// One pinned, immutable generation. No discovery-chunk dependency or automatic activation.
import {keys,requireValue,freeze} from './contract.js';
import {fetchVerified,decodeJSON,check,linkCancellation,validatedURL} from './transport.js';
const product='named bodies', need=(ok,label)=>requireValue(ok,label,product);
const fields=(v,k)=>keys(v,k.split(' '),[],product);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const number=x=>typeof x==='number'&&Number.isFinite(x);
const start=2378496.5,end=2488069.5,epoch=2451545;
const names=['Mercury','Venus','Earth','Mars','Jupiter','Saturn','Uranus','Neptune','Ceres','Pluto','Haumea','Makemake','Eris'];
const ids=[...names.slice(0,8).map(x=>'orrery:planet:'+x.toLowerCase()),...[1,134340,136108,136472,136199].map(x=>'mpc:number:'+x)];
const targets=['199','299','399','4','5','6','7','8','1;','9','136108;','136472;','136199;'];
const conventions={origin:'Sun centre',frame:'Horizons ecliptic J2000 (IAU76 obliquity relative to ICRF)',distance:'AU',angles:'degrees',time:'TDB Julian days',rate_time:'Julian century (36525 days)',epoch,elements:['a','e','i','ascending_node','argument_of_perihelion','mean_anomaly']};
export function validateNamedDefinitions(v){
 fields(v,'named_body_version conventions model validation_interval extrapolation evidence_sha256 bodies');
 need(v.named_body_version===1&&v.model==='linear-rate-kepler'&&hash(v.evidence_sha256),'version/model');
 fields(v.conventions,Object.keys(conventions).join(' '));
 for(const [k,x] of Object.entries(conventions))need(JSON.stringify(v.conventions[k])===JSON.stringify(x),'conventions '+k);
 need(Array.isArray(v.validation_interval)&&v.validation_interval.length===2&&v.validation_interval[0]===start&&v.validation_interval[1]===end,'interval');
 need(v.extrapolation==='freeze-shape-at-nearest-boundary; continue-mean-anomaly-at-fitted-rate','extrapolation');
 need(Array.isArray(v.bodies)&&v.bodies.length===13,'inventory');
 v.bodies.forEach((b,i)=>{
  fields(b,'id name classification target centre_kind elements rates sources validation');
  need(b.id===ids[i]&&b.name===names[i]&&b.target===targets[i]&&b.classification===(i<8?'planet':'dwarf-planet'),'identity');
  need(b.centre_kind===(/^[1-9]$/.test(targets[i])?'system-barycentre':'body-centre'),'centre');
  for(const k of ['elements','rates'])need(Array.isArray(b[k])&&b[k].length===6&&b[k].every(number),k);
  need(b.rates[5]>0,'mean motion');
  for(const jd of [start,end]){const t=(jd-epoch)/36525,a=b.elements[0]+b.rates[0]*t,e=b.elements[1]+b.rates[1]*t;need(a>0&&e>=0&&e<1,'elliptic interval');}
  fields(b.sources,'elements fit validation');
  for(const s of Object.values(b.sources)){
   fields(s,'url sha256 retrieved_at target');
   need(typeof s.url==='string'&&s.url.startsWith('https://ssd.jpl.nasa.gov/api/horizons.api?')&&hash(s.sha256)
    &&typeof s.retrieved_at==='string'&&typeof s.target==='string'&&s.target.toLowerCase().includes(b.name.toLowerCase()),'source provenance');
  }
  fields(b.validation,'samples max_position_error_au max_direction_error_degrees meaning');
  need(Number.isSafeInteger(b.validation.samples)&&b.validation.samples>0&&b.validation.meaning==='sampled-residuals-not-guaranteed-bounds','samples');
  for(const k of ['max_position_error_au','max_direction_error_degrees'])need(number(b.validation[k])&&b.validation[k]>=0,'residual');
 });
 return freeze(v);
}
export function validateNamedMapping(v,source){
 fields(v,'named_body_mapping_version catalog_id asteroid_index_sha256 snapshot_version records members');
 need(v.named_body_mapping_version===1&&hash(v.asteroid_index_sha256)&&v.asteroid_index_sha256===source.sourceId
   &&v.catalog_id===source.info.catalog_id&&v.snapshot_version===source.info.snapshot_version&&v.records===source.info.counts.discovery_export,'asteroid generation');
 need(Number.isSafeInteger(v.records)&&v.records>=0&&Array.isArray(v.members)&&v.members.length===5,'mapping inventory');
 const used=new Set();
 v.members.forEach((m,i)=>{
  fields(m,'id status ordinal discovery_jd reason');need(m.id===ids[i+8]&&(m.discovery_jd===null||number(m.discovery_jd)),'mapping identity/date');
  if(m.status==='present'){
   need(Number.isSafeInteger(m.ordinal)&&m.ordinal>=0&&m.ordinal<v.records&&!used.has(m.ordinal)&&m.discovery_jd!==null&&m.reason===null,'present mapping');used.add(m.ordinal);
  }else{
   need(m.status==='absent-from-export'&&m.ordinal===null&&['not-in-master','unknown-discovery-date','selection-limit'].includes(m.reason),'absence');
   need((m.reason==='selection-limit')===(m.discovery_jd!==null),'absence date');
  }
 });return freeze(v);
}
// Consumer adaptation: share the producer's propagation/basis between markers
// and tracks. Coefficients, conventions and extrapolation policy are unchanged.
export function namedShapeDate(jd) {
 need(number(jd),'date');
 return Math.min(end,Math.max(start,jd));
}
export function namedEllipse(body,jd) {
 const bounded=namedShapeDate(jd),t=(bounded-epoch)/36525;
 let [a,e,i,O,w,M]=body.elements.map((x,k)=>x+body.rates[k]*t);
 M+=body.rates[5]*((jd-bounded)/36525);need([a,e,i,O,w,M].every(number),'propagation overflow');
 [i,O,w]=[i,O,w].map(x=>x*Math.PI/180);
 const cw=Math.cos(w),sw=Math.sin(w),cO=Math.cos(O),sO=Math.sin(O),ci=Math.cos(i),si=Math.sin(i),b=a*Math.sqrt(1-e*e);
 const p=[cw*cO-sw*sO*ci,cw*sO+sw*cO*ci,sw*si].map(x=>x*a);
 const q=[-sw*cO-cw*sO*ci,-sw*sO+cw*cO*ci,cw*si].map(x=>x*b);
 return {p,q,center:p.map(x=>-e*x),normal:[sO*si,-cO*si,ci],e,M,
   status:jd>=start&&jd<=end?'validated-interval':'approximate-extrapolation'};
}
export function namedPosition(body,jd){
 const {p,q,e,M:mean,status}=namedEllipse(body,jd);
 const M=((mean%360)+360)%360*Math.PI/180;let E=M;
 for(let k=0;k<32;k++){const d=(E-e*Math.sin(E)-M)/(1-e*Math.cos(E));E-=d;if(Math.abs(d)<1e-13)break;}
 need(Math.abs(E-e*Math.sin(E)-M)<1e-11,'Kepler convergence');
 return {position:p.map((x,k)=>x*(Math.cos(E)-e)+q[k]*Math.sin(E)),status};
}
function reference(ref,prefix){fields(ref,'url sha256 bytes');need(typeof ref.url==='string'&&hash(ref.sha256)&&Number.isSafeInteger(ref.bytes)&&ref.bytes>0&&ref.bytes<=128*1024,'reference');if(prefix)need(ref.url===prefix+ref.sha256+'.json','reference path');}
export async function loadNamedBodies(source,ref,url,{signal}={}){
 const controller=new AbortController();let unlink=()=>{};
 try{
  need(!source.closed,'closed asteroid source');reference(ref);
  unlink=linkCancellation(controller,[source.lifetime.signal,...(signal?[signal]:[])]);check(controller.signal,product);
  const base=validatedURL(url,product);
  need(new URL(ref.url,base).href===base.href,'reference URL mismatch');
  const index=decodeJSON(await fetchVerified(ref,base.href,controller.signal,product),product);
  fields(index,'named_body_product_version definitions mapping');need(index.named_body_product_version===1,'product version');
  reference(index.definitions,'definitions-');reference(index.mapping,'mapping-');
  const [d,m]=await Promise.all([index.definitions,index.mapping].map(async r=>decodeJSON(await fetchVerified(r,new URL(r.url,base).href,controller.signal,product),product)));
  const result={definitions:validateNamedDefinitions(d),mapping:validateNamedMapping(m,source)};
  check(controller.signal,product);need(!source.closed,'closed asteroid source');return freeze(result);
 }catch(error){controller.abort();throw error;}finally{unlink();}
}
