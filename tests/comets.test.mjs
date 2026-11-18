import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { COMETS, positionAt, lastDate, pathRange, validCometIds, validateCometData, validateCometOptions } from '../src/unified/comets/model.js';
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

test('invalid comet assets and settings fail before scene mutation', () => {
  assert.equal(validateCometData(data), data);
  for (const value of [null, {}, {...data, '1P': {...data['1P'], step:0}}, {...data, '2P': {start:1,step:1,states:[[0,0,0,0,0,0],[0,0,NaN,0,0,0]]}}]) {
    assert.throws(()=>validateCometData(value), /Invalid comet ephemeris/);
  }
  for (const value of [{cometsShown:1},{asteroidsShown:'false'},{cometPaths:null},{cometIds:['fake']}]) {
    assert.throws(()=>validateCometOptions(value), RangeError);
  }
});
