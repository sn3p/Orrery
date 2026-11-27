import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, PerspectiveCamera } from 'three';
import { ScreenOrbit, ORBIT_DASH, ORBIT_GAP, ORBIT_WIDTH } from '../src/unified/named/ScreenOrbit.js';
const identity = new Matrix4().elements;
const metrics=(orbit,width,height)=>{
 const a=orbit.vertices;
 return {length:Math.hypot((a[8]-a[0])*width/2,(a[9]-a[1])*height/2),
   distance:a[11]-a[3],width:Math.hypot((a[4]-a[0])*width/2,(a[5]-a[1])*height/2)};
};
test('dash lengths use CSS pixels while stroke width stays one device pixel',()=>{
 const points=new Float64Array([-.5,0,0,.5,0,0]);
 for(const width of [320,1280,2560])for(const height of [480,900])for(const zoom of [.1,1,10])for(const ratio of [1,1.25,2]){
  const orbit=new ScreenOrbit(points),matrix=new Matrix4().makeScale(zoom,zoom,1).elements;
  orbit.update(matrix,width,height,ratio);
  const m=metrics(orbit,width,height);
  assert(Math.abs(m.length-m.distance)<1e-4);assert(Math.abs(m.width*ratio-ORBIT_WIDTH)<1e-5);
  assert.equal(ORBIT_DASH,5);assert.equal(ORBIT_GAP,3);
  const buffer=orbit.vertices;assert.equal(orbit.update(matrix,width,height,ratio),false);
  assert.strictEqual(orbit.vertices,buffer);assert.equal(orbit.revision,1);
 }
});
test('perspective depth, near plane and camera crossings keep finite bounded screen distances',()=>{
 const camera=new PerspectiveCamera(60,1.5,.01,100000);camera.position.set(0,0,0);camera.lookAt(0,0,-1);camera.updateMatrixWorld();
 const matrix=new Matrix4().multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse).elements;
 for(const points of [
  [-1,0,-2,1,0,-10],[-1,0,1,1,0,-2],[-1,0,1,1,0,2],
  [0,0,-.001,.1,0,-1],[-1e12,0,-1,1e12,0,-1],
 ]){
  const orbit=new ScreenOrbit(new Float64Array(points));orbit.update(matrix,1200,800);
  assert(orbit.vertices.every(Number.isFinite));
  if(orbit.count){const m=metrics(orbit,1200,800);assert(Math.abs(m.length-m.distance)<.001);assert(m.distance<=Math.hypot(1200,800)+.01);assert(Math.abs(m.width-1)<.001);}
 }
 const hidden=new ScreenOrbit(new Float64Array([-1,0,1,1,0,2]));hidden.update(matrix,1200,800);assert.equal(hidden.count,0);
});
test('phase is continuous across visible joins without growing unbounded around large paths',()=>{
 const orbit=new ScreenOrbit(new Float64Array([-.5,0,0,0,0,0,.5,.5,0]));orbit.update(identity,320,480);
 assert.equal(orbit.count,12);
 const a=orbit.vertices;assert(Math.abs(a[27]-(a[11]%(ORBIT_DASH+ORBIT_GAP)))<1e-5);
 assert(orbit.vertices.every(Number.isFinite));
});

test('native Three track retains buffers, skips hidden work and uses CSS dimensions across DPR', async () => {
 const { default: OrbitTrack } = await import('../src/unified/three/ScreenOrbit.js');
 const camera = new PerspectiveCamera(60, 1.5, .01, 1000);
 camera.position.set(0, 0, 10); camera.updateMatrixWorld();
 const points = new Float64Array([-1, 0, 0, 1, 0, 0]), track = new OrbitTrack(points);
 const geometry = track.geometry, buffer = track.screenBuffer, data = buffer.array;
 try {
  track.updateScreenOrbit(camera, { width: 1200, height: 800, pixelRatio: 1 });
  const first = [...data], version = buffer.version;
  track.updateScreenOrbit(camera, { width: 1200, height: 800, pixelRatio: 2 });
  assert.notDeepEqual([...data], first); assert.equal(buffer.version, version + 1);
  const second = [...data];
  track.updateScreenOrbit(camera, { width: 1200, height: 800, pixelRatio: 2 });
  assert.deepEqual([...data], second); assert.equal(buffer.version, version + 1);
  const m = metrics(track.screenOrbit, 1200, 800);
  assert(Math.abs(m.length - m.distance) < 1e-4); assert(Math.abs(m.width - .5) < 1e-4);
  track.visible = false;
  camera.position.z = 5; camera.updateMatrixWorld();
  track.updateScreenOrbit(camera, { width: 1200, height: 800 });
  assert.equal(buffer.version, version + 1);
  track.visible = true; track.updateScreenOrbit(camera, { width: 1200, height: 800 });
  assert.equal(buffer.version, version + 2); assert.notDeepEqual([...data], first);
  assert.strictEqual(track.geometry, geometry); assert.strictEqual(track.screenBuffer, buffer);
  assert.strictEqual(buffer.array, data); assert.strictEqual(track.sourcePoints, points);
  assert.equal(track.geometry.drawRange.count, track.screenOrbit.count);
 } finally { track.geometry.dispose(); track.material.dispose(); }
});

test('hidden native Pixi tracks defer shader creation and projection', async () => {
 const { default: OrbitTrack } = await import('../src/unified/pixi/ScreenOrbit.js');
 const track = new OrbitTrack(new Float64Array([-1, 0, 0, 1, 0, 0]));
 try {
  track.visible = false;
  track.updateScreenOrbit({ width: 1200, height: 800, pixelRatio: 2 });
  assert.equal(track.screenOrbit.revision, 0); assert.equal(track.screenOrbit.count, 0);
  assert.equal(track.shader, null);
 } finally { track.destroy(); }
});


test('panning keeps phase anchored through clipped starts and invisible segments', () => {
 const width = 322, points = new Float64Array([-3,0,0, -2,0,0, -1.02,0,0, 0,0,0, .5,0,0]);
 const orbit = new ScreenOrbit(points);
 for (const pan of [-.1, 0, .04, .2, 0]) {
  orbit.update(new Matrix4().makeTranslation(pan,0,0).elements,width,480);
  const a = orbit.vertices;
  let phase;
  for(let i=0;i<orbit.count*4;i+=24) {
   const start=(a[i]+a[i+4])/2,end=(a[i+8]+a[i+20])/2;
   if(start<=pan && end>=pan) phase=(a[i+3]+(pan-start)/(end-start)*(a[i+11]-a[i+3]))%8;
  }
  assert(Math.abs(phase-(3*width/2)%8)<1e-4, `Pan ${pan}: ${phase}`);
 }
});

test('projection clears only the stale used tail and bounds upload size', () => {
 const orbit = new ScreenOrbit(new Float64Array([-3,0,0, -2,0,0, -.5,0,0, .5,0,0, 2,0,0, 3,0,0]));
 const cleared=[];
 orbit.vertices.fill = function(value,start,end) { cleared.push([start,end]); return Float32Array.prototype.fill.call(this,value,start,end); };
 orbit.update(identity,322,480);
 const previous=orbit.count*4;
 assert(previous>0 && previous<orbit.vertices.length);
 assert.equal(orbit.updateSize,previous);
 orbit.update(new Matrix4().makeTranslation(3,0,0).elements,322,480);
 assert(orbit.count*4<previous);
 assert.deepEqual(cleared.at(-1),[orbit.count*4,previous]);
 assert.equal(orbit.updateSize,previous);
 assert(orbit.vertices.subarray(orbit.count*4).every(value=>value===0));
 orbit.update(new Matrix4().makeTranslation(4,0,0).elements,322,480);
 orbit.update(new Matrix4().makeTranslation(5,0,0).elements,322,480);
 assert.equal(orbit.count,0); assert.equal(orbit.updateSize,0);
});

test('Three legacy tracks preserve double precision before projection', async () => {
 const { default: Orbit } = await import('../src/unified/three/Orbit.js');
 const eph={ a:68.123456789,e:.44,i:44,W:36,w:151,M:204,n:.00178,epoch:2451545 };
 const track=Orbit.createOrbit(eph,2451545);
 try {
  assert(track.sourcePoints instanceof Float64Array);
  const expected=Orbit.getPosAtTime(eph,2451545);
  assert.deepEqual([...track.sourcePoints.slice(0,3)],expected);
  assert(track.sourcePoints.some(value=>value!==Math.fround(value)));
  assert.deepEqual(track.sourcePoints.slice(-3),track.sourcePoints.slice(0,3));
 } finally { track.geometry.dispose(); track.material.dispose(); }
});
