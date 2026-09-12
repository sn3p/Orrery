const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { chromium } = require("playwright");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const output = path.join(root, ".context/font-qa");
const fontName = "JetBrains Mono Variable";

async function checkTypography(page, { fontLoaded = true, waitForFont = true } = {}) {
  if (waitForFont) await page.evaluate(() => document.fonts.ready);
  const ui = await page.evaluate(() => {
    const bounds = selector => {
      const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { x, y, width, height };
    };
    const text = document.createRange();
    text.selectNodeContents(document.querySelector(".dg .property-name"));
    const selectors = ["#orrery-date", "#orrery-fps", "#orrery-count", ".dg .property-name", ".dg input"];
    return {
      fonts: [...document.fonts].map(font => ({ family: font.family, status: font.status })),
      styles: selectors.map(selector => {
        const style = getComputedStyle(document.querySelector(selector));
        return { family: style.fontFamily, size: style.fontSize };
      }),
      boxes: selectors.map(bounds),
      input: bounds(".dg input"),
      slider: bounds(".dg .slider"),
      labelRight: text.getBoundingClientRect().right,
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  assert.equal(ui.fonts.some(font => font.family === fontName && font.status === "loaded"), fontLoaded, "Self-hosted font loading state");
  assert(ui.styles.every(style => style.family.startsWith(`"${fontName}"`)), "Every UI text surface uses the shared font stack");
  assert.deepEqual(ui.styles.map(style => style.size), ["14px", "14px", "14px", "14px", "12px"]);
  assert.equal(ui.input.height, 19, "Speed input is 19px high");
  assert.equal(ui.input.y, ui.slider.y, "Input and slider top edges align");
  assert.equal(ui.input.height, ui.slider.height, "Input and slider heights match");
  assert(ui.slider.x - ui.labelRight >= 4, "Speed label keeps at least 4px of visible space before the slider");
  assert(ui.slider.x + ui.slider.width <= ui.input.x, "Slider and input do not overlap");
  assert.equal(ui.width, page.viewportSize().width, "Mobile browsers use the device viewport width");
  assert.equal(ui.scrollWidth, ui.width, "No horizontal overflow");
  for (const box of ui.boxes) {
    assert(box.width > 0 && box.height > 0, "UI elements remain visible");
    assert(box.x >= 0 && box.x + box.width <= ui.width, "UI fits horizontally");
    assert(box.y >= 0 && box.y + box.height <= ui.height, "UI fits vertically");
  }
  assert(ui.boxes[1].x + ui.boxes[1].width < ui.boxes[3].x, "FPS readout does not overlap speed label");
  assert(ui.boxes[0].x + ui.boxes[0].width < ui.boxes[2].x, "Date and count do not overlap");
  return ui;
}

async function setSpeed(page, value) {
  const input = page.getByRole("textbox", { name: "Playback speed" });
  await input.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText(String(value));
  await page.keyboard.press("Enter");
  assert.equal(await input.inputValue(), String(value));
}

async function checkStatusContrast(page, expected) {
  const status = await page.getByRole("status").evaluate(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { text: element.textContent, color: getComputedStyle(element).color,
      background: getComputedStyle(element).backgroundColor,
      fits: width > 0 && height > 0 && x >= 0 && y >= 0 && x + width <= innerWidth && y + height <= innerHeight };
  });
  assert.equal(status.text, expected);
  const luminance = color => {
    const channels = color.match(/[\d.]+/g).map(Number);
    assert(channels.length === 3 || channels[3] === 1, "Status colors remain opaque over the visualization");
    return channels.slice(0, 3).map(value => value / 255)
      .map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
  };
  const light = luminance(status.color), dark = luminance(status.background);
  status.contrast = (Math.max(light, dark) + 0.05) / (Math.min(light, dark) + 0.05);
  assert(status.contrast >= 4.5, `Status contrast ${status.contrast}:1 must reach 4.5:1`);
  assert(status.fits, "Status message fits the viewport");
  return status;
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  // Serve the actual production files at the GitHub Pages subpath.
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname.endsWith("/favicon.ico")) { res.writeHead(204); res.end(); return; }
    const filename = path.resolve(dist, "." + pathname.replace(/^\/Orrery/, "") + (pathname.endsWith("/") ? "index.html" : ""));
    if (!pathname.startsWith("/Orrery/") || !filename.startsWith(dist + path.sep) || !fs.existsSync(filename)) {
      res.writeHead(404); res.end(); return;
    }
    res.setHeader("Content-Type", { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2", ".txt": "text/plain" }[path.extname(filename)] || "application/octet-stream");
    fs.createReadStream(filename).pipe(res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/Orrery/`;
  let browser;
  const report = [];
  try {
    browser = await chromium.launch({ channel: process.env.CHROME_CHANNEL || "chrome" });
    for (const width of [1280, 390, 360]) {
      const context = await browser.newContext({ viewport: { width, height: width === 1280 ? 800 : 844 }, isMobile: width < 500, hasTouch: width < 500 });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await page.goto(url);
      await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent) > 0);
      report.push({ width, state: "loaded", ui: await checkTypography(page) });
      await page.keyboard.press("Tab");
      assert(await page.getByRole("textbox", { name: "Playback speed" }).evaluate(input => input === document.activeElement), "Speed input is keyboard reachable");
      await setSpeed(page, 0);
      const date = await page.locator("#orrery-date").textContent();
      await page.waitForTimeout(150);
      assert.equal(await page.locator("#orrery-date").textContent(), date, "Keyboard editing pauses playback");
      await page.screenshot({ path: path.join(output, `ui-${width}.png`) });
      await setSpeed(page, -1);
      await page.waitForFunction(previous => document.querySelector("#orrery-date").textContent < previous, date);
      const reversed = await page.locator("#orrery-date").textContent();
      const slider = page.locator(".dg .slider");
      const box = await slider.boundingBox();
      await slider.click({ position: { x: box.width * 0.75, y: box.height / 2 } });
      await page.waitForFunction(previous => document.querySelector("#orrery-date").textContent > previous, reversed);
      await page.reload();
      await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent) > 0);
      await checkTypography(page);
      assert.deepEqual(errors, [], "No browser errors during normal playback and reload");
      await context.close();
    }

    const page = await browser.newPage({ viewport: { width: 360, height: 844 }, isMobile: true, hasTouch: true });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let releaseCatalog;
    const catalogGate = new Promise(resolve => { releaseCatalog = resolve; });
    let releaseFont;
    const fontGate = new Promise(resolve => { releaseFont = resolve; });
    await page.route("**/data/catalog.json", async route => { await catalogGate; await route.continue(); });
    await page.route("**/*.woff2", async route => { await fontGate; await route.continue(); });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#orrery-count").textContent === "0");
    report.push({ width: 360, state: "font-loading", ui: await checkTypography(page, { fontLoaded: false, waitForFont: false }) });
    releaseFont();
    report.push({ width: 360, state: "catalog-loading", ui: await checkTypography(page),
      status: await checkStatusContrast(page, "Loading asteroids…") });
    await page.screenshot({ path: path.join(output, "loading-360.png") });
    releaseCatalog();
    await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent) > 0);

    for (const name of ["JetBrainsMono-Variable.woff2", "OFL.txt"]) {
      const response = await page.request.get(url + "fonts/" + name);
      assert(response.ok(), `${name} served beneath /Orrery/`);
      assert.deepEqual(await response.body(), fs.readFileSync(path.join(root, "src/fonts", name)), `${name} served unchanged`);
    }

    // A failed font request must leave usable fallback typography and controls.
    await page.route("**/*.woff2", route => route.abort());
    await page.reload();
    await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent) > 0);
    report.push({ width: 360, state: "font-fallback", ui: await checkTypography(page, { fontLoaded: false }) });
    await setSpeed(page, 0);
    await page.screenshot({ path: path.join(output, "fallback-360.png") });
    assert.deepEqual(errors, [], "No JavaScript errors during loading or font fallback");

    await page.unroute("**/*.woff2");
    await page.route("**/data/catalog.json", route => route.fulfill({ status: 503, body: "Unavailable" }));
    await page.reload();
    await page.waitForFunction(() => document.querySelector("#orrery-status").textContent.startsWith("Unable to load"));
    report.push({ width: 360, state: "catalog-error", ui: await checkTypography(page),
      status: await checkStatusContrast(page, "Unable to load asteroids. Reload to try again.") });
    await page.screenshot({ path: path.join(output, "error-360.png") });
    assert.deepEqual(errors, [], "No JavaScript errors during catalogue failure");
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
    console.log("UI checks passed: production font/license delivery, desktop/mobile typography, keyboard and slider playback, reload, delayed loading and font fallback.");
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
