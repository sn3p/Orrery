import * as THREE from 'three';
import { NamedOrbit as Model, namedOrbitPoints, orbitShapeDate } from '../named/model.js';

export default class NamedOrbit extends Model {
  matches(body) { return body === this.body; }
  getPosAtTime(jed, target) {
    const position = this.position(jed);
    this.updateTrack(jed);
    return target ? target.set(...position) : position;
  }
  drawOrbit(jed) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(361 * 3), 3));
    geometry.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(361), 1));
    this.track = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color: 0x333333, linewidth: 1, dashSize: 5, gapSize: 3 }));
    this.updateTrack(jed);
    return this.track;
  }
  updateTrack(jed) {
    const date = orbitShapeDate(jed);
    if (!this.track || date === this.trackDate) return;
    const geometry = this.track.geometry, attribute = geometry.attributes.position;
    attribute.array.set(namedOrbitPoints(this.body, jed));
    attribute.needsUpdate = true;
    geometry.computeBoundingSphere();
    // Keep the attribute identity: replacing it each frame leaks old GPU buffers.
    const distances = geometry.attributes.lineDistance;
    distances.array[0] = 0;
    for (let j = 1; j < distances.count; j++) {
      const k = 3 * j;
      distances.array[j] = distances.array[j - 1] + Math.hypot(
        attribute.array[k] - attribute.array[k - 3], attribute.array[k + 1] - attribute.array[k - 2],
        attribute.array[k + 2] - attribute.array[k - 1]);
    }
    distances.needsUpdate = true;
    this.trackDate = date;
  }
}
