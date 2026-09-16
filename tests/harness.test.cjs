const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const cli = require.resolve('@playwright/test/cli');
const { build } = require('./support.cjs');
const { copyPrepared, inventory, sourceFingerprint } = require('./fixture-builds.cjs');
fs.mkdirSync('.context', { recursive: true });

test('every runner entry imports without starting a standalone process', () => {
  for (const suite of ['assets', 'next', 'unified', 'gpu', 'rendering', 'options-browser',
    'benchmark', 'scheduling', 'ui', 'hmr', 'next-dev', 'benchmark-clone', 'browser-environment', 'catalog-suite', 'three', 'three-benchmark', 'switching', 'default-catalog']) {
    assert.equal(typeof require(`./${suite}.cjs`).run, 'function', suite);
  }
});

test('prepared build boundary rejects absent, corrupt, stale and wrong-variant artifacts', async () => {
  const root = fs.mkdtempSync(path.resolve('.context/test-fixtures-probe-'));
  const previous = process.env.ORRERY_PREBUILT_FIXTURES;
  process.env.ORRERY_PREBUILT_FIXTURES = root;
  try {
    const output = path.join(root, 'consumer');
    await assert.rejects(build('./tests/browser.js', output), /ENOENT/);
    const fixture = path.join(root, 'legacy/gpu');
    fs.mkdirSync(fixture, { recursive: true });
    fs.writeFileSync(path.join(fixture, 'bundle.js'), 'verified fixture');
    const manifest = { version: 1, source: sourceFingerprint(), fixtures: { 'legacy/gpu': inventory(fixture) } };
    const save = () => fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
    save();
    await build('./tests/browser.js', output, { application: 'legacy' });
    assert.equal(fs.readFileSync(path.join(output, 'bundle.js'), 'utf8'), 'verified fixture');
    fs.writeFileSync(path.join(output, 'bundle.js'), 'consumer mutation');
    await build('./tests/browser.js', output, { application: 'legacy' });
    assert.equal(fs.readFileSync(path.join(output, 'bundle.js'), 'utf8'), 'verified fixture');
    await assert.rejects(build('./tests/browser.js', output, { application: 'unified' }), /Missing prepared fixture/);
    await assert.rejects(build('./unknown.js', output), /No prepared fixture/);
    assert.throws(() => copyPrepared('catalog', output), /Missing prepared fixture/);
    const catalog = path.join(root, 'catalog/catalog-indexed');
    fs.mkdirSync(catalog, { recursive: true });
    fs.writeFileSync(path.join(catalog, 'bundle.js'), 'verified catalogue entry');
    manifest.fixtures.catalog = inventory(path.join(root, 'catalog')); save();
    copyPrepared('catalog', output);
    fs.writeFileSync(path.join(output, 'catalog-indexed/bundle.js'), 'consumer mutation');
    copyPrepared('catalog', output);
    assert.equal(fs.readFileSync(path.join(output, 'catalog-indexed/bundle.js'), 'utf8'), 'verified catalogue entry');
    fs.appendFileSync(path.join(catalog, 'bundle.js'), 'corrupt');
    assert.throws(() => copyPrepared('catalog', output), /Prepared fixture changed/);
    fs.appendFileSync(path.join(fixture, 'bundle.js'), 'corrupt');
    await assert.rejects(build('./tests/browser.js', output), /Prepared fixture changed/);
    manifest.source = 'different revision'; save();
    await assert.rejects(build('./tests/browser.js', output), /different source/);
  } finally {
    if (previous === undefined) delete process.env.ORRERY_PREBUILT_FIXTURES;
    else process.env.ORRERY_PREBUILT_FIXTURES = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('fixture identity includes compiler, catalogue provisioning and profile changes and is portable between checkouts', async () => {
  const root = fs.mkdtempSync(path.resolve('.context/test-fixtures-probe-'));
  const fingerprint = async cwd => (await execute(process.execPath, ['-e',
    `process.stdout.write(require(${JSON.stringify(require.resolve('./fixture-builds.cjs'))}).sourceFingerprint())`], { cwd })).stdout;
  try {
    for (const name of ['first', 'second']) {
      const checkout = path.join(root, name);
      for (const directory of ['src', 'tests', 'data', 'scripts', 'catalog-profiles']) fs.mkdirSync(path.join(checkout, directory), { recursive: true });
      fs.writeFileSync(path.join(checkout, 'data/catalog.json'), '[]');
      fs.writeFileSync(path.join(checkout, 'postcss.config.js'), 'module.exports = { plugins: [] };');
      fs.writeFileSync(path.join(checkout, 'scripts/catalog.cjs'), 'module.exports = {};');
      fs.writeFileSync(path.join(checkout, 'catalog-profiles/ties-indexed.json'), '{"mode":"indexed"}');
    }
    const first = path.join(root, 'first'), second = path.join(root, 'second');
    const original = await fingerprint(first);
    assert.equal(await fingerprint(second), original, 'Checkout location does not change fixture identity');
    fs.writeFileSync(path.join(first, 'postcss.config.js'), 'module.exports = { plugins: ["changed"] };');
    assert.notEqual(await fingerprint(first), original, 'CSS compiler configuration invalidates prepared fixtures');
    const withCompilerChange = await fingerprint(first);
    fs.appendFileSync(path.join(first, 'scripts/catalog.cjs'), '// changed');
    assert.notEqual(await fingerprint(first), withCompilerChange, 'Catalogue provisioning changes invalidate prepared fixtures');
    const withProvisioningChange = await fingerprint(first);
    fs.writeFileSync(path.join(first, 'catalog-profiles/ties-indexed.json'), '{"mode":"whole"}');
    assert.notEqual(await fingerprint(first), withProvisioningChange, 'Catalogue profile changes invalidate prepared fixtures');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

async function discover(...args) {
  const env = { ...process.env };
  delete env.BROWSERS;
  delete env.ORRERY_TEST_GROUPS;
  const { stdout } = await execute(process.execPath, [cli, 'test', '--list', '--reporter=json', ...args], { env, maxBuffer: 4 * 1024 * 1024 });
  const rows = [];
  function visit(suite, parents = []) {
    for (const spec of suite.specs || []) {
      for (const item of spec.tests) rows.push({ id: spec.id, project: item.projectName, title: [...parents, spec.title].join(' / ') });
    }
    for (const child of suite.suites || []) visit(child, [...parents, child.title]);
  }
  visit(JSON.parse(stdout));
  return rows;
}

test('native discovery preserves coverage and each browser shard partitions it exactly once', async () => {
  const all = await discover();
  const required = ['production assets', 'preview entry', 'preview footer loading', 'promoted root', 'configured promotion', 'default indexed catalogue', 'development texture lifecycle', 'raw App lifecycle',
    ...['legacy', 'unified'].flatMap(app => ['GPU numerics', 'rendering, readouts', 'options controls',
      'pixel ratio and display transitions', 'texture recovery', 'benchmark frames'].map(title => `${app} / ${title}`))];
  const catalogue = ['catalogue loading, demand, transport', 'catalogue replacement, recovery', 'catalogue frame commits'];
  const catalogueChromium = ['catalogue benchmark completion', 'catalogue configured preview development'];
  for (const browser of ['chromium', 'firefox', 'webkit']) {
    const cases = all.filter(row => row.project === browser);
    assert.equal(cases.length, 37);
    assert.equal(cases.filter(row => row.title.includes('Three ')).length, 5);
    assert.equal(cases.filter(row => row.title.includes('Renderer switching ')).length, 6);
    for (const title of [...required, ...catalogue]) assert.equal(cases.filter(row => row.title.includes(title)).length, 1, `${browser}: ${title}`);
    const count = browser === 'webkit' ? 4 : 2;
    const shards = await Promise.all(Array.from({ length: count }, (_, i) => discover(`--project=${browser}`, `--shard=${i + 1}/${count}`)));
    assert(shards.every(shard => shard.length > 0));
    assert.deepEqual(shards.flat().map(row => row.id).sort(), cases.map(row => row.id).sort());
    assert.equal(new Set(shards.flat().map(row => row.id)).size, cases.length);
  }
  const chromiumOnly = all.filter(row => row.project === 'chromium-only');
  assert.equal(chromiumOnly.length, 17);
  for (const title of catalogueChromium) assert.equal(chromiumOnly.filter(row => row.title.includes(title)).length, 1, title);
  const standalone = await discover('--config=playwright.standalone.config.cjs');
  assert.equal(standalone.length, 2, 'Standalone never inherits the full project matrix');
  assert(standalone.every(row => row.project === 'standalone' && row.title.includes('public startup')));
});
