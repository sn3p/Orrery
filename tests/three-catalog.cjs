const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const cases = require('./fixtures/consumer-v1/cases.json');
const tie = require('./fixtures/consumer-v1/loader-cases.json').cases[0];
const pin = (base, name = 'ties') => ({ ...cases.bundles[name].pin, url: base + '/catalog/catalog-fixtures/' + name + '/index.json' });
async function boot(page, url) {
  await page.goto(url); await page.evaluate(() => catalogReady);
  await page.waitForFunction(() => catalogTest.app.catalogLoader?.sceneComplete());
  await page.evaluate(() => { window.app = catalogTest.app; app.jedDelta = 0; });
}

async function data(browser, base, output, name) {
  const results = [];
  for (const mode of ['indexed', 'whole']) {
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    let release; const gate = new Promise(resolve => release = resolve);
    const first = mode === 'indexed' ? '**/chunks/000000.json' : '**/full/catalog.json';
    await page.route(first, async route => { await gate; await route.continue().catch(() => {}); });
    try {
      await page.goto(base + '/catalog/catalog-' + mode + '/?renderer=three');
      await page.evaluate(() => catalogReady);
      await page.evaluate(() => { window.app = catalogTest.app; app.autoRender = false; app.cancelRender(); });
      if (mode === 'indexed') await page.waitForFunction(() => performance.getEntriesByName('catalog:parse-validate').length === 1);
      assert.equal(await page.evaluate(() => app.catalogLoader.committedCount), 0);
      assert.equal(await page.locator('#orrery-count').textContent(), '0');
      assert(await page.evaluate(() => {
        const date = app.jed; app.jedDelta = 1.5; app.renderFrame(1000); app.renderFrame(6000);
        return app.jed === date && !app.catalogLoader.sceneComplete() && !app.renderer.asteroids;
      }), 'A gap blocks graphics and time before the complete tied-date prefix');
      release();
      await page.waitForFunction(() => app.catalogLoader.committedCount >= 4);
      assert(!await page.evaluate(() => app.catalogLoader.sceneComplete()), 'CPU readiness is not a draw receipt');
      assert.deepEqual(await page.evaluate(() => {
        const before = app.jed; app.renderFrame(6000); const first = app.jed;
        const count = app.asteroidsDiscovered, complete = app.catalogLoader.sceneComplete();
        app.renderFrame(6100); const advance = app.jed - first; app.jedDelta = 0;
        return { reset: first === before, count, complete, advance };
      }), { reset: true, count: 4, complete: true, advance: 9 });
      await page.unroute(first);
      await page.evaluate(() => { app.autoRender = true; app.jed = 9999999; app.requestRender(); });
      await page.waitForFunction(() => app.asteroidsDiscovered === 6 && app.catalogLoader.sceneComplete());
      const comparison = await page.evaluate(async () => {
        // Capture actual adapter data independently of the source's delivery mode.
        const cloud = app.renderer.asteroids;
        return { count: app.catalogue.count, rows: Array.from(app.catalogue.rows), phases: Array.from(cloud.geometry.attributes.meanAnomaly.array),
          p: Array.from(app.catalogue.p), q: Array.from(app.catalogue.q), dates: Array.from(app.catalogue.dates), epoch: cloud.epoch };
      });
      await page.evaluate(date => { app.jed = date; }, tie.through);
      await page.waitForFunction(() => app.asteroidsDiscovered === 4 && app.catalogLoader.sceneComplete());
      const requests = []; page.on('request', r => { if (/\.json/.test(r.url())) requests.push(r.url()); });
      for (let cycle = 0; cycle < 2; cycle++) {
        await page.evaluate(() => { window.model = app.catalogue; window.loss = app.renderer.renderer.getContext().getExtension('WEBGL_lose_context'); loss.loseContext(); });
        await page.waitForFunction(() => app.contextLost);
        assert(!await page.evaluate(() => app.catalogLoader.sceneComplete()));
        assert.match(await page.locator('#orrery-status').textContent(), /Graphics connection lost/);
        await page.evaluate(() => loss.restoreContext());
        await page.waitForFunction(() => !app.contextLost && app.catalogLoader.sceneComplete());
        assert(await page.evaluate(() => app.catalogue === model && app.asteroidsDiscovered === 4));
      }
      assert.deepEqual(requests, [], 'Retained indexed/whole data restores without requests');
      const original = await page.evaluate(() => { window.oldModel = app.catalogue; return app.catalogLoader.generation; });
      await page.evaluate(async next => { await app.loadCatalog(next); }, pin(base, 'empty'));
      await page.waitForFunction(() => app.catalogLoader.sceneComplete() && app.asteroidsDiscovered === 0);
      assert.equal(await page.locator('#orrery-count').textContent(), '0');
      assert(!await page.evaluate(() => app.catalogue === oldModel));
      await page.evaluate(async next => { await app.loadCatalog(next); }, pin(base));
      await page.waitForFunction(() => app.catalogLoader.sceneComplete() && app.asteroidsDiscovered === 4);
      await page.screenshot({ path: path.join(output, `${name}-${mode}-restored.png`) });
      assert.deepEqual(errors, []);
      results.push({ mode, comparison, recoveryCycles: 2, replacement: true, initialGeneration: original });
    } finally { release(); await page.close(); }
  }
  assert.deepEqual(results[0].comparison, results[1].comparison, 'Indexed/whole paths produce identical neutral and packed arrays');

  const page = await browser.newPage();
  try {
    await page.route('https://catalog-fixtures.test/**', async route => {
      const response = await route.fetch({ url: base + '/catalog' + new URL(route.request().url()).pathname });
      await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
    });
    await boot(page, base + '/catalog/catalog-latest/?renderer=three');
    assert.equal(await page.locator('#orrery-count').textContent(), '4');
    const identity = await page.evaluate(() => app.catalogue.catalogId);
    await page.reload(); await page.waitForFunction(() => catalogTest.app.catalogLoader?.sceneComplete());
    assert.equal(await page.evaluate(() => catalogTest.app.catalogue.catalogId), identity);
    results.push({ latestReload: true, identity });
  } finally { await page.close(); }
  const replacement = await browser.newPage();
  let release;
  try {
    await boot(replacement, base + '/catalog/catalog-indexed/?renderer=three');
    const gate = new Promise(resolve => release = resolve);
    await replacement.route('**/catalog-fixtures/ties/index.json', async route => { await gate; await route.continue().catch(() => {}); });
    await replacement.evaluate(next => { window.stale = app.loadCatalog(next); }, pin(base));
    await replacement.evaluate(next => app.loadCatalog(next), pin(base, 'empty'));
    await replacement.waitForFunction(() => app.catalogLoader.sceneComplete() && app.catalogue.count === 0);
    release(); assert.equal(await replacement.evaluate(() => stale), false);
    await replacement.unroute('**/catalog-fixtures/ties/index.json');
    assert.equal(await replacement.evaluate(() => app.catalogue.count), 0, 'Stale source opening cannot overwrite empty replacement');
    let attempts = 0;
    await replacement.route('**/catalog-fixtures/ties/chunks/000000.json', route => ++attempts === 1
      ? route.fulfill({ status: 503, body: 'Try again' }) : route.continue());
    await replacement.evaluate(next => app.loadCatalog(next), pin(base));
    await replacement.waitForFunction(() => app.catalogLoader.sceneComplete() && app.asteroidsDiscovered === 4);
    assert(attempts >= 2, 'A required transport failure retries through the real loader');
    const before = await replacement.evaluate(() => ({ date: app.jed, count: app.asteroidsDiscovered, id: app.catalogue.sourceId }));
    await replacement.route('**/malformed-catalog', route => route.fulfill({ json: [{ e: 2 }] }));
    assert.equal(await replacement.evaluate(() => app.loadAsteroids('/malformed-catalog')), false);
    assert.deepEqual(await replacement.evaluate(() => ({ date: app.jed, count: app.asteroidsDiscovered, id: app.catalogue.sourceId })), before);
    let releaseLoad; const loadGate = new Promise(resolve => releaseLoad = resolve);
    await replacement.route('**/delayed-catalog', async route => { await loadGate; await route.fulfill({ json: [] }).catch(() => {}); });
    const request = replacement.waitForRequest('**/delayed-catalog');
    await replacement.evaluate(() => { window.loading = app.loadAsteroids('/delayed-catalog'); });
    await request; await replacement.evaluate(() => app.destroy()); releaseLoad();
    assert.equal(await replacement.evaluate(() => loading), false);
    assert.equal(await replacement.locator('canvas, .orrery-options').count(), 0);
    results.push({ stale: true, retry: attempts, malformedReplacementPreserved: true, disposedLoad: true });
  } finally { release?.(); await replacement.close(); }
  return results;
}

async function frames(browser, base, output, name) {
  const results = [{ bundled: await require('./three-bundled.cjs')(browser, base) }];
  for (const kind of ['null', 'draw', 'allocate', 'upload', 'update']) {
    const page = await browser.newPage(); const errors = []; page.on('pageerror', e => errors.push(e.message));
    try {
      await boot(page, base + '/catalog/catalog-indexed/?renderer=three');
      await page.evaluate(() => app.jed = 9999999);
      await page.waitForFunction(() => app.asteroidsDiscovered === 6 && app.catalogLoader.sceneComplete());
      await page.evaluate(date => app.jed = date, tie.through);
      await page.waitForFunction(() => app.asteroidsDiscovered === 4 && app.catalogLoader.sceneComplete());
      const result = await page.evaluate(kind => {
        app.autoRender = false; app.cancelRender(); app.renderFrame();
        const adapter = app.renderer, cloud = adapter.asteroids, gl = adapter.renderer.getContext();
        const before = { date: app.jed, count: app.asteroidsDiscovered, text: app.gui.date.textContent,
          pixels: adapter.canvas.toDataURL(), epoch: cloud.epoch, means: cloud.geometry.attributes.meanAnomaly.array.slice(),
          positions: adapter.planets.map(planet => planet.body.position.toArray()) };
        const draw = adapter.renderer.renderBufferDirect, update = adapter.update;
        const buffer = gl[kind === 'allocate' ? 'bufferData' : 'bufferSubData'];
        const method = kind === 'allocate' ? 'bufferData' : 'bufferSubData';
        let failed = false;
        if (kind === 'null' || kind === 'draw') adapter.renderer.renderBufferDirect = function(...args) {
          if (!failed && args[4] === cloud) {
            failed = true;
            if (kind === 'draw') gl.drawArrays(gl.POINTS, 0, -1);
            return;
          }
          return draw.apply(this, args);
        };
        if (kind === 'allocate' || kind === 'upload') {
          if (kind === 'allocate') cloud.invalidateGraphics();
          gl[method] = function(...args) {
            const array = args[kind === 'allocate' ? 1 : 2];
            if (!failed && Object.values(cloud.geometry.attributes).some(a => a.array === array)) {
              failed = true;
              // Real driver error, consumed by the adapter's onUpload check.
              if (kind === 'allocate') return buffer.call(this, gl.ARRAY_BUFFER, -1, gl.STATIC_DRAW);
              return buffer.call(this, gl.ARRAY_BUFFER, -1, array);
            }
            return buffer.apply(this, args);
          };
        }
        if (kind === 'update') adapter.update = frame => { update.call(adapter, frame); failed = true; throw new Error('controlled Three update failure'); };
        // Seek crosses the phase boundary but the loaded tie population remains complete.
        app.jed = before.date + 5000; let thrown;
        try { app.renderFrame(); } catch (error) { thrown = error.message; }
        finally { adapter.renderer.renderBufferDirect = draw; adapter.update = update; gl[method] = buffer; }
        window.completed = before;
        return { kind, failed, threw: !!thrown, date: app.jed === before.date, count: app.asteroidsDiscovered === before.count,
          hud: app.gui.date.textContent === before.text, means: before.means.every((v,i) => v === cloud.geometry.attributes.meanAnomaly.array[i]),
          epoch: cloud.epoch === before.epoch, pixels: adapter.canvas.toDataURL() === before.pixels,
          planets: adapter.planets.every((p,i) => p.body.position.toArray().every((v,j) => v === before.positions[i][j])),
          pending: app.requestedJed === before.date + 5000, graphicsIncomplete: !app.catalogLoader.sceneComplete() };
      }, kind);
      assert.deepEqual(result, { kind, failed: true, threw: kind !== 'null', date: true, count: true, hud: true,
        means: true, epoch: true, pixels: true, planets: true, pending: true, graphicsIncomplete: kind !== 'null' });
      await page.evaluate(() => { window.loss = app.renderer.renderer.getContext().getExtension('WEBGL_lose_context'); loss.loseContext(); });
      await page.waitForFunction(() => app.contextLost);
      await page.evaluate(() => loss.restoreContext()); await page.waitForFunction(() => !app.contextLost);
      assert(await page.evaluate(() => { app.renderFrame(); return !app.renderFailure && app.jed === completed.date + 5000; }));
      assert.deepEqual(errors, []);
      results.push(result);
    } finally { await page.close(); }
  }
  return results;
}
module.exports = { data, frames };
