import { presentBodies } from './model.js';

// Reference bodies join the asteroid renderer's existing draw transaction.
// Keep the previous graphics alive until a successful draw receipt commits it.
export default class ReferenceBodies {
  constructor({ prepare, attach, detach, dispose }) {
    Object.assign(this, { prepare, attach, detach, dispose });
    this.baseline = [];
    this.current = this.baseline;
    this.definitions = null;
    this.transition = null;
  }
  add(data, jed) {
    const batch = this.prepare(data, jed);
    this.baseline.push(...batch);
    if (this.current === this.baseline) this.attach(this.current);
  }
  select(definitions = null, jed) {
    if (definitions === this.definitions) return;
    if (this.transition) throw new Error('Uncommitted reference-body replacement.');
    const next = definitions ? this.prepare(presentBodies(definitions), jed) : this.baseline;
    this.transition = { batch: this.current, definitions: this.definitions };
    this.detach(this.current);
    this.current = next;
    this.definitions = definitions;
    this.attach(next);
  }
  commit() {
    if (this.transition?.batch !== this.baseline && this.transition) this.dispose(this.transition.batch);
    this.transition = null;
  }
  rollback() {
    if (!this.transition) return;
    this.detach(this.current);
    if (this.current !== this.baseline) this.dispose(this.current);
    this.current = this.transition.batch;
    this.definitions = this.transition.definitions;
    this.transition = null;
    this.attach(this.current);
  }
  forEach(callback) {
    for (const batch of new Set([this.baseline, this.current, this.transition?.batch])) {
      if (batch) for (const entry of batch) callback(entry);
    }
  }
  destroy() {
    this.detach(this.current);
    for (const batch of new Set([this.baseline, this.current, this.transition?.batch])) if (batch) this.dispose(batch);
    this.baseline = this.current = [];
    this.transition = null;
  }
}
