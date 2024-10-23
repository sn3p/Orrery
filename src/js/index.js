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

const MPC_DATA_URL = catalog;

// Init Orrery
const orrery = new Orrery({
  width: window.innerWidth,
  height: window.innerHeight,
});

orrery.init().then(() => {
  // Add planets
  orrery.addPlanets(planetData);

  // Load asteroids
  // fetch(MPC_DATA_URL)
  //   .then((response) => response.json())
  //   .then((data) => {
  //     // Sort by discovery date
  //     data.sort((a, b) => a.disc - b.disc);

  //     orrery.setAsteroids(data);
  //   });

  // Resize orrery
  window.addEventListener("resize", () => {
    orrery.resize(window.innerWidth, window.innerHeight);
  });
});
