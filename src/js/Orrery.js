import { Application, Container, ParticleContainer, Graphics, log2 } from "pixi.js";
import { toJED, fromJED } from "./utils";
import Controls from "./Controls.js";
import Stats from "./Stats.js";
import Gui from "./Gui.js";
import Planet from "./Planet.js";
import Asteroid from "./Asteroid.js";

export default class Orrery {
  constructor(options = {}) {
    this.container = options.container || document.body;
    this.startDate = options.startDate || new Date(1980, 1);
    this.jedDelta = options.jedDelta || 1.5;
    this.jed = toJED(this.startDate);
  }

  async init() {
    // Create PIXI application
    this.app = new Application();
    await this.app.init({
      resizeTo: window,
      backgroundColor: 0x000000,
      antialias: true,
    });

    this.stage = this.app.stage;
    this.canvas = this.app.canvas;

    // Add canvas to container
    this.container.appendChild(this.canvas);

    // Center the stage
    this.stage.position.set(this.canvas.width / 2, this.canvas.height / 2);

    // Setup GUI and controls
    this.setupGui();
    this.controls = new Controls(this);

    // Create star system
    this.createSystem();

    // Start the ticker
    this.app.ticker.add(this.tick.bind(this));
  }

  async createSystem() {
    this.planets = [];
    this.asteroidData = [];
    this.asteroids = [];

    // Create texture
    // TODO: create a custom texture for asteroids of 1px size?
    this.circleTexture = this.createCircleTexture();

    // Add sun
    this.addSun();

    // Container for planets
    this.planetContainer = new ParticleContainer(10);
    this.stage.addChild(this.planetContainer);

    // Container for asteroids
    this.asteroidContainer = new ParticleContainer(
      999999,
      { scale: true, tint: true },
      16384,
      true
    );
    this.stage.addChild(this.asteroidContainer);
  }

  setupGui() {
    this.gui = {};
    this.gui.date = document.getElementById("orrery-date");
    this.stats = new Stats();
    this.gui.fps = document.getElementById("orrery-fps");
    this.gui.count = document.getElementById("orrery-count");
    this.gui.controls = new Gui(this);
  }

  updateGui() {
    // Update the date
    const date = fromJED(this.jed).toISOString().slice(0, 10);
    this.gui.date.textContent = date;
    this.gui.fps.textContent = `${this.stats.fps} FPS`;
    this.gui.count.textContent = this.asteroids.length;
  }

  createCircleTexture(radius = 5) {
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
      const planet = new Planet(data.ephemeris, this.circleTexture, {
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
        this.asteroidContainer.removeParticle(asteroid.body);
      }
    }
  }

  addAsteroid(data) {
    const asteroid = new Asteroid(data, this.circleTexture);
    this.asteroids.push(asteroid);
    this.asteroidContainer.addParticle(asteroid.body);
  }

  tick() {
    this.stats.begin();

    if (this.jedDelta !== 0) {
      this.jed += this.jedDelta;

      // Discover asteroids
      this.discoverAsteroids();

      // Render planets and asteroids
      this.planets.forEach((planet) => planet.render(this.jed));
      this.asteroids.forEach((asteroid) => asteroid.render(this.jed));

      this.updateGui();
    }

    this.stats.end();
  }

  resize() {
    const { width, height } = this.canvas;
    this.app.renderer.resize(width, height);
    this.stage.position.set(width / 2, height / 2);
  }
}
