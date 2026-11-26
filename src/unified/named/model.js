import { namedPosition, namedEllipse, namedShapeDate } from './source/NamedBodySource.js';
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

// Render-space adaptation only; the source module owns the ellipse and dates.
export const orbitShapeDate = namedShapeDate;
export function namedOrbitFrame(body, jd) {
  const { p, q, center, normal } = namedEllipse(body, jd);
  return { p: p.map(x => x * PIXELS_PER_AU), q: q.map(x => x * PIXELS_PER_AU),
    center: center.map(x => x * PIXELS_PER_AU), normal };
}
export function namedOrbitPoints(body, jd, parts = 360) {
  const { p, q, center } = namedOrbitFrame(body, jd);
  const points = new Float64Array((parts + 1) * 3);
  for (let j = 0; j < parts; j++) {
    const E = 2 * Math.PI * j / parts;
    for (let k = 0; k < 3; k++) points[3 * j + k] = center[k] + p[k] * Math.cos(E) + q[k] * Math.sin(E);
  }
  points.set(points.subarray(0, 3), parts * 3);
  return points;
}
export class NamedOrbit {
  constructor(body) { this.body = body; }
  position(jd) {
    return namedPosition(this.body, jd).position.map(value => value * PIXELS_PER_AU);
  }
}
