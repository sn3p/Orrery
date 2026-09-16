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
  // Pinned source is a rendered/numerical Three oracle, not a runtime import.
  if (fs.existsSync('migration/orrery3d')) inputs.push(...files('migration/orrery3d/src'),
    'migration/orrery3d/tests/shader.js', 'migration/orrery3d/webpack.config.js');
  const hash = crypto.createHash('sha256');
  for (const file of inputs) hash.update(file).update('\0').update(fs.readFileSync(file)).update('\0');
  return hash.digest('hex');
}

async function prepare() {
  fs.rmSync(directory, { recursive: true, force: true });
  const manifest = { version: 1, source: sourceFingerprint(), fixtures: {} };
  for (const definition of definitions) {
    const output = path.join(directory, definition.key);
    await compile(definition.entry, output, definition);
    manifest.fixtures[definition.key] = inventory(output);
    console.log(`Prepared ${definition.key}`);
  }
  // Compile the lazy JS/CSS/JSON probe once too; its chunk assertion belongs
  // here, while each browser still verifies loading at both deployment paths.
  const { compileLazyProbe } = require('./next.cjs');
  const lazy = path.join(directory, 'lazy-preview');
  await compileLazyProbe(lazy);
  manifest.fixtures['lazy-preview'] = inventory(path.join(lazy, 'site'));
  const catalog = path.join(directory, 'catalog');
  await require('./catalog-loading.cjs').build(catalog);
  manifest.fixtures.catalog = inventory(catalog);
  console.log('Prepared catalog');
  const three = path.join(directory, 'three');
  await require('./three-build.cjs').build(three);
  manifest.fixtures.three = inventory(three);
  console.log('Prepared three');
  fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
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
