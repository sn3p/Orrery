import App from "./App.js";
import Intro from "./ui/Intro.js";
import planets from "../js/planets.js";
import { parseShareDate } from "./shareUrl.js";
import "../css/main.css";
import "./preview.css";
import "../fonts/OFL.txt";

const selection = __CATALOG_SELECTION__;
const params = new URLSearchParams(location.search);
const shareJed = parseShareDate(params.get("date"));
const app = new App({ container: document.getElementById("orrery"),
  renderer: params.get("renderer") ?? "pixi", startJed: selection?.startJed,
  jed: shareJed ?? undefined, jedDelta: shareJed != null ? 0 : selection?.speed });
// The introduction and its footer trigger stay usable even if the renderer fails to start.
const intro = new Intro(app);
const ready = app.init().then(() => {
  app.addPlanets(planets);
  const pin = selection.pin && { ...selection.pin, url: new URL(selection.pin.url, document.baseURI).href };
  return app.loadCatalog(pin, { mode: selection.mode, latest: selection.latest });
}).catch(() => { /* App owns initialization error feedback and cleanup. */ });

// Unaccepted application edits reload the document; dispose pending work first.
if (module.hot) module.hot.dispose(() => { intro.destroy(); app.destroy(); });

export { app, ready };
