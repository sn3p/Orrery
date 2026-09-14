import App from "./App.js";
import planets from "../js/planets.js";
import catalogURL from "../../data/catalog.json";
import "../css/main.css";
import "./preview.css";
import "../fonts/OFL.txt";

const app = new App({ container: document.getElementById("orrery") });
app.init().then(() => {
  app.addPlanets(planets);
  return app.loadAsteroids(catalogURL);
}).catch(() => { /* App owns initialization error feedback and cleanup. */ });

// Unaccepted application edits reload the document; dispose pending work first.
if (module.hot) module.hot.dispose(() => app.destroy());
