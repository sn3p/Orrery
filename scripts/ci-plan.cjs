const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const { plan } = require('../tests/ci-policy.cjs');

function changedFiles(eventName, event, git = (...args) => execFileSync('git', args, { encoding: 'utf8' })) {
  const pr = eventName === 'pull_request';
  const base = pr ? event.pull_request?.base?.sha : event.before;
  const head = pr ? event.pull_request?.head?.sha : event.after;
  if (![base, head].every(sha => /^[a-f0-9]{40}$/.test(sha || '') && !/^0+$/.test(sha))) throw new Error('No trustworthy change range');
  // --no-renames includes BOTH sides: moving graphics into docs must not skip it.
  return git('diff', '--name-only', '--no-renames', '-z', pr ? `${base}...${head}` : `${base}..${head}`)
    .split('\0').filter(Boolean);
}
// A PR becomes ready for review when it is marked ready or opened as ready.
const readyEvent = (eventName, event) => eventName === 'pull_request'
  && (event.action === 'ready_for_review' || (event.action === 'opened' && !event.pull_request?.draft));
function fromEvent(eventName, event, git) {
  if (eventName === 'schedule' || eventName === 'workflow_dispatch') return plan([], { full: true });
  if (!['pull_request', 'push'].includes(eventName)) return plan([], { full: true });
  let files;
  try { files = changedFiles(eventName, event, git); }
  catch (error) { console.error(`Selecting all PR groups: ${error.message}`); files = ['<unknown-change-range>']; }
  if (eventName === 'pull_request' && event.pull_request?.draft) return plan(files, { draft: true });
  // Becoming ready runs the nightly matrix once; documentation-only PRs still skip.
  if (readyEvent(eventName, event) && plan(files).code) return plan(files, { full: true });
  return plan(files);
}
async function main() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const result = fromEvent(process.env.GITHUB_EVENT_NAME, event);
  const { apiClient, findSource, execution, artifactIds } = require('./ci-reuse.cjs');
  const testedSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (process.env.GITHUB_SHA && testedSha !== process.env.GITHUB_SHA) throw new Error('Checkout does not match the event revision');
  const current = { version: 1, repository: process.env.GITHUB_REPOSITORY, pr: event.pull_request?.number || event.number,
    sha: testedSha, head: event.pull_request?.head?.sha, base: event.pull_request?.base?.sha,
    run: Number(process.env.GITHUB_RUN_ID), attempt: Number(process.env.GITHUB_RUN_ATTEMPT) };
  let source = null;
  let reports = {};
  if (readyEvent(process.env.GITHUB_EVENT_NAME, event) && result.code && process.env.GH_TOKEN) {
    const api = apiClient(current.repository);
    current.workflow = api.run(current.run).workflow_id;
    source = findSource(current, api);
    if (source) reports = artifactIds(api, source, 'CI');
  }
  const jobs = execution(result, source);
  const previous = source ? { mode: source.plan.mode, groups: source.plan.groups,
    projects: [...new Set(source.plan.matrix.include.map(job => job.project))] } : null;
  const values = { code: result.code, groups: result.groups, mode: result.mode, budget: result.budget,
    matrix: JSON.stringify(result.matrix), execution: JSON.stringify(jobs),
    'source-run': source?.run || '', 'source-attempt': source?.attempt || '',
    'source-reports': Object.values(reports).join(','), 'source-report-manifest': JSON.stringify(reports),
    'build-required': result.buildTests, 'build-reused': !!source?.plan.buildTests,
    previous: previous ? JSON.stringify(previous) : '', ...jobs };
  fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
  fs.mkdirSync('.context', { recursive: true });
  fs.writeFileSync('.context/ci-plan.json', JSON.stringify({ ...current, plan: result, source }, null, 2));
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Test plan\n\nBudget: **${result.budget}**. Mode: **${result.mode}**. Groups: **${result.groups}**. Code checks: **${result.code}**. Build integrations required: **${result.buildTests}**; reused: **${values['build-reused']}**; run here: **${jobs['build-tests']}**.\n\n`
    + 'Draft PRs run Chromium core. Readiness requires full coverage; later pushes use the routine affected-group budget. Nightly/manual runs are exhaustive; documentation-only changes skip code checks. See docs/browser-tests.md.\n\n'
    + (source ? `Reusing completed [run ${source.run}](https://github.com/${current.repository}/actions/runs/${source.run}) attempt ${source.attempt} for the exact merge revision ${current.sha}. Its report is under **Artifacts → browser-test-report** on that run page. Only missing checks run here; CI revalidates the source attempt.\n`
      : 'No completed, compatible source selected. All checks in this budget run here; running sources are never awaited.\n'));
  console.log(JSON.stringify(result));
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { changedFiles, fromEvent, readyEvent, main };
