import * as THREE from 'three';
import { ScreenOrbit, orbitFragment } from '../named/ScreenOrbit.js';

export default class OrbitTrack extends THREE.Mesh {
  constructor(points) {
    const projection = new ScreenOrbit(points), geometry = new THREE.BufferGeometry();
    const buffer = new THREE.InterleavedBuffer(projection.vertices, 4).setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    geometry.setAttribute('lineDistance', new THREE.InterleavedBufferAttribute(buffer, 1, 3));
    geometry.setDrawRange(0, 0);
    const material = new THREE.ShaderMaterial({
      vertexShader: `attribute float lineDistance;
        varying float vDistance;
        void main() { gl_Position = vec4(position, 1.0); vDistance = lineDistance; }`,
      fragmentShader: orbitFragment, depthWrite: false, side: THREE.DoubleSide,
    });
    super(geometry, material);
    this.sourcePoints = points; this.screenOrbit = projection; this.screenBuffer = buffer;
    this.frustumCulled = false; this.projectionMatrix = new THREE.Matrix4();
  }
  updateScreenOrbit(camera, { width, height, pixelRatio = 1 }) {
    if (!this.visible) return;
    this.updateWorldMatrix(true, false);
    this.projectionMatrix.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse).multiply(this.matrixWorld);
    // The renderer passes CSS dimensions explicitly: ThreeRenderer sizes its
    // backing buffer directly, so WebGLRenderer.getSize is not the CSS size.
    if (this.screenOrbit.update(this.projectionMatrix.elements, width, height, pixelRatio)) {
      this.screenBuffer.needsUpdate = true;
      this.geometry.setDrawRange(0, this.screenOrbit.count);
    }
  }
}
