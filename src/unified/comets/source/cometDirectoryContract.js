// Unpublished catalogue contract: identity, assessment and published coverage are independent.
import {keys, requireValue, freeze} from './contract.js';
import {modelIdentity} from './cometHistoryContract.js';
import {reference, CONVENTIONS, interpolateCometState} from './cometSourceCore.js';
export const need = (ok, label) => requireValue(ok, label, 'comet directory');
export const fields = (v,k) => keys(v,k,[],'comet directory');
// JSON object keys are unordered; array positions and primitive values are not.
export function same(a,b) {
  if(a===b)return true;
  if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)
    && a.length===b.length&&a.every((value,i)=>same(value,b[i]));
  const keys=Object.keys(a);
  return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&same(a[key],b[key]));
}
export const text = v => typeof v === 'string' && v.length > 0 && v.length <= 512 && !/[\x00-\x1f\x7f]/.test(v);
export const id = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(v);
// Decimal steps can round the computed endpoint offset just above count-1.
// Recognize only the exact advertised sample endpoint; never clamp outside it.
export function directoryState(series,jd) {
  const end=series.start+series.step*(series.states.length-1);
  if(jd===end) {const row=series.states.at(-1);return {position:row.slice(0,3),velocity:row.slice(3)};}
  return interpolateCometState(series,jd);
}
export const directoryPosition=(series,jd)=>directoryState(series,jd).position;
export const owns = (c,t) => t >= c.start && (t < c.end || c.end_inclusive && t === c.end);
export function intervals(values) {
  need(Array.isArray(values) && values.length <= 4096,'intervals');
  values.forEach((c,i)=>{
    fields(c,['start','end','end_inclusive']);
    need(Number.isFinite(c.start) && Number.isFinite(c.end) && c.start < c.end && typeof c.end_inclusive === 'boolean','interval');
    if(i) need(values[i-1].end < c.start || values[i-1].end === c.start && !values[i-1].end_inclusive,'overlap');
  });
}
export function validateDirectory(v) {
  fields(v,['comet_contract_version','snapshot','defaults','legacy','objects']);
  need(v.comet_contract_version === 4,'version');
  fields(v.snapshot,['source','retrieved_on','retrieved_at','sha256']);
  need(text(v.snapshot.source) && text(v.snapshot.retrieved_on) && (v.snapshot.retrieved_at === null || text(v.snapshot.retrieved_at)) && /^[a-f0-9]{64}$/.test(v.snapshot.sha256),'snapshot');
  reference(v.legacy,'index-',256*1024);
  need(same(v.defaults,['1P','2P','55P','9P','10P','67P']),'preserved defaults');
  need(Array.isArray(v.objects) && v.objects.length >= 6 && v.objects.length <= 20000,'objects');
  const seen=new Set();
  for(const e of v.objects) {
    fields(e,['id','designation','name','aliases','source_ids','parent_id','assessment','coverage','trajectory']);
    need(id(e.id) && !seen.has(e.id),'identity');seen.add(e.id);
    need(text(e.name) && text(e.designation) && Array.isArray(e.aliases) && e.aliases.length <= 128 && e.aliases.every(text)
      && new Set(e.aliases).size === e.aliases.length && Array.isArray(e.source_ids) && e.source_ids.length > 0 && e.source_ids.every(text)
      && (e.parent_id === null || id(e.parent_id)),'identity metadata');
    fields(e.assessment,['state','reason','scope','evidence']);
    need(['available','not_yet_assessed','under_assessment','unsupported'].includes(e.assessment.state)
      && (e.assessment.reason === null || text(e.assessment.reason)),'assessment');
    intervals(e.assessment.scope);intervals(e.coverage);
    if(e.assessment.state === 'unsupported') {
      need(['no-source-solution','invalid-model','numerical-validation-failed','outside-physical-lifetime'].includes(e.assessment.reason) && e.assessment.scope.length,'scoped rejection');
      fields(e.assessment.evidence,['assessed_at','policy','source','sha256']);
      const a=e.assessment.evidence;
      need(text(a.assessed_at) && Number.isFinite(Date.parse(a.assessed_at)) && text(a.policy) && text(a.source) && /^[a-f0-9]{64}$/.test(a.sha256),'assessment evidence');
    } else need(e.assessment.evidence === null,'assessment evidence');
    need((e.assessment.state === 'available') === (e.coverage.length > 0),'availability');
    if(e.coverage.length) {
      need(e.trajectory !== null,'trajectory');
      if(e.trajectory.kind === 'legacy') {
        fields(e.trajectory,['kind','id']);need(e.trajectory.id === e.id && v.defaults.includes(e.id),'legacy identity');
      } else {fields(e.trajectory,['kind','manifest']);need(e.trajectory.kind === 'manifest','trajectory kind');reference(e.trajectory.manifest,'manifests/',256*1024);}
    } else need(e.trajectory === null,'empty trajectory');
  }
  for(const e of v.objects) need(e.parent_id === null || e.parent_id !== e.id && seen.has(e.parent_id),'parent');
  const parents=new Map(v.objects.map(e=>[e.id,e.parent_id])),finished=new Set();
  for(const e of v.objects) {
    const path=new Set();let current=e.id;
    while(current!==null&&!finished.has(current)) {
      need(!path.has(current),'parent cycle');path.add(current);current=parents.get(current);
    }
    for(const visited of path)finished.add(visited);
  }
  for(const d of v.defaults) need(v.objects.some(e=>e.id === d && e.trajectory?.kind === 'legacy'),'legacy membership');
  return freeze(v);
}
export function validateManifest(v,e) {
  fields(v,['comet_contract_version','id','segments']);
  need(v.comet_contract_version === 4 && v.id === e.id && Array.isArray(v.segments) && v.segments.length > 0 && v.segments.length <= 4096,'manifest');
  need(v.segments.every(s=>s && typeof s === 'object'),'segments');
  intervals(v.segments.map(s=>s.coverage));
  need(same(v.segments.map(s=>s.coverage),e.coverage),'manifest coverage');
  const seen=new Set();
  for(const [index,s] of v.segments.entries()) {
    fields(s,['key','coverage','grid','data','provenance','validation','join']);
    need(id(s.key) && !seen.has(s.key),'segment key');seen.add(s.key);
    const previous=v.segments[index-1],touching=previous?.coverage.end===s.coverage.start;
    need(touching?['continuous','separate'].includes(s.join):s.join===null,'join policy');
    fields(s.grid,['start','step','count']);
    const g=s.grid,end=g.start+g.step*(g.count-1);
    need(Number.isFinite(g.start) && Number.isFinite(g.step) && g.step > 0 && g.start+g.step>g.start && end-g.step<end && Number.isSafeInteger(g.count) && g.count >= 2
      && g.count <= 25000 && Number.isFinite(end) && g.start <= s.coverage.start && end >= s.coverage.end,'sample support');
    reference(s.data,'objects/',2*1024*1024);
    fields(s.provenance,['vectors','checks']);
    need(Array.isArray(s.provenance.checks) && s.provenance.checks.length > 0 && s.provenance.checks.length <= 3,'checks');
    for(const p of [s.provenance.vectors,...s.provenance.checks]) {
      fields(p,['url','sha256','target','solution','header','retrieved_at','api_version']);
      need(typeof p.url === 'string' && p.url.startsWith('https://ssd.jpl.nasa.gov/api/horizons.api?') && /^[a-f0-9]{64}$/.test(p.sha256)
        && text(p.target) && text(p.solution) && typeof p.header === 'string' && p.header.length > 0
        && text(p.retrieved_at) && ['1.2','1.3'].includes(p.api_version),'provenance');
      need(p.target === s.provenance.vectors.target && (p.target === e.name || e.aliases.includes(p.target)) && p.solution === s.provenance.vectors.solution
        && modelIdentity(p.header) === modelIdentity(s.provenance.vectors.header),'model identity');
    }
    if(s.join==='continuous') need(s.provenance.vectors.target===previous.provenance.vectors.target
      && s.provenance.vectors.solution===previous.provenance.vectors.solution
      && modelIdentity(s.provenance.vectors.header).split('\n').filter(l=>!l.startsWith('Step-size')).join('\n')
        ===modelIdentity(previous.provenance.vectors.header).split('\n').filter(l=>!l.startsWith('Step-size')).join('\n'),'join model');
    const a=s.validation;fields(a,['method','samples','tolerance_au','max_error_au','references']);
    need(['all-midpoints-final-serialized','all-quarter-points-final-serialized'].includes(a.method)
      && a.samples === (g.count-1)*(a.method.startsWith('all-quarter')?3:1)
      && a.tolerance_au === .000052 && Number.isFinite(a.max_error_au) && a.max_error_au >= 0 && a.max_error_au <= a.tolerance_au
      && Array.isArray(a.references) && a.references.length > 0 && a.references.every(r=>Array.isArray(r)&&r.length===4&&r.every(Number.isFinite)&&r[0]>=g.start&&r[0]<=end),'validation');
  }
  return freeze(v);
}
export function validateBlock(v,e,s) {
  fields(v,['comet_contract_version','id','conventions','series']);
  need(v.comet_contract_version === 4 && v.id === e.id,'payload identity');
  fields(v.conventions,Object.keys(CONVENTIONS));need(Object.entries(CONVENTIONS).every(([k,value])=>v.conventions[k]===value),'conventions');
  fields(v.series,['start','step','states']);
  need(v.series.start === s.grid.start && v.series.step === s.grid.step && Array.isArray(v.series.states)
    && v.series.states.length === s.grid.count && v.series.states.every(r=>Array.isArray(r)&&r.length===6&&r.every(Number.isFinite)),'states');
  for(const r of s.validation.references) need(Math.hypot(...directoryPosition(v.series,r[0]).map((x,i)=>x-r[i+1]))<=.000052,'numerical evidence');
  return v;
}
