const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const cases = require('./fixtures/consumer-v1/cases.json');

async function nullReplacement(browser, base, output, name) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(base + '/catalog-indexed/');
    await page.waitForFunction(() => catalogTest.app.catalogLoader?.sceneComplete());
    await page.evaluate(async pin => {
      const app = window.app = catalogTest.app;
      app.autoRender = false; app.cancelRender();
      app.elapsed = 2; app.renderFrame(1000);
      window.completed = { cloud: app.renderer.asteroids, model: app.catalogue,
        pixels: app.renderer.canvas.toDataURL(), date: app.gui.date.textContent, count: app.gui.count.textContent };
      await app.loadCatalog(pin);
    }, { ...cases.bundles.ties.pin, url: base + '/catalog-fixtures/ties/index.json' });
    await page.waitForFunction(() => app.catalogLoader.committedCount >= 4);
    await page.evaluate(() => {
      window.candidate = app.pendingSession.model;
      const adapter = app.renderer, encoder = adapter.app.renderer.encoder, draw = encoder.draw;
      let missed = false;
      encoder.draw = function(options) {
        if (!missed && options.geometry === adapter.asteroids?.geometry
          && adapter.asteroids.catalogue === candidate) { missed = true; return; }
        return draw.call(this, options);
      };
      const renderFrame = app.renderFrame;
      app.renderFrame = function(...args) {
        const result = renderFrame.apply(this, args);
        if (missed && !window.nullReceipt) window.nullReceipt = {
          previousActive: adapter.asteroids === completed.cloud && completed.cloud.visible,
          previousModel: app.catalogue === completed.model,
          retainedCandidate: adapter.stagedAsteroids?.catalogue === candidate,
          unchangedHud: app.gui.date.textContent === completed.date && app.gui.count.textContent === completed.count,
          previousPixels: adapter.canvas.toDataURL() === completed.pixels,
          retryScheduled: app.animationFrame !== null,
        };
        return result;
      };
      app.autoRender = true; app.requestRender();
    });
    await page.waitForFunction(() => !!window.nullReceipt);
    assert.deepEqual(await page.evaluate(() => nullReceipt), {
      previousActive: true, previousModel: true, retainedCandidate: true,
      unchangedHud: true, previousPixels: true, retryScheduled: true,
    }, 'A missing real candidate submission restores the completed mesh/HUD and schedules a retry');
    await page.waitForFunction(() => app.catalogue === candidate && app.catalogLoader.sceneComplete()
      && !app.pendingSession && app.animationFrame === null);
    assert.equal(await page.locator('#orrery-count').textContent(), '4');
    assert.equal(await page.evaluate(() => completed.cloud.destroyed), true, 'Previous mesh is released only after the retry commits');
    await page.screenshot({ path: path.join(output, name + '-null-receipt-recovered.png') });
    assert.deepEqual(errors, []);
    return { automaticNullReceipt: true, retainedReplacement: true };
  } finally { await page.close(); }
}

async function bundledFailures(browser, base, output, name) {
  const results = [];
  for (const motion of ['playback', 'seek']) for (const kind of ['update', 'draw', 'null']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(base + '/catalog-historical/');
      await page.evaluate(() => catalogReady);
      await page.evaluate(() => {
        const app = window.app = catalogTest.app;
        app.autoRender = false; app.cancelRender(); app.jedDelta = 0;
        // The real default entry loaded historical100k through loadAsteroids /
        // setAsteroids, with no shared-loader session. Cross both phase and
        // marker rebase boundaries on the failing playback frame.
        app.jed = app.renderer.asteroids.epoch + 250;
        app.elapsed = 4096; app.renderFrame(1000);
        app.jedDelta = 1.5; app.renderFrame(2000);
      });
      assert.equal(await page.evaluate(() => app.catalogue.count), 100000);
      assert.equal(await page.evaluate(() => app.activeSession ?? null), null);
      const failure = await page.evaluate(({ kind, motion }) => {
        app.renderFrame(2000); // Draw/capture before the browser discards its WebGL drawing buffer.
        if (motion === 'seek') app.jedDelta = 0;
        const adapter = app.renderer, cloud = adapter.asteroids, encoder = adapter.app.renderer.encoder;
        const before = { jed: app.jed, elapsed: app.elapsed, count: app.asteroidsDiscovered,
          dateText: app.gui.date.textContent, countText: app.gui.count.textContent,
          pixels: adapter.canvas.toDataURL(), epoch: cloud.epoch, markerEpoch: cloud.markerEpoch,
          orbitTime: cloud.uniforms.uOrbitTime, markerTime: cloud.uniforms.uMarkerTime,
          means: cloud.geometry.getBuffer('aMeanAnomaly').data.slice(),
          markers: cloud.geometry.getBuffer('aDiscovery').data.slice(),
          planets: adapter.planets.map(planet => [planet.body.x, planet.body.y]) };
        window.targetDate = motion === 'seek' ? before.jed + 257 : before.jed;
        if (motion === 'seek') app.jed = targetDate;
        const update = adapter.update, render = adapter.render, draw = encoder.draw;
        let thrown, skipped = false;
        if (kind === 'update') adapter.update = frame => { update.call(adapter, frame); throw new Error('controlled bundled update failure'); };
        if (kind === 'draw') adapter.render = () => { throw new Error('controlled bundled draw failure'); };
        if (kind === 'null') encoder.draw = function(options) {
          if (!skipped && options.geometry === cloud.geometry) { skipped = true; return; }
          return draw.call(this, options);
        };
        try { app.renderFrame(2100); } catch (error) { thrown = error.message; }
        finally { adapter.update = update; adapter.render = render; encoder.draw = draw; }
        window.completedPixels = before.pixels;
        window.completedState = before;
        window.failedPixels = adapter.canvas.toDataURL();
        return { thrown: thrown ?? null, kind, motion,
          frame: app.jed === before.jed && app.elapsed === before.elapsed && app.asteroidsDiscovered === before.count,
          hud: app.gui.date.textContent === before.dateText && app.gui.count.textContent === before.countText,
          cloud: cloud.epoch === before.epoch && cloud.markerEpoch === before.markerEpoch
            && cloud.uniforms.uOrbitTime === before.orbitTime && cloud.uniforms.uMarkerTime === before.markerTime
            && cloud.geometry.instanceCount === before.count,
          buffers: before.means.every((value, i) => value === cloud.geometry.getBuffer('aMeanAnomaly').data[i])
            && before.markers.every((value, i) => value === cloud.geometry.getBuffer('aDiscovery').data[i]),
          planets: adapter.planets.every((planet, i) => planet.body.x === before.planets[i][0] && planet.body.y === before.planets[i][1]),
          pixels: adapter.canvas.toDataURL() === before.pixels,
          clock: app.clock.previous === null && app.jedDelta === (motion === 'seek' ? 0 : 1.5),
          pending: app.requestedJed === (motion === 'seek' ? targetDate : null),
        };
      }, { kind, motion });
      if (!failure.pixels) {
        for (const [label, key] of [['before', 'completedPixels'], ['failed', 'failedPixels']]) {
          const image = await page.evaluate(key => window[key], key);
          await fs.writeFile(path.join(output, name + '-bundled-' + motion + '-' + kind + '-' + label + '.png'), Buffer.from(image.split(',')[1], 'base64'));
        }
      }
      assert.deepEqual(failure, { kind, motion, thrown: kind === 'null' ? null : `controlled bundled ${kind} failure`,
        frame: true, hud: true, cloud: true, buffers: true, planets: true, pixels: true, clock: true, pending: true },
      'Failed default frames restore app, HUD, phase/arrival buffers and planets');
      await page.evaluate(() => {
        window.loss = app.renderer.app.renderer.gl.getExtension('WEBGL_lose_context');
        loss.loseContext();
      });
      await page.waitForFunction(() => app.contextLost);
      await page.evaluate(() => loss.restoreContext());
      await page.waitForFunction(() => !app.contextLost);
      const recovered = await page.evaluate(() => {
        app.renderFrame(2200);
        return { failure: app.renderFailure?.message ?? null,
        equal: app.renderer.canvas.toDataURL() === completedPixels,
        date: [app.jed, completedState.jed], elapsed: [app.elapsed, completedState.elapsed],
        epoch: [app.renderer.asteroids.epoch, completedState.epoch],
        markerEpoch: [app.renderer.asteroids.markerEpoch, completedState.markerEpoch],
        target: app.jed === targetDate && app.renderer.frameState.jed === targetDate && app.requestedJed === null };
      });
      if (motion === 'playback' && !recovered.equal) {
        const before = await page.evaluate(() => completedPixels);
        await fs.writeFile(path.join(output, name + '-bundled-' + motion + '-' + kind + '-before.png'), Buffer.from(before.split(',')[1], 'base64'));
        await page.screenshot({ path: path.join(output, name + '-bundled-' + motion + '-' + kind + '-failed-recovery.png') });
      }
      assert(recovered.failure === null && recovered.target && (motion === 'seek' || recovered.equal),
        JSON.stringify(recovered) + ': ' +
        'A fresh render after real graphics recovery keeps the completed frame');
      await page.screenshot({ path: path.join(output, name + '-bundled-' + motion + '-' + kind + '-recovered.png') });
      assert.deepEqual(errors, []);
      results.push({ bundledFailure: kind, motion, rollback: true, recovery: true });
    } finally { await page.close(); }
  }
  return results;
}

async function directTickBuffering(browser, base, output, name) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  try {
    await page.goto(base + '/catalog-historical/');
    await page.evaluate(() => catalogReady);
    await page.route('**/catalog-fixtures/ties/chunks/*.json', async route => { await gate; await route.continue(); });
    await page.evaluate(async pin => {
      const app = window.app = catalogTest.app;
      app.autoRender = false; app.cancelRender(); app.jedDelta = 0;
      app.jed = 2451544.5;
      app.tick(1000); app.renderer.app.render(); // Supported direct-update compatibility seam.
      const cloud = app.renderer.asteroids;
      window.completed = { cloud, model: app.catalogue, frame: app.renderer.frameState,
        pixels: app.renderer.canvas.toDataURL(), date: app.gui.date.textContent, count: app.gui.count.textContent,
        epoch: cloud.epoch, markerEpoch: cloud.markerEpoch,
        means: cloud.geometry.getBuffer('aMeanAnomaly').data.slice(),
        markers: cloud.geometry.getBuffer('aDiscovery').data.slice() };
      await app.loadCatalog(pin);
    }, { ...cases.bundles.ties.pin, url: base + '/catalog-fixtures/ties/index.json' });
    const waiting = await page.evaluate(() => {
      app.renderFrame(1100);
      // A later redraw must also preserve the last completed direct tick.
      app.renderer.render();
      const cloud = app.renderer.asteroids;
      return { buffering: app.catalogWaiting && app.pendingSession.model.count === 0,
        previousActive: cloud === completed.cloud && app.catalogue === completed.model,
        frame: app.jed === completed.frame.jed && app.elapsed === completed.frame.elapsed
          && app.asteroidsDiscovered === completed.frame.count
          && JSON.stringify(app.renderer.frameState) === JSON.stringify(completed.frame),
        hud: app.gui.date.textContent === completed.date && app.gui.count.textContent === completed.count,
        buffers: cloud.epoch === completed.epoch && cloud.markerEpoch === completed.markerEpoch
          && completed.means.every((value, i) => value === cloud.geometry.getBuffer('aMeanAnomaly').data[i])
          && completed.markers.every((value, i) => value === cloud.geometry.getBuffer('aDiscovery').data[i]),
        pixels: app.renderer.canvas.toDataURL() === completed.pixels };
    });
    assert.deepEqual(waiting, { buffering: true, previousActive: true, frame: true, hud: true, buffers: true, pixels: true },
      'A buffering replacement cannot consume a snapshot from an already completed direct tick');
    release();
    await page.waitForFunction(() => app.catalogLoader.committedCount >= 4);
    await page.evaluate(() => app.renderFrame(1200));
    assert.equal(await page.evaluate(() => app.catalogLoader.sceneComplete() && !app.pendingSession && app.catalogue !== completed.model), true);
    await page.screenshot({ path: path.join(output, name + '-direct-tick-replacement.png') });
    assert.deepEqual(errors, []);
    return { directTickBuffering: true, completedFramePreserved: true, replacementRecovered: true };
  } finally { release(); await page.close(); }
}

async function run(browser, base, output, name) {
  return [await nullReplacement(browser, base, output, name), ...await bundledFailures(browser, base, output, name),
    await directTickBuffering(browser, base, output, name)];
}
module.exports = { run, nullReplacement, bundledFailures, directTickBuffering };
