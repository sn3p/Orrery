// TODO:
// - Render MPCs from the moment they've been discovered
// - Init Graphics once to improve performance
// - Draw orbits (for planets)
// - GUI: mpc count, etc.
// - Controls: speed, etc.
// - Create React app
// - Add 3D/Anaglyph mode
// - Add Sound (optional), e.g. The Dig OST :)
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
    this.gui.date = document.getElementById('orrery-date');

    this.stats = new Stats();
    this.gui.fps = document.getElementById('orrery-fps');

    this.gui.count = document.getElementById('orrery-count');
  }

  updateGui() {
    // Update current date
    const date = this.fromJED(this.jed).toISOString().slice(0, 10);
    this.gui.date.textContent = date;

    this.gui.fps.textContent = `${this.stats.fps} FPS`;
    this.gui.count.textContent = this.asteroidCount;
  }

  createSystem() {
    // this.renderer = new PIXI.autoDetectRenderer(this.width, this.height, {
    this.renderer = new PIXI.CanvasRenderer(this.width, this.height, {
    // this.renderer = new PIXI.WebGLRenderer(this.width, this.height, {
      backgroundColor : 0x000000,
      // autoResize: true,
      // transparent: true,
      // antialias: true
    });
    this.graphics = new PIXI.Graphics();
    this.graphics.x = this.width / 2;
    this.graphics.y = this.height / 2;

    const orrery = document.getElementById('orrery');
    orrery.appendChild(this.renderer.view);
  }

  createStar() {
    const star = new PIXI.Graphics();
    star.beginFill(0xfff2ac);
    star.drawCircle(0, 0, 5);
    star.endFill();

    this.star = star;
    this.graphics.addChild(this.star);
  }

  addPlanets(planetData) {
    planetData.forEach(data => {
      const planet = new Planet(data.ephemeris, {
        name: data.name,
        size: data.size,
        color: data.color
      });
      this.planets.push(planet);
      this.graphics.addChild(planet.body);
      planet.render(this.jed);
    });
  }

  setAsteroids(asteroidData) {
    this.asteroids = asteroidData;
  }

  drawAsteroids(jed) {
    this.asteroidCount = 0;

    for (let asteroid of this.asteroids) {
      if (asteroid.disc <= jed) {
        this.drawAsteroid(asteroid);
        this.asteroidCount++;
      }
    }
  }

  drawAsteroid(data) {
    const orbit = new Orbit(data);
    const {x, y} = orbit.getPosAtTime(this.jed);
    this.graphics.beginFill(0xffffff);
    this.graphics.drawCircle(x, y, 0.5);
    this.graphics.endFill();
  }

  tick() {
    this.stats.begin();

    this.graphics.clear();
    this.jed += this.jedDelta;

    // Draw asteroids
    this.drawAsteroids(this.jed);

    // Render
    this.planets.forEach(planet => planet.render(this.jed));
    this.renderer.render(this.graphics);

    this.updateGui();

    this.stats.end();
    requestAnimationFrame(this.tick.bind(this));
  }

  resize(width, height) {
    this.renderer.resize(width, height);
    this.graphics.x = width / 2;
    this.graphics.y = height / 2;
  }

  // Gregorian to Julian date
  toJED(d){
    return d / 86400000 + 2440587.5;
  }

  // Julian to Gregorian date
  fromJED(jed) {
    return new Date(86400000 * (-2440587.5 + jed));
  }
}
