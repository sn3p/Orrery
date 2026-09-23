// Instrument the real configured production entry. Public startup is Three.js;
// Pixi catalogue probes pass ?renderer=pixi.
import { app, ready } from "../src/unified/index.js";
import { prepareOrbits } from "../src/js/asteroidOrbits.js";
import CatalogSource from "../src/unified/catalog/CatalogSource.js";
window.catalogTest = { app, prepareOrbits, CatalogSource };
window.catalogReady = ready;
