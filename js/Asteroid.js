// Extend Orbit

class Asteroid {
  constructor(graphics, ephemeris, options) {
    this.ephemeris = ephemeris;
    options = options || {};
    this.size = options.size || 0.5;
    this.color = options.color || 0xffffff;
    this.orbit = new Orbit(this.ephemeris);
    this.graphics = graphics;
  }

  render(jed) {
    const [x, y] = this.orbit.getPosAtTime(jed);
    this.graphics.beginFill(this.color);
    // TODO: would drawRect be more efficient?
    this.graphics.drawCircle(x, y, this.size);
    this.graphics.endFill();
  }
}
