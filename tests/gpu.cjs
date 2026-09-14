const { exercisePhaseUploads, startRecording, checkRestorationUploads } = require("./phase-uploads.cjs");
const { exercisePreparation, exercisePreparationLoading } = require("./preparation.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { launchBrowser } = require("./browsers.cjs");
const { build, serve } = require("./support.cjs");
const output = process.env.ORRERY_TEST_APP === 'unified' ? '.context/pr2/unified-gpu' : path.resolve(".context/gpu-orbits/checks");

async function exercise(page) {
  await page.evaluate(() => window.ready);
  return page.evaluate(() => {
    const { app, catalog, initialSpeed, REFERENCE_JED, REBASE_DAYS, shaderAccuracy, reference } = window.fixture;
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    check(initialSpeed === 0, "Zero initial speed is preserved");
    app.setAsteroids(catalog);
    check(app.asteroidsDiscovered === 100000, "Full real catalogue loaded at reference date");
    const timing = [];
    for (const hz of [30, 60, 120]) {
      app.jed = REFERENCE_JED; app.jedDelta = 1.5; app.clock.reset();
      const ticker = app.app.ticker; ticker.lastTime = -1;
      ticker.update(0);
      for (let i = 1; i <= hz; i++) ticker.update(i * 1000 / hz);
      const days = app.jed - REFERENCE_JED;
      check(Math.abs(days - 90) < 1e-6, `${hz} Hz actual Pixi ticker: ${days}`);
      timing.push({ hz, days });
    }
    app.jedDelta = 0; const paused = app.jed, elapsed = app.elapsed;
    app.tick({ lastTime: 2000 });
    check(app.jed === paused && app.elapsed === elapsed, "Pause freezes both orbits and markers");
    app.jedDelta = -1.5; app.tick({ lastTime: 200000 });
    check(app.jed === paused && app.elapsed === elapsed, "First reverse frame excludes paused time");
    app.tick({ lastTime: 200016.6666667 });
    check(app.jed < paused && app.elapsed > elapsed, "Reverse moves time backward while markers age");
    const before = app.jed;
    Object.defineProperty(document, "hidden", { configurable: true, value: true });
    document.dispatchEvent(new Event("visibilitychange")); app.tick({ lastTime: 100000 });
    check(app.jed === before, "Hidden time excluded");
    delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); app.tick({ lastTime: 200000 });
    check(app.jed === before, "Visibility resume excludes downtime");
    app.jedDelta = 0;

    for (const date of [catalog[0].disc - 1, catalog[0].disc, catalog[50000].disc, catalog.at(-1).disc, catalog.at(-1).disc + 1, catalog[0].disc - 1, REFERENCE_JED]) {
      app.jed = date; app.tick(); app.app.render();
      const expected = catalog.filter(d => d.disc <= date).length;
      check(app.asteroidsDiscovered === expected && app.asteroids.geometry.instanceCount === expected, "Forward/reverse/jump discovery cutoff");
      check(Number(app.gui.count.textContent) === expected, "Count reaches UI while paused");
    }
    const cloud = app.asteroids;
    const oldGeometryUid = cloud.geometry.uid;
    const buffers = cloud.geometry.buffers;
    const versions = buffers.map(b => b._updateID);
    for (let i = 0; i < 20; i++) { app.jed += 0.1; app.tick(); app.app.render(); }
    check(buffers.every((b, i) => b._updateID === versions[i]), "Ordinary frames do not modify asteroid buffers");
    app.jed = cloud.epoch + REBASE_DAYS + 1; app.tick(); app.app.render();
    check(cloud.uniforms.uOrbitTime === 0, "Time is relative after rebase");
    check(buffers.every((b, i) => b._updateID === versions[i] + (b === cloud.geometry.getBuffer("aMeanAnomaly") ? 1 : 0)), "Only phase buffer changes at rebase");

    for (const data of [null, new Array(1), [catalog[0], , catalog[1]], [{ ...catalog[0], e: 1 }], [{ ...catalog[0], wbar: false }],
      [{ ...catalog[0], n: 1e40 }], [{ ...catalog[0], n: null, P: 1e-37 }]]) {
      let rejected = false; try { app.setAsteroids(data); } catch { rejected = true; }
      check(rejected && app.asteroids === cloud, "Invalid replacement preserves visible data");
    }
    app.setAsteroids([]); app.app.render();
    check(!app.app.renderer.geometry._managedGeometries.items[oldGeometryUid], "Replacement releases the renderer geometry registry and VAO");
    check(cloud.destroyed && buffers.every(b => b.destroyed), "Replacement disposes geometry and buffers");
    check(app.asteroidsDiscovered === 0 && !app.asteroids.visible, "Empty catalogue renders no instances");
    app.setAsteroids(catalog); app.app.render();
    check(app.stage.children.filter(c => c.label === "Asteroids").length === 1, "Only one GPU cloud after replacement");
    const planetPositions = app.planets.map(planet => {
      const expected = reference(planet.orbit.ephemeris, app.jed);
      check(Math.hypot(planet.body.x - expected[0], planet.body.y - expected[1]) < 0.001, "CPU planets retain the projected shader coordinate convention");
      return { name: planet.options.name, x: planet.body.x, y: planet.body.y };
    });
    const numerical = shaderAccuracy(app.circleTexture, catalog, fixture.planets);
    return { timing, numerical, planetPositions };
  });
}

async function pixels(page) {
  return page.evaluate(() => {
    const { app, REFERENCE_JED, reference } = fixture;
    const check = (c, m) => { if (!c) throw new Error(m); };
    // An actual production mesh at a known projected point. Hide other objects
    // only for these framebuffer assertions; full-app screenshots follow.
    const hidden = app.stage.children.filter(c => c !== app.asteroids);
    hidden.forEach(c => { c.visible = false; });
    const d = { a: 0.1, e: 0, i: 0, W: 0, wbar: 0, M: 35, n: 1, epoch: REFERENCE_JED, disc: REFERENCE_JED };
    app.jed = REFERENCE_JED; app.stage.scale.set(12);
    app.stage.position.set(app.viewWidth / 2 + 17, app.viewHeight / 2 - 23);
    app.setAsteroids([d]);
    const epoch = app.elapsed;
    const read = age => {
      app.asteroids.update(app.jed, epoch + age); app.app.render();
      const gl = app.app.renderer.gl, w = app.canvas.width, h = app.canvas.height;
      const data = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, data);
      let green = 0, gray = 0, xTotal = 0, yTotal = 0, lit = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (data[i + 1] > 20) {
          lit++; xTotal += x + 0.5; yTotal += h - y - 0.5;
          if (data[i + 1] > data[i] * 2) green++;
          else if (Math.abs(data[i] - data[i + 1]) < 2) gray++;
        }
      }
      return { green, gray, x: xTotal / lit, y: yTotal / lit, lit };
    };
    const fresh = read(0), shrinking = read(1 / 3), old = read(2 / 3 + 0.001);
    check(fresh.green > shrinking.green * 1.8 && shrinking.green > old.lit * 3, "Green marker shrinks 3x -> 2x -> 1x");
    check(old.green === 0 && old.gray > 0, "Mature marker is gray, not a color fade");
    const expected = reference(d, app.jed), resolution = app.app.renderer.resolution;
    check(Math.abs(old.x - (app.stage.x + expected[0] * 12) * resolution) < 1, "Negative-x projection and pan/zoom/DPR");
    check(Math.abs(old.y - (app.stage.y + expected[1] * 12) * resolution) < 1, "Positive-y projection and pan/zoom/DPR");
    // A replay must flash again even after all earlier particles were hidden.
    app.asteroids.update(d.disc - 1, epoch + 1);
    app.asteroids.update(d.disc, epoch + 1);
    check(app.asteroids.geometry.getBuffer("aDiscovery").data[0] === Math.fround(epoch + 1 - app.asteroids.markerEpoch), "Replay resets discovery age");
    // Force a partial marker upload before clock rebasing, then verify the
    // entire refresh reaches the GPU (Pixi retains the previous update size).
    app.elapsed = epoch + 4096.1; app.asteroids.update(d.disc, app.elapsed);
    const rebased = read(4096.2);
    check(rebased.green === 0 && rebased.gray > 0, "Old markers stay gray at animation clock rebase");
    app.elapsed = epoch + 4096.2;
    hidden.forEach(c => { c.visible = true; });
    app.stage.scale.set(1); app.stage.position.set(app.viewWidth / 2, app.viewHeight / 2);
    app.setAsteroids(fixture.catalog); app.elapsed += 1; app.tick(); app.app.render();
    return { fresh, shrinking, old, rebased };
  });
}

async function instancePixels(page) {
  return page.evaluate(() => {
    const { app, REFERENCE_JED, reference } = fixture;
    const hidden = app.stage.children.filter(c => c !== app.asteroids);
    hidden.forEach(c => { c.visible = false; });
    const data = [0, 90, 180, 270].map((M, i) => ({ a: 0.1, e: 0, i: 0, W: 0, wbar: 0, M, n: 1, epoch: REFERENCE_JED, disc: REFERENCE_JED - 3 + i }));
    app.jedDelta = 0; app.jed = REFERENCE_JED - 1;
    app.stage.scale.set(12); app.stage.position.set(app.viewWidth / 2, app.viewHeight / 2);
    app.setAsteroids(data); app.elapsed += 1; app.tick(); app.app.render();
    app.jed = REFERENCE_JED; app.tick(); app.app.render();
    const read = () => data.map(d => {
      const [x, y] = reference(d, app.jed), rgba = new Uint8Array(4);
      const gl = app.app.renderer.gl, r = app.app.renderer.resolution;
      gl.readPixels(Math.floor((app.stage.x + x * 12) * r), app.canvas.height - 1 - Math.floor((app.stage.y + y * 12) * r), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      return Array.from(rgba);
    });
    const colors = read();
    colors.forEach(([r, g, b], i) => {
      if (!(i === 3 ? r === 0 && g > 200 && b === 0 : r > 100 && r === g && g === b)) throw new Error("Per-instance position or partial discovery timestamp upload failed");
    });
    app.elapsed += 4096.1; app.tick(); app.app.render();
    const rebased = read();
    if (!rebased.every(([r, g, b]) => r > 100 && r === g && g === b)) throw new Error("Full timestamp refresh after a partial upload failed");
    hidden.forEach(c => { c.visible = true; });
    app.stage.scale.set(1); app.setAsteroids(fixture.catalog); app.elapsed += 1; app.tick(); app.app.render();
    return { colors, rebased };
  });
}

async function contextRecovery(page) {
  const uploads = [];
  for (let i = 0; i < 2; i++) {
    const available = await page.evaluate(() => {
      const { app } = fixture;
      app.jedDelta = 1.5; app.clock.reset(); app.tick({ lastTime: 0 });
      window.beforeLoss = { jed: app.jed, texture: app.circleTexture.uid };
      const extension = app.app.renderer.gl.getExtension("WEBGL_lose_context");
      window.lossExtension = extension;
      extension?.loseContext(); return !!extension;
    });
    if (!available) return { unavailable: "WEBGL_lose_context extension unavailable" };
    await page.waitForFunction(() => fixture.app.contextLost);
    await startRecording(page);
    await page.evaluate(() => {
      const { app } = fixture;
      app.tick({ lastTime: 100000 });
      if (app.jed !== beforeLoss.jed) throw new Error("Simulation advanced during context loss");
      window.lossExtension.restoreContext();
    });
    await page.waitForFunction(() => !fixture.app.contextLost);
    await page.evaluate(() => {
      const { app } = fixture;
      app.tick({ lastTime: 200000 });
      if (app.jed !== beforeLoss.jed) throw new Error("Context resume caught up downtime");
      if (app.circleTexture.uid === beforeLoss.texture) throw new Error("Generated texture was not recreated");
      app.jedDelta = 0;
      app.app.render();
    });
    const restored = await checkRestorationUploads(page);
    // Pixi's WebGL1 texture setup emits its existing INVALID_ENUM warning
    // again on restore. Separate setup errors from the warm orbital probes.
    const setupErrors = await page.evaluate(() => {
      const gl = fixture.app.app.renderer.gl, errors = [];
      for (let error = gl.getError(); error !== gl.NO_ERROR; error = gl.getError()) errors.push(error);
      return errors;
    });
    if (await page.evaluate(() => fixture.app.app.renderer.context.webGLVersion) === 1) {
      assert(setupErrors.every(error => error === 1280), "Only known WebGL1 texture setup warnings");
    } else assert.deepEqual(setupErrors, []);
    uploads.push({ restored, setupErrors, warm: await exercisePhaseUploads(page) });
    // Includes nonempty framebuffer, correct colour, shape and transform checks
    // after restoration, plus a second replacement using the shared program.
    await pixels(page);
  }
  return { cycles: 2, uploads };
}

async function main() {
  await build("./tests/browser.js", path.join(output, "fixture"));
  await build("./src/js/index.js", path.join(output, "production"));
  const server = await serve(output), report = [];
  try {
    for (const name of (process.env.BROWSERS || "chromium").split(",")) {
      const browser = await launchBrowser(name);
      try {
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const errors = [];
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
        await page.goto(server.url + "/fixture/");
        const result = { browser: name, version: browser.version(), ...await exercise(page), phaseUploads: await exercisePhaseUploads(page), preparation: await exercisePreparation(page), pixels: await pixels(page), instances: await instancePixels(page), recovery: await contextRecovery(page) };
        await page.screenshot({ path: path.join(output, `${name}-desktop.png`) });
        const scale = await page.evaluate(() => fixture.app.stage.scale.x);
        await page.mouse.move(500, 400); await page.mouse.wheel(0, -100);
        await page.waitForFunction(before => fixture.app.stage.scale.x > before, scale);
        await page.setViewportSize({ width: 390, height: 844 });
        await page.waitForFunction(() => fixture.app.canvas.width === 390);
        await page.evaluate(() => { fixture.app.app.render(); });
        await page.screenshot({ path: path.join(output, `${name}-narrow.png`) });
        assert.deepEqual(errors, [], "No GL, shader or JavaScript errors");

        result.preparationLoading = await exercisePreparationLoading(page, server.url);
        await page.reload(); await page.evaluate(() => window.ready);
        result.preparationReload = await exercisePreparation(page);
        assert.deepEqual(errors, [], "Preparation failures/recovery/reload leave no browser errors");

        // HTTP failure, malformed data, delayed/out-of-order replacement and disposal.
        await page.route("**/failure", route => route.fulfill({ status: 200, body: "invalid json" }));
        await page.evaluate(async url => {
          const { app } = fixture, cloud = app.asteroids;
          if (await app.loadAsteroids(url + "/failure")) throw new Error("Malformed JSON accepted");
          if (app.asteroids !== cloud || !document.getElementById("orrery-status").textContent.includes("Unable")) throw new Error("Failed load discarded valid state or error feedback");
        }, server.url);
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        await page.route("**/delayed", async route => { await gate; await route.fulfill({ status: 200, body: "[]" }).catch(() => {}); });
        await page.evaluate(url => { window.pendingLoad = fixture.app.loadAsteroids(url + "/delayed"); }, server.url);
        await page.evaluate(() => fixture.app.setAsteroids([fixture.catalog[0]]));
        release(); await page.evaluate(() => pendingLoad);
        assert.equal(await page.evaluate(() => fixture.app.asteroids.discoveryDates.length), 1);
        await page.evaluate(() => {
          const { app } = fixture, cloud = app.asteroids;
          app.destroy(); app.destroy();
          if (!cloud.destroyed || document.querySelector("canvas") || document.querySelector(".dg.main")) throw new Error("Application disposal leaked resources or UI");
        });
        await page.close();

        const highDpr = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
        await highDpr.goto(server.url + "/fixture/"); await highDpr.evaluate(() => window.ready);
        result.dpr2 = await pixels(highDpr);
        assert.equal(await highDpr.evaluate(() => fixture.app.canvas.width), 780);
        await highDpr.screenshot({ path: path.join(output, `${name}-dpr2.png`) });
        await highDpr.close();

        const production = await browser.newPage({ viewport: { width: 360, height: 844 } });
        const productionErrors = [];
        production.on("pageerror", error => productionErrors.push(error.message));
        production.on("console", message => { if (message.type() === "error") productionErrors.push(message.text()); });
        await production.goto(server.url + "/production/");
        await production.waitForFunction(() => Number(document.getElementById("orrery-count").textContent) > 0);
        await require("./options.cjs").openOptions(production);
        const input = production.getByRole("textbox", { name: "Playback speed" });
        await input.fill("0"); await input.press("Enter");
        const date = await production.locator("#orrery-date").textContent();
        await production.waitForTimeout(100);
        assert.equal(await production.locator("#orrery-date").textContent(), date);
        await input.fill("-1.5"); await input.press("Enter");
        await production.waitForFunction(previous => document.getElementById("orrery-date").textContent < previous, date);
        await production.screenshot({ path: path.join(output, `${name}-production.png`) });
        assert.deepEqual(productionErrors, []);
        const record = { a: 1, e: 0, i: 0, W: 0, w: 0, M: 0, n: 1, epoch: 2458600.5, disc: 2400000 };
        for (const body of ["invalid", JSON.stringify([record, { ...record, a: 1e40, disc: 2399999 }])]) {
          await production.route("**/data/catalog.json", route => route.fulfill({ status: 200, contentType: "application/json", body }));
          await production.reload();
          await production.getByRole("status").filter({ hasText: "Unable to load" }).waitFor();
          assert.equal(await production.locator("#orrery-count").textContent(), "0");
          await production.unroute("**/data/catalog.json");
        }
        await production.reload();
        await production.waitForFunction(() => Number(document.getElementById("orrery-count").textContent) > 0);
        assert.equal(await production.getByRole("status").textContent(), "");
        assert.deepEqual(productionErrors, [], "Production reload recovers from preparation failures");
        await production.close();
        if (name === "chromium") {
          const webgl1 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
          await webgl1.addInitScript(() => {
            const get = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(type, ...args) {
              return type === "webgl2" ? null : get.call(this, type, ...args);
            };
          });
          await webgl1.goto(server.url + "/fixture/"); await webgl1.evaluate(() => window.ready);
          result.webgl1 = await webgl1.evaluate(() => {
            const { app, catalog } = fixture;
            if (app.app.renderer.context.webGLVersion !== 1) throw new Error("Expected WebGL1");
            app.setAsteroids(catalog.slice(0, 10)); app.jed = catalog[0].disc; app.tick(); app.app.render();
            const gl = app.app.renderer.gl;
            // Pixi emits pre-existing texture parameter warnings on WebGL1
            // setup. Drain these before testing the discovery upload itself.
            while (gl.getError() !== gl.NO_ERROR) {}
            app.jed = catalog[5].disc; app.tick(); app.app.render();
            if (gl.getError() !== gl.NO_ERROR) throw new Error("WebGL1 discovery upload overflow");
            return { version: 1, discovered: app.asteroidsDiscovered };
          });
          result.webgl1.phaseUploads = await exercisePhaseUploads(webgl1);
          result.webgl1.recovery = await contextRecovery(webgl1);
          result.webgl1.pixels = await pixels(webgl1);
          result.webgl1.instances = await instancePixels(webgl1);
          await webgl1.close();
        }
        report.push(result);
        fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
        console.log(JSON.stringify(result));
      } finally { await browser.close(); }
    }
  } finally { await server.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
