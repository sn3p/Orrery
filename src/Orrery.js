import * as PIXI from "pixi.js";
import Controls from "./Controls.js";
import Stats from "./Stats.js";
import Planet from "./Planet.js";
import Asteroid from "./Asteroid.js";

export default class Orrery {
  constructor(options) {
    options = options || {};
    this.width = options.width || 800;
    this.height = options.height || 800;
    this.startDate = options.startDate || new Date(1980, 1);
    this.endDate = options.endDate || new Date();
    this.jedDelta = options.jedDelta || 1.5;
    this.jed = this.toJED(this.startDate);

    this.planets = [];
    this.asteroidData = [];
    this.asteroids = [];

    // Create star system
    this.createSystem();

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
    this.gui.count.textContent = this.asteroids.length;
  }

  createSystem() {
    this.renderer = new PIXI.WebGLRenderer(this.width, this.height, {
      backgroundColor: 0x000000
      // autoResize: true,
      // transparent: true,
      // antialias: true
    });

    // Container for graphics
    this.stage = new PIXI.Container();
    this.stage.x = this.width / 2;
    this.stage.y = this.height / 2;

    // Add star
    this.addStar();

    // Container for particles
    this.planetContainer = new PIXI.particles.ParticleContainer(10);
    this.stage.addChild(this.planetContainer);

    // this.particles = new PIXI.Container();
    this.particleContainer = new PIXI.particles.ParticleContainer(
      999999,
      { scale: true, tint: true },
      16384,
      true
    );
    this.stage.addChild(this.particleContainer);

    // Create textures
    this.cirleTexture = this.createCirleTexture();

    // Render the view
    const orrery = document.getElementById("orrery");
    orrery.appendChild(this.renderer.view);
  }

  createCirleTexture(radius = 5) {
    const graphics = new PIXI.Graphics();
    graphics.beginFill(0xffffff);
    graphics.drawCircle(0, 0, radius);
    graphics.endFill();

    return this.renderer.generateTexture(graphics);
  }

  addStar() {
    const star = new PIXI.Graphics();
    star.beginFill(0xfff2ac);
    star.drawCircle(0, 0, 5);
    star.endFill();

    this.stage.addChild(star);
  }

  addPlanets(planetData) {
    planetData.forEach(data => {
      const planet = new Planet(data.ephemeris, this.cirleTexture, {
        name: data.name,
        size: data.size,
        color: data.color
      });

      this.planets.push(planet);
      this.planetContainer.addChild(planet.body);
    });
  }

  setAsteroids(asteroidData) {
    this.asteroidData = asteroidData;

    // Add all asteroids at once (for debugging/performance testing)
    // this.asteroidData = [];
    // asteroidData.forEach(data => this.addAsteroid(data));
  }

  discoverAsteroids(jed) {
    let discoveryCount = 0;

    for (let data of this.asteroidData) {
      if (data.disc > jed) {
        break;
      }

      discoveryCount++;
      this.addAsteroid(data);
    }

    if (discoveryCount > 0) {
      this.asteroidData.splice(0, discoveryCount);
    }
  }

  addAsteroid(data) {
    const asteroid = new Asteroid(data, this.cirleTexture);
    this.asteroids.push(asteroid);
    this.particleContainer.addChild(asteroid.body);
    this.asteroidCount++;
  }

  tick() {
    this.stats.begin();

    this.jed += this.jedDelta;

    // Add asteroids
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
    this.width = width;
    this.height = height;
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
