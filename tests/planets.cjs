const assert = require("node:assert/strict");

// Independent Kepler bisection using M = L - wbar, followed by orbital-plane
// rotations. Reference: Orrery3D PR17. Orrery projects negative X / positive Y,
// with 100 world units per AU. Dates: J2000 and quarter-period forward/backward.
const cases = [{
  name: "Saturn",
  dates: [2451545, 2454234.805, 2448855.195],
  positions: [
    [-641.5546167927974, 654.1377455743664],
    [751.1001963554454, 531.6205380165759],
    [-706.7054593797596, -693.1585990494149],
  ],
}];

module.exports = async function checkPlanetPhases(page) {
  const report = [];
  for (const test of cases) {
    const actual = await page.evaluate(({ name, dates, positions }) => {
      const { app, probe } = window.fixture;
      const planet = app.planets.find(p => p.options.name === name);
      if (!planet || !app.stage.children.includes(app.planetContainer)
        || !app.planetContainer.particleChildren.includes(planet.body)) {
        throw new Error(`${name} is missing from the rendered particle container`);
      }
      const original = { jed: app.jed, speed: app.jedDelta, x: app.stage.x, y: app.stage.y,
        scaleX: app.stage.scale.x, scaleY: app.stage.scale.y };
      try {
        app.jedDelta = 0;
        app.stage.scale.set(1);
        return dates.map((jed, i) => {
          app.jed = jed;
          // Center the independently expected position for an actual framebuffer
          // check; the unchanged full scene and real planet renderer still run.
          app.stage.position.set(app.viewWidth / 2 - positions[i][0], app.viewHeight / 2 - positions[i][1]);
          const before = probe.draws;
          app.render();
          const gl = app.app.renderer.gl, pixels = new Uint8Array(7 * 7 * 4);
          gl.readPixels(Math.floor(app.canvas.width / 2) - 3, Math.floor(app.canvas.height / 2) - 3,
            7, 7, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          const color = planet.options.color;
          const rgb = [color >> 16 & 255, color >> 8 & 255, color & 255];
          let coloredPixels = 0;
          for (let offset = 0; offset < pixels.length; offset += 4) {
            if (rgb.every((value, axis) => Math.abs(pixels[offset + axis] - value) < 40)) coloredPixels++;
          }
          return { position: [planet.body.x, planet.body.y], draws: probe.draws - before, coloredPixels };
        });
      } finally {
        app.stage.position.set(original.x, original.y);
        app.stage.scale.set(original.scaleX, original.scaleY);
        app.jed = original.jed;
        app.render();
        app.jedDelta = original.speed;
      }
    }, test);
    let maxPositionError = 0;
    actual.forEach((sample, i) => {
      const error = Math.hypot(...sample.position.map((value, axis) => value - test.positions[i][axis]));
      assert(error < 1e-5, `${test.name} at JED ${test.dates[i]}: ${error} world units from expected position`);
      assert.equal(sample.draws, 1, "Date change reaches the real app renderer exactly once");
      assert(sample.coloredPixels > 0, `${test.name} reaches the framebuffer at its expected position`);
      maxPositionError = Math.max(maxPositionError, error);
    });
    report.push({ name: test.name, datesChecked: actual.length, maxPositionError });
  }
  return report;
};

// Focused run, also used inside the broader rendering suite below.
if (require.main === module) (async () => {
  const fs = require("node:fs"), path = require("node:path");
  const browsers = require("playwright"), { build, serve } = require("./support.cjs");
  const output = ".context/planet-phases";
  await build("./tests/rendering-fixture.js", path.join(output, "fixture"));
  const server = await serve(path.join(output, "fixture")), report = [];
  try {
    for (const name of (process.env.BROWSERS || "chromium").split(",")) {
      const browser = await browsers[name].launch(name === "chromium" ? { channel: "chrome" } : {});
      try {
        for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
          const page = await browser.newPage({ viewport }), errors = [];
          page.on("pageerror", error => errors.push(error.message));
          page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
          await page.goto(server.url); await page.evaluate(() => window.ready);
          const boot = await module.exports(page);
          await page.reload(); await page.evaluate(() => window.ready);
          const reload = await module.exports(page);
          await page.evaluate(() => {
            const { app } = fixture;
            app.jed = 2451545;
            app.stage.scale.set(Math.min(app.viewWidth, app.viewHeight) / 2200);
            app.render();
          });
          await page.screenshot({ path: path.join(output, `${name}-${viewport.width}.png`) });
          assert.deepEqual(errors, [], "No browser, shader or WebGL errors");
          report.push({ browser: name, version: browser.version(), viewport, boot, reload });
          await page.close();
        }
      } finally { await browser.close(); }
    }
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report));
  } finally { await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
