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
  constructor(container, name, color) {
    const element = container.ownerDocument.createElement("span");
    element.className = "orrery-planet-label";
    element.textContent = name;
    element.dataset.planet = name;
    const cssColor = planetLabelColor(color);
    if (cssColor) element.style.color = cssColor;
    element.setAttribute("aria-hidden", "true");
    element.hidden = true;
    container.appendChild(element);
    this.element = element;
  }

  place(x, y, { width, height, visible = true }) {
    const shown = visible && Number.isFinite(x) && Number.isFinite(y)
      && Number.isFinite(width) && Number.isFinite(height)
      && width > 0 && height > 0 && x >= 0 && x <= width && y >= 0 && y <= height;
    this.element.hidden = !shown;
    if (!shown) return;
    this.element.style.left = `${x}px`;
    this.element.style.top = `${Math.min(height - EDGE_GUTTER, Math.max(EDGE_GUTTER, y))}px`;
    this.element.dataset.side = x > width - FLIP_DISTANCE ? "left" : "right";
  }

  hide() {
    this.element.hidden = true;
  }

  destroy() {
    this.element.remove();
  }
}

export class PlanetLabels {
  constructor(container) {
    this.container = container;
    this.labels = new Map();
  }

  setMode(planets, mode) {
    if (!isPlanetLabelMode(mode)) throw new RangeError("Invalid planet label mode.");
    const wanted = new Set(planets.filter(planet => planetLabelModeShows(mode, planet.options.name)));
    for (const [planet, label] of this.labels) {
      if (wanted.has(planet)) continue;
      label.destroy();
      this.labels.delete(planet);
    }
    for (const planet of wanted) {
      if (!this.labels.has(planet)) {
        this.labels.set(planet, new PlanetLabel(this.container, planet.options.name, planet.options.color));
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
