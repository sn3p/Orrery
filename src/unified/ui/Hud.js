import { formatIsoDay } from "../../js/utils.js";
import { UNIX_EPOCH_JULIAN_DATE } from "../../js/constants.js";
import Options from "./Options.js";
import Timeline from "./Timeline.js";

const countFormat = new Intl.NumberFormat("en-US");

export default class Hud {
  constructor(app) {
    this.timeline = new Timeline(app);
    this.date = this.timeline.date;
    this.now = document.getElementById("orrery-now");
    this.fps = document.getElementById("orrery-fps");
    this.count = document.getElementById("orrery-count");
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
      this.date.textContent = formatIsoDay(jed);
      this.lastDay = day;
    }
    if (fps !== this.lastFps) {
      this.fps.textContent = `${fps} FPS`;
      this.lastFps = fps;
    }
    if (count !== this.lastCount) {
      // SI-style digit groups; keep each count on one line.
      this.count.textContent = countFormat.format(count).replaceAll(",", "\u202f");
      this.lastCount = count;
    }
  }

  updatePlayback(speed) { this.timeline.updatePlayback(speed); }

  updateNow(active) {
    // Reached after every rendered frame; skip the reflected write when unchanged.
    if (!this.now || this.now.hidden === !active) return;
    this.now.hidden = !active;
  }

  updatePresentCopy(enabled) { this.timeline.updatePresentCopy(enabled); }

  destroy() { this.timeline.destroy(); this.controls.destroy(); }
}
