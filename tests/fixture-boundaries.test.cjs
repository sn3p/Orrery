const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { replaceDeploymentLink } = require('./deployment.cjs');
const { assertNoTestImports } = require('./build-boundaries.cjs');

function temporary(t) {
  fs.mkdirSync('.context', { recursive: true });
  const root = fs.mkdtempSync(path.resolve('.context/fixture-boundaries-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

for (const state of ['fresh', 'stale', 'dangling', 'current']) {
  test(`nested deployment replaces a ${state} link and serves the current target`, async t => {
    const root = temporary(t), target = path.join(root, 'current'), prior = path.join(root, 'prior');
    const pages = path.join(root, 'pages'), link = path.join(pages, 'Orrery');
    fs.mkdirSync(target); fs.mkdirSync(pages);
    fs.writeFileSync(path.join(target, 'index.html'), 'current fixture');
    if (state === 'stale') {
      fs.mkdirSync(prior); fs.writeFileSync(path.join(prior, 'index.html'), 'stale fixture');
    }
    if (state !== 'fresh') fs.symlinkSync(state === 'current' ? target : prior, link, 'dir');
    replaceDeploymentLink(target, link);
    assert.equal(fs.realpathSync(link), fs.realpathSync(target));
    if (state === 'stale') assert.equal(fs.readFileSync(path.join(prior, 'index.html'), 'utf8'), 'stale fixture');
    const server = await require('./support.cjs').serve(pages);
    try {
      const response = await fetch(server.url + '/Orrery/');
      assert.equal(response.status, 200);
      assert.equal(await response.text(), 'current fixture');
    } finally { await server.close(); }
  });
}

test('public module boundary is anchored to this checkout tests directory', async t => {
  const root = path.join(temporary(t), 'tests', 'checkout');
  for (const directory of ['src', 'tests', 'tests-other', 'node_modules/library/tests']) {
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'node_modules/library/tests/index.js'), 'module.exports = 1;');
  fs.writeFileSync(path.join(root, 'tests/fixture.js'), 'module.exports = 2;');
  fs.writeFileSync(path.join(root, 'tests-other/public.js'), 'module.exports = 3;');
  const webpack = require('webpack');
  for (const [imported, permitted] of [['library/tests', true], ['../tests-other/public', true], ['../tests/fixture', false]]) {
    fs.writeFileSync(path.join(root, 'src/index.js'), `globalThis.value = require(${JSON.stringify(imported)});`);
    const compiler = webpack({ mode: 'none', context: root, entry: './src/index.js',
      output: { path: path.join(root, 'out'), filename: 'bundle.js' } });
    const stats = await new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(closeError => {
      if (error || closeError || stats.hasErrors()) reject(error || closeError || new Error(stats.toString('errors-only')));
      else resolve(stats);
    })));
    if (permitted) assert.doesNotThrow(() => assertNoTestImports(stats, root), imported);
    else assert.throws(() => assertNoTestImports(stats, root), /excludes all test fixtures/);
  }
});
