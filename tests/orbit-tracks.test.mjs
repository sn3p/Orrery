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

test("tracks reject dates below sampling resolution while accepting representable boundary steps", () => {
  const spacing = 2 ** -31; // Julian dates around J2000 have this double spacing.
  for (const jed of [2451545, 2451545 + spacing, -2451545, -2451545 - spacing]) {
    for (const motion of [{ n: 1e15 }, { n: 0, P: 1e-13 }, { n: 2 ** 32 }]) {
      const orbit = new Orbit({ ...base, ...motion, epoch: jed });
      assert(Number.isFinite(orbit.getPeriodInDays()), "The period alone remains valid");
      assert.throws(() => orbit.drawOrbit(jed), RangeError,
        "Every successive track date must advance, including half-spacing ties");
    }
    checkTrack(new Orbit({ ...base, n: 2 ** 31, epoch: jed }), jed);
  }
});


test("track resolution checks include relative epoch, initial phase and later spacing boundaries", () => {
  const boundary = 2 ** 21 - 2 ** -32;
  for (const [jed, patch] of [[0, { n: 1e15 }], [2451545, { M: 1e20 }],
    [boundary, { n: 2 ** 32, epoch: boundary }]]) {
    const orbit = new Orbit({ ...base, ...patch });
    assert(Number.isFinite(orbit.getPosAtTime(jed).x), "Initial position is representable");
    assert.throws(() => orbit.drawOrbit(jed), RangeError);
  }
  // Tiny periods remain supported where the actual date and phase can resolve
  // all samples. Projected duplicate coordinates are not themselves an error.
  checkTrack(new Orbit({ ...base, n: 1e15, epoch: 0 }), 0);
  checkTrack(new Orbit({ ...base, n: 1e15, epoch: -1e-12 }), -1e-12);
  checkTrack(new Orbit({ ...base, e: 0, i: 90, W: 0, wbar: 0, M: 0 }));
});
