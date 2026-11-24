import { keys, requireValue, freeze } from './contract.js';
import { CONVENTIONS, reference, utcTimestamp, vectorQuery, validateCometIndex, validateComet, interpolateComet } from './cometSourceCore.js';
export const T = 2444239.5, END = 2488067.5;
const IDS = ['1P', '2P', '55P', '9P', '10P', '67P'];
export const HISTORY = { '1P': [2391511.5, 13183, '90000030', 'JPL#75'], '55P': [2402592.5, 10413, '90000626', 'JPL#J985/69'] };
export const requireHistory = (ok, label) => requireValue(ok, label, 'comet history');
const fields = (value, required, optional = []) => keys(value, required, optional, 'comet history');
const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const hash = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const text = v => typeof v === 'string' && v.length > 0;
const nullable = v => v === null || typeof v === 'string';
function day(v) {
  return typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v)
    && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
}
function https(v) { try { const u = new URL(v); return u.protocol === 'https:' && !u.username && !u.password; } catch { return false; } }
export { reference };
function metadata(value, id, sources) {
  fields(value, ['id','catalogue_discovery','catalogue_provenance','events','event_inventory_complete']);
  requireHistory(value.id === id && value.event_inventory_complete === false, 'discovery identity');
  fields(value.catalogue_discovery, ['citation','name','who','location','site','discovery','cref','date','ref']);
  requireHistory(Object.values(value.catalogue_discovery).every(nullable), 'catalogue assertions');
  const p = value.catalogue_provenance;
  fields(p, ['url','raw_file','sha256','retrieved_on','retrieved_at','note']);
  requireHistory(p.url === `https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=${id}&discovery=true&full-prec=true`
    && p.raw_file === `sources/${id}-sbdb.json` && hash(p.sha256) && day(p.retrieved_on)
    && (p.retrieved_at === null || (utcTimestamp(p.retrieved_at) && p.retrieved_at.startsWith(p.retrieved_on))) && nullable(p.note), 'discovery provenance');
  requireHistory(Array.isArray(value.events) && value.events.length > 0, 'events');
  for (const e of value.events) {
    fields(e, ['kind','date','people','sources','certainty','note']);
    requireHistory(['discovery','independent_discovery','recovery','earlier_sighting','photographic_observation','discovery_recognition'].includes(e.kind)
      && ['documented','day-disputed'].includes(e.certainty) && nullable(e.note)
      && Array.isArray(e.people) && e.people.every(text) && Array.isArray(e.sources) && e.sources.length > 0
      && e.sources.every(s => text(s) && Object.hasOwn(sources,s)), 'event semantics');
    const d = e.date;
    fields(d,['year','month','day','precision','calendar','year_numbering']);
    requireHistory(Number.isSafeInteger(d.year) && Math.abs(d.year) <= 9999 && d.year_numbering === 'astronomical'
      && ['gregorian','historical-unspecified'].includes(d.calendar) && ['year','month','day'].includes(d.precision), 'date');
    requireHistory(d.precision === 'year' ? d.month === null && d.day === null
      : Number.isInteger(d.month) && d.month >= 1 && d.month <= 12
        && (d.precision === 'month' ? d.day === null : Number.isInteger(d.day)
          && d.calendar === 'gregorian' && d.year > 0
          && day(`${String(d.year).padStart(4,'0')}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`)), 'date precision');
  }
}
// Match Python str.splitlines(), including CRLF and Unicode separators, so
// request-endpoint removal does not accidentally hide scientific header lines.
export function modelIdentity(header) {
  const lines = header.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/u);
  if (lines.at(-1) === '') lines.pop();
  return lines.filter(line=>!line.startsWith('Start time')&&!line.startsWith('Stop  time')).join('\n');
}
function historicalQuery(id, offset) {
  const [start,,record] = HISTORY[id], count = Math.floor((END-start)/4)+1;
  const first = start+offset, last = start+4*(count-1)-(offset ? 4-offset : 0);
  return vectorQuery(`${record};`, `JD${first}`, `JD${last}`);
}
export function validateHistoryIndex(index) {
  fields(index,['comet_contract_version','sources','objects']);
  requireHistory(index.comet_contract_version === 3 && Array.isArray(index.objects)
    && equal(index.objects.map(e=>e?.id),IDS), 'catalogue');
  requireHistory(index.sources && typeof index.sources === 'object' && !Array.isArray(index.sources), 'sources');
  for (const [key,s] of Object.entries(index.sources)) {
    requireHistory(text(key),'source key');
    fields(s,['url','checked_on'],['note','description']);
    requireHistory(https(s.url) && day(s.checked_on) && (s.note === undefined || text(s.note))
      && (s.description === undefined || text(s.description)), 'source');
  }
  for (const e of index.objects) {
    fields(e,['id','name','discovery','segments','transition']); metadata(e.discovery,e.id,index.sources);
    const historical = Object.hasOwn(HISTORY,e.id);
    requireHistory(Array.isArray(e.segments) && equal(e.segments.map(s=>s?.key), historical ? ['historical','modern'] : ['modern']), 'segments');
    for (const s of e.segments) {
      fields(s,['key','payload_contract_version','data','sample_coverage','coverage','provenance','validation']);
      reference(s.data,'objects/',2*1024*1024);
      fields(s.coverage,['start','end','end_inclusive']);
      const old = s.key === 'historical', start = old ? HISTORY[e.id][0] : T;
      const sampleEnd = old ? start+(HISTORY[e.id][1]-1)*4 : END;
      requireHistory(s.payload_contract_version === (old ? 3 : 2)
        && equal(s.sample_coverage,[start,sampleEnd]) && s.coverage.start === start
        && s.coverage.end === (old ? T : END) && s.coverage.end_inclusive === !old, 'coverage');
      if (!old) {
        validateCometIndex({comet_contract_version:2,objects:[{id:e.id,name:e.name,coverage:s.sample_coverage,data:s.data,provenance:s.provenance,validation:s.validation}]});
        continue;
      }
      fields(s.provenance,['vectors','1','2','3']);
      const normalized = [];
      for (const [kind,p] of Object.entries(s.provenance)) {
        fields(p,['url','sha256','retrieved_at','header','target','solution','api_version']);
        requireHistory(p.url === historicalQuery(e.id,kind === 'vectors' ? 0 : Number(kind))
          && ['1.2','1.3'].includes(p.api_version) && hash(p.sha256) && utcTimestamp(p.retrieved_at) && p.target === e.name
          && p.solution === HISTORY[e.id][3] && text(p.header), 'historical provenance');
        normalized.push(modelIdentity(p.header));
      }
      requireHistory(new Set(normalized).size === 1, 'historical model');
      const v = s.validation;
      fields(v,['method','tolerance_au','checks']);
      requireHistory(v.method === 'all-quarter-points-final-serialized' && v.tolerance_au === .000052
        && Array.isArray(v.checks) && v.checks.length === 3, 'validation');
      v.checks.forEach((c,i)=>{
        fields(c,['offset_days','samples','max_error_au','worst_jd','references']);
        const onGrid = t => Number.isFinite(t) && t >= start+i+1 && t <= sampleEnd-4+i+1 && (t-start-i-1)%4 === 0;
        requireHistory(c.offset_days === i+1 && c.samples === HISTORY[e.id][1]-1
          && Number.isFinite(c.max_error_au) && c.max_error_au >= 0 && c.max_error_au <= v.tolerance_au
          && onGrid(c.worst_jd) && Array.isArray(c.references) && c.references.length > 0
          && c.references.every(r=>Array.isArray(r)&&r.length===4&&r.every(Number.isFinite)&&onGrid(r[0]))
          && [start+i+1,sampleEnd-4+i+1,c.worst_jd].every(t=>c.references.some(r=>r[0]===t)), 'historical references');
      });
    }
    if (!historical) { requireHistory(e.transition === null,'transition'); continue; }
    const t = e.transition;
    fields(t,['jd','owner','position_limit_au','velocity_limit_au_per_day','comparisons']);
    const end = e.segments[0].sample_coverage[1];
    requireHistory(t.jd === T && t.owner === 'modern' && t.position_limit_au === .000052
      && t.velocity_limit_au_per_day === .000013 && Array.isArray(t.comparisons)
      && equal(t.comparisons.map(c=>c?.jd),end===T?[T]:[T,end]),'transition');
    for (const c of t.comparisons) {
      fields(c,['jd','position_difference_au','velocity_difference_au_per_day']);
      requireHistory(Number.isFinite(c.position_difference_au) && c.position_difference_au >= 0 && c.position_difference_au <= t.position_limit_au
        && Number.isFinite(c.velocity_difference_au_per_day) && c.velocity_difference_au_per_day >= 0 && c.velocity_difference_au_per_day <= t.velocity_limit_au_per_day,'transition limits');
    }
  }
  return freeze(index);
}
export function validateSegment(value, entry) {
  const { objectId:id, segment:s } = entry;
  if (s.key === 'modern') validateComet(value,id);
  else {
    fields(value,['comet_contract_version','id','segment','conventions','series']);
    requireHistory(value.comet_contract_version === 3 && value.id === id && value.segment === 'historical','identity');
    fields(value.conventions,Object.keys(CONVENTIONS));
    requireHistory(Object.entries(CONVENTIONS).every(([k,v])=>value.conventions[k]===v),'conventions');
    fields(value.series,['start','step','states']);
    requireHistory(value.series.start === HISTORY[id][0] && value.series.step === 4
      && Array.isArray(value.series.states) && value.series.states.length === HISTORY[id][1]
      && value.series.states.every(r=>Array.isArray(r)&&r.length===6&&r.every(Number.isFinite)), 'historical states');
  }
  const refs = s.key === 'modern' ? s.validation.references : s.validation.checks.flatMap(c=>c.references);
  for (const r of refs) requireHistory(Math.hypot(...interpolateComet(value.series,r[0]).map((v,k)=>v-r[k+1])) <= .000052,'interpolation tolerance');
  return value;
}
