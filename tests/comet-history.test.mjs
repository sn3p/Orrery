import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import Acquisition, { openCandidateSource, COMET_LATEST_URL } from '../src/unified/comets/Acquisition.js';
import { positionAt, pathStrips, cometFitPoints, cataloguePresentation, firstDate, lastDate } from '../src/unified/comets/model.js';
import { fixture } from './comet-history-fixture.mjs';
const T=2444239.5, END=2488067.5;
const base='https://candidate.test/';
function transport(t, files, fail=()=>false) {
  t.mock.method(globalThis,'fetch',async url=>{
    const name=new URL(url).pathname.slice(1);
    return files.has(name) && !fail(name) ? new Response(files.get(name)) : new Response('',{status:404});
  });
}
async function checkAcquisition(t, files, real=false) {
  transport(t,files);
  const a=new Acquisition(()=>{},openCandidateSource(base+'latest.json'));
  t.after(()=>a.close());
  const source=await a.source(), entries=cataloguePresentation(source.info.objects), ids=entries.map(e=>e.id);
  assert.equal(Object.keys(a.data).length,0,'metadata never installs trajectories');
  await a.select(ids);
  assert(ids.every(id=>a.states[id]==='ready'));
  if(real) assert.equal(source.sourceId,'a9de1f2f711dd65e880102de7c1f0c14bf20598a20d9cc4e001081406e40c2e2');
  for(const entry of entries) {
    const model=a.data[entry.id];
    assert.deepEqual(model.discovery,entry.discovery);
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
  const a=new Acquisition(()=>{},openCandidateSource(base+'latest.json'));t.after(()=>a.close());
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
    const name=new URL(url).pathname.slice(1);
    if(name.startsWith('objects/')) await gate;
    if(signal.aborted)throw new DOMException('Cancelled','AbortError');
    return new Response(f.files.get(name));
  });
  const a=new Acquisition(()=>{},openCandidateSource(base+'latest.json'));t.after(()=>a.close());
  await a.source();const pending=a.select(['55P']);await a.select([]);a.replace();release();await pending;
  assert.deepEqual(a.data,{});assert.deepEqual(a.states,{});
  await a.select(['55P']);assert.equal(a.states['55P'],'ready');
});
