import { Application, ParticleContainer, ParticleShader, Graphics, Texture } from "pixi.js";
import Controls from "./Controls.js";
import Planet from "./Planet.js";
import Asteroids from "./Asteroids.js";
import { DEFAULT_PLANET_LABEL_MODE, isPlanetLabelMode, PlanetLabels } from "../PlanetLabel.js";
import { DEFAULT_PLANET_ORBITS_VISIBLE, isPlanetOrbitVisibility } from "../PlanetOrbitPreference.js";

function disposePlanets(batch) {
  for (const { orbit } of batch) orbit?.destroy();
}

function preparePlanets(data, jed, texture) {
  const batch = [];
  try {
    for (const item of data) {
      const planet = new Planet(item.ephemeris, texture, { name: item.name, size: item.size, color: item.color });
      const entry = { planet };
      batch.push(entry);
      entry.orbit = planet.orbit.drawOrbit(jed);
      planet.render(jed);
    }
    return batch;
  } catch (error) { disposePlanets(batch); throw error; }
}

// Pixi owns graphics and input. Frame time, scheduling, data requests and UI
// belong to App. The current viewport is read again after async GPU setup.
export default class PixiRenderer {
  constructor({ container, invalidate, reportGraphicsState, getViewport }) {
    this.container = container;
    this.getViewport = getViewport;
    this.requestRender = invalidate;
    this.reportGraphicsState = reportGraphicsState;
    this.planets = [];
    this.planetOrbits = [];
    this.planetLabelMode = DEFAULT_PLANET_LABEL_MODE;
    this.planetOrbitsVisible = DEFAULT_PLANET_ORBITS_VISIBLE;
    this.planetLabels = new PlanetLabels(container);
    this.destroyed = false;
    this.initialized = false;
    this.contextLost = false;
    this.onContextLost = event => {
      event.preventDefault();
      this.contextLost = true;
      this.planetLabels.hide();
      this.reportGraphicsState(true);
    };
    this.onContextRestored = () => {
      if (this.destroyed) return;
      try {
        this.resize(this.viewport);
        this.refreshCircleTexture();
        this.contextLost = false;
        this.reportGraphicsState(false);
      } catch (error) {
        this.reportGraphicsState(true, error);
      }
    };
  }

  init() {
    if (this.destroyed) return Promise.resolve();
    this.initialization ??= this.initialize();
    return this.initialization;
  }

  async initialize() {
    let viewport = this.getViewport();
    this.app = new Application();
    try {
      await this.app.init({ autoStart: false, sharedTicker: false,
        preference: "webgl", resolution: viewport.pixelRatio, autoDensity: true,
        width: viewport.width, height: viewport.height,
        backgroundColor: 0x000000, antialias: true });
      if (this.destroyed) { this.releaseApplication(); return; }
      viewport = this.getViewport();
      this.stage = this.app.stage;
      this.canvas = this.app.canvas;
      this.viewWidth = viewport.width;
      this.viewHeight = viewport.height;
      this.stage.position.set(this.viewWidth / 2, this.viewHeight / 2);
      this.initialized = true;
      // Pixi's onRender callback runs before renderability/culling checks.
      // Record this adapter's actual mesh submission instead, after encoding.
      const encoder = this.app.renderer.encoder, draw = encoder.draw;
      encoder.draw = options => {
        const result = draw.call(encoder, options);
        if (options.geometry === this.asteroids?.geometry && options.geometry.instanceCount > 0) {
          this.drawnAsteroids = this.asteroids;
        }
        return result;
      };
      const buffers = this.app.renderer.buffer, updateBuffer = buffers.updateBuffer;
      buffers.updateBuffer = buffer => {
        const renderer = this.app.renderer, gl = renderer.gl;
        const changed = buffer._gpuData[renderer.uid]?.updateID !== buffer._updateID;
        const asteroidUpload = changed && this.asteroids?.geometry.buffers.includes(buffer);
        if (asteroidUpload) {
          // Pixi's WebGL1 texture setup can leave INVALID_ENUM pending. Scope
          // upload errors to this buffer operation, retaining prior OOM errors.
          if (gl.getError() === gl.OUT_OF_MEMORY) throw new Error("Unable to upload asteroid buffers.");
        }
        try {
          const result = updateBuffer.call(buffers, buffer);
          if (asteroidUpload && gl.getError() !== gl.NO_ERROR) throw new Error("Unable to upload asteroid buffers.");
          return result;
        } catch (error) {
          if (asteroidUpload) {
            // Pixi records the version/capacity before the GL operation. A
            // failed allocation or partial update must force a full upload
            // into this same buffer, preserving its geometry/VAO bindings.
            const gpu = buffer._gpuData[renderer.uid];
            if (gpu) { gpu.updateID = -1; gpu.byteLength = 0; }
          }
          throw error;
        }
      };
      this.resize(viewport);
      this.container.appendChild(this.canvas);
      this.controls = new Controls(this);
      this.createSystem();
      this.canvas.addEventListener("webglcontextlost", this.onContextLost);
      this.canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    } catch (error) {
      this.destroy();
      this.releaseApplication();
      throw error;
    }
  }

  createSystem() {
    this.planets = [];
    this.planetOrbits = [];
    this.asteroids = null;

    // Create texture
    // TODO: create a custom texture for asteroids of 1px size?
    this.circleTexture = this.createCircleTexture();

    // Add sun
    this.addSun();

    // Planets keep the existing CPU orbit path and particle rendering.
    // Own the shader so texture replacement can unbind the old source before
    // disposal, even when the particle container does not draw that frame.
    this.planetContainer = new ParticleContainer({ texture: this.circleTexture, shader: new ParticleShader() });
    this.stage.addChild(this.planetContainer);
  }

  createCircleTexture(radius = 5) {
    const gfx = new Graphics();
    gfx.circle(0, 0, radius).fill({ color: 0xffffff });
    // Keep the reusable circle at an integer density. Fractional backing sizes
    // otherwise change its logical width (10px becomes 10.667px at DPR .75),
    // which changes planet sizes when their shared texture is rebound.
    const texture = this.app.renderer.generateTexture({ target: gfx, resolution: this.texturePixelRatio });
    gfx.destroy();
    return texture;
  }

  refreshCircleTexture() {
    const previous = this.circleTexture;
    this.circleTexture = this.createCircleTexture();
    for (const planet of this.planets) planet.body.texture = this.circleTexture;
    this.planetContainer.texture = this.circleTexture;
    this.planetContainer.shader.resources.uTexture = this.circleTexture.source;
    this.planetContainer.update();
    this.asteroids?.setTexture(this.circleTexture);
    this.stagedAsteroids?.setTexture(this.circleTexture);
    this.catalogueTransition?.previous?.setTexture(this.circleTexture);
    previous.destroy(true);
  }

  get texturePixelRatio() { return Math.max(1, Math.ceil(this.app.renderer.resolution)); }

  addSun() {
    const sun = new Graphics();
    sun.circle(0, 0, 5).fill({ color: 0xfff2ac });
    this.stage.addChild(sun);
  }

  // Detached validation remains usable after context disposal, without
  // importing another engine or retaining this renderer's texture/scene.
  validatePlanets(data, { jed }) {
    disposePlanets(preparePlanets(data, jed, Texture.WHITE));
  }

  setOptions({ shared } = {}) {
    const mode = shared?.planetLabels;
    const orbits = shared?.planetOrbits;
    if (mode !== undefined && !isPlanetLabelMode(mode)) throw new RangeError("Invalid planet label mode.");
    if (orbits !== undefined && !isPlanetOrbitVisibility(orbits)) {
      throw new RangeError("Invalid planet orbit visibility.");
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
    if (changed) this.requestRender();
  }

  addPlanets(data, { jed }) {
    if (this.destroyed) return;
    const batch = preparePlanets(data, jed, this.circleTexture);
    for (const { planet, orbit } of batch) {
      orbit.visible = this.planetOrbitsVisible;
      this.stage.addChild(orbit);
      this.planetOrbits.push(orbit);
      this.planets.push(planet);
      this.planetContainer.addParticle(planet.body);
    }
    this.planetLabels.setMode(this.planets, this.planetLabelMode);
    this.requestRender();
  }

  setAsteroids(data, { jed, elapsed }, { preservePrevious = false } = {}) {
    if (this.destroyed) return 0;
    // Prepare/allocate completely before replacing the usable scene.
    const next = new Asteroids(data, this.circleTexture, jed, elapsed,
      this.app.renderer.context.webGLVersion === 2);
    this.discardStagedCatalogue();
    this.installAsteroids(next, preservePrevious);
    return next.geometry.instanceCount;
  }

  installAsteroids(next, preservePrevious = false) {
    const previous = this.asteroids;
    this.stage.addChildAt(next, previous ? this.stage.getChildIndex(previous) : 2);
    this.asteroids = next;
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
      cloud = this.stagedAsteroids = new Asteroids(model, this.circleTexture, frame.jed, frame.elapsed,
        this.app.renderer.context.webGLVersion === 2, 0);
    }
    // Bound catch-up after late starts and graphics suspension as well as the
    // ordinary chunk path. Each continuation is a new application frame/task.
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
      this.stage.removeChild(this.asteroids);
      this.stagedAsteroids = this.asteroids;
    } else this.asteroids.destroy();
    const { previous, visible } = this.catalogueTransition;
    this.asteroids = previous;
    if (previous) previous.visible = visible;
    this.catalogueTransition = null;
  }

  update({ jed, elapsed }, options) {
    if (this.app.renderer.resolution !== this.viewport.pixelRatio) this.resize(this.viewport);
    if (this.circleTexture.source.resolution !== this.texturePixelRatio) this.refreshCircleTexture();
    const count = this.asteroids?.update(jed, elapsed, options) ?? 0;
    for (const planet of this.planets) planet.render(jed);
    return count;
  }

  get frameState() {
    const cloud = this.asteroids;
    return cloud ? { jed: cloud.epoch + cloud.uniforms.uOrbitTime,
      elapsed: cloud.elapsed, count: cloud.geometry.instanceCount } : null;
  }

  captureFrame(frame, options) {
    this.frameSnapshot = this.asteroids
      && { cloud: this.asteroids, state: this.asteroids.captureFrame(frame.jed, frame.elapsed, options) };
  }

  restoreFrame(frame) {
    if (this.frameSnapshot?.cloud === this.asteroids) this.asteroids.restoreFrame(this.frameSnapshot.state);
    for (const planet of this.planets) planet.render(frame.jed);
    this.frameSnapshot = null;
  }

  commitFrame() { this.frameSnapshot = null; }

  render() {
    this.drawnAsteroids = null;
    const renderer = this.app.renderer;
    if (this.asteroids?.visible && !renderer.gl.isContextLost()) {
      const program = renderer.shader._getProgramData(this.asteroids.shader.glProgram).program;
      // Validate once per actual GPU program, including context restoration.
      if (program !== this.checkedProgram) {
        if (!renderer.gl.getProgramParameter(program, renderer.gl.LINK_STATUS)) throw new Error("Unable to render asteroid shader.");
        this.checkedProgram = program;
      }
    }
    this.app.render();
    if (this.destroyed || this.contextLost || this.app.renderer.gl.isContextLost()) return null;
    if (this.asteroids?.geometry.instanceCount && this.drawnAsteroids !== this.asteroids) return null;
    this.placePlanetLabels();
    return this.asteroids?.acknowledgeDraw(this.app.renderer) ?? (this.asteroids ? null : 0);
  }

  placePlanetLabels() {
    const { a, b, c, d, tx, ty } = this.stage.worldTransform;
    this.planetLabels.forEach((planet, label) => {
      const { x, y } = planet.body;
      label.place(a * x + c * y + tx, b * x + d * y + ty, this.viewport);
    });
  }

  resize(viewport) {
    this.viewport = viewport;
    if (!this.initialized || this.destroyed) return;
    const { width, height, pixelRatio } = viewport;
    this.app.renderer.resize(width, height, pixelRatio);
    // Fractional physical rounding must not alter logical marker/view sizes.
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.stage.position.x += (width - this.viewWidth) / 2;
    this.stage.position.y += (height - this.viewHeight) / 2;
    this.viewWidth = width;
    this.viewHeight = height;
  }

  captureView() {
    return { x: this.stage.x - this.viewWidth / 2, y: this.stage.y - this.viewHeight / 2,
      scale: this.stage.scale.x };
  }

  restoreView(view) {
    if (!view) return;
    this.stage.position.set(this.viewWidth / 2 + view.x, this.viewHeight / 2 + view.y);
    this.stage.scale.set(view.scale);
  }

  // A mode restoration is not a discovery. End transient arrivals without
  // changing the constructor/update semantics used for initial and new data.
  restoreDiscoveries() {
    const cloud = this.asteroids;
    if (!cloud) return;
    cloud.geometry.getBuffer("aDiscovery").data.fill(-1);
    cloud.queueUpload("aDiscovery", 0, cloud.committedCount * 4);
  }

  releaseApplication() {
    // Application.init can reject before assigning a renderer. Destroy the
    // stage in that case; Application.destroy itself assumes a renderer exists.
    if (this.app?.renderer) this.app.destroy(true, { children: true });
    else if (this.app?.stage) { this.app.stage.destroy({ children: true }); this.app.stage = null; }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.frameSnapshot = null;
    this.canvas?.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas?.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.controls?.destroy();
    this.planetLabels.destroy();
    this.asteroids?.destroy();
    this.stagedAsteroids?.destroy();
    this.catalogueTransition?.previous?.destroy();
    // A pending async init cleans itself as soon as Pixi finishes.
    if (this.initialized) this.releaseApplication();
    // ParticleContainer destroys its shader; release every binding before the
    // shared texture source (also used by the asteroid shaders) is destroyed.
    this.circleTexture?.destroy(true);
    this.initialized = false;
  }
}
