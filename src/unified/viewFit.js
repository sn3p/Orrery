import { PIXELS_PER_AU } from "../js/constants.js";
import { TROJAN_A_MAX } from "./catalog/population.js";

export const TROJAN_FIT_PADDING = 1.08;
export const VIEW_FIT_MS = 500;
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

export function pixiTrojanTargetScale(viewWidth, viewHeight, sunX, sunY, currentScale) {
  const room = Math.min(sunX, viewWidth - sunX, sunY, viewHeight - sunY);
  const radius = trojanFitRadiusPx();
  if (!(room > 0) || !(radius > 0) || !(currentScale > 0)) return null;
  const needed = room / radius;
  return currentScale > needed * SCALE_SNAP ? needed : null;
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
  const radius = trojanFitRadiusPx();
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
  if (distFromSun >= needed - DIST_SNAP && sunAngle + angRadius <= half) return null;
  const distance = Math.max(distFromSun, needed);
  return {
    position: [direction[0] * distance, direction[1] * distance, direction[2] * distance],
    target: [0, 0, 0],
  };
}
