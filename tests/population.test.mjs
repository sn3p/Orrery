import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { prepareCatalogue } from "../src/unified/catalog/prepareCatalogue.js";
import {
  CLASS_BELT, CLASS_DISTANT, CLASS_NEA, CLASS_TROJAN, DEFAULT_POPULATION_PRESET,
  POPULATION_PRESET_OPTIONS, advanceClassTallies, classifyOrbit, isPopulationPreset,
  populationHint, populationMask, resyncClassTallies, visibleFromTallies,
} from "../src/unified/catalog/population.js";
import PixiRenderer from "../src/unified/pixi/PixiRenderer.js";
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

test("both asteroid adapters rewind tallies incrementally", () => {
  for (const file of ["../src/unified/pixi/Asteroids.js", "../src/unified/three/Asteroids.js"]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    const body = source.slice(source.indexOf("syncTallies(count)"), source.indexOf("captureFrame"));
    assert.match(body, /advanceClassTallies/, file);
    assert.doesNotMatch(body, /resyncClassTallies/, file);
  }
});
