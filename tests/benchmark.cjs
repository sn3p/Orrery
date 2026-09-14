const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const { launchBrowser } = require("./browsers.cjs");
const checkFrames = require("./benchmark-frames.cjs");
const { build, serve } = require("./support.cjs");
const { sample } = require("../benchmarks/run.cjs");
const { checkoutSource, recordSource, bundleSource } = require("../benchmarks/provenance.cjs");
const execute = promisify(execFile);
const hash = value => crypto.createHash("sha256").update(value).digest("hex");

(async () => {
  const artifacts = ".context/gpu-orbits/benchmark-test";
  const directory = path.join(artifacts, "app");
  fs.rmSync(artifacts, { recursive: true, force: true });
  const invalidOutput = path.join(artifacts, "invalid-input");
  fs.mkdirSync(invalidOutput, { recursive: true });
  for (const name of ["COUNTS", "REPEATS"]) {
    const invalid = ["0", "-1", "NaN", "1.5", "", " ", "Infinity", "9007199254740992"];
    if (name === "COUNTS") invalid.push("1000,", "1000,,2000", "1000,-1", "1000,1.5");
    for (const value of invalid) {
      const file = path.join(invalidOutput, "results.json");
      fs.writeFileSync(file, JSON.stringify({ complete: true, runs: ["previous run"] }));
      const env = { ...process.env, COUNTS: "1000", REPEATS: "1", [name]: value,
        BUNDLE: path.join(artifacts, "missing-bundle"), OUTPUT: invalidOutput };
      await assert.rejects(execute(process.execPath, ["benchmarks/run.cjs"], { env, timeout: 5000 }), error =>
        error.code === 1 && !error.killed && new RegExp(`${name}.*positive safe integer`).test(error.stderr));
      const report = JSON.parse(fs.readFileSync(file));
      assert.equal(report.complete, false, "Invalid input replaces any previous completed report");
      assert.deepEqual(report.runs, []);
      assert.match(report.error, new RegExp(name));
    }
  }
  await build("./tests/fixture.js", directory);
  const server = await serve(directory);
  const frameReports = [];
  try {
    for (const name of (process.env.BROWSERS || "chromium").split(",")) {
      const browser = await launchBrowser(name);
      try {
      frameReports.push({ browser: name, version: browser.version(), ...await checkFrames(browser, server.url) });
      for (const dpr of [1, 2, 3]) {
        const page = await browser.newPage({ viewport: { width: 800, height: 600 }, deviceScaleFactor: dpr });
        try {
          await page.addInitScript(() => localStorage.setItem('orrery.pixelRatio', '1'));
          await page.goto(`${server.url}/?resolution=${dpr}`); await page.evaluate(() => window.ready);
          const run = await page.evaluate(sample, { count: 1000, warmupMs: 0, sampleMs: 50, dpr });
          assert.deepEqual(run.resolution, { requested: dpr, native: dpr, renderer: dpr,
            canvas: [800 * dpr, 600 * dpr], buffer: [800 * dpr, 600 * dpr] });
          assert.equal(await page.evaluate(() => fixture.app.pixelRatio), '1', 'Benchmark resolution is independent of the user selection');
          await assert.rejects(page.evaluate(sample, { count: 1000, warmupMs: 0, sampleMs: 50, dpr: dpr + 1 }), /resolution mismatch/);
          assert.equal(await page.evaluate(() => fixture.app.animationFrame), null);
        } finally { await page.close(); }
      }
      for (const event of [null, "resize", "blur", "visibilitychange"]) {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        await page.goto(server.url); await page.evaluate(() => window.ready);
        await page.evaluate(event => {
          const { app } = fixture;
          window.work = { ticks: 0, draws: 0 };
          const tick = app.tick.bind(app), render = app.app.renderer.render.bind(app.app.renderer);
          app.tick = (...args) => { work.ticks++; return tick(...args); };
          app.app.renderer.render = options => {
            if (options.container === app.stage) {
              work.draws++;
              // Interrupt a measured frame, after sample() has registered its
              // listeners. Scheduling before a separate protocol call can fire
              // the event before the benchmark starts on a slow runner.
              if (event && work.draws === 1) {
                (event === "visibilitychange" ? document : window).dispatchEvent(new Event(event));
              }
            }
            return render(options);
          };
        }, event);
        const run = page.evaluate(sample, { count: 100000, warmupMs: 50, sampleMs: 100 });
        if (event) {
          await assert.rejects(run, /interrupted/, `${event} during a measured frame invalidates the sample`);
          const work = await page.evaluate(() => window.work);
          await page.waitForTimeout(150);
          assert.deepEqual(await page.evaluate(() => window.work), work, "Interrupted benchmark leaves no background work");
        } else {
          assert((await run).frames > 0);
          const work = await page.evaluate(() => window.work);
          assert.equal(work.draws, work.ticks + 1, "One explicit draw per benchmark tick plus the final rebase draw");
          await page.waitForTimeout(150);
          assert.deepEqual(await page.evaluate(() => window.work), work, "Finite benchmark leaves no background work");
          await page.evaluate(() => { fixture.app.autoRender = true; });
          await assert.rejects(page.evaluate(sample, { count: 100000, warmupMs: 50, sampleMs: 100 }), /manual scheduling/);
        }
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
      } finally { await browser.close(); }
    }
  } finally { await server.close(); }
  fs.writeFileSync(path.join(artifacts, "frame-results.json"), JSON.stringify(frameReports, null, 2) + "\n");

  const sourceFixture = path.join(artifacts, "source-fixture");
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
  const external = path.join(artifacts, "external"), output = path.join(artifacts, "external-results");
  fs.mkdirSync(external, { recursive: true });
  for (const name of ["bundle.js", "index.html", "main.css", "fonts", "data", "benchmark-source.json"]) {
    fs.cpSync(path.join(directory, name), path.join(external, name), { recursive: true });
  }
  assert.equal(bundleSource(external).revision, source.revision, "Copied build retains its recorded source");
  for (const name of ["index.html", "main.css", "fonts/JetBrainsMono-Variable.woff2"]) {
    const filename = path.join(external, name), original = fs.readFileSync(filename);
    fs.appendFileSync(filename, name.endsWith(".html") ? "<script>requestAnimationFrame(function loop(){requestAnimationFrame(loop)})</script>" : "\n/* changed input */");
    assert.equal(bundleSource(external).revision, null, `Changed ${name} invalidates build attribution`);
    fs.writeFileSync(filename, original);
  }
  const injected = path.join(external, "injected.js");
  fs.writeFileSync(injected, "requestAnimationFrame(() => {});");
  assert.equal(bundleSource(external).revision, null, "Added auxiliary scripts invalidate attribution");
  fs.renameSync(injected, path.join(external, "renamed.js"));
  assert.equal(bundleSource(external).revision, null, "Renamed assets invalidate attribution");
  fs.rmSync(path.join(external, "renamed.js"));
  const css = fs.readFileSync(path.join(external, "main.css"));
  fs.rmSync(path.join(external, "main.css"));
  assert.equal(bundleSource(external).revision, null, "Removed CSS invalidates attribution");
  fs.writeFileSync(path.join(external, "main.css"), css);
  assert.equal(bundleSource(external).revision, source.revision);
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
  assert.deepEqual(report.counts, [1000]);
  assert.equal(report.repeats, 1);
  assert.equal(report.runs.length, 1, "A valid matrix runs the requested number of samples");
  assert.equal(report.revision, null, "Unknown external source is not the runner checkout");
  assert.equal(report.sourceDirty, null);
  assert.equal(report.runnerRevision, source.revision);
  assert.equal(report.catalogSHA256, hash(catalog), "Report fingerprints the actually served catalogue");
  assert.equal(report.bundleSHA256, hash(fs.readFileSync(path.join(external, "bundle.js"))));
  assert.notEqual(report.catalogSHA256, hash(fs.readFileSync("data/catalog.json")));

  fs.rmSync(path.join(output, "results.json"));
  const mutating = execute(process.execPath, ["benchmarks/run.cjs"], { env, timeout: 30000 });
  const rejectedMutation = assert.rejects(mutating, error => error.code === 1 && /Served bundle changed/.test(error.stderr));
  // The initial report is written after startup fingerprints were taken.
  for (let i = 0; !fs.existsSync(path.join(output, "results.json")); i++) {
    if (i >= 200) throw new Error("Benchmark did not start for the mutation test");
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  fs.appendFileSync(path.join(external, "index.html"), "<!-- modified during measurement -->");
  await rejectedMutation;
  assert.equal(JSON.parse(fs.readFileSync(path.join(output, "results.json"))).complete, false);

  fs.appendFileSync(path.join(external, "bundle.js"), '\nwindow.ready = window.ready.then(() => { fixture.app.tick = () => { throw new Error("forced CLI frame failure"); }; });\n');
  await assert.rejects(execute(process.execPath, ["benchmarks/run.cjs"], { env, timeout: 10000 }), error =>
    error.code === 1 && !error.killed && /forced CLI frame failure/.test(error.stderr));
  const failed = JSON.parse(fs.readFileSync(path.join(output, "results.json")));
  assert.equal(failed.complete, false, "Failure replaces any earlier complete report");
  assert.match(failed.error, /forced CLI frame failure/);
  console.log("Benchmark verifies served provenance, rejects interruptions/frame errors, cleans up, and exits with an incomplete error report.");
})().catch(error => { console.error(error); process.exitCode = 1; });
