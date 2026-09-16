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

for (const dependency of ['manifest', 'helper']) {
  test(`actual webpack watch reloads changed fixture ${dependency}`, { timeout: 30000 }, async t => {
    const path = require('node:path');
    const webpack = require('webpack');
    fs.mkdirSync(path.resolve('.context'), { recursive: true });
    const root = fs.mkdtempSync(path.resolve('.context/fixture-watch-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const catalogDirectory = path.join(root, 'fixtures/historical100k');
    fs.mkdirSync(catalogDirectory, { recursive: true });
    for (const name of ['historical-catalog.cjs', 'historical-catalog-loader.cjs']) {
      fs.copyFileSync(path.join(__dirname, name), path.join(root, name));
    }
    const bytes = Buffer.from('[{"disc":1}]');
    const pin = JSON.stringify({ bytes: bytes.length,
      sha256: require('node:crypto').createHash('sha256').update(bytes).digest('hex') });
    const pinFile = path.join(catalogDirectory, 'manifest.json');
    const helperFile = path.join(root, 'historical-catalog.cjs');
    fs.writeFileSync(pinFile, pin);
    fs.writeFileSync(path.join(catalogDirectory, 'catalog.json.gz'), gzipSync(bytes));
    fs.writeFileSync(path.join(root, 'entry.js'), 'import url from "./fixtures/historical100k/catalog.json.gz"; globalThis.catalogURL = url;');
    const compiler = webpack({ mode: 'development', context: root, entry: './entry.js',
      output: { path: path.join(root, 'out'), filename: 'bundle.js' },
      module: { rules: [require(helperFile).rule] } });
    const events = [];
    let wake;
    async function nextMatching(matches, label) {
      const deadline = Date.now() + 5000;
      while (true) {
        while (events.length) {
          const event = events.shift();
          assert.ifError(event.error);
          if (matches(event.stats)) return event.stats;
        }
        const remaining = deadline - Date.now();
        assert(remaining > 0, `Timed out waiting for ${label}`);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => { wake = null; reject(new Error(`Timed out waiting for ${label}`)); }, remaining);
          wake = () => { clearTimeout(timer); wake = null; resolve(); };
        });
      }
    }
    const watcher = compiler.watch({ aggregateTimeout: 10 }, (error, stats) => {
      const event = { error, stats };
      events.push(event);
      wake?.();
    });
    try {
      await nextMatching(stats => !stats.hasErrors(), 'initial fixture compilation');
      assert.deepEqual(fs.readFileSync(path.join(root, 'out/data/catalog.json')), bytes);
      const changedFile = dependency === 'manifest' ? pinFile : helperFile;
      const original = fs.readFileSync(changedFile, 'utf8');
      const changed = dependency === 'manifest'
        ? JSON.stringify({ ...JSON.parse(pin), sha256: '0'.repeat(64) })
        : original.replace('return bytes;', 'throw new Error("changed validation helper");');
      fs.writeFileSync(changedFile, changed);
      const expected = dependency === 'manifest' ? /pinned source/ : /changed validation helper/;
      await nextMatching(stats => stats.hasErrors() && expected.test(stats.toString('errors-only')),
        `changed ${dependency} validation in the same watcher`);
      fs.writeFileSync(changedFile, original);
      await nextMatching(stats => !stats.hasErrors(), `restored ${dependency} compilation`);
      assert.deepEqual(fs.readFileSync(path.join(root, 'out/data/catalog.json')), bytes);
    } finally {
      await new Promise((resolve, reject) => watcher.close(error => error ? reject(error) : resolve()));
      await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
    }
  });
}
