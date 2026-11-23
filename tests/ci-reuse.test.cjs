const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { compatible, findSource, execution, waitForJob, artifactIds } = require('../scripts/ci-reuse.cjs');
const { plan } = require('./ci-policy.cjs');
const { verify } = require('../scripts/ci-gate.cjs');

const current = { repository: 'owner/repo', pr: 12, sha: 'a'.repeat(40), head: 'b'.repeat(40), base: 'c'.repeat(40), run: 200, workflow: 1 };
const run = { id: 100, run_attempt: 1, workflow_id: 1, event: 'pull_request', head_sha: current.head, status: 'in_progress' };
const record = () => ({ ...current, version: 1, run: run.id, attempt: 1, plan: plan(['src/unified/App.js'], { draft: true }) });

test('reuse requires the exact PR, tested merge revision, workflow and run attempt', () => {
  assert(compatible(record(), run, current));
  for (const key of ['repository', 'pr', 'sha', 'head', 'base', 'run', 'attempt', 'version']) {
    assert(!compatible({ ...record(), [key]: 'different' }, run, current), key);
  }
  for (const change of [{ id: 201 }, { workflow_id: 2 }, { event: 'push' }, { run_attempt: 2 }, { head_sha: current.base }]) {
    assert(!compatible(record(), { ...run, ...change }, current));
  }
  assert(!compatible(record(), { ...run, conclusion: 'cancelled' }, current));
  const fullRecord = { ...record(), plan: plan([], { full: true }) };
  assert(!compatible(fullRecord, run, current), 'In-flight full run would be cancelled by the new readiness event');
  assert(compatible(fullRecord, { ...run, status: 'completed', conclusion: 'success' }, current));
  assert(!compatible({ ...record(), plan: { ...record().plan, groups: 'invalid' } }, run, current));
  assert(!compatible({ ...record(), plan: { ...record().plan, code: false } }, run, current));
});

test('readiness finds completed or running coverage and handles a late receipt without rerunning tests', async () => {
  let calls = 0, pauses = 0;
  const source = await findSource(current, { runs: () => [run], record: () => ++calls < 2 ? null : record() }, { pause: async () => pauses++ });
  assert.equal(source.run, 100); assert.equal(pauses, 1);
  assert.equal((await findSource(current, { runs: () => [{ ...run, status: 'completed' }], record }, {})).run, 100);
  assert.equal(await findSource(current, { runs: () => [], record }, {}), null);
  await assert.rejects(findSource(current, { runs: () => [run], record: () => null }, { attempts: 2, pause: async () => {} }), /refusing to duplicate/);
  const full = { ...record(), plan: plan([], { full: true }) };
  const completed = { ...run, status: 'completed', conclusion: 'success' };
  const reused = { ...completed, id: 150 };
  const sources = { runs: () => [reused, completed], record: r => r.id === reused.id
    ? { ...full, run: reused.id, source: { run: run.id, attempt: 1 } } : full };
  assert.equal((await findSource(current, sources)).run, run.id, 'Repeated readiness goes back to self-contained full coverage');
  assert.equal(await findSource(current, { ...sources, runs: () => [reused] }), null);
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
    assert.equal(await findSource(current, { runs: () => [{ ...run, conclusion }], record: () => { throw new Error('Ineligible run must not be queried'); } }), null);
  }
  await assert.rejects(findSource(current, { runs: () => { throw new Error('API denied'); } }), /API denied/);
});

test('malformed coverage receipts cannot suppress required work', () => {
  const routine = { ...record(), plan: plan(['src/css/main.css']) };
  assert(compatible(routine, run, current));
  delete routine.plan.groups;
  assert(!compatible(routine, run, current), 'Missing groups must not inherit full selection from the process environment');
  for (const change of [{ matrix: { include: [] } }, { budget: 'unknown' }, { mode: 'full' },
    { matrix: { include: record().plan.matrix.include.slice(0, 1) } }, { groups: 'full' }, { code: 'true' }]) {
    assert(!compatible({ ...record(), plan: { ...record().plan, ...change } }, run, current), JSON.stringify(change));
  }
});

test('reused pending/failed/cancelled/missing checks cannot yield a passing gate', async () => {
  const source = { run: 100, attempt: 1, plan: record().plan };
  let checks = 0;
  await waitForJob({ run: () => run, jobs: () => [{ name: 'CI', status: ++checks < 2 ? 'in_progress' : 'completed', conclusion: 'success' }] }, source, 'CI', { pause: async () => {} });
  assert.equal(checks, 2);
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', 'neutral']) {
    await assert.rejects(waitForJob({ run: () => run, jobs: () => [{ name: 'CI', status: 'completed', conclusion }] }, source, 'CI'), /Source CI/);
  }
  await assert.rejects(waitForJob({ run: () => ({ ...run, status: 'completed' }), jobs: () => [] }, source, 'CI'), /did not complete/);
  await assert.rejects(waitForJob({ run: () => ({ ...run, run_attempt: 2 }), jobs: () => [] }, source, 'CI'), /was rerun/);
  let attempt = 1;
  await assert.rejects(waitForJob({ run: () => ({ ...run, run_attempt: attempt }), jobs: () => {
    attempt = 2;
    return [{ name: 'CI', status: 'completed', conclusion: 'success' }];
  } }, source, 'CI'), /was rerun/);
  await assert.rejects(waitForJob({ run: () => run, jobs: () => [] }, source, 'CI', { attempts: 1 }), /Timed out/);
  const full = plan([], { full: true });
  const jobs = execution(full, source);
  assert.equal(jobs.node, false); assert.equal(jobs.standalone, false); assert.equal(jobs['build-tests'], true);
  const needs = { plan: { result: 'success', outputs: { code: 'true', 'build-tests': 'true', execution: JSON.stringify(jobs) } } };
  for (const [job, required] of Object.entries(jobs)) needs[job] = { result: required ? 'success' : 'skipped' };
  verify(needs);
  for (const result of ['failure', 'skipped', 'cancelled']) {
    assert.throws(() => verify({ ...needs, baseline: { result } }));
  }
  const missingExecution = structuredClone(needs); delete missingExecution.plan.outputs.execution;
  assert.throws(() => verify(missingExecution));
  const noWork = structuredClone(needs);
  noWork.plan.outputs.execution = JSON.stringify(Object.fromEntries(Object.keys(jobs).map(job => [job, false])));
  assert.throws(() => verify(noWork));
  await assert.rejects(waitForJob({ run: () => ({ ...run, conclusion: 'cancelled' }),
    jobs: () => [{ name: 'CI', status: 'completed', conclusion: 'success' }] }, source, 'CI'), /Source run: cancelled/);
  assert.deepEqual(execution(full, { ...source, plan: full }),
    { node: false, build: false, 'build-tests': false, 'browser-tests': false, standalone: false, baseline: true });
});

test('artifact downloads require every expected artifact from the exact attempt', () => {
  const source = { run: 100, attempt: 1 };
  const names = ['github-pages', 'browser-fixtures', ...record().plan.matrix.include.map(job => `playwright-blob-${job.id}`), 'playwright-blob-standalone'];
  const artifacts = names.map((name, id) => ({ id: id + 7, name, created_at: '2026-11-23T12:01:00Z' }));
  const api = { artifacts: () => artifacts, run: () => run, record: () => ({ ...record(), uploadedAt: '2026-11-23T12:00:00Z' }) };
  assert.deepEqual(artifactIds(api, source, 'build'), { 'github-pages': 7, 'browser-fixtures': 8 });
  assert.deepEqual(artifactIds(api, source, 'CI'), Object.fromEntries(names.slice(2).map((name, i) => [name, i + 9])));
  for (let i = 0; i < artifacts.length; i++) {
    const incomplete = artifacts.filter((_, index) => index !== i);
    assert.throws(() => artifactIds({ ...api, artifacts: () => incomplete }, source, i < 2 ? 'build' : 'CI'), /Missing/);
    assert.throws(() => artifactIds({ ...api, artifacts: () => artifacts.map((a, index) => index === i ? { ...a, expired: true } : a) }, source, i < 2 ? 'build' : 'CI'), /Missing/);
  }
  assert.throws(() => artifactIds({ ...api, artifacts: () => artifacts.map(a => ({ ...a, created_at: '2026-11-23T11:00:00Z' })) }, source, 'build'), /Missing/);
  assert.throws(() => artifactIds({ ...api, run: () => ({ ...run, run_attempt: 2 }) }, source, 'CI'), /attempt changed/);
});

test('workflow connects reuse outputs, source gates, artifacts and remaining browser selection', () => {
  const { jobs, permissions } = require('js-yaml').load(fs.readFileSync('.github/workflows/pages.yml', 'utf8'));
  assert.equal(permissions.actions, 'read');
  assert(jobs.build['timeout-minutes'] >= 40);
  assert(jobs.plan['timeout-minutes'] >= 30);
  assert(jobs.ci.needs.includes('baseline'));
  assert(jobs.report.needs.includes('baseline'));
  assert.equal(jobs['browser-tests'].env.ORRERY_PREVIOUS_COVERAGE, '${{ needs.plan.outputs.previous }}');
  for (const name of ['node', 'build', 'build-tests', 'browser-tests', 'standalone', 'baseline']) {
    assert(jobs.plan.outputs[name], name);
    assert(jobs[name].if.includes(`needs.plan.outputs.${name}`), name);
  }
  const downloads = jobs.build.steps.filter(step => step.name?.startsWith('Reuse '));
  assert.equal(downloads.length, 2);
  for (const step of downloads) {
    assert(step.with['artifact-ids']); assert(!step.with.name);
    assert.equal(step.with['run-id'], '${{ needs.plan.outputs.source-run }}');
  }
  assert(jobs.ci.steps.some(step => step.run === 'node scripts/ci-reuse.cjs CI --gate-only'));
});

test('real planner CLI discovers and validates an earlier run through the gh artifact boundary', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-reuse-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  fs.mkdirSync(path.join(root, 'src/css'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/css/main.css'), 'body {}');
  git('add', '.'); git('commit', '-qm', 'base'); const base = git('rev-parse', 'HEAD');
  fs.appendFileSync(path.join(root, 'src/css/main.css'), 'body {color: red}');
  git('commit', '-am', 'head', '-q'); const head = git('rev-parse', 'HEAD');
  const source = { ...run, id: 41, head_sha: head, status: 'in_progress' };
  const receipt = { version: 1, repository: 'owner/repo', pr: 12, sha: head, head, base,
    run: 41, attempt: 1, plan: plan(['src/css/main.css'], { draft: true }) };
  fs.writeFileSync(path.join(root, 'ci-plan.json'), JSON.stringify(receipt));
  execFileSync('zip', ['-q', 'receipt.zip', 'ci-plan.json'], { cwd: root });
  const gh = path.join(root, 'gh');
  fs.writeFileSync(gh, `#!${process.execPath}
const fs=require('node:fs');const url=process.argv[3];
const source=${JSON.stringify(source)};
if(process.env.FAKE_GH_DENIED)throw new Error('Actions read permission denied');
if(url.endsWith('/artifacts/7/zip'))process.stdout.write(fs.readFileSync(${JSON.stringify(path.join(root, 'receipt.zip'))}));
else {let result;
if(url.endsWith('/runs/42'))result={workflow_id:1};
else if(url.includes('/workflows/1/runs?'))result={workflow_runs:url.endsWith('page=1')?Array.from({length:100},(_,i)=>({...source,id:1000+i})):[source]};
else if(url.includes('/runs/41/artifacts?'))result={artifacts:url.endsWith('page=1')?Array.from({length:100},(_,i)=>({id:1000+i,name:'old',expired:true})):[{id:7,name:'ci-plan-1',size_in_bytes:400}]};
else throw new Error(url);
process.stdout.write(JSON.stringify(result));}
`);
  fs.chmodSync(gh, 0o755);
  const event = path.join(root, 'event.json'), output = path.join(root, 'output');
  fs.writeFileSync(event, JSON.stringify({ action: 'ready_for_review', number: 12,
    pull_request: { number: 12, draft: false, base: { sha: base }, head: { sha: head } } }));
  const options = { cwd: root, encoding: 'utf8', stdio: 'pipe', env: {
    ...process.env, PATH: root + path.delimiter + process.env.PATH, GH_TOKEN: 'fixture', GITHUB_REPOSITORY: 'owner/repo',
    GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: head, GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: path.join(root, 'summary'),
  } };
  const invoke = env => execFileSync(process.execPath, [path.resolve('scripts/ci-plan.cjs')], { ...options, env: { ...options.env, ...env } });
  invoke();
  const values = Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').map(line => {
    const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];
  }));
  assert.equal(values['source-run'], '41'); assert.equal(values['source-attempt'], '1');
  assert.equal(values.node, 'false'); assert.equal(values.standalone, 'false');
  assert.equal(values['browser-tests'], 'true'); assert.equal(values['build-tests'], 'true');
  assert.equal(values.baseline, 'true');
  assert.deepEqual(JSON.parse(values.previous), { mode: 'pr', groups: 'core', projects: ['chromium', 'chromium-only'] });
  const saved = JSON.parse(fs.readFileSync(path.join(root, '.context/ci-plan.json')));
  assert.equal(saved.sha, head); assert.equal(saved.source.run, 41);
  assert.throws(() => invoke({ GITHUB_SHA: base }), /Checkout does not match/);
  assert.throws(() => invoke({ FAKE_GH_DENIED: '1' }), /Actions read permission denied/);
  fs.writeFileSync(path.join(root, 'ci-plan.json'), '{broken');
  execFileSync('zip', ['-q', 'receipt.zip', 'ci-plan.json'], { cwd: root });
  assert.throws(() => invoke(), /JSON/);
});

test('native blob merge retains disjoint source and readiness results despite matching filenames', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-merge-reports-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cli = require.resolve('@playwright/test/cli');
  const config = path.join(root, 'playwright.config.cjs');
  fs.writeFileSync(config, `module.exports = { testDir: ${JSON.stringify(root)}, reporter: 'blob' };`);
  fs.writeFileSync(path.join(root, 'coverage.spec.cjs'), `const { test, expect } = require(${JSON.stringify(require.resolve('@playwright/test'))});
    test('covered in draft', () => expect(1).toBe(1));
    test('added when ready', () => expect(2).toBe(2));`);
  const combined = path.join(root, 'combined'); fs.mkdirSync(combined);
  for (const [part, grep] of [['source', 'covered in draft'], ['current', 'added when ready']]) {
    const blobs = path.join(root, part);
    execFileSync(process.execPath, [cli, 'test', '--config', config, '--grep', grep], {
      cwd: root, stdio: 'pipe', env: { ...process.env, PLAYWRIGHT_BLOB_OUTPUT_DIR: blobs, PLAYWRIGHT_BLOB_OUTPUT_NAME: 'report-chromium-1.zip' },
    });
    fs.copyFileSync(path.join(blobs, 'report-chromium-1.zip'), path.join(combined, `${part}-report-chromium-1.zip`));
  }
  const report = JSON.parse(execFileSync(process.execPath, [cli, 'merge-reports', '--reporter=json', combined], { cwd: root, encoding: 'utf8' }));
  assert.equal(report.stats.expected, 2); assert.equal(report.stats.unexpected, 0);
  assert.deepEqual(report.suites.flatMap(suite => suite.specs.map(spec => spec.title)).sort(), ['added when ready', 'covered in draft']);
});
