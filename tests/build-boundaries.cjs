const assert = require('node:assert/strict');
const path = require('node:path');

function assertNoTestImports(stats, root = path.resolve(__dirname, '..')) {
  const tests = path.join(root, 'tests') + path.sep;
  assert(![...stats.compilation.modules].some(module => module.resource?.startsWith(tests)),
    'Public import graph excludes all test fixtures and gzip helpers');
}
module.exports = { assertNoTestImports };
