// TODO:
// - Highlight MPCs the moment they are discovered
// - Draw orbits (for planets)
// - Controls: speed, etc.
// - Add 3D/Anaglyph mode
// - Create layers: planets above asteroids
//
// Inspiration:
// https://www.youtube.com/watch?v=BKKg4lZ_o-Y
// https://github.com/typpo/asterank
// https://github.com/slowe/astro.js
// https://github.com/mgvez/jsorrery
// http://mgvez.github.io/jsorrery/
// https://lord.io/blog/2014/kepler/

import { ajaxGet } from "./utils";
import Orrery from "./Orrery.js";
import planetData from "./planets.js";
import catalog from "../../data/catalog.json";
import "../css/main.css";

const MPC_DATA_URL = catalog;

// Init Orrery
const orrery = new Orrery({
  width: window.innerWidth,
  height: window.innerHeight
});

// Add planets
orrery.addPlanets(planetData);

// Load asteroids
ajaxGet(MPC_DATA_URL, data => {
  const asteroidData = JSON.parse(data);

  // Sort by discovery date
  asteroidData.sort((a, b) => a.disc - b.disc);

  orrery.setAsteroids(asteroidData);
});

// Resize orrery
window.addEventListener("resize", () => {
  orrery.resize(window.innerWidth, window.innerHeight);
});
