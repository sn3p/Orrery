const assert = require('node:assert/strict');
const { expect } = require('@playwright/test');
module.exports = async (browser, root, renderer) => {
  const page = await browser.newPage({viewport:{width:1280,height:1000}}), errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await require('./route-files.cjs').routeFiles(page,root);
  try {
    await page.goto(`https://orrery.test/next/?renderer=${renderer}`);
    await page.evaluate(()=>threeTest.ready);
    await page.evaluate(()=>{window.app=threeTest.app;app.jedDelta=1.5;});
    await page.getByRole('button',{name:'Options',exact:true}).click();
    const trigger=page.getByRole('button',{name:'About comets',exact:true});
    const dialog=page.getByRole('dialog',{name:'Comets',exact:true});
    assert.equal(await page.evaluate(()=>app.cometsShown),false);
    await trigger.focus();await page.keyboard.press('Enter');
    await expect(dialog.getByRole('heading',{name:'Comets',exact:true})).toBeFocused();
    assert.equal(await page.evaluate(()=>app.held),true);
    await expect(dialog).toContainText('Being listed in the catalogue does not mean a trajectory is available');
    await expect(dialog).toContainText('Coverage varies by comet and date');
    await expect(dialog).toContainText('up to ten years of available trajectory data');
    await expect(dialog).toContainText('not an estimate of the orbital period');
    await expect(dialog.getByRole('link',{name:'JPL Horizons'})).toHaveAttribute('href','https://ssd.jpl.nasa.gov/horizons/');
    await page.keyboard.press(browser.browserType().name()==='webkit' ? 'Alt+Tab' : 'Tab');
    await expect(dialog.getByRole('link',{name:'JPL Horizons'})).toBeFocused();
    await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(trigger).toBeFocused();
    await expect.poll(()=>page.evaluate(()=>app.held)).toBe(false);
    // Closing must preserve a hold acquired before this dialog opened.
    await page.evaluate(()=>app.hold(true));
    await trigger.click();await dialog.getByRole('button',{name:'Close',exact:true}).click();
    assert.equal(await page.evaluate(()=>app.held),true);
    await page.evaluate(()=>app.hold(false));
    await trigger.click();await page.mouse.click(1,1);await expect(dialog).toBeHidden();
    await expect.poll(()=>page.evaluate(()=>app.held)).toBe(false);
    await page.getByRole('button',{name:'Options',exact:true}).click();
    for(const width of [320,390,1280]) {
      await page.setViewportSize({width,height:width===1280?1000:568});
      for(const id of ['orrery-intro','orrery-glossary','orrery-comet-info']) {
        // The renderer fixture omits Intro; inspect its actual built markup.
        await page.locator('#'+id).evaluate(e=>e.showModal());
        const modal=page.locator('#'+id);
        assert(await modal.evaluate(e=>e.scrollWidth<=e.clientWidth+1), `${id} at ${width}: no horizontal overflow`);
        const close=modal.getByRole('button',{name:'Close',exact:true});
        await close.focus();await expect(close).toBeFocused();
        assert(await close.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));
        await page.keyboard.press('Enter');await expect(modal).toBeHidden();
      }
    }
    await page.evaluate(async()=>{
      const controls=app.gui.controls;
      controls.open();
      for (let i=0;i<3;i++) { controls.onOpenCometInfo();controls.cometInfo.close(); }
      await new Promise(resolve=>setTimeout(resolve,100));
    });
    await expect.poll(()=>page.evaluate(()=>app.held)).toBe(false);
    // Disposing after close() but before its event must release the hold too.
    await trigger.click();
    await page.evaluate(()=>{
      const controls=app.gui.controls;
      controls.cometInfo.close();controls.destroy();
    });
    await expect.poll(()=>page.evaluate(()=>app.held)).toBe(false);
    await page.reload();await page.evaluate(()=>threeTest.ready);
    await page.evaluate(()=>{window.app=threeTest.app;app.gui.controls.open();});
    await trigger.click();
    await page.evaluate(()=>app.gui.controls.destroy());
    await expect(dialog).toBeHidden();
    await expect.poll(()=>page.evaluate(()=>app.held)).toBe(false);
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
};
