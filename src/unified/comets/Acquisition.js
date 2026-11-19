import CometSource from './source/CometSource.js';

export const COMET_LATEST_URL = 'https://sn3p.github.io/orrery-data/comets/latest.json';

// One generation owns one source and its verified cache. Selection is independent
// of acquisition: completing a request never changes visibility or selection.
export default class Acquisition {
  constructor(changed, open = signal => CometSource.openLatest(COMET_LATEST_URL, { signal })) {
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
  select(ids, retry = false) {
    if (this.closed) return Promise.resolve();
    for (const [id, request] of this.requests) if (!ids.includes(id)) {
      this.requests.delete(id);
      request.abort();
      delete this.states[id];
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
          const comet = await source.load(id, { signal: request.signal });
          if (!valid()) return;
          this.data = { ...this.data, [id]: comet.series };
          this.states[id] = 'ready';
        } catch (error) {
          if (valid() && error.name !== 'AbortError') this.states[id] = 'error';
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
