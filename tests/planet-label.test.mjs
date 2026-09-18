import test from "node:test";
import assert from "node:assert/strict";
import PlanetLabel, { DEFAULT_PLANET_LABEL_MODE, PlanetLabels, PLANET_LABEL_STORAGE_KEY,
  isPlanetLabelMode, loadPlanetLabelMode, planetLabelColor, planetLabelModeShows,
  savePlanetLabelMode } from "../src/unified/PlanetLabel.js";
import PixiRenderer from "../src/unified/pixi/PixiRenderer.js";
import ThreeRenderer from "../src/unified/three/ThreeRenderer.js";

function fixture() {
  const elements = [];
  const container = {
    ownerDocument: { createElement(tag) {
      assert.equal(tag, "span");
      const attributes = new Map(), element = {
        dataset: {}, style: {}, hidden: false, removed: 0,
        setAttribute(name, value) { attributes.set(name, value); },
        getAttribute(name) { return attributes.get(name); },
        remove() { this.removed++; },
      };
      elements.push(element);
      return element;
    } },
    appendChild(child) { this.children ??= []; this.children.push(child); },
  };
  return { container, elements };
}

test("Earth label is a presentation-only overlay with bounded edge placement", () => {
  const { container, elements } = fixture();
  const label = new PlanetLabel(container, "Earth", 0x98c0ff);
  const [element] = elements;
  assert.strictEqual(container.children[0], element);
  assert.equal(element.className, "orrery-planet-label");
  assert.equal(element.textContent, "Earth");
  assert.equal(element.dataset.planet, "Earth");
  assert.equal(element.style.color, "#98c0ff");
  assert.equal(element.getAttribute("aria-hidden"), "true");
  assert.equal(element.hidden, true);

  label.place(120.5, 1, { width: 200, height: 100 });
  assert.equal(element.hidden, false);
  assert.deepEqual(element.style, { color: "#98c0ff", left: "120.5px", top: "8px" });
  assert.equal(element.dataset.side, "right");

  label.place(190, 99, { width: 200, height: 100 });
  assert.equal(element.style.top, "92px");
  assert.equal(element.dataset.side, "left");

  for (const [x, y, viewport] of [
    [-1, 20, { width: 200, height: 100 }],
    [20, 101, { width: 200, height: 100 }],
    [NaN, 20, { width: 200, height: 100 }],
    [20, 20, { width: 0, height: 100 }],
    [20, 20, { width: 200, height: 100, visible: false }],
  ]) {
    label.place(x, y, viewport);
    assert.equal(element.hidden, true);
  }
  label.hide();
  assert.equal(element.hidden, true);
  label.destroy();
  assert.equal(element.removed, 1);
});

test("label modes create only their requested planets and cleanly replace the active set", () => {
  const { container, elements } = fixture();
  const planets = ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn"]
    .map((name, index) => ({ options: { name, color: index } }));
  const labels = new PlanetLabels(container);
  labels.setMode(planets, "earth");
  assert.deepEqual([...labels.labels.keys()], [planets[2]]);
  assert.equal(elements[0].textContent, "Earth");
  assert.equal(elements[0].style.color, "#000002");
  const earthElement = elements[0];

  labels.setMode(planets, "all");
  assert.equal(labels.labels.size, 6);
  assert.strictEqual(labels.labels.get(planets[2]).element, earthElement);
  assert.deepEqual([...labels.labels.values()].map(label => label.element.textContent),
    ["Earth", "Mercury", "Venus", "Mars", "Jupiter", "Saturn"]);
  labels.hide();
  assert([...labels.labels.values()].every(label => label.element.hidden));

  labels.setMode(planets, "off");
  assert.equal(labels.labels.size, 0);
  assert(elements.every(element => element.removed === 1));
  assert.throws(() => labels.setMode(planets, "selected"), RangeError);
  labels.destroy();
});

test("planet label colors use complete CSS hex values and reject invalid inputs", () => {
  assert.equal(planetLabelColor(0x98c0ff), "#98c0ff");
  assert.equal(planetLabelColor(0x42), "#000042");
  for (const color of [-1, 0x1000000, 1.5, "98c0ff", undefined]) {
    assert.equal(planetLabelColor(color), null);
  }
});

test("label preference defaults, validates and survives unavailable storage", () => {
  const values = new Map(), scope = { localStorage: {
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  } };
  assert.equal(DEFAULT_PLANET_LABEL_MODE, "earth");
  assert.deepEqual(["off", "earth", "all", "selected"].map(isPlanetLabelMode), [true, true, true, false]);
  assert.equal(planetLabelModeShows("earth", "Earth"), true);
  assert.equal(planetLabelModeShows("earth", "Mars"), false);
  assert.equal(planetLabelModeShows("all", "Mars"), true);
  assert.equal(loadPlanetLabelMode(scope), "earth");
  assert.equal(savePlanetLabelMode("all", scope), true);
  assert.equal(values.get(PLANET_LABEL_STORAGE_KEY), "all");
  assert.equal(loadPlanetLabelMode(scope), "all");
  values.set(PLANET_LABEL_STORAGE_KEY, "selected");
  assert.equal(loadPlanetLabelMode(scope), "earth");
  assert.equal(savePlanetLabelMode("selected", scope), false);
  assert.equal(savePlanetLabelMode("off", {}), false);
  const blocked = { get localStorage() { throw new Error("blocked"); } };
  assert.equal(loadPlanetLabelMode(blocked), "earth");
  assert.equal(savePlanetLabelMode("off", blocked), false);
});

test("both renderers apply shared label modes without reacting to unrelated shared options", () => {
  for (const Renderer of [PixiRenderer, ThreeRenderer]) {
    const planets = [{ options: { name: "Earth" } }], calls = [], receiver = {
      planetLabelMode: "earth", planets,
      planetLabels: { setMode(...args) { calls.push(args); } },
      requestRender() { calls.push("render"); },
    };
    Renderer.prototype.setOptions.call(receiver, { shared: { pixelRatio: "2" } });
    assert.deepEqual(calls, []);
    Renderer.prototype.setOptions.call(receiver, { shared: { planetLabels: "all" } });
    assert.equal(receiver.planetLabelMode, "all");
    assert.deepEqual(calls, [[planets, "all"], "render"]);
    Renderer.prototype.setOptions.call(receiver, { shared: { planetLabels: "all" } });
    assert.equal(calls.length, 2, "Applying the active mode is inert");
    assert.throws(() => Renderer.prototype.setOptions.call(receiver,
      { shared: { planetLabels: "selected" } }), RangeError);
    assert.equal(receiver.planetLabelMode, "all");
  }
});

test("Pixi accepts label changes before asynchronous scene initialization", () => {
  const { container } = fixture();
  let renders = 0;
  const renderer = new PixiRenderer({ container,
    invalidate() { renders++; },
    reportGraphicsState() {},
    getViewport() { return { width: 640, height: 480, pixelRatio: 1 }; },
  });
  assert.deepEqual(renderer.planets, []);
  renderer.setOptions({ shared: { planetLabels: "all" } });
  assert.equal(renderer.planetLabelMode, "all");
  assert.equal(renderer.planetLabels.labels.size, 0);
  assert.equal(renders, 1);
  renderer.destroy();
});

test("Pixi projects every active label through the complete stage transform", () => {
  let placement;
  const planet = { body: { x: 3, y: 5 } }, label = { place(...args) { placement = args; } };
  PixiRenderer.prototype.placePlanetLabels.call({
    planetLabels: { forEach(callback) { callback(planet, label); } },
    stage: { worldTransform: { a: 2, b: 1, c: -1, d: 4, tx: 100, ty: 200 } },
    viewport: { width: 640, height: 480, pixelRatio: 2 },
  });
  assert.deepEqual(placement, [101, 223, { width: 640, height: 480, pixelRatio: 2 }]);
});

test("Three projects every active label to CSS pixels and rejects clipped depth", () => {
  const planet = { body: { position: { marker: "planet" } } }, camera = { marker: "camera" };
  const position = {
    x: 0.5, y: -0.25, z: 0.75,
    copy(value) { assert.strictEqual(value, planet.body.position); return this; },
    project(value) { assert.strictEqual(value, camera); return this; },
  };
  const placements = [], label = { place(...args) { placements.push(args); } }, receiver = {
    planetLabels: { forEach(callback) { callback(planet, label); } },
    planetLabelPosition: position, camera,
    viewport: { width: 400, height: 200 },
  };
  ThreeRenderer.prototype.placePlanetLabels.call(receiver);
  assert.deepEqual(placements[0], [300, 125, { width: 400, height: 200, visible: true }]);
  position.z = 2;
  ThreeRenderer.prototype.placePlanetLabels.call(receiver);
  assert.deepEqual(placements[1], [300, 125, { width: 400, height: 200, visible: false }]);
});
