const assert=require('node:assert/strict');
const {expect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
module.exports=async function(browser,root){
  let files;
  if(process.env.COMET_HISTORY_CANDIDATE){
    files=new Map();const dir=path.resolve(process.env.COMET_HISTORY_CANDIDATE);
    const visit=(prefix='')=>{for(const e of fs.readdirSync(path.join(dir,prefix),{withFileTypes:true})){
      const name=path.posix.join(prefix,e.name);if(e.isDirectory())visit(name);else files.set(name,fs.readFileSync(path.join(dir,name)));
    }};visit();
  } else files=(await import('./comet-history-fixture.mjs')).fixture().files;
  for(const renderer of ['pixi','three']){
    const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await require('./comet-fixture.cjs').routeComets(page);
    await require('./route-files.cjs').routeFiles(page,root);
    let fail=false, history=true;
    const requests=[];
    const index=JSON.parse(files.get(JSON.parse(files.get('latest.json')).index.url));
    const missing=index.objects[0].segments[0].data.url;
    await page.route('https://sn3p.github.io/orrery-data/comets/**',route=>{
      if(!history)return route.fallback();
      const name=new URL(route.request().url()).pathname.replace('/orrery-data/comets/','');
      requests.push(name);
      return route.fulfill({status:files.has(name)&&!(fail&&name===missing)?200:404,
        body:files.get(name)||'',contentType:'application/json',headers:{'access-control-allow-origin':'*'}});
    });
    try{
      await page.goto(`https://orrery.test/Orrery/next/?renderer=${renderer}`);
      await page.evaluate(()=>threeTest.ready);await page.waitForFunction(()=>threeTest.app.catalogue?.firstDraw);
      const enableScripts=[];
      const trackScripts=request=>{if(request.resourceType()==='script')enableScripts.push(request.url());};
      page.on('request',trackScripts);
      await page.evaluate(async()=>{window.app=threeTest.app;app.jedDelta=0;app.cometsShown=true;await app.loadComets();app.cancelRender();});
      await page.waitForFunction(()=>Object.keys(app.cometData).length===6);
      page.off('request',trackScripts);
      assert.deepEqual(enableScripts,[],'Enabling production history needs no additional code download');
      assert.equal(requests.filter(n=>n==='latest.json').length,1);
      assert.equal(await page.evaluate(()=>app.cometSourceId),JSON.parse(files.get('latest.json')).index.sha256);
      assert.equal(requests.filter(n=>n.startsWith('objects/')).length,8);
      for(const jd of [index.objects.find(e=>e.id==='1P').segments[0].coverage.start-1e-6,index.objects.find(e=>e.id==='1P').segments[0].coverage.start,index.objects.find(e=>e.id==='55P').segments[0].coverage.start,2444239.5-1e-6,2444239.5,2444239.5+1e-6,2444240.5,2488067.5,2488067.5+1e-6]){
        await page.evaluate(jd=>{app.jed=jd;app.cancelRender();app.renderFrame();},jd);
        assert.equal(await page.evaluate(()=>app.renderer.comets.entries.filter(e=>e.body.visible).length),index.objects.filter(e=>jd>=e.segments[0].coverage.start&&jd<=2488067.5).length);
        for (const entry of index.objects) {
          assert.equal(await page.locator(`[data-comet-id="${entry.id}"]`).evaluate(e=>e.cometStatus.textContent),
            jd>=entry.segments[0].coverage.start&&jd<=2488067.5 ? '' : 'No trajectory for this date');
        }
      }
      await page.evaluate(()=>{app.jed=2444239.5;app.cancelRender();app.renderFrame();});
      assert(await page.evaluate(()=>app.renderer.comets.entries.filter(e=>['1P','55P'].includes(e.comet.id)).every(e=>e.range.includes('historical:')&&e.range.includes('|modern:'))));
      await page.evaluate(()=>{
        const r=app.renderer;
        for(const entry of r.comets.entries.filter(e=>['1P','55P'].includes(e.comet.id))) {
          if(app.rendererId==='three') { if(!entry.path.isLineSegments) throw Error('Seam must not be a connecting line');
            const geometry=entry.path.geometry, indices=geometry.index.array;
            if(geometry.index.count!==2*(geometry.attributes.position.count-2))throw Error('Each strip reuses unique vertices');
            let breaks=0;for(let i=2;i<indices.length;i+=2)if(indices[i]!==indices[i-1])breaks++;
            if(breaks!==1)throw Error('Indexed edges must leave the seam disconnected'); }
          else {const commands=entry.path.context.instructions.find(i=>i.action==='stroke').data.path.instructions;
            if(commands.filter(i=>i.action==='moveTo').length!==2)throw Error('Historical and modern paths need separate strips');}
        }
        const view=()=>app.rendererId==='three'?r.camera.position.toArray():[r.stage.scale.x,r.stage.scale.y];
        app.focusComets();const before=view();app.cometPaths=false;app.focusComets();
        if(view().some((v,i)=>Math.abs(v-before[i])>1e-8))throw Error('Hidden candidate paths change Fit');
        app.cometPaths=true;
      });
      await page.evaluate(async()=>{const before=app.cometData;const ids=app.cometIds.join('|');await app.switchRenderer(app.rendererId==='pixi'?'three':'pixi');
        if(app.cometData!==before||app.cometIds.join('|')!==ids)throw Error('Renderer switch lost candidate state');});
      await page.getByRole('button',{name:'Options',exact:true}).click();
      await expect(page.getByRole('checkbox',{name:'Show comets',exact:true})).toHaveAccessibleDescription('Comet paths are calculated from JPL orbit models. Historical positions are approximate, with uncertainty varying by comet and date.');
      await page.evaluate(()=>{app.cometIds=['2P','55P'];app.jed=2378496.5;app.cancelRender();app.renderFrame();});
      await expect(page.locator('.orrery-options-panel [role=status]').filter({hasText:'No trajectory for this date'})).toContainText('Selected comets cover 1865–2099.');
      await expect(page.locator('.orrery-options-panel [role=status]')).toContainText('Selected comets cover 1865–2099.');
      await page.getByRole('button',{name:'Choose…',exact:true}).click();
      await expect(page.getByRole('dialog').filter({hasText:'Choose comets'}).locator('[role=status]')).toContainText('Selected comets cover 1865–2099.');
      await expect(page.getByRole('checkbox',{name:'Show 55P/Tempel-Tuttle',exact:true})).toHaveAccessibleDescription('No trajectory for this date');
      await page.getByRole('button',{name:'Done',exact:true}).click();
      await page.evaluate(()=>{app.cometIds=['55P','10P'];app.gui.timeline.open();});
      const summary=page.locator('#orrery-comet-history summary');await summary.focus();await page.keyboard.press('Enter');
      await expect(page.locator('#orrery-comet-history')).toHaveAttribute('open','');
      await expect(page.locator('#orrery-comet-history')).toContainText('1865-12 (Gregorian): independent discovery');
      await expect(page.locator('#orrery-comet-history')).toContainText('discovery (day disputed)');
      await expect(page.locator('#orrery-comet-history')).toContainText('July 3');
      await expect(page.locator('#orrery-comet-history')).toContainText('July 4');
      assert(await page.locator('#orrery-comet-history a').count()>0);
      for(const viewport of [{width:320,height:568},{width:1280,height:800}]){
        await page.setViewportSize(viewport);
        assert(await page.locator('#orrery-date-dialog').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'date dialog must wrap horizontally');
        assert(await page.locator('#orrery-date-input').evaluate(e=>e.getBoundingClientRect().width>=150),'date input retains usable width');
        assert(await page.locator('#orrery-comet-history').evaluate(e=>e.getBoundingClientRect().width>=250),'history spans both form columns');
      }
      await page.evaluate(()=>{app.cometIds=['1P'];});
      await expect(page.locator('#orrery-comet-history')).toContainText('240 BCE (calendar unspecified)');
      await expect(page.locator('#orrery-comet-history')).not.toContainText('55P/Tempel-Tuttle');
      await page.keyboard.press('Escape');
      history=false;
      await page.evaluate(async()=>{await app.replaceCometSource('hosted');app.gui.timeline.open();});
      await expect(page.locator('#orrery-comet-history')).toBeHidden();
      assert(!(await page.locator('.orrery-options-panel [role=status]').allTextContents()).some(text=>text.includes('All six comets')));
      await page.keyboard.press('Escape');
      history=true;fail=true;await page.evaluate(async()=>{app.cometIds=['1P'];await app.replaceCometSource('hosted');});
      assert.equal(await page.evaluate(()=>app.cometStates['1P']),'error');
      assert.equal(await page.evaluate(()=>app.cometData['1P']),undefined);
      fail=false;await page.evaluate(()=>app.loadComets());assert.equal(await page.evaluate(()=>app.cometStates['1P']),'ready');
      await page.evaluate(async()=>{await app.replaceCometSource('bundled');});
      assert.equal(await page.evaluate(()=>app.cometSourceId),'bundled-horizons-2026-11-18');
      assert(await page.evaluate(()=>!app.cometData['1P'].segments));
      await expect(page.locator('.orrery-options-panel [role=status]')).toContainText('1P/Halley covers 1980–2099.');
      await expect(page.locator('.orrery-options-panel [role=status]')).not.toContainText('Earlier coverage');
      // The test entry omits Intro; exercise the actual built About markup directly.
      await page.locator('#orrery-intro').evaluate(e=>e.showModal());
      await expect(page.locator('#orrery-intro')).toContainText('Coverage varies by comet and loaded catalogue');
      await expect(page.locator('#orrery-intro')).toContainText('start and end dates');
      await expect(page.locator('#orrery-intro')).not.toContainText('1835');
      await expect(page.locator('#orrery-intro')).not.toContainText('1865');
      for(const viewport of [{width:320,height:568},{width:1280,height:800}]) {
        await page.setViewportSize(viewport);
        assert(await page.locator('#orrery-intro').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'About must wrap without horizontal overflow');
        const close=page.locator('.orrery-intro-close');
        await page.locator('#orrery-intro-date').focus();await close.focus();
        await expect(close).toBeFocused();
        assert(await close.evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}),'About close stays reachable after keyboard focus');
      }
      await page.keyboard.press('Enter');await expect(page.locator('#orrery-intro')).not.toBeVisible();
      assert.deepEqual(errors,[]);
    }finally{await page.close();}
  }
};
