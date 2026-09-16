const fs = require('node:fs');
const path = require('node:path');
const { gunzipSync } = require('node:zlib');
const { createHash } = require('node:crypto');
const manifest = require('./fixtures/historical100k/manifest.json');
const filename = path.join(__dirname, 'fixtures/historical100k/catalog.json.gz');

function decodeCatalog(compressed) {
  const bytes = gunzipSync(compressed);
  if (bytes.length !== manifest.bytes || createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) {
    throw new Error('Historical catalogue fixture differs from its pinned source');
  }
  return bytes;
}
function readCatalog() { return decodeCatalog(fs.readFileSync(filename)); }
// Opt in only in fixture compilers. The public build has no gzip resource rule.
const rule = { test: /catalog\.json\.gz$/, include: path.dirname(filename),
  type: 'asset/resource', use: [{ loader: path.join(__dirname, 'historical-catalog-loader.cjs') }],
  generator: { filename: 'data/catalog.json' } };
module.exports = { readCatalog, decodeCatalog, manifest, filename, rule };
