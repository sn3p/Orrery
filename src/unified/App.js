import { formatIsoDay, toJED } from "../js/utils.js";
import { validDate } from "../js/asteroidOrbits.js";
import { replaceShareUrl, shareDateValue } from "./shareUrl.js";
import PlaybackClock from "../js/PlaybackClock.js";
import Stats from "../js/Stats.js";
import Hud from "./ui/Hud.js";
import CatalogSource from "./catalog/CatalogSource.js";
import CatalogLoader from "./catalog/CatalogLoader.js";
import { allocateCatalogue, appendCatalogue, prepareCatalogue } from "./catalog/prepareCatalogue.js";
import { selectRenderer, renderers } from "./renderers.js";
import switchRenderer from "./switchRenderer.js";
import { isPlanetLabelMode, loadPlanetLabelMode, savePlanetLabelMode } from "./PlanetLabel.js";
import { DEFAULT_PLANET_ORBITS_VISIBLE, isPlanetOrbitVisibility } from "./PlanetOrbitPreference.js";
import { DEFAULT_POPULATION_PRESET, isPopulationPreset } from "./catalog/population.js";
import { currentJed, engagePresent, frameSeconds, seekPresent, stepPresent } from "./present.js";
import { loadRealTimePreference, saveRealTimePreference } from "./RealTimePreference.js";

// Shared across module replacements so stale disposal cannot erase a new App's feedback.
const STATUS_OWNER = Symbol.for("orrery.statusOwner");
const countFormat = new Intl.NumberFormat("en-US");
const formatCount = value => countFormat.format(value).replaceAll(",", "\u202f");

export default class App {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.startDate = options.startDate ?? new Date(Date.UTC(1980, 0, 1));
    this.startJed = options.startJed ?? toJED(this.startDate);
    this._jed = options.jed ?? this.startJed;
    this._jedDelta = options.jedDelta ?? 1.5;
    if (!validDate(this.startJed) || !validDate(this.jed) || !Number.isFinite(this.jedDelta)) {
      throw new Error("Invalid initial playback time.");
    }
    this.autoRender = options.autoRender ?? true;
    this.fixedResolution = options.resolution;
    if (this.fixedResolution !== undefined && (this.autoRender || !Number.isFinite(this.fixedResolution) || this.fixedResolution <= 0)) {
      throw new Error("Fixed resolution requires manual rendering and a positive finite value.");
    }
    this.rendererRegistry = options.renderers ?? renderers;
    this.rendererOptions = Object.fromEntries(Object.entries(this.rendererRegistry).map(([id, entry]) => [id, { ...entry.defaults }]));
    this.rendererViews = {};
    this.planetBatches = [];
    const selection = selectRenderer(options.renderer, this.rendererRegistry);
    this.rendererId = selection.id;
    this.rendererNotice = selection.notice;
    // Reload must reproduce an unrecognized ?renderer= value; the resolved Pixi
    // id would omit it from the share URL and drop the fallback notice.
    this.rendererQuery = selection.notice ? options.renderer : selection.id;
    this.createRenderer = options.createRenderer ?? selection.create;
    this._pixelRatio = (window.devicePixelRatio || 1) >= 2 ? "2" : "1";
    this._planetLabels = options.planetLabels ?? loadPlanetLabelMode();
    if (!isPlanetLabelMode(this._planetLabels)) throw new Error("Invalid planet label mode.");
    this._planetOrbits = options.planetOrbits ?? DEFAULT_PLANET_ORBITS_VISIBLE;
    try { localStorage.removeItem("orrery.planetOrbits"); } catch { /* Drop a retired preference. */ }
    if (!isPlanetOrbitVisibility(this._planetOrbits)) throw new Error("Invalid planet orbit visibility.");
    this._populationPreset = options.populationPreset ?? DEFAULT_POPULATION_PRESET;
    if (!isPopulationPreset(this._populationPreset)) throw new Error("Invalid population preset.");
    // Remembered in this browser. The app entry passes the saved choice; other
    // callers stay off unless they opt in.
    this._holdAtPresent = !!options.holdAtPresent;
    this.followingPresent = false;
    if (this._holdAtPresent) {
      const engaged = engagePresent({ jed: this._jed, now: currentJed(), speed: this._jedDelta });
      this.followingPresent = engaged.following;
      this._jed = engaged.jed;
      this._jedDelta = engaged.speed;
    }
    this.held = false;
    this.clock = new PlaybackClock();
    this.elapsed = 0;
    this.asteroidsDiscovered = 0;
    this.asteroidsVisible = 0;
    this.hasCommittedReadouts = false;
    this.loadVersion = 0;
    this.seekGeneration = 0;
    this.pendingSeek = null;
    if (options.jed !== undefined && !Object.is(this._jed, this.startJed)) {
      this.pendingSeek = { generation: ++this.seekGeneration, target: this._jed };
      this.requestedJed = this._jed;
    }
    if (this.followingPresent && this._jedDelta !== 0) this.syncShareUrl();
    this.rendererGeneration = 0;
    this.destroyed = false;
    this.initialized = false;
    this.contextLost = false;
    this.graphicsRecoveryPending = false;
    this.rendererRecovery = false;
    this.rendererStateObservers = new Set();
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
        this.graphicsRecoveryPending = true;
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
      else this.graphicsError = lost ? "Graphics connection lost. Waiting to reconnect…"
        : this.graphicsRecoveryPending ? "Restoring the visualization…" : "";
      this.renderStatus();
    };
    this.onCatalogOnline = () => { this.catalogLoader?.retry(); };
  }

  get jed() { return this._jed; }
  set jed(value) {
    if (this.destroyed) return;
    if (!validDate(value)) throw new Error("Invalid playback date.");
    if (this._holdAtPresent) {
      const sought = seekPresent({ jed: value, hold: true, now: currentJed() });
      value = sought.jed;
      this.followingPresent = sought.following;
    }
    if (Object.is(value, this.requestedJed ?? this._jed)) {
      this.notePresent();
      return;
    }
    this.pendingSeek = { generation: ++this.seekGeneration, target: value };
    if (this.switching || this.catalogOpening || this.catalogLoader?.source) {
      this.requestedJed = value;
      this.resetClock();
      this.demandCatalog();
      this.onCatalogChange();
      this.syncShareUrl();
      this.notePresent();
      return;
    }
    this.requestedJed = value;
    this.resetClock();
    this._jed = value;
    this.requestRender();
    this.syncShareUrl();
    this.notePresent();
  }
  get jedDelta() { return this._jedDelta; }
  set jedDelta(value) {
    if (this.destroyed || Object.is(value, this._jedDelta)) return;
    if (!Number.isFinite(value)) throw new Error("Invalid playback speed.");
    const wasPlaying = this.isPlaying;
    this._jedDelta = value;
    // Reverse leaves the wall clock. Forward play catches the present again.
    if (value < 0) this.followingPresent = false;
    this.gui?.updatePlayback(value);
    this.gui?.controls.speed?.updateDisplay();
    this.demandCatalog();
    if (!wasPlaying || !this.isPlaying) this.resetClock();
    this.requestRender();
    if (value === 0) this.syncShareUrl();
    this.notePresent();
  }
  get holdAtPresent() { return this._holdAtPresent; }
  set holdAtPresent(value) {
    value = !!value;
    if (this.destroyed || value === this._holdAtPresent) return;
    this._holdAtPresent = value;
    saveRealTimePreference(value);
    if (!value) this.followingPresent = false;
    else {
      // A streamed seek keeps the target in requestedJed while jed is still
      // the last committed day. Judge that target, then assign through the
      // setter so it replaces the queued seek.
      const engaged = engagePresent({
        jed: this.requestedJed ?? this.jed, now: currentJed(), speed: this.jedDelta,
        resumeSpeed: this.gui?.timeline?.resumeSpeed,
      });
      this.followingPresent = engaged.following;
      if (engaged.speed !== this.jedDelta) this.jedDelta = engaged.speed;
      if (engaged.seek) this.jed = engaged.jed;
    }
    this.gui?.controls.present?.updateDisplay();
    this.notePresent();
    this.requestRender();
  }
  notePresent() {
    this.gui?.updateNow?.(this._holdAtPresent && this.followingPresent);
    this.gui?.updatePresentCopy?.(this._holdAtPresent);
  }
  get isPlaying() { return this.jedDelta !== 0 && !this.held; }
  // Hold playback without changing the chosen speed, e.g. while the introduction is open.
  hold(held) {
    held = !!held;
    if (this.destroyed || held === this.held) return;
    const wasPlaying = this.isPlaying;
    this.held = held;
    this.demandCatalog();
    if (wasPlaying !== this.isPlaying) this.resetClock();
    this.requestRender();
  }
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
  get planetLabels() { return this._planetLabels; }
  set planetLabels(value) {
    if (this.destroyed || !isPlanetLabelMode(value) || value === this._planetLabels) return;
    this._planetLabels = value;
    savePlanetLabelMode(value);
    this.renderer?.setOptions?.(this.rendererSettings());
    this.requestRender();
  }
  get planetOrbits() { return this._planetOrbits; }
  set planetOrbits(value) {
    if (this.destroyed || !isPlanetOrbitVisibility(value) || value === this._planetOrbits) return;
    this._planetOrbits = value;
    this.renderer?.setOptions?.(this.rendererSettings());
    this.requestRender();
  }
  get populationPreset() { return this._populationPreset; }
  set populationPreset(value) {
    if (this.destroyed || !isPopulationPreset(value) || value === this._populationPreset) return;
    this._populationPreset = value;
    this.renderer?.setOptions?.(this.rendererSettings());
    this.renderer?.ensurePopulationView?.(value);
    this.requestRender();
  }
  get frameState() { return { jed: this.jed, elapsed: this.elapsed }; }
  get viewport() { return { width: innerWidth, height: innerHeight, pixelRatio: this.effectivePixelRatio }; }
  rendererSettings(id = this.rendererId, renderer = this.rendererOptions[id]) {
    return { shared: { pixelRatio: this.pixelRatio, planetLabels: this.planetLabels,
      planetOrbits: this.planetOrbits, populationPreset: this.populationPreset }, renderer };
  }

  init() {
    if (this.destroyed) return Promise.resolve();
    this.initialization ??= this.initialize();
    return this.initialization;
  }

  async initialize() {
    try {
      const renderer = this.createRenderer(this.rendererContext(this.rendererToken = {}));
      this.renderer = renderer instanceof Promise ? await renderer : renderer;
      if (this.destroyed) { this.renderer.destroy(); return; }
      await this.renderer.init();
      if (this.destroyed) return;
      this.renderer.setOptions?.(this.rendererSettings());
      this.validatePlanets = this.renderer.validatePlanets;
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

  rendererContext(token) {
    return { container: this.container, getViewport: () => this.viewport,
      invalidate: () => { if (!this.destroyed && this.rendererToken === token) this.requestRender(); },
      reportGraphicsState: (lost, error) => {
        if (this.destroyed || this.rendererToken !== token) return;
        token.lost = lost;
        if (this.switching === "preparing") return;
        this.onGraphicsState(lost, error);
      } };
  }

  observeRendererState(observer) {
    this.rendererStateObservers.add(observer);
    return () => this.rendererStateObservers.delete(observer);
  }

  notifyRendererState() {
    for (const observer of this.rendererStateObservers) observer();
  }

  switchRenderer(id) { return switchRenderer(this, id); }
  syncShareUrl() {
    if (this.destroyed) return;
    replaceShareUrl({
      renderer: this.rendererNotice ? this.rendererQuery : this.rendererId,
      ...(this.jedDelta === 0 ? { date: shareDateValue(this.requestedJed ?? this._jed, this.startJed) } : {}),
    });
  }

  setRendererOptions(id, changes) {
    const entry = this.rendererRegistry[id];
    if (!entry || !entry.validateOptions || !changes || typeof changes !== "object") throw new Error("Unsupported renderer options.");
    const next = { ...this.rendererOptions[id], ...changes };
    if (!entry.validateOptions(next)) throw new Error("Invalid renderer options.");
    if (id === this.rendererId && this.switching !== "preparing") this.renderer?.setOptions?.(this.rendererSettings(id, next));
    this.rendererOptions[id] = next;
    this.requestRender();
  }

  addPlanets(planets) {
    if (!this.initialized || this.destroyed) return;
    const batch = { planets: [...planets], jed: this.jed };
    if (this.renderer) this.renderer.addPlanets(batch.planets, this.frameState);
    else this.validatePlanets(batch.planets, this.frameState);
    this.planetBatches.push(batch);
  }

  setAsteroids(data) {
    if (!this.initialized || this.destroyed) return false;
    const model = prepareCatalogue(data, this.jed);
    const previous = this.pendingBundled?.previous ?? this.renderer?.frameState
      ?? { ...this.frameState, count: this.asteroidsDiscovered, visibleCount: this.asteroidsVisible };
    this.pendingBundled = { model, previous };
    this.catalogOpening?.abort();
    this.catalogOpening = null;
    this.catalogLoader?.dispose();
    this.activeSession?.loader.dispose();
    this.catalogLoader = this.activeSession = this.pendingSession = null;
    this.catalogFailure = null;
    if (this.renderFailure && !this.contextLost) this.renderFailure = null;
    this.requestedJed = null;
    this.pendingSeek = null;
    this.loadVersion++;
    this.loadController?.abort();
    this.setStatus("");
    this.resetClock();
    // Keep synchronous attachment usable by manual callers, but publish it
    // only after the same receipt/rollback boundary as streamed catalogues.
    this.renderFrame();
    this.requestRender();
    // Prepared data may remain pending after a skipped or failed first draw.
    // Only the frame receipt publishes this exact model as the active catalogue.
    return this.catalogue === model;
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
    this.setStatus("Loading asteroids…", false, { busy: true });
    try {
      // Explicit callers may start a load during renderer initialization.
      await this.init();
      if (this.destroyed || version !== this.loadVersion) return false;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`Catalogue request failed (${response.status}).`);
      const data = await response.json();
      if (this.destroyed || version !== this.loadVersion) return false;
      return this.setAsteroids(data);
    } catch (error) {
      if (this.destroyed || version !== this.loadVersion || controller.signal.aborted) return false;
      this.setStatus("Unable to load asteroids. Reload to try again.", true);
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
    const hidden = document.hidden || !this.renderer || this.contextLost || !!this.catalogOpening || !!this.switching;
    const live = this._holdAtPresent && this.followingPresent;
    return this.catalogLoader?.demand(date, { playing: this.isPlaying && !!this.renderer && !this.catalogOpening && !this.switching, hidden,
      daysPerSecond: live ? 0 : this.jedDelta * 60 }) ?? !this.catalogOpening;
  }
  onCatalogChange() {
    if (this.catalogWaiting) this.resetClock();
    this.updateCatalogStatus();
    this.requestRender();
  }
  updateCatalogStatus() {
    const loader = this.catalogLoader;
    const target = this.requestedJed ?? this.pendingSeek?.target;
    const targetDay = Number.isFinite(target) ? formatIsoDay(target) : "";
    const hasTargetContext = this.hasCommittedReadouts && targetDay;
    const failure = (this.catalogFailure && "Could not load the asteroid catalogue. Reload to try again.")
      || (loader?.errorKind === "commit" && "This asteroid catalogue cannot be prepared for this renderer.")
      || (loader?.error && loader.buffering && (hasTargetContext
        ? `Could not load asteroids for ${targetDay}. Reload to try again.`
        : "Could not load more asteroids. Reload to try again."));
    if (failure) {
      this.setStatus(failure, true);
      return;
    }
    if (this.catalogOpening && this.hasCommittedReadouts && targetDay) {
      this.setStatus("Buffering asteroids…", false, {
        busy: true,
        detail: targetDay,
        announcement: `Buffering asteroids for ${targetDay}.`,
      });
      return;
    }
    if (this.catalogOpening || (loader?.source && !loader.initialRendered && !hasTargetContext)) {
      this.setStatus("Loading asteroids…", false, { busy: true });
      return;
    }
    if (!loader?.source || !Number.isFinite(target)) {
      this.setStatus("");
      return;
    }
    const required = loader.source.countThrough(target);
    const session = this.pendingSession ?? this.activeSession;
    const packed = this.renderer?.catalogueProgress?.(session?.model) ?? 0;
    const buffering = loader.committedCount < required;
    const preparing = !buffering && !loader.sceneComplete(target);
    if (!buffering && !preparing) {
      this.setStatus("");
      return;
    }
    const completed = Math.min(required, buffering ? loader.committedCount : packed);
    this.setStatus(buffering ? "Buffering asteroids…" : "Preparing asteroids…", false, {
      busy: true,
      detail: `${targetDay} · ${formatCount(completed)} / ${formatCount(required)}`,
      announcement: `${buffering ? "Buffering" : "Preparing"} asteroids for ${targetDay}.`,
    });
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

  setStatus(message, error = false, { busy = false, detail = "", announcement = message } = {}) {
    this.statusMessage = message;
    this.statusError = error;
    this.statusBusy = busy;
    this.statusDetail = detail;
    this.statusAnnouncement = announcement;
    this.renderStatus();
  }
  renderStatus() {
    // Initialization failures publish feedback after resource cleanup. Once
    // explicitly cleared, a disposed instance must not reclaim the shared node.
    const status = document.getElementById("orrery-status");
    if (this.destroyed && (!this.statusMessage || (this.statusNode && status?.[STATUS_OWNER] !== this))) return;
    if (status) {
      this.statusNode = status;
      status[STATUS_OWNER] = this;
      const message = this.switchMessage || (!this.renderer && this.switchError) || this.graphicsError
        || (this.statusError && this.statusMessage) || this.switchError || this.statusMessage || this.rendererNotice || "";
      const usingCatalogStatus = message === this.statusMessage;
      const detail = usingCatalogStatus ? this.statusDetail : "";
      const busy = usingCatalogStatus ? this.statusBusy : !!this.switchMessage || /^Restoring /.test(message);
      const announcement = usingCatalogStatus ? this.statusAnnouncement : message;
      const signature = JSON.stringify([message, busy, announcement, !!detail]);
      const changed = status.dataset.signature !== signature;
      if (changed) {
        status.replaceChildren();
        if (message) {
          const visual = document.createElement("span");
          visual.className = `orrery-status-visual${busy ? " orrery-status-busy" : ""}`;
          if (busy) {
            const spinner = document.createElement("span");
            spinner.className = "orrery-status-spinner";
            spinner.setAttribute("aria-hidden", "true");
            visual.append(spinner);
          }
          const label = document.createElement("span");
          label.className = "orrery-status-label";
          label.textContent = message;
          visual.append(label);
          if (detail) {
            const progress = document.createElement("span");
            progress.className = "orrery-status-detail";
            progress.textContent = detail;
            visual.append(progress);
          }
          if (busy) visual.setAttribute("aria-hidden", "true");
          status.append(visual);
          if (busy) {
            const liveAnnouncement = document.createElement("span");
            liveAnnouncement.className = "orrery-status-announcement";
            liveAnnouncement.textContent = announcement;
            status.append(liveAnnouncement);
          }
        }
        status.dataset.signature = signature;
      } else if (detail) {
        status.querySelector(".orrery-status-detail").textContent = detail;
      }
      status.removeAttribute("aria-label");
      if (changed && this.switchError && !this.renderer && !this.destroyed) {
        const retry = document.createElement("button");
        retry.type = "button";
        retry.textContent = "Retry visualization";
        retry.onclick = () => { void this.switchRenderer(this.failedRendererId); };
        status.append(" ", retry);
      }
      if (changed && this.rendererRecovery) {
        const link = document.createElement("a"), url = new URL(location.href);
        url.searchParams.set("renderer", "pixi");
        link.href = url.href;
        link.textContent = "Open Pixi preview";
        status.append(" ", link);
      }
      status.setAttribute("role", (this.statusError && !this.graphicsError) || this.renderFailure || this.rendererRecovery || this.switchError ? "alert" : "status");
      if (changed && message) this.gui?.controls.revealStatus(status);
    }
  }
  updateGui() {
    if (this.destroyed) return;
    // A loaded empty catalogue is valid too. Retain the last committed readouts
    // while a replacement, renderer switch or graphics recovery is pending.
    this.gui?.update(this.jed, this.stats.fps, this.asteroidsVisible, this.hasCommittedReadouts);
    this.notePresent();
  }
  resetClock() {
    this.clock.reset();
    this.stats?.reset();
    if (this.initialized && !this.destroyed && !this.catalogLoader?.source
      && !this.pendingBundled && !this.renderFailure && !this.graphicsRecoveryPending && !this.deferReadouts) this.updateGui();
  }
  requestRender() {
    if (!this.autoRender || !this.initialized || this.destroyed || document.hidden || this.contextLost || !this.renderer || this.switching === "preparing" || this.animationFrame !== null) return;
    this.animationFrame = requestAnimationFrame(this.render);
  }
  cancelRender() {
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.animationFrame = null;
  }
  render(timestamp = performance.now()) {
    this.cancelRender();
    this.renderFrame(timestamp);
    const packing = this.renderer && this.catalogLoader && !this.catalogLoader.error
      && this.renderer.needsCatalogPacking?.((this.pendingSession ?? this.activeSession)?.model);
    if (!this.switching && !this.renderFailure
      && ((this.isPlaying && !this.catalogWaiting) || packing || this.renderer?.viewAnimating)) {
      this.requestRender();
    }
  }
  renderFrame(timestamp = performance.now(), { beforeRender, afterRender } = {}) {
    if (this.destroyed || !this.initialized || !this.renderer) return;
    if (this.switching) {
      this.resetClock();
      if (this.switching === "loading" && !document.hidden && !this.contextLost) {
        try { this.renderer.render(); } catch { /* Rebuilding provides recovery after loading. */ }
      }
      return;
    }
    if (document.hidden || this.contextLost) { this.resetClock(); return; }
    // Direct tick/Pixi callers may leave a snapshot from an earlier update.
    // Rollback must use only state captured within this frame transaction.
    this.renderer.commitFrame?.();
    // A direct seek changes App.jed before its draw. The adapter still owns
    // the previous scene, including changes made through direct tick callers.
    const previous = this.pendingBundled?.previous ?? this.renderer?.frameState
      ?? { jed: this.jed, elapsed: this.elapsed, count: this.asteroidsDiscovered,
        visibleCount: this.asteroidsVisible };
    const requested = this.requestedJed ?? (this.jed !== previous.jed ? this.jed : null);
    const seek = this.pendingSeek;
    const graphicsGeneration = this.rendererGeneration;
    let drawn = null, prepared = false, frameError;
    const fail = error => {
      frameError = error;
      this.renderFailure = error;
      this.graphicsRecoveryPending = true;
      this.rendererRecovery = this.rendererId === "three";
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
    if (committed) {
      this.asteroidsDiscovered = this.renderer.frameState?.count ?? 0;
      this.asteroidsVisible = this.renderer.frameState?.visibleCount ?? this.asteroidsDiscovered;
    }
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
      this.requestedJed ??= seek?.target ?? (session ? this.jed : requested);
      this._jed = previous.jed;
      this.elapsed = previous.elapsed;
      this.asteroidsDiscovered = previous.count;
      this.asteroidsVisible = previous.visibleCount ?? previous.count;
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
    if (committed && seek && this.pendingSeek?.generation === seek.generation
      && Object.is(this.jed, seek.target)) this.pendingSeek = null;
    this.renderer.commitFrame?.();
    if (!session && this.catalogue && committed && !this.catalogue.firstDraw) {
      this.catalogue.firstDraw = true;
      performance.mark("catalog:first-complete");
    }
    if (committed && this.graphicsRecoveryPending) {
      this.graphicsRecoveryPending = this.rendererRecovery = false;
      this.graphicsError = "";
      this.renderStatus();
    }
    if (committed && this.catalogue) this.hasCommittedReadouts = true;
    this.updateGui();
    // Manual callers (including finite benchmarks) own failure handling. Keep
    // the same throwable boundary after restoring app/graphics state.
    if (frameError && !this.autoRender) throw frameError;
    afterRender?.();
  }
  tick(timestamp = performance.now()) {
    if (this.destroyed || !this.initialized || !this.renderer || this.switching) return;
    if (document.hidden || this.contextLost) { this.resetClock(); return; }
    // Direct ticks support already committed bundled scenes. Pending/streamed
    // data needs renderFrame's receipt and rollback boundary before activation,
    // and a terminal render failure cannot be bypassed through this entry point.
    if (this.renderFailure || (!this.deferReadouts && (this.pendingBundled || this.catalogLoader?.source || this.graphicsRecoveryPending))) {
      this.resetClock();
      return;
    }
    if (this.appliedPixelRatio !== this.effectivePixelRatio || this.nativePixelRatio !== (window.devicePixelRatio || 1)) this.resize({ render: false });
    if (this.catalogOpening) { this.resetClock(); return; }
    const loader = this.catalogLoader;
    const wasWaiting = this.catalogWaiting;
    if (wasWaiting) this.resetClock();
    const blocked = wasWaiting || this.held;
    const followClock = this._holdAtPresent && this.followingPresent && !blocked && this.jedDelta > 0;
    const realSeconds = followClock ? frameSeconds(this.clock.previous, timestamp) : 0;
    const advance = this.clock.advance(timestamp, blocked || followClock ? 0 : this.jedDelta);
    let next = this.requestedJed;
    if (next == null) {
      const storyAdvance = validDate(this.jed + advance) ? advance : 0;
      const stepped = stepPresent({
        jed: this.jed, advance: storyAdvance, speed: blocked ? 0 : this.jedDelta,
        hold: this._holdAtPresent, following: this.followingPresent, now: currentJed(),
      });
      next = stepped.jed;
      this.followingPresent = stepped.following;
    }
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
    this.elapsed += wasWaiting ? 0 : (followClock ? realSeconds : this.clock.seconds);
    const seek = this.pendingSeek;
    const baseline = !!seek && Object.is(next, seek.target);
    this.renderer.captureFrame(this.frameState, { baseline });
    const count = this.renderer.update(this.frameState, { baseline });
    // Direct tick callers own their synchronous update boundary and do not
    // return through renderFrame's receipt handling.
    if (!this.deferReadouts && baseline && this.pendingSeek?.generation === seek.generation) this.pendingSeek = null;
    if (!this.deferReadouts) {
      this.asteroidsDiscovered = count;
      this.asteroidsVisible = this.renderer.asteroids?.visibleCount ?? count;
    }
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
    this.renderer?.resize(this.viewport);
    this.appliedPixelRatio = this.effectivePixelRatio;
    this.watchResolution();
    this.gui.controls.updatePixelRatio();
    if (this.statusNode?.textContent) this.gui.controls.revealStatus(this.statusNode);
    if (render) this.requestRender();
  }
  destroy() {
    // Startup failure can leave owned feedback after resources were destroyed.
    // Clear it on later explicit disposal, without touching a newer App's UI.
    this.renderFailure = null;
    this.rendererRecovery = this.graphicsRecoveryPending = false;
    this.rendererNotice = this.graphicsError = this.statusMessage = this.statusDetail = this.statusAnnouncement
      = this.switchError = this.switchMessage = "";
    this.statusBusy = false;
    this.statusError = false;
    if (this.statusNode?.[STATUS_OWNER] === this) {
      this.statusNode.textContent = "";
      this.statusNode.setAttribute("role", "status");
      this.statusNode.removeAttribute("aria-label");
      delete this.statusNode.dataset.signature;
      delete this.statusNode[STATUS_OWNER];
    }
    this.statusNode = null;
    if (this.destroyed) return;
    this.destroyed = true;
    this.notifyRendererState();
    this.rendererStateObservers.clear();
    this.switchController?.abort();
    this.rendererToken = null;
    this.switchCandidate?.destroy();
    this.cancelRender();
    this.loadVersion++;
    this.loadController?.abort();
    this.catalogOpening?.abort();
    this.catalogLoader?.dispose();
    this.activeSession?.loader.dispose();
    this.catalogue = this.pendingBundled = this.pendingSession = this.activeSession = null;
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("online", this.onCatalogOnline);
    this.resolutionQuery?.removeEventListener("change", this.onResolutionChange);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.gui?.destroy();
    this.renderer?.destroy();
    this.initialized = false;
  }
}
