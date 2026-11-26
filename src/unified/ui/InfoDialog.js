// Shared lifecycle for the two section explanations. Native close events are
// queued; finish synchronously on teardown and before reopening a closed card.
export default class InfoDialog {
  constructor(options, dialog, trigger, prepare = () => {}) {
    Object.assign(this, { options, dialog, trigger, prepare });
    trigger.addEventListener('click', this.onOpen);
    dialog.addEventListener('close', this.finish);
    dialog.addEventListener('click', this.onBackdrop);
  }

  open({ restoreFocus = this.trigger } = {}) {
    if (this.destroyed || this.options.destroyed || this.dialog.open) return false;
    this.restoreFocus = null;
    this.finish();
    this.prepare();
    this.options.hideTip();
    this.restoreFocus = restoreFocus;
    this.wasHeld = this.options.orrery.held;
    this.holding = true;
    this.options.orrery.hold(true);
    this.dialog.showModal();
    this.dialog.scrollTop = 0;
    this.dialog.querySelector('h1').focus({ preventScroll: true });
    return true;
  }

  onOpen = () => { this.open(); };
  onBackdrop = event => { if (event.target === this.dialog) this.close(); };

  finish = () => {
    if (this.dialog.open || !this.holding) return;
    this.holding = false;
    const { options, dialog } = this;
    if (!this.wasHeld && !document.querySelector('dialog[open]')) options.orrery.hold(false);
    const restore = this.restoreFocus;
    this.restoreFocus = null;
    const active = document.activeElement;
    const unclaimed = active === document.body || active === this.trigger || active === restore
      || active === options.trigger || dialog.contains(active);
    if (!this.destroyed && !options.destroyed && restore && unclaimed) {
      // Intro can open the asteroid glossary while Options is hidden; preserve
      // its explicit return target instead of always focusing the disclosure.
      const target = options.panel.hidden && options.panel.contains(restore) ? options.trigger : restore;
      target.focus();
    }
  };

  close(restoreFocus = true) {
    if (!restoreFocus) this.restoreFocus = null;
    if (this.dialog.open) this.dialog.close();
    this.finish();
  }

  destroy() {
    this.destroyed = true;
    this.close(false);
    this.trigger.removeEventListener('click', this.onOpen);
    this.dialog.removeEventListener('close', this.finish);
    this.dialog.removeEventListener('click', this.onBackdrop);
  }
}
