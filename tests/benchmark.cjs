const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { chromium } = require("playwright");
const { build, serve } = require("./support.cjs");
const { sample } = require("../benchmarks/run.cjs");
const { checkoutSource, recordSource, bundleSource } = require("../benchmarks/provenance.cjs");
const execute = promisify(execFile);
const hash = value => crypto.createHash("sha256").update(value).digest("hex");

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
    for (const method of ["tick", "render"]) {
      const page = await browser.newPage();
      await page.goto(server.url); await page.evaluate(() => window.ready);
      await page.evaluate(method => {
        const { app } = fixture, gl = app.app.renderer.gl;
        const owner = method === "tick" ? app : app.app, original = owner[method];
        const upload = gl.bufferSubData;
        const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
        let listeners = 0, calls = 0;
        const watched = (target, type) => [window, document, app.canvas].includes(target)
          && ["resize", "blur", "visibilitychange", "webglcontextlost"].includes(type);
        EventTarget.prototype.addEventListener = function(type, ...args) {
          if (watched(this, type)) listeners++;
          return add.call(this, type, ...args);
        };
        EventTarget.prototype.removeEventListener = function(type, ...args) {
          if (watched(this, type)) listeners--;
          return remove.call(this, type, ...args);
        };
        owner[method] = () => { calls++; throw new Error(`forced ${method} failure`); };
        window.failureCheck = () => ({ listeners, calls, uploadRestored: gl.bufferSubData === upload });
        window.restoreFailure = () => {
          owner[method] = original;
          EventTarget.prototype.addEventListener = add; EventTarget.prototype.removeEventListener = remove;
        };
      }, method);
      let timer;
      try {
        await assert.rejects(Promise.race([
          page.evaluate(sample, { count: 1000, warmupMs: 0, sampleMs: 50 }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Benchmark hung after a frame error")), 2000); }),
        ]), new RegExp(`forced ${method} failure`));
        await page.waitForTimeout(100);
        assert.deepEqual(await page.evaluate(() => failureCheck()), { listeners: 0, calls: 1, uploadRestored: true });
        await page.evaluate(() => restoreFailure());
        assert((await page.evaluate(sample, { count: 1000, warmupMs: 0, sampleMs: 50 })).frames > 0, "Same page can run after failure");
      } finally { clearTimeout(timer); await page.close(); }
    }
  } finally { await browser.close(); await server.close(); }

  const sourceFixture = path.join(directory, "source-fixture");
  fs.rmSync(sourceFixture, { recursive: true, force: true });
  fs.mkdirSync(sourceFixture, { recursive: true });
  const git = (...args) => execute("git", args, { cwd: sourceFixture });
  await git("init", "--quiet");
  fs.writeFileSync(path.join(sourceFixture, "large.js"), "a".repeat(1200000));
  await git("add", "large.js");
  await git("-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Fixture");
  assert.equal((await checkoutSource(sourceFixture)).sourceDirty, false);
  fs.writeFileSync(path.join(sourceFixture, "large.js"), "b".repeat(1200000));
  const dirty = await checkoutSource(sourceFixture);
  assert.equal(dirty.sourceDirty, true, "Large generated diffs do not exceed a subprocess output limit");
  assert.match(dirty.diffSHA256, /^[a-f0-9]{64}$/);

  const source = await checkoutSource();
  recordSource(directory, source);
  assert.equal(bundleSource(directory).revision, source.revision);
  assert.equal(bundleSource(directory).sourceDirty, source.sourceDirty);
  const external = path.join(directory, "external"), output = path.join(directory, "external-results");
  fs.mkdirSync(external, { recursive: true });
  for (const name of ["bundle.js", "index.html", "main.css", "fonts", "data", "benchmark-source.json"]) {
    fs.cpSync(path.join(directory, name), path.join(external, name), { recursive: true });
  }
  assert.equal(bundleSource(external).revision, source.revision, "Copied build retains its recorded source");
  const bundleFile = path.join(external, "bundle.js"), originalBundle = fs.readFileSync(bundleFile);
  fs.appendFileSync(bundleFile, "\n// Changed external bundle\n");
  assert.equal(bundleSource(external).revision, null, "Changed JavaScript invalidates stale source stamp");
  fs.writeFileSync(bundleFile, originalBundle);
  const catalog = JSON.stringify(JSON.parse(fs.readFileSync("data/catalog.json")).slice(0, 1000));
  fs.writeFileSync(path.join(external, "data/catalog.json"), catalog);
  assert.equal(bundleSource(external).revision, null, "Changed data invalidates stale source stamp");
  fs.rmSync(path.join(external, "benchmark-source.json"));
  const env = { ...process.env, BUNDLE: external, OUTPUT: output, COUNTS: "1000", REPEATS: "1" };
  await execute(process.execPath, ["benchmarks/run.cjs"], { env, timeout: 30000 });
  const report = JSON.parse(fs.readFileSync(path.join(output, "results.json")));
  assert.equal(report.complete, true);
  assert.equal(report.revision, null, "Unknown external source is not the runner checkout");
  assert.equal(report.sourceDirty, null);
  assert.equal(report.runnerRevision, source.revision);
  assert.equal(report.catalogSHA256, hash(catalog), "Report fingerprints the actually served catalogue");
  assert.equal(report.bundleSHA256, hash(fs.readFileSync(path.join(external, "bundle.js"))));
  assert.notEqual(report.catalogSHA256, hash(fs.readFileSync("data/catalog.json")));

  fs.appendFileSync(path.join(external, "bundle.js"), '\nwindow.ready = window.ready.then(() => { fixture.app.tick = () => { throw new Error("forced CLI frame failure"); }; });\n');
  await assert.rejects(execute(process.execPath, ["benchmarks/run.cjs"], { env, timeout: 10000 }), error =>
    error.code === 1 && !error.killed && /forced CLI frame failure/.test(error.stderr));
  const failed = JSON.parse(fs.readFileSync(path.join(output, "results.json")));
  assert.equal(failed.complete, false, "Failure replaces any earlier complete report");
  assert.match(failed.error, /forced CLI frame failure/);
  console.log("Benchmark verifies served provenance, rejects interruptions/frame errors, cleans up, and exits with an incomplete error report.");
})().catch(error => { console.error(error); process.exitCode = 1; });
