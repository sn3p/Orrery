// TODO:
// - Highlight MPCs the moment they are discovered
// - Draw orbits (for planets)
// - Controls: speed, etc.
// - Create React app
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

import Orrery from "./Orrery.js";
import planetData from "./planets.js";

function ajaxGet(url, callback) {
  const xhr = window.XMLHttpRequest
    ? new XMLHttpRequest()
    : new ActiveXObject("Microsoft.XMLHTTP");
  xhr.open("GET", url);
  xhr.onreadystatechange = () => {
    if (xhr.readyState > 3 && xhr.status === 200) {
      callback(xhr.responseText);
    }
  };
  xhr.setRequestHeader("X-Requested-With", "XMLHttpRequest");
  xhr.send();
  return xhr;
}

const MPC_DATA_URL = "data/mpcs.json";

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
  orrery.setAsteroids(asteroidData);
});

// Resize orrery
window.addEventListener("resize", () => {
  orrery.resize(window.innerWidth, window.innerHeight);
});
