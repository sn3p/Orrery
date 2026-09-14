// Test/benchmark inspection facade only. Existing strict numerical/lifecycle
// probes address the extracted renderer here, never in the public App API.
import App from "../src/unified/App.js";
import PixiRenderer from "../src/unified/pixi/PixiRenderer.js";

export default class UnifiedFixture extends App {
  static application = "unified";
  constructor(options) {
    super({ ...options, createRenderer: callbacks => new PixiRenderer(callbacks) });
  }
  async initialize() {
    await super.initialize();
    // Legacy GPU tests explicitly drive a stopped Pixi ticker. Production
    // never registers this bridge: only App's scheduler advances the clock.
    if (!this.destroyed) this.app.ticker.add(this.tick);
  }
  tick(ticker) {
    super.tick(typeof ticker === "object" ? ticker.lastTime + (ticker.elapsedMS ?? 0) : ticker);
  }
  destroy() {
    this.app?.ticker?.remove(this.tick);
    super.destroy();
  }
}
for (const key of ["app", "stage", "canvas", "viewWidth", "viewHeight", "planets", "asteroids", "circleTexture", "planetContainer", "controls", "texturePixelRatio", "onContextLost", "onContextRestored"]) {
  Object.defineProperty(UnifiedFixture.prototype, key, {
    get() { return this.renderer?.[key]; },
    set(value) { this.renderer[key] = value; },
  });
}
