// TODO:
// - Render MPCs from the moment they've been discovered
// - Init Graphics once to improve performance
// - Draw orbits (for planets)
// - GUI: mpc count, etc.
// - Controls: speed, etc.
// - Create React app
// - Add 3D/Anaglyph mode
// - Create layers: planets above asteroids

class Orrery {
  constructor(options) {
    options = options || {};
    this.width = options.width || 800;
    this.height = options.height || 800;
    this.startDate = options.startDate || new Date(1980, 1);
    this.endDate = options.endDate || new Date();
    this.jedDelta = options.jedDelta || 1.5;
    this.jed = this.toJED(this.startDate);

    this.planets = [];
    this.undiscoveredAsteroids = [];
    this.asteroids = [];
    this.asteroidCount = 0;

    // Create star system
    this.createSystem();
    this.createStar();

    // Setup GUI and controls
    this.setupGui();
    this.controls = new Controls(this);

    // Start rendering
    this.tick();
  }

  setupGui() {
    this.gui = {};
    this.gui.date = document.getElementById("orrery-date");

    this.stats = new Stats();
    this.gui.fps = document.getElementById("orrery-fps");

    this.gui.count = document.getElementById("orrery-count");
  }

  updateGui() {
    // Update current date
    const date = this.fromJED(this.jed)
      .toISOString()
      .slice(0, 10);
    this.gui.date.textContent = date;

    this.gui.fps.textContent = `${this.stats.fps} FPS`;
    this.gui.count.textContent = this.asteroidCount;
  }

  createSystem() {
    // this.renderer = new PIXI.autoDetectRenderer(this.width, this.height, {
    this.renderer = new PIXI.CanvasRenderer(this.width, this.height, {
      // this.renderer = new PIXI.WebGLRenderer(this.width, this.height, {
      backgroundColor: 0x000000
      // autoResize: true,
      // transparent: true,
      // antialias: true
    });

    this.stage = new PIXI.Container();
    this.stage.x = this.width / 2;
    this.stage.y = this.height / 2;

    const orrery = document.getElementById("orrery");
    orrery.appendChild(this.renderer.view);
  }

  createStar() {
    const star = new PIXI.Graphics();
    star.beginFill(0xfff2ac);
    star.drawCircle(0, 0, 5);
    star.endFill();

    this.star = star;
    this.stage.addChild(this.star);
  }

  addPlanets(planetData) {
    planetData.forEach(data => {
      const planet = new Planet(data.ephemeris, {
        name: data.name,
        size: data.size,
        color: data.color
      });
      this.planets.push(planet);
      this.stage.addChild(planet.body);
      planet.render(this.jed);
    });
  }

  setAsteroids(asteroidData) {
    this.undiscoveredAsteroids = asteroidData;

    // Add all asteroids at once (for debugging/performance testing)
    // asteroidData.forEach(data => this.addAsteroid(data));
  }

  discoverAsteroids(jed) {
    let discoveryCount = 0;

    for (let data of this.undiscoveredAsteroids) {
      if (data.disc > jed) {
        break;
      }

      discoveryCount++;
      this.addAsteroid(data);
    }

    if (discoveryCount > 0) {
      this.undiscoveredAsteroids.splice(0, discoveryCount);
    }
  }

  addAsteroid(data) {
    const asteroid = new Asteroid(data);
    this.asteroids.push(asteroid);
    this.stage.addChild(asteroid.body);
    this.asteroidCount++;
    asteroid.render(this.jed);
  }

  tick() {
    this.stats.begin();

    this.jed += this.jedDelta;

    // Discover new asteroids
    this.discoverAsteroids(this.jed);

    // Render
    this.planets.forEach(planet => planet.render(this.jed));
    this.asteroids.forEach(asteroid => asteroid.render(this.jed));
    this.renderer.render(this.stage);

    this.updateGui();

    this.stats.end();
    requestAnimationFrame(this.tick.bind(this));
  }

  resize(width, height) {
    this.renderer.resize(width, height);
    this.stage.x = width / 2;
    this.stage.y = height / 2;
  }

  // Gregorian to Julian date
  toJED(d) {
    return d / 86400000 + 2440587.5;
  }

  // Julian to Gregorian date
  fromJED(jed) {
    return new Date(86400000 * (-2440587.5 + jed));
  }
}
