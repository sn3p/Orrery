export default class Controls {
  constructor(orrery, options = {}) {
    options.multiplier = options.multiplier || 1.04;
    this.options = options;
    this.orrery = orrery;

    // Firefox
    orrery.renderer.view.addEventListener("DOMMouseScroll", this.onScroll);
    // Other
    orrery.renderer.view.addEventListener("mousewheel", this.onScroll);
  }

  onScroll = event => {
    // Firefox has `detail` prop with opposite sign to `wheelDelta`
    const delta = event.wheelDelta || -event.detail;
    const multiplier = this.options.multiplier;
    const factor = delta > 0 ? multiplier : 1 / multiplier;
    const scale = this.orrery.stage.scale;

    scale.set(scale.x * factor);
  };
}
