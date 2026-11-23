const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { compile } = require('./support.cjs');

const directory = path.resolve('.context/test-fixtures');
const entries = {
  gpu: './tests/browser.js',
  rendering: './tests/rendering-fixture.js',
  initialization: './tests/init-fixture.js',
  benchmark: './tests/fixture.js',
  production: './tests/bundled-entry.js',
};
const definitions = ['unified'].flatMap(application =>
  Object.entries(entries).map(([name, entry]) => ({ key: `${application}/${name}`, application, entry })));
definitions.push({ key: 'unified/contracts', application: 'unified', entry: './tests/unified-fixture.js' });

function files(root) {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? files(path.join(root, entry.name)) : [path.join(root, entry.name)]).sort();
}

function inventory(root) {
  return Object.fromEntries(files(root).map(file => [path.relative(root, file),
    crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]));
}

function sourceFingerprint() {
  // Portable between checkouts of this exact source. Include uncommitted edits
  // too, so a local prepared run cannot silently test yesterday's fixture.
  const inputs = [...files('src'), ...files('tests'), ...files('scripts'), ...files('catalog-profiles'),
    ...fs.readdirSync('.').filter(file => /^(webpack.*\.[cm]?js|.*\.config\.[cm]?js|\.babelrc|\.browserslistrc|package(-lock)?\.json)$/.test(file))].sort();
  const hash = crypto.createHash('sha256');
  for (const file of inputs) hash.update(file).update('\0').update(fs.readFileSync(file)).update('\0');
  return hash.digest('hex');
}

async function prepare({ root = directory, compileVariant = compile,
  buildLazy = output => require('./next.cjs').compileLazyProbe(output),
  buildCatalog = output => require('./catalog-loading.cjs').build(output),
  buildThree = output => require('./three-build.cjs').build(output) } = {}) {
  const keys = require('./ci-policy.cjs').fixtureKeys();
  const needed = key => !keys || keys.has(key);
  const reuse = process.env.ORRERY_REUSE_FIXTURES === '1';
  let manifest;
  if (reuse) {
    manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
    assert.equal(manifest.version, 1, 'Unsupported test fixture artifact');
    assert.equal(manifest.source, sourceFingerprint(), 'Prepared test fixtures belong to different source; rebuild them');
    for (const key of Object.keys(manifest.fixtures)) {
      assert.deepEqual(inventory(path.join(root, key, key === 'lazy-preview' ? 'site' : '')),
        manifest.fixtures[key], `Prepared fixture changed: ${key}`);
    }
  } else {
    fs.rmSync(root, { recursive: true, force: true });
    manifest = { version: 1, source: sourceFingerprint(), fixtures: {} };
  }
  for (const definition of definitions.filter(item => needed(item.key))) {
    if (manifest.fixtures[definition.key]) continue;
    const output = path.join(root, definition.key);
    await compileVariant(definition.entry, output, definition);
    manifest.fixtures[definition.key] = inventory(output);
    console.log(`Prepared ${definition.key}`);
  }
  // Compile the lazy JS/CSS/JSON probe once too; its chunk assertion belongs
  // here, while each browser still verifies loading at both deployment paths.
  const lazy = path.join(root, 'lazy-preview');
  if (!manifest.fixtures['lazy-preview']) await buildLazy(lazy);
  manifest.fixtures['lazy-preview'] = inventory(path.join(lazy, 'site'));
  const catalog = path.join(root, 'catalog');
  if (!manifest.fixtures.catalog) await buildCatalog(catalog);
  manifest.fixtures.catalog = inventory(catalog);
  console.log('Prepared catalog');
  const three = path.join(root, 'three');
  if (!manifest.fixtures.three) await buildThree(three);
  manifest.fixtures.three = inventory(three);
  console.log('Prepared three');
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function copyPrepared(key, output) {
  const root = path.resolve(process.env.ORRERY_PREBUILT_FIXTURES || directory);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  assert.equal(manifest.version, 1, 'Unsupported test fixture artifact');
  assert.equal(manifest.source, sourceFingerprint(), 'Prepared test fixtures belong to different source; rebuild them');
  const source = path.join(root, key, key === 'lazy-preview' ? 'site' : '');
  assert(manifest.fixtures[key], `Missing prepared fixture: ${key}`);
  assert.deepEqual(inventory(source), manifest.fixtures[key], `Prepared fixture changed: ${key}`);
  fs.rmSync(output, { recursive: true, force: true });
  fs.cpSync(source, output, { recursive: true });
}

function copyFixture(entry, output, application) {
  const definition = definitions.find(item => item.entry === entry && item.application === application);
  assert(definition, `No prepared fixture for ${application}: ${entry}`);
  copyPrepared(definition.key, output);
}

module.exports = { directory, definitions, prepare, copyFixture, copyPrepared, inventory, sourceFingerprint };
if (require.main === module) prepare().catch(error => { console.error(error); process.exitCode = 1; });
