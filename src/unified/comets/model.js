// These periods only choose the length of the displayed trajectory; positions
// come from integrated Horizons states, never from a fixed Kepler ellipse.
export const COMETS = Object.freeze([
  { id: '1P', name: 'Halley', color: 0x75d5ee, periodDays: 27729 },
  { id: '2P', name: 'Encke', color: 0xf0bc75, periodDays: 1207 },
  { id: '55P', name: 'Tempel–Tuttle', color: 0xc4a0ef, periodDays: 12142 },
]);
export const DEFAULT_COMET_IDS = Object.freeze(COMETS.map(comet => comet.id));
export function validCometIds(ids) {
  return Array.isArray(ids) && new Set(ids).size === ids.length
    && ids.every(id => DEFAULT_COMET_IDS.includes(id));
}
export const lastDate = series => series.start + (series.states.length - 1) * series.step;

// Cubic Hermite interpolation uses positions and velocities in AU and AU/day.
// Input dates are UT Julian days, matching the app's UTC calendar to its existing
// precision. Outside the supplied interval there is deliberately no extrapolation.
export function positionAt(series, jed, target = {}) {
  if (!Number.isFinite(jed) || jed < series.start || jed > lastDate(series)) return null;
  const offset = (jed - series.start) / series.step;
  const i = Math.min(Math.floor(offset), series.states.length - 2), t = offset - i;
  const a = series.states[i], b = series.states[i + 1], t2 = t * t, t3 = t2 * t;
  const h00 = 2*t3 - 3*t2 + 1, h10 = t3 - 2*t2 + t;
  const h01 = -2*t3 + 3*t2, h11 = t3 - t2;
  for (const [k, key] of ['x', 'y', 'z'].entries()) {
    target[key] = h00*a[k] + h10*series.step*a[k+3] + h01*b[k] + h11*series.step*b[k+3];
  }
  return target;
}

export function pathRange(series, jed, periodDays) {
  const center = Math.round((jed - series.start) / series.step / 8) * 8;
  const half = Math.ceil(periodDays / series.step / 2);
  return [Math.max(0, center-half), Math.min(series.states.length-1, center+half)];
}

export function cometRadius(data, ids) {
  let radius = 1;
  for (const id of ids) for (const row of data[id].states) {
    radius = Math.max(radius, Math.hypot(...row.slice(0,3)));
  }
  return radius;
}

export function validateCometData(data) {
  for (const id of DEFAULT_COMET_IDS) {
    const series = data?.[id];
    if (!series || !Number.isFinite(series.start) || !Number.isFinite(series.step) || series.step <= 0
      || !Array.isArray(series.states) || series.states.length < 2
      || !Number.isFinite(lastDate(series))
      || !series.states.every(row => Array.isArray(row) && row.length === 6 && row.every(Number.isFinite))) {
      throw new Error("Invalid comet ephemeris.");
    }
  }
  return data;
}

export function validateCometOptions(shared) {
  for (const key of ['asteroidsShown', 'cometsShown', 'cometPaths']) {
    if (shared?.[key] !== undefined && typeof shared[key] !== 'boolean') throw new RangeError(`Invalid ${key}.`);
  }
  if (shared?.cometIds !== undefined && !validCometIds(shared.cometIds)) throw new RangeError('Invalid comet selection.');
}
