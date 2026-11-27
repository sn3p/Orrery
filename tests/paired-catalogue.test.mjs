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
  globalThis.fetch = async (url, options) => { calls++; assert.equal(options.cache, 'no-cache'); assert.equal(options.redirect, 'manual'); return new Response(body); };
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

test('transport errors distinguish missing resources from bad data and cancellation', async t => {
  const { request, CatalogueRequestError, isRequestFailure, isMissingResource } = await import('../src/unified/catalog/request.js');
  const { fetchVerified } = await import('../src/unified/catalog/CatalogSource.js');
  const { fetchVerified: fetchNamed } = await import('../src/unified/named/source/transport.js');
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  for (const read of [fetchVerified, fetchNamed]) {
    for (const status of [404, 410, 503]) {
      globalThis.fetch = async () => new Response('', { status });
      await assert.rejects(read(data.pin, data.pin.url), error => isRequestFailure(error) && isMissingResource(error) === (status !== 503));
    }
    globalThis.fetch = async () => { throw new TypeError('offline'); };
    await assert.rejects(read(data.pin, data.pin.url), error => isRequestFailure(error) && !isMissingResource(error));
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.error(new TypeError('connection interrupted')); } }));
    await assert.rejects(read(data.pin, data.pin.url), error => isRequestFailure(error) && !isMissingResource(error));
    globalThis.fetch = async () => new Response('{}');
    await assert.rejects(read(data.pin, data.pin.url), error => !isRequestFailure(error));
  }
  globalThis.fetch = async () => { throw new DOMException('cancelled','AbortError'); };
  await assert.rejects(request(data.pin.url), error => error.name === 'AbortError' && !(error instanceof CatalogueRequestError));
});


test('transport preserves non-Error rejection causes and cancellation', async t => {
  const { request, readResponse, isRequestFailure } = await import('../src/unified/catalog/request.js');
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  for (const cause of [undefined, null, 'offline', new TypeError('offline')]) {
    globalThis.fetch = async () => { throw cause; };
    for (const operation of [() => request(data.pin.url), () => readResponse({ read: globalThis.fetch })]) {
      await assert.rejects(operation, error => isRequestFailure(error) && error.cause === cause);
    }
  }
  const controller = new AbortController(); controller.abort();
  const aborted = new DOMException('cancelled', 'AbortError');
  globalThis.fetch = async () => { throw aborted; };
  await assert.rejects(request(data.pin.url, { signal: controller.signal }), error => error === aborted);
});

test('paired and legacy latest share transport classification without following redirects', async t => {
  const { default: CatalogSource } = await import('../src/unified/catalog/CatalogSource.js');
  const { isRequestFailure } = await import('../src/unified/catalog/request.js');
  const original = globalThis.fetch; t.after(() => { globalThis.fetch = original; });
  for (const open of [resolvePairedLatest, url => CatalogSource.openLatest(url)]) {
    const url = 'https://named.test/latest.json';
    for (const response of [new Response('', { status: 302, headers: { Location: url + '?changed' } }),
      { type: 'opaqueredirect', status: 0 }]) {
      let calls = 0;
      globalThis.fetch = async (_url, options) => {
        calls++; assert.equal(options.redirect, 'manual'); assert.equal(options.cache, 'no-cache'); return response;
      };
      await assert.rejects(open(url), error => !isRequestFailure(error) && /must not redirect/.test(error.message));
      assert.equal(calls, 1);
    }
    for (const status of [404, 410, 503]) {
      globalThis.fetch = async () => new Response('', { status });
      await assert.rejects(open(url), error => isRequestFailure(error) && error.status === status);
    }
    globalThis.fetch = async () => { throw undefined; };
    await assert.rejects(open(url), error => isRequestFailure(error) && error.cause === undefined);
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) { controller.error('stream failed'); } }));
    await assert.rejects(open(url), error => isRequestFailure(error) && error.cause === 'stream failed');
    for (const body of ['{}', ' '.repeat(4097)]) {
      globalThis.fetch = async () => new Response(body);
      await assert.rejects(open(url), error => !isRequestFailure(error));
    }
  }
});
