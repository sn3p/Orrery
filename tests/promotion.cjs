const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { serve } = require('./support.cjs');
const { routeDefaultCatalog, producerBase } = require('./default-catalog-route.cjs');

async function ready(page) {
  await page.waitForFunction(() => document.querySelector('#orrery-count')?.textContent === '6');
  assert.equal(await page.locator('#orrery canvas').count(), 1);
}
async function options(page) {
  const button = page.getByRole('button', { name: 'Options', exact: true });
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  return page.getByRole('combobox', { name: 'Renderer', exact: true });
}
async function run({ browser, name, output }) {
  fs.mkdirSync(output, { recursive: true });
  const site = path.resolve(process.env.ORRERY_DEFAULT_DIST || 'dist');
  const nested = path.join(output, 'pages');
  fs.mkdirSync(nested, { recursive: true });
  fs.symlinkSync(site, path.join(nested, 'Orrery'), 'dir');
  const server = await serve(site), pages = await serve(nested);
  const results = [];
  try {
    for (const base of [server.url + '/', pages.url + '/Orrery/']) {
      for (const [entry, query, mode] of [
        ['', '', 'pixi'], ['', '?renderer=three', 'three'],
        ['next/', '?renderer=three&extra=a%20b#view', 'three'],
        ['next/index.html', '?renderer=pixi&extra=%2F%3F#section', 'pixi'],
        ['next', '?renderer=three#view', 'three'],
        ['next/', '?renderer=unknown', 'pixi'],
        ['next/', '?renderer=three&renderer=pixi', 'three'],
      ]) {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const errors = [], requests = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('request', r => requests.push(r.url()));
        await routeDefaultCatalog(page);
        try {
          const previous = base + 'history-start';
          let historyLength;
          if (entry) {
            await page.route(previous, route => route.fulfill({ contentType: 'text/html', body: '<title>Previous page</title>' }));
            await page.goto(previous);
            historyLength = await page.evaluate(() => history.length);
          }
          await page.goto(base + entry + query);
          await page.waitForURL(base + query);
          await ready(page);
          assert.equal(await page.title(), 'Orrery');
          assert.equal(await (await options(page)).inputValue(), mode);
          assert(!requests.some(url => /data\/catalog.json/.test(url)));
          assert(requests.filter(url => !url.startsWith('data:')).every(url => url.startsWith(base) || url.startsWith(producerBase)));
          if (entry) {
            assert.equal(await page.evaluate(() => history.length), historyLength + 1);
            await page.goBack();
            await page.waitForURL(previous);
            assert.equal(page.url(), previous, 'Forwarding replaces its history entry');
          }
          assert.deepEqual(errors, []);
          results.push({ base, entry, query, mode });
        } finally { await page.close(); }
      }
      // Cached PR73 HTML bootstraps against the new deployment. Then demand a
      // previously unloaded renderer chunk, as an already-open page would.
      for (const oldEntry of ['', 'next/']) {
        const page = await browser.newPage();
        const errors = [], requests = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
        page.on('request', r => requests.push(r.url()));
        await routeDefaultCatalog(page);
        const url = base + oldEntry;
        const html = fs.readFileSync(path.join(__dirname, 'fixtures/promotion', oldEntry ? 'pr73-next.html' : 'pr73-root.html'), 'utf8');
        await page.route(url, route => route.fulfill({ contentType: 'text/html', body: html }));
        try {
          await page.goto(url);
          if (oldEntry) {
            await ready(page);
            assert(!requests.some(url => /\/three\./.test(url)));
            await (await options(page)).selectOption('three');
            await page.waitForFunction(() => !document.querySelector('select[aria-label="Renderer"]').disabled);
            assert.equal(await (await options(page)).inputValue(), 'three');
            assert(requests.some(url => /\/next\/assets\/three\./.test(url)));
          } else {
            await page.waitForFunction(() => Number(document.querySelector('#orrery-count')?.textContent) > 0);
            assert(requests.some(url => /\/data\/catalog.json/.test(url)));
          }
          await page.unroute(url);
          await page.reload();
          await page.waitForURL(base);
          await ready(page);
          assert.deepEqual(errors, []);
          results.push({ base, cachedPR73: oldEntry || 'root', reload: true });
        } finally { await page.close(); }
      }
      for (const mode of ['pixi', 'three']) {
        const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
        const errors = []; page.on('pageerror', e => errors.push(e.message));
        await routeDefaultCatalog(page);
        const pattern = `**/assets/${mode}.*.js`;
        await page.route(pattern, route => route.fulfill({ status: 404, body: 'Removed chunk' }));
        try {
          await page.goto(base + '?renderer=' + mode);
          await page.locator('#orrery-status').filter({ hasText: 'Unable to start' }).waitFor();
          assert.equal(await page.locator('canvas').count(), 0);
          await page.screenshot({ path: path.join(output, `${name}-${base.includes('/Orrery/') ? 'pages' : 'root'}-${mode}-missing-chunk.png`) });
          if (mode === 'three') {
            const link = page.getByRole('link', { name: 'Open Pixi preview', exact: true });
            assert.equal(new URL(await link.getAttribute('href')).pathname, new URL(base).pathname);
            await link.click(); await ready(page);
          }
          await page.unroute(pattern);
          await page.goto(base + '?renderer=' + mode);
          await ready(page);
          assert.equal(await (await options(page)).inputValue(), mode);
          assert.deepEqual(errors, []);
          results.push({ base, mode, missingChunkRecovery: true });
        } finally { await page.close(); }
      }
    }
    fs.writeFileSync(path.join(output, 'promotion.json'), JSON.stringify(results, null, 2) + '\n');
  } finally { await server.close(); await pages.close(); }
}
async function configured({ browser, name, output }) {
  fs.mkdirSync(output, { recursive: true });
  const results = [];
  for (const mode of ['indexed', 'whole']) {
    const site = path.join(output, mode);
    await require('../scripts/catalog.cjs').buildTrial(path.resolve(`catalog-profiles/ties-${mode}.json`), site,
      { assembled: true, publicDefaults: true });
    const container = path.join(output, mode + '-pages'); fs.mkdirSync(container, { recursive: true });
    fs.symlinkSync(path.resolve(site), path.join(container, 'Orrery'), 'dir');
    const server = await serve(container);
    try { for (const renderer of ['pixi', 'three']) for (const cached of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const requests = [], errors = [];
      page.on('request', r => requests.push(r.url()));
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
      const base = server.url + '/Orrery/';
      if (cached) await page.route(base + 'next/?renderer=' + renderer, route => route.fulfill({
        contentType: 'text/html', body: fs.readFileSync(path.join(site, 'index.html'), 'utf8'),
      }));
      try {
        await page.goto(base + 'next/?renderer=' + renderer);
        await page.waitForFunction(() => document.querySelector('#orrery-count')?.textContent === '4');
        assert.equal(page.url(), base + (cached ? 'next/' : '') + '?renderer=' + renderer);
        const selector = await options(page);
        assert.equal(await selector.inputValue(), renderer);
        assert.equal(await page.getByRole('textbox', { name: 'Playback speed' }).inputValue(), '0');
        assert.equal(await page.locator('#orrery-date').textContent(), '2000-01-01');
        const dataBase = base + (cached ? 'next/' : '') + 'data/delivery-v1-';
        assert(requests.some(url => url.startsWith(dataBase) && url.endsWith('/index.json')));
        assert(!requests.some(url => url.endsWith('/data/catalog.json')));
        assert(!requests.some(url => !url.startsWith(base) && !url.startsWith('data:')));
        const speed = page.getByRole('textbox', { name: 'Playback speed' });
        await speed.fill('8'); await speed.press('Enter');
        await page.waitForFunction(() => document.querySelector('#orrery-count')?.textContent === '5');
        await speed.fill('0'); await speed.press('Enter');
        await selector.selectOption(renderer === 'pixi' ? 'three' : 'pixi');
        await page.waitForFunction(() => !document.querySelector('select[aria-label="Renderer"]').disabled);
        assert.equal(await page.locator('#orrery-count').textContent(), '5');
        assert.deepEqual(errors, []);
        results.push({ mode, renderer, cached, initialCount: 4, finalCount: 5 });
      } finally { await page.close(); }
    } } finally { await server.close(); }
  }
  fs.writeFileSync(path.join(output, 'configured-promotion.json'), JSON.stringify(results, null, 2) + '\n');
}
module.exports = { run, configured };
