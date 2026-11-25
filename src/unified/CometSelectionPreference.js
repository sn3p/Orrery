import { validCometIds } from './comets/model.js';
export const COMET_SELECTION_STORAGE_KEY = 'orrery.selectedComets';
const EDIT_PREFIX = `${COMET_SELECTION_STORAGE_KEY}.edit.`;
const applyEdit = (ids, edit) => edit.replace !== undefined ? [...edit.replace]
  : [...new Set([...(ids ?? edit.base ?? []).filter(id => !edit.remove.includes(id)), ...edit.add])];
const validEdit = edit => edit && (edit.base === undefined || validCometIds(edit.base)) && (edit.replace !== undefined ? validCometIds(edit.replace)
  : validCometIds(edit.add) && validCometIds(edit.remove));
function readBase(scope) {
  try {
    const value = JSON.parse(scope.localStorage?.getItem(COMET_SELECTION_STORAGE_KEY) ?? 'null');
    return Array.isArray(value) && validCometIds([...new Set(value)]) ? [...new Set(value)] : null;
  } catch { return null; }
}
function readEdits(scope) {
  const edits = [];
  try {
    const storage = scope.localStorage;
    for (let i = 0; i < (storage?.length ?? 0); i++) {
      const key = storage.key(i);
      if (!key?.startsWith(EDIT_PREFIX)) continue;
      try {
        const edit = JSON.parse(storage.getItem(key));
        if (validEdit(edit)) edits.push({key, edit});
      } catch { /* Ignore malformed browser preferences. */ }
    }
  } catch { /* Storage may be unavailable. */ }
  return edits.sort((a,b) => a.key.localeCompare(b.key));
}
export function loadCometSelection(scope = globalThis) {
  return readEdits(scope).reduce((ids, record) => applyEdit(ids, record.edit), readBase(scope));
}
export function saveCometSelection(ids, scope = globalThis) {
  try {
    if (!scope.localStorage) return false;
    scope.localStorage.setItem(COMET_SELECTION_STORAGE_KEY, JSON.stringify(ids));
    return true;
  } catch { return false; }
}

// Desired IDs are canonical; App derives active IDs from catalogue membership.
// Each edit is durable before returning to the UI. Locks compact the journal
// into the legacy array without losing other tabs' edits or reloads mid-save.
export class CometSelectionPreference {
  constructor(onChange, scope = globalThis) {
    this.scope = scope;
    this.onChange = onChange;
    this.ids = loadCometSelection(scope);
    this.pending = [];
    this.saved = Promise.resolve();
    this.onStorage = event => {
      if (event.key === COMET_SELECTION_STORAGE_KEY || event.key?.startsWith(EDIT_PREFIX) || event.key === null) this.refresh();
    };
    scope.addEventListener?.('storage', this.onStorage);
    if (readEdits(scope).length) this.flush();
  }
  initialize(ids) { this.ids ??= [...ids]; }
  publish(ids) {
    if (JSON.stringify(ids) === JSON.stringify(this.ids)) return;
    this.ids = ids;
    if (!this.closed) this.onChange();
  }
  refresh() {
    if (!this.closed) this.publish(this.pending.reduce(applyEdit, loadCometSelection(this.scope)));
  }
  edit(edit) {
    const records = readEdits(this.scope);
    const clock = Math.max(Date.now() * 1000, ...records.map(record => Number(record.key.slice(EDIT_PREFIX.length).split('-')[0]) + 1));
    const key = `${EDIT_PREFIX}${clock}-${this.scope.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    // A baseline travels with the operation; never overwrite another tab's
    // snapshot while initializing first-visit defaults.
    edit = { ...edit, base: this.ids ?? [] };
    try {
      if (!this.scope.localStorage) throw new Error('Storage unavailable');
      this.scope.localStorage.setItem(key, JSON.stringify(edit));
    } catch { this.pending.push(edit); }
    this.ids = applyEdit(this.ids, edit);
    this.onChange();
    return this.flush();
  }
  flush() {
    const write = () => {
      const records = readEdits(this.scope);
      const next = this.pending.reduce(applyEdit, records.reduce((ids, record) => applyEdit(ids, record.edit), readBase(this.scope)) ?? this.ids);
      if (next !== null && saveCometSelection(next, this.scope)) {
        // Delete oldest first: any remaining suffix is safe to replay on next.
        for (const record of records) this.scope.localStorage.removeItem(record.key);
        this.pending = [];
      }
      this.refresh();
    };
    // Without Web Locks keep durable operations rather than racing compaction.
    this.saved = this.saved.then(() => this.scope.navigator?.locks
      ? this.scope.navigator.locks.request(COMET_SELECTION_STORAGE_KEY, write) : undefined)
      .catch(() => { /* The journal survives; a later edit or reload retries. */ });
    return this.saved;
  }
  missingNotice(catalogue) {
    const available = new Set(catalogue.map(entry => entry.id));
    const signature = JSON.stringify((this.ids ?? []).filter(id => !available.has(id)).sort());
    const key = `${COMET_SELECTION_STORAGE_KEY}.missing`;
    let previous = this.missingSignature;
    try { previous = this.scope.localStorage?.getItem(key) ?? previous; this.scope.localStorage?.setItem(key, signature); } catch { /* In-memory acknowledgement still works. */ }
    this.missingSignature = signature;
    return signature !== '[]' && signature !== previous ? 'Some saved comets are absent from this catalogue.' : '';
  }
  destroy() { this.closed = true; this.scope.removeEventListener?.('storage', this.onStorage); }
}
