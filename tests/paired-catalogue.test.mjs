import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePairedLatest, validatePairedSelection } from '../src/unified/named/source/PairedCatalogSource.js';
import { fixture } from './named-body-fixture.cjs';
import { prepareCatalog } from '../scripts/catalog.cjs';
import fs from 'node:fs/promises';
const data = fixture();
const descriptor = { paired_catalogue_version: 1, asteroids: data.pin, namedBodies: data.namedBodies };
test('paired discovery is bounded, revalidated, strict and cancellable', async t => {
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  let body = JSON.stringify(descriptor), calls = 0;
  globalThis.fetch = async (url, options) => { calls++; assert.equal(options.cache, 'no-cache'); assert.equal(options.redirect, 'error'); return new Response(body); };
  assert.deepEqual(await resolvePairedLatest('https://named.test/paired/latest.json'), { pin: data.pin, namedBodies: data.namedBodies });
  assert.equal(calls, 1);
  for (const value of [{ ...descriptor, extra: 1 }, { ...descriptor, paired_catalogue_version: 2 },
    { ...descriptor, asteroids: { ...data.pin, bytes: 4194305 } },
    { ...descriptor, namedBodies: { ...data.namedBodies, url: 'https://named.test/a?b' } }]) {
    body = JSON.stringify(value); await assert.rejects(resolvePairedLatest('https://named.test/latest.json'));
  }
  body = ' '.repeat(4097); await assert.rejects(resolvePairedLatest('https://named.test/latest.json'));
  body = JSON.stringify(descriptor).replace('"paired_catalogue_version":1', '"paired_catalogue_version":1,"paired_catalogue_version":1');
  await assert.rejects(resolvePairedLatest('https://named.test/latest.json'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(resolvePairedLatest('https://named.test/latest.json', { signal: controller.signal }), { name: 'AbortError' });
});
test('build and runtime reject conflicting paired selectors', async t => {
  await fs.mkdir('.context', { recursive: true });
  const dir = await fs.mkdtemp('.context/paired-profile-'); t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const base = { mode: 'indexed', pairedLatest: 'https://named.test/paired/latest.json' };
  for (const extra of [{ pin: data.pin }, { namedBodies: data.namedBodies }, { latest: 'https://named.test/latest.json' }, { bundle: 'x' }, { archive: {} }, { retained: [] }, { mode: 'whole' }]) {
    const selection = { ...base, ...extra };
    assert.throws(() => validatePairedSelection(selection));
    await fs.writeFile(dir + '/profile.json', JSON.stringify(selection));
    await assert.rejects(prepareCatalog(dir + '/profile.json'));
  }
  await fs.writeFile(dir + '/profile.json', JSON.stringify(base));
  assert.deepEqual((await prepareCatalog(dir + '/profile.json', { publicDefaults: true })).runtime, base);
});
