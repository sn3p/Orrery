const assert = require('node:assert/strict');

exports.boundaries = async page => page.evaluate(async () => {
  const { app, catalogURL } = fixture;
  const catalog = await (await fetch(catalogURL)).json();
  const saved = { jed: app.jed, speed: app.jedDelta, autoRender: app.autoRender };
  const elements = ['date', 'fps', 'count'].map(name => document.getElementById(`orrery-${name}`));
  const observer = new MutationObserver(() => {});
  const toISO = Date.prototype.toISOString;
  let records = catalog, formats = 0, frames = 0, writes = 0;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const verify = (label, action) => {
    const before = elements.map(element => element.textContent), previousFormats = formats;
    action();
    const date = new Date(86400000 * (-2440587.5 + app.jed));
    const count = records.filter(record => record.disc <= app.jed).length;
    const expected = [toISO.call(date).slice(0, 10), `${app.stats.fps} FPS`,
      count.toLocaleString('en-US').replaceAll(',', '\u202f')];
    const mutations = observer.takeRecords();
    elements.forEach((element, index) => {
      check(element.textContent === expected[index], `${label}: incorrect ${element.id}`);
      const count = mutations.filter(mutation => mutation.target === element).length;
      check(count === Number(before[index] !== expected[index]), `${label}: redundant or missing ${element.id} write`);
    });
    check(formats - previousFormats === Number(before[0] !== expected[0]), `${label}: redundant or missing date formatting`);
    frames++; writes += mutations.length;
  };
  const frame = label => verify(label, () => app.render());
  try {
    app.autoRender = false; app.cancelRender(); app.jedDelta = 0; app.render();
    elements.forEach(element => observer.observe(element, { childList: true }));
    Date.prototype.toISOString = function() { formats++; return toISO.call(this); };
    for (let i = 0; i < 100; i++) frame('Unchanged paused frame');
    const unchanged = { frames, writes, formats };
    for (const midnight of ['1900-03-01', '1969-12-31', '1970-01-01', '2000-02-29', '2001-01-01']) {
      const jed = Date.parse(`${midnight}T00:00:00Z`) / 86400000 + 2440587.5;
      const offsets = [-2 / 86400000, -0.5 / 86400000, 0, 0.5 / 86400000, 2 / 86400000,
        0.5 - 1 / 86400000, 0.5, 0.5 + 1 / 86400000, 1];
      for (const offset of [...offsets, ...offsets.toReversed()]) {
        app.jed = jed + offset; frame(`${midnight} ${offset}`);
      }
    }
    const discovery = catalog[50000].disc;
    for (const jed of [discovery - 0.001, discovery, discovery + 0.001, discovery, discovery - 0.001]) {
      app.jed = jed; frame('Real discovery cutoff');
    }
    const day = 2451544.5;
    app.jed = day; frame('Before replacement');
    records = [0.25, 0.75].map(offset => ({ ...catalog[0], disc: day + offset }));
    verify('Same-day replacement', () => app.setAsteroids(records));
    for (const offset of [0, 0.25, 0.5, 0.75, 0.5, 0.25, 0]) {
      app.jed = day + offset; frame('Same-day discoveries and rewind');
    }
    records = []; verify('Empty replacement', () => app.setAsteroids(records));
    verify('Repeated empty replacement', () => app.setAsteroids(records));
    records = catalog; verify('Catalogue restored', () => app.setAsteroids(records));
    for (const fps of [0, 60, 60, 61, 0, 0]) {
      verify('FPS update', () => { app.stats.fps = fps; app.updateGui(); });
    }
    app.stats.fps = 42; verify('FPS before reset', () => app.updateGui());
    verify('Clock reset', () => app.resetClock());
    verify('Repeated clock reset', () => app.resetClock());
    return { frames, writes, formats, unchanged, dateBoundaries: 90, countAndFpsTransitions: 'passed' };
  } finally {
    Date.prototype.toISOString = toISO; observer.disconnect();
    app.jed = saved.jed; app.setAsteroids(catalog); app.jedDelta = saved.speed;
    app.autoRender = saved.autoRender; app.render();
  }
});

exports.lifetimes = async page => page.evaluate(async () => {
  const { Orrery } = fixture;
  const delivered = [];
  const observer = new MutationObserver(records => delivered.push(...records));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  let app;
  const observe = () => {
    observer.disconnect(); delivered.length = 0;
    for (const name of ['date', 'fps', 'count']) observer.observe(document.getElementById(`orrery-${name}`), { childList: true });
  };
  const verify = label => {
    const mutations = [...delivered.splice(0), ...observer.takeRecords()];
    for (const [name, value] of [['date', '2000-01-01'], ['fps', '0 FPS'], ['count', '0']]) {
      const element = document.getElementById(`orrery-${name}`);
      check(element.textContent === value, `${label}: initial ${name}, including zero`);
      check(mutations.filter(m => m.target === element).length === 1, `${label}: exactly one initial ${name} write`);
    }
    app.updateGui();
    check(observer.takeRecords().length === 0, `${label}: repeat update remains cached`);
  };
  try {
    for (let i = 0; i < 2; i++) {
      observe();
      app = new Orrery({ startDate: new Date('2000-01-01T00:00:00Z'), jedDelta: 0, autoRender: false });
      await app.init(); verify(`App lifetime ${i + 1}`);
      app.gui.controls.destroy();
      for (const name of ['date', 'fps', 'count']) {
        const element = document.getElementById(`orrery-${name}`);
        element.replaceWith(element.cloneNode(false));
      }
      observe(); app.setupGui(); app.updateGui(); verify('Replacement GUI lifetime');
      app.destroy(); app = null;
    }
    return { appLifetimes: 2, replacementSetups: 2, zeroReadouts: 'passed' };
  } finally { observer.disconnect(); app?.destroy(); }
});

// Exercise actual production boot/fetch/keyboard playback without exporting the app.
exports.production = async (page, url) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const fulfill = async route => route.fulfill({ json: await gate });
  await page.route('**/data/catalog.json', fulfill);
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await require('./options.cjs').openOptions(page);
    const speed = page.getByRole('textbox', { name: 'Playback speed' });
    const setSpeed = async value => { await speed.fill(String(value)); await speed.press('Enter'); };
    await setSpeed(0);
    await page.waitForFunction(() => document.getElementById('orrery-fps').textContent === '0 FPS');
    assert.equal(await page.locator('#orrery-count').textContent(), '0');
    const initial = await page.locator('#orrery-date').textContent();
    const day = Date.parse(`${initial}T00:00:00Z`) / 86400000 + 2440587.5;
    const orbit = { a: 2.5, e: 0.1, i: 5, wbar: 70, W: 45, M: 60, n: 0.25, epoch: 2451545 };
    release([{ ...orbit, disc: day - 36525 }, { ...orbit, a: 3, disc: day + 30 }]);
    await page.waitForFunction(() => document.getElementById('orrery-count').textContent === '1');
    await page.evaluate(() => {
      const probe = window.readoutProbe = { writes: { date: 0, fps: 0, count: 0 }, redundant: [] };
      const descriptor = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
      probe.restore = () => Object.defineProperty(Node.prototype, 'textContent', descriptor);
      Object.defineProperty(Node.prototype, 'textContent', { ...descriptor, set(value) {
        const name = this.id?.replace('orrery-', '');
        if (Object.hasOwn(probe.writes, name)) {
          probe.writes[name]++;
          if (this.textContent === String(value)) probe.redundant.push(name);
        }
        descriptor.set.call(this, value);
      } });
    });
    const countTransitions = [1];
    for (const [value, count] of [[1.5, 2], [-1.5, 1]]) {
      const before = await page.locator('#orrery-date').textContent();
      await setSpeed(value);
      await page.waitForFunction(({ before, value }) => {
        const date = document.getElementById('orrery-date').textContent;
        return value > 0 ? date > before : date < before;
      }, { before, value });
      await page.waitForFunction(count => document.getElementById('orrery-count').textContent === String(count), count);
      await page.waitForFunction(() => parseInt(document.getElementById('orrery-fps').textContent) > 0);
      await setSpeed(0);
      await page.waitForFunction(() => document.getElementById('orrery-fps').textContent === '0 FPS');
      assert.equal(await page.locator('#orrery-count').textContent(), String(count));
      countTransitions.push(count);
    }
    const result = await page.evaluate(() => ({ writes: readoutProbe.writes, redundant: readoutProbe.redundant }));
    assert.deepEqual(result.redundant, [], 'Production frames only write changed readouts');
    assert(Object.values(result.writes).every(count => count > 0), 'Each readout changes during real playback');
    return { ...result, countTransitions, initialZeros: true };
  } finally {
    release([]); await page.unroute('**/data/catalog.json', fulfill);
    await page.evaluate(() => { window.readoutProbe?.restore(); delete window.readoutProbe; });
  }
};
