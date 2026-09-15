const assert = require('node:assert/strict');

exports.frames = async page => {
  const result = await page.evaluate(() => {
    const { app } = fixture;
    const deferredReadouts = app.constructor.application === 'unified';
    const saved = { autoRender: app.autoRender, speed: app.jedDelta, jed: app.jed, elapsed: app.elapsed };
    const restores = [], events = [];
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    let image;
    const wrap = (owner, key, label, after) => {
      const original = owner[key];
      restores.push(() => { owner[key] = original; });
      owner[key] = function(...args) {
        events.push(label);
        const result = original.apply(this, args);
        after?.();
        return result;
      };
    };
    const state = () => ({ events: [...events], image, jed: app.jed, elapsed: app.elapsed,
      planets: app.planets.map(p => [p.body.x, p.body.y]),
      readouts: ['date', 'fps', 'count'].map(id => document.getElementById(`orrery-${id}`).textContent) });
    try {
      app.autoRender = false; app.cancelRender(); app.jedDelta = 0; app.jed = 2458600.5;
      app.render();
      wrap(app, 'renderFrame', 'frame'); wrap(app, 'tick', 'tick');
      wrap(app.clock, 'advance', 'clock'); wrap(app.asteroids, 'update', 'asteroids');
      app.planets.forEach(p => wrap(p, 'render', 'planet'));
      wrap(app.stats, 'reset', 'fps'); wrap(app, 'updateGui', 'gui');
      wrap(app.app, 'render', 'draw', () => { image = app.canvas.toDataURL(); });
      app.render(1000);
      const production = state();
      events.length = 0;
      app.renderFrame({ lastTime: 984, elapsedMS: 16 }, {
        beforeRender: () => events.push('beforeDraw'), afterRender: () => events.push('afterDraw'),
      });
      const manual = state();
      const tail = deferredReadouts ? ['beforeDraw', 'draw', 'gui', 'afterDraw'] : ['beforeDraw', 'draw', 'afterDraw'];
      check(tail.every((event, index) => events.at(index - tail.length) === event), 'Hooks enclose submission and completed readout commitment');
      check(events.indexOf('fps') < events.indexOf('beforeDraw'), 'FPS sampling stays inside tick timing');
      check(deferredReadouts ? events.indexOf('gui') > events.indexOf('draw') : events.indexOf('gui') < events.indexOf('beforeDraw'), 'Preview readouts wait for a draw receipt; legacy ordering is unchanged');
      check(app.animationFrame === null && !app.app.ticker.started, 'Manual frame starts no scheduler');
      app.autoRender = true;
      app.app.renderer.resolution = 1.25;
      app.renderFrame(1000);
      check(app.animationFrame === null && app.app.renderer.resolution === app.effectivePixelRatio, 'In-frame DPR correction creates no extra RAF');
      app.autoRender = false; app.jedDelta = 1.5; app.resetClock();
      app.renderFrame(2000); const jed = app.jed, elapsed = app.elapsed;
      app.renderFrame({ lastTime: 2000, elapsedMS: 100 });
      check(Math.abs(app.jed - jed - 9) < 1e-9 && Math.abs(app.elapsed - elapsed - 0.1) < 1e-9, 'One clock advance per numeric/ticker frame');
      // The already-registered Pixi callback remains the supported update boundary.
      app.app.ticker.lastTime = 2100;
      events.length = 0; const tickerJed = app.jed;
      app.app.ticker.update(2200);
      check(events.filter(e => e === 'asteroids').length === 1 && events.filter(e => e === 'planet').length === app.planets.length, 'Explicit ticker updates the scene once');
      check(Math.abs(app.jed - tickerJed - 9) < 1e-9, 'Explicit ticker reconstructs the uncapped timestamp');
      app.jedDelta = 0;
      for (const guard of ['hidden', 'context']) {
        const before = app.jed; events.length = 0;
        if (guard === 'hidden') Object.defineProperty(document, 'hidden', { configurable: true, value: true });
        else app.contextLost = true;
        app.renderFrame(10000);
        delete document.hidden; app.contextLost = false;
        check(!events.includes('tick') && !events.includes('draw') && app.jed === before, `${guard} blocks scene/date/draw`);
      }
      const early = new app.constructor({ autoRender: false });
      early.renderFrame(); early.destroy(); early.renderFrame();
      return { production, manual, deferredReadouts };
    } finally {
      delete document.hidden; app.contextLost = false;
      restores.reverse().forEach(restore => restore());
      app.elapsed = saved.elapsed; app.jed = saved.jed; app.jedDelta = saved.speed; app.autoRender = saved.autoRender;
      app.resetClock(); app.render();
    }
  });
  assert.deepEqual(result.manual.events.filter(e => !['beforeDraw', 'afterDraw'].includes(e)), result.production.events);
  for (const key of ['image', 'jed', 'elapsed', 'planets', 'readouts']) assert.deepEqual(result.manual[key], result.production[key], `Production/manual ${key} match`);
  assert.deepEqual(result.production.events, ['frame', 'tick', 'clock', 'asteroids', ...result.production.planets.map(() => 'planet'), 'fps', ...(result.deferredReadouts ? ['draw', 'gui'] : ['gui', 'draw'])]);
  return { matchingPixelsAndState: true, timingBoundaries: 'passed', schedulerAndTicker: 'passed', guards: 'passed' };
};

exports.fps = async page => page.evaluate(() => {
  const { app } = fixture, stats = app.stats;
  const saved = { performance: stats.performance, autoRender: app.autoRender, speed: app.jedDelta, jed: app.jed, elapsed: app.elapsed };
  let now = 0;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const verify = (frames, fps, label) => {
    check(stats.frames === frames && stats.fps === fps, `${label}: sampling state`);
    check(document.getElementById('orrery-fps').textContent === `${fps} FPS`, `${label}: same-frame readout`);
  };
  try {
    app.autoRender = false; app.cancelRender(); app.jedDelta = 1.5;
    stats.performance = { now: () => now }; app.resetClock();
    app.render(0); verify(1, 0, 'First frame');
    now = 1000; app.renderFrame(1000); verify(2, 0, 'Strict one-second boundary');
    now = 1001; app.renderFrame(1001); verify(0, 3, 'Rounded completed sample');
    now = 2002; app.render(2002); verify(0, 1, 'Fresh sample window');
    app.jedDelta = 0; app.renderFrame(3000); verify(0, 0, 'Paused frame');
    now = 9000; app.jedDelta = -1.5; app.render(9000); verify(1, 0, 'Reverse resume excludes idle time');
    now = 10001; app.renderFrame(10001); verify(0, 2, 'Reverse completed sample');
    stats.reset(); stats.reset(); app.updateGui(); verify(0, 0, 'Repeated reset');
    return { strictBoundary: true, rounding: true, sameFrameReadout: true, pauseResumeReverse: true };
  } finally {
    stats.performance = saved.performance; app.elapsed = saved.elapsed; app.jed = saved.jed;
    app.jedDelta = saved.speed; app.autoRender = saved.autoRender; app.resetClock(); app.render();
  }
});

exports.gui = async page => page.evaluate(() => {
  const { app } = fixture;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const add = window.addEventListener, remove = window.removeEventListener;
  const active = new Map();
  window.addEventListener = function(type, listener, ...args) {
    if (!active.has(type)) active.set(type, new Set());
    active.get(type).add(listener);
    return add.call(this, type, listener, ...args);
  };
  window.removeEventListener = function(type, listener, ...args) {
    active.get(type)?.delete(listener);
    return remove.call(this, type, listener, ...args);
  };
  let destroys = 0;
  try {
    for (let i = 0; i < 2; i++) {
      const direct = new app.gui.controls.constructor(app), element = direct.gui.domElement;
      const destroy = direct.gui.destroy.bind(direct.gui);
      direct.gui.destroy = () => { destroys++; destroy(); };
      check(element.isConnected && element.querySelector('input').getAttribute('aria-label') === 'Playback speed', 'Fresh standalone controls are attached and named');
      direct.destroy(); direct.destroy();
      check(destroys === i + 1 && !element.isConnected, 'Standalone destroy releases DOM exactly once');
      check([...active.values()].every(set => set.size === 0), 'Standalone GUI removes each owned window listener');
      window.dispatchEvent(new Event('resize'));
    }
    const controls = app.gui.controls, destroy = controls.gui.destroy.bind(controls.gui);
    let ownedDestroys = 0;
    controls.gui.destroy = () => { ownedDestroys++; destroy(); };
    controls.destroy(); controls.destroy();
    app.autoRender = true; app.requestRender(); app.destroy(); app.destroy();
    app.renderFrame(); app.render();
    check(ownedDestroys === 1 && app.animationFrame === null && !document.querySelector('canvas, .dg.main'), 'Standalone then app teardown remains safe and leaves no resources');
    return { standaloneLifetimes: 2, standaloneDestroys: destroys, appOwnedDestroys: ownedDestroys, listenersRemaining: 0 };
  } finally { window.addEventListener = add; window.removeEventListener = remove; }
});
