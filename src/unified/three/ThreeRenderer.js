import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import Sun from "./Sun.js";
import Planet from "./Planet.js";
import Orbit from "./Orbit.js";
import Asteroids from "./Asteroids.js";
import { DEFAULT_PLANET_LABEL_MODE, isPlanetLabelMode, PlanetLabels } from "../PlanetLabel.js";
import { DEFAULT_PLANET_ORBITS_VISIBLE, isPlanetOrbitVisibility } from "../PlanetOrbitPreference.js";
import { DEFAULT_POPULATION_PRESET, isPopulationPreset } from "../catalog/population.js";
import { VIEW_FIT_MS, easeOutCubic, lerp3, threePresetTargetPose } from "../viewFit.js";

function disposePlanets(batch) {
  for (const { planet, orbit } of batch) {
    planet.body.geometry.dispose();
    planet.body.material.dispose();
    orbit?.geometry.dispose();
    orbit?.material.dispose();
  }
}

function preparePlanets(data, jed) {
  const batch = [];
  try {
    for (const item of data) {
      const planet = new Planet(item.ephemeris, { name: item.name, size: item.size, color: item.color });
      const entry = { planet };
      batch.push(entry);
      entry.orbit = Orbit.createOrbit(item.ephemeris, jed);
      planet.render(jed);
    }
    return batch;
  } catch (error) { disposePlanets(batch); throw error; }
}

// Three owns graphics and camera/input. App owns time, scheduling, UI and data.
export default class ThreeRenderer {
  constructor({ container, invalidate, reportGraphicsState, getViewport }) {
    Object.assign(this, { container, getViewport, reportGraphicsState, requestRender: invalidate });
    this.destroyed = false;
    this.contextLost = false;
    this.asteroids = this.stagedAsteroids = this.catalogueTransition = null;
    this.planets = [];
    this.planetOrbits = [];
    this.planetLabelMode = DEFAULT_PLANET_LABEL_MODE;
    this.planetOrbitsVisible = DEFAULT_PLANET_ORBITS_VISIBLE;
    this.populationPreset = DEFAULT_POPULATION_PRESET;
    this.colorizeGroups = false;
    this.viewFit = null;
    this.viewFitInternal = false;
    this.planetLabels = new PlanetLabels(container);
    this.planetLabelPosition = new THREE.Vector3();
    this.onContextLost = event => {
      event.preventDefault();
      if (this.destroyed) return;
      this.contextLost = true;
      this.planetLabels.hide();
      this.releaseSceneResources();
      this.reportGraphicsState(true);
    };
    this.onContextRestored = () => {
      if (this.destroyed) return;
      try {
        this.resize(this.getViewport());
        this.contextLost = false;
        this.reportGraphicsState(false);
      } catch (error) { this.reportGraphicsState(true, error); }
    };
  }

  init() {
    if (this.destroyed || this.initialized) return;
    try {
      this.canvas = document.createElement("canvas");
      this.scene = new THREE.Scene();
      this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
      this.renderer.setClearColor(0x000000, 1);
      this.camera = new THREE.PerspectiveCamera(60, 1, 0.001, 2000000);
      this.camera.position.set(500, 500, 400);
      this.camera.up.set(0, 0, 1);
      this.camera.lookAt(this.scene.position);
      this.scene.add(new Sun().body);
      this.installDrawChecks();
      this.renderer.debug.onShaderError = () => {
        this.gpuError ??= new Error("Unable to render the scene shaders.");
      };
      this.initialized = true;
      this.resize(this.getViewport());
      this.container.appendChild(this.canvas);
      // OrbitControls binds keyboard interception to getRootNode(). Connect
      // after attachment so disposal removes it from the same document.
      this.controls = new OrbitControls(this.camera, this.canvas);
      this.controls.addEventListener("change", this.onControlsChange);
      this.canvas.addEventListener("webglcontextlost", this.onContextLost);
      this.canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    } catch (error) { this.destroy(); throw error; }
  }

  installDrawChecks() {
    const gl = this.renderer.getContext();
    this.glMethods = [];
    // GL reports allocation/upload/draw failures without throwing. Keep Three's
    // internal render stacks balanced, then reject the whole frame after render.
    for (const name of ["bufferData", "bufferSubData", "drawArrays", "drawElements"]) {
      const original = gl[name];
      const checked = (...args) => {
        if (!this.inFrame) return original.apply(gl, args);
        try {
          const result = original.apply(gl, args);
          if (gl.getError() !== gl.NO_ERROR) this.gpuError ??= new Error(`Unable to submit graphics operation ${name}.`);
          if (!this.gpuError && name === "drawArrays" && args[0] === gl.POINTS
            && this.drawingObject === this.asteroids && args[1] === 0
            && args[2] === this.asteroids.geometry.drawRange.count && args[2] > 0) {
            this.drawnAsteroids = this.asteroids;
          }
          return result;
        } catch (error) { this.gpuError ??= error; }
      };
      gl[name] = checked;
      this.glMethods.push({ name, original, checked });
    }
    const draw = this.renderer.renderBufferDirect;
    this.renderer.renderBufferDirect = (...args) => {
      this.drawingObject = args[4];
      try { return draw.apply(this.renderer, args); }
      finally { this.drawingObject = null; }
    };
  }

  createCloud(model, frame, committedCount = model.count) {
    const cloud = new Asteroids(model, { jed: frame.jed, elapsed: frame.elapsed ?? 0, committedCount,
      populationPreset: this.populationPreset, colorize: this.colorizeGroups });
    for (const attribute of Object.values(cloud.geometry.attributes)) {
      attribute.onUpload(() => {
        const gl = this.renderer.getContext();
        const bytes = gl.getBufferParameter(gl.ARRAY_BUFFER, gl.BUFFER_SIZE);
        if (bytes !== attribute.array.byteLength || gl.getError() !== gl.NO_ERROR) {
          this.gpuError ??= new Error("Unable to upload asteroid buffers.");
        }
        if (!this.gpuError) cloud.uploadedVersions.set(attribute, attribute.version);
      });
    }
    return cloud;
  }

  validatePlanets(data, { jed }) {
    disposePlanets(preparePlanets(data, jed));
  }

  setOptions({ shared } = {}) {
    const mode = shared?.planetLabels;
    const orbits = shared?.planetOrbits;
    const population = shared?.populationPreset;
    const colorize = shared?.colorizeGroups;
    if (mode !== undefined && !isPlanetLabelMode(mode)) throw new RangeError("Invalid planet label mode.");
    if (orbits !== undefined && !isPlanetOrbitVisibility(orbits)) {
      throw new RangeError("Invalid planet orbit visibility.");
    }
    if (population !== undefined && !isPopulationPreset(population)) {
      throw new RangeError("Invalid population preset.");
    }
    if (colorize !== undefined && typeof colorize !== "boolean") {
      throw new RangeError("Invalid group colorize.");
    }
    let changed = false;
    if (mode !== undefined && mode !== this.planetLabelMode) {
      this.planetLabelMode = mode;
      this.planetLabels.setMode(this.planets, mode);
      changed = true;
    }
    if (orbits !== undefined && orbits !== this.planetOrbitsVisible) {
      this.planetOrbitsVisible = orbits;
      for (const orbit of this.planetOrbits) orbit.visible = orbits;
      changed = true;
    }
    if (population !== undefined && population !== this.populationPreset) {
      this.populationPreset = population;
      this.asteroids?.setPopulationPreset(population);
      this.stagedAsteroids?.setPopulationPreset(population);
      this.catalogueTransition?.previous?.setPopulationPreset(population);
      changed = true;
    }
    if (colorize !== undefined && colorize !== this.colorizeGroups) {
      this.colorizeGroups = colorize;
      this.asteroids?.setColorize(colorize);
      this.stagedAsteroids?.setColorize(colorize);
      this.catalogueTransition?.previous?.setColorize(colorize);
      changed = true;
    }
    if (changed) this.requestRender();
  }

  get viewAnimating() { return !!this.viewFit; }

  cancelViewFit() { this.viewFit = null; }

  onControlsChange = () => {
    if (!this.viewFitInternal) this.cancelViewFit();
    this.requestRender();
  };

  ensurePopulationView(preset, now = performance.now()) {
    this.cancelViewFit();
    if (this.destroyed || !this.camera || !this.controls) return false;
    const pose = threePresetTargetPose(preset, this.camera.position.toArray(), this.controls.target.toArray(),
      this.camera.fov, this.camera.aspect, this.camera.zoom);
    if (!pose) return false;
    this.viewFit = {
      fromPosition: this.camera.position.toArray(),
      fromTarget: this.controls.target.toArray(),
      toPosition: pose.position,
      toTarget: pose.target,
      start: now,
      duration: VIEW_FIT_MS,
    };
    return true;
  }

  advanceViewFit(now = performance.now()) {
    if (!this.viewFit || this.destroyed || !this.camera || !this.controls) return false;
    const { fromPosition, fromTarget, toPosition, toTarget, start, duration } = this.viewFit;
    const t = Math.min(1, duration > 0 ? (now - start) / duration : 1);
    const k = easeOutCubic(t);
    this.viewFitInternal = true;
    this.camera.position.fromArray(lerp3(fromPosition, toPosition, k));
    this.controls.target.fromArray(lerp3(fromTarget, toTarget, k));
    this.controls.update();
    this.viewFitInternal = false;
    if (t >= 1) this.viewFit = null;
    return true;
  }

  addPlanets(data, { jed }) {
    if (this.destroyed) return;
    const batch = preparePlanets(data, jed);
    for (const { planet, orbit } of batch) {
      orbit.visible = this.planetOrbitsVisible;
      this.planets.push(planet);
      this.planetOrbits.push(orbit);
      this.scene.add(orbit, planet.body);
    }
    this.planetLabels.setMode(this.planets, this.planetLabelMode);
    this.requestRender();
  }

  setAsteroids(model, frame, { preservePrevious = false } = {}) {
    if (this.destroyed) return 0;
    const cloud = this.createCloud(model, frame);
    this.discardStagedCatalogue();
    this.installAsteroids(cloud, preservePrevious);
    return cloud.geometry.drawRange.count;
  }

  installAsteroids(cloud, preservePrevious = false) {
    const previous = this.asteroids;
    this.scene.add(cloud);
    this.asteroids = cloud;
    if (preservePrevious) {
      this.catalogueTransition = { previous, visible: previous?.visible };
      if (previous) previous.visible = false;
    } else previous?.destroy();
  }

  syncCatalogue(model, frame, { required, activate }) {
    if (this.destroyed) return 0;
    let cloud = this.asteroids?.catalogue === model ? this.asteroids : this.stagedAsteroids;
    if (cloud?.catalogue !== model) {
      this.stagedAsteroids?.destroy();
      cloud = this.stagedAsteroids = this.createCloud(model, frame, 0);
    }
    cloud.append(cloud.committedCount + 8192);
    if (cloud !== this.asteroids && activate && cloud.committedCount >= required) {
      cloud.update(frame.jed, frame.elapsed, { baseline: true });
      this.installAsteroids(cloud, true);
      this.stagedAsteroids = null;
    }
    return cloud === this.asteroids ? cloud.committedCount : -1;
  }

  needsCatalogPacking(model) {
    const cloud = this.asteroids?.catalogue === model ? this.asteroids : this.stagedAsteroids;
    return !!model && (cloud?.committedCount ?? 0) < model.count;
  }

  catalogueProgress(model) {
    const cloud = this.asteroids?.catalogue === model ? this.asteroids : this.stagedAsteroids;
    return cloud?.catalogue === model ? cloud.committedCount : 0;
  }

  discardStagedCatalogue() {
    this.rollbackCatalogue();
    this.stagedAsteroids?.destroy();
    this.stagedAsteroids = null;
  }
  commitCatalogue() {
    this.catalogueTransition?.previous?.destroy();
    this.catalogueTransition = null;
  }
  rollbackCatalogue({ retain = false } = {}) {
    if (!this.catalogueTransition) return;
    if (retain) {
      this.asteroids.removeFromParent();
      this.stagedAsteroids = this.asteroids;
    } else this.asteroids.destroy();
    const { previous, visible } = this.catalogueTransition;
    this.asteroids = previous;
    if (previous) previous.visible = visible;
    this.catalogueTransition = null;
  }

  update({ jed, elapsed }, options) {
    this.advanceViewFit();
    const count = this.asteroids?.update(jed, elapsed, options) ?? 0;
    for (const planet of this.planets) planet.render(jed);
    return count;
  }
  get frameState() {
    const cloud = this.asteroids;
    return cloud ? { jed: cloud.epoch + cloud.uniforms.orbitTime.value,
      elapsed: cloud.elapsed, count: cloud.geometry.drawRange.count, visibleCount: cloud.visibleCount } : null;
  }
  captureFrame(frame, options) {
    this.frameSnapshot = this.asteroids
      && { cloud: this.asteroids, state: this.asteroids.captureFrame(frame.jed, frame.elapsed, options) };
  }
  restoreFrame({ jed }) {
    if (this.frameSnapshot && this.frameSnapshot.cloud === this.asteroids) this.asteroids.restoreFrame(this.frameSnapshot.state);
    for (const planet of this.planets) planet.render(jed);
    this.frameSnapshot = null;
  }
  commitFrame() { this.frameSnapshot = null; }

  // A mode restoration is not a discovery. End transient arrivals without
  // changing the constructor/update semantics used for initial and new data.
  restoreDiscoveries() {
    const cloud = this.asteroids;
    if (!cloud) return;
    const arrival = cloud.geometry.attributes.arrival;
    arrival.array.fill(-1, 0, cloud.committedCount);
    if (cloud.committedCount) {
      arrival.addUpdateRange(0, cloud.committedCount);
      arrival.needsUpdate = true;
    }
  }

  render() {
    if (this.destroyed || this.contextLost) return null;
    const gl = this.renderer.getContext();
    if (gl.isContextLost()) return null;
    this.drawnAsteroids = null;
    this.gpuError = gl.getError() === gl.NO_ERROR ? null : new Error("Unable to render the visualization.");
    this.inFrame = true;
    try { this.renderer.render(this.scene, this.camera); }
    finally { this.inFrame = false; }
    if (this.contextLost || gl.isContextLost()) return null;
    if (this.gpuError) {
      this.releaseSceneResources();
      throw this.gpuError;
    }
    if (this.asteroids?.geometry.drawRange.count && this.drawnAsteroids !== this.asteroids) return null;
    this.placePlanetLabels();
    return this.asteroids?.acknowledgeDraw() ?? (this.asteroids ? null : 0);
  }

  placePlanetLabels() {
    const { width, height } = this.viewport;
    this.planetLabels.forEach((planet, label) => {
      const position = this.planetLabelPosition.copy(planet.body.position).project(this.camera);
      label.place((position.x + 1) * width / 2, (1 - position.y) * height / 2,
        { width, height, visible: position.z >= -1 && position.z <= 1 });
    });
  }

  resize(viewport) {
    if (this.destroyed || !this.initialized) return;
    this.viewport = viewport;
    const { width, height, pixelRatio } = viewport;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    // Three's setPixelRatio floors both axes. Fractional displays need the same
    // rounded backing store Pixi uses, which one ratio cannot floor onto.
    const physicalWidth = Math.max(1, Math.round(width * pixelRatio));
    const physicalHeight = Math.max(1, Math.round(height * pixelRatio));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(physicalWidth, physicalHeight, false);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
  }

  captureView() {
    this.advanceViewFit(Number.POSITIVE_INFINITY);
    return { position: this.camera.position.toArray(), up: this.camera.up.toArray(),
      quaternion: this.camera.quaternion.toArray(), zoom: this.camera.zoom,
      target: this.controls.target.toArray() };
  }

  restoreView(view) {
    this.cancelViewFit();
    if (!view) return;
    this.camera.position.fromArray(view.position);
    this.camera.up.fromArray(view.up);
    this.camera.zoom = view.zoom;
    this.controls.target.fromArray(view.target);
    this.controls.update();
    this.camera.quaternion.fromArray(view.quaternion);
    this.camera.updateProjectionMatrix();
  }

  releaseSceneResources() {
    this.scene?.traverse(object => {
      object.geometry?.dispose();
      object.material?.dispose();
    });
    for (const cloud of new Set([this.asteroids, this.stagedAsteroids, this.catalogueTransition?.previous])) {
      cloud?.invalidateGraphics();
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.viewFit = null;
    this.frameSnapshot = null;
    this.canvas?.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas?.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.controls?.removeEventListener("change", this.onControlsChange);
    this.controls?.dispose();
    this.planetLabels.destroy();
    this.releaseSceneResources();
    for (const cloud of new Set([this.asteroids, this.stagedAsteroids, this.catalogueTransition?.previous])) cloud?.destroy();
    if (this.renderer) {
      const gl = this.renderer.getContext();
      for (const { name, original, checked } of this.glMethods ?? []) if (gl[name] === checked) gl[name] = original;
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    this.canvas?.remove();
    this.scene?.clear();
    this.planets = [];
    this.planetOrbits = [];
    this.asteroids = this.stagedAsteroids = this.catalogueTransition = null;
    this.initialized = false;
  }
}
