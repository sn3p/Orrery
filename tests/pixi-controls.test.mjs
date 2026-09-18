import test from "node:test";
import assert from "node:assert/strict";
import Controls from "../src/unified/pixi/Controls.js";

function fixture(options) {
  const listeners = new Map(), removed = new Map();
  const canvas = {
    captures: [],
    addEventListener(type, listener, config) { listeners.set(type, { listener, config }); },
    removeEventListener(type, listener) { removed.set(type, listener); },
    setPointerCapture(pointerId) { this.captures.push(pointerId); },
  };
  const scale = { x: 1, y: 1, set(value) { this.x = this.y = value; } };
  const orrery = { canvas, stage: { scale }, renders: 0, requestRender() { this.renders++; } };
  const controls = new Controls(orrery, options);
  return { controls, orrery, canvas, listeners, removed, scale };
}

function pointer(pointerId, clientY, overrides = {}) {
  return { pointerId, clientY, pointerType: "touch", prevented: false,
    preventDefault() { this.prevented = true; }, ...overrides };
}

test("wheel zoom keeps its existing direction and ignores horizontal-only input", () => {
  const { controls, orrery, listeners, removed, scale } = fixture();
  const horizontal = { deltaY: 0, preventDefault() { throw new Error("Horizontal input was cancelled"); } };
  controls.onScroll(horizontal);
  assert.equal(scale.x, 1);
  assert.equal(orrery.renders, 0);

  const vertical = { deltaY: -100, prevented: false, preventDefault() { this.prevented = true; } };
  controls.onScroll(vertical);
  assert.equal(vertical.prevented, true);
  assert.equal(scale.x, 1.04);
  assert.equal(orrery.renders, 1);
  assert.equal(listeners.get("wheel").config.passive, false);

  controls.destroy();
  for (const [type, { listener }] of listeners) assert.equal(removed.get(type), listener, `${type} listener removed`);
});

test("a one-finger vertical drag zooms down toward the scene and up away from it", () => {
  const { controls, orrery, canvas, scale } = fixture({ multiplier: 1.04, dragPixelsPerStep: 8 });
  const down = pointer(4, 100);
  controls.onPointerDown(down);
  assert.equal(down.prevented, true);
  assert.deepEqual(canvas.captures, [4]);

  const zoomIn = pointer(4, 180);
  controls.onPointerMove(zoomIn);
  assert.equal(zoomIn.prevented, true);
  assert(Math.abs(scale.x - 1.04 ** 10) < 1e-12);

  controls.onPointerMove(pointer(4, 100));
  assert(Math.abs(scale.x - 1) < 1e-12);
  assert.equal(orrery.renders, 2);

  controls.onPointerEnd(pointer(4, 100));
  controls.onPointerMove(pointer(4, 180));
  assert(Math.abs(scale.x - 1) < 1e-12, "Released touches cannot keep zooming");
});

test("mouse drags and multi-touch movement do not trigger Pixi zoom", () => {
  const { controls, orrery, scale } = fixture();
  controls.onPointerDown(pointer(1, 100, { pointerType: "mouse" }));
  controls.onPointerMove(pointer(1, 180, { pointerType: "mouse" }));
  assert.equal(scale.x, 1);

  controls.onPointerDown(pointer(2, 100));
  controls.onPointerDown(pointer(3, 100));
  controls.onPointerMove(pointer(2, 180));
  assert.equal(scale.x, 1, "A second finger cancels the drag gesture");
  assert.equal(orrery.renders, 0);
  controls.onPointerEnd(pointer(2, 180));
  controls.onPointerEnd(pointer(3, 100));

  controls.onPointerDown(pointer(5, 100));
  controls.onPointerMove(pointer(5, 108));
  assert.equal(scale.x, 1.04, "A new one-finger gesture starts normally");
});
