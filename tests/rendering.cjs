const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const browsers = require('playwright');
const { build, serve } = require('./support.cjs');
const lifecycle = require('./rendering-lifecycle.cjs');
const initialization = require('./initialization.cjs');
const status = require('./status.cjs');
const checkPlanetPhases = require('./planets.cjs');
const checkCPUOrbits = require('./cpu-orbits.cjs');
const checkOrbitTracks = require('./orbit-tracks.cjs');
const readouts = require('./readouts.cjs');
const frameOperations = require('./frame-operations.cjs');
const output = '.context/paused-rendering/checks';
const settle = page => page.evaluate(async () => {
  for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
});
const snapshot = page => page.evaluate(() => ({ draws: fixture.probe.draws, updates: fixture.probe.updates,
  jed: fixture.app.jed, elapsed: fixture.app.elapsed, pending: fixture.app.animationFrame }));
async function idle(page) {
  await settle(page);
  const before = await snapshot(page);
  await page.waitForTimeout(180);
  assert.deepEqual(await snapshot(page), before, 'Paused scene has zero recurring renderer draws/updates and both clocks freeze');
  assert.equal(before.pending, null);
  assert.equal(await page.locator('#orrery-fps').textContent(), '0 FPS');
  return before;
}
async function speed(page, value) {
  const input = page.getByRole('textbox', { name: 'Playback speed' });
  await input.fill(String(value));
  assert(await input.evaluate(el => el === document.activeElement), 'Speed input receives keyboard focus');
  await input.press('Enter');
}
async function pause(page) { await speed(page, 0); return idle(page); }

async function paused(page) {
  const initial = await idle(page);
  assert(initial.draws > 0, 'Initial speed zero paints the loaded scene');
  assert.equal(initial.elapsed, 0);
  const before = await page.evaluate(() => {
    const {app, probe} = fixture, draws = probe.draws;
    app.jed = 2458600.5;
    for (let i = 0; i < 10; i++) app.requestRender();
    return draws;
  });
  await settle(page);
  assert.equal((await snapshot(page)).draws, before + 1, 'Synchronous date/request invalidations coalesce');
  assert.equal(await page.locator('#orrery-count').textContent(), '100000');
  assert.equal(await page.locator('#orrery-date').textContent(), '2019-04-27');
  for (const value of [1.5, -1.5]) {
    const stopped = await idle(page);
    await speed(page, value);
    await page.waitForFunction(n => fixture.probe.draws >= n + 3, stopped.draws);
    const resumed = await snapshot(page);
    const first = await page.evaluate(n => fixture.probe.frames[n], stopped.draws);
    assert.deepEqual(first, { jed: stopped.jed, elapsed: stopped.elapsed }, 'First resumed frame excludes all inactive time');
    assert(value > 0 ? resumed.jed > stopped.jed : resumed.jed < stopped.jed);
    assert(resumed.elapsed > stopped.elapsed);
    await pause(page);
  }
  const slider = page.locator('.dg .slider'), box = await slider.boundingBox();
  await slider.click({ position: { x: box.width * 0.7, y: box.height / 2 } });
  await page.waitForFunction(() => fixture.app.jedDelta > 0 && fixture.app.animationFrame !== null);
  await pause(page);
  return { initialPause: 'passed', recurringIdleDraws: 0, coalescedDraws: 1, forwardReverse: 'passed' };
}

async function invalidations(page) {
  await page.evaluate(() => {
    fixture.probe.capture = true;
    fixture.saved = fixture.app.asteroids;
    fixture.app.setAsteroids([]);
  });
  await idle(page);
  assert.equal(await page.locator('#orrery-count').textContent(), '0');
  const emptyImage = await page.evaluate(() => fixture.probe.image);
  await page.evaluate(() => fixture.app.loadAsteroids(fixture.catalogURL));
  await idle(page);
  assert.equal(await page.locator('#orrery-count').textContent(), '100000');
  assert.notEqual(await page.evaluate(() => fixture.probe.image), emptyImage, 'Successful replacement repaints pixels');
  const invalid = await page.evaluate(() => {
    const {app, probe} = fixture, previous = app.asteroids, draws = probe.draws;
    let rejected = false; try { app.setAsteroids([{ e: 2 }]); } catch { rejected = true; }
    return { rejected, preserved: previous === app.asteroids, draws, pending: app.animationFrame };
  });
  assert(invalid.rejected && invalid.preserved); assert.equal(invalid.pending, null);
  assert.equal((await idle(page)).draws, invalid.draws, 'Invalid replacement leaves the working scene idle');
  const image = await page.evaluate(() => fixture.probe.image);
  await page.mouse.move(600, 400); await page.mouse.wheel(0, -100);
  await page.waitForFunction(before => fixture.probe.image !== before, image);
  await idle(page);
  await page.evaluate(() => { fixture.app.stage.position.x += 17; fixture.app.stage.position.y -= 23; });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => fixture.app.viewWidth === 390);
  await idle(page);
  assert.deepEqual(await page.evaluate(() => [fixture.app.stage.x, fixture.app.stage.y]), [212, 399], 'Resize preserves CSS-pixel centering and pan');
  assert.deepEqual(await page.locator('canvas').evaluate(el => [el.width, el.height]), [390, 844]);
  return { emptyFullInvalid: 'passed', wheelAndResize: 'passed' };
}

async function dpr(page, browserName) {
  if (browserName !== 'chromium') return 'DPR2 covered by production/GPU contexts; same-page DPR emulation requires CDP';
  const session = await page.context().newCDPSession(page);
  try {
    const results = [];
    // Real media-query changes at fixed viewport dimensions, in both directions.
    await page.evaluate(() => { window.resizeEvents = 0; window.addEventListener('resize', () => window.resizeEvents++); });
    for (const value of [2, 1, 2]) {
      const before = await snapshot(page);
      await session.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: value, mobile: false });
      // CDP changes devicePixelRatio without notifying existing media queries.
      // Refresh emulated media so the browser delivers its native change event;
      // do not call Orrery's resize/invalidation methods from the test.
      await session.send('Emulation.setEmulatedMedia', { media: value === 2 ? 'screen' : '' });
      await page.waitForFunction(r => fixture.app.app.renderer.resolution === r, value);
      const after = await idle(page);
      assert(after.draws > before.draws);
      assert.deepEqual(await page.locator('canvas').evaluate(el => [el.width, el.height]), [390 * value, 844 * value]);
      assert.deepEqual(await page.evaluate(() => [fixture.app.stage.x, fixture.app.stage.y]), [212, 399]);
      results.push({ dpr: value, draws: after.draws - before.draws });
    }
    assert.equal(await page.evaluate(() => window.resizeEvents), 0, 'DPR-only changes wake rendering without a resize event');
    return results;
  } finally { await session.detach(); }
}

async function loading(page, url) {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route('**/data/catalog.json', async route => { await gate; await route.continue().catch(() => {}); });
  try {
    await page.goto(url + '/?speed=1.5', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => window.initialized);
    const paused = await pause(page);
    assert.match(await page.locator('#orrery-status').textContent(), /Loading/);
    assert.equal(await page.locator('#orrery-count').textContent(), '0');
    release(); await page.evaluate(() => window.ready);
    const loaded = await idle(page);
    assert(loaded.draws > paused.draws, 'Delayed catalogue triggers a real paused repaint');
    assert.equal(loaded.jed, paused.jed); assert.equal(loaded.elapsed, paused.elapsed);
    assert(Number(await page.locator('#orrery-count').textContent()) > 0);
    assert.equal(await page.locator('#orrery-status').textContent(), '');
    // Scene population can also happen after the initial empty scene settled.
    await page.unroute('**/data/catalog.json');
    await page.goto(url + '/?empty'); await page.evaluate(() => window.ready);
    const empty = await idle(page);
    await page.evaluate(() => fixture.app.addPlanets(fixture.planets));
    assert.equal((await idle(page)).draws, empty.draws + 1, 'Late planet addition invalidates initial pause');
    return 'initial pause, pause during fetch and late planets passed';
  } finally { release(); await page.unroute('**/data/catalog.json'); }
}

async function markers(page, url) {
  await page.goto(url + '/?empty'); await page.evaluate(() => window.ready);
  await page.evaluate(() => {
    const {app, probe} = fixture;
    app.stage.children.forEach(c => { c.visible = false; });
    app.stage.scale.set(12);
    app.setAsteroids([{ a: 0.1, e: 0, i: 0, W: 0, wbar: 0, M: 35, n: 1, epoch: app.jed, disc: app.jed - 10000 }]);
    probe.capture = true;
  });
  const fresh = await idle(page);
  const freshPixels = await page.evaluate(() => ({ ...fixture.probe.pixels, image: fixture.probe.image }));
  assert(freshPixels.green > 0);
  await speed(page, 1.5);
  await page.waitForFunction(() => fixture.app.elapsed >= 1 / 3);
  const halfway = await pause(page);
  assert(halfway.elapsed < 2 / 3, 'Pause catches marker mid-shrink');
  const halfPixels = await page.evaluate(() => ({ ...fixture.probe.pixels, image: fixture.probe.image }));
  assert(halfPixels.green < freshPixels.green && halfPixels.green > 0, 'Marker shrinks during active time');
  await page.waitForTimeout(750);
  await page.evaluate(() => fixture.app.requestRender());
  const still = await idle(page);
  assert.equal(still.elapsed, halfway.elapsed);
  assert.equal(await page.evaluate(() => fixture.probe.image), halfPixels.image, 'A paused redraw does not age green marker pixels');
  await speed(page, -1.5);
  await page.waitForFunction(() => fixture.app.elapsed >= 2 / 3 + 0.02);
  const mature = await pause(page);
  assert.deepEqual(await page.evaluate(n => fixture.probe.frames[n], still.draws), { jed: still.jed, elapsed: still.elapsed });
  const oldPixels = await page.evaluate(() => fixture.probe.pixels);
  assert.equal(oldPixels.green, 0); assert(oldPixels.gray > 0);
  return { fresh: { elapsed: fresh.elapsed, green: freshPixels.green }, halfway: { elapsed: halfway.elapsed, green: halfPixels.green }, mature: { elapsed: mature.elapsed, ...oldPixels } };
}

async function main() {
  await build('./tests/rendering-fixture.js', path.join(output, 'fixture'));
  await build('./src/js/index.js', path.join(output, 'production'));
  await build('./tests/init-fixture.js', path.join(output, 'init'));
  const server = await serve(output), report = [];
  const fixtureURL = server.url + '/fixture';
  try {
    for (const name of (process.env.BROWSERS || 'chromium').split(',')) {
      const browser = await browsers[name].launch({ ...(name === 'chromium' ? { channel: 'chrome' } : {}) });
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const errors = [];
        page.on('pageerror', e => errors.push(e.message));
        page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
        await page.goto(fixtureURL + '/'); await page.evaluate(() => window.ready);
        const sharedFrames = await frameOperations.frames(page);
        const readoutBoundaries = await readouts.boundaries(page);
        const planetPhases = await checkPlanetPhases(page);
        const cpuOrbits = await checkCPUOrbits(page);
        const orbitTracks = await checkOrbitTracks(page);
        await page.reload(); await page.evaluate(() => window.ready);
        const sharedFramesAfterReload = await frameOperations.frames(page);
        const readoutsAfterReload = await readouts.boundaries(page);
        const planetPhasesAfterReload = await checkPlanetPhases(page);
        const cpuOrbitsAfterReload = await checkCPUOrbits(page);
        const orbitTracksAfterReload = await checkOrbitTracks(page);
        const result = { browser: name, version: browser.version(), sharedFrames, sharedFramesAfterReload, readoutBoundaries, readoutsAfterReload, planetPhases, planetPhasesAfterReload,
          cpuOrbits, cpuOrbitsAfterReload, orbitTracks, orbitTracksAfterReload, paused: await paused(page),
          invalidations: await invalidations(page), dpr: await dpr(page, name),
          loading: await loading(page, fixtureURL), markers: await markers(page, fixtureURL) };
        await page.goto(fixtureURL + '/'); await page.evaluate(() => window.ready);
        result.visibility = await lifecycle.visibility(page);
        result.recovery = await lifecycle.recovery(page);
        result.disposal = await lifecycle.disposal(page, server.url);
        await page.goto(fixtureURL + '/?manual'); await page.evaluate(() => window.ready);
        result.manualRecovery = await lifecycle.recovery(page, { manual: true });
        result.manualDisposal = await lifecycle.disposal(page, server.url);
        result.productionReadouts = await readouts.production(page, server.url + '/production/');
        result.production = await lifecycle.production(browser, server.url + '/production/', output, name);
        await page.goto(server.url + '/init/');
        result.initialization = await initialization(page);
        result.readoutLifetimes = await readouts.lifetimes(page);
        result.status = await status(browser, server.url + '/production/', output, name);
        assert.deepEqual(errors, [], 'No browser, shader or WebGL errors');
        report.push(result); console.log(JSON.stringify(result));
      } finally { await browser.close(); }
    }
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  } finally { await server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
