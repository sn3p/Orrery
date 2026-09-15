import App from "./App.js";
import planets from "../js/planets.js";
import "../css/main.css";
import "./preview.css";
import "../fonts/OFL.txt";

const selection = __CATALOG_SELECTION__;
const app = new App({ container: document.getElementById("orrery"),
  renderer: new URLSearchParams(location.search).get("renderer") ?? "pixi",
  startJed: selection?.startJed, jedDelta: selection?.speed });
const ready = app.init().then(() => {
  app.addPlanets(planets);
  const pin = selection.pin && { ...selection.pin, url: new URL(selection.pin.url, document.baseURI).href };
  return app.loadCatalog(pin, { mode: selection.mode, latest: selection.latest });
}).catch(() => { /* App owns initialization error feedback and cleanup. */ });

// Unaccepted application edits reload the document; dispose pending work first.
if (module.hot) module.hot.dispose(() => app.destroy());

export { app, ready };
