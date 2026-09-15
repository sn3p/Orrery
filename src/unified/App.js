import { toJED } from "../js/utils.js";
import { validDate } from "../js/asteroidOrbits.js";
import PlaybackClock from "../js/PlaybackClock.js";
import Stats from "../js/Stats.js";
import Hud from "./ui/Hud.js";
import CatalogSource from "./catalog/CatalogSource.js";
import CatalogLoader from "./catalog/CatalogLoader.js";
import { allocateCatalogue, appendCatalogue, prepareCatalogue } from "./catalog/prepareCatalogue.js";
import { selectRenderer } from "./renderers.js";

export default class App {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.startDate = options.startDate ?? new Date(1980, 1);
    this._jed = options.startJed ?? toJED(this.startDate);
    this._jedDelta = options.jedDelta ?? 1.5;
    if (!validDate(this.jed) || !Number.isFinite(this.jedDelta)) throw new Error("Invalid initial playback time.");
    this.autoRender = options.autoRender ?? true;
    this.fixedResolution = options.resolution;
    if (this.fixedResolution !== undefined && (this.autoRender || !Number.isFinite(this.fixedResolution) || this.fixedResolution <= 0)) {
      throw new Error("Fixed resolution requires manual rendering and a positive finite value.");
    }
    const selection = selectRenderer(options.renderer);
    this.rendererId = selection.id;
    this.rendererNotice = selection.notice;
    this.createRenderer = options.createRenderer ?? selection.create;
    this._pixelRatio = "1";
    this.clock = new PlaybackClock();
    this.elapsed = 0;
    this.asteroidsDiscovered = 0;
    this.loadVersion = 0;
    this.rendererGeneration = 0;
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
      this.demandCatalog();
      if (document.hidden) this.cancelRender();
      else this.requestRender();
    };
    this.onGraphicsState = (lost, error) => {
      if (this.destroyed) return;
      this.contextLost = lost;
      this.rendererGeneration++;
      if (lost) {
        this.catalogLoader?.loseGraphics();
        if (this.activeSession?.loader !== this.catalogLoader) this.activeSession?.loader.loseGraphics();
      } else if (!error) {
        this.renderFailure = null;
        for (const session of new Set([this.pendingSession, this.activeSession])) {
          if (!session?.adapterFailure) continue;
          if (session.loader.error === session.adapterFailure) {
            session.loader.error = session.loader.errorKind = null;
          }
          session.adapterFailure = null;
        }
      }
      this.demandCatalog();
      this.resetClock();
      if (lost) this.cancelRender();
      else this.requestRender();
      if (error) this.graphicsError = "Unable to restore the visualization. Reload to try again.";
      else this.graphicsError = lost ? "Graphics connection lost. Waiting to reconnect…" : "";
      this.renderStatus();
    };
    this.onCatalogOnline = () => { this.catalogLoader?.retry(); };
  }

  get jed() { return this._jed; }
  set jed(value) {
    if (this.destroyed || Object.is(value, this.requestedJed ?? this._jed)) return;
    if (!validDate(value)) throw new Error("Invalid playback date.");
    if (this.catalogOpening || this.catalogLoader?.source) {
      this.requestedJed = value;
      this.resetClock();
      this.demandCatalog();
      this.onCatalogChange();
      return;
    }
    this.requestedJed = null;
    this._jed = value;
    this.requestRender();
  }
  get jedDelta() { return this._jedDelta; }
  set jedDelta(value) {
    if (this.destroyed || Object.is(value, this._jedDelta)) return;
    if (!Number.isFinite(value)) throw new Error("Invalid playback speed.");
    const wasPlaying = this.isPlaying;
    this._jedDelta = value;
    this.demandCatalog();
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
      window.addEventListener("online", this.onCatalogOnline);
      this.updateGui();
      this.requestRender();
    } catch (error) {
      const disposed = this.destroyed;
      this.destroy();
      if (!disposed) {
        this.rendererRecovery = this.rendererId === "three";
        this.setStatus(this.rendererRecovery
          ? "Unable to start the 3D visualization. Please reload to try again."
          : "Unable to start the visualization. Please reload to try again.", this.rendererRecovery);
      }
      throw error;
    }
  }

  addPlanets(planets) {
    if (!this.initialized || this.destroyed) return;
    this.renderer.addPlanets(planets, this.frameState);
  }

  setAsteroids(data) {
    if (!this.initialized || this.destroyed) return;
    const model = prepareCatalogue(data, this.jed);
    const previous = this.pendingBundled?.previous ?? this.renderer.frameState
      ?? { ...this.frameState, count: this.asteroidsDiscovered };
    this.renderer.setAsteroids(model, this.frameState, { preservePrevious: true });
    this.pendingBundled = { model, previous };
    this.catalogOpening?.abort();
    this.catalogOpening = null;
    this.catalogLoader?.dispose();
    this.activeSession?.loader.dispose();
    this.catalogLoader = this.activeSession = this.pendingSession = null;
    this.catalogFailure = null;
    if (this.renderFailure && !this.contextLost) {
      this.renderFailure = null;
      this.graphicsError = "";
    }
    this.requestedJed = null;
    this.loadVersion++;
    this.loadController?.abort();
    this.setStatus("");
    this.resetClock();
    // Keep synchronous attachment usable by manual callers, but publish it
    // only after the same receipt/rollback boundary as streamed catalogues.
    this.renderFrame();
    this.requestRender();
  }

  async loadAsteroids(url) {
    if (this.destroyed) return false;
    this.catalogOpening?.abort();
    this.catalogOpening = null;
    if (this.pendingSession && this.pendingSession !== this.activeSession) this.pendingSession.loader.dispose();
    this.pendingSession = null;
    this.renderer?.discardStagedCatalogue();
    this.pendingBundled = null;
    this.catalogLoader = this.activeSession?.loader ?? null;
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

  // A candidate owns a separate data generation. The previous complete scene
  // remains usable until the candidate has a complete requested CPU prefix.
  async loadCatalog(pin, { mode = "indexed", latest } = {}) {
    if (this.destroyed) return false;
    const version = ++this.loadVersion;
    this.loadController?.abort();
    this.catalogOpening?.abort();
    if (this.pendingSession && this.pendingSession !== this.activeSession) this.pendingSession.loader.dispose();
    const opening = this.catalogOpening = new AbortController();
    this.pendingSession = null;
    this.catalogLoader = this.activeSession?.loader ?? null;
    this.renderer?.discardStagedCatalogue();
    this.pendingBundled = null;
    this.catalogFailure = null;
    if (this.renderFailure && !this.contextLost) this.graphicsError = "";
    this.renderFailure = null;
    this.demandCatalog();
    this.resetClock();
    this.updateCatalogStatus();
    let candidate;
    try {
      await this.init();
      if (this.destroyed || version !== this.loadVersion) return false;
      if (latest !== undefined && mode !== "indexed") throw new Error("Whole-file mode unavailable in browser distribution.");
      const source = latest !== undefined
        ? await CatalogSource.openLatest(latest, { signal: opening.signal })
        : await CatalogSource.open(pin, { mode, signal: opening.signal });
      if (this.destroyed || version !== this.loadVersion) { source.close(); return false; }
      const session = candidate = { version, model: null, loader: null };
      const loader = session.loader = new CatalogLoader({
        activate: count => {
          const start = performance.now();
          session.model = allocateCatalogue(count);
          session.model.sourceId = source.sourceId;
          session.model.catalogId = source.info.catalog_id;
          performance.measure("catalog:allocate", { start });
        },
        commit: event => {
          const start = performance.now();
          appendCatalogue(session.model, event.records, event.start);
          performance.measure("catalog:prepare-commit", { start });
        },
        changed: () => { if ((version === this.loadVersion || this.activeSession === session) && !this.destroyed) this.onCatalogChange(); },
      });
      this.pendingSession = session;
      this.catalogLoader = loader;
      this.catalogOpening = null;
      loader.activate(source, this.requestedJed ?? this.jed);
      this.demandCatalog();
      this.onCatalogChange();
      return source;
    } catch (error) {
      if (this.destroyed || version !== this.loadVersion || opening.signal.aborted) return false;
      candidate?.loader.dispose();
      this.pendingSession = null;
      this.catalogLoader = this.activeSession?.loader ?? null;
      this.renderer?.discardStagedCatalogue();
      this.catalogOpening = null;
      this.catalogFailure = error;
      this.onCatalogChange();
      return false;
    }
  }

  get catalogWaiting() {
    return !!this.catalogOpening || !!(this.catalogLoader?.source
      && !this.catalogLoader.sceneComplete(this.requestedJed ?? this.catalogLoader.date));
  }
  demandCatalog(date = this.requestedJed ?? this.jed) {
    const hidden = document.hidden || this.contextLost || !!this.catalogOpening;
    return this.catalogLoader?.demand(date, { playing: this.isPlaying && !this.catalogOpening, hidden }) ?? !this.catalogOpening;
  }
  onCatalogChange() {
    if (this.catalogWaiting) this.resetClock();
    this.updateCatalogStatus();
    this.requestRender();
  }
  updateCatalogStatus() {
    const loader = this.catalogLoader;
    const failure = (this.catalogFailure && "Could not load the asteroid catalogue. Reload to try again.")
      || (loader?.errorKind === "commit" && "This asteroid catalogue cannot be prepared for this renderer.")
      || (loader?.error && loader.buffering && "Could not load more asteroids. Reload to try again.");
    this.setStatus(failure || (this.catalogOpening || (loader?.source && !loader.initialRendered)
      ? "Loading asteroids…" : loader?.buffering ? "Buffering asteroids…" : ""), !!failure);
  }

  syncCatalog(date) {
    const session = this.pendingSession ?? this.activeSession;
    if (!session || this.catalogOpening || session.adapterFailure) return false;
    try {
      const required = session.loader.source.countThrough(date);
      const ready = session.loader.readyToDraw(date);
      const start = this.renderer.needsCatalogPacking(session.model) ? performance.now() : null;
      const packed = this.renderer.syncCatalogue(session.model, { ...this.frameState, jed: date }, { required, activate: ready });
      if (start !== null) performance.measure("catalog:pack", { start });
      if (!ready || packed < required) return false;
      return true;
    } catch (error) {
      session.adapterFailure = error;
      session.loader.error = error;
      session.loader.errorKind = "commit";
      this.updateCatalogStatus();
      return false;
    }
  }

  setupGui() {
    this.stats = new Stats();
    this.gui = new Hud(this);
  }

  setStatus(message, error = false) {
    this.statusMessage = message;
    this.statusError = error;
    this.renderStatus();
  }
  renderStatus() {
    const status = document.getElementById("orrery-status");
    if (status) {
      status.textContent = this.graphicsError || this.statusMessage || this.rendererNotice || "";
      if (this.rendererRecovery) {
        const link = document.createElement("a"), url = new URL(location.href);
        url.searchParams.set("renderer", "pixi");
        link.href = url.href;
        link.textContent = "Open Pixi preview";
        status.append(" ", link);
      }
      status.setAttribute("role", (this.statusError && !this.graphicsError) || this.renderFailure ? "alert" : "status");
    }
  }
  updateGui() { this.gui?.update(this.jed, this.stats.fps, this.asteroidsDiscovered); }
  resetClock() {
    this.clock.reset();
    this.stats?.reset();
    if (this.initialized && !this.destroyed && !this.catalogLoader?.source
      && !this.pendingBundled && !this.deferReadouts) this.updateGui();
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
    const packing = this.catalogLoader && !this.catalogLoader.error
      && this.renderer.needsCatalogPacking?.((this.pendingSession ?? this.activeSession)?.model);
    if (!this.renderFailure && ((this.isPlaying && !this.catalogWaiting) || packing)) this.requestRender();
  }
  renderFrame(timestamp = performance.now(), { beforeRender, afterRender } = {}) {
    if (this.destroyed || !this.initialized) return;
    if (document.hidden || this.contextLost) { this.resetClock(); return; }
    // Direct tick/Pixi callers may leave a snapshot from an earlier update.
    // Rollback must use only state captured within this frame transaction.
    this.renderer.commitFrame?.();
    // A direct seek changes App.jed before its draw. The adapter still owns
    // the previous scene, including changes made through direct tick callers.
    const previous = this.pendingBundled?.previous ?? this.renderer.frameState
      ?? { jed: this.jed, elapsed: this.elapsed, count: this.asteroidsDiscovered };
    const requested = this.requestedJed ?? (this.jed !== previous.jed ? this.jed : null);
    const graphicsGeneration = this.rendererGeneration;
    let drawn = null, prepared = false, frameError;
    const fail = error => {
      frameError = error;
      this.renderFailure = error;
      this.graphicsError = "Unable to render the visualization. Reload to try again.";
      const failed = this.pendingSession ?? this.activeSession;
      if (failed) {
        failed.adapterFailure = error;
        failed.loader.error = error;
        failed.loader.errorKind = "commit";
      }
      this.catalogLoader?.loseGraphics();
      this.cancelRender();
      this.renderStatus();
    };
    try {
      // Invalidations after a terminal failure may repaint the restored scene,
      // but only explicit graphics/catalogue recovery can advance it again.
      this.deferReadouts = true;
      prepared = !this.renderFailure && this.tick(timestamp) === true;
      beforeRender?.();
      drawn = this.renderer.render();
    }
    catch (error) { fail(error); }
    finally { this.deferReadouts = false; }
    const session = this.pendingSession ?? this.activeSession;
    const sameCatalogue = session && this.renderer.asteroids?.catalogue === session.model;
    const committed = !this.renderFailure && !frameError && drawn !== null && graphicsGeneration === this.rendererGeneration
      && (!this.pendingBundled || this.renderer.asteroids?.catalogue === this.pendingBundled.model)
      && (!session || (prepared && !session.adapterFailure && sameCatalogue
        && drawn >= session.loader.source.countThrough(this.jed)));
    // Receipts cover the uploaded prefix; the HUD counts only discoveries at
    // this date, which may be much smaller than the retained catalogue.
    if (committed) this.asteroidsDiscovered = this.renderer.frameState?.count ?? 0;
    if (committed && this.pendingBundled) {
      this.renderer.commitCatalogue();
      this.catalogue = this.pendingBundled.model;
      this.pendingBundled = null;
    }
    if (committed && session) {
      if (session !== this.activeSession) {
        this.renderer.commitCatalogue();
        this.activeSession?.loader.dispose();
        this.activeSession = session;
        this.pendingSession = null;
        this.catalogue = session.model;
      }
      session.loader.rendered(drawn);
      if (session.loader.initialRendered && !session.firstDraw) {
        session.firstDraw = true;
        performance.mark("catalog:first-complete");
      }
      this.updateCatalogStatus();
    } else if (!committed) {
      this.requestedJed ??= session ? this.jed : requested;
      this._jed = previous.jed;
      this.elapsed = previous.elapsed;
      this.asteroidsDiscovered = previous.count;
      // Renderer state includes the shared planets as well as the cloud cutoff.
      // A later invalidation must not draw the rejected date under the old HUD.
      this.renderer.restoreFrame(this.frameState);
      this.renderer.rollbackCatalogue({ retain: !frameError });
      this.resetClock();
      if (drawn === null && (prepared || !session) && !this.contextLost) {
        // A skipped or throwing submission can clear the canvas. Repaint the
        // restored scene once, preserving the original error for manual callers.
        try { this.renderer.render(); }
        catch (error) { if (!frameError) fail(error); }
        if (!this.renderFailure) this.requestRender();
      }
    }
    this.renderer.commitFrame?.();
    if (!session && this.catalogue && committed && !this.catalogue.firstDraw) {
      this.catalogue.firstDraw = true;
      performance.mark("catalog:first-complete");
    }
    this.updateGui();
    // Manual callers (including finite benchmarks) own failure handling. Keep
    // the same throwable boundary after restoring app/graphics state.
    if (frameError && !this.autoRender) throw frameError;
    afterRender?.();
  }
  tick(timestamp = performance.now()) {
    if (this.destroyed || !this.initialized) return;
    if (document.hidden || this.contextLost) { this.resetClock(); return; }
    if (this.appliedPixelRatio !== this.effectivePixelRatio || this.nativePixelRatio !== (window.devicePixelRatio || 1)) this.resize({ render: false });
    if (this.catalogOpening) { this.resetClock(); return; }
    const loader = this.catalogLoader;
    const wasWaiting = this.catalogWaiting;
    if (wasWaiting) this.resetClock();
    const advance = this.clock.advance(timestamp, wasWaiting ? 0 : this.jedDelta);
    const next = this.requestedJed ?? (validDate(this.jed + advance) ? this.jed + advance : this.jed);
    if (this.pendingBundled && this.renderer.asteroids?.catalogue !== this.pendingBundled.model) {
      this.renderer.setAsteroids(this.pendingBundled.model, { jed: next, elapsed: this.elapsed }, { preservePrevious: true });
    }
    if (loader?.source) {
      const ready = this.demandCatalog(next);
      const packed = this.syncCatalog(next);
      if (!ready || !packed) {
        this.requestedJed = next;
        this.resetClock();
        this.updateCatalogStatus();
        return;
      }
    }
    this.requestedJed = null;
    this._jed = next;
    this.elapsed += wasWaiting ? 0 : this.clock.seconds;
    this.renderer.captureFrame(this.frameState);
    const count = this.renderer.update(this.frameState);
    if (!this.deferReadouts) this.asteroidsDiscovered = count;
    if (this.isPlaying) this.stats.update();
    else this.stats.reset();
    if (!loader?.source && !this.deferReadouts) this.updateGui();
    return true;
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
    this.catalogOpening?.abort();
    this.catalogLoader?.dispose();
    this.activeSession?.loader.dispose();
    this.catalogue = this.pendingBundled = this.pendingSession = this.activeSession = null;
    this.graphicsError = "";
    this.setStatus("");
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("online", this.onCatalogOnline);
    this.resolutionQuery?.removeEventListener("change", this.onResolutionChange);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.gui?.destroy();
    this.renderer?.destroy();
    this.initialized = false;
  }
}
