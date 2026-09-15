const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, serve } = require('./support.cjs');
function raster(image) {
  const png = Buffer.from(image.split(',')[1], 'base64'), data = [];
  let header;
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    const bytes = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') header = bytes;
    if (type === 'IDAT') data.push(bytes);
    offset += length + 12;
  }
  // Firefox adds a different deBG ancillary chunk per canvas. Compare exact
  // raster scanlines/dimensions, excluding PNG metadata; no pixel tolerance.
  return Buffer.concat([header, require('node:zlib').inflateSync(Buffer.concat(data))]);
}

async function run({ browser, name, application = "legacy", output: artifactDirectory }) {
  const output = artifactDirectory || '.context/pr2/contracts';
  assert.equal(application, 'legacy', 'Raw comparison must not alias the legacy reference');
  // No alias: compare the actual legacy class and actual production controller.
  await build('./tests/unified-fixture.js', path.join(output, 'fixture'), { application });
  const server = await serve(output), report = [];
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
    await page.goto(server.url + '/fixture/');
    const lifecycle = await page.evaluate(async () => {
      const { App, PixiRenderer, Application } = fixture;
      const check = (v, m) => { if (!v) throw new Error(m); };
      const pendingFrames = new Set();
      const raf = window.requestAnimationFrame, caf = window.cancelAnimationFrame;
      window.requestAnimationFrame = fn => { const id = raf.call(window, t => { pendingFrames.delete(id); fn(t); }); pendingFrames.add(id); return id; };
      window.cancelAnimationFrame = id => { pendingFrames.delete(id); caf.call(window, id); };
      let app, release;
      const init = Application.prototype.init;
      try {
        let adapter;
        app = new App({ createRenderer: callbacks => new Promise(resolve => { release = () => resolve(adapter = new PixiRenderer(callbacks)); }) });
        const first = app.init();
        check(app.init() === first, 'Raw App initialization is shared');
        app.destroy(); release(); await first;
        check(adapter.destroyed && !adapter.app, 'Disposal during lazy loading prevents GPU allocation');
        for (const afterAllocation of [false, true]) {
          let failedPixi;
          Application.prototype.init = async function(options) {
            failedPixi = this;
            if (afterAllocation) await init.call(this, options);
            throw new Error('forced init failure');
          };
          app = new App();
          let rejected = false;
          try { await app.init(); } catch { rejected = true; }
          check(rejected && app.destroyed && !app.initialized, 'Failed init is terminal and disposed');
          check(!failedPixi.renderer && !failedPixi.stage, 'Failed init releases partial GPU/stage resources');
          check(!document.querySelector('canvas, .orrery-options'), 'Failed init attaches no canvas/UI');
          check(document.getElementById('orrery-status').textContent.includes('Unable to start'), 'Initial error remains visible');
          app.destroy(); app.destroy(); app.renderStatus();
          check(!document.getElementById('orrery-status').textContent, 'Explicit teardown clears failed Pixi startup feedback');
        }
        Application.prototype.init = init;
        app = new App({ autoRender: false, jedDelta: 0 });
        // Exercise a real early load; App must wait for its own lazy renderer.
        check(await app.loadAsteroids(fixture.catalogURL), 'Load before init is accepted and committed');
        check(app.renderer.asteroids.discoveryDates.length === 100000, 'Historical100k committed');
        check(app.renderer.app.ticker.count === 1 && !app.renderer.app.ticker.started,
          'Production Pixi ticker retains only its own render listener, no clock bridge');
        app.addPlanets(fixture.planets);
        app.jedDelta = 1.5;
        app.renderFrame(0); const start = app.jed;
        for (let i = 1; i <= 60; i++) app.renderFrame(i * 1000 / 60);
        check(Math.abs(app.jed - start - 90) < 1e-6, 'Raw shell advances exactly90days/second');
        app.renderFrame(100000);
        check(Math.abs(app.jed - start - 112.5) < 1e-6, 'Long stalls preserve the existing250ms cap');
        app.destroy(); app.destroy();
        check(!document.querySelector('canvas, .orrery-options') && pendingFrames.size === 0, 'Raw lifecycle leaves no UI/canvas/RAF');
        return { sharedInit: true, lazyDispose: true, failedInit: ['before-allocation', 'after-allocation'], earlyLoad: 100000, clock: true, pendingFrames: pendingFrames.size };
      } finally {
        release?.(); Application.prototype.init = init; app?.destroy();
        window.requestAnimationFrame = raf; window.cancelAnimationFrame = caf;
      }
    });
    assert.deepEqual(errors, []);
    let releaseLoad;
    const gate = new Promise(resolve => { releaseLoad = resolve; });
    await page.route('**/delayed-catalog', async route => {
      await gate; await route.fulfill({ json: [] }).catch(() => {});
    });
    try {
      await page.evaluate(async () => {
        window.recoveryApp = new fixture.App({ jedDelta: 0, autoRender: false });
        await recoveryApp.init();
        await recoveryApp.loadAsteroids(fixture.catalogURL);
        recoveryApp.renderFrame(0);
        window.completedRecoveryModel = recoveryApp.catalogue;
        window.completedRecoveryCloud = recoveryApp.renderer.asteroids;
        window.completedRecoveryHud = recoveryApp.gui.count.textContent;
        window.pendingLoad = recoveryApp.loadAsteroids('/delayed-catalog');
        const adapter = recoveryApp.renderer;
        window.originalTexture = adapter.createCircleTexture;
        window.contextExtension = adapter.app.renderer.gl.getExtension('WEBGL_lose_context');
        if (!contextExtension) throw new Error('Context-loss testing requires WEBGL_lose_context');
        contextExtension.loseContext();
      });
      await page.waitForFunction(() => recoveryApp.contextLost);
      await page.evaluate(() => {
        recoveryApp.renderer.createCircleTexture = () => { throw new Error('forced recovery failure'); };
        contextExtension.restoreContext();
      });
      await page.getByRole('status').filter({ hasText: 'Unable to restore' }).waitFor();
      releaseLoad();
      assert.equal(await page.evaluate(() => pendingLoad), false, 'Data received during graphics loss has not drawn or committed');
      assert(await page.evaluate(() => recoveryApp.catalogue === completedRecoveryModel && recoveryApp.pendingBundled.model.count === 0),
        'The completed model stays active and newly received data remains available for recovery');
      assert(await page.evaluate(() => recoveryApp.renderer.asteroids === completedRecoveryCloud
        && recoveryApp.renderer.asteroids.catalogue === completedRecoveryModel
        && recoveryApp.renderer.asteroids.discoveryDates.length === completedRecoveryModel.count
        && recoveryApp.gui.count.textContent === completedRecoveryHud),
        'Graphics failure retains the completed cloud and readouts alongside the completed model');
      assert.match(await page.getByRole('status').textContent(), /Unable to restore/,
        'Data success must preserve the graphics failure and recovery instruction');
      assert(await page.evaluate(() => recoveryApp.contextLost && recoveryApp.animationFrame === null));
      await page.evaluate(() => {
        recoveryApp.renderer.createCircleTexture = originalTexture;
        window.beforeSecondLoss = recoveryApp.rendererGeneration;
        contextExtension.loseContext();
      });
      await page.waitForFunction(() => recoveryApp.rendererGeneration > beforeSecondLoss
        && recoveryApp.renderer.app.renderer.gl.isContextLost());
      await page.evaluate(() => contextExtension.restoreContext());
      await page.waitForFunction(() => !recoveryApp.contextLost);
      assert(await page.evaluate(() => {
        const candidate = recoveryApp.pendingBundled.model;
        recoveryApp.tick(1000);
        if (recoveryApp.renderer.asteroids !== completedRecoveryCloud) return false;
        recoveryApp.renderFrame(1100);
        return recoveryApp.catalogue === candidate && !recoveryApp.pendingBundled && candidate.firstDraw
          && recoveryApp.renderer.asteroids.catalogue === candidate
          && recoveryApp.renderer.asteroids.discoveryDates.length === 0 && recoveryApp.asteroidsDiscovered === 0;
      }), 'A restored full frame commits the retained empty candidate');
      await page.evaluate(() => {
        recoveryApp.destroy(); recoveryApp.destroy();
      });
      assert.equal(await page.getByRole('status').textContent(), '');
      lifecycle.failedRecoveryWithPendingData = true;
    } finally { releaseLoad(); await page.close(); }

    const comparisons = [];
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 320, height: 568 }, { width: 844, height: 390 }]) {
      for (const dpr of [1, 2]) {
        const pages = [];
        try {
          for (const application of ['Legacy', 'App']) {
            const p = await browser.newPage({ viewport, deviceScaleFactor: dpr });
            pages.push(p);
            p.on('pageerror', e => errors.push(e.message));
            p.on('console', m => { if (m.type() === 'error') errors.push(`${name}: ${m.text()}`); });
            await p.goto(server.url + '/fixture/');
            await p.evaluate(async application => {
              const app = window.app = new fixture[application]({ jedDelta: 0, autoRender: false, resolution: devicePixelRatio });
              await app.init();
              window.scene = app.renderer ?? app;
              app.addPlanets(fixture.planets);
              window.catalog = await (await fetch(fixture.catalogURL)).json();
            }, application);
          }
          for (const [label, jed, elapsed, scale] of [
            ['sparse-fresh', 2415020.5, 0, 1], ['sparse-half', 2415020.5, 1 / 3, 1], ['sparse-mature', 2415020.5, 1, 1],
            ['dense-fresh', 2458600.5, 0, 1], ['dense-half', 2458600.5, 1 / 3, 1], ['dense-mature', 2458600.5, 1, 1],
            ['zoom', 2458600.5, 1, 4], ['overview', 2458600.5, 1, 0.35], ['reverse', 2444269.5, 1, 1],
          ]) {
            const results = [];
            for (const p of pages) {
              // Firefox backgrounds the previous page when another opens;
              // production deliberately does no scene work while hidden.
              await p.bringToFront();
              await p.waitForFunction(() => !document.hidden);
              results.push(await p.evaluate(({ jed, elapsed, scale }) => {
              app.jed = jed; app.elapsed = 0;
              app.setAsteroids(catalog); app.elapsed = elapsed;
              scene.stage.scale.set(scale);
              app.renderFrame(0);
              const result = { pixels: scene.canvas.toDataURL(), date: app.gui.date.textContent, count: Number(app.gui.count.textContent.replaceAll(",", "")),
                resources: { sceneChildren: scene.stage.children.length, planets: scene.planets.length,
                  geometries: Object.keys(scene.app.renderer.geometry._managedGeometries.items).length,
                  buffers: scene.asteroids.geometry.buffers.length,
                  bufferBytes: scene.asteroids.geometry.buffers.reduce((n, b) => n + b.data.byteLength, 0),
                  phaseBytes: scene.asteroids.phases.byteLength, dateBytes: scene.asteroids.discoveryDates.byteLength } };
              return result;
              }, { jed, elapsed, scale }));
            }
            assert(raster(results[1].pixels).equals(raster(results[0].pixels)) && results[1].date === results[0].date && results[1].count === results[0].count, `${name} ${label} ${viewport.width}x${viewport.height} DPR${dpr}: exact scene pixels/HUD`);
            assert.deepEqual(results[1].resources, results[0].resources, 'Retained scene/GPU/CPU resource counts match');
            comparisons.push({ viewport, dpr, label, equal: true, resources: results[1].resources });
            if (dpr === 1 && ['dense-mature', 'sparse-half'].includes(label)) {
              for (let i = 0; i < pages.length; i++) {
                await pages[i].bringToFront(); await pages[i].waitForFunction(() => !document.hidden);
                await pages[i].evaluate(() => app.renderFrame(0));
                await pages[i].screenshot({ path: path.join(output, `${name}-${i ? 'preview' : 'legacy'}-${viewport.width}-${label}.png`) });
              }
            }
          }
          if (viewport.width === 1280 && dpr === 1) {
            for (let cycle = 0; cycle < 2; cycle++) {
              const images = [];
              for (const p of pages) {
                await p.bringToFront(); await p.waitForFunction(() => !document.hidden);
                const before = await p.evaluate(() => {
                  app.renderFrame(0);
                  window.beforeRecovery = scene.canvas.toDataURL();
                  window.extension = scene.app.renderer.gl.getExtension('WEBGL_lose_context');
                  extension.loseContext();
                  return beforeRecovery;
                });
                await p.waitForFunction(() => app.contextLost);
                await p.evaluate(() => extension.restoreContext());
                await p.waitForFunction(() => !app.contextLost);
                const after = await p.evaluate(() => { app.renderFrame(0); return scene.canvas.toDataURL(); });
                assert(raster(after).equals(raster(before)), 'Graphics recovery restores exact mature pixels');
                images.push(after);
              }
              assert(raster(images[0]).equals(raster(images[1])), 'Legacy and preview recovery pixels match');
              comparisons.push({ viewport, dpr, label: `recovery-${cycle + 1}`, equal: true });
            }
          }
        } finally { for (const p of pages) await p.close(); }
      }
    }
    assert.deepEqual(errors, [], 'No browser errors during raw lifecycle and parity comparisons');
    report.push({ browser: name, lifecycle, comparisons });
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`${name}: raw App lifecycle and ${comparisons.length} exact legacy/preview scene+HUD comparisons passed.`);
  } finally { await server.close(); }
}

module.exports = { run };
if (require.main === module) require("./standalone.cjs").run(run, { chromiumOnly: false });
