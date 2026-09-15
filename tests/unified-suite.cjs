const { execFileSync } = require('node:child_process');
const cli = require.resolve('@playwright/test/cli');
// The caller may already have built dist/next; preserve the historical entry.
execFileSync(process.execPath, [cli, 'test', '--config', 'playwright.standalone.config.cjs'], {
  stdio: 'inherit', env: process.env,
});
