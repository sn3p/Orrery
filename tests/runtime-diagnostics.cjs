const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const webpack = require('webpack');
const { serve } = require('./support.cjs');
const { fixtureFiles, producerBase } = require('./default-catalog-route.cjs');

async function run({ browser, name, output = path.resolve('.context/promotion/runtime-diagnostics', name) }) {
  await fs.mkdir(output, { recursive: true });
  const entry = path.join(output, 'entry.js'), site = path.join(output, 'site');
  await fs.writeFile(entry, `import { app, ready } from ${JSON.stringify(path.resolve('src/unified/index.js'))};
    app.jedDelta = 0; window.probe = { app, ready };`);
  const config = await require('../webpack.app.config.cjs')();
  // Development retains Pixi's BindGroup diagnostics; production strips them.
  await new Promise((resolve, reject) => {
    const compiler = webpack({ ...config, mode: 'development', entry, devtool: false,
      output: { ...config.output, path: site }, performance: { hints: false } });
    compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error || new Error(stats.toString('errors-only')));
      else resolve();
    }));
  });
  const server = await serve(site), results = [];
  try {
    for (const renderer of ['pixi', 'three']) {
      const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 2 });
      const errors = [], warnings = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => {
        if (m.type() === 'error') errors.push(m.text());
        if (m.type() === 'warning' && /destroyed while still bound/.test(m.text())) warnings.push(m.text());
      });
      const files = fixtureFiles(), latest = JSON.parse(files.get('latest.json'));
      const info = JSON.parse(files.get(latest.index.url));
      let release;
      const hold = new Promise(resolve => { release = resolve; });
      await page.route(producerBase + '**', async route => {
        const relative = route.request().url().slice(producerBase.length);
        if (relative === info.chunks[1].url) await hold;
        await route.fulfill({ status: 200, contentType: 'application/json', body: files.get(relative) });
      });
      try {
        await page.goto(server.url + '/?renderer=' + renderer);
        await page.waitForFunction(() => window.probe?.app.catalogLoader?.sceneComplete());
        const frozen = await page.evaluate(() => {
          const app = probe.app;
          app.jed = 2444271.5; app.renderFrame();
          app.stats.fps = 60; app.updateGui();
          app.jedDelta = 8;
          return { jed: app.jed, count: app.asteroidsDiscovered };
        });
        await page.waitForFunction(() => probe.app.catalogLoader.buffering);
        assert.equal(await page.locator('#orrery-status').textContent(), 'Buffering asteroids…');
        assert.equal(await page.locator('#orrery-fps').textContent(), '0 FPS');
        assert.deepEqual(await page.evaluate(() => ({ jed: probe.app.jed, count: probe.app.asteroidsDiscovered })), frozen);
        await page.screenshot({ path: path.join(output, renderer + '-buffering.png') });
        release();
        await page.waitForFunction(() => probe.app.jed > 2444272.5 && !probe.app.catalogWaiting);
        await page.waitForFunction(() => probe.app.stats.fps > 0);
        assert.equal(await page.locator('#orrery-status').textContent(), '');
        await page.evaluate(async () => {
          const app = probe.app; app.jedDelta = 0;
          await app.switchRenderer('pixi');
          // Ordinary DPR updates must unbind the old planet texture too.
          for (const ratio of ['2', '1', '2']) { app.pixelRatio = ratio; app.renderFrame(); }
          for (let i = 0; i < 3; i++) {
            await app.switchRenderer('three'); await app.switchRenderer('pixi');
          }
        });
        await page.screenshot({ path: path.join(output, renderer + '-recovered.png') });
        await page.evaluate(() => probe.app.destroy());
        const result = { renderer, bufferingFreezesReadouts: true, resumesWithFPS: true, errors, warnings };
        results.push(result);
        await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
        assert.deepEqual(errors, []);
        assert.deepEqual(warnings, []);
      } finally { release(); await page.close(); }
    }
    console.log(`${name}: buffering recovery, DPR refresh, repeated switching and teardown passed.`);
  } finally { await server.close(); }
}
module.exports = { run };
if (require.main === module) require('./standalone.cjs').run(run);
