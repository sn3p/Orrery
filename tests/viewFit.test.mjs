import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { PIXELS_PER_AU } from "../src/js/constants.js";
import { TROJAN_A_MAX } from "../src/unified/catalog/population.js";
import {
  BELT_FIT_AU, NEA_FIT_AU, TROJAN_FIT_PADDING, VIEW_FIT_MS, easeOutCubic, perspectiveDistanceToFit, pixiDistantTargetScale,
  pixiPresetTargetScale, pixiTrojanTargetScale, presetFitRadiusPx, threeDistantTargetPose, threePresetTargetPose,
  threeTrojanTargetPose, trojanFitRadiusPx, distantFitRadiusPx,
} from "../src/unified/viewFit.js";
import PixiRenderer from "../src/unified/pixi/PixiRenderer.js";
import ThreeRenderer from "../src/unified/three/ThreeRenderer.js";

function pixiStub(scale = 1, width = 800, height = 800) {
  const receiver = {
    destroyed: false,
    viewFit: null,
    viewWidth: width,
    viewHeight: height,
    stage: {
      position: { x: width / 2, y: height / 2 },
      get x() { return this.position.x; },
      get y() { return this.position.y; },
      scale: { x: scale, y: scale, set(value) { this.x = this.y = value; } },
    },
  };
  Object.setPrototypeOf(receiver, PixiRenderer.prototype);
  return receiver;
}

function threeStub({
  position = [500, 500, 400], target = [0, 0, 0], aspect = 1.6, fov = 60, zoom = 1,
} = {}) {
  const pos = position.slice(), tgt = target.slice();
  const receiver = {
    destroyed: false,
    viewFit: null,
    viewFitInternal: false,
    camera: {
      fov, aspect, zoom,
      position: {
        toArray() { return pos.slice(); },
        fromArray(value) { pos.splice(0, 3, ...value); },
      },
      up: { toArray() { return [0, 0, 1]; } },
      quaternion: { toArray() { return [0, 0, 0, 1]; } },
    },
    controls: {
      target: {
        toArray() { return tgt.slice(); },
        fromArray(value) { tgt.splice(0, 3, ...value); },
      },
      updates: 0,
      update() { this.updates++; },
    },
  };
  Object.setPrototypeOf(receiver, ThreeRenderer.prototype);
  return receiver;
}

test("2D fit frames Jupiter's orbit from either side and leaves a fitted view alone", () => {
  const needed = pixiTrojanTargetScale(800, 800, 400, 400, 1);
  assert.ok(needed > 0 && needed < 1);
  assert.equal(pixiTrojanTargetScale(800, 800, 400, 400, needed), null);
  assert.equal(pixiTrojanTargetScale(800, 800, 400, 400, needed * 1.01), null);
  assert.equal(pixiTrojanTargetScale(800, 800, 400, 400, 0.2), needed, "zooms back in");
  assert.ok(pixiTrojanTargetScale(320, 568, 160, 284, 1) < needed);
});

test("every group has a frame; Near Earth is the inner system and All shares Jupiter's", () => {
  assert.equal(presetFitRadiusPx("nea"), NEA_FIT_AU * PIXELS_PER_AU * TROJAN_FIT_PADDING);
  assert.equal(presetFitRadiusPx("hungarias"), presetFitRadiusPx("nea"));
  for (const preset of ["belt", "belt-inner", "belt-middle", "belt-outer"]) {
    assert.equal(presetFitRadiusPx(preset), BELT_FIT_AU * PIXELS_PER_AU * TROJAN_FIT_PADDING, preset);
  }
  assert.ok(presetFitRadiusPx("belt") > presetFitRadiusPx("nea") && presetFitRadiusPx("belt") < trojanFitRadiusPx());
  assert.equal(presetFitRadiusPx("hildas"), trojanFitRadiusPx());
  assert.equal(presetFitRadiusPx("all"), trojanFitRadiusPx());
  assert.equal(presetFitRadiusPx("without-belt"), trojanFitRadiusPx());
  assert.equal(presetFitRadiusPx("trojans"), trojanFitRadiusPx());
  assert.equal(presetFitRadiusPx("distant"), distantFitRadiusPx());
  assert.equal(presetFitRadiusPx("nope"), null);
  assert.equal(pixiPresetTargetScale("nope", 800, 800, 400, 400, 1), null);
  assert.equal(threePresetTargetPose("nope", [500, 500, 400], [0, 0, 0], 60, 1.6, 1), null);
  assert.ok(pixiPresetTargetScale("nea", 800, 800, 400, 400, 1) > pixiTrojanTargetScale(800, 800, 400, 400, 1));
});

test("3D fit keeps the current side of the sun, dollies both ways, and skips a framed view", () => {
  const radius = trojanFitRadiusPx();
  const needed = perspectiveDistanceToFit(radius, 60, 1.6, 1);
  const start = [500, 500, 400];
  const pose = threeTrojanTargetPose(start, [0, 0, 0], 60, 1.6, 1);
  assert.ok(pose);
  assert.deepEqual(pose.target, [0, 0, 0]);
  const mag = Math.hypot(...pose.position);
  assert.ok(Math.abs(mag - needed) < 1e-6);
  assert.ok(Math.abs(pose.position[0] / mag - start[0] / Math.hypot(...start)) < 1e-12);
  const far = start.map(value => value * 4);
  const back = threeTrojanTargetPose(far, [0, 0, 0], 60, 1.6, 1);
  assert.ok(Math.abs(Math.hypot(...back.position) - needed) < 1e-6, "dollies back in");
  assert.equal(threeTrojanTargetPose(pose.position, [0, 0, 0], 60, 1.6, 1), null);
});

test("Pixi and Three frame each group in both directions and yield to a gesture", () => {
  const pixi = pixiStub(2);
  assert.equal(pixi.ensurePopulationView("nea", 0), true);
  pixi.advanceViewFit(VIEW_FIT_MS);
  const inner = pixi.stage.scale.x;
  assert.ok(inner < 2 && inner > 1, "Near Earth frames the inner system");
  pixi.stage.scale.set(2);
  assert.equal(pixi.ensurePopulationView("trojans", 0), true);
  assert.equal(pixi.viewAnimating, true);
  assert.equal(pixi.stage.scale.x, 2);
  pixi.advanceViewFit(VIEW_FIT_MS / 2);
  assert.ok(pixi.stage.scale.x < 2 && pixi.stage.scale.x > pixi.viewFit.to);
  pixi.advanceViewFit(VIEW_FIT_MS);
  assert.equal(pixi.viewAnimating, false);
  assert.ok(pixi.stage.scale.x < 1);

  const already = pixiStub(pixi.stage.scale.x);
  assert.equal(already.ensurePopulationView("trojans", 0), false);
  assert.equal(already.ensurePopulationView("all", 0), false, "All shares Jupiter's frame");
  assert.equal(already.ensurePopulationView("nea", 0), true);
  already.advanceViewFit(VIEW_FIT_MS);
  assert.equal(already.stage.scale.x, inner, "zooms back in to the inner system");

  const cancelled = pixiStub(3);
  cancelled.ensurePopulationView("trojans", 0);
  cancelled.advanceViewFit(VIEW_FIT_MS / 2);
  const mid = cancelled.stage.scale.x;
  cancelled.cancelViewFit();
  cancelled.advanceViewFit(VIEW_FIT_MS);
  assert.equal(cancelled.stage.scale.x, mid);
  assert.equal(cancelled.ensurePopulationView("all", 0), true, "a half-finished fit is not a fitted view");

  const three = threeStub();
  const start = three.camera.position.toArray();
  assert.equal(three.ensurePopulationView("nea", 0), true);
  three.advanceViewFit(VIEW_FIT_MS);
  assert.ok(Math.hypot(...three.camera.position.toArray()) < Math.hypot(...start), "dollies in for Near Earth");
  assert.equal(three.ensurePopulationView("trojans", 0), true);
  three.advanceViewFit(VIEW_FIT_MS);
  const end = three.camera.position.toArray();
  assert.ok(Math.hypot(...end) > Math.hypot(...start));
  assert.deepEqual(three.controls.target.toArray(), [0, 0, 0]);
  assert.equal(three.controls.updates > 0, true);
  assert.equal(three.viewAnimating, false);

  const distantPixi = pixiStub(2);
  assert.equal(distantPixi.ensurePopulationView("distant", 0), true);
  distantPixi.advanceViewFit(VIEW_FIT_MS);
  const trojanPixi = pixiStub(2);
  trojanPixi.ensurePopulationView("trojans", 0);
  trojanPixi.advanceViewFit(VIEW_FIT_MS);
  assert.ok(distantPixi.stage.scale.x < trojanPixi.stage.scale.x);
  assert.equal(pixiDistantTargetScale(800, 800, 400, 400, distantPixi.stage.scale.x), null);

  const distantThree = threeStub();
  assert.equal(distantThree.ensurePopulationView("distant", 0), true);
  distantThree.advanceViewFit(VIEW_FIT_MS);
  const trojanThree = threeStub();
  trojanThree.ensurePopulationView("trojans", 0);
  trojanThree.advanceViewFit(VIEW_FIT_MS);
  assert.ok(Math.hypot(...distantThree.camera.position.toArray())
    > Math.hypot(...trojanThree.camera.position.toArray()));
  assert.ok(distantFitRadiusPx() > trojanFitRadiusPx());
  assert.equal(threeDistantTargetPose(distantThree.camera.position.toArray(), [0, 0, 0], 60, 1.6, 1), null);
  const atNeptune = Math.hypot(...distantThree.camera.position.toArray());
  assert.equal(distantThree.ensurePopulationView("trojans", 0), true);
  distantThree.advanceViewFit(VIEW_FIT_MS);
  assert.ok(Math.hypot(...distantThree.camera.position.toArray()) < atNeptune, "comes back in to Jupiter");
});

test("capturing a view finishes an in-flight Trojan fit", () => {
  const pixi = pixiStub(3);
  pixi.ensurePopulationView("trojans", 0);
  pixi.advanceViewFit(VIEW_FIT_MS / 2);
  const mid = pixi.stage.scale.x;
  const view = pixi.captureView();
  assert.equal(pixi.viewAnimating, false);
  assert.ok(view.scale < mid);
  assert.equal(view.scale, pixi.stage.scale.x);

  const three = threeStub();
  three.ensurePopulationView("trojans", 0);
  three.advanceViewFit(VIEW_FIT_MS / 2);
  const midDist = Math.hypot(...three.camera.position.toArray());
  const captured = three.captureView();
  assert.equal(three.viewAnimating, false);
  assert.ok(Math.hypot(...captured.position) > midDist);
});

test("choosing Trojans frames the current renderer, not a later switch restore", () => {
  const app = fs.readFileSync(new URL("../src/unified/App.js", import.meta.url), "utf8");
  const pixi = fs.readFileSync(new URL("../src/unified/pixi/PixiRenderer.js", import.meta.url), "utf8");
  const three = fs.readFileSync(new URL("../src/unified/three/ThreeRenderer.js", import.meta.url), "utf8");
  assert.match(app, /ensurePopulationView\?\.\(value\)/);
  assert.match(app, /viewAnimating/);
  const pixiOptions = pixi.slice(pixi.indexOf("setOptions"), pixi.indexOf("get viewAnimating"));
  const threeOptions = three.slice(three.indexOf("setOptions"), three.indexOf("get viewAnimating"));
  assert.doesNotMatch(pixiOptions, /ensurePopulationView/);
  assert.doesNotMatch(threeOptions, /ensurePopulationView/);
  assert.equal(TROJAN_A_MAX * PIXELS_PER_AU * TROJAN_FIT_PADDING, trojanFitRadiusPx());
});

test("ease-out starts slow to leave and settles on the fitted view", () => {
  assert.equal(easeOutCubic(0), 0);
  assert.equal(easeOutCubic(1), 1);
  assert.ok(easeOutCubic(0.5) > 0.5);
});
