import * as THREE from "three";
import { REFERENCE_JED, wrapPhase } from "../catalog/prepareCatalogue.js";
import { DISCOVERY_SECONDS, validDate, MAX_PHASE_ADVANCE } from "../../js/asteroidOrbits.js";
import { CLASS_COUNT, CLASS_REST_COLOR,
  DEFAULT_POPULATION_PRESET, advanceClassTallies, highlightMask,
  isPopulationPreset, populationGLSL, populationMask, visibleFromTallies } from "../catalog/population.js";

export { REFERENCE_JED } from "../catalog/prepareCatalogue.js";
export const REBASE_DAYS = 4096;

// Shader and presentation ported from preserved Orrery3D 93a3e1f (MIT).
// Also executed directly by the benchmark's numerical accuracy checks.
export const orbitGLSL = `
  vec3 orbitPosition(vec3 p, vec3 q, vec2 orbit, float meanAnomaly, float time) {
    float e = orbit.x;
    float M = mod(meanAnomaly + orbit.y * time + 3.141592653589793, 6.283185307179586) - 3.141592653589793;
    float E = e < 0.8 ? M : sign(M) * 3.141592653589793;
    for (int k = 0; k < 12; k++) {
      E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
    }
    // Very eccentric ellipses can converge more slowly near perihelion.
    if (e >= 0.99) {
      for (int k = 0; k < 12; k++) {
        E -= (E - e * sin(E) - M) / (1.0 - e * cos(E));
      }
    }
    return p * (cos(E) - e) + q * sin(E);
  }
  vec3 discoveryColor(float time, float discovery, float duration, vec3 fresh, vec3 old) {
    if (duration <= 0.0) return old;
    return mix(fresh, old, clamp((time - discovery) / duration, 0.0, 1.0));
  }
`;

export default class Asteroids extends THREE.Points {
  constructor(model, { jed, elapsed = 0, color = new THREE.Color(0x999999), discoveryColor = new THREE.Color(0x00ff00),
    discoveryDuration = 200, committedCount = model.count, populationPreset = DEFAULT_POPULATION_PRESET,
    colorize = false }) {
    if (!validDate(jed) || !Number.isFinite(elapsed) || elapsed < 0
      || !Number.isFinite(discoveryDuration) || discoveryDuration < 0) {
      throw new Error("Invalid asteroid date or discovery duration.");
    }
    const geometry = new THREE.BufferGeometry();
    // Static attributes reference retained CPU data read-only. Only phase,
    // discovery packing and arrival timestamps are adapter-owned.
    const arrivals = new Float32Array(model.dates.length).fill(-1);
    for (const [name, array, size] of [["position", model.p, 3], ["basisQ", model.q, 3],
      ["elements", model.elements, 2], ["meanAnomaly", new Float32Array(model.dates.length), 1],
      ["discovery", new Float32Array(model.dates.length), 1], ["arrival", arrivals, 1],
      ["classId", model.classes, 1]]) {
      geometry.setAttribute(name, new THREE.BufferAttribute(array, size));
    }
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), model.radius * 1.00001 + 1);
    geometry.setDrawRange(0, 0);
    const preset = isPopulationPreset(populationPreset) ? populationPreset : DEFAULT_POPULATION_PRESET;
    const shared = {
      orbitTime: { value: 0 }, discoveryTime: { value: jed - REFERENCE_JED },
      discoveryBaseline: { value: jed - REFERENCE_JED },
      fadeDuration: { value: discoveryDuration },
      freshColor: { value: discoveryColor }, oldColor: { value: color },
      classMask: { value: populationMask(preset) },
      colorMask: { value: highlightMask(preset, colorize === true) },
      classColors: { value: Array.from({ length: CLASS_COUNT }, (_, id) => new THREE.Color(CLASS_REST_COLOR[id] ?? 0)) },
      pulseTime: { value: 0 },
    };
    const uniforms = { ...shared, pass: { value: 0 } };
    const highlightUniforms = { ...shared, pass: { value: 1 } };
    const compile = (shader, set) => {
      Object.assign(shader.uniforms, set);
      shader.vertexShader = shader.vertexShader.replace("#include <common>", `
        #include <common>
        attribute vec3 basisQ;
        attribute vec2 elements;
        attribute float meanAnomaly;
        attribute float discovery;
        attribute float arrival;
        attribute float classId;
        uniform float orbitTime;
        uniform float discoveryTime;
        uniform float discoveryBaseline;
        uniform float fadeDuration;
        uniform vec3 freshColor;
        uniform vec3 oldColor;
        uniform float classMask;
        uniform float colorMask;
        uniform vec3 classColors[${CLASS_COUNT}];
        uniform float pass;
        uniform float pulseTime;
        ${orbitGLSL}
        ${populationGLSL}
        vec3 classRestColor(float id) {
          return classColors[int(id + 0.5)];
        }
      `).replace("#include <color_vertex>", `
        float highlighted = populationVisible(classId, colorMask);
        float show = populationVisible(classId, classMask);
        show *= pass < 0.5 ? 1.0 - highlighted : highlighted;
        vec3 resting = highlighted > 0.5 ? classRestColor(classId) : oldColor;
        vColor = vec4(discovery <= discoveryBaseline ? resting
          : discoveryColor(discoveryTime, discovery, fadeDuration, freshColor, resting), show);
      `).replace("#include <begin_vertex>", "vec3 transformed = orbitPosition(position, basisQ, elements, meanAnomaly, orbitTime);")
        .replace("#include <fog_vertex>", `
        // WebGL clamps gl_PointSize to at least 1, so masked points must leave clip space.
        if (vColor.a < 0.5) {
          gl_PointSize = 0.0;
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        } else {
          float age = pulseTime - arrival;
          gl_PointSize = max(gl_PointSize, 1.0) * (arrival >= 0.0 && age >= 0.0 && age < ${DISCOVERY_SECONDS}
            ? 3.0 - 3.0 * age : 1.0);
        }
        #include <fog_vertex>
      `);
      shader.fragmentShader = shader.fragmentShader.replace("#include <clipping_planes_fragment>", `
        if (vColor.a < 0.5) discard;
        #include <clipping_planes_fragment>
      `);
    };
    const material = new THREE.PointsMaterial({ size: 1, vertexColors: true, depthWrite: false });
    const highlightMaterial = new THREE.PointsMaterial({
      size: 1, vertexColors: true, depthTest: true, depthWrite: false,
    });
    material.onBeforeCompile = shader => compile(shader, uniforms);
    highlightMaterial.onBeforeCompile = shader => compile(shader, highlightUniforms);
    const programKey = () => "asteroid-orbits-r186-v9";
    material.customProgramCacheKey = programKey;
    highlightMaterial.customProgramCacheKey = programKey;
    super(geometry, material);
    this.highlight = new THREE.Points(geometry, highlightMaterial);
    this.highlight.frustumCulled = false;
    this.highlight.name = "Asteroid highlights";
    this.highlight.visible = false;
    this.add(this.highlight);
    this.name = "Asteroids";
    this.catalogue = model;
    this.discoveryDates = model.dates;
    this.classes = model.classes;
    this.phases = model.phases;
    this.epoch = jed;
    this.elapsed = elapsed;
    this.markerEpoch = 0;
    this.rebaseDays = REBASE_DAYS;
    this.committedCount = 0;
    this.uploadedVersions = new Map();
    this.uniforms = uniforms;
    this.highlightUniforms = highlightUniforms;
    this.populationPreset = preset;
    this.colorize = colorize === true;
    this.classTallies = new Uint32Array(CLASS_COUNT);
    this.tallyCount = 0;
    this.visibleCount = 0;
    // Always submit the complete visible prefix, even with an offscreen camera.
    // GPU clipping handles it without confusing completion with CPU culling.
    this.frustumCulled = false;
    this.append(committedCount);
    this.update(jed, elapsed, { baseline: true });
  }

  append(limit = this.catalogue.count) {
    const model = this.catalogue, start = this.committedCount, end = Math.min(limit, model.count);
    if (end <= start) return;
    const attributes = this.geometry.attributes;
    for (let i = start; i < end; i++) {
      attributes.meanAnomaly.array[i] = wrapPhase(this.phases[i * 2] + this.phases[i * 2 + 1] * (this.epoch - REFERENCE_JED));
      attributes.discovery.array[i] = this.discoveryDates[i] - REFERENCE_JED;
      // Preserve source rebasing for ordinary orbits, bounding unusually fast
      // valid catalogue rows by the same phase budget used in shared validation.
      this.rebaseDays = Math.min(this.rebaseDays, MAX_PHASE_ADVANCE / model.elements[i * 2 + 1]);
    }
    for (const attribute of Object.values(attributes)) {
      attribute.addUpdateRange(start * attribute.itemSize, (end - start) * attribute.itemSize);
      attribute.needsUpdate = true;
    }
    this.geometry.boundingSphere.radius = model.radius * 1.00001 + 1;
    this.committedCount = end;
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
    this.uniforms.classMask.value = populationMask(this.populationPreset);
    this.uniforms.colorMask.value = highlightMask(this.populationPreset, this.colorize);
    this.syncHighlight();
  }

  syncHighlight() {
    this.highlight.visible = this.visible && this.uniforms.colorMask.value !== 0;
  }

  syncTallies(count) {
    const next = advanceClassTallies(this.classes, this.tallyCount, count, this.populationPreset, this.classTallies);
    this.tallyCount = next.tallyCount;
    this.visibleCount = next.visibleCount;
  }

  captureFrame(jed, elapsed = this.elapsed, { baseline = false } = {}) {
    const previous = this.geometry.drawRange.count;
    let lo = 0, hi = this.committedCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.discoveryDates[mid] <= jed) lo = mid + 1;
      else hi = mid;
    }
    const count = lo;
    const rollover = elapsed - this.markerEpoch > 4096;
    const arrivalStart = rollover || baseline ? 0 : previous;
    const arrivalEnd = rollover ? this.committedCount : baseline ? count : Math.max(previous, count);
    return { epoch: this.epoch, elapsed: this.elapsed, markerEpoch: this.markerEpoch,
      orbitTime: this.uniforms.orbitTime.value,
      discoveryTime: this.uniforms.discoveryTime.value, discoveryBaseline: this.uniforms.discoveryBaseline.value,
      pulseTime: this.uniforms.pulseTime.value,
      count: previous, visible: this.visible,
      means: Math.abs(jed - this.epoch) > this.rebaseDays
        ? this.geometry.attributes.meanAnomaly.array.slice(0, this.committedCount) : null,
      arrivalStart, arrivals: arrivalEnd > arrivalStart
        ? this.geometry.attributes.arrival.array.slice(arrivalStart, arrivalEnd) : null };
  }

  restoreFrame(state) {
    if (state.means) {
      const attribute = this.geometry.attributes.meanAnomaly;
      attribute.array.set(state.means);
      attribute.addUpdateRange(0, state.means.length);
      attribute.needsUpdate = true;
    }
    if (state.arrivals) {
      const attribute = this.geometry.attributes.arrival;
      attribute.array.set(state.arrivals, state.arrivalStart);
      attribute.addUpdateRange(state.arrivalStart, state.arrivals.length);
      attribute.needsUpdate = true;
    }
    this.epoch = state.epoch;
    this.elapsed = state.elapsed;
    this.markerEpoch = state.markerEpoch;
    this.uniforms.orbitTime.value = state.orbitTime;
    this.uniforms.discoveryTime.value = state.discoveryTime;
    this.uniforms.discoveryBaseline.value = state.discoveryBaseline;
    this.uniforms.pulseTime.value = state.pulseTime;
    this.geometry.setDrawRange(0, state.count);
    this.visible = state.visible;
    this.syncHighlight();
    this.syncTallies(state.count);
  }

  update(jed, elapsed = this.elapsed, { baseline = false } = {}) {
    if (!validDate(jed) || !Number.isFinite(elapsed) || elapsed < this.markerEpoch) {
      throw new Error("Invalid asteroid date.");
    }
    const previousJed = this.uniforms.discoveryTime.value + REFERENCE_JED;
    if (Math.abs(jed - this.epoch) > this.rebaseDays) {
      const meanAnomaly = this.geometry.attributes.meanAnomaly;
      for (let i = 0; i < this.committedCount; i++) {
        meanAnomaly.array[i] = wrapPhase(this.phases[i * 2] + this.phases[i * 2 + 1] * (jed - REFERENCE_JED));
      }
      if (this.committedCount) {
        meanAnomaly.addUpdateRange(0, this.committedCount);
        meanAnomaly.needsUpdate = true;
      }
      this.epoch = jed;
    }
    this.elapsed = elapsed;
    let pulseTime = elapsed - this.markerEpoch;
    const arrivals = this.geometry.attributes.arrival;
    let refreshed = false;
    // Bound animation-time float error as well, even after hours of playback.
    if (pulseTime > 4096) {
      for (let i = 0; i < this.committedCount; i++) {
        const age = pulseTime - arrivals.array[i];
        arrivals.array[i] = arrivals.array[i] >= 0 && age < DISCOVERY_SECONDS ? DISCOVERY_SECONDS - age : -1;
      }
      this.markerEpoch = elapsed - DISCOVERY_SECONDS;
      pulseTime = DISCOVERY_SECONDS;
      refreshed = true;
    }
    const previous = this.geometry.drawRange.count;
    let lo = 0, hi = this.committedCount;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.discoveryDates[mid] <= jed) lo = mid + 1;
      else hi = mid;
    }
    if (baseline) {
      arrivals.array.fill(-1, 0, lo);
      if (!refreshed && lo) {
        arrivals.addUpdateRange(0, lo);
        arrivals.needsUpdate = true;
      }
    } else if (lo > previous) {
      arrivals.array.fill(pulseTime, previous, lo);
      if (!refreshed) {
        arrivals.addUpdateRange(previous, lo - previous);
        arrivals.needsUpdate = true;
      }
    }
    if (refreshed && this.committedCount) {
      arrivals.addUpdateRange(0, this.committedCount);
      arrivals.needsUpdate = true;
    }
    this.uniforms.orbitTime.value = jed - this.epoch;
    this.uniforms.discoveryTime.value = jed - REFERENCE_JED;
    this.uniforms.pulseTime.value = pulseTime;
    if (baseline) this.uniforms.discoveryBaseline.value = jed - REFERENCE_JED;
    else if (jed < previousJed) {
      // Rewinding lowers the mature cutoff. A later ordinary forward crossing
      // can therefore receive discovery emphasis again.
      this.uniforms.discoveryBaseline.value = Math.min(this.uniforms.discoveryBaseline.value, jed - REFERENCE_JED);
    }
    this.geometry.setDrawRange(0, lo);
    // Three otherwise uploads every preallocated attribute even for zero draws.
    this.visible = lo > 0;
    this.syncHighlight();
    this.syncTallies(lo);
    return lo;
  }

  invalidateGraphics() {
    this.uploadedVersions.clear();
    this.geometry.dispose();
  }

  acknowledgeDraw() {
    if (!this.geometry.drawRange.count) return 0;
    for (const attribute of Object.values(this.geometry.attributes)) {
      if (this.uploadedVersions.get(attribute) !== attribute.version) return null;
    }
    return this.committedCount;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.highlight.material.dispose();
    this.highlight = null;
    this.removeFromParent();
    this.geometry.dispose();
    this.material.dispose();
    for (const name of Object.keys(this.geometry.attributes)) this.geometry.deleteAttribute(name);
    this.uploadedVersions.clear();
    this.catalogue = this.discoveryDates = this.classes = this.phases = null;
  }
  dispose() { this.destroy(); }
}
