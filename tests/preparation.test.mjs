import test from "node:test";
import assert from "node:assert/strict";
import { prepareOrbits, REFERENCE_JED, REBASE_DAYS, wrap } from "../src/js/asteroidOrbits.js";

const sample = { a: 2, e: 0.2, i: 10, W: 25, w: 40, M: 80, n: 0.3, epoch: REFERENCE_JED - 123, disc: REFERENCE_JED };
const arrays = packed => Object.values(packed).filter(ArrayBuffer.isView);

test("catalogue failures identify original rows when discovery sorting moves them", () => {
  for (const [patch, message] of [[{ e: 1 }, "Invalid elliptical orbit"], [{ a: 1e40 }, "Orbit exceeds rendering precision"],
    [{ n: 300 }, "Orbit exceeds rendering precision"], [{ n: null, P: 1e-37 }, "Orbit exceeds rendering precision"]]) {
    for (const [sourceIndex, disc] of [[0, REFERENCE_JED + 1], [2, REFERENCE_JED - 1]]) {
      const records = [sample, sample, sample];
      records[sourceIndex] = { ...sample, ...patch, disc };
      assert.throws(() => prepareOrbits(records, REFERENCE_JED), { message: `${message} at catalogue entry ${sourceIndex + 1}.` });
    }
  }
});

test("preparation owns stable sorted buffers and records their packing epoch", () => {
  const nested = Object.freeze({ notes: Object.freeze(["unchanged"]) });
  const records = Object.freeze([
    Object.freeze({ ...sample, a: 3, disc: REFERENCE_JED + 0.125, nested }),
    Object.freeze({ ...sample, a: 1, nested }), Object.freeze({ ...sample, a: 2, nested }),
  ]);
  const before = structuredClone(records);
  const results = [REFERENCE_JED - REBASE_DAYS - 0.125, REFERENCE_JED, REFERENCE_JED + REBASE_DAYS + 0.125]
    .map(jed => prepareOrbits(records, jed));
  for (const packed of results) {
    assert.deepEqual(Object.keys(packed).sort(), ["bases", "dates", "elements", "epoch", "meanAnomalies", "phases", "radius"], "No input records retained in the payload");
    assert.equal(arrays(packed).length, 5);
    assert.equal(arrays(packed).reduce((bytes, array) => bytes + array.byteLength, 0), records.length * 52);
    assert.equal(packed.radius, 360);
    assert.deepEqual([...packed.dates], [REFERENCE_JED, REFERENCE_JED, REFERENCE_JED + 0.125]);
    const ordered = [records[1], records[2], records[0]];
    ordered.forEach((record, i) => {
      const single = prepareOrbits([record], packed.epoch);
      assert.deepEqual(packed.bases.slice(i * 4, i * 4 + 4), single.bases, "Stable order for equal discovery dates");
      const n = record.n * Math.PI / 180;
      const mean = wrap(record.M * Math.PI / 180 + n * (REFERENCE_JED - record.epoch));
      assert.equal(packed.phases[i * 2], mean, "Canonical phase uses the reference date, not the packing/source epoch");
      assert.equal(packed.meanAnomalies[i], Math.fround(wrap(mean + n * (packed.epoch - REFERENCE_JED))));
    });
  }
  assert.deepEqual(results.map(packed => packed.epoch), [REFERENCE_JED - REBASE_DAYS - 0.125, REFERENCE_JED, REFERENCE_JED + REBASE_DAYS + 0.125]);
  const buffers = results.flatMap(packed => arrays(packed).map(array => array.buffer));
  assert.equal(new Set(buffers).size, 15, "Each array and result owns independent storage");
  const snapshot = structuredClone(results[1]);
  for (const array of arrays(results[0])) array.fill(0);
  results[0].epoch = 0;
  assert.deepEqual(results[1], snapshot);
  assert.deepEqual(records, before, "Input array, records and nested values remain unchanged");
});

test("pure preparation supports clone and transfer without sharing or retaining source buffers", () => {
  for (const records of [[], [sample]]) {
    const source = prepareOrbits(records, REFERENCE_JED + 17.125);
    const cloned = structuredClone(source);
    assert.deepEqual(cloned, source);
    arrays(source).forEach((array, i) => assert.notStrictEqual(array.buffer, arrays(cloned)[i].buffer));
    const transferred = structuredClone(source, { transfer: arrays(source).map(array => array.buffer) });
    assert(arrays(source).every(array => array.byteLength === 0), "Transfer detaches every sending buffer");
    assert.deepEqual(transferred, cloned);
    assert.equal(transferred.epoch, REFERENCE_JED + 17.125);
    if (!records.length) assert.equal(transferred.radius, 0);
  }
});
