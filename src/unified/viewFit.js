import { PIXELS_PER_AU } from "../js/constants.js";
import { TROJAN_A_MAX } from "./catalog/population.js";

export const TROJAN_FIT_PADDING = 1.08;
export const VIEW_FIT_MS = 500;
// Every group has a frame, and choosing it eases the camera in or out to fit.
// The radius fills half of the shorter viewport side, so a landscape window
// shows more to the left and right. Hungarias: Mars and the inner belt edge,
// which holds every Hungaria aphelion. Near Earth, the belt and its zones: the
// belt edge with room for eccentric orbits; 2.5 AU cut a quarter of the Near
// Earth positions off. All, Hildas, Trojans and Without the belt: Jupiter's
// orbit. Distant: Neptune's distance, without adding the planet.
export const HUNGARIA_FIT_AU = 2.5;
export const BELT_FIT_AU = 3.5;
export const NEA_FIT_AU = BELT_FIT_AU;
export const NEPTUNE_FIT_AU = 30.1;
const SCALE_SNAP = 1.02;
const DIST_SNAP = 8;

export function easeOutCubic(t) {
  return 1 - (1 - t) ** 3;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function lerp3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

export function trojanFitRadiusPx(padding = TROJAN_FIT_PADDING) {
  return TROJAN_A_MAX * PIXELS_PER_AU * padding;
}

export function distantFitRadiusPx(padding = TROJAN_FIT_PADDING) {
  return NEPTUNE_FIT_AU * PIXELS_PER_AU * padding;
}

const BELT_PRESETS = new Set(["nea", "belt", "belt-inner", "belt-middle", "belt-outer"]);
const JUPITER_PRESETS = new Set(["all", "hildas", "trojans", "without-belt"]);

export function presetFitRadiusPx(preset, padding = TROJAN_FIT_PADDING) {
  if (preset === "hungarias") return HUNGARIA_FIT_AU * PIXELS_PER_AU * padding;
  if (BELT_PRESETS.has(preset)) return BELT_FIT_AU * PIXELS_PER_AU * padding;
  if (preset === "distant") return distantFitRadiusPx(padding);
  if (JUPITER_PRESETS.has(preset)) return trojanFitRadiusPx(padding);
  return null;
}

// A view that already fits within the snap tolerance is left alone; otherwise
// the fit moves in or out to the exact frame.
function pixiTargetScale(radius, viewWidth, viewHeight, sunX, sunY, currentScale) {
  const room = Math.min(sunX, viewWidth - sunX, sunY, viewHeight - sunY);
  if (!(room > 0) || !(radius > 0) || !(currentScale > 0)) return null;
  const needed = room / radius;
  return Math.abs(currentScale / needed - 1) > SCALE_SNAP - 1 ? needed : null;
}

export function pixiPresetTargetScale(preset, viewWidth, viewHeight, sunX, sunY, currentScale) {
  const radius = presetFitRadiusPx(preset);
  return radius == null ? null : pixiTargetScale(radius, viewWidth, viewHeight, sunX, sunY, currentScale);
}

export function pixiTrojanTargetScale(viewWidth, viewHeight, sunX, sunY, currentScale) {
  return pixiTargetScale(trojanFitRadiusPx(), viewWidth, viewHeight, sunX, sunY, currentScale);
}

export function pixiDistantTargetScale(viewWidth, viewHeight, sunX, sunY, currentScale) {
  return pixiTargetScale(distantFitRadiusPx(), viewWidth, viewHeight, sunX, sunY, currentScale);
}

export function perspectiveDistanceToFit(radius, fovDeg, aspect, zoom = 1) {
  const halfV = (fovDeg * Math.PI / 180) / 2;
  const halfH = Math.atan(Math.tan(halfV) * Math.max(aspect, 1e-6));
  const half = Math.min(halfV, halfH);
  if (!(half > 0) || !(radius > 0)) return null;
  return (radius / Math.tan(half)) * Math.max(zoom, 1e-6);
}

function hypot3(v) { return Math.hypot(v[0], v[1], v[2]); }

function normalize3(v) {
  const mag = hypot3(v);
  return mag > 1e-8 ? [v[0] / mag, v[1] / mag, v[2] / mag] : null;
}

function minHalfFov(fovDeg, aspect, zoom = 1) {
  const halfV = (fovDeg * Math.PI / 180) / 2;
  const halfH = Math.atan(Math.tan(halfV) * Math.max(aspect, 1e-6));
  return Math.atan(Math.tan(Math.min(halfV, halfH)) / Math.max(zoom, 1e-6));
}

export function threeTrojanTargetPose(position, target, fovDeg, aspect, zoom = 1) {
  return threeFitPose(position, target, fovDeg, aspect, zoom, trojanFitRadiusPx());
}

export function threeDistantTargetPose(position, target, fovDeg, aspect, zoom = 1) {
  return threeFitPose(position, target, fovDeg, aspect, zoom, distantFitRadiusPx());
}

export function threePresetTargetPose(preset, position, target, fovDeg, aspect, zoom = 1) {
  const radius = presetFitRadiusPx(preset);
  return radius == null ? null : threeFitPose(position, target, fovDeg, aspect, zoom, radius);
}

function threeFitPose(position, target, fovDeg, aspect, zoom, radius) {
  const needed = perspectiveDistanceToFit(radius, fovDeg, aspect, zoom);
  if (needed == null) return null;
  const fromSun = normalize3(position);
  const fromTarget = normalize3([
    position[0] - target[0], position[1] - target[1], position[2] - target[2],
  ]);
  const direction = fromSun ?? fromTarget;
  if (!direction) return null;
  const distFromSun = hypot3(position);
  const viewDir = fromTarget
    ? [-fromTarget[0], -fromTarget[1], -fromTarget[2]]
    : [-direction[0], -direction[1], -direction[2]];
  const sunDir = distFromSun > 1e-8
    ? [-position[0] / distFromSun, -position[1] / distFromSun, -position[2] / distFromSun]
    : viewDir;
  const lookDotSun = Math.min(1, Math.max(-1,
    viewDir[0] * sunDir[0] + viewDir[1] * sunDir[1] + viewDir[2] * sunDir[2]));
  const sunAngle = Math.acos(lookDotSun);
  const angRadius = distFromSun > radius ? Math.atan(radius / distFromSun) : Math.PI;
  const half = minHalfFov(fovDeg, aspect, zoom);
  const fitted = Math.abs(distFromSun - needed) <= DIST_SNAP;
  if (fitted && sunAngle + angRadius <= half + 1e-4) return null;
  const distance = needed;
  return {
    position: [direction[0] * distance, direction[1] * distance, direction[2] * distance],
    target: [0, 0, 0],
  };
}
