const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { serve } = require('./support.cjs');
const { routeDefaultCatalog } = require('./default-catalog-route.cjs');

const text = (page, selector) => page.locator(selector).textContent();

async function expectDateStable(page, date, message) {
  await page.waitForTimeout(120);
  const actual = await text(page, '#orrery-date');
  if (actual !== date) throw new Error(`${message}: expected ${JSON.stringify(date)}, got ${JSON.stringify(actual)}`);
}

async function run({ browser, name, output = '.context/timeline' }) {
  fs.mkdirSync(output, { recursive: true });
  const server = await serve(process.env.ORRERY_DEFAULT_DIST || 'dist');
  const results = [];
  try {
    for (const renderer of ['pixi', 'three']) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      const errors = [];
      await routeDefaultCatalog(page);
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
      try {
        await page.goto(`${server.url}/?renderer=${renderer}`);
        await page.waitForFunction(() => document.querySelector('#orrery-count')?.textContent === '6');
        const play = page.locator('#orrery-playback');
        const date = page.locator('#orrery-date');
        const dialog = page.getByRole('dialog', { name: 'Jump to date' });
        const input = page.getByLabel('UTC date');

        assert.equal(await play.getAttribute('aria-label'), 'Pause playback');
        assert.equal(await play.getAttribute('aria-keyshortcuts'), 'Space');
        assert.equal((await play.textContent()).trim(), '[⏸︎]');
        assert.equal(await date.getAttribute('aria-haspopup'), 'dialog');
        const linkStyle = await date.evaluate(element => {
          const style = getComputedStyle(element);
          return { color: style.color, decorationColor: style.textDecorationColor,
            decorationStyle: style.textDecorationStyle };
        });
        assert.equal(linkStyle.decorationStyle, 'solid');
        assert.notEqual(linkStyle.decorationColor, linkStyle.color, 'Date underline is quieter than its resting text');
        const playStyle = await play.evaluate(element => {
          const style = getComputedStyle(element);
          const indicator = element.querySelector('.orrery-control-indicator');
          const indicatorStyle = getComputedStyle(indicator);
          return { background: style.backgroundColor, borderStyle: style.borderStyle,
            height: element.getBoundingClientRect().height, indicatorBorderStyle: indicatorStyle.borderStyle,
            indicatorPadding: indicatorStyle.padding };
        });
        assert.equal(playStyle.background, 'rgba(0, 0, 0, 0)', 'Playback button stays transparent');
        assert.equal(playStyle.borderStyle, 'none', 'Playback button has no outer outline at rest');
        assert.equal(playStyle.indicatorBorderStyle, 'none', 'Playback brackets replace the drawn icon box');
        assert.equal(playStyle.indicatorPadding, '0px', 'Playback brackets need no extra visual padding');
        assert(playStyle.height >= 24, 'Playback button keeps a 24px target');
        await page.screenshot({ path: path.join(output, `${name}-${renderer}-timeline-desktop.png`) });

        await play.click();
        await page.waitForFunction(() => document.querySelector('#orrery-fps').textContent === '0 FPS');
        const paused = await date.textContent();
        await expectDateStable(page, paused, 'Visible playback control pauses the timeline');
        assert.equal(await play.getAttribute('aria-label'), 'Resume playback');
        assert.equal((await play.textContent()).trim(), '[⏵︎]');

        await require('./options.cjs').openOptions(page);
        const speed = page.getByRole('textbox', { name: 'Playback speed' });
        await speed.fill('-1.5');
        await speed.press('Enter');
        await page.getByRole('button', { name: 'Options', exact: true }).click();
        await page.waitForFunction(previous => document.querySelector('#orrery-date').textContent < previous, paused);
        await play.click();
        const reversePaused = await date.textContent();
        await expectDateStable(page, reversePaused, 'Pause works during reverse playback');
        assert.equal(await play.getAttribute('aria-label'), 'Resume reverse playback');

        await page.evaluate(() => document.activeElement.blur());
        await page.keyboard.press('Space');
        assert.equal(await play.getAttribute('aria-label'), 'Pause playback', 'Space resumes playback outside controls');
        await page.waitForFunction(previous => document.querySelector('#orrery-date').textContent < previous, reversePaused);
        await page.keyboard.press('Space');
        const shortcutPaused = await date.textContent();
        assert.equal(await play.getAttribute('aria-label'), 'Resume reverse playback');
        await expectDateStable(page, shortcutPaused, 'Space pauses playback outside controls');

        await play.click();
        const beforeEditor = await date.textContent();
        await date.click();
        assert(await dialog.isVisible());
        const editorDate = await input.inputValue();
        assert(editorDate <= beforeEditor, 'Reverse playback editor opens on the current UTC day');
        assert.equal(await input.getAttribute('aria-describedby'), 'orrery-date-help orrery-date-error');
        assert.equal(await input.evaluate(element => element === document.activeElement), true,
          'Date editor opens with focus on its UTC input');
        await page.waitForFunction(expected => document.querySelector('#orrery-date').textContent === expected, editorDate);
        await expectDateStable(page, editorDate, 'Opening the date editor holds playback');
        await input.press('Space');
        await expectDateStable(page, editorDate, 'Space inside the date editor does not toggle playback');
        await page.getByRole('button', { name: 'cancel', exact: true }).click();
        assert.equal(await date.evaluate(element => element === document.activeElement), true,
          'Cancel returns focus to the date control');
        await page.waitForFunction(previous => document.querySelector('#orrery-date').textContent < previous, editorDate);

        await date.click();
        await input.fill('2000-01-01');
        await page.getByRole('button', { name: 'jump', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#orrery-date').textContent === '2000-01-01');
        assert.equal(await play.getAttribute('aria-label'), 'Resume reverse playback',
          'A date jump stays paused and preserves reverse as the resume direction');
        await expectDateStable(page, '2000-01-01', 'Applied UTC date remains paused for inspection');

        const today = new Date().toISOString().slice(0, 10);
        await date.click();
        await page.getByRole('button', { name: 'today', exact: true }).click();
        await page.waitForFunction(expected => document.querySelector('#orrery-date').textContent === expected, today);
        assert.equal(await play.getAttribute('aria-label'), 'Resume reverse playback');

        await date.click();
        await page.getByRole('button', { name: '1980-01-01', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#orrery-date').textContent === '1980-01-01');
        assert.equal(await text(page, '#orrery-fps'), '0 FPS');

        await page.setViewportSize({ width: 320, height: 568 });
        await date.press('Enter');
        const bounds = await dialog.boundingBox();
        const viewport = page.viewportSize();
        assert(await page.getByRole('heading', { name: 'Jump to date' }).isVisible(),
          'Reopened date editor keeps its heading visible');
        assert(await input.isVisible(), 'Reopened date editor keeps its date input visible');
        assert.equal(await dialog.evaluate(element => element.scrollTop), 0,
          'Reopened date editor starts at the top');
        assert(bounds && bounds.x >= 8 && bounds.y >= 8
          && bounds.x + bounds.width <= viewport.width - 8
          && bounds.y + bounds.height <= viewport.height - 8,
        'Date editor fits the narrow viewport');
        assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true,
          'Date editor has no horizontal overflow');
        for (const control of await dialog.locator('input, button').all()) {
          assert((await control.boundingBox()).height >= 28, 'Date editor controls retain their target size');
        }
        await page.screenshot({ path: path.join(output, `${name}-${renderer}-timeline-320x568.png`) });
        await page.keyboard.press('Escape');
        assert.equal(await date.evaluate(element => element === document.activeElement), true,
          'Escape closes the editor and restores focus');
        assert.deepEqual(errors, []);
        results.push({ renderer, playback: true, reverseResume: true, keyboard: true,
          dateJump: true, todayAndBeginning: true, narrow: true });
      } finally { await page.close(); }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
    console.log(`${name}: main timeline controls passed (${results.length} renderers).`);
  } finally { await server.close(); }
}

module.exports = { run };
if (require.main === module) require('./standalone.cjs').run(run);
