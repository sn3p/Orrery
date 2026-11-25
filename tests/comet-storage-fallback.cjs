const assert=require('node:assert/strict');
const {expect}=require('@playwright/test');
module.exports=async(browser,root)=>{
 const context=await browser.newContext();const pages=[await context.newPage(),await context.newPage()];
 try{
  for(const page of pages){
   await page.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:undefined,configurable:true}));
   await require('./route-files.cjs').routeFiles(page,root);await require('./comet-fixture.cjs').routeComets(page);
   await page.goto('https://orrery.test/next/?renderer=pixi');await page.evaluate(()=>threeTest.ready);
   await page.evaluate(async()=>{window.app=threeTest.app;app.jedDelta=0;app.cometsShown=true;await app.loadComets();});
  }
  const [a,b]=pages;
  await a.evaluate(async()=>{app.restoreCometSelection([]);await app.cometSelection.saved;});
  await expect.poll(()=>b.evaluate(()=>app.cometIds)).toEqual([]);
  await Promise.all(pages.map((page,i)=>page.evaluate(async id=>{app.cometIds=[...app.cometIds,id];await app.cometSelection.saved;},i?'2P':'1P')));
  for(const page of pages)await expect.poll(()=>page.evaluate(()=>app.cometIds)).toEqual(['1P','2P']);
  await a.evaluate(async()=>{for(let i=0;i<100;i++){app.cometIds=i%2?['1P','2P']:['1P'];await app.cometSelection.saved;}});
  assert.equal(await a.evaluate(()=>Object.keys(localStorage).filter(key=>key.startsWith('orrery.selectedComets.edit.')).length),0);
  // A Web Locks tab and an IndexedDB-only tab share the same transaction domain.
  await b.evaluate(()=>{delete navigator.locks;});
  await Promise.all([a.evaluate(async()=>{app.cometIds=[...app.cometIds,'55P'];await app.cometSelection.saved;}),
   b.evaluate(async()=>{app.cometIds=[...app.cometIds,'9P'];await app.cometSelection.saved;})]);
  for(const page of pages)await expect.poll(()=>page.evaluate(()=>app.cometIds.slice().sort())).toEqual(['1P','2P','55P','9P']);
  await a.reload();await a.evaluate(()=>threeTest.ready);
  assert.deepEqual(await a.evaluate(()=>threeTest.app.rememberedCometIds.slice().sort()),['1P','2P','55P','9P']);
 }finally{await context.close();}
};
