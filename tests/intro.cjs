const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { serve } = require('./support.cjs');
const { routeDefaultCatalog } = require('./default-catalog-route.cjs');
const { firstVisitContext } = require('./browsers.cjs');

const loaded = page => page.waitForFunction(() => !document.querySelector('.orrery-readouts').hidden
  && Number(document.querySelector('#orrery-count').textContent.replaceAll(' ', '')) > 0);

async function holds(page, dialog, label) {
  assert(await dialog.evaluate(el => el.open), `${label}: introduction is open`);
  assert(await dialog.evaluate(el => el.contains(document.activeElement)), `${label}: focus moves into the card`);
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
      const capture = state => page.screenshot({ path: path.join(output, `${name}-${viewport.width}-${state}.png`) });
      try {
        await routeDefaultCatalog(page);
        await page.goto(`${server.url}/`);
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
