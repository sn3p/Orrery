const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const browsers = require("playwright");
const { serve } = require("./support.cjs");
const hash = bytes => createHash("sha256").update(bytes).digest("hex");

(async () => {
  const directory = path.resolve(".context/build-test/deployment");
  fs.mkdirSync(directory, { recursive: true });
  const nested = path.join(directory, "Orrery");
  if (!fs.existsSync(nested)) fs.symlinkSync(path.resolve("dist"), nested, "dir");
  const catalog = fs.readFileSync("data/catalog.json");
  assert.equal(JSON.parse(catalog).length, 100000);
  assert.equal(hash(fs.readFileSync("dist/data/catalog.json")), hash(catalog));
  assert.deepEqual(fs.readdirSync("dist/data"), ["catalog.json"]);
  assert.deepEqual(fs.readdirSync("dist").filter(file => file.endsWith(".js")), ["bundle.js"]);
  for (const file of fs.readdirSync("src/fonts").filter(file => /\.(woff2|txt)$/.test(file))) {
    assert.equal(hash(fs.readFileSync(`dist/fonts/${file}`)), hash(fs.readFileSync(`src/fonts/${file}`)));
  }
  const root = await serve("dist"), subpath = await serve(directory);
  const results = [];
  try {
    for (const name of (process.env.BROWSERS || "chromium").split(",")) {
      const browser = await browsers[name].launch(name === "chromium" ? { channel: "chrome" } : {});
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
              await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent) > 0);
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
              for (const selector of ["#orrery-date", "#orrery-fps", "#orrery-count", ".dg.main"]) {
                const box = await page.locator(selector).boundingBox();
                assert(box && box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0
                  && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, `${selector} fits`);
              }
              await page.screenshot({ path: path.join(directory, `${name}-${label}-${viewport.width}.png`) });
              await page.unroute("**/data/catalog.json");
              await page.reload();
              await page.waitForFunction(() => Number(document.querySelector("#orrery-count").textContent) > 0);
              assert.equal(await page.locator("#orrery canvas").count(), 1);
              assert(!requests.some(url => new URL(url).pathname.includes("/next/")),
                "Root visitors never fetch preview resources");
              assert.equal(await page.locator('a[href*="next/"]').count(), 0,
                "The public root does not link to the preview");
              assert.deepEqual(errors, []);
              results.push({ browser: name, path: label, width: viewport.width, catalogSHA256: hash(catalog), asyncFetch: true, reload: true });
            } finally { release(); await page.close(); }
          }
        }
      } finally { await browser.close(); }
    }
    fs.writeFileSync(path.join(directory, "results.json"), JSON.stringify(results, null, 2) + "\n");
    console.log("Production root and nested deployment fetch exact catalogue bytes; fonts, layout, keyboard and reload pass.");
  } finally { await root.close(); await subpath.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
