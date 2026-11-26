const assert = require('node:assert/strict');
const { expect } = require('@playwright/test');

// The shared Options layout and help work with either renderer, including touch.
module.exports = async (browser, root, renderer) => {
  const page = await browser.newPage({viewport:{width:1280,height:1000},deviceScaleFactor:2,hasTouch:true});
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await require('./route-files.cjs').routeFiles(page,root);
  await require('./comet-fixture.cjs').routeComets(page);
  try {
    await page.goto(`https://orrery.test/next/?renderer=${renderer}`);
    await page.evaluate(()=>threeTest.ready);
    await page.evaluate(()=>{window.app=threeTest.app;app.jedDelta=0;});
    const options=page.getByRole('button',{name:'Options',exact:true});
    const panel=page.locator('.orrery-options-panel');
    await options.tap();
    const forward=browser.browserType().name()==='webkit' && process.platform==='darwin' ? 'Alt+Tab' : 'Tab';
    await options.focus();
    await require('./options.cjs').tabIntoOptions(page,forward);
    await expect(page.getByRole('combobox',{name:'Renderer',exact:true})).toBeFocused();
    await page.keyboard.press(forward);
    await expect(page.getByRole('combobox',{name:'Rendering pixel ratio'})).toBeFocused();
    assert.deepEqual(await panel.locator('.orrery-options-info').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('aria-label'))),
      ['About Rendering pixel ratio','About Playback speed','About Real time']);
    assert.equal(await panel.locator('.orrery-options-info svg[aria-hidden="true"]').count(),3);
    const label=panel.locator('.lil-controller').filter({has:page.getByRole('combobox',{name:'Rendering pixel ratio'})}).locator('.lil-name');
    await expect(label).toHaveText('pixel density');
    const asteroid=page.getByRole('button',{name:'About asteroids',exact:true});
    const comet=page.getByRole('button',{name:'About comets',exact:true});
    await expect(asteroid).toBeVisible();await expect(comet).toBeVisible();
    assert(await asteroid.evaluate(e=>e.closest('.orrery-about-row').nextElementSibling.querySelector('[aria-label="Show comets"]')));
    assert(await comet.evaluate(e=>!e.closest('.orrery-about-row').nextElementSibling));
    const groups=page.getByRole('combobox',{name:'Minor-planet groups'});
    const choices=await groups.locator('option').evaluateAll(nodes=>nodes.map(n=>({value:n.value,label:n.textContent})));
    const dialog=page.getByRole('dialog',{name:'Asteroids',exact:true});
    for(const choice of choices) {
      await groups.selectOption(choice.value);
      await asteroid.focus();await page.keyboard.press('Enter');
      await expect(dialog.getByRole('heading',{name:'Asteroids',exact:true})).toBeFocused();
      await expect(dialog.locator('#orrery-glossary-selection')).toContainText(`Showing: ${choice.label}.`);
      assert((await dialog.locator('#orrery-glossary-selection').textContent()).length>choice.label.length+30);
      await expect(dialog).toContainText('not official classifications or verified resonances');
      await page.keyboard.press('Escape');await expect(asteroid).toBeFocused();
      await expect.poll(()=>page.evaluate(()=>app.held)).toBe(false);
    }
    await page.getByRole('checkbox',{name:'Show asteroids',exact:true}).uncheck();
    await asteroid.tap();
    await expect(dialog.locator('#orrery-glossary-selection')).toContainText('Asteroids hidden. Selected: Without the belt.');
    await dialog.getByRole('button',{name:'Close',exact:true}).tap();
    await page.getByRole('checkbox',{name:'Show comets',exact:true}).check();
    await expect(page.getByRole('button',{name:'Fit selected comets'})).toBeEnabled();
    for(const width of [1280,390,320]) {
      await page.setViewportSize({width,height:width===1280?1000:568});
      await require('./options-geometry.cjs')(panel);
      const real=page.getByRole('checkbox',{name:'Real time',exact:true});
      const info=page.getByRole('button',{name:'About Real time',exact:true});
      const icon=info.locator('svg');
      assert.deepEqual(await icon.evaluate(e=>{const r=e.getBoundingClientRect();return [r.width,r.height];}),[14,14]);
      const before=await real.isChecked();
      await info.tap();
      const tip=page.locator('#'+await info.getAttribute('aria-describedby'));
      await expect(tip).toBeVisible();
      await expect(info).toHaveCSS('color','rgb(181, 232, 193)');
      assert.equal(await real.isChecked(),before,'Touching help does not toggle its checkbox');
      assert(await tip.evaluate(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));
      await page.keyboard.press('Escape');await expect(tip).toBeHidden();await expect(panel).toBeVisible();
      for(const [trigger,modal] of [[asteroid,dialog],[comet,page.getByRole('dialog',{name:'Comets',exact:true})]]) {
        await trigger.tap();
        assert(await modal.evaluate(e=>e.scrollWidth<=e.clientWidth));
        await modal.getByRole('button',{name:'Close',exact:true}).tap();
        await expect(modal).toBeHidden();
      }
      // Pin and dismiss by touch outside the panel, without touching scene controls.
      await info.tap();await expect(tip).toBeVisible();
      await page.touchscreen.tap(width-2,2);await expect(tip).toBeHidden();await expect(panel).toBeHidden();
      await options.tap();
    }
    await page.getByRole('checkbox',{name:'Show comets',exact:true}).uncheck();
    await expect(comet).toBeVisible();await expect(asteroid).toBeVisible();
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
};
