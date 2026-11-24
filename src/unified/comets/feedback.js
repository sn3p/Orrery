import { firstDate, lastDate } from './model.js';

// Availability changes only when crossing coverage boundaries, not every frame.
export class CometFeedbackCache {
  changed(app) {
    const dataChanged = this.data !== app.cometData;
    const catalogueChanged = this.catalogue !== app.cometCatalogue;
    if (dataChanged) {
      this.data = app.cometData;
      this.boundaries = [...new Set(Object.values(this.data ?? {}).flatMap(model => model.segments
        ? model.segments.flatMap(s => [s.coverage.start, s.coverage.end]) : [firstDate(model), lastDate(model)]))].sort((a,b) => a-b);
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
