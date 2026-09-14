const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { chromium } = require("playwright");

(async () => {
  const directory = path.resolve(".context/next-preview/dev");
  fs.mkdirSync(directory, { recursive: true });
  const value = path.join(directory, "value.js"), entry = path.join(directory, "entry.js");
  fs.writeFileSync(value, 'export default "initial";\n');
  fs.writeFileSync(entry, `
    import ${JSON.stringify(path.resolve("src/unified/index.js"))};
    import value from "./value.js";
    window.previewProbe = { value, documentId: crypto.randomUUID() };
    module.hot.accept("./value.js", () => { window.previewProbe.value = value; });
  `);
  // Run the documented command on a dynamically assigned port. Add only a
  // test probe; actual preview HTML/styles, output paths and dev options apply.
  const child = spawn("npm", ["run", "serve:next", "--", "--host", "127.0.0.1", "--port", "0",
    "--no-open", "--entry", entry], { stdio: ["ignore", "pipe", "pipe"], detached: true });
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
  let browser;
  try {
    await until(() => /http:\/\/127\.0\.0\.1:\d+\//.test(log));
    const base = log.match(/http:\/\/127\.0\.0\.1:\d+\//)[0];
    browser = await chromium.launch({ channel: "chrome" });
    const page = await browser.newPage();
    const errors = [], hotChunks = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("response", response => {
      if (/\.hot-update\.js$/.test(new URL(response.url()).pathname)) hotChunks.push(response.status());
    });
    await page.goto(`${base}next/`);
    await page.waitForFunction(() => window.previewProbe?.value === "initial");
    assert.equal(await page.title(), "Orrery — Preview");
    const documentId = await page.evaluate(() => previewProbe.documentId);
    for (const text of ["first edit", "second edit"]) {
      fs.writeFileSync(value, `export default ${JSON.stringify(text)};\n`);
      await page.waitForFunction(text => previewProbe.value === text, text);
      assert.equal(await page.evaluate(() => previewProbe.documentId), documentId, "Accepted edit stays on the current document");
    }
    assert(hotChunks.length >= 2 && hotChunks.every(status => status === 200));
    fs.appendFileSync(entry, "\nwindow.previewProbe.reloaded = true;\n");
    await page.waitForFunction(previous => previewProbe.reloaded && previewProbe.documentId !== previous, documentId);
    assert.equal(await page.getByRole("heading", { level: 1 }).count(), 1);
    await page.reload();
    await page.waitForFunction(() => previewProbe.reloaded);
    await page.screenshot({ path: path.join(directory, "after-updates.png") });
    await page.getByRole("link", { name: "Open Orrery", exact: true }).click();
    await page.waitForURL(base);
    await page.waitForFunction(() => Number(document.querySelector("#orrery-count")?.textContent) > 0);
    assert.equal((await page.request.get(`${base}favicon.ico`)).status(), 204,
      "Returning to the static root has no missing automatic favicon request");
    assert.deepEqual(errors, []);
    console.log("Actual serve:next command serves /next/, applies hot chunks and reloads unaccepted edits.");
  } finally {
    await browser?.close();
    if (child.exitCode === null) process.kill(-child.pid, "SIGTERM");
    await exited;
    fs.writeFileSync(path.join(directory, "server.log"), log);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
