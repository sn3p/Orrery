export const REAL_TIME_STORAGE_KEY = "orrery.realTime";
export const DEFAULT_REAL_TIME = false;

export function loadRealTimePreference(scope = globalThis) {
  try {
    const value = scope.localStorage?.getItem(REAL_TIME_STORAGE_KEY);
    if (value === "true") return true;
    if (value === "false") return false;
  } catch { /* Use the default when storage is unavailable. */ }
  return DEFAULT_REAL_TIME;
}

export function saveRealTimePreference(enabled, scope = globalThis) {
  if (typeof enabled !== "boolean") return false;
  try {
    if (!scope.localStorage) return false;
    scope.localStorage.setItem(REAL_TIME_STORAGE_KEY, String(enabled));
    return true;
  } catch { return false; }
}
