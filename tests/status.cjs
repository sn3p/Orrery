const assert = require('node:assert/strict');
const path = require('node:path');

async function check(page) {
  const status = page.locator('#orrery-status');
  const metrics = await status.evaluate(element => {
    const style = getComputedStyle(element);
    const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = values => values.map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    const foreground = luminance(rgb(style.color));
    const background = luminance(rgb(getComputedStyle(document.body).backgroundColor));
    const bounds = element.getBoundingClientRect();
    return { ratio: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
      color: style.color, fontSize: style.fontSize, text: element.textContent,
      x: bounds.x, right: bounds.right, y: bounds.y, bottom: bounds.bottom,
      scrollWidth: element.scrollWidth, width: element.clientWidth };
  });
  assert(metrics.ratio >= 4.5, `Status contrast ${metrics.ratio.toFixed(2)}:1 must be at least 4.5:1`);
  assert.equal(metrics.fontSize, '14px');
  assert(metrics.x >= 0 && metrics.right <= page.viewportSize().width);
  assert(metrics.y >= 0 && metrics.bottom <= page.viewportSize().height);
  assert(metrics.scrollWidth <= metrics.width, 'Status wraps without overflow');
  assert(await status.isVisible());
  return metrics;
}

module.exports = async (browser, url, output, name) => {
  const results = [];
  for (const width of [1280, 360]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/data/catalog.json', async route => {
      await gate; await route.fulfill({ status: 200, body: 'invalid JSON' }).catch(() => {});
    });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await page.getByRole('status').filter({ hasText: 'Loading' }).waitFor();
      const loading = await check(page);
      await page.screenshot({ path: path.join(output, `${name}-loading-${width}.png`) });
      release();
      await page.locator('#orrery-status').filter({ hasText: 'Unable to load' }).waitFor();
      const failed = await check(page);
      await page.screenshot({ path: path.join(output, `${name}-failure-${width}.png`) });
      assert.deepEqual(errors, []);
      results.push({ width, loading, failed });
    } finally { release(); await page.close(); }
    const unavailable = await browser.newPage({ viewport: { width, height: 844 } });
    try {
      await unavailable.addInitScript(() => {
        // Pixi also probes WebGPU and Canvas when WebGL is unavailable.
        Object.defineProperty(navigator, 'gpu', { value: undefined });
        HTMLCanvasElement.prototype.getContext = () => null;
      });
      await unavailable.goto(url);
      await unavailable.getByRole('status').filter({ hasText: 'Unable to start' }).waitFor();
      results.at(-1).unavailable = await check(unavailable);
      await unavailable.screenshot({ path: path.join(output, `${name}-webgl-failure-${width}.png`) });
    } finally { await unavailable.close(); }
  }
  return results;
};
