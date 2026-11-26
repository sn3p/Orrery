// Ported from the preserved Orrery3D 93a3e1f source (MIT).
import Orbit from "./Orbit.js";
import NamedOrbit from "./NamedOrbit.js";
import createSphere from "./createSphere.js";

export default class Planet {
  static defaultOptions = {
    size: 2,
    segments: 32,
    color: 0xffffff
  };

  constructor(ephemeris, options = {}) {
    this.options = Object.assign({}, Planet.defaultOptions, options);
    this.ephemeris = ephemeris;
    this.orbit = options.namedBody ? new NamedOrbit(options.namedBody) : new Orbit(ephemeris);
    this.body = createSphere(this.options);
  }

  render(jed) {
    if (!this.options.namedBody && !this.orbit.matches(this.ephemeris)) this.orbit = new Orbit(this.ephemeris);
    this.orbit.getPosAtTime(jed, this.body.position);
  }
}
