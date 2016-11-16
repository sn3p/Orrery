// Inspiration:
// https://github.com/typpo/asterank
// https://github.com/slowe/astro.js
// https://github.com/mgvez/jsorrery
// http://mgvez.github.io/jsorrery/
// https://lord.io/blog/2014/kepler/

const PIXELS_PER_AU = 50;

// Init Orrery
const orrery = new Orrery({
  width: window.innerWidth,
  height: window.innerHeight
});

// Add planets
orrery.addPlanets(planetData);

// Resize orrery
window.addEventListener('resize', () => {
  orrery.resize(window.innerWidth, window.innerHeight);
});
