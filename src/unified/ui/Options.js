import { formatIsoDay } from "../../js/utils.js";
import { lastDate, hasCoverage } from "../comets/model.js";
import * as dat from "dat.gui";
import { DEFAULT_POPULATION_PRESET, POPULATION_PRESET_OPTIONS, legendGroups, populationHint } from "../catalog/population.js";

const SPEED_HINT = "Time scale: 1 = 60 days/s. 0 pauses; negative reverses.";

export const SPEED_LIVE_HINT = "Real time: one second per second. 0 pauses; negative reverses.";

let nextPanelId = 0;

export default class Options {
  constructor(orrery) {
    this.orrery = orrery;
    this.hints = new Set();
    this.hintId = 0;

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
      Object.fromEntries(Object.entries(orrery.rendererRegistry).map(([id, entry]) => [entry.label, id]))).name("renderer");
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

    this.pixelRatio = this.gui.add(this.orrery, "pixelRatio", { "1×": "1", "2×": "2" }).name("DPR");
    this.pixelRatioSelect = this.pixelRatio.domElement.querySelector("select");
    this.pixelRatioSelect.setAttribute("aria-label", "Rendering pixel ratio");
    this.pixelRatioSelect.title = "Pixel density: 2× is sharper but uses more GPU.";
    this.addHint(this.pixelRatio, this.pixelRatioSelect.title, this.pixelRatioSelect);
    this.updatePixelRatio();
    this.addSection("Rendering", this.renderer);
    this.playbackHeading = this.addSection("Playback", this.pixelRatio, true);

    const speed = this.speed = this.gui.add(this.orrery, "jedDelta", -8, 8).name("speed");
    const input = this.speedInput = speed.domElement.querySelector("input");
    input.setAttribute("aria-label", "Playback speed");
    this.speedHelp = this.addHint(speed, SPEED_HINT, input);
    this.speedHint = document.createElement("p");
    this.speedHint.className = "orrery-options-hint";
    this.speedHint.id = `${this.panel.id}-live-speed`;
    speed.domElement.closest("li").append(this.speedHint);
    this.speedRow = speed.domElement.closest("li");
    this.speedLive = null;
    this.setSpeedLive(this.orrery.holdAtPresent && this.orrery.followingPresent && this.orrery.jedDelta > 0);

    this.present = this.gui.add(this.orrery, "holdAtPresent").name("real time");
    this.presentInput = this.present.domElement.querySelector("input");
    this.presentInput.setAttribute("aria-label", "Real time");
    this.presentInput.title = "The date runs forward only until today, then stays on the current time. Remembered in this browser.";
    this.addHint(this.present, this.presentInput.title, this.presentInput);
    this.confineCheckbox(this.present);
    this.addSection("Planets", this.present, true);

    this.planetLabels = this.gui.add(this.orrery, "planetLabels",
      { Off: "off", "Earth only": "earth", "All planets": "all" }).name("labels");
    this.planetLabelsSelect = this.planetLabels.domElement.querySelector("select");
    this.planetLabelsSelect.setAttribute("aria-label", "Planet labels");
    this.describeControl(this.planetLabels, this.planetLabelsSelect, "Show labels for Earth, all planets, or none.");

    this.planetOrbits = this.gui.add(this.orrery, "planetOrbits").name("orbits");
    this.planetOrbitsInput = this.planetOrbits.domElement.querySelector("input");
    this.planetOrbitsInput.setAttribute("aria-label", "Planet orbits");
    this.describeControl(this.planetOrbits, this.planetOrbitsInput, "Show or hide planetary orbit lines.");
    this.confineCheckbox(this.planetOrbits);

    this.asteroids = this.gui.add(this.orrery, "asteroidsShown").name("asteroids");
    this.asteroids.domElement.querySelector("input").setAttribute("aria-label", "Show asteroids");
    this.confineCheckbox(this.asteroids);
    this.makeSectionToggle(this.asteroids, "Asteroids");

    this.population = this.gui.add(this.orrery, "populationPreset", POPULATION_PRESET_OPTIONS).name("groups");
    this.populationSelect = this.population.domElement.querySelector("select");
    this.populationSelect.setAttribute("aria-label", "Minor-planet groups");
    this.setPopulationHint(this.orrery.populationPreset ?? DEFAULT_POPULATION_PRESET);
    this.population.onChange(value => this.setPopulationHint(value));
    this.mountGlossary();

    this.colorize = this.gui.add(this.orrery, "colorizeGroups").name("colors");
    this.colorizeInput = this.colorize.domElement.querySelector("input");
    this.colorizeInput.setAttribute("aria-label", "Group colors");
    this.colorizeInput.title = "Color the shown groups by orbit. The belt stays gray on All; the belt presets paint its zones.";
    this.addHint(this.colorize, this.colorizeInput.title, this.colorizeInput);
    this.confineCheckbox(this.colorize);

    this.mountComets();

    try { this.mountRenderer(); }
    catch (error) { this.destroy(); throw error; }
    this.trigger.addEventListener("click", this.onToggle);
    document.addEventListener("pointerdown", this.onOutsidePointer, true);
    document.addEventListener("keydown", this.onKeyDown);
    this.panel.addEventListener("scroll", this.placeTip);
    window.addEventListener("resize", this.placeTip);
  }

  mountComets() {
    const toggle = this.cometToggle = this.gui.add(this.orrery, "cometsShown").name("comets");
    const input = toggle.domElement.querySelector("input");
    input.setAttribute("aria-label", "Show comets");
    this.confineCheckbox(toggle);
    this.makeSectionToggle(toggle, "Comets");
    this.addHint(toggle, "Comets from the OrreryData catalogue. Positions and paths use NASA/JPL Horizons predictions from 1980 to 2099; uncertainty grows away from observations.", input);
    this.panelCometFeedback = this.createCometFeedback();

    this.cometRows = [];
    this.cometChoices = {};
    this.mountCometChooser();
    const statusRow = document.createElement("li");
    statusRow.className = "orrery-comet-status";
    statusRow.append(this.panelCometFeedback.status);
    this.gui.__ul.append(statusRow);
    this.cometRows.push(statusRow);
    const paths = this.gui.add(this.orrery, "cometPaths").name("paths");
    paths.domElement.querySelector("input").setAttribute("aria-label", "Comet paths");
    this.confineCheckbox(paths);
    this.cometRows.push(paths.domElement.closest("li"));
    // Native buttons supply keyboard semantics absent from dat.gui functions.
    const row = document.createElement("li");
    row.className = "orrery-comet-actions";
    this.cometFocus = document.createElement("button");
    this.cometFocus.type = "button";
    this.cometFocus.className = "orrery-glossary-close";
    this.cometFocus.textContent = "Fit selected comets";
    this.cometFocus.onclick = () => this.orrery.focusComets();
    row.append(this.cometFocus, this.panelCometFeedback.retry);
    this.gui.__ul.append(row);
    this.cometRows.push(row);
    this.updateComets();
  }

  // The chooser edits the shared selection; closing it does not commit or cancel.
  mountCometChooser() {
    const row = document.createElement("li");
    row.className = "orrery-comet-summary";
    this.cometSummary = document.createElement("span");
    const trigger = this.cometChoose = document.createElement("button");
    trigger.type = "button";
    trigger.textContent = "Choose…";
    trigger.className = "orrery-glossary-trigger";
    trigger.setAttribute("aria-haspopup", "dialog");
    row.append(this.cometSummary, trigger);
    this.gui.__ul.append(row);
    this.cometRows.push(row);

    const dialog = this.cometDialog = document.createElement("dialog");
    dialog.id = `${this.panel.id}-comets`;
    dialog.className = "orrery-glossary orrery-comet-chooser";
    trigger.setAttribute("aria-controls", dialog.id);
    const title = document.createElement("h1");
    title.id = `${dialog.id}-title`;
    title.className = "orrery-dialog-title";
    title.tabIndex = -1;
    title.textContent = "Choose comets";
    dialog.setAttribute("aria-labelledby", title.id);
    this.cometDialogSummary = document.createElement("p");
    this.cometChoiceList = document.createElement("div");
    this.cometChoiceList.className = "orrery-comet-choice-list";
    this.chooserCometFeedback = this.createCometFeedback();
    const done = this.cometDone = document.createElement("button");
    done.type = "button";
    done.className = "orrery-glossary-close";
    done.textContent = "Done";
    done.onclick = () => this.closeCometChooser();
    const header = document.createElement("header");
    header.append(title, this.cometDialogSummary);
    const footer = document.createElement("footer");
    footer.append(this.chooserCometFeedback.retry, done);
    const body = this.cometChooserBody = document.createElement("div");
    body.className = "orrery-comet-chooser-body";
    body.append(this.chooserCometFeedback.status, this.cometChoiceList);
    dialog.append(header, body, footer);
    document.body.append(dialog);
    trigger.onclick = () => {
      if (this.destroyed || dialog.open) return;
      this.finishCometChooser();
      this.cometClosingHandled = false;
      this.cometWasHeld = this.orrery.held;
      this.cometRestoreFocus = true;
      this.hideTip();
      this.orrery.hold(true);
      dialog.showModal();
      this.cometChooserBody.scrollTop = 0;
      title.focus({ preventScroll: true });
    };
    dialog.onclick = event => { if (event.target === dialog) this.closeCometChooser(); };
    dialog.oncancel = event => { event.preventDefault(); this.closeCometChooser(); };
    dialog.onclose = () => this.finishCometChooser();
  }

  finishCometChooser() {
    const dialog = this.cometDialog;
    if (dialog.open || this.cometClosingHandled !== false) return;
    this.cometClosingHandled = true;
    // Release only the hold this chooser introduced. Another open modal owns its hold.
    if (!this.cometWasHeld && !document.querySelector("dialog[open]")) this.orrery.hold(false);
    const active = document.activeElement;
    const focusUnclaimed = active === document.body || active === this.cometChoose
      || active === this.trigger || dialog.contains(active);
    if (!this.destroyed && this.cometRestoreFocus && focusUnclaimed) {
      const restore = this.panel.hidden ? this.trigger : this.orrery.cometsShown ? this.cometChoose
        : this.cometToggle.domElement.querySelector("input");
      restore.focus();
    }
  }

  closeCometChooser(restoreFocus = true) {
    if (!this.cometDialog?.open) return;
    this.cometRestoreFocus = restoreFocus && this.cometDialog.contains(document.activeElement);
    this.cometDialog.close();
    // Finish synchronously so a rapid reopen cannot inherit our previous hold.
    this.finishCometChooser();
  }

  createCometFeedback() {
    const status = document.createElement("p");
    status.className = "orrery-options-hint";
    status.setAttribute("role", "status");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "orrery-glossary-close";
    retry.textContent = "Retry comet data";
    retry.onclick = () => { void this.orrery.loadComets(); };
    return { status, retry };
  }

  rebuildCometChoices() {
    const focusedId = document.activeElement?.dataset?.cometId;
    this.cometChoiceList.replaceChildren();
    this.cometChoices = {};
    for (const comet of this.orrery.cometCatalogue) {
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.dataset.cometId = comet.id;
      checkbox.setAttribute("aria-label", `Show ${comet.name}`);
      checkbox.onchange = () => {
        this.orrery.cometIds = this.orrery.cometCatalogue
          .filter(item => item.id === comet.id ? checkbox.checked : this.orrery.cometIds.includes(item.id))
          .map(item => item.id);
        this.updateComets();
      };
      const name = document.createElement("span");
      name.textContent = comet.name;
      label.append(checkbox, name);
      this.cometChoiceList.append(label);
      this.cometChoices[comet.id] = checkbox;
    }
    if (focusedId && this.cometDialog.open) {
      (this.cometChoices[focusedId] ?? this.cometDialog.querySelector("h1")).focus();
    }
  }

  updateComets() {
    if (!this.panelCometFeedback) return;
    const app = this.orrery, ids = app.cometIds;
    const feedback = [this.panelCometFeedback, this.chooserCometFeedback];
    const focusedRetry = feedback.find(view => view.retry === document.activeElement)?.retry;
    if (this.cometCatalogue !== app.cometCatalogue) {
      this.cometCatalogue = app.cometCatalogue;
      this.rebuildCometChoices();
      this.cometDisplayKey = null;
    }
    let ready = 0, loading = 0, failed = 0, usable = 0, firstSeries;
    for (const id of ids) {
      const series = app.cometData?.[id];
      if (series) { ready++; firstSeries ??= series; }
      if (hasCoverage(series, app.jed)) usable++;
      if (app.cometStates?.[id] === 'loading') loading++;
      if (app.cometStates?.[id] === 'error') failed++;
    }
    const key = [ready, loading, failed, usable, firstSeries?.start, firstSeries && lastDate(firstSeries),
      app.cometDiscoveryState, app.cometSelectionNotice, app.cometsShown, !!app.switching, ...ids].join("|");
    if (key === this.cometDisplayKey) return;
    this.cometDisplayKey = key;
    let status = "";
    if (app.cometsShown) {
      if (app.cometDiscoveryState === 'loading') status = 'Loading comet catalogue…';
      else if (app.cometDiscoveryState === 'error') status = 'Could not load comet catalogue. Retry below or reload the page.';
      else if (!ids.length) status = "Choose a comet to show.";
      else if (loading || failed) status = `${ready} of ${ids.length} comets ready.`
        + (loading ? ` Loading ${loading}…` : '')
        + (failed ? ` Could not load ${failed}. Retry below. If it still fails, reload the page to check for updated comet data.` : '');
      else if (ready) {
        const series = firstSeries;
        if (!usable) status = `Comets are unavailable at this date. Choose ${formatIsoDay(series.start)} to ${formatIsoDay(lastDate(series))}.`;
      }
    }
    if (app.cometsShown && ready && !usable && (loading || failed)) {
      const series = firstSeries;
      status += ` Loaded comets are unavailable at this date. Choose ${formatIsoDay(series.start)} to ${formatIsoDay(lastDate(series))}.`;
    }
    if (app.cometsShown && app.cometCatalogue.some(entry => entry.usesDefaultWindow && ids.includes(entry.id))) {
      status += ' Comets without a known display period use a 10-year trajectory window, limited to available data.';
    }
    if (app.cometsShown && app.cometSelectionNotice) status += ` ${app.cometSelectionNotice}`;
    for (const row of this.cometRows) row.hidden = !app.cometsShown;
    for (const view of feedback) {
      if (view.status.textContent !== status) view.status.textContent = status;
      view.status.hidden = !status;
      view.retry.hidden = !failed && app.cometDiscoveryState !== 'error';
    }
    this.cometFocus.disabled = !app.cometsShown || !usable || !!app.switching;
    const count = app.cometDiscoveryState === 'ready' ? `${ids.length}/${app.cometCatalogue.length}` : `${ids.length}`;
    this.cometSummary.textContent = this.cometDialogSummary.textContent = `${count} selected`;
    this.cometChoose.disabled = !app.cometCatalogue.length;
    for (const [id, checkbox] of Object.entries(this.cometChoices)) checkbox.checked = ids.includes(id);
    if (!app.cometsShown && this.cometDialog.open) this.closeCometChooser();
    if (focusedRetry && !focusedRetry.getClientRects().length) {
      const candidates = this.cometDialog.open ? [this.cometDone] : this.panel.hidden ? [this.trigger]
        : [this.cometFocus, this.cometChoose, this.cometToggle.domElement.querySelector("input"), this.trigger];
      candidates.find(element => !element.disabled && element.getClientRects().length)?.focus();
    }
  }

  updateRenderer() {
    const focused = document.activeElement === this.rendererSelect;
    this.rendererState.renderer = this.orrery.renderer ? this.orrery.rendererId : "";
    this.renderer.updateDisplay();
    // dat.gui skips focused selects; recovery still needs a truthful value.
    this.rendererSelect.value = this.rendererState.renderer;
    this.speed?.updateDisplay();
    this.population?.updateDisplay();
    this.colorize?.updateDisplay();
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
    this.hideTip();
    for (const hint of this.hints) {
      if (this.rendererFolder?.domElement.contains(hint.button)) {
        hint.tip.remove();
        this.hints.delete(hint);
      }
    }
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
    this.playbackHeading.before(folder.domElement.parentElement);
    // Builders edit their own model; the setter validates before touching App
    // or graphics. Their cleanup owns any listeners beyond dat.gui controls.
    this.disposeRendererControls = entry.buildOptions({ gui: folder,
      values: { ...this.orrery.rendererOptions[id] },
      setOptions: changes => this.orrery.setRendererOptions(id, changes),
      addHint: (controller, text, input) => this.addHint(controller, text, input) });
    if (!folder.__controllers.length && !Object.keys(folder.__folders).length) this.unmountRenderer();
    else folder.open();
  }

  addSection(title, controller, after = false) {
    const row = document.createElement("li");
    row.className = "orrery-options-section";
    const heading = document.createElement("h2");
    heading.textContent = title;
    row.append(heading);
    const anchor = controller.domElement.closest("li");
    if (after) anchor.after(row); else anchor.before(row);
    return row;
  }

  makeSectionToggle(controller, title) {
    const row = controller.domElement.closest("li");
    row.classList.add("orrery-options-section");
    const label = row.querySelector(".property-name");
    label.textContent = title;
    label.setAttribute("role", "heading");
    label.setAttribute("aria-level", "2");
  }

  confineCheckbox(controller) {
    const row = controller.domElement.closest("li");
    // dat.gui toggles a checkbox from a click anywhere on the row.
    row.addEventListener("click", event => {
      if (event.target.closest("input, .property-name, .orrery-options-info")) return;
      event.stopImmediatePropagation();
    }, true);
  }

  // While the wall clock drives the date, the slider value is not the rate.
  // The row dims but stays live: 0 still pauses and a negative speed rewinds.
  setSpeedLive(live) {
    live = !!live;
    if (this.destroyed || live === this.speedLive) return;
    this.speedLive = live;
    this.speedRow.classList.toggle("orrery-options-inactive", live);
    this.speedHint.textContent = live ? SPEED_LIVE_HINT : "";
    this.speedHint.hidden = !live;
    this.speedHelp.textContent = live ? SPEED_LIVE_HINT : SPEED_HINT;
    this.placeTip();
  }

  describeControl(controller, input, text) {
    const description = document.createElement("span");
    description.id = `${this.panel.id}-description-${++this.hintId}`;
    description.hidden = true;
    description.textContent = text;
    controller.domElement.closest("li").append(description);
    input.setAttribute("aria-describedby", description.id);
  }

  addHint(controller, text, input) {
    const tip = document.createElement("div");
    tip.className = "orrery-options-tip";
    tip.id = `${this.panel.id}-hint-${++this.hintId}`;
    tip.setAttribute("role", "tooltip");
    tip.textContent = text;
    tip.hidden = true;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "orrery-options-info";
    button.setAttribute("aria-label", `About ${input.getAttribute("aria-label") || controller.property}`);
    button.setAttribute("aria-describedby", tip.id);
    const icon = document.createElement("span");
    icon.textContent = "i";
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);
    controller.domElement.closest("li").querySelector(":scope > div").append(button);
    document.body.append(tip);
    input.setAttribute("aria-describedby", tip.id);
    input.removeAttribute("title");
    const hint = { button, tip };
    this.hints.add(hint);
    button.onpointerenter = event => {
      clearTimeout(this.tipTimer);
      if (event.pointerType === "mouse" && !this.tipPinned) this.showTip(hint);
    };
    button.onpointerleave = event => {
      if (event.pointerType === "mouse" && !this.tipPinned && document.activeElement !== button) this.deferHideTip();
    };
    button.onfocus = () => { if (this.activeTip !== hint) this.showTip(hint); };
    button.onblur = event => {
      // Non-focusable tooltip text blurs the button; keep a pinned tip selectable.
      // Outside pointer presses close it in onOutsidePointer; Tab has a related target.
      if (!this.tipPinned || (event.relatedTarget && !tip.contains(event.relatedTarget))) this.hideTip();
    };
    button.onclick = event => {
      event.stopPropagation();
      if (this.activeTip === hint && this.tipPinned) this.hideTip();
      else this.showTip(hint, true);
    };
    tip.onpointerenter = () => clearTimeout(this.tipTimer);
    tip.onpointerleave = () => { if (!this.tipPinned && document.activeElement !== button) this.deferHideTip(); };
    return tip;
  }

  deferHideTip() {
    clearTimeout(this.tipTimer);
    this.tipTimer = setTimeout(() => this.hideTip(), 120);
  }

  showTip(hint, pinned = false) {
    this.hideTip();
    this.activeTip = hint;
    this.tipPinned = pinned;
    hint.tip.hidden = false;
    hint.button.classList.add("is-open");
    this.placeTip();
  }

  hideTip = () => {
    clearTimeout(this.tipTimer);
    if (this.activeTip) {
      this.activeTip.tip.hidden = true;
      this.activeTip.button.classList.remove("is-open");
    }
    this.activeTip = null;
    this.tipPinned = false;
  };

  placeTip = () => {
    if (!this.activeTip) return;
    const { button, tip } = this.activeTip;
    const r = button.getBoundingClientRect(), panel = this.panel.getBoundingClientRect();
    if (this.panel.hidden || !button.isConnected || r.bottom <= panel.top || r.top >= panel.bottom) return this.hideTip();
    const width = document.documentElement.clientWidth, height = window.innerHeight;
    tip.style.width = `${Math.min(260, width - 16)}px`;
    tip.style.maxHeight = `${height - 16}px`;
    const box = tip.getBoundingClientRect(), side = panel.right + 10 + box.width <= width - 8;
    let x = side ? panel.right + 10 : Math.max(8, Math.min(r.right - box.width, width - box.width - 8));
    let y = side ? r.top - 4 : r.bottom + 4;
    if (!side && y + box.height > height - 8) y = r.top - box.height - 4;
    y = Math.max(8, Math.min(y, height - box.height - 8));
    tip.classList.toggle("is-side", side);
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.style.setProperty("--tip-notch", `${Math.max(4, Math.min(r.top + r.height / 2 - y - 4, box.height - 12))}px`);
  };

  setPopulationHint(preset) {
    const text = populationHint(preset);
    if (!this.populationHint) {
      this.populationHint = this.addHint(this.population, text, this.populationSelect);
      return;
    }
    this.populationHint.textContent = text;
    this.placeTip();
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
    trigger.textContent = "About these groups";
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", this.glossary.id);
    this.population.domElement.closest("li").querySelector(":scope > div").appendChild(trigger);
    this.paintGlossaryTitles();
    trigger.addEventListener("click", this.onOpenGlossary);
    this.glossary.addEventListener("close", this.onGlossaryClose);
    this.glossary.addEventListener("click", this.onGlossaryBackdrop);
    this.glossaryRestoreFocus = trigger;
  }

  // Each group title carries the legend dots of its preset; the ramp shows
  // three. Decorative only: the title text already names the group.
  paintGlossaryTitles() {
    for (const title of this.glossary.querySelectorAll("dt[data-preset]")) {
      if (title.querySelector(".orrery-swatch-dots")) continue;
      const colors = legendGroups(title.dataset.preset, true).flatMap(group => group.colors);
      if (!colors.length) continue;
      const dots = document.createElement("span");
      dots.className = "orrery-swatch-dots";
      dots.setAttribute("aria-hidden", "true");
      dots.append(...colors.map(color => {
        const dot = document.createElement("span");
        dot.className = "orrery-swatch";
        dot.style.backgroundColor = `#${color.toString(16).padStart(6, "0")}`;
        return dot;
      }));
      title.prepend(dots);
    }
  }

  openGlossary({ restoreFocus } = {}) {
    if (this.destroyed || !this.glossary || this.glossary.open) return false;
    this.glossaryRestoreFocus = restoreFocus ?? this.glossaryTrigger;
    // With group colors off the scene is gray, so the title dots would mislead.
    // The dialog is modal, so the option cannot change while it is open.
    this.hideTip();
    this.glossary.classList.toggle("orrery-glossary-gray", this.orrery.colorizeGroups === false);
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
    this.hideTip();
    this.panel.hidden = !open;
    this.indicator.textContent = open ? "[-]" : "[+]";
    this.trigger.setAttribute("aria-expanded", String(open));
    // Leave focus on the disclosure when opening. Programmatically focusing a
    // select invokes the full-screen native picker on iOS; keyboard users can
    // reach the first newly revealed control with Tab.
    if (!open) this.closeCometChooser(restoreFocus);
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
    if (this.activeTip?.tip.contains(event.target)) return;
    if (!this.activeTip?.button.contains(event.target)) this.hideTip();
    if (!this.panel.hidden && !this.element.contains(event.target)
      && !this.glossary?.contains(event.target) && !this.cometDialog?.contains(event.target)) this.setOpen(false);
  };

  onKeyDown = event => {
    if (event.key !== "Escape" || event.defaultPrevented) return;
    // Native dialogs own Escape even if a pointer-only tip has not disappeared yet.
    if (document.querySelector("dialog[open]")) { this.hideTip(); return; }
    const tipOwnsEscape = this.tipPinned || this.activeTip?.button === event.target
      || this.activeTip?.tip.contains(event.target);
    this.hideTip();
    if (tipOwnsEscape) { event.preventDefault(); return; }
    if (this.panel.hidden) return;
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
    this.hideTip();
    this.panel.removeEventListener("scroll", this.placeTip);
    window.removeEventListener("resize", this.placeTip);
    for (const hint of this.hints) hint.tip.remove();
    this.hints.clear();
    this.trigger.removeEventListener("click", this.onToggle);
    document.removeEventListener("pointerdown", this.onOutsidePointer, true);
    document.removeEventListener("keydown", this.onKeyDown);
    if (this.glossary?.open) this.glossary.close();
    this.glossaryTrigger?.removeEventListener("click", this.onOpenGlossary);
    this.glossary?.removeEventListener("close", this.onGlossaryClose);
    this.glossary?.removeEventListener("click", this.onGlossaryBackdrop);
    this.closeCometChooser(false);
    this.cometDialog?.remove();
    this.unmountRenderer();
    this.gui.destroy();
    this.element.remove();
  }
}
