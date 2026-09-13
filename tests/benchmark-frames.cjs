const assert = require('node:assert/strict');
const { sample } = require('../benchmarks/run.cjs');

module.exports = async (browser, url) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(url); await page.evaluate(() => window.ready);
    await page.evaluate(() => {
      const { app } = fixture;
      const original = app.renderFrame;
      window.frames = [];
      app.renderFrame = function(timestamp, hooks) {
        const events = [], restores = [];
        const wrap = (owner, key, label) => {
          const saved = owner[key]; restores.push(() => { owner[key] = saved; });
          owner[key] = function(...args) { events.push(label); return saved.apply(this, args); };
        };
        wrap(app.clock, 'advance', 'clock'); wrap(app.asteroids, 'update', 'asteroids');
        app.planets.forEach(p => wrap(p, 'render', 'planet'));
        wrap(app.stats, 'update', 'fps'); wrap(app, 'updateGui', 'gui'); wrap(app.app, 'render', 'draw');
        try {
          const result = original.call(this, timestamp, {
            beforeRender: () => { events.push('beforeDraw'); hooks.beforeRender(); },
            afterRender: () => { events.push('afterDraw'); hooks.afterRender(); },
          });
          frames.push({ events, timestamp, jed: app.jed, fps: app.stats.fps,
            readout: document.getElementById('orrery-fps').textContent });
          return result;
        } finally { restores.reverse().forEach(restore => restore()); }
      };
    });
    const run = await page.evaluate(sample, { count: 1000, warmupMs: 50, sampleMs: 80 });
    const frames = await page.evaluate(() => window.frames);
    assert(run.frames > 0 && frames.length >= run.frames);
    for (const frame of frames) {
      assert.deepEqual(frame.events, ['clock', 'asteroids', ...Array(6).fill('planet'), 'fps', 'gui', 'beforeDraw', 'draw', 'afterDraw']);
      assert.equal(frame.readout, `${frame.fps} FPS`);
      assert(Math.abs(frame.jed - frames[0].jed - (frame.timestamp - frames[0].timestamp) * 0.09) < 1e-8, 'Benchmark advances the dated view exactly once');
    }
    for (const field of ['tickMs', 'renderSubmitMs', 'arrayUploadBytes']) {
      for (const value of Object.values(run[field])) assert(Number.isFinite(value) && value >= 0, `Finite separate ${field}`);
    }
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => frames.length), frames.length, 'Shared benchmark helper creates no background frames');

    const interruptions = [];
    for (const event of ['resize', 'blur', 'visibilitychange', 'webglcontextlost']) {
      await page.reload(); await page.evaluate(() => window.ready);
      await page.evaluate(() => {
        const { app } = fixture, gl = app.app.renderer.gl;
        const upload = gl.bufferSubData, raf = requestAnimationFrame, cancel = cancelAnimationFrame;
        const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
        const pending = new Set(); let listeners = 0;
        const watched = (target, type) => [window, document, app.canvas].includes(target)
          && ['resize', 'blur', 'visibilitychange', 'webglcontextlost'].includes(type);
        EventTarget.prototype.addEventListener = function(type, ...args) {
          if (watched(this, type)) listeners++;
          return add.call(this, type, ...args);
        };
        EventTarget.prototype.removeEventListener = function(type, ...args) {
          if (watched(this, type)) listeners--;
          return remove.call(this, type, ...args);
        };
        // Model the browser withholding RAF after backgrounding. Events still
        // dispatch, but the benchmark must settle without its next callback.
        window.requestAnimationFrame = callback => {
          if (callback.name !== 'frame') return raf(callback);
          const id = raf(() => {}); pending.add(id); return id;
        };
        window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
        window.cleanupCheck = () => ({ pending: pending.size, listeners, uploadRestored: gl.bufferSubData === upload });
        window.restoreProbe = () => {
          requestAnimationFrame = raf; cancelAnimationFrame = cancel;
          EventTarget.prototype.addEventListener = add; EventTarget.prototype.removeEventListener = remove;
        };
      });
      let timer;
      try {
        const rejected = assert.rejects(Promise.race([
          page.evaluate(sample, { count: 1000, warmupMs: 0, sampleMs: 50 }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Benchmark hung on ${event} without RAF`)), 2000); }),
        ]), /interrupted/);
        await page.waitForFunction(() => !cleanupCheck().uploadRestored);
        if (event === 'resize') await page.setViewportSize({ width: 390, height: 844 });
        else if (event === 'webglcontextlost') await page.evaluate(() => {
          window.recoverContext = fixture.app.app.renderer.gl.getExtension('WEBGL_lose_context');
          recoverContext.loseContext();
        });
        else await page.evaluate(event => {
          if (event === 'visibilitychange') Object.defineProperty(document, 'hidden', { configurable: true, value: true });
          (event === 'visibilitychange' ? document : window).dispatchEvent(new Event(event));
        }, event);
        await rejected;
        assert.deepEqual(await page.evaluate(() => cleanupCheck()), { pending: 0, listeners: 0, uploadRestored: true });
        await page.evaluate(() => { delete document.hidden; restoreProbe(); });
        if (event === 'webglcontextlost') {
          await page.waitForFunction(() => fixture.app.contextLost);
          await page.waitForTimeout(50);
          await page.evaluate(() => recoverContext.restoreContext());
          await page.waitForFunction(() => !fixture.app.contextLost);
        }
        assert((await page.evaluate(sample, { count: 1000, warmupMs: 0, sampleMs: 50 })).frames > 0, `Same-page retry after ${event}`);
        assert.equal(await page.evaluate(() => fixture.app.animationFrame), null);
        interruptions.push(event);
      } finally { clearTimeout(timer); }
    }
    assert.deepEqual(errors, []);
    return { sharedFrames: frames.length, exactOperationOrder: true, separateTiming: true,
      interruptionsWithoutRaf: interruptions, nativeEvents: ['resize', 'webglcontextlost'],
      controlledEvents: ['blur', 'visibilitychange'], samePageRetries: 4 };
  } finally { await page.close(); }
};
