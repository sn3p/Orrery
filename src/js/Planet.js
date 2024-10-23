import { Particle } from "pixi.js";
import Orbit from "./Orbit.js";

export default class Planet {
  static defaultOptions = {
    size: 4,
    color: 0xffffff,
  };

  constructor(ephemeris, texture, options = {}) {
    this.options = Object.assign({}, Planet.defaultOptions, options);

    // Planet orbit
    this.orbit = new Orbit(ephemeris);

    // Planet body
    const particle = new Particle(texture);
    particle.scaleX = particle.scaleY = this.options.size / texture.width;
    particle.anchorX = particle.anchorY = 0.5;
    particle.tint = this.options.color;
    this.body = particle;
  }

  render(jed) {
    const { x, y } = this.orbit.getPosAtTime(jed);
    this.body.x = x;
    this.body.y = y;
  }
}
