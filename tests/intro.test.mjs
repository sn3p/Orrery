import test from "node:test";
import assert from "node:assert/strict";
import Intro from "../src/unified/ui/Intro.js";
import switchRenderer from "../src/unified/switchRenderer.js";

const settle = () => new Promise(resolve => setImmediate(resolve));

function fixture({ renderer = {}, rendererId = "pixi", remembered = false } = {}) {
  const storage = new Map(remembered ? [["orrery.intro", "seen"]] : []), elements = {};
  class Element {
    constructor(id) {
      this.id = id;
      this.open = false;
      this.disabled = false;
      this.dataset = {};
      this.attributes = new Map();
      this.listeners = new Map();
    }
    addEventListener(type, listener) { this.listeners.set(type, listener); }
    removeEventListener(type, listener) { if (this.listeners.get(type) === listener) this.listeners.delete(type); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    showModal() { this.open = true; }
    close(value = "") {
      this.open = false;
      this.returnValue = value;
      this.listeners.get("close")?.({ currentTarget: this, target: this });
    }
    click() { this.listeners.get("click")?.({ currentTarget: this, target: this }); }
    querySelectorAll() { return this.rendererActions ?? []; }
  }
  for (const id of ["orrery-intro", "orrery-about", "orrery-intro-date", "orrery-intro-options",
    "orrery-intro-renderers", "intro-2d", "intro-3d"]) elements[id] = new Element(id);
  elements["intro-2d"].dataset.renderer = "pixi";
  elements["intro-3d"].dataset.renderer = "three";
  elements["orrery-intro"].rendererActions = [elements["intro-2d"], elements["intro-3d"]];
  const order = [], rendererStateObservers = new Set(), app = {
    rendererRegistry: { pixi: {}, three: {} },
    rendererId,
    renderer,
    initialized: true,
    destroyed: false,
    switching: null,
    holds: [],
    hold(value) { this.holds.push(value); order.push(`hold:${value}`); },
    init() { return Promise.resolve(); },
    observeRendererState(observer) {
      rendererStateObservers.add(observer);
      return () => rendererStateObservers.delete(observer);
    },
    notifyRendererState() { for (const observer of rendererStateObservers) observer(); },
    gui: {
      timeline: { open() { order.push("date"); app.hold(true); } },
      controls: { open() { order.push("options"); } },
    },
    async switchRenderer(id) {
      order.push(`renderer:${id}`);
      this.rendererId = id;
      this.renderer = {};
      return true;
    },
  };
  const document = { getElementById: id => elements[id] ?? null };
  const localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  return { app, document, elements, localStorage, order, storage, rendererStateObservers };
}

async function withFixture(options, run) {
  const originalDocument = globalThis.document, originalStorage = globalThis.localStorage;
  const value = fixture(options);
  globalThis.document = value.document;
  globalThis.localStorage = value.localStorage;
  try { await run(value); }
  finally {
    if (originalDocument === undefined) delete globalThis.document; else globalThis.document = originalDocument;
    if (originalStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = originalStorage;
  }
}

test("intro releases its hold before handing off to date and options controls", async () => {
  await withFixture({}, async ({ app, elements, order, storage }) => {
    const intro = new Intro(app);
    assert.equal(elements["orrery-intro"].open, true);
    elements["orrery-intro-date"].click();
    await settle();
    assert.deepEqual(order, ["hold:true", "hold:false", "date", "hold:true"]);
    assert.equal(storage.get("orrery.intro"), "seen");
    intro.destroy();
  });

  await withFixture({}, async ({ app, elements, order }) => {
    const intro = new Intro(app);
    elements["orrery-intro-options"].click();
    await settle();
    assert.deepEqual(order, ["hold:true", "hold:false", "options"]);
    intro.destroy();
  });
});

test("renderer shortcuts stay actionable, recover missing graphics and follow external switching", async () => {
  await withFixture({}, async ({ app, elements, order }) => {
    const intro = new Intro(app);
    const twoD = elements["intro-2d"], threeD = elements["intro-3d"];
    assert.equal(twoD.getAttribute("aria-pressed"), "true");
    assert.equal(twoD.disabled, false);
    assert.equal(threeD.disabled, false);
    twoD.click();
    await settle();
    assert.equal(elements["orrery-intro"].open, false);
    assert.deepEqual(order, ["hold:true", "hold:false"],
      "Choosing the current renderer closes the card without rebuilding it");
    intro.destroy();
  });

  await withFixture({ renderer: null }, async ({ app, elements, order }) => {
    const intro = new Intro(app);
    const twoD = elements["intro-2d"], threeD = elements["intro-3d"];
    assert.equal(twoD.getAttribute("aria-pressed"), "false");
    assert.equal(twoD.disabled, false, "The selected renderer remains available when it needs rebuilding");
    assert.equal(threeD.disabled, false);
    twoD.click();
    await settle();
    assert(order.includes("renderer:pixi"));
    intro.open();
    assert.equal(twoD.getAttribute("aria-pressed"), "true");
    assert.equal(twoD.disabled, false);
    intro.destroy();
  });

  await withFixture({ remembered: true }, async ({ app, elements, rendererStateObservers }) => {
    let resolveSwitch;
    const pending = new Promise(resolve => { resolveSwitch = resolve; });
    const intro = new Intro(app);
    intro.open();
    const twoD = elements["intro-2d"], threeD = elements["intro-3d"];
    assert.equal(elements["orrery-intro-renderers"].getAttribute("aria-busy"), "false");

    // This switch begins elsewhere after the introduction is already open.
    app.switching = "loading";
    app.switchPromise = pending;
    app.notifyRendererState();
    assert.equal(elements["orrery-intro-renderers"].getAttribute("aria-busy"), "true");
    assert(twoD.disabled && threeD.disabled);

    app.rendererId = "three";
    app.renderer = {};
    app.switching = null;
    app.switchPromise = null;
    resolveSwitch();
    app.notifyRendererState();
    await settle();
    assert.equal(elements["orrery-intro-renderers"].getAttribute("aria-busy"), "false");
    assert.equal(threeD.getAttribute("aria-pressed"), "true");
    assert.equal(threeD.disabled, false);
    assert.equal(twoD.disabled, false);

    app.renderer = null;
    app.destroyed = true;
    intro.updateRendererActions();
    assert(twoD.disabled && threeD.disabled, "Terminal startup failure disables both shortcuts");
    assert(elements["orrery-intro-date"].disabled && elements["orrery-intro-options"].disabled,
      "Terminal startup failure disables controls that require the app GUI");
    assert.equal(twoD.getAttribute("aria-pressed"), "false");
    assert.equal(threeD.getAttribute("aria-pressed"), "false");
    intro.destroy();
    assert.equal(rendererStateObservers.size, 0, "Destroying Intro removes its renderer observer");
  });
});

test("renderer switching publishes its start and settled lifecycle", async () => {
  const states = [];
  const app = {
    rendererRegistry: { pixi: {} },
    rendererId: "pixi",
    renderer: {},
    destroyed: false,
    requestedRenderer: null,
    switchPromise: null,
    init: () => Promise.resolve(),
    notifyRendererState() { states.push(!!this.switchPromise); },
  };
  assert.equal(await switchRenderer(app, "pixi"), true);
  assert.deepEqual(states, [true, false]);

  const failedStates = [], failure = new Error("startup failed"), failed = {
    ...app,
    renderer: null,
    requestedRenderer: null,
    switchPromise: null,
    init: () => Promise.reject(failure),
    notifyRendererState() { failedStates.push(!!this.switchPromise); },
  };
  await assert.rejects(switchRenderer(failed, "pixi"), failure);
  assert.deepEqual(failedStates, [true, false]);
});
