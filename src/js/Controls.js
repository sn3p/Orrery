export default class Controls {
  constructor(orrery, options = {}) {
    options.multiplier = options.multiplier || 1.04;
    this.options = options;
    this.orrery = orrery;

    this.onScroll = this.onScroll.bind(this);
    orrery.canvas.addEventListener("wheel", this.onScroll, { passive: false });
  }

  destroy() { this.orrery.canvas.removeEventListener("wheel", this.onScroll); }

  onScroll(event) {
    event.preventDefault();
    const delta = -event.deltaY;
    const multiplier = this.options.multiplier;
    const factor = delta > 0 ? multiplier : 1 / multiplier;
    const scale = this.orrery.stage.scale;

    scale.set(scale.x * factor);
    this.orrery.requestRender();
  }
}
