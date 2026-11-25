import {CometSource,reference,CometDownloadQueue,cometPathStrip} from './cometSourceCore.js';
import HistorySource from './CometHistorySource.js';
import {validateHistoryIndex} from './cometHistoryContract.js';
import {fetchLatest,fetchVerified,decodeJSON,check} from './transport.js';
import {validateDirectory,validateManifest,validateBlock,need,fields,owns,same,directoryPosition as interpolateComet,directoryState as interpolateCometState} from './cometDirectoryContract.js';
const defaults=['1P','2P','55P','9P','10P','67P'];
const normalized=s=>s.normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
function coversWindow(coverage,start,end) {
  let cursor=start;
  for(const c of coverage) {
    if(c.end<cursor || c.end===cursor&&!c.end_inclusive)continue;
    if(c.start>cursor)return false;
    if(c.end>end || c.end===end&&c.end_inclusive)return true;
    cursor=c.end;
  }
  return false;
}
// One source generation owns metadata and all requests. The UI owns selection.
export default class CometDirectorySource extends CometSource {
  static async openLatest(url,{signal}={}) {
    return this.openDescriptor(await fetchLatest(url,signal,'comet'),{signal});
  }
  static async openDescriptor({location,latest},{signal}={}) {
    fields(latest,['comet_contract_version','index']);
    need([3,4].includes(latest.comet_contract_version),'version');
    reference(latest.index,'index-',latest.comet_contract_version===4?4*1024*1024:256*1024);
    const indexURL=new URL(latest.index.url,location).href;
    const index=decodeJSON(await fetchVerified(latest.index,indexURL,signal,'comet'));
    let info,legacyIndex,legacyURL;
    if(latest.comet_contract_version===3) {
      legacyIndex=validateHistoryIndex(index);legacyURL=indexURL;
      info={comet_contract_version:3,defaults,objects:index.objects.map(e=>({id:e.id,designation:e.id,name:e.name,aliases:[e.id,e.name],
        source_ids:[e.id],parent_id:null,assessment:{state:'available',reason:null,scope:[],evidence:null},coverage:e.segments.map(s=>s.coverage),trajectory:{kind:'legacy',id:e.id}}))};
    } else {
      info=validateDirectory(index);legacyURL=new URL(info.legacy.url,indexURL).href;
      legacyIndex=validateHistoryIndex(decodeJSON(await fetchVerified(info.legacy,legacyURL,signal,'comet')));
      need(same(info.objects.filter(e=>e.trajectory?.kind==='legacy').map(e=>e.id).sort(),legacyIndex.objects.map(e=>e.id).sort()),'legacy membership');
      for(const e of legacyIndex.objects) need(same(info.objects.find(x=>x.id===e.id)?.coverage,e.segments.map(s=>s.coverage)),'legacy coverage');
    }
    check(signal);
    return new this(indexURL,latest.index.sha256,info,new HistorySource(legacyURL,latest.comet_contract_version===3?latest.index.sha256:info.legacy.sha256,legacyIndex));
  }
  constructor(url,pin,info,legacy) {
    super(url,pin,info);this.legacy=legacy;this.entries=[];this.byId=new Map(info.objects.map(e=>[e.id,e]));
    this.searchRows=info.objects.map(e=>({e,terms:[e.id,e.designation,e.name,...e.aliases].map(normalized)}));
    this.aliases=new Map();
    for(const {e,terms} of this.searchRows) for(const term of new Set(terms.filter(Boolean))) {if(!this.aliases.has(term))this.aliases.set(term,[]);this.aliases.get(term).push(e);}
    this.downloads=new CometDownloadQueue();this.cacheBudget=16*1024*1024;
    for(const e of info.objects) if(e.trajectory?.kind==='manifest') this.entries.push({id:`manifest:${e.id}`,object:e,data:e.trajectory.manifest,kind:'manifest'});
    this.entriesById=new Map(this.entries.map(e=>[e.id,e]));
  }
  entryFor(id) { return this.entriesById.get(id); }
  async readEntry(id,signal) {
    const value=await super.load(id,{signal});
    if(this.cache.has(id)){this.cache.delete(id);this.cache.set(id,value);}
    this.trim();return value;
  }
  getObject(value) {
    check(this.lifetime.signal);if(this.byId.has(value))return this.byId.get(value);
    need(typeof value==='string','identity');const key=normalized(value),matches=key?this.aliases.get(key)??[]:[];
    need(matches.length===1,matches.length?'ambiguous alias':'unknown identity');return matches[0];
  }
  search(query='',{cursor=null,limit=30}={}) {
    check(this.lifetime.signal);need(typeof query==='string'&&Number.isSafeInteger(limit)&&limit>0&&limit<=200,'search');
    const q=normalized(query),browse=query.trim()==='';let offset=0;
    if(cursor!==null){fields(cursor,['pin','query','offset']);need(cursor.pin===this.sourceId&&cursor.query===q&&Number.isSafeInteger(cursor.offset)&&cursor.offset>=0,'cursor');offset=cursor.offset;}
    const rows=this.searchRows.filter(r=>browse||q&&r.terms.some(t=>t.includes(q)));
    need(offset<=rows.length,'cursor range');
    return {items:rows.slice(offset,offset+limit).map(r=>r.e),total:rows.length,complete:true,
      nextCursor:offset+limit<rows.length?{pin:this.sourceId,query:q,offset:offset+limit}:null};
  }
  availabilityAt(id,jd) {
    need(Number.isFinite(jd),'date');const e=this.getObject(id);
    if(e.coverage.length)return e.coverage.some(c=>owns(c,jd))?'available_at_date':'outside_coverage';
    if(e.assessment.state==='unsupported'&&!e.assessment.scope.some(c=>owns(c,jd)))return 'not_yet_assessed';
    return e.assessment.state;
  }
  async getDetails(id,{signal}={}) {
    const e=this.getObject(id);check(signal);
    if(e.trajectory?.kind==='legacy')return {object:e,discovery:this.legacy.object(e.id).discovery,segments:this.legacy.object(e.id).segments};
    return {object:e,discovery:null,segments:e.trajectory?(await this.manifest(e,signal)).segments:[]};
  }
  async manifest(e,signal) {return this.readEntry(`manifest:${e.id}`,signal);}
  async load(id,{jd,signal}={}) {const result=await this.loadWindow(id,{start:jd,end:jd,signal});return result.segments[0]??null;}
  async loadWindow(id,{start,end,signal}={}) {
    check(signal);check(this.lifetime.signal);need(Number.isFinite(start)&&Number.isFinite(end)&&start<=end,'window');
    const e=this.getObject(id),startStatus=this.availabilityAt(e.id,start);
    const wanted=e.coverage.filter(c=>end>=c.start&&(start<c.end||c.end_inclusive&&start===c.end));
    if(!wanted.length)return {id:e.id,status:startStatus,startStatus,complete:false,segments:[]};
    const status='available',complete=coversWindow(e.coverage,start,end);
    if(e.trajectory.kind==='legacy') {
      const entry=this.legacy.object(e.id),segments=[];
      for(const s of entry.segments.filter(s=>wanted.some(c=>same(c,s.coverage)))) {
        const v=await this.legacy.loadSegment(e.id,s.key,{signal});segments.push({key:s.key,coverage:s.coverage,series:v.series});
      }
      check(signal);check(this.lifetime.signal);return {id:e.id,status,startStatus,complete,segments};
    }
    const manifest=await this.manifest(e,signal),segments=[];
    const selected=manifest.segments.filter(s=>wanted.some(c=>same(c,s.coverage)));
    const required=new Set(selected);
    for(let i=1;i<manifest.segments.length;i++)if(manifest.segments[i].join==='continuous'
      && (selected.includes(manifest.segments[i])||selected.includes(manifest.segments[i-1]))) {
      required.add(manifest.segments[i]);required.add(manifest.segments[i-1]);
    }
    need([...required].reduce((sum,s)=>sum+s.data.bytes,0)<=this.cacheBudget,'window byte budget');
    const loaded=new Map();
    // Sequential per window avoids speculative downloads; independent readers share requests.
    for(const s of required) {
      const key=`block:${e.id}:${s.key}`;
      if(!this.entriesById.has(key)){const entry={id:key,object:e,segment:s,data:s.data,kind:'block'};this.entries.push(entry);this.entriesById.set(key,entry);}
      const v=await this.readEntry(key,signal);loaded.set(s,v);if(selected.includes(s))segments.push({key:s.key,coverage:s.coverage,series:v.series});
    }
    for(let i=1;i<manifest.segments.length;i++) {
      const a=manifest.segments[i-1],b=manifest.segments[i];
      if(b.join!=='continuous'||!loaded.has(a)||!loaded.has(b))continue;
      const left=interpolateCometState(loaded.get(a).series,b.coverage.start),right=interpolateCometState(loaded.get(b).series,b.coverage.start);
      need(Math.hypot(...left.position.map((x,k)=>x-right.position[k]))<=.000052
        && Math.hypot(...left.velocity.map((x,k)=>x-right.velocity[k]))<=.000013,'join evidence');
    }
    check(signal);check(this.lifetime.signal);return {id:e.id,status,startStatus,complete,segments};
  }
  async positionAt(id,jd,options={}) {
    const {segments}=await this.loadWindow(id,{start:jd,end:jd,...options});
    const s=segments.find(s=>owns(s.coverage,jd));return s?interpolateComet(s.series,jd):null;
  }
  async pathSegments(id,start,end,options={}) {
    const {segments}=await this.loadWindow(id,{start,end,...options});
    return segments.map(s=>cometPathStrip(s,start,end,interpolateComet)).filter(Boolean);
  }
  validatePayload(value,entry) {return entry.kind==='manifest'?validateManifest(value,entry.object):validateBlock(value,entry.object,entry.segment);}
  trim() {
    let bytes=0;for(const key of this.cache.keys())bytes+=this.entriesById.get(key).data.bytes;
    for(const key of this.cache.keys()) {if(bytes<=this.cacheBudget)break;bytes-=this.entriesById.get(key).data.bytes;this.cache.delete(key);}
    // Eviction must release per-block provenance as well as parsed states.
    this.entries=this.entries.filter(e=>{const keep=e.kind==='manifest'||this.cache.has(e.id)||this.pending.has(e.id);if(!keep)this.entriesById.delete(e.id);return keep;});
  }
  fetchEntry(entry,signal) {return this.downloads.run(signal,()=>super.fetchEntry(entry,signal));}
  close(){this.legacy.close();super.close();}
}
