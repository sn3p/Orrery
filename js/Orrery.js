// TODO:
// - Show MPCs after they've been discovered
// - Init Graphics once to improve performance
// - Add GUI and mouse controls (ftp, zoom, speed, etc.)
// - Add 3D/Anagluph mode
// - Add Sound (optional), e.g. The Dig OST :)

class Orrery {
  constructor(options) {
    options = options || {};
    this.width = options.width || 800;
    this.height = options.height || 800;
    this.startDate = options.startDate || new Date(1981);
    this.endDate = options.endDate || new Date();
    this.jedDelta = options.jedDelta || 1;
    this.jed = this.toJED(this.startDate);

    this.planets = [];
    this.asteroids = [];

    // Create star system
    this.createSystem();
    this.createStar();

    // Start rendering
    this.animate();
  }

  createSystem() {
    this.renderer = new PIXI.CanvasRenderer(this.width, this.height, {
      backgroundColor : 0x000000
    });

    this.stage = new PIXI.Container();
    this.stage.x = this.width / 2;
    this.stage.y = this.height / 2;
    this.stage.scale.set(2);

    const orrery = document.getElementById('orrery');
    orrery.appendChild(this.renderer.view);
  }

  createStar() {
    const star = new PIXI.Graphics();
    star.beginFill(0xfff2ac);
    star.drawCircle(0, 0, 5);
    star.endFill();

    const blurFilter = new PIXI.filters.BlurFilter();
    blurFilter.passes = 1;
    blurFilter.blur = 20;
    star.filters = [blurFilter];

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

  addAsteroids(mpcData) {
    mpcData.forEach(data => {
      const asteroid = new Asteroid(data);
      this.asteroids.push(asteroid);
      this.stage.addChild(asteroid.body);
      asteroid.render(this.jed);
    });
  }

  animate() {
    requestAnimationFrame(this.animate.bind(this));

    this.jed += this.jedDelta;

    this.planets.forEach(planet => planet.render(this.jed));
    this.asteroids.forEach(asteroid => asteroid.render(this.jed));

    this.renderer.render(this.stage);

    // Display current date
    const date = this.fromJED(this.jed).toISOString().slice(0, 10);
    document.getElementById('orrery-date').textContent = date;

  }

  resize(width, height) {
    this.renderer.resize(width, height);
    this.stage.x = width / 2;
    this.stage.y = height / 2;
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
