const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { plan, grepInvert } = require('./ci-policy.cjs');

function discover(groups, mode, previous) {
  const args = [require.resolve('@playwright/test/cli'), 'test', '--list', '--reporter=json'];
  const report = JSON.parse(execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
    env: { ...process.env, BROWSERS: 'chromium,firefox,webkit', ORRERY_TEST_GROUPS: groups, ORRERY_TEST_MODE: mode,
      ORRERY_PREVIOUS_COVERAGE: previous ? JSON.stringify(previous) : '' } }));
  const rows = [];
  // spec.id belongs to the first project of a merged spec and changes with the
  // selected projects; key each case by project, location and title path.
  function visit(suite, parents = []) {
    for (const spec of suite.specs || []) for (const item of spec.tests) rows.push({ id: `${item.projectName}:${spec.file}:${spec.line}:${spec.column} ${[...parents, spec.title].join(' / ')}`, project: item.projectName, title: spec.title, tags: spec.tags.map(tag => `@${tag}`) });
    for (const child of suite.suites || []) visit(child, [...parents, child.title]);
  }
  visit(report); return rows;
}

test('draft/routine subtraction preserves the native inventory without repeated matrix discovery', () => {
  const full = discover('full', 'full');
  const ids = rows => rows.map(row => row.id).sort();
  const plans = [plan(['package-lock.json'], { draft: true }), ...[
    'src/css/main.css', 'src/unified/App.js', 'src/unified/catalog/CatalogLoader.js', 'src/unified/index.js', 'package-lock.json',
  ].map(file => plan([file]))];
  // Independent tag-based oracle over one native inventory. Exercise every
  // selection without spawning a fresh Playwright process for each one.
  for (const prior of plans) {
    const projects = [...new Set(prior.matrix.include.map(job => job.project))];
    const previous = { groups: prior.groups, mode: prior.mode, projects };
    const covered = full.filter(row => projects.includes(row.project) && !row.tags.includes('@extended')
      && (row.project.startsWith('chromium')
        ? prior.groups === 'full' || ['smoke', ...prior.groups.split(',')].some(tag => row.tags.includes(`@${tag}`))
        : row.tags.includes('@smoke')));
    const extra = full.filter(row => !grepInvert('full', row.project, previous)?.test(`${row.title} ${row.tags.join(' ')}`));
    assert.deepEqual(ids(extra), ids(full.filter(row => !covered.includes(row))), JSON.stringify(previous));
    // Keep actual config/Playwright filtering checks for draft and broad routine
    // sources. Native sharding itself is already covered in harness.test.cjs.
    if (prior.budget === 'draft' || prior.groups === 'full') {
      assert.deepEqual(ids(discover(prior.groups, prior.mode).filter(row => projects.includes(row.project))), ids(covered));
      assert.deepEqual(ids(discover('full', 'full', previous)), ids(extra));
    }
    for (const project of ['chromium', 'chromium-only', 'firefox', 'webkit']) {
      const count = plan([], { full: true }).matrix.include.filter(job => job.project === project).length;
      assert(extra.filter(row => row.project === project).length >= count, `Enough remaining cases for ${project} shards`);
    }
  }
});

test('fixture preparation verifies reused bytes and builds only missing variants', async t => {
  const { prepare, definitions } = require('./fixture-builds.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-incremental-fixtures-'));
  const keys = ['ORRERY_TEST_GROUPS', 'ORRERY_TEST_MODE', 'ORRERY_REUSE_FIXTURES'];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  t.after(() => {
    for (const key of keys) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
    fs.rmSync(root, { recursive: true, force: true });
  });
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
