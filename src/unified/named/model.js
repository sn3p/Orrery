import { namedPosition } from './source/NamedBodySource.js';
import { PIXELS_PER_AU } from '../../js/constants.js';

// Presentation only. Scientific identity, classification and motion belong to OrreryData.
const style = {
  'orrery:planet:mercury': [1.6, 0xeccd9e], 'orrery:planet:venus': [1.8, 0xeccd9e],
  'orrery:planet:earth': [2.8, 0x98c0ff], 'orrery:planet:mars': [2.2, 0xffbc83],
  'orrery:planet:jupiter': [4, 0xc5c3bd], 'orrery:planet:saturn': [3.2, 0xeccd9e],
  'orrery:planet:uranus': [3, 0xa9dddd], 'orrery:planet:neptune': [3, 0x7e9fe8],
  'mpc:number:1': [1.6, 0xb8ada0], 'mpc:number:134340': [1.8, 0xd4b6a1],
  'mpc:number:136108': [1.6, 0xc9c8d3], 'mpc:number:136472': [1.6, 0xcaa58e],
  'mpc:number:136199': [1.6, 0xd3d8e0],
};
export const presentBodies = definitions => definitions.bodies.map(body => ({
  id: body.id, name: body.name, classification: body.classification, namedBody: body,
  size: style[body.id][0], color: style[body.id][1],
}));

// Sample the instantaneous ellipse, not a future trajectory. All five shape /
// orientation elements use exactly the producer's boundary-freeze policy.
export function orbitShapeDate(jd) {
  if (!Number.isFinite(jd)) throw new RangeError('Invalid named-body date.');
  return Math.min(2488069.5, Math.max(2378496.5, jd));
}
export function namedOrbitPoints(body, jd, parts = 360) {
  const date = orbitShapeDate(jd), t = (date - 2451545) / 36525;
  const [a, e, inc, node, peri] = body.elements.map((value, k) => value + body.rates[k] * t);
  const [i, O, w] = [inc, node, peri].map(value => value * Math.PI / 180);
  const cw = Math.cos(w), sw = Math.sin(w), co = Math.cos(O), so = Math.sin(O), ci = Math.cos(i), si = Math.sin(i);
  const p = [cw * co - sw * so * ci, cw * so + sw * co * ci, sw * si];
  const q = [-sw * co - cw * so * ci, -sw * so + cw * co * ci, cw * si];
  const points = new Float64Array((parts + 1) * 3);
  for (let j = 0; j < parts; j++) {
    const E = 2 * Math.PI * j / parts, x = a * (Math.cos(E) - e), y = a * Math.sqrt(1 - e * e) * Math.sin(E);
    for (let k = 0; k < 3; k++) points[3 * j + k] = (p[k] * x + q[k] * y) * PIXELS_PER_AU;
  }
  points.set(points.subarray(0, 3), parts * 3);
  return points;
}
export class NamedOrbit {
  constructor(body) { this.body = body; }
  position(jd) {
    const { position, status } = namedPosition(this.body, jd);
    this.status = status;
    return position.map(value => value * PIXELS_PER_AU);
  }
}
