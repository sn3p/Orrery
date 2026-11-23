const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { expect } = require('@playwright/test');
const { routeDefaultCatalog, latestURL, producerBase } = require('./default-catalog-route.cjs');

// Serve the production entry in-process. No test App export, server or images.
async function run({ browser, name, output = '.context/startup-switching' }) {
  const root = path.resolve(process.env.ORRERY_DEFAULT_DIST || 'dist');
  const results = [];
  for (const prefix of ['', '/Orrery']) for (const initial of ['pixi', 'three']) {
    for (const stage of ['discovery', 'chunks']) for (const failure of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const errors = [], requests = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('request', request => requests.push(request.url()));
      await page.route('https://orrery.test/**', route => {
        const pathname = new URL(route.request().url()).pathname.replace(/^\/Orrery\//, '/');
        const file = path.resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
        if (!file.startsWith(root + path.sep) || !fs.existsSync(file)) return route.fulfill({ status: 404 });
        const contentType = { '.js': 'text/javascript', '.json': 'application/json', '.html': 'text/html',
          '.css': 'text/css', '.woff2': 'font/woff2' }[path.extname(file)] || 'application/octet-stream';
        return route.fulfill({ path: file, contentType });
      });
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
        await page.getByRole('button', { name: 'Options', exact: true }).click();
        const selector = page.locator('select[aria-label="Renderer"]');
        await expect(selector).toHaveValue(initial);
        // Real comet controls stay usable independently of the held asteroids.
        await page.getByRole('checkbox', { name: 'Show comets', exact: true }).check();
        await expect(page.getByRole('status').filter({ hasText: '6 comets selected.' })).toBeVisible();
        await page.getByRole('checkbox', { name: 'Show 2P/Encke', exact: true }).uncheck();
        await page.getByRole('checkbox', { name: 'Comet paths', exact: true }).uncheck();
        const cometRequests = requests.filter(url => url.includes('/comets-v2/')).length;
        if (failure) await page.evaluate(() => { window.failNextCanvasMount = true; });
        const target = initial === 'pixi' ? 'three' : 'pixi';
        await selector.selectOption(target);
        if (failure) {
          await expect(page.locator('#orrery-status')).toContainText('The previous renderer is still selected.');
          const options = page.getByRole('button', { name: 'Options', exact: true });
          if (await options.getAttribute('aria-expanded') !== 'true') await options.click();
        }
        await expect(selector).toBeEnabled();
        await expect(selector).toHaveValue(failure ? initial : target);
        await expect(page.locator('#orrery canvas')).toHaveCount(1);
        await expect(page.locator('#orrery-count')).toHaveText('0');
        if (failure) {
          const options = page.getByRole('button', { name: 'Options', exact: true });
          if (await options.getAttribute('aria-expanded') !== 'true') await options.click();
          await selector.selectOption(target);
          await expect(selector).toHaveValue(target);
          await expect(selector).toBeEnabled();
        }
        const options = page.getByRole('button', { name: 'Options', exact: true });
        if (await options.getAttribute('aria-expanded') !== 'true') await options.click();
        await expect(page.getByRole('checkbox', { name: 'Show 2P/Encke', exact: true })).not.toBeChecked();
        await expect(page.getByRole('checkbox', { name: 'Comet paths', exact: true })).not.toBeChecked();
        await page.getByRole('button', { name: 'Fit selected comets' }).click();
        await expect(page.locator('.orrery-comet-label:not([hidden])')).toHaveCount(5);
        release();
        await expect(page.locator('#orrery-count')).toHaveText('6');
        await selector.selectOption(initial);
        await expect(selector).toHaveValue(initial);
        await expect(selector).toBeEnabled();
        await expect(page.locator('#orrery-count')).toHaveText('6');
        assert.equal(requests.filter(url => url === latestURL).length, 1, 'Switching never reopens discovery');
        assert.equal(requests.filter(url => url.includes('/comets-v2/')).length, cometRequests, 'Comet pin/cache survive');
        assert.deepEqual(errors, []);
        results.push({ prefix, initial, stage, failure, pass: true });
        console.log(name, prefix || '/', initial, stage, failure ? 'fallback' : 'switch', 'passed');
      } finally { release(); await page.close(); }
    }
  }
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(path.join(output, `${name}-results.json`), JSON.stringify(results, null, 2));
  console.log(`${name}: ${results.length} production startup switch/recovery cases passed`);
}
module.exports = { run };
if (require.main === module) require('./standalone.cjs').run(run);
