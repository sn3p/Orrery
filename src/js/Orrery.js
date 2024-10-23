import { Application, Container, ParticleContainer, Graphics } from "pixi.js";
import { toJED, fromJED } from "./utils";
import Controls from "./Controls.js";
import Stats from "./Stats.js";
import Gui from "./Gui.js";
import Planet from "./Planet.js";
import Asteroid from "./Asteroid.js";

export default class Orrery {
  constructor(options = {}) {
    this.width = options.width || 800;
    this.height = options.height || 800;
    this.startDate = options.startDate || new Date(1980, 1);
    this.jedDelta = options.jedDelta || 1.5;
    this.jed = toJED(this.startDate);

    // Create star system
    // this.createSystem();

    // Setup GUI and controls
    // this.setupGui();
    // this.controls = new Controls(this);

    // Start rendering
    // this.tick();
    // this.app.ticker.add(this.tick.bind(this));
  }

  async init() {
    // Create PIXI application
    this.app = new Application();
    this.stage = this.app.stage;

    await this.app.init({
      width: this.width,
      height: this.height,
      backgroundColor: 0x000000,
      antialias: true,
      // autoResize: true,
      // transparent: true,
      // forceFXAA: true,
      // resizeTo: window,
    });

    // TODO: append to document.body
    const orrery = document.getElementById("orrery");
    orrery.appendChild(this.app.canvas);

    // Center the stage
    this.stage.position.set(this.width / 2, this.height / 2);

    // Create star system
    this.createSystem();

    // Start the ticker
    this.app.ticker.add(this.tick.bind(this));
  }

  async createSystem() {
    this.planets = [];
    this.asteroidData = [];
    this.asteroids = [];

    // Add sun
    this.addSun();

    // Container for planets
    this.planetContainer = new ParticleContainer(10);
    this.stage.addChild(this.planetContainer);

    //
    this.cirleTexture = this.createCirleTexture();

    return;

    this.renderer = new autoDetectRenderer({
      width: this.width,
      height: this.height,
      backgroundColor: 0x000000,
      // autoResize: true,
      // transparent: true,
      antialias: true,
      // forceFXAA: true
    });

    // Main container
    this.stage = new Container();
    this.stage.x = this.width / 2;
    this.stage.y = this.height / 2;

    // Add sun
    this.addSun();

    // Container for planets
    this.planetContainer = new ParticleContainer(10);
    this.stage.addChild(this.planetContainer);

    // Container for asteroids
    this.particleContainer = new ParticleContainer(
      999999,
      { scale: true, tint: true },
      16384,
      true
    );
    this.stage.addChild(this.particleContainer);

    // Create textures
    this.cirleTexture = this.createCirleTexture();

    // Render the view
    // const orrery = document.getElementById("orrery");
    orrery.appendChild(this.renderer.view);
  }

  // setupGui() {
  //   this.gui = {};
  //   this.gui.date = document.getElementById("orrery-date");

  //   this.stats = new Stats();
  //   this.gui.fps = document.getElementById("orrery-fps");

  //   this.gui.count = document.getElementById("orrery-count");

  //   this.gui.controls = new Gui(this);
  // }

  // updateGui() {
  //   // Update the date
  //   const date = fromJED(this.jed).toISOString().slice(0, 10);

  //   this.gui.date.textContent = date;

  //   this.gui.fps.textContent = `${this.stats.fps} FPS`;
  //   this.gui.count.textContent = this.asteroids.length;
  // }

  // createCirleTexture(radius = 1) {
  createCirleTexture(radius = 5) {
    const gfx = new Graphics();
    gfx.circle(0, 0, radius).fill({ color: 0xffffff });
    return this.app.renderer.generateTexture(gfx);
  }

  addSun() {
    const sun = new Graphics();
    sun.circle(0, 0, 5).fill({ color: 0xfff2ac });
    this.stage.addChild(sun);
  }

  addPlanets(planets) {
    planets.forEach((data) => {
      const planet = new Planet(data.ephemeris, this.cirleTexture, {
        name: data.name,
        size: data.size,
        color: data.color,
      });

      // Draw orbit
      const orbit = planet.orbit.drawOrbit(this.jed);
      this.stage.addChild(orbit);

      // Add planet
      this.planets.push(planet);
      this.planetContainer.addParticle(planet.body);
    });
  }

  setAsteroids(asteroidData) {
    this.asteroidData = asteroidData;

    // Add all asteroids at once (for debugging/performance testing)
    // asteroidData.forEach(data => this.addAsteroid(data));
  }

  discoverAsteroids() {
    if (this.jedDelta > 0) {
      // Forward in time
      for (let i = this.asteroids.length; i < this.asteroidData.length; ++i) {
        const data = this.asteroidData[i];

        if (data.disc > this.jed) {
          break;
        }

        // Add asteroid
        this.addAsteroid(data);
      }
    } else {
      // Backward in time
      for (let i = this.asteroids.length - 1; i >= 0; --i) {
        const asteroid = this.asteroids[i];

        if (asteroid.disc < this.jed) {
          this.asteroids.splice(i + 1);
          break;
        }

        // Remove asteroid
        this.particleContainer.removeChild(asteroid.body);
      }
    }
  }

  addAsteroid(data) {
    const asteroid = new Asteroid(data, this.cirleTexture);
    this.asteroids.push(asteroid);
    this.particleContainer.addChild(asteroid.body);
  }

  tick(ticker) {
    // console.log(ticker);

    // this.stats.begin();

    if (this.jedDelta !== 0) {
      this.jed += this.jedDelta;

      // Discover asteroids
      // this.discoverAsteroids();

      // Render planets and asteroids
      this.planets.forEach((planet) => planet.render(this.jed));
      // this.asteroids.forEach((asteroid) => asteroid.render(this.jed));
      // this.renderer.render(this.stage);

      // this.updateGui();
    }

    // this.stats.end();
  }

  // tick = () => {
  //   requestAnimationFrame(this.tick);

  //   this.stats.begin();

  //   if (this.jedDelta !== 0) {
  //     this.jed += this.jedDelta;

  //     // Discover asteroids
  //     this.discoverAsteroids();

  //     // Render everything
  //     this.planets.forEach((planet) => planet.render(this.jed));
  //     this.asteroids.forEach((asteroid) => asteroid.render(this.jed));
  //     this.renderer.render(this.stage);

  //     this.updateGui();
  //   }

  //   this.stats.end();
  // };

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.renderer.resize(width, height);
    this.stage.x = width / 2;
    this.stage.y = height / 2;
  }
}
