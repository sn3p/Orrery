import { Bounds, Buffer, BufferUsage, Geometry, Mesh, Shader, UniformGroup } from "pixi.js";
import { DISCOVERY_SECONDS, REBASE_DAYS, REFERENCE_JED, discoveryCount, orbitGLSL, prepareOrbits, validDate, wrap } from "../../js/asteroidOrbits.js";
import { CLASS_COUNT, CLASS_DISTANT, CLASS_NEA, CLASS_REST_COLOR, CLASS_TROJAN,
  DEFAULT_POPULATION_PRESET, advanceClassTallies, classifyCatalogue, colorChannels,
  highlightMask, isPopulationPreset, populationGLSL, populationMask, visibleFromTallies } from "../catalog/population.js";

const vertex = pass => `
precision highp float;
attribute vec2 aPosition;
attribute vec4 aBasis;
attribute vec2 aElements;
attribute float aMeanAnomaly;
attribute float aDiscovery;
attribute float aClass;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
uniform vec4 uWorldColorAlpha;
uniform vec4 uColor;
uniform float uOrbitTime;
uniform float uMarkerTime;
uniform float uClassMask;
uniform float uColorMask;
uniform vec3 uNeaColor;
uniform vec3 uTrojanColor;
uniform vec3 uDistantColor;
varying vec2 vUV;
varying vec4 vColor;
${orbitGLSL}
${populationGLSL}
vec3 classRestColor(float id) {
  if (id < 1.5) return uNeaColor;
  if (id < 2.5) return uTrojanColor;
  return uDistantColor;
}
void main() {
  float age = uMarkerTime - aDiscovery;
  bool fresh = aDiscovery >= 0.0 && age < ${DISCOVERY_SECONDS};
  float highlighted = populationVisible(aClass, uColorMask);
  float visible = populationVisible(aClass, uClassMask);
  visible *= ${pass}.0 < 0.5 ? 1.0 - highlighted : highlighted;
  float emphasis = fresh ? 3.0 - 3.0 * max(age, 0.0) : 1.0;
  mat3 model = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  float clipPerUnit = length((model * vec3(1.0, 0.0, 0.0)).xy);
  float clipPerPixel = length(uProjectionMatrix[0].xy);
  float pixelsPerUnit = clipPerPixel > 0.0 ? clipPerUnit / clipPerPixel : 1.0;
  float size = visible * emphasis * max(1.0, pixelsPerUnit > 0.0 ? 1.0 / pixelsPerUnit : 1.0);
  vec2 center = orbitPosition(aBasis.xy, aBasis.zw, aElements, aMeanAnomaly, uOrbitTime);
  vec3 position = model * vec3(center + aPosition * size, 1.0);
  gl_Position = vec4(position.xy, 0.0, 1.0);
  vUV = aPosition + 0.5;
  vec3 resting = highlighted > 0.5 ? classRestColor(aClass) : vec3(0.6666666667);
  vec3 arrival = vec3(0.0, 1.0, 0.0);
  vColor = vec4(fresh ? arrival : resting, visible) * uColor * uWorldColorAlpha;
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
    const classes = canonical ? data.classes : classifyCatalogue(data);
    const classValues = buffer(new Float32Array(packed.dates.length), "population classes");
    const quad = buffer(new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), "unit quad");
    const geometry = new OrbitGeometry({
      attributes: {
        aPosition: { buffer: quad, format: "float32x2" },
        aBasis: { buffer: bases, format: "float32x4", instance: true },
        aElements: { buffer: elements, format: "float32x2", instance: true },
        aMeanAnomaly: { buffer: meanAnomalies, format: "float32", instance: true },
        aDiscovery: { buffer: markers, format: "float32", instance: true },
        aClass: { buffer: classValues, format: "float32", instance: true },
      },
      indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]), instanceCount: 0,
    }, packed.radius);
    const [neaR, neaG, neaB] = colorChannels(CLASS_REST_COLOR[CLASS_NEA]);
    const [trojanR, trojanG, trojanB] = colorChannels(CLASS_REST_COLOR[CLASS_TROJAN]);
    const [distantR, distantG, distantB] = colorChannels(CLASS_REST_COLOR[CLASS_DISTANT]);
    const uniforms = new UniformGroup({
      uOrbitTime: { value: 0, type: "f32" }, uMarkerTime: { value: 0, type: "f32" },
      uClassMask: { value: populationMask(DEFAULT_POPULATION_PRESET), type: "f32" },
      uColorMask: { value: highlightMask(DEFAULT_POPULATION_PRESET), type: "f32" },
      uNeaColor: { value: new Float32Array([neaR, neaG, neaB]), type: "vec3<f32>" },
      uTrojanColor: { value: new Float32Array([trojanR, trojanG, trojanB]), type: "vec3<f32>" },
      uDistantColor: { value: new Float32Array([distantR, distantG, distantB]), type: "vec3<f32>" },
    });
    const shader = Shader.from({
      gl: { vertex: vertex(0), fragment, name: "asteroid-orbits" },
      resources: { orbitUniforms: uniforms, uTexture: texture.source },
    });
    super({ geometry, shader, texture, eventMode: "none", label: "Asteroids" });
    const highlightGeometry = new OrbitGeometry({
      attributes: {
        aPosition: { buffer: quad, format: "float32x2" },
        aBasis: { buffer: bases, format: "float32x4", instance: true },
        aElements: { buffer: elements, format: "float32x2", instance: true },
        aMeanAnomaly: { buffer: meanAnomalies, format: "float32", instance: true },
        aDiscovery: { buffer: markers, format: "float32", instance: true },
        aClass: { buffer: classValues, format: "float32", instance: true },
      },
      indexBuffer: new Uint16Array([0, 1, 2, 0, 2, 3]), instanceCount: 0,
    }, packed.radius);
    const highlightUniforms = new UniformGroup({
      uOrbitTime: { value: 0, type: "f32" }, uMarkerTime: { value: 0, type: "f32" },
      uClassMask: { value: populationMask(DEFAULT_POPULATION_PRESET), type: "f32" },
      uColorMask: { value: highlightMask(DEFAULT_POPULATION_PRESET), type: "f32" },
      uNeaColor: { value: new Float32Array([neaR, neaG, neaB]), type: "vec3<f32>" },
      uTrojanColor: { value: new Float32Array([trojanR, trojanG, trojanB]), type: "vec3<f32>" },
      uDistantColor: { value: new Float32Array([distantR, distantG, distantB]), type: "vec3<f32>" },
    });
    const highlightShader = Shader.from({
      gl: { vertex: vertex(1), fragment, name: "asteroid-orbits-highlight" },
      resources: { orbitUniforms: highlightUniforms, uTexture: texture.source },
    });
    this.highlight = new Mesh({
      geometry: highlightGeometry, shader: highlightShader, texture,
      eventMode: "none", label: "Asteroid highlights", visible: false,
    });
    this.partialUploads = partialUploads;
    this.catalogue = canonical ? data : null;
    this.committedCount = canonical ? 0 : packed.dates.length;
    this.pendingRanges = new Map();
    this.phases = packed.phases;
    this.discoveryDates = packed.dates;
    this.classes = classes;
    this.classTallies = new Uint32Array(CLASS_COUNT);
    this.tallyCount = 0;
    this.visibleCount = 0;
    this.populationPreset = DEFAULT_POPULATION_PRESET;
    this.colorize = false;
    this.epoch = packed.epoch;
    this.markerEpoch = elapsed;
    this.elapsed = elapsed;
    this.uniforms = uniforms.uniforms;
    this.highlightUniforms = highlightUniforms.uniforms;
    if (canonical) this.append(limit);
    else {
      this.copyClasses(0, this.committedCount);
      this.queueUpload("aClass", 0, this.committedCount * 4);
    }
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
    this.copyClasses(start, end);
    const extent = model.radius * 1.00001 + 2;
    this.geometry.orbitBounds = new Bounds(-extent, -extent, extent, extent);
    for (const [name, stride] of [["aBasis", 4], ["aElements", 2], ["aMeanAnomaly", 1], ["aClass", 1]]) {
      this.queueUpload(name, start * stride * 4, end * stride * 4);
    }
  }

  copyClasses(start, end) {
    const values = this.geometry.getBuffer("aClass").data;
    for (let i = start; i < end; i++) values[i] = this.classes[i];
  }

  setPopulationPreset(preset) {
    if (!isPopulationPreset(preset) || preset === this.populationPreset) return;
    this.populationPreset = preset;
    this.applyMasks();
    this.visibleCount = visibleFromTallies(this.classTallies, preset);
  }

  setColorize(colorize) {
    if (typeof colorize !== "boolean" || colorize === this.colorize) return;
    this.colorize = colorize;
    this.applyMasks();
  }

  applyMasks() {
    const drawn = populationMask(this.populationPreset);
    const mask = highlightMask(this.populationPreset, this.colorize);
    this.uniforms.uClassMask = this.highlightUniforms.uClassMask = drawn;
    this.uniforms.uColorMask = this.highlightUniforms.uColorMask = mask;
    this.syncHighlight();
  }

  syncTallies(count) {
    const next = advanceClassTallies(this.classes, this.tallyCount, count, this.populationPreset, this.classTallies);
    this.tallyCount = next.tallyCount;
    this.visibleCount = next.visibleCount;
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
    for (const name of ["aBasis", "aElements", "aMeanAnomaly", "aDiscovery", "aClass"]) {
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
    this.geometry.instanceCount = this.highlight.geometry.instanceCount = state.count;
    this.visible = state.visible;
    this.syncHighlight();
    this.syncTallies(state.count);
    this.uniforms.uOrbitTime = this.highlightUniforms.uOrbitTime = state.orbitTime;
    this.uniforms.uMarkerTime = this.highlightUniforms.uMarkerTime = state.markerTime;
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
    this.geometry.instanceCount = this.highlight.geometry.instanceCount = count;
    this.visible = count > 0;
    this.syncHighlight();
    this.syncTallies(count);
    this.uniforms.uOrbitTime = this.highlightUniforms.uOrbitTime = jed - this.epoch;
    this.uniforms.uMarkerTime = this.highlightUniforms.uMarkerTime = markerTime;
    return count;
  }

  setTexture(texture) {
    this.texture = this.highlight.texture = texture;
    this.shader.resources.uTexture = texture.source;
    this.highlight.shader.resources.uTexture = texture.source;
  }

  // The highlight is a stage sibling. A mesh may not parent it.
  mountHighlight() {
    const parent = this.parent;
    if (!parent || this.highlight.parent === parent) return;
    parent.addChildAt(this.highlight, parent.getChildIndex(this) + 1);
    this.syncHighlight();
  }

  syncHighlight() {
    this.highlight.visible = this.visible && this.uniforms.uColorMask !== 0;
  }

  destroy() {
    const { geometry, shader, highlight } = this;
    const highlightGeometry = highlight.geometry, highlightShader = highlight.shader;
    highlight.destroy();
    // Same order as the cloud below: unload before destroy so the renderer
    // drops its VAO, and never destroy the program. Pixi caches programs by
    // source, so the next cloud's highlight still draws with this one.
    highlightGeometry.unload();
    highlightGeometry.destroy(false);
    highlightShader.destroy();
    super.destroy();
    // Pixi 8.20 removes geometry listeners inside destroy(), before unload.
    // Unload first so the renderer releases its VAO and managed reference.
    geometry.unload();
    geometry.destroy(true);
    // Pixi caches programs across meshes; replacing one must not destroy them.
    shader.destroy();
    this.phases = this.discoveryDates = this.classes = this.catalogue = null;
    this.pendingRanges.clear();
  }
}
