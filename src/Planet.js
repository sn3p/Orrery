import * as PIXI from "pixi.js";
import Orbit from "./Orbit.js";

export default class Planet {
  static defaultOptions = {
    size: 4,
    color: 0xffffff
  };

  constructor(ephemeris, texture, options = {}) {
    this.options = Object.assign({}, Planet.defaultOptions, options);

    // Planet orbit
    this.orbit = new Orbit(ephemeris);

    // Planet body
    const sprite = new PIXI.Sprite(texture);
    sprite.width = sprite.height = this.options.size;
    sprite.anchor.x = sprite.anchor.y = 0.5;
    sprite.tint = this.options.color;

    this.body = sprite;
  }

  render(jed) {
    const { x, y } = this.orbit.getPosAtTime(jed);
    this.body.position.x = x;
    this.body.position.y = y;
  }
}
