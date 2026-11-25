import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Acquisition, { openCandidateSource, openHostedSource, COMET_LATEST_URL } from '../src/unified/comets/Acquisition.js';
import { positionAt, pathStrips, cometFitPoints, cataloguePresentation, firstDate, lastDate } from '../src/unified/comets/model.js';
import { fixture } from './comet-history-fixture.mjs';
const T=2444239.5, END=2488067.5;
const base='https://candidate.test/';
function transport(t, files, fail=()=>false) {
  const calls=[];
  t.mock.method(globalThis,'fetch',async url=>{
    const name=new URL(url).pathname.replace(/^\/orrery-data\/comets\//,'').replace(/^\//,'');calls.push(name);
    return files.has(name) && !fail(name) ? new Response(files.get(name)) : new Response('',{status:404});
  });
  return calls;
}
async function checkAcquisition(t, files, real=false) {
  const calls=transport(t,files);
  const a=new Acquisition(()=>{});
  t.after(()=>a.close());
  const source=await a.source(), entries=cataloguePresentation(source.info.objects), ids=entries.map(e=>e.id);
  assert.equal(Object.keys(a.data).length,0,'metadata never installs trajectories');
  await a.select(ids);
  assert(ids.every(id=>a.states[id]==='ready'));
  if(real) assert.equal(source.sourceId,'a9de1f2f711dd65e880102de7c1f0c14bf20598a20d9cc4e001081406e40c2e2');
  for(const entry of entries) {
    const model=a.data[entry.id];
    assert.equal(model.discovery,undefined,'metadata remains owned by the catalogue');
    for (const segment of model.segments) {
      assert.equal(segment.points,undefined,'no full duplicate path is retained');
      assert.equal(segment.series,(await source.loadSegment(entry.id,segment.key)).series);
    }
    for(const jd of [firstDate(model),T-1e-6,T,T+1e-6,T+1,END,END+1e-6,firstDate(model)-1e-6]) {
      const expected=await source.positionAt(entry.id,jd), actual=positionAt(model,jd);
      assert.deepEqual(actual && [actual.x,actual.y,actual.z],expected);
      if(!actual) continue;
      const strips=pathStrips(model,jd,entry.periodDays);
      assert.equal(pathStrips(model,jd,entry.periodDays),strips,'unchanged windows reuse geometry');
      for(const strip of strips) {
        if(strip.key==='historical') assert(strip.points.at(-1)[0]<T);
        else assert(strip.points[0][0]>=T);
      }
      const fit=cometFitPoints(a.data,[entry.id],jd,entries);
      assert.deepEqual(fit.slice(1),strips.flatMap(s=>s.points.map(p=>p.slice(1))));
    }
  }
  assert.equal(calls.filter(name=>name==='latest.json').length,1,'one descriptor pins dispatch and all object reads');
  const data=a.data;
  await a.select([]);await a.select(ids);
  assert.equal(a.data,data,'selection retains validated trajectories');
  a.replace(openCandidateSource(base+'latest.json'));
  assert.deepEqual(a.data,{});assert.deepEqual(a.states,{});
  assert.equal(COMET_LATEST_URL,'https://sn3p.github.io/orrery-data/comets/latest.json');
}
test('candidate metadata and owned segments flow through acquisition, timeline markers and Fit',async t=>{
  await checkAcquisition(t,fixture().files);
});
test('one missing segment rejects the entire selected object; retry preserves pin',async t=>{
  const f=fixture(),missing=f.index.objects[0].segments[0].data.url;
  let failing=true;transport(t,f.files,name=>failing&&name===missing);
  const a=new Acquisition(()=>{});t.after(()=>a.close());
  const source=await a.source();await a.select(['1P']);
  assert.equal(a.states['1P'],'error');assert.equal(a.data['1P'],undefined);
  failing=false;await a.select(['1P'],true);
  assert.equal(a.states['1P'],'ready');assert.equal(await a.source(),source);
});
test('retained exact candidate bytes pass application acquisition and consumers', {skip:!process.env.COMET_HISTORY_CANDIDATE},async t=>{
  const directory=process.env.COMET_HISTORY_CANDIDATE,files=new Map();
  async function visit(dir='') {for(const e of await fs.readdir(path.join(directory,dir),{withFileTypes:true})) {
    const name=path.posix.join(dir,e.name);if(e.isDirectory())await visit(name);else files.set(name,await fs.readFile(path.join(directory,name)));
  }}
  await visit();await checkAcquisition(t,files,true);
});

import {eventDate,historyEvents} from '../src/unified/comets/history.js';
test('timeline event metadata preserves precision, calendars, distinctions and conflict',()=>{
  const {index}=fixture();
  assert.equal(eventDate(index.objects[0].discovery.events[0].date),'240 BCE (calendar unspecified)');
  const tt=historyEvents(index.objects.find(e=>e.id==='55P'),index.sources);
  assert(tt.some(e=>e.text.startsWith('1865-12 (Gregorian): independent discovery')));
  const conflict=historyEvents(index.objects.find(e=>e.id==='10P'),index.sources)[0];
  assert(conflict.text.startsWith('1873-07 (Gregorian): discovery'));
  assert(conflict.text.includes('July 3'));assert(conflict.text.includes('July 4'));
  assert.equal(conflict.citations[0].url,index.sources.sbdb.url);
});
test('candidate deselection and source replacement prevent delayed pair installation',async t=>{
  const f=fixture();let release;const gate=new Promise(r=>release=r);
  t.mock.method(globalThis,'fetch',async (url,{signal})=>{
    const name=new URL(url).pathname.replace(/^\/orrery-data\/comets\//,'').replace(/^\//,'');
    if(name.startsWith('objects/')) await gate;
    if(signal.aborted)throw new DOMException('Cancelled','AbortError');
    return new Response(f.files.get(name));
  });
  const a=new Acquisition(()=>{});t.after(()=>a.close());
  await a.source();const pending=a.select(['55P']);await a.select([]);a.replace();release();await pending;
  assert.deepEqual(a.data,{});assert.deepEqual(a.states,{});
  await a.select(['55P']);assert.equal(a.states['55P'],'ready');
});

import {CometFeedbackCache,catalogueCoverage} from '../src/unified/comets/feedback.js';
test('feedback skips unchanged coverage regions, invalidates endpoints, selection and state',()=>{
  let reads=0;
  const model={get start(){reads++;return 10;},step:2,states:[[0,0,0,0,0,0],[1,1,1,0,0,0]]};
  const app={cometData:{'1P':model},cometCatalogue:[],cometIds:['1P'],cometStates:{'1P':'ready'},jed:10.1};
  Object.defineProperty(app,'rememberedCometIds',{get(){throw Error('Feedback must not copy remembered IDs');}});
  const cache=new CometFeedbackCache();assert(cache.changed(app));const baseline=reads;
  for(const jed of [10.2,10.3,11,11.9]){app.jed=jed;assert(!cache.changed(app));}
  assert.equal(reads,baseline,'no per-model coverage reads during playback within a region');
  for(const jed of [12,12.1,10,9.9]){app.jed=jed;assert(cache.changed(app));}
  app.cometIds=[];assert(cache.changed(app));app.cometStates['1P']='error';assert(cache.changed(app));
  app.cometData={};assert(cache.changed(app));
  app.cometSelection={ids:['999P']};assert(cache.changed(app));
  assert(!cache.changed(app));
  app.cometSelection.ids=[];assert(cache.changed(app));
  assert.deepEqual(catalogueCoverage([{coverage:[10,20]},{coverage:[10,20]}]),[10,20]);
  assert.deepEqual(catalogueCoverage(fixture().index.objects),[2391511.5,END]);
});
test('disputed events are labelled and BCE month/day precision has a trailing era',()=>{
  for(const [precision,expected] of [['year','240 BCE'],['month','240-05 BCE'],['day','240-05-02 BCE']])
    assert.equal(eventDate({year:-239,month:5,day:2,precision,calendar:'gregorian'}),`${expected} (Gregorian)`);
  assert.equal(eventDate({year:0,month:null,day:null,precision:'year',calendar:'historical-unspecified'}),'1 BCE (calendar unspecified)');
  const {index}=fixture(), disputed=historyEvents(index.objects.find(e=>e.id==='10P'),index.sources)[0];
  assert(disputed.text.includes('discovery (day disputed)'));assert(disputed.text.includes('July 3'));assert(disputed.text.includes('July 4'));
});
test('segmented windows use the series grid and only read displayed states',()=>{
  let reads=0;
  const rows=Array.from({length:12001},(_,i)=>[i,0,0,0,0,0]);
  const states=new Proxy(rows,{get(target,key){if(/^\d+$/.test(String(key)))reads++;return target[key];}});
  const model={segments:[{key:'modern',coverage:{start:10,end:24010,end_inclusive:true},series:{start:10,step:2,states}}]};
  const strips=pathStrips(model,12010,10);
  assert.equal(strips[0].points.at(-1)[0]-strips[0].points[0][0],12);
  assert(reads<=12,`display window read ${reads} states out of ${rows.length}`);
  const firstReads=reads;assert.equal(pathStrips(model,12010,10),strips);assert.equal(reads,firstReads);
  pathStrips(model,12026,10);assert(reads-firstReads<=12);
});

import HistorySource from '../src/unified/comets/source/CometHistorySource.js';
import {modelIdentity} from '../src/unified/comets/source/cometHistoryContract.js';
test('reader modern access neither requests nor depends on unavailable history',async t=>{
  const f=fixture(),old=f.index.objects[0].segments[0].data.url;
  f.files.delete(old);const calls=transport(t,f.files);
  const source=await HistorySource.openLatest(base+'latest.json');t.after(()=>source.close());
  assert.deepEqual(await source.positionAt('1P',T),[0,0,0]);
  assert.deepEqual((await source.pathSegments('1P',T,T+8)).map(s=>s.key),['modern']);
  assert(!calls.includes(old));
  await assert.rejects(source.positionAt('1P',T-1));
  assert.deepEqual(await source.positionAt('1P',T),[0,0,0]);
});
test('reader memoizes only successful immutable transition pairs per source',async t=>{
  transport(t,fixture().files);
  const source=await HistorySource.openLatest(base+'latest.json');t.after(()=>source.close());
  let checks=0;const check=source.validateTransition.bind(source);
  source.validateTransition=(...args)=>{checks++;check(...args);};
  const historical=await source.loadSegment('1P','historical');
  assert(Object.isFrozen(historical.series.states));
  await source.pathSegments('1P',T-8,T+8);await source.positionAt('1P',T-1);await source.positionAt('1P',T);
  assert.equal(checks,1);
  source.close();assert.equal(source.validatedTransitions.size,0);
  const next=await HistorySource.openLatest(base+'latest.json');t.after(()=>next.close());
  assert.equal(next.validatedTransitions.size,0);await next.positionAt('1P',T-1);assert.equal(next.validatedTransitions.size,1);
});
test('reader failed pair is never memoized and retry preserves authoritative modern',async t=>{
  const f=fixture((kind,value,object,segment)=>{
    if(kind==='payload'&&object.id==='1P'&&segment.key==='historical')value.series.states.at(-1)[3]=.00005;
  });
  const calls=transport(t,f.files),entry=f.index.objects[0];
  const source=await HistorySource.openLatest(base+'latest.json');t.after(()=>source.close());
  const modern=await source.loadSegment('1P','modern');
  for(let i=0;i<2;i++)await assert.rejects(source.positionAt('1P',T-1),/transition evidence/);
  assert.equal(source.validatedTransitions.size,0);
  assert.equal(await source.loadSegment('1P','modern'),modern);
  assert.equal(calls.filter(name=>name===entry.segments[0].data.url).length,2);
  assert.equal(calls.filter(name=>name===entry.segments[1].data.url).length,1);
});
test('reader rejects empty source keys and accepts Python-equivalent scientific header lines',async t=>{
  for(const mutate of [index=>{index.sources['']=index.sources.sbdb;},index=>{index.objects[0].discovery.events[0].sources=[''];}]){
    const f=fixture((kind,value)=>{if(kind==='index')mutate(value);});transport(t,f.files);
    await assert.rejects(HistorySource.openLatest(base+'latest.json'));
  }
  const f=fixture((kind,index)=>{if(kind==='index')for(const [i,v] of Object.values(index.objects[0].segments[0].provenance).entries())
    v.header=v.header.replaceAll('\n',['\r','\r\n','\u0085','\n'][i]);});
  transport(t,f.files);const source=await HistorySource.openLatest(base+'latest.json');source.close();
});
test('model identity preserves scientific lines for every Python splitlines separator',()=>{
  for(const separator of ['\n','\r','\r\n','\v','\f','\x1c','\x1d','\x1e','\x85','\u2028','\u2029']){
    const header=['Start time: request','EOP file: observed','Stop  time: request','Model: DE441'].join(separator)+separator;
    assert.equal(modelIdentity(header),'EOP file: observed\nModel: DE441');
    assert.notEqual(modelIdentity(header.replace('DE441','DE440')),modelIdentity(header));
  }
});

test('acquisition rejects resealed historical catalogues with changed modern solutions before payload reads',async t=>{
  for(const [id,solution] of [['1P','JPL#76'],['55P','JPL#J985/70']])await t.test(id,async t=>{
    const f=fixture((kind,index)=>{if(kind==='index'){
      const modern=index.objects.find(object=>object.id===id).segments.find(segment=>segment.key==='modern');
      // Change both together so schema-2's matching-provenance check still passes.
      modern.provenance.vectors.solution=modern.provenance.midpoints.solution=solution;
    }});
    const calls=transport(t,f.files);let failure;
    const open=openCandidateSource(base+'latest.json');
    const a=new Acquisition(()=>{},async signal=>{try{return await open(signal);}catch(error){failure=error;throw error;}});
    t.after(()=>a.close());await a.select([id]);
    assert.match(failure?.message??'',/modern historical solution/);
    assert.equal(a.states[id],'error');assert.deepEqual(a.data,{});assert.equal(a.current,undefined);
    assert.equal(calls.length,2,'only descriptor and resealed index are requested');
    assert(!calls.some(name=>name.startsWith('objects/')));
  });
});

import { createRequire } from 'node:module';
const { product } = createRequire(import.meta.url)('./comet-catalogue-fixture.cjs');
test('production dispatch accepts schema 2 and rejects unknown or malformed descriptors',async t=>{
  const f=product(['1P']);const calls=transport(t,f.files);
  const a=new Acquisition(()=>{});t.after(()=>a.close());await a.select(['1P']);
  assert.equal(a.states['1P'],'ready');assert(a.data['1P'].states);
  assert.equal(calls.filter(n=>n==='latest.json').length,1);
  for(const [descriptor,message] of [
    ...[null,{}, {...f.descriptor,comet_contract_version:4}].map(d=>[d,'Invalid comet contract version']),
    [{...f.descriptor,extra:true},'Invalid comet fields.'],
    [{...JSON.parse(fixture().files.get('latest.json')),extra:true},'Invalid comet history fields.']]) {
    const reads=transport(t,new Map([['latest.json',JSON.stringify(descriptor)]]));
    await assert.rejects(openHostedSource(),{message});
    assert.deepEqual(reads,['latest.json'],'descriptor validation must reject before an index request');
  }
});
test('production dispatch rejects transport-corrupt index bytes',async t=>{
  const f=fixture(),descriptor=JSON.parse(f.files.get('latest.json'));
  f.files.set(descriptor.index.url,Buffer.from('{}'));transport(t,f.files);
  await assert.rejects(openHostedSource(),/Invalid comet byte length/);
});

import { createHash } from 'node:crypto';
import CometSource from '../src/unified/comets/source/CometCatalogSource.js';
test('production dispatch validates correctly hashed index semantics in both schemas',async t=>{
  for(const f of [product(['1P']),fixture()]) {
    const descriptor=JSON.parse(f.files.get('latest.json'));
    const index=JSON.parse(f.files.get(descriptor.index.url));index.objects=[];
    const bytes=Buffer.from(JSON.stringify(index)),sha256=createHash('sha256').update(bytes).digest('hex');
    descriptor.index={url:`index-${sha256}.json`,sha256,bytes:bytes.length};
    const calls=transport(t,new Map([['latest.json',JSON.stringify(descriptor)],[descriptor.index.url,bytes]]));
    await assert.rejects(openHostedSource(),{message:descriptor.comet_contract_version===2?'Invalid comet catalogue.':'Invalid comet history catalogue.'});
    assert.deepEqual(calls,['latest.json',descriptor.index.url],'semantic rejection happens after verified index fetch, before payloads');
  }
});
test('schema-2 descriptor cancellation retains the comet-specific error',async t=>{
  const controller=new AbortController();controller.abort();
  const failure={name:'AbortError',message:'Comet read cancelled.'};
  await assert.rejects(CometSource.openDescriptor({location:new URL(COMET_LATEST_URL),latest:product(['1P']).descriptor},
    {signal:controller.signal}),failure);
  await assert.rejects(openHostedSource(controller.signal),failure);
  const f=product(['1P']);transport(t,f.files);
  const source=await openHostedSource();t.after(()=>source.close());
  await assert.rejects(source.load('1P',{signal:controller.signal}),failure);
});

import {catalogueHasCoverage} from '../src/unified/comets/feedback.js';
test('coverage feedback follows catalogue metadata across historical, rollback and future sources', () => {
  const entries = fixture().index.objects;
  const modern = entries.map(e => ({id:e.id, name:e.name, coverage:[T, END]}));
  assert.deepEqual(catalogueCoverage(modern), [T, END]);
  assert.equal(catalogueCoverage([]), null);
  const cache = new CometFeedbackCache();
  const app = {cometData:{},cometCatalogue:entries,cometIds:[],cometStates:{},jed:0};
  assert(cache.changed(app));
  for (const entry of entries) for (const segment of entry.segments) {
    const c=segment.coverage;
    for (const jd of [c.start-1e-6,c.start,c.start+1e-6,c.end-1e-6,c.end,c.end+1e-6]) {
      assert.equal(catalogueHasCoverage(entry,jd),entry.segments.some(s => jd>=s.coverage.start && (jd<s.coverage.end || jd===s.coverage.end && s.coverage.end_inclusive)));
      app.jed=jd; cache.changed(app);
    }
  }
  app.cometCatalogue=modern;assert(cache.changed(app));
  app.jed=T-1e-6;assert(cache.changed(app));assert(!catalogueHasCoverage(modern[0],app.jed));
  app.jed=T;assert(cache.changed(app));assert(catalogueHasCoverage(modern[0],app.jed));
  assert(!catalogueHasCoverage(modern[0],NaN));
  assert(!catalogueHasCoverage({segments:[{coverage:{start:T,end:T+1}},{coverage:{start:T+2,end:END}}]}, T+1.5));
});
