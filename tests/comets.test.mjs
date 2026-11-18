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
