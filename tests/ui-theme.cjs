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
  const dateDialog = page.getByRole('dialog', { name: 'Jump to date' });
  assert(await dateDialog.isVisible(), 'The accented date remains an interactive control');
  const dateTitle = page.getByRole('heading', { name: 'Jump to date' });
  assert.equal(await dateTitle.evaluate(el => el === document.activeElement), true,
  'The dialog does not invoke its native date input automatically');
  assert.equal(await dateTitle.evaluate(el => getComputedStyle(el).outlineStyle), 'none',
    'The static dialog heading does not show a native focus ring');
  await page.getByRole('button', { name: 'cancel', exact: true }).click();
  await require('./options.cjs').openOptions(page);
  const viewport = page.viewportSize();
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  const snapshot = () => page.evaluate(() => {
    const colors = selector => [...document.querySelectorAll(selector)].map(el => getComputedStyle(el).color);
    return {
      hud: colors('#orrery-count, #orrery-fps, .orrery-identity'),
      links: colors('#orrery-date, .orrery-about, .orrery-options-trigger'),
      optionMarker: colors('.orrery-options-indicator'),
      labels: colors('.orrery-options-panel .property-name'),
      help: colors('.orrery-options-hint'),
      values: colors('.orrery-options-panel input, .orrery-options-panel select'),
      panelBorder: getComputedStyle(document.querySelector('.orrery-options-panel')).borderColor,
      underlines: [...document.querySelectorAll('#orrery-date, .orrery-about')].map(element => {
        const style = getComputedStyle(element);
        return { color: style.color, decorationColor: style.textDecorationColor, style: style.textDecorationStyle };
      }),
      optionsDecoration: getComputedStyle(document.querySelector('.orrery-options-trigger')).textDecorationLine,
    };
  });
  const normal = await snapshot();
  const grey = color => Number(color.match(/\d+/)[0]);
  assert(normal.hud.every(color => grey(color) < 153 && grey(color) >= 119), 'HUD is slightly muted and readable');
  assert(normal.links.every(color => color === 'rgb(136, 136, 136)'), 'HUD links are muted at rest');
  assert(normal.underlines.every(underline => underline.style === 'solid'), 'Link controls use a solid underline');
  assert(normal.underlines.every(underline => grey(underline.decorationColor) < grey(underline.color)),
    'Link underlines are quieter than their resting text');
  assert.equal(normal.optionsDecoration, 'none', 'Options is not underlined');
  assert.deepEqual(normal.optionMarker, [normal.links[2]], 'The Options marker inherits the normal link color');
  assert(Number(normal.panelBorder.match(/\d+/g)[1]) > Number(normal.panelBorder.match(/\d+/g)[0]),
    'Options panel uses the same green border treatment as the date dialog');
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
  await page.locator('#orrery-date').hover();
  assert.equal(await page.locator('#orrery-date').evaluate(element => getComputedStyle(element).color), 'rgb(0, 232, 90)',
    'White links turn green on hover');
  await page.getByRole('button', { name: 'Options', exact: true }).hover();
  assert.equal(await page.getByRole('button', { name: 'Options', exact: true }).evaluate(element => getComputedStyle(element).color),
    'rgb(0, 232, 90)', 'Options turns green only on hover');
  for (const control of [page.getByRole('textbox', { name: 'Playback speed' }),
    page.getByRole('combobox', { name: 'Renderer', exact: true })]) {
    await control.hover();
    assert.deepEqual(await snapshot(), normal, 'Hover preserves each text role');
    await control.focus();
    assert.deepEqual(await snapshot(), normal, 'Focus preserves each text role');
  }
  await page.keyboard.press('Escape');
  await require('./options.cjs').openOptions(page);
  await page.mouse.move(viewport.width / 2, viewport.height / 2);
  assert.deepEqual(await snapshot(), normal, 'Reopening preserves text roles');
  return normal;
};
