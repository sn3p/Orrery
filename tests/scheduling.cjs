const assert = require('node:assert/strict');
const { launchBrowser } = require('./browsers.cjs');
const { build, serve } = require('./support.cjs');

const settle = page => page.evaluate(async () => {
  for (let i = 0; i < 3; i++) await new Promise(requestAnimationFrame);
});

(async () => {
  const output = process.env.ORRERY_TEST_APP === 'unified' ? '.context/pr2/unified-scheduling' : '.context/paused-rendering/scheduling';
  await build('./tests/rendering-fixture.js', output);
  const server = await serve(output);
  const browser = await launchBrowser("chromium");
  try {
    const page = await browser.newPage();
    await page.goto(server.url + '/?speed=1.5'); await page.evaluate(() => window.ready);
    assert.equal(await page.evaluate(() => fixture.app.app.ticker.started), false, 'Pixi automatic ticker stays stopped');
    const before = await page.evaluate(() => fixture.probe.draws);
    await page.waitForFunction(n => fixture.probe.draws >= n + 3, before);
    await page.goto(server.url + '/?manual'); await page.evaluate(() => window.ready);
    await settle(page);
    assert.equal(await page.evaluate(() => fixture.probe.draws), 0, 'Manual bootstrap does not draw');
    await page.evaluate(() => {
      const {app} = fixture;
      app.jed += 1; app.jedDelta = -1.5;
      app.resize(); app.requestRender();
      app.onVisibilityChange();
    });
    await settle(page);
    assert.equal(await page.evaluate(() => fixture.probe.draws), 0, 'Manual state changes do not schedule');
    await page.evaluate(() => fixture.app.render(1000));
    await settle(page);
    assert.equal(await page.evaluate(() => fixture.probe.draws), 1, 'Explicit render draws exactly once');
    assert.equal(await page.evaluate(() => fixture.app.animationFrame), null);
    await page.evaluate(() => {
      const {app} = fixture;
      app.autoRender = true; app.requestRender(); app.destroy(); app.destroy();
    });
    await settle(page);
    assert.equal(await page.evaluate(() => fixture.probe.draws), 1, 'Disposal cancels pending work');
    console.log('Scheduling ownership: continuous RAF, stopped Pixi ticker, manual bootstrap/invalidation/render and disposal passed.');
  } finally { await browser.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
