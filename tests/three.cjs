const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { serve } = require('./support.cjs');
const cases = require('./fixtures/consumer-v1/cases.json');
const tie = require('./fixtures/consumer-v1/loader-cases.json').cases[0];

async function boot(page, url) {
  await page.goto(url);
  await page.evaluate(() => window.threeTest?.ready ?? window.catalogReady);
  await page.waitForFunction(() => {
    const app = window.threeTest?.app ?? window.catalogTest?.app;
    return app?.initialized && (app.catalogLoader ? app.catalogLoader.sceneComplete() : !!app.catalogue?.firstDraw);
  });
  await page.evaluate(() => { window.app = window.threeTest?.app ?? window.catalogTest.app; app.jedDelta = 0; });
}
async function settle(page) { await page.evaluate(async () => { for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame); }); }
function errors(page) {
  const result = [];
  page.on('pageerror', e => result.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) result.push(m.text()); });
  return result;
}
function raster(image) {
  const png = Buffer.from(image.split(',')[1], 'base64'), data = []; let header;
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset), type = png.toString('ascii', offset + 4, offset + 8);
    if (type === 'IHDR') header = png.subarray(offset + 8, offset + 8 + length);
    if (type === 'IDAT') data.push(png.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
  }
  return Buffer.concat([header, require('node:zlib').inflateSync(Buffer.concat(data))]);
}

async function entries(browser, base, output, name) {
  const results = [];
  for (const prefix of ['', '/Orrery']) {
    for (const renderer of ['pixi', 'three', 'unknown']) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      const diagnostics = errors(page), requests = [];
      page.on('request', r => requests.push(r.url()));
      try {
        // Pixi remains available without WebGL2, including unknown-ID fallback.
        if (renderer !== 'three') await page.addInitScript(() => {
          const get = HTMLCanvasElement.prototype.getContext;
          HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl2' ? null : get.call(this, type, ...args); };
        });
        await boot(page, base + prefix + '/next/?renderer=' + renderer);
        assert.equal(await page.evaluate(() => app.rendererId), renderer === 'three' ? 'three' : 'pixi');
        assert.equal(await page.evaluate(() => app.catalogue.count), 100000);
        assert.equal(await page.locator('#orrery canvas').count(), 1);
        assert.equal(await page.getByRole('button', { name: 'Options', exact: true }).count(), 1);
        assert(requests.some(url => url.includes('/' + (renderer === 'three' ? 'three' : 'pixi') + '.')));
        assert(!requests.some(url => url.includes('/' + (renderer === 'three' ? 'pixi' : 'three') + '.')));
        if (renderer === 'unknown') assert.equal(await page.locator('#orrery-status').textContent(), 'Unknown renderer. Showing Pixi.');
        await page.reload();
        await page.waitForFunction(() => Number(document.querySelector('#orrery-count').textContent.replaceAll("\u202f", "")) > 0);
        // Existing Pixi/WebGL1 texture setup emits this exact WebKit diagnostic
        // on the no-fault baseline too (see frame-commit.cjs). Keep it recorded;
        // every other console error and all Three errors remain failures.
        const known = message => name === 'webkit' && renderer !== 'three'
          && message === 'WebGL: INVALID_ENUM: texParameter: invalid parameter name';
        assert.deepEqual(diagnostics.filter(message => !known(message)), []);
        if (renderer === 'unknown') {
          assert.equal(await page.locator('#orrery-status').textContent(), 'Unknown renderer. Showing Pixi.');
          await page.evaluate(() => { threeTest.app.destroy(); threeTest.app.destroy(); threeTest.app.renderStatus(); });
          assert.equal(await page.locator('#orrery-status').textContent(), '', 'Unknown-renderer notice is cleared by teardown');
          assert.equal(await page.locator('#orrery-status').getAttribute('role'), 'status');
          assert.equal(await page.locator('canvas, .orrery-options').count(), 0);
        }
        results.push({ prefix, renderer, historical100k: true, lazy: true, knownWebGL1Warnings: diagnostics.filter(known).length });
      } finally { await page.close(); }
    }
  }
  for (const kind of ['chunk', 'webgl2', 'shader']) {
    const page = await browser.newPage({ viewport: { width: 320, height: 568 } });
    const unhandled = []; page.on('pageerror', e => unhandled.push(e.message));
    try {
      if (kind === 'chunk') await page.route('**/assets/three.*.js', route => route.fulfill({ status: 503, body: 'Unavailable' }));
      else if (kind === 'webgl2') await page.addInitScript(() => {
        const get = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) { return type === 'webgl2' ? null : get.call(this, type, ...args); };
      });
      else await page.addInitScript(() => {
        const original = WebGL2RenderingContext.prototype.shaderSource;
        WebGL2RenderingContext.prototype.shaderSource = function(shader, source) {
          return original.call(this, shader, source.includes('vec3 orbitPosition')
            ? source + '\ncontrolled_invalid_shader_token;\n' : source);
        };
      });
      await page.goto(base + '/Orrery/next/?renderer=three');
      await page.getByRole('alert').filter({ hasText: kind === 'shader' ? 'Unable to render' : 'Unable to start the 3D visualization' }).waitFor();
      if (kind === 'shader') {
        assert.equal(await page.evaluate(() => threeTest.ready), false, 'Initial GPU failure does not report a successful load');
        assert(await page.evaluate(() => threeTest.app.initialized && threeTest.app.renderFailure && !threeTest.app.catalogue));
      } else assert.equal(await page.locator('canvas, .orrery-options').count(), 0);
      const link = page.getByRole('link', { name: 'Open Pixi preview', exact: true });
      assert.equal(await link.evaluate(el => new URL(el.href).pathname), '/Orrery/next/');
      const box = await link.boundingBox(); assert(box.x >= 0 && box.x + box.width <= 320);
      await link.focus(); assert(await link.evaluate(el => el === document.activeElement));
      await page.screenshot({ path: path.join(output, `${name}-${kind}-recovery.png`) });
      if (kind !== 'shader') {
        assert(await page.evaluate(async () => {
          const failed = threeTest.app, status = document.getElementById('orrery-status');
          failed.destroy(); failed.destroy(); failed.renderStatus();
          if (status.textContent || status.getAttribute('role') !== 'status' || status.querySelector('a')) return false;
          // A failed old instance may be disposed after another App takes over
          // the shared status node, as during replacement or hot disposal.
          const stale = new failed.constructor({ renderer: 'three' });
          try { await stale.init(); } catch { /* The same startup fault remains installed. */ }
          const replacement = new failed.constructor({ renderer: 'unknown', autoRender: false });
          await replacement.loadAsteroids('data/catalog.json');
          const message = status.textContent;
          stale.renderStatus();
          const untouched = status.textContent === message;
          stale.destroy(); stale.destroy(); stale.renderStatus();
          const retained = untouched && message === 'Unknown renderer. Showing Pixi.' && status.textContent === message;
          replacement.destroy();
          return retained && !status.textContent && !document.querySelector('canvas, .orrery-options');
        }), 'Startup teardown clears its own feedback and preserves a newer App status');
        await page.reload();
        await page.getByRole('alert').filter({ hasText: 'Unable to start the 3D visualization' }).waitFor();
      }
      await link.click();
      await page.waitForFunction(() => Number(document.querySelector('#orrery-count').textContent.replaceAll("\u202f", "")) > 0);
      assert.equal(await page.evaluate(() => threeTest.app.rendererId), 'pixi');
      assert.deepEqual(unhandled, []);
      results.push({ failure: kind, accessiblePixiRecovery: true });
    } finally { await page.close(); }
  }
  return results;
}

async function graphics(browser, base, output, name) {
  const results = [];
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const target = await context.newPage();
    const diagnostics = errors(target);
    try {
      await boot(target, base + '/next/?renderer=three');
      // The completed source-port comparison is retired. Independently count
      // discoveries and require exact return-to-date pixels on production.
      const catalogue = JSON.parse(require('./historical-catalog.cjs').readCatalog());
      for (const dpr of ['1', '2']) {
        let startPixels;
        for (const [label, date] of [['sparse', 2378861.5], ['start', 2444270.5],
          ['dense', 2458600.5], ['reverse', 2444270.5]]) {
          const expectedCount = catalogue.filter(row => row.disc <= date).length;
          const actual = await target.evaluate(({ date, dpr }) => {
            app.pixelRatio = dpr; app.jed = date; app.renderFrame();
            const canvas = app.renderer.canvas;
            const gl = app.renderer.renderer.getContext();
            const pixels = new Uint8Array(canvas.width * canvas.height * 4);
            gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
            let lit = 0;
            for (let i = 0; i < pixels.length; i += 4) if (pixels[i] || pixels[i + 1] || pixels[i + 2]) lit++;
            return { pixels: canvas.toDataURL(), count: app.asteroidsDiscovered,
              width: canvas.width, height: canvas.height, lit, error: gl.getError(),
              complete: !app.renderFailure && !app.requestedJed && app.jed === date };
          }, { date, dpr });
          assert(actual.complete, 'Scene/date commits successfully');
          assert.equal(actual.error, 0, 'Scene readback has no WebGL error');
          assert(actual.lit > 100, 'Scene contains visible rendered content');
          assert.equal(actual.width, viewport.width * Number(dpr));
          assert.equal(actual.height, viewport.height * Number(dpr));
          assert.equal(actual.count, expectedCount);
          assert.equal(await target.locator('#orrery-count').textContent(), expectedCount.toLocaleString('en-US').replaceAll(',', '\u202f'),
            'The committed Three discovery count is grouped for display');
          if (label === 'start') startPixels = raster(actual.pixels);
          if (label === 'reverse') assert(raster(actual.pixels).equals(startPixels), 'Reverse restores exact start-date scene pixels');
          await target.screenshot({ path: path.join(output, `${name}-${viewport.width}-${dpr}-${label}.png`) });
          results.push({ viewport, dpr, label, count: actual.count, litPixels: actual.lit, reverseExact: label === 'reverse' });
        }
      }
      await require('./next-layout.cjs').check(target);
      const options = target.getByRole('button', { name: 'Options', exact: true });
      await options.click();
      const speed = target.getByRole('textbox', { name: 'Playback speed' });
      assert(await options.evaluate(el => el === document.activeElement));
      await target.keyboard.press("Tab");
      assert(await target.getByRole("combobox", { name: "Renderer", exact: true }).evaluate(el => el === document.activeElement));
      await target.keyboard.press("Tab");
      assert(await speed.evaluate(el => el === document.activeElement));
      for (const selector of ['.orrery-identity', '.orrery-date', '.orrery-count', '.orrery-options-panel']) {
        const box = await target.locator(selector).boundingBox();
        assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, selector);
      }
      await target.screenshot({ path: path.join(output, `${name}-${viewport.width}-options.png`) });
      await speed.press('Escape'); assert(await target.getByRole('button', { name: 'Options', exact: true }).evaluate(el => el === document.activeElement));
      assert.deepEqual(diagnostics.flat(), []);
    } finally { await context.close(); }
  }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    await boot(page, base + '/next/?renderer=three');
    results.push({ shader: await page.evaluate(() => threeTest.validate()) });
    await page.evaluate(() => {
      // Adapt only the source test's application entry; assertions and native
      // GL upload instrumentation remain unchanged.
      window.test = { REFERENCE_JED: 2458600.5, REBASE_DAYS: 4096, app: {
        get jed() { return app.jed; }, get autoRender() { return app.autoRender; }, set autoRender(v) { app.autoRender = v; },
        renderer: app.renderer.renderer, asteroids: app.renderer.asteroids,
        cancelRender: () => app.cancelRender(), requestRender: () => app.requestRender(),
        renderFrame: jed => { app.jed = jed; app.renderFrame(); },
      } };
    });
    results.push({ uploads: await require('./three-uploads.cjs')(page) });
    results.push({ adaptiveRebase: await page.evaluate(() => {
      app.jedDelta = 0; app.jed = 2458600.5;
      const row = { a: 1, e: .7, i: 37, W: 123, wbar: 45, M: 90,
        n: 4 * 180 / Math.PI, epoch: app.jed, disc: 2000000 };
      app.setAsteroids([row]);
      const cloud = app.renderer.asteroids, model = app.catalogue;
      const phases = model.phases.slice(), dates = model.dates.slice(), epoch = cloud.epoch;
      if (cloud.rebaseDays !== 256) throw new Error('Fast accepted orbits must shorten the source rebase interval');
      app.jed = epoch + 256; app.renderFrame();
      if (cloud.epoch !== epoch) throw new Error('The exact adaptive threshold must not upload');
      app.jed = epoch + 256.25; app.renderFrame();
      if (cloud.epoch !== app.jed || cloud.uniforms.orbitTime.value !== 0) throw new Error('Fast phases must rebase after the threshold');
      app.jed -= 256.25; app.renderFrame();
      if (cloud.epoch !== app.jed) throw new Error('Reverse fast phases must rebase too');
      if (!phases.every((v,i) => v === model.phases[i]) || !dates.every((v,i) => v === model.dates[i])) throw new Error('Rebasing mutated canonical data');
      return { days: cloud.rebaseDays, forward: true, reverse: true, immutable: true };
    }) });
  } finally { await page.close(); }
  return results;
}

async function lifecycle(browser, base, output, name) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, hasTouch: true });
  const diagnostics = errors(page), requests = [];
  page.on('request', r => { if (/catalog\.json/.test(r.url())) requests.push(r.url()); });
  try {
    await boot(page, base + '/next/?renderer=three');
    await settle(page);
    await page.evaluate(() => {
      window.draws = 0; const render = app.renderer.render.bind(app.renderer);
      app.renderer.render = () => { draws++; return render(); };
      window.model = app.catalogue;
      window.originalArrays = Object.fromEntries(['p','q','elements','phases','dates','rows'].map(k => [k, model[k].slice()]));
    });
    const idle = await page.evaluate(() => ({ draws, jed: app.jed }));
    await page.waitForTimeout(120);
    assert.deepEqual(await page.evaluate(() => ({ draws, jed: app.jed })), idle, 'Paused Three has no recurring frames');
    const initial = await page.evaluate(() => app.renderer.camera.position.toArray());
    await page.mouse.move(640, 400); await page.mouse.down(); await page.mouse.move(770, 460, { steps: 5 }); await page.mouse.up();
    await settle(page);
    assert.notDeepEqual(await page.evaluate(() => app.renderer.camera.position.toArray()), initial);
    assert.equal(await page.evaluate(() => app.jed), idle.jed);
    const beforePan = await page.evaluate(() => app.renderer.controls.target.toArray());
    await page.mouse.move(640, 400); await page.mouse.down({ button: 'right' });
    await page.mouse.move(710, 420, { steps: 4 }); await page.mouse.up({ button: 'right' });
    await settle(page);
    assert.notDeepEqual(await page.evaluate(() => app.renderer.controls.target.toArray()), beforePan);
    const beforeZoom = await page.evaluate(() => app.renderer.camera.position.distanceTo(app.renderer.controls.target));
    await page.mouse.wheel(0, 160); await settle(page);
    assert.notEqual(await page.evaluate(() => app.renderer.camera.position.distanceTo(app.renderer.controls.target)), beforeZoom);
    if (name === 'chromium') {
      const session = await page.context().newCDPSession(page);
      for (const fingers of [1, 2]) {
        const before = await page.evaluate(() => app.renderer.camera.position.toArray());
        const points = step => fingers === 1 ? [{ x: 500 + step * 12, y: 400 + step * 5, id: 1 }]
          : [{ x: 400 - step * 3, y: 400, id: 1 }, { x: 640 + step * 6, y: 400, id: 2 }];
        await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points(0) });
        for (let step = 1; step <= 6; step++) await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points(step) });
        await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await settle(page); assert.notDeepEqual(await page.evaluate(() => app.renderer.camera.position.toArray()), before);
      }
      await session.detach();
    }
    for (const speed of [1.5, -1.5]) {
      const date = await page.evaluate(speed => { app.jedDelta = speed; return app.jed; }, speed);
      await page.waitForFunction(({ date, speed }) => speed > 0 ? app.jed > date : app.jed < date, { date, speed });
      await page.evaluate(() => app.jedDelta = 0); await settle(page);
    }
    const visibility = await page.evaluate(() => {
      app.autoRender = false; app.cancelRender(); app.jedDelta = 1.5;
      app.renderFrame(1000); const before = app.jed;
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange')); app.renderFrame(6000);
      const hidden = app.jed; delete document.hidden; document.dispatchEvent(new Event('visibilitychange'));
      app.renderFrame(7000); const first = app.jed; app.renderFrame(7100);
      const advance = app.jed - first; app.jedDelta = 0;
      // A completely offscreen camera still commits time with an actual draw.
      app.renderer.controls.target.set(1e8,1e8,1e8); app.renderer.controls.update();
      app.jed += 1; const requested = app.jed; app.renderFrame();
      return { hidden: hidden === before, resume: first === before, advance, offscreen: app.jed === requested && !app.requestedJed };
    });
    assert.deepEqual(visibility, { hidden: true, resume: true, advance: 9, offscreen: true });
    for (let cycle = 0; cycle < 2; cycle++) {
      await page.evaluate(() => { window.loss = app.renderer.renderer.getContext().getExtension('WEBGL_lose_context'); loss.loseContext(); });
      await page.waitForFunction(() => app.contextLost);
      assert.match(await page.locator('#orrery-status').textContent(), /Graphics connection lost/);
      assert.equal(await page.evaluate(() => app.animationFrame), null);
      await page.evaluate(() => loss.restoreContext()); await page.waitForFunction(() => !app.contextLost);
      assert(await page.evaluate(() => { app.renderFrame(); return !app.renderFailure && app.catalogue === model; }));
    }
    assert.equal(requests.length, 1, 'Two graphics restorations reuse retained CPU catalogue');
    assert(await page.evaluate(() => Object.entries(originalArrays).every(([key, values]) => values.every((v,i) => Object.is(v, model[key][i])))), 'Canonical data remains unmutated');
    assert(await page.evaluate(() => {
      const adapter = app.renderer, cloud = adapter.asteroids;
      app.destroy(); app.destroy(); window.dispatchEvent(new Event('resize')); app.requestRender();
      return Object.keys(cloud.geometry.attributes).length === 0 && adapter.scene.children.length === 0
        && adapter.planets.length === 0 && adapter.asteroids === null;
    }), 'Final destruction releases CPU arrays and scene ownership as well as GPU storage');
    assert.equal(await page.locator('canvas, .orrery-options').count(), 0);
    assert.equal(await page.evaluate(() => app.animationFrame), null);
    const initialization = await page.evaluate(async () => {
      const { App, ThreeRenderer } = await threeTest.constructors();
      const check = (value, message) => { if (!value) throw new Error(message); };
      let release, adapter;
      const lazy = new App({ renderer: 'three', createRenderer: options => new Promise(resolve => {
        release = () => resolve(adapter = new ThreeRenderer(options));
      }) });
      const pending = lazy.init(); lazy.destroy(); release(); await pending;
      check(adapter.destroyed && !adapter.renderer, 'Disposal during lazy import prevents GPU allocation');
      for (const afterAllocation of [false, true]) {
        const failing = new App({ renderer: 'three', createRenderer: options => {
          adapter = new ThreeRenderer(options); const initialize = adapter.init;
          adapter.init = () => { if (afterAllocation) initialize.call(adapter); throw new Error('controlled init failure'); };
          return adapter;
        } });
        let rejected = false;
        try { await failing.init(); } catch { rejected = true; }
        check(rejected && failing.destroyed && adapter.destroyed, 'Partial initialization is terminal and disposed');
        check(!document.querySelector('canvas, .orrery-options'), 'Initialization failure releases all attached resources');
        failing.destroy();
      }
      return { lazyDisposal: true, partialInitialization: ['before', 'after'] };
    });
    assert.deepEqual(diagnostics, []);
    return { initialization, paused: true, camera: true, playback: true, visibility, recoveryCycles: 2, catalogueRequests: requests.length, immutable: true, disposal: true };
  } finally { await page.close(); }
}

const parts = { entries, graphics, lifecycle, ...require('./three-catalog.cjs') };
async function run({ browser, name, output = path.resolve('.context/pr4/browser', name), part = 'entries' }) {
  assert(Object.hasOwn(parts, part));
  await fs.mkdir(output, { recursive: true });
  const site = output + '-site';
  await fs.rm(site, { recursive: true, force: true });
  if (process.env.ORRERY_PREBUILT_FIXTURES) require('./fixture-builds.cjs').copyPrepared('three', site);
  else await require('./three-build.cjs').build(site);
  if (part === 'data' || part === 'frames') {
    if (process.env.ORRERY_PREBUILT_FIXTURES) require('./fixture-builds.cjs').copyPrepared('catalog', path.join(site, 'catalog'));
    else await require('./catalog-loading.cjs').build(path.join(site, 'catalog'));
  }
  await fs.symlink(site, path.join(site, 'Orrery'), 'dir');
  const server = await serve(site);
  try {
    const result = await parts[part](browser, server.url, output, name);
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ name, part, result }, null, 2));
    console.log(`${name}: Three ${part} passed.`);
  } finally { await server.close(); }
}
module.exports = { run };
if (require.main === module) require('./standalone.cjs').run(options => run({ ...options, part: process.env.THREE_PART || 'entries' }));
