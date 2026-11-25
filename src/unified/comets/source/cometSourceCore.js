import { aborted as abortError, check as checkSignal, fetchLatest, fetchVerified, decodeJSON } from './transport.js';
import { freeze, requireValue as requireProductValue, keys } from './contract.js';

const aborted = () => abortError('comet');
const check = signal => checkSignal(signal, 'comet');
const decode = bytes => decodeJSON(bytes, 'comet');
const requireValue = (ok, label) => requireProductValue(ok, label, 'comet');
const fields = (value, expected) => keys(value, expected, [], 'comet');

const START = 2444239.5, STEP = 4, COUNT = 10958;
const validId = id => typeof id === 'string' && /^[1-9][0-9]*P$/.test(id);
// Match the producer's explicit whitespace set, independent of runtime trim rules.
const EDGE_WHITESPACE = '\u0009\u000a\u000b\u000c\u000d\u001c\u001d\u001e\u001f '
  + '\u0085\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005'
  + '\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
const validName = (name, id) => typeof name === 'string' && name.startsWith(id + '/')
  && name.length > id.length + 1 && !EDGE_WHITESPACE.includes(name[0]) && !EDGE_WHITESPACE.includes(name.at(-1)) && !/[\x00-\x1f\x7f]/.test(name);
export const CONVENTIONS = Object.freeze({ center: 'Sun', frame: 'Ecliptic J2000', time: 'UT', position_units: 'AU',
  velocity_units: 'AU/day', correction: 'NONE', interpolation: 'cubic-hermite', encoding: 'uniform-state-v1' });
export function reference(ref, prefix, max) {
  fields(ref, ['url', 'sha256', 'bytes']);
  requireValue(/^[a-f0-9]{64}$/.test(ref.sha256) && ref.url === `${prefix}${ref.sha256}.json`
    && Number.isSafeInteger(ref.bytes) && ref.bytes > 0 && ref.bytes <= max, 'reference');
}
export function vectorQuery(command,start,stop) {
  const params = { format: 'json', COMMAND: `'${command}'`, EPHEM_TYPE: "'VECTORS'",
    CENTER: "'500@10'", START_TIME: `'${start}'`, STOP_TIME: `'${stop}'`, STEP_SIZE: "'4 d'",
    TIME_TYPE: "'UT'", OUT_UNITS: "'AU-D'", REF_PLANE: "'ECLIPTIC'", REF_SYSTEM: "'ICRF'",
    VEC_TABLE: "'2'", CSV_FORMAT: "'YES'", VEC_CORR: "'NONE'", OBJ_DATA: "'YES'" };
  return 'https://ssd.jpl.nasa.gov/api/horizons.api?' + new URLSearchParams(params);
}
function sourceQuery(id, midpoint) {
  return vectorQuery(`DES=${id}; CAP;`, midpoint?'1980-01-03':'1980-01-01',midpoint?'2099-12-30':'2100-01-01');
}
export function utcTimestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().replace('.000Z', 'Z') === value;
}
export function interpolateCometState(series, jd) {
  const offset = (jd - series.start) / series.step;
  requireValue(Number.isFinite(jd) && offset >= 0 && offset <= series.states.length - 1, 'date coverage');
  const index = Math.min(Math.floor(offset), series.states.length - 2), t = offset - index;
  const a = series.states[index], b = series.states[index + 1], h = series.step;
  const position = [0, 1, 2].map(k => (2*t**3-3*t*t+1)*a[k] + (t**3-2*t*t+t)*h*a[k+3]
    + (-2*t**3+3*t*t)*b[k] + (t**3-t*t)*h*b[k+3]);
  const velocity = [0,1,2].map(k=>((6*t*t-6*t)*a[k]+(3*t*t-4*t+1)*h*a[k+3]
    +(-6*t*t+6*t)*b[k]+(3*t*t-2*t)*h*b[k+3])/h);
  return {position,velocity};
}

export function interpolateComet(series,jd) { return interpolateCometState(series,jd).position; }

function version(value) { requireValue(value.comet_contract_version === 2, 'contract version'); }
export function validateComet(value, id) {
  fields(value, ['comet_contract_version', 'id', 'conventions', 'series']); version(value);
  requireValue(value.id === id && validId(id), 'identity');
  fields(value.conventions, Object.keys(CONVENTIONS));
  requireValue(Object.entries(CONVENTIONS).every(([k, v]) => value.conventions[k] === v), 'conventions');
  fields(value.series, ['start', 'step', 'states']);
  const { start, step, states } = value.series;
  requireValue(start === START && step === STEP && Array.isArray(states) && states.length === COUNT
    && states.every(row => Array.isArray(row) && row.length === 6 && row.every(Number.isFinite)), 'states');
  return value;
}
export function validateCometIndex(index) {
  fields(index, ['comet_contract_version', 'objects']); version(index);
  requireValue(Array.isArray(index.objects) && index.objects.length > 0, 'catalogue');
  const seen = new Set();
  index.objects.forEach(entry => {
    fields(entry, ['id', 'name', 'coverage', 'data', 'provenance', 'validation']);
    requireValue(validId(entry.id) && !seen.has(entry.id), 'identity');
    seen.add(entry.id);
    requireValue(validName(entry.name, entry.id) && Array.isArray(entry.coverage)
      && entry.coverage.length === 2 && entry.coverage[0] === START
      && entry.coverage[1] === START + STEP * (COUNT - 1), 'metadata');
    reference(entry.data, 'objects/', 2 * 1024 * 1024);
    fields(entry.provenance, ['vectors', 'midpoints']);
    for (const [kind, source] of Object.entries(entry.provenance)) {
      fields(source, ['url', 'sha256', 'retrieved_at', 'target', 'solution', 'header', 'api_version']);
      requireValue(Object.values(source).every(v => typeof v === 'string' && v.length)
        && ['1.2', '1.3'].includes(source.api_version) && utcTimestamp(source.retrieved_at)
        && source.url === sourceQuery(entry.id, kind === 'midpoints')
        && source.target === entry.name && /^JPL#[A-Za-z0-9\/._-]+$/.test(source.solution)
        && /^[a-f0-9]{64}$/.test(source.sha256), 'provenance');
    }
    requireValue(entry.provenance.vectors.solution === entry.provenance.midpoints.solution, 'solution');
    const v = entry.validation;
    fields(v, ['method', 'samples', 'max_error_au', 'worst_jd', 'tolerance_au', 'references']);
    requireValue(v.method === 'all-midpoints-final-serialized' && v.samples === COUNT - 1
      && v.tolerance_au === 0.000052 && Number.isFinite(v.max_error_au)
      && v.max_error_au >= 0 && v.max_error_au <= v.tolerance_au && Array.isArray(v.references)
      && v.references.length > 0 && v.references.every(r => Array.isArray(r) && r.length === 4 && r.every(Number.isFinite))
      && v.references.some(r => r[0] === v.worst_jd), 'validation');
  });
  return index;
}

// Shared cancellable download queue for segmented readers.
export class CometDownloadQueue {
  constructor(limit=2) { this.limit=limit; this.active=0; this.waiting=[]; }
  async run(signal,work) {
    await new Promise((resolve,reject)=>{
      const item={start:()=>{signal.removeEventListener('abort',cancel);this.active++;resolve();}};
      const cancel=()=>{const i=this.waiting.indexOf(item);if(i>=0)this.waiting.splice(i,1);signal.removeEventListener('abort',cancel);reject(aborted());};
      if(signal.aborted){cancel();return;}
      signal.addEventListener('abort',cancel,{once:true});this.waiting.push(item);this.drain();
    });
    try { check(signal); return await work(); }
    finally { this.active--;this.drain(); }
  }
  drain() { while(this.active<this.limit && this.waiting.length)this.waiting.shift().start(); }
}
export function previousJulianDay(value) {
  if(value===0)return -Number.MIN_VALUE;
  const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,value);
  view.setBigUint64(0,view.getBigUint64(0)+(value>0?-1n:1n));return view.getFloat64(0);
}
export function cometPathStrip(segment,start,end,interpolate=interpolateComet) {
  const {key,coverage,series}=segment;
  const first=Math.max(start,coverage.start),last=Math.min(end,coverage.end_inclusive?coverage.end:previousJulianDay(coverage.end));
  if(first>last)return null;
  const times=[first];
  for(let i=Math.floor((first-series.start)/series.step)+1;series.start+i*series.step<last;i++)times.push(series.start+i*series.step);
  if(last>first)times.push(last);
  return {key,points:times.map(t=>[t,...interpolate(series,t)])};
}

// A source pins one index. A new visit/retry creates a new source; close aborts
// outstanding reads. Selection and renderer generation remain the app's concern.
export class CometSource {
  static async openLatest(url, { signal } = {}) {
    return this.openDescriptor(await fetchLatest(url, signal, 'comet'), { signal });
  }
  static async openDescriptor({ location, latest }, { signal } = {}) {
    check(signal);
    fields(latest, ['comet_contract_version', 'index']); version(latest);
    reference(latest.index, 'index-', 256 * 1024);
    const indexURL = new URL(latest.index.url, location).href;
    const bytes = await fetchVerified(latest.index, indexURL, signal, 'comet');
    check(signal);
    const index = decode(bytes);
    validateCometIndex(index);
    check(signal);
    return new CometSource(indexURL, latest.index.sha256, index);
  }
  constructor(url, sourceId, info) {
    Object.defineProperties(this, { url: { value: url }, sourceId: { value: sourceId, enumerable: true },
      info: { value: freeze(info), enumerable: true } });
    this.lifetime = new AbortController();
    this.entries = info.objects;
    this.cache = new Map();
    this.pending = new Map();
  }
  async load(id, { signal } = {}) {
    check(signal); check(this.lifetime.signal);
    const entry = this.entryFor(id);
    requireValue(entry, 'selection');
    if (this.cache.has(id)) return this.cache.get(id);
    let pending = this.pending.get(id);
    if (!pending) {
      const controller = new AbortController();
      pending = { controller, subscribers: new Set(), settled: false };
      this.pending.set(id, pending);
      pending.promise = (async () => {
        try {
          const bytes = await this.fetchEntry(entry, controller.signal);
          check(controller.signal);
          const value = this.validatePayload(decode(bytes), entry);
          check(controller.signal);
          this.cache.set(id, freeze(value));
          return value;
        } finally {
          pending.settled = true;
          if (this.pending.get(id) === pending) this.pending.delete(id);
        }
      })();
    }
    // Cancellation belongs to each subscriber. Only the last cancelled reader
    // aborts shared work, and eviction permits an immediate independent retry.
    return new Promise((resolve, reject) => {
      const signals = [...new Set([this.lifetime.signal, ...(signal ? [signal] : [])])];
      let finished = false;
      const finish = (callback, value) => {
        if (finished) return;
        finished = true;
        for (const signal of signals) signal.removeEventListener('abort', cancel);
        pending.subscribers.delete(cancel);
        if (!pending.settled && pending.subscribers.size === 0) {
          pending.controller.abort();
          if (this.pending.get(id) === pending) this.pending.delete(id);
        }
        callback(value);
      };
      const cancel = () => finish(reject, aborted());
      pending.subscribers.add(cancel);
      for (const signal of signals) signal.addEventListener('abort', cancel, { once: true });
      pending.promise.then(value => finish(resolve, value), error => finish(reject, error));
      // A synchronous fetch interceptor can abort before registration.
      if (signals.some(signal => signal.aborted)) cancel();
    });
  }
  entryFor(id) { return this.entries.find(v => v.id === id); }
  fetchEntry(entry, signal) {
    return fetchVerified(entry.data, new URL(entry.data.url, this.url).href, signal, 'comet');
  }
  validatePayload(value, entry) {
    validateComet(value, entry.id);
    for (const row of entry.validation.references) requireValue(
      Math.hypot(...interpolateComet(value.series, row[0]).map((v, k) => v - row[k + 1])) <= 0.000052,
      'interpolation tolerance');
    return value;
  }
  close() { this.lifetime.abort(); this.cache.clear(); }
}
