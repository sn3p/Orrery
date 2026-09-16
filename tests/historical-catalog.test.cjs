const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { gzipSync } = require('node:zlib');
const { readCatalog, decodeCatalog, filename, manifest } = require('./historical-catalog.cjs');

test('historical fixture retains original bytes, population, discovery ties and input order', () => {
  const bytes = readCatalog(), rows = JSON.parse(bytes);
  assert.equal(manifest.sha256, '46da56fa836c356d9fd8ed0dd9b113702375646758881573ec6ef7acb2732c99');
  assert.equal(rows.length, 100000);
  assert.equal(bytes.length, manifest.bytes);
  assert(new Set(rows.map(row => row.disc)).size < rows.length, 'Discovery ties remain');
  assert(rows.every((row, i) => !i || row.disc >= rows[i - 1].disc), 'Original chronological order remains');
  assert(rows.some(row => row.e > 0.9), 'High eccentricity coverage remains');
  assert.throws(() => decodeCatalog(Buffer.from('not gzip')));
  assert.throws(() => decodeCatalog(fs.readFileSync(filename).subarray(0, 100)));
  assert.throws(() => decodeCatalog(gzipSync(Buffer.from('[]'))), /pinned source/);
});
