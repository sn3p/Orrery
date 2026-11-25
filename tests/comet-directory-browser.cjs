// Exact bytes are supplied by the pinned producer checkout; no HTTP server.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {expect} = require('@playwright/test');
module.exports = async function(browser, root, directory) {
  const latest=JSON.parse(fs.readFileSync(path.join(directory,'latest.json')));
  const index=JSON.parse(fs.readFileSync(path.join(directory,latest.index.url)));
  const starters=await require('./comet-starters.cjs')(index.objects);
  const expanded=latest.comet_contract_version===4;
  assert.equal(latest.index.sha256,expanded?'907f8cb552c65db81eb3ec3167b0d422e764ab5fef1fcbbb948e63cae21f1070':'a9de1f2f711dd65e880102de7c1f0c14bf20598a20d9cc4e001081406e40c2e2');
  for(const renderer of ['pixi','three']) {
    const page=await browser.newPage({viewport:{width:1280,height:800}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await require('./route-files.cjs').routeFiles(page,root);
    let corrupt=false, legacyOnly=false;
    await page.route('https://sn3p.github.io/orrery-data/comets/**',route=>{
      const name=new URL(route.request().url()).pathname.replace('/orrery-data/comets/','');
      const file=path.join(directory,name);
      if(legacyOnly && name==='latest.json')return route.fulfill({status:200,body:JSON.stringify({comet_contract_version:3,index:index.legacy}),contentType:'application/json'});
      return route.fulfill({status:200,body:corrupt&&name.startsWith('objects/')?'{}':fs.readFileSync(file),contentType:'application/json',headers:{'access-control-allow-origin':'*'}});
    });
    const ready=async()=>{
      await page.evaluate(()=>threeTest.ready);
      await page.waitForFunction(()=>threeTest.app.catalogue?.firstDraw);
    };
    try {
      await page.goto(`https://orrery.test/Orrery/next/?renderer=${renderer}`);
      await ready();
      await page.evaluate(async()=>{window.app=threeTest.app;app.jedDelta=0;app.cometsShown=true;await app.loadComets();});
      assert.equal(await page.evaluate(()=>app.cometSourceId),latest.index.sha256);
      assert.deepEqual(await page.evaluate(()=>app.cometIds.slice().sort()),starters.slice().sort());
      assert.equal(await page.evaluate(()=>app.cometCatalogue.length),expanded?4089:6);
      assert.equal(await page.evaluate(()=>app.renderer.comets.entries.length),expanded?14:6);
      if(expanded) {
        const checkColours=async()=>{
          assert.deepEqual(await page.evaluate(()=>app.cometIds.slice().sort()),starters.slice().sort());
          assert.equal(await page.evaluate(()=>new Set(app.cometCatalogue.filter(e=>app.cometIds.includes(e.id)).map(e=>e.color)).size),starters.length);
          assert.equal(await page.evaluate(()=>{
            app.renderFrame();
            const entry=app.renderer.comets.entries.find(e=>e.comet.id==='c1000079');
            if(!entry.body.visible || !entry.path.visible)throw Error('29P starter is not rendered');
            if(app.rendererId==='three') {
              if(entry.path.material.color.getHex()!==entry.body.material.color.getHex())throw Error('Path and marker colours differ');
              return entry.body.material.color.getHex();
            }
            const stroke=entry.path.context.instructions.find(e=>e.action==='stroke').data.style.color;
            const fill=entry.body.context.instructions.find(e=>e.action==='fill').data.style.color;
            if(stroke!==fill)throw Error('Path and marker colours differ');
            return fill;
          }),0x7d9cff);
        };
        await checkColours();
        // Real source replacement must adapt unedited starters, not freeze their first subset.
        legacyOnly=true;
        await page.reload();await ready();
        await page.evaluate(async()=>{window.app=threeTest.app;app.jedDelta=0;app.cometsShown=true;await app.loadComets();});
        const legacyStarters=await require('./comet-starters.cjs')(index.objects.filter(e=>e.trajectory?.kind==='legacy'));
        assert.deepEqual(await page.evaluate(()=>app.cometIds.slice().sort()),legacyStarters.slice().sort());
        assert.equal(await page.evaluate(()=>app.cometSelectionNotice),'');
        legacyOnly=false;
        await page.evaluate(()=>app.replaceCometSource('hosted'));
        await checkColours();
        await page.evaluate(()=>app.replaceCometSource('bundled'));
        assert.equal(await page.evaluate(()=>app.cometSelectionNotice),'','Automatic starters never report saved missing entries');
        assert.equal(await page.evaluate(()=>localStorage.getItem('orrery.selectedComets')),null);
        await page.evaluate(()=>app.replaceCometSource('hosted'));
        await checkColours();
        // Explicit picks remain authoritative through precisely the same replacements.
        await page.evaluate(async()=>{app.restoreCometSelection(['9P','c1000079']);await app.cometSelection.saved;});
        await page.evaluate(()=>app.replaceCometSource('bundled'));
        assert.deepEqual(await page.evaluate(()=>app.rememberedCometIds.slice().sort()),['9P','c1000079']);
        assert.equal(await page.evaluate(()=>app.cometSelectionNotice),'Some saved comets are absent from this catalogue.');
        await page.evaluate(()=>app.replaceCometSource('hosted'));
        assert.deepEqual(await page.evaluate(()=>app.cometIds.slice().sort()),['9P','c1000079']);
        await page.evaluate(()=>localStorage.removeItem('orrery.selectedComets'));
        await page.reload();await ready();
        await page.evaluate(async()=>{window.app=threeTest.app;app.jedDelta=0;app.cometsShown=true;await app.loadComets();});
        await checkColours();
        // Same starter state survives renderer replacement and hide/show.
        await page.evaluate(()=>app.switchRenderer(app.rendererId==='pixi'?'three':'pixi'));
        await page.waitForFunction(()=>!app.switching);
        await checkColours();
        await page.evaluate(id=>app.switchRenderer(id),renderer);
        await page.waitForFunction(id=>app.rendererId===id&&!app.switching,renderer);
        await checkColours();
        // Test both persisted formats: original arrays and the current journal snapshot.
        for(const ids of [['1P','2P','55P','9P','10P','67P'],[],['9P','missing-id']]) {
          for(const snapshot of [ids,{version:1,ids,clocks:{},replacement:''}]) {
            await page.evaluate(value=>{localStorage.setItem('orrery.selectedComets',JSON.stringify(value));},snapshot);
            await page.reload();await ready();
            await page.evaluate(async()=>{window.app=threeTest.app;app.jedDelta=0;app.cometsShown=true;await app.loadComets();app.renderFrame();});
            assert.deepEqual(await page.evaluate(()=>app.rememberedCometIds),ids);
            assert.deepEqual(await page.evaluate(()=>JSON.parse(localStorage.getItem('orrery.selectedComets'))),snapshot,'Reading saved selections does not migrate them');
            assert.deepEqual(await page.evaluate(()=>app.cometIds.slice().sort()),ids.filter(id=>id!=='missing-id').sort());
          }
        }
        await page.evaluate(()=>localStorage.removeItem('orrery.selectedComets'));
        await page.reload();await ready();
        await page.evaluate(async()=>{window.app=threeTest.app;app.jedDelta=0;app.cometsShown=true;await app.loadComets();});
        await checkColours();
        // The UI presents five selected rows with an accessible 29P choice.
        await page.getByRole('button',{name:'Options',exact:true}).click();
        await page.getByRole('button',{name:'Choose…',exact:true}).click();
        await expect(page.getByRole('dialog',{name:'Choose comets'}).getByRole('checkbox')).toHaveCount(starters.length);
        const choice=page.getByRole('checkbox',{name:'Show 29P/Schwassmann-Wachmann 1',exact:true});
        await expect(choice).toBeChecked();
        assert.equal(await choice.evaluate(e=>getComputedStyle(e.cometSwatch).backgroundColor),'rgb(125, 156, 255)');
        await page.keyboard.press('Escape');
        await page.getByRole('button',{name:'Options',exact:true}).click();
      }
      await page.evaluate(async()=>{
        const before=app.cometData;app.cometsShown=false;app.cometsShown=true;await app.loadComets();
        if(app.cometData!==before)throw Error('Hide/show discarded verified models');
      });
      if(expanded) await page.evaluate(async()=>{
        const before=app.cometData['2P'];
        app.cometsShown=false;app.restoreCometSelection(['2P']);await app.acquireComets();
        if(Object.keys(app.cometData).join(',')!=='2P'||app.cometData['2P']!==before)throw Error('Hidden selection retained deselected models');
        for(const entry of app.renderer.comets.entries.filter(e=>e.comet.id!=='2P')) {
          if(app.rendererId==='three' && entry.path.geometry.getAttribute('position'))throw Error('Deselected path buffer retained');
          if(app.rendererId==='pixi' && entry.path.context.instructions.length)throw Error('Deselected path commands retained');
        }
        app.cometsShown=true;await app.loadComets();
      });
      const available=index.objects.filter(e=>expanded?e.trajectory:true);
      for(const entry of available) {
        const coverage=expanded?entry.coverage:entry.segments.map(s=>s.coverage);
        const jd=(coverage.at(-1).start+coverage.at(-1).end)/2;
        await page.evaluate(async({id,jd})=>{app.cometIds=[id];app.jed=jd;app.renderFrame();await app.loadComets();app.renderFrame();},{id:entry.id,jd});
        await page.waitForFunction(id=>app.cometStates[id]==='ready',entry.id);
        await page.evaluate(()=>app.renderFrame());
        assert.equal(await page.evaluate(id=>app.renderer.comets.entries.find(e=>e.comet.id===id).body.visible,entry.id),true);
        assert(await page.evaluate(id=>Number.isFinite(app.cometCatalogue.find(e=>e.id===id).color),entry.id));
        await page.evaluate(async id=>{
          const expected=await app.cometAcquisition.current.positionAt(id,app.jed);
          const body=app.renderer.comets.entries.find(e=>e.comet.id===id).body;
          const actual=app.rendererId==='three'?[body.position.x/100,body.position.y/100,body.position.z/100]:[-body.position.x/100,body.position.y/100];
          if(actual.some((v,i)=>Math.abs(v-expected[i])>1e-10))throw Error('Rendered position differs from authenticated trajectory');
        },entry.id);
        await page.evaluate(()=>{const r=app.renderer;const view=()=>app.rendererId==='three'?r.camera.position.toArray():[r.stage.scale.x,r.stage.scale.y];app.focusComets();const before=view();app.cometPaths=false;app.focusComets();if(view().some((v,i)=>Math.abs(v-before[i])>1e-8))throw Error('Hidden paths changed Fit');app.cometPaths=true;});
      }
      if(expanded) {
        await page.getByRole('button',{name:'Options',exact:true}).click();
        await page.getByRole('button',{name:'Choose…',exact:true}).click();
        const input=page.getByRole('searchbox');
        const pending=index.objects.find(e=>e.assessment.state==='under_assessment');
        const unassessed=index.objects.find(e=>e.assessment.state==='not_yet_assessed');
        for(const [entry,text] of [[pending,'Trajectory not yet available'],[unassessed,'Trajectory not yet assessed']]) {
          await input.fill(entry.id);
          const box=page.locator(`[data-comet-id="${entry.id}"]`);
          await expect(box).toBeDisabled();await expect(box).toHaveAccessibleDescription(text);
        }
        await input.fill('');
        await page.getByRole('button',{name:/Browse catalogue/}).click();
        assert.equal(await page.locator('[data-comet-id]').count(),30);
        await page.getByRole('button',{name:/Load more/}).click();
        assert.equal(await page.locator('[data-comet-id]').count(),60);
        for(const width of [320,1280]) {await page.setViewportSize({width,height:800});assert(await page.locator('dialog[open]').evaluate(e=>e.scrollWidth<=e.clientWidth+1));}
        await page.keyboard.press('Escape');
        await page.evaluate(async id=>{app.restoreCometSelection([id]);await app.loadComets();},pending.id);
        await expect(page.locator('.orrery-options-panel [role=status]')).toContainText('1 selected comet has no published trajectory.');
        await expect(page.locator('.orrery-options-panel [role=status]')).not.toContainText('No trajectory for this date');
        // Paused date seek must initiate acquisition without an explicit reload.
        await page.evaluate(()=>{app.cometIds=['1P'];app.jed=2444239.5;app.renderFrame();});
        await page.waitForFunction(()=>app.cometStates['1P']==='ready');
        await page.evaluate(()=>{app.jed=2400000;app.renderFrame();});
        await page.waitForFunction(()=>app.cometAcquisition.windows['1P'].start<2400000&&app.cometStates['1P']==='ready');
        assert(await page.evaluate(()=>app.cometCatalogue.find(e=>e.id==='55P').discovery.events.length>0));
        await page.evaluate(async()=>{app.restoreCometSelection(['1P','missing-id']);await app.loadComets();});
        await page.reload();await ready();
        await page.evaluate(async()=>{window.app=threeTest.app;app.jedDelta=0;app.cometsShown=true;await app.loadComets();});
        assert.deepEqual(await page.evaluate(()=>app.rememberedCometIds),['1P','missing-id']);
        await page.evaluate(async()=>{app.restoreCometSelection([]);await app.loadComets();});
        await page.reload();await ready();
        await page.evaluate(async()=>{window.app=threeTest.app;app.cometsShown=true;await app.loadComets();});
        assert.deepEqual(await page.evaluate(()=>app.cometIds),[]);
      }
      corrupt=true;
      await page.evaluate(async()=>{app.restoreCometSelection(['2P']);await app.replaceCometSource('hosted');});
      assert.equal(await page.evaluate(()=>app.cometStates['2P']),'error');
      corrupt=false;await page.evaluate(()=>app.loadComets());
      assert.equal(await page.evaluate(()=>app.cometStates['2P']),'ready');
      await page.evaluate(()=>app.replaceCometSource('bundled'));
      assert.equal(await page.evaluate(()=>app.cometSourceId),'bundled-horizons-2026-11-18');
      assert.deepEqual(errors,[]);
      console.log(`${renderer}: ${latest.index.sha256} passed`);
    } finally {await page.close();}
  }
};
