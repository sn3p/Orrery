const assert = require('node:assert/strict');

module.exports = async function checkTheme(page) {
  const hit = await page.locator('#orrery-date').evaluate(element => {
    const box = element.getBoundingClientRect();
    return { footer: getComputedStyle(element.closest('footer')).pointerEvents,
      receivesPointer: element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
  });
  assert.equal(hit.footer, 'auto');
  assert(hit.receivesPointer, 'Footer text receives pointer input instead of the canvas');
  await page.locator('#orrery-date').click();
  await require('./options.cjs').openOptions(page);
  const snapshot = () => page.evaluate(() => {
    const colors = selector => [...document.querySelectorAll(selector)].map(el => getComputedStyle(el).color);
    return {
      hud: colors('#orrery-date, #orrery-count, #orrery-fps, .orrery-identity'),
      labels: colors('.orrery-options-panel .property-name'),
      help: colors('.orrery-options-hint'),
      values: colors('.orrery-options-panel input, .orrery-options-panel select'),
    };
  });
  const normal = await snapshot();
  const grey = color => Number(color.match(/\d+/)[0]);
  assert(normal.hud.every(color => grey(color) < 153 && grey(color) >= 119), 'HUD is slightly muted and readable');
  assert(normal.labels.every(color => grey(color) > grey(normal.values[0])), 'Labels are brighter than values');
  assert(normal.values.every(color => grey(color) > grey(normal.help[0])), 'Help text is quieter than values');
  const contrast = await page.locator('.orrery-options-hint').first().evaluate(element => {
    const luminance = color => color.match(/\d+/g).slice(0, 3).map(Number).map(value => {
      const channel = value / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    return (luminance(getComputedStyle(element).color) + 0.05)
      / (luminance(getComputedStyle(element.closest('.orrery-options-panel')).backgroundColor) + 0.05);
  });
  assert(contrast >= 4.5, 'Muted help text keeps readable contrast');
  for (const control of [page.getByRole('textbox', { name: 'Playback speed' }),
    page.getByRole('combobox', { name: 'Renderer', exact: true })]) {
    await control.hover();
    assert.deepEqual(await snapshot(), normal, 'Hover preserves each text role');
    await control.focus();
    assert.deepEqual(await snapshot(), normal, 'Focus preserves each text role');
  }
  await page.keyboard.press('Escape');
  await require('./options.cjs').openOptions(page);
  assert.deepEqual(await snapshot(), normal, 'Reopening preserves text roles');
  return normal;
};
