import { test } from 'node:test';
import ThreeAsteroids from '../src/unified/three/Asteroids.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { prepareCatalogue, allocateCatalogue, appendCatalogue } from '../src/unified/catalog/prepareCatalogue.js';
import { classifyOrbit } from '../src/unified/catalog/population.js';
import { prepareOrbits } from '../src/js/asteroidOrbits.js';

const rows = JSON.parse(fs.readFileSync(new URL('fixtures/consumer-v1/ties/full/catalog.json', import.meta.url)));
test('retained 3D catalogue reproduces exact legacy projection/phases and preserves source row diagnostics', () => {
  const data = [rows[5], rows[0], rows[2], rows[1], rows[3], rows[4]];
  const model = prepareCatalogue(data, 2451544.5), legacy = prepareOrbits(data, 2451544.5);
  for (let i = 0; i < data.length; i++) {
    assert.deepEqual([-model.p[i * 3], model.p[i * 3 + 1], -model.q[i * 3], model.q[i * 3 + 1]], [...legacy.bases.subarray(i * 4, i * 4 + 4)]);
    assert.equal(data[model.rows[i]].disc, model.dates[i]);
  }
  assert.deepEqual(model.phases, legacy.phases);
  assert.deepEqual(model.elements, legacy.elements);
  assert.deepEqual([...model.classes], [...model.rows].map(source => classifyOrbit(data[source].a, data[source].e, data[source].i)));
  assert(model.p.some((n, i) => i % 3 === 2 && n !== 0), 'Third dimension is retained independently of projection');
  const bad = structuredClone(data); bad[0].n = 1e30;
  assert.throws(() => prepareCatalogue(bad), /entry 1/);
});
test('a failed later batch cannot partially modify retained numeric data', () => {
  const model = allocateCatalogue(6);
  appendCatalogue(model, rows.slice(0, 2), 0);
  const before = structuredClone(model), invalid = structuredClone(rows.slice(2, 4));
  invalid[1].a = 1e300;
  assert.throws(() => appendCatalogue(model, invalid, 2), /entry 4/);
  assert.deepEqual(model, before);
  appendCatalogue(model, rows.slice(2), 2);
  const expected = prepareCatalogue(rows);
  assert.deepEqual(model, expected);
  assert(!Object.values(model).includes(rows), 'No source object graph retained');
});


test('Three retains a separate masked class without mutating canonical classes or duplicating other static arrays', () => {
  for (const suppressed of [false, true]) {
    const model = prepareCatalogue(rows);
    if (suppressed) model.suppressedRows = new Set([1]);
    const original = model.classes.slice();
    const cloud = new ThreeAsteroids(model, { jed: 2451544.5 });
    try {
      const attributes = cloud.geometry.attributes;
      assert.equal(attributes.position.array, model.p);
      assert.equal(attributes.basisQ.array, model.q);
      assert.equal(attributes.elements.array, model.elements);
      assert.notEqual(attributes.classId.array.buffer, model.classes.buffer);
      assert.equal(attributes.classId.array[1], suppressed ? 9 : original[1]);
      assert.deepEqual(model.classes, original);
      const arrays = Object.values(attributes).map(attribute => attribute.array);
      const retained = new Set([...Object.values(model).filter(ArrayBuffer.isView), ...arrays].map(array => array.buffer));
      assert.equal([...retained].reduce((bytes, buffer) => bytes + buffer.byteLength, 0), rows.length * 74);
      assert.equal(arrays.reduce((bytes, array) => bytes + array.byteLength, 0), rows.length * 45);
    } finally { cloud.destroy(); }
  }
});
