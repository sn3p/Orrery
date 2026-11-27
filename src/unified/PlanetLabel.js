import { isDwarfLabelMode } from './DwarfPreferences.js';
const EDGE_GUTTER = 8;
const FLIP_DISTANCE = 48;
export const PLANET_LABEL_STORAGE_KEY = "orrery.planetLabels";
export const DEFAULT_PLANET_LABEL_MODE = "earth";
const PLANET_LABEL_MODES = new Set(["off", "earth", "all"]);

export function isPlanetLabelMode(value) {
  return PLANET_LABEL_MODES.has(value);
}

export function planetLabelModeShows(mode, name) {
  return mode === "all" || (mode === "earth" && name === "Earth");
}

export function loadPlanetLabelMode(scope = globalThis) {
  try {
    const value = scope.localStorage?.getItem(PLANET_LABEL_STORAGE_KEY);
    return isPlanetLabelMode(value) ? value : DEFAULT_PLANET_LABEL_MODE;
  } catch { return DEFAULT_PLANET_LABEL_MODE; }
}

export function savePlanetLabelMode(mode, scope = globalThis) {
  if (!isPlanetLabelMode(mode)) return false;
  try {
    if (!scope.localStorage) return false;
    scope.localStorage.setItem(PLANET_LABEL_STORAGE_KEY, mode);
    return true;
  }
  catch { return false; }
}

export function planetLabelColor(color) {
  return Number.isInteger(color) && color >= 0 && color <= 0xffffff
    ? `#${color.toString(16).padStart(6, "0")}`
    : null;
}

export default class PlanetLabel {
  constructor(container, name, color, classification) {
    const element = container.ownerDocument.createElement("span");
    element.className = "orrery-planet-label";
    element.textContent = classification === "dwarf-planet" ? `${name} · dwarf` : name;
    if (classification) element.dataset.classification = classification;
    element.dataset.planet = name;
    const cssColor = planetLabelColor(color);
    if (cssColor) element.style.color = cssColor;
    element.setAttribute("aria-hidden", "true");
    element.hidden = true;
    container.appendChild(element);
    this.element = element;
    this.width = null;
    const Observer = container.ownerDocument.defaultView?.ResizeObserver;
    if (Observer) {
      this.observer = new Observer(entries => {
        // display:none reports zero; retain the last useful measurement.
        const width = entries[0]?.contentRect.width;
        if (width > 0) {
          this.width = width;
          if (!this.element.hidden) this.updateSide();
        }
      });
      this.observer.observe(element);
    }
  }

  place(x, y, { width, height, visible = true }) {
    const shown = visible && Number.isFinite(x) && Number.isFinite(y)
      && Number.isFinite(width) && Number.isFinite(height)
      && width > 0 && height > 0 && x >= 0 && x <= width && y >= 0 && y <= height;
    this.element.hidden = !shown;
    if (!shown) return;
    // Measure once on first display. Subsequent font/size changes arrive via
    // ResizeObserver, outside the animation loop.
    if (this.width === null) this.width = this.element.offsetWidth || 0;
    this.element.style.left = `${x}px`;
    this.element.style.top = `${Math.min(height - EDGE_GUTTER, Math.max(EDGE_GUTTER, y))}px`;
    this.x = x; this.viewportWidth = width;
    this.updateSide();
  }

  updateSide() {
    const flipDistance = Math.max(FLIP_DISTANCE, this.width + EDGE_GUTTER + 7);
    this.element.dataset.side = this.x > this.viewportWidth - flipDistance ? "left" : "right";
  }

  hide() {
    this.element.hidden = true;
  }

  destroy() {
    this.observer?.disconnect();
    this.element.remove();
  }
}

export class PlanetLabels {
  constructor(container) {
    this.container = container;
    this.labels = new Map();
  }

  setMode(planets, mode, dwarfMode = "off") {
    if (!isPlanetLabelMode(mode)) throw new RangeError("Invalid planet label mode.");
    if (!isDwarfLabelMode(dwarfMode)) throw new RangeError("Invalid dwarf label mode.");
    const wanted = new Set(planets.filter(planet => planet.options.classification === 'dwarf-planet'
      ? dwarfMode === 'all' : planetLabelModeShows(mode, planet.options.name)));
    for (const [planet, label] of this.labels) {
      if (wanted.has(planet)) continue;
      label.destroy();
      this.labels.delete(planet);
    }
    for (const planet of wanted) {
      if (!this.labels.has(planet)) {
        this.labels.set(planet, new PlanetLabel(this.container, planet.options.name, planet.options.color, planet.options.classification));
      }
    }
  }

  forEach(callback) {
    for (const [planet, label] of this.labels) callback(planet, label);
  }

  hide() {
    for (const label of this.labels.values()) label.hide();
  }

  destroy() {
    for (const label of this.labels.values()) label.destroy();
    this.labels.clear();
  }
}
