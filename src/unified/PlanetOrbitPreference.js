export const PLANET_ORBIT_STORAGE_KEY = "orrery.planetOrbits";
export const DEFAULT_PLANET_ORBITS_VISIBLE = true;

export function isPlanetOrbitVisibility(value) {
  return typeof value === "boolean";
}

export function loadPlanetOrbitVisibility(scope = globalThis) {
  try {
    const value = scope.localStorage?.getItem(PLANET_ORBIT_STORAGE_KEY);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch { /* Use the visible default when storage is unavailable. */ }
  return DEFAULT_PLANET_ORBITS_VISIBLE;
}

export function savePlanetOrbitVisibility(visible, scope = globalThis) {
  if (!isPlanetOrbitVisibility(visible)) return false;
  try {
    if (!scope.localStorage) return false;
    scope.localStorage.setItem(PLANET_ORBIT_STORAGE_KEY, String(visible));
    return true;
  } catch { return false; }
}
