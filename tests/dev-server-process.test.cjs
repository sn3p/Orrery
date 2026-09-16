const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const test = require('node:test');
const execute = promisify(execFile);

async function until(check) {
  const deadline = Date.now() + 10000;
  while (!check()) {
    assert(Date.now() < deadline, 'Timed out waiting for the dev-server subprocess');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}

for (const ending of ['execFile timeout', 'SIGTERM', 'browser failure']) {
  test(`next-dev cleans its detached server and retains logs after ${ending}`, { timeout: 20000 }, async t => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'orrery-dev-process-'));
    let runner;
    t.after(() => {
      if (runner && runner.exitCode === null) runner.kill('SIGKILL');
      const pidFile = path.join(root, 'server.pid');
      if (fs.existsSync(pidFile)) {
        try { process.kill(-Number(fs.readFileSync(pidFile, 'utf8')), 'SIGKILL'); }
        catch (error) { if (error.code !== 'ESRCH') throw error; }
      }
      fs.rmSync(root, { recursive: true, force: true });
    });
    const output = path.join(root, 'output');
    const logFile = path.join(output, 'server.log');
    const portFile = path.join(root, 'port');
    const descendant = path.join(root, 'descendant.cjs');
    fs.writeFileSync(descendant, `
      const server = require('node:net').createServer(socket => socket.end());
      process.on('SIGTERM', () => {});
      server.listen(0, '127.0.0.1', () => {
        require('node:fs').writeFileSync(${JSON.stringify(portFile)}, String(server.address().port));
        console.log('http://127.0.0.1:' + server.address().port + '/');
        console.error('retained descendant diagnostic');
      });
    `);
    // Exercise next-dev's actual npm -> server process boundary without starting
    // a browser or recompiling the app. Both processes resist SIGTERM so the
    // bounded process-group fallback has to close the descendant's real port.
    fs.writeFileSync(path.join(root, 'npm'), `#!/usr/bin/env node
      require('node:fs').writeFileSync(${JSON.stringify(path.join(root, 'server.pid'))}, String(process.pid));
      require('node:child_process').spawn(process.execPath, [${JSON.stringify(descendant)}], { stdio: 'inherit' });
      process.on('SIGTERM', () => {});
    `, { mode: 0o755 });
    const source = `require(${JSON.stringify(path.join(__dirname, 'next-dev.cjs'))}).run({
      output: ${JSON.stringify(output)},
      browser: { newPage() { ${ending === 'browser failure' ? "throw new Error('planned browser failure');" : 'return new Promise(() => {});'} } }
    }).catch(error => { console.error(error.message); process.exitCode = 1; });`;
    const execution = execute(process.execPath, ['-e', source], {
      env: { ...process.env, PATH: root + path.delimiter + process.env.PATH, CATALOG_CONFIG: '' },
      timeout: 5000,
    });
    // Attach rejection handling immediately, including when startup fails.
    const result = execution.then(() => null, error => error);
    runner = execution.child;
    await until(() => fs.existsSync(portFile));
    const port = Number(fs.readFileSync(portFile, 'utf8'));
    if (ending === 'SIGTERM') execution.child.kill('SIGTERM');
    const error = await result;
    assert(error, 'The interrupted or failed runner must fail');
    await new Promise((resolve, reject) => {
      const socket = net.connect({ host: '127.0.0.1', port });
      socket.once('connect', () => { socket.destroy(); reject(new Error('Detached descendant still accepts connections')); });
      socket.once('error', error => { try { assert.equal(error.code, 'ECONNREFUSED'); resolve(); } catch (failure) { reject(failure); } });
    });
    if (ending === 'execFile timeout') assert.equal(error.killed, true);
    else if (ending === 'SIGTERM') assert.equal(error.code, 143);
    else assert.match(error.stderr, /planned browser failure/);
    assert.match(fs.readFileSync(logFile, 'utf8'), /retained descendant diagnostic/);
  });
}
