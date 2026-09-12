// Separate entry point: exercise the production classes without shipping test globals.
import Orrery from "../src/js/Orrery";
import planets from "../src/js/planets";
import catalogURL from "../data/catalog.json";
import "../src/css/main.css";

window.ready = (async () => {
  const app = new Orrery({ container: document.getElementById("orrery"), jedDelta: 0 });
  const initStart = performance.now();
  await app.init();
  const initialSpeed = app.jedDelta;
  app.app.stop();
  app.jedDelta = 0;
  app.jed = 2458600.5;
  app.addPlanets(planets);
  const fetchStart = performance.now();
  const response = await fetch(catalogURL);
  const text = await response.text();
  const parseStart = performance.now();
  const catalog = JSON.parse(text);
  const parseEnd = performance.now();
  catalog.sort((a, b) => a.disc - b.disc);
  window.fixture = { app, catalog, planets, initialSpeed, timings: { initMs: fetchStart - initStart,
    fetchMs: parseStart - fetchStart, parseMs: parseEnd - parseStart } };
})();
