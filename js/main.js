// Inspiration:
// https://www.youtube.com/watch?v=BKKg4lZ_o-Y
// https://github.com/typpo/asterank
// https://github.com/slowe/astro.js
// https://github.com/mgvez/jsorrery
// http://mgvez.github.io/jsorrery/
// https://lord.io/blog/2014/kepler/

function ajaxGet(url, callback) {
  const xhr = window.XMLHttpRequest ? new XMLHttpRequest()
                                    : new ActiveXObject('Microsoft.XMLHTTP');
  xhr.open('GET', url);
  xhr.onreadystatechange = () => {
    if (xhr.readyState > 3 && xhr.status === 200) {
      callback(xhr.responseText);
    }
  };
  xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
  xhr.setRequestHeader('Cache-Control', 'max-age=0');
  xhr.send();
  return xhr;
}

const PIXELS_PER_AU = 50;

// Init Orrery
const orrery = new Orrery({
  width: window.innerWidth,
  height: window.innerHeight
});

// Add planets
orrery.addPlanets(planetData);

// Load MPCs
ajaxGet('data/mpcs.json', (data) => {
  const asteroids = JSON.parse(data);
  orrery.addAsteroids(asteroids);
});

// Resize orrery
window.addEventListener('resize', () => {
  orrery.resize(window.innerWidth, window.innerHeight);
});
