import test from "node:test";
import assert from "node:assert/strict";
import Orbit from "../src/js/Orbit.js";
import planets from "../src/js/planets.js";
import reference from "./cpu-reference.cjs";

const base = { a: 1, e: 0, i: 0, W: 25, w: 10, wbar: 0, M: 0, n: 1, epoch: 2451545 };

function check(orbit, jed, label = "position") {
  const expected = reference(orbit.ephemeris, jed);
  const sin = Math.sin;
  let calls = 0, actual;
  try {
    // Fail deterministically instead of hanging when the old unbounded solve returns.
    Math.sin = value => {
      assert(++calls <= 128, "CPU solve exceeded its work budget");
      return sin(value);
    };
    actual = orbit.getPosAtTime(jed);
  } finally { Math.sin = sin; }
  const error = Math.hypot(actual.x - expected.x, actual.y - expected.y);
  assert(error <= Math.max(1, orbit.ephemeris.a * 100) * 1e-9,
    `${label}: ${error} world units from independent reference`);
  return calls;
}

test("CPU solver is bounded and accurate from circular to near-parabolic orbits", () => {
  let maxCalls = 0;
  const hard = { ...base, e: 0.999, M: 0.013823007675795088 * 180 / Math.PI };
  maxCalls = check(new Orbit(hard), base.epoch, "historical hard case");
  for (const e of [0, 0.0167, 0.8, 0.95, 0.999, 0.999999, 1 - Number.EPSILON]) {
    for (const M of [0, 1e-10, -1e-10, 0.1, -0.1, 1, 90, 180, -180, 359.99, -720.1]) {
      for (const offset of [0, 4097, -4097, 365250]) {
        maxCalls = Math.max(maxCalls, check(new Orbit({ ...base, e, M, i: 37, W: 123, wbar: 45 }),
          base.epoch + offset, `e=${e}, M=${M}, offset=${offset}`));
      }
    }
  }
  assert(maxCalls > 20, "Exercise the safeguarded solve beyond the Newton budget");
});

test("analytic apsides and all six planets preserve the 2D projection", () => {
  for (const e of [0, 0.8, 0.999999, 1 - Number.EPSILON]) {
    const orbit = new Orbit({ ...base, e, W: 0 });
    for (const [offset, x] of [[0, -100 * (1 - e)], [180, 100 * (1 + e)], [-180, 100 * (1 + e)]]) {
      const pos = orbit.getPosAtTime(base.epoch + offset);
      assert(Math.hypot(pos.x - x, pos.y) < 1e-10, `Analytic apsis e=${e}, offset=${offset}`);
    }
  }
  assert.equal(planets.length, 6);
  for (const planet of planets) for (const jed of [2378861.5, 2451545, 2488070.5]) {
    check(new Orbit(planet.ephemeris), jed, planet.name);
  }
});

test("selected longitude and mean motion retain their fallback and precedence rules", () => {
  for (const wbar of [0, null, undefined]) check(new Orbit({ ...base, wbar }), base.epoch);
  for (const w of [undefined, null, false, true, "0", {}, [], Infinity]) {
    check(new Orbit({ ...base, w }), base.epoch, "explicit longitude ignores unused fallback");
  }
  for (const wbar of [null, undefined]) check(new Orbit({ ...base, wbar, w: 0 }), base.epoch);
  for (const n of [undefined, null, 0, 0.7]) {
    check(new Orbit({ ...base, e: 0.3, n, P: 999 }), base.epoch - 4567);
  }
  for (const P of [undefined, null, "999", false, NaN, Infinity]) {
    check(new Orbit({ ...base, n: 0.7, P }), base.epoch + 789, "explicit mean motion ignores unused period");
  }
});

test("invalid or overflowing inputs are rejected by both positions and real Pixi tracks", () => {
  const malformed = [undefined, null, false, true, "0", "", NaN, Infinity, -Infinity, {}, []];
  const invalid = [null, undefined,
    ...[null, undefined].flatMap(wbar => malformed.map(w => ({ ...base, wbar, w }))),
    ...["a", "e", "i", "W", "M", "epoch"].flatMap(key => malformed.map(value => ({ ...base, [key]: value }))),
    ...malformed.filter(value => value != null).map(wbar => ({ ...base, wbar })),
    ...malformed.filter(value => value != null).map(n => ({ ...base, n, P: 360 })),
    ...malformed.map(P => ({ ...base, n: 0, P })),
    ...[{ a: 0 }, { a: -1 }, { e: -0.1 }, { e: 1 }, { e: 2 }, { n: -1 }, { n: 0 },
      { n: 0, P: 0 }, { n: null, P: -1 }, { n: Number.MIN_VALUE },
      { n: null, P: Number.MIN_VALUE }, { a: Number.MAX_VALUE },
      { wbar: null, w: Number.MAX_VALUE, W: Number.MAX_VALUE },
      { wbar: Number.MAX_VALUE, W: -Number.MAX_VALUE }].map(patch => ({ ...base, ...patch }))];
  const reject = (eph, jed) => {
    for (const method of ["getPosAtTime", "drawOrbit"]) {
      assert.throws(() => new Orbit(eph)[method](jed), RangeError, `${method} rejects malformed inputs`);
    }
  };
  invalid.forEach(eph => reject(eph, base.epoch));
  for (const jed of malformed.filter(value => value !== undefined)) reject(base, jed);
  assert.throws(() => new Orbit(base).getPosAtTime(undefined), RangeError);
  reject({ ...base, epoch: -Number.MAX_VALUE }, Number.MAX_VALUE);
  reject({ ...base, n: Number.MAX_VALUE }, base.epoch + 1e10);
  assert.throws(() => new Orbit({ ...base, n: 0, P: 1e308, epoch: 1e308 }).drawOrbit(1e308), RangeError,
    "A valid initial position does not hide overflowing later track samples");
  reject({ ...base, a: Number.MAX_VALUE / 150, e: 0.9, M: 180, W: 0 }, base.epoch);
  assert.throws(() => new Orbit({ ...base, n: 1e-308 }).drawOrbit(), RangeError, "Motion-derived track period overflow");
});

test("public ephemeris edits and replacement affect future calls without changing owned results", () => {
  const orbit = new Orbit({ ...base, e: 0.2 });
  const first = orbit.getPosAtTime(base.epoch), saved = { ...first };
  for (const patch of [{ M: 37 }, { e: 0.95 }, { a: 3 }, { i: 85 }, { W: -123 },
    { wbar: 0 }, { wbar: undefined, w: 60 }, { n: 0, P: 777 }, { epoch: 2450000 }]) {
    Object.assign(orbit.ephemeris, patch);
    check(orbit, base.epoch + 9876, `mutation ${JSON.stringify(patch)}`);
  }
  orbit.ephemeris = { ...base, e: 0.8, M: -45 };
  check(orbit, base.epoch, "replaced ephemeris");
  orbit.ephemeris.e = 1;
  assert.throws(() => orbit.getPosAtTime(base.epoch), RangeError);
  orbit.ephemeris.e = 0.5;
  check(orbit, base.epoch, "recovered mutation");
  assert.deepEqual(first, saved);
  assert.notStrictEqual(orbit.getPosAtTime(base.epoch), orbit.getPosAtTime(base.epoch));
});
