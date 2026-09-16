const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const root = path.join(__dirname, 'fixtures/three-reference');
const pin = require('./fixtures/three-reference/manifest.json');
const hash = value => createHash('sha256').update(value).digest('hex');

test('Three references retain pinned provenance and independent expected calculations', async () => {
  assert.equal(pin.sourceCommit, '93a3e1f4a36d8fdceb513bdfdca20beddb3348d6');
  for (const [file, record] of Object.entries(pin.files)) {
    assert.equal(hash(fs.readFileSync(path.join(root, file))), record.sha256, file);
  }
  for (const file of ['constants.js', 'LICENSE']) assert.equal(pin.files[file].sha256, pin.files[file].sourceSha256);
  const shader = fs.readFileSync(path.join(root, 'shader.js'), 'utf8');
  const original = shader.replace('../../../src/unified/three/Asteroids.js', '../src/js/Asteroids')
    .replace('../../../src/unified/catalog/prepareCatalogue.js', '../src/js/prepareCatalogue')
    .replace('./Orbit', '../src/js/Orbit');
  assert.equal(hash(original), pin.files['shader.js'].sourceSha256, 'All original shader/numerical/pixel assertions survive extraction');
  const orbit = fs.readFileSync(path.join(root, 'Orbit.js'), 'utf8');
  assert.deepEqual([...orbit.matchAll(/from "([^"]+)"/g)].map(match => match[1]), ['./constants']);
  // Load the independent arithmetic with only its local constants in Node,
  // without importing any production renderer or orbital implementation.
  const constants = fs.readFileSync(path.join(root, 'constants.js'), 'utf8');
  const dataURL = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
  const { default: Orbit } = await import(dataURL(orbit.replace('"./constants"', JSON.stringify(dataURL(constants)))));
  const row = { a: 1, e: 0, i: 90, W: 0, wbar: 0, M: 0, n: 1, epoch: 2451545 };
  for (const [days, expected] of [[0, [100, 0, 0]], [90, [0, 0, 100]], [-90, [0, 0, -100]]]) {
    const actual = Orbit.getPosAtTime(row, row.epoch + days);
    assert(Math.hypot(...actual.map((value, i) => value - expected[i])) < 1e-10);
  }
});

test('webpack watch observes the extracted independent reference dependency and recovery', { timeout: 30000 }, async t => {
  const webpack = require('webpack');
  fs.mkdirSync(path.resolve('.context'), { recursive: true });
  const directory = fs.mkdtempSync(path.resolve('.context/three-reference-watch-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const file of ['Orbit.js', 'constants.js']) fs.copyFileSync(path.join(root, file), path.join(directory, file));
  fs.writeFileSync(path.join(directory, 'entry.js'), `import Orbit from './Orbit';
    export default Orbit.getPosAtTime({ a: 1, e: 0, i: 0, W: 0, wbar: 0, M: 0, n: 1, epoch: 0 }, 0);`);
  const output = path.join(directory, 'out/bundle.cjs');
  const compiler = webpack({ context: directory, mode: 'development', target: 'node', entry: './entry.js',
    output: { path: path.dirname(output), filename: 'bundle.cjs', library: { type: 'commonjs2' } } });
  const events = []; let wake;
  const watcher = compiler.watch({ aggregateTimeout: 10 }, (error, stats) => { events.push({ error, stats }); wake?.(); });
  async function next(matches) {
    const deadline = Date.now() + 5000;
    while (true) {
      while (events.length) {
        const { error, stats } = events.shift(); assert.ifError(error);
        if (matches(stats)) return stats;
      }
      const remaining = deadline - Date.now(); assert(remaining > 0, 'Reference watcher timed out');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { wake = null; reject(new Error('Reference watcher timed out')); }, remaining);
        wake = () => { clearTimeout(timer); wake = null; resolve(); };
      });
    }
  }
  const position = () => { delete require.cache[output]; return require(output).default; };
  const constantsFile = path.join(directory, 'constants.js'), original = fs.readFileSync(constantsFile, 'utf8');
  try {
    const first = await next(stats => !stats.hasErrors());
    assert(first.compilation.fileDependencies.has(constantsFile), 'Reference constant is a real compiler dependency');
    assert.deepEqual(position(), [100, 0, 0]);
    fs.writeFileSync(constantsFile, original.replace('PIXELS_PER_AU = 100', 'PIXELS_PER_AU = 101'));
    await next(stats => !stats.hasErrors() && position()[0] === 101);
    fs.writeFileSync(constantsFile, 'invalid syntax !');
    await next(stats => stats.hasErrors());
    fs.writeFileSync(constantsFile, original);
    await next(stats => !stats.hasErrors() && position()[0] === 100);
  } finally {
    await new Promise((resolve, reject) => watcher.close(error => error ? reject(error) : resolve()));
    await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
  }
});
