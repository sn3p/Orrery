const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Exercise the compiled public latest URL without making deterministic browser
// checks depend on the live producer. This is a test-only indexed fixture; it
// does not replace the production selection or relax checksum validation.
const latestURL = require('../catalog-profiles/latest.json').pairedLatest;
const producerBase = new URL('.', latestURL).href;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function fixtureFiles(empty = false) {
  const root = path.resolve('tests/fixtures/browser-v1', empty ? 'empty' : 'ties');
  const latest = JSON.parse(fs.readFileSync(path.join(root, 'latest.json')));
  const info = JSON.parse(fs.readFileSync(path.join(root, latest.index.url)));
  const files = new Map();
  if (!empty) {
    // Compact the synthetic fixture around normal January 1980 startup.
    // Equal-date chunk boundaries remain intact; no production dates change.
    const dates = new Map(info.date_counts.map(([date], i) => [date, 2444238.5 + i * 3]));
    info.date_counts = info.date_counts.map(([date, count]) => [dates.get(date), count]);
    for (const chunk of info.chunks) {
      const rows = JSON.parse(fs.readFileSync(path.join(root, chunk.url)));
      for (const row of rows) row.disc = dates.get(row.disc);
      const bytes = Buffer.from(JSON.stringify(rows) + '\n');
      const sha256 = digest(bytes);
      chunk.url = `chunks/${sha256}.json`;
      chunk.sha256 = sha256;
      chunk.bytes = bytes.length;
      chunk.first_disc = rows[0].disc;
      chunk.last_disc = rows.at(-1).disc;
      files.set(chunk.url, bytes);
    }
  }
  for (const ref of [...info.chunks, ...Object.values(info.provenance)]) {
    if (!files.has(ref.url)) files.set(ref.url, fs.readFileSync(path.join(root, ref.url)));
  }
  const bytes = Buffer.from(JSON.stringify(info) + '\n');
  const sha256 = digest(bytes);
  latest.index = { url: `index-${sha256}.json`, sha256, bytes: bytes.length };
  files.set(latest.index.url, bytes);
  // All fixture dwarfs are explicitly absent: synthetic rows are not real IDs.
  const named = require('./named-body-fixture.cjs').fixture('empty');
  const mapping = { ...named.mapping, catalog_id: info.catalog_id,
    asteroid_index_sha256: sha256, snapshot_version: info.snapshot_version, records: info.counts.discovery_export };
  const add = (value, prefix) => {
    const bytes = Buffer.from(JSON.stringify(value)), sha256 = digest(bytes);
    const url = `${prefix}-${sha256}.json`; files.set(url, bytes);
    return { url, sha256, bytes: bytes.length };
  };
  const product = add({ named_body_product_version: 1,
    definitions: add(named.definitions, 'definitions'), mapping: add(mapping, 'mapping') }, 'named');
  files.set('latest.json', Buffer.from(JSON.stringify({ paired_catalogue_version: 1,
    asteroids: { ...latest.index, url: producerBase + latest.index.url },
    namedBodies: { ...product, url: producerBase + product.url } })));

  return files;
}

async function routeDefaultCatalog(page, { empty = false } = {}) {
  const files = fixtureFiles(empty);
  const pattern = producerBase + '**';
  const handler = async route => {
    const relative = route.request().url().slice(producerBase.length);
    const body = files.get(relative);
    if (!body) throw new Error(`Unexpected default catalogue request: ${relative}`);
    await route.fulfill({ status: 200, body,
      contentType: relative.endsWith('.json') ? 'application/json' : 'text/plain' });
  };
  await page.route(pattern, handler);
  return () => page.unroute(pattern, handler);
}

module.exports = { latestURL, producerBase, fixtureFiles, routeDefaultCatalog };
