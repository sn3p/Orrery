const fs = require('node:fs');
const { spawn } = require('node:child_process');

function startServer(command, args, { logFile, ...options }) {
  fs.writeFileSync(logFile, '');
  const child = spawn(command, args, { ...options, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '', stopping;
  const record = data => {
    log += data;
    // Preserve diagnostics even when the enclosing runner is interrupted.
    fs.appendFileSync(logFile, data);
  };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  const closed = new Promise(resolve => {
    child.once('close', resolve);
    child.once('error', error => { record(Buffer.from(`${error.stack}\n`)); resolve(); });
  });
  function signalGroup(signal) {
    if (!child.pid) return;
    try { process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  async function cleanup() {
    signalGroup('SIGTERM');
    let timer;
    try {
      await Promise.race([closed, new Promise(resolve => { timer = setTimeout(resolve, 1000); })]);
      // The group leader can exit before its descendants; always address the
      // whole group, including descendants that ignore graceful termination.
      signalGroup('SIGKILL');
      await closed;
    } finally {
      clearTimeout(timer);
      process.removeListener('SIGTERM', onTerm);
      process.removeListener('SIGINT', onInterrupt);
    }
  }
  const stop = () => stopping ||= cleanup();
  const onTerm = () => { void stop().finally(() => process.exit(143)); };
  const onInterrupt = () => { void stop().finally(() => process.exit(130)); };
  process.once('SIGTERM', onTerm);
  process.once('SIGINT', onInterrupt);
  return { child, stop, get log() { return log; } };
}

module.exports = { startServer };
