import { Matrix } from 'pixi.js';
import OrbitTrack from './ScreenOrbit.js';
import { NamedOrbit as Model, namedOrbitPoints, namedOrbitFrame, orbitShapeDate } from '../named/model.js';

function frameMatrix(body, jed, target) {
  const { p, q, center } = namedOrbitFrame(body, jed);
  return target.set(-p[0], p[1], -q[0], q[1], -center[0], center[1]);
}

export default class NamedOrbit extends Model {
  getPosAtTime(jed, target = {}) {
    const [x, y] = this.position(jed);
    target.x = -x; target.y = y;
    this.updateTrack(jed);
    return target;
  }
  drawOrbit(jed) {
    const points = namedOrbitPoints(this.body, jed);
    for (let i = 0; i < points.length; i += 3) { points[i] = -points[i]; points[i + 2] = 0; }
    this.track = new OrbitTrack(points);
    this.baseInverse = frameMatrix(this.body, jed, new Matrix()).invert();
    this.frame = new Matrix();
    this.trackDate = orbitShapeDate(jed);
    return this.track;
  }
  updateTrack(jed) {
    const date = orbitShapeDate(jed);
    if (!this.track || date === this.trackDate) return;
    // Every instantaneous ellipse is an affine image of the initial ellipse.
    // Keep the path/tessellation; only its basis and centre change with date.
    frameMatrix(this.body, jed, this.frame).append(this.baseInverse);
    // Matrix.decompose treats tiny shear as rotation. Preserve both axes
    // exactly instead; their small difference matters at outer-body distances.
    const { a, b, c, d, tx, ty } = this.frame;
    this.track.position.set(tx, ty);
    this.track.scale.set(Math.hypot(a, b), Math.hypot(c, d));
    this.track.skew.set(Math.atan2(c, d), Math.atan2(b, a));
    this.trackDate = date;
  }
}
