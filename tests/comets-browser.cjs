const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { expect } = require('@playwright/test');

// Intercept built assets directly: no HTTP server, live profile or screenshots.
async function routeFiles(page, root) {
  await page.route('https://orrery.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname.replace(/^\/Orrery\//, '/');
    const file = path.resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
    if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return route.fulfill({ status:404 });
    const contentType = {'.js':'text/javascript','.json':'application/json','.html':'text/html','.css':'text/css','.woff2':'font/woff2'}[path.extname(file)] || 'application/octet-stream';
    return route.fulfill({path:file,contentType});
  });
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
    page.on('request',request=>{if(request.url().endsWith('/data/vectors.json')) requests++;});
    await routeFiles(page,root);
    try {
      await page.goto(`https://orrery.test/Orrery/next/?renderer=${renderer}`);
      await page.evaluate(()=>threeTest.ready);
      await page.waitForFunction(()=>threeTest.app.catalogue?.firstDraw);
      await page.evaluate(()=>{window.app=threeTest.app;app.jedDelta=0;app.cancelRender();});
      assert.equal(requests,0,'Default view never requests comet vectors');
      await page.getByRole('button',{name:'Options',exact:true}).click();
      await expect(page.getByRole('checkbox',{name:'Show Halley',exact:true})).toHaveCount(0);
      await page.getByRole('checkbox',{name:'Show comets',exact:true}).check();
      await page.waitForFunction(()=>app.cometData && app.renderer.comets?.entries.every(e=>e.body.visible));
      assert.equal(requests,1);
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
            check(duration >= comet.periodDays && duration < comet.periodDays + 2 * source.step,
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
      await page.waitForFunction(()=>document.querySelectorAll('.orrery-comet-label:not([hidden])').length===3);
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
      await page.getByRole('checkbox',{name:'Show Encke' ,exact:true}).uncheck();
      await page.getByRole('checkbox',{name:'Comet paths',exact:true}).uncheck();
      assert(await page.evaluate(()=>app.renderer.comets.entries.every(e=>!e.path.visible) && !app.renderer.comets.entries[1].body.visible));
      await page.getByRole('checkbox',{name:'Show Halley',exact:true}).focus();
      await page.keyboard.press('Space');
      await expect(page.getByRole('checkbox',{name:'Show Halley',exact:true})).not.toBeChecked();
      await page.getByRole('checkbox',{name:'Show Halley',exact:true}).check();
      const other=renderer==='three'?'pixi':'three';
      await page.getByRole('combobox',{name:'Renderer',exact:true}).selectOption(other);
      await page.waitForFunction(id=>app.rendererId===id&&!app.switching,other);
      assert(await page.evaluate(()=>app.cometsShown && !app.asteroidsShown && !app.cometPaths && app.cometIds.join(',')==='1P,55P'));
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
      await expect(page.getByRole('checkbox',{name:'Show Halley',exact:true})).toHaveCount(0);
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
    await page.route('**/data/vectors.json',route=>{vectorRoute=route;notifyVector();});
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
      await page.waitForFunction(()=>app.cometLoading===null);
      assert(await page.evaluate(()=>app.cometData===null && document.querySelectorAll('.orrery-comet-label').length===0));
    } finally { await page.close(); }
  }
  // Public entry and indexed catalogue, independent of the instrumented fixture.
  for (const renderer of ['three','pixi']) {
    const page=await browser.newPage({viewport:{width:800,height:600}});
    await routeFiles(page,path.resolve('dist'));
    await require('./default-catalog-route.cjs').routeDefaultCatalog(page);
    let failures=1;
    await page.route('**/data/vectors.json',route=>failures-- > 0
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
      await page.waitForFunction(()=>document.querySelectorAll('.orrery-comet-label:not([hidden])').length===3);
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
