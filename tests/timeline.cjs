const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { serve } = require('./support.cjs');
const { routeDefaultCatalog } = require('./default-catalog-route.cjs');

const text = (page, selector) => page.locator(selector).textContent();
const share = page => new URL(page.url()).searchParams;

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
        const play = page.locator('#orrery-playback');
        const date = page.locator('#orrery-date');
        const dialog = page.getByRole('dialog', { name: 'Jump to date' });
        const input = page.getByLabel('UTC date');
        const shared = renderer === 'pixi' ? '?renderer=pixi&date=2005-05-03' : '?date=2005-05-03';
        await page.goto(`${server.url}/${shared}`);
        await page.waitForFunction(() => document.querySelector('#orrery-count')?.textContent === '6');
        assert.equal(await date.textContent(), '2005-05-03', 'A shared UTC date is the initial inspection day');
        assert.equal(await play.getAttribute('aria-label'), 'Resume playback', 'A shared date starts paused');
        assert.equal(share(page).get('date'), '2005-05-03');
        assert.equal(share(page).get('renderer'), renderer === 'pixi' ? 'pixi' : null);

        const currentDay = new Date().toISOString().slice(0, 10);
        await page.goto(`${server.url}/?renderer=${renderer}&date=${currentDay}`);
        await page.waitForFunction(() => document.querySelector('#orrery-count')?.textContent === '6');
        assert.equal(await date.textContent(), currentDay, 'A shared today opens on today');
        assert.equal(await play.getAttribute('aria-label'), 'Resume playback', 'A shared today stays paused with real time on');
        assert.equal(await page.locator('#orrery-now').isHidden(), true, 'A paused shared today shows no real-time mark');
        assert.equal(share(page).get('date'), currentDay);

        await page.goto(`${server.url}/?renderer=${renderer}&date=not-a-day`);
        await page.waitForFunction(() => document.querySelector('#orrery-count')?.textContent === '6');
        assert.equal(await play.getAttribute('aria-label'), 'Pause playback', 'An invalid date is ignored');

        await page.goto(`${server.url}/?renderer=${renderer}`);
        await page.waitForFunction(() => document.querySelector('#orrery-count')?.textContent === '6');

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
            indicatorPadding: indicatorStyle.padding, indicatorWidth: indicator.getBoundingClientRect().width };
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
        assert.equal(share(page).get('date'), paused === '1980-01-01' ? null : paused,
          'Pause writes the visible UTC day, omitting the 1980 beginning');
        assert.equal(share(page).get('renderer'), renderer === 'pixi' ? 'pixi' : null);
        assert.equal(await play.getAttribute('aria-label'), 'Resume playback');
        assert.equal((await play.textContent()).trim(), '[⏵︎]');
        assert.equal(await play.locator('.orrery-control-indicator').evaluate(element => element.getBoundingClientRect().width),
          playStyle.indicatorWidth, 'Pause and play symbols keep the same fixed width');

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
        const title = page.getByRole('heading', { name: 'Jump to date' });
        assert.equal(await title.evaluate(element => element === document.activeElement), true,
        'Date editor opens on its heading without invoking the native input');
        assert.equal(await title.evaluate(element => getComputedStyle(element).outlineStyle), 'none',
          'The non-interactive initial focus target has no native focus ring');
        assert.equal(await input.evaluate(element => element === document.activeElement), false,
          'Date input waits for explicit interaction');
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
        assert.equal(share(page).get('date'), '2000-01-01', 'A date jump is named in the URL');

        const today = new Date().toISOString().slice(0, 10);
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Options', exact: true }).click();
        await page.getByRole('checkbox', { name: 'Real time' }).uncheck();
        await page.keyboard.press('Escape');
        await date.click();
        await page.getByRole('button', { name: 'today', exact: true }).click();
        await page.waitForFunction(expected => document.querySelector('#orrery-date').textContent === expected, today);
        assert.equal(await play.getAttribute('aria-label'), 'Resume reverse playback',
          'Today pauses and keeps the reverse resume direction while real time is off');
        assert.equal(share(page).get('date'), today);

        await page.getByRole('button', { name: 'Options', exact: true }).click();
        await page.getByRole('checkbox', { name: 'Real time' }).check();
        await page.keyboard.press('Escape');
        await date.click();
        await page.getByRole('button', { name: 'today (real time)', exact: true }).click();
        await page.waitForFunction(expected => document.querySelector('#orrery-date').textContent === expected, today);
        assert.equal(await play.getAttribute('aria-label'), 'Pause playback',
          'Today keeps playing while real time is on');
        assert.equal(await date.textContent(), today);

        await date.click();
        await page.getByRole('button', { name: '1980-01-01', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('#orrery-date').textContent === '1980-01-01');
        assert.equal(await text(page, '#orrery-fps'), '0 FPS');
        assert.equal(share(page).get('date'), null, 'The 1980 beginning is omitted from the URL');

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
