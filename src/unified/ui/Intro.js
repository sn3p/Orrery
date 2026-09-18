// First-visit introduction and the footer "Orrery" entry that reopens it. Playback holds while the
// card is open so the start of the discovery timeline is not hidden behind it.
const STORAGE_KEY = "orrery.intro";

const remembered = () => { try { return localStorage.getItem(STORAGE_KEY) === "seen"; } catch { return false; } };
const remember = () => { try { localStorage.setItem(STORAGE_KEY, "seen"); } catch { /* Blocked storage: the card returns next visit. */ } };

export default class Intro {
  constructor(app) {
    this.app = app;
    this.dialog = document.getElementById("orrery-intro");
    this.trigger = document.getElementById("orrery-about");
    // Fixture pages have no card; browsers without <dialog> keep the app usable.
    if (typeof this.dialog?.showModal !== "function") { this.dialog = null; return; }
    this.trigger?.addEventListener("click", this.onOpen);
    this.dialog.addEventListener("close", this.onClose);
    this.dialog.addEventListener("click", this.onBackdrop);
    this.dateAction = document.getElementById("orrery-intro-date");
    this.optionsAction = document.getElementById("orrery-intro-options");
    this.rendererGroup = document.getElementById("orrery-intro-renderers");
    this.rendererActions = [...this.dialog.querySelectorAll(".orrery-intro-renderer[data-renderer]")];
    this.dateAction?.addEventListener("click", this.onDate);
    this.optionsAction?.addEventListener("click", this.onOptions);
    for (const action of this.rendererActions) action.addEventListener("click", this.onRenderer);
    if (!remembered()) this.open();
    // index.js starts App immediately after constructing Intro. Reconcile the
    // initially selected label once that shared initialization promise exists.
    Promise.resolve().then(() => { this.watchRendererState(); this.updateRendererActions(); });
  }

  get isOpen() { return !!this.dialog?.open; }

  open() {
    if (!this.dialog || this.dialog.open) return;
    this.updateRendererActions();
    this.app.hold(true);
    this.dialog.showModal();
  }

  closeWith(action) {
    if (!this.dialog?.open || this.pendingAction) return;
    this.pendingAction = action;
    this.dialog.close("action");
  }

  async withControls(open) {
    try { await this.app.init(); }
    catch { return; }
    if (this.dialog) open(this.app.gui);
  }

  updateRendererActions() {
    const busy = !!this.rendererTarget || !!this.app.switching;
    this.rendererGroup?.setAttribute("aria-busy", String(busy));
    if (this.dateAction) this.dateAction.disabled = this.app.destroyed;
    if (this.optionsAction) this.optionsAction.disabled = this.app.destroyed;
    for (const action of this.rendererActions ?? []) {
      const active = !this.app.destroyed && !!this.app.renderer
        && action.dataset.renderer === this.app.rendererId;
      action.setAttribute("aria-pressed", String(active));
      action.disabled = this.app.destroyed || busy;
    }
    this.watchRendererState();
  }

  watchRendererState() {
    const pending = this.app.destroyed ? null
      : this.app.switchPromise ?? (!this.app.initialized ? this.app.initialization : null);
    if (!pending || pending === this.rendererWatch) return;
    this.rendererWatch = pending;
    Promise.resolve(pending).catch(() => {}).finally(() => {
      if (this.rendererWatch === pending) this.rendererWatch = null;
      if (this.dialog) this.updateRendererActions();
    });
  }

  onOpen = () => { this.open(); };
  onDate = () => { this.closeWith(() => this.withControls(gui => gui?.timeline.open())); };
  onOptions = () => { this.closeWith(() => this.withControls(gui => gui?.controls.open())); };
  onRenderer = event => {
    const id = event.currentTarget.dataset.renderer;
    if (this.app.destroyed || !Object.hasOwn(this.app.rendererRegistry, id)
      || this.app.switching) return;
    if (id === this.app.rendererId && this.app.renderer) {
      this.closeWith();
      return;
    }
    this.rendererTarget = id;
    this.updateRendererActions();
    this.closeWith(async () => {
      try { await this.app.switchRenderer(id); }
      catch { /* App publishes initialization and switching failures. */ }
      finally {
        this.rendererTarget = null;
        this.updateRendererActions();
      }
    });
  };
  onClose = () => {
    remember();
    this.app.hold(false);
    const action = this.pendingAction;
    this.pendingAction = null;
    if (action) void action();
  };
  onBackdrop = event => { if (event.target === this.dialog) this.dialog.close(); };

  destroy() {
    if (!this.dialog) return;
    this.trigger?.removeEventListener("click", this.onOpen);
    this.dialog.removeEventListener("close", this.onClose);
    this.dialog.removeEventListener("click", this.onBackdrop);
    this.dateAction?.removeEventListener("click", this.onDate);
    this.optionsAction?.removeEventListener("click", this.onOptions);
    for (const action of this.rendererActions ?? []) action.removeEventListener("click", this.onRenderer);
    this.pendingAction = null;
    this.rendererWatch = null;
    // Disposal (for example a hot update) is not a dismissal; nothing is remembered.
    if (this.dialog.open) this.dialog.close();
    this.dialog = null;
  }
}
