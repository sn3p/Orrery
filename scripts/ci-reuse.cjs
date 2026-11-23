// Reuse evidence from an earlier run of this exact tested merge revision.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { selection, plan } = require('../tests/ci-policy.cjs');

function validPlan(p) {
  if (p?.code !== true || typeof p.buildTests !== 'boolean' || typeof p.groups !== 'string'
    || !['draft', 'routine', 'full'].includes(p.budget)) return false;
  try { selection(p.groups); } catch { return false; }
  const expected = plan(['package.json'], { draft: p.budget === 'draft', full: p.budget === 'full' });
  return p.mode === expected.mode && isDeepStrictEqual(p.matrix, expected.matrix)
    && (p.budget !== 'draft' || p.groups === 'core')
    && (p.budget !== 'full' || (p.groups === 'full' && p.buildTests));
}

function eligibleRun(run, current) {
  return Number.isSafeInteger(run.id) && run.id < current.run
    && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0
    && run.workflow_id === current.workflow && run.event === 'pull_request' && run.head_sha === current.head
    && run.status === 'completed' && run.conclusion === 'success';
}

function compatible(record, run, current) {
  if (record?.version !== 1 || record.repository !== current.repository || record.pr !== current.pr
    || record.sha !== current.sha || record.head !== current.head || record.base !== current.base
    || record.run !== run.id || record.attempt !== run.run_attempt || !eligibleRun(run, current)) return false;
  // A receipt with dependencies does not own all the artifacts it claims as
  // coverage. Select a self-contained source rather than trusting stale ancestors.
  if (record.source) return false;
  return validPlan(record.plan);
}

function apiClient(repository, { now = Date.now, timeoutMs = 120000, execute = execFileSync } = {}) {
  const prefix = `repos/${repository}/actions`;
  const deadline = now() + timeoutMs;
  const command = (file, args, options) => {
    const remaining = deadline - now();
    if (remaining <= 0) throw new Error('CI reuse lookup exceeded its time budget');
    try {
      const result = execute(file, args, { ...options, timeout: Math.min(60000, remaining) });
      if (now() >= deadline) throw new Error('CI reuse lookup exceeded its time budget');
      return result;
    }
    catch (error) {
      if (error.code === 'ETIMEDOUT') throw new Error('CI reuse lookup exceeded its time budget', { cause: error });
      throw error;
    }
  };
  const api = endpoint => JSON.parse(command('gh', ['api', `${prefix}/${endpoint}`], { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }));
  const pages = (endpoint, key) => {
    const rows = [];
    for (let page = 1; ; page++) {
      const result = api(`${endpoint}${endpoint.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      const batch = result?.[key];
      if (!Array.isArray(batch)) throw new Error(`Unexpected Actions API response for ${endpoint}: expected ${key} array`);
      rows.push(...batch);
      if (batch.length < 100) return rows;
    }
  };
  const client = {
    run: id => api(`runs/${id}`),
    runs: (workflow, head) => pages(`workflows/${workflow}/runs?event=pull_request&head_sha=${head}`, 'workflow_runs'),
    jobs: (id, attempt) => pages(`runs/${id}/attempts/${attempt}/jobs`, 'jobs'),
    artifacts: id => pages(`runs/${id}/artifacts`, 'artifacts'),
    record: (run, artifacts = client.artifacts(run.id)) => {
      const artifact = artifacts.find(a => a.name === `ci-plan-${run.run_attempt}` && !a.expired);
      if (!artifact || artifact.size_in_bytes > 1024 * 1024) return null;
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-ci-record-'));
      try {
        const zip = path.join(directory, 'record.zip');
        fs.writeFileSync(zip, command('gh', ['api', `${prefix}/artifacts/${artifact.id}/zip`], { maxBuffer: 1024 * 1024 }));
        const record = JSON.parse(command('unzip', ['-p', zip, 'ci-plan.json'], { encoding: 'utf8', maxBuffer: 1024 * 1024 }));
        return { ...record, uploadedAt: artifact.created_at };
      } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    },
  };
  return client;
}

function findSource(current, api) {
  // Running sources can be cancelled by a fixup. Never make readiness depend on
  // them or wait for receipts a partial rerun will not upload.
  const runs = api.runs(current.workflow, current.head).filter(run => eligibleRun(run, current)).sort((a, b) => b.id - a.id);
  for (const run of runs) {
    try {
      const artifacts = api.artifacts(run.id);
      const record = api.record(run, artifacts);
      if (!compatible(record, run, current)) continue;
      const source = { run: run.id, attempt: run.run_attempt, plan: record.plan };
      const reports = selectArtifactIds(artifacts, record, 'CI');
      // Partial coverage needs the public build and fixtures too. Pages artifacts
      // expire sooner than receipts/reports; reject the candidate before reuse.
      if (execution(record.plan, source).build) selectArtifactIds(artifacts, record, 'build');
      if (api.run(run.id).run_attempt !== source.attempt) throw new Error('Source attempt changed while selecting artifacts');
      return { ...source, reports };
    } catch (error) {
      console.error(`Skipping reuse candidate ${run.id}: ${error.message}`);
    }
  }
  return null;
}

function execution(plan, source) {
  const complete = !!source && source.plan.mode === 'full' && source.plan.groups === 'full';
  return {
    node: plan.code && !source,
    build: plan.code && !complete,
    'build-tests': plan.buildTests && !source?.plan.buildTests,
    'browser-tests': plan.code && !complete,
    standalone: plan.code && !source,
  };
}

function verifyJob(api, source, name) {
  const checkRun = () => {
    const run = api.run(source.run);
    if (run.run_attempt !== source.attempt) throw new Error('Source run was rerun; rerun this verification to select its new attempt');
    if (run.status !== 'completed' || run.conclusion !== 'success') throw new Error('Source run is not completed successfully');
  };
  checkRun();
  const job = api.jobs(source.run, source.attempt).find(job => job.name === name);
  if (job?.status !== 'completed' || job.conclusion !== 'success') {
    throw new Error(`Source ${name} did not complete successfully`);
  }
  checkRun();
}

function selectArtifactIds(artifacts, receipt, name) {
  const plannedAt = Date.parse(receipt.uploadedAt);
  if (!Number.isFinite(plannedAt)) throw new Error('Missing source receipt upload time');
  const keys = name === 'build' ? ['github-pages', 'browser-fixtures']
    : [...receipt.plan.matrix.include.map(job => `playwright-blob-${job.id}`), 'playwright-blob-standalone'];
  return Object.fromEntries(keys.map(key => {
    // Never mix leftovers from a prior attempt with this attempt's receipt.
    const artifact = artifacts.find(item => item.name === key && !item.expired && Date.parse(item.created_at) >= plannedAt);
    if (!artifact) throw new Error(`Missing source artifact: ${key}`);
    return [key, artifact.id];
  }));
}

function artifactIds(api, source, name) {
  const artifacts = api.artifacts(source.run);
  const run = api.run(source.run);
  const receipt = api.record(run, artifacts);
  if (receipt?.run !== source.run || receipt?.attempt !== source.attempt || receipt.source || !validPlan(receipt?.plan)) {
    throw new Error('Missing or incompatible source receipt');
  }
  const selected = selectArtifactIds(artifacts, receipt, name);
  if (api.run(source.run).run_attempt !== source.attempt) throw new Error('Source attempt changed while selecting artifacts');
  return selected;
}

if (require.main === module) {
  const source = { run: Number(process.env.CI_SOURCE_RUN), attempt: Number(process.env.CI_SOURCE_ATTEMPT) };
  if (!Number.isSafeInteger(source.run) || source.run <= 0 || !Number.isSafeInteger(source.attempt) || source.attempt <= 0) throw new Error('Invalid source run identity');
  const api = apiClient(process.env.GITHUB_REPOSITORY);
  const name = process.argv[2] || 'CI';
  try {
    verifyJob(api, source, name);
    if (process.env.GITHUB_OUTPUT && !process.argv.includes('--gate-only')) {
      const ids = artifactIds(api, source, name);
      const values = name === 'build' ? { pages: ids['github-pages'], fixtures: ids['browser-fixtures'] }
        : { reports: Object.values(ids).join(',') };
      fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
    }
  } catch (error) { console.error(error); process.exitCode = 1; }
}
module.exports = { compatible, apiClient, findSource, execution, verifyJob, artifactIds };
