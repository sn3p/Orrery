const assert = require('node:assert/strict');
const { expect } = require('@playwright/test');
module.exports = async (browser, root, renderer) => {
  const page = await browser.newPage({viewport:{width:390,height:520}});
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await require('./route-files.cjs').routeFiles(page, root);
  const ids = ['1P','2P','55P','9P','10P','67P', ...Array.from({length:60},(_,i)=>`${120+i}P`)];
  let product = require('./comet-catalogue-fixture.cjs').product(ids, {compact:true});
  await page.route('**/comets/**', route => {
    const file = new URL(route.request().url()).pathname.split('/comets/')[1];
    return route.fulfill({status:product.files.has(file)?200:404,body:product.files.get(file)||'',contentType:'application/json'});
  });
  const start = async () => {
    await page.goto(`https://orrery.test/next/?renderer=${renderer}`);
    await page.evaluate(()=>threeTest.ready);
    await page.waitForFunction(()=>threeTest.app.catalogue?.firstDraw);
    await page.evaluate(async()=>{window.app=threeTest.app;app.jedDelta=0;app.jed=2461000;app.cometsShown=true;await app.loadComets();app.gui.controls.open();});
  };
  const open = () => page.getByRole('button',{name:'Choose…',exact:true}).click();
  const dialog = page.getByRole('dialog',{name:'Choose comets'});
  try {
    await start();
    assert.deepEqual(await page.evaluate(()=>app.cometIds),ids.slice(0,6), JSON.stringify(await page.evaluate(()=>({state:app.cometDiscoveryState,notice:app.cometSelectionNotice,source:app.cometSourceId}))));
    await open();
    await expect(dialog.locator('h1')).toBeFocused();
    await expect(dialog.locator('label')).toHaveCount(6);
    await page.evaluate(()=>{window.halleyRow=document.querySelector('[data-comet-id="1P"]');});
    await dialog.getByRole('searchbox').fill('halley');
    await expect(dialog.locator('label')).toHaveCount(1);
    assert(await page.evaluate(()=>halleyRow===document.querySelector('[data-comet-id="1P"]')));
    assert.equal(await page.evaluate(async()=>{
      let writes=0;const observer=new MutationObserver(changes=>{writes+=changes.length;});
      observer.observe(halleyRow.cometStatus,{childList:true,characterData:true,subtree:true});
      app.gui.controls.cometFeedbackCache=null;app.gui.controls.updateComets();
      await Promise.resolve();observer.disconnect();return writes;
    }),0,'Unchanged status text does not mutate accessible DOM');
    await dialog.getByRole('searchbox').fill('');
    await dialog.getByRole('button',{name:/Browse catalogue/}).click();
    await expect(dialog.locator('label')).toHaveCount(30);
    await expect(dialog.locator('input[type=checkbox]').first()).toBeFocused();
    await dialog.getByRole('button',{name:/Load more/}).click();
    await expect(dialog.locator('label')).toHaveCount(60);
    await expect(dialog.locator('input[type=checkbox]').nth(30)).toBeFocused();
    await dialog.getByRole('button',{name:/Load more/}).click();
    await expect(dialog.locator('label')).toHaveCount(66);
    for (const viewport of [{width:390,height:520},{width:1280,height:520},{width:1280,height:800}]) {
      await page.setViewportSize(viewport);
      assert(await dialog.evaluate(el=>{const r=el.getBoundingClientRect();const body=el.querySelector('.orrery-comet-chooser-body');const done=el.querySelector('footer').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.left>=0&&r.right<=innerWidth&&body.scrollHeight>body.clientHeight&&done.bottom<=innerHeight&&el.scrollWidth<=el.clientWidth;}));
    }
    await dialog.getByRole('button',{name:'Back to selected'}).click();
    await expect(dialog.getByRole('button',{name:/Browse catalogue/})).toBeFocused();
    await dialog.getByRole('searchbox').fill('not-a-comet');
    await expect(dialog).toContainText('No matches');
    await dialog.getByRole('searchbox').fill('179p');
    await expect(dialog.locator('label')).toHaveCount(1);
    await page.evaluate(()=>{
      const checkbox=document.querySelector('.orrery-comet-choice-list input');
      const change=checkbox.onchange;
      checkbox.onchange=()=>{
        const descriptor=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(app),'cometIds');
        window.selectionReads=0;
        Object.defineProperty(app,'cometIds',{configurable:true,get(){selectionReads++;return descriptor.get.call(this);},set:descriptor.set});
        try{change();}finally{delete app.cometIds;}
      };
    });
    await dialog.getByRole('checkbox').check();
    assert(await page.evaluate(()=>selectionReads<30),'Checkbox selection reads stay bounded independently of catalogue size');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('searchbox')).toHaveValue('');
    await dialog.getByRole('button',{name:'Clear selection',exact:true}).click();
    await page.evaluate(()=>app.cometSelection.saved);
    assert.deepEqual(await page.evaluate(()=>((value)=>value.ids ?? value)(JSON.parse(localStorage.getItem('orrery.selectedComets')))),[]);
    await dialog.getByRole('button',{name:'Undo',exact:true}).click();
    assert((await page.evaluate(()=>app.cometIds)).includes('179P'));
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await expect(page.getByRole('button',{name:'Choose…',exact:true})).toBeFocused();
    await page.evaluate(()=>app.cometSelection.saved);
    await start();
    assert((await page.evaluate(()=>app.cometIds)).includes('179P'));
    product = require('./comet-catalogue-fixture.cjs').product(['1P']);
    await page.evaluate(()=>app.replaceCometSource('hosted'));
    assert((await page.evaluate(()=>((value)=>value.ids ?? value)(JSON.parse(localStorage.getItem('orrery.selectedComets'))))).includes('179P'));
    await page.evaluate(()=>{app.cometIds=[];});
    assert((await page.evaluate(()=>((value)=>value.ids ?? value)(JSON.parse(localStorage.getItem('orrery.selectedComets'))))).includes('179P'));
    await open();
    product = require('./comet-catalogue-fixture.cjs').product(ids, {compact:true});
    await page.evaluate(()=>app.replaceCometSource('hosted'));
    await expect(dialog.getByRole('checkbox',{name:'Show 179P/<b>Literal test comet</b>',exact:true})).toBeVisible();
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    assert((await page.evaluate(()=>app.cometIds)).includes('179P'));
    await open();
    await dialog.getByRole('button',{name:'Clear selection',exact:true}).click();
    await dialog.getByRole('button',{name:'Done',exact:true}).click();
    await page.evaluate(()=>app.cometSelection.saved);
    await start();
    assert.deepEqual(await page.evaluate(()=>app.cometIds),[]);
    await open();
    await expect(dialog).toContainText('No comets selected.');
    await page.keyboard.press('Escape');
    await page.evaluate(()=>localStorage.setItem('orrery.selectedComets','["invalid id"]'));
    await start();
    assert.deepEqual(await page.evaluate(()=>app.cometIds),ids.slice(0,6));
    assert.deepEqual(errors,[]);
  } finally {await page.close();}
};
