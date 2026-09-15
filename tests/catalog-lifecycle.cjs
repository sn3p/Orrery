const assert = require('node:assert/strict');
const cases = require('./fixtures/consumer-v1/cases.json');
const path = require('node:path');
const fs = require('node:fs/promises');

async function run(browser, base, output, name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const pins = Object.fromEntries(Object.entries(cases.bundles).map(([key, value]) => [key,
    { ...value.pin, url: base + '/catalog-fixtures/' + key + '/index.json' }]));
  const open = async () => {
    await page.goto(base + '/catalog-indexed/');
    await page.waitForFunction(() => catalogTest.app.catalogLoader?.sceneComplete());
    await page.evaluate(() => { window.app = catalogTest.app; app.autoRender = false; app.cancelRender(); });
  };
  try {
    await open();
    // Public latest selection must not silently convert a whole request.
    assert.equal(await page.evaluate(() => app.loadCatalog(null,
      { latest: location.origin + '/browser-fixtures/latest.json', mode: 'whole' })), false);
    assert.match(await page.evaluate(() => app.catalogFailure.message), /Whole-file mode unavailable/);
    assert.equal(await page.evaluate(() => !!app.activeSession && !app.catalogWaiting), true);
    // Pending user date survives opening; superseded requests cannot write.
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/catalog-fixtures/ties/index.json', async route => { await gate; await route.continue().catch(() => {}); });
    await page.evaluate(pin => { window.opening = app.loadCatalog(pin); app.jed = 2458847.5; }, pins.ties);
    release(); await page.evaluate(() => opening);
    await page.waitForFunction(() => app.catalogLoader.committedCount === 6);
    assert.equal(await page.evaluate(() => { app.renderFrame(1000); return app.jed; }), 2458847.5);
    assert.equal(await page.locator('#orrery-count').textContent(), '6');
    await page.unroute('**/catalog-fixtures/ties/index.json');

    // A failed replacement leaves a previous complete scene/date/count intact.
    const previous = await page.evaluate(() => ({ jed: app.jed, count: app.asteroidsDiscovered, id: app.catalogue.sourceId }));
    await page.route('**/bad-index', route => route.fulfill({ status: 503, body: 'failed' }));
    assert.equal(await page.evaluate(pin => app.loadCatalog({ ...pin, url: location.origin + '/bad-index' }), pins.ties), false);
    assert.deepEqual(await page.evaluate(() => { app.renderFrame(1000); return { jed: app.jed, count: app.asteroidsDiscovered, id: app.catalogue.sourceId }; }), previous);
    assert.match(await page.locator('#orrery-status').textContent(), /Could not load/);

    // Regression: a failed legacy load superseding an opening cannot freeze it.
    let releaseAgain;
    const again = new Promise(resolve => { releaseAgain = resolve; });
    await page.route('**/catalog-fixtures/ties/index.json', async route => { await again; await route.continue().catch(() => {}); });
    await page.evaluate(pin => { window.stale = app.loadCatalog(pin); }, pins.ties);
    assert.equal(await page.evaluate(() => app.loadAsteroids('/bad-index')), false);
    releaseAgain(); await page.evaluate(() => stale);
    assert.equal(await page.evaluate(() => !!app.catalogOpening || app.catalogWaiting), false);
    await page.unroute('**/catalog-fixtures/ties/index.json');

    // Regression: failed initial allocation closes the candidate, restoring owner.
    const allocation = await page.evaluate(async pin => {
      const Original = window.Float32Array, Source = catalogTest.CatalogSource, open = Source.open;
      let source;
      Source.open = async (...args) => source = await open.call(Source, ...args);
      window.Float32Array = class extends Original { constructor(...args) {
        if (args[0] === 18) throw new Error('controlled allocation failure'); super(...args);
      } };
      try {
        const result = await app.loadCatalog(pin);
        return { result, closed: source.closed, pending: !!app.pendingSession,
          active: app.catalogLoader === app.activeSession.loader, waiting: app.catalogWaiting };
      } finally { window.Float32Array = Original; Source.open = open; }
    }, pins.ties);
    assert.deepEqual(allocation, { result: false, closed: true, pending: false, active: true, waiting: false });

    // Regression: preparation/adapter failure preserves old usable graphics.
    await page.evaluate(async pin => { await app.loadCatalog(pin); }, pins.ties);
    await page.waitForFunction(() => app.catalogLoader.committedCount === 6);
    const failedDraw = await page.evaluate(() => {
      const before = { jed: app.jed, count: app.asteroidsDiscovered, model: app.catalogue, scene: app.renderer.asteroids };
      const render = app.renderer.render;
      app.renderer.render = () => { throw new Error('controlled draw failure'); };
      try { app.renderFrame(2000); }
      catch (error) { if (error.message !== 'controlled draw failure') throw error; }
      finally { app.renderer.render = render; }
      return { unchanged: app.jed === before.jed && app.asteroidsDiscovered === before.count,
        retained: app.catalogue === before.model && app.renderer.asteroids === before.scene,
        complete: app.catalogLoader.sceneComplete() };
    });
    assert.deepEqual(failedDraw, { unchanged: true, retained: true, complete: false });
    await page.evaluate(pin => app.loadCatalog(pin), pins.ties);
    await page.waitForFunction(() => app.catalogLoader.committedCount === 6);
    await page.evaluate(() => app.renderFrame(2000));
    assert.equal(await page.evaluate(() => app.catalogLoader.sceneComplete()), true);

    // A null draw receipt never publishes a replacement's date or count.
    await page.evaluate(pin => app.loadCatalog(pin), pins.empty);
    const receipt = await page.evaluate(() => {
      const before = app.gui.count.textContent, render = app.renderer.render;
      app.renderer.render = () => null;
      app.renderFrame(2000);
      const blocked = { count: app.gui.count.textContent, complete: app.catalogLoader.sceneComplete() };
      app.renderer.render = render; app.renderFrame(2000);
      return { before, blocked, after: app.gui.count.textContent, complete: app.catalogLoader.sceneComplete() };
    });
    assert.equal(receipt.blocked.count, receipt.before);
    assert.equal(receipt.blocked.complete, false);
    assert.equal(receipt.after, '0'); assert.equal(receipt.complete, true);

    // Context loss retains incoming verified CPU data, with no graphics receipt.
    await page.evaluate(pin => app.loadCatalog(pin), pins.ties);
    await page.waitForFunction(() => app.catalogLoader.committedCount === 6);
    await page.evaluate(() => app.renderFrame(2000));
    const beforeRequests = await page.evaluate(() => performance.getEntriesByType('resource').filter(x => /chunks\//.test(x.name)).length);
    await page.evaluate(() => { window.loss = app.renderer.app.renderer.gl.getExtension('WEBGL_lose_context'); loss.loseContext(); });
    await page.waitForFunction(() => app.contextLost);
    assert.equal(await page.evaluate(() => app.catalogLoader.sceneComplete()), false);
    await page.evaluate(() => loss.restoreContext());
    await page.waitForFunction(() => !app.contextLost);
    await page.evaluate(() => app.renderFrame(2000));
    assert.equal(await page.evaluate(() => app.catalogLoader.sceneComplete()), true);
    assert.equal(await page.evaluate(() => performance.getEntriesByType('resource').filter(x => /chunks\//.test(x.name)).length), beforeRequests);

    // Failed draw on an active source rolls back cloud phases, arrivals and
    // shared planets, and cannot turn the rejected frame into a later receipt.
    const activeFailure = await page.evaluate(() => {
      app.elapsed = 2; app.renderFrame(2000);
      const before = { jed: app.jed, count: app.asteroidsDiscovered,
        pixels: app.renderer.canvas.toDataURL(), model: app.catalogue };
      const render = app.renderer.render;
      app.jed = 2451544.5;
      app.renderer.render = () => { throw new Error('active draw failure'); };
      try { app.renderFrame(2100); }
      catch (error) { if (error.message !== 'active draw failure') throw error; }
      app.renderer.render = render;
      app.renderFrame(2200);
      return { same: app.jed === before.jed && app.asteroidsDiscovered === before.count,
        pixels: app.renderer.canvas.toDataURL() === before.pixels,
        retained: app.catalogue === before.model, complete: app.catalogLoader.sceneComplete() };
    });
    assert.deepEqual(activeFailure, { same: true, pixels: true, retained: true, complete: false });
    await page.evaluate(() => { window.failureLoss = app.renderer.app.renderer.gl.getExtension('WEBGL_lose_context'); failureLoss.loseContext(); });
    await page.waitForFunction(() => app.contextLost);
    await page.evaluate(() => failureLoss.restoreContext());
    await page.waitForFunction(() => !app.contextLost);
    await page.evaluate(() => app.renderFrame(2200));
    assert.equal(await page.evaluate(() => app.catalogLoader.sceneComplete() && app.jed === 2451544.5 && !app.renderFailure), true);

    // Graphics preparation can throw before the draw call (e.g. texture rebuild).
    const updateFailure = await page.evaluate(() => {
      const before = { jed: app.jed, elapsed: app.elapsed, count: app.asteroidsDiscovered };
      const update = app.renderer.update;
      app.jed = 2458847.5;
      app.renderer.update = frame => { update.call(app.renderer, frame); throw new Error('controlled update failure'); };
      try { app.renderFrame(2250); }
      catch (error) { if (error.message !== 'controlled update failure') throw error; }
      finally { app.renderer.update = update; }
      return { restored: app.jed === before.jed && app.elapsed === before.elapsed && app.asteroidsDiscovered === before.count,
        complete: app.catalogLoader.sceneComplete(), failure: !!app.renderFailure };
    });
    assert.deepEqual(updateFailure, { restored: true, complete: false, failure: true });

    // Driver allocation errors are signaled by GL state, not thrown by Pixi.
    // The failed seek still requires all six rows. Hold the tail to prove
    // that the old four-row prefix is insufficient to reach a GPU upload.
    let releaseGpuTail;
    const gpuTail = new Promise(resolve => { releaseGpuTail = resolve; });
    const tailPattern = '**/catalog-fixtures/ties/chunks/000002.json';
    await page.route(tailPattern, async route => { await gpuTail; await route.continue(); });
    try {
      await page.evaluate(pin => app.loadCatalog(pin), pins.ties);
      await page.waitForFunction(() => app.catalogLoader.committedCount === 4);
      assert.equal(await page.evaluate(() => app.catalogLoader.readyToDraw(app.requestedJed ?? app.jed)), false);
    } finally { releaseGpuTail(); }
    await page.waitForFunction(() => app.catalogLoader.readyToDraw(app.requestedJed ?? app.jed));
    await page.unroute(tailPattern);
    const gpuFailure = await page.evaluate(() => {
      const gl = app.renderer.app.renderer.gl, getError = gl.getError, bufferData = gl.bufferData;
      let injected = false, pendingError = false;
      gl.bufferData = function(target, data, ...args) {
        if (!injected && data === app.renderer.asteroids.geometry.getBuffer('aBasis').data) {
          injected = pendingError = true; return; // Failed allocation leaves no storage.
        }
        return bufferData.call(this, target, data, ...args);
      };
      gl.getError = () => {
        if (pendingError) { pendingError = false; return gl.OUT_OF_MEMORY; }
        return getError.call(gl);
      };
      try { app.renderFrame(2200); }
      catch (error) { if (!/Unable to upload/.test(error.message)) throw error; }
      finally { gl.getError = getError; gl.bufferData = bufferData; }
      return { injected, complete: app.catalogLoader.sceneComplete(), failure: !!app.renderFailure };
    });
    assert.deepEqual(gpuFailure, { injected: true, complete: false, failure: true });
    await page.evaluate(async () => {
      const rows = await (await fetch('/catalog-fixtures/ties/full/catalog.json')).json();
      app.setAsteroids(rows); app.renderFrame(2200);
    });
    assert.equal(await page.locator('#orrery-status').textContent(), '');
    const manualFailure = await page.evaluate(() => {
      const render = app.renderer.render;
      app.renderer.render = () => { throw new Error('manual frame failure'); };
      let thrown;
      try { app.renderFrame(2300); }
      catch (error) { thrown = error.message; }
      finally { app.renderer.render = render; }
      return { thrown, status: document.querySelector('#orrery-status').textContent };
    });
    assert.equal(manualFailure.thrown, 'manual frame failure');
    assert.match(manualFailure.status, /Unable to render/);
    await page.evaluate(async () => app.setAsteroids(await (await fetch('/catalog-fixtures/ties/full/catalog.json')).json()));

    // Preview controls and status remain keyboard usable at short/narrow sizes.
    for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      await page.getByRole('button', { name: 'Options' }).click();
      await page.getByRole('textbox', { name: 'Playback speed' }).press('Escape');
      assert.equal(await page.getByRole('button', { name: 'Options' }).getAttribute('aria-expanded'), 'false');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.evaluate(() => app.renderFrame(2300));
      await page.screenshot({ path: path.join(output, name + '-lifecycle-' + viewport.width + '.png') });
    }
    // Adapter catch-up is bounded even when the entire CPU prefix is available.
    // Read actual GPU storage after two appends before one draw: a later dirty
    // range must not erase an earlier update in Pixi's one-range buffer API.
    const packing = await page.evaluate(async () => {
      const rows = await (await fetch('/catalog-fixtures/ties/full/catalog.json')).json();
      app.setAsteroids(Array.from({ length: 10000 }, (_, i) => rows[i % rows.length]));
      const model = app.catalogue;
      app.setAsteroids(rows);
      const frame = { jed: 2458847.5, elapsed: 3 };
      app.renderer.syncCatalogue(model, frame, { required: 10000, activate: true });
      const first = app.renderer.stagedAsteroids.committedCount;
      app.renderer.syncCatalogue(model, frame, { required: 10000, activate: true });
      app.renderer.render(); app.renderer.commitCatalogue();
      const final = app.renderer.asteroids.committedCount;
      app.setAsteroids(rows);
      model.count = 2;
      app.renderer.syncCatalogue(model, frame, { required: 2, activate: true });
      app.renderer.render(); app.renderer.commitCatalogue();
      model.count = 10000;
      app.renderer.syncCatalogue(model, frame, { required: 10000, activate: true });
      app.renderer.syncCatalogue(model, frame, { required: 10000, activate: true });
      app.renderer.update(frame); app.renderer.render();
      const renderer = app.renderer.app.renderer, cloud = app.renderer.asteroids;
      let matches = true;
      if (renderer.context.webGLVersion === 2) {
        const gl = renderer.gl;
        for (const name of ['aBasis', 'aElements', 'aMeanAnomaly']) {
          const buffer = cloud.geometry.getBuffer(name), gpu = new Float32Array(buffer.data.length);
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer._gpuData[renderer.uid].buffer);
          gl.getBufferSubData(gl.ARRAY_BUFFER, 0, gpu);
          matches &&= gpu.every((value, i) => value === buffer.data[i]);
        }
      }
      return { first, final, matches };
    });
    assert.deepEqual(packing, { first: 8192, final: 10000, matches: true });
    await page.evaluate(() => { app.destroy(); app.destroy(); });
    assert.equal(await page.locator('canvas, .orrery-options').count(), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
  const prefix = await browser.newPage();
  try {
    await prefix.goto(base + '/catalog-indexed/');
    await prefix.waitForFunction(() => catalogTest.app.catalogLoader?.sceneComplete());
    await prefix.evaluate(() => {
      const app = catalogTest.app;
      app.autoRender = false; app.cancelRender();
      app.catalogLoader.commitCloud = () => { throw new Error('controlled later preparation failure'); };
      app.jedDelta = 1.5;
    });
    await prefix.waitForFunction(() => catalogTest.app.catalogLoader.errorKind === 'commit');
    const usable = await prefix.evaluate(() => {
      const app = catalogTest.app, before = app.jed;
      app.renderFrame(1000); app.renderFrame(1100);
      const continued = app.jed - before;
      app.jedDelta = 0; app.jed = 2458847.5; app.renderFrame(1100);
      const blocked = { date: app.jed, count: app.asteroidsDiscovered, complete: app.catalogLoader.sceneComplete() };
      app.jed = before; app.renderFrame(1100);
      return { continued, blocked, reversed: app.jed === before && app.catalogLoader.sceneComplete() };
    });
    assert.equal(usable.continued, 9, 'A later preparation failure does not freeze the valid prefix');
    assert.deepEqual(usable.blocked, { date: 2451553.5, count: 4, complete: false });
    assert.equal(usable.reversed, true);
  } finally { await prefix.close(); }
  const latest = await browser.newPage();
  try {
    // Keep the compiled latest URL independent of this worker's ephemeral port.
    // Fetch the real fixture bytes over HTTP; the browser still runs the actual
    // entry's latest discovery, relative URL resolution and checksum validation.
    const { latestOrigin } = require('./catalog-loading.cjs');
    await latest.route(latestOrigin + '/**', async route => {
      const source = new URL(route.request().url());
      const response = await route.fetch({ url: base + source.pathname + source.search });
      await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
    });
    const requests = [];
    latest.on('request', req => requests.push(req.url()));
    await latest.goto(base + '/catalog-latest/');
    await latest.waitForFunction(() => catalogTest.app.catalogLoader?.sceneComplete());
    assert.equal(await latest.locator('#orrery-count').textContent(), '4');
    assert(!requests.some(url => /full\/catalog|data\/catalog.json/.test(url)), 'Explicit latest never falls back to historical/whole');
    await latest.reload();
    await latest.waitForFunction(() => catalogTest.app.catalogLoader?.sceneComplete());
    assert.equal(requests.filter(url => url.endsWith('/latest.json')).length, 2);
    await latest.route('**/latest.json', route => route.fulfill({ status: 503, body: 'unavailable' }));
    await latest.reload();
    await latest.getByRole('alert').waitFor();
    assert.match(await latest.getByRole('alert').textContent(), /Could not load/);
    assert(!requests.some(url => /full\/catalog|data\/catalog.json/.test(url)));
  } finally { await latest.close(); }
  return [{ replacementFailure: true, staleOpening: true, allocationFailure: true,
    drawReceipt: true, noRefetchRecovery: true, keyboard: true }];
}
module.exports = { run };
