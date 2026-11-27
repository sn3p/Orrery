export const DEFAULT_PLANET_ORBITS_VISIBLE = true;

export function isPlanetOrbitVisibility(value) {
  return typeof value === "boolean";
}

export function applyOrbitVisibility(orbits, planets, planetVisible, dwarfVisible) {
  orbits.forEach((orbit, index) => {
    orbit.visible = planets[index]?.options.classification === 'dwarf-planet' ? dwarfVisible : planetVisible;
  });
}
