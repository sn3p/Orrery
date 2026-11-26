const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fixture, ref } = require('./named-body-fixture.cjs');
const { routeFiles } = require('./route-files.cjs');

async function build(output) {
  const target = require('../webpack.next.config.js'), webpack = require('webpack');
  const config = { ...target, entry: './tests/named-bodies-entry.js', mode: 'production',
    output: { ...target.output, path: path.resolve(output) }, performance: { hints: false },
    plugins: target.plugins.map(plugin => plugin instanceof webpack.DefinePlugin
      ? new webpack.DefinePlugin({ __CATALOG_SELECTION__: JSON.stringify(fixture().selection) }) : plugin) };
  await new Promise((resolve, reject) => {
    const compiler = webpack(config);
    compiler.run((error, stats) => compiler.close(closeError => {
      if (error || closeError || stats.hasErrors()) reject(error || closeError || new Error(stats.toString('errors-only'))); else resolve();
    }));
  });
}
async function settle(page, count = 13) {
  await page.waitForFunction(expected => {
    const app = namedTest.app;
    app.renderFrame();
    return !app.pendingSession && app.activeSession && app.renderer.planets.length === expected;
  }, count);
}
async function run({ browser, output = '.context/named-bodies/browser', candidate }) {
  const root = path.resolve(output, 'site'); await build(root);
  const data = fixture(), empty = fixture('empty'), report = [];
  for (const [url, body] of empty.files) data.files.set(url, body);
  for (const renderer of ['pixi', 'three']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    let offline = false, blocked, release;
    await routeFiles(page, root);
    await page.route(/^https:\/\/(named|empty)\.test\//, async route => {
      const url = route.request().url();
      if (url.includes('/held/')) {
        blocked?.();
        await new Promise(resolve => { release = resolve; });
      }
      const body = data.files.get(url.replace('/held/', '/bodies/'));
      await route.fulfill(offline ? { status: 503, body: 'offline' } : body
        ? { body, contentType: 'application/json' } : { status: 404 }).catch(() => {});
    });
    try {
      await page.goto(`https://orrery.test/?renderer=${renderer}`);
      await page.evaluate(async () => { await namedTest.ready; window.app = namedTest.app; app.autoRender = false; app.cancelRender(); });
      await settle(page);
      const initial = await page.evaluate(() => app.renderer.captureView());
      if (renderer === 'pixi') assert.deepEqual(initial, { scale: 1, x: 0, y: 0 });
      else {
        assert(initial.position.every((value, i) => Math.abs(value - [500, 500, 400][i]) < 1e-9));
        assert.deepEqual(initial.target, [0, 0, 0]); assert.equal(initial.zoom, 1);
      }
      assert.equal(await page.evaluate(() => app.asteroidsDiscovered), 0);
      assert.equal(await page.evaluate(() => app.renderer.planets.filter(p => p.options.classification === 'dwarf-planet').length), 5);
      await page.evaluate(() => { app.planetLabels = 'all'; app.renderFrame(); });
      assert.equal(await page.locator('.orrery-planet-label[data-classification="dwarf-planet"]').count(), 5);
      assert.equal(await page.locator('.orrery-planet-label[data-planet="Pluto"]').textContent(), 'Pluto · dwarf');
      assert(await page.locator('.orrery-planet-label[data-planet="Pluto"]').isHidden(), 'Outer bodies clip in the opening view');
      // Confirm both adapters use real producer positions through the actual App update.
      for (const date of [2378496.5, 2451545, 2488069.5, 1000000, 4000000]) {
        await page.evaluate(jd => { app.jed = jd; app.renderFrame(); }, date);
        await page.waitForFunction(jd => { app.renderFrame(); return app.jed === jd && !app.catalogWaiting; }, date);
        const state = await page.evaluate(() => app.renderer.planets.map(p => {
          const expected = namedTest.namedPosition(p.options.namedBody, app.jed);
          const actual = app.rendererId === 'pixi' ? [-p.body.x / 100, p.body.y / 100] : p.body.position.toArray().map(x => x / 100);
          return { error: Math.hypot(...actual.map((x, i) => x - expected.position[i])),
            expectedStatus: expected.status, trackDate: p.orbit.trackDate };
        }));
        assert(state.every(p => p.error < 1e-12));
      }
      assert.deepEqual(await page.evaluate(() => app.renderer.captureView()), initial, 'Date/data never refits the camera');
      const masks = await page.evaluate(() => {
        const cloud = app.renderer.asteroids, model = app.catalogue;
        return { classes: Array.from(model.classes), gpu: Array.from(app.rendererId === 'pixi'
          ? cloud.geometry.getBuffer('aClass').data : cloud.geometry.attributes.classId.array),
          discovered: app.asteroidsDiscovered, visible: app.asteroidsVisible, suppressed: [...model.suppressedRows] };
      });
      assert.deepEqual(masks.suppressed, [1]); assert.equal(masks.discovered, 6); assert.equal(masks.visible, 6);
      assert.notEqual(masks.gpu[1], masks.classes[1]);
      for (const i of [0, 2, 3, 4, 5]) assert.equal(masks.gpu[i], masks.classes[i]);
      for (const preset of ['all', 'nea', 'hungarias', 'belt', 'belt-inner', 'belt-middle', 'belt-outer', 'hildas', 'trojans', 'distant', 'without-belt']) {
        await page.evaluate(preset => { app.populationPreset = preset; app.asteroidsShown = false; app.renderFrame(); }, preset);
        assert.equal(await page.evaluate(() => app.renderer.planets.length), 13);
        assert.equal(await page.evaluate(() => app.populationPreset), preset);
      }
      await page.evaluate(() => { app.asteroidsShown = true; app.populationPreset = 'all'; app.planetOrbits = false; app.renderFrame(); });
      assert(await page.evaluate(() => app.renderer.planetOrbits.every(o => !o.visible)));
      const beforeSwitch = await page.evaluate(() => app.renderer.captureView());
      const other = renderer === 'pixi' ? 'three' : 'pixi';
      assert(await page.evaluate(id => app.switchRenderer(id), other));
      assert.equal(await page.evaluate(() => app.renderer.planets.length), 13);
      assert(await page.evaluate(() => app.renderer.planetOrbits.every(o => !o.visible)));
      assert(await page.evaluate(id => app.switchRenderer(id), renderer));
      const afterSwitch = await page.evaluate(() => app.renderer.captureView());
      for (const key of Object.keys(beforeSwitch)) {
        const a = [beforeSwitch[key]].flat(), b = [afterSwitch[key]].flat();
        assert(a.every((value, i) => Math.abs(value - b[i]) < 1e-9), `Restored camera ${key}`);
      }
      // DPR replacement updates every retained body set, including the hidden baseline.
      await page.evaluate(() => { app.pixelRatio = 2; app.renderFrame(); });
      assert(await page.evaluate(() => app.rendererId !== 'pixi' || (() => {
        let valid = true;
        app.renderer.referenceBodies.forEach(({ planet }) => { valid &&= planet.body.texture === app.renderer.circleTexture; });
        return valid;
      })()));
      // The previous pair survives offline/corrupt/mismatched replacements.
      offline = true;
      assert.equal(await page.evaluate(({ pin, namedBodies }) => app.loadCatalog(pin, { namedBodies }), data), false);
      offline = false;
      assert.equal(await page.evaluate(() => app.renderer.planets.length), 13);
      const bad = { ...data.namedBodies, sha256: '0'.repeat(64) };
      assert.equal(await page.evaluate(({ pin, namedBodies }) => app.loadCatalog(pin, { namedBodies }), { pin: data.pin, namedBodies: bad }), false);
      assert.equal(await page.evaluate(() => app.catalogue.sourceId), data.pin.sha256);
      assert.equal(await page.evaluate(({ pin, namedBodies }) => app.loadCatalog(pin, { namedBodies }), { pin: empty.pin, namedBodies: data.namedBodies }), false);
      assert.equal(await page.evaluate(() => app.catalogue.sourceId), data.pin.sha256, 'Wrong generation retains the previous catalogue');
      await page.evaluate(({ pin, namedBodies }) => app.loadCatalog(pin, { namedBodies }), empty); await settle(page);
      assert.equal(await page.evaluate(() => app.asteroidsDiscovered), 0);
      assert.equal(await page.evaluate(() => app.catalogue.suppressedRows.size), 0);
      await page.evaluate(({ pin, namedBodies }) => app.loadCatalog(pin, { namedBodies }), data); await settle(page);
      // Supersede a blocked pair request with a successful unpaired replacement.
      const held = new Promise(resolve => { blocked = resolve; });
      await page.evaluate(({ pin, namedBodies }) => { window.stale = app.loadCatalog(pin, { namedBodies: { ...namedBodies, url: namedBodies.url.replace('/bodies/', '/held/') } }); }, data);
      await held;
      await page.evaluate(pin => app.loadCatalog(pin), data.pin); release();
      assert.equal(await page.evaluate(() => window.stale), false); await settle(page, 6);
      assert.equal(await page.evaluate(() => app.catalogue.namedBodies), null);
      // A failed draw must restore the previous *pair*, not just the cloud.
      await page.evaluate(({ pin, namedBodies }) => app.loadCatalog(pin, { namedBodies }), data);
      await page.waitForFunction(() => app.pendingSession?.loader.readyToDraw(app.jed));
      const attempted = await page.evaluate(() => {
        const renderer = app.renderer, render = renderer.render;
        const counts = [];
        renderer.render = () => { counts.push(renderer.planets.length); return null; };
        app.renderFrame(); renderer.render = render;
        return counts;
      });
      assert.equal(attempted[0], 13, 'Failed submission reached the installed candidate pair');
      assert.equal(await page.evaluate(() => app.renderer.planets.length), 6);
      await settle(page);
      // Existing Planets controls retain keyboard access at desktop/mobile sizes.
      await page.getByRole('button', { name: 'Options', exact: true }).click();
      for (const width of [1280, 390, 320]) {
        await page.setViewportSize({ width, height: width === 1280 ? 900 : 568 });
        await require('./options-geometry.cjs')(page.locator('.orrery-options-panel'));
        const labels = page.getByRole('combobox', { name: 'Planet labels', exact: true });
        await labels.selectOption('off'); assert.equal(await page.locator('.orrery-planet-label').count(), 0);
        await labels.selectOption('earth'); assert.equal(await page.locator('.orrery-planet-label').count(), 1);
        await labels.selectOption('all'); assert.equal(await page.locator('.orrery-planet-label').count(), 13);
        const orbits = page.getByRole('checkbox', { name: 'Planet orbits', exact: true });
        await orbits.focus(); await page.keyboard.press('Space');
        assert(await page.evaluate(() => app.renderer.planetOrbits.every(o => o.visible === app.planetOrbits)));
      }
      await page.keyboard.press('Escape');
      const edgeLabels = await page.evaluate(() => {
        const results = [];
        app.renderer.planetLabels.forEach((planet, label) => {
          if (planet.options.classification !== 'dwarf-planet') return;
          for (const x of [1, innerWidth - 60, innerWidth - 1]) {
            label.place(x, 100, { width: innerWidth, height: innerHeight });
            const r = label.element.getBoundingClientRect();
            results.push({ left: r.left, right: r.right });
          }
        });
        return results;
      });
      assert(edgeLabels.every(r => r.left >= 0 && r.right <= 320), 'Long dwarf labels fit near either edge');
      // Real context loss/restoration retains the committed pair.
      await page.evaluate(() => {
        const r = app.renderer, gl = app.rendererId === 'pixi' ? r.app.renderer.gl : r.renderer.getContext();
        window.lostContext = gl.getExtension('WEBGL_lose_context'); lostContext.loseContext();
      });
      await page.waitForFunction(() => app.contextLost);
      await page.evaluate(() => lostContext.restoreContext());
      await page.waitForFunction(() => { if (!app.contextLost) app.renderFrame(); return !app.contextLost && !app.graphicsRecoveryPending; });
      assert.equal(await page.evaluate(() => app.renderer.planets.length), 13);
      if (candidate) {
        const files = candidate;
        await page.route('https://candidate.test/**', async route => {
          const url = new URL(route.request().url());
          const root = url.pathname.startsWith('/asteroids/') ? files.asteroids : files.named;
          const filename = path.join(root, url.pathname.replace(/^\/(asteroids|bodies)\//, ''));
          await route.fulfill({ path: filename, contentType: 'application/json' });
        });
        const asteroidIndex = fs.readdirSync(files.asteroids).find(f => f.startsWith('index-'));
        const pin = ref('https://candidate.test/asteroids/' + asteroidIndex, fs.readFileSync(path.join(files.asteroids, asteroidIndex)));
        const namedBodies = ref('https://candidate.test/bodies/index.json', fs.readFileSync(path.join(files.named, 'index.json')));
        await page.evaluate(async ({ pin, namedBodies }) => { app.jed = 2461000.5; await app.loadCatalog(pin, { namedBodies }); }, { pin, namedBodies });
        await settle(page);
        assert.equal(await page.evaluate(() => app.catalogue.suppressedRows.size), 5);
        assert.equal(await page.evaluate(() => app.activeSession.loader.source.info.counts.discovery_export), 895910);
        assert(await page.evaluate(() => app.catalogue.namedBodies.mapping.members.every(member => {
          const cloud = app.renderer.asteroids;
          const values = app.rendererId === 'pixi' ? cloud.geometry.getBuffer('aClass').data : cloud.geometry.attributes.classId.array;
          return values[member.ordinal] === 9 && app.catalogue.classes[member.ordinal] < 9;
        })), 'All five exact real dwarf instances are masked; raw classes retained');
        for (const member of await page.evaluate(() => app.catalogue.namedBodies.mapping.members)) {
          for (const date of [member.discovery_jd - 1, member.discovery_jd]) {
            await page.evaluate(jd => { app.jed = jd; app.renderFrame(); }, date);
            await page.waitForFunction(jd => { app.renderFrame(); return app.jed === jd && !app.catalogWaiting; }, date);
            assert.equal(await page.evaluate(() => app.renderer.planets.length), 13);
            assert(await page.evaluate(() => app.asteroidsDiscovered === app.activeSession.loader.source.countThrough(app.jed)));
          }
        }
        report.push({ renderer, realCatalogue: pin.sha256, named: namedBodies.sha256 });
      }
      assert.deepEqual(errors, []);
      await page.evaluate(() => app.destroy());
      assert.equal(await page.locator('.orrery-planet-label').count(), 0);
      offline = true;
      await page.reload();
      await page.evaluate(async () => { await namedTest.ready; namedTest.app.jedDelta = 0; namedTest.app.renderFrame(); });
      assert.equal(await page.evaluate(() => namedTest.app.renderer.planets.length), 6, 'Offline startup retains producer-owned baseline');
      await page.evaluate(() => namedTest.app.destroy());
      offline = false;
      report.push({ renderer, cases: 'positions, tracks, labels, clipping, raw counts, suppression, views, switching, failure, stale loads, draw rollback, responsive controls' });
    } catch (error) { error.message += `\nPage errors: ${JSON.stringify(errors)}`; throw error; }
    finally { release?.(); await page.close(); }
  }
  return report;
}
module.exports = { run, build };
if (require.main === module) (async () => {
  const { launchBrowser } = require('./browsers.cjs');
  const browser = await launchBrowser(process.env.NAMED_BROWSER || 'chromium');
  try {
    const candidate = process.env.NAMED_CANDIDATE_ROOT && { named: path.join(process.env.NAMED_CANDIDATE_ROOT, 'candidate'), asteroids: path.join(process.env.NAMED_CANDIDATE_ROOT, 'asteroids') };
    console.log(JSON.stringify(await run({ browser, candidate }), null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
