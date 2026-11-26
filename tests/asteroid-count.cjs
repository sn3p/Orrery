const assert = require('node:assert/strict');
const { expect } = require('@playwright/test');

// Public entry, real checkbox -> committed render -> footer -> renderer switch/reload.
module.exports = async (browser, root, renderer) => {
  const page=await browser.newPage({viewport:{width:320,height:568},hasTouch:true});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await require('./route-files.cjs').routeFiles(page,root);
  await require('./default-catalog-route.cjs').routeDefaultCatalog(page);
  await require('./comet-fixture.cjs').routeComets(page);
  try {
    await page.goto(`https://orrery.test/?renderer=${renderer}&date=1980-02-01`);
    const count=page.locator('#orrery-count'), unit=page.locator('#orrery-count-unit'), separator=page.locator('#orrery-count-separator');
    await expect(count).toHaveText('6');await expect(count).toBeVisible();await expect(separator).toBeVisible();
    const options=page.getByRole('button',{name:'Options',exact:true});
    await options.tap();
    const asteroids=page.getByRole('checkbox',{name:'Show asteroids',exact:true});
    const comets=page.getByRole('checkbox',{name:'Show comets',exact:true});
    for(const cometShown of [false,true]) {
      await comets.setChecked(cometShown);
      await asteroids.uncheck();
      for(const element of [count,unit,separator]) await expect(element).toBeHidden();
      await expect(page.getByRole('button',{name:'About asteroids',exact:true})).toBeVisible();
      await expect(page.getByRole('button',{name:'About comets',exact:true})).toBeVisible();
      await asteroids.check();await expect(count).toHaveText('6');await expect(count).toBeVisible();await expect(separator).toBeVisible();
      await expect(unit).toBeVisible({visible:cometShown});
    }
    await asteroids.uncheck();
    await page.getByRole('combobox',{name:'Renderer',exact:true}).selectOption(renderer==='pixi'?'three':'pixi');
    await expect(page.locator('select[aria-label="Renderer"]')).toBeEnabled();
    if (await options.getAttribute('aria-expanded')==='false') await options.tap();
    for(const element of [count,unit,separator]) await expect(element).toBeHidden();
    await asteroids.check();await expect(count).toBeVisible();await expect(count).toHaveText('6');
    await options.tap();
    await page.locator('#orrery-date').tap();
    await page.locator('#orrery-date-input').fill('1800-01-01');
    await page.locator('#orrery-date-form').getByRole('button',{name:'jump',exact:true}).tap();
    await expect(count).toHaveText('0');await expect(count).toBeVisible();await expect(separator).toBeVisible();
    await page.reload();await expect(count).toHaveText('0');await expect(count).toBeVisible();await expect(separator).toBeVisible();
    await expect(unit).toBeHidden();
    assert(await page.locator('.orrery-footer').evaluate(e=>e.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
};
