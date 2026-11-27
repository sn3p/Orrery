export const DWARF_LABEL_STORAGE_KEY = 'orrery.dwarfLabels';
export const isDwarfLabelMode = value => value === 'off' || value === 'all';

export function loadDwarfLabelMode(scope = globalThis) {
  try {
    const value = scope.localStorage?.getItem(DWARF_LABEL_STORAGE_KEY);
    return isDwarfLabelMode(value) ? value : 'off';
  } catch { return 'off'; }
}

export function saveDwarfLabelMode(value, scope = globalThis) {
  if (!isDwarfLabelMode(value)) return false;
  try {
    if (!scope.localStorage) return false;
    scope.localStorage.setItem(DWARF_LABEL_STORAGE_KEY, value);
    return true;
  } catch { return false; }
}
