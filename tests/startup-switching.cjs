const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('@playwright/test');
const { routeFiles } = require('./route-files.cjs');
const { openOptions } = require('./options.cjs');
const { routeDefaultCatalog, latestURL, producerBase } = require('./default-catalog-route.cjs');

const scenarios = ['', '/Orrery'].flatMap(prefix => ['pixi', 'three'].flatMap(initial =>
  ['discovery', 'chunks'].flatMap(stage => [false, true].map(failure => ({
    prefix, initial, stage, failure,
    id: `${prefix ? 'pages' : 'root'}-${initial}-${stage}-${failure ? 'fallback' : 'switch'}`,
  })))));

// Serve the production entry in-process. No test App export, server or images.
async function run({ browser, name, output = '.context/startup-switching', scenario }) {
  const root = path.resolve(process.env.ORRERY_DEFAULT_DIST || 'dist');
  const results = [];
  const starters = await require('./comet-starters.cjs')();
  for (const { prefix, initial, stage, failure } of (scenario ? [scenario] : scenarios)) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const errors = [], requests = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => requests.push(request.url()));
    await routeFiles(page, root);
    await routeDefaultCatalog(page);
    await require('./comet-fixture.cjs').routeComets(page);
    let release, requested;
    const held = new Promise(resolve => { requested = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    await page.route(stage === 'discovery' ? latestURL : producerBase + 'chunks/**', async route => {
      requested(); await gate; await route.fallback();
    });
    // Fail candidate initialization after the outgoing renderer is disposed,
    // so recovery must rebuild that renderer without an active session too.
    await page.addInitScript(() => {
      const appendChild = Node.prototype.appendChild;
      Node.prototype.appendChild = function(child) {
        if (window.failNextCanvasMount && this.id === 'orrery' && child instanceof HTMLCanvasElement) {
          window.failNextCanvasMount = false;
          throw new Error('Controlled candidate initialization failure');
        }
        return appendChild.call(this, child);
      };
    });
    try {
      await page.goto(`https://orrery.test${prefix}/?renderer=${initial}&date=2026-11-18`);
      await held;
      await expect(page.locator('#orrery-count')).toHaveText('0');
      await openOptions(page);
      const selector = page.locator('select[aria-label="Renderer"]');
      await expect(selector).toHaveValue(initial);
      // Real comet controls stay usable independently of the held asteroids.
      await page.getByRole('checkbox', { name: 'Show comets', exact: true }).check();
      await expect(page.locator('.orrery-comet-summary')).toContainText(`${starters.length} selected`);
      await expect(page.getByRole('button', { name: 'Fit selected comets' })).toBeEnabled();
      await page.getByRole('button', { name: 'Choose…', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Show 2P/Encke', exact: true }).uncheck();
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await page.getByRole('checkbox', { name: 'Comet paths', exact: true }).uncheck();
      const cometRequests = requests.filter(url => url.includes('/comets/')).length;
      assert(cometRequests > 0, 'Comet requests are observed before checking cache reuse');
      if (failure) await page.evaluate(() => { window.failNextCanvasMount = true; });
      const target = initial === 'pixi' ? 'three' : 'pixi';
      await selector.selectOption(target);
      if (failure) {
        await expect(page.locator('#orrery-status')).toContainText('The previous renderer is still selected.');
      }
      await expect(selector).toBeEnabled();
      await expect(selector).toHaveValue(failure ? initial : target);
      await expect(page.locator('#orrery canvas')).toHaveCount(1);
      await expect(page.locator('#orrery-count')).toHaveText('0');
      if (failure) {
        await openOptions(page);
        await selector.selectOption(target);
        await expect(selector).toHaveValue(target);
        await expect(selector).toBeEnabled();
      }
      await openOptions(page);
      await page.getByRole('button', { name: 'Choose…', exact: true }).click();
      await page.getByRole('button', { name: /Browse catalogue/ }).click();
      await expect(page.getByRole('checkbox', { name: 'Show 2P/Encke', exact: true })).not.toBeChecked();
      await page.getByRole('button', { name: 'Done', exact: true }).click();
      await expect(page.getByRole('checkbox', { name: 'Comet paths', exact: true })).not.toBeChecked();
      await page.getByRole('button', { name: 'Fit selected comets' }).click();
      await expect(page.locator('.orrery-comet-label:not([hidden])')).toHaveCount(starters.filter(id=>id!=='2P').length);
      release();
      await expect(page.locator('#orrery-count')).toHaveText('6');
      await selector.selectOption(initial);
      await expect(selector).toHaveValue(initial);
      await expect(selector).toBeEnabled();
      await expect(page.locator('#orrery-count')).toHaveText('6');
      assert.equal(requests.filter(url => url === latestURL).length, 1, 'Switching never reopens discovery');
      assert.equal(requests.filter(url => url.includes('/comets/')).length, cometRequests, 'Comet pin/cache survive');
      assert.deepEqual(errors, []);
      results.push({ prefix, initial, stage, failure, pass: true });
      console.log(name, prefix || '/', initial, stage, failure ? 'fallback' : 'switch', 'passed');
    } finally { release(); await page.close(); }
  }
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `${name}${scenario ? `-${scenario.id}` : ''}-results.json`), JSON.stringify(results, null, 2));
  console.log(`${name}: ${results.length} production startup switch/recovery cases passed`);
}
module.exports = { run, scenarios };
if (require.main === module) require('./standalone.cjs').run(run);
