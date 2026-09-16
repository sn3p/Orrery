const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build, serve } = require('./support.cjs');
const { testOptions } = require('./options.cjs');
const testPixelRatio = require('./pixel-ratio.cjs');
const texture = require('./resolution-texture.cjs');

async function run({ browser, name, application = "unified", output: artifactDirectory, part, step = (_name, action) => action() }) {
  assert(part === undefined || ['options', 'pixelRatio', 'texture'].includes(part), `Unknown options check: ${part}`);
  const output = artifactDirectory || (application === 'unified' ? '.context/pr2/unified-options-browser' : '.context/dpr/checks');
  fs.mkdirSync(output, { recursive: true });
  if (part === undefined || part === 'texture') {
    await build('./tests/rendering-fixture.js', path.join(output, 'fixture'), { application });
    await build('./tests/init-fixture.js', path.join(output, 'init'), { application });
  }
  const publicSite = 'dist';
  const production = await serve(publicSite), fixture = await serve(output);
  const report = [];
  try {
    const result = { browser: name, version: browser.version() };
    const url = production.url + '/';
    // These checks create independent pages and share no state. Native cases
    // give each its own timeout; standalone invocation still runs all three.
    for (const [key, label, action] of [
      ['options', 'options interactions', () => testOptions(browser, url, output, name, application)],
      ['pixelRatio', 'pixel ratio and display transitions', () => testPixelRatio(browser, url, output, name, application)],
      ['texture', 'texture recovery', () => texture(browser, fixture.url, name)],
    ]) {
      if (part === undefined || part === key) result[key] = await step(label, action);
    }
    report.push(result);
    console.log(JSON.stringify(result));
    assert(report.length > 0);
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  } finally { await production.close(); await fixture.close(); }
}

module.exports = { run };
if (require.main === module) require("./standalone.cjs").run(run, { chromiumOnly: false });
