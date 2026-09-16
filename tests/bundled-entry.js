// Explicit whole-file oracle for renderer parity and legacy loading regressions.
// Public preview startup is tested separately through src/unified/index.js.
import App from "../src/unified/App.js";
import planets from "../src/js/planets.js";
import catalogURL from "./fixtures/historical100k/catalog.json.gz";
import "../src/css/main.css";
import "../src/unified/preview.css";
import "../src/fonts/OFL.txt";

const app = new App({ container: document.getElementById("orrery"),
  renderer: new URLSearchParams(location.search).get("renderer") ?? "pixi" });
const ready = app.init().then(() => {
  app.addPlanets(planets);
  return app.loadAsteroids(catalogURL);
}).catch(() => { /* App owns initialization error feedback and cleanup. */ });
export { app, ready };
