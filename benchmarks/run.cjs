const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { launchOptions } = require("../tests/browsers.cjs");
const { build, serve } = require("../tests/support.cjs");
const { checkoutSource, fingerprints, recordSource, bundleSource } = require("./provenance.cjs");

async function sample({ count, warmupMs, sampleMs, dpr = 1 }) {
  const { app, catalog, timings } = window.fixture;
  if (app.autoRender || app.app.ticker.started || app.animationFrame !== null) {
    throw new Error("Benchmark requires explicit manual scheduling (autoRender: false)");
  }
  if (!app.initialized || app.destroyed || document.hidden || app.contextLost) {
    throw new Error("Benchmark requires a visible, initialized app with a working graphics context");
  }
  const resolution = { requested: dpr, native: devicePixelRatio, renderer: app.app.renderer.resolution,
    canvas: [app.canvas.width, app.canvas.height],
    buffer: [app.app.renderer.gl.drawingBufferWidth, app.app.renderer.gl.drawingBufferHeight] };
  if (resolution.native !== dpr || resolution.renderer !== dpr
    || [...resolution.canvas, ...resolution.buffer].some((value, i) => value !== Math.round((i % 2 ? innerHeight : innerWidth) * dpr))) {
    throw new Error("Benchmark requested/native/renderer/buffer resolution mismatch");
  }
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
  let bytes = 0, interrupted = false, rejectSample;
  const bufferSubData = gl.bufferSubData;
  gl.bufferSubData = function(target, offset, data, srcOffset = 0, length) {
    if (target === gl.ARRAY_BUFFER) bytes += (length ?? (data.length - srcOffset)) * data.BYTES_PER_ELEMENT;
    return bufferSubData.apply(this, arguments);
  };
  const interrupt = () => {
    interrupted = true;
    // A hidden tab may stop delivering RAF altogether. Settle now so finally
    // can restore the upload hook and release the caller-owned frame/listeners.
    rejectSample?.(new Error("Benchmark interrupted or resolution changed; discard this run"));
  };
  for (const event of ["resize", "blur"]) window.addEventListener(event, interrupt);
  document.addEventListener("visibilitychange", interrupt);
  app.canvas.addEventListener("webglcontextlost", interrupt);
  const dimensions = [innerWidth, innerHeight, devicePixelRatio, app.app.renderer.resolution, app.canvas.width, app.canvas.height];
  const start = performance.now();
  let previous = null;
  let animationFrame;
  try {
    app.clock.reset();
    await new Promise((resolve, reject) => {
      rejectSample = reject;
      function frame(now) {
        try {
          const dt = previous === null ? 0 : now - previous;
          previous = now;
          app.jedDelta = 1.5;
          // Match the dated view even when a slow frame hits the clock cap.
          app.jed = 2458600.5 + (now - start) * 0.09 - Math.min(dt, 250) * 0.09;
          bytes = 0;
          const t = performance.now();
          let r, end;
          app.renderFrame(now, {
            beforeRender: () => { r = performance.now(); },
            afterRender: () => { end = performance.now(); },
          });
          if (now - start >= warmupMs) {
            intervals.push(dt); ticks.push(r - t); renders.push(end - r); uploads.push(bytes);
          }
          if (now - start < warmupMs + sampleMs) animationFrame = requestAnimationFrame(frame);
          else resolve();
        } catch (error) { reject(error); }
      }
      animationFrame = requestAnimationFrame(frame);
    });
  } finally {
    cancelAnimationFrame(animationFrame);
    gl.bufferSubData = bufferSubData;
    for (const event of ["resize", "blur"]) window.removeEventListener(event, interrupt);
    document.removeEventListener("visibilitychange", interrupt);
    app.canvas.removeEventListener("webglcontextlost", interrupt);
  }
  if (interrupted || document.hidden || gl.isContextLost() || dimensions.some((v, i) => v !== [innerWidth, innerHeight, devicePixelRatio, app.app.renderer.resolution, app.canvas.width, app.canvas.height][i])) throw new Error("Benchmark interrupted or resolution changed; discard this run");
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
  return { application: window.fixture.application ?? "unknown", count, resolution, synthetic: count > catalog.length, gpu, timings, setupMs,
    rebaseCpuMs, frames: intervals.length, frameMs: frames, fps: 1000 / frames.mean,
    tickMs: stats(ticks), renderSubmitMs: stats(renders), arrayUploadBytes: stats(uploads),
    heapBytes: performance.memory?.usedJSHeapSize ?? null, intervals };
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${name} must be a positive safe integer.`);
  return number;
}

async function main() {
  const output = path.resolve(process.env.OUTPUT || ".context/gpu-orbits/benchmark");
  const bundle = process.env.BUNDLE || path.join(output, "app");
  fs.mkdirSync(output, { recursive: true });
  let browser, server;
  const report = { complete: false, recordedAt: new Date().toISOString(),
    label: process.env.LABEL || "benchmark", browser: null,
    viewport: { width: 1280, height: 800 }, dpr: 1, jed: 2458600.5, daysPerSecond: 90,
    warmupMs: 3000, sampleMs: 5000, headless: process.env.HEADLESS !== "0", runs: [] };
  try {
    const counts = (process.env.COUNTS ?? "100000,1000000").split(",").map(value => positiveInteger(value, "COUNTS entry"));
    const repeats = positiveInteger(process.env.REPEATS ?? "3", "REPEATS");
    Object.assign(report, { counts, repeats });
    const runnerSource = await checkoutSource();
    report.runnerRevision = runnerSource.revision;
    if (!process.env.BUNDLE) {
      await build("./tests/fixture.js", bundle);
      // Do not claim a revision if the checkout changed while webpack ran.
      const stable = JSON.stringify(runnerSource) === JSON.stringify(await checkoutSource());
      recordSource(bundle, stable ? runnerSource : {});
    }
    const source = bundleSource(bundle);
    Object.assign(report, source);
    server = await serve(bundle);
    const browserOptions = launchOptions("chromium");
    report.headless = browserOptions.headless;
    browser = await chromium.launch({ ...browserOptions, args: [...(browserOptions.args || []), "--enable-precise-memory-info"] });
    report.browser = browser.version();
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
    for (const count of counts) {
      for (let repetition = 0; repetition < repeats; repetition++) {
        const page = await browser.newPage({ viewport: report.viewport, deviceScaleFactor: report.dpr });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
        await page.goto(`${server.url}/?resolution=${report.dpr}`);
        await page.evaluate(() => window.ready);
        const application = await page.evaluate(() => fixture.application ?? "unknown");
        if (report.application && report.application !== application) throw new Error("Benchmark application changed between runs");
        report.application = application;
        const result = await page.evaluate(sample, { count, warmupMs: report.warmupMs, sampleMs: report.sampleMs, dpr: report.dpr });
        if (errors.length) throw new Error(errors.join("\n"));
        await page.screenshot({ path: path.join(output, `${count}-${repetition}.png`) });
        report.runs.push({ repetition, ...result });
        fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
        console.log(JSON.stringify({ repetition, ...result, intervals: undefined }));
        await page.close();
      }
    }
    const final = fingerprints(bundle);
    if (Object.keys(final).some(key => final[key] !== source[key])) throw new Error("Served bundle changed during the benchmark; discard this run");
    report.complete = true;
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    await browser?.close();
    await server?.close();
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
  }
}
module.exports = { sample };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
