const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const browsers = require('playwright');
const { build, serve } = require('./support.cjs');
const { testOptions } = require('./options.cjs');
const testPixelRatio = require('./pixel-ratio.cjs');
const texture = require('./resolution-texture.cjs');

(async () => {
  const output = '.context/dpr/checks';
  fs.mkdirSync(output, { recursive: true });
  await build('./tests/rendering-fixture.js', path.join(output, 'fixture'));
  await build('./tests/init-fixture.js', path.join(output, 'init'));
  const production = await serve('dist'), fixture = await serve(output);
  const report = [];
  try {
    for (const name of (process.env.BROWSERS || 'chromium').split(',')) {
      const browser = await browsers[name].launch(name === 'chromium' ? { channel: 'chrome' } : {});
      try {
        const result = { browser: name, version: browser.version(),
          options: await testOptions(browser, production.url, output, name),
          pixelRatio: await testPixelRatio(browser, production.url, output, name),
          texture: await texture(browser, fixture.url, name) };
        report.push(result);
        console.log(JSON.stringify(result));
      } finally { await browser.close(); }
    }
    assert(report.length > 0);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  } finally { await production.close(); await fixture.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
