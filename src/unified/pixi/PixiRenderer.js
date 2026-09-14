import { Application, ParticleContainer, Graphics } from "pixi.js";
import Controls from "./Controls.js";
import Planet from "./Planet.js";
import Asteroids from "./Asteroids.js";

// Pixi owns graphics and input. Frame time, scheduling, data requests and UI
// belong to App. The current viewport is read again after async GPU setup.
export default class PixiRenderer {
  constructor({ container, invalidate, reportGraphicsState, getViewport }) {
    this.container = container;
    this.getViewport = getViewport;
    this.requestRender = invalidate;
    this.reportGraphicsState = reportGraphicsState;
    this.destroyed = false;
    this.initialized = false;
    this.contextLost = false;
    this.onContextLost = event => {
      event.preventDefault();
      this.contextLost = true;
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
    this.asteroids = null;

    // Create texture
    // TODO: create a custom texture for asteroids of 1px size?
    this.circleTexture = this.createCircleTexture();

    // Add sun
    this.addSun();

    // Planets keep the existing CPU orbit path and particle rendering.
    this.planetContainer = new ParticleContainer({ texture: this.circleTexture });
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
    this.planetContainer.update();
    this.asteroids?.setTexture(this.circleTexture);
    previous.destroy(true);
  }

  get texturePixelRatio() { return Math.max(1, Math.ceil(this.app.renderer.resolution)); }

  addSun() {
    const sun = new Graphics();
    sun.circle(0, 0, 5).fill({ color: 0xfff2ac });
    this.stage.addChild(sun);
  }

  addPlanets(planets, { jed }) {
    if (this.destroyed) return;
    planets.forEach((data) => {
      const planet = new Planet(data.ephemeris, this.circleTexture, {
        name: data.name,
        size: data.size,
        color: data.color,
      });

      // Draw orbit
      const orbit = planet.orbit.drawOrbit(jed);
      this.stage.addChild(orbit);

      // Add planet
      this.planets.push(planet);
      this.planetContainer.addParticle(planet.body);
      planet.render(jed);
    });
    this.requestRender();
  }

  setAsteroids(data, { jed, elapsed }) {
    if (this.destroyed) return 0;
    // Prepare/allocate completely before replacing the usable scene. Retained
    // neutral catalogue ownership and incremental uploads arrive in PR3.
    const next = new Asteroids(data, this.circleTexture, jed, elapsed,
      this.app.renderer.context.webGLVersion === 2);
    const previous = this.asteroids;
    this.stage.addChildAt(next, previous ? this.stage.getChildIndex(previous) : 2);
    this.asteroids = next;
    previous?.destroy();
    return next.geometry.instanceCount;
  }

  update({ jed, elapsed }) {
    if (this.app.renderer.resolution !== this.viewport.pixelRatio) this.resize(this.viewport);
    if (this.circleTexture.source.resolution !== this.texturePixelRatio) this.refreshCircleTexture();
    const count = this.asteroids?.update(jed, elapsed) ?? 0;
    for (const planet of this.planets) planet.render(jed);
    return count;
  }

  render() { this.app.render(); }

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

  releaseApplication() {
    // Application.init can reject before assigning a renderer. Destroy the
    // stage in that case; Application.destroy itself assumes a renderer exists.
    if (this.app?.renderer) this.app.destroy(true, { children: true });
    else if (this.app?.stage) { this.app.stage.destroy({ children: true }); this.app.stage = null; }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.canvas?.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas?.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.controls?.destroy();
    this.asteroids?.destroy();
    this.circleTexture?.destroy(true);
    // A pending async init cleans itself as soon as Pixi finishes.
    if (this.initialized) this.releaseApplication();
    this.initialized = false;
  }
}
