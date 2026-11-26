import * as THREE from 'three';
import { NamedOrbit as Model, namedOrbitPoints, namedOrbitFrame, orbitShapeDate } from '../named/model.js';

function frameMatrix(body, jed, target) {
  const { p, q, normal: n, center: c } = namedOrbitFrame(body, jed);
  return target.set(p[0], q[0], n[0], c[0], p[1], q[1], n[1], c[1],
    p[2], q[2], n[2], c[2], 0, 0, 0, 1);
}

export default class NamedOrbit extends Model {
  getPosAtTime(jed, target) {
    const position = this.position(jed);
    this.updateTrack(jed);
    return target ? target.set(...position) : position;
  }
  drawOrbit(jed) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(namedOrbitPoints(this.body, jed)), 3));
    geometry.computeBoundingSphere();
    this.track = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: 0x333333, linewidth: 1, dashSize: 5, gapSize: 3 }));
    this.track.computeLineDistances();
    this.track.matrixAutoUpdate = false;
    // An affine basis can include shear; Three's generic transformed sphere is
    // not conservative for shear. Thirteen lines can use ordinary GPU clipping.
    this.track.frustumCulled = false;
    this.baseInverse = frameMatrix(this.body, jed, new THREE.Matrix4()).invert();
    this.trackDate = orbitShapeDate(jed);
    return this.track;
  }
  updateTrack(jed) {
    const date = orbitShapeDate(jed);
    if (!this.track || date === this.trackDate) return;
    frameMatrix(this.body, jed, this.track.matrix).multiply(this.baseInverse);
    this.track.matrixWorldNeedsUpdate = true;
    this.trackDate = date;
  }
}
