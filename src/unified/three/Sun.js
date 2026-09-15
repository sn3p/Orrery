// Ported from the preserved Orrery3D 93a3e1f source (MIT).
import createSphere from "./createSphere.js";

export default class Sun {
  static defaultOptions = {
    size: 5,
    segments: 32,
    color: 0xffff00
  };

  constructor(options) {
    this.options = Object.assign({}, Sun.defaultOptions, options);
    this.body = createSphere(this.options);
  }
}
