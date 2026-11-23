const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { compatible, findSource, execution, verifyJob, artifactIds, apiClient } = require('../scripts/ci-reuse.cjs');
const { plan } = require('./ci-policy.cjs');
const { verify } = require('../scripts/ci-gate.cjs');

const current = { repository: 'owner/repo', pr: 12, sha: 'a'.repeat(40), head: 'b'.repeat(40), base: 'c'.repeat(40), run: 200, workflow: 1 };
const run = { id: 100, run_attempt: 1, workflow_id: 1, event: 'pull_request', head_sha: current.head, status: 'completed', conclusion: 'success' };
const record = () => ({ ...current, version: 1, run: run.id, attempt: 1, uploadedAt: '2026-11-23T12:00:00Z', plan: plan(['src/unified/App.js'], { draft: true }) });

const sourceArtifacts = (receipt = record()) => ['github-pages', 'browser-fixtures',
  ...receipt.plan.matrix.include.map(job => `playwright-blob-${job.id}`), 'playwright-blob-standalone']
  .map((name, i) => ({ name, id: i + 7, created_at: '2026-11-23T12:01:00Z' }));
const sourceApi = { runs: () => [run], run: () => run, artifacts: () => sourceArtifacts(), record };

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
  assert(!compatible(fullRecord, { ...run, status: 'in_progress', conclusion: null }, current), 'In-flight coverage is not reusable');
  assert(compatible(fullRecord, { ...run, status: 'completed', conclusion: 'success' }, current));
  assert(!compatible({ ...record(), plan: { ...record().plan, groups: 'invalid' } }, run, current));
  assert(!compatible({ ...record(), plan: { ...record().plan, code: false } }, run, current));
});

test('readiness selects completed successful coverage once, ignoring pending and partial reruns', () => {
  for (const status of ['queued', 'in_progress']) {
    for (const attempt of [1, 2]) {
      const running = { ...run, status, run_attempt: attempt, conclusion: null };
      assert.equal(findSource(current, { runs: () => [running], record: () => { throw new Error('Must not wait for or fetch a pending receipt'); } }), null);
    }
  }
  let reads = 0;
  assert.equal(findSource(current, { ...sourceApi, record: () => { reads++; return null; } }), null);
  assert.equal(reads, 1, 'A missing partial-rerun receipt is inspected once');
  assert.equal(findSource(current, sourceApi).run, 100);
  assert.equal(findSource(current, { runs: () => [], record }), null);
  const full = { ...record(), plan: plan([], { full: true }) };
  const reused = { ...run, id: 150 };
  const sources = { ...sourceApi, artifacts: () => sourceArtifacts(full), runs: () => [reused, run], record: r => r.id === reused.id
    ? { ...full, run: reused.id, source: { run: run.id, attempt: 1 } } : full };
  assert.equal(findSource(current, sources).run, run.id, 'Repeated readiness goes back to self-contained full coverage');
  assert.equal(findSource(current, { ...sources, runs: () => [reused] }), null);
  for (const conclusion of ['failure', 'cancelled', 'timed_out']) {
    assert.equal(findSource(current, { runs: () => [{ ...run, conclusion }], record: () => { throw new Error('Ineligible run must not be queried'); } }), null);
  }
  assert.throws(() => findSource(current, { runs: () => { throw new Error('API denied'); } }), /API denied/);
});

test('candidate selection skips corrupt receipts and reuses one validated artifact snapshot', () => {
  const newer = { ...run, id: 150 };
  const calls = [];
  const artifacts = sourceArtifacts();
  const api = { ...sourceApi, runs: () => [newer, run],
    artifacts: id => { calls.push(`artifacts:${id}`); return artifacts; },
    record: (candidate, listed) => {
      assert.equal(listed, artifacts); calls.push(`record:${candidate.id}`);
      if (candidate.id === newer.id) throw new SyntaxError('Corrupt JSON');
      return record();
    }, run: id => { calls.push(`run:${id}`); return run; } };
  assert.equal(findSource(current, api).run, run.id);
  assert.deepEqual(calls, ['artifacts:150', 'record:150', 'artifacts:100', 'record:100', 'run:100']);
  assert.equal(findSource(current, { ...sourceApi, record: () => { throw new Error('Invalid zip'); } }), null);
  assert.equal(findSource(current, { ...sourceApi, run: () => ({ ...run, run_attempt: 2 }) }), null);
});

test('unexpected API list responses identify the endpoint and expected collection', () => {
  for (const response of [null, {}, { artifacts: {} }, { artifacts: null }, { artifacts: 'bad' }]) {
    const api = apiClient('owner/repo', { execute: () => JSON.stringify(response) });
    assert.throws(() => api.artifacts(100), /Unexpected Actions API response for runs\/100\/artifacts: expected artifacts array/);
  }
  const api = apiClient('owner/repo', { execute: () => '{broken' });
  assert.throws(() => api.runs(1, current.head), /JSON/);
});

test('API pagination and downloads share a wall-clock deadline', () => {
  let time = 0;
  const timeouts = [];
  const api = apiClient('owner/repo', { now: () => time, timeoutMs: 100,
    execute: (_file, _args, options) => {
      timeouts.push(options.timeout); time += 60;
      return JSON.stringify({ workflow_runs: Array.from({ length: 100 }, () => run) });
    } });
  assert.throws(() => api.runs(1, current.head), /time budget/);
  assert.deepEqual(timeouts, [100, 40], 'Later requests receive only remaining time');
  const stalled = apiClient('owner/repo', { execute: () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); } });
  assert.throws(() => stalled.run(100), /time budget/);
  const download = apiClient('owner/repo', { now: () => time, timeoutMs: 100, execute: (_file, args, options) => {
    if (args[1].includes('/artifacts?')) { time += 80; return JSON.stringify({ artifacts: [{ id: 7, name: 'ci-plan-1', size_in_bytes: 100 }] }); }
    assert.equal(options.timeout, 20);
    throw Object.assign(new Error('slow download'), { code: 'ETIMEDOUT' });
  } });
  assert.throws(() => download.record(run), /time budget/);
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

test('source checks and final gate reject pending, failed, cancelled or rerun evidence immediately', () => {
  const source = { run: 100, attempt: 1, plan: record().plan };
  const passed = { name: 'CI', status: 'completed', conclusion: 'success' };
  verifyJob({ run: () => run, jobs: () => [passed] }, source, 'CI');
  for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out', 'neutral']) {
    assert.throws(() => verifyJob({ run: () => run, jobs: () => [{ ...passed, conclusion }] }, source, 'CI'), /Source CI/);
  }
  assert.throws(() => verifyJob({ run: () => run, jobs: () => [] }, source, 'CI'), /did not complete/);
  assert.throws(() => verifyJob({ run: () => ({ ...run, run_attempt: 2 }), jobs: () => [] }, source, 'CI'), /was rerun/);
  let attempt = 1;
  assert.throws(() => verifyJob({ run: () => ({ ...run, run_attempt: attempt }), jobs: () => {
    attempt = 2; return [passed];
  } }, source, 'CI'), /was rerun/);
  for (const state of [{ status: 'in_progress', conclusion: null }, { conclusion: 'cancelled' }]) {
    assert.throws(() => verifyJob({ run: () => ({ ...run, ...state }), jobs: () => [passed] }, source, 'CI'), /not completed successfully/);
  }
  const full = plan([], { full: true });
  for (const buildReused of [true, false]) {
    const jobs = execution(full, { ...source, plan: { ...source.plan, buildTests: buildReused } });
    assert.equal(jobs.node, false); assert.equal(jobs.standalone, false);
    const needs = { plan: { result: 'success', outputs: { code: 'true', 'build-required': 'true', 'build-reused': String(buildReused), execution: JSON.stringify(jobs) } } };
    for (const [job, required] of Object.entries(jobs)) needs[job] = { result: required ? 'success' : 'skipped' };
    verify(needs);
    for (const result of ['failure', 'skipped', 'cancelled']) assert.throws(() => verify({ ...needs, baseline: { result } }));
    const missingExecution = structuredClone(needs); delete missingExecution.plan.outputs.execution;
    assert.throws(() => verify(missingExecution));
    // A required integration cannot disappear just because the execution map says skip.
    needs.plan.outputs['build-reused'] = 'false';
    needs.plan.outputs.execution = JSON.stringify({ ...jobs, 'build-tests': false });
    assert.throws(() => verify(needs), /Inconsistent execution/);
  }
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
  assert.equal(jobs.build['timeout-minutes'], 10);
  for (const name of ['plan', 'baseline', 'ci']) assert.equal(jobs[name]['timeout-minutes'], 5);
  assert(jobs.ci.needs.includes('baseline'));
  assert(!jobs.report.needs.includes('baseline'));
  assert.equal(jobs.baseline.needs, 'plan');
  assert(jobs.plan.outputs['source-reports']);
  assert(jobs.plan.outputs['source-report-manifest']);
  const sourceReports = jobs.report.steps.find(step => step.name === 'Include the reused source reports');
  assert.equal(sourceReports.with['artifact-ids'], '${{ needs.plan.outputs.source-reports }}');
  assert.equal(sourceReports.with['merge-multiple'], false);
  const combine = jobs.report.steps.find(step => step.name === 'Combine disjoint reports');
  assert.equal(combine.env.CI_SOURCE_REPORTS, '${{ needs.plan.outputs.source-report-manifest }}');
  assert(jobs.report.steps.indexOf(combine) < jobs.report.steps.findIndex(step => step.name === 'Merge reports'));
  assert.equal(sourceReports.if, "needs.plan.outputs.source-run != ''");
  const needs = { plan: { outputs: { 'browser-tests': 'true', 'source-run': '100' } },
    'browser-tests': { result: 'failure' }, standalone: { result: 'skipped' }, baseline: { result: 'failure' } };
  // Actions permits hyphens in property names; JS needs bracket notation.
  const expression = value => value.replace(/^\$\{\{|\}\}$/g, '').replace(/\.([a-z]+(?:-[a-z]+)+)/g, "['$1']");
  assert(Function('needs', 'cancelled', `return (${expression(jobs.report.if)});`)(needs, () => false), 'Current failures must not suppress reports');
  assert(Function('needs', `return (${expression(sourceReports.if)});`)(needs), 'Source reports remain included after baseline failure');
  assert(jobs.ci.steps.findIndex(step => step.run === 'node scripts/ci-gate.cjs') < jobs.ci.steps.findIndex(step => step.run === 'node scripts/ci-reuse.cjs CI --gate-only'));
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
  const source = { ...run, id: 41, head_sha: head };
  const receipt = { version: 1, repository: 'owner/repo', pr: 12, sha: head, head, base,
    run: 41, attempt: 1, plan: plan(['src/css/main.css'], { draft: true }) };
  fs.writeFileSync(path.join(root, 'ci-plan.json'), JSON.stringify(receipt));
  execFileSync('zip', ['-q', 'receipt.zip', 'ci-plan.json'], { cwd: root });
  const artifacts = ['ci-plan-1', ...receipt.plan.matrix.include.map(job => `playwright-blob-${job.id}`), 'playwright-blob-standalone', 'github-pages', 'browser-fixtures'].map((name, i) => ({ name, id: i + 7, size_in_bytes: 400, created_at: '2026-11-23T12:00:00Z' }));
  const gh = path.join(root, 'gh');
  fs.writeFileSync(gh, `#!${process.execPath}
const fs=require('node:fs');const url=process.argv[3];
const source=${JSON.stringify(source)};
if(process.env.FAKE_GH_DENIED)throw new Error('Actions read permission denied');
if(url.endsWith('/artifacts/7/zip'))process.stdout.write(fs.readFileSync(${JSON.stringify(path.join(root, 'receipt.zip'))}));
else {let result;
if(url.endsWith('/runs/42'))result={workflow_id:1};
else if(url.endsWith('/runs/41'))result=source;
else if(url.includes('/workflows/1/runs?'))result={workflow_runs:url.endsWith('page=1')?Array.from({length:100},(_,i)=>({...source,id:1000+i})):[source]};
else if(url.includes('/runs/41/artifacts?'))result={artifacts:url.endsWith('page=1')?Array.from({length:100},(_,i)=>({id:1000+i,name:'old',expired:true})):${JSON.stringify(artifacts)}.filter(a=>a.name!==process.env.FAKE_MISSING_ARTIFACT).map(a=>({...a,expired:a.name===process.env.FAKE_EXPIRED_ARTIFACT}))};
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
  assert.equal(values['build-required'], 'true'); assert.equal(values['build-reused'], 'false');
  assert.equal(values['source-reports'], artifacts.slice(1, -2).map(a => a.id).join(','));
  assert.deepEqual(JSON.parse(values['source-report-manifest']), Object.fromEntries(artifacts.slice(1, -2).map(a => [a.name, a.id])));
  const summary = fs.readFileSync(options.env.GITHUB_STEP_SUMMARY, 'utf8');
  for (const text of ['Mode: **full**', 'Code checks: **true**', 'Build integrations required: **true**', 'Draft PRs run Chromium core', 'Artifacts → browser-test-report']) assert(summary.includes(text), text);
  assert.deepEqual(JSON.parse(values.previous), { mode: 'pr', groups: 'core', projects: ['chromium', 'chromium-only'] });
  const saved = JSON.parse(fs.readFileSync(path.join(root, '.context/ci-plan.json')));
  assert.equal(saved.sha, head); assert.equal(saved.source.run, 41);
  receipt.plan.buildTests = true;
  fs.writeFileSync(path.join(root, 'ci-plan.json'), JSON.stringify(receipt));
  execFileSync('zip', ['-q', 'receipt.zip', 'ci-plan.json'], { cwd: root });
  fs.writeFileSync(output, ''); invoke();
  const reused = fs.readFileSync(output, 'utf8');
  assert.match(reused, /build-required=true\n/); assert.match(reused, /build-reused=true\n/); assert.match(reused, /(?:^|\n)build-tests=false\n/);
  assert.throws(() => invoke({ GITHUB_SHA: base }), /Checkout does not match/);
  const fallback = env => {
    fs.writeFileSync(output, ''); invoke(env);
    const values = Object.fromEntries(fs.readFileSync(output, 'utf8').trim().split('\n').map(line => {
      const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)];
    }));
    assert.equal(values['source-run'], ''); assert.equal(values.previous, '');
    assert.equal(values.mode, 'full'); assert.equal(values['source-reports'], '');
    for (const job of ['node', 'build', 'build-tests', 'browser-tests', 'standalone']) assert.equal(values[job], 'true', job);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.context/ci-plan.json'))).source, null);
  };
  fallback({ FAKE_GH_DENIED: '1' });
  for (const name of ['github-pages', 'browser-fixtures', 'playwright-blob-chromium-1', 'playwright-blob-standalone']) {
    fallback({ FAKE_MISSING_ARTIFACT: name }); fallback({ FAKE_EXPIRED_ARTIFACT: name });
  }
  fs.writeFileSync(path.join(root, 'ci-plan.json'), '{broken');
  execFileSync('zip', ['-q', 'receipt.zip', 'ci-plan.json'], { cwd: root });
  fallback();
});

test('report assembly rejects incomplete downloads before merging', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-incomplete-reports-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync('scripts', path.join(root, 'scripts'), { recursive: true });
  const workflow = require('js-yaml').load(fs.readFileSync('.github/workflows/pages.yml', 'utf8'));
  const step = workflow.jobs.report.steps.find(step => step.name === 'Combine disjoint reports');
  const manifest = { 'playwright-blob-chromium-1': 101, 'playwright-blob-chromium-2': 102, 'playwright-blob-standalone': 103 };
  const sources = path.join(root, '.context/source-reports');
  const combine = () => execFileSync('bash', ['-eu', '-c', step.run], {
    cwd: root, stdio: 'pipe', env: { ...process.env, CI_SOURCE_REPORTS: JSON.stringify(manifest) },
  });
  // The pinned downloader flattens its output when only one requested artifact remains.
  fs.mkdirSync(sources, { recursive: true });
  fs.writeFileSync(path.join(sources, 'report.zip'), 'surviving blob');
  assert.throws(combine, /Missing source report/, 'One surviving artifact must not pass');
  fs.rmSync(sources, { recursive: true });
  for (const name of Object.keys(manifest)) {
    fs.mkdirSync(path.join(sources, name), { recursive: true });
    fs.writeFileSync(path.join(sources, name, 'report.zip'), 'blob');
  }
  for (const name of Object.keys(manifest)) {
    const blob = path.join(sources, name, 'report.zip');
    fs.unlinkSync(blob);
    assert.throws(combine, /Expected one source report blob/, name);
    fs.writeFileSync(blob, 'blob');
  }
  fs.rmSync(path.join(sources, 'playwright-blob-standalone'), { recursive: true });
  assert.throws(combine, /Missing source report/, 'Two surviving artifacts must not pass');
  assert(!fs.existsSync(path.join(root, '.context/playwright-blob')), 'Validate the whole set before copying');
});

test('workflow report assembly retains source-only diagnostics and disjoint readiness results', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-merge-reports-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cli = require.resolve('@playwright/test/cli');
  const config = path.join(root, 'playwright.config.cjs');
  fs.writeFileSync(config, `module.exports = { testDir: ${JSON.stringify(root)}, reporter: 'blob' };`);
  fs.writeFileSync(path.join(root, 'coverage.spec.cjs'), `const { test, expect } = require(${JSON.stringify(require.resolve('@playwright/test'))});
    test('covered in draft', () => expect(1).toBe(1));
    test('standalone in draft', () => expect(3).toBe(3));
    test('added when ready', () => expect(2).toBe(2));`);
  const combined = path.join(root, '.context/playwright-blob');
  const sources = path.join(root, '.context/source-reports'); fs.mkdirSync(sources, { recursive: true });
  const manifest = { 'playwright-blob-chromium-1': 101, 'playwright-blob-standalone': 102 };
  fs.cpSync('scripts', path.join(root, 'scripts'), { recursive: true });
  for (const [part, grep] of [['playwright-blob-chromium-1', 'covered in draft'], ['playwright-blob-standalone', 'standalone in draft'], ['current', 'added when ready']]) {
    const blobs = path.join(root, part);
    execFileSync(process.execPath, [cli, 'test', '--config', config, '--grep', grep], {
      cwd: root, stdio: 'pipe', env: { ...process.env, PLAYWRIGHT_BLOB_OUTPUT_DIR: blobs, PLAYWRIGHT_BLOB_OUTPUT_NAME: 'report-chromium-1.zip' },
    });
    if (part !== 'current') {
      fs.mkdirSync(path.join(sources, part));
      fs.copyFileSync(path.join(blobs, 'report-chromium-1.zip'), path.join(sources, part, 'report-chromium-1.zip'));
    }
  }
  const workflow = require('js-yaml').load(fs.readFileSync('.github/workflows/pages.yml', 'utf8'));
  execFileSync('bash', ['-eu', '-c', workflow.jobs.report.steps.find(step => step.name === 'Combine disjoint reports').run], {
    cwd: root, env: { ...process.env, CI_SOURCE_REPORTS: JSON.stringify(manifest) },
  });
  const merge = () => JSON.parse(execFileSync(process.execPath, [cli, 'merge-reports', '--reporter=json', combined], { cwd: root, encoding: 'utf8' }));
  assert.equal(merge().stats.expected, 2, 'Source evidence remains when the current build/browser job produced no blobs');
  fs.copyFileSync(path.join(root, 'current/report-chromium-1.zip'), path.join(combined, 'report-chromium-1.zip'));
  const report = merge();
  assert.equal(report.stats.expected, 3); assert.equal(report.stats.unexpected, 0);
  assert.deepEqual(report.suites.flatMap(suite => suite.specs.map(spec => spec.title)).sort(), ['added when ready', 'covered in draft', 'standalone in draft']);
});
