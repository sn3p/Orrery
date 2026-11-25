import test from 'node:test';
import assert from 'node:assert/strict';
import Acquisition from '../src/unified/comets/Acquisition.js';
import {searchComets} from '../src/unified/comets/search.js';
import {cataloguePresentation,validCometIds,pathStrips,positionAt} from '../src/unified/comets/model.js';
import {assessmentMessage,catalogueCoverage,catalogueHasCoverage,CometFeedbackCache} from '../src/unified/comets/feedback.js';
const coverage=[{start:100,end:102,end_inclusive:false},{start:102,end:103,end_inclusive:true},{start:110,end:112,end_inclusive:true}];
const entry={id:'c1000076',designation:'1995 O1',name:'Example',aliases:['Étoile','星'],coverage,assessment:{state:'available',scope:[]},trajectory:{}};
test('opaque identity, Unicode aliases, punctuation and missing selections',()=>{
  const rows=cataloguePresentation([entry]);assert(Number.isFinite(rows[0].color));
  for(const query of [entry.id,'1995O1','etoile','星'])assert.equal(searchComets(rows,query)[0].id,entry.id);
  assert.deepEqual(searchComets(rows,'!!!'),[]);assert.equal(searchComets(rows,' ').length,1);
  assert(validCometIds(['missing-id',entry.id]));assert(!validCometIds(['bad id']));assert(!validCometIds(['constructor']));
  assert(!validCometIds(['missing-id'],rows));
});
test('coverage gaps and scoped assessments stay distinct and invalidate feedback',()=>{
  assert.deepEqual(catalogueCoverage([entry]),[100,112]);assert(catalogueHasCoverage(entry,102));assert(!catalogueHasCoverage(entry,105));
  const unsupported={...entry,coverage:[],assessment:{state:'unsupported',scope:[coverage[0]]}};
  assert.equal(assessmentMessage(unsupported,101),'No trajectory available');assert.equal(assessmentMessage(unsupported,103),'Trajectory not yet assessed');
  const app={cometData:{},cometCatalogue:[unsupported],jed:101,cometIds:[],cometStates:{}};
  const cache=new CometFeedbackCache();assert(cache.changed(app));assert(!cache.changed(app));app.jed=103;assert(cache.changed(app));
});
test('short, dense, gapped strips preserve ownership and finite endpoint interpolation',()=>{
  const segments=coverage.map((c,i)=>({key:String(i),coverage:c,series:{start:c.start,step:(c.end-c.start)/4,states:Array.from({length:5},(_,j)=>[c.start+j*(c.end-c.start)/4,0,0,1,0,0])}}));
  const model={segments};assert.equal(positionAt(model,105),null);assert.equal(positionAt(model,102).x,102);
  const strips=pathStrips(model,102,20);assert.equal(strips.length,3);assert(strips[0].points.at(-1)[0]<102);assert.equal(strips[1].points[0][0],102);
  assert.deepEqual(pathStrips({segments:[]},100,20),[]);
});
test('window acquisition cancels stale work, retries failures and releases deselected data',async()=>{
  const calls=[];let fail=false;
  const source={getObject(){},close(){},loadWindow:async(id,options)=>{calls.push(options);if(fail)throw Error('corrupt');return {segments:[]};}};
  const a=new Acquisition(()=>{},async()=>source);await a.source();
  const context={jed:100,catalogue:[{...entry,periodDays:10,coverage:[{start:0,end:100000,end_inclusive:true}]}]};
  await a.select([entry.id],false,context);assert.equal(a.states[entry.id],'ready');assert.equal(calls.length,1);
  await a.select([entry.id],false,context);assert.equal(calls.length,1);
  fail=true;await a.select([entry.id],false,{...context,jed:200});assert.equal(a.states[entry.id],'error');assert(a.data[entry.id], 'Retain the verified model on replacement failure');
  await a.select([entry.id],false,{...context,jed:300});assert.equal(calls.length,2,'Playback does not retry settled failures');
  fail=false;await a.select([entry.id],true,{...context,jed:200});assert.equal(a.states[entry.id],'ready');
  await a.select([],false,context);assert.deepEqual(a.data,{});
  let release;source.loadWindow=async()=>{await new Promise(r=>release=r);return {segments:[]};};
  const pending=a.select([entry.id],false,context);while (!release) await new Promise(resolve=>setImmediate(resolve));
  a.replace();release();await pending;assert.deepEqual(a.data,{});a.close();
});

test('acquisition shifts the complete display window at coverage boundaries',async()=>{
  const segments=Array.from({length:40},(_,i)=>({key:String(i),coverage:{start:i*100,end:(i+1)*100,end_inclusive:i===39},series:{start:i*100,step:1,states:Array.from({length:101},(_,j)=>[i*100+j,0,0,1,0,0])}}));
  const row={...entry,periodDays:3652.5,coverage:segments.map(s=>s.coverage)};
  const source={getObject(){},close(){},loadWindow:async(id,{start,end})=>({segments:segments.filter(s=>s.coverage.start<=end&&s.coverage.end>=start)})};
  const a=new Acquisition(()=>{},async()=>source);await a.source();
  for(const jed of [0,4000]) {await a.select([row.id],false,{jed,catalogue:[row]});assert.deepEqual(pathStrips(a.data[row.id],jed,row.periodDays),pathStrips({segments,displayWindow:a.data[row.id].displayWindow},jed,row.periodDays));}
  a.close();
});

test('variable grid steps do not change explicit window drawing or Fit',async()=>{
  const segments=Array.from({length:40},(_,i)=>({key:String(i),coverage:{start:i*300,end:(i+1)*300,end_inclusive:i===39},series:{start:i*300,step:300,states:[[i*300,0,0,1,0,0],[(i+1)*300,0,0,1,0,0]]}}));
  const row={...entry,periodDays:3652.5,coverage:segments.map(s=>s.coverage)};
  const source={getObject(){},close(){},loadWindow:async(id,{start,end})=>({segments:segments.filter(s=>s.coverage.start<=end&&s.coverage.end>=start)})};
  const a=new Acquisition(()=>{},async()=>source);await a.source();
  for(const jed of [0,3000,12000]) {await a.select([row.id],false,{jed,catalogue:[row]});const model=a.data[row.id];assert.deepEqual(pathStrips(model,jed,row.periodDays),pathStrips({segments,displayWindow:model.displayWindow},jed,row.periodDays));}
  a.close();
});

test('fresh selection, moving windows and hide preserve useful work without starving loads',async()=>{
  const row={...entry,periodDays:10,coverage:[{start:0,end:10000,end_inclusive:true}]};
  const context=jed=>({jed,catalogue:[row]});
  const calls=[],releases=[];
  let delayed=false;
  const source={getObject:()=>row,close(){},loadWindow:async(id,options)=>{
    calls.push(options);if(delayed)await new Promise(resolve=>releases.push(resolve));
    return {segments:[{key:'block',coverage:row.coverage[0],series:{start:0,step:10000,states:[[0,0,0,1,0,0],[10000,0,0,1,0,0]]}}]};
  }};
  const a=new Acquisition(()=>{},async()=>source);
  await a.select([row.id],false,context(100));assert.equal(a.states[row.id],'ready','Fresh source loads with date context');
  const model=a.data[row.id];a.suspend();await a.select([row.id],false,context(100));
  assert.equal(a.data[row.id],model);assert.equal(calls.length,1,'Hide/show reuses loaded model');
  delayed=true;const pending=a.select([row.id],false,context(200));
  while(!releases.length)await new Promise(r=>setImmediate(r));
  for(const jed of [300,400,500])void a.select([row.id],false,context(jed));
  assert.equal(a.data[row.id],model);assert.equal(calls.length,2);assert(!calls[1].signal.aborted);
  releases.shift()();await pending;
  while(!releases.length)await new Promise(r=>setImmediate(r));
  assert.equal(calls.length,3,'Follow only the latest requested window');
  assert.equal(a.data[row.id].displayWindow.start,calls[1].start);
  releases.shift()();while(a.requests.size)await new Promise(r=>setImmediate(r));
  assert.equal(a.data[row.id].displayWindow.start,calls[2].start);
  await a.select([],false,context(500));assert.deepEqual(a.data,{});a.close();
});
test('application IDs reject inherited object keys even when a catalogue lists them',()=>{
  for(const id of [...Object.getOwnPropertyNames(Object.prototype),'prototype']) {
    assert(!validCometIds([id]));assert(!validCometIds([id],[{id}]));
  }
});
test('comet queue cancellation retains comet diagnostics',async()=>{
  const {CometDownloadQueue}=await import('../src/unified/comets/source/cometSourceCore.js');
  const queue=new CometDownloadQueue(0), controller=new AbortController();
  const pending=queue.run(controller.signal,()=>{});controller.abort();
  await assert.rejects(pending,error=>error.name==='AbortError'&&/comet/i.test(error.message));
});
