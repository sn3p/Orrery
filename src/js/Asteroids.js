import { Bounds, Buffer, BufferUsage, Geometry, Mesh, Shader, UniformGroup } from "pixi.js";
import { DISCOVERY_SECONDS, REBASE_DAYS, REFERENCE_JED, discoveryCount, orbitGLSL, prepareOrbits, validDate, wrap } from "./asteroidOrbits.js";

const vertex = `
precision highp float;
attribute vec2 aPosition;
attribute vec4 aBasis;
attribute vec3 aElements;
attribute float aDiscovery;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec4 uColor;
uniform float uOrbitTime;
uniform float uMarkerTime;
varying vec2 vUV;
varying vec4 vColor;
${orbitGLSL}
void main() {
  float age = uMarkerTime - aDiscovery;
  bool fresh = aDiscovery >= 0.0 && age < ${DISCOVERY_SECONDS};
  float size = fresh ? 3.0 - 3.0 * max(age, 0.0) : 1.0;
  vec2 center = orbitPosition(aBasis.xy, aBasis.zw, aElements, uOrbitTime);
  vec3 position = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(center + aPosition * size, 1.0);
  gl_Position = vec4(position.xy, 0.0, 1.0);
  vUV = aPosition + 0.5;
  vColor = vec4(fresh ? vec3(0.0, 1.0, 0.0) : vec3(0.6666666667), 1.0) * uColor * uWorldColorAlpha;
}`;
const fragment = `
precision mediump float;
varying vec2 vUV;
varying vec4 vColor;
uniform sampler2D uTexture;
void main() { gl_FragColor = texture2D(uTexture, vUV) * vColor; }
`;

// Geometry cannot infer moving bounds from the unit quad or orbital bases.
class OrbitGeometry extends Geometry {
  constructor(options, radius) {
    super(options);
    const extent = radius * 1.00001 + 2;
    this.orbitBounds = new Bounds(-extent, -extent, extent, extent);
  }
  get bounds() { return this.orbitBounds; }
}

export default class Asteroids extends Mesh {
  constructor(data, texture, jed, elapsed = 0, partialUploads = true) {
    const packed = prepareOrbits(data, jed);
    const buffer = (data, label) => new Buffer({ data, label, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const bases = buffer(packed.bases, "orbital bases");
    const elements = buffer(packed.elements, "orbital phases");
    const markers = buffer(new Float32Array(packed.dates.length).fill(-1), "discovery timestamps");
    const geometry = new OrbitGeometry({
      attributes: {
        aPosition: { buffer: buffer(new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), "unit quad"), format: "float32x2" },
        aBasis: { buffer: bases, format: "float32x4", instance: true },
        aElements: { buffer: elements, format: "float32x3", instance: true },
        aDiscovery: { buffer: markers, format: "float32", instance: true },
      },
      indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]), instanceCount: 0,
    }, packed.radius);
    const uniforms = new UniformGroup({ uOrbitTime: { value: 0, type: "f32" }, uMarkerTime: { value: 0, type: "f32" } });
    const shader = Shader.from({ gl: { vertex, fragment, name: "asteroid-orbits" }, resources: { orbitUniforms: uniforms, uTexture: texture.source } });
    super({ geometry, shader, texture, eventMode: "none", label: "Asteroids" });
    this.partialUploads = partialUploads;
    this.phases = packed.phases;
    this.discoveryDates = packed.dates;
    this.epoch = jed;
    this.markerEpoch = elapsed;
    this.elapsed = elapsed;
    this.uniforms = uniforms.uniforms;
    this.update(jed, elapsed);
  }

  update(jed, elapsed = this.elapsed) {
    if (!validDate(jed) || !Number.isFinite(elapsed) || elapsed < this.markerEpoch) throw new Error("Invalid asteroid time.");
    if (Math.abs(jed - this.epoch) > REBASE_DAYS) {
      const elements = this.geometry.getBuffer("aElements");
      for (let i = 0; i < this.discoveryDates.length; i++) {
        elements.data[i * 3 + 1] = wrap(this.phases[i * 2] + this.phases[i * 2 + 1] * (jed - REFERENCE_JED));
      }
      elements.update();
      this.epoch = jed;
    }
    this.elapsed = elapsed;
    let markerTime = elapsed - this.markerEpoch;
    const markers = this.geometry.getBuffer("aDiscovery");
    let refreshed = false;
    // Bound animation-time float error as well, even after hours of playback.
    if (markerTime > 4096) {
      for (let i = 0; i < markers.data.length; i++) {
        const age = markerTime - markers.data[i];
        markers.data[i] = markers.data[i] >= 0 && age < DISCOVERY_SECONDS ? DISCOVERY_SECONDS - age : -1;
      }
      this.markerEpoch = elapsed - DISCOVERY_SECONDS;
      markerTime = DISCOVERY_SECONDS;
      refreshed = true;
    }
    const previous = this.geometry.instanceCount;
    const count = discoveryCount(this.discoveryDates, jed);
    if (count > previous) {
      markers.data.fill(markerTime, previous, count);
      // Only the newly revealed range; no position or colour buffer exists.
      if (!refreshed) {
        // Pixi uses WebGL2's bufferSubData range overload. WebGL1 ignores
        // those arguments, so upload timestamps in full on discovery there.
        if (this.partialUploads) markers.update((count - previous) * 4, previous * 4);
        else markers.update(markers.data.byteLength);
      }
    }
    if (refreshed) markers.update(markers.data.byteLength);
    this.geometry.instanceCount = count;
    this.visible = count > 0;
    this.uniforms.uOrbitTime = jed - this.epoch;
    this.uniforms.uMarkerTime = markerTime;
    return count;
  }

  setTexture(texture) {
    this.texture = texture;
    this.shader.resources.uTexture = texture.source;
  }

  destroy() {
    const { geometry, shader } = this;
    super.destroy();
    // Pixi 8.20 removes geometry listeners inside destroy(), before unload.
    // Unload first so the renderer releases its VAO and managed reference.
    geometry.unload();
    geometry.destroy(true);
    // Pixi caches programs across meshes; replacing one must not destroy them.
    shader.destroy();
    this.phases = this.discoveryDates = null;
  }
}
