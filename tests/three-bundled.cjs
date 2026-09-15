const assert = require('node:assert/strict');

// Real historical boot and loadAsteroids replacement: inspect readouts inside
// the failed GPU operation, before App gets a chance to roll the frame back.
module.exports = async function bundled(browser, base) {
  const results = [];
  for (const renderer of ['pixi', 'three']) for (const replacement of [false, true]) for (const kind of ['allocate', 'draw', 'null']) {
    const page = await browser.newPage();
    let release;
    try {
      const gate = new Promise(resolve => release = resolve);
      if (!replacement) await page.route('**/data/catalog.json', async route => { await gate; await route.continue().catch(() => {}); });
      await page.goto(base + '/next/?renderer=' + renderer);
      await page.waitForFunction(() => threeTest.app.initialized);
      if (replacement) await page.evaluate(() => threeTest.ready);
      await page.evaluate(() => {
        window.app = threeTest.app; app.autoRender = false; app.cancelRender(); app.jedDelta = 0; app.renderFrame();
        window.completed = { count: app.asteroidsDiscovered, date: app.jed, model: app.catalogue,
          cloud: app.renderer.asteroids, hud: app.gui.count.textContent, dateText: app.gui.date.textContent, pixels: app.renderer.canvas.toDataURL() };
      });
      await page.evaluate(({ renderer, kind }) => {
        const adapter = app.renderer, gl = adapter.renderer?.getContext() ?? adapter.app.renderer.gl;
        const bufferData = gl.bufferData, getError = gl.getError;
        const owner = renderer === 'three' ? adapter.renderer : adapter.app.renderer.encoder;
        const method = renderer === 'three' ? 'renderBufferDirect' : 'draw', draw = owner[method];
        let pending = false;
        window.receipt = { fired: false };
        const renderFrame = app.renderFrame;
        app.renderFrame = function(...args) {
          try { return renderFrame.apply(this, args); }
          finally { if (receipt.fired) receipt.pixels = adapter.canvas.toDataURL() === completed.pixels; }
        };
        const fail = () => {
          receipt.fired = true;
          receipt.before = { count: app.asteroidsDiscovered, hud: app.gui.count.textContent, dateText: app.gui.date.textContent,
            priorModel: app.catalogue === completed.model, firstDraw: !!app.pendingBundled?.model.firstDraw };
        };
        gl.bufferData = function(target, data, ...rest) {
          const cloud = adapter.asteroids;
          const arrays = renderer === 'three' ? Object.values(cloud?.geometry.attributes ?? {}).map(a => a.array)
            : (cloud?.geometry.buffers ?? []).map(b => b.data);
          if (!receipt.fired && kind === 'allocate' && cloud !== completed.cloud && arrays.includes(data)) {
            fail(); pending = true; return;
          }
          return bufferData.call(this, target, data, ...rest);
        };
        gl.getError = function() { if (pending) { pending = false; return gl.OUT_OF_MEMORY; } return getError.call(this); };
        owner[method] = function(...args) {
          const asteroid = renderer === 'three' ? args[4] === adapter.asteroids : args[0].geometry === adapter.asteroids?.geometry;
          if (!receipt.fired && kind !== 'allocate' && asteroid && adapter.asteroids !== completed.cloud) {
            fail(); if (kind === 'draw') throw new Error('controlled first asteroid draw failure');
            return;
          }
          return draw.apply(this, args);
        };
        window.restoreInjection = () => { gl.bufferData = bufferData; gl.getError = getError; owner[method] = draw; app.renderFrame = renderFrame; };
      }, { renderer, kind });
      if (replacement && kind === 'draw') {
        await page.evaluate(() => {
          const row = { a: 2, e: .1, i: 30, W: 40, wbar: 80, M: 30, n: .25, epoch: 2451545, disc: 2000000 };
          Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          try { app.setAsteroids([row, row]); app.setAsteroids([row, row, row]); }
          finally { delete document.hidden; }
          try { app.renderFrame(); } catch { /* Manual failed draw restores the completed scene. */ }
        });
      } else if (replacement) {
        if (kind === 'allocate') await page.evaluate(() => { app.jed += 5000; });
        await page.route('**/replacement.json', route => route.fulfill({ json: [{ a: 2, e: .1, i: 30, W: 40, wbar: 80, M: 30, n: .25, epoch: 2451545, disc: 2000000 }] }));
        await page.evaluate(() => app.loadAsteroids('/replacement.json'));
      } else { release(); await page.evaluate(() => threeTest.ready); }
      const result = await page.evaluate(() => {
        restoreInjection();
        return { ...receipt, expected: { count: completed.count, hud: completed.hud, dateText: completed.dateText, priorModel: true, firstDraw: false },
          priorCount: app.asteroidsDiscovered === completed.count, priorDate: app.jed === completed.date,
          priorModel: app.catalogue === completed.model, priorCloud: app.renderer.asteroids === completed.cloud,
          pending: !!app.pendingBundled, failure: !!app.renderFailure };
      });
      assert.equal(result.fired, true);
      assert.deepEqual(result.before, result.expected, `${renderer} ${kind}: no readout/model publication before receipt`);
      for (const key of ['priorCount', 'priorDate', 'priorModel', 'priorCloud', 'pixels', 'pending']) assert.equal(result[key], true, renderer + ' ' + kind + ': ' + key);
      assert.equal(result.failure, kind !== 'null');
      const requests = []; page.on('request', request => { if (/\.json/.test(request.url())) requests.push(request.url()); });
      if (kind !== 'null') {
        await page.evaluate(() => { window.loss = (app.renderer.renderer?.getContext() ?? app.renderer.app.renderer.gl).getExtension('WEBGL_lose_context'); loss.loseContext(); });
        await page.waitForFunction(() => app.contextLost);
        await page.evaluate(() => loss.restoreContext()); await page.waitForFunction(() => !app.contextLost);
      }
      assert(await page.evaluate(() => { app.renderFrame(); return !app.renderFailure && !app.pendingBundled && app.catalogue.firstDraw && app.catalogue !== completed.model; }));
      assert.deepEqual(requests, [], 'Recovery uses retained bundled data');
      results.push({ renderer, replacement, kind });
    } finally { release?.(); await page.close(); }
  }
  return results;
};
