class Asteroid {
  constructor(ephemeris, options = {}) {
    this.size = options.size || 0.5;

    // Asteroid orbit
    this.orbit = new Orbit(ephemeris);

    // Asteroid body
    this.body = new PIXI.Sprite(PIXI.Texture.WHITE);
    this.body.anchor.set(0.5, 0.5);
    this.body.width = this.size;
    this.body.height = this.size;
  }

  render(jed) {
    const { x, y } = this.orbit.getPosAtTime(jed);
    this.body.position.x = x;
    this.body.position.y = y;
  }
}
