const assert = require("node:assert/strict");

// Observe production Pixi calls, not dirty flags or predicted array sizes.
// WebGL1 ignores WebGL2's source-range overload, so count what that API submits.
async function startRecording(page) {
  await page.evaluate(() => {
    const { app } = fixture, gl = app.app.renderer.gl;
    const original = { bufferData: gl.bufferData, bufferSubData: gl.bufferSubData };
    const writes = [];
    for (const method of Object.keys(original)) {
      gl[method] = function (...args) {
        const data = args[method === "bufferData" ? 1 : 2];
        const ranged = app.app.renderer.context.webGLVersion === 2;
        const offset = ranged ? (args[3] ?? 0) : 0;
        const length = ranged ? (args[4] || (data?.length - offset)) : data?.length;
        const bytes = typeof data === "number" ? data : length * data.BYTES_PER_ELEMENT;
        const attribute = Object.entries(app.asteroids.geometry.attributes)
          .find(([, value]) => value.buffer.data === data)?.[0] ?? null;
        writes.push({ method, bytes, attribute, target: args[0], offset: method === "bufferSubData" ? args[1] : 0 });
        return original[method].apply(this, args);
      };
    }
    window.phaseRecording = { writes, stop: () => { Object.assign(gl, original); delete window.phaseRecording; } };
  });
}

async function stopRecording(page) {
  return page.evaluate(() => {
    const writes = phaseRecording.writes.slice();
    phaseRecording.stop();
    return writes;
  });
}

const orbital = writes => writes.filter(write => ["aBasis", "aElements", "aMeanAnomaly"].includes(write.attribute));
const phaseBytes = (writes, count, method, message) => {
  assert.deepEqual(orbital(writes).map(({ attribute, bytes, method, offset }) => ({ attribute, bytes, method, offset })),
    [{ attribute: "aMeanAnomaly", bytes: count * 4, method, offset: 0 }], message);
};

async function exercisePhaseUploads(page) {
  await startRecording(page);
  let result;
  try {
    result = await page.evaluate(() => {
      const { app, catalog, prepareOrbits, REFERENCE_JED, REBASE_DAYS } = fixture;
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      const writes = phaseRecording.writes, probes = [];
      app.jedDelta = 0;
      app.jed = REFERENCE_JED;
      app.setAsteroids(catalog);
      app.app.render();
      const initial = writes.splice(0);
      const cloud = app.asteroids, count = catalog.length;
      const fixed = ["aBasis", "aElements"].map(name => ({ name, data: cloud.geometry.getBuffer(name).data.slice() }));
      const frame = (name, jed, refresh) => {
        writes.length = 0;
        app.jed = jed; app.tick(); app.app.render();
        const expected = prepareOrbits(catalog, cloud.epoch);
        check(cloud.geometry.getBuffer("aMeanAnomaly").data.every((value, i) => value === expected.meanAnomalies[i]), "All phases match their packed epoch");
        check(fixed.every(({ name, data }) => data.every((value, i) => value === cloud.geometry.getBuffer(name).data[i])), "Fixed attributes never change");
        probes.push({ name, refresh, writes: writes.slice(), epoch: cloud.epoch, orbitTime: cloud.uniforms.uOrbitTime,
          expectedTime: jed - cloud.epoch, discovered: cloud.geometry.instanceCount, expectedCount: catalog.filter(d => d.disc <= jed).length });
      };
      frame("ordinary", REFERENCE_JED + 1, false);
      frame("exact forward threshold", REFERENCE_JED + REBASE_DAYS, false);
      frame("forward refresh", REFERENCE_JED + REBASE_DAYS + 0.125, true);
      frame("same date", app.jed, false);
      frame("exact reverse threshold", cloud.epoch - REBASE_DAYS, false);
      frame("reverse refresh", cloud.epoch - REBASE_DAYS - 0.125, true);
      frame("future jump", REFERENCE_JED + 50000, true);
      frame("past jump", REFERENCE_JED - 50000, true);
      frame("return to reference", REFERENCE_JED, true);
      frame("ordinary after jumps", REFERENCE_JED + 1, false);

      // Hide every row, refresh the CPU arrays, then reveal without another
      // orbital rebase. The first GPU allocation must use the hidden refresh.
      const data = Array.from({ length: 4 }, (_, i) => ({ ...catalog[i], disc: REFERENCE_JED + 800 + i }));
      app.jed = REFERENCE_JED; app.setAsteroids(data); app.app.render(); writes.length = 0;
      app.jed += 700; app.tick(); app.app.render();
      const hidden = writes.splice(0), current = app.asteroids;
      const packed = prepareOrbits(data, app.jed);
      check(!current.visible && current.geometry.instanceCount === 0, "Hidden cloud remains undrawn");
      check(current.geometry.getBuffer("aMeanAnomaly").data.every((value, i) => value === packed.meanAnomalies[i]), "Hidden refresh includes undiscovered rows");
      const hiddenEpoch = current.epoch;
      app.jed = data[0].disc; app.tick(); app.app.render();
      const revealed = writes.splice(0);
      check(current.epoch === hiddenEpoch && current.geometry.instanceCount === 1, "Discovery consumes the hidden epoch without rebasing again");
      app.jed = data[2].disc; app.tick(); app.app.render();
      const partialMarkers = writes.splice(0);
      app.elapsed += 4096.1; app.tick(); app.app.render();
      const markerRebase = writes.splice(0);
      check(current.geometry.getBuffer("aDiscovery").data.every(value => value === -1), "Old markers are retired after their independent clock rebase");
      app.jed = data[3].disc; app.tick(); app.app.render();
      const finalDiscovery = writes.splice(0);
      app.setAsteroids([]); app.jed += 1000; app.tick(); app.app.render();
      const empty = writes.splice(0);
      check(!app.asteroids.visible && app.asteroids.geometry.instanceCount === 0, "Empty cloud survives rebase");
      app.jed = REFERENCE_JED; app.setAsteroids(catalog); app.app.render();
      check(app.app.renderer.gl.getError() === app.app.renderer.gl.NO_ERROR, "Phase/discovery uploads produce no GL error");
      return { count, version: app.app.renderer.context.webGLVersion, initial, probes, hidden, revealed,
        partialMarkers, markerRebase, finalDiscovery, empty };
    });
  } finally { await stopRecording(page); }
  const allocation = orbital(result.initial);
  assert.deepEqual(allocation.map(({ attribute, bytes, method }) => ({ attribute, bytes, method })), [
    { attribute: "aBasis", bytes: result.count * 16, method: "bufferData" },
    { attribute: "aElements", bytes: result.count * 8, method: "bufferData" },
    { attribute: "aMeanAnomaly", bytes: result.count * 4, method: "bufferData" },
  ], "Initial allocation owns separate fixed and scalar buffers");
  for (const probe of result.probes) {
    if (probe.refresh) phaseBytes(probe.writes, result.count, "bufferSubData", probe.name);
    else assert.deepEqual(orbital(probe.writes), [], probe.name);
    assert.equal(probe.orbitTime, probe.expectedTime, probe.name);
    assert.equal(probe.discovered, probe.expectedCount, probe.name);
    if (probe.refresh) assert.equal(probe.orbitTime, 0, probe.name);
  }
  assert.deepEqual(orbital(result.hidden), [], "Hidden refresh does not submit a draw/upload");
  assert.equal(result.revealed.find(write => write.attribute === "aMeanAnomaly")?.bytes, 16, "Reveal allocates all refreshed phases");
  assert.deepEqual(orbital(result.partialMarkers), [], "Discovery changes no orbital buffer");
  for (const [name, writes, bytes, offset] of [
    ["partial discovery", result.partialMarkers, result.version === 2 ? 8 : 16, result.version === 2 ? 4 : 0],
    ["marker clock rebase", result.markerRebase, 16, 0],
    ["discovery after marker rebase", result.finalDiscovery, result.version === 2 ? 4 : 16, result.version === 2 ? 12 : 0],
  ]) {
    assert.deepEqual(writes.filter(write => write.attribute === "aDiscovery").map(({ method, bytes, offset }) => ({ method, bytes, offset })),
      [{ method: "bufferSubData", bytes, offset }], name);
    assert.deepEqual(orbital(writes), [], name);
  }
  assert.deepEqual(orbital(result.empty), [], "Empty rebase uploads no orbital data");
  return result;
}

// Called around real WEBGL_lose_context restoration, before the first render.
async function checkRestorationUploads(page) {
  const writes = await stopRecording(page);
  const count = await page.evaluate(() => fixture.app.asteroids.discoveryDates.length);
  for (const [attribute, stride] of [["aBasis", 16], ["aElements", 8], ["aMeanAnomaly", 4], ["aDiscovery", 4]]) {
    assert(writes.some(write => write.attribute === attribute && write.method === "bufferData" && write.bytes === count * stride),
      `Context restoration re-creates ${attribute} storage`);
  }
  return { count, writes };
}

module.exports = { exercisePhaseUploads, startRecording, checkRestorationUploads };
