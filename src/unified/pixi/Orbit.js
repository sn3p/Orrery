import { Graphics } from "pixi.js";
import { PIXELS_PER_AU, J2000, DEG_TO_RAD } from "../../js/constants.js";

const TAU = 2 * Math.PI;
const ELEMENT_KEYS = ["a", "e", "i", "W", "wbar", "w", "M", "n", "P", "epoch"];

function meanMotion(eph) {
  // Preserve the existing zero/absent-n period fallback.
  if (eph.n != null && (!Number.isFinite(eph.n) || eph.n < 0)) {
    throw new RangeError("Invalid orbital mean motion.");
  }
  if (!eph.n && (!Number.isFinite(eph.P) || eph.P <= 0)) {
    throw new RangeError("Invalid orbital period.");
  }
  const n = eph.n ? eph.n * DEG_TO_RAD : TAU / eph.P;
  if (!Number.isFinite(n) || n <= 0) throw new RangeError("Invalid orbital mean motion.");
  return n;
}

function meanAnomaly(prepared, jed) {
  return prepared.mean + prepared.n * (jed - prepared.epoch);
}

function eccentricAnomaly(mean, e) {
  // Signed wrapping preserves small negative phases without adding a full turn.
  let M = mean % TAU;
  if (M > Math.PI) M -= TAU;
  if (M < -Math.PI) M += TAU;
  if (M === 0 || e === 0) return M;
  const sign = Math.sign(M);
  M = Math.abs(M);
  let lo = 0, hi = Math.PI;
  let E = e < 0.8 ? M : Math.PI;
  // Kepler's equation is monotonic for 0 <= e < 1. Keep a root bracket
  // throughout Newton iteration; reject steps that leave it.
  for (let i = 0; i < 16; i++) {
    const residual = E - e * Math.sin(E) - M;
    if (residual === 0) return sign * E;
    if (residual > 0) hi = E;
    else lo = E;
    const next = E - residual / (1 - e * Math.cos(E));
    if (!(next > lo && next < hi)) break;
    if (Math.abs(next - E) <= 1e-14) return sign * next;
    E = next;
  }
  // A fixed bisection budget guarantees termination even near e = 1.
  for (let i = 0; i < 64; i++) {
    E = (lo + hi) / 2;
    const residual = E - e * Math.sin(E) - M;
    if (residual === 0 || hi - lo <= 1e-14) break;
    if (residual > 0) hi = E;
    else lo = E;
  }
  return sign * E;
}

function matchesElements(prepared, eph) {
  for (const key of ELEMENT_KEYS) {
    if (!Object.is(eph[key], prepared.elements[key])) return false;
  }
  return true;
}

function prepareElements(elements) {
  const eph = elements, { cos, sin } = Math;
  const perihelion = eph.wbar ?? eph.w;
  if (!Number.isFinite(eph.a) || eph.a <= 0 || !Number.isFinite(eph.e) || eph.e < 0 || eph.e >= 1
    || !Number.isFinite(eph.i) || !Number.isFinite(eph.W) || !Number.isFinite(perihelion)
    || !Number.isFinite(eph.M) || !Number.isFinite(eph.epoch)) {
    throw new RangeError("Invalid elliptical orbital elements.");
  }
  const longitude = eph.wbar ?? (perihelion + eph.W);
  const e = eph.e, a = eph.a * PIXELS_PER_AU;
  const i = eph.i * DEG_TO_RAD;
  const o = eph.W * DEG_TO_RAD; // longitude of ascending node
  const w = (longitude - eph.W) * DEG_TO_RAD; // argument of perihelion
  const n = meanMotion(eph);
  if (!Number.isFinite(a) || !Number.isFinite(longitude) || !Number.isFinite(w)) {
    throw new RangeError("Orbit exceeds numerical range.");
  }
  const co = cos(o), so = sin(o), cw = cos(w), sw = sin(w), ci = cos(i);
  return { elements, epoch: eph.epoch, mean: eph.M * DEG_TO_RAD, n, e, a,
    b: a * Math.sqrt((1 - e) * (1 + e)),
    px: co * cw - so * sw * ci, qx: -co * sw - so * cw * ci,
    py: so * cw + co * sw * ci, qy: -so * sw + co * cw * ci };
}

function positionAtTime(prepared, jed, target) {
  if (!Number.isFinite(jed)) throw new RangeError("Invalid orbit or Julian date.");
  const M = meanAnomaly(prepared, jed);
  if (!Number.isFinite(M)) throw new RangeError("Orbit exceeds numerical range.");
  const E = eccentricAnomaly(M, prepared.e);

  // Direct eccentric-anomaly coordinates avoid near-parabolic cancellation.
  const px = prepared.a * (Math.cos(E) - prepared.e);
  const py = prepared.b * Math.sin(E);
  const x = px * prepared.px + py * prepared.qx;
  const y = px * prepared.py + py * prepared.qy;
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new RangeError("Orbit exceeds numerical range.");
  }
  // Commit both coordinates only after validation, preserving a failed target.
  target.x = -x; target.y = y;
  return target;
}

export default class Orbit {
  constructor(ephemeris) {
    this.ephemeris = ephemeris;
    this._prepared = null;
  }

  _prepare() {
    const eph = this.ephemeris;
    if (!eph) throw new RangeError("Invalid orbit or Julian date.");
    const previous = this._prepared;
    // Observe public edits/replacement without allocating on ordinary frames.
    if (previous && matchesElements(previous, eph)) return previous;
    const elements = {};
    for (const key of ELEMENT_KEYS) elements[key] = eph[key];
    // Publish a new snapshot only after preparation succeeds; repair is automatic.
    const prepared = prepareElements(elements);
    this._prepared = prepared;
    return prepared;
  }

  // Omitted targets return independent objects; particles can reuse their fields.
  getPosAtTime(jed, target) {
    return positionAtTime(this._prepare(), jed, target || {});
  }

  drawOrbit(jed = J2000) {
    // Reject invalid elements/dates before allocating a Pixi track.
    const prepared = this._prepare();
    const position = positionAtTime(prepared, jed, {});
    const parts = 360;
    const period = this.getPeriodInDays();
    const delta = period / parts;

    // Sample before creating Graphics, so even a later overflowing sample
    // cannot leave a partially allocated track behind.
    const positions = new Float64Array((parts + 1) * 2);
    positions[0] = position.x; positions[1] = position.y;
    let previousDate = jed, previousMean = meanAnomaly(prepared, jed);
    for (let i = 1; i < parts; i++) {
      const date = jed + delta * i;
      const mean = meanAnomaly(prepared, date);
      // Date addition, epoch subtraction or a large initial phase can erase
      // a sample step. Check every step, including floating-spacing boundaries.
      if (date <= previousDate || mean <= previousMean) {
        throw new RangeError("Orbit track exceeds numerical sampling resolution.");
      }
      positionAtTime(prepared, date, position);
      positions[i * 2] = position.x; positions[i * 2 + 1] = position.y;
      previousDate = date; previousMean = mean;
    }
    // Reuse the first point exactly to include the closing segment.
    positions[parts * 2] = positions[0]; positions[parts * 2 + 1] = positions[1];

    const line = new Graphics();
    for (let i = 0; i <= parts; i++) {
      const x = positions[i * 2], y = positions[i * 2 + 1];

      if (i === 0) {
        line.moveTo(x, y);
      } else {
        line.lineTo(x, y);
      }
    }

    line.stroke({ width: 0.2, color: 0x555555 });

    return line;
  }

  getPeriodInDays() {
    const a = this.ephemeris?.a;
    if (!Number.isFinite(a) || a <= 0) throw new RangeError("Invalid orbital axis.");
    // Match getPosAtTime, including validation of the selected n/P value.
    const eph = this.ephemeris;
    meanMotion(eph);
    const period = eph.n ? 360 / eph.n : eph.P;
    if (!Number.isFinite(period) || period <= 0) throw new RangeError("Invalid orbital period.");
    return period;
  }
}
