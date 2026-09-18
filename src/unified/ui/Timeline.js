import { formatIsoDay, toJED } from "../../js/utils.js";

const interactive = target => target?.closest?.("button, a, input, select, textarea, dialog, [contenteditable='true']");

export default class Timeline {
  constructor(app) {
    this.app = app;
    this.playButton = document.getElementById("orrery-playback");
    this.playIndicator = document.getElementById("orrery-playback-indicator");
    this.date = document.getElementById("orrery-date");
    this.dialog = document.getElementById("orrery-date-dialog");
    this.form = document.getElementById("orrery-date-form");
    this.input = document.getElementById("orrery-date-input");
    this.error = document.getElementById("orrery-date-error");
    this.today = document.getElementById("orrery-date-today");
    this.beginning = document.getElementById("orrery-date-beginning");
    this.cancel = document.getElementById("orrery-date-cancel");
    this.resumeSpeed = app.jedDelta || 1.5;
    this.enabled = !!(this.playButton && this.playIndicator && this.date?.matches("button")
      && this.dialog && typeof this.dialog.showModal === "function" && this.form && this.input
      && this.error && this.today && this.beginning && this.cancel);
    if (!this.enabled) return;
    this.beginning.textContent = formatIsoDay(app.startJed);
    this.playButton.addEventListener("click", this.onTogglePlayback);
    this.date.addEventListener("click", this.onOpenDate);
    this.form.addEventListener("submit", this.onSubmitDate);
    this.today.addEventListener("click", this.onToday);
    this.beginning.addEventListener("click", this.onBeginning);
    this.cancel.addEventListener("click", this.onCancel);
    this.dialog.addEventListener("close", this.onDateClose);
    this.dialog.addEventListener("click", this.onBackdrop);
    document.addEventListener("keydown", this.onShortcut);
    this.updatePlayback(app.jedDelta);
  }

  updatePlayback(speed) {
    if (!this.enabled) return;
    if (speed !== 0) this.resumeSpeed = speed;
    const paused = speed === 0;
    this.playIndicator.textContent = paused ? "[⏵︎]" : "[⏸︎]";
    this.playButton.setAttribute("aria-label", paused
      ? (this.resumeSpeed < 0 ? "Resume reverse playback" : "Resume playback")
      : "Pause playback");
    this.playButton.title = `${this.playButton.getAttribute("aria-label")} (Space)`;
    this.playButton.dataset.state = paused ? "paused" : "playing";
  }

  togglePlayback() {
    if (this.app.jedDelta === 0) this.app.jedDelta = this.resumeSpeed || 1.5;
    else {
      this.resumeSpeed = this.app.jedDelta;
      this.app.jedDelta = 0;
    }
  }

  onTogglePlayback = () => { this.togglePlayback(); };

  onShortcut = event => {
    if (event.key !== " " || event.repeat || event.defaultPrevented
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || interactive(event.target) || document.querySelector("dialog[open]")) return;
    event.preventDefault();
    this.togglePlayback();
  };

  onOpenDate = () => {
    if (this.dialog.open) return;
    this.error.textContent = "";
    this.input.value = formatIsoDay(this.app.jed);
    this.app.hold(true);
    this.dialog.showModal();
    this.dialog.scrollTop = 0;
    this.input.focus();
  };

  commitDate(value) {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00.000Z`) : null;
    if (!date || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) {
      this.error.textContent = "Enter a valid UTC date.";
      this.input.focus();
      return;
    }
    this.applyJed(toJED(date));
  }

  applyJed(jed) {
    this.resumeSpeed = this.app.jedDelta || this.resumeSpeed;
    this.app.jedDelta = 0;
    this.app.jed = jed;
    this.dialog.close("apply");
  }

  onSubmitDate = event => {
    event.preventDefault();
    this.commitDate(this.input.value);
  };

  onToday = () => { this.commitDate(new Date().toISOString().slice(0, 10)); };
  onBeginning = () => { this.applyJed(this.app.startJed); };
  onCancel = () => { this.dialog.close("cancel"); };
  onBackdrop = event => { if (event.target === this.dialog) this.dialog.close("cancel"); };

  onDateClose = () => {
    this.app.hold(false);
    this.error.textContent = "";
    this.date.focus();
  };

  destroy() {
    if (!this.enabled || this.destroyed) return;
    this.destroyed = true;
    this.playButton.removeEventListener("click", this.onTogglePlayback);
    this.date.removeEventListener("click", this.onOpenDate);
    this.form.removeEventListener("submit", this.onSubmitDate);
    this.today.removeEventListener("click", this.onToday);
    this.beginning.removeEventListener("click", this.onBeginning);
    this.cancel.removeEventListener("click", this.onCancel);
    this.dialog.removeEventListener("close", this.onDateClose);
    this.dialog.removeEventListener("click", this.onBackdrop);
    document.removeEventListener("keydown", this.onShortcut);
    if (this.dialog.open) this.dialog.close();
  }
}
