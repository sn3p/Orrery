import { firstDate, lastDate } from './model.js';

// Availability changes only when crossing coverage boundaries, not every frame.
export class CometFeedbackCache {
  changed(app) {
    const dataChanged = this.data !== app.cometData;
    const catalogueChanged = this.catalogue !== app.cometCatalogue;
    if (dataChanged || catalogueChanged) {
      this.data = app.cometData;
      this.boundaries = [...new Set([...Object.values(this.data ?? {}), ...app.cometCatalogue].flatMap(model => model.segments
        ? model.segments.flatMap(s => [s.coverage.start, s.coverage.end]) : model.coverage ?? (model.states ? [firstDate(model), lastDate(model)] : [])))].sort((a,b) => a-b);
    }
    this.catalogue = app.cometCatalogue;
    const boundaries = this.boundaries ?? [];
    let lo = 0, hi = boundaries.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (boundaries[mid] < app.jed) lo = mid + 1; else hi = mid; }
    // Exact endpoints have their own region to preserve inclusive/exclusive ends.
    const region = Number.isFinite(app.jed) ? `${lo}:${boundaries[lo] === app.jed}` : 'unsupported';
    const key = [region, app.cometsShown, !!app.switching, app.cometDiscoveryState, app.cometSelectionNotice,
      app.cometIds.join(','), ...Object.entries(app.cometStates ?? {}).flat()].join('|');
    if (!dataChanged && !catalogueChanged && key === this.key) return false;
    this.key = key;
    return true;
  }
}

export function catalogueCoverage(entries) {
  const ranges = entries.flatMap(entry => entry.segments ? entry.segments.map(s => [s.coverage.start, s.coverage.end])
    : Array.isArray(entry.coverage) ? [entry.coverage] : []);
  return ranges.length ? [Math.min(...ranges.map(r => r[0])), Math.max(...ranges.map(r => r[1]))] : null;
}

// Metadata is available even for unselected objects whose payload is not loaded.
export function catalogueHasCoverage(entry, jed) {
  if (!entry || !Number.isFinite(jed)) return false;
  return entry.segments ? entry.segments.some(({coverage: c}) =>
    jed >= c.start && (jed < c.end || (jed === c.end && c.end_inclusive)))
    : !!entry.coverage && jed >= entry.coverage[0] && jed <= entry.coverage[1];
}

export function coverageSummary(entries) {
  if (!entries.length) return '';
  const ranges = entries.map(entry => {
    const segments = entry.segments?.map(s => [s.coverage.start, s.coverage.end])
      ?? (entry.coverage ? [entry.coverage] : []);
    // Do not describe a gap as continuous coverage in a future catalogue.
    if (!segments.length || segments.some((s, i) => i && s[0] > segments[i - 1][1])) return null;
    return [segments[0][0], segments.at(-1)[1]];
  });
  if (ranges.some(r => !r)) return 'Coverage varies by comet.';
  const start = Math.max(...ranges.map(r => r[0])), end = Math.min(...ranges.map(r => r[1]));
  if (start > end) return 'Coverage varies by comet.';
  const year = jd => new Date((jd - 2440587.5) * 86400000).getUTCFullYear();
  const count = ['zero', 'one', 'two', 'three', 'four', 'five', 'six'][entries.length] ?? entries.length;
  let text = entries.length === 1 ? 'The comet has' : `All ${count} comets have`;
  text += ` trajectories from ${year(start)}–${year(end)}.`;
  const earlier = entries.flatMap((entry, i) => ranges[i][0] < start
    ? [`${entry.name.replace(/^[^/]+\//, '').replaceAll('-', '–')} from ${year(ranges[i][0])}`] : []);
  if (earlier.length) text += ` Earlier coverage: ${earlier.length > 1
    ? earlier.slice(0, -1).join(', ') + ' and ' + earlier.at(-1) : earlier[0]}.`;
  return text;
}
