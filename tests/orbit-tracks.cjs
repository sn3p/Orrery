const assert = require("node:assert/strict");
const reference = require("./cpu-reference.cjs");

module.exports = async function checkOrbitTracks(page) {
  const cases = await page.evaluate(() => {
    const { app, probe } = fixture;
    const tracks = app.stage.children.filter(child => child.screenOrbit);
    if (tracks.length !== app.planets.length) throw new Error("One actual boot track per planet");
    const start = app.startDate.getTime() / 86400000 + 2440587.5;
    const capture = (line, orbit, jed, label) => {
      const points = line.sourcePoints;
      return { label, eph: { ...orbit.ephemeris }, jed, period: orbit.getPeriodInDays(),
        points: Array.from({ length: points.length / 3 }, (_, i) => ({ data: [points[i*3], points[i*3+1]] })) };
    };
    const result = app.planets.map((planet, i) => capture(tracks[i], planet.orbit, start, planet.options.name));
    const original = { jed: app.jed, speed: app.jedDelta, x: app.stage.x, y: app.stage.y,
      sx: app.stage.scale.x, sy: app.stage.scale.y, visible: app.stage.children.map(child => child.visible) };
    try {
      app.jedDelta = 0;
      for (const [index, planet] of app.planets.entries()) {
        const orbit = planet.orbit, period = orbit.ephemeris.n ? 360 / orbit.ephemeris.n : orbit.ephemeris.P;
        const samples = result[index].points;
        result[index].frames = [0, 90, 180, 359].map(i => {
          app.jed = start + period / 360 * i;
          const before = probe.draws;
          app.render();
          return { point: i, body: [planet.body.x, planet.body.y], draws: probe.draws - before };
        });
        // Isolate the existing boot track and inspect its last segment in the
        // real framebuffer at ordinary supported zoom. No synthetic line renderer.
        app.stage.children.forEach(child => { child.visible = child === tracks[index]; });
        const last = samples.at(-2).data, first = samples[0].data;
        app.stage.scale.set(10);
        app.stage.position.set(app.viewWidth / 2 - (last[0] + first[0]) * 5,
          app.viewHeight / 2 - (last[1] + first[1]) * 5);
        app.render();
        const gl = app.app.renderer.gl, pixels = new Uint8Array(7 * 7 * 4);
        gl.readPixels(Math.floor(app.canvas.width / 2) - 3, Math.floor(app.canvas.height / 2) - 3,
          7, 7, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        // A fixed 1px stroke can straddle pixels: MSAA splits its intensity.
        // Measure gray coverage instead of requiring one nearly opaque pixel.
        result[index].closingCoverage = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i] > 0 && Math.abs(pixels[i] - pixels[i + 1]) < 2
            && Math.abs(pixels[i] - pixels[i + 2]) < 2) result[index].closingCoverage += pixels[i] / 51;
        }
        app.stage.children.forEach((child, i) => { child.visible = original.visible[i]; });
        for (const jed of [2451545, 2378861.5, 2488070.5]) {
          const line = orbit.drawOrbit(jed);
          try { result.push(capture(line, orbit, jed, `${planet.options.name} at ${jed}`)); }
          finally { line.destroy(); }
        }
      }
      // Near the date-resolution boundary, valid one-ULP steps still produce
      // the complete orbit in both time directions.
      const Orbit = app.planets[0].orbit.constructor;
      for (const jed of [2451545, -2451545]) {
        const orbit = new Orbit({ ...app.planets[2].orbit.ephemeris, n: 2 ** 31, epoch: jed });
        const line = orbit.drawOrbit(jed);
        try { result.push(capture(line, orbit, jed, `date resolution at ${jed}`)); }
        finally { line.destroy(); }
      }
    } finally {
      app.stage.children.forEach((child, i) => { child.visible = original.visible[i]; });
      app.stage.position.set(original.x, original.y); app.stage.scale.set(original.sx, original.sy);
      app.jed = original.jed; app.render(); app.jedDelta = original.speed;
    }
    return result;
  });
  let verticesChecked = 0, framesChecked = 0;
  for (const { label, eph, jed, period, points, frames, closingCoverage } of cases) {
    assert.equal(points.length, 361, `${label}: 360 segments and 361 vertices`);
    assert.deepEqual(points.at(-1).data, points[0].data, `${label}: exact closure`);
    const expectedPeriod = eph.n ? 360 / eph.n : eph.P;
    assert.equal(period, expectedPeriod, `${label}: motion-consistent period`);
    for (let i = 0; i < 360; i++) {
      const { x, y } = reference(eph, jed + expectedPeriod / 360 * i);
      assert(Math.hypot(points[i].data[0] - x, points[i].data[1] - y) < Math.max(1, eph.a * 100) * 1e-9,
        `${label}: vertex ${i} follows independent position reference`);
      verticesChecked++;
    }
    if (frames) {
      for (const frame of frames) {
        assert.deepEqual(frame.body, points[frame.point].data, `${label}: actual frame aligns body and sampled track`);
        assert.equal(frame.draws, 1); framesChecked++;
      }
      assert(closingCoverage >= 1, `${label}: closing segment reaches the framebuffer`);
    }
  }
  return { sceneTracks: 6, casesChecked: cases.length, verticesChecked, framesChecked,
    closingCoverage: cases.slice(0, 6).map(({ label, closingCoverage }) => ({ label, closingCoverage })) };
};
