// Strict schema-3 adapter, shared by production dispatch and explicit candidates.
import { CometSource, interpolateComet, interpolateCometState, CometDownloadQueue, cometPathStrip } from './cometSourceCore.js';
import { fetchLatest, fetchVerified, decodeJSON, check } from './transport.js';
import { keys } from './contract.js';
import { T, END, reference, requireHistory, validateHistoryIndex, validateSegment } from './cometHistoryContract.js';

export default class CometHistorySource extends CometSource {
  static async openLatest(url, { signal } = {}) {
    return this.openDescriptor(await fetchLatest(url, signal, 'comet'), { signal });
  }
  static async openDescriptor({ location, latest }, { signal } = {}) {
    check(signal, 'comet');
    keys(latest,['comet_contract_version','index'],[],'comet history');
    requireHistory(latest.comet_contract_version === 3,'contract version');
    reference(latest.index,'index-',256*1024);
    const indexURL = new URL(latest.index.url,location).href;
    const bytes = await fetchVerified(latest.index,indexURL,signal,'comet');
    check(signal,'comet');
    const index = validateHistoryIndex(decodeJSON(bytes,'comet'));
    check(signal,'comet');
    return new CometHistorySource(indexURL,latest.index.sha256,index);
  }
  constructor(url,pin,index) {
    super(url,pin,index);
    this.entries = index.objects.flatMap(e=>e.segments.map(s=>({id:`${e.id}:${s.key}`,objectId:e.id,segment:s,data:s.data})));
    this.downloads = new CometDownloadQueue();
    this.validatedTransitions = new Map();
  }
  object(id) {
    check(this.lifetime.signal,'comet');
    const entry = this.info.objects.find(e=>e.id===id);
    requireHistory(entry,'selection');
    return entry;
  }
  segmentAt(id,jd) {
    requireHistory(Number.isFinite(jd),'date');
    return this.object(id).segments.find(s=>jd>=s.coverage.start &&
      (jd<s.coverage.end || (jd===s.coverage.end && s.coverage.end_inclusive))) ?? null;
  }
  // No default date: callers must explicitly distinguish marker and path reads.
  async load(id,{jd,signal}={}) {
    check(signal,'comet');
    const segment = this.segmentAt(id,jd);
    return segment ? this.loadSegment(id,segment.key,{signal}) : null;
  }
  async group(signal, work) {
    check(signal,'comet'); check(this.lifetime.signal,'comet');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener('abort',cancel,{once:true});
    try { return await work(controller.signal); }
    finally { controller.abort(); signal?.removeEventListener('abort',cancel); }
  }
  async loadSegment(id,key,{signal}={}) {
    check(signal,'comet');
    const object = this.object(id);
    requireHistory(object.segments.some(s=>s.key===key),'selection');
    // Modern is independently authoritative. History must prove compatibility
    // against modern, including retries and pre-1980-only visits.
    if (key === 'modern' || !object.transition) return super.load(`${id}:${key}`,{signal});
    return this.group(signal,async sharedSignal=>{
      const [historical,modern] = await Promise.all(['historical','modern'].map(part=>
        super.load(`${id}:${part}`,{signal:sharedSignal})));
      check(sharedSignal,'comet'); check(this.lifetime.signal,'comet');
      const verified = this.validatedTransitions.get(id);
      if (verified?.historical !== historical || verified?.modern !== modern) {
        try { this.validateTransition(object,historical,modern); }
        catch(error) {
          this.validatedTransitions.delete(id);
          this.cache.delete(`${id}:historical`);
          throw error;
        }
        this.validatedTransitions.set(id,{historical,modern});
      }
      return key==='historical'?historical:modern;
    });
  }
  async positionAt(id,jd,{signal}={}) {
    const value = await this.load(id,{jd,signal});
    check(signal,'comet'); check(this.lifetime.signal,'comet');
    return value ? interpolateComet(value.series,jd) : null;
  }
  // Returns separate strips; support-only samples beyond the owned interval are
  // never exposed as path vertices. No connector or cross-file interpolation.
  async pathSegments(id,start,end,{signal}={}) {
    requireHistory(Number.isFinite(start)&&Number.isFinite(end)&&start<=end,'path range');
    check(signal,'comet');
    const wanted = this.object(id).segments.filter(s=>start<=s.coverage.end && end>=s.coverage.start
      && !(start===s.coverage.end && !s.coverage.end_inclusive));
    return this.group(signal,async pathSignal=>{
    const strips = await Promise.all(wanted.map(async s=>{
      const value = await this.loadSegment(id,s.key,{signal:pathSignal});
      return cometPathStrip({key:s.key,coverage:s.coverage,series:value.series},start,end);
    }));
    check(signal,'comet'); check(this.lifetime.signal,'comet');
    return strips.filter(Boolean);
    });
  }
  validatePayload(value,entry) { return validateSegment(value,entry); }
  validateTransition(object,historical,modern) {
    for(const c of object.transition.comparisons) {
      const h = interpolateCometState(historical.series,c.jd), m = interpolateCometState(modern.series,c.jd);
      const dp = Math.hypot(...h.position.map((v,i)=>v-m.position[i]));
      const dv = Math.hypot(...h.velocity.map((v,i)=>v-m.velocity[i]));
      requireHistory(dp <= object.transition.position_limit_au && dv <= object.transition.velocity_limit_au_per_day
        && Math.abs(dp-c.position_difference_au)<=1e-14 && Math.abs(dv-c.velocity_difference_au_per_day)<=1e-14,'transition evidence');
    }
  }
  // The strict index admits exactly eight files, each <=2MiB. Retaining all
  // verified files is bounded by construction; there is no unreachable LRU policy.
  fetchEntry(entry,signal) {
    return this.downloads.run(signal,()=>super.fetchEntry(entry,signal));
  }
  close() { super.close(); this.validatedTransitions.clear(); }
}
export { T, END };
