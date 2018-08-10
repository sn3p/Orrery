import * as PIXI from "pixi.js";
import Orbit from "./Orbit.js";

export default class Asteroid {
  static defaultOptions = {
    size: 1,
    color: 0xaaaaaa,
    discoveryColor: 0x00ff00,
    discoveryScale: 3
  };

  constructor(ephemeris, texture, options = {}) {
    this.options = Object.assign({}, Asteroid.defaultOptions, options);

    // Orbital elements
    this.orbit = new Orbit(ephemeris);

    // Sprite
    const sprite = new PIXI.Sprite(texture);
    sprite.width = sprite.height = this.options.size;
    sprite.anchor.x = sprite.anchor.y = 0.5;
    sprite.tint = this.options.discoveryColor;

    // Set scale
    this.originalScale = sprite.scale.x;
    sprite.scale.x = sprite.scale.y *= this.options.discoveryScale;

    this.body = sprite;
  }

  render(jed) {
    this.renderPosition(jed);

    this.body.scale.x = this.body.scale.y -= 0.005;

    if (this.body.scale.x <= this.originalScale) {
      this.body.tint = this.options.color;

      // Revert to original scale
      this.body.scale.x = this.body.scale.y = this.originalScale;
      delete this.originalScale;

      // Overwrite render function
      this.render = this.renderPosition;
    }
  }

  renderPosition(jed) {
    const { x, y } = this.orbit.getPosAtTime(jed);
    this.body.position.x = x;
    this.body.position.y = y;
  }
}
