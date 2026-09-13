import { Graphics } from "pixi.js";
import { PIXELS_PER_AU, J2000, YEAR, DEG_TO_RAD } from "./constants.js";

const TAU = 2 * Math.PI;

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

export default class Orbit {
  constructor(ephemeris) {
    this.ephemeris = ephemeris;
  }

  // Get position at time for Julian Date
  getPosAtTime(jed) {
    // Read the public ephemeris on every call so edits/replacement stay observable.
    const eph = this.ephemeris;
    const { cos, sin } = Math;
    if (!eph || !Number.isFinite(jed)) throw new RangeError("Invalid orbit or Julian date.");
    const perihelion = eph.wbar ?? eph.w;
    if (!Number.isFinite(eph.a) || eph.a <= 0 || !Number.isFinite(eph.e) || eph.e < 0 || eph.e >= 1
      || !Number.isFinite(eph.i) || !Number.isFinite(eph.W) || !Number.isFinite(perihelion)
      || !Number.isFinite(eph.M) || !Number.isFinite(eph.epoch)) {
      throw new RangeError("Invalid elliptical orbital elements.");
    }
    const longitude = eph.wbar ?? (perihelion + eph.W);
    const epoch = eph.epoch;
    const e = eph.e;
    const a = eph.a * PIXELS_PER_AU;
    const i = eph.i * DEG_TO_RAD;
    const o = eph.W * DEG_TO_RAD; // longitude of ascending node
    const w = (longitude - eph.W) * DEG_TO_RAD; // argument of perihelion
    const M = eph.M * DEG_TO_RAD + meanMotion(eph) * (jed - epoch);
    if (!Number.isFinite(M) || !Number.isFinite(a) || !Number.isFinite(longitude)) {
      throw new RangeError("Orbit exceeds numerical range.");
    }
    const E = eccentricAnomaly(M, e);

    // Direct eccentric-anomaly coordinates avoid the near-parabolic 0/0
    // cancellation in r = a(1-e²)/(1+e cos(v)), especially at aphelion.
    const px = a * (cos(E) - e);
    const py = a * Math.sqrt((1 - e) * (1 + e)) * sin(E);
    const x = px * (cos(o) * cos(w) - sin(o) * sin(w) * cos(i))
      + py * (-cos(o) * sin(w) - sin(o) * cos(w) * cos(i));
    const y = px * (sin(o) * cos(w) + cos(o) * sin(w) * cos(i))
      + py * (-sin(o) * sin(w) + cos(o) * cos(w) * cos(i));
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError("Orbit exceeds numerical range.");
    }

    return { x: -x, y };
  }

  drawOrbit(jed = J2000) {
    // Reject invalid elements/dates before allocating a Pixi track.
    this.getPosAtTime(jed);
    const parts = 360;
    const period = this.getPeriodInDays();
    const delta = period / parts;

    // Sample before creating Graphics, so even a later overflowing sample
    // cannot leave a partially allocated track behind.
    const positions = [];
    for (let i = 0; i <= parts; i++) {
      jed += delta;
      positions.push(this.getPosAtTime(jed));
    }

    const line = new Graphics();
    for (let i = 0; i <= parts; i++) {
      const pos = positions[i];

      if (i === 0) {
        line.moveTo(pos.x, pos.y);
      } else {
        line.lineTo(pos.x, pos.y);
      }
    }

    line.stroke({ width: 0.2, color: 0x555555 });

    return line;
  }

  getPeriodInDays() {
    const a = this.ephemeris?.a;
    if (!Number.isFinite(a) || a <= 0) throw new RangeError("Invalid orbital axis.");
    // Preserve the existing track period here; matching the motion period is separate.
    const period = Math.sqrt(Math.pow(a, 3)) * YEAR;
    if (!Number.isFinite(period) || period <= 0) throw new RangeError("Invalid orbital period.");
    return period;
  }
}
