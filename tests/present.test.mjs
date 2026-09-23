import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Timeline from "../src/unified/ui/Timeline.js";
import { UNIX_EPOCH_JULIAN_DATE } from "../src/js/constants.js";
import { armPresent, currentJed, engagePresent, frameSeconds, PRESENT_SLACK, seekPresent, stepPresent } from "../src/unified/present.js";
import { DEFAULT_REAL_TIME, REAL_TIME_STORAGE_KEY, loadRealTimePreference, saveRealTimePreference } from "../src/unified/RealTimePreference.js";
import { toJED } from "../src/js/utils.js";

const NOW = 2461305.5;

test("forward playback stops at the present and then follows the clock", () => {
  const approaching = stepPresent({
    jed: NOW - 10, advance: 3, speed: 1.5, hold: true, following: false, now: NOW,
  });
  assert.deepEqual(approaching, { jed: NOW - 7, following: false });

  const crossing = stepPresent({
    jed: NOW - 1, advance: 4, speed: 1.5, hold: true, following: false, now: NOW,
  });
  assert.deepEqual(crossing, { jed: NOW, following: true });

  const live = stepPresent({
    jed: NOW - 0.2, advance: 90, speed: 1.5, hold: true, following: true, now: NOW,
  });
  assert.deepEqual(live, { jed: NOW, following: true });
});

test("the hold stays off the story clock until it is on", () => {
  const running = stepPresent({
    jed: NOW - 1, advance: 4, speed: 1.5, hold: false, following: false, now: NOW,
  });
  assert.deepEqual(running, { jed: NOW + 3, following: false });
});

test("pause freezes the present and play resumes the wall clock", () => {
  const paused = stepPresent({
    jed: NOW - 0.01, advance: 0, speed: 0, hold: true, following: true, now: NOW,
  });
  assert.deepEqual(paused, { jed: NOW - 0.01, following: true });

  const resumed = stepPresent({
    jed: NOW - 0.01, advance: 0, speed: 1.5, hold: true, following: true, now: NOW,
  });
  assert.deepEqual(resumed, { jed: NOW, following: true });
});

test("reverse and a past date leave the wall clock", () => {
  const reverse = stepPresent({
    jed: NOW, advance: -2, speed: -1.5, hold: true, following: true, now: NOW,
  });
  assert.deepEqual(reverse, { jed: NOW - 2, following: false });

  assert.deepEqual(seekPresent({ jed: NOW - 40, hold: true, now: NOW }),
    { jed: NOW - 40, following: false });
  assert.deepEqual(seekPresent({ jed: NOW + 10, hold: true, now: NOW }),
    { jed: NOW, following: true });
  assert.deepEqual(seekPresent({ jed: NOW + 10, hold: false, now: NOW }),
    { jed: NOW + 10, following: false });
});

test("turning real time on plays when the date is already today", () => {
  const midnight = toJED(new Date("2026-09-23T00:00:00.000Z"));
  const now = midnight + 0.4;
  assert.deepEqual(engagePresent({ jed: midnight, now, speed: 0, resumeSpeed: 4 }),
    { jed: now, following: true, seek: true, speed: 4 });
  assert.deepEqual(engagePresent({ jed: now + 2, now, speed: 0 }),
    { jed: now, following: true, seek: true, speed: 1.5 });
  assert.deepEqual(engagePresent({ jed: now, now, speed: 1.5 }),
    { jed: now, following: true, seek: false, speed: 1.5 });
  assert.deepEqual(engagePresent({ jed: midnight - 3, now, speed: 0 }),
    { jed: midnight - 3, following: false, seek: false, speed: 0 });
});

test("real time is on by default and remembered in this browser", () => {
  const values = new Map();
  const scope = { localStorage: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  } };
  assert.equal(DEFAULT_REAL_TIME, true);
  assert.equal(loadRealTimePreference(scope), true);
  assert.equal(saveRealTimePreference(false, scope), true);
  assert.equal(values.get(REAL_TIME_STORAGE_KEY), "false");
  assert.equal(loadRealTimePreference(scope), false);
  values.set(REAL_TIME_STORAGE_KEY, "yes");
  assert.equal(loadRealTimePreference(scope), true);
  const blocked = { get localStorage() { throw new Error("blocked"); } };
  assert.equal(loadRealTimePreference(blocked), true);
  assert.equal(saveRealTimePreference(false, blocked), false);
});

test("turning the option on seeks back only from the future", () => {
  assert.deepEqual(armPresent({ jed: NOW + 5, now: NOW }), { jed: NOW, following: true, seek: true });
  assert.deepEqual(armPresent({ jed: NOW - 100, now: NOW }), { jed: NOW - 100, following: false, seek: false });
  assert.equal(armPresent({ jed: NOW - PRESENT_SLACK / 2, now: NOW }).following, true);
});

test("live frames still age markers within the playback cap", () => {
  assert.equal(frameSeconds(null, 1000), 0);
  assert.equal(frameSeconds(1000, 1160), 0.16);
  assert.equal(frameSeconds(1000, 5000), 0.25);
});

function timelineFixture({ holdAtPresent = false, jedDelta = 1.5 } = {}) {
  const listeners = new Map();
  class Element {
    constructor() { this.dataset = {}; this.attributes = new Map(); this.textContent = ""; this.className = ""; this.children = []; this.open = false; }
    matches(selector) { return selector === "button"; }
    addEventListener(type, handler) { listeners.set(`${this.id}:${type}`, handler); }
    removeEventListener() {}
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    focus() {}
    showModal() { this.open = true; }
    close() { this.open = false; listeners.get(`${this.id}:close`)?.(); }
    replaceChildren(...nodes) {
      this.children = [];
      this.textContent = "";
      for (const node of nodes) {
        if (typeof node === "string") this.textContent += node;
        else { this.children.push(node); this.textContent += node.textContent; }
      }
    }
  }
  const ids = ["orrery-playback", "orrery-playback-indicator", "orrery-date", "orrery-date-dialog",
    "orrery-date-title", "orrery-date-form", "orrery-date-input", "orrery-date-help", "orrery-date-error",
    "orrery-date-today", "orrery-date-beginning", "orrery-date-cancel"];
  const elements = Object.fromEntries(ids.map(id => [id, new Element()]));
  for (const [id, element] of Object.entries(elements)) element.id = id;
  const document = {
    activeElement: null,
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    createElement() { return new Element(); },
    getElementById: id => elements[id] ?? null,
  };
  const startJed = UNIX_EPOCH_JULIAN_DATE;
  const app = { startJed, jed: startJed + 1, jedDelta, holdAtPresent, hold() {} };
  return { app, document, elements };
}

test("today pauses when real time is off", () => {
  const originalDocument = globalThis.document;
  try {
    const { app, document, elements } = timelineFixture();
    globalThis.document = document;
    const timeline = new Timeline(app);
    const before = Date.now();
    timeline.onToday();
    const after = Date.now();
    assert.equal(app.holdAtPresent, false);
    assert.equal(app.jedDelta, 0);
    assert.equal(timeline.resumeSpeed, 1.5);
    assert.equal(elements["orrery-date-today"].textContent, "today");
    assert.equal(elements["orrery-date-help"].textContent, "Playback stays paused after jumping.");
    assert.ok(app.jed >= currentJed(before));
    assert.ok(app.jed <= currentJed(after));
    timeline.destroy();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("today keeps playing when real time is on", () => {
  const originalDocument = globalThis.document;
  try {
    const { app, document, elements } = timelineFixture({ holdAtPresent: true, jedDelta: -2 });
    globalThis.document = document;
    const timeline = new Timeline(app);
    timeline.resumeSpeed = -2;
    const before = Date.now();
    timeline.onToday();
    const after = Date.now();
    assert.equal(app.holdAtPresent, true);
    assert.equal(app.jedDelta, 1.5);
    assert.equal(elements["orrery-date-today"].textContent, "today (real time)");
    assert.equal(elements["orrery-date-today"].children[0].className, "orrery-realtime-mark");
    assert.equal(elements["orrery-date-today"].children[0].textContent, "(real time)");
    assert.equal(elements["orrery-date-help"].textContent, "A chosen date stays paused. Today keeps playing.");
    assert.ok(app.jed >= currentJed(before));
    assert.ok(app.jed <= currentJed(after));

    app.jedDelta = 4;
    timeline.onToday();
    assert.equal(app.jedDelta, 4);
    timeline.destroy();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

test("real time dialog copy is rebuilt only when the option changes", () => {
  const originalDocument = globalThis.document;
  try {
    const { app, document, elements } = timelineFixture({ holdAtPresent: true });
    globalThis.document = document;
    const timeline = new Timeline(app);
    let writes = 0;
    const today = elements["orrery-date-today"];
    const build = today.replaceChildren.bind(today);
    today.replaceChildren = (...nodes) => { writes += 1; build(...nodes); };
    let text = today.textContent;
    Object.defineProperty(today, "textContent", {
      configurable: true,
      get() { return text; },
      set(value) { writes += 1; text = value; },
    });
    timeline.updatePresentCopy(true);
    timeline.updatePresentCopy(true);
    assert.equal(writes, 0);
    timeline.updatePresentCopy(false);
    assert.equal(writes, 1);
    timeline.updatePresentCopy(false);
    assert.equal(writes, 1);
    timeline.destroy();
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});

async function withAppDocument(run) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const head = { appendChild() {} };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.document = {
    hidden: true,
    documentElement: {},
    head,
    createElement() { return { setAttribute() {}, style: {}, innerHTML: "" }; },
    getElementsByTagName(name) { return name === "head" ? [head] : []; },
    addEventListener() {},
    removeEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
  };
  try {
    const { default: App } = await import("../src/unified/App.js");
    await run(App);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
    if (previousDocument === undefined) delete globalThis.document;
    else globalThis.document = previousDocument;
  }
}

test("enabling real time clamps a queued future seek", () => withAppDocument(App => {
  const app = new App({ container: {}, autoRender: false, jedDelta: 0, holdAtPresent: false });
  const committed = app.jed;
  app.requestedJed = 9999999;
  app.pendingSeek = { generation: 1, target: 9999999 };
  const before = Date.now();
  app.holdAtPresent = true;
  const after = Date.now();
  assert.ok(app.jed < 9999999);
  assert.ok(app.jed >= currentJed(before) - 1 / 86400);
  assert.ok(app.jed <= currentJed(after));
  assert.equal(app.requestedJed, app.jed);
  assert.equal(app.pendingSeek.target, app.jed);
  assert.equal(app.followingPresent, true);
  assert.ok(app.jedDelta > 0);
  assert.notEqual(app.jed, committed);
}));

test("a shared date for today opens paused even with real time on", () => withAppDocument(App => {
  const now = currentJed();
  const midnight = toJED(new Date(new Date().setUTCHours(0, 0, 0, 0)));
  const app = new App({ container: {}, autoRender: false, jed: midnight, jedDelta: 0, holdAtPresent: true });
  assert.equal(app.jedDelta, 0);
  assert.equal(app.jed, midnight);
  assert.equal(app.requestedJed, midnight);
  if (now - midnight > PRESENT_SLACK) assert.equal(app.followingPresent, false);
}));

test("a shared future date opens paused at the current instant", () => withAppDocument(App => {
  const before = Date.now();
  const app = new App({ container: {}, autoRender: false, jed: currentJed(before) + 30, jedDelta: 0, holdAtPresent: true });
  assert.equal(app.jedDelta, 0);
  assert.ok(app.jed >= currentJed(before) - PRESENT_SLACK);
  assert.ok(app.jed <= currentJed(Date.now()));
  assert.equal(app.requestedJed, app.jed);
  assert.equal(app.followingPresent, true);
}));

test("the default entry only arms the stop", () => withAppDocument(App => {
  const app = new App({ container: {}, autoRender: false, holdAtPresent: true });
  assert.equal(app.jed, app.startJed);
  assert.equal(app.jedDelta, 1.5);
  assert.equal(app.followingPresent, false);
  assert.equal(app.requestedJed, undefined);
}));

test("the present indicator is written only when its state changes", async () => {
  const { default: Hud } = await import("../src/unified/ui/Hud.js");
  let writes = 0, hidden = true;
  const now = { get hidden() { return hidden; }, set hidden(value) { writes += 1; hidden = value; } };
  const hud = { now };
  Hud.prototype.updateNow.call(hud, false);
  assert.equal(writes, 0);
  Hud.prototype.updateNow.call(hud, true);
  Hud.prototype.updateNow.call(hud, true);
  assert.equal(writes, 1);
  assert.equal(hidden, false);
  Hud.prototype.updateNow.call(hud, false);
  assert.equal(writes, 2);
  Hud.prototype.updateNow.call({ now: null }, true);
});

test("the speed row dims only while the wall clock drives the date", async () => {
  const { default: Options, SPEED_LIVE_HINT } = await import("../src/unified/ui/Options.js");
  const title = "Time scale: 1 = 60 days/s; 0 pauses; negative reverses.";
  let toggles = 0, writes = 0, text = title;
  const controls = {
    speedLive: null,
    speedInput: { title },
    speedRow: { classList: { toggle(name, force) { toggles += 1; assert.equal(name, "orrery-options-inactive"); controls.inactive = force; } } },
    speedHint: { get textContent() { return text; }, set textContent(value) { writes += 1; text = value; } },
  };
  const set = live => Options.prototype.setSpeedLive.call(controls, live);
  set(false);
  assert.equal(toggles, 1);
  assert.equal(controls.inactive, false);
  assert.equal(text, title);
  set(true); set(true);
  assert.equal(toggles, 2);
  assert.equal(writes, 2);
  assert.equal(controls.inactive, true);
  assert.equal(text, SPEED_LIVE_HINT);
  set(false);
  assert.equal(text, title);
  assert.equal(controls.inactive, false);
});

test("the date readout has a present indicator", () => {
  const html = readFileSync(new URL("../src/unified/index.html", import.meta.url), "utf8");
  assert.match(html, /id="orrery-now"[^>]*>\(real time\)</);
});
