import { toJED } from "../js/utils.js";
import { validDate } from "../js/asteroidOrbits.js";
import PlaybackClock from "../js/PlaybackClock.js";
import Stats from "../js/Stats.js";
import Hud from "./ui/Hud.js";

const createPixi = options => import(/* webpackChunkName: "pixi" */ "./pixi/PixiRenderer.js")
  .then(({ default: PixiRenderer }) => new PixiRenderer(options));

export default class App {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.startDate = options.startDate ?? new Date(1980, 1);
    this._jed = toJED(this.startDate);
    this._jedDelta = options.jedDelta ?? 1.5;
    if (!validDate(this.jed) || !Number.isFinite(this.jedDelta)) throw new Error("Invalid initial playback time.");
    this.autoRender = options.autoRender ?? true;
    this.fixedResolution = options.resolution;
    if (this.fixedResolution !== undefined && (this.autoRender || !Number.isFinite(this.fixedResolution) || this.fixedResolution <= 0)) {
      throw new Error("Fixed resolution requires manual rendering and a positive finite value.");
    }
    this.createRenderer = options.createRenderer ?? createPixi;
    this._pixelRatio = "1";
    this.clock = new PlaybackClock();
    this.elapsed = 0;
    this.asteroidsDiscovered = 0;
    this.loadVersion = 0;
    this.destroyed = false;
    this.initialized = false;
    this.contextLost = false;
    this.animationFrame = null;
    this.tick = this.tick.bind(this);
    this.render = this.render.bind(this);
    this.resize = this.resize.bind(this);
    this.onResolutionChange = () => this.resize();
    this.onVisibilityChange = () => {
      this.resetClock();
      if (document.hidden) this.cancelRender();
      else this.requestRender();
    };
    this.onGraphicsState = (lost, error) => {
      if (this.destroyed) return;
      this.contextLost = lost;
      this.resetClock();
      if (lost) this.cancelRender();
      else this.requestRender();
      if (error) this.graphicsError = "Unable to restore the visualization. Reload to try again.";
      else if (!lost) this.graphicsError = "";
      this.renderStatus();
    };
  }

  get jed() { return this._jed; }
  set jed(value) {
    if (this.destroyed || Object.is(value, this._jed)) return;
    if (!validDate(value)) throw new Error("Invalid playback date.");
    this._jed = value;
    this.requestRender();
  }
  get jedDelta() { return this._jedDelta; }
  set jedDelta(value) {
    if (this.destroyed || Object.is(value, this._jedDelta)) return;
    if (!Number.isFinite(value)) throw new Error("Invalid playback speed.");
    const wasPlaying = this.isPlaying;
    this._jedDelta = value;
    if (!wasPlaying || !this.isPlaying) this.resetClock();
    this.requestRender();
  }
  get isPlaying() { return this.jedDelta !== 0; }
  get pixelRatio() { return this._pixelRatio; }
  set pixelRatio(value) {
    if (this.destroyed || !["1", "2"].includes(value) || value === this._pixelRatio) return;
    this._pixelRatio = value;
    this.resize();
  }
  get effectivePixelRatio() {
    const native = window.devicePixelRatio || 1;
    return this.fixedResolution ?? (native >= 2 ? Number(this.pixelRatio) : Math.min(native, 1));
  }
  get frameState() { return { jed: this.jed, elapsed: this.elapsed }; }
  get viewport() { return { width: innerWidth, height: innerHeight, pixelRatio: this.effectivePixelRatio }; }

  init() {
    if (this.destroyed) return Promise.resolve();
    this.initialization ??= this.initialize();
    return this.initialization;
  }

  async initialize() {
    try {
      const renderer = this.createRenderer({ container: this.container,
        invalidate: () => this.requestRender(), reportGraphicsState: this.onGraphicsState,
        getViewport: () => this.viewport });
      this.renderer = renderer instanceof Promise ? await renderer : renderer;
      if (this.destroyed) { this.renderer.destroy(); return; }
      await this.renderer.init();
      if (this.destroyed) return;
      this.setupGui();
      this.initialized = true;
      this.resize({ render: false });
      window.addEventListener("resize", this.resize);
      document.addEventListener("visibilitychange", this.onVisibilityChange);
      this.updateGui();
      this.requestRender();
    } catch (error) {
      const disposed = this.destroyed;
      this.destroy();
      if (!disposed) this.setStatus("Unable to start the visualization. Please reload to try again.");
      throw error;
    }
  }

  addPlanets(planets) {
    if (!this.initialized || this.destroyed) return;
    this.renderer.addPlanets(planets, this.frameState);
  }

  setAsteroids(data) {
    if (!this.initialized || this.destroyed) return;
    const count = this.renderer.setAsteroids(data, this.frameState);
    this.loadVersion++;
    this.loadController?.abort();
    this.asteroidsDiscovered = count;
    this.setStatus("");
    this.updateGui();
    this.requestRender();
  }

  async loadAsteroids(url) {
    if (this.destroyed) return false;
    this.loadController?.abort();
    const controller = this.loadController = new AbortController();
    const version = ++this.loadVersion;
    this.setStatus("Loading asteroids…");
    try {
      // Explicit callers may start a load during renderer initialization.
      await this.init();
      if (this.destroyed || version !== this.loadVersion) return false;
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

  setupGui() {
    this.stats = new Stats();
    this.gui = new Hud(this);
  }

  setStatus(message) {
    this.statusMessage = message;
    this.renderStatus();
  }
  renderStatus() {
    const status = document.getElementById("orrery-status");
    if (status) status.textContent = this.graphicsError || this.statusMessage || "";
  }
  updateGui() { this.gui?.update(this.jed, this.stats.fps, this.asteroidsDiscovered); }
  resetClock() {
    this.clock.reset();
    this.stats?.reset();
    if (this.initialized && !this.destroyed) this.updateGui();
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
    this.cancelRender();
    this.renderFrame(timestamp);
    if (this.isPlaying) this.requestRender();
  }
  renderFrame(timestamp = performance.now(), { beforeRender, afterRender } = {}) {
    if (this.destroyed || !this.initialized) return;
    if (document.hidden || this.contextLost) { this.resetClock(); return; }
    this.tick(timestamp);
    beforeRender?.();
    this.renderer.render();
    afterRender?.();
  }
  tick(timestamp = performance.now()) {
    if (this.destroyed || !this.initialized) return;
    if (document.hidden || this.contextLost) { this.resetClock(); return; }
    if (this.appliedPixelRatio !== this.effectivePixelRatio || this.nativePixelRatio !== (window.devicePixelRatio || 1)) this.resize({ render: false });
    const advance = this.clock.advance(timestamp, this.jedDelta);
    if (validDate(this.jed + advance)) this._jed += advance;
    this.elapsed += this.clock.seconds;
    this.asteroidsDiscovered = this.renderer.update(this.frameState);
    if (this.isPlaying) this.stats.update();
    else this.stats.reset();
    this.updateGui();
  }
  watchResolution() {
    this.resolutionQuery?.removeEventListener("change", this.onResolutionChange);
    this.nativePixelRatio = window.devicePixelRatio || 1;
    this.resolutionQuery = window.matchMedia(`(resolution: ${this.nativePixelRatio}dppx)`);
    this.resolutionQuery.addEventListener("change", this.onResolutionChange);
  }
  resize({ render = true } = {}) {
    if (this.destroyed || !this.initialized) return;
    this.renderer.resize(this.viewport);
    this.appliedPixelRatio = this.effectivePixelRatio;
    this.watchResolution();
    this.gui.controls.updatePixelRatio();
    if (render) this.requestRender();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.cancelRender();
    this.loadVersion++;
    this.loadController?.abort();
    this.graphicsError = "";
    this.setStatus("");
    window.removeEventListener("resize", this.resize);
    this.resolutionQuery?.removeEventListener("change", this.onResolutionChange);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.gui?.destroy();
    this.renderer?.destroy();
    this.initialized = false;
  }
}
