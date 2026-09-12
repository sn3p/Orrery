import { Application, ParticleContainer, Graphics } from "pixi.js";
import { toJED, fromJED } from "./utils";
import Controls from "./Controls.js";
import Stats from "./Stats.js";
import Gui from "./Gui.js";
import Planet from "./Planet.js";
import Asteroids from "./Asteroids.js";
import PlaybackClock from "./PlaybackClock.js";
import { validDate } from "./asteroidOrbits.js";

export default class Orrery {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.startDate = options.startDate ?? new Date(1980, 1);
    this.jedDelta = options.jedDelta ?? 1.5;
    this.jed = toJED(this.startDate);
    if (!validDate(this.jed) || !Number.isFinite(this.jedDelta)) throw new Error("Invalid initial playback time.");
    this.clock = new PlaybackClock();
    this.elapsed = 0;
    this.loadVersion = 0;
    this.destroyed = false;
    this.contextLost = false;
    // Tests and benchmarks can own a finite scheduler explicitly.
    this.autoRender = options.autoRender ?? true;
    this.animationFrame = null;
    this.initialized = false;
    this.tick = this.tick.bind(this);
    this.render = this.render.bind(this);
    this.resize = this.resize.bind(this);
    this.onVisibilityChange = () => {
      this.clock.reset();
      if (document.hidden) this.cancelRender();
      else this.requestRender();
    };
    this.onContextLost = event => {
      event.preventDefault();
      this.contextLost = true;
      this.cancelRender();
      this.clock.reset();
    };
    this.onContextRestored = () => {
      if (this.destroyed) return;
      // Render textures contain GPU-only pixels. Pixi restores buffers/programs,
      // but the generated circle must be drawn again after every context loss.
      const previous = this.circleTexture;
      this.circleTexture = this.createCircleTexture();
      for (const planet of this.planets) planet.body.texture = this.circleTexture;
      this.planetContainer.texture = this.circleTexture;
      this.planetContainer.update();
      this.asteroids?.setTexture(this.circleTexture);
      previous.destroy(true);
      this.contextLost = false;
      this.clock.reset();
      this.requestRender();
    };
  }

  async init() {
    // Create PIXI application
    this.app = new Application();
    await this.app.init({
      // Pixi registers app.render separately from tick. Its automatic ticker
      // must stay stopped: Orrery's RAF is the sole automatic frame owner.
      autoStart: false,
      sharedTicker: false,
      preference: "webgl",
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: 0x000000,
      antialias: true,
    });

    this.stage = this.app.stage;
    this.canvas = this.app.canvas;

    // Add canvas to container
    this.container.appendChild(this.canvas);

    // Center the stage
    this.viewWidth = window.innerWidth;
    this.viewHeight = window.innerHeight;
    this.stage.position.set(this.viewWidth / 2, this.viewHeight / 2);

    // Setup GUI and controls
    this.setupGui();
    this.controls = new Controls(this);

    // Create star system
    this.createSystem();

    // Retain explicit ticker.update() support for deterministic GPU tests.
    this.app.ticker.add(this.tick);
    window.addEventListener("resize", this.resize);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    this.canvas.addEventListener("webglcontextlost", this.onContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.onContextRestored);
    this.initialized = true;
    this.updateGui();
    this.requestRender();
  }

  createSystem() {
    this.planets = [];
    this.asteroids = null;
    this.asteroidsDiscovered = 0;

    // Create texture
    // TODO: create a custom texture for asteroids of 1px size?
    this.circleTexture = this.createCircleTexture();

    // Add sun
    this.addSun();

    // Planets keep the existing CPU orbit path and particle rendering.
    this.planetContainer = new ParticleContainer({ texture: this.circleTexture });
    this.stage.addChild(this.planetContainer);
  }

  setupGui() {
    this.gui = {};
    this.gui.date = document.getElementById("orrery-date");
    this.stats = new Stats();
    this.gui.fps = document.getElementById("orrery-fps");
    this.gui.count = document.getElementById("orrery-count");
    this.gui.controls = new Gui(this);
  }

  updateGui() {
    // Update the date
    const date = fromJED(this.jed).toISOString().slice(0, 10);
    this.gui.date.textContent = date;
    this.gui.fps.textContent = `${this.stats.fps} FPS`;
    this.gui.count.textContent = this.asteroidsDiscovered;
  }

  createCircleTexture(radius = 5) {
    const gfx = new Graphics();
    gfx.circle(0, 0, radius).fill({ color: 0xffffff });
    const texture = this.app.renderer.generateTexture(gfx);
    gfx.destroy();
    return texture;
  }

  addSun() {
    const sun = new Graphics();
    sun.circle(0, 0, 5).fill({ color: 0xfff2ac });
    this.stage.addChild(sun);
  }

  addPlanets(planets) {
    planets.forEach((data) => {
      const planet = new Planet(data.ephemeris, this.circleTexture, {
        name: data.name,
        size: data.size,
        color: data.color,
      });

      // Draw orbit
      const orbit = planet.orbit.drawOrbit(this.jed);
      this.stage.addChild(orbit);

      // Add planet
      this.planets.push(planet);
      this.planetContainer.addParticle(planet.body);
      planet.render(this.jed);
    });
  }

  setAsteroids(data) {
    // Validate/allocate before touching the current catalogue or pending load.
    const next = new Asteroids(data, this.circleTexture, this.jed, this.elapsed, this.app.renderer.context.webGLVersion === 2);
    const previous = this.asteroids;
    this.loadVersion++;
    this.loadController?.abort();
    this.asteroids = next;
    this.asteroidsDiscovered = next.geometry.instanceCount;
    this.stage.addChildAt(next, previous ? this.stage.getChildIndex(previous) : 2);
    previous?.destroy();
    this.setStatus("");
    this.updateGui();
  }

  async loadAsteroids(url) {
    this.loadController?.abort();
    const controller = this.loadController = new AbortController();
    const version = ++this.loadVersion;
    this.setStatus("Loading asteroids…");
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Catalogue request failed (${response.status}).`);
      const data = await response.json();
      if (this.destroyed || version !== this.loadVersion) return false;
      this.setAsteroids(data);
      return true;
    } catch (error) {
      if (this.destroyed || version !== this.loadVersion || controller.signal.aborted) return false;
      this.setStatus("Unable to load asteroids. Reload to try again.");
      return false;
    }
  }

  setStatus(message) {
    const status = document.getElementById("orrery-status");
    if (status) status.textContent = message;
  }

  requestRender() {
    if (!this.autoRender || !this.initialized || this.destroyed || document.hidden || this.contextLost || this.animationFrame !== null) return;
    this.animationFrame = requestAnimationFrame(this.render);
  }

  cancelRender() {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  }

  render(timestamp = performance.now()) {
    // An explicit render also consumes any previously requested frame.
    this.cancelRender();
    if (this.destroyed || !this.initialized) return;
    if (document.hidden || this.contextLost) { this.clock.reset(); return; }
    this.tick(timestamp);
    this.app.render();
    this.requestRender();
  }

  tick(ticker = performance.now()) {
    if (this.destroyed) return;
    if (document.hidden || this.contextLost) { this.clock.reset(); return; }
    // Moving a window between screens can change DPR without changing its size.
    if (this.app.renderer.resolution !== (window.devicePixelRatio || 1)) this.resize();
    this.stats.begin();
    // Pixi updates lastTime *after* invoking listeners; elapsedMS is raw,
    // unlike its capped/scaled deltaMS. Reconstruct this callback's timestamp.
    const timestamp = typeof ticker === "number" ? ticker : ticker.lastTime + (ticker.elapsedMS ?? 0);
    const advance = this.clock.advance(timestamp, this.jedDelta);
    if (validDate(this.jed + advance)) this.jed += advance;
    this.elapsed += this.clock.seconds;
    this.asteroidsDiscovered = this.asteroids?.update(this.jed, this.elapsed) ?? 0;
    for (const planet of this.planets) planet.render(this.jed);
    this.updateGui();
    this.stats.end();
  }

  resize() {
    const width = window.innerWidth, height = window.innerHeight;
    this.app.renderer.resize(width, height, window.devicePixelRatio || 1);
    this.stage.position.x += (width - this.viewWidth) / 2;
    this.stage.position.y += (height - this.viewHeight) / 2;
    this.viewWidth = width;
    this.viewHeight = height;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelRender();
    this.loadVersion++;
    this.loadController?.abort();
    window.removeEventListener("resize", this.resize);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.canvas.removeEventListener("webglcontextlost", this.onContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.onContextRestored);
    this.app.ticker.remove(this.tick);
    this.controls.destroy();
    this.gui.controls.destroy();
    this.asteroids?.destroy();
    this.circleTexture.destroy(true);
    this.app.destroy(true, { children: true });
  }
}
