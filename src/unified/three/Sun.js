// Ported from the preserved Orrery3D 93a3e1f source (MIT).
import * as THREE from "three";
import createSphere from "./createSphere.js";
import { SUN_GLOW_EXTENT, sunGlowStops } from "../sunGlow.js";

export default class Sun {
  static defaultOptions = {
    size: 5,
    segments: 32,
    color: 0xffff00
  };

  constructor(options) {
    this.options = Object.assign({}, Sun.defaultOptions, options);
    this.body = createSphere(this.options);
    this.body.add(createGlow(this.options.size));
  }
}

// A camera-facing halo. Depth precision at the default distance cannot
// separate the sphere's front from the sprite's plane, so the texture leaves
// the core clear (slightly inside, for the faceted silhouette) instead of
// relying on the depth test. Additive light only brightens what lies behind.
function createGlow(radius, size = 256) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const { offset, color } of sunGlowStops(0.98 / SUN_GLOW_EXTENT)) gradient.addColorStop(offset, color);
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map, blending: THREE.AdditiveBlending, depthWrite: false }));
  glow.scale.setScalar(2 * radius * SUN_GLOW_EXTENT);
  return glow;
}
