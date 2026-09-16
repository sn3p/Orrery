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
      for (const suffix of ['next', 'next/', 'next/index.html', 'next/assets/retired.js', 'bundle.js', 'main.css', 'data/catalog.json']) {
        const response = await browser.newContext();
        try {
          const result = await response.request.get(base + suffix + '?renderer=three&extra=a%20b');
          assert.equal(result.status(), 404);
          assert(new URL(result.url()).pathname.startsWith(new URL(base).pathname));
        } finally { await response.close(); }
      }
      for (const [query, mode] of [
        ['', 'pixi'], ['?renderer=three', 'three'],
        ['?renderer=three&extra=a%20b#view', 'three'],
        ['?renderer=pixi&extra=%2F%3F#section', 'pixi'],
        ['?renderer=unknown', 'pixi'], ['?renderer=three&renderer=pixi', 'three'],
      ]) {
        const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
        const errors = [], requests = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        page.on('request', r => requests.push(r.url()));
        await routeDefaultCatalog(page);
        try {
          await page.goto(base + query);
          await ready(page);
          assert.equal(await page.title(), 'Orrery');
          assert.equal(await (await options(page)).inputValue(), mode);
          assert(!requests.some(url => /data\/catalog.json/.test(url)));
          assert(requests.filter(url => !url.startsWith('data:')).every(url => url.startsWith(base) || url.startsWith(producerBase)));
          assert.deepEqual(errors, []);
          results.push({ base, query, mode });
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
    require('./site-assets.cjs')(site);
    const container = path.join(output, mode + '-pages'); fs.mkdirSync(container, { recursive: true });
    fs.symlinkSync(path.resolve(site), path.join(container, 'Orrery'), 'dir');
    const server = await serve(container);
    try {
      for (const suffix of ['next', 'next/', 'next/index.html', 'next/assets/retired.js', 'bundle.js', 'main.css', 'data/catalog.json']) {
        const context = await browser.newContext();
        try { assert.equal((await context.request.get(server.url + '/Orrery/' + suffix + '?renderer=three')).status(), 404); }
        finally { await context.close(); }
      }
      for (const renderer of ['pixi', 'three']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const requests = [], errors = [];
      page.on('request', r => requests.push(r.url()));
      page.on('pageerror', e => errors.push(e.message));
      page.on('response', r => { if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`); });
      const base = server.url + '/Orrery/';
      try {
        await page.goto(base + '?renderer=' + renderer);
        await page.waitForFunction(() => document.querySelector('#orrery-count')?.textContent === '4');
        assert.equal(page.url(), base + '?renderer=' + renderer);
        const selector = await options(page);
        assert.equal(await selector.inputValue(), renderer);
        assert.equal(await page.getByRole('textbox', { name: 'Playback speed' }).inputValue(), '0');
        assert.equal(await page.locator('#orrery-date').textContent(), '2000-01-01');
        const dataBase = base + 'data/delivery-v1-';
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
        results.push({ mode, renderer, initialCount: 4, finalCount: 5 });
      } finally { await page.close(); }
    }
    } finally { await server.close(); }
  }
  fs.writeFileSync(path.join(output, 'configured-promotion.json'), JSON.stringify(results, null, 2) + '\n');
}
module.exports = { run, configured };
