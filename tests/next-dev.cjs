const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

async function run({ browser, name, application = "legacy", output: artifactDirectory,
  catalogConfig = process.env.CATALOG_CONFIG, renderer = "pixi", command = "serve:next" }) {
  const selection = catalogConfig && JSON.parse(fs.readFileSync(catalogConfig, "utf8"));
  const directory = artifactDirectory || path.resolve(selection ? ".context/pr3/browser/dev" : ".context/next-preview/dev");
  fs.mkdirSync(directory, { recursive: true });
  const value = path.join(directory, "value.js"), entry = path.join(directory, "entry.js");
  fs.writeFileSync(value, 'export default "initial";\n');
  fs.writeFileSync(entry, `
    import { app } from ${JSON.stringify(path.resolve("src/unified/index.js"))};
    import value from "./value.js";
    window.previewProbe = { app, value, documentId: crypto.randomUUID() };
    module.hot.accept("./value.js", () => { window.previewProbe.value = value; });
  `);
  // Run the documented command on a dynamically assigned port. Add only a
  // test probe; actual preview HTML/styles, output paths and dev options apply.
  const child = spawn("npm", ["run", command, "--", "--host", "127.0.0.1", "--port", "0",
    "--no-open", "--entry", entry], { stdio: ["ignore", "pipe", "pipe"], detached: true,
    env: { ...process.env, CATALOG_CONFIG: catalogConfig || "" } });
  let log = "";
  child.stdout.on("data", data => log += data); child.stderr.on("data", data => log += data);
  const exited = new Promise(resolve => child.on("exit", resolve));
  async function until(test) {
    const deadline = Date.now() + 30000;
    while (!test()) {
      if (child.exitCode !== null || Date.now() >= deadline) throw new Error(`Preview dev server failed: ${log}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  try {
    await until(() => /http:\/\/127\.0\.0\.1:\d+\//.test(log));
    const base = log.match(/http:\/\/127\.0\.0\.1:\d+\//)[0];
    const page = await browser.newPage();
    const requests = [];
    page.on("request", request => requests.push(request.url()));
    if (!selection) await require("./default-catalog-route.cjs").routeDefaultCatalog(page);
    const errors = [], hotChunks = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("response", response => {
      if (/\.hot-update\.js$/.test(new URL(response.url()).pathname)) hotChunks.push(response.status());
    });
    await page.goto(`${base}?renderer=${renderer}`);
    await page.waitForFunction(() => window.previewProbe?.value === "initial");
    assert.equal(await page.title(), "Orrery");
    const documentId = await page.evaluate(() => previewProbe.documentId);
    for (const text of ["first edit", "second edit"]) {
      fs.writeFileSync(value, `export default ${JSON.stringify(text)};\n`);
      await page.waitForFunction(text => previewProbe.value === text, text);
      assert.equal(await page.evaluate(() => previewProbe.documentId), documentId, "Accepted edit stays on the current document");
    }
    assert(hotChunks.length >= 2 && hotChunks.every(status => status === 200));
    fs.appendFileSync(entry, "\nwindow.previewProbe.reloaded = true;\n");
    await page.waitForFunction(previous => previewProbe.reloaded && previewProbe.documentId !== previous, documentId);
    await page.waitForFunction(() => Number(document.querySelector("#orrery-count")?.textContent.replaceAll("\u202f", "")) > 0);
    if (selection) {
      await page.waitForFunction(() => previewProbe.app.catalogLoader?.sceneComplete());
      assert.equal(await page.evaluate(() => previewProbe.app.catalogLoader.source.sourceId), selection.pin.sha256);
    }
    if (!selection) {
      await page.waitForFunction(() => previewProbe.app.catalogLoader?.sceneComplete());
      assert(requests.includes(require("./default-catalog-route.cjs").latestURL));
      assert(!requests.some(url => url.endsWith('/data/catalog.json')), "Default development never fetches the legacy bundle");
      assert.equal(await page.evaluate(() => previewProbe.app.catalogLoader.source.mode), "indexed");
    }
    assert.equal(await page.locator("#orrery canvas").count(), 1);
    assert.equal(await page.locator(".orrery-options").count(), 1);
    await page.reload();
    await page.waitForFunction(() => previewProbe.reloaded);
    if (selection) {
      await page.waitForFunction(() => previewProbe.app.catalogLoader?.sceneComplete());
      assert.equal(await page.evaluate(() => previewProbe.app.catalogLoader.source.sourceId), selection.pin.sha256);
    }
    await page.screenshot({ path: path.join(directory, "after-updates.png") });
    // The historical combined-build test covers the return destination. The
    // configured standalone preview does not require a root build to exist.
    if (!selection) {
      for (const suffix of ["next/", "next", "next/index.html"]) {
        await page.goto(base + suffix + "?renderer=" + renderer + "&extra=a%20b#view");
        await page.waitForURL(base + "?renderer=" + renderer + "&extra=a%20b#view");
        await page.waitForFunction(() => Number(document.querySelector("#orrery-count")?.textContent.replaceAll("\u202f", "")) > 0);
      }
      await page.waitForFunction(() => Number(document.querySelector("#orrery-count")?.textContent.replaceAll("\u202f", "")) > 0);
      assert.equal((await page.request.get(`${base}favicon.ico`)).status(), 204,
        "Returning to the static root has no missing automatic favicon request");
    }
    assert.deepEqual(errors, []);
    console.log("Actual serve:next command serves /next/, applies hot chunks and reloads unaccepted edits.");
  } finally {
    if (child.exitCode === null) process.kill(-child.pid, "SIGTERM");
    await exited;
    fs.writeFileSync(path.join(directory, "server.log"), log);
  }
}

module.exports = { run };
if (require.main === module) require("./standalone.cjs").run(run, { chromiumOnly: true });
