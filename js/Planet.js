class Planet {
  constructor(ephemeris, options = {}) {
    this.name = options.name;
    this.size = options.size || 4;
    this.color = options.color || 0xffffff;

    // Planet orbit
    this.orbit = new Orbit(ephemeris);

    // Planet body
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
