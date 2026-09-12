const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

(async () => {
  const root = path.resolve(__dirname, '..');
  const output = path.join(root, '.context/gpu-orbits/benchmark-clone');
  const clone = path.join(output, 'checkout');
  fs.mkdirSync(output, { recursive: true });
  fs.rmSync(clone, { recursive: true, force: true });
  const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1', COUNTS: '1000', REPEATS: '1' };
  delete env.BUNDLE; delete env.OUTPUT;
  try {
    // Real clone with default local excludes, not Conductor's worktree excludes.
    await execute('git', ['clone', '--shared', '--quiet', root, clone], { env });
    // Test current working source before it has to be committed in the real repo.
    const { stdout } = await execute('git', ['ls-files', '-z'], { cwd: root, env });
    for (const name of stdout.split('\0').filter(Boolean)) {
      const target = path.join(clone, name);
      if (!fs.existsSync(path.join(root, name))) fs.rmSync(target, { force: true });
      else { fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, name), target); }
    }
    const git = (...args) => execute('git', args, { cwd: clone, env });
    await git('add', '-A');
    await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '--allow-empty', '--quiet', '-m', 'Working source fixture');
    const revision = (await git('rev-parse', 'HEAD')).stdout.trim();
    fs.mkdirSync(path.join(clone, 'node_modules'));
    for (const name of fs.readdirSync(path.join(root, 'node_modules'))) {
      fs.symlinkSync(path.join(root, 'node_modules', name), path.join(clone, 'node_modules', name));
    }
    assert.equal((await git('status', '--porcelain')).stdout, '');
    // The full suite also runs the real dev-server regression. Its generated
    // entry/probe files must not taint a subsequent benchmark's source stamp.
    await execute(process.execPath, ['tests/hmr.cjs'], { cwd: clone, env, timeout: 60000 });
    assert.equal((await git('status', '--porcelain')).stdout, '', 'HMR test outputs leave the source clean');
    await execute('npm', ['run', 'benchmark'], { cwd: clone, env, timeout: 30000 });
    const report = JSON.parse(fs.readFileSync(path.join(clone, '.context/gpu-orbits/benchmark/results.json')));
    assert.equal(report.complete, true);
    assert.equal(report.provenance, 'recorded-build');
    assert.equal(report.revision, revision, 'Default no-BUNDLE command retains clean-clone source attribution');
    assert.equal(report.sourceDirty, false);
    assert.equal((await git('status', '--porcelain')).stdout, '', 'Only generated outputs were ignored');
    fs.writeFileSync(path.join(clone, 'src/provenance-probe.txt'), 'real untracked source');
    assert.match((await git('status', '--porcelain')).stdout, /src\/provenance-probe.txt/);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
    console.log('Default benchmark after HMR tests in a clean ordinary clone retains verified source attribution.');
  } finally { fs.rmSync(clone, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
