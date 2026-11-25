const assert = require('node:assert/strict');
const {expect} = require('@playwright/test');
module.exports = async (browser, root) => {
  const context = await browser.newContext();
  const pages = [await context.newPage(), await context.newPage()];
  const boot = async page => {
    await page.goto('https://orrery.test/next/?renderer=pixi');
    await page.evaluate(()=>threeTest.ready);
    await page.evaluate(()=>{window.app=threeTest.app;app.jedDelta=0;});
  };
  const enable = async page => {
    await page.evaluate(()=>{app.cometsShown=true;});
    await page.waitForFunction(()=>app.cometDiscoveryState==='ready');
  };
  const saved = page => page.evaluate(()=>app.cometSelection.saved);
  try {
    for (const page of pages) {
      await require('./route-files.cjs').routeFiles(page,root);
      await require('./comet-fixture.cjs').routeComets(page);
    }
    const [a,b] = pages;
    await boot(a);
    await a.evaluate(()=>localStorage.setItem('orrery.selectedComets','["1P","999P"]'));
    await boot(a);
    assert.deepEqual(await a.evaluate(()=>app.cometIds),[], 'Unreconciled IDs never reach active selection');
    await a.evaluate(()=>{app.cometIds=[];});
    await saved(a); await enable(a);
    assert.deepEqual(await a.evaluate(()=>app.cometIds),[], 'Pre-discovery deselection survives discovery');
    await a.evaluate(()=>app.restoreCometSelection(['1P','999P']));await saved(a);
    await a.evaluate(()=>app.replaceCometSource('hosted'));
    await expect.poll(()=>a.evaluate(()=>app.cometSelectionNotice)).toContain('absent');
    await boot(a);await enable(a);
    assert.equal(await a.evaluate(()=>app.cometSelectionNotice),'','Same missing condition is not announced each startup');
    await a.evaluate(()=>{app.cometIds=['1P','2P'];}); await saved(a);
    assert.equal(await a.evaluate(()=>app.cometSelectionNotice),'');
    let release;
    const held = new Promise(resolve=>{release=resolve;});
    await a.route('**/comets/latest.json',async route=>{await held;await route.fallback();});
    await a.evaluate(()=>{void app.replaceCometSource('hosted');app.cometIds=[];});
    assert.deepEqual(await a.evaluate(()=>app.cometIds),[]);
    await saved(a);release();await a.waitForFunction(()=>app.cometDiscoveryState==='ready');
    assert.deepEqual(await a.evaluate(()=>app.cometIds),[], 'Replacement cannot resurrect deselected known IDs');
    assert.deepEqual(await a.evaluate(()=>app.rememberedCometIds),['999P']);
    await a.unroute('**/comets/latest.json');
    await a.evaluate(()=>app.restoreCometSelection(['1P']));await saved(a);
    await boot(b);await enable(b);
    // Queue both edits behind the same browser lock: both tabs start stale.
    await a.evaluate(()=>{window.unlock=null;window.lockHeld=new Promise(resolve=>{
      navigator.locks.request('orrery.selectedComets',()=>new Promise(done=>{window.unlock=done;resolve();}));
    });return window.lockHeld;});
    await Promise.all([a.evaluate(()=>{app.cometIds=[...app.cometIds,'2P'];}),b.evaluate(()=>{app.cometIds=[...app.cometIds,'55P'];})]);
    // Reload a tab whose write is queued: the synchronous journal must survive.
    await boot(b);await enable(b);
    assert((await b.evaluate(()=>app.cometIds)).includes('55P'));
    await a.evaluate(()=>window.unlock());await Promise.all(pages.map(saved));
    for (const page of pages) await expect.poll(()=>page.evaluate(()=>app.cometIds.slice().sort())).toEqual(['1P','2P','55P']);
    await a.evaluate(()=>app.restoreCometSelection([]));await saved(a);
    await expect.poll(()=>b.evaluate(()=>app.cometIds)).toEqual([]);
    await boot(b);await enable(b);assert.deepEqual(await b.evaluate(()=>app.cometIds),[]);
    await b.evaluate(()=>app.gui.controls.open());
    await b.getByRole('button',{name:'Choose…',exact:true}).click();
    const clear = b.getByRole('dialog',{name:'Choose comets'}).getByRole('button',{name:'Clear selection',exact:true});
    await expect(clear).toBeDisabled();
    await a.evaluate(()=>app.restoreCometSelection(['999P']));await saved(a);
    await expect.poll(()=>b.evaluate(()=>app.rememberedCometIds)).toEqual(['999P']);
    assert.deepEqual(await b.evaluate(()=>app.cometIds),[]);
    assert.equal(await b.evaluate(()=>app.cometSelectionNotice),'');
    await expect(clear).toBeEnabled();
    await clear.click();await saved(b);
    await expect.poll(()=>a.evaluate(()=>app.rememberedCometIds)).toEqual([]);
    // Remote additions update the open Selected list and invalidate Clear's Undo.
    await b.getByRole('button',{name:/Browse catalogue/}).focus();
    await a.evaluate(()=>app.restoreCometSelection(['1P','2P']));await saved(a);
    await expect(b.getByRole('checkbox',{name:'Show 2P/Encke',exact:true})).toBeVisible();
    await expect(b.getByRole('button',{name:/Browse catalogue/})).toBeFocused();
    await expect(b.getByRole('button',{name:'Undo',exact:true})).toHaveCount(0);
    await b.getByRole('checkbox',{name:'Show 1P/Halley',exact:true}).uncheck();
    await expect(b.getByRole('checkbox',{name:'Show 1P/Halley',exact:true})).toBeVisible();
    await b.getByRole('checkbox',{name:'Show 2P/Encke',exact:true}).focus();
    await a.evaluate(()=>app.restoreCometSelection(['2P','55P']));await saved(a);
    await expect(b.getByRole('checkbox',{name:'Show 55P/Tempel-Tuttle',exact:true})).toBeVisible();
    await expect(b.getByRole('checkbox',{name:'Show 2P/Encke',exact:true})).toBeFocused();
    await b.getByRole('button',{name:'Clear selection',exact:true}).click();await saved(b);
    await expect(b.getByRole('button',{name:'Undo',exact:true})).toBeVisible();
    await a.evaluate(()=>app.restoreCometSelection(['55P']));await saved(a);
    await expect(b.getByRole('button',{name:'Undo',exact:true})).toHaveCount(0);
    // Removing storage restores first-visit defaults; explicit [] still means empty.
    await a.evaluate(()=>localStorage.clear());
    await expect.poll(()=>b.evaluate(()=>app.cometIds)).toEqual(['1P','2P','55P','9P','10P','67P']);
  } finally {await context.close();}
};
