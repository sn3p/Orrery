const assert = require('node:assert/strict');
const path = require('node:path');
const { serve } = require('./support.cjs');
const { routeDefaultCatalog } = require('./default-catalog-route.cjs');

// Public production entry + small hash-verified indexed catalogue. No test
// renderer, large catalogue or prebuilt fixture is needed for these boundaries.
async function run({ browser, output, renderer }) {
  const server = await serve(process.env.ORRERY_DEFAULT_DIST || 'dist');
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const ready = () => page.waitForFunction(() => document.querySelector('#orrery-count')?.textContent === '6');
  const speed = page.getByRole('textbox', { name: 'Playback speed' });
  const button = page.getByRole('button', { name: 'Options', exact: true });
  async function pause() {
    await speed.fill('0'); await speed.press('Enter');
    await page.waitForFunction(() => document.querySelector('#orrery-fps').textContent === '0 FPS');
  }
  try {
    await routeDefaultCatalog(page);
    await page.goto(`${server.url}/?renderer=${renderer}`);
    await ready();
    assert.equal(await page.title(), 'Orrery');
    assert.equal(await page.locator('#orrery canvas').count(), 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    // Enter through the real keyboard-operated public control.
    await button.focus(); await button.press('Enter');
    assert.equal(await button.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.getByRole('combobox', { name: 'Renderer', exact: true }).inputValue(), renderer);
    await pause();
    const ratio = page.getByRole('combobox', { name: 'Rendering pixel ratio' });
    await ratio.selectOption('2');
    await page.waitForFunction(() => document.querySelector('canvas').width === 780);
    await page.screenshot({ path: path.join(output, `${renderer}-smoke.png`) });
    await page.locator('canvas').evaluate(canvas => {
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      const extension = gl.getExtension('WEBGL_lose_context');
      if (!extension) throw new Error('Context-loss testing unavailable');
      window.smokeExtension = extension;
      window.smokeLost = new Promise(resolve => canvas.addEventListener('webglcontextlost', resolve, { once: true }));
      window.smokeRestored = new Promise(resolve => canvas.addEventListener('webglcontextrestored', resolve, { once: true }));
      extension.loseContext();
    });
    await page.evaluate(() => smokeLost.then(() => true));
    await page.evaluate(() => smokeExtension.restoreContext());
    await page.evaluate(() => smokeRestored.then(() => true));
    const date = await page.locator('#orrery-date').textContent();
    await speed.fill('-1.5'); await speed.press('Enter');
    await page.waitForFunction(before => document.querySelector('#orrery-date').textContent < before, date);
    await pause();
    await speed.press('Escape');
    assert.equal(await button.getAttribute('aria-expanded'), 'false');
    await page.reload();
    await page.waitForFunction(() => {
      const readouts = document.querySelector('.orrery-readouts');
      return document.querySelector('#orrery canvas') && readouts && !readouts.hidden
        && (document.querySelector('#orrery-count')?.textContent ?? '') !== '';
    });
    assert.equal(await page.locator('#orrery canvas').count(), 1);
    await button.click();
    assert.equal(await ratio.inputValue(), '2', 'Reload starts with the default DPR');
    assert.equal(await page.getByRole('combobox', { name: 'Renderer', exact: true }).inputValue(), renderer);
    assert.deepEqual(errors, [], 'No unhandled errors through startup, recovery or reload');
  } finally { await page.close(); await server.close(); }
}
module.exports = { run };
