const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);

exports.run = async ({ output }) => {
  const report = path.join(output, 'probe-report.json');
  fs.writeFileSync(path.join(output, 'probe.spec.cjs'), `
    const assert = require('node:assert/strict');
    const { test } = require(${JSON.stringify(require.resolve('./playwright/fixtures.cjs'))});
    test('context cleanup producer', async ({ browser, check }) => {
      const page = await browser.newPage();
      await page.setContent('<h1>Context cleanup probe</h1>');
    });
    test('context cleanup consumer', async ({ browser, check }) => {
      assert.equal(browser.contexts().length, 0, 'Previous case must leave no browser context');
    });
    test('intentional diagnostic failure', async ({ browser, check }) => {
      const page = await browser.newPage();
      await page.setContent('<h1>Expected harness failure</h1>');
      assert.fail('expected harness diagnostic');
    });
  `);
  const config = path.join(output, 'probe.config.cjs');
  fs.writeFileSync(config, `
    const base = require(${JSON.stringify(require.resolve('../playwright.config.cjs'))});
    module.exports = { ...base, testDir: __dirname, testMatch: 'probe.spec.cjs',
      fullyParallel: false, globalSetup: undefined,
      outputDir: ${JSON.stringify(path.join(output, 'probe-results'))},
      reporter: [['json', { outputFile: ${JSON.stringify(report)} }]],
      projects: [{ name: 'probe', use: base.projects.find(p => p.name === 'chromium-only').use }],
    };
  `);
  await assert.rejects(execute(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', config], {
    timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
  }), error => error.code === 1 && !error.killed);
  const results = JSON.parse(fs.readFileSync(report));
  assert.equal(results.stats.expected, 2, 'Context cleanup passes across consecutive tests');
  assert.equal(results.stats.unexpected, 1, 'A failed assertion must fail the runner');
  const result = results.suites[0].specs.find(spec => spec.title === 'intentional diagnostic failure').tests[0].results[0];
  assert.match(result.error.message, /expected harness diagnostic/);
  for (const extension of ['.zip', '.png']) {
    const artifact = result.attachments.find(item => item.path?.endsWith(extension));
    assert(artifact && fs.statSync(artifact.path).size > 0, `Failure produces ${extension} diagnostics`);
  }
};
