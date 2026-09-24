import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { prepareCatalogue, REFERENCE_JED } from "../src/unified/catalog/prepareCatalogue.js";
import {
  CLASS_BELT, CLASS_DISTANT, CLASS_NEA, CLASS_REST_COLOR, CLASS_TROJAN, DEFAULT_POPULATION_PRESET,
  POPULATION_PRESET_OPTIONS, advanceClassTallies, classifyOrbit, highlightMask,
  isPopulationPreset, legendGroups, populationHint, populationMask, resyncClassTallies, visibleFromTallies,
} from "../src/unified/catalog/population.js";
import PixiRenderer from "../src/unified/pixi/PixiRenderer.js";
import Asteroids from "../src/unified/three/Asteroids.js";
import ThreeRenderer from "../src/unified/three/ThreeRenderer.js";

const sample = {
  a: 2.7, e: 0.1, i: 10, W: 25, w: 40, M: 80, n: 0.2,
  epoch: 2451544.5, disc: 2451544.5,
};

test("orbit-shape cuts follow the Phase 1 class ids", () => {
  assert.equal(classifyOrbit(1.0, 0.2), CLASS_NEA);
  assert.equal(classifyOrbit(2.5, 0.6), CLASS_NEA);
  assert.equal(classifyOrbit(5.2, 0.1), CLASS_TROJAN);
  assert.equal(classifyOrbit(5.204, 0.1), CLASS_TROJAN);
  assert.equal(classifyOrbit(5.4, 0.1), CLASS_DISTANT);
  assert.equal(classifyOrbit(20, 0.05), CLASS_DISTANT);
  assert.equal(classifyOrbit(5.2, 0.3), CLASS_BELT);
  assert.equal(classifyOrbit(5.3, 0.3), CLASS_DISTANT);
  assert.equal(classifyOrbit(4.8, 0.1), CLASS_BELT);
  assert.equal(classifyOrbit(2.7, 0.1), CLASS_BELT);
});

test("Jupiter Trojans are not the main belt and stay visible without it", () => {
  assert.equal(classifyOrbit(5.2, 0.1), CLASS_TROJAN);
  assert.equal(populationMask("without-belt") & (1 << CLASS_TROJAN), 1 << CLASS_TROJAN);
  assert.equal(populationMask("without-belt") & (1 << CLASS_BELT), 0);
  assert.equal(populationMask("all") & (1 << CLASS_TROJAN), 1 << CLASS_TROJAN);
  assert.equal(visibleFromTallies(Uint32Array.from([0, 0, 4, 0, 10]), "without-belt"), 4);
  assert.equal(visibleFromTallies(Uint32Array.from([0, 0, 4, 0, 10]), "all"), 14);
});

test("group colors keep the belt visible and reserve green for highlighted arrivals", () => {
  assert.equal(CLASS_REST_COLOR[CLASS_NEA], 0x2ec4b6);
  assert.equal(CLASS_REST_COLOR[CLASS_TROJAN], 0xd4a017);
  assert.equal(CLASS_REST_COLOR[CLASS_DISTANT], 0xa78bfa);
  // Group colors never changes which points are drawn; the menu owns that.
  for (const preset of ["all", "nea", "trojans", "distant", "without-belt"]) {
    assert.equal(highlightMask(preset), 0);
    assert.equal(highlightMask(preset, true) & ~populationMask(preset), 0, `${preset} colors only drawn points`);
    assert.equal(highlightMask(preset, true) & (1 << CLASS_BELT), 0, `${preset} keeps the belt gray`);
  }
  assert.equal(highlightMask("nea", true), 1 << CLASS_NEA);
  assert.equal(highlightMask("trojans", true), 1 << CLASS_TROJAN);
  assert.equal(highlightMask("distant", true), 1 << CLASS_DISTANT);
  assert.equal(highlightMask("without-belt", true) & (1 << CLASS_BELT), 0);
  assert.equal(highlightMask("without-belt", true) & (1 << CLASS_TROJAN), 1 << CLASS_TROJAN);
  const minority = (1 << CLASS_NEA) | (1 << CLASS_TROJAN) | (1 << CLASS_DISTANT);
  assert.equal(highlightMask("all", true), minority);
  assert.equal(highlightMask("nea", true), 1 << CLASS_NEA);
  assert.deepEqual(legendGroups("all", false), []);
  assert.deepEqual(legendGroups("all", true).map(group => group.name),
    ["Near Earth", "Jupiter Trojans", "Distant"]);
  assert.deepEqual(legendGroups("trojans", true).map(group => group.name), ["Jupiter Trojans"]);
  const pixi = fs.readFileSync(new URL("../src/unified/pixi/Asteroids.js", import.meta.url), "utf8");
  const three = fs.readFileSync(new URL("../src/unified/three/Asteroids.js", import.meta.url), "utf8");
  assert.match(pixi, /vec3 arrival = vec3\(0\.0, 1\.0, 0\.0\)/);
  assert.match(pixi, /1\.0 \/ pixelsPerUnit/);
  assert.doesNotMatch(pixi, /vec3\(1\.0\)/);
  assert.match(three, /freshColor/);
  assert.match(three, /0x00ff00/);
  assert.doesNotMatch(three, /vec3\(1\.0\)/);
  assert.match(three, /depthWrite: false/);
  assert.match(three, /depthTest: true/);
  assert.doesNotMatch(three, /onAfterRender/);
  assert.match(three, /pass: \{ value: 1 \}/);
});

test("presets validate, default to All, and do not persist a storage key", () => {
  assert.equal(DEFAULT_POPULATION_PRESET, "all");
  assert.deepEqual(Object.values(POPULATION_PRESET_OPTIONS),
    ["all", "nea", "trojans", "distant", "without-belt"]);
  assert.deepEqual(["all", "nea", "trojans", "distant", "without-belt", "belt", "", null].map(isPopulationPreset),
    [true, true, true, true, true, false, false, false]);
  assert.equal(populationMask("all"), 31);
  assert.equal(populationMask("nea"), 1 << CLASS_NEA);
  assert.equal(populationMask("without-belt"), 31 ^ (1 << CLASS_BELT));
  assert.equal(populationMask("unknown"), populationMask("all"));
  assert.match(populationHint("trojans"), /2000s/);
  assert.match(populationHint("nea"), /sample/);
});

test("prepareCatalogue classifies the discovery-sorted prefix and tallies match the draw range", () => {
  const records = [
    { ...sample, a: 2.7, e: 0.1, disc: 2451544.5 },
    { ...sample, a: 1.0, e: 0.2, disc: 2451545.5 },
    { ...sample, a: 5.2, e: 0.05, disc: 2451546.5 },
    { ...sample, a: 20, e: 0.1, disc: 2451547.5 },
  ];
  const model = prepareCatalogue(records);
  assert.deepEqual([...model.classes.subarray(0, model.count)],
    [CLASS_BELT, CLASS_NEA, CLASS_TROJAN, CLASS_DISTANT]);
  const discovered = model.count;
  const all = resyncClassTallies(model.classes, discovered, "all");
  assert.equal(all.visibleCount, discovered);
  assert.equal(visibleFromTallies(all.tallies, "nea"), 1);
  assert.equal(visibleFromTallies(all.tallies, "trojans"), 1);
  assert.equal(visibleFromTallies(all.tallies, "distant"), 1);
  assert.equal(visibleFromTallies(all.tallies, "without-belt"), 3);
  const rewind = advanceClassTallies(model.classes, discovered, 1, "without-belt", all.tallies);
  assert.equal(rewind.visibleCount, 0);
  assert.equal(rewind.tallyCount, 1);
  assert.deepEqual([...rewind.tallies], [...resyncClassTallies(model.classes, 1, "without-belt").tallies]);
  const recovered = advanceClassTallies(model.classes, 4, 1, "all", new Uint32Array(5));
  assert.equal(recovered.visibleCount, 1);
  assert.deepEqual([...recovered.tallies], [...resyncClassTallies(model.classes, 1, "all").tallies]);
  const forward = advanceClassTallies(model.classes, 1, discovered, "nea", rewind.tallies);
  assert.equal(forward.tallyCount, discovered);
  assert.equal(forward.visibleCount, 1);
});

test("both renderers apply a population preset without touching other shared options", () => {
  for (const Renderer of [PixiRenderer, ThreeRenderer]) {
    const calls = [], cloud = {
      preset: "all",
      setPopulationPreset(value) { this.preset = value; calls.push(value); },
    };
    const receiver = {
      planetLabelMode: "earth",
      planetLabels: { setMode() { calls.push("labels"); } },
      planets: [],
      planetOrbits: [],
      planetOrbitsVisible: true,
      populationPreset: "all",
      asteroids: cloud,
      stagedAsteroids: cloud,
      catalogueTransition: { previous: cloud },
      requestRender() { calls.push("render"); },
    };
    Renderer.prototype.setOptions.call(receiver, { shared: { planetOrbits: true } });
    assert.deepEqual(calls, []);
    Renderer.prototype.setOptions.call(receiver, { shared: { populationPreset: "trojans" } });
    assert.equal(receiver.populationPreset, "trojans");
    assert.equal(cloud.preset, "trojans");
    assert.deepEqual(calls, ["trojans", "trojans", "trojans", "render"]);
    Renderer.prototype.setOptions.call(receiver, { shared: { populationPreset: "trojans" } });
    assert.equal(calls.length, 4, "Applying the active preset is inert");
    assert.throws(() => Renderer.prototype.setOptions.call(receiver,
      { shared: { populationPreset: "belt" } }), RangeError);
    assert.equal(receiver.populationPreset, "trojans");
    assert.throws(() => Renderer.prototype.setOptions.call(receiver,
      { shared: { planetLabels: "all", populationPreset: "nope" } }), RangeError);
    assert.equal(receiver.planetLabelMode, "earth", "Invalid combined settings are rejected atomically");
    assert.throws(() => Renderer.prototype.setOptions.call(receiver,
      { shared: { colorizeGroups: "yes" } }), RangeError);
    assert.equal(receiver.populationPreset, "trojans");
  }
});

test("group colors update the highlight without changing the group", () => {
  const cloud = new Asteroids(prepareCatalogue([sample]), { jed: REFERENCE_JED, elapsed: 0 });
  assert.equal(cloud.material.depthWrite, false);
  assert.equal(cloud.highlight.material.depthTest, true);
  assert.equal(cloud.highlight.material.depthWrite, false);
  assert.notEqual(cloud.material, cloud.highlight.material);
  assert.equal(cloud.uniforms.pass.value, 0);
  assert.equal(cloud.highlightUniforms.pass.value, 1);
  assert.equal(cloud.uniforms.colorMask, cloud.highlightUniforms.colorMask);
  assert.equal(cloud.visible, true);
  assert.equal(cloud.highlight.visible, false);
  cloud.setColorize(true);
  assert.equal(cloud.uniforms.colorMask.value, (1 << CLASS_NEA) | (1 << CLASS_TROJAN) | (1 << CLASS_DISTANT));
  assert.equal(cloud.highlight.visible, true);
  cloud.setPopulationPreset("nea");
  // The menu owns the drawn set; group colors only paint it.
  assert.equal(cloud.uniforms.classMask.value, 1 << CLASS_NEA);
  assert.equal(cloud.uniforms.colorMask.value, 1 << CLASS_NEA);
  cloud.setColorize(false);
  assert.equal(cloud.populationPreset, "nea");
  assert.equal(cloud.uniforms.classMask.value, 1 << CLASS_NEA);
  assert.equal(cloud.uniforms.colorMask.value, 0);
  assert.equal(cloud.highlight.visible, false);
  cloud.destroy();

  for (const Renderer of [PixiRenderer, ThreeRenderer]) {
    const calls = [];
    const painted = {
      setColorize(value) { calls.push(value); },
    };
    const receiver = {
      planetLabelMode: "earth",
      planetOrbitsVisible: true,
      populationPreset: "all",
      colorizeGroups: false,
      asteroids: painted,
      stagedAsteroids: null,
      catalogueTransition: null,
      requestRender() { calls.push("render"); },
    };
    Renderer.prototype.setOptions.call(receiver, { shared: { colorizeGroups: true } });
    assert.equal(receiver.colorizeGroups, true);
    assert.deepEqual(calls, [true, "render"]);
    Renderer.prototype.setOptions.call(receiver, { shared: { colorizeGroups: true } });
    assert.deepEqual(calls, [true, "render"]);
  }
});

test("Three hides masked points by clipping and discard, not point size alone", () => {
  const source = fs.readFileSync(new URL("../src/unified/three/Asteroids.js", import.meta.url), "utf8");
  assert.match(source, /vColor = vec4\(/);
  assert.match(source, /gl_Position = vec4\(2\.0, 2\.0, 2\.0, 1\.0\)/);
  assert.match(source, /if \(vColor\.a < 0\.5\) discard/);
  assert.match(source, /pulseTime - arrival/);
  assert.match(source, /3\.0 - 3\.0 \* age/);
  assert.doesNotMatch(source, /vPopulationVisible/);
});

test("Three stamps a forward discovery pulse and suppresses seek, switch and restored frames", () => {
  const cloud = new Asteroids(prepareCatalogue([
    { ...sample, disc: REFERENCE_JED, epoch: REFERENCE_JED },
    { ...sample, a: 2.8, disc: REFERENCE_JED + 1, epoch: REFERENCE_JED },
  ]), { jed: REFERENCE_JED - 1, elapsed: 0 });
  const arrivals = cloud.geometry.attributes.arrival.array;
  assert.equal(cloud.geometry.drawRange.count, 0);
  assert.equal(arrivals[0], -1);
  assert.equal(arrivals[1], -1);

  cloud.update(REFERENCE_JED, 0.25);
  assert.equal(cloud.geometry.drawRange.count, 1);
  assert.equal(arrivals[0], 0.25);
  assert.equal(cloud.uniforms.pulseTime.value, 0.25);
  assert.equal(arrivals[1], -1);

  cloud.update(REFERENCE_JED + 1, 1, { baseline: true });
  assert.equal(cloud.geometry.drawRange.count, 2);
  assert.equal(arrivals[0], -1);
  assert.equal(arrivals[1], -1);

  cloud.update(REFERENCE_JED - 1, 1.5);
  cloud.update(REFERENCE_JED, 1.5);
  assert.equal(arrivals[0], 1.5, "Rewind then forward restamps the pulse");

  ThreeRenderer.prototype.restoreDiscoveries.call({ asteroids: cloud });
  assert.equal(arrivals[0], -1);
  assert.equal(arrivals[1], -1);
  assert.equal(cloud.geometry.drawRange.count, 1, "Switch restoration ends the pulse without hiding the prefix");

  const snapshot = cloud.captureFrame(REFERENCE_JED + 1, 2);
  cloud.update(REFERENCE_JED + 1, 2);
  assert.equal(arrivals[1], 2);
  cloud.restoreFrame(snapshot);
  assert.equal(cloud.geometry.drawRange.count, 1);
  assert.equal(arrivals[1], -1, "A restored frame does not keep the speculative pulse");
});

test("both asteroid adapters rewind tallies incrementally", () => {
  for (const file of ["../src/unified/pixi/Asteroids.js", "../src/unified/three/Asteroids.js"]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    const body = source.slice(source.indexOf("syncTallies(count)"), source.indexOf("captureFrame"));
    assert.match(body, /advanceClassTallies/, file);
    assert.doesNotMatch(body, /resyncClassTallies/, file);
  }
});
