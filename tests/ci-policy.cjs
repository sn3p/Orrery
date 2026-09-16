// Shared by native discovery, fixture preparation and the workflow planner.
// No test is deleted: an unset selection means the complete suite.
const groups = ['core', 'ui', 'graphics', 'data', 'build', 'dev'];
function mode(value = process.env.ORRERY_TEST_MODE || 'full') {
  if (!['pr', 'full'].includes(value)) throw new Error(`Invalid test mode: ${value}`);
  return value;
}
function selection(value = process.env.ORRERY_TEST_GROUPS || 'full') {
  if (value === 'full') return ['full'];
  const selected = [...new Set(value.split(','))];
  if (!selected.includes('core') || selected.some(group => !groups.includes(group))) {
    throw new Error(`Invalid test groups: ${value}`);
  }
  return selected;
}
function grep(project, selected = selection(), runMode = mode()) {
  if (runMode === 'pr' && !project.startsWith('chromium')) return /@smoke(?:\s|$)/;
  if (selected.includes('full')) return undefined;
  const tags = ['smoke', ...selected.filter(group => group !== 'core' || project.startsWith('chromium'))];
  return new RegExp(`@(?:${tags.join('|')})(?:\\s|$)`);
}
function grepInvert(runMode = mode()) {
  return runMode === 'pr' ? /@extended(?:\s|$)/ : undefined;
}
function fixtureKeys(selected = selection(), runMode = mode()) {
  if (runMode === 'full' && (selected.includes('full') || selected.includes('graphics') || selected.includes('build') || selected.includes('dev'))) return null;
  const keys = ['unified/contracts', 'unified/production', 'lazy-preview', 'catalog', 'three', 'unified/rendering'];
  if (selected.includes('full') || selected.includes('ui') || selected.includes('graphics')) keys.push('unified/initialization');
  return new Set(keys);
}
function plan(files, { full = false } = {}) {
  const runMode = full ? 'full' : 'pr';
  let allGroups = full;
  const selected = new Set(['core']);
  let buildTests = false, code = false;
  for (const file of files) {
    // Only explicitly harmless paths bypass testing; unknown code selects all groups.
    if (/^(docs\/|(?:README|LICENSE|AGENTS)(?:\.[^/]*)?$)/.test(file)) continue;
    code = true;
    if (/^src\/(?:unified\/(?:index\.(?:js|html)$|renderers\.js$|compat\/))/.test(file)) {
      selected.add('ui'); selected.add('build'); selected.add('dev'); buildTests = true;
    } else if (/^src\/(?:js\/index|unified\/(?:index|renderers))(?:[./]|$)/.test(file)) {
      // Unknown entry-like files must not fall through to broad JS coverage.
      allGroups = true;
    } else if (/^src\/css\/dat-gui\.css$/.test(file)) {
      selected.add('graphics'); selected.add('ui');
    } else if (/^(src\/css\/|src\/fonts\/|src\/index\.html$|src\/unified\/preview\.css$|src\/unified\/ui\/(?:Hud|Options)\.js$)/.test(file)) selected.add('ui');
    else if (/^(src\/unified\/catalog\/|catalog-profiles\/|data\/)/.test(file)) {
      selected.add('data'); selected.add('build'); buildTests = true;
    } else if (/^(src\/(?:unified\/|js\/|shaders\/))/.test(file)) {
      selected.add('graphics'); selected.add('ui'); selected.add('data');
    } else if (/^benchmarks\//.test(file)) {
      selected.add('graphics'); selected.add('build'); selected.add('dev'); buildTests = true;
    } else allGroups = true;
  }
  if (allGroups) { code = true; buildTests = true; }
  const value = allGroups ? 'full' : groups.filter(group => selected.has(group)).join(',');
  // Broad path selections still use the routine PR budget. Only explicit
  // nightly/manual full runs repeat all checks across every engine.
  const broad = runMode === 'full';
  const include = [];
  for (const [browser, count] of [['chromium', 2], ['firefox', broad ? 2 : 1], ['webkit', broad ? 4 : 1]]) {
    for (let shard = 1; shard <= count; shard++) include.push({ browser, project: browser,
      shard: `${shard}/${count}`, id: `${browser}-${shard}`, name: `Browser tests (${browser}, shard ${shard}/${count})` });
  }
  include.push({ browser: 'chromium', project: 'chromium-only', shard: '1/1', id: 'chromium-only', name: 'Chromium-only integration tests' });
  return { code, buildTests, mode: runMode, groups: value, matrix: { include } };
}
module.exports = { mode, selection, grep, grepInvert, fixtureKeys, plan };
