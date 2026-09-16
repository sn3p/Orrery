const fs = require('node:fs');
const path = require('node:path');
const base = require('@playwright/test');
const { withIntroDismissed } = require('../browsers.cjs');

exports.test = base.test.extend({
  graphics: [async ({ browser, browserName }, use, workerInfo) => {
    const output = path.join(workerInfo.project.outputDir, 'environment', `${workerInfo.project.name}-${workerInfo.workerIndex}`);
    const contexts = new Set(browser.contexts());
    try {
      await require('../browser-environment.cjs').run({ browser, name: browserName, output });
    } finally {
      for (const context of browser.contexts()) if (!contexts.has(context)) await context.close();
    }
    await use();
  }, { scope: 'worker', auto: true }],

  check: async ({ browser, browserName }, use, testInfo) => {
    withIntroDismissed(browser);
    const contexts = new Set(browser.contexts());
    const output = testInfo.outputPath('evidence');
    fs.mkdirSync(output, { recursive: true });
    try {
      await use(async (suite, options = {}) => {
        const { method = 'run', ...parameters } = options;
        await require(`../${suite}.cjs`)[method]({
          browser, name: browserName, output, step: base.test.step, ...parameters,
        });
      });
    } finally {
      // Browser.newPage() is used by existing assertion helpers. Close every
      // context they created, including paths interrupted by a failed assertion.
      // Playwright's recorder captures these contexts and retains failure traces.
      for (const context of browser.contexts()) if (!contexts.has(context)) await context.close();
      if (fs.existsSync(output)) {
        for (const entry of fs.readdirSync(output, { withFileTypes: true })) {
          if (entry.isFile() && /\.(png|json|log)$/.test(entry.name)) {
            await testInfo.attach(entry.name, { path: path.join(output, entry.name) });
          }
        }
      }
    }
  },
});
