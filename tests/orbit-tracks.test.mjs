import test from "node:test";
import assert from "node:assert/strict";
import Orbit from "../src/js/Orbit.js";
import planets from "../src/js/planets.js";
import reference from "./cpu-reference.cjs";

const base = { a: 1, e: 0.1, i: 23, W: 45, wbar: 0, M: 17, n: 1, epoch: 2451545 };

function checkTrack(orbit, jed = 2451545) {
  const line = orbit.drawOrbit(jed);
  try {
    const { path, style } = line.context.instructions[0].data;
    const points = path.instructions;
    assert.equal(points.length, 361);
    assert.equal(points[0].action, "moveTo");
    assert(points.slice(1).every(point => point.action === "lineTo"));
    assert.deepEqual(points.at(-1).data, points[0].data, "Repeat the first point exactly");
    assert.equal(style.width, 0.2); assert.equal(style.color, 0x555555);
    const eph = orbit.ephemeris, period = eph.n ? 360 / eph.n : eph.P;
    for (let i = 0; i < 360; i++) {
      const { x, y } = reference(eph, jed + period / 360 * i);
      assert(Math.hypot(points[i].data[0] - x, points[i].data[1] - y) < Math.max(1, eph.a * 100) * 1e-9,
        `Vertex ${i} starts at the requested date and follows the motion period`);
    }
  } finally { line.destroy(); }
}

test("real Pixi tracks close exactly and sample the moving planet's period from the requested date", () => {
  for (const { ephemeris } of planets) for (const jed of [2451545, 2378861.5, 2488070.5]) {
    checkTrack(new Orbit(ephemeris), jed);
  }
  for (const e of [0, 0.8, 0.999999, 1 - Number.EPSILON]) checkTrack(new Orbit({ ...base, e }));
});

test("track periods use the same n/P precedence and reject invalid selected motion", () => {
  for (const P of [undefined, null, 999, "999", false, NaN, Infinity]) {
    const orbit = new Orbit({ ...base, n: 0.7, P });
    assert.equal(orbit.getPeriodInDays(), 360 / 0.7);
    checkTrack(orbit);
  }
  for (const n of [undefined, null, 0]) {
    const orbit = new Orbit({ ...base, n, P: 999 });
    assert.equal(orbit.getPeriodInDays(), 999);
    checkTrack(orbit);
  }
  for (const eph of [null, { ...base, a: 0 }, { ...base, n: -1 }, { ...base, n: NaN },
    { ...base, n: "1" }, { ...base, n: 0 }, { ...base, n: null, P: -1 },
    { ...base, n: 1e-308 }, { ...base, n: Number.MIN_VALUE }]) {
    assert.throws(() => new Orbit(eph).getPeriodInDays(), RangeError);
  }
});

test("new tracks and periods observe public ephemeris edits, replacement and repair", () => {
  const orbit = new Orbit({ ...base });
  checkTrack(orbit);
  Object.assign(orbit.ephemeris, { n: 0, P: 777, M: -65 });
  assert.equal(orbit.getPeriodInDays(), 777); checkTrack(orbit);
  orbit.ephemeris = { ...base, n: 0.7, e: 0.8 };
  assert.equal(orbit.getPeriodInDays(), 360 / 0.7); checkTrack(orbit);
  orbit.ephemeris.n = NaN;
  assert.throws(() => orbit.drawOrbit(), RangeError);
  orbit.ephemeris.n = 2;
  assert.equal(orbit.getPeriodInDays(), 180); checkTrack(orbit);
});
