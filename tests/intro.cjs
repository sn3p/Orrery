const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { serve } = require('./support.cjs');
const { routeDefaultCatalog } = require('./default-catalog-route.cjs');
const { firstVisitContext } = require('./browsers.cjs');

// A valid beginning can predate the first discovery and therefore show zero.
const loaded = page => page.waitForFunction(() => !document.querySelector('.orrery-readouts').hidden
  && document.querySelector('#orrery-count').textContent !== ''
  && document.querySelector('#orrery-status').textContent === '');

async function expectDateStable(page, date, message) {
  await page.waitForTimeout(120);
  assert.equal(await page.locator('#orrery-date').textContent(), date, message);
}

async function holds(page, dialog, label) {
  assert(await dialog.evaluate(el => el.open), `${label}: introduction is open`);
  assert(await dialog.evaluate(el => el.contains(document.activeElement)), `${label}: focus moves into the card`);
  const theme = await dialog.evaluate(el => {
    const close = el.querySelector('.orrery-intro-close');
    return {
      border: getComputedStyle(el).borderColor,
      closeBorder: getComputedStyle(close).borderColor,
      closeColor: getComputedStyle(close).color,
      closeFocused: close === document.activeElement,
      closeFocusVisible: close.matches(':focus-visible'),
      closeOutline: getComputedStyle(close).outlineStyle,
      closeOutlineColor: getComputedStyle(close).outlineColor,
    };
  });
  assert.equal(theme.border, 'rgb(54, 92, 65)', `${label}: dialog uses the green chrome border`);
  assert.equal(theme.closeBorder, 'rgb(71, 123, 84)', `${label}: primary action uses the green border`);
  assert.equal(theme.closeColor, 'rgb(181, 232, 193)', `${label}: primary action uses the green label`);
  assert(theme.closeFocused, `${label}: focus moves to the Close action rather than the title`);
  if (theme.closeFocusVisible) {
    assert.equal(theme.closeOutline, 'solid', `${label}: keyboard focus keeps a visible outline`);
    assert.equal(theme.closeOutlineColor, 'rgb(0, 232, 90)', `${label}: visible focus uses the green accent`);
  } else assert.equal(theme.closeOutline, 'none', `${label}: pointer focus has no native outline`);
  const linkThemes = await dialog.locator('a').evaluateAll(links => links.map(link => {
    const style = getComputedStyle(link);
    return { color: style.color, decorationColor: style.textDecorationColor, decorationStyle: style.textDecorationStyle };
  }));
  assert(linkThemes.every(link => link.color === 'rgb(111, 191, 131)'), `${label}: dialog links use the standard green`);
  assert(linkThemes.every(link => link.decorationStyle === 'solid'), `${label}: links use solid underlines`);
  assert(linkThemes.every(link => link.decorationColor !== link.color), `${label}: link underlines stay subdued`);
  const firstLink = dialog.locator('a').first();
  await firstLink.hover();
  assert.equal(await firstLink.evaluate(link => getComputedStyle(link).color), 'rgb(0, 232, 90)',
    `${label}: dialog links brighten on hover`);
  await page.mouse.move(0, 0);
  const actions = await dialog.locator('.orrery-intro-action').evaluateAll(buttons => buttons.map(button => {
    const style = getComputedStyle(button);
    return { name: button.textContent, pressed: button.getAttribute('aria-pressed'), disabled: button.disabled,
      height: button.getBoundingClientRect().height, color: style.color, fontWeight: style.fontWeight,
      decorationColor: style.textDecorationColor, decorationLine: style.textDecorationLine,
      decorationStyle: style.textDecorationStyle };
  }));
  assert.equal(actions.length, 5, `${label}: date, options, groups and both renderer shortcuts are available`);
  assert(actions.every(action => action.height >= 24), `${label}: intro shortcuts keep comfortable targets`);
  assert(actions.every(action => action.decorationStyle === 'solid' && action.decorationLine === 'underline'),
    `${label}: available shortcuts use the link treatment`);
  assert(actions.every(action => action.color === 'rgb(111, 191, 131)' && action.fontWeight === '400'),
    `${label}: all shortcuts use the same plain green link treatment`);
  assert(actions.filter(action => action.pressed !== null).length === 2, `${label}: both renderer choices expose pressed state`);
  assert.equal(actions.filter(action => action.pressed === 'true').length, 1, `${label}: one renderer is current`);
  assert.equal(actions.filter(action => action.pressed !== null && !action.disabled).length, 2,
    `${label}: both renderer choices remain actionable`);
  const alternate = dialog.locator('.orrery-intro-renderer[aria-pressed="false"]');
  const disabledTheme = await alternate.evaluate(button => {
    button.disabled = true;
    const style = getComputedStyle(button);
    const result = { color: style.color, decorationLine: style.textDecorationLine };
    button.disabled = false;
    return result;
  });
  assert.equal(disabledTheme.decorationLine, 'none', `${label}: an unavailable shortcut no longer looks linked`);
  assert.notEqual(disabledTheme.color, actions.find(action => action.pressed === 'false').color,
    `${label}: an unavailable shortcut uses a visibly muted color`);
  const date = await page.locator('#orrery-date').textContent();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('#orrery-date').textContent(), date, `${label}: playback holds while the introduction is open`);
  assert.equal(await page.locator('#orrery-fps').textContent(), '0 FPS', `${label}: no frames are drawn while holding`);
  assert.equal(await page.locator('input[aria-label="Playback speed"]').inputValue(), '1.5', `${label}: the chosen speed is kept`);
  const box = await dialog.boundingBox(), viewport = page.viewportSize();
  assert(box.x >= 8 && box.y >= 8 && box.x + box.width <= viewport.width - 8 && box.y + box.height <= viewport.height - 8,
    `${label}: the card fits inside the viewport inset`);
  return date;
}

async function resumes(page, dialog, date, label) {
  await page.locator('#orrery-intro').evaluate(el => new Promise(resolve => (el.open ? el.addEventListener('close', resolve, { once: true }) : resolve())));
  await page.waitForFunction(previous => document.querySelector('#orrery-date').textContent !== previous, date);
  assert.equal(await page.evaluate(() => localStorage.getItem('orrery.intro')), 'seen', `${label}: dismissal is remembered`);
}

async function activate(dialog, action) {
  const closed = dialog.evaluate(el => new Promise(resolve => el.addEventListener('close', resolve, { once: true })));
  await action.click();
  await closed;
}

async function run({ browser, name, output = '.context/intro' }) {
  fs.mkdirSync(output, { recursive: true });
  const server = await serve(process.env.ORRERY_DEFAULT_DIST || 'dist');
  const results = [];
  try {
    for (const viewport of [{ width: 1280, height: 800 }, { width: 320, height: 568 }]) {
      const context = await firstVisitContext(browser, { viewport });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      const capture = process.env.ORRERY_NO_SCREENSHOTS === '1' ? async () => {}
        : state => page.screenshot({ path: path.join(output, `${name}-${viewport.width}-${state}.png`) });
      try {
        await routeDefaultCatalog(page);
        // The shortcut sequence starts on Pixi. `/` itself opens Three.js.
        await page.goto(`${server.url}/?renderer=pixi`);
        const dialog = page.getByRole('dialog', { name: 'Orrery' });
        await dialog.waitFor();
        await loaded(page);
        const first = await holds(page, dialog, 'first visit');
        await capture('first-visit');
        await page.keyboard.press('Escape');
        await resumes(page, dialog, first, 'Escape');

        await page.reload();
        await loaded(page);
        assert(!await page.locator('#orrery-intro').evaluate(el => el.open), 'A remembered visitor is not interrupted again');
        await require('./next-layout.cjs').check(page);
        const about = page.getByRole('button', { name: 'About Orrery', exact: true });
        assert((await about.boundingBox()).height >= 24, 'The footer trigger keeps a comfortable target');
        assert.equal(await dialog.getByRole('link', { name: 'GitHub' }).count(), 0, 'Links are hidden with the card');

        await about.click();
        const reopened = await holds(page, dialog, 'About');
        assert.equal(await dialog.getByRole('link', { name: 'GitHub' }).getAttribute('href'), 'https://github.com/sn3p/Orrery', 'The card links the repository');
        assert.deepEqual(await dialog.locator('a').evaluateAll(links => links.map(link => link.textContent.trim())),
          ['GitHub', 'Minor Planet Center', 'orrery-data'], 'Code precedes data in the About card');
        await capture('about');
        await page.mouse.click(2, 2);
        await resumes(page, dialog, reopened, 'backdrop click');
        // Safari's convention leaves buttons unfocused after a pointer click, so
        // the dialog has nothing to restore there; focus must still leave the card.
        if (name === 'webkit') assert(!await page.locator('#orrery-intro').evaluate(el => el.contains(document.activeElement)), 'Focus leaves the closed card');
        else assert(await about.evaluate(el => el === document.activeElement), 'Focus returns to the footer trigger');

        await about.click();
        const again = await holds(page, dialog, 'About again');
        await dialog.getByRole('button', { name: 'Close' }).click();
        await resumes(page, dialog, again, 'Close button');

        await about.click();
        const beforeOptions = await holds(page, dialog, 'Options shortcut');
        await activate(dialog, dialog.getByRole('button', { name: 'Open options' }));
        const options = page.getByRole('button', { name: 'Options', exact: true });
        await page.waitForFunction(() => document.querySelector('.orrery-options-trigger')?.getAttribute('aria-expanded') === 'true');
        assert(await options.evaluate(el => el === document.activeElement), 'Options shortcut transfers focus to the real disclosure');
        await page.waitForFunction(previous => document.querySelector('#orrery-date').textContent !== previous, beforeOptions);
        await options.click();

        await about.click();
        const beforeGlossary = await holds(page, dialog, 'Groups shortcut');
        await activate(dialog, dialog.getByRole('button', { name: 'minor-planet groups', exact: true }));
        const glossary = page.getByRole('dialog', { name: 'Minor-planet groups' });
        await glossary.waitFor();
        assert.equal(await page.evaluate(() => document.activeElement?.id), 'orrery-glossary-title',
          'Groups shortcut focuses the glossary title');
        await expectDateStable(page, beforeGlossary, 'Groups shortcut keeps playback held');
        await glossary.getByRole('button', { name: 'Close' }).click();
        assert(await about.evaluate(el => el === document.activeElement),
          'Closing the glossary opened from About returns to the footer trigger');
        await page.waitForFunction(previous => document.querySelector('#orrery-date').textContent !== previous, beforeGlossary);

        await about.click();
        const beforeDate = await holds(page, dialog, 'Date shortcut');
        await activate(dialog, dialog.getByRole('button', { name: 'date', exact: true }));
        const dateDialog = page.getByRole('dialog', { name: 'Jump to date' });
        await dateDialog.waitFor();
        assert(await page.locator('#orrery-date-title').evaluate(el => el === document.activeElement),
          'Date shortcut preserves the title-first mobile picker behavior');
        await expectDateStable(page, beforeDate, 'Date shortcut keeps playback held');
        await dateDialog.getByRole('button', { name: 'cancel' }).click();
        await page.waitForFunction(previous => document.querySelector('#orrery-date').textContent !== previous, beforeDate);

        await about.click();
        await holds(page, dialog, 'External renderer switch');
        const externalTwoD = dialog.getByRole('button', { name: '2D', exact: true });
        const externalThreeD = dialog.getByRole('button', { name: '3D', exact: true });
        await page.locator('select[aria-label="Renderer"]').evaluate(select => {
          select.value = 'three';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });
        // A warm switch can finish within a round trip, so read busy and both
        // disabled states in one evaluation rather than three.
        const busyChoices = await page.waitForFunction(() => {
          const group = document.querySelector('#orrery-intro-renderers');
          if (group?.getAttribute('aria-busy') !== 'true') return null;
          return [...group.querySelectorAll('.orrery-intro-renderer')].every(button => button.disabled);
        });
        assert(await busyChoices.jsonValue(),
          'A switch started elsewhere immediately disables both intro choices');
        await page.waitForFunction(() => {
          const select = document.querySelector('select[aria-label="Renderer"]');
          return select?.value === 'three' && !select.disabled
            && document.querySelector('#orrery-intro-renderers')?.getAttribute('aria-busy') === 'false';
        });
        assert.equal(await externalThreeD.getAttribute('aria-pressed'), 'true',
          'The open introduction follows the externally selected renderer');
        assert(!await externalTwoD.isDisabled() && !await externalThreeD.isDisabled());
        await activate(dialog, externalTwoD);
        await page.waitForFunction(() => {
          const select = document.querySelector('select[aria-label="Renderer"]');
          return select?.value === 'pixi' && !select.disabled;
        });

        await about.click();
        await holds(page, dialog, '3D shortcut');
        const twoD = dialog.getByRole('button', { name: '2D', exact: true });
        const threeD = dialog.getByRole('button', { name: '3D', exact: true });
        assert.equal(await twoD.getAttribute('aria-pressed'), 'true');
        assert(!await twoD.isDisabled());
        await activate(dialog, threeD);
        await page.waitForFunction(() => {
          const select = document.querySelector('select[aria-label="Renderer"]');
          return select?.value === 'three' && !select.disabled;
        });

        await about.click();
        await holds(page, dialog, '2D shortcut');
        assert.equal(await threeD.getAttribute('aria-pressed'), 'true');
        assert(!await threeD.isDisabled());
        assert.equal(await twoD.getAttribute('aria-pressed'), 'false');
        assert(!await twoD.isDisabled());
        await activate(dialog, twoD);
        await page.waitForFunction(() => {
          const select = document.querySelector('select[aria-label="Renderer"]');
          return select?.value === 'pixi' && !select.disabled;
        });

        await about.click();
        const beforeCurrent = await holds(page, dialog, 'Current renderer shortcut');
        assert.equal(await twoD.getAttribute('aria-pressed'), 'true');
        assert(!await twoD.isDisabled());
        await activate(dialog, twoD);
        await resumes(page, dialog, beforeCurrent, 'current renderer shortcut');
        assert.equal(await page.locator('select[aria-label="Renderer"]').inputValue(), 'pixi',
          'Choosing the current renderer leaves it selected');
        assert.deepEqual(errors, []);
        results.push({ browser: name, viewport, firstVisit: true, remembered: true, reopen: true });
      } finally { await context.close(); }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`${name}: introduction, hold and About passed (${results.length} viewports).`);
  } finally { await server.close(); }
}

module.exports = { run };
if (require.main === module) require('./standalone.cjs').run(run);
