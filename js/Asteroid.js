class Asteroid {
  constructor(ephemeris, options = {}) {
    this.size = options.size || 1;
    this.color = options.color || 0xffffff;

    // Asteroid orbit
    this.orbit = new Orbit(ephemeris);

    // Asteroid body
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
