const assert = require('node:assert/strict');
const path = require('node:path');
const settle = page => page.evaluate(async () => {
  for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
});
const state = page => page.evaluate(() => ({ draws: fixture.probe.draws, updates: fixture.probe.updates,
  jed: fixture.app.jed, elapsed: fixture.app.elapsed, pending: fixture.app.animationFrame }));

exports.visibility = async page => {
  const results = [];
  for (const speed of [0, 1.5, -1.5]) {
    await page.evaluate(speed => {
      const {app} = fixture;
      app.jedDelta = speed;
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      app.requestRender();
    }, speed);
    const hidden = await state(page);
    assert.equal(hidden.pending, null);
    await page.waitForTimeout(180);
    assert.deepEqual(await state(page), hidden, 'Visibility loss cancels queued rendering and freezes both clocks');
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(n => fixture.probe.draws > n, hidden.draws);
    assert.deepEqual(await page.evaluate(n => fixture.probe.frames[n], hidden.draws), { jed: hidden.jed, elapsed: hidden.elapsed });
    await settle(page);
    if (speed === 0) assert.equal((await state(page)).draws, hidden.draws + 1);
    else assert(speed > 0 ? (await state(page)).jed > hidden.jed : (await state(page)).jed < hidden.jed);
    await page.evaluate(() => { fixture.app.jedDelta = 0; }); await settle(page);
    results.push({ speed, firstFrameExcludesDowntime: true });
  }
  return results;
};

exports.recovery = async (page, { manual = false } = {}) => {
  await page.evaluate(() => {
    fixture.probe.capture = true;
    // Capture the complete populated scene before loss, including planets.
    if (!fixture.app.autoRender) fixture.app.render();
    else fixture.app.requestRender();
  });
  await settle(page);
  const results = [];
  for (const speed of manual ? [0, -1.5] : [0, 0, -1.5]) {
    const available = await page.evaluate(speed => {
      const {app} = fixture;
      app.jedDelta = speed;
      window.lossExtension = app.app.renderer.gl.getExtension('WEBGL_lose_context');
      window.lossExtension?.loseContext();
      return !!window.lossExtension;
    }, speed);
    assert(available, 'Real context loss extension is required for this lifecycle test');
    await page.waitForFunction(() => fixture.app.contextLost);
    const lost = await state(page);
    const before = await page.evaluate(() => ({ texture: fixture.app.circleTexture.uid,
      image: fixture.probe.image, pixels: fixture.probe.pixels, textureDraws: fixture.probe.textureDraws }));
    assert.equal(lost.pending, null);
    await page.waitForTimeout(180);
    assert.deepEqual(await state(page), lost, 'No recurring scene work during graphics loss');
    await page.evaluate(() => window.lossExtension.restoreContext());
    await page.waitForFunction(() => !fixture.app.contextLost);
    if (manual) {
      await settle(page);
      assert.deepEqual(await state(page), lost, 'Recovery in manual mode does not draw or advance');
      await page.evaluate(() => fixture.app.render(performance.now() + 100000));
    } else {
      await page.waitForFunction(n => fixture.probe.draws > n, lost.draws);
    }
    assert.deepEqual(await page.evaluate(n => fixture.probe.frames[n], lost.draws), { jed: lost.jed, elapsed: lost.elapsed }, 'First recovery draw excludes all graphics downtime');
    assert.equal(await page.evaluate(() => fixture.app.renderFailure?.message || fixture.app.graphicsError || ''), '',
      'A restored frame must not leave a terminal graphics failure, even while paused');
    const recovered = await page.evaluate(() => ({ texture: fixture.app.circleTexture.uid,
      image: fixture.probe.image, pixels: fixture.probe.pixels, textureDraws: fixture.probe.textureDraws,
      bound: fixture.app.planets.every(p => p.body.texture === fixture.app.circleTexture)
        && fixture.app.planetContainer.texture === fixture.app.circleTexture
        && fixture.app.asteroids.texture === fixture.app.circleTexture }));
    assert.notEqual(recovered.texture, before.texture);
    assert.equal(recovered.textureDraws, before.textureDraws + 1, 'One offscreen texture regeneration is distinct from scene scheduling');
    assert(recovered.bound, 'Planets and asteroids rebind the recovered texture');
    if (speed === 0) {
      assert.equal(recovered.image, before.image, 'Automatic recovery preserves the complete paused framebuffer');
      assert(recovered.pixels.green + recovered.pixels.gray > 0, 'Recovered scene is nonempty');
      await settle(page);
      assert.equal((await state(page)).draws, lost.draws + 1);
    } else if (!manual) {
      await page.waitForFunction(jed => fixture.app.jed < jed, lost.jed);
      assert((await state(page)).elapsed > lost.elapsed);
    }
    await page.evaluate(() => { fixture.app.jedDelta = 0; }); await settle(page);
    results.push({ speed, textureRegenerated: true, firstFrameExcludesDowntime: true });
  }
  return results;
};

exports.disposal = async (page, url) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/pending-disposal', async route => { await gate; await route.fulfill({ body: '[]' }).catch(() => {}); });
  try {
    await page.evaluate(url => { window.pendingLoad = fixture.app.loadAsteroids(url + '/pending-disposal'); }, url);
    assert.equal(await page.getByRole('status').textContent(), 'Loading asteroids…');
    const before = await page.evaluate(() => {
      const {app, probe} = fixture, query = app.resolutionQuery, canvas = app.canvas, cloud = app.asteroids;
      const expected = [[window, 'resize', app.resize], [document, 'visibilitychange', app.onVisibilityChange],
        [canvas, 'webglcontextlost', app.onContextLost], [canvas, 'webglcontextrestored', app.onContextRestored],
        [canvas, 'wheel', app.controls.onScroll], [query, 'change', app.onResolutionChange],
        [app.gui.controls.trigger, 'click', app.gui.controls.onToggle],
        [document, 'pointerdown', app.gui.controls.onOutsidePointer], [document, 'keydown', app.gui.controls.onKeyDown]];
      const removed = new Set(), restore = [];
      for (const target of new Set(expected.map(item => item[0]))) {
        const original = target.removeEventListener;
        target.removeEventListener = function(type, listener, ...args) {
          expected.forEach(([t, event, callback], i) => {
            if (t === target && event === type && callback === listener) removed.add(i);
          });
          return original.call(this, type, listener, ...args);
        };
        restore.push(() => { target.removeEventListener = original; });
      }
      app.jedDelta = 1.5; app.requestRender(); app.destroy(); app.destroy();
      query.dispatchEvent(new Event('change'));
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -100 }));
      window.dispatchEvent(new Event('resize'));
      document.dispatchEvent(new Event('visibilitychange'));
      app.setAsteroids([]); app.jed += 1; app.jedDelta = -1.5; app.requestRender(); app.render();
      restore.forEach(fn => fn());
      return { draws: probe.draws, updates: probe.updates, removed: removed.size, pending: app.animationFrame,
        canvas: !!document.querySelector('canvas'), gui: !!document.querySelector('.dg.main'), cloudDestroyed: cloud.destroyed };
    });
    // This is evaluated in the page without adding production globals.
    assert.equal(before.pending, null); assert.equal(before.removed, 9);
    assert.equal(before.canvas, false); assert.equal(before.gui, false); assert(before.cloudDestroyed);
    assert.equal(await page.getByRole('status').textContent(), '', 'Teardown clears pending loading feedback immediately');
    release(); assert.equal(await page.evaluate(() => window.pendingLoad), false);
    await settle(page);
    assert.equal(await page.getByRole('status').textContent(), '', 'Cancelled fetch cannot restore stale loading feedback');
    assert.equal(await page.evaluate(() => fixture.probe.draws), before.draws);
    assert.equal(await page.evaluate(() => fixture.probe.updates), before.updates);
    return { pendingFrameCancelled: true, delayedLoadCancelled: true, statusCleared: true, listenersRemoved: true };
  } finally { release(); await page.unroute('**/pending-disposal'); }
};

exports.production = async (browser, url, output, name) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/data/catalog.json', async route => { await gate; await route.continue().catch(() => {}); });
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await require('./options.cjs').openOptions(page);
    await page.getByRole('combobox', { name: 'Rendering pixel ratio' }).selectOption('2');
    const input = page.getByRole('textbox', { name: 'Playback speed' });
    const speed = async value => { await input.fill(String(value)); await input.press('Enter'); await settle(page); };
    await speed(0);
    assert.match(await page.locator('#orrery-status').textContent(), /Loading/);
    await page.evaluate(() => {
      // Instrument the real production WebGL context: no exported app/test API.
      const gl = document.querySelector('canvas').getContext('webgl2');
      window.draws = 0;
      for (const method of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
        const original = gl[method];
        gl[method] = function(...args) { window.draws++; return original.apply(this, args); };
      }
    });
    const idle = async () => {
      await settle(page);
      const before = await page.evaluate(() => window.draws);
      await page.waitForTimeout(180);
      assert.equal(await page.evaluate(() => window.draws), before, 'Actual production WebGL submissions stop at pause');
      assert.equal(await page.locator('#orrery-fps').textContent(), '0 FPS');
      return before;
    };
    await idle();
    const pausedDate = await page.locator('#orrery-date').textContent();
    release();
    await page.waitForFunction(() => Number(document.querySelector('#orrery-count').textContent) > 0);
    assert((await idle()) > 0, 'Delayed production fetch automatically repaints while paused');
    assert.equal(await page.locator('#orrery-date').textContent(), pausedDate);
    assert.equal(await page.locator('#orrery-status').textContent(), '');
    await page.screenshot({ path: path.join(output, `${name}-production-desktop.png`) });
    const canvas = page.locator('canvas');
    // A canvas screenshot includes overlaid UI; clear trigger hover before comparing.
    await page.mouse.move(600, 400);
    const previous = await canvas.screenshot();
    const draws = await page.evaluate(() => window.draws);
    await page.evaluate(() => {
      window.horizontalWheel = false;
      document.querySelector('canvas').addEventListener('wheel', event => {
        window.horizontalWheel = event.deltaX !== 0 && event.deltaY === 0;
      }, { once: true });
    });
    await page.mouse.move(600, 400); await page.mouse.wheel(200, 0);
    await page.waitForFunction(() => window.horizontalWheel);
    assert.equal(await idle(), draws, 'Horizontal-only wheel input leaves the paused renderer asleep');
    assert(previous.equals(await canvas.screenshot()), 'Horizontal-only wheel input preserves the framebuffer');
    await page.mouse.move(600, 400); await page.mouse.wheel(0, -200);
    await page.waitForFunction(n => window.draws > n, draws);
    await idle();
    assert(!previous.equals(await canvas.screenshot()), 'Paused wheel zoom changes the production framebuffer');
    await speed(1.5);
    await page.waitForFunction(date => document.querySelector('#orrery-date').textContent > date, pausedDate);
    await page.waitForFunction(() => parseInt(document.querySelector('#orrery-fps').textContent) > 0);
    await speed(0); await idle();
    const date = await page.locator('#orrery-date').textContent();
    await speed(-1.5);
    await page.waitForFunction(date => document.querySelector('#orrery-date').textContent < date, date);
    await speed(0); await idle();
    const slider = page.locator('.dg .slider'), bounds = await slider.boundingBox();
    await slider.click({ position: { x: bounds.width * 0.7, y: bounds.height / 2 } });
    await page.waitForFunction(date => document.querySelector('#orrery-date').textContent > date, await page.locator('#orrery-date').textContent());
    await speed(0); await idle();
    for (const width of [390, 360]) {
      const before = await page.evaluate(() => window.draws);
      await page.setViewportSize({ width, height: 844 });
      await page.waitForFunction(n => window.draws > n, before);
      await idle();
      assert.deepEqual(await canvas.evaluate(el => [el.width, el.height]), [width * 2, 1688]);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), width);
      for (const selector of ['#orrery-date', '#orrery-count', '#orrery-fps', '.dg .slider', '.dg input']) {
        const box = await page.locator(selector).boundingBox();
        assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 844);
      }
      await input.focus(); assert(await input.evaluate(el => el === document.activeElement));
      await page.screenshot({ path: path.join(output, `${name}-production-${width}.png`) });
    }
    assert.deepEqual(errors, []);
    return { recurringWebGLSubmissions: 0, pausedLoading: 'passed', horizontalWheelIgnored: true, keyboardSliderZoom: 'passed',
      viewports: ['1280x800 DPR2', '390x844 DPR2', '360x844 DPR2'], consoleErrors: 0 };
  } finally { release(); await page.close(); }
};
