import * as dat from "dat.gui";

let nextPanelId = 0;

export default class Options {
  constructor(orrery) {
    this.orrery = orrery;

    // Controls
    this.element = document.createElement("div");
    this.element.className = "orrery-options";
    this.trigger = document.createElement("button");
    this.trigger.type = "button";
    this.trigger.className = "orrery-options-trigger";
    this.indicator = document.createElement("span");
    this.indicator.className = "orrery-options-indicator";
    this.indicator.setAttribute("aria-hidden", "true");
    this.indicator.textContent = "[+]";
    this.trigger.append(this.indicator, " options");
    this.trigger.setAttribute("aria-label", "Options");
    this.trigger.setAttribute("aria-expanded", "false");
    this.panel = document.createElement("section");
    this.panel.className = "orrery-options-panel";
    this.panel.id = `orrery-options-${++nextPanelId}`;
    this.panel.setAttribute("aria-label", "Options");
    this.panel.hidden = true;
    this.trigger.setAttribute("aria-controls", this.panel.id);
    this.element.append(this.trigger, this.panel);
    document.body.appendChild(this.element);
    this.gui = new dat.GUI({ hideable: false, autoPlace: false });
    this.panel.appendChild(this.gui.domElement);
    this.rendererState = { renderer: this.orrery.rendererId };
    this.renderer = this.gui.add(this.rendererState, "renderer",
      Object.fromEntries(Object.entries(orrery.rendererRegistry).map(([id, entry]) => [entry.label, id]))).name("Renderer");
    this.renderer.domElement.closest("li").classList.add("orrery-renderer-option");
    this.rendererSelect = this.renderer.domElement.querySelector("select");
    this.rendererSelect.setAttribute("aria-label", "Renderer");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose renderer";
    placeholder.disabled = true;
    this.rendererSelect.prepend(placeholder);
    this.addHint(this.renderer, "Switch views while keeping the current date and speed.", this.rendererSelect);
    this.renderer.onChange(id => { if (id) void this.orrery.switchRenderer(id); });
    const speed = this.speed = this.gui.add(this.orrery, "jedDelta", -8, 8).name("speed");
    const input = speed.domElement.querySelector("input");
    input.setAttribute("aria-label", "Playback speed");
    input.title = "0 pauses; negative reverses. 1 = 60 days per second.";
    this.addHint(speed, input.title, input);

    this.pixelRatio = this.gui.add(this.orrery, "pixelRatio", { "1×": "1", "2×": "2" }).name("DPR");
    this.pixelRatioSelect = this.pixelRatio.domElement.querySelector("select");
    this.pixelRatioSelect.setAttribute("aria-label", "Rendering pixel ratio");
    this.pixelRatioSelect.title = "Rendering resolution. 2× is sharper but requires more graphics processing.";
    this.addHint(this.pixelRatio, this.pixelRatioSelect.title, this.pixelRatioSelect);
    this.updatePixelRatio();
    try { this.mountRenderer(); }
    catch (error) { this.destroy(); throw error; }
    this.trigger.addEventListener("click", this.onToggle);
    document.addEventListener("pointerdown", this.onOutsidePointer, true);
    document.addEventListener("keydown", this.onKeyDown);
  }

  updateRenderer() {
    const focused = document.activeElement === this.rendererSelect;
    this.rendererState.renderer = this.orrery.renderer ? this.orrery.rendererId : "";
    this.renderer.updateDisplay();
    // dat.gui skips focused selects; recovery still needs a truthful value.
    this.rendererSelect.value = this.rendererState.renderer;
    this.speed?.updateDisplay();
    this.rendererSelect.disabled = !!this.orrery.switching;
    this.panel.setAttribute("aria-busy", String(!!this.orrery.switching));
    if (focused && this.rendererSelect.disabled) {
      this.restoreRendererFocus = true;
      this.trigger.focus();
    } else if (this.restoreRendererFocus && !this.rendererSelect.disabled) {
      if (!this.panel.hidden && document.activeElement === this.trigger) this.rendererSelect.focus();
      this.restoreRendererFocus = false;
    }
  }

  revealStatus(status) {
    if (this.panel.hidden) return;
    const panel = this.panel.getBoundingClientRect(), feedback = status.getBoundingClientRect();
    if (panel.left < feedback.right && panel.right > feedback.left
      && panel.top < feedback.bottom && panel.bottom > feedback.top) this.setOpen(false);
  }

  unmountRenderer() {
    const focused = this.rendererFolder?.domElement.contains(document.activeElement);
    this.disposeRendererControls?.();
    this.disposeRendererControls = null;
    if (this.rendererFolder) this.gui.removeFolder(this.rendererFolder);
    this.rendererFolder = null;
    if (focused) this.trigger.focus();
  }

  mountRenderer() {
    this.unmountRenderer();
    const id = this.orrery.rendererId, entry = this.orrery.rendererRegistry[id];
    if (!entry.buildOptions) return;
    const folder = this.rendererFolder = this.gui.addFolder(entry.label);
    folder.domElement.classList.add("orrery-renderer-settings");
    // Builders edit their own model; the setter validates before touching App
    // or graphics. Their cleanup owns any listeners beyond dat.gui controls.
    this.disposeRendererControls = entry.buildOptions({ gui: folder,
      values: { ...this.orrery.rendererOptions[id] },
      setOptions: changes => this.orrery.setRendererOptions(id, changes),
      addHint: (controller, text, input) => this.addHint(controller, text, input) });
    if (!folder.__controllers.length && !Object.keys(folder.__folders).length) this.unmountRenderer();
    else folder.open();
  }

  addHint(controller, text, input) {
    const hint = document.createElement("p");
    hint.className = "orrery-options-hint";
    hint.id = `${this.panel.id}-${controller.property}-hint`;
    hint.textContent = text;
    controller.domElement.closest("li").appendChild(hint);
    input.setAttribute("aria-describedby", hint.id);
  }

  setOpen(open, restoreFocus = true) {
    const hadFocus = this.panel.contains(document.activeElement);
    this.panel.hidden = !open;
    this.indicator.textContent = open ? "[-]" : "[+]";
    this.trigger.setAttribute("aria-expanded", String(open));
    if (open) (this.rendererSelect.disabled ? this.speed.domElement.querySelector("input") : this.rendererSelect).focus();
    else if (restoreFocus && hadFocus) this.trigger.focus();
  }

  onToggle = () => { this.setOpen(this.panel.hidden); };

  onOutsidePointer = event => {
    if (!this.panel.hidden && !this.element.contains(event.target)) this.setOpen(false);
  };

  onKeyDown = event => {
    if (event.key !== "Escape" || this.panel.hidden) return;
    event.preventDefault();
    this.setOpen(false, false);
    this.trigger.focus();
  };

  updatePixelRatio() {
    const available = window.devicePixelRatio >= 2;
    this.pixelRatioSelect.value = this.orrery.pixelRatio;
    this.pixelRatio.domElement.closest("li").style.display = available ? "" : "none";
    if (!available && document.activeElement === this.pixelRatioSelect) {
      this.gui.domElement.querySelector("input").focus();
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.trigger.removeEventListener("click", this.onToggle);
    document.removeEventListener("pointerdown", this.onOutsidePointer, true);
    document.removeEventListener("keydown", this.onKeyDown);
    this.unmountRenderer();
    this.gui.destroy();
    this.element.remove();
  }
}
