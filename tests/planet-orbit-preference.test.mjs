import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PLANET_ORBITS_VISIBLE, isPlanetOrbitVisibility } from "../src/unified/PlanetOrbitPreference.js";
import PixiRenderer from "../src/unified/pixi/PixiRenderer.js";
import ThreeRenderer from "../src/unified/three/ThreeRenderer.js";

test("planet orbit visibility defaults to shown and accepts only booleans", () => {
  assert.equal(DEFAULT_PLANET_ORBITS_VISIBLE, true);
  assert.deepEqual([true, false, "true", 1, null].map(isPlanetOrbitVisibility),
    [true, true, false, false, false]);
});

test("both renderers apply orbit visibility independently of other shared options", () => {
  for (const Renderer of [PixiRenderer, ThreeRenderer]) {
    const tracks = [{ visible: true }, { visible: true }], calls = [], receiver = {
      planetLabelMode: "earth",
      planetLabels: { setMode(...args) { calls.push(args); } },
      planets: [],
      planetOrbits: tracks,
      planetOrbitsVisible: true,
      requestRender() { calls.push("render"); },
    };
    Renderer.prototype.setOptions.call(receiver, { shared: { pixelRatio: "2" } });
    assert.deepEqual(calls, []);
    Renderer.prototype.setOptions.call(receiver, { shared: { planetOrbits: false } });
    assert.equal(receiver.planetOrbitsVisible, false);
    assert(tracks.every(track => track.visible === false));
    assert.deepEqual(calls, ["render"]);
    Renderer.prototype.setOptions.call(receiver, { shared: { planetOrbits: false } });
    assert.equal(calls.length, 1, "Applying active visibility is inert");
    assert.throws(() => Renderer.prototype.setOptions.call(receiver,
      { shared: { planetOrbits: "false" } }), RangeError);
    assert.equal(receiver.planetOrbitsVisible, false);
    assert.throws(() => Renderer.prototype.setOptions.call(receiver,
      { shared: { planetLabels: "all", planetOrbits: "false" } }), RangeError);
    assert.equal(receiver.planetLabelMode, "earth", "Invalid combined settings are rejected atomically");
  }
});

test("Pixi accepts orbit visibility changes before asynchronous scene initialization", () => {
  const renderer = new PixiRenderer({ container: { ownerDocument: {} },
    invalidate() {}, reportGraphicsState() {},
    getViewport() { return { width: 640, height: 480, pixelRatio: 1 }; } });
  assert.deepEqual(renderer.planetOrbits, []);
  renderer.setOptions({ shared: { planetOrbits: false } });
  assert.equal(renderer.planetOrbitsVisible, false);
  renderer.destroy();
});
