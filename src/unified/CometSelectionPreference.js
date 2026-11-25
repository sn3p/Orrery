import { validCometIds } from './comets/model.js';
export const COMET_SELECTION_STORAGE_KEY = 'orrery.selectedComets';
export function loadCometSelection(scope = globalThis) {
  try {
    const value = JSON.parse(scope.localStorage?.getItem(COMET_SELECTION_STORAGE_KEY) ?? 'null');
    return Array.isArray(value) && validCometIds([...new Set(value)])
      ? [...new Set(value)] : null;
  } catch { return null; }
}
export function saveCometSelection(ids, scope = globalThis) {
  try { scope.localStorage?.setItem(COMET_SELECTION_STORAGE_KEY, JSON.stringify(ids)); }
  catch { /* Selection still works when browser storage is unavailable. */ }
}
