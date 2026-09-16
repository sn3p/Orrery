import test from "node:test";
import assert from "node:assert/strict";
import { Texture } from "pixi.js";
import Orbit from "../src/unified/pixi/Orbit.js";
import Planet from "../src/unified/pixi/Planet.js";
import planets from "../src/js/planets.js";
import reference from "./cpu-reference.cjs";

const base = { a: 1, e: 0.2, i: 23, W: 45, wbar: 0, w: 12, M: 17, n: 1, P: 500, epoch: 2451545 };
function check(orbit, jed, target) {
  const expected = reference(orbit.ephemeris, jed);
  const actual = orbit.getPosAtTime(jed, target);
  assert(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-7);
  if (target) assert.strictEqual(actual, target);
  return actual;
}

test("warm real planet updates reuse fixed calculations and their existing particles", () => {
  const bodies = planets.map(p => new Planet({ ...p.ephemeris }, Texture.EMPTY));
  for (const p of bodies) p.render(base.epoch);
  const sqrt = Math.sqrt;
  let squareRoots = 0, reused = 0;
  for (const planet of bodies) {
    const fn = planet.orbit.getPosAtTime;
    planet.orbit.getPosAtTime = function(jed, output) {
      assert.strictEqual(output, planet.body, "Actual Planet.render supplies its owned particle");
      const result = fn.call(this, jed, output);
      assert.strictEqual(result, output); reused++;
      return result;
    };
  }
  try {
    Math.sqrt = value => { squareRoots++; return sqrt(value); };
    for (let frame = 0; frame < 100; frame++) for (const planet of bodies) planet.render(base.epoch + frame - 50);
  } finally { Math.sqrt = sqrt; }
  assert.equal(reused, 600); assert.equal(squareRoots, 0);
  for (const planet of bodies) {
    const expected = reference(planet.orbit.ephemeris, base.epoch + 49);
    assert(Math.hypot(planet.body.x - expected.x, planet.body.y - expected.y) < 1e-7);
  }
});

test("cached positions observe every element, input replacement and shared-input edits", () => {
  const input = { ...base }, first = new Orbit(input), second = new Orbit(input);
  const target = { x: 0, y: 0, untouched: 42 };
  const owned = check(first, base.epoch), saved = { ...owned };
  check(second, base.epoch);
  for (const patch of [{ a: 3 }, { e: 0.999999 }, { i: 81 }, { W: -123 },
    { wbar: 72 }, { wbar: undefined, w: 60 }, { w: 0 }, { M: -47 }, { n: 0.7 },
    { n: 0, P: 777 }, { P: 999 }, { epoch: 2450000 }]) {
    Object.assign(input, patch);
    for (const orbit of [first, second]) for (const jed of [2378861.5, 2451545, 2488070.5]) check(orbit, jed, target);
  }
  first.ephemeris = { ...base, e: 1 - Number.EPSILON, M: 180 };
  check(first, base.epoch, target); check(second, base.epoch);
  assert.notDeepEqual(first.getPosAtTime(base.epoch), second.getPosAtTime(base.epoch));
  assert.deepEqual(owned, saved); assert.equal(target.untouched, 42);
  assert.notStrictEqual(first.getPosAtTime(base.epoch), first.getPosAtTime(base.epoch));
});

test("invalid cached elements and dates leave caller output intact and recover after repair", () => {
  const orbit = new Orbit({ ...base }), target = { x: 12, y: 34 };
  const patches = [{ a: 0 }, { e: 1 }, { i: NaN }, { W: Infinity }, { wbar: "0" },
    { wbar: null, w: "1" }, { M: NaN }, { epoch: NaN }, { n: -1 }, { n: NaN },
    { n: 0, P: -1 }, { n: 0, P: "999" }, { a: Number.MAX_VALUE },
    { a: Number.MAX_VALUE / 150, e: 0.9, M: 180, W: 0, wbar: 0 }];
  for (const patch of patches) {
    orbit.ephemeris = { ...base }; check(orbit, base.epoch, target);
    const saved = { ...target };
    Object.assign(orbit.ephemeris, patch);
    for (let i = 0; i < 2; i++) assert.throws(() => orbit.getPosAtTime(base.epoch, target), RangeError);
    assert.deepEqual(target, saved);
    Object.assign(orbit.ephemeris, base); check(orbit, base.epoch, target);
  }
  const saved = { ...target };
  for (const date of [undefined, null, NaN, Infinity, "2451545", Number.MAX_VALUE]) {
    // The last finite date overflows mean anomaly only with a large valid n.
    orbit.ephemeris.n = 1000;
    assert.throws(() => orbit.getPosAtTime(date, target), RangeError);
    assert.deepEqual(target, saved);
  }
  orbit.ephemeris = null; assert.throws(() => orbit.getPosAtTime(base.epoch, target), RangeError);
  orbit.ephemeris = { ...base }; check(orbit, base.epoch, target);
});

test("ignored fallback values remain valid cache hits and period validation stays independent", () => {
  const orbit = new Orbit({ ...base, w: NaN, P: NaN });
  check(orbit, base.epoch);
  const sqrt = Math.sqrt;
  let calls = 0;
  try {
    Math.sqrt = value => { calls++; return sqrt(value); };
    for (let i = 0; i < 10; i++) orbit.getPosAtTime(base.epoch + i);
  } finally { Math.sqrt = sqrt; }
  assert.equal(calls, 0, "Object.is preserves cache hits for unused NaN fields");
  orbit.ephemeris.wbar = null; assert.throws(() => orbit.getPosAtTime(base.epoch), RangeError);
  orbit.ephemeris.w = 0; check(orbit, base.epoch);
  orbit.ephemeris.n = 0; assert.throws(() => orbit.getPosAtTime(base.epoch), RangeError);
  orbit.ephemeris.P = 999; check(orbit, base.epoch);
  for (const eph of [{ a: 1, n: 1 }, { a: 1, n: 0, P: 999 }]) {
    const partial = new Orbit(eph);
    assert.equal(partial.getPeriodInDays(), eph.n ? 360 : 999);
    assert.throws(() => partial.getPosAtTime(base.epoch), RangeError);
  }
  assert.doesNotThrow(() => new Orbit(null), "Constructor validation stays lazy");
});

test("track samples reuse prepared ellipse terms while preserving independent positions", () => {
  const orbit = new Orbit({ ...base }), sqrt = Math.sqrt;
  let calls = 0, line;
  try {
    Math.sqrt = value => { calls++; return sqrt(value); };
    line = orbit.drawOrbit(base.epoch);
  } finally { Math.sqrt = sqrt; }
  try {
    assert.equal(calls, 1, "Prepare the ellipse once for all track samples");
    const points = line.context.instructions[0].data.path.instructions;
    assert.equal(points.length, 361);
    assert.deepEqual(points[0].data, points.at(-1).data);
    for (let i = 0; i < 360; i++) {
      const expected = reference(orbit.ephemeris, base.epoch + i);
      assert(Math.hypot(points[i].data[0] - expected.x, points[i].data[1] - expected.y) < 1e-7);
    }
  } finally { line.destroy(); }
});
