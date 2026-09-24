// The real async bootstrap sequence, with instrumentation only in this bundle.
import Orrery from "./unified-app";
import Asteroids from "../src/unified/pixi/Asteroids";
import planets from "../src/js/planets";
import catalogURL from "./fixtures/historical100k/catalog.json.gz";
import "../src/css/main.css";

const options = new URLSearchParams(location.search);
const app = new Orrery({ container: document.getElementById("orrery"),
  jedDelta: Number(options.get("speed") ?? 0), autoRender: !options.has("manual") });
// Test-only cold-selection path; production always starts at 1x.
if (options.has("pixelRatio")) app.pixelRatio = options.get("pixelRatio");
const probe = { draws: 0, textureDraws: 0, updates: 0, frames: [] };
window.fixture = { app, probe, planets, catalogURL };
const update = Asteroids.prototype.update;
Asteroids.prototype.update = function(...args) { probe.updates++; return update.apply(this, args); };
window.initialized = app.init().then(() => {
  const render = app.app.renderer.render.bind(app.app.renderer);
  app.app.renderer.render = options => {
    const scene = options.container === app.stage;
    if (scene) {
      probe.draws++;
      probe.frames.push({ jed: app.jed, elapsed: app.elapsed });
    } else probe.textureDraws++;
    const result = render(options);
    if (scene && probe.capture) {
      probe.image = app.canvas.toDataURL();
      const gl = app.app.renderer.gl, data = new Uint8Array(app.canvas.width * app.canvas.height * 4);
      gl.readPixels(0, 0, app.canvas.width, app.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
      // Pure green is the arrival; teal is a Near Earth marker's resting group
      // color, which has as much blue as green; gray has all three equal.
      let green = 0, gray = 0, teal = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (g > 20 && g > r * 2 && g > b * 2) green++;
        else if (r > 20 && Math.abs(r - g) < 2 && Math.abs(g - b) < 2) gray++;
        else if (g > 20 && g > r * 2 && b > r * 2) teal++;
      }
      probe.pixels = { green, gray, teal };
    }
    return result;
  };
  if (!options.has("empty")) app.addPlanets(planets);
});
window.ready = window.initialized.then(async () => {
  if (!options.has("empty")) await app.loadAsteroids(catalogURL);
});
