import * as THREE from 'three';
import { COMETS, positionAt, pathRange } from '../comets/model.js';
import { cometLabel } from '../comets/labels.js';
import { PIXELS_PER_AU } from '../../js/constants.js';

export default class Comets {
  constructor(scene, container, data) {
    this.data = data;
    this.group = new THREE.Group();
    this.projected = new THREE.Vector3();
    this.entries = COMETS.map(comet => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute([0,0,0], 3));
      const body = new THREE.Points(geometry, new THREE.PointsMaterial({
        color: comet.color, size: 6, sizeAttenuation: false, depthTest: false,
      }));
      const path = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({
        color: comet.color, transparent: true, opacity: .35,
      }));
      this.group.add(path, body);
      return { comet, body, path, position: {}, label: cometLabel(container, comet), range: '' };
    });
    scene.add(this.group);
    this.group.visible = false;
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
      body.position.set(position.x * PIXELS_PER_AU, position.y * PIXELS_PER_AU, position.z * PIXELS_PER_AU);
      if (paths) {
        const [first, last] = pathRange(series, jed, comet.periodDays), range = `${first}:${last}`;
        if (range !== entry.range) {
          const vertices = new Float32Array((last-first+1)*3);
          for (let i=first; i<=last; i++) for (let k=0; k<3; k++) vertices[(i-first)*3+k] = series.states[i][k]*PIXELS_PER_AU;
          path.geometry.dispose();
          path.geometry = new THREE.BufferGeometry();
          path.geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
          entry.range = range;
        }
      }
    }
  }

  resize(viewport, physicalWidth) {
    for (const {body} of this.entries) body.material.size = 6 * physicalWidth / viewport.width;
  }

  placeLabels(camera, viewport) {
    for (const { body, label } of this.entries) {
      const p = this.projected.copy(body.position).project(camera);
      label.place((p.x+1)*viewport.width/2, (1-p.y)*viewport.height/2,
        { ...viewport, visible: this.group.visible && body.visible && p.z >= -1 && p.z <= 1 });
    }
  }
  hideLabels() { for (const {label} of this.entries) label.hide(); }
  destroy() {
    for (const {body,path,label} of this.entries) {
      body.geometry.dispose(); body.material.dispose(); path.geometry.dispose(); path.material.dispose(); label.destroy();
    }
    this.group.removeFromParent();
  }
}
