import { fromJED } from "../../js/utils.js";
import { UNIX_EPOCH_JULIAN_DATE } from "../../js/constants.js";
import Options from "./Options.js";

export default class Hud {
  constructor(app) {
    this.date = document.getElementById("orrery-date");
    this.fps = document.getElementById("orrery-fps");
    this.count = document.getElementById("orrery-count");
    this.lastDay = this.lastFps = this.lastCount = null;
    this.controls = new Options(app);
  }

  update(jed, fps, count) {
    // Match Date's millisecond truncation, including pre-Unix-epoch dates.
    const milliseconds = Math.trunc((jed - UNIX_EPOCH_JULIAN_DATE) * 86400000);
    const day = Math.floor(milliseconds / 86400000);
    if (day !== this.lastDay) {
      this.date.textContent = fromJED(jed).toISOString().slice(0, 10);
      this.lastDay = day;
    }
    if (fps !== this.lastFps) {
      this.fps.textContent = `${fps} FPS`;
      this.lastFps = fps;
    }
    if (count !== this.lastCount) {
      this.count.textContent = count;
      this.lastCount = count;
    }
  }

  destroy() { this.controls.destroy(); }
}
