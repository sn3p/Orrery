class Asteroid {
  constructor(ephemeris, options) {
    this.ephemeris = ephemeris;
    options = options || {};
    this.size = options.size || 0.2;
    this.color = options.color || 0xcccccc;

    // Asteroid orbit
    this.orbit = new Orbit(this.ephemeris);

    // Asteroid body
    const body = new PIXI.Graphics();
    body.beginFill(this.color);
    // TODO: would drawRect be more efficient?
    body.drawCircle(0, 0, this.size);
    body.endFill();
    this.body = body;
  }

  render(jed) {
    const pos = this.orbit.getPosAtTime(jed);
    this.body.x = pos.x;
    this.body.y = pos.y;
  }
}
