const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright");
const { build, serve } = require("../tests/support.cjs");

async function sample({ count, warmupMs, sampleMs }) {
  const { app, catalog, timings } = window.fixture;
  const data = Array.from({ length: count }, (_, i) => catalog[i % catalog.length]);
  const setupStart = performance.now();
  app.setAsteroids(data);
  const setupMs = performance.now() - setupStart;
  // Settle discovery marks outside the measured interval.
  app.elapsed += 1;
  app.asteroids.update(app.jed, app.elapsed);
  const gl = app.app.renderer.gl;
  const debug = gl.getExtension("WEBGL_debug_renderer_info");
  const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  const intervals = [], ticks = [], renders = [], uploads = [];
  let bytes = 0, interrupted = false;
  const bufferSubData = gl.bufferSubData;
  gl.bufferSubData = function(target, offset, data, srcOffset = 0, length) {
    if (target === gl.ARRAY_BUFFER) bytes += (length ?? (data.length - srcOffset)) * data.BYTES_PER_ELEMENT;
    return bufferSubData.apply(this, arguments);
  };
  const interrupt = () => { interrupted = true; };
  for (const event of ["resize", "blur"]) window.addEventListener(event, interrupt);
  document.addEventListener("visibilitychange", interrupt);
  app.canvas.addEventListener("webglcontextlost", interrupt);
  const dimensions = [innerWidth, innerHeight, devicePixelRatio, app.canvas.width, app.canvas.height];
  const start = performance.now();
  let previous = null;
  app.clock.reset();
  await new Promise(resolve => {
    function frame(now) {
      const dt = previous === null ? 0 : now - previous;
      previous = now;
      app.jedDelta = 1.5;
      // Match the dated view even when a slow frame hits the clock cap.
      app.jed = 2458600.5 + (now - start) * 0.09 - Math.min(dt, 250) * 0.09;
      bytes = 0;
      const t = performance.now();
      app.tick({ lastTime: now });
      const r = performance.now();
      app.app.render();
      const end = performance.now();
      if (now - start >= warmupMs) {
        intervals.push(dt); ticks.push(r - t); renders.push(end - r); uploads.push(bytes);
      }
      if (now - start < warmupMs + sampleMs) requestAnimationFrame(frame);
      else resolve();
    }
    requestAnimationFrame(frame);
  });
  gl.bufferSubData = bufferSubData;
  for (const event of ["resize", "blur"]) window.removeEventListener(event, interrupt);
  document.removeEventListener("visibilitychange", interrupt);
  app.canvas.removeEventListener("webglcontextlost", interrupt);
  if (interrupted || document.hidden || gl.isContextLost() || dimensions.some((v, i) => v !== [innerWidth, innerHeight, devicePixelRatio, app.canvas.width, app.canvas.height][i])) throw new Error("Benchmark interrupted or resolution changed; discard this run");
  const stats = values => {
    const sorted = values.slice().sort((a, b) => a - b);
    return { mean: values.reduce((a, b) => a + b, 0) / values.length,
      p50: sorted[Math.floor(sorted.length * 0.5)], p95: sorted[Math.floor(sorted.length * 0.95)], p99: sorted[Math.floor(sorted.length * 0.99)] };
  };
  const frames = stats(intervals);
  const rebaseStart = performance.now();
  app.asteroids.update(app.jed + 257, app.elapsed);
  const rebaseCpuMs = performance.now() - rebaseStart;
  app.asteroids.update(app.jed, app.elapsed);
  app.app.render();
  const visible = app.asteroidsDiscovered;
  if (visible !== count) throw new Error(`Expected ${count} visible, got ${visible}`);
  return { count, synthetic: count > catalog.length, gpu, timings, setupMs,
    rebaseCpuMs, frames: intervals.length, frameMs: frames, fps: 1000 / frames.mean,
    tickMs: stats(ticks), renderSubmitMs: stats(renders), arrayUploadBytes: stats(uploads),
    heapBytes: performance.memory?.usedJSHeapSize ?? null, intervals };
}

async function main() {
  const output = path.resolve(process.env.OUTPUT || ".context/gpu-orbits/benchmark");
  const bundle = process.env.BUNDLE || path.join(output, "app");
  fs.mkdirSync(output, { recursive: true });
  if (!process.env.BUNDLE) await build("./tests/fixture.js", bundle);
  const server = await serve(bundle);
  const browser = await chromium.launch({ channel: "chrome", headless: process.env.HEADLESS !== "0", args: ["--enable-precise-memory-info"] });
  const report = { complete: false, recordedAt: new Date().toISOString(), revision: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    label: process.env.LABEL || "working-tree", browser: browser.version(),
    catalogSHA256: crypto.createHash("sha256").update(fs.readFileSync("data/catalog.json")).digest("hex"),
    viewport: { width: 1280, height: 800 }, dpr: 1, jed: 2458600.5, daysPerSecond: 90,
    warmupMs: 3000, sampleMs: 5000, headless: process.env.HEADLESS !== "0", runs: [] };
  try {
    for (const count of (process.env.COUNTS || "100000,1000000").split(",").map(Number)) {
      for (let repetition = 0; repetition < Number(process.env.REPEATS || 3); repetition++) {
        const page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: report.dpr });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
        await page.goto(server.url);
        await page.evaluate(() => window.ready);
        const result = await page.evaluate(sample, { count, warmupMs: report.warmupMs, sampleMs: report.sampleMs });
        if (errors.length) throw new Error(errors.join("\n"));
        await page.screenshot({ path: path.join(output, `${count}-${repetition}.png`) });
        report.runs.push({ repetition, ...result });
        fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
        console.log(JSON.stringify({ repetition, ...result, intervals: undefined }));
        await page.close();
      }
    }
    report.complete = true;
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
  } finally { await browser.close(); await server.close(); }
}
module.exports = { sample };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
