import test from "node:test";
import assert from "node:assert/strict";
import Timeline from "../src/unified/ui/Timeline.js";
import { UNIX_EPOCH_JULIAN_DATE } from "../src/js/constants.js";

function fixture(startJed, speed = -1.5) {
  const listeners = new Map();
  const document = {
    activeElement: null,
    listeners: new Map(),
    addEventListener(type, handler) { this.listeners.set(type, handler); },
    removeEventListener(type) { this.listeners.delete(type); },
    querySelector() { return null; },
  };
  class Element {
    constructor({ button = false, dialog = false } = {}) {
      this.button = button;
      this.dialog = dialog;
      this.dataset = {};
      this.attributes = new Map();
      this.textContent = "";
      this.open = false;
      this.scrollTop = 0;
    }
    matches(selector) { return selector === "button" && this.button; }
    addEventListener(type, handler) { listeners.set(`${this.id}:${type}`, handler); }
    removeEventListener(type) { listeners.delete(`${this.id}:${type}`); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close(value = "") {
      this.open = false;
      this.returnValue = value;
      listeners.get(`${this.id}:close`)?.();
    }
  }
  const ids = ["orrery-playback", "orrery-playback-indicator", "orrery-date", "orrery-date-dialog",
    "orrery-date-title", "orrery-date-form", "orrery-date-input", "orrery-date-error", "orrery-date-today",
    "orrery-date-beginning", "orrery-date-cancel"];
  const elements = Object.fromEntries(ids.map(id => [id, new Element({
    button: ["orrery-playback", "orrery-date", "orrery-date-today", "orrery-date-beginning", "orrery-date-cancel"].includes(id),
    dialog: id === "orrery-date-dialog",
  })]));
  for (const [id, element] of Object.entries(elements)) element.id = id;
  document.getElementById = id => elements[id] ?? null;
  const app = {
    startJed,
    jed: startJed + 1,
    jedDelta: speed,
    holds: [],
    hold(value) { this.holds.push(value); },
  };
  return { app, document, elements };
}

test("configured beginning labels and applies the validated JED directly", () => {
  const originalDocument = globalThis.document;
  try {
    for (const milliseconds of [Date.UTC(2000, 0, 1), -8.64e15, 8.64e15]) {
      const startJed = UNIX_EPOCH_JULIAN_DATE + milliseconds / 86400000;
      const expected = new Date(milliseconds).toISOString().split("T", 1)[0];
      const { app, document, elements } = fixture(startJed);
      globalThis.document = document;
      const timeline = new Timeline(app);

      assert.equal(elements["orrery-date-beginning"].textContent, expected);
      timeline.onBeginning();
      assert.equal(app.jed, startJed, `${expected} is applied without the four-digit input parser`);
      assert.equal(app.jedDelta, 0);
      assert.equal(timeline.resumeSpeed, -1.5);
      assert.equal(elements["orrery-date-dialog"].returnValue, "apply");
      assert.equal(elements["orrery-date-error"].textContent, "");
      timeline.destroy();
    }
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("opening the date dialog leaves its native input closed", () => {
  const originalDocument = globalThis.document;
  try {
    const { app, document, elements } = fixture(UNIX_EPOCH_JULIAN_DATE);
    globalThis.document = document;
    const timeline = new Timeline(app);

    timeline.onOpenDate();

    assert.equal(elements["orrery-date-dialog"].open, true);
    assert.equal(elements["orrery-date-dialog"].scrollTop, 0);
    assert.equal(document.activeElement, elements["orrery-date-title"]);
    assert.notEqual(document.activeElement, elements["orrery-date-input"]);
    assert.deepEqual(app.holds, [true]);
    timeline.destroy();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
