import test from 'node:test';
import { Vector3 } from 'three';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fixtureModule from './named-body-fixture.cjs';
import CatalogSource from '../src/unified/catalog/CatalogSource.js';
import { loadNamedBodies, namedPosition, validateNamedDefinitions } from '../src/unified/named/source/NamedBodySource.js';
import { namedOrbitPoints, presentBodies } from '../src/unified/named/model.js';
import { allocateCatalogue, appendCatalogue } from '../src/unified/catalog/prepareCatalogue.js';
import reference from './cpu-reference.cjs';
import ReferenceBodies from '../src/unified/named/ReferenceBodies.js';
import PixiOrbit from '../src/unified/pixi/NamedOrbit.js';
import ThreeOrbit from '../src/unified/three/NamedOrbit.js';

const data = fixtureModule.fixture();
const definitions = validateNamedDefinitions(data.definitions);

test('producer science covers all thirteen, with presentation keyed by identity', () => {
  const presented = presentBodies(definitions);
  assert.equal(presented.length, 13);
  assert.equal(presented.filter(b => b.classification === 'dwarf-planet').length, 5);
  assert(presented.every(b => b.namedBody.id === b.id && Number.isFinite(b.size) && Number.isInteger(b.color)));
  assert(Object.isFrozen(definitions.bodies[0].rates));
});

test('both real orbit adapters project producer positions and update closed tracks at each shape date', () => {
  for (const body of definitions.bodies) {
    const pixi = new PixiOrbit(body), three = new ThreeOrbit(body);
    const p = pixi.drawOrbit(2451545), t = three.drawOrbit(2451545);
    const distances = t.geometry.attributes.lineDistance, vertices = t.geometry.attributes.position;
    const path = p.context.instructions[0].data.path.instructions;
    try {
      for (const jd of [1000000, 2378496.5, 2451545, 2488069.5, 4000000]) {
        const expected = namedPosition(body, jd), a = pixi.getPosAtTime(jd), b = three.getPosAtTime(jd);
        assert.deepEqual([a.x, a.y], [-expected.position[0] * 100, expected.position[1] * 100]);
        assert.deepEqual(b, expected.position.map(x => x * 100));

        assert.equal(t.geometry.attributes.lineDistance, distances, "Moving tracks reuse their GPU attribute");
        assert.equal(t.geometry.attributes.position, vertices);
        assert.equal(vertices.version, 0, 'No per-frame vertex upload');
        assert.equal(distances.version, 0, 'No per-frame dash upload');
        assert.equal(p.context.instructions[0].data.path.instructions, path, 'No path rebuild');
        p.updateLocalTransform();
        const points = namedOrbitPoints(body, jd);
        assert.deepEqual(path[0].data, path.at(-1).data);
        for (let i = 0; i <= 360; i++) {
          const [x, y] = path[i].data, point = p.localTransform.apply({ x, y });
          assert(Math.hypot(point.x + points[3 * i], point.y - points[3 * i + 1]) < 1e-8);
          const spatial = new Vector3().fromBufferAttribute(vertices, i).applyMatrix4(t.matrix);
          assert(Math.hypot(...spatial.toArray().map((v, k) => v - points[3 * i + k])) < 0.001);
        }
      }
      assert.deepEqual(namedOrbitPoints(body, 1000000), namedOrbitPoints(body, 2378496.5));
      assert.deepEqual(namedOrbitPoints(body, 4000000), namedOrbitPoints(body, 2488069.5));
      for (const boundary of [2378496.5, 2488069.5]) {
        const before = namedPosition(body, boundary - 1e-5).position, after = namedPosition(body, boundary + 1e-5).position;
        assert(Math.hypot(...before.map((v, i) => v - after[i])) < 1e-5);
      }
    } finally { p.destroy(); t.geometry.dispose(); t.material.dispose(); }
  }
});

test('fitted positions agree with the independent bisection oracle and instantaneous ellipses', () => {
  for (const body of definitions.bodies) for (const jd of [1000000, 2378496.5, 2451545, 2488069.5, 4000000]) {
    const bounded = Math.max(2378496.5, Math.min(2488069.5, jd)), t = (bounded - 2451545) / 36525;
    const [a, e, i, W, w, mean] = body.elements.map((x, k) => x + t * body.rates[k]);
    const M = mean + body.rates[5] * (jd - bounded) / 36525;
    const expected = reference({ a, e, i, W, w, M, epoch: jd, P: 360 }, jd);
    const actual = namedPosition(body, jd).position;
    assert(Math.hypot(actual[0] * 100 + expected.x, actual[1] * 100 - expected.y) < 1e-7);
    const points = namedOrbitPoints(body, jd);
    // A point halfway around the same ellipse is separated by 2a.
    assert(Math.abs(Math.hypot(...[0, 1, 2].map(k => points[k] - points[540 + k])) - 200 * a) < 1e-9);
  }
});

test('verified pairing rejects wrong generations, corrupted bytes, closed sources and cancellation', async () => {
  const original = globalThis.fetch;
  let changed = false;
  globalThis.fetch = async url => new Response(changed && url === data.namedBodies.url ? '{}' : data.files.get(url));
  let source;
  try {
    source = await CatalogSource.open(data.pin);
    const pair = await loadNamedBodies(source, data.namedBodies, data.namedBodies.url);
    assert.equal(pair.definitions.bodies.length, 13); assert(Object.isFrozen(pair.mapping.members));
    await assert.rejects(loadNamedBodies({ ...source, sourceId: 'f'.repeat(64) }, data.namedBodies, data.namedBodies.url), /generation/);
    changed = true;
    await assert.rejects(loadNamedBodies(source, data.namedBodies, data.namedBodies.url), /length/);
    changed = false;
    const controller = new AbortController(); controller.abort();
    await assert.rejects(loadNamedBodies(source, data.namedBodies, data.namedBodies.url, { signal: controller.signal }), { name: 'AbortError' });
    source.close();
    await assert.rejects(loadNamedBodies(source, data.namedBodies, data.namedBodies.url), /closed/);
  } finally { source?.close(); globalThis.fetch = original; }
});

test('mapped discovery-date check fails before any CPU batch is committed', () => {
  const rows = JSON.parse(readFileSync(new URL('./fixtures/consumer-v1/ties/full/catalog.json', import.meta.url)));
  const model = allocateCatalogue(6); model.namedBodies = { mapping: data.mapping };
  appendCatalogue(model, rows.slice(0, 2), 0); assert.equal(model.count, 2);
  const failed = allocateCatalogue(6); failed.namedBodies = { mapping: data.mapping };
  rows[1].disc++;
  assert.throws(() => appendCatalogue(failed, rows.slice(0, 2), 0), /discovery date/);
  assert.equal(failed.count, 0);
});

test('reference replacement commits, rolls back and disposes independently of baseline', () => {
  let attached; const disposed = new Set();
  const manager = new ReferenceBodies({ prepare: data => data.map(x => ({ ...x })),
    attach: batch => { attached = batch; }, detach: () => {}, dispose: batch => { assert(!disposed.has(batch)); disposed.add(batch); } });
  manager.add([{ name: 'baseline' }], 0); const baseline = attached;
  manager.select(definitions, 2451545); const first = attached;
  const retained = []; manager.forEach(entry => retained.push(entry));
  assert.equal(retained.length, 14, "Texture refresh reaches hidden baseline and current set");
  assert.equal(first.length, 13); manager.rollback(); assert.equal(attached, baseline); assert(disposed.has(first));
  manager.select(definitions, 2451545); const second = attached; manager.commit(); assert(!disposed.has(baseline));
  manager.select(null, 2451545); manager.rollback(); assert.equal(attached, second);
  manager.select(null, 2451545); manager.commit(); assert(disposed.has(second)); manager.destroy(); assert(disposed.has(baseline));
});

test('catalogue profile carries the trusted named product through the real build selection', async t => {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { prepareCatalog } = await import('../scripts/catalog.cjs');
  const directory = await fs.mkdtemp(path.resolve('.context/named-profile-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = path.join(directory, 'profile.json');
  await fs.writeFile(config, JSON.stringify(data.selection));
  const result = await prepareCatalog(config, { publicDefaults: true });
  assert.deepEqual(result.runtime, data.selection);
  await fs.writeFile(config, JSON.stringify({ ...data.selection, namedBodies: { ...data.namedBodies, sha256: 'wrong' } }));
  await assert.rejects(prepareCatalog(config), /Invalid/);
});
