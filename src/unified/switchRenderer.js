import { discoveryCount } from "../js/asteroidOrbits.js";

// One asynchronous transition owns graphics at a time. Catalogue sessions keep
// retaining CPU data, but only App's regular frame transaction can publish it.
function nextTask(signal) {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 0);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}
async function visible(signal) {
  while (document.hidden) {
    await new Promise((resolve, reject) => {
      const cleanup = () => { document.removeEventListener("visibilitychange", changed); signal.removeEventListener("abort", abort); };
      const changed = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(signal.reason); };
      document.addEventListener("visibilitychange", changed, { once: true });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  signal.throwIfAborted();
}

async function rebuild(app, create, id, signal) {
  const token = app.rendererToken = {};
  let renderer;
  try {
    renderer = await create(app.rendererContext(token));
    signal.throwIfAborted();
    app.switchCandidate = renderer;
    await renderer.init();
    signal.throwIfAborted();
    renderer.restoreView?.(app.rendererViews[id]);
    renderer.setOptions?.(app.rendererSettings(id));
    const model = app.catalogue;
    if (model) {
      // Retain only one packed cloud. Yield between bounded CPU batches, also
      // for bundled data so subsequent bundled playback has its entire prefix.
      while (renderer.syncCatalogue(model, app.frameState, { required: model.count, activate: true }) < model.count) {
        await nextTask(signal);
        signal.throwIfAborted();
        if (token.lost) throw new Error("Graphics connection lost while switching.");
      }
    }
    await visible(signal);
    if (token.lost) throw new Error("Graphics connection lost while switching.");
    // Tracks retain the sampling date used when their planets were added.
    // Re-sampling at each switch subtly moves their polygon vertices.
    for (const batch of app.planetBatches) renderer.addPlanets(batch.planets, { jed: batch.jed });
    renderer.setOptions?.(app.rendererSettings(id));
    renderer.resize(app.viewport);
    renderer.update(app.frameState);
    renderer.restoreDiscoveries?.();
    const receipt = renderer.render();
    const required = model ? discoveryCount(model.dates.subarray(0, model.count), app.jed) : 0;
    if (receipt === null || receipt < required || token.lost) {
      throw new Error("The renderer did not draw the complete catalogue.");
    }
    signal.throwIfAborted();
    renderer.commitCatalogue();
    app.renderer = renderer;
    app.switchCandidate = null;
    app.rendererId = id;
    app.createRenderer = create;
    app.validatePlanets = renderer.validatePlanets;
    app.asteroidsDiscovered = renderer.frameState?.count ?? app.asteroidsDiscovered;
    app.asteroidsVisible = renderer.frameState?.visibleCount ?? app.asteroidsVisible;
    // Clear only adapter failures; a CPU preparation/source failure still owns
    // its own error and cannot be fixed by changing the graphics engine.
    for (const session of new Set([app.activeSession, app.pendingSession])) {
      if (session?.adapterFailure) {
        if (session.loader.error === session.adapterFailure) session.loader.error = session.loader.errorKind = null;
        session.adapterFailure = null;
      }
    }
    if (app.activeSession?.model === model) app.activeSession.loader.rendered(receipt);
    app.contextLost = false;
    app.renderFailure = null;
    app.graphicsRecoveryPending = app.rendererRecovery = false;
    app.graphicsError = app.rendererNotice = "";
    app.gui?.controls.mountRenderer();
  } catch (error) {
    if (app.rendererToken === token) app.rendererToken = null;
    app.gui?.controls.unmountRenderer();
    renderer?.destroy();
    if (app.renderer === renderer) app.renderer = null;
    app.switchCandidate = null;
    throw error;
  }
}

async function transition(app, id, signal) {
  const previousId = app.rendererId, previousCreate = app.createRenderer;
  let disposed = !app.renderer;
  const previousFrame = app.renderer?.frameState;
  if (previousFrame && app.jed !== previousFrame.jed) {
    app.requestedJed ??= app.jed;
    app._jed = previousFrame.jed;
    app.elapsed = previousFrame.elapsed;
    app.asteroidsDiscovered = previousFrame.count;
    app.asteroidsVisible = previousFrame.visibleCount ?? previousFrame.count;
  }
  app.switching = "loading";
  app.switchError = "";
  app.switchMessage = `Loading ${app.rendererRegistry[id].label}…`;
  app.gui?.controls.updateRenderer();
  app.resetClock();
  app.demandCatalog();
  app.renderStatus();
  try {
    const create = await app.rendererRegistry[id].load();
    signal.throwIfAborted();
    // Capture after code loading: camera input remains usable during loading.
    if (app.renderer) app.rendererViews[previousId] = app.renderer.captureView?.();
    app.switching = "preparing";
    app.cancelRender();
    app.gui?.controls.unmountRenderer();
    app.rendererToken = null;
    app.renderer?.destroy();
    app.renderer = null;
    disposed = true;
    for (const session of new Set([app.activeSession, app.pendingSession])) session?.loader.loseGraphics();
    // Context loss is asynchronous. Let native cleanup run before allocating
    // another context, even when a small retained cloud needs no packing yield.
    await nextTask(signal);
    await rebuild(app, create, id, signal);
  } catch (error) {
    if (signal.aborted || app.destroyed) return;
    if (disposed) {
      try { await nextTask(signal); await rebuild(app, previousCreate, previousId, signal); }
      catch {
        if (signal.aborted || app.destroyed) return;
        app.rendererId = previousId;
        app.switchError = "Unable to restore the visualization. Retry or choose a renderer in options.";
        app.failedRendererId = id;
      }
    }
    if (!app.switchError) app.switchError = `Unable to switch to ${app.rendererRegistry[id].label}. The previous renderer is still selected.`;
  } finally {
    if (!app.destroyed) {
      app.switching = null;
      app.switchMessage = "";
      app.resetClock();
      app.demandCatalog();
      app.gui?.controls.updateRenderer();
      app.renderStatus();
      app.requestRender();
    }
  }
}

export default function switchRenderer(app, id) {
  if (!Object.hasOwn(app.rendererRegistry, id)) return Promise.reject(new Error("Unknown renderer."));
  if (app.destroyed) return Promise.resolve(false);
  app.requestedRenderer = id;
  if (!app.switchPromise) {
    const controller = app.switchController = new AbortController();
    app.switchPromise = (async () => {
      await app.init();
      while (!app.destroyed && app.requestedRenderer !== null) {
        const next = app.requestedRenderer;
        app.requestedRenderer = null;
        if (next !== app.rendererId || !app.renderer) await transition(app, next, controller.signal);
      }
    })().finally(() => {
      app.switchPromise = null;
      app.switchController = null;
      app.notifyRendererState?.();
    });
  }
  app.notifyRendererState?.();
  return app.switchPromise.then(() => !app.destroyed && !!app.renderer && app.rendererId === id);
}
