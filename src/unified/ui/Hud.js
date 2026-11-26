import { formatIsoDay } from "../../js/utils.js";
import { UNIX_EPOCH_JULIAN_DATE } from "../../js/constants.js";
import { legendGroups } from "../catalog/population.js";
import Options from "./Options.js";
import Timeline from "./Timeline.js";

const countFormat = new Intl.NumberFormat("en-US");
const TEXT_NODE = 3;

export default class Hud {
  constructor(app) {
    this.timeline = new Timeline(app);
    this.date = this.timeline.date;
    this.now = document.getElementById("orrery-now");
    this.fps = document.getElementById("orrery-fps");
    this.count = document.getElementById("orrery-count");
    this.countUnit = document.getElementById("orrery-count-unit");
    this.countSeparator = document.getElementById("orrery-count-separator");
    this.swatches = document.getElementById("orrery-swatches");
    this.legendKey = "";
    this.readouts = this.date.closest(".orrery-readouts");
    if (this.readouts) this.readouts.hidden = true;
    this.lastDay = this.lastFps = this.lastCount = null;
    try { this.controls = new Options(app); }
    catch (error) {
      try { this.timeline.destroy(); }
      catch { /* Preserve the control-construction error. */ }
      throw error;
    }
  }

  update(jed, fps, count, ready) {
    if (this.readouts && this.readouts.hidden === ready) this.readouts.hidden = !ready;
    // Match Date's millisecond truncation, including pre-Unix-epoch dates.
    const milliseconds = Math.trunc((jed - UNIX_EPOCH_JULIAN_DATE) * 86400000);
    const day = Math.floor(milliseconds / 86400000);
    if (day !== this.lastDay) {
      this.writeDate(formatIsoDay(jed));
      this.lastDay = day;
    }
    if (fps !== this.lastFps) {
      this.fps.textContent = `${fps} FPS`;
      this.lastFps = fps;
    }
    if (count !== this.lastCount) {
      // SI-style digit groups; keep each count on one line.
      this.count.textContent = countFormat.format(count).replaceAll(",", "\u202f");
      this.count.setAttribute("aria-label", `${countFormat.format(count)} asteroids`);
      this.lastCount = count;
    }
  }

  setAsteroidVisibility(shown, showUnit) {
    for (const element of [this.count, this.countSeparator]) {
      if (element && element.hidden === shown) element.hidden = !shown;
    }
    const unitHidden = !shown || !showUnit;
    if (this.countUnit && this.countUnit.hidden !== unitHidden) this.countUnit.hidden = unitHidden;
  }

  // The date is a button whose text changes on nearly every frame of playback.
  // Rewrite its one text node in place: WebKit drops the click when the node
  // under the press leaves the document before the release, so replacing it
  // (as textContent does) kept Safari from opening the date editor mid-play.
  writeDate(text) {
    const label = this.date.firstChild;
    if (label && label.nodeType === TEXT_NODE && label === this.date.lastChild) label.data = text;
    else this.date.textContent = text;
  }

  setLegend(preset, colorize) {
    const groups = legendGroups(preset, colorize);
    const key = groups.map(group => group.name).join("|");
    if (key === this.legendKey) return;
    this.legendKey = key;
    if (!this.swatches) return;
    this.swatches.replaceChildren(...groups.map(group => {
      const item = document.createElement("span");
      item.className = "orrery-swatch-item";
      item.setAttribute("role", "listitem");
      // The dot carries the hue visually; say it for screen readers.
      item.setAttribute("aria-label", `${group.name}, ${group.colorName}`);
      const dots = document.createElement("span");
      dots.className = "orrery-swatch-dots";
      dots.append(...group.colors.map(color => {
        const dot = document.createElement("span");
        dot.className = "orrery-swatch";
        dot.style.backgroundColor = `#${color.toString(16).padStart(6, "0")}`;
        return dot;
      }));
      const name = document.createElement("span");
      name.className = "orrery-swatch-name";
      name.textContent = group.name;
      item.append(dots, name);
      return item;
    }));
    this.swatches.hidden = groups.length === 0;
  }

  updatePlayback(speed) { this.timeline.updatePlayback(speed); }

  updateNow(active) {
    // Reached after every rendered frame; skip the reflected write when unchanged.
    if (!this.now || this.now.hidden === !active) return;
    this.now.hidden = !active;
  }

  updatePresentCopy(enabled) { this.timeline.updatePresentCopy(enabled); }

  updateSpeedLive(live) { this.controls?.setSpeedLive(live); }

  destroy() { this.timeline.destroy(); this.controls.destroy(); }
}
