const assert = require('node:assert/strict');
// DOMRect arithmetic in Firefox may differ by fractions of a layout pixel.
const epsilon = 1 / 64;
const aligned = (actual, expected, message) => assert(Math.abs(actual - expected) < epsilon, message);

exports.check = async page => {
  const layout = await page.evaluate(() => {
    const box = selector => {
      const { x, y, right, bottom, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { x, y, right, bottom, width, height };
    };
    return { playback: box('.orrery-playback'), date: box('.orrery-date'), count: box('.orrery-count'), readouts: box('.orrery-readouts'),
      identity: box('.orrery-identity'), options: box('.orrery-options-trigger'), fps: box('.orrery-fps'),
      width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth };
  });
  for (const box of [layout.readouts, layout.identity, layout.options, layout.fps]) {
    assert(box.x >= 8 - epsilon && box.right <= layout.width - 8 + epsilon
      && box.y >= 8 - epsilon && box.bottom <= layout.height - 8 + epsilon,
      'HUD fits within the shared edge inset');
  }
  aligned(layout.playback.y + layout.playback.height / 2, layout.date.y + layout.date.height / 2,
    'Playback and date controls share a line');
  aligned(layout.date.y + layout.date.height / 2, layout.count.y + layout.count.height / 2,
    'Date and count share a visual baseline');
  assert(layout.playback.right < layout.date.x, 'Playback and date have a visible control gap');
  assert(layout.date.right < layout.count.x, 'Date and count have a visible separator gap');
  aligned(layout.options.x, 8, 'Options stays top-left');
  aligned(layout.fps.right, layout.width - 8, 'FPS stays top-right');
  aligned(layout.readouts.x, 8, 'Readouts stay left aligned');
  aligned(layout.identity.right, layout.width - 8, 'Identity stays right aligned');
  assert(layout.readouts.right < layout.identity.x || layout.readouts.bottom < layout.identity.y,
    'Footer groups sit alongside or wrap without overlap');
  assert.equal(layout.scrollWidth, layout.width, 'No horizontal overflow');
  assert.equal(await page.locator('.preview-identity').count(), 0);
  assert.equal(await page.getByRole('link', { name: 'Open Orrery' }).count(), 0);
  assert((await page.getByRole('button', { name: 'About Orrery', exact: true }).boundingBox()).height >= 24,
    'The small footer text retains a comfortable target');
  for (const control of [page.locator('.orrery-playback'), page.locator('.orrery-date')]) {
    assert((await control.boundingBox()).height >= 24, 'Timeline controls retain a comfortable target');
  }
  const styles = await page.locator('.orrery-playback, .orrery-date, .orrery-count, .orrery-fps, .orrery-identity, .orrery-options-trigger, .orrery-options-indicator, .orrery-options-hint, .dg .property-name, input[aria-label="Playback speed"], .dg select')
    .evaluateAll(elements => elements.map(element => getComputedStyle(element).fontSize));
  assert(styles.every(size => size === '12px'), 'All preview text uses 12px');
  return layout;
};

// Typography stress only: real catalogue/count semantics are checked by the
// rendering suites. Reserve space for longer numbers even with the fallback font.
exports.checkLongReadouts = async page => {
  const saved = await page.locator('#orrery-count').textContent();
  const font = await page.locator('body').evaluate(el => el.style.fontFamily);
  try {
    for (const family of ['', 'monospace']) {
      await page.locator('body').evaluate((el, family) => { el.style.fontFamily = family; }, family);
      await page.locator('#orrery-count').evaluate(el => { el.textContent = '1\u202f234\u202f567'; });
      await exports.check(page);
    }
  } finally {
    await page.locator('#orrery-count').evaluate((el, text) => { el.textContent = text; }, saved);
    await page.locator('body').evaluate((el, family) => { el.style.fontFamily = family; }, font);
  }
};
