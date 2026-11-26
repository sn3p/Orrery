import { Graphics } from 'pixi.js';
import { NamedOrbit as Model, namedOrbitPoints, orbitShapeDate } from '../named/model.js';

export default class NamedOrbit extends Model {
  getPosAtTime(jed, target = {}) {
    const [x, y] = this.position(jed);
    target.x = -x; target.y = y;
    this.updateTrack(jed);
    return target;
  }
  drawOrbit(jed) {
    this.track = new Graphics();
    this.updateTrack(jed);
    return this.track;
  }
  updateTrack(jed) {
    const date = orbitShapeDate(jed);
    if (!this.track || date === this.trackDate) return;
    const points = namedOrbitPoints(this.body, jed);
    this.track.clear();
    this.track.moveTo(-points[0], points[1]);
    for (let i = 3; i < points.length; i += 3) this.track.lineTo(-points[i], points[i + 1]);
    this.track.stroke({ width: 0.2, color: 0x555555 });
    this.trackDate = date;
  }
}
