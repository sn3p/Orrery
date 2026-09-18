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
    assert.deepEqual(await page.evaluate(() => ({
      pending: !!app.pendingSession && !app.catalogLoader.initialRendered,
      previousActive: app.renderer.asteroids === completed.cloud && app.catalogue === completed.model,
      hud: app.gui.date.textContent === completed.date && app.gui.count.textContent === completed.count,
    })), { pending: true, previousActive: true, hud: true },
    'An unrendered replacement retains the committed scene while reporting its loading state');
    assert.equal(await page.locator('.orrery-status-label').textContent(), 'Loading asteroids…');
    assert.equal(await page.locator('#orrery-status').ariaSnapshot(), '- status: Loading asteroids…');
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
    assert.equal(await page.locator('#orrery-status').textContent(), '');
    await page.screenshot({ path: path.join(output, name + '-direct-tick-replacement.png') });
    assert.deepEqual(errors, []);
    return { directTickBuffering: true, completedFramePreserved: true, replacementRecovered: true };
  } finally { release(); await page.close(); }
}

async function loaderlessSeek(browser, base) {
  const results = [];
  for (const renderer of ['pixi', 'three']) {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`${base}/catalog-historical/?renderer=${renderer}`);
      await page.evaluate(() => catalogReady);
      const result = await page.evaluate(() => {
        const app = window.app = catalogTest.app;
        app.autoRender = false;
        app.cancelRender();
        app.jedDelta = 1.5;
        app.resetClock();
        app.renderFrame(1000);
        const target = app.jed + 257;
        app.jed = target;
        app.renderFrame(1100);
        const cloud = app.renderer.asteroids;
        const baseline = app.rendererId === 'pixi'
          ? Array.from(cloud.geometry.getBuffer('aDiscovery').data.slice(0, cloud.geometry.instanceCount))
          : cloud.uniforms.discoveryBaseline.value;
        return { target, jed: app.jed, frameJed: app.renderer.frameState.jed,
          pending: app.pendingSeek, requested: app.requestedJed, baseline };
      });
      assert.equal(result.jed, result.target, `${renderer}: running loaderless seek commits the exact target`);
      assert.equal(result.frameJed, result.target, `${renderer}: renderer commits the exact loaderless target`);
      assert.equal(result.pending, null, `${renderer}: exact loaderless seek clears pending ownership`);
      assert.equal(result.requested, null, `${renderer}: exact loaderless seek clears the queued target`);
      if (renderer === 'pixi') assert(result.baseline.length > 0 && result.baseline.every(value => value === -1),
        'Pixi loaderless seek treats every existing discovery as mature');
      else assert.equal(result.baseline, result.target - 2458600.5,
        'Three loaderless seek treats existing discoveries as mature');
      assert.deepEqual(errors, []);
      results.push({ renderer, exactTarget: true, matureBaseline: true });
    } finally { await page.close(); }
  }
  return results;
}

async function uploadFailurePage(browser, version) {
  const page = await browser.newPage();
  if (version === 1) await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return type === 'webgl2' ? null : getContext.call(this, type, ...args);
    };
  });
  return page;
}

function uploadDiagnostics(page, name) {
  const errors = [], consoleErrors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  return actualVersion => {
    // The no-fault WebKit/WebGL1 baseline emits this existing Pixi texture
    // setup warning on initialization/restoration (also noted in gpu.cjs).
    // Record it explicitly; no other console or JavaScript error is allowed.
    const known = message => name === 'webkit' && actualVersion === 1
      && message === 'WebGL: INVALID_ENUM: texParameter: invalid parameter name';
    assert.deepEqual(errors, []);
    assert.deepEqual(consoleErrors.filter(message => !known(message)), []);
    return consoleErrors.filter(known);
  };
}

async function bundledUploadFailure(browser, base, output, name, version = 2) {
  const page = await uploadFailurePage(browser, version);
  const diagnostics = uploadDiagnostics(page, name);
  try {
    await page.goto(base + '/catalog-historical/');
    await page.evaluate(() => catalogReady);
    const failed = await page.evaluate(async () => {
      const app = window.app = catalogTest.app;
      app.autoRender = false; app.cancelRender(); app.jedDelta = 0;
      // Bundled attachment now draws synchronously. Unload its real GPU buffer
      // to exercise allocation recovery on the completed historical scene.
      // Initial and replacement first-draw faults live in three-bundled.cjs.
      const rows = await (await fetch('./data/catalog.json')).json();
      app.setAsteroids(rows);
      const cloud = app.renderer.asteroids, renderer = app.renderer.app.renderer, gl = renderer.gl;
      const basis = cloud.geometry.getBuffer('aBasis');
      basis.unload();
      const before = { jed: app.jed, elapsed: app.elapsed, count: app.asteroidsDiscovered };
      window.uploadTarget = before.jed + 1;
      const bufferData = gl.bufferData, getError = gl.getError;
      let attempts = 0, pendingError = false, thrown;
      gl.bufferData = function(target, data, ...args) {
        if (data === basis.data && ++attempts === 1) { pendingError = true; return; }
        return bufferData.call(this, target, data, ...args);
      };
      gl.getError = function() {
        if (pendingError) { pendingError = false; return gl.OUT_OF_MEMORY; }
        return getError.call(this);
      };
      try {
        try { app.renderFrame(1000); } catch (error) { thrown = error.message; }
        // A later invalidation must not consume a requested date after
        // reallocation of the completed scene has failed.
        app.jed = uploadTarget;
        app.renderFrame(1100);
        gl.bindBuffer(gl.ARRAY_BUFFER, basis._gpuData[renderer.uid].buffer);
        return { thrown, attempts, allocated: gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE) === basis.data.byteLength,
          frame: app.jed === before.jed && app.elapsed === before.elapsed && app.asteroidsDiscovered === before.count,
          requested: app.requestedJed === uploadTarget, firstDraw: !!app.catalogue.firstDraw,
          failed: !!app.renderFailure, population: app.catalogue.count, version: renderer.context.webGLVersion };
      } finally { gl.bufferData = bufferData; gl.getError = getError; }
    });
    assert.deepEqual(failed, { thrown: 'Unable to upload asteroid buffers.', attempts: 2, allocated: true,
      frame: true, requested: true, firstDraw: true, failed: true, population: 100000, version },
    'A failed historical upload cannot publish a later frame, and repaint must rebuild actual GPU storage');
    await page.evaluate(() => { app.autoRender = true; });
    await page.getByRole('button', { name: 'Options' }).click();
    await page.getByRole('textbox', { name: 'Playback speed' }).fill('1.5');
    await page.getByRole('textbox', { name: 'Playback speed' }).press('Enter');
    const invalidated = await page.evaluate(async () => {
      await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
      const result = { retainedDate: app.jed === uploadTarget - 1, requested: app.requestedJed === uploadTarget,
        firstDraw: !!app.catalogue.firstDraw, pending: app.animationFrame };
      app.autoRender = false; app.cancelRender();
      return result;
    });
    assert.deepEqual(invalidated, { retainedDate: true, requested: true, firstDraw: true, pending: null },
      'A real speed-control invalidation cannot resume a terminal graphics failure');
    await page.evaluate(() => {
      window.uploadLoss = app.renderer.app.renderer.gl.getExtension('WEBGL_lose_context');
      uploadLoss.loseContext();
    });
    await page.waitForFunction(() => app.contextLost);
    await page.evaluate(() => uploadLoss.restoreContext());
    await page.waitForFunction(() => !app.contextLost);
    const recovered = await page.evaluate(() => {
      app.renderFrame(1200);
      return { complete: !!app.catalogue.firstDraw, failure: !!app.renderFailure,
        requested: app.requestedJed, date: app.jed === uploadTarget, pending: app.animationFrame };
    });
    assert.deepEqual(recovered, { complete: true, failure: false, requested: null, date: true, pending: null });
    const partial = await page.evaluate(() => {
      app.jedDelta = 0; app.renderFrame(1200);
      const adapter = app.renderer, renderer = adapter.app.renderer, gl = renderer.gl;
      const means = adapter.asteroids.geometry.getBuffer('aMeanAnomaly');
      const before = { jed: app.jed, pixels: adapter.canvas.toDataURL() };
      const bufferSubData = gl.bufferSubData, bufferData = gl.bufferData, getError = gl.getError;
      let injected = false, pendingError = false, fullUpload = false, thrown;
      gl.bufferSubData = function(target, offset, data, ...args) {
        if (!injected && data === means.data) { injected = pendingError = true; return; }
        return bufferSubData.call(this, target, offset, data, ...args);
      };
      gl.bufferData = function(target, data, ...args) {
        if (injected && data === means.data) fullUpload = true;
        return bufferData.call(this, target, data, ...args);
      };
      gl.getError = function() {
        if (pendingError) { pendingError = false; return gl.OUT_OF_MEMORY; }
        return getError.call(this);
      };
      try {
        app.jed = adapter.asteroids.epoch + 257;
        try { app.renderFrame(1300); } catch (error) { thrown = error.message; }
        let gpuMatches = true;
        if (renderer.context.webGLVersion === 2) {
          const gpu = new Float32Array(means.data.length);
          gl.bindBuffer(gl.ARRAY_BUFFER, means._gpuData[renderer.uid].buffer);
          gl.getBufferSubData(gl.ARRAY_BUFFER, 0, gpu);
          gpuMatches = gpu.every((value, index) => value === means.data[index]);
        }
        return { thrown, injected, fullUpload, gpuMatches, date: app.jed === before.jed,
          pixels: adapter.canvas.toDataURL() === before.pixels, failed: !!app.renderFailure };
      } finally { gl.bufferSubData = bufferSubData; gl.bufferData = bufferData; gl.getError = getError; }
    });
    assert.deepEqual(partial, { thrown: 'Unable to upload asteroid buffers.', injected: true, fullUpload: true,
      gpuMatches: true, date: true, pixels: true, failed: true },
    'A failed existing-buffer update must restore the complete frame with a full GPU upload');
    assert.equal(await page.evaluate(async () => {
      app.setAsteroids(await (await fetch('./data/catalog.json')).json());
      app.renderFrame(1400);
      return !app.renderFailure && app.catalogue.firstDraw && app.animationFrame === null;
    }), true, 'A fresh direct catalogue remains a valid same-page benchmark recovery');
    await page.screenshot({ path: path.join(output, name + '-bundled-upload-webgl' + version + '-recovered.png') });
    return { bundledUpload: failed, recovered, partialUpdate: partial, directRecovery: true,
      textureSetupWarnings: diagnostics(failed.version) };
  } finally { await page.close(); }
}

async function replacementUploadFailure(browser, base, output, name, version = 2) {
  const page = await uploadFailurePage(browser, version);
  const diagnostics = uploadDiagnostics(page, name);
  try {
    await page.goto(base + '/catalog-indexed/');
    await page.waitForFunction(() => catalogTest.app.catalogLoader?.sceneComplete());
    await page.evaluate(async pin => {
      const app = window.app = catalogTest.app;
      app.autoRender = false; app.cancelRender();
      app.elapsed = 2; app.renderFrame(1000);
      await app.loadCatalog(pin);
    }, { ...cases.bundles.ties.pin, url: base + '/catalog-fixtures/ties/index.json' });
    await page.waitForFunction(() => app.catalogLoader.committedCount >= 4);
    const failed = await page.evaluate(() => {
      const adapter = app.renderer, gl = adapter.app.renderer.gl;
      adapter.render(); // Capture a live previous framebuffer, before its discard.
      const previous = { cloud: adapter.asteroids, model: app.catalogue, pixels: adapter.canvas.toDataURL(),
        jed: app.jed, elapsed: app.elapsed, count: app.asteroidsDiscovered };
      const bufferData = gl.bufferData, getError = gl.getError, clear = gl.clear;
      let pendingError = false, injected = false, cleared = false, failedAfterClear = false, thrown;
      gl.clear = function(...args) { cleared = true; return clear.apply(this, args); };
      gl.bufferData = function(target, data, ...args) {
        if (!injected && data === adapter.asteroids.geometry.getBuffer('aBasis').data
          && adapter.asteroids !== previous.cloud) {
          injected = pendingError = true; failedAfterClear = cleared; return;
        }
        return bufferData.call(this, target, data, ...args);
      };
      gl.getError = function() {
        if (pendingError) { pendingError = false; return gl.OUT_OF_MEMORY; }
        return getError.call(this);
      };
      try {
        try { app.renderFrame(1100); } catch (error) { thrown = error.message; }
        window.replacementBeforePixels = previous.pixels;
        window.replacementFailedPixels = adapter.canvas.toDataURL();
        return { thrown, failedAfterClear,
          retained: adapter.asteroids === previous.cloud && app.catalogue === previous.model,
          pixels: replacementFailedPixels === previous.pixels,
          frame: app.jed === previous.jed && app.elapsed === previous.elapsed && app.asteroidsDiscovered === previous.count,
          complete: app.catalogLoader.sceneComplete(), failed: !!app.renderFailure, pending: app.animationFrame,
          version: adapter.app.renderer.context.webGLVersion };
      } finally { gl.bufferData = bufferData; gl.getError = getError; gl.clear = clear; }
    });
    for (const [label, key] of [['before', 'replacementBeforePixels'], ['failed', 'replacementFailedPixels']]) {
      const image = await page.evaluate(key => window[key], key);
      await fs.writeFile(path.join(output, name + '-replacement-upload-webgl' + version + '-' + label + '.png'), Buffer.from(image.split(',')[1], 'base64'));
    }
    assert.deepEqual(failed, { thrown: 'Unable to upload asteroid buffers.', failedAfterClear: true,
      retained: true, pixels: true, frame: true, complete: false, failed: true, pending: null, version },
    'A throwing replacement upload after target clearing must repaint the retained complete scene');
    await page.evaluate(pin => app.loadCatalog(pin), { ...cases.bundles.ties.pin, url: base + '/catalog-fixtures/ties/index.json' });
    await page.waitForFunction(() => app.catalogLoader.committedCount >= 4);
    assert.equal(await page.evaluate(() => {
      app.renderFrame(1200);
      return app.catalogLoader.sceneComplete() && !app.renderFailure && app.animationFrame === null;
    }), true, 'A new replacement remains a valid explicit recovery');
    return { replacementUpload: failed, recovered: true, textureSetupWarnings: diagnostics(failed.version) };
  } finally { await page.close(); }
}

async function run(browser, base, output, name) {
  const results = [await nullReplacement(browser, base, output, name), ...await bundledFailures(browser, base, output, name),
    await directTickBuffering(browser, base, output, name), ...await loaderlessSeek(browser, base)];
  for (const version of [1, 2]) {
    results.push(await bundledUploadFailure(browser, base, output, name, version),
      await replacementUploadFailure(browser, base, output, name, version));
  }
  return results;
}
module.exports = { run, nullReplacement, bundledFailures, directTickBuffering, loaderlessSeek,
  bundledUploadFailure, replacementUploadFailure };
