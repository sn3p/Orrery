export default class Controls {
  constructor(orrery, options = {}) {
    options.multiplier = options.multiplier || 1.04;
    this.options = options;
    this.orrery = orrery;

    orrery.canvas.addEventListener("wheel", this.onScroll.bind(this));
  }

  onScroll(event) {
    const delta = event.wheelDelta;
    const multiplier = this.options.multiplier;
    const factor = delta > 0 ? multiplier : 1 / multiplier;
    const scale = this.orrery.stage.scale;

    scale.set(scale.x * factor);
  }
}
