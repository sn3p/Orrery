const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { serve } = require('./support.cjs');
const { routeDefaultCatalog, fixtureFiles, producerBase, latestURL } = require('./default-catalog-route.cjs');

async function checkStatus(page, retained) {
  const status = page.locator('#orrery-status');
  assert(await status.isVisible());
  const readouts = page.locator('.orrery-readouts');
  assert.equal(await readouts.isVisible(), retained, 'Only committed readouts are visible');
  const box = await status.boundingBox(), identity = await page.locator('.orrery-identity').boundingBox();
  assert.equal(box.x, 8, 'Status shares the bottom-left inset');
  assert(box.y > page.viewportSize().height / 2, 'Status stays in the bottom area');
  assert(box.x + box.width <= page.viewportSize().width - 8 && box.y + box.height <= page.viewportSize().height - 8);
  assert(box.x + box.width < identity.x || box.y + box.height < identity.y, 'Status and identity do not overlap');
  if (retained) {
    const data = await readouts.boundingBox();
    assert.equal(box.y + box.height + 4, data.y, 'Feedback sits immediately above the retained readout');
  }
  assert(await status.evaluate(el => el.scrollWidth <= el.clientWidth), 'Long status wraps inside the viewport');
}

async function run({ browser, name, output = '.context/ui-polish/status' }) {
  fs.mkdirSync(output, { recursive: true });
  const server = await serve(process.env.ORRERY_DEFAULT_DIST || 'dist');
  const files = fixtureFiles();
  const index = JSON.parse(files.get([...files.keys()].find(key => key.startsWith('index-'))));
  const last = index.chunks.at(-1);
  const lastChunk = producerBase + last.url;
  const prefixChunk = producerBase + index.chunks.at(-2).url;
  const results = [];
  try {
    for (const renderer of ['pixi', 'three']) {
      for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 },
        { width: 320, height: 568 }, { width: 844, height: 390 }, { width: 320, height: 240 }]) {
        const page = await browser.newPage({ viewport });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        let releaseLatest, releasePrefix, releaseChunk, failChunk = true;
        const latestGate = new Promise(resolve => { releaseLatest = resolve; });
        const prefixGate = new Promise(resolve => { releasePrefix = resolve; });
        const chunkGate = new Promise(resolve => { releaseChunk = resolve; });
        await routeDefaultCatalog(page);
        await page.route(latestURL, async route => { await latestGate; await route.fallback(); });
        await page.route(prefixChunk, async route => { await prefixGate; await route.fallback(); });
        await page.route(lastChunk, async route => {
          await chunkGate;
          if (failChunk) await route.fulfill({ status: 503, body: 'Controlled failure' });
          else await route.fallback();
        });
        const capture = state => page.screenshot({ path: path.join(output, `${name}-${renderer}-${viewport.width}x${viewport.height}-${state}.png`) });
        try {
          await page.goto(`${server.url}/?renderer=${renderer}`, { waitUntil: 'domcontentloaded' });
          await page.getByRole('status').filter({ hasText: 'Loading asteroids' }).waitFor();
          await checkStatus(page, false);
          await capture('initial');
          releaseLatest();
          await page.getByRole('status').filter({ hasText: 'Buffering asteroids' }).waitFor();
          assert(Number(await page.locator('#orrery-count').textContent()) < last.start);
          releasePrefix();
          // The earlier prefix can briefly buffer too. Wait for its committed
          // readout and the held final chunk before inspecting stable feedback.
          await page.waitForFunction(count => document.querySelector('#orrery-count').textContent === String(count)
            && document.querySelector('#orrery-status').textContent === 'Buffering asteroids…', last.start);
          await checkStatus(page, true);
          const before = await page.locator('.orrery-readouts').textContent();
          await capture('buffering');
          releaseChunk();
          await page.getByRole('alert').filter({ hasText: 'Could not load more asteroids' }).waitFor();
          await checkStatus(page, true);
          assert.equal(await page.locator('.orrery-readouts').textContent(), before, 'Failed delivery retains the last date/count');
          await capture('error');

          // Recovery through the real reload path, followed by a valid empty catalogue.
          failChunk = false;
          await page.reload();
          await page.waitForFunction(() => document.querySelector('#orrery-count').textContent === '6'
            && document.querySelector('#orrery-status').textContent === '');
          assert(await page.locator('.orrery-readouts').isVisible());
          await capture('recovered');
          await require('./ui-theme.cjs')(page);
          await capture('options-colors');
          await page.keyboard.press('Escape');
          await routeDefaultCatalog(page, { empty: true });
          await page.reload();
          await page.waitForFunction(() => !document.querySelector('.orrery-readouts').hidden
            && document.querySelector('#orrery-count').textContent === '0'
            && document.querySelector('#orrery-status').textContent === '');
          await capture('empty');
          assert.deepEqual(errors, []);
          results.push({ renderer, viewport, initial: true, buffering: true, retainedFailure: true, reload: true, empty: true });
        } catch (error) {
          console.error({ renderer, viewport, status: await page.locator('#orrery-status').textContent(),
            readouts: await page.locator('.orrery-readouts').textContent(), errors });
          await capture('unexpected-failure');
          throw error;
        } finally { releaseLatest(); releasePrefix(); releaseChunk(); await page.close(); }
      }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`${name}: preview status layout and committed readouts passed (${results.length} scenarios).`);
  } finally { await server.close(); }
}

module.exports = { run, checkStatus };
if (require.main === module) require('./standalone.cjs').run(run);
