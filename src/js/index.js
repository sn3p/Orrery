// TODO:
// - Draw orbits (for planets)
// - Create layers: planets above asteroids
// - Support compact JSON data for asteroids
//
// Inspiration:
// https://www.youtube.com/watch?v=BKKg4lZ_o-Y
// https://github.com/typpo/asterank
// https://github.com/slowe/astro.js
// https://github.com/mgvez/jsorrery
// http://mgvez.github.io/jsorrery/
// https://lord.io/blog/2014/kepler/

import Orrery from "./Orrery.js";
import planetData from "./planets.js";
import catalog from "../../data/catalog.json";
import "../css/main.css";
import "../fonts/OFL.txt";

const MPC_DATA_URL = catalog;

// Init Orrery
const orrery = new Orrery({
  container: document.getElementById("orrery"),
});

orrery.init().then(() => {
  // Add planets
  orrery.addPlanets(planetData);

  orrery.loadAsteroids(MPC_DATA_URL);
}).catch(() => {
  document.getElementById("orrery-status").textContent = "Unable to start the visualization. WebGL is required.";
});
