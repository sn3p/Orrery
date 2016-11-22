// Extend Orbit

class Planet {
  constructor(ephemeris, options) {
    this.ephemeris = ephemeris;
    options = options || {};
    this.name = options.name;
    this.size = options.size || 4;
    this.color = options.color || 0xffffff;

    // Planet orbit
    this.orbit = new Orbit(this.ephemeris);

    // Planet body
    const body = new PIXI.Graphics();
    body.beginFill(this.color);
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
