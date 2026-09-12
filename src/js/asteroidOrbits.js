import { DEG_TO_RAD, PIXELS_PER_AU } from "./constants.js";

export const REFERENCE_JED = 2458600.5;
export const REBASE_DAYS = 256;
export const DISCOVERY_SECONDS = 2 / 3;
const TAU = 2 * Math.PI;
export const wrap = value => value - TAU * Math.floor((value + Math.PI) / TAU);

// Shared verbatim with the GPU numerical tests. Orbital bases already include
// Orrery's negative x / positive y projection and pixels-per-AU conversion.
export const orbitGLSL = `
vec2 orbitPosition(vec2 p, vec2 q, vec3 elements, float time) {
  float e = elements.x;
  float M = elements.y + elements.z * time;
  M -= 6.283185307179586 * floor((M + 3.141592653589793) / 6.283185307179586);
  float E = e < 0.8 ? M : sign(M) * 3.141592653589793;
  for (int k = 0; k < 12; k++) {
    E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
  }
  if (e >= 0.99) {
    for (int k = 0; k < 12; k++) {
      E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
    }
  }
  return p * (cos(E) - e) + q * sin(E);
}
`;

export function validDate(jed) {
  return Number.isFinite(jed) && Math.abs((jed - 2440587.5) * 86400000) <= 8.64e15;
}

export function prepareOrbits(data, jed) {
  if (!validDate(jed)) throw new Error("Invalid asteroid date.");
  if (!Array.isArray(data)) throw new Error("The asteroid catalogue must be an array.");
  for (let index = 0; index < data.length; index++) {
    const d = data[index];
    const valid = d && ["a", "e", "i", "W", "M", "epoch", "disc"].every(key => Number.isFinite(d[key]))
      && d.a > 0 && d.e >= 0 && d.e < 1 && Math.fround(d.e) < 1
      && Number.isFinite(d.wbar ?? d.w) && validDate(d.epoch) && validDate(d.disc)
      && (d.n == null ? Number.isFinite(d.P) && d.P > 0 : Number.isFinite(d.n) && d.n > 0);
    if (!valid) throw new Error(`Invalid elliptical orbit at catalogue entry ${index + 1}.`);
  }
  const sorted = data.slice().sort((a, b) => a.disc - b.disc);
  const count = sorted.length;
  const bases = new Float32Array(count * 4), elements = new Float32Array(count * 3);
  const phases = new Float64Array(count * 2), dates = new Float64Array(count);
  let radius = 0;
  sorted.forEach((d, index) => {
    const o = d.W * DEG_TO_RAD, w = ((d.wbar ?? d.w + d.W) - d.W) * DEG_TO_RAD;
    const inc = d.i * DEG_TO_RAD;
    const a = d.a * PIXELS_PER_AU, b = a * Math.sqrt(1 - d.e * d.e);
    const n = d.n == null ? TAU / d.P : d.n * DEG_TO_RAD;
    const mean = wrap(d.M * DEG_TO_RAD + n * (REFERENCE_JED - d.epoch));
    bases.set([
      -a * (Math.cos(o) * Math.cos(w) - Math.sin(o) * Math.sin(w) * Math.cos(inc)),
      a * (Math.sin(o) * Math.cos(w) + Math.cos(o) * Math.sin(w) * Math.cos(inc)),
      -b * (-Math.cos(o) * Math.sin(w) - Math.sin(o) * Math.cos(w) * Math.cos(inc)),
      b * (-Math.sin(o) * Math.sin(w) + Math.cos(o) * Math.cos(w) * Math.cos(inc)),
    ], index * 4);
    elements.set([d.e, wrap(mean + n * (jed - REFERENCE_JED)), n], index * 3);
    phases.set([mean, n], index * 2);
    dates[index] = d.disc;
    radius = Math.max(radius, a * (1 + d.e));
    if (!Number.isFinite(Math.fround(radius)) || !(Math.fround(a) > 0) || !(elements[index * 3 + 2] > 0)
      || !bases.subarray(index * 4, index * 4 + 4).every(Number.isFinite)
      || !elements.subarray(index * 3, index * 3 + 3).every(Number.isFinite)) {
      throw new Error(`Orbit exceeds rendering precision at catalogue entry ${index + 1}.`);
    }
  });
  return { bases, elements, phases, dates, radius };
}

export function discoveryCount(dates, jed) {
  let lo = 0, hi = dates.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (dates[mid] <= jed) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
