// These periods only choose the length of the displayed trajectory; positions
// come from integrated Horizons states, never from a fixed Kepler ellipse.
export const COMETS = Object.freeze([
  { id: '1P', name: '1P/Halley', color: 0x75d5ee, periodDays: 27729 },
  { id: '2P', name: '2P/Encke', color: 0xf0bc75, periodDays: 1207 },
  { id: '55P', name: '55P/Tempel-Tuttle', color: 0xc4a0ef, periodDays: 12142 },
]);
// Approximate presentation periods from the pinned Horizons PER headers, rounded
// from Julian years to days. See docs/comets.md for source epochs/solutions.
// This lookup never determines membership or computes positions.
const ADDITIONAL_DISPLAY_PERIOD_DAYS = Object.freeze({ '9P': 2038, '10P': 1958, '67P': 2353 });
const ADDITIONAL_COLORS = Object.freeze({ '9P': 0x8cdaa0, '10P': 0xef9fb2, '67P': 0xcbd079 });
export const DEFAULT_COMET_SELECTION_LIMIT = 6;
export const DEFAULT_DISPLAY_WINDOW_DAYS = 10 * 365.25;
export const DEFAULT_COMET_IDS = Object.freeze(COMETS.map(comet => comet.id));
export function validCometIds(ids, catalogue) {
  return Array.isArray(ids) && new Set(ids).size === ids.length
    && ids.every(id => catalogue ? catalogue.some(entry => entry.id === id) : /^[1-9][0-9]*P$/.test(id));
}
export const lastDate = series => series.start + (series.states.length - 1) * series.step;

export const hasCoverage = (series, jed) => !!series && Number.isFinite(jed)
  && jed >= series.start && jed <= lastDate(series);
export const hasUsableComets = (data, ids, jed) => ids.some(id => hasCoverage(data?.[id], jed));

// Cubic Hermite interpolation uses positions and velocities in AU and AU/day.
// Input dates are UT Julian days, matching the app's UTC calendar to its existing
// precision. Outside the supplied interval there is deliberately no extrapolation.
export function positionAt(series, jed, target = {}) {
  if (!hasCoverage(series, jed)) return null;
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
  const end = series.states.length - 1;
  const span = Math.min(2 * half, end);
  // Shift the whole window at either boundary instead of clipping half of it.
  // Every vertex still comes from the supplied trajectory; never join its ends.
  const first = Math.max(0, Math.min(center - half, end - span));
  return [first, first + span];
}

// Fit the same trajectory window that is drawn, including the interpolated body.
// Keep fitting trajectories when paths are hidden, so that toggle does not zoom.
export function cometFitPoints(data, ids, jed, catalogue = COMETS) {
  const points = [];
  for (const comet of catalogue) {
    if (!ids.includes(comet.id)) continue;
    const series = data[comet.id], position = positionAt(series, jed);
    if (!position) continue;
    points.push([position.x, position.y, position.z]);
    const [first, last] = pathRange(series, jed, comet.periodDays);
    for (let i = first; i <= last; i++) points.push(series.states[i].slice(0, 3));
  }
  return points;
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

// The fallback is a fixed display interval, not an estimated orbital period.
export function cataloguePresentation(objects) {
  return objects.map(entry => {
    const original = COMETS.find(c => c.id === entry.id);
    const periodDays = original?.periodDays ?? ADDITIONAL_DISPLAY_PERIOD_DAYS[entry.id];
    return { ...entry,
      color: original?.color ?? ADDITIONAL_COLORS[entry.id] ?? [0x75d5ee, 0xf0bc75, 0xc4a0ef, 0x8cdaa0, 0xef9fb2, 0xcbd079][parseInt(entry.id, 10) % 6],
      periodDays: periodDays ?? DEFAULT_DISPLAY_WINDOW_DAYS,
      usesDefaultWindow: periodDays === undefined,
    };
  });
}
