const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { expect } = require('@playwright/test');

const { routeFiles: routeAppFiles } = require('./route-files.cjs');

async function routeFiles(page, root) {
  await require('./comet-fixture.cjs').routeComets(page);
  await routeAppFiles(page, root);
}

async function run({browser, name, output = '.context/comet-browser'}) {
  const root = path.resolve(output, 'site');
  if (process.env.ORRERY_PREBUILT_FIXTURES) require('./fixture-builds.cjs').copyPrepared('three',root);
  else await require('./three-build.cjs').build(root);
  for (const renderer of ['three','pixi']) {
    const page = await browser.newPage({viewport:{width:1280,height:800},deviceScaleFactor:2});
    const errors=[];
    page.on('pageerror', e=>errors.push(e.message));
    let requests=0;
    page.on('request',request=>{if(request.url().includes('/comets/objects/')) requests++;});
    await routeFiles(page,root);
    try {
      await page.goto(`https://orrery.test/Orrery/next/?renderer=${renderer}`);
      await page.evaluate(()=>threeTest.ready);
      await page.waitForFunction(()=>threeTest.app.catalogue?.firstDraw);
      await page.evaluate(()=>{window.app=threeTest.app;app.jedDelta=0;app.cancelRender();});
      assert.equal(requests,0,'Default view never requests comet vectors');
      await page.getByRole('button',{name:'Options',exact:true}).click();
      await expect(page.getByRole('checkbox',{name:'Show 1P/Halley',exact:true})).toHaveCount(0);
      await page.getByRole('checkbox',{name:'Show comets',exact:true}).check();
      await page.waitForFunction(()=>app.cometData && app.renderer.comets?.entries.every(e=>e.body.visible));
      assert.equal(requests,6);
      assert.equal(await page.evaluate(()=>new Set(app.renderer.comets.entries.map(e=>e.comet.color)).size),6);
      assert.deepEqual(await page.evaluate(()=>app.cometCatalogue.map(e=>e.periodDays)),[27729,1207,12142,2038,1958,2353]);
      await page.evaluate(() => {
        const check = (ok, message) => { if (!ok) throw new Error(message); };
        const series = app.cometData['55P'];
        const end = series.start + (series.states.length - 1) * series.step;
        for (const jed of [series.start, series.start + 32, end - 32, end, (series.start + end) / 2, series.start]) {
          app.jed = jed; app.cancelRender(); app.renderFrame();
          for (const { comet, path, range } of app.renderer.comets.entries) {
            const source = app.cometData[comet.id];
            const [first, last] = range.split(':').map(Number);
            const duration = (last - first) * source.step;
            check(Number.isFinite(comet.periodDays) && duration >= comet.periodDays && duration < comet.periodDays + 2 * source.step,
              `${comet.id}: full trajectory at ${jed}`);
            if (app.rendererId === 'three') {
              const points = path.geometry.attributes.position;
              check(points.count === last - first + 1, 'Three uses exactly the source slice');
              for (const [vertex, sample] of [[0, first], [points.count - 1, last]]) {
                for (let axis = 0; axis < 3; axis++) check(points.array[vertex * 3 + axis] === Math.fround(source.states[sample][axis] * 100),
                  'Three endpoints are JPL samples without an invented closing segment');
              }
            } else {
              const commands = path.context.instructions.find(item => item.action === 'stroke').data.path.instructions;
              const lines = commands.filter(item => item.action === 'lineTo');
              check(lines.length === last - first && !commands.some(item => item.action === 'closePath'),
                'Pixi draws only the source slice without closing it');
              const beginning = commands.filter(item => item.action === 'moveTo').at(-1).data;
              for (const [point, sample] of [[beginning, first], [lines.at(-1).data, last]]) {
                check(point[0] === -source.states[sample][0] * 100 && point[1] === source.states[sample][1] * 100,
                  'Pixi endpoints are projected JPL samples');
              }
            }
          }
        }
      });
      if (renderer === 'three') assert.equal(await page.evaluate(()=> {
        const r=app.renderer; return r.comets.entries[0].body.material.size*r.viewport.width/r.canvas.width;
      }),6,'DPR2 comet marker remains six CSS pixels');
      await page.getByRole('button',{name:'Fit selected comets'}).click();
      await page.waitForFunction(()=>document.querySelectorAll('.orrery-comet-label:not([hidden])').length===6);
      for (const viewport of [{width:1460,height:1028},{width:320,height:568},{width:568,height:240}]) {
        await page.setViewportSize(viewport);
        await page.waitForFunction(({width,height}) => app.renderer.viewport.width === width
          && app.renderer.viewport.height === height, viewport);
        await page.evaluate(()=>{app.jed=2447878.5;app.cancelRender();app.renderFrame();});
        await page.getByRole('button',{name:'Fit selected comets'}).click();
        const fitted = await page.evaluate(()=>{
          app.cancelRender(); app.renderFrame();
          const r=app.renderer;
          let extent=0, clipped=false;
          for (const {body,path} of r.comets.entries) {
            if (app.rendererId==='three') {
              const p=body.position.clone();
              const measure=()=>{
                p.project(r.camera);
                extent=Math.max(extent,Math.abs(p.x),Math.abs(p.y));
                clipped ||= p.z < -1 || p.z > 1;
              };
              measure();
              const positions=path.geometry.attributes.position;
              for(let i=0;i<positions.count;i++){p.fromBufferAttribute(positions,i);measure();}
            } else {
              const measure=(x,y)=>{
                const p=r.stage.worldTransform.apply({x,y});
                extent=Math.max(extent,Math.abs(2*p.x/r.viewport.width-1),Math.abs(2*p.y/r.viewport.height-1));
              };
              measure(body.x,body.y);
              const commands=path.context.instructions.find(item=>item.action==='stroke').data.path.instructions;
              for(const {action,data} of commands) if(action==='moveTo'||action==='lineTo') measure(data[0],data[1]);
            }
          }
          return {extent,clipped};
        });
        assert(!fitted.clipped && Math.abs(fitted.extent-1/1.12)<.001,
          `${renderer}: rendered paths fill the fit margin without clipping at ${viewport.width}×${viewport.height}`);
      }
      await page.setViewportSize({width:1280,height:800});
      await page.getByRole('button',{name:'Fit selected comets'}).click();
      await page.evaluate(()=>document.fonts.ready);
      assert(await page.evaluate(()=>{
        const r=app.renderer, label=r.comets.entries[2].label;
        label.place(r.viewport.width-60,r.viewport.height/2,r.viewport);
        const box=label.element.getBoundingClientRect();
        r.render();
        return box.left>=0 && box.right<=r.viewport.width;
      }),'Long comet label stays within the right edge');
      await page.getByRole('checkbox',{name:'Show asteroids',exact:true}).uncheck();
      await page.waitForFunction(()=>document.querySelector('#orrery-count').textContent==='0');
      assert(await page.evaluate(()=>{
        const cloud=app.renderer.asteroids;
        return app.rendererId==='three' ? cloud.uniforms.classMask.value===0 && cloud.uniforms.colorMask.value===0 : cloud.uniforms.uClassMask===0 && cloud.uniforms.uColorMask===0;
      }));
      await page.evaluate(()=>{
        const model=app.catalogue;
        app.renderer.setAsteroids(model,app.frameState);
        app.renderFrame();
      });
      assert(await page.evaluate(()=>app.renderer.asteroids.shown===false),'Catalogue replacement retains hidden asteroids');
      await page.getByRole('checkbox',{name:'Show 2P/Encke' ,exact:true}).uncheck();
      await page.getByRole('checkbox',{name:'Comet paths',exact:true}).uncheck();
      assert(await page.evaluate(()=>app.renderer.comets.entries.every(e=>!e.path.visible) && !app.renderer.comets.entries[1].body.visible));
      await page.getByRole('checkbox',{name:'Show 1P/Halley',exact:true}).focus();
      await page.keyboard.press('Space');
      await expect(page.getByRole('checkbox',{name:'Show 1P/Halley',exact:true})).not.toBeChecked();
      await page.getByRole('checkbox',{name:'Show 1P/Halley',exact:true}).check();
      const other=renderer==='three'?'pixi':'three';
      await page.getByRole('combobox',{name:'Renderer',exact:true}).selectOption(other);
      await page.waitForFunction(id=>app.rendererId===id&&!app.switching,other);
      assert(await page.evaluate(()=>app.cometsShown && !app.asteroidsShown && !app.cometPaths && app.cometIds.join(',')==='1P,55P,9P,10P,67P'));
      await page.evaluate(()=>{app.renderer.setOptions({shared:{planetLabels:'all'}});app.renderFrame();});
      assert(await page.evaluate(()=>app.renderer.comets.entries[0].body.visible),'Partial options preserve comets');
      await page.getByRole('checkbox',{name:'Comet paths',exact:true}).check();
      // Dates, reverse motion and failed frame rollback use the same committed clock.
      const dates = await page.evaluate(()=>{
        const start=app.jed;app.jed=start+100;app.renderFrame();
        const forward={...app.renderer.comets.entries[0].position};
        app.jed=start;app.renderFrame();
        const backward={...app.renderer.comets.entries[0].position};
        app.jed=2444238.5;app.renderFrame();
        return {different:JSON.stringify(forward)!==JSON.stringify(backward),hidden:app.renderer.comets.entries.every(e=>!e.body.visible)};
      });
      assert(dates.different && dates.hidden);
      await expect(page.getByRole('status').filter({hasText:'Comets are unavailable'})).toBeVisible();
      await page.evaluate(()=>{app.jed=2444239.5;app.renderFrame();});
      await page.getByRole('button',{name:'Fit selected comets'}).click();
      for (const viewport of [{width:320,height:568},{width:568,height:240},{width:1280,height:800}]) {
        await page.setViewportSize(viewport);
        const panel=page.locator('.orrery-options-panel');
        const box=await panel.boundingBox();
        assert(box.x>=0 && box.x+box.width<=viewport.width+1 && box.y+box.height<=viewport.height+1);
        await page.getByRole('button',{name:'Fit selected comets'}).scrollIntoViewIfNeeded();
        assert(await panel.evaluate(el=>el.scrollWidth<=el.clientWidth+1),'No horizontal overflow');
      }
      await page.evaluate(()=>{
        const r=app.renderer, original=r.render, before={...r.comets.entries[0].position};
        r.render=()=>null;
        app.jed+=10;app.cancelRender();app.renderFrame();r.render=original;
        if(JSON.stringify(before)!==JSON.stringify(r.comets.entries[0].position)) throw new Error('Comet frame rollback failed');
        app.renderFrame();
      });
      await page.evaluate(()=>{
        const r=app.renderer;
        window.cometContext=r.renderer?.getContext() ?? r.app.renderer.gl;
        window.cometLoss=cometContext.getExtension('WEBGL_lose_context');
        if(!cometLoss) throw new Error('Context-loss extension unavailable');
        cometLoss.loseContext();
      });
      await page.waitForFunction(()=>app.contextLost);
      await page.evaluate(()=>cometLoss.restoreContext());
      await page.waitForFunction(()=>!app.contextLost && !app.graphicsRecoveryPending);
      assert(await page.evaluate(()=>app.renderer.comets.entries[0].body.visible),'Comets recover after actual context loss');
      await page.getByRole('checkbox',{name:'Show comets',exact:true}).uncheck();
      await expect(page.getByRole('checkbox',{name:'Show 1P/Halley',exact:true})).toHaveCount(0);
      assert(await page.evaluate(()=>[...document.querySelectorAll('.orrery-comet-label')].every(e=>e.hidden)));
      await page.getByRole('checkbox',{name:'Show asteroids',exact:true}).check();
      await page.waitForFunction(()=>document.querySelector('#orrery-count').textContent!=='0');
      await page.evaluate(()=>app.destroy());
      assert.equal(await page.locator('.orrery-comet-label').count(),0);
      assert.deepEqual(errors,[]);
    } finally { await page.close(); }
  }
  for (const renderer of ['three','pixi']) {
    const page=await browser.newPage();
    await routeFiles(page,root);
    let catalogRoute, vectorRoute, notifyVector;
    const vectorRequested=new Promise(resolve=>{notifyVector=resolve;});
    await page.route('**/data/catalog.json',route=>{catalogRoute=route;});
    await page.route('**/comets/latest.json',route=>{vectorRoute=route;notifyVector();});
    try {
      await page.goto(`https://orrery.test/Orrery/next/?renderer=${renderer}`);
      await page.waitForFunction(()=>threeTest.app.initialized);
      await page.evaluate(()=>{window.app=threeTest.app;app.asteroidsShown=false;app.jedDelta=0;});
      await expect.poll(()=>!!catalogRoute).toBe(true);
      await catalogRoute.fallback();
      await page.waitForFunction(()=>app.catalogue?.firstDraw);
      assert(await page.evaluate(()=>app.renderer.asteroids.shown===false),'Initial delayed installation retains asteroid visibility');
      await page.getByRole('button',{name:'Options',exact:true}).click();
      await page.getByRole('checkbox',{name:'Show comets',exact:true}).check();
      await vectorRequested;
      await page.evaluate(()=>app.destroy());
      await vectorRoute.abort().catch(()=>{});
      await page.waitForFunction(()=>app.destroyed);
      assert(await page.evaluate(()=>!Object.keys(app.cometData || {}).length && document.querySelectorAll('.orrery-comet-label').length===0));
    } finally { await page.close(); }
  }
  // Partial object acquisition and generation replacement through the real app.
  for (const renderer of ['three', 'pixi']) {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    await routeFiles(page, root);
    const fixture = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/comets-v2/latest.json')));
    const index = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/comets-v2',fixture.index.url)));
    const encke = index.objects.find(entry=>entry.id==='2P').data.url;
    let fail = true, downloads = 0, status = 503, discoveries = 0;
    page.on('request', r=>{if(r.url().includes('/comets/objects/'))downloads++;
      if(r.url().endsWith('/comets/latest.json')) discoveries++;});
    await page.route('**/'+encke, r=>fail ? r.fulfill({status,body:'Unavailable'}) : r.fallback());
    try {
      await page.goto(`https://orrery.test/next/?renderer=${renderer}`);
      await page.evaluate(()=>threeTest.ready);
      await page.waitForFunction(()=>threeTest.app.catalogue?.firstDraw);
      await page.evaluate(()=>{window.app=threeTest.app;app.jedDelta=0;app.cometIds=['1P','2P'];});
      await page.getByRole('button',{name:'Options',exact:true}).click();
      await page.getByRole('checkbox',{name:'Show comets',exact:true}).check();
      await page.waitForFunction(()=>app.cometStates?.['1P']==='ready' && app.cometStates?.['2P']==='error');
      const fit = page.getByRole('button',{name:'Fit selected comets'});
      await expect(fit).toBeEnabled();
      assert.equal(await page.evaluate(()=>app.renderer.comets.entries.filter(e=>e.body.visible).length),1);
      await page.evaluate(()=>{app.jed=2444238.5;app.cancelRender();app.renderFrame();});
      await expect(fit).toBeDisabled();
      await page.evaluate(()=>{app.jed=2450000;app.cancelRender();app.renderFrame();});
      await expect(fit).toBeEnabled();
      // Hiding clears failed attempts, while keeping the verified Halley series.
      const sourceId = await page.evaluate(()=>app.cometSourceId);
      status=404;
      await page.getByRole('checkbox',{name:'Show comets',exact:true}).uncheck();
      await page.getByRole('checkbox',{name:'Show comets',exact:true}).check();
      await page.waitForFunction(()=>app.cometStates['2P']==='error');
      assert.equal(downloads,3,'Re-show retries the failed object only');
      await expect(page.getByRole('status').filter({hasText:'reload the page'})).toBeVisible();
      await page.getByRole('button',{name:'Retry comet data'}).click();
      await page.waitForFunction(()=>app.cometStates['2P']==='error');
      assert.equal(downloads,4,'Pinned missing object can retry without silently changing sources');
      assert.equal(discoveries,1);
      assert.equal(await page.evaluate(()=>app.cometSourceId),sourceId);
      await page.getByRole('checkbox',{name:'Show 2P/Encke',exact:true}).uncheck();
      fail=false;
      await page.getByRole('checkbox',{name:'Show 2P/Encke',exact:true}).check();
      await page.waitForFunction(()=>app.cometStates['2P']==='ready');
      assert.equal(downloads,5,'Reselect retries the failed object');
      await page.evaluate(()=>{app.cometsShown=false;app.cometsShown=true;});
      assert.equal(downloads,5,'Showing verified selections reuses the cache');

      await page.evaluate(()=>{app.cometIds=[];app.cometIds=['1P'];});
      assert.equal(downloads,5,'Verified reselect does not download');
      let delayed;
      const tempel = index.objects.find(entry=>entry.id==='55P').data.url;
      await page.route('**/'+tempel, route=>{delayed=route;});
      await page.evaluate(()=>{app.cometIds=['55P'];});
      await expect.poll(()=>!!delayed).toBe(true);
      const other = renderer==='three' ? 'pixi' : 'three';
      await page.getByRole('combobox',{name:'Renderer',exact:true}).selectOption(other);
      await page.waitForFunction(id=>app.rendererId===id&&!app.switching,other);
      await delayed.fallback();
      await page.waitForFunction(()=>app.cometStates['55P']==='ready');
      assert.equal(downloads,6,'New selection acquires its object');
      await page.evaluate(async()=>{
        app.cometIds=['1P'];
        const layer=app.renderer.comets;
        const path=layer.entries[0].path;
        // A same-date new series must rebuild geometry, not reuse the range key.
        const series=structuredClone(app.cometData['1P']);
        series.states[0][0]+=1;
        const before=layer.entries[0].range;
        layer.setData({'1P':series});
        if(layer.entries[0].range!=='')throw Error('Replacement retained cached path');
        app.applyCometOptions();
        await app.replaceCometSource('bundled');
        if(app.cometSourceId!=='bundled-horizons-2026-11-18')throw Error('Incorrect fallback identity');
        if(app.cometCatalogue.map(e=>e.name).join('|')!=='1P/Halley|2P/Encke|55P/Tempel-Tuttle')throw Error('Inconsistent rollback names');
        await app.replaceCometSource('hosted');
        if(!/^[a-f0-9]{64}$/.test(app.cometSourceId))throw Error('Incorrect hosted identity');
      });
      await page.evaluate(()=>{
        const renderer=app.renderer, focus=renderer.focusComets, options=renderer.setOptions;
        let fits=0, updates=0;
        renderer.focusComets=()=>{fits++;};
        renderer.setOptions=function(...args){updates++;return options.apply(this,args);};
        try {
          app.cometsShown=false;
          if(updates!==1)throw Error('Visibility sends duplicate options');
          app.focusComets();
          app.cometIds=[];app.cometsShown=true;app.focusComets();
          app.cometIds=['1P'];
          const date=app.jed;app.jed=2444238.5;app.focusComets();
          app.jed=date;
          if(fits!==0)throw Error('Invalid selection reached renderer fit');
          app.focusComets();if(fits!==1)throw Error('Usable selection did not reach fit');
        } finally {renderer.focusComets=focus;renderer.setOptions=options;}
      });
      await page.evaluate(()=>app.destroy());
      assert.equal(await page.locator('.orrery-comet-label').count(),0);
    } finally { await page.close(); }
  }
  // Catalogue growth, reordering, removal and literal metadata through the real app.
  for (const renderer of ['three', 'pixi']) {
    const page = await browser.newPage({viewport:{width:320,height:568}});
    await routeFiles(page,root);
    let product = require('./comet-catalogue-fixture.cjs').product(['67P','123P','1P']);
    let requests = 0;
    await page.route('**/comets/**', route => {
      requests++;
      const file = new URL(route.request().url()).pathname.split('/comets/')[1];
      if (!product.files.has(file)) return route.fulfill({status:404});
      return route.fulfill({body:product.files.get(file),contentType:'application/json'});
    });
    try {
      await page.goto(`https://orrery.test/next/?renderer=${renderer}`);
      assert.equal(await page.evaluate(async () =>
        (await fetch('https://sn3p.github.io/orrery-data/comets/missing.json')).status), 404,
        'Missing synthetic catalogue assets return 404');
      await page.evaluate(()=>threeTest.ready);
      await page.waitForFunction(()=>threeTest.app.catalogue?.firstDraw);
      await page.evaluate(()=>{window.app=threeTest.app;app.jedDelta=0;});
      await page.getByRole('button',{name:'Options',exact:true}).click();
      await page.getByRole('checkbox',{name:'Show comets',exact:true}).check();
      await page.waitForFunction(()=>Object.keys(app.cometData??{}).length===3);
      assert.deepEqual(await page.evaluate(()=>app.renderer.comets.entries.map(e=>e.comet.id)),['67P','123P','1P']);
      assert.deepEqual(await page.locator('.property-name').allTextContents().then(names=>names.filter(n=>n.includes('/'))),product.objects.map(e=>e.name));
      assert.equal(await page.locator('.property-name b').count(),0,'Names are literal text');
      await expect(page.getByRole('status').filter({hasText:'10-year trajectory window'})).toBeVisible();
      await page.evaluate(()=>{
        const series=app.cometData['123P'];
        for(const date of [series.start,series.start+16000,series.start+(series.states.length-1)*series.step]){
          app.jed=date;app.cancelRender();app.renderFrame();
          const entry=app.renderer.comets.entries.find(e=>e.comet.id==='123P');
          const [first,last]=entry.range.split(':').map(Number);
          if(last-first!==914 || first<0 || last>=series.states.length)throw Error('Unbounded fallback path');
          const count=app.rendererId==='three' ? entry.path.geometry.attributes.position.count
            : entry.path.context.instructions.find(i=>i.action==='stroke').data.path.instructions.filter(i=>i.action==='lineTo').length+1;
          if(count!==915)throw Error('Fallback geometry does not match window');
        }
      });
      await page.getByRole('checkbox',{name:'Show 123P/<b>Literal test comet</b>',exact:true}).focus();
      await page.keyboard.press('Space');
      assert.deepEqual(await page.evaluate(()=>app.cometIds),['67P','1P']);
      await expect(page.getByRole('status').filter({hasText:'10-year trajectory window'})).toHaveCount(0);
      const before=requests;
      await page.evaluate(()=>{app.cometsShown=false;app.cometsShown=true;});
      assert.equal(requests,before,'Hide/show reuses verified pin');
      product=require('./comet-catalogue-fixture.cjs').product(['2P','123P']);
      await page.evaluate(()=>app.replaceCometSource('hosted'));
      assert.deepEqual(await page.evaluate(()=>app.cometIds),[]);
      await expect(page.getByRole('status').filter({hasText:'absent from this catalogue'})).toBeVisible();
      assert.deepEqual(await page.evaluate(()=>app.renderer.comets.entries.map(e=>e.comet.id)),['2P','123P']);
      assert.equal(await page.locator('.orrery-comet-label').count(),2,'Old resources removed');
      await page.getByRole('checkbox',{name:'Show 123P/<b>Literal test comet</b>',exact:true}).check();
      await page.waitForFunction(()=>app.cometStates['123P']==='ready');
      await expect(page.getByRole('status').filter({hasText:'absent from this catalogue'})).toHaveCount(0);
      await page.getByRole('button',{name:'Fit selected comets'}).click();
      assert(await page.locator('.orrery-options-panel').evaluate(el=>el.scrollWidth<=el.clientWidth+1));
      await page.evaluate(()=>{
        const r=app.renderer;
        const view=()=>app.rendererId==='three' ? r.camera.position.toArray() : [r.stage.scale.x,r.stage.scale.y];
        app.focusComets();const before=view();app.cometPaths=false;app.focusComets();
        // OrbitControls re-normalizes the camera quaternion on repeated fits.
        if(view().some((value,i)=>Math.abs(value-before[i])>1e-8))throw Error('Hidden fallback paths change fit window');
      });
      product=require('./comet-catalogue-fixture.cjs').product([]);
      await page.evaluate(()=>app.replaceCometSource('hosted'));
      await expect(page.getByRole('button',{name:'Retry comet data'})).toBeVisible();
      assert.equal(await page.locator('.orrery-comet-label').count(),0);
      product=require('./comet-catalogue-fixture.cjs').product(['123P','67P']);
      await page.getByRole('button',{name:'Retry comet data'}).click();
      await page.waitForFunction(()=>app.cometStates['123P']==='ready');
      assert.deepEqual(await page.evaluate(()=>app.cometIds),['123P']);
      await page.evaluate(async()=>{app.destroy();await app.loadComets();});
      const disposed=requests;
      await page.evaluate(()=>app.loadComets());
      assert.equal(requests,disposed,'Disposed app never reopens discovery');
    } finally {await page.close();}
  }
  // Automatic selection is bounded; entries beyond the initial subset stay usable.
  for (const renderer of ['three','pixi']) {
    const page=await browser.newPage();
    await routeFiles(page,root);
    const ids=['1P','2P','55P','9P','10P','67P','123P','124P'];
    const product=require('./comet-catalogue-fixture.cjs').product(ids);
    let downloads=0;
    await page.route('**/comets/**',route=>{
      const file=new URL(route.request().url()).pathname.split('/comets/')[1];
      if(file.startsWith('objects/'))downloads++;
      if (!product.files.has(file)) return route.fulfill({status:404});
      return route.fulfill({body:product.files.get(file),contentType:'application/json'});
    });
    try {
      await page.goto(`https://orrery.test/next/?renderer=${renderer}`);
      assert.equal(await page.evaluate(async () =>
        (await fetch('https://sn3p.github.io/orrery-data/comets/missing.json')).status), 404,
        'Missing synthetic catalogue assets return 404');
      await page.evaluate(()=>threeTest.ready);
      await page.waitForFunction(()=>threeTest.app.catalogue?.firstDraw);
      await page.evaluate(()=>{window.app=threeTest.app;app.jedDelta=0;app.cometsShown=true;});
      await page.waitForFunction(()=>Object.keys(app.cometData??{}).length===6);
      assert.equal(downloads,6);
      assert.deepEqual(await page.evaluate(()=>app.cometIds),ids.slice(0,6));
      await page.getByRole('button',{name:'Options',exact:true}).click();
      await page.getByRole('checkbox',{name:'Show 123P/<b>Literal test comet</b>',exact:true}).check();
      await page.waitForFunction(()=>app.cometStates['123P']==='ready');
      assert.equal(downloads,7,'Additional entry loads only on explicit selection');
      await page.evaluate(()=>{
        const r=app.renderer;
        const catalogue=app.cometCatalogue.slice().reverse();
        r.setOptions({shared:{cometCatalogue:catalogue}});
        if(!r.comets || r.comets.entries[0].comet.id!=='124P')throw Error('Catalogue-only update lost layer');
        if(r.cometSettings.cometData!==app.cometData)throw Error('Partial update lost verified data');
        r.setOptions({shared:{planetLabels:'all'}});
        if(r.comets.entries.length!==8)throw Error('Partial update lost catalogue');
      });
      await page.evaluate(()=>app.destroy());
    } finally {await page.close();}
  }
  // Public entry and indexed catalogue, independent of the instrumented fixture.
  for (const renderer of ['three','pixi']) {
    const page=await browser.newPage({viewport:{width:800,height:600}});
    await routeFiles(page,path.resolve('dist'));
    await require('./default-catalog-route.cjs').routeDefaultCatalog(page);
    await require('./comet-fixture.cjs').routeComets(page);
    let failures=1;
    await page.route('**/comets/latest.json',route=>failures-- > 0
      ? route.fulfill({status:503,body:'Unavailable'}) : route.fallback());
    try {
      await page.goto(`https://orrery.test/Orrery/?renderer=${renderer}&date=2026-11-18`);
      await page.waitForFunction(()=>document.querySelector('#orrery-count').textContent.length>0);
      await page.getByRole('button',{name:'Options',exact:true}).click();
      await page.getByRole('checkbox',{name:'Show comets',exact:true}).check();
      await expect(page.getByRole('button',{name:'Retry comet data'})).toBeVisible();
      await page.getByRole('button',{name:'Retry comet data'}).click();
      await expect(page.getByRole('button',{name:'Fit selected comets'})).toBeEnabled();
      await page.getByRole('button',{name:'Fit selected comets'}).click();
      await page.waitForFunction(()=>document.querySelectorAll('.orrery-comet-label:not([hidden])').length===6);
      await page.getByRole('checkbox',{name:'Show asteroids',exact:true}).uncheck();
      await expect(page.locator('#orrery-count-unit')).toBeVisible();
      await expect(page.locator('#orrery-count')).toHaveText('0');
      await page.reload();
      await page.getByRole('button',{name:'Options',exact:true}).click();
      await expect(page.getByRole('checkbox',{name:'Show comets',exact:true})).not.toBeChecked();
      await expect(page.getByRole('checkbox',{name:'Show asteroids',exact:true})).toBeChecked();
    } finally { await page.close(); }
  }
  console.log(`${name}: comet controls, lazy data, both renderers, dates, switching and responsive layout passed`);
}
module.exports={run,routeFiles};
if(require.main===module) require('./standalone.cjs').run(run);
