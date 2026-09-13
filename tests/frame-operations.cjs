const assert = require('node:assert/strict');

exports.frames = async page => {
  const result = await page.evaluate(() => {
    const { app } = fixture;
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
      check(events.at(-3) === 'beforeDraw' && events.at(-2) === 'draw' && events.at(-1) === 'afterDraw', 'Hooks bracket drawing only');
      check(events.indexOf('fps') < events.indexOf('gui') && events.indexOf('gui') < events.indexOf('beforeDraw'), 'Target FPS/readout ordering remains inside tick timing');
      check(app.animationFrame === null && !app.app.ticker.started, 'Manual frame starts no scheduler');
      app.autoRender = true;
      app.app.renderer.resolution = 1.25;
      app.renderFrame(1000);
      check(app.animationFrame === null && app.app.renderer.resolution === devicePixelRatio, 'In-frame DPR correction creates no extra RAF');
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
      return { production, manual };
    } finally {
      delete document.hidden; app.contextLost = false;
      restores.reverse().forEach(restore => restore());
      app.elapsed = saved.elapsed; app.jed = saved.jed; app.jedDelta = saved.speed; app.autoRender = saved.autoRender;
      app.resetClock(); app.render();
    }
  });
  assert.deepEqual(result.manual.events.filter(e => !['beforeDraw', 'afterDraw'].includes(e)), result.production.events);
  for (const key of ['image', 'jed', 'elapsed', 'planets', 'readouts']) assert.deepEqual(result.manual[key], result.production[key], `Production/manual ${key} match`);
  assert.deepEqual(result.production.events, ['frame', 'tick', 'clock', 'asteroids', ...result.production.planets.map(() => 'planet'), 'fps', 'gui', 'draw']);
  return { matchingPixelsAndState: true, timingBoundaries: 'passed', schedulerAndTicker: 'passed', guards: 'passed' };
};
