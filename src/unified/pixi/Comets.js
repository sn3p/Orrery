import { Container, Graphics } from 'pixi.js';
import { COMETS, positionAt, pathStrips } from '../comets/model.js';
import { cometLabel } from '../comets/labels.js';
import { PIXELS_PER_AU } from '../../js/constants.js';

export default class Comets {
  constructor(stage, container, data, catalogue = COMETS) {
    this.data = data;
    this.group = new Container();
    this.entries = catalogue.filter(comet => !comet.assessment || comet.trajectory).map(comet => {
      const body = new Graphics().circle(0,0,3).fill(comet.color);
      const path = new Graphics();
      this.group.addChild(path, body);
      return { comet, body, path, position: {}, label: cometLabel(container, comet), range: '' };
    });
    stage.addChild(this.group);
    this.group.visible = false;
  }
  setData(data) {
    for (const entry of this.entries) {
      if (this.data[entry.comet.id] !== data[entry.comet.id]) {
        entry.range = "";
        entry.path.clear();
      }
    }
    this.data = data;
  }
  update(jed, visible, ids, paths) {
    this.group.visible = visible;
    for (const entry of this.entries) {
      const { comet, body, path, position, label } = entry;
      const series = this.data[comet.id];
      const shown = visible && ids.includes(comet.id) && !!positionAt(series, jed, position);
      body.visible = shown;
      path.visible = shown && paths;
      if (!shown) { label.hide(); continue; }
      body.position.set(-position.x*PIXELS_PER_AU, position.y*PIXELS_PER_AU);
      // Constant screen-size markers, like the Three view.
      body.scale.set(1 / this.group.parent.scale.x);
      if (paths) {
        const strips = pathStrips(series, jed, comet.periodDays);
        const range = strips.map(s => `${s.key}:${s.points[0]?.[0]}:${s.points.at(-1)?.[0]}`).join('|');
        if (range !== entry.range) {
          path.clear();
          for (const strip of strips) for (const [i, [,x,y]] of strip.points.entries()) {
            if (i === 0) path.moveTo(-x*PIXELS_PER_AU, y*PIXELS_PER_AU);
            else path.lineTo(-x*PIXELS_PER_AU, y*PIXELS_PER_AU);
          }
          path.stroke({width: 1, pixelLine: true, color: comet.color, alpha: .35});
          entry.range = range;
        }
      }
    }
  }
  placeLabels(stage, viewport) {
    const {a,b,c,d,tx,ty} = stage.worldTransform;
    for (const {body,label} of this.entries) label.place(a*body.x+c*body.y+tx, b*body.x+d*body.y+ty,
      {...viewport, visible: this.group.visible && body.visible});
  }
  hideLabels() { for (const {label} of this.entries) label.hide(); }
  destroy() {
    for (const {label} of this.entries) label.destroy();
    this.group.destroy({children:true});
  }
}
