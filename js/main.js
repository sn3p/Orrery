// Inspiration:
// https://github.com/typpo/asterank
// https://github.com/slowe/astro.js
// https://github.com/mgvez/jsorrery
// http://mgvez.github.io/jsorrery/
// https://lord.io/blog/2014/kepler/

// function ajaxGet(url, callback) {
//   const xhr = window.XMLHttpRequest ? new XMLHttpRequest()
//                                     : new ActiveXObject('Microsoft.XMLHTTP');
//   xhr.open('GET', url);
//   xhr.onreadystatechange = () => {
//     if (xhr.readyState > 3 && xhr.status === 200) {
//       callback(xhr.responseText);
//     }
//   };
//   xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
//   xhr.send();
//   return xhr;
// }

const asteroids = [{
  epoch: 2456400.5,     // Epoch (Julian date)
  a: 2.767993,          // Semi-major axis (AU)
  e: 0.0761669,         // Orbital eccentricity
  i: 10.59423,          // Orbital inclination (degrees)
  W: 80.33008,          // Longitude of ascending node (degrees, Ω)
  w: 72.16707,          // Argument of perihelion (degrees, ω)
  M: 327.85412,         // Mean anomaly (degrees)
  n: 0.2140211,         // Mean daily motion (degrees)
}];

const PIXELS_PER_AU = 50;

// Init Orrery
const orrery = new Orrery({
  width: window.innerWidth,
  height: window.innerHeight
});

// Add planets
orrery.addPlanets(planetData);

// Get MPCs
// ajaxGet('data/mpcs.json', (data) => {
//   const json = JSON.parse(data);
//   console.log(json);
//   // orrery.addAsteroids(planetData);
// });

// Resize orrery
window.addEventListener('resize', () => {
  orrery.resize(window.innerWidth, window.innerHeight);
});
