// Compatibility for documented individual checks and the ordinary-clone probe.
// CI and npm test use Playwright Test's projects, fixtures and reports.
const { launchBrowser } = require('./browsers.cjs');

exports.run = async (check, { chromiumOnly = false } = {}) => {
  try {
    const names = chromiumOnly ? ['chromium'] : (process.env.BROWSERS || 'chromium').split(',');
    for (const name of names) {
      const browser = await launchBrowser(name);
      try {
        await check({ browser, name, application: process.env.ORRERY_TEST_APP || 'legacy' });
      } finally { await browser.close(); }
    }
  } catch (error) { console.error(error); process.exitCode = 1; }
};
