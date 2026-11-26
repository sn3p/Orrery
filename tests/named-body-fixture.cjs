const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const ref = (url, bytes) => ({ url, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });

// Tiny test-only identity mapping: Ceres is row 1 in the producer's ties fixture.
// Other dwarf identities are absent from that fixture's master export.
function fixture(kind = 'ties') {
  const root = path.join(__dirname, 'fixtures/browser-v1/' + kind);
  const host = kind === 'ties' ? 'https://named.test' : 'https://empty.test';
  const indexName = fs.readdirSync(root).find(name => name.startsWith('index-'));
  const indexBytes = fs.readFileSync(path.join(root, indexName)), index = JSON.parse(indexBytes);
  const files = new Map();
  for (const name of [indexName, 'latest.json', ...index.chunks.map(chunk => chunk.url)]) {
    files.set(host + '/asteroids/' + name, fs.readFileSync(path.join(root, name)));
  }
  const definitions = fs.readFileSync(path.join(__dirname, '../src/unified/named/definitions.json'));
  const bodies = JSON.parse(definitions).bodies.slice(8);
  const mapping = Buffer.from(JSON.stringify({ named_body_mapping_version: 1, catalog_id: index.catalog_id,
    asteroid_index_sha256: ref(indexName, indexBytes).sha256, snapshot_version: index.snapshot_version,
    records: index.counts.discovery_export, members: bodies.map((b, i) => ({ id: b.id,
      status: i || kind === 'empty' ? 'absent-from-export' : 'present', ordinal: i || kind === 'empty' ? null : 1,
      discovery_jd: i || kind === 'empty' ? null : 2451544.5, reason: i || kind === 'empty' ? 'not-in-master' : null })) }));
  const product = (bytes, prefix) => { const r = ref('', bytes); r.url = `${prefix}-${r.sha256}.json`; files.set(host + '/bodies/' + r.url, bytes); return r; };
  const productBytes = Buffer.from(JSON.stringify({ named_body_product_version: 1,
    definitions: product(definitions, 'definitions'), mapping: product(mapping, 'mapping') }));
  const namedBodies = ref(host + '/bodies/index.json', productBytes);
  files.set(namedBodies.url, productBytes);
  return { files, definitions: JSON.parse(definitions), mapping: JSON.parse(mapping),
    pin: ref(host + '/asteroids/' + indexName, indexBytes), namedBodies,
    selection: { mode: 'indexed', pin: ref(host + '/asteroids/' + indexName, indexBytes), namedBodies, startJed: 2378496.5, speed: 0 } };
}
module.exports = { fixture, ref };
