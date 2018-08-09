import { PIXELS_PER_AU, J2000, YEAR, DEG_TO_RAD } from "./constants.js";

export default class Orbit {
  constructor(ephemeris) {
    this.ephemeris = ephemeris;
  }

  // Get position at time for Julian Date
  // https://github.com/typpo/asterank/blob/master/static/js/3d/ellipse.js#L45
  // http://nbodyphysics.com/blog/2016/05/29/planetary-orbits-in-javascript/
  getPosAtTime(jed) {
    const pi = Math.PI;
    const sin = Math.sin;
    const cos = Math.cos;

    const eph = this.ephemeris;
    const epoch = eph.epoch;
    const e = eph.e;
    const a = eph.a;
    const i = eph.i * DEG_TO_RAD;
    const o = eph.W * DEG_TO_RAD; // longitude of ascending node
    const p = (eph.wbar || eph.w + eph.W) * DEG_TO_RAD; // longitude of perihelion
    const ma = eph.M * DEG_TO_RAD; // mean anomaly at J2000

    // mean motion
    // eph.n is provided for asteroids but not for planets
    let n;
    if (eph.n) {
      n = eph.n * DEG_TO_RAD;
    } else {
      n = (2 * pi) / eph.P;
    }

    const d = jed - epoch;
    //L = ma + p;

    // const M = n * -d + L - p;
    const M = ma + n * d;

    // estimate eccentric and true anom using iterative approx
    let E0 = M;
    let lastdiff;

    do {
      const E1 = M + e * sin(E0);
      lastdiff = Math.abs(E1 - E0);
      E0 = E1;
    } while (lastdiff > 0.0000001);
    //} while(lastdiff > 0.00001);

    const E = E0;
    const v = 2 * Math.atan(Math.sqrt((1 + e) / (1 - e)) * Math.tan(E / 2));

    // radius vector in AU
    const r = ((a * (1 - e * e)) / (1 + e * cos(v))) * PIXELS_PER_AU;

    // heliocentric coords
    const x = r * (cos(o) * cos(v + p - o) + sin(o) * sin(v + p - o) * cos(i));
    const y = r * (sin(o) * cos(v + p - o) - cos(o) * sin(v + p - o) * cos(i));
    return { x: x, y: y };
    // const z = r * (sin(v + p - o) * sin(i))
    // return { x: x, y: y, z: z };
  }

  createOrbit(jed = J2000) {
    const parts = 360;
    const period = this.getPeriodInDays();
    const delta = period / parts;

    const line = new PIXI.Graphics();
    line.lineStyle(0.2, 0x555555);

    for (let i = 0; i <= parts; i++) {
      jed += delta;
      const pos = this.getPosAtTime(jed);

      if (i === 0) {
        line.moveTo(pos.x, pos.y);
      } else {
        line.lineTo(pos.x, pos.y);
      }
    }

    line.endFill();

    return line;
  }

  getPeriodInDays() {
    return Math.sqrt(Math.pow(this.ephemeris.a, 3)) * YEAR;
  }
}
