const assert = require("node:assert/strict");
const reference = require("./cpu-reference.cjs");

module.exports = async function checkCPUOrbits(page) {
  const base = { a: 1, e: 0, i: 0, W: 25, w: 10, wbar: 0, M: 0, n: 1, epoch: 2451545 };
  const samples = [];
  for (const e of [0, 0.8, 0.999, 0.999999, 1 - Number.EPSILON]) {
    for (const M of [0, 1e-10, -1e-10, 0.1, -0.1, 90, 180, -180, 359.99, -720.1]) {
      for (const offset of [0, -4097, 365250]) {
        const eph = { ...base, e, M, i: 37, W: 123, wbar: 45 }, jed = base.epoch + offset;
        samples.push({ eph, jed, expected: reference(eph, jed) });
      }
    }
  }
  const numerics = await page.evaluate(samples => {
    const Orbit = fixture.app.planets[0].orbit.constructor;
    let maxError = 0, maxCalls = 0;
    for (const { eph, jed, expected } of samples) {
      const sin = Math.sin;
      let calls = 0, actual;
      try {
        Math.sin = x => {
          if (++calls > 128) throw new Error("CPU solve exceeded its work budget");
          return sin(x);
        };
        actual = new Orbit(eph).getPosAtTime(jed);
      } finally { Math.sin = sin; }
      maxError = Math.max(maxError, Math.hypot(actual.x - expected.x, actual.y - expected.y));
      maxCalls = Math.max(maxCalls, calls);
    }
    return { cases: samples.length, maxError, maxCalls };
  }, samples);
  assert(numerics.maxError < 1e-7, JSON.stringify(numerics));

  const steps = [
    { patch: { e: 0.8, M: 90 } },
    { patch: { n: 0, P: 999, wbar: null, w: 60 } },
    { replacement: { ...base, a: 2, e: 0.5, i: 63, M: -45 } },
  ];
  let eph = { ...base };
  for (const step of steps) {
    eph = step.replacement || { ...eph, ...step.patch };
    step.expected = reference(eph, base.epoch + 9876);
  }
  const scene = await page.evaluate(({ base, steps }) => {
    const { app, probe } = fixture;
    const original = { jed: app.jed, speed: app.jedDelta, x: app.stage.x, y: app.stage.y,
      scaleX: app.stage.scale.x, scaleY: app.stage.scale.y };
    const first = app.planets.length, children = new Set(app.stage.children);
    const result = { apsides: [], mutations: [], invalid: [] };
    const sin = Math.sin;
    let calls = 0;
    try {
      app.jedDelta = 0;
      app.jed = base.epoch;
      // A whole-scene guard covers both track construction and Planet.render.
      Math.sin = x => {
        if (++calls > 100000) throw new Error("Scene CPU solve exceeded its work budget");
        return sin(x);
      };
      app.addPlanets([0, 1 - Number.EPSILON].map(e => ({ name: `CPU regression ${e}`,
        size: 4, color: 0xffffff, ephemeris: { ...base, e } })));
      const added = app.planets.slice(first);
      const tracks = app.stage.children.filter(child => !children.has(child));
      result.tracks = tracks.map(track => {
        const { style, path } = track.context.instructions[0].data;
        return { vertices: path.instructions.length,
          finite: path.instructions.every(point => point.data.every(Number.isFinite)),
          width: style.width, color: style.color };
      });
      app.stage.scale.set(1);
      for (const offset of [0, 180, -180]) {
        app.jed = base.epoch + offset;
        for (const planet of added) {
          const e = planet.orbit.ephemeris.e;
          const x = offset === 0 ? -100 * (1 - e) : 100 * (1 + e);
          app.stage.position.set(app.viewWidth / 2 - x, app.viewHeight / 2);
          const before = probe.draws;
          app.render();
          const gl = app.app.renderer.gl, pixels = new Uint8Array(7 * 7 * 4);
          gl.readPixels(Math.floor(app.canvas.width / 2) - 3, Math.floor(app.canvas.height / 2) - 3,
            7, 7, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
          let white = 0;
          for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] > 220 && pixels[i + 1] > 220 && pixels[i + 2] > 220) white++;
          }
          result.apsides.push({ actual: [planet.body.x, planet.body.y], expected: [x, 0],
            draws: probe.draws - before, white,
            attached: app.planetContainer.particleChildren.includes(planet.body) });
        }
      }
      const planet = added[0];
      app.jed = base.epoch + 9876;
      for (const step of steps) {
        if (step.replacement) planet.orbit.ephemeris = step.replacement;
        else Object.assign(planet.orbit.ephemeris, step.patch);
        app.render();
        result.mutations.push({ actual: { x: planet.body.x, y: planet.body.y }, expected: step.expected });
      }
      const saved = { x: planet.body.x, y: planet.body.y };
      planet.orbit.ephemeris.e = 1;
      try { planet.render(app.jed); result.invalid.push(false); }
      catch (error) { result.invalid.push(error instanceof RangeError); }
      result.preserved = saved.x === planet.body.x && saved.y === planet.body.y;
      planet.orbit.ephemeris.e = 0.5;
      app.render();
      result.recovered = saved.x === planet.body.x && saved.y === planet.body.y;
      const counts = [app.planets.length, app.stage.children.length, app.planetContainer.particleChildren.length];
      for (const patch of [{ e: 1 }, { a: Number.MAX_VALUE }, { n: NaN, P: 360 },
        { wbar: null, w: "0" }]) {
        try { app.addPlanets([{ name: "Invalid CPU orbit", ephemeris: { ...base, ...patch } }]); result.invalid.push(false); }
        catch (error) { result.invalid.push(error instanceof RangeError); }
      }
      // A finite initial point can still overflow at a later track date. The
      // real addition boundary must reject it before attaching any scene object.
      try {
        app.addPlanets([{ name: "Overflowing track", ephemeris: { ...base,
          a: Number.MAX_VALUE / 150, e: 0.9, M: 0, W: 0, epoch: app.jed } }]);
        result.invalid.push(false);
      } catch (error) { result.invalid.push(error instanceof RangeError); }
      result.counts = { before: counts,
        after: [app.planets.length, app.stage.children.length, app.planetContainer.particleChildren.length] };
    } finally {
      Math.sin = sin;
      for (const planet of app.planets.splice(first)) app.planetContainer.removeParticle(planet.body);
      for (const child of [...app.stage.children]) if (!children.has(child)) {
        app.stage.removeChild(child); child.destroy();
      }
      app.stage.position.set(original.x, original.y);
      app.stage.scale.set(original.scaleX, original.scaleY);
      app.jed = original.jed; app.render(); app.jedDelta = original.speed;
    }
    return result;
  }, { base, steps });
  assert.equal(scene.tracks.length, 2);
  for (const track of scene.tracks) {
    assert(track.finite);
    assert.equal(track.vertices, 361, "Existing track resolution is preserved");
    assert.equal(track.width, 0.2); assert.equal(track.color, 0x555555);
  }
  for (const sample of scene.apsides) {
    assert(Math.hypot(...sample.actual.map((n, i) => n - sample.expected[i])) < 1e-10);
    assert(sample.attached && sample.white > 0, "Hard-case planet reaches the real framebuffer");
    assert.equal(sample.draws, 1);
  }
  for (const { actual, expected } of scene.mutations) {
    assert(Math.hypot(actual.x - expected.x, actual.y - expected.y) < 1e-7, "App frames observe ephemeris changes");
  }
  assert(scene.invalid.every(Boolean), "Invalid inputs reject at real consumer boundaries");
  assert(scene.preserved && scene.recovered, "Failed planet update preserves its body and recovers after repair");
  assert.deepEqual(scene.counts.before, scene.counts.after, "Rejected track inputs never attach partial scene resources");
  return { numerics, scene };
};
