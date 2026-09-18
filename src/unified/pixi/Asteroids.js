import { Bounds, Buffer, BufferUsage, Geometry, Mesh, Shader, UniformGroup } from "pixi.js";
import { DISCOVERY_SECONDS, REBASE_DAYS, REFERENCE_JED, discoveryCount, orbitGLSL, prepareOrbits, validDate, wrap } from "../../js/asteroidOrbits.js";

const vertex = `
precision highp float;
attribute vec2 aPosition;
attribute vec4 aBasis;
attribute vec2 aElements;
attribute float aMeanAnomaly;
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
  vec2 center = orbitPosition(aBasis.xy, aBasis.zw, aElements, aMeanAnomaly, uOrbitTime);
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
  constructor(data, texture, jed, elapsed = 0, partialUploads = true, limit = data.count ?? data.length) {
    const canonical = !Array.isArray(data);
    const packed = canonical ? {
      bases: new Float32Array(data.dates.length * 4), elements: data.elements,
      meanAnomalies: new Float32Array(data.dates.length), phases: data.phases,
      dates: data.dates, radius: data.radius, epoch: jed,
    } : prepareOrbits(data, jed);
    const buffer = (data, label) => new Buffer({ data, label, usage: BufferUsage.VERTEX | BufferUsage.COPY_DST });
    const bases = buffer(packed.bases, "orbital bases");
    const elements = buffer(packed.elements, "orbital elements");
    const meanAnomalies = buffer(packed.meanAnomalies, "orbital phases");
    const markers = buffer(new Float32Array(packed.dates.length).fill(-1), "discovery timestamps");
    const geometry = new OrbitGeometry({
      attributes: {
        aPosition: { buffer: buffer(new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), "unit quad"), format: "float32x2" },
        aBasis: { buffer: bases, format: "float32x4", instance: true },
        aElements: { buffer: elements, format: "float32x2", instance: true },
        aMeanAnomaly: { buffer: meanAnomalies, format: "float32", instance: true },
        aDiscovery: { buffer: markers, format: "float32", instance: true },
      },
      indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]), instanceCount: 0,
    }, packed.radius);
    const uniforms = new UniformGroup({ uOrbitTime: { value: 0, type: "f32" }, uMarkerTime: { value: 0, type: "f32" } });
    const shader = Shader.from({ gl: { vertex, fragment, name: "asteroid-orbits" }, resources: { orbitUniforms: uniforms, uTexture: texture.source } });
    super({ geometry, shader, texture, eventMode: "none", label: "Asteroids" });
    this.partialUploads = partialUploads;
    this.catalogue = canonical ? data : null;
    this.committedCount = canonical ? 0 : packed.dates.length;
    this.pendingRanges = new Map();
    this.phases = packed.phases;
    this.discoveryDates = packed.dates;
    this.epoch = packed.epoch;
    this.markerEpoch = elapsed;
    this.elapsed = elapsed;
    this.uniforms = uniforms.uniforms;
    if (canonical) this.append(limit);
    // Creating or replacing a cloud establishes a complete historical baseline;
    // only later chronological crossings should receive arrival emphasis.
    this.update(jed, elapsed, { baseline: true });
  }

  // App keeps the canonical arrays; only the active adapter packs its projection.
  append(limit = this.catalogue?.count) {
    const model = this.catalogue;
    if (!model || Math.min(limit, model.count) <= this.committedCount) return;
    const start = this.committedCount, end = Math.min(limit, model.count);
    const bases = this.geometry.getBuffer("aBasis");
    const means = this.geometry.getBuffer("aMeanAnomaly");
    for (let i = start; i < end; i++) {
      bases.data.set([-model.p[i * 3], model.p[i * 3 + 1], -model.q[i * 3], model.q[i * 3 + 1]], i * 4);
      means.data[i] = wrap(model.phases[i * 2] + model.phases[i * 2 + 1] * (this.epoch - REFERENCE_JED));
    }
    this.committedCount = end;
    const extent = model.radius * 1.00001 + 2;
    this.geometry.orbitBounds = new Bounds(-extent, -extent, extent, extent);
    for (const [name, stride] of [["aBasis", 4], ["aElements", 2], ["aMeanAnomaly", 1]]) {
      this.queueUpload(name, start * stride * 4, end * stride * 4);
    }
  }

  queueUpload(name, start, end) {
    if (end <= start) return;
    const buffer = this.geometry.getBuffer(name);
    // Manual callers may render Pixi directly between updates. GPU buffer
    // versions also retire consumed ranges when no App receipt was requested.
    const uploaded = Object.values(buffer._gpuData).some(gpu => gpu?.updateID === buffer._updateID);
    const previous = uploaded ? null : this.pendingRanges.get(name);
    const range = this.partialUploads
      ? [Math.min(start, previous?.[0] ?? start), Math.max(end, previous?.[1] ?? end)]
      : [0, buffer.data.byteLength];
    this.pendingRanges.set(name, range);
    buffer.update(range[1] - range[0], range[0]);
  }

  acknowledgeDraw(renderer) {
    if (!this.geometry.instanceCount) return 0;
    for (const name of ["aBasis", "aElements", "aMeanAnomaly", "aDiscovery"]) {
      const buffer = this.geometry.getBuffer(name);
      if (buffer._gpuData[renderer.uid]?.updateID !== buffer._updateID) return null;
    }
    this.pendingRanges.clear();
    return this.committedCount;
  }

  captureFrame(jed, elapsed, { baseline = false } = {}) {
    const previous = this.geometry.instanceCount, count = discoveryCount(this.discoveryDates.subarray(0, this.committedCount), jed);
    const rollover = elapsed - this.markerEpoch > 4096;
    const markerStart = rollover || baseline ? 0 : previous;
    const markerEnd = rollover ? this.committedCount : baseline ? count : Math.max(previous, count);
    return { epoch: this.epoch, markerEpoch: this.markerEpoch, elapsed: this.elapsed,
      count: previous, visible: this.visible, orbitTime: this.uniforms.uOrbitTime, markerTime: this.uniforms.uMarkerTime,
      means: Math.abs(jed - this.epoch) > REBASE_DAYS
        ? this.geometry.getBuffer("aMeanAnomaly").data.slice(0, this.committedCount) : null,
      markerStart, markers: markerEnd > markerStart
        ? this.geometry.getBuffer("aDiscovery").data.slice(markerStart, markerEnd) : null };
  }

  restoreFrame(state) {
    if (state.means) {
      this.geometry.getBuffer("aMeanAnomaly").data.set(state.means);
      this.queueUpload("aMeanAnomaly", 0, state.means.byteLength);
    }
    if (state.markers) {
      this.geometry.getBuffer("aDiscovery").data.set(state.markers, state.markerStart);
      this.queueUpload("aDiscovery", state.markerStart * 4, state.markerStart * 4 + state.markers.byteLength);
    }
    this.epoch = state.epoch;
    this.markerEpoch = state.markerEpoch;
    this.elapsed = state.elapsed;
    this.geometry.instanceCount = state.count;
    this.visible = state.visible;
    this.uniforms.uOrbitTime = state.orbitTime;
    this.uniforms.uMarkerTime = state.markerTime;
  }

  update(jed, elapsed = this.elapsed, { baseline = false } = {}) {
    if (!validDate(jed) || !Number.isFinite(elapsed) || elapsed < this.markerEpoch) throw new Error("Invalid asteroid time.");
    if (Math.abs(jed - this.epoch) > REBASE_DAYS) {
      // Refresh every row, including hidden discoveries, from canonical Float64
      // phases. Eccentricity and motion remain in their immutable GPU buffer.
      const meanAnomalies = this.geometry.getBuffer("aMeanAnomaly");
      for (let i = 0; i < this.committedCount; i++) {
        meanAnomalies.data[i] = wrap(this.phases[i * 2] + this.phases[i * 2 + 1] * (jed - REFERENCE_JED));
      }
      this.queueUpload("aMeanAnomaly", 0, this.committedCount * 4);
      this.epoch = jed;
    }
    this.elapsed = elapsed;
    let markerTime = elapsed - this.markerEpoch;
    const markers = this.geometry.getBuffer("aDiscovery");
    let refreshed = false;
    // Bound animation-time float error as well, even after hours of playback.
    if (markerTime > 4096) {
      for (let i = 0; i < this.committedCount; i++) {
        const age = markerTime - markers.data[i];
        markers.data[i] = markers.data[i] >= 0 && age < DISCOVERY_SECONDS ? DISCOVERY_SECONDS - age : -1;
      }
      this.markerEpoch = elapsed - DISCOVERY_SECONDS;
      markerTime = DISCOVERY_SECONDS;
      refreshed = true;
    }
    const previous = this.geometry.instanceCount;
    const count = discoveryCount(this.discoveryDates.subarray(0, this.committedCount), jed);
    if (baseline) {
      markers.data.fill(-1, 0, count);
      if (!refreshed) this.queueUpload("aDiscovery", 0, count * 4);
    } else if (count > previous) {
      markers.data.fill(markerTime, previous, count);
      // Only the newly revealed range; no position or colour buffer exists.
      if (!refreshed) {
        // Pixi uses WebGL2's bufferSubData range overload. WebGL1 ignores
        // those arguments, so upload timestamps in full on discovery there.
        this.queueUpload("aDiscovery", previous * 4, count * 4);
      }
    }
    if (refreshed) this.queueUpload("aDiscovery", 0, this.committedCount * 4);
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
    this.phases = this.discoveryDates = this.catalogue = null;
    this.pendingRanges.clear();
  }
}
