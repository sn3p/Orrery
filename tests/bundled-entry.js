// Explicit whole-file oracle for renderer parity and legacy loading regressions.
// Public startup defaults to Three.js through src/unified/index.js. This oracle
// keeps Pixi when the query is absent so existing Pixi fixtures stay on Pixi.
import App from "../src/unified/App.js";
import planets from "../src/js/planets.js";
import catalogURL from "./fixtures/historical100k/catalog.json.gz";
import "../src/css/main.css";
import "../src/unified/preview.css";
import "../src/fonts/OFL.txt";

const app = new App({ container: document.getElementById("orrery"),
  renderer: new URLSearchParams(location.search).get("renderer") ?? "pixi",
  defaultRenderer: "pixi" });
const ready = app.init().then(() => {
  app.addPlanets(planets);
  return app.loadAsteroids(catalogURL);
}).catch(() => { /* App owns initialization error feedback and cleanup. */ });
export { app, ready };
