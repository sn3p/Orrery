const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const fontName = "JetBrains Mono Variable";

async function checkTypography(page, { fontLoaded = true, waitForFont = true } = {}) {
  await require("./options.cjs").openOptions(page);
  if (waitForFont) await page.evaluate(() => document.fonts.ready);
  const ui = await page.evaluate(() => {
    const bounds = selector => {
      const { x, y, width, height } = document.querySelector(selector).getBoundingClientRect();
      return { x, y, width, height };
    };
    const text = document.createRange();
    text.selectNodeContents(document.querySelector("input[aria-label='Playback speed']").closest("li").querySelector(".property-name"));
    const selectors = ["#orrery-date", "#orrery-fps", "#orrery-count", ".dg .property-name", "input[aria-label='Playback speed']"];
    return {
      unified: !!document.querySelector(".orrery-footer"),
      readoutsHidden: !!document.querySelector(".orrery-readouts")?.hidden,
      fonts: [...document.fonts].map(font => ({ family: font.family, status: font.status })),
      styles: selectors.map(selector => {
        const style = getComputedStyle(document.querySelector(selector));
        return { family: style.fontFamily, size: style.fontSize };
      }),
      boxes: selectors.map(bounds),
      input: bounds("input[aria-label='Playback speed']"),
      slider: bounds(".dg .slider"),
      labelRight: text.getBoundingClientRect().right,
      width: innerWidth,
      height: innerHeight,
      scrollWidth: document.documentElement.scrollWidth,
    };
  });
  assert.equal(ui.fonts.some(font => font.family === fontName && font.status === "loaded"), fontLoaded, "Self-hosted font loading state");
  assert(ui.styles.every(style => style.family.startsWith(`"${fontName}"`)), "Every UI text surface uses the shared font stack");
  assert.deepEqual(ui.styles.map(style => style.size), Array(5).fill("12px"));
  assert.equal(ui.input.height, 19, "Speed input is 19px high");
  assert.equal(ui.input.y, ui.slider.y, "Input and slider top edges align");
  assert.equal(ui.input.height, ui.slider.height, "Input and slider heights match");
  assert(ui.slider.x - ui.labelRight >= 8, "Speed label keeps at least 8px of visible space before the slider");
  assert(ui.slider.x + ui.slider.width <= ui.input.x, "Slider and input do not overlap");
  assert.equal(ui.width, page.viewportSize().width, "Mobile browsers use the device viewport width");
  assert.equal(ui.scrollWidth, ui.width, "No horizontal overflow");
  for (const [index, box] of ui.boxes.entries()) {
    if (ui.readoutsHidden && [0, 2].includes(index)) continue;
    assert(box.width > 0 && box.height > 0, "UI elements remain visible");
    assert(box.x >= 0 && box.x + box.width <= ui.width, "UI fits horizontally");
    assert(box.y >= 0 && box.y + box.height <= ui.height, "UI fits vertically");
  }
  assert(ui.boxes[1].y + ui.boxes[1].height <= ui.boxes[3].y, "FPS readout sits above the options controls");
  if (!ui.readoutsHidden) assert(ui.boxes[0].x + ui.boxes[0].width < ui.boxes[2].x, "Date and count do not overlap");
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
  const status = await page.locator("#orrery-status").evaluate(element => {
    const { x, y, width, height } = element.getBoundingClientRect();
    return { text: element.querySelector(".orrery-status-label")?.textContent ?? element.textContent,
      color: getComputedStyle(element).color,
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

async function run({ browser, name, application = "unified", output: artifactDirectory }) {
  const { routeDefaultCatalog, latestURL } = require("./default-catalog-route.cjs");
  const catalogRequest = latestURL;
  const dist = path.join(root, "dist");
  const output = artifactDirectory || path.join(root, ".context/pr2/unified-ui");
  fs.mkdirSync(output, { recursive: true });
  const capture = process.env.ORRERY_NO_SCREENSHOTS === "1" ? async () => {}
    : (page, options) => page.screenshot(options);
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
  const report = [], contexts = [];
  try {
    for (const width of [1280, 390, 360]) {
      const context = await browser.newContext({ viewport: { width, height: width === 1280 ? 800 : 844 },
        deviceScaleFactor: 2, isMobile: width < 500, hasTouch: width < 500 });
      contexts.push(context);
      const page = await context.newPage();
      await routeDefaultCatalog(page);
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await page.goto(url);
      await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent.replaceAll("\u202f", "")) > 0);
      report.push({ width, state: "loaded", ui: await checkTypography(page) });

      const renderer = page.getByRole("combobox", { name: "Renderer", exact: true });
      await page.keyboard.press("Tab");
      if (await renderer.count()) {
        assert(await renderer.evaluate(input => input === document.activeElement), "Renderer input is keyboard reachable");
        await page.keyboard.press("Tab");
      }
      assert(await page.getByRole("textbox", { name: "Playback speed" }).evaluate(input => input === document.activeElement), "Speed input is keyboard reachable");
      await setSpeed(page, 0);
      const date = await page.locator("#orrery-date").textContent();
      await page.waitForTimeout(150);
      assert.equal(await page.locator("#orrery-date").textContent(), date, "Keyboard editing pauses playback");
      await capture(page, { path: path.join(output, `ui-${width}.png`) });
      await setSpeed(page, -1);
      await page.waitForFunction(previous => document.querySelector("#orrery-date").textContent < previous, date);
      const reversed = await page.locator("#orrery-date").textContent();
      const slider = page.locator(".dg .slider");
      const box = await slider.boundingBox();
      await slider.click({ position: { x: box.width * 0.75, y: box.height / 2 } });
      await page.waitForFunction(previous => document.querySelector("#orrery-date").textContent > previous, reversed);
      await page.reload();
      await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent.replaceAll("\u202f", "")) > 0);
      await checkTypography(page);
      assert.deepEqual(errors, [], "No browser errors during normal playback and reload");
      await context.close();
    }

    const page = await browser.newPage({ viewport: { width: 360, height: 844 }, isMobile: true, hasTouch: true });
    contexts.push(page.context());
    await routeDefaultCatalog(page);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    let releaseCatalog;
    const catalogGate = new Promise(resolve => { releaseCatalog = resolve; });
    let releaseFont;
    const fontGate = new Promise(resolve => { releaseFont = resolve; });
    await page.route(catalogRequest, async route => { await catalogGate; await route.fallback(); });
    await page.route("**/*.woff2", async route => { await fontGate; await route.continue(); });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.querySelector("#orrery-count").textContent === "0");
    report.push({ width: 360, state: "font-loading", ui: await checkTypography(page, { fontLoaded: false, waitForFont: false }) });
    releaseFont();
    report.push({ width: 360, state: "catalog-loading", ui: await checkTypography(page),
      status: await checkStatusContrast(page, "Loading asteroids…") });
    await capture(page, { path: path.join(output, "loading-360.png") });
    releaseCatalog();
    await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent.replaceAll("\u202f", "")) > 0);

    for (const name of ["JetBrainsMono-Variable.woff2", "OFL.txt"]) {
      const response = await page.request.get(url + "fonts/" + name);
      assert(response.ok(), `${name} served beneath /Orrery/`);
      assert.deepEqual(await response.body(), fs.readFileSync(path.join(root, "src/fonts", name)), `${name} served unchanged`);
    }

    // A failed font request must leave usable fallback typography and controls.
    await page.route("**/*.woff2", route => route.abort());
    await page.reload();
    await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent.replaceAll("\u202f", "")) > 0);
    report.push({ width: 360, state: "font-fallback", ui: await checkTypography(page, { fontLoaded: false }) });
    await setSpeed(page, 0);
    await capture(page, { path: path.join(output, "fallback-360.png") });
    assert.deepEqual(errors, [], "No JavaScript errors during loading or font fallback");

    await page.unroute("**/*.woff2");
    await page.route(catalogRequest, route => route.fulfill({ status: 503, body: "Unavailable" }));
    await page.reload();
    const errorMessage = "Could not load the asteroid catalogue. Reload to try again.";
    await page.waitForFunction(message => document.querySelector("#orrery-status").textContent === message, errorMessage);
    report.push({ width: 360, state: "catalog-error", ui: await checkTypography(page),
      status: await checkStatusContrast(page, errorMessage) });
    await capture(page, { path: path.join(output, "error-360.png") });
    assert.deepEqual(errors, [], "No JavaScript errors during catalogue failure");
    fs.writeFileSync(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
    console.log("UI checks passed: production font/license delivery, desktop/mobile typography, keyboard and slider playback, reload, delayed loading and font fallback.");
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
    await new Promise(resolve => server.close(resolve));
  }
}


module.exports = { run };
if (require.main === module) require("./standalone.cjs").run(run, { chromiumOnly: true });
