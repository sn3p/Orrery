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
    // Both section dialogs share hold/focus semantics, including native queued
    // close events and disposal before those events can be delivered.
    for (const kind of ['Asteroids','Comets']) {
      const about=page.getByRole('button',{name:`About ${kind.toLowerCase()}`,exact:true});
      const modal=page.getByRole('dialog',{name:kind,exact:true});
      await page.evaluate(()=>app.gui.controls.open());
      await page.evaluate(()=>app.hold(true));
      await about.click();await modal.getByRole('button',{name:'Close',exact:true}).click();
      await expect(about).toBeFocused();assert.equal(await page.evaluate(()=>app.held),true);
      await page.evaluate(()=>app.hold(false));
      await about.focus();await page.keyboard.press('Enter');
      await page.evaluate(()=>app.gui.controls.setOpen(false));
      await expect(page.getByRole('button',{name:'Options',exact:true})).toBeFocused();
      await expect.poll(()=>page.evaluate(()=>app.held)).toBe(false);
      await page.evaluate(async kind=>{
        const c=app.gui.controls;c.open();
        const trigger=kind==='Asteroids'?c.glossaryTrigger:c.cometInfoTrigger;
        const modal=kind==='Asteroids'?c.glossary:c.cometInfo;
        for(let i=0;i<3;i++){trigger.click();modal.close();}
        await new Promise(resolve=>setTimeout(resolve,100));
      },kind);
      await expect.poll(()=>page.evaluate(()=>app.held)).toBe(false);
      // A queued close must not steal focus from a different control.
      await about.click();
      await modal.evaluate(e=>e.close());
      await page.getByRole('combobox',{name:'Renderer',exact:true}).focus();
      await expect(page.getByRole('combobox',{name:'Renderer',exact:true})).toBeFocused();
      for (const preheld of [false,true]) for (const closeFirst of [false,true]) {
        await page.evaluate(preheld=>app.hold(preheld),preheld);
        await about.click();
        await modal.evaluate((e,closeFirst)=>{
          if(closeFirst)e.close();app.gui.controls.destroy();
        },closeFirst);
        await expect(modal).toBeHidden();
        assert.equal(await page.evaluate(()=>app.held),preheld,`${kind}: dispose preserves caller hold`);
        await page.reload();await page.evaluate(()=>threeTest.ready);
        await page.evaluate(()=>{window.app=threeTest.app;app.gui.controls.open();});
      }
    }
    // The Intro shortcut intentionally opens Asteroids with Options hidden.
    await page.evaluate(()=>{
      const c=app.gui.controls;c.setOpen(false);
      c.openGlossary({restoreFocus:document.getElementById('orrery-about')});
    });
    await page.getByRole('dialog',{name:'Asteroids',exact:true}).getByRole('button',{name:'Close',exact:true}).click();
    await expect(page.locator('#orrery-about')).toBeFocused();
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
};
