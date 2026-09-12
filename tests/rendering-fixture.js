// The real async bootstrap sequence, with instrumentation only in this bundle.
import Orrery from "../src/js/Orrery";
import Asteroids from "../src/js/Asteroids";
import planets from "../src/js/planets";
import catalogURL from "../data/catalog.json";
import "../src/css/main.css";

const options = new URLSearchParams(location.search);
const app = new Orrery({ container: document.getElementById("orrery"),
  jedDelta: Number(options.get("speed") ?? 0), autoRender: !options.has("manual") });
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
    if (scene && probe.capture) probe.image = app.canvas.toDataURL();
    return result;
  };
  if (!options.has("empty")) app.addPlanets(planets);
});
window.ready = window.initialized.then(async () => {
  if (!options.has("empty")) await app.loadAsteroids(catalogURL);
});
