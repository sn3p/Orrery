import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { prepareOrbits, discoveryCount, REFERENCE_JED, REBASE_DAYS, MAX_PHASE_ADVANCE, validDate } from "../src/js/asteroidOrbits.js";
import PlaybackClock from "../src/js/PlaybackClock.js";

const sample = { a: 2, e: 0.2, i: 10, W: 25, w: 40, M: 80, n: 0.3, epoch: REFERENCE_JED, disc: REFERENCE_JED };
test("catalogue validation preserves zero longitudes and rejects malformed or unrepresentable data", () => {
  const packed = prepareOrbits([{ ...sample, wbar: 0 }], REFERENCE_JED);
  assert.deepEqual(packed.bases, prepareOrbits([{ ...sample, w: -25 }], REFERENCE_JED).bases);
  assert.deepEqual(prepareOrbits([{ ...sample, wbar: null }], REFERENCE_JED).bases, prepareOrbits([sample], REFERENCE_JED).bases);
  assert(prepareOrbits([{ ...sample, n: undefined, P: 100 }], REFERENCE_JED).elements[1] > 0);
  for (const data of [null, {}, new Array(1), [sample, , sample], [null], [undefined],
    ...[{ e: 1 }, { e: 1 - 1e-12 }, { e: -1 }, { a: 0 }, { a: 1e-100 }, { a: 1e100 }, { n: 1e-100 },
      { n: 0, P: 100 }, { n: -1 }, { n: NaN, P: 100 }, { disc: 1e100 }, { epoch: Infinity }, { M: undefined },
      ...["", "20", false, {}, NaN, Infinity].map(wbar => ({ wbar })),
      ...["", "20", false, {}, NaN, Infinity].map(n => ({ n, P: 100 }))].map(patch => [{ ...sample, ...patch }])]) {
    assert.throws(() => prepareOrbits(data, REFERENCE_JED));
  }
  assert.throws(() => prepareOrbits([sample], NaN));
  assert(!validDate(Infinity));
  assert(!validDate(1e100));
  assert.equal(prepareOrbits([], REFERENCE_JED).dates.length, 0);
});

test("real catalogue packs without mutation; discoveries are inclusive in both directions", () => {
  const catalog = JSON.parse(fs.readFileSync(new URL("../data/catalog.json", import.meta.url)));
  assert.equal(catalog.length, 100000);
  const original = JSON.stringify(catalog);
  const packed = prepareOrbits(catalog, REFERENCE_JED);
  assert.equal(JSON.stringify(catalog), original);
  for (const index of [0, 1000, 50000, 99999]) {
    const date = packed.dates[index];
    for (const jed of [date - 0.01, date, date + 0.01]) {
      assert.equal(discoveryCount(packed.dates, jed), catalog.filter(d => d.disc <= jed).length);
    }
  }
  assert.equal(discoveryCount(packed.dates, -1e6), 0);
  assert.equal(discoveryCount(packed.dates, 1e7), 100000);
});

test("motion and period fallbacks stay within the shader's full rebase interval", () => {
  const limit = MAX_PHASE_ADVANCE / REBASE_DAYS;
  for (const motion of [{ n: 1e40 }, { n: null, P: 1e-37 }]) {
    const n = motion.n == null ? 2 * Math.PI / motion.P : motion.n * Math.PI / 180;
    assert(Number.isFinite(Math.fround(n)), "The stored float alone used to pass validation");
    assert(!Number.isFinite(Math.fround(Math.fround(n) * REBASE_DAYS)));
    assert.throws(() => prepareOrbits([{ ...sample, ...motion }], REFERENCE_JED), /rendering precision/);
  }
  for (const fallback of [false, true]) {
    const motion = n => fallback ? { n: null, P: 2 * Math.PI / n } : { n: n * 180 / Math.PI };
    assert.equal(prepareOrbits([{ ...sample, ...motion(limit) }], REFERENCE_JED).elements[1], limit);
    assert.throws(() => prepareOrbits([{ ...sample, ...motion(limit * (1 + 1e-6)) }], REFERENCE_JED), /rendering precision/);
  }
});

test("elapsed playback, pause, reverse, invalid clocks and stall cap", () => {
  for (const hz of [30, 60, 120]) for (const speed of [0, 1.5, -1.5]) {
    const clock = new PlaybackClock();
    let days = clock.advance(0, speed), seconds = 0;
    for (let i = 1; i <= hz; i++) { days += clock.advance(i * 1000 / hz, speed); seconds += clock.seconds; }
    assert(Math.abs(days - speed * 60) < 1e-9);
    assert(Math.abs(seconds - (speed === 0 ? 0 : 1)) < 1e-9);
    clock.reset();
    assert.equal(clock.advance(1e8, speed), 0);
  }
  const clock = new PlaybackClock();
  clock.advance(0, 1);
  assert.equal(clock.advance(10000, 1), 15);
  assert.equal(clock.advance(9999, 1), 0);
  assert.equal(clock.advance(NaN, 1), 0);
  assert.equal(clock.advance(20000, 1), 0);
  assert.equal(clock.advance(20016, Infinity), 0);
});
