const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { serve } = require('./support.cjs');
const loading = require('./catalog-loading.cjs');

const latestOrigin = loading.latestOrigin;
const START = 2451544.5;
const INTERMEDIATE = 2452261.5;
const LATEST = 2458847.5;
const REFERENCE = 2458600.5;

function cloudState() {
  const app = window.catalogTest.app, cloud = app.renderer.asteroids;
  if (app.rendererId === 'pixi') {
    return { renderer: 'pixi', count: cloud.geometry.instanceCount,
      baseline: Array.from(cloud.geometry.getBuffer('aDiscovery').data.slice(0, cloud.geometry.instanceCount)) };
  }
  return { renderer: 'three', count: cloud.geometry.drawRange.count,
    baseline: cloud.uniforms.discoveryBaseline.value,
    time: cloud.uniforms.discoveryTime.value };
}

async function checkBusyAnnouncement(page, expected) {
  const status = page.locator('#orrery-status');
  assert.deepEqual(await status.evaluate(element => {
    const visual = element.querySelector('.orrery-status-visual');
    const announcement = element.querySelector('.orrery-status-announcement');
    return { role: element.getAttribute('role'), label: element.getAttribute('aria-label'),
      visualHidden: visual?.getAttribute('aria-hidden'), announcement: announcement?.textContent,
      announcementHidden: announcement?.getAttribute('aria-hidden') };
  }), { role: 'status', label: null, visualHidden: 'true', announcement: expected,
    announcementHidden: null }, 'Busy status exposes stable live-region text outside its hidden visual subtree');
  assert.deepEqual(await page.locator('.orrery-status-announcement').evaluate(element => {
    const style = getComputedStyle(element);
    return { position: style.position, width: style.width, height: style.height,
      overflow: style.overflow, clipPath: style.clipPath, whiteSpace: style.whiteSpace };
  }), { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden',
    clipPath: 'inset(50%)', whiteSpace: 'nowrap' }, 'Live-region announcement stays visually clipped');
  assert.equal(await status.ariaSnapshot(), `- status: ${expected}`,
    'The accessibility tree contains the stable busy announcement without visual progress');
}

async function checkDesktopStatus(page) {
  const layout = await page.evaluate(() => {
    const box = selector => {
      const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { x, y, width, height, right: x + width, bottom: y + height };
    };
    const spinner = document.querySelector('.orrery-status-spinner');
    const pseudo = getComputedStyle(spinner, '::before');
    return { status: box('#orrery-status'), readouts: box('.orrery-readouts'), identity: box('.orrery-identity'),
      overflow: document.documentElement.scrollWidth > innerWidth,
      animation: pseudo.animationName, content: pseudo.content };
  });
  const center = layout.status.x + layout.status.width / 2;
  assert(Math.abs(center - page.viewportSize().width / 2) <= 1, 'Busy status is centered in the desktop footer');
  assert(layout.readouts.right < layout.status.x, 'Desktop status does not overlap the playback readouts');
  assert(layout.status.right < layout.identity.x, 'Desktop status does not overlap the identity');
  assert.equal(layout.overflow, false, 'Desktop footer does not overflow');
  assert.equal(layout.animation, 'orrery-status-spin', 'ASCII loading indicator animates');
  assert.match(layout.content, /\[/, 'ASCII loading indicator supplies a bracketed frame');
  await page.waitForTimeout(225);
  const nextFrame = await page.locator('.orrery-status-spinner').evaluate(element => getComputedStyle(element, '::before').content);
  assert.notEqual(nextFrame, layout.content, 'ASCII loading indicator advances through its character sequence');
}

async function checkNarrowStatus(page) {
  for (const viewport of [{ width: 844, height: 390 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    const layout = await page.evaluate(() => {
      const box = selector => {
        const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
        return { x, y, width, height, right: x + width, bottom: y + height };
      };
      return { status: box('#orrery-status'), readouts: box('.orrery-readouts'), identity: box('.orrery-identity'),
        detailDisplay: getComputedStyle(document.querySelector('.orrery-status-detail')).display,
        overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert(layout.status.bottom <= layout.readouts.y, 'Compact status moves to a row above the playback readouts');
    assert(layout.status.bottom <= layout.identity.y, 'Compact status moves to a row above the identity');
    assert.equal(layout.detailDisplay, 'block', 'Compact progress detail wraps onto its own line');
    assert.equal(layout.overflow, false, 'Compact footer does not overflow');
  }

  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.deepEqual(await page.locator('.orrery-status-spinner').evaluate(element => {
    const style = getComputedStyle(element, '::before');
    return { animation: style.animationName, content: style.content };
  }), { animation: 'none', content: '"[-]"' }, 'Reduced motion uses a static ASCII indicator');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1280, height: 800 });
}

async function runRenderer(context, base, renderer) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const fixture = path.join(__dirname, 'fixtures/browser-v1/ties');
  const latest = JSON.parse(await fs.readFile(path.join(fixture, 'latest.json')));
  const info = JSON.parse(await fs.readFile(path.join(fixture, latest.index.url)));
  const tail = '/' + info.chunks.at(-1).url;
  let releaseTail;
  const tailGate = new Promise(resolve => { releaseTail = resolve; });
  await page.route(latestOrigin + '/**', async route => {
    const source = new URL(route.request().url());
    if (source.pathname.endsWith(tail)) await tailGate;
    const response = await route.fetch({ url: base + source.pathname + source.search });
    await route.fulfill({ response, headers: { ...response.headers(), 'access-control-allow-origin': '*' } });
  });
  try {
    await page.goto(`${base}/catalog-latest/?renderer=${renderer}`);
    await page.waitForFunction(() => window.catalogTest?.app.catalogLoader?.sceneComplete()
      && window.catalogTest.app.asteroidsDiscovered === 4);
    await page.evaluate(() => {
      const app = window.catalogTest.app;
      app.autoRender = false;
      app.cancelRender();
    });
    const committed = await page.evaluate(() => {
      const app = window.catalogTest.app;
      return { jed: app.jed, count: app.asteroidsDiscovered, frame: app.renderer.frameState };
    });
    assert.equal(committed.jed, START);
    assert.equal(committed.count, 4);

    // Exercise the actual date control. The final chunk remains unavailable, so
    // the old scene and readouts must remain authoritative while the target is named.
    await page.locator('#orrery-date').click();
    await page.getByLabel('UTC date').fill('2019-12-30');
    await page.getByRole('button', { name: 'jump', exact: true }).click();
    await page.locator('.orrery-status-label').filter({ hasText: 'Buffering asteroids…' }).waitFor();
    assert.equal(await page.locator('.orrery-status-detail').textContent(), '2019-12-30 · 4 / 6');
    await checkBusyAnnouncement(page, 'Buffering asteroids for 2019-12-30.');
    assert.equal(await page.locator('.orrery-status-spinner').getAttribute('aria-hidden'), 'true');
    assert.deepEqual(await page.evaluate(() => {
      const app = window.catalogTest.app;
      return { jed: app.jed, count: app.asteroidsDiscovered, date: app.gui.date.textContent,
        countText: app.gui.count.textContent, frame: app.renderer.frameState };
    }), { ...committed, date: '2000-01-01', countText: '4' }, 'Pending seek retains the committed scene and readouts');
    await checkDesktopStatus(page);

    // A newer target supersedes the held request. It is in the same unavailable
    // chunk, allowing the status and eventual commit winner to be observed.
    await page.evaluate(target => { window.catalogTest.app.jed = target; }, INTERMEDIATE);
    await page.waitForFunction(() => document.querySelector('.orrery-status-detail')?.textContent.includes('2001-12-18'));
    assert.equal(await page.locator('.orrery-status-detail').textContent(), '2001-12-18 · 4 / 5');
    await checkBusyAnnouncement(page, 'Buffering asteroids for 2001-12-18.');
    await page.locator('.orrery-status-detail').evaluate(element => {
      element.textContent = '2026-09-17 · 381\u202f420 / 895\u202f910';
    });
    assert.equal(await page.locator('#orrery-status').ariaSnapshot(),
      '- status: Buffering asteroids for 2001-12-18.',
      'Visual progress changes do not replace the stable live-region announcement');
    await page.setViewportSize({ width: 861, height: 568 });
    await checkDesktopStatus(page);
    await checkNarrowStatus(page);

    const activeRenderer = renderer === 'pixi' ? 'three' : 'pixi';
    assert.equal(await page.evaluate(id => catalogTest.app.switchRenderer(id), activeRenderer), true);
    assert.deepEqual(await page.evaluate(() => ({ renderer: catalogTest.app.rendererId, jed: catalogTest.app.jed,
      count: catalogTest.app.asteroidsDiscovered, pending: catalogTest.app.pendingSeek?.target,
      requested: catalogTest.app.requestedJed })), {
      renderer: activeRenderer, jed: START, count: 4, pending: INTERMEDIATE, requested: INTERMEDIATE,
    }, 'Renderer switching preserves the old committed frame and pending seek owner');
    assert.equal(await page.locator('.orrery-status-detail').textContent(), '2001-12-18 · 4 / 5');

    assert.deepEqual(await page.evaluate(() => {
      const app = window.catalogTest.app;
      app.onGraphicsState(true);
      const lost = { contextLost: app.contextLost, jed: app.jed, count: app.asteroidsDiscovered,
        pending: app.pendingSeek?.target, requested: app.requestedJed };
      app.onGraphicsState(false);
      return { lost, contextLost: app.contextLost, recovering: app.graphicsRecoveryPending,
        pending: app.pendingSeek?.target, requested: app.requestedJed };
    }), {
      lost: { contextLost: true, jed: START, count: 4, pending: INTERMEDIATE, requested: INTERMEDIATE },
      contextLost: false, recovering: true, pending: INTERMEDIATE, requested: INTERMEDIATE,
    }, 'Graphics recovery preserves the pending seek and committed readouts');
    assert.equal(await page.locator('.orrery-status-label').textContent(), 'Restoring the visualization…');
    await checkBusyAnnouncement(page, 'Restoring the visualization…');

    releaseTail();
    await page.evaluate(() => {
      const app = window.catalogTest.app;
      app.autoRender = true;
      app.requestRender();
    });
    await page.waitForFunction(target => {
      const app = window.catalogTest.app;
      return app.jed === target && app.asteroidsDiscovered === 5 && !app.pendingSeek;
    }, INTERMEDIATE);
    assert.equal(await page.locator('#orrery-date').textContent(), '2001-12-18');
    assert.equal(await page.locator('#orrery-count').textContent(), '5');
    assert.equal(await page.locator('#orrery-status').textContent(), '');
    const initialBaseline = await page.evaluate(cloudState);
    if (activeRenderer === 'pixi') assert(initialBaseline.baseline.every(value => value === -1), 'Target-date Pixi history is mature');
    else {
      assert.equal(initialBaseline.baseline, INTERMEDIATE - REFERENCE, 'Target-date Three history is mature');
      assert.equal(initialBaseline.time, INTERMEDIATE - REFERENCE);
    }

    // A rejected cached seek restores the mature baseline as well as date/count.
    const rollback = await page.evaluate(target => {
      const app = window.catalogTest.app, before = window.cloudStateForTest();
      app.autoRender = false;
      app.cancelRender();
      app.jed = target;
      const render = app.renderer.render;
      app.renderer.render = () => null;
      app.renderFrame(2000);
      app.renderer.render = render;
      return { jed: app.jed, count: app.asteroidsDiscovered, pending: app.pendingSeek?.target,
        before, after: window.cloudStateForTest() };
    }, LATEST);
    assert.equal(rollback.jed, INTERMEDIATE);
    assert.equal(rollback.count, 5);
    assert.equal(rollback.pending, LATEST);
    assert.deepEqual(rollback.after, rollback.before, 'Rejected seek restores renderer discovery state');
    await page.evaluate(() => window.catalogTest.app.renderFrame(2100));
    assert.deepEqual(await page.evaluate(() => ({ jed: catalogTest.app.jed, count: catalogTest.app.asteroidsDiscovered,
      pending: catalogTest.app.pendingSeek, cloud: window.cloudStateForTest() })), {
      jed: LATEST, count: 6, pending: null,
      cloud: activeRenderer === 'pixi'
        ? { renderer: 'pixi', count: 6, baseline: [-1, -1, -1, -1, -1, -1] }
        : { renderer: 'three', count: 6, baseline: LATEST - REFERENCE, time: LATEST - REFERENCE },
    }, 'Successful retry atomically commits a mature target scene');

    // Explicit jumps establish baselines; ordinary reverse/forward playback
    // still crosses and highlights discoveries again.
    const replay = await page.evaluate(({ target, start }) => {
      const app = window.catalogTest.app;
      let timestamp = 3000, reverseFrames = 0, forwardFrames = 0;
      app.jedDelta = -8;
      app.resetClock();
      app.renderFrame(timestamp);
      while (app.jed >= start && reverseFrames++ < 100) app.renderFrame(timestamp += 250);
      const reversed = window.cloudStateForTest();
      app.jedDelta = 8;
      app.resetClock();
      app.renderFrame(timestamp += 250);
      while (app.jed < target && forwardFrames++ < 100) app.renderFrame(timestamp += 250);
      app.jedDelta = 0;
      return { reversed, forward: window.cloudStateForTest(), reverseFrames, forwardFrames, jed: app.jed };
    }, { target: LATEST, start: START });
    assert(replay.reversed.count < 6 && replay.forward.count === 6 && replay.jed >= LATEST,
      'Ordinary playback crosses the hidden discoveries in both directions');
    if (activeRenderer === 'pixi') {
      assert(replay.forward.baseline.some(value => value >= 0), 'Pixi replays discovery markers after rewinding');
    } else {
      assert(replay.forward.baseline < INTERMEDIATE - REFERENCE,
        'Three lowers its mature cutoff while rewinding so later crossings replay');
      assert(replay.forward.time > replay.forward.baseline);
    }

    // Switching renderer is a mode restoration, not a mass discovery event.
    assert.equal(await page.evaluate(id => catalogTest.app.switchRenderer(id), renderer), true);
    const switched = await page.evaluate(() => ({ jed: catalogTest.app.jed, count: catalogTest.app.asteroidsDiscovered,
      renderer: catalogTest.app.rendererId, cloud: window.cloudStateForTest() }));
    assert.equal(switched.renderer, renderer);
    assert.equal(switched.count, 6);
    if (renderer === 'pixi') assert(switched.cloud.baseline.every(value => value === -1), 'Pixi switch restoration is mature');
    else assert.equal(switched.cloud.baseline, switched.jed - REFERENCE, 'Three switch restoration is mature');
    await page.evaluate(() => window.catalogTest.app.setStatus('Preparing asteroids…', false, {
      busy: true, detail: '2026-09-17 · 381\u202f420 / 895\u202f910',
      announcement: 'Preparing asteroids for 2026-09-17.',
    }));
    await checkBusyAnnouncement(page, 'Preparing asteroids for 2026-09-17.');
    await page.evaluate(() => window.catalogTest.app.destroy());
    assert.deepEqual(await page.locator('#orrery-status').evaluate(element => ({
      text: element.textContent, label: element.getAttribute('aria-label'), role: element.getAttribute('role'),
    })), { text: '', label: null, role: 'status' }, 'Teardown clears busy status semantics');
    assert.equal(await page.locator('canvas, .orrery-options').count(), 0);
    assert.deepEqual(errors, []);
    return { renderer, newerSeekWins: true, pendingSwitch: activeRenderer,
      rollback: true, replay: true, switched: renderer };
  } finally {
    releaseTail();
    await page.close();
  }
}

async function run({ browser, name, output = '.context/date-seek' }) {
  output = path.resolve(output);
  await fs.mkdir(output, { recursive: true });
  const site = output + '-site';
  if (process.env.ORRERY_PREBUILT_FIXTURES) require('./fixture-builds.cjs').copyPrepared('catalog', site);
  else await loading.build(site);
  const server = await serve(site);
  const results = [];
  try {
    for (const renderer of ['pixi', 'three']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
      await context.addInitScript(() => {
        window.cloudStateForTest = () => {
          const app = window.catalogTest.app, cloud = app.renderer.asteroids;
          if (app.rendererId === 'pixi') {
            return { renderer: 'pixi', count: cloud.geometry.instanceCount,
              baseline: Array.from(cloud.geometry.getBuffer('aDiscovery').data.slice(0, cloud.geometry.instanceCount)) };
          }
          return { renderer: 'three', count: cloud.geometry.drawRange.count,
            baseline: cloud.uniforms.discoveryBaseline.value,
            time: cloud.uniforms.discoveryTime.value };
        };
      });
      try { results.push(await runRenderer(context, server.url, renderer)); }
      finally { await context.close(); }
    }
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ browser: name, results }, null, 2) + '\n');
    console.log(`${name}: atomic date seeks, unified status and discovery baselines passed.`);
    return results;
  } finally { await server.close(); }
}

module.exports = { run };
if (require.main === module) require('./standalone.cjs').run(run);
