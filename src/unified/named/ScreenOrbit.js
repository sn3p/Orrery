// Project immutable scientific samples into retained screen-space stroke buffers.
// Depth clipping bounds projection before Float32 upload, including
// outer orbits which cross the camera or the near plane.
export const ORBIT_DASH = 5;
export const ORBIT_GAP = 3;
export const ORBIT_WIDTH = 1; // Backing-store pixels; dash/gap lengths remain CSS pixels.
const PERIOD = ORBIT_DASH + ORBIT_GAP;
const screenPlanes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]];
const depthPlanes = [[0, 0, 1], [0, 0, -1]];
function clip(a, b, planes) {
  let first = 0, last = 1;
  for (const plane of planes) {
    const da = plane[0] * a[0] + plane[1] * a[1] + plane[2] * a[2] + a[3];
    const db = plane[0] * b[0] + plane[1] * b[1] + plane[2] * b[2] + b[3];
    if (da < 0 && db < 0) return false;
    if (da < 0) first = Math.max(first, da / (da - db));
    if (db < 0) last = Math.min(last, da / (da - db));
  }
  if (last < first) return false;
  for (let k = 0; k < 4; k++) {
    const start = a[k], delta = b[k] - start;
    a[k] = start + delta * first; b[k] = start + delta * last;
  }
  return a[3] > 0 && b[3] > 0;
}

function transform(points, index, matrix, out) {
  const x = points[index], y = points[index + 1], z = points[index + 2];
  for (let k = 0; k < 4; k++) out[k] = matrix[k] * x + matrix[k + 4] * y + matrix[k + 8] * z + matrix[k + 12];
}
function vertex(data, cursor, x, y, z, distance) {
  data[cursor] = x; data[cursor + 1] = y; data[cursor + 2] = z; data[cursor + 3] = distance;
  return cursor + 4;
}

export class ScreenOrbit {
  constructor(points) {
    this.points = points;
    this.vertices = new Float32Array((points.length / 3 - 1) * 6 * 4);
    this.signature = new Float64Array(19).fill(NaN);
    this.start = new Float64Array(4); this.end = new Float64Array(4);
    this.count = 0; this.updateSize = 0; this.revision = 0;
  }
  update(matrix, width, height, pixelRatio = 1) {
    if (!(width > 0 && height > 0 && pixelRatio > 0 && Number.isFinite(pixelRatio))) return false;
    let unchanged = this.signature[16] === width && this.signature[17] === height && this.signature[18] === pixelRatio;
    for (let i = 0; unchanged && i < 16; i++) unchanged = matrix[i] === this.signature[i];
    if (unchanged) return false;
    this.signature.set(matrix); this.signature[16] = width; this.signature[17] = height; this.signature[18] = pixelRatio;
    const data = this.vertices;
    const previousSize = this.count * 4;
    let cursor = 0, phase = 0;
    for (let i = 0; i < this.points.length - 3; i += 3) {
      const a = this.start, b = this.end;
      transform(this.points, i, matrix, a); transform(this.points, i + 3, matrix, b);
      // Anchor phase to the path, including off-screen segments. Only depth
      // discontinuities reset it: projecting through the camera is undefined.
      if (!clip(a, b, depthPlanes)) { phase = 0; continue; }
      const originX = a[0] / a[3], originY = a[1] / a[3];
      const fullLength = Math.hypot((b[0] / b[3] - originX) * width / 2, (b[1] / b[3] - originY) * height / 2);
      if (!Number.isFinite(fullLength)) { phase = 0; continue; }
      const startPhase = phase;
      phase = (phase + fullLength % PERIOD) % PERIOD;
      if (!clip(a, b, screenPlanes)) continue;
      const ax = a[0] / a[3], ay = a[1] / a[3], az = a[2] / a[3];
      const bx = b[0] / b[3], by = b[1] / b[3], bz = b[2] / b[3];
      const skipped = Math.hypot((ax - originX) * width / 2, (ay - originY) * height / 2);
      const visiblePhase = (startPhase + skipped % PERIOD) % PERIOD;
      const dx = (bx - ax) * width / 2, dy = (by - ay) * height / 2, length = Math.hypot(dx, dy);
      if (!(length > 1e-8 && Number.isFinite(length))) continue;
      // Extrude one backing-store-pixel-wide quad, retaining the lighter high-DPI stroke.
      // Linear screen-space interpolation keeps
      // both dash length and gap independent of perspective and backing-buffer DPR.
      const nx = -dy / length * ORBIT_WIDTH / (width * pixelRatio), ny = dx / length * ORBIT_WIDTH / (height * pixelRatio);
      cursor = vertex(data, cursor, ax + nx, ay + ny, az, visiblePhase);
      cursor = vertex(data, cursor, ax - nx, ay - ny, az, visiblePhase);
      cursor = vertex(data, cursor, bx + nx, by + ny, bz, visiblePhase + length);
      cursor = vertex(data, cursor, bx + nx, by + ny, bz, visiblePhase + length);
      cursor = vertex(data, cursor, ax - nx, ay - ny, az, visiblePhase);
      cursor = vertex(data, cursor, bx - nx, by - ny, bz, visiblePhase + length);
    }
    // The active prefix was overwritten. Only previously drawn triangles in
    // the now-unused tail need clearing (Pixi draws the allocated capacity).
    data.fill(0, cursor, previousSize);
    this.updateSize = Math.max(cursor, previousSize);
    this.count = cursor / 4; this.revision++;
    return true;
  }
}

export const orbitFragment = `
precision highp float;
varying float vDistance;
void main() {
  if (mod(vDistance, ${PERIOD}.0) > ${ORBIT_DASH}.0) discard;
  gl_FragColor = vec4(vec3(0.2), 1.0);
}`;
