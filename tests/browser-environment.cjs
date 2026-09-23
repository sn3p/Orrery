const assert = require("node:assert/strict");
const fs = require("node:fs");

function webglProbeIncomplete(contexts, graphics) {
  return !contexts?.[0]?.available || (graphics === "mesa" && !contexts?.[1]?.available);
}

async function readContexts(page) {
  return page.evaluate(() => ["webgl", "webgl2"].map(type => {
    const gl = document.createElement("canvas").getContext(type);
    if (!gl) return { type, available: false };
    const extension = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = gl.getParameter(extension ? extension.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    const precision = gl.getShaderPrecisionFormat(gl.VERTEX_SHADER, gl.HIGH_FLOAT);
    const result = { type, available: true, renderer, precision: precision.precision };
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return result;
  }));
}

// Firefox on the Mesa display can report no WebGL on the first page and succeed
// on the next. A later page is the same check, not a weaker requirement.
async function run({ browser, name, application = "unified", output: artifactDirectory,
  graphics = process.env.ORRERY_TEST_GRAPHICS || "default", attempts = 3,
  pause = () => new Promise(resolve => setTimeout(resolve, 300)) }) {
  const directory = artifactDirectory || ".context/browser-environment";
  fs.mkdirSync(directory, { recursive: true });
  let contexts;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const page = await browser.newPage();
    try { contexts = await readContexts(page); }
    finally { await page.close(); }
    if (!webglProbeIncomplete(contexts, graphics) || attempt === attempts) break;
    await pause();
  }
  const report = { browser: name, version: browser.version(), graphics, contexts };
  fs.writeFileSync(`${directory}/${name}.json`, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report));
  assert(contexts[0].available, `${name}: WebGL is required by the legacy browser tests`);
  if (graphics === "mesa") {
    assert(contexts[1].available, `${name}: CI must exercise WebGL2 numerical checks, not skip them`);
    // WebKit masks the backend as "Apple GPU", including on Linux:
    // https://github.com/microsoft/playwright/issues/2864
    if (name !== "webkit") {
      assert(contexts.every(context => /llvmpipe|softpipe/i.test(context.renderer)),
        `${name}: expected Mesa software rendering, got ${JSON.stringify(contexts)}`);
    }
  }
}

module.exports = { run };
if (require.main === module) require("./standalone.cjs").run(run, { chromiumOnly: false });
