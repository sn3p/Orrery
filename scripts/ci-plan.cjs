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
function fromEvent(eventName, event, git) {
  if (eventName === 'schedule' || eventName === 'workflow_dispatch') return plan([], { full: true });
  if (!['pull_request', 'push'].includes(eventName)) return plan([], { full: true });
  try { return plan(changedFiles(eventName, event, git)); }
  catch (error) { console.error(`Selecting all PR groups: ${error.message}`); return plan(['<unknown-change-range>']); }
}
if (require.main === module) {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const result = fromEvent(process.env.GITHUB_EVENT_NAME, event);
  const values = { code: result.code, 'build-tests': result.buildTests, mode: result.mode, groups: result.groups, matrix: JSON.stringify(result.matrix) };
  fs.appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(values).map(([key, value]) => `${key}=${value}\n`).join(''));
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Test plan\n\nMode: **${result.mode}**. Groups: **${result.groups}**. Code checks: **${result.code}**. Build integrations: **${result.buildTests}**.\n\nThe full suite runs nightly and with workflow_dispatch. See docs/browser-tests.md.\n`);
  console.log(JSON.stringify(result));
}
module.exports = { changedFiles, fromEvent };
