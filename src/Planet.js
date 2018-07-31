import * as PIXI from "pixi.js";
import Orbit from "./Orbit.js";

export default class Planet {
  constructor(ephemeris, options = {}) {
    this.name = options.name;
    this.size = options.size || 4;
    this.color = options.color || 0xffffff;

    // Planet orbit
    this.orbit = new Orbit(ephemeris);

    // Planet body
    const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
    sprite.tint = this.color;
    sprite.width = this.size;
    sprite.height = this.size;
    sprite.anchor.x = 0.5;
    sprite.anchor.y = 0.5;
    this.body = sprite;
  }

  render(jed) {
    const { x, y } = this.orbit.getPosAtTime(jed);
    this.body.position.x = x;
    this.body.position.y = y;
  }
}
