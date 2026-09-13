const assert = require('node:assert/strict');
const { openOptions } = require('./options.cjs');
const lifecycle = require('./rendering-lifecycle.cjs');
const settle = page => page.evaluate(async () => {
  for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
});

module.exports = async (browser, url, name) => {
  const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const select = page.getByRole('combobox', { name: 'Rendering pixel ratio' });
  const prepare = async () => {
    await page.evaluate(() => window.ready);
    await openOptions(page);
    await page.evaluate(() => {
      const { app, probe } = fixture;
      app.jed = 2458600.5;
      app.elapsed = 1;
      app.stage.position.set(417, 277);
      app.stage.scale.set(1.25);
      probe.capture = true;
      if (!app.autoRender) app.render();
    });
    await settle(page);
  };
  const snapshot = () => page.evaluate(() => {
    const { app, probe } = fixture, texture = app.circleTexture;
    return { ratio: app.app.renderer.resolution, textureRatio: texture.source.resolution,
      size: [texture.width, texture.height], pixels: [texture.source.pixelWidth, texture.source.pixelHeight],
      position: [app.stage.x, app.stage.y, app.stage.scale.x], image: probe.image,
      bound: app.planets.every(p => p.body.texture === texture) && app.planetContainer.texture === texture
        && app.asteroids.texture === texture, pending: app.animationFrame };
  });
  try {
    await page.goto(url + '/fixture/'); await prepare();
    const one = await snapshot();
    assert.equal(one.ratio, 1); assert.equal(one.textureRatio, 1);
    assert.deepEqual(one.size, [10, 10]); assert.deepEqual(one.pixels, [10, 10]);
    for (const ratio of [2, 1, 2]) {
      await page.evaluate(() => { fixture.previousTexture = fixture.app.circleTexture; });
      await select.selectOption(String(ratio)); await settle(page);
      const next = await snapshot();
      assert.equal(next.ratio, ratio); assert.equal(next.textureRatio, ratio);
      assert(next.bound); assert.deepEqual(next.size, one.size);
      assert.deepEqual(next.pixels, [10 * ratio, 10 * ratio]);
      assert.deepEqual(next.position, one.position); assert.equal(next.pending, null);
      assert(await page.evaluate(() => fixture.previousTexture.destroyed), 'Superseded texture is destroyed');
      if (ratio === 1) assert.equal(next.image, one.image, 'Returning to 1x exactly restores original pixels');
    }
    const two = await snapshot();
    // A real selection before init verifies cold and switched texture quality.
    await page.goto(url + '/fixture/?pixelRatio=2'); await prepare();
    assert.deepEqual(await snapshot(), two, 'Cold 2x and switched 2x have identical texture and scene pixels');
    if (name === 'chromium') {
      const cdp = await page.context().newCDPSession(page);
      try {
        await page.setViewportSize({ width: 390, height: 843 });
        for (const native of [0.75, 1, 2]) {
          await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 843, deviceScaleFactor: native, mobile: false });
          await cdp.send('Emulation.setEmulatedMedia', { media: 'screen' });
          await cdp.send('Emulation.setEmulatedMedia', { media: '' });
          await page.waitForFunction(native => fixture.app.nativePixelRatio === native, native);
          await settle(page);
          const dimensions = await page.evaluate(() => {
            const { app } = fixture;
            return { size: [app.circleTexture.width, app.circleTexture.height],
              ratio: app.circleTexture.source.resolution,
              planets: app.planets.map(p => [p.body.scaleX * app.circleTexture.width, p.options.size]),
              css: [app.canvas.getBoundingClientRect().width, app.canvas.getBoundingClientRect().height] };
          });
          assert.deepEqual(dimensions.size, [10, 10], 'Fractional DPR cannot change logical circle size');
          assert.equal(dimensions.ratio, native >= 2 ? 2 : 1);
          assert.deepEqual(dimensions.css, [390, 843], 'Fractional buffer rounding cannot resize the CSS canvas');
          for (const [actual, expected] of dimensions.planets) assert(Math.abs(actual - expected) < 1e-12, 'Every planet retains its configured dot size');
        }
      } finally { await cdp.detach(); }
    }
    await lifecycle.recovery(page);
    await lifecycle.visibility(page);
    await page.goto(url + '/fixture/?manual'); await prepare();
    const manual = await page.evaluate(() => fixture.probe.draws);
    await select.selectOption('2'); await settle(page);
    assert.equal(await page.evaluate(() => fixture.probe.draws), manual);
    assert.equal(await page.evaluate(() => fixture.app.animationFrame), null);
    await page.evaluate(() => fixture.app.render());
    assert.equal((await snapshot()).textureRatio, 2);
    await lifecycle.recovery(page, { manual: true });
    await lifecycle.disposal(page, url);

    // DPR changes during asynchronous initialization must converge before the
    // first texture is generated, even when there will be no automatic tick.
    await page.goto(url + '/init/');
    await page.evaluate(async () => {
      const { Orrery, Application } = fixture;
      const original = Application.prototype.init;
      let release, allocated;
      const gate = new Promise(resolve => { release = resolve; });
      const ready = new Promise(resolve => { allocated = resolve; });
      Application.prototype.init = async function(options) { await original.call(this, options); allocated(); await gate; };
      const app = new Orrery({ autoRender: false });
      app.pixelRatio = '2';
      try {
        const pending = app.init(); await ready;
        Object.defineProperty(window, 'devicePixelRatio', { configurable: true, value: 1.5 });
        release(); await pending;
        if (app.app.renderer.resolution !== 1 || app.circleTexture.source.resolution !== 1
          || app.nativePixelRatio !== 1.5 || app.gui.controls.pixelRatioSelect.closest('li').style.display !== 'none') {
          throw new Error('Async init used stale resolution or availability');
        }
        if (app.circleTexture.width !== 10) throw new Error('Changed logical circle size');
      } finally { release(); Application.prototype.init = original; delete window.devicePixelRatio; app.destroy(); }
    });
    const fractional = await browser.newPage({ viewport: { width: 390, height: 843 }, deviceScaleFactor: 0.75 });
    try {
      await fractional.goto(url + '/fixture/'); await fractional.evaluate(() => window.ready);
      assert.deepEqual(await fractional.evaluate(() => {
        const { app } = fixture;
        return { renderer: app.app.renderer.resolution, texture: app.circleTexture.source.resolution,
          size: [app.circleTexture.width, app.circleTexture.height],
          planetSizes: app.planets.every(p => Math.abs(p.body.scaleX * app.circleTexture.width - p.options.size) < 1e-12),
          css: [app.canvas.getBoundingClientRect().width, app.canvas.getBoundingClientRect().height] };
      }), { renderer: 0.75, texture: 1, size: [10, 10], planetSizes: true, css: [390, 843] });
    } finally { await fractional.close(); }
    if (name === 'chromium') {
      const webgl1 = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: 2 });
      try {
        await webgl1.addInitScript(() => {
          const get = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl2' ? null : get.call(this, type, ...args); };
        });
        await webgl1.goto(url + '/fixture/'); await webgl1.evaluate(() => window.ready);
        await openOptions(webgl1);
        for (const ratio of [2, 1, 2]) {
          await webgl1.getByRole('combobox', { name: 'Rendering pixel ratio' }).selectOption(String(ratio)); await settle(webgl1);
          assert.deepEqual(await webgl1.evaluate(() => {
            const { app } = fixture;
            return [app.app.renderer.context.webGLVersion, app.app.renderer.resolution,
              app.circleTexture.source.resolution, app.app.renderer.gl.drawingBufferWidth];
          }), [1, ratio, ratio, 800 * ratio]);
        }
        await lifecycle.recovery(webgl1);
      } finally { await webgl1.close(); }
    }
    assert.deepEqual(errors, []);
    return { texturesReboundAndDestroyed: true, logicalSizeAndViewPreserved: true, roundTripPixels: true,
      repeatedRecovery: true, manualOwnership: true, asyncDisplayChange: true };
  } finally { await page.close(); }
};
