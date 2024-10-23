import { Particle } from "pixi.js";
import Orbit from "./Orbit.js";

export default class Asteroid {
  static defaultOptions = {
    size: 1,
    color: 0xaaaaaa,
    discoveryColor: 0x00ff00,
    discoveryScale: 3,
  };

  constructor(data, texture, options = {}) {
    this.options = Object.assign({}, Asteroid.defaultOptions, options);
    this.disc = data.disc;

    // Orbit
    this.orbit = new Orbit(data);

    // Asteroid body
    // TODO: create a custom texture for asteroids of 1px size?
    const particle = new Particle(texture);
    this.originalScale = this.options.size / texture.width;
    particle.scaleX = particle.scaleY = this.originalScale * this.options.discoveryScale;
    // particle.anchorX = particle.anchorY = 0.5; // TODO: is this correct/required?
    particle.tint = this.options.discoveryColor;
    this.body = particle;
  }

  render(jed) {
    this.renderPosition(jed);

    this.body.scaleX = this.body.scaleY -= 0.005;

    if (this.body.scaleX <= this.originalScale) {
      // Set original scale
      this.body.scaleX = this.body.scaleY = this.originalScale;
      delete this.originalScale;

      // Set original color
      this.body.tint = this.options.color;

      // Overwrite render function
      this.render = this.renderPosition;
    }
  }

  renderPosition(jed) {
    const { x, y } = this.orbit.getPosAtTime(jed);
    this.body.x = x;
    this.body.y = y;
  }
}
