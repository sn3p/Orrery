const assert = require("node:assert/strict");

exports.exercisePreparation = async page => page.evaluate(() => {
  const { app, catalog, prepareOrbits, REFERENCE_JED, REBASE_DAYS } = fixture;
  const check = (value, message) => { if (!value) throw new Error(message); };
  if (!app.asteroids) app.setAsteroids(catalog);
  const cloud = app.asteroids;
  const before = { jed: app.jed, speed: app.jedDelta, elapsed: app.elapsed, count: app.asteroidsDiscovered,
    status: document.getElementById("orrery-status").textContent, countText: app.gui.count.textContent,
    version: app.loadVersion, controller: app.loadController, children: [...app.stage.children] };
  const buffers = cloud.geometry.buffers;
  let diagnostics = 0, rebases = 0;
  for (const [patch, prefix] of [[{ e: 1 }, "Invalid elliptical orbit"], [{ a: 1e40 }, "Orbit exceeds rendering precision"]]) {
    for (const [sourceIndex, disc] of [[0, REFERENCE_JED + 1], [2, REFERENCE_JED - 1]]) {
      const data = [catalog[0], catalog[0], catalog[0]].map(d => ({ ...d, disc: REFERENCE_JED }));
      data[sourceIndex] = { ...data[sourceIndex], ...patch, disc };
      let error;
      try { app.setAsteroids(data); } catch (caught) { error = caught.message; }
      check(error === `${prefix} at catalogue entry ${sourceIndex + 1}.`, `Original row through setAsteroids: ${error}`);
      check(app.asteroids === cloud && !cloud.destroyed && buffers.every(b => !b.destroyed), "Rejected preparation preserves live GPU resources");
      check(app.jed === before.jed && app.jedDelta === before.speed && app.elapsed === before.elapsed
        && app.asteroidsDiscovered === before.count && app.gui.count.textContent === before.countText
        && document.getElementById("orrery-status").textContent === before.status, "Rejected replacement leaves current scene and UI state intact");
      check(app.loadVersion === before.version && app.loadController === before.controller
        && app.stage.children.every((child, i) => child === before.children[i]), "Rejected replacement preserves load ownership and scene order");
      app.app.render();
      diagnostics++;
    }
  }
  const data = [3, 1, 2].map((a, i) => ({ ...catalog[0], a, epoch: REFERENCE_JED - 123,
    disc: REFERENCE_JED + (i === 0 ? 0.125 : 0) }));
  for (const jed of [REFERENCE_JED - 17.125, REFERENCE_JED + 19.25]) {
    app.jed = jed; app.setAsteroids(data); app.app.render();
    const current = app.asteroids, packed = prepareOrbits(data, jed);
    const bases = current.geometry.getBuffer("aBasis").data;
    const phases = current.phases.slice(), dates = current.discoveryDates.slice();
    check(current.epoch === packed.epoch && current.epoch === jed && current.markerEpoch === before.elapsed,
      "Packing date and elapsed marker epoch remain distinct");
    check(current.uniforms.uOrbitTime === 0, "New mesh starts at its packed phase date");
    for (const date of [jed + REBASE_DAYS, jed + REBASE_DAYS + 0.125, jed - REBASE_DAYS - 0.125]) {
      app.jed = date; app.tick(); app.app.render();
      const expected = prepareOrbits(data, current.epoch);
      check(current.geometry.getBuffer("aMeanAnomaly").data.every((value, i) => value === expected.meanAnomalies[i]), "Real mesh rebase matches freshly prepared phases");
      check(current.geometry.getBuffer("aElements").data.every((value, i) => value === packed.elements[i])
        && bases.every((value, i) => value === packed.bases[i]) && current.phases.every((value, i) => value === phases[i])
        && current.discoveryDates.every((value, i) => value === dates[i]), "Rebase changes no elements, bases, canonical phases or discovery dates");
      check(current.uniforms.uOrbitTime === date - current.epoch && current.markerEpoch === before.elapsed, "Orbital rebasing leaves marker epoch alone");
      check(current.geometry.instanceCount === data.filter(d => d.disc <= date).length
        && Number(app.gui.count.textContent.replaceAll(",", "")) === current.geometry.instanceCount, "Rebased discovery count reaches draw and UI");
      rebases++;
    }
  }
  app.jed = before.jed; app.setAsteroids(catalog); app.app.render();
  check(cloud.destroyed && buffers.every(b => b.destroyed), "A valid replacement after failures disposes the old mesh");
  return { originalRowFailures: diagnostics, phaseDates: 2, rebaseBoundaries: rebases };
});

exports.exercisePreparationLoading = async (page, url) => {
  const record = await page.evaluate(() => ({ ...fixture.catalog[0], disc: fixture.app.jed - 1 }));
  for (const patch of [{ e: 1 }, { a: 1e40 }]) {
    await page.route("**/preparation-invalid", route => route.fulfill({ contentType: "application/json",
      body: JSON.stringify([record, { ...record, ...patch, disc: record.disc - 1 }]) }));
    await page.evaluate(async url => {
      const { app } = fixture, cloud = app.asteroids, count = app.asteroidsDiscovered;
      if (await app.loadAsteroids(url + "/preparation-invalid")) throw new Error("Invalid preparation load succeeded");
      app.app.render();
      if (app.asteroids !== cloud || cloud.destroyed || app.asteroidsDiscovered !== count
        || !document.getElementById("orrery-status").textContent.includes("Unable")) throw new Error("Failed preparation load discarded working state or feedback");
    }, url);
    await page.unroute("**/preparation-invalid");
  }
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("**/preparation-valid", async route => { await gate;
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([record, { ...record, a: record.a + 1 }]) }); });
  await page.evaluate(url => { window.preparationLoad = fixture.app.loadAsteroids(url + "/preparation-valid"); }, url);
  const pending = await page.evaluate(() => {
    const { app, catalog } = fixture, controller = app.loadController, version = app.loadVersion;
    let rejected = false;
    try { app.setAsteroids([{ ...catalog[0], a: 1e40 }]); } catch { rejected = true; }
    return rejected && app.loadController === controller && app.loadVersion === version && !controller.signal.aborted;
  });
  release();
  assert(pending, "Rejected synchronous preparation leaves the pending valid fetch alive");
  assert(await page.evaluate(() => preparationLoad), "Valid pending response replaces the failed catalogue");
  assert.deepEqual(await page.evaluate(() => {
    const { app } = fixture; app.app.render();
    return [app.asteroids.discoveryDates.length, app.asteroidsDiscovered, app.gui.count.textContent,
      document.getElementById("orrery-status").textContent];
  }), [2, 2, "2", ""]);
  await page.unroute("**/preparation-valid");
  return { rejectedLoads: 2, validPendingRecovery: true };
};
