const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { serve } = require('./support.cjs');
const cases = require('./fixtures/consumer-v1/cases.json');

async function boot(browser, base, renderer = 'pixi', viewport = { width: 1280, height: 800 }, trackListeners = false) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  if (trackListeners) await page.addInitScript(() => {
    window.activeListeners = [];
    const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
    const tracked = target => target === window || target === document || target instanceof HTMLCanvasElement;
    const capture = options => typeof options === 'boolean' ? options : !!options?.capture;
    EventTarget.prototype.addEventListener = function(type, listener, options) {
      if (tracked(this) && !activeListeners.some(e => e.target === this && e.type === type && e.listener === listener && e.capture === capture(options))) {
        activeListeners.push({ target: this, type, listener, capture: capture(options) });
      }
      return add.call(this, type, listener, options);
    };
    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      window.activeListeners = activeListeners.filter(e => !(e.target === this && e.type === type && e.listener === listener && e.capture === capture(options)));
      return remove.call(this, type, listener, options);
    };
  });
  await page.goto(base + '/Orrery/next/?renderer=' + renderer);
  await page.evaluate(() => threeTest.ready);
  await page.waitForFunction(() => threeTest.app.catalogue?.firstDraw);
  await page.evaluate(() => { window.app = threeTest.app; app.jedDelta = 0; app.cancelRender(); });
  return { page, errors };
}
async function state(browser, base, output, name) {
  const { page, errors } = await boot(browser, base);
  try {
    const result = await page.evaluate(async () => {
      const check = (ok, message) => { if (!ok) throw new Error(message); };
      const model = app.catalogue, jed = app.jed, count = app.asteroidsDiscovered;
      app.pixelRatio = '2'; app.renderer.stage.scale.set(1.7); app.renderer.stage.x += 21;
      const pixi = app.renderer.captureView();
      const start = performance.now();
      check(await app.switchRenderer('three'), 'Switch reaches Three');
      const cold = performance.now() - start;
      check(app.catalogue === model && app.jed === jed && app.asteroidsDiscovered === count, 'Date/count/model survive');
      app.renderer.camera.position.set(700, 300, 200); app.renderer.controls.target.set(11, 12, 13); app.renderer.controls.update();
      const three = app.renderer.captureView();
      check(await app.switchRenderer('pixi'), 'Switch returns to Pixi');
      check(JSON.stringify(app.renderer.captureView()) === JSON.stringify(pixi), 'Pixi view restored');
      check(app.renderer.asteroids.geometry.getBuffer('aDiscovery').data.every(n => n === -1), 'No historical arrivals replayed');
      check(app.renderer.asteroids.committedCount === model.count, 'Bundled future population retained');
      check(await app.switchRenderer('three'), 'Three round trip');
      const restored = app.renderer.captureView();
      for (const key of ['position', 'up', 'quaternion', 'target']) check(restored[key].every((v,i) => Math.abs(v - three[key][i]) < 1e-10), key + ' restored');
      app.jed = jed + 30;
      check(await app.switchRenderer('pixi'), 'Undrawn bundled seek switch');
      check(app.jed === jed && app.asteroidsDiscovered === count, 'Switch rebuilds last committed date/count');
      app.renderFrame();
      check(app.jed === jed + 30, 'Undrawn seek commits in following frame');
      app.jed += 1234; app.renderFrame(); app.renderer.stage.scale.set(4);
      const captureTracks = () => { app.renderer.asteroids.visible = false; app.renderer.render(); return app.renderer.canvas.toDataURL(); };
      const tracks = captureTracks();
      await app.switchRenderer('three'); await app.switchRenderer('pixi');
      check(captureTracks() === tracks, 'Planet/track pixels round-trip after advancing time');
      app.renderer.asteroids.visible = true;
      for (const speed of [1.5, -2, 0]) {
        app.jedDelta = speed; app.cancelRender();
        const before = { jed: app.jed, elapsed: app.elapsed };
        check(await app.switchRenderer(app.rendererId === 'pixi' ? 'three' : 'pixi'), 'Playing switch');
        app.cancelRender();
        check(app.jed === before.jed && app.elapsed === before.elapsed && app.jedDelta === speed, 'No transition time added');
        app.renderFrame(performance.now() + 60000);
        check(app.jed === before.jed, 'First resumed frame resets clock');
      }
      app.jedDelta = 0;
      const requests = [app.switchRenderer('three'), app.switchRenderer('pixi'), app.switchRenderer('three')];
      await Promise.all(requests);
      check(app.rendererId === 'three' && !app.switching, 'Rapid requests coalesced');
      check(app.pixelRatio === '2' && app.renderer.viewport.pixelRatio === 2, 'DPR preserved');
      return { coldSwitchMs: cold, modelCount: model.count, views: true, speeds: true, coalescing: true };
    });
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    const selector = page.getByRole('combobox', { name: 'Renderer', exact: true });
    assert(await selector.evaluate(el => el === document.activeElement));
    await selector.selectOption('pixi');
    await page.waitForFunction(() => !app.switching && app.rendererId === 'pixi');
    assert(await selector.evaluate(el => el === document.activeElement));
    for (const viewport of [{ width: 1280, height: 800 }, { width: 320, height: 568 }, { width: 568, height: 200 }]) {
      await page.setViewportSize(viewport);
      assert(await selector.evaluate(el => { const label = el.closest('li').querySelector('.property-name'); return label.scrollWidth <= label.clientWidth; }), 'Renderer label is not clipped');
      const box = await page.locator('.orrery-options-panel').boundingBox();
      assert(box.x >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height);
      await page.screenshot({ path: path.join(output, `${name}-switch-options-${viewport.width}.png`) });
    }
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('button', { name: 'Options', exact: true }).getAttribute('aria-expanded'), 'false');
    assert.deepEqual(errors, []);
    return result;
  } finally { await page.close(); }
}

async function failures(browser, base) {
  const { page, errors } = await boot(browser, base);
  try {
    await page.evaluate(async ({ pin, base }) => {
      app.jed = 2451544.5; app.renderFrame();
      await app.loadCatalog({ ...pin, url: base + '/fixtures/ties/index.json' });
    }, { pin: cases.bundles.ties.pin, base });
    await page.waitForFunction(() => app.activeSession && !app.pendingSession && app.catalogLoader.sceneComplete());
    await page.evaluate(async () => {
      const check = (ok, message) => { if (!ok) throw new Error(message); };
      const model = app.catalogue, jed = app.jed, count = app.asteroidsDiscovered;
      const load = app.rendererRegistry.three.load;
      const original = app.renderer;
      app.rendererRegistry.three.load = async () => { throw new Error('controlled code load'); };
      check(!await app.switchRenderer('three'), 'Lazy failure rejected');
      check(app.renderer === original && !original.destroyed && app.jed === jed, 'Lazy failure preserves outgoing');
      app.renderer.reportGraphicsState(true);
      check(document.getElementById('orrery-status').textContent.includes('Graphics connection lost'), 'Graphics loss overrides old switch failure');
      app.renderer.reportGraphicsState(false); app.renderFrame();
      const render = app.renderer.render.bind(app.renderer);
      app.renderer.render = () => { throw new Error('controlled active draw'); };
      app.renderFrame();
      check(document.getElementById('orrery-status').textContent.includes('Unable to render'), 'Active draw failure overrides old switch failure');
      app.renderer.render = render; app.renderer.reportGraphicsState(false); app.renderFrame();
      const make = await load();
      for (const fault of ['init', 'pack', 'upload', 'draw', 'receipt']) {
        let failed;
        app.rendererRegistry.three.load = async () => options => {
          failed = make(options);
          if (fault === 'init') { const init = failed.init.bind(failed); failed.init = () => { init(); throw new Error('controlled init'); }; }
          if (fault === 'upload') { const init = failed.init.bind(failed); failed.init = () => { init(); failed.renderer.getContext().bufferData = () => { throw new Error('controlled allocation/upload'); }; }; }
          if (fault === 'pack') failed.syncCatalogue = () => { throw new Error('controlled pack'); };
          if (fault === 'draw') failed.render = () => { throw new Error('controlled draw'); };
          if (fault === 'receipt') failed.render = () => null;
          return failed;
        };
        const outgoing = app.renderer;
        check(!await app.switchRenderer('three'), fault + ' rejected');
        check(failed.destroyed && outgoing.destroyed && app.rendererId === 'pixi' && !app.renderer.destroyed, fault + ' fallback rebuilt');
        check(app.catalogue === model && app.jed === jed && app.asteroidsDiscovered === count, fault + ' keeps state');
        const token = app.rendererGeneration;
        outgoing.reportGraphicsState(true, new Error('stale'));
        failed.reportGraphicsState(true, new Error('stale'));
        check(!app.contextLost && app.rendererGeneration === token, 'Stale graphics callbacks ignored');
      }
      const previousCreate = app.createRenderer;
      let failedFallback;
      app.createRenderer = async options => {
        failedFallback = await previousCreate(options);
        failedFallback.init = () => { throw new Error('controlled fallback failure'); };
        return failedFallback;
      };
      app.renderer.reportGraphicsState(true);
      check(!await app.switchRenderer('three') && !app.renderer, 'Double failure has no renderer');
      check(document.getElementById('orrery-status').textContent.includes('Unable to restore the visualization'), 'Terminal switch recovery overrides the disposed context status');
      check(app.animationFrame === null && document.querySelector('#orrery-status button'), 'Double failure exposes retry without loop');
      const generation = app.rendererGeneration, contextLost = app.contextLost;
      failedFallback.reportGraphicsState(true, new Error('stale fallback'));
      check(app.contextLost === contextLost && app.rendererGeneration === generation, 'Failed fallback callbacks ignored');
      app.renderFrame(); app.tick(); app.resize();
      app.createRenderer = previousCreate;
      app.rendererRegistry.three.load = load;
      const loader = app.catalogLoader, demand = loader.demand.bind(loader);
      let terminalDemand;
      app.contextLost = false; app.jedDelta = 1.5;
      loader.demand = (date, state) => { terminalDemand = state; return demand(date, state); };
      app.demandCatalog(); loader.demand = demand; app.jedDelta = 0;
      check(terminalDemand.hidden && !terminalDemand.playing, 'No renderer suspends catalogue lookahead');
      window.resumeFailureChecks = async () => {
      check(app.rendererId === 'pixi' && !!app.renderer, 'Previous mode recovered directly through selector');
      check(await app.switchRenderer('three'), 'Explicit mode recovery works');
      check(app.catalogue === model && document.querySelectorAll('canvas').length === 1, 'Recovery uses same model and one canvas');
      // Delay actual code preparation, exercise frozen date and data replacement.
      let release;
      const pixiLoad = app.rendererRegistry.pixi.load;
      app.rendererRegistry.pixi.load = () => new Promise(resolve => { release = async () => resolve(await pixiLoad()); });
      const before = app.jed;
      const pending = app.switchRenderer('pixi');
      while (!release) await new Promise(resolve => setTimeout(resolve, 0));
      app.jed = before + 1; app.tick(performance.now() + 5000); app.renderFrame();
      check(app.jed === before, 'Seek stays pending during loading');
      release(); await pending; app.renderFrame();
      check(app.jed === before + 1, 'Pending seek applies after switch');
      app.rendererRegistry.pixi.load = pixiLoad;
      // Destroy during asynchronous candidate initialization.
      app.rendererRegistry.three.load = async () => options => {
        const renderer = make(options), init = renderer.init.bind(renderer);
        renderer.init = async () => { init(); await new Promise(resolve => { release = resolve; }); };
        return renderer;
      };
      release = null;
      const destroyedSwitch = app.switchRenderer('three');
      while (!release) await new Promise(resolve => setTimeout(resolve, 0));
      app.destroy(); release(); await destroyedSwitch;
      check(!document.querySelector('canvas, .orrery-options') && app.animationFrame === null, 'Destroy during initialization disposes everything');
      return { faults: ['load', 'init', 'pack', 'upload', 'draw', 'receipt', 'fallback'], staleCallbacks: true, pendingSeek: true, disposal: true };
      };
    });
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    const selector = page.getByRole('combobox', { name: 'Renderer', exact: true });
    assert.equal(await selector.inputValue(), '', 'No renderer is falsely shown as active');
    assert.equal(await selector.locator('option:checked').textContent(), 'Choose renderer');
    await selector.selectOption('pixi');
    await page.waitForFunction(() => !app.switchPromise && !!app.renderer);
    assert.equal(await selector.inputValue(), 'pixi', 'Focused selector reflects recovery');
    return await page.evaluate(() => resumeFailureChecks());
  } finally { assert.deepEqual(errors, []); await page.close(); }
}

async function lifecycle(browser, base) {
  const { page, errors } = await boot(browser, base, 'pixi', undefined, true);
  try {
    const result = await page.evaluate(async () => {
      const check = (ok, message) => { if (!ok) throw new Error(message); };
      const model = app.catalogue, timings = [], listenerCounts = [];
      for (let i = 0; i < 20; i++) {
        const start = performance.now();
        check(await app.switchRenderer(i % 2 ? 'pixi' : 'three'), 'Alternating switch ' + i);
        timings.push(performance.now() - start);
        if (i % 2) listenerCounts.push(activeListeners.length);
        check(document.querySelectorAll('canvas').length === 1 && document.querySelectorAll('.orrery-options').length === 1, 'One scene/UI');
        check(app.catalogue === model && !app.renderer.needsCatalogPacking(model), 'Retained population uploaded');
      }
      check(listenerCounts.every(n => n === listenerCounts[0]), 'Listener count stays bounded: ' + listenerCounts);
      app.cancelRender();
      let draws = 0; const render = app.renderer.render.bind(app.renderer); app.renderer.render = () => { draws++; return render(); };
      await new Promise(resolve => setTimeout(resolve, 100));
      check(draws === 0 && app.animationFrame === null, 'Paused switch leaves no recurring draws');
      app.renderer.render = render;
      return { switches: timings.length, timings, listenerCounts, pausedDraws: draws };
    });
    for (const id of ['pixi', 'three']) {
      await page.evaluate(id => app.switchRenderer(id), id);
      for (let cycle = 0; cycle < 2; cycle++) {
        await page.evaluate(() => {
          window.oldModel = app.catalogue;
          const gl = app.rendererId === 'pixi' ? app.renderer.app.renderer.gl : app.renderer.renderer.getContext();
          window.recover = gl.getExtension('WEBGL_lose_context'); recover.loseContext();
        });
        await page.waitForFunction(() => app.contextLost);
        await page.evaluate(() => recover.restoreContext());
        await page.waitForFunction(() => !app.contextLost && !app.graphicsRecoveryPending);
        assert(await page.evaluate(() => app.catalogue === oldModel && !!app.renderer.render()));
      }
    }
    assert.deepEqual(errors, []);
    return result;
  } finally { await page.close(); }
}

async function data(browser, base) {
  const { page, errors } = await boot(browser, base);
  const requests = [];
  page.on('request', r => { if (/\/fixtures\//.test(r.url())) requests.push(r.url()); });
  try {
    // The empty visible population is valid even when future records are retained.
    for (const id of ['three', 'pixi']) {
      assert(await page.evaluate(async id => {
        app.jed = 0; app.renderFrame();
        return await app.switchRenderer(id) && app.jed === 0 && app.asteroidsDiscovered === 0 && !!app.catalogue.count;
      }, id));
    }
    for (const mode of ['indexed', 'whole']) {
      await page.evaluate(async ({ mode, pin, base }) => {
        app.jed = 2451544.499999; app.renderFrame();
        await app.loadCatalog({ ...pin, url: base + '/fixtures/ties/index.json' }, { mode });
      }, { mode, pin: cases.bundles.ties.pin, base });
      await page.waitForFunction(() => app.activeSession && !app.pendingSession && app.catalogLoader.sceneComplete());
      const fetched = requests.length;
      for (const id of ['three', 'pixi']) {
        assert(await page.evaluate(async id => {
          const model = app.catalogue, source = app.catalogLoader.source, count = app.asteroidsDiscovered;
          const success = await app.switchRenderer(id);
          return success && app.catalogue === model && app.catalogLoader.source === source
            && app.asteroidsDiscovered === count && app.catalogLoader.sceneComplete();
        }, id));
      }
      assert.equal(requests.length, fetched, mode + ' switch does not refetch');
      await page.evaluate(() => { app.jed = 2451544.5; });
      await page.waitForFunction(() => app.jed === 2451544.5 && app.asteroidsDiscovered === 4);
      await page.evaluate(() => app.switchRenderer('three'));
      assert.equal(await page.evaluate(() => app.asteroidsDiscovered), 4, 'Equal-date ties survive');
      await page.evaluate(() => { app.jed = 0; });
      await page.waitForFunction(() => app.jed === 0 && app.asteroidsDiscovered === 0);
      assert(await page.evaluate(() => app.switchRenderer('pixi')), 'Retained indexed empty draw succeeds');
    }
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.oldModel = app.catalogue;
      window.pending = app.switchRenderer('three');
    });
    await page.waitForFunction(() => app.switchCandidate?.initialized);
    await page.evaluate(async ({ pin, base }) => {
      app.jed = 2451544.5;
      await app.loadCatalog({ ...pin, url: base + '/fixtures/ties/index.json' });
    }, { pin: cases.bundles.ties.pin, base });
    await page.waitForFunction(() => app.pendingSession?.model?.count >= 4);
    assert(await page.evaluate(() => app.catalogue === oldModel && app.jed === 0));
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.evaluate(() => pending);
    await page.waitForFunction(() => app.catalogue !== oldModel && app.jed === 2451544.5 && app.asteroidsDiscovered === 4);
    await page.evaluate(() => app.switchRenderer('pixi'));
    // A source replacement and bundled candidate can finish while code is loading.
    assert(await page.evaluate(async () => {
      const load = app.rendererRegistry.three.load, model = app.catalogue;
      let release;
      app.rendererRegistry.three.load = () => new Promise(resolve => { release = async () => resolve(await load()); });
      const pending = app.switchRenderer('three');
      while (!release) await new Promise(resolve => setTimeout(resolve, 0));
      const rows = await (await fetch('data/catalog.json')).json();
      const result = app.setAsteroids(rows);
      if (result || app.catalogue !== model || !app.pendingBundled) throw new Error('No bundled publication during switch');
      app.tick(); app.renderFrame();
      if (app.catalogue !== model) throw new Error('Direct calls cannot publish candidate');
      release(); await pending;
      app.renderFrame();
      app.rendererRegistry.three.load = load;
      return app.catalogue !== model && app.catalogue.count === 100000 && !app.pendingBundled;
    }));
    assert.deepEqual(errors, []);
    return { modes: ['indexed', 'whole'], ties: true, zeroVisible: true, noRefetch: true, pendingBundled: true };
  } finally { await page.close(); }
}

async function options(browser, base, output, name) {
  const { page, errors } = await boot(browser, base);
  try {
    await page.evaluate(async () => {
      const App = app.constructor, registry = { ...app.rendererRegistry }, model = app.catalogue;
      const create = await registry.pixi.load();
      app.destroy();
      window.fixture = { mounts: 0, disposals: 0, changes: 0 };
      registry.fixture = { label: 'Fixture', defaults: { strength: 2 },
        validateOptions: values => Object.keys(values).length === 1 && Number.isFinite(values.strength) && values.strength >= 0 && values.strength <= 10,
        load: async () => options => {
          const renderer = create(options);
          renderer.setOptions = value => { renderer.fixtureStrength = value.renderer.strength; fixture.changes++; };
          return renderer;
        },
        buildOptions: ({ gui, values, setOptions, addHint }) => {
          fixture.mounts++;
          const control = gui.add(values, 'strength', 0, 10).name('Strength');
          const input = control.domElement.querySelector('input'); input.setAttribute('aria-label', 'Fixture strength');
          addHint(control, 'Fixture-only strength.', input);
          control.onChange(strength => setOptions({ strength }));
          const listener = () => { fixture.events = (fixture.events || 0) + 1; };
          window.addEventListener('fixture-event', listener);
          return () => { fixture.disposals++; window.removeEventListener('fixture-event', listener); };
        } };
      window.app = new App({ renderer: 'fixture', renderers: registry });
      await app.init(); app.jedDelta = 0;
      app.pendingBundled = { model, previous: { ...app.frameState, count: 0 } }; app.renderFrame();
      if (app.renderer.fixtureStrength !== 2) throw new Error('Initial defaults applied');
    });
    await page.getByRole('button', { name: 'Options', exact: true }).click();
    const strength = page.getByRole('textbox', { name: 'Fixture strength' });
    await strength.fill('7'); await strength.press('Enter');
    assert.equal(await page.evaluate(() => app.rendererOptions.fixture.strength), 7);
    assert.equal(await page.evaluate(() => app.renderer.fixtureStrength), 7);
    assert.equal(await page.getByRole('textbox', { name: 'Playback speed' }).inputValue(), '0');
    assert(await strength.evaluate(el => { const label = el.closest('li').querySelector('.property-name'); return label.scrollWidth <= label.clientWidth; }), 'Renderer-specific label fits');
    assert(await page.evaluate(() => {
      const before = fixture.changes;
      for (const bad of [{ strength: NaN }, { strength: -1 }, { unsupported: 1 }]) {
        let threw = false; try { app.setRendererOptions('fixture', bad); } catch { threw = true; }
        if (!threw) return false;
      }
      return fixture.changes === before && app.rendererOptions.fixture.strength === 7;
    }));
    await page.screenshot({ path: path.join(output, name + '-fixture-options.png') });
    await page.evaluate(() => app.switchRenderer('three'));
    assert.equal(await strength.count(), 0);
    assert(await page.evaluate(() => { window.dispatchEvent(new Event('fixture-event')); return !fixture.events && fixture.disposals === 1; }));
    // Hold a hidden candidate after init, then change its stored option.
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      window.pending = app.switchRenderer('fixture');
    });
    await page.waitForFunction(() => app.switchCandidate?.initialized);
    await page.evaluate(() => {
      app.setRendererOptions('fixture', { strength: 9 });
      Object.defineProperty(document, 'hidden', { configurable: true, value: false });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await page.evaluate(() => pending);
    assert.equal(await page.evaluate(() => app.renderer.fixtureStrength), 9);
    assert.equal(await strength.inputValue(), '9');
    assert.equal(await page.evaluate(() => app.rendererOptions.three.strength), undefined);
    await page.evaluate(() => app.destroy());
    assert.equal(await page.evaluate(() => fixture.disposals), 2);
    assert(await page.evaluate(async () => {
      const registry = { ...app.rendererRegistry, fixture: { ...app.rendererRegistry.fixture,
        buildOptions: ({ gui, values }) => { gui.add(values, 'strength'); throw new Error('controlled builder failure'); } } };
      const failed = new app.constructor({ renderer: 'fixture', renderers: registry });
      try { await failed.init(); } catch { /* Initial control construction fails. */ }
      const clean = failed.destroyed && !document.querySelector('canvas, .orrery-options');
      failed.destroy(); return clean;
    }), 'Initial builder failure cleans partial UI and graphics');
    assert.deepEqual(errors, []);
    return { defaults: true, validation: true, isolation: true, teardown: true, hiddenMutation: true };
  } finally { await page.close(); }
}

async function network(browser, base, output, name) {
  const results = [];
  for (const prefix of ['', '/Orrery']) {
    const { page, errors } = await boot(browser, base);
    try {
      // A genuinely cold engine chunk fails while the production selector is used.
      let releaseChunk;
      await page.route('**/assets/three.*.js', async route => {
        await new Promise(resolve => { releaseChunk = resolve; });
        await route.fulfill({ status: 503, body: 'controlled missing chunk' });
      });
      await page.setViewportSize({ width: 320, height: 568 });
      await page.goto(base + prefix + '/next/');
      await page.evaluate(() => threeTest.ready);
      await page.evaluate(() => { window.app = threeTest.app; app.jedDelta = 0; window.outgoing = app.renderer; });
      await page.getByRole('button', { name: 'Options', exact: true }).click();
      await page.getByRole('combobox', { name: 'Renderer', exact: true }).selectOption('three');
      await page.waitForFunction(() => app.switching === 'loading');
      assert(await page.getByRole('combobox', { name: 'Renderer', exact: true }).isDisabled());
      const frozen = await page.evaluate(() => ({ jed: app.jed, count: app.asteroidsDiscovered, scale: app.renderer.stage.scale.x }));
      await page.mouse.move(100, 400); await page.mouse.wheel(0, -100);
      await page.waitForFunction(scale => app.renderer.stage.scale.x !== scale, frozen.scale);
      assert.deepEqual(await page.evaluate(() => ({ jed: app.jed, count: app.asteroidsDiscovered })), { jed: frozen.jed, count: frozen.count });
      await page.screenshot({ path: path.join(output, `${name}-${prefix ? 'pages' : 'root'}-switch-loading.png`) });
      releaseChunk();
      await page.waitForFunction(() => !!app.switchError && !app.switching);
      const box = await page.locator('#orrery-status').boundingBox();
      assert(box.x >= 0 && box.x + box.width <= 320 && box.y + box.height <= 568);
      await page.screenshot({ path: path.join(output, `${name}-${prefix ? 'pages' : 'root'}-switch-error.png`) });
      assert(await page.evaluate(() => app.renderer === outgoing && !outgoing.destroyed && app.rendererId === 'pixi'));
      await page.unroute('**/assets/three.*.js');
      await page.getByRole('combobox', { name: 'Renderer', exact: true }).selectOption('three');
      await page.waitForFunction(() => app.rendererId === 'three' && !app.switching);
      assert.equal(new URL(page.url()).search, '', 'Selection is page-local, with no navigation');
      await page.reload(); await page.evaluate(() => threeTest.ready);
      assert.equal(await page.evaluate(() => threeTest.app.rendererId), 'pixi', 'Reload uses entry default');
      const expectedDiagnostics = errors.filter(message => /Failed to load resource.*503/.test(message));
      results.push({ prefix, coldChunkRecovery: true, reloadDefault: true, expectedDiagnostics });
      assert.deepEqual(errors.filter(message => !expectedDiagnostics.includes(message)), []);
    } finally { await page.close(); }
  }
  // A tied-date required read remains current while graphics switch around it.
  const { page, errors } = await boot(browser, base);
  let release, received;
  const requested = new Promise(resolve => { received = resolve; });
  try {
    await page.evaluate(async ({ pin, base }) => {
      app.jed = 2451544.499999; app.renderFrame();
      await app.loadCatalog({ ...pin, url: base + '/fixtures/ties/index.json' });
    }, { pin: cases.bundles.ties.pin, base });
    await page.waitForFunction(() => app.activeSession && !app.pendingSession && app.catalogLoader.sceneComplete());
    await page.route('**/chunks/000001.json', async route => {
      received(); await new Promise(resolve => { release = resolve; }); await route.continue();
    });
    await page.evaluate(() => { app.jed = 2451544.5; });
    await requested;
    assert(await page.evaluate(async () => {
      const before = app.jed, count = app.asteroidsDiscovered, model = app.catalogue;
      return await app.switchRenderer('three') && app.catalogue === model && app.jed === before
        && app.asteroidsDiscovered === count && app.requestedJed === 2451544.5;
    }));
    release();
    await page.waitForFunction(() => app.jed === 2451544.5 && app.asteroidsDiscovered === 4 && app.catalogLoader.sceneComplete());
    assert.deepEqual(errors, []);
    results.push({ bufferedSwitch: true, tiedReadCompletion: true });
  } finally { release?.(); await page.close(); }
  return results;
}

const parts = { state, failures, lifecycle, data, options, network };
async function run({ browser, name, output = path.resolve('.context/pr5/browser', name), part = 'state' }) {
  await fs.mkdir(output, { recursive: true });
  const site = output + '-site';
  await fs.rm(site, { recursive: true, force: true });
  if (process.env.ORRERY_PREBUILT_FIXTURES) require('./fixture-builds.cjs').copyPrepared('three', site);
  else await require('./three-build.cjs').build(site);
  await fs.cp(path.resolve('tests/fixtures/consumer-v1'), path.join(site, 'fixtures'), { recursive: true });
  await fs.symlink(site, path.join(site, 'Orrery'), 'dir');
  const server = await serve(site);
  try {
    const result = await parts[part](browser, server.url, output, name);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ name, part, result }, null, 2));
    console.log(`${name}: switching ${part} passed.`);
  } finally { await server.close(); }
}
module.exports = { run };
if (require.main === module) require('./standalone.cjs').run(options => run({ ...options, part: process.env.SWITCH_PART || 'state' }));
