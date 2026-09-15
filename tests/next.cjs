const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const webpack = require("webpack");
const { serve } = require("./support.cjs");
const { routeDefaultCatalog, latestURL, producerBase } = require("./default-catalog-route.cjs");

async function compile(config) {
  const compiler = webpack(config);
  return new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(() => {
    if (error || stats.hasErrors()) reject(error || new Error(stats.toString("errors-only")));
    else resolve(stats);
  })));
}

async function compileLazyProbe(fixture) {
  fs.mkdirSync(fixture, { recursive: true });
  fs.writeFileSync(path.join(fixture, "entry.js"), 'window.loadPreviewProbe = () => import(/* webpackChunkName: "probe" */ "./lazy.js");\n');
  fs.writeFileSync(path.join(fixture, "lazy.js"), 'import "./lazy.css"; import url from "./probe.json"; export { url };\n');
  fs.writeFileSync(path.join(fixture, "lazy.css"), 'body { --preview-probe: loaded; }\n');
  fs.writeFileSync(path.join(fixture, "probe.json"), '{"loaded":true}\n');
  const config = require("../webpack.next.config");
  const stats = await compile({ ...config, mode: "production", entry: { preview: path.join(fixture, "entry.js") },
    output: { ...config.output, path: path.join(fixture, "site/next") } });
  assert([...stats.compilation.chunks].some(chunk => !chunk.canBeInitial()), "Preview supports real lazy chunks");
}

async function run({ browser, name, application = "legacy", output: artifactDirectory }) {
  const directory = artifactDirectory || path.resolve(".context/next-preview/browser");
  fs.mkdirSync(directory, { recursive: true });
  const pages = path.join(directory, "pages");
  fs.mkdirSync(pages, { recursive: true });
  const publicRoot = path.resolve(process.env.ORRERY_DEFAULT_DIST || "dist");
  const pagesRoot = path.join(pages, "Orrery");
  if (fs.existsSync(pagesRoot) && fs.lstatSync(pagesRoot).isSymbolicLink() && fs.readlinkSync(pagesRoot) !== publicRoot) fs.unlinkSync(pagesRoot);
  if (!fs.existsSync(pagesRoot)) fs.symlinkSync(publicRoot, pagesRoot, "dir");

  // Retain async CSS/data coverage alongside the real public Pixi lazy entry.
  const fixture = path.join(directory, "fixture");
  if (process.env.ORRERY_PREBUILT_FIXTURES) {
    require('./fixture-builds.cjs').copyPrepared('lazy-preview', path.join(fixture, 'site'));
  } else await compileLazyProbe(fixture);
  fs.mkdirSync(path.join(fixture, "pages"), { recursive: true });
  if (!fs.existsSync(path.join(fixture, "pages/Orrery"))) fs.symlinkSync(path.join(fixture, "site"), path.join(fixture, "pages/Orrery"), "dir");
  const root = await serve(process.env.ORRERY_DEFAULT_DIST || "dist"), nested = await serve(pages);
  const lazyRoot = await serve(path.join(fixture, "site")), lazyNested = await serve(path.join(fixture, "pages"));
  const results = [];
  try {
    for (const [label, base] of [["root", `${root.url}/`], ["pages", `${nested.url}/Orrery/`]]) {
      for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 },
        { width: 320, height: 568 }, { width: 844, height: 390 }]) {
        const page = await browser.newPage({ viewport });
        const errors = [], requests = [];
        await routeDefaultCatalog(page);
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
        page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
        page.on("request", request => requests.push(request.url()));
        try {
          const url = `${base}next/`;
          assert.equal((await page.goto(url)).status(), 200);
          await page.evaluate(() => document.fonts.ready);
          assert.equal(await page.title(), "Orrery — Preview");
          assert.match(await page.locator('meta[name="robots"]').getAttribute("content"), /noindex/);
          await page.waitForFunction(() => Number(document.querySelector("#orrery-count")?.textContent.replaceAll("\u202f", "")) > 0);
          assert.equal(await page.locator("#orrery canvas").count(), 1);
          assert.equal(await page.getByRole("button", { name: "Options", exact: true }).count(), 1);
          assert.equal(await page.getByRole("button", { name: "Options", exact: true }).getAttribute("aria-expanded"), "false");
          assert.equal(await page.evaluate(() => getComputedStyle(document.body).backgroundColor), "rgb(0, 0, 0)");
          assert(await page.evaluate(() => [...document.fonts].some(font => font.family === "JetBrains Mono Variable" && font.status === "loaded")));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), viewport.width);
          for (const selector of [".orrery-identity", ".orrery-date", ".orrery-count", ".orrery-options-trigger"]) {
            for (const element of await page.locator(selector).all()) {
              const box = await element.boundingBox();
              assert(box && box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0
                && box.y + box.height <= viewport.height, `${selector} fits ${viewport.width}×${viewport.height}`);
            }
          }
          // macOS WebKit follows Safari's default: Option-Tab includes
          // native links. Other supported browsers/platforms use Tab.
          await page.keyboard.press(name === "webkit" && process.platform === "darwin" ? "Alt+Tab" : "Tab");
          const link = page.getByRole("link", { name: "GitHub", exact: true });
          assert(await link.evaluate(element => element === document.activeElement));
          assert.equal(await link.evaluate(element => getComputedStyle(element).outlineStyle), "solid");
          assert.equal(await link.getAttribute("href"), "https://github.com/sn3p/Orrery");
          assert.equal(await link.getAttribute("target"), "_blank");
          await require("./next-layout.cjs").check(page);
          await page.screenshot({ path: path.join(directory, `${name}-${label}-${viewport.width}.png`) });
          await page.getByRole("button", { name: "Options", exact: true }).click();
          const input = page.getByRole("textbox", { name: "Playback speed" });
          assert(await page.getByRole("combobox", { name: "Renderer", exact: true }).evaluate(el => el === document.activeElement));
          await page.keyboard.press("Tab");
          assert(await input.evaluate(el => el === document.activeElement), "Tab reaches speed after Renderer");
          await input.fill("0"); await input.press("Enter");
          await page.waitForFunction(() => document.querySelector("#orrery-fps").textContent === "0 FPS");
          await require("./next-layout.cjs").checkLongReadouts(page);
          const date = await page.locator("#orrery-date").textContent();
          const panel = await page.locator(".orrery-options-panel").boundingBox();
          const identity = await page.locator(".orrery-identity").boundingBox();
          assert(panel.y + panel.height < identity.y || panel.x > identity.x + identity.width || panel.x + panel.width < identity.x,
            "Footer identity never obscures the options");
          await page.screenshot({ path: path.join(directory, `${name}-${label}-${viewport.width}-options.png`) });
          await input.fill("-1.5"); await input.press("Enter");
          await page.waitForFunction(date => document.querySelector("#orrery-date").textContent < date, date);
          await input.press("Escape");
          assert.equal(await page.getByRole("button", { name: "Options", exact: true }).getAttribute("aria-expanded"), "false");
          await page.reload();
          await page.waitForFunction(() => Number(document.querySelector("#orrery-count")?.textContent.replaceAll("\u202f", "")) > 0);
          assert.equal(await page.locator("#orrery canvas").count(), 1);
          assert(requests.filter(url => !url.startsWith("data:")).every(request => request.startsWith(url) || request.startsWith(producerBase)),
            "Preview assets stay in their static directory; catalogue requests use the selected producer");
          assert.equal(requests.filter(url => url === latestURL).length, 2, "Default startup and reload discover latest without CATALOG_CONFIG");
          assert(requests.some(url => /\/index-[a-f0-9]+\.json$/.test(url)), "Default preview resolves the verified index");
          assert(requests.some(url => /\/chunks\/[a-f0-9]+\.json$/.test(url)), "Default preview loads indexed chunks");
          assert(!requests.some(url => /\/data\/catalog.json$|\/full\/catalog/.test(url)), "Preview never requests historical or whole-file data");
          assert(requests.some(url => /\/pixi\.[\da-f]+\.js$/.test(url)), "Preview loads the real lazy Pixi adapter");
          assert(!requests.some(url => /\/three\.[\da-f]+\.js$/.test(url)), "Pixi startup does not eagerly load Three");
          // The legacy destination still works when visited directly.
          await page.goto(base);
          await page.waitForFunction(() => Number(document.querySelector("#orrery-count")?.textContent.replaceAll("\u202f", "")) > 0);
          assert.equal(await page.locator("#orrery canvas").count(), 1);
          assert.deepEqual(errors, []);
          results.push({ browser: name, path: label, viewport, reload: true, keyboardLink: true, isolated: true });
        } finally { await page.close(); }
      }
    }
    // Actual generated entry: latest HTTP failure/empty indexed catalogue and missing lazy engine
    // recover on reload. Intentional HTTP503 diagnostics are kept separate
    // from the zero-error ordinary-entry assertions above.
    const failure = await browser.newPage({ viewport: { width: 390, height: 844 } });
    const failureErrors = [], expectedDiagnostics = [];
    failure.on("pageerror", error => failureErrors.push(error.message));
    failure.on("console", message => { if (message.type() === "error") expectedDiagnostics.push(message.text()); });
    try {
      const url = `${nested.url}/Orrery/next/`;
      await failure.route(latestURL, route => route.fulfill({ status: 503, body: "Unavailable" }));
      await failure.goto(url);
      await failure.getByRole("alert").filter({ hasText: "Could not load the asteroid catalogue" }).waitFor();
      assert.equal(await failure.locator("#orrery-count").textContent(), "0");
      assert.equal(await failure.locator("#orrery canvas").count(), 1);
      await failure.unroute(latestURL);
      const removeEmpty = await routeDefaultCatalog(failure, { empty: true });
      await failure.reload();
      await failure.waitForFunction(() => document.querySelector("#orrery-date").textContent && document.querySelector("#orrery-status").textContent === "");
      assert.equal(await failure.locator("#orrery-count").textContent(), "0");
      await removeEmpty();
      await routeDefaultCatalog(failure);
      await failure.route("**/assets/pixi.*.js", route => route.fulfill({ status: 503, body: "Unavailable" }));
      await failure.reload();
      await failure.getByRole("status").filter({ hasText: "Unable to start" }).waitFor();
      assert.equal(await failure.getByRole("status").textContent(),
        "Unable to start the visualization. Please reload to try again.",
        "A failed renderer download gives recovery guidance without claiming WebGL is missing");
      assert.equal(await failure.locator("canvas, .orrery-options").count(), 0);
      assert(await failure.getByRole("link", { name: "GitHub", exact: true }).isVisible());
      await failure.unroute("**/assets/pixi.*.js");
      await failure.reload();
      await failure.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent.replaceAll("\u202f", "")) > 0);
      assert.equal(await failure.locator("#orrery canvas").count(), 1);
      assert.equal(await failure.locator(".orrery-options").count(), 1);
      assert.deepEqual(failureErrors, [], "Startup failures are handled without unhandled exceptions");
      results.push({ browser: name, path: "pages", httpFailure: true, emptyCatalogue: true, lazyFailure: true, reloadRecovery: true, expectedDiagnostics });
    } finally { await failure.close(); }
    for (const base of [`${lazyRoot.url}/next/`, `${lazyNested.url}/Orrery/next/`]) {
      const page = await browser.newPage();
      const requests = [], errors = [];
      page.on("request", request => requests.push(request.url()));
      page.on("pageerror", error => errors.push(error.message));
      try {
        await page.goto(base);
        assert(!requests.some(url => /\/probe\./.test(url)), "Lazy chunk is absent before demand");
        assert.deepEqual(await page.evaluate(async () => {
          const { url } = await window.loadPreviewProbe();
          return (await fetch(url)).json();
        }), { loaded: true });
        assert.equal(await page.evaluate(() => getComputedStyle(document.body).getPropertyValue("--preview-probe").trim()), "loaded");
        assert(requests.some(url => /\/probe\.[\da-f]+\.js$/.test(url)));
        assert(requests.filter(url => !url.startsWith("data:")).every(url => url.startsWith(base)));
        assert.deepEqual(errors, []);
      } finally { await page.close(); }
    }
    fs.writeFileSync(path.join(directory, "results.json"), JSON.stringify(results, null, 2) + "\n");
    console.log("Preview root/Pages paths, reload, fonts, responsive layout, keyboard link and lazy JS/CSS/data pass.");
  } finally { await root.close(); await nested.close(); await lazyRoot.close(); await lazyNested.close(); }
}

module.exports = { run, compileLazyProbe };
if (require.main === module) require("./standalone.cjs").run(run, { chromiumOnly: false });
