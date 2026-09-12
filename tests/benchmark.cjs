const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { build, serve } = require("./support.cjs");
const { sample } = require("../benchmarks/run.cjs");

(async () => {
  const directory = ".context/gpu-orbits/benchmark-test";
  await build("./tests/fixture.js", directory);
  const server = await serve(directory);
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    for (const event of [null, "resize", "blur", "visibilitychange"]) {
      const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
      await page.goto(server.url); await page.evaluate(() => window.ready);
      if (event) await page.evaluate(event => {
        requestAnimationFrame(() => requestAnimationFrame(() => {
          (event === "visibilitychange" ? document : window).dispatchEvent(new Event(event));
        }));
      }, event);
      const run = page.evaluate(sample, { count: 100000, warmupMs: 50, sampleMs: 100 });
      if (event) await assert.rejects(run, /interrupted/);
      else assert((await run).frames > 0);
      await page.close();
    }
    console.log("Benchmark accepts stable runs and rejects resize, blur and visibility interruptions.");
  } finally { await browser.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
