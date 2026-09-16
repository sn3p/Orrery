const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { serve } = require("./support.cjs");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

async function run({ browser, name, application = "unified", output: artifactDirectory }) {
  const directory = artifactDirectory || path.resolve(".context/build-test/deployment");
  fs.mkdirSync(directory, { recursive: true });
  // Exact historical fixture delivery through the production App at root/subpath.
  const dist = path.join(directory, "fixture-site");
  await require("./support.cjs").build("./tests/bundled-entry.js", dist, { application: "unified" });
  const nested = path.join(directory, "Orrery");
  if (!fs.existsSync(nested)) fs.symlinkSync(path.resolve(dist), nested, "dir");
  const catalog = require("./historical-catalog.cjs").readCatalog();
  assert.equal(JSON.parse(catalog).length, 100000);
  assert.equal(hash(fs.readFileSync(path.join(dist, "data/catalog.json"))), hash(catalog));
  assert.deepEqual(fs.readdirSync(path.join(dist, "data")), ["catalog.json"]);
  assert.deepEqual(fs.readdirSync(dist).filter(file => file.endsWith(".js")), ["bundle.js"]);
  for (const file of fs.readdirSync("src/fonts").filter(file => /\.(woff2|txt)$/.test(file))) {
    assert.equal(hash(fs.readFileSync(path.join(dist, "fonts", file))), hash(fs.readFileSync(`src/fonts/${file}`)));
  }
  const root = await serve(dist), subpath = await serve(directory);
  const results = [];
  try {
    for (const [label, url] of [["root", `${root.url}/`], ["nested", `${subpath.url}/Orrery/`]]) {
      for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
        const page = await browser.newPage({ viewport });
        // Digest the actual application fetch inside the page: Firefox's
        // debugging protocol can evict this large response before body().
        // Finish the clone before returning: successful catalogue replacement
        // aborts its completed request and would also cancel a slower clone.
        await page.addInitScript(() => {
          const fetch = window.fetch;
          window.fetch = async (...args) => {
            const response = await fetch(...args);
            if (response.url.endsWith("/data/catalog.json")) {
              window.catalogDigest = await response.clone().arrayBuffer().then(async bytes => ({
                bytes: bytes.byteLength,
                sha256: [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
                  .map(byte => byte.toString(16).padStart(2, "0")).join(""),
              }));
            }
            return response;
          };
        });
        const errors = [];
        const requests = [];
        page.on("request", request => requests.push(request.url()));
        page.on("pageerror", error => errors.push(error.message));
        page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
        let release;
        const gate = new Promise(resolve => { release = resolve; });
        await page.route("**/data/catalog.json", async route => { await gate; await route.continue(); });
        try {
          const request = page.waitForRequest(request => request.url() === `${url}data/catalog.json`);
          const response = page.waitForResponse(response => response.url() === `${url}data/catalog.json`);
          await page.goto(url, { waitUntil: "domcontentloaded" });
          assert.equal((await request).resourceType(), "fetch", "Catalogue stays an async fetch at the deployment path");
          assert.equal(await page.getByRole("status").textContent(), "Loading asteroids…");
          assert.equal(await page.locator("#orrery-count").textContent(), "0");
          assert.equal(await page.locator("#orrery canvas").count(), 1);
          release();
          const fetched = await response;
          assert.equal(fetched.status(), 200);
          await page.waitForFunction(() => window.catalogDigest);
          assert.deepEqual(await page.evaluate(() => window.catalogDigest), { bytes: catalog.length, sha256: hash(catalog) });
          await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent.replaceAll("\u202f", "")) > 0);
          await page.evaluate(() => document.fonts.ready);
          await require("./options.cjs").openOptions(page);
          const speed = page.getByRole("textbox", { name: "Playback speed" });
          await speed.focus();
          assert(await speed.evaluate(element => element === document.activeElement));
          await page.keyboard.press("ControlOrMeta+A");
          await page.keyboard.insertText("0"); await page.keyboard.press("Enter");
          assert.equal(await speed.inputValue(), "0");
          assert.equal(await page.locator("#orrery-fps").textContent(), "0 FPS");
          assert(await page.evaluate(() => [...document.fonts].some(font => font.family === "JetBrains Mono Variable" && font.status === "loaded")));
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), viewport.width);
          for (const selector of ["#orrery-date", "#orrery-fps", "#orrery-count", ".orrery-options-panel"]) {
            const box = await page.locator(selector).boundingBox();
            assert(box && box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0
              && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, `${selector} fits`);
          }
          await page.screenshot({ path: path.join(directory, `${name}-${label}-${viewport.width}.png`) });
          await page.unroute("**/data/catalog.json");
          await page.reload();
          await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent.replaceAll("\u202f", "")) > 0);
          assert.equal(await page.locator("#orrery canvas").count(), 1);
          assert(!requests.some(url => new URL(url).pathname.includes("/next/")),
            "Root visitors never fetch preview resources");
          assert.equal(await page.locator('a[href*="next/"]').count(), 0,
            "The public root does not link to the preview");
          assert.deepEqual(errors, []);
          results.push({ browser: name, path: label, width: viewport.width, catalogSHA256: hash(catalog), asyncFetch: true, reload: true });
        } catch (error) {
          const diagnostic = { browser: name, label, viewport, url, error: error.message, errors };
          diagnostic.page = await page.evaluate(() => ({
            status: document.querySelector("#orrery-status")?.textContent,
            count: document.querySelector("#orrery-count")?.textContent,
            visibility: document.visibilityState,
            catalogDigest: window.catalogDigest,
          })).catch(error => ({ error: error.message }));
          const prefix = path.join(directory, `${name}-${label}-${viewport.width}-failure`);
          fs.writeFileSync(`${prefix}.json`, JSON.stringify(diagnostic, null, 2) + "\n");
          await page.screenshot({ path: `${prefix}.png`, timeout: 5000 }).catch(() => {});
          console.error(JSON.stringify(diagnostic));
          throw error;
        } finally { release(); await page.close(); }
      }
    }
    fs.writeFileSync(path.join(directory, "results.json"), JSON.stringify(results, null, 2) + "\n");
    console.log("Historical fixture root and nested deployment fetch exact catalogue bytes; fonts, layout, keyboard and reload pass.");
  } finally { await root.close(); await subpath.close(); }
}

module.exports = { run };
if (require.main === module) require("./standalone.cjs").run(run, { chromiumOnly: false });
