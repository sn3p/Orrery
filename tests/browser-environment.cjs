const assert = require("node:assert/strict");
const fs = require("node:fs");
const { launchBrowser } = require("./browsers.cjs");

(async () => {
  const directory = ".context/browser-environment";
  fs.mkdirSync(directory, { recursive: true });
  // Some development and legacy tests also use Chrome in the other matrix jobs.
  for (const name of new Set([...(process.env.BROWSERS || "chromium").split(","), "chromium"])) {
    const browser = await launchBrowser(name);
    try {
      const page = await browser.newPage();
      const contexts = await page.evaluate(() => ["webgl", "webgl2"].map(type => {
        const gl = document.createElement("canvas").getContext(type);
        if (!gl) return { type, available: false };
        const extension = gl.getExtension("WEBGL_debug_renderer_info");
        const renderer = gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
        const precision = gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT);
        const result = { type, available: true, renderer, precision: precision.precision };
        gl.getExtension("WEBGL_lose_context")?.loseContext();
        return result;
      }));
      const report = { browser: name, version: browser.version(), graphics: process.env.ORRERY_TEST_GRAPHICS || "default", contexts };
      fs.writeFileSync(`${directory}/${name}.json`, JSON.stringify(report, null, 2) + "\n");
      console.log(JSON.stringify(report));
      assert(contexts[0].available, `${name}: WebGL is required by the legacy browser tests`);
      if (process.env.ORRERY_TEST_GRAPHICS === "mesa") {
        assert(contexts[1].available, `${name}: CI must exercise WebGL2 numerical checks, not skip them`);
        // WebKit masks the backend as "Apple GPU", including on Linux:
        // https://github.com/microsoft/playwright/issues/2864
        if (name !== "webkit") {
          assert(contexts.every(context => /llvmpipe|softpipe/i.test(context.renderer)),
            `${name}: expected Mesa software rendering, got ${JSON.stringify(contexts)}`);
        }
      }
    } finally { await browser.close(); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
