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
if (require.main === module) {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const result = fromEvent(process.env.GITHUB_EVENT_NAME, event);
  const values = { code: result.code, 'build-tests': result.buildTests, budget: result.budget, mode: result.mode, groups: result.groups, matrix: JSON.stringify(result.matrix) };
  fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Test plan\n\nBudget: **${result.budget}**. Mode: **${result.mode}**. Groups: **${result.groups}**. Code checks: **${result.code}**. Build integrations: **${result.buildTests}**.\n\nDraft PRs run Chromium core only. Marking a PR ready (or opening it ready) runs the full suite once; later pushes run the routine budget. The full suite also runs nightly and with workflow_dispatch. See docs/browser-tests.md.\n`);
  console.log(JSON.stringify(result));
}
module.exports = { changedFiles, fromEvent, readyEvent };
