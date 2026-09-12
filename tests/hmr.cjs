const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const webpack = require("webpack");
const DevServer = require("webpack-dev-server");
const { chromium } = require("playwright");
const config = require("../webpack.config");

(async () => {
  const directory = path.resolve(".context/hmr-test");
  fs.mkdirSync(directory, { recursive: true });
  const valueFile = path.join(directory, "value.js");
  const entryFile = path.join(directory, "entry.js");
  fs.writeFileSync(valueFile, 'export default "initial";\n');
  fs.writeFileSync(entryFile, `
    import value from "./value.js";
    window.hmrProbe = { value, documentId: crypto.randomUUID() };
    module.hot.accept("./value.js", () => { window.hmrProbe.value = value; });
  `);
  const compiler = webpack({ ...config, mode: "development",
    entry: { main: [path.resolve("src/js/index.js"), entryFile] },
    output: { ...config.output, path: path.join(directory, "dist") },
    infrastructureLogging: { level: "error" }, stats: "errors-only" });
  let compiled;
  compiler.hooks.done.tap("HotUpdateRegression", stats => compiled?.(stats));
  function nextBuild() {
    let timer;
    return new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error("Hot-update compilation timed out")), 30000);
      compiled = resolve;
    }).finally(() => { clearTimeout(timer); compiled = null; });
  }
  const server = new DevServer({ ...config.devServer, host: "127.0.0.1", port: 0,
    open: false, static: false, watchFiles: [], hot: true,
    setupMiddlewares(middlewares, server) {
      server.app.get("/favicon.ico", (_req, res) => res.status(204).end());
      return middlewares;
    },
    client: { logging: "none" }, devMiddleware: { stats: "errors-only" } }, compiler);
  let browser;
  try {
    const initial = nextBuild();
    await server.start();
    assert(!(await initial).hasErrors(), "Initial development compilation succeeds");
    browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage();
    const errors = [], hotChunks = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("response", response => {
      if (/\.hot-update\.js$/.test(new URL(response.url()).pathname)) hotChunks.push(response.status());
    });
    await page.goto(`http://127.0.0.1:${server.server.address().port}`);
    await page.waitForFunction(() => window.hmrProbe?.value === "initial"
      && Number(document.querySelector("#orrery-count").textContent) > 0);
    const documentId = await page.evaluate(() => hmrProbe.documentId);
    for (const value of ["first edit", "second edit"]) {
      const rebuilt = nextBuild();
      fs.writeFileSync(valueFile, `export default ${JSON.stringify(value)};\n`);
      const stats = await rebuilt;
      assert(!stats.hasErrors(), stats.toString("errors-only"));
      await page.waitForFunction(value => hmrProbe.value === value, value);
      assert.equal(await page.evaluate(() => hmrProbe.documentId), documentId, "Update applies without reloading the page");
    }
    assert.deepEqual(hotChunks, [200, 200], "Both hot-update chunks are fetched successfully");
    // Orrery's entry does not accept HMR, so application edits must also be
    // able to rebuild and take the dev server's normal full-reload path.
    const rebuilt = nextBuild();
    fs.appendFileSync(entryFile, "\nwindow.hmrProbe.unacceptedEdit = true;\n");
    const stats = await rebuilt;
    assert(!stats.hasErrors(), stats.toString("errors-only"));
    await page.waitForFunction(previous => window.hmrProbe?.unacceptedEdit
      && hmrProbe.documentId !== previous
      && Number(document.querySelector("#orrery-count").textContent) > 0, documentId);
    assert.equal(await page.locator("#orrery canvas").count(), 1, "Reload initializes one Orrery canvas");
    assert.deepEqual(errors, [], "Hot updates leave no compiler or browser errors");
    assert.equal(await page.locator("#webpack-dev-server-client-overlay").count(), 0);
    await page.screenshot({ path: path.join(directory, "after-updates.png") });
    console.log("Development server applies two hot updates and reloads an unaccepted edit with the actual Orrery app rendered.");
  } finally {
    await browser?.close();
    await server.stop();
    await new Promise((resolve, reject) => compiler.close(error => error ? reject(error) : resolve()));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
