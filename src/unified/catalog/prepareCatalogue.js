import { DEG_TO_RAD, PIXELS_PER_AU } from "../../js/constants.js";

import { validDate, REBASE_DAYS, MAX_PHASE_ADVANCE } from "../../js/asteroidOrbits.js";
import { classifyOrbit } from "./population.js";

export const REFERENCE_JED = 2458600.5;
const TAU = 2 * Math.PI;
export const wrapPhase = value => value - TAU * Math.floor((value + Math.PI) / TAU);

export function allocateCatalogue(count, epoch = REFERENCE_JED) {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(epoch)) throw new Error("Invalid catalogue capacity.");
  return {
    p: new Float32Array(count * 3), q: new Float32Array(count * 3),
    elements: new Float32Array(count * 2), phases: new Float64Array(count * 2),
    dates: new Float64Array(count), rows: new Uint32Array(count),
    classes: new Uint8Array(count), radius: 0, epoch, count: 0,
  };
}

// Pure CPU preparation: no Three.js, DOM, fetch or GPU resource allocation.
// Adapted from the preserved Orrery3D preparation (MIT). Canonical 3D bases
// and Float64 phases are read-only to renderers. Mutable phase/marker packing
// belongs to the adapter. Source rows remain diagnosable within this pin.
export function prepareCatalogue(data, epoch = REFERENCE_JED, rowOffset = 0) {
  if (!validDate(epoch)) throw new Error("Invalid asteroid date.");
  if (!Array.isArray(data)) throw new Error("The asteroid catalogue must be an array.");
  // Reject invalid elements before allocating GPU resources or replacing a cloud.
  for (let index = 0; index < data.length; index++) {
    const d = data[index];
    const valid = d && ["a", "e", "i", "W", "M", "epoch", "disc"].every(key => Number.isFinite(d[key]))
      && d.a > 0 && d.e >= 0 && d.e < 1
      && Number.isFinite(d.wbar ?? d.w) && validDate(d.epoch) && validDate(d.disc)
      && (d.n == null ? Number.isFinite(d.P) && d.P > 0 : Number.isFinite(d.n) && d.n > 0);
    // Float32 must still represent an ellipse, even when e is extremely near 1.
    if (!valid || Math.fround(d.e) >= 1) throw new Error(`Invalid elliptical orbit at catalogue entry ${rowOffset + index + 1}.`);
  }
  // Sort row indices so errors still identify the original input entry.
  // Stable sorting also preserves source order for equal discovery dates.
  const sorted = Array.from({ length: data.length }, (_, index) => index)
    .sort((a, b) => data[a].disc - data[b].disc);
  const count = sorted.length;
  const { p, q, elements, phases, dates, rows, classes } = allocateCatalogue(count, epoch);
  let radius = 0;
  sorted.forEach((sourceIndex, index) => {
    const d = data[sourceIndex];
    const offset = index * 3;
    const o = d.W * DEG_TO_RAD;
    const w = ((d.wbar ?? d.w + d.W) - d.W) * DEG_TO_RAD;
    const inc = d.i * DEG_TO_RAD;
    const a = d.a * PIXELS_PER_AU, b = a * Math.sqrt(1 - d.e * d.e);
    const n = d.n == null ? TAU / d.P : d.n * DEG_TO_RAD;
    const mean = wrapPhase(d.M * DEG_TO_RAD + n * (REFERENCE_JED - d.epoch));
    p.set([
      a * (Math.cos(o) * Math.cos(w) - Math.sin(o) * Math.sin(w) * Math.cos(inc)),
      a * (Math.sin(o) * Math.cos(w) + Math.cos(o) * Math.sin(w) * Math.cos(inc)),
      a * Math.sin(w) * Math.sin(inc),
    ], offset);
    q.set([
      b * (-Math.cos(o) * Math.sin(w) - Math.sin(o) * Math.cos(w) * Math.cos(inc)),
      b * (-Math.sin(o) * Math.sin(w) + Math.cos(o) * Math.cos(w) * Math.cos(inc)),
      b * Math.cos(w) * Math.sin(inc),
    ], offset);
    elements.set([d.e, n], index * 2);
    phases.set([mean, n], index * 2);
    dates[index] = d.disc;
    rows[index] = rowOffset + sourceIndex;
    classes[index] = classifyOrbit(d.a, d.e);
    radius = Math.max(radius, a * (1 + d.e));
    let finite = Number.isFinite(Math.fround(radius)) && Math.fround(a) > 0
      && Number.isFinite(Math.fround(wrapPhase(mean + n * (epoch - REFERENCE_JED))))
      && elements[index * 2 + 1] > 0 && elements[index * 2 + 1] * REBASE_DAYS <= MAX_PHASE_ADVANCE && Number.isFinite(elements[index * 2])
      && Number.isFinite(elements[index * 2 + 1]);
    for (let axis = 0; axis < 3; axis++) {
      finite = finite && Number.isFinite(p[offset + axis]) && Number.isFinite(q[offset + axis]);
    }
    if (!finite) {
      throw new Error(`Orbit exceeds rendering precision at catalogue entry ${rowOffset + sourceIndex + 1}.`);
    }
  });
  return { p, q, elements, phases, dates, rows, classes, radius, epoch, count };
}

// Prepare a complete batch before touching retained state: invalid rows cannot
// leave a partially committed prefix. The source holds its processing slot.
export function appendCatalogue(model, records, start) {
  if (start !== model.count || start + records.length > model.dates.length) throw new Error("Noncontiguous catalogue commitment.");
  const packed = prepareCatalogue(records, model.epoch, start);
  for (const [key, stride] of Object.entries({ p: 3, q: 3, elements: 2, phases: 2, dates: 1, rows: 1, classes: 1 })) {
    model[key].set(packed[key], start * stride);
  }
  model.radius = Math.max(model.radius, packed.radius);
  model.count += records.length;
}
