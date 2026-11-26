import { firstDate, lastDate } from './model.js';

// Availability changes only when crossing coverage boundaries, not every frame.
export class CometFeedbackCache {
  changed(app) {
    const dataChanged = this.data !== app.cometData;
    const catalogueChanged = this.catalogue !== app.cometCatalogue;
    if (dataChanged || catalogueChanged) {
      this.data = app.cometData;
      this.boundaries = [...new Set([...Object.values(this.data ?? {}), ...app.cometCatalogue].flatMap(model => model.segments
        ? model.segments.flatMap(s => [s.coverage.start, s.coverage.end]) : (model.assessment ? [...model.coverage, ...model.assessment.scope].flatMap(c => [c.start, c.end]) : model.coverage) ?? (model.states ? [firstDate(model), lastDate(model)] : [])))].sort((a,b) => a-b);
    }
    this.catalogue = app.cometCatalogue;
    const boundaries = this.boundaries ?? [];
    let lo = 0, hi = boundaries.length;
    while (lo < hi) { const mid = (lo + hi) >>> 1; if (boundaries[mid] < app.jed) lo = mid + 1; else hi = mid; }
    // Exact endpoints have their own region to preserve inclusive/exclusive ends.
    const region = Number.isFinite(app.jed) ? `${lo}:${boundaries[lo] === app.jed}` : 'unsupported';
    const key = [region, app.cometsShown, !!app.switching, app.cometDiscoveryState, app.cometSelectionNotice,
      app.cometIds.join(','), app.cometSelection?.ids?.join(','), ...Object.entries(app.cometStates ?? {}).flat()].join('|');
    if (!dataChanged && !catalogueChanged && key === this.key) return false;
    this.key = key;
    return true;
  }
}

export function catalogueCoverage(entries) {
  const ranges = entries.flatMap(entry => entry.segments ? entry.segments.map(s => [s.coverage.start, s.coverage.end])
    : entry.assessment ? entry.coverage.map(c => [c.start, c.end]) : Array.isArray(entry.coverage) ? [entry.coverage] : []);
  return ranges.length ? [Math.min(...ranges.map(r => r[0])), Math.max(...ranges.map(r => r[1]))] : null;
}

// Metadata is available even for unselected objects whose payload is not loaded.
export function catalogueHasCoverage(entry, jed) {
  if (!entry || !Number.isFinite(jed)) return false;
  if (entry.assessment) return entry.coverage.some(c => jed >= c.start && (jed < c.end || jed === c.end && c.end_inclusive));
  return entry.segments ? entry.segments.some(({coverage: c}) =>
    jed >= c.start && (jed < c.end || (jed === c.end && c.end_inclusive)))
    : !!entry.coverage && jed >= entry.coverage[0] && jed <= entry.coverage[1];
}

export function assessmentState(entry, jed) {
  let state = entry.assessment?.state;
  if (state === 'unsupported' && !entry.assessment.scope.some(c => jed >= c.start && (jed < c.end || jed === c.end && c.end_inclusive))) state = 'not_yet_assessed';
  return state;
}

export function assessmentMessage(entry, jed) {
  return { not_yet_assessed: 'Trajectory not yet assessed', under_assessment: 'Trajectory not yet available', unsupported: 'No trajectory available' }[assessmentState(entry, jed)] ?? 'No trajectory available';
}
