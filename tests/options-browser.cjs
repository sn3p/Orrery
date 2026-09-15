const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, serve } = require('./support.cjs');
const { testOptions } = require('./options.cjs');
const testPixelRatio = require('./pixel-ratio.cjs');
const texture = require('./resolution-texture.cjs');

async function run({ browser, name, application = "legacy", output: artifactDirectory, step = (_name, action) => action() }) {
  const output = artifactDirectory || (application === 'unified' ? '.context/pr2/unified-options-browser' : '.context/dpr/checks');
  fs.mkdirSync(output, { recursive: true });
  await build('./tests/rendering-fixture.js', path.join(output, 'fixture'), { application });
  await build('./tests/init-fixture.js', path.join(output, 'init'), { application });
  const production = await serve('dist'), fixture = await serve(output);
  const report = [];
  try {
    const result = { browser: name, version: browser.version(),
      options: await step("options interactions", () => testOptions(browser, production.url + (application === 'unified' ? '/next/' : '/'), output, name)),
      pixelRatio: await step("pixel ratio and display transitions", () => testPixelRatio(browser, production.url + (application === 'unified' ? '/next/' : '/'), output, name)),
      texture: await step("texture recovery", () => texture(browser, fixture.url, name)) };
    report.push(result);
    console.log(JSON.stringify(result));
    assert(report.length > 0);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  } finally { await production.close(); await fixture.close(); }
}

module.exports = { run };
if (require.main === module) require("./standalone.cjs").run(run, { chromiumOnly: false });
