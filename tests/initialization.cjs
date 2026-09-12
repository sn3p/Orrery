const assert = require('node:assert/strict');

module.exports = async page => {
  const result = await page.evaluate(async () => {
    const { Orrery, Application } = fixture;
    const check = (value, message) => { if (!value) throw new Error(message); };
    const settle = async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); };
    const before = new Orrery({ autoRender: false });
    before.destroy(); before.destroy(); await before.init();
    check(!before.app && !document.querySelector('canvas'), 'Destroy before init prevents allocation');
    const results = [];
    for (const delayed of [false, true]) {
      const original = Application.prototype.init;
      let release, allocated;
      const gate = new Promise(resolve => { release = resolve; });
      const ready = new Promise(resolve => { allocated = resolve; });
      const app = new Orrery({ autoRender: false });
      const registrations = [];
      const add = EventTarget.prototype.addEventListener;
      EventTarget.prototype.addEventListener = function(type, listener, ...args) {
        if ([app.resize, app.onResolutionChange, app.onVisibilityChange, app.onContextLost, app.onContextRestored].includes(listener)) registrations.push(type);
        return add.call(this, type, listener, ...args);
      };
      Application.prototype.init = async function(options) {
        await original.call(this, options);
        allocated();
        if (delayed) await gate;
      };
      try {
        const pending = app.init();
        check(app.init() === pending, "Concurrent init callers share one operation");
        if (delayed) await ready;
        const pixi = app.app;
        app.destroy(); app.destroy();
        release(); await pending; await settle();
        check(app.destroyed && !app.initialized && app.animationFrame === null, 'Disposed initialization stays inert');
        check(pixi.renderer === null && pixi.stage === null, 'Late Pixi resources were actually destroyed');
        check(!document.querySelector('canvas') && !document.querySelector('.dg.main'), 'Late init attaches no canvas or GUI');
        check(registrations.length === 0, 'Late init registers no Orrery listeners');
        await app.init();
        check(app.app === pixi && pixi.renderer === null, 'Repeated init cannot revive disposal');
        results.push({ delayed, rendererDestroyed: true, listeners: registrations.length });
      } finally {
        release(); Application.prototype.init = original;
        EventTarget.prototype.addEventListener = add;
        app.destroy();
      }
    }
    // A cancelled instance must not poison the next real initialization.
    const next = new Orrery({ autoRender: false });
    await next.init();
    check(document.querySelectorAll('canvas').length === 1 && document.querySelectorAll('.dg.main').length === 1, 'Independent fresh instance initializes once');
    next.render(); next.destroy(); await settle();
    check(!document.querySelector('canvas') && !document.querySelector('.dg.main'), 'Fresh instance also cleans up');
    return { beforeInit: true, races: results, freshInstance: true };
  });
  assert.equal(result.races.length, 2);
  return result;
};
