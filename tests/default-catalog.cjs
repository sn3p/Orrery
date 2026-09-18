const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { serve } = require('./support.cjs');
const { routeDefaultCatalog, latestURL, producerBase } = require('./default-catalog-route.cjs');

async function run({ browser, name, output = '.context/full-catalogue/default-entry' }) {
  fs.mkdirSync(output, { recursive: true });
  const capture = process.env.ORRERY_NO_SCREENSHOTS === '1' ? async () => {}
    : (page, options) => page.screenshot(options);
  const server = await serve(process.env.ORRERY_DEFAULT_DIST || 'dist');
  const pages = path.join(output, 'pages');
  fs.mkdirSync(pages, { recursive: true });
  const nestedRoot = path.join(pages, 'Orrery');
  const publicRoot = path.resolve(process.env.ORRERY_DEFAULT_DIST || 'dist');
  require('./deployment.cjs').replaceDeploymentLink(publicRoot, nestedRoot);
  const nested = await serve(pages);
  const results = [];
  try {
    for (const [prefix, url] of [['root', server.url + '/'], ['pages', nested.url + '/Orrery/']]) {
      for (const renderer of ['pixi', 'three']) {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const requests = [], errors = [];
        await routeDefaultCatalog(page);
        page.on('request', request => requests.push(request.url()));
        page.on('pageerror', error => errors.push(error.message));
        try {
          await page.goto(url + (renderer === 'three' ? '?renderer=three' : ''));
          await page.waitForFunction(() => document.querySelector('#orrery-count').textContent === '6');
          await page.getByRole('button', { name: 'Options', exact: true }).click();
          const speed = page.getByRole('textbox', { name: 'Playback speed' });
          await speed.fill('0'); await speed.press('Enter');
          const selector = page.getByRole('combobox', { name: 'Renderer', exact: true });
          assert.equal(await selector.inputValue(), renderer);
          const date = await page.locator('#orrery-date').textContent();
          const catalogueRequests = () => requests.filter(url => url.startsWith(producerBase));
          const before = catalogueRequests().slice();
          assert.equal(before.filter(url => url === latestURL).length, 1);
          assert.equal(before.filter(url => /\/chunks\//.test(url)).length, 3);
          assert(!requests.some(url => /\/data\/catalog.json|\/full\/catalog/.test(url)));
          for (const target of ['three', 'pixi', 'three', 'pixi']) {
            await selector.selectOption(target);
            await page.waitForFunction(() => !document.querySelector('select[aria-label="Renderer"]').disabled
              && document.querySelector('#orrery-status').textContent === '');
            assert.equal(await page.locator('#orrery-count').textContent(), '6');
            assert.equal(await page.locator('#orrery-date').textContent(), date);
            assert.equal(await page.locator('#orrery canvas').count(), 1);
            assert.deepEqual(catalogueRequests(), before, 'Repeated switches retain all indexed data without refetch');
          }
          await capture(page, { path: path.join(output, `${name}-${prefix}-${renderer}-default-switching.png`) });
          assert.deepEqual(errors, []);
          await page.route(latestURL, route => route.fulfill({ status: 503, body: 'Unavailable' }));
          await page.reload();
          await page.getByRole('alert').filter({ hasText: 'Could not load the asteroid catalogue' }).waitFor();
          assert.equal(await page.locator('#orrery-count').textContent(), '0');
          assert(!requests.some(url => /\/data\/catalog.json|\/full\/catalog/.test(url)), 'Source failure never falls back');
          await page.unroute(latestURL);
          await page.reload();
          await page.waitForFunction(() => document.querySelector('#orrery-count').textContent === '6');
          assert.equal(await page.locator('#orrery canvas').count(), 1);
          // A stale/corrupt immutable index is rejected by the actual default
          // entry, even when the latest descriptor itself resolves correctly.
          const indexPattern = producerBase + 'index-*.json';
          await page.route(indexPattern, route => route.fulfill({ json: { stale: true } }));
          await page.reload();
          await page.getByRole('alert').filter({ hasText: 'Could not load the asteroid catalogue' }).waitFor();
          assert.equal(await page.locator('#orrery-count').textContent(), '0');
          await page.unroute(indexPattern);
          // Initial chunk transport failure keeps loading truthful; coming
          // online retries the retained source without reopening latest.
          const chunkPattern = producerBase + 'chunks/*.json';
          await page.route(chunkPattern, route => route.abort('internetdisconnected'));
          await page.reload();
          await page.getByRole('alert').filter({ hasText: 'Could not load more asteroids' }).waitFor();
          assert.equal(await page.locator('#orrery-count').textContent(), '0');
          const latestRequests = requests.filter(url => url === latestURL).length;
          await page.unroute(chunkPattern);
          await page.evaluate(() => window.dispatchEvent(new Event('online')));
          await page.waitForFunction(() => document.querySelector('#orrery-count').textContent === '6');
          assert.equal(requests.filter(url => url === latestURL).length, latestRequests);
          assert(!requests.some(url => /\/data\/catalog.json|\/full\/catalog/.test(url)));
          assert.deepEqual(errors, []);
          results.push({ prefix, renderer, count: 6, switches: 4, sourceFailure: true, staleIndex: true, offlineRetry: true, reloadRecovery: true, noHistoricalFallback: true });
        } finally { await page.close(); }
      }
      }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2) + '\n');
  } finally { await server.close(); await nested.close(); }
}
module.exports = { run };
if (require.main === module) require('./standalone.cjs').run(run);
