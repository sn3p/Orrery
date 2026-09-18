export default class Controls {
  constructor(orrery, options = {}) {
    options.multiplier = options.multiplier || 1.04;
    options.dragPixelsPerStep = options.dragPixelsPerStep || 8;
    this.options = options;
    this.orrery = orrery;
    this.touchPointers = new Set();
    this.pointerId = null;
    this.pointerY = null;
    this.pointerEndTarget = orrery.canvas.ownerDocument || orrery.canvas;

    this.onScroll = this.onScroll.bind(this);
    orrery.canvas.addEventListener("wheel", this.onScroll, { passive: false });
    orrery.canvas.addEventListener("pointerdown", this.onPointerDown, { passive: false });
    orrery.canvas.addEventListener("pointermove", this.onPointerMove, { passive: false });
    this.pointerEndTarget.addEventListener("pointerup", this.onPointerEnd);
    this.pointerEndTarget.addEventListener("pointercancel", this.onPointerEnd);
    orrery.canvas.addEventListener("lostpointercapture", this.onPointerEnd);
  }

  destroy() {
    const canvas = this.orrery.canvas;
    canvas.removeEventListener("wheel", this.onScroll);
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointermove", this.onPointerMove);
    this.pointerEndTarget.removeEventListener("pointerup", this.onPointerEnd);
    this.pointerEndTarget.removeEventListener("pointercancel", this.onPointerEnd);
    canvas.removeEventListener("lostpointercapture", this.onPointerEnd);
    this.touchPointers.clear();
    this.pointerId = this.pointerY = null;
  }

  zoom(factor) {
    const scale = this.orrery.stage.scale;
    scale.set(scale.x * factor);
    this.orrery.requestRender();
  }

  onScroll(event) {
    if (event.deltaY === 0) return;
    event.preventDefault();
    const delta = -event.deltaY;
    const multiplier = this.options.multiplier;
    const factor = delta > 0 ? multiplier : 1 / multiplier;

    this.zoom(factor);
  }

  onPointerDown = event => {
    if (event.pointerType !== "touch") return;
    event.preventDefault();
    this.touchPointers.add(event.pointerId);
    if (this.touchPointers.size !== 1) {
      this.pointerId = this.pointerY = null;
      return;
    }
    this.pointerId = event.pointerId;
    this.pointerY = event.clientY;
    // Pointer capture keeps a vertical drag targeted at the canvas. Document
    // listeners still finish it when capture is unavailable or ineffective.
    try { this.orrery.canvas.setPointerCapture?.(event.pointerId); }
    catch { /* The gesture still works while the pointer remains on-canvas. */ }
  };

  onPointerMove = event => {
    if (event.pointerType !== "touch" || event.pointerId !== this.pointerId
      || this.touchPointers.size !== 1) return;
    event.preventDefault();
    const delta = event.clientY - this.pointerY;
    this.pointerY = event.clientY;
    if (delta === 0) return;
    const factor = this.options.multiplier ** (delta / this.options.dragPixelsPerStep);

    this.zoom(factor);
  };

  onPointerEnd = event => {
    if (!this.touchPointers.delete(event.pointerId)) return;
    if (event.pointerId === this.pointerId) this.pointerId = this.pointerY = null;
  };
}
