import * as dat from "dat.gui";

export default class Gui {
  constructor(orrery) {
    const gui = new dat.GUI({ hideable: false });

    gui.add(orrery, "jedDelta", -8, 8).name("speed");
  }
}
