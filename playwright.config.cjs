const { defineConfig } = require('@playwright/test');
const { launchOptions } = require('./tests/browsers.cjs');

const browsers = (process.env.BROWSERS || 'chromium,firefox,webkit').split(',');
for (const name of browsers) {
  if (!['chromium', 'firefox', 'webkit'].includes(name)) throw new Error(`Unknown browser: ${name}`);
}
function use(browserName) {
  const { headless, channel, ...options } = launchOptions(browserName);
  return { browserName, headless, channel, launchOptions: options };
}

module.exports = defineConfig({
  testDir: './tests/playwright',
  // A lifecycle test owns its sequence. Independent tests may be distributed
  // between machines, with one software-rendered workload per worker.
  fullyParallel: true,
  workers: 1,
  timeout: 180_000,
  forbidOnly: !!process.env.CI,
  retries: 0,
  globalSetup: require.resolve('./tests/playwright/setup.cjs'),
  outputDir: '.context/playwright-results',
  reporter: [
    ['list'],
    ['blob', { outputDir: '.context/playwright-blob' }],
    ['html', { outputFolder: '.context/playwright-report', open: 'never' }],
  ],
  use: {
    actionTimeout: 30_000,
    navigationTimeout: 30_000,
    // Recording every DOM snapshot and screencast is expensive for these WebGL
    // tests. Keep actions/sources and failure screenshots; --trace on opts into
    // full visual traces when investigating a specific case.
    trace: { mode: 'retain-on-failure', snapshots: false, screenshots: false },
    screenshot: 'only-on-failure',
  },
  projects: [
    ...[...new Set(browsers)].map(name => ({
      name, testMatch: ['browser.spec.cjs', 'catalog.spec.cjs'], use: use(name),
    })),
    { name: 'chromium-only', testMatch: ['chromium.spec.cjs', 'catalog-chromium.spec.cjs'], use: use('chromium') },
  ],
});
