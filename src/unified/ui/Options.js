import { fromJED } from '../../js/utils.js';
import { searchComets } from '../comets/search.js';
import { hasCoverage } from "../comets/model.js";
import { assessmentMessage, CometFeedbackCache, catalogueHasCoverage, catalogueCoverage } from "../comets/feedback.js";
import * as dat from "dat.gui";
import { DEFAULT_POPULATION_PRESET, POPULATION_PRESET_OPTIONS, legendGroups, populationHint } from "../catalog/population.js";

const SPEED_HINT = "Time scale: 1 = 60 days/s. 0 pauses; negative reverses.";

export const SPEED_LIVE_HINT = "Real time: one second per second. 0 pauses; negative reverses.";

const COMET_PAGE_SIZE = 30;
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
    this.renderer.onChange(id => { if (id) void this.orrery.switchRenderer(id); });

    this.pixelRatio = this.gui.add(this.orrery, "pixelRatio", { "1×": "1", "2×": "2" }).name("pixel density");
    this.pixelRatioSelect = this.pixelRatio.domElement.querySelector("select");
    this.pixelRatioSelect.setAttribute("aria-label", "Rendering pixel ratio");
    this.pixelRatioSelect.title = "2× is sharper but uses more GPU.";
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

    this.colorize = this.gui.add(this.orrery, "colorizeGroups").name("colors");
    this.colorizeInput = this.colorize.domElement.querySelector("input");
    this.colorizeInput.setAttribute("aria-label", "Group colors");
    this.confineCheckbox(this.colorize);
    this.mountGlossary();

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
    this.panelCometFeedback = this.createCometFeedback();

    this.cometRows = [];
    this.cometChoices = {};
    this.mountCometChooser();
    const statusRow = document.createElement("li");
    statusRow.className = "orrery-comet-status";
    statusRow.append(this.panelCometFeedback.status, this.panelCometFeedback.retry);
    this.gui.__ul.append(statusRow);
    this.cometRows.push(statusRow);
    const paths = this.gui.add(this.orrery, "cometPaths").name("paths");
    paths.domElement.querySelector("input").setAttribute("aria-label", "Comet paths");
    this.confineCheckbox(paths);
    this.cometRows.push(paths.domElement.closest("li"));
    this.mountCometInfo();
    this.updateComets();
  }

  mountCometInfo() {
    const dialog = this.cometInfo = document.getElementById("orrery-comet-info");
    if (typeof dialog?.showModal !== "function") { this.cometInfo = null; return; }
    const trigger = this.cometInfoTrigger = this.addAboutLink("About comets", dialog);
    trigger.addEventListener("click", this.onOpenCometInfo);
    dialog.addEventListener("close", this.onCometInfoClose);
    dialog.addEventListener("click", this.onCometInfoBackdrop);
  }

  onOpenCometInfo = () => {
    if (this.destroyed || !this.cometInfo || this.cometInfo.open) return;
    // Native close events are queued. Finish the previous session before a
    // same-task reopen captures its hold as though it belonged to the caller.
    this.onCometInfoClose();
    this.hideTip();
    this.cometInfoHolding = true;
    this.cometInfoWasHeld = this.orrery.held;
    this.orrery.hold(true);
    this.cometInfo.showModal();
    this.cometInfo.scrollTop = 0;
    this.cometInfo.querySelector("h1").focus({ preventScroll: true });
  };

  onCometInfoBackdrop = event => {
    if (event.target === this.cometInfo) this.cometInfo.close();
  };

  onCometInfoClose = () => {
    if (this.cometInfo?.open || !this.cometInfoHolding) return;
    this.cometInfoHolding = false;
    if (!this.cometInfoWasHeld && !document.querySelector("dialog[open]")) this.orrery.hold(false);
    if (!this.destroyed && !this.panel.hidden) this.cometInfoTrigger.focus();
  };

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
    this.cometFocus = document.createElement("button");
    this.cometFocus.type = "button";
    this.cometFocus.className = "orrery-glossary-close";
    this.cometFocus.textContent = "Fit";
    this.cometFocus.setAttribute("aria-label", "Fit selected comets");
    this.cometFocus.onclick = () => this.orrery.focusComets();
    row.append(this.cometSummary, trigger, this.cometFocus);
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
    this.cometSearch = document.createElement("input");
    this.cometSearch.type = "search";
    this.cometSearch.setAttribute("aria-label", "Search comets by name or designation");
    this.cometSearch.oninput = () => {
      clearTimeout(this.cometSearchTimer);
      if (!this.cometSearch.value) this.changeCometView('selected');
      else this.cometSearchTimer = setTimeout(() => this.changeCometView('search'), 100);
    };
    this.cometClear = document.createElement("button");
    this.cometClear.className = "orrery-glossary-trigger";
    this.cometClear.textContent = "Clear selection";
    this.cometClear.onclick = () => {
      if (this.cometUndo) {
        const restored = this.cometUndo;
        this.cometUndo = null;
        this.orrery.restoreCometSelection(restored);
      } else {
        this.cometUndo = [...(this.orrery.rememberedCometIds ?? this.orrery.cometIds)];
        this.orrery.restoreCometSelection([]);
      }
      this.cometFeedbackCache = null;
      this.updateComets();
    };
    const summary = document.createElement("div");
    summary.className = "orrery-comet-selection-summary";
    summary.append(this.cometDialogSummary, this.cometClear);
    this.cometAssessmentLegend = document.createElement("p");
    this.cometAssessmentLegend.className = "orrery-comet-assessment-legend";
    this.cometAssessmentLegend.textContent = "— Trajectory not yet assessed";
    this.cometAssessmentLegend.hidden = true;
    header.append(title, this.cometSearch, summary, this.cometAssessmentLegend);
    const footer = document.createElement("footer");
    footer.append(this.chooserCometFeedback.status, this.chooserCometFeedback.retry, done);
    const body = this.cometChooserBody = document.createElement("div");
    body.className = "orrery-comet-chooser-body";
    body.append(this.cometChoiceList);
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
      this.cometUndo = null;
      this.cometSearch.value = "";
      this.changeCometView("selected");
      dialog.showModal();
      this.cometChooserBody.scrollTop = 0;
      title.focus({ preventScroll: true });
    };
    dialog.onclick = event => { if (event.target === dialog) this.closeCometChooser(); };
    dialog.oncancel = event => {
      event.preventDefault();
      if (this.cometSearch.value) { this.cometSearch.value = ""; this.changeCometView("selected"); }
      else this.closeCometChooser();
    };
    dialog.onclose = () => this.finishCometChooser();
  }

  finishCometChooser() {
    const dialog = this.cometDialog;
    if (dialog.open || this.cometClosingHandled !== false) return;
    this.cometClosingHandled = true;
    clearTimeout(this.cometSearchTimer);
    this.orrery.cometSelectionNotice = '';
    this.updateComets();
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
    retry.onclick = () => { this.cometRetried = true; void this.orrery.loadComets(); };
    return { status, retry };
  }

  changeCometView(mode, focus = false) {
    clearTimeout(this.cometSearchTimer);
    this.cometView = mode;
    this.cometLimit = COMET_PAGE_SIZE;
    this.cometSelectedSnapshot = [...this.orrery.cometIds];
    this.rebuildCometChoices();
    this.cometFeedbackCache = null;
    this.updateComets();
    this.cometChooserBody.scrollTop = 0;
    if (focus) (mode === 'selected' ? this.cometBrowse : Object.values(this.cometChoices).find(input => !input.disabled))?.focus();
  }

  rebuildCometChoices() {
    const focusedId = document.activeElement?.dataset?.cometId;
    const focusedBrowse = document.activeElement === this.cometBrowse;
    this.cometChoiceList.replaceChildren();
    this.cometChoices = {};
    const catalogue = this.orrery.cometCatalogue;
    if (this.cometRowCatalogue !== catalogue) {
      this.cometRowCatalogue = catalogue;
      this.cometRowCache = new Map();
    }
    const mode = this.cometView ?? 'selected';
    const selected = new Set(this.cometSelectedSnapshot ?? this.orrery.cometIds);
    const entries = mode === 'search' ? searchComets(catalogue, this.cometSearch.value)
      : mode === 'catalogue' ? catalogue : catalogue.filter(entry => selected.has(entry.id));
    const heading = document.createElement("div");
    heading.className = "orrery-comet-list-heading";
    heading.textContent = mode === 'search' ? (entries.length ? `${entries.length.toLocaleString('en')} matches` : 'No matches')
      : mode === 'catalogue' ? `Catalogue · ${catalogue.length.toLocaleString('en')} comets` : 'Selected';
    this.cometChoiceList.append(heading);
    if (mode === 'catalogue') {
      const back = document.createElement("button");
      back.className = "orrery-glossary-trigger";
      back.textContent = "Back to selected";
      back.onclick = () => this.changeCometView('selected', true);
      heading.append(back);
    }
    if (mode === 'selected' && !entries.length) this.cometChoiceList.append(Object.assign(document.createElement('p'), {textContent: 'No comets selected.'}));
    const limit = mode === 'selected' ? entries.length : (this.cometLimit ?? COMET_PAGE_SIZE);
    for (const comet of entries.slice(0, limit)) {
      const cached = this.cometRowCache.get(comet.id);
      if (cached) {
        this.cometChoiceList.append(cached.closest('label'));
        this.cometChoices[comet.id] = cached;
        continue;
      }
      const label = document.createElement("label");
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.cometEntry = comet;
      this.cometRowCache.set(comet.id, checkbox);
      checkbox.dataset.cometId = comet.id;
      checkbox.setAttribute("aria-label", `Show ${comet.name}`);
      checkbox.onchange = () => {
        this.cometUndo = null;
        const selected = new Set(this.orrery.cometIds);
        this.orrery.cometIds = this.orrery.cometCatalogue
          .filter(item => item.id === comet.id ? checkbox.checked : selected.has(item.id))
          .map(item => item.id);
        this.updateComets();
      };
      const name = document.createElement("span");
      name.textContent = comet.name;
      const state = document.createElement("small");
      state.id = `${this.cometDialog.id}-${encodeURIComponent(comet.id)}-state`;
      checkbox.setAttribute("aria-describedby", state.id);
      const detail = document.createElement("span");
      detail.className = "orrery-comet-detail";
      detail.append(name, state);
      const swatch = checkbox.cometSwatch = document.createElement("span");
      swatch.className = "orrery-comet-swatch";
      swatch.style.backgroundColor = `#${comet.color.toString(16).padStart(6, '0')}`;
      swatch.setAttribute("aria-hidden", "true");
      label.append(checkbox, detail, swatch);
      checkbox.cometStatus = state;
      this.cometChoiceList.append(label);
      this.cometChoices[comet.id] = checkbox;
    }
    if (mode === 'selected') {
      const browse = this.cometBrowse = document.createElement("button");
      browse.className = "orrery-glossary-trigger orrery-comet-browse";
      browse.textContent = `Browse catalogue · ${catalogue.length.toLocaleString('en')} comets`;
      browse.onclick = () => this.changeCometView('catalogue', true);
      this.cometChoiceList.append(browse);
    } else if (limit < entries.length) {
      const more = document.createElement("button");
      more.className = "orrery-glossary-trigger";
      more.textContent = `Load more · ${limit} of ${entries.length.toLocaleString('en')}`;
      more.onclick = () => {
        this.cometLimit = limit + COMET_PAGE_SIZE;
        this.rebuildCometChoices();
        this.cometFeedbackCache = null;
        this.updateComets();
        Object.values(this.cometChoices).slice(limit).find(input => !input.disabled)?.focus();
      };
      this.cometChoiceList.append(more);
    }
    if (focusedId && this.cometDialog.open) {
      (this.cometChoices[focusedId] ?? this.cometDialog.querySelector("h1")).focus();
    } else if (focusedBrowse && this.cometDialog.open) this.cometBrowse?.focus();
  }

  updateComets() {
    if (!this.panelCometFeedback) return;
    const app = this.orrery, ids = app.cometIds;
    const selectedIds = new Set(ids);
    this.cometFeedbackCache ??= new CometFeedbackCache();
    if (!this.cometFeedbackCache.changed(app)) return;
    const feedback = [this.panelCometFeedback, this.chooserCometFeedback];
    const focusedRetry = feedback.find(view => view.retry === document.activeElement)?.retry;
    if (this.cometUndo && app.cometSelection.ids?.length) this.cometUndo = null;
    const displayed = new Set(this.cometSelectedSnapshot ?? []);
    const added = this.cometView === 'selected' && ids.some(id => !displayed.has(id));
    if (added) this.cometSelectedSnapshot = [...new Set([...displayed, ...ids])];
    if (this.cometCatalogue !== app.cometCatalogue || added) {
      this.cometCatalogue = app.cometCatalogue;
      this.rebuildCometChoices();
    }
    let hasUnassessed = false;
    for (const [id, checkbox] of Object.entries(this.cometChoices)) {
      const data = app.cometData?.[id], state = app.cometStates?.[id];
      const entry = checkbox.cometEntry;
      const coverage = catalogueCoverage([entry]);
      const covered = catalogueHasCoverage(entry, app.jed);
      const selected = selectedIds.has(id);
      const text = !coverage ? assessmentMessage(entry, app.jed) : !covered ? 'No trajectory for this date'
        : selected && state === 'error' ? 'Could not load trajectory'
        : selected && state === 'loading' ? 'Loading…' : '';
      const unassessed = text === 'Trajectory not yet assessed';
      hasUnassessed ||= unassessed;
      checkbox.closest('label').classList.toggle('is-unassessed', unassessed);
      checkbox.closest('label').title = unassessed ? `${entry.name}: ${text}` : '';
      checkbox.disabled = !coverage && !selected;
      if (checkbox.cometStatus.textContent !== text) checkbox.cometStatus.textContent = text;
      checkbox.cometStatus.classList.toggle('is-error', selected && covered && state === 'error');
      checkbox.cometStatus.classList.toggle('is-loading', selected && covered && state === 'loading');
      checkbox.cometSwatch.hidden = !selected || !hasCoverage(data, app.jed);
    }
    this.cometAssessmentLegend.hidden = !hasUnassessed;
    let ready = 0, loading = 0, failed = 0, usable = 0;
    for (const id of ids) {
      const series = app.cometData?.[id];
      if (series) ready++;
      if (hasCoverage(series, app.jed)) usable++;
      if (app.cometStates?.[id] === 'loading') loading++;
      if (app.cometStates?.[id] === 'error') failed++;
    }
    let status = "";
    if (app.cometsShown) {
      if (app.cometDiscoveryState === 'loading') status = 'Loading comet catalogue…';
      else if (app.cometDiscoveryState === 'error') status = 'Could not load comet catalogue.';
      else if (!ids.length) status = "Choose a comet to show.";
      else if (loading || failed) status = (loading ? `${ready} of ${ids.length} ready. Loading ${loading}…` : '')
        + (failed ? ` Could not load ${failed}.` : '');
    }
    const selectedEntries = app.cometCatalogue.filter(entry => selectedIds.has(entry.id));
    const unavailable = selectedEntries.filter(entry => catalogueCoverage([entry]) && !catalogueHasCoverage(entry, app.jed)).length;
    const unpublished = selectedEntries.filter(entry => !catalogueCoverage([entry])).length;
    if (app.cometsShown && unpublished) status += ` ${unpublished} selected ${unpublished === 1 ? 'comet has' : 'comets have'} no published trajectory.`;
    if (app.cometsShown && unavailable) {
      status += unavailable === ids.length ? ' No trajectory for this date.'
        : ` ${unavailable} of ${ids.length} ${unavailable === 1 ? 'has' : 'have'} no trajectory for this date.`;
      if (unavailable === ids.length) {
        const range = catalogueCoverage(selectedEntries);
        const year = jd => fromJED(jd).getUTCFullYear();
        if (range) status += ` ${ids.length === 1 ? selectedEntries[0].name + ' covers' : 'Selected comets cover'} ${year(range[0])}–${year(range[1])}.`;
      }
    }
    if (app.cometsShown && app.cometCatalogue.some(entry => entry.usesDefaultWindow && catalogueCoverage([entry]) && selectedIds.has(entry.id))) {
      status += ' Comets without a known display period use a 10-year trajectory window, limited to available data.';
    }
    if (!loading && !failed && app.cometDiscoveryState === 'ready') this.cometRetried = false;
    if (this.cometRetried && (failed || app.cometDiscoveryState === 'error')) status += ' Reload the page if it keeps failing.';
    status = status.trim();
    if (app.cometsShown && app.cometSelectionNotice) status += ` ${app.cometSelectionNotice}`;
    for (const row of this.cometRows) row.hidden = !app.cometsShown;
    for (const view of feedback) {
      if (view.status.textContent !== status) view.status.textContent = status;
      view.status.hidden = !status;
      view.retry.hidden = !failed && app.cometDiscoveryState !== 'error';
    }
    this.cometFocus.disabled = !app.cometsShown || !usable || !!app.switching;
    this.cometSummary.textContent = this.cometDialogSummary.textContent = `${ids.length} selected`;
    this.cometClear.textContent = this.cometUndo ? 'Undo' : 'Clear selection';
    this.cometClear.disabled = !this.cometUndo && !(app.cometSelection.ids?.length || ids.length);
    this.cometSearch.placeholder = `Search ${app.cometCatalogue.length.toLocaleString('en')} comets`;
    this.cometChoose.disabled = !app.cometCatalogue.length;
    for (const [id, checkbox] of Object.entries(this.cometChoices)) checkbox.checked = selectedIds.has(id);
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

  addAboutLink(label, dialog) {
    const row = document.createElement("li");
    row.className = "orrery-about-row";
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "orrery-glossary-trigger";
    trigger.textContent = label;
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-controls", dialog.id);
    row.append(trigger);
    this.gui.__ul.append(row);
    return trigger;
  }

  updateGlossarySelection() {
    const preset = this.orrery.populationPreset ?? DEFAULT_POPULATION_PRESET;
    const label = Object.entries(POPULATION_PRESET_OPTIONS).find(([, value]) => value === preset)?.[0] ?? "All";
    const heading = document.createElement("strong");
    heading.textContent = this.orrery.asteroidsShown ? `Showing: ${label}.` : `Asteroids hidden. Selected: ${label}.`;
    this.glossary.querySelector("#orrery-glossary-selection")?.replaceChildren(heading, ` ${populationHint(preset)}`);
  }

  mountGlossary() {
    this.glossary = document.getElementById("orrery-glossary");
    this.glossaryTitle = document.getElementById("orrery-glossary-title");
    if (typeof this.glossary?.showModal !== "function" || !this.glossaryTitle) {
      this.glossary = null;
      return;
    }
    const trigger = this.glossaryTrigger = this.addAboutLink("About asteroids", this.glossary);
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
    this.updateGlossarySelection();
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
    if (!open && this.cometInfo?.open) this.cometInfo.close();
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
      && !this.glossary?.contains(event.target) && !this.cometDialog?.contains(event.target)
      && !this.cometInfo?.contains(event.target)) this.setOpen(false);
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
    clearTimeout(this.cometSearchTimer);
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
    if (this.cometInfo?.open) this.cometInfo.close();
    this.onCometInfoClose();
    this.cometInfoTrigger?.removeEventListener("click", this.onOpenCometInfo);
    this.cometInfo?.removeEventListener("close", this.onCometInfoClose);
    this.cometInfo?.removeEventListener("click", this.onCometInfoBackdrop);
    this.closeCometChooser(false);
    this.cometDialog?.remove();
    this.unmountRenderer();
    this.gui.destroy();
    this.element.remove();
  }
}
