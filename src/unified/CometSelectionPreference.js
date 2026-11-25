import { validCometIds } from './comets/model.js';
export const COMET_SELECTION_STORAGE_KEY = 'orrery.selectedComets';
const EDIT_PREFIX = `${COMET_SELECTION_STORAGE_KEY}.edit.`;
const applyEdit = (ids, edit) => edit.replace !== undefined ? [...edit.replace]
  : [...new Set([...(ids ?? edit.base ?? []).filter(id => !edit.remove.includes(id)), ...edit.add])];
const validEdit = edit => edit && (edit.base === undefined || validCometIds(edit.base)) && (edit.replace !== undefined ? validCometIds(edit.replace)
  : validCometIds(edit.add) && validCometIds(edit.remove));
const emptySnapshot = ids => ({version: 1, ids, clocks: {}, replacement: ''});
const validClock = value => typeof value === 'string' && (value === '' || value.startsWith(EDIT_PREFIX));
function readSnapshot(scope) {
  try {
    const value = JSON.parse(scope.localStorage?.getItem(COMET_SELECTION_STORAGE_KEY) ?? 'null');
    // Existing browsers saved a plain ID array; retain that migration path.
    if (Array.isArray(value) && validCometIds([...new Set(value)])) return emptySnapshot([...new Set(value)]);
    if (value?.version === 1 && validCometIds(value.ids) && value.clocks && typeof value.clocks === 'object'
      && validCometIds(Object.keys(value.clocks)) && Object.values(value.clocks).every(validClock)
      && validClock(value.replacement)) return value;
  } catch { /* Storage may be unavailable or malformed. */ }
  return null;
}
function applyRecord(snapshot, {key, edit}) {
  const current = snapshot ?? emptySnapshot(edit.base ?? []);
  const ids = new Set(current.ids), clocks = {...current.clocks};
  let replacement = current.replacement;
  if (edit.replace !== undefined) {
    if (key <= replacement) return current;
    const selected = new Set(edit.replace);
    for (const id of new Set([...ids, ...selected])) {
      if ((clocks[id] ?? '') <= key) {
        if (selected.has(id)) ids.add(id); else ids.delete(id);
      }
    }
    replacement = key;
    for (const id of Object.keys(clocks)) if (clocks[id] <= key) delete clocks[id];
  } else {
    for (const [selected, entries] of [[false, edit.remove], [true, edit.add]]) for (const id of entries) {
      if (key <= replacement || key <= (clocks[id] ?? '')) continue;
      if (selected) ids.add(id); else ids.delete(id);
      clocks[id] = key;
    }
  }
  return {version: 1, ids: [...ids], clocks, replacement};
}
const replay = (scope, records) => records.reduce(applyRecord, readSnapshot(scope));
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
  return edits.sort((a,b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}
export function loadCometSelection(scope = globalThis) {
  return replay(scope, readEdits(scope))?.ids ?? null;
}
// All capable tabs use the same transaction domain, including tabs that also
// hold a Web Lock. The callback is synchronous while the readwrite lock is held.
function withStorageTransaction(scope, write) {
  if (!scope.indexedDB) return scope.navigator?.locks ? write() : undefined;
  return new Promise((resolve, reject) => {
    const request = scope.indexedDB.open(COMET_SELECTION_STORAGE_KEY, 1);
    let unavailable = false;
    request.onupgradeneeded = () => request.result.createObjectStore('mutex');
    request.onerror = () => reject(request.error);
    request.onblocked = () => { unavailable = true; reject(new Error('Preference database blocked')); };
    request.onsuccess = () => {
      const db = request.result;
      if (unavailable) { db.close(); return; }
      const transaction = db.transaction('mutex', 'readwrite');
      let failure;
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = () => { db.close(); reject(failure ?? transaction.error); };
      transaction.objectStore('mutex').get('selection').onsuccess = () => {
        try { write(); } catch (error) { failure = error; transaction.abort(); }
      };
    };
  });
}

// Desired IDs are canonical; App derives active IDs from catalogue membership.
// Each edit is durable before returning to the UI. Locks compact the journal
// into a versioned snapshot. Per-ID clocks preserve ordering even when another
// tab compacts newer operations before an older failed write recovers.
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
  records() {
    // Failed writes retain their original ordering key, rather than becoming
    // an unconditional tail applied after every newer durable edit.
    return [...readEdits(this.scope), ...this.pending].sort((a,b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  }
  refresh() {
    if (!this.closed) this.publish(replay(this.scope, this.records())?.ids ?? null);
  }
  edit(edit) {
    const records = this.records();
    const snapshot = readSnapshot(this.scope);
    const current = records.reduce(applyRecord, snapshot)?.ids ?? this.ids;
    // Empty deltas are redundant; explicit Clear/Undo or per-ID actions still
    // establish ordering against unseen edits in another tab.
    if (edit.replace === undefined && !edit.add.length && !edit.remove.length) {
      this.publish(current);
      return this.saved;
    }
    const stamps = [...records.map(record => record.key), ...Object.values(snapshot?.clocks ?? {}), snapshot?.replacement].filter(Boolean);
    const timer = this.scope.performance ?? globalThis.performance;
    const now = timer ? Math.floor((timer.timeOrigin + timer.now()) * 1000) : Date.now() * 1000;
    const clock = this.lastClock = Math.max(now, (this.lastClock ?? 0) + 1,
      ...stamps.map(key => Number(key.slice(EDIT_PREFIX.length).split('-')[0]) + 1));
    const key = `${EDIT_PREFIX}${clock}-${this.scope.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    // A baseline travels with the operation; never overwrite another tab's
    // snapshot while initializing first-visit defaults.
    edit = { ...edit, base: this.ids ?? [] };
    try {
      if (!this.scope.localStorage) throw new Error('Storage unavailable');
      this.scope.localStorage.setItem(key, JSON.stringify(edit));
    } catch { this.pending.push({key, edit}); }
    this.ids = applyEdit(this.ids, edit);
    this.onChange();
    return this.flush();
  }
  flush() {
    const write = () => {
      const records = this.records();
      const next = replay(this.scope, records);
      if (next !== null) {
        // One atomic value carries both membership and operation ordering.
        this.scope.localStorage.setItem(COMET_SELECTION_STORAGE_KEY, JSON.stringify(next));
        // Delete oldest first: any remaining suffix is safe to replay on next.
        for (const record of records) {
          this.scope.localStorage.removeItem(record.key);
          this.pending = this.pending.filter(pending => pending.key !== record.key);
        }
      }
      this.refresh();
    };
    const compact = () => withStorageTransaction(this.scope, write);
    this.saved = this.saved.then(() => this.scope.navigator?.locks
      ? this.scope.navigator.locks.request(COMET_SELECTION_STORAGE_KEY, compact) : compact())
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
