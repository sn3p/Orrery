const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { plan, selection, fixtureKeys, mode } = require('./ci-policy.cjs');
const { fromEvent } = require('../scripts/ci-plan.cjs');
const { verify } = require('../scripts/ci-gate.cjs');

test('path policy preserves risky changes, unions groups and defaults unknown files to full', () => {
  assert.equal(plan(['docs/browser-tests.md', 'README.md']).code, false);
  assert.equal(plan(['src/css/main.css']).groups, 'core,ui');
  assert.equal(plan(['src/js/Gui.js']).groups, 'core,ui,graphics,data');
  assert.equal(plan(['src/unified/ui/Options.js']).groups, 'core,ui');
  assert.equal(plan(['src/unified/compat/pr73-assets/main.js.gz']).groups, 'core,ui,build,dev');
  for (const file of ['src/unified/index.js', 'src/unified/index.html', 'src/unified/renderers.js']) {
    assert.equal(plan([file]).groups, 'core,ui,build,dev', file);
    for (const suffix of ['.map', '.old', '.gz', '/nested.js', '.copy.js']) {
      const unknown = file + suffix;
      assert.equal(plan([unknown]).groups, 'full', unknown);
      assert(plan([unknown]).buildTests, unknown);
    }
  }
  assert(plan(['src/unified/index.html']).buildTests);
  assert.equal(plan(['src/unified/App.js']).groups, 'core,ui,graphics,data');
  const data = plan(['src/unified/catalog/CatalogLoader.js']);
  assert.equal(data.groups, 'core,data,build'); assert(data.buildTests);
  assert.equal(plan(['src/css/main.css', 'catalog-profiles/latest.json']).groups, 'core,ui,data,build');
  for (const file of ['package-lock.json', '.github/workflows/pages.yml', 'tests/gpu.cjs',
    'src/js/index.js', 'tests/new.spec.cjs', 'scripts/build.cjs', 'webpack.config.js', 'src/new-runtime.js', 'migration/orrery3d/src/App.js',
    'src/unified/index.mjs', 'src/unified/index.css', 'src/unified/renderers.json', 'src/js/index']) {
    assert.equal(plan([file]).groups, 'full', file);
    assert(plan([file]).buildTests, file);
  }
  for (const value of ['oops', 'ui', 'core,typo', 'full,core', '']) assert.throws(() => selection(value));
  for (const value of ['oops', '', 'core']) assert.throws(() => mode(value));
  assert.equal(fixtureKeys(['full']), null);
  assert(!fixtureKeys(['core']).has('unified/gpu'));
  const known = new Set([...require('./fixture-builds.cjs').definitions.map(item => item.key), 'lazy-preview', 'catalog', 'three']);
  for (const groups of [['core'], ['core', 'ui']]) {
    for (const key of fixtureKeys(groups)) assert(known.has(key), `Unknown selected fixture: ${key}`);
  }
  assert(fixtureKeys(['core', 'ui']).has('unified/production'));
  const routineFixtures = fixtureKeys(['full'], 'pr');
  assert(routineFixtures.has('unified/initialization'));
  assert(!routineFixtures.has('unified/gpu'));
  assert(!routineFixtures.has('unified/benchmark'));
  for (const files of [['src/css/main.css'], ['src/unified/App.js'], ['tests/runtime-diagnostics.cjs'], ['package-lock.json']]) {
    const result = plan(files);
    assert.equal(result.mode, 'pr');
    assert.equal(result.matrix.include.length, 5, files.join(','));
  }
  assert.equal(plan([], { full: true }).mode, 'full');
  assert.equal(plan([], { full: true }).matrix.include.length, 9);
});

test('reduced prepared manifest reaches the real public-assets browser boundary', async t => {
  const { inventory, sourceFingerprint } = require('./fixture-builds.cjs');
  const root = fs.mkdtempSync(path.resolve('.context/core-fixture-probe-'));
  const previous = process.env.ORRERY_PREBUILT_FIXTURES;
  process.env.ORRERY_PREBUILT_FIXTURES = root;
  t.after(() => {
    if (previous === undefined) delete process.env.ORRERY_PREBUILT_FIXTURES;
    else process.env.ORRERY_PREBUILT_FIXTURES = previous;
    fs.rmSync(root, { recursive: true, force: true });
  });
  const manifest = { version: 1, source: sourceFingerprint(), fixtures: {} };
  // The consumer checks exact catalogue/fonts and actual prepared-build routing
  // before opening a browser. Missing policy keys must fail at this boundary.
  const catalog = require('./historical-catalog.cjs').readCatalog();
  for (const key of fixtureKeys(['core'])) {
    const directory = path.join(root, key);
    fs.mkdirSync(path.join(directory, 'data'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'data/catalog.json'), catalog);
    fs.cpSync('src/fonts', path.join(directory, 'fonts'), { recursive: true });
    fs.writeFileSync(path.join(directory, 'bundle.js'), '// prepared test fixture');
    manifest.fixtures[key] = inventory(directory);
  }
  fs.writeFileSync(path.join(root, 'manifest.json'), JSON.stringify(manifest));
  const reachedBrowser = new Error('reached browser boundary');
  await assert.rejects(require('./assets.cjs').run({
    browser: { newPage: async () => { throw reachedBrowser; } }, name: 'chromium', output: path.join(root, 'consumer'),
  }), error => error === reachedBrowser);
});

test('planner CLI handles real PR divergence, rename/delete, push, missing history, schedule and manual events', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-ci-plan-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.name', 'CI fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.mkdirSync(path.join(directory, 'src/css'), { recursive: true });
  fs.writeFileSync(path.join(directory, 'src/css/main.css'), 'body {}');
  git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD').trim();
  git('checkout', '-qb', 'topic');
  fs.mkdirSync(path.join(directory, 'docs')); git('mv', 'src/css/main.css', 'docs/moved.md');
  git('commit', '-qm', 'rename'); const head = git('rev-parse', 'HEAD').trim();
  git('checkout', '-qb', 'base-moved', base);
  fs.writeFileSync(path.join(directory, 'package-lock.json'), '{}');
  git('add', '.'); git('commit', '-qm', 'unrelated base work'); const movedBase = git('rev-parse', 'HEAD').trim();
  const cli = path.resolve('scripts/ci-plan.cjs');
  function run(name, event) {
    const eventPath = path.join(directory, 'event.json'), output = path.join(directory, 'output'), summary = path.join(directory, 'summary');
    fs.writeFileSync(eventPath, JSON.stringify(event)); fs.writeFileSync(output, ''); fs.writeFileSync(summary, '');
    execFileSync(process.execPath, [cli], { cwd: directory, env: { ...process.env,
      GITHUB_EVENT_NAME: name, GITHUB_EVENT_PATH: eventPath, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: summary }, stdio: 'pipe' });
    return Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').map(line => {
      const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];
    }));
  }
  const pr = run('pull_request', { pull_request: { base: { sha: movedBase }, head: { sha: head } } });
  assert.equal(pr.groups, 'core,ui', 'Rename retains removed code; unrelated base commits do not inflate selection');
  assert.equal(pr.code, 'true'); assert.equal(pr.mode, 'pr');
  assert.equal(JSON.parse(pr.matrix).include.length, 5);
  assert.equal(run('push', { before: base, after: head }).groups, 'core,ui');
  assert.equal(run('push', { before: '0'.repeat(40), after: head }).groups, 'full');
  assert.equal(run('push', { before: 'a'.repeat(40), after: head }).groups, 'full');
  for (const name of ['schedule', 'workflow_dispatch', 'unknown']) {
    const result = run(name, {});
    assert.equal(result.groups, 'full'); assert.equal(result.mode, 'full');
  }
  assert.equal(run('push', { before: '0'.repeat(40), after: head }).mode, 'pr');
  assert.equal(fromEvent('push', { before: base, after: head }, () => '').code, false);

  // Exercise the workflow's real Git diff and output boundary, not only the
  // pure classifier: entry-like additions and their deletions must run full.
  git('checkout', '-q', 'topic');
  for (const file of ['src/js/index.js.map', 'src/unified/renderers.js.old', 'src/unified/index.html.gz']) {
    const before = git('rev-parse', 'HEAD').trim();
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.writeFileSync(path.join(directory, file), 'unknown entry-like file');
    git('add', file); git('commit', '-qm', 'add unknown entry-like file');
    const after = git('rev-parse', 'HEAD').trim();
    for (const result of [run('push', { before, after }),
      run('pull_request', { pull_request: { base: { sha: before }, head: { sha: after } } })]) {
      assert.equal(result.groups, 'full', file);
      assert.equal(result['build-tests'], 'true', file);
      assert.equal(result.code, 'true', file);
    }
    git('rm', '-q', file); git('commit', '-qm', 'remove unknown entry-like file');
    assert.equal(run('push', { before: after, after: git('rev-parse', 'HEAD').trim() }).groups, 'full', file);
  }
});

test('native selection retains core in Chromium, smoke in other engines and two independent standalone cases', () => {
  const cli = require.resolve('@playwright/test/cli');
  const discover = (groups, runMode = 'full', ...args) => {
    const report = JSON.parse(execFileSync(process.execPath, [cli, 'test', '--list', '--reporter=json', ...args], {
      encoding: 'utf8', maxBuffer: 10 * 1024 * 1024,
      env: { ...process.env, BROWSERS: 'chromium,firefox,webkit', ORRERY_TEST_GROUPS: groups, ORRERY_TEST_MODE: runMode },
    }));
    const rows = [];
    function visit(suite) {
      for (const spec of suite.specs || []) for (const item of spec.tests) rows.push({ title: spec.title, project: item.projectName, tags: spec.tags });
      for (const child of suite.suites || []) visit(child);
    }
    visit(report); return rows;
  };
  const core = discover('core');
  assert.equal(core.length, 25);
  for (const browser of ['firefox', 'webkit']) {
    const cases = core.filter(row => row.project === browser);
    assert.equal(cases.length, 2); assert(cases.every(row => row.tags.includes('smoke')));
  }
  assert(core.some(row => row.title.startsWith('representative production')));
  assert(!core.some(row => /benchmark|raw App lifecycle|GPU numerics, uploads/.test(row.title)));
  assert(!core.some(row => row.title.startsWith('Three scenes')), 'Full Three graphics remains outside the core budget');
  const ui = discover('core,ui');
  for (const browser of ['chromium', 'firefox', 'webkit']) {
    assert(ui.some(row => row.project === browser && row.title === 'pixel ratio and display transitions'));
    assert(ui.some(row => row.project === browser && row.title.startsWith('preview footer')));
  }
  const full = discover('full'); assert.equal(full.length, 109);
  assert(full.some(row => row.title.includes('configured promotion')));
  assert(full.some(row => row.title.includes('benchmark CLI provenance')));
  // Follow actual workflow outputs through native discovery and its shards.
  // A change to the test suite itself selects all groups, not the nightly mode.
  const routine = plan(['tests/runtime-diagnostics.cjs']);
  const expected = discover(routine.groups, routine.mode);
  assert(expected.length < full.length / 2);
  assert(expected.some(row => row.title.includes('speed-eight buffering')));
  assert(!expected.some(row => row.tags.includes('extended')));
  assert(!expected.some(row => /benchmark|raw App lifecycle|GPU numerics, uploads|Three scenes/.test(row.title)));
  for (const browser of ['firefox', 'webkit']) {
    const cases = expected.filter(row => row.project === browser);
    assert.equal(cases.length, 2); assert(cases.every(row => row.tags.includes('smoke')));
  }
  const identity = row => `${row.project}: ${row.title}`;
  const sharded = routine.matrix.include.flatMap(job => discover(routine.groups, routine.mode,
    `--project=${job.project}`, `--shard=${job.shard}`));
  assert.deepEqual(sharded.map(identity).sort(), expected.map(identity).sort());
  assert.equal(new Set(sharded.map(identity)).size, expected.length);
  const data = discover(plan(['src/unified/catalog/CatalogLoader.js']).groups, 'pr');
  assert(data.some(row => row.title.includes('catalogue frame commits')));
  assert(!data.some(row => /benchmark|development|HMR/.test(row.title) && !row.title.includes('speed-eight')));
  const css = discover(plan(['src/css/main.css']).groups, 'pr');
  assert(css.some(row => row.project === 'chromium' && row.title === 'options controls, keyboard and responsive layout'));
  for (const groups of ['core', 'full']) {
    const standalone = discover(groups, 'pr', '--config=playwright.standalone.config.cjs');
    assert.equal(standalone.length, 2); assert(standalone.every(row => row.project === 'standalone'));
  }
});

test('aggregate gate rejects failing, cancelled, missing or unexpectedly skipped selected jobs', () => {
  const baseline = { plan: { result: 'success', outputs: { code: 'true', 'build-tests': 'false' } },
    node: { result: 'success' }, build: { result: 'success' }, 'build-tests': { result: 'skipped' },
    'browser-tests': { result: 'success' }, standalone: { result: 'success' } };
  verify(baseline);
  const malformed = structuredClone(baseline); delete malformed.plan.outputs.code;
  assert.throws(() => verify(malformed));
  for (const job of ['plan', 'node', 'build', 'browser-tests', 'standalone']) {
    for (const result of ['failure', 'cancelled', 'skipped', undefined]) {
      const value = structuredClone(baseline); value[job].result = result;
      assert.throws(() => verify(value), undefined, `${job} ${result}`);
    }
  }
  const full = structuredClone(baseline); full.plan.outputs['build-tests'] = 'true';
  assert.throws(() => verify(full)); full['build-tests'].result = 'success'; verify(full);
  const docs = structuredClone(baseline); docs.plan.outputs.code = 'false';
  for (const job of ['node', 'build', 'browser-tests', 'standalone']) docs[job].result = 'skipped';
  verify(docs);
});
