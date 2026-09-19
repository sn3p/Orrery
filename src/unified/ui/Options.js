import * as dat from "dat.gui";
import { DEFAULT_POPULATION_PRESET, POPULATION_PRESET_OPTIONS, populationHint } from "../catalog/population.js";

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
    this.addHint(this.renderer, "Change renderer; time and options persist.", this.rendererSelect);
    this.renderer.onChange(id => { if (id) void this.orrery.switchRenderer(id); });
    const speed = this.speed = this.gui.add(this.orrery, "jedDelta", -8, 8).name("speed");
    const input = this.speedInput = speed.domElement.querySelector("input");
    input.setAttribute("aria-label", "Playback speed");
    input.title = "Time scale: 1 = 60 days/s; 0 pauses; negative reverses.";
    this.addHint(speed, input.title, input);

    this.planetLabels = this.gui.add(this.orrery, "planetLabels",
      { Off: "off", "Earth only": "earth", "All planets": "all" }).name("labels");
    this.planetLabelsSelect = this.planetLabels.domElement.querySelector("select");
    this.planetLabelsSelect.setAttribute("aria-label", "Planet labels");
    this.planetLabelsSelect.title = "Show labels for Earth, all planets, or none.";
    this.addHint(this.planetLabels, this.planetLabelsSelect.title, this.planetLabelsSelect);

    this.planetOrbits = this.gui.add(this.orrery, "planetOrbits").name("orbits");
    this.planetOrbitsInput = this.planetOrbits.domElement.querySelector("input");
    this.planetOrbitsInput.setAttribute("aria-label", "Planet orbits");
    this.planetOrbitsInput.title = "Show or hide planetary orbit lines.";
    this.addHint(this.planetOrbits, this.planetOrbitsInput.title, this.planetOrbitsInput);

    this.population = this.gui.add(this.orrery, "populationPreset", POPULATION_PRESET_OPTIONS).name("groups");
    this.populationSelect = this.population.domElement.querySelector("select");
    this.populationSelect.setAttribute("aria-label", "Minor-planet groups");
    this.setPopulationHint(this.orrery.populationPreset ?? DEFAULT_POPULATION_PRESET);
    this.population.onChange(value => this.setPopulationHint(value));
    this.mountGlossary();

    this.pixelRatio = this.gui.add(this.orrery, "pixelRatio", { "1×": "1", "2×": "2" }).name("DPR");
    this.pixelRatioSelect = this.pixelRatio.domElement.querySelector("select");
    this.pixelRatioSelect.setAttribute("aria-label", "Rendering pixel ratio");
    this.pixelRatioSelect.title = "Pixel density: 2× is sharper but uses more GPU.";
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
    this.population?.updateDisplay();
    this.rendererSelect.disabled = !!this.orrery.switching;
    this.panel.setAttribute("aria-busy", String(!!this.orrery.switching));
    if (focused && this.rendererSelect.disabled) {
      this.trigger.focus();
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
    return hint;
  }

  setPopulationHint(preset) {
    const text = populationHint(preset);
    this.populationSelect.title = text;
    if (!this.populationHint) {
      this.populationHint = this.addHint(this.population, text, this.populationSelect);
      return;
    }
    this.populationHint.textContent = text;
  }

  mountGlossary() {
    this.glossary = document.getElementById("orrery-glossary");
    this.glossaryTitle = document.getElementById("orrery-glossary-title");
    if (typeof this.glossary?.showModal !== "function" || !this.glossaryTitle) {
      this.glossary = null;
      return;
    }
    const trigger = this.glossaryTrigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "orrery-glossary-trigger";
    trigger.textContent = "What is this?";
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", this.glossary.id);
    this.population.domElement.closest("li").appendChild(trigger);
    trigger.addEventListener("click", this.onOpenGlossary);
    this.glossary.addEventListener("close", this.onGlossaryClose);
    this.glossary.addEventListener("click", this.onGlossaryBackdrop);
    this.glossaryRestoreFocus = trigger;
  }

  openGlossary({ restoreFocus } = {}) {
    if (this.destroyed || !this.glossary || this.glossary.open) return false;
    this.glossaryRestoreFocus = restoreFocus ?? this.glossaryTrigger;
    this.orrery.hold(true);
    this.glossary.showModal();
    this.glossary.scrollTop = 0;
    this.glossaryTitle.focus({ preventScroll: true });
    return true;
  }

  onOpenGlossary = () => { this.openGlossary(); };

  onGlossaryBackdrop = event => { if (event.target === this.glossary) this.glossary.close(); };

  onGlossaryClose = () => {
    this.orrery.hold(false);
    const restore = this.glossaryRestoreFocus;
    this.glossaryRestoreFocus = this.glossaryTrigger;
    if (!this.destroyed) restore?.focus?.();
  };

  setOpen(open, restoreFocus = true) {
    const hadFocus = this.panel.contains(document.activeElement);
    this.panel.hidden = !open;
    this.indicator.textContent = open ? "[-]" : "[+]";
    this.trigger.setAttribute("aria-expanded", String(open));
    // Leave focus on the disclosure when opening. Programmatically focusing a
    // select invokes the full-screen native picker on iOS; keyboard users can
    // reach the first newly revealed control with Tab.
    if (!open && this.glossary?.open) this.glossary.close();
    if (!open && restoreFocus && hadFocus) this.trigger.focus();
  }

  open() {
    if (this.destroyed) return false;
    this.setOpen(true);
    this.trigger.focus();
    return true;
  }

  onToggle = () => { this.setOpen(this.panel.hidden); };

  onOutsidePointer = event => {
    if (!this.panel.hidden && !this.element.contains(event.target)
      && !this.glossary?.contains(event.target)) this.setOpen(false);
  };

  onKeyDown = event => {
    if (event.key !== "Escape" || this.panel.hidden || event.target?.closest?.("dialog")) return;
    event.preventDefault();
    this.setOpen(false, false);
    this.trigger.focus();
  };

  updatePixelRatio() {
    const available = window.devicePixelRatio >= 2;
    this.pixelRatioSelect.value = this.orrery.pixelRatio;
    this.pixelRatio.domElement.closest("li").style.display = available ? "" : "none";
    if (!available && document.activeElement === this.pixelRatioSelect) {
      this.speedInput.focus();
    }
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.trigger.removeEventListener("click", this.onToggle);
    document.removeEventListener("pointerdown", this.onOutsidePointer, true);
    document.removeEventListener("keydown", this.onKeyDown);
    if (this.glossary?.open) this.glossary.close();
    this.glossaryTrigger?.removeEventListener("click", this.onOpenGlossary);
    this.glossary?.removeEventListener("close", this.onGlossaryClose);
    this.glossary?.removeEventListener("click", this.onGlossaryBackdrop);
    this.unmountRenderer();
    this.gui.destroy();
    this.element.remove();
  }
}
