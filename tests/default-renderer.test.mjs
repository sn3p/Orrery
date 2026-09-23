import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RENDERER, renderers, selectRenderer } from "../src/unified/renderers.js";

test("Three.js is the public default and unknown ids fall back to it", () => {
  assert.equal(DEFAULT_RENDERER, "three");
  assert.equal(selectRenderer().id, "three");
  assert.equal(selectRenderer().notice, "");
  assert.equal(selectRenderer("pixi").id, "pixi");
  assert.equal(selectRenderer("pixi").notice, "");
  const unknown = selectRenderer("nope");
  assert.equal(unknown.id, "three");
  assert.equal(unknown.notice, "Unknown renderer. Showing Three.js.");
  const pixiOracle = selectRenderer("nope", undefined, "pixi");
  assert.equal(pixiOracle.id, "pixi");
  assert.equal(pixiOracle.notice, "Unknown renderer. Showing Pixi.");
});

test("Only Three.js needs WebGL2", () => {
  assert.equal(renderers.three.needsWebGL2, true);
  assert.equal(renderers.pixi.needsWebGL2, undefined);
});

test("Custom registries fall back to their first entry and name it by label", () => {
  const custom = { fixture: { label: "Fixture", load: async () => () => ({}) } };
  const fallback = selectRenderer("nope", custom);
  assert.equal(fallback.id, "fixture");
  assert.equal(fallback.notice, "Unknown renderer. Showing Fixture.");
});
