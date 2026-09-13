const assert = require("node:assert/strict");

// Independent Kepler bisection using M = L - wbar, followed by orbital-plane
// rotations. References: Orrery3D PR17/23. Orrery projects negative X / positive Y,
// with 100 world units per AU. Dates: J2000 and quarter-period forward/backward;
// Earth also covers distant backward/forward playback dates.
const cases = [{
  name: "Saturn",
  dates: [2451545, 2454234.805, 2448855.195],
  positions: [
    [-641.5546167927974, 654.1377455743664],
    [751.1001963554454, 531.6205380165759],
    [-706.7054593797596, -693.1585990494149],
  ],
}, {
  name: "Earth",
  dates: [2451545, 2451636.314, 2451453.686, 2378861.5, 2488070.5],
  positions: [
    [17.716175624839284, 96.72148794098914],
    [97.63172650399369, -21.42782149947558],
    [-98.98689279403717, 14.887987306053766],
    [21.90286569520022, 95.85851448615269],
    [17.544116286101282, 96.75297887991078],
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
  const elements = await page.evaluate(() => fixture.app.planets.map(planet => ({
    name: planet.options.name, ephemeris: planet.orbit.ephemeris,
  })));
  assert.deepEqual(elements.map(planet => planet.name), ["Mercury", "Venus", "Earth", "Mars", "Jupiter", "Saturn"]);
  for (const { name, ephemeris: { M, L, wbar } } of elements) {
    const difference = (M - (L - wbar)) * Math.PI / 180;
    assert(Math.abs(Math.atan2(Math.sin(difference), Math.cos(difference))) < 1e-10,
      `${name}: mean anomaly agrees with its own L - wbar`);
  }
  // NASA NSSDCA's J2000 source cohort and sidereal period, preserved together:
  // https://nssdc.gsfc.nasa.gov/planetary/factsheet/earthfact.html
  assert.deepEqual(elements.find(planet => planet.name === "Earth").ephemeris, {
    epoch: 2451545, a: 1.00000011, e: 0.01671022, i: 0.00005,
    W: -11.26064, w: 114.20783, wbar: 102.94719, L: 100.46435, M: -2.48284, P: 365.256,
  });
  return { positions: report, phasesChecked: elements.length };
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
