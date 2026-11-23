const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { plan } = require('./ci-policy.cjs');

function discover(groups, mode, previous, project, shard) {
  const args = [require.resolve('@playwright/test/cli'), 'test', '--list', '--reporter=json'];
  if (project) args.push(`--project=${project}`);
  if (shard) args.push(`--shard=${shard}`);
  const report = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, BROWSERS: 'chromium,firefox,webkit', ORRERY_TEST_GROUPS: groups, ORRERY_TEST_MODE: mode,
      ORRERY_PREVIOUS_COVERAGE: previous ? JSON.stringify(previous) : '' } }));
  const rows = [];
  function visit(suite) {
    for (const spec of suite.specs || []) for (const item of spec.tests) rows.push(`${item.projectName}:${spec.id}`);
    for (const child of suite.suites || []) visit(child);
  }
  visit(report); return rows;
}

test('draft/routine coverage and readiness additions are disjoint and equal the full native suite', () => {
  const full = discover('full', 'full');
  const plans = [plan(['package-lock.json'], { draft: true }), ...[
    'src/css/main.css', 'src/unified/App.js', 'src/unified/catalog/CatalogLoader.js', 'src/unified/index.js', 'package-lock.json',
  ].map(file => plan([file]))];
  for (const prior of plans) {
    const projects = [...new Set(prior.matrix.include.map(job => job.project))];
    const previous = { groups: prior.groups, mode: prior.mode, projects };
    const covered = discover(prior.groups, prior.mode).filter(id => projects.includes(id.split(':')[0]));
    const extra = discover('full', 'full', previous);
    assert.equal(new Set([...covered, ...extra]).size, covered.length + extra.length, JSON.stringify(previous));
    assert.deepEqual([...covered, ...extra].sort(), [...full].sort());
  }
  // The readiness workflow shards the remainder, not the original full list.
  const previous = { groups: 'full', mode: 'pr', projects: ['chromium', 'chromium-only', 'firefox', 'webkit'] };
  const shards = plan([], { full: true }).matrix.include.map(job => discover('full', 'full', previous, job.project, job.shard));
  assert(shards.every(rows => rows.length));
  assert.deepEqual(shards.flat().sort(), discover('full', 'full', previous).sort());
});

test('fixture preparation verifies reused bytes and builds only missing variants', async t => {
  const { prepare, definitions } = require('./fixture-builds.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-incremental-fixtures-'));
  const previous = { ...process.env };
  t.after(() => { process.env = previous; fs.rmSync(root, { recursive: true, force: true }); });
  const builds = [];
  const build = (output, key) => { builds.push(key); fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, 'bundle.js'), key); };
  const options = { root, compileVariant: async (_entry, output, definition) => build(output, definition.key),
    buildLazy: async output => build(path.join(output, 'site'), 'lazy-preview'),
    buildCatalog: async output => build(output, 'catalog'), buildThree: async output => build(output, 'three') };
  process.env.ORRERY_TEST_GROUPS = 'core'; process.env.ORRERY_TEST_MODE = 'pr'; process.env.ORRERY_REUSE_FIXTURES = '0';
  const core = await prepare(options); const first = [...builds];
  process.env.ORRERY_TEST_GROUPS = 'full'; process.env.ORRERY_TEST_MODE = 'full'; process.env.ORRERY_REUSE_FIXTURES = '1';
  const full = await prepare(options);
  assert.equal(new Set(builds).size, builds.length, 'No fixture variant rebuilt');
  assert.equal(builds.length, definitions.length + 3);
  for (const key of first) assert.deepEqual(full.fixtures[key], core.fixtures[key]);
  fs.appendFileSync(path.join(root, 'three/bundle.js'), 'corrupt');
  await assert.rejects(prepare(options), /Prepared fixture changed/);
  fs.rmSync(path.join(root, 'manifest.json'));
  await assert.rejects(prepare(options), /ENOENT/);
});
