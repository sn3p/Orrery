const fs = require("node:fs/promises");
const path = require("node:path");
const { serve } = require("./support.cjs");
const { launchBrowser } = require("./browsers.cjs");
const suite = require("./catalog-loading.cjs");
(async () => {
  const output = path.resolve(".context/pr3/browser");
  await fs.mkdir(output, { recursive: true });
  const server = await serve(output), results = [];
  try {
    await suite.build(output, server.url);
    for (const name of (process.env.BROWSERS || "chromium").split(",")) {
      const browser = await launchBrowser(name);
      try { results.push({ name, cases: await suite.run(browser, server.url, output, name) }); }
      finally { await browser.close(); }
      await fs.writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
      console.log(name + ": actual-entry catalogue loading/lifecycle passed.");
    }
  } finally { await server.close(); }
  require("node:child_process").execFileSync(process.execPath, ["tests/next-dev.cjs"], {
    stdio: "inherit", env: { ...process.env, CATALOG_CONFIG: path.resolve("catalog-profiles/ties-indexed.json") },
  });
})().catch(error => { console.error(error); process.exitCode = 1; });
