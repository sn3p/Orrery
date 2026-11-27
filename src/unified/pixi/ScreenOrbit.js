import { Buffer, BufferUsage, Geometry, Mesh, Shader, Matrix } from 'pixi.js';
import { ScreenOrbit, orbitFragment } from '../named/ScreenOrbit.js';

export default class OrbitTrack extends Mesh {
  constructor(points) {
    const projection = new ScreenOrbit(points);
    const buffer = new Buffer({ data: projection.vertices, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const geometry = new Geometry({ attributes: {
      aPosition: { buffer, format: 'float32x3', stride: 16, offset: 0 },
      aDistance: { buffer, format: 'float32', stride: 16, offset: 12 },
    } });
    super({ geometry, eventMode: 'none' });
    this.sourcePoints = points; this.screenOrbit = projection; this.screenBuffer = buffer;
    this.screenMatrix = new Float64Array(16); this.screenTransform = new Matrix();
  }
  updateScreenOrbit({ width, height, pixelRatio = 1 }) {
    if (!this.visible) return;
    // Hidden reference groups need neither a shader nor projected geometry.
    this.shader ||= Shader.from({ gl: {
      name: 'screen-orbit',
      vertex: `precision highp float;
        attribute vec3 aPosition; attribute float aDistance; varying float vDistance;
        void main() { gl_Position = vec4(aPosition, 1.0); vDistance = aDistance; }`,
      fragment: orbitFragment,
    } });
    const { a, b, c, d, tx, ty } = this.getGlobalTransform(this.screenTransform), m = this.screenMatrix;
    m.fill(0); m[0] = 2 * a / width; m[1] = -2 * b / height; m[4] = 2 * c / width; m[5] = -2 * d / height;
    m[12] = 2 * tx / width - 1; m[13] = 1 - 2 * ty / height; m[15] = 1;
    if (this.screenOrbit.update(m, width, height, pixelRatio)) this.screenBuffer.update();
  }
  destroy(options) {
    const geometry = this.geometry, shader = this.shader;
    super.destroy(options);
    geometry.destroy(true);
    shader?.destroy();
  }
}
