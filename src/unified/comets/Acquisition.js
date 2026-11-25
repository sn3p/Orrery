import CometSource from './source/CometCatalogSource.js';
import DirectorySource from './source/CometDirectorySource.js';
import { DEFAULT_DISPLAY_WINDOW_DAYS } from './model.js';
import HistorySource from './source/CometHistorySource.js';
import { fetchLatest } from './source/transport.js';

export const COMET_LATEST_URL = 'https://sn3p.github.io/orrery-data/comets/latest.json';
// Explicit candidate injection remains available for offline rollout verification.
export const openCandidateSource = url => signal => DirectorySource.openLatest(url, { signal });
export const openHostedSource = async signal => {
  // Read latest once: dispatch and verification must use the same descriptor pin.
  const descriptor = await fetchLatest(COMET_LATEST_URL, signal, 'comet');
  switch (descriptor.latest?.comet_contract_version) {
    case 2: return CometSource.openDescriptor(descriptor, { signal });
    case 3: return HistorySource.openDescriptor(descriptor, { signal });
    case 4: return DirectorySource.openDescriptor(descriptor, { signal });
    default: throw new Error('Invalid comet contract version');
  }
};

// One generation owns one source and its verified cache. Selection is independent
// of acquisition: completing a request never changes visibility or selection.
export default class Acquisition {
  constructor(changed, open = openHostedSource) {
    this.changed = changed;
    this.open = open;
    this.generation = 0;
    this.data = {};
    this.states = {};
    this.requests = new Map();
    this.controller = new AbortController();
  }
  async source() {
    if (!this.opening) {
      const generation = this.generation;
      this.opening = this.open(this.controller.signal).then(source => {
        if (this.closed || generation !== this.generation) { source.close(); throw new DOMException('Cancelled', 'AbortError'); }
        this.current = source;
        return source;
      }).catch(error => {
        if (generation === this.generation) this.opening = null;
        throw error;
      });
    }
    return this.opening;
  }
  select(ids, retry = false, context = {}) {
    const windowed = !!this.current?.getObject;
    if (windowed) {
      const windows = Object.fromEntries(ids.map(id => {
        const entry = context.catalogue?.find(e => e.id === id);
        const half = (entry?.periodDays ?? DEFAULT_DISPLAY_WINDOW_DAYS) / 2 + 64;
        const center = Math.floor(context.jed / 64) * 64;
        const coverage = entry?.coverage ?? [];
        const first = coverage[0]?.start, last = coverage.at(-1)?.end;
        if (entry?.trajectory?.kind === 'legacy') return [id, { start: first, end: last }];
        const span = Number.isFinite(first) && Number.isFinite(last) ? Math.min(half * 2, last - first) : half * 2;
        const start = Number.isFinite(first) ? Math.max(first, Math.min(center - half, last - span)) : center - half;
        return [id, { start, end: start + span }];
      }));
      for (const id of new Set([...Object.keys(this.data), ...this.requests.keys(), ...Object.keys(this.states)])) {
        if (!windows[id] || JSON.stringify(windows[id]) !== JSON.stringify(this.windows?.[id])) {
          this.requests.get(id)?.abort(); this.requests.delete(id);
          const { [id]: removed, ...remaining } = this.data; this.data = remaining;
          delete this.states[id];
        }
      }
      this.windows = windows;
    }
    if (this.closed) return Promise.resolve();
    for (const [id, request] of this.requests) if (!ids.includes(id)) {
      this.requests.delete(id);
      request.abort();
      delete this.states[id];
    }
    // Settled failures have no request left to cancel. Deselecting them must
    // still reset the attempt so reselect/show behaves like a new request.
    for (const id of Object.keys(this.states)) {
      if (!ids.includes(id) && this.states[id] === 'error') delete this.states[id];
    }
    const work = ids.map(id => {
      if (this.data[id] || this.requests.has(id) || (this.states[id] === 'error' && !retry)) return;
      const request = new AbortController(), generation = this.generation;
      this.requests.set(id, request);
      this.states[id] = 'loading';
      const valid = () => !this.closed && generation === this.generation && this.requests.get(id) === request;
      return (async () => {
        try {
          const source = await this.source();
          if (!valid()) return;
          let comet;
          if (source.getObject) {
            const entry = source.getObject(id);
            const legacy = entry?.trajectory?.kind === 'legacy';
            const window = legacy ? { start: entry.coverage[0].start, end: entry.coverage.at(-1).end } : this.windows[id];
            const result = await source.loadWindow(id, { ...window, signal: request.signal });
            // Legacy paths retain their established grid-rounded presentation.
            // New segmented paths draw exactly the bounded window requested,
            // independent of which support blocks happen to be resident.
            comet = { series: { segments: result.segments, ...(!legacy && { displayWindow: window }) } };
          } else if (source.loadSegment) {
            const entry = source.info.objects.find(object => object.id === id);
            // Reader validates the complete pair before exposing a selected object.
            const segments = [];
            // loadSegment validates its entire transition pair. Keep only shared
            // source series references; display windows are generated on demand.
            for (const segment of entry.segments) {
              const payload = await source.loadSegment(id, segment.key, { signal: request.signal });
              segments.push({ key: segment.key, coverage: segment.coverage, series: payload.series });
            }
            comet = { series: { segments } };
          } else comet = await source.load(id, { signal: request.signal });
          if (!valid()) return;
          this.data = { ...this.data, [id]: comet.series };
          this.states[id] = 'ready';
        } catch {
          // Own cancellations invalidate the request before rejecting. Any error
          // from a still-current read (including AbortError) needs recovery UI.
          if (valid()) this.states[id] = 'error';
        } finally {
          if (valid()) { this.requests.delete(id); this.changed(); }
        }
      })();
    });
    this.changed();
    return Promise.all(work);
  }
  replace(open = this.open) {
    this.generation++;
    this.controller.abort();
    this.current?.close();
    for (const request of this.requests.values()) request.abort();
    this.requests.clear();
    this.controller = new AbortController();
    this.open = open;
    this.opening = this.current = null;
    this.data = {}; this.states = {};
    if (!this.closed) this.changed();
  }
  close() { this.closed = true; this.replace(); }
}
