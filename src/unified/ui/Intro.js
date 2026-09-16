// First-visit introduction and the footer About entry. Playback holds while the
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
    if (!remembered()) this.open();
  }

  get isOpen() { return !!this.dialog?.open; }

  open() {
    if (!this.dialog || this.dialog.open) return;
    this.app.hold(true);
    this.dialog.showModal();
  }

  onOpen = () => { this.open(); };
  onClose = () => { remember(); this.app.hold(false); };
  onBackdrop = event => { if (event.target === this.dialog) this.dialog.close(); };

  destroy() {
    if (!this.dialog) return;
    this.trigger?.removeEventListener("click", this.onOpen);
    this.dialog.removeEventListener("close", this.onClose);
    this.dialog.removeEventListener("click", this.onBackdrop);
    // Disposal (for example a hot update) is not a dismissal; nothing is remembered.
    if (this.dialog.open) this.dialog.close();
    this.dialog = null;
  }
}
