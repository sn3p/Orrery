import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COMETS, positionAt, lastDate, pathRange, cometFitPoints, validCometIds, validateCometData, validateCometOptions } from '../src/unified/comets/model.js';
const data = JSON.parse(fs.readFileSync(new URL('../src/unified/comets/vectors.json', import.meta.url)));
const references = JSON.parse(fs.readFileSync(new URL('./fixtures/comet-vectors.json', import.meta.url)));

test('comet positions match independent Horizons midpoint vectors, including worst perihelion cases', () => {
  for (const {id} of COMETS) {
    const series = data[id];
    assert.equal(series.step, 4);
    assert(series.states.length > 10000);
    for (const state of series.states) assert(state.length === 6 && state.every(Number.isFinite));
    for (const [jed,x,y,z] of references[id].samples) {
      const p = positionAt(series, jed);
      assert(Math.hypot(p.x-x,p.y-y,p.z-z) < 0.000052, `${id} at ${jed}`);
    }
    assert(references[id].maxMidpointErrorAU < 0.000052);
  }
});

test('comet interpolation reproduces endpoints and never extrapolates or mutates a failed target', () => {
  for (const series of Object.values(data)) {
    for (const i of [0, 100, series.states.length-1]) {
      const p = positionAt(series, series.start+i*series.step);
      assert.deepEqual([p.x,p.y,p.z], series.states[i].slice(0,3));
    }
    for (const date of [NaN, Infinity, series.start-1e-6, lastDate(series)+1e-6]) {
      const target = {x:1,y:2,z:3};
      assert.equal(positionAt(series, date, target), null);
      assert.deepEqual(target, {x:1,y:2,z:3});
    }
  }
});

test('comet paths are bounded data slices, not synthetic closed ellipses', () => {
  for (const comet of COMETS) {
    const series=data[comet.id];
    for (const jed of [series.start,lastDate(series),(series.start+lastDate(series))/2]) {
      const [first,last]=pathRange(series,jed,comet.periodDays);
      assert(first>=0 && last<series.states.length && last>first);
      assert(first<= (jed-series.start)/series.step && last >= (jed-series.start)/series.step);
    }
  }
  assert(validCometIds([]));
  assert(validCometIds(['1P','55P']));
  for(const ids of [null,['fake'],['1P','1P']]) assert(!validCometIds(ids));
});

test('comet paths retain a full period at both boundaries and throughout playback', () => {
  for (const comet of COMETS) {
    const series = data[comet.id];
    const initial = pathRange(series, series.start, comet.periodDays);
    const final = pathRange(series, lastDate(series), comet.periodDays);
    assert.equal(initial[0], 0);
    assert.equal(final[1], series.states.length - 1);
    const duration = (initial[1] - initial[0]) * series.step;
    assert(duration >= comet.periodDays && duration < comet.periodDays + 2 * series.step);
    for (let i = 0; i < series.states.length; i++) {
      const [first, last] = pathRange(series, series.start + i * series.step, comet.periodDays);
      assert.equal((last - first) * series.step, duration, `${comet.id} at sample ${i}`);
      assert(first >= 0 && last < series.states.length && first <= i && last >= i);
    }
    assert.deepEqual(pathRange(series, series.start + 32, comet.periodDays), initial,
      'Early playback does not grow the displayed path');
    assert.deepEqual(pathRange(series, lastDate(series) - 32, comet.periodDays), final,
      'Late playback does not shrink the displayed path');
  }
});

test('a dataset shorter than one period uses all available samples', () => {
  const series = { start: 100, step: 4, states: Array(10) };
  for (const jed of [100, 116, 136]) assert.deepEqual(pathRange(series, jed, 1000), [0, 9]);
});

test('comet fitting uses only selected current paths and includes the interpolated marker', () => {
  const series = data['55P'], jed = series.start + 3;
  const points = cometFitPoints(data, ['55P'], jed);
  const position = positionAt(series, jed);
  assert.deepEqual(points[0], [position.x, position.y, position.z]);
  const [first, last] = pathRange(series, jed, COMETS.find(c => c.id === '55P').periodDays);
  assert.deepEqual(points.slice(1), series.states.slice(first, last + 1).map(row => row.slice(0, 3)));
  assert(points.length < series.states.length, 'Undisplayed future samples do not expand the fit');
  assert.deepEqual(cometFitPoints(data, [], jed), []);
  assert.deepEqual(cometFitPoints(data, ['55P'], series.start - 1), []);
});

test('invalid comet assets and settings fail before scene mutation', () => {
  assert.equal(validateCometData(data), data);
  for (const value of [null, {}, {...data, '1P': {...data['1P'], step:0}}, {...data, '2P': {start:1,step:1,states:[[0,0,0,0,0,0],[0,0,NaN,0,0,0]]}}]) {
    assert.throws(()=>validateCometData(value), /Invalid comet ephemeris/);
  }
  for (const value of [{cometsShown:1},{asteroidsShown:'false'},{cometPaths:null},{cometIds:['fake']}]) {
    assert.throws(()=>validateCometOptions(value), RangeError);
  }
});

// Real producer bytes exercise the same integrity and provenance boundary as visits.
import CometSource, { validateComet } from '../src/unified/comets/source/CometCatalogSource.js';
import Acquisition from '../src/unified/comets/Acquisition.js';
const fixtureRoot = new URL('./fixtures/comets-v2/', import.meta.url);
const descriptor = JSON.parse(fs.readFileSync(new URL('latest.json', fixtureRoot)));
const index = JSON.parse(fs.readFileSync(new URL(descriptor.index.url, fixtureRoot)));
function fixtureFetch(url) {
  const name = new URL(url).pathname.split('/comets-v2/')[1];
  return Promise.resolve(new Response(fs.readFileSync(new URL(name, fixtureRoot))));
}
test('hosted contract fixture verifies all bytes, provenance, references and baseline series', async t => {
  const calls=[];
  t.mock.method(globalThis,'fetch',(url,options)=>{calls.push([url,options]);return fixtureFetch(url);});
  const source=await CometSource.openLatest('https://fixture.test/nested/comets-v2/latest.json');
  assert.equal(source.sourceId,descriptor.index.sha256);
  for(const id of DEFAULT_IDS()) {
    const [a,b]=await Promise.all([source.load(id),source.load(id)]);
    assert.equal(a,b);assert.deepEqual(a.series,data[id]);
    assert.equal(await source.load(id),a);
  }
  assert.equal(calls.length,5);
  assert(calls.every(([,options])=>options.redirect==='error'));
  source.close();await assert.rejects(source.load('1P'),{name:'AbortError'});
});
function DEFAULT_IDS(){return COMETS.map(c=>c.id);}
test('partial data has no guessed positions or fit points',()=>{
  assert.equal(positionAt(undefined,2450000),null);
  assert.deepEqual(cometFitPoints({},DEFAULT_IDS(),2450000),[]);
});
test('invalid product fields and corrupt/truncated transport never enter cache',async t=>{
  const object=JSON.parse(fs.readFileSync(new URL(index.objects[0].data.url,fixtureRoot)));
  for(const modify of [o=>o.id='2P',o=>o.comet_contract_version=1,o=>o.conventions.time='TDB',o=>o.series.start++,o=>o.series.states.pop()]){
    const copy=structuredClone(object);modify(copy);assert.throws(()=>validateComet(copy,'1P'));
  }
  let bad=false;
  t.mock.method(globalThis,'fetch',async url=>{
    if(bad&&url.includes('/objects/'))return new Response('bad');
    return fixtureFetch(url);
  });
  const source=await CometSource.openLatest('https://fixture.test/comets-v2/latest.json');
  bad=true;await assert.rejects(source.load('1P'));bad=false;
  assert.deepEqual((await source.load('1P')).series,data['1P']);source.close();
});
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
test('acquisition guards deselection, partial failure, retry, replacement and destroy',async()=>{
  let pending={},closed=0;
  const open=async()=>({sourceId:'first',load:id=>(pending[id]=deferred()).promise,close:()=>closed++});
  const a=new Acquisition(()=>{},open);
  const first=a.select(['1P','2P']);await new Promise(resolve=>setImmediate(resolve));
  pending['1P'].resolve({series:data['1P']});pending['2P'].reject(Error('503'));await first;
  assert.deepEqual(Object.keys(a.data),['1P']);assert.equal(a.states['2P'],'error');
  const retry=a.select(['1P','2P'],true);await new Promise(resolve=>setImmediate(resolve));
  const old=pending['2P'];a.select([]);old.resolve({series:data['2P']});await retry;
  assert(!a.data['2P']);
  const stale=a.select(['55P']);await new Promise(resolve=>setImmediate(resolve));
  const old55=pending['55P'];a.replace(async()=>({sourceId:'new',load:async()=>({series:data['2P']}),close(){}}));
  await a.select(['2P']);old55.resolve({series:data['55P']});await stale;
  assert.deepEqual(Object.keys(a.data),['2P']);assert.equal(a.current.sourceId,'new');assert.equal(closed,1);
  a.close();assert.deepEqual(a.data,{});await a.select(['1P']);assert.deepEqual(a.data,{});
});

test('source subscribers cancel independently, all-cancel retries and pre-aborted calls do no work',async t=>{
  let gate,objectCalls=0;
  t.mock.method(globalThis,'fetch',async (url,{signal})=>{
    if(!url.includes('/objects/'))return fixtureFetch(url);
    objectCalls++;gate=deferred();
    signal.addEventListener('abort',()=>gate.reject(new DOMException('Cancelled','AbortError')),{once:true});
    await gate.promise;return fixtureFetch(url);
  });
  const source=await CometSource.openLatest('https://fixture.test/comets-v2/latest.json');
  const one=new AbortController(),two=new AbortController();
  const a=source.load('1P',{signal:one.signal}),b=source.load('1P',{signal:two.signal});
  const rejected=assert.rejects(a,{name:'AbortError'});one.abort();gate.resolve();
  await rejected;assert.deepEqual((await b).series,data['1P']);assert.equal(objectCalls,1);
  const all=new AbortController(),c=source.load('2P',{signal:all.signal});
  const cancelled=assert.rejects(c,{name:'AbortError'});all.abort();await cancelled;
  const retry=source.load('2P');gate.resolve();await retry;assert.equal(objectCalls,3);
  const before=objectCalls;await assert.rejects(source.load('55P',{signal:all.signal}),{name:'AbortError'});
  assert.equal(objectCalls,before);source.close();
});
test('bounded transport rejects null bodies, oversized descriptors and wrong hashes',async t=>{
  let response;
  t.mock.method(globalThis,'fetch',async()=>response);
  for(const body of [null,' '.repeat(4097),'{']){
    response=new Response(body);await assert.rejects(CometSource.openLatest('https://fixture.test/comets-v2/latest.json'));
  }
  let corrupt=false;
  globalThis.fetch=async url=>{
    const r=await fixtureFetch(url);if(!corrupt||!url.includes('/objects/'))return r;
    const bytes=new Uint8Array(await r.arrayBuffer());bytes[bytes.length-2]^=1;return new Response(bytes);
  };
  const source=await CometSource.openLatest('https://fixture.test/comets-v2/latest.json');
  corrupt=true;await assert.rejects(source.load('55P'));corrupt=false;await source.load('55P');source.close();
});

test('failed selection retries after deselection while ready objects stay cached', async () => {
  const calls = [];
  let fail = true;
  const acquisition = new Acquisition(() => {}, async () => ({
    load: async id => {
      calls.push(id);
      if (id === '2P' && fail) throw new Error('503');
      return { series: data[id] };
    }, close() {},
  }));
  await acquisition.select(['1P', '2P']);
  await acquisition.select(['1P']);
  assert.equal(acquisition.states['2P'], undefined);
  fail = false;
  await acquisition.select(['1P', '2P']);
  assert.equal(acquisition.states['2P'], 'ready');
  await acquisition.select([]);
  await acquisition.select(['1P', '2P']);
  assert.deepEqual(calls, ['1P', '2P', '2P']);
  acquisition.close();
});

test('unexpected AbortError becomes retryable rather than stuck loading', async () => {
  let fail = true;
  const acquisition = new Acquisition(() => {}, async () => ({
    load: async () => {
      if (fail) throw new DOMException('Browser cancelled read', 'AbortError');
      return { series: data['1P'] };
    }, close() {},
  }));
  await acquisition.select(['1P']);
  assert.equal(acquisition.states['1P'], 'error');
  fail = false;
  await acquisition.select(['1P'], true);
  assert.equal(acquisition.states['1P'], 'ready');
  acquisition.close();
});

test('comet discovery rejects fragments before requesting data', async t => {
  let requests = 0;
  t.mock.method(globalThis, 'fetch', url => { requests++; return fixtureFetch(url); });
  await assert.rejects(CometSource.openLatest('https://fixture.test/comets-v2/latest.json#ambiguous'));
  assert.equal(requests, 0);
});

test('comet fit eligibility requires a loaded series at a supported date', async () => {
  const { hasUsableComets } = await import('../src/unified/comets/model.js');
  assert.equal(hasUsableComets({}, ['1P'], 2450000), false);
  assert.equal(hasUsableComets(data, [], 2450000), false);
  assert.equal(hasUsableComets(data, ['1P'], NaN), false);
  assert.equal(hasUsableComets(data, ['1P'], data['1P'].start - 1), false);
  assert.equal(hasUsableComets(data, ['1P'], data['1P'].start), true);
  assert.equal(hasUsableComets({'1P':data['1P']}, ['2P', '1P'], lastDate(data['1P'])), true);
});

import CometCatalogSource from '../src/unified/comets/source/CometCatalogSource.js';
import catalogueFixtures from './comet-catalogue-fixture.cjs';
import { cataloguePresentation } from '../src/unified/comets/model.js';
test('v2 pins arbitrary ordered membership, verifies new IDs, caches, and rejects unknown selections', async t => {
  for (const ids of [['67P','123P','1P'], ['2P'], catalogueFixtures.index.objects.map(e=>e.id)]) {
    const {files,descriptor,objects} = catalogueFixtures.product(ids);
    const calls=[];
    t.mock.method(globalThis,'fetch',async url=>{const name=new URL(url).pathname.slice(1);calls.push(name);return new Response(files.get(name));});
    const source=await CometCatalogSource.openLatest('https://fixture.test/latest.json');
    assert.equal(source.sourceId,descriptor.index.sha256);
    assert.deepEqual(source.info.objects.map(e=>e.id),ids);
    assert.equal(calls.length,2,'Opening fetches no objects');
    const metadata=cataloguePresentation(objects);
    for(const id of ids){
      const [a,b]=await Promise.all([source.load(id),source.load(id)]);
      assert.equal(a,b);assert.equal(await source.load(id),a);
      assert.equal(cometFitPoints({[id]:a.series},[id],a.series.start,metadata).length>1,true);
    }
    assert.equal(calls.length,2+ids.length);
    await assert.rejects(source.load('99999P'));
    source.close();await assert.rejects(source.load(ids[0]),{name:'AbortError'});
  }
});
test('v2 invalid empty catalogue and corrupt assets fail with explicit same-pin recovery',async t=>{
  let product=catalogueFixtures.product([]), corrupt=false;
  t.mock.method(globalThis,'fetch',async url=>{const name=new URL(url).pathname.slice(1);return new Response(corrupt&&name.startsWith('objects/')?'bad':product.files.get(name));});
  await assert.rejects(CometCatalogSource.openLatest('https://fixture.test/latest.json'));
  product=catalogueFixtures.product(['67P']);
  const source=await CometCatalogSource.openLatest('https://fixture.test/latest.json');
  corrupt=true;await assert.rejects(source.load('67P'));corrupt=false;
  const object=await source.load('67P');assert.equal(object.id,'67P');
  assert.equal(source.sourceId,product.descriptor.index.sha256);source.close();
});
test('v2 subscribers cancel independently and cancelled loads retry under the pin', async t => {
  const {files}=catalogueFixtures.product(['67P','123P']);
  let gate, loads=0;
  t.mock.method(globalThis,'fetch',async(url,{signal})=>{
    const name=new URL(url).pathname.slice(1);
    if(name.startsWith('objects/')){
      loads++;const pending=gate=deferred();
      signal.addEventListener('abort',()=>pending.reject(new DOMException('Cancelled','AbortError')),{once:true});
      await pending.promise;
    }
    return new Response(files.get(name));
  });
  const source=await CometCatalogSource.openLatest('https://fixture.test/latest.json');
  const first=new AbortController(), second=new AbortController();
  const a=source.load('67P',{signal:first.signal}),b=source.load('67P',{signal:second.signal});
  const rejected=assert.rejects(a,{name:'AbortError'});first.abort();gate.resolve();await rejected;await b;
  assert.equal(loads,1);
  const all=new AbortController(),c=source.load('123P',{signal:all.signal});
  const cancelled=assert.rejects(c,{name:'AbortError'});all.abort();await cancelled;
  const retry=source.load('123P');gate.resolve();await retry;assert.equal(loads,3);
  await assert.rejects(source.load('67P',{signal:all.signal}),{name:'AbortError'});
  source.close();
});

test('curated display windows match published periods without changing catalogue membership', () => {
  const entries = catalogueFixtures.index.objects;
  const presentation = cataloguePresentation(entries);
  assert.deepEqual(presentation.map(e => e.id), entries.map(e => e.id));
  for (const [id, days] of [['9P',2038],['10P',1958],['67P',2353]]) {
    const entry = entries.find(e => e.id === id);
    const years = Number(entry.provenance.vectors.header.match(/PER=\s*([\d.]+)/)[1]);
    assert.equal(Math.round(years * 365.25), days);
    assert.equal(presentation.find(e => e.id === id).periodDays, days);
  }
  for (const original of COMETS) assert.equal(presentation.find(e => e.id === original.id).periodDays, original.periodDays);
  assert(presentation.every(e => !e.usesDefaultWindow));
});

test('new and unknown comet paths and fit stay within a moving bounded display window', () => {
  const entries = cataloguePresentation(catalogueFixtures.product(['9P','10P','67P','123P']).objects);
  const unknown = entries.find(e => e.id === '123P');
  assert.equal(unknown.periodDays,3652.5);
  assert.equal(unknown.usesDefaultWindow,true);
  for (const entry of entries) {
    const series = data['1P']; // Same supported time grid; arbitrary ID, no orbit inference.
    const span = 2 * Math.ceil(entry.periodDays / 8);
    for (const date of [series.start, series.start+32, series.start+16000, lastDate(series)-32, lastDate(series)]) {
      const [first,last] = pathRange(series,date,entry.periodDays);
      assert.equal(last-first,span);
      assert(first>=0 && last<series.states.length);
      const fit=cometFitPoints({[entry.id]:series},[entry.id],date,[entry]);
      assert.deepEqual(fit.slice(1),series.states.slice(first,last+1).map(row=>row.slice(0,3)));
      assert.equal(fit.length,span+2,'Fit never includes the complete historical trajectory');
    }
    const middle=series.start+16000;
    const first=pathRange(series,middle,entry.periodDays)[0];
    assert.equal(pathRange(series,middle+32,entry.periodDays)[0],first+8);
    assert.deepEqual(pathRange({...series,states:series.states.slice(0,10)},series.start,entry.periodDays),[0,9]);
  }
});

import { syncCometLayer } from '../src/unified/comets/layer.js';
test('catalogue-only layer updates preserve data, dispose old resources and report changes',()=>{
  const initial=[{id:'1P'}], next=[{id:'123P'}];
  let disposed=0,created=0;
  const renderer={initialized:true,cometCatalogue:initial,
    cometSettings:{cometCatalogue:initial,cometData:data,cometIds:['1P'],cometsShown:true},
    comets:{destroy(){disposed++;}}};
  const create=(actual,catalogue)=>{
    assert.equal(actual,data);assert.equal(catalogue,next);created++;
    return {setData(value){assert.equal(value,data);},destroy(){disposed++;}};
  };
  assert.equal(syncCometLayer(renderer,{cometCatalogue:next},create),true);
  assert.equal(disposed,1);assert.equal(created,1);
  assert.equal(renderer.cometSettings.cometsShown,true);
  assert.equal(syncCometLayer(renderer,{planetLabels:'all'},create),false);
  assert.equal(disposed,1);assert.equal(created,1);
});
test('curated colours are distinct and bundled names match hosted names',()=>{
  const catalogue=cataloguePresentation(catalogueFixtures.index.objects);
  assert.equal(new Set(catalogue.map(e=>e.color)).size,6);
  for(const bundled of COMETS)assert.equal(bundled.name,catalogue.find(e=>e.id===bundled.id).name);
});
