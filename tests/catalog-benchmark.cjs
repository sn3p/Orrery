const assert = require("node:assert/strict");
const path = require("node:path");
const { measure } = require("../benchmarks/catalog-loading.cjs");

async function run(browser, base, output) {
  const results = [];
  for (const version of [1, 2]) for (const mode of ["indexed", "whole", "historical"]) {
    const contexts = [];
    let fail, timer;
    const failed = new Promise((_, reject) => { fail = reject; });
    // Exercise the actual benchmark, including its own context, initial
    // completion measurement, full-population jump and context restoration.
    const instrumented = { newContext: async options => {
      const context = await browser.newContext(options);
      contexts.push(context);
      context.on("page", page => page.on("pageerror", fail));
      if (version === 1) await context.addInitScript(() => {
        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
          return type === "webgl2" ? null : getContext.call(this, type, ...args);
        };
      });
      return context;
    } };
    try {
      timer = setTimeout(() => fail(new Error("Catalogue benchmark did not complete")), 30000);
      const result = await Promise.race([failed, measure(instrumented, base + "/catalog-" + mode + "/", "native", 0, [],
        path.join(output, `chromium-benchmark-${mode}-webgl${version}.png`))]);
      assert.equal(result.webGLVersion, version, "Report the renderer actually used");
      assert.equal(result.initialGpuMethod, version === 2 ? "fenceSync" : "finish");
      assert(Number.isFinite(result.initialSubmissionMs) && result.initialSubmissionMs > 0);
      assert(Number.isFinite(result.initialGpuMs) && result.initialGpuMs >= result.initialSubmissionMs);
      assert.equal(result.initialMs, result.initialGpuMs);
      assert.equal(result.population, mode === "historical" ? 100000 : 6);
      assert.equal(result.restoredDataRequests, 0);
      assert.deepEqual(result.errors, []);
      results.push({ benchmark: mode, webGLVersion: result.webGLVersion, method: result.initialGpuMethod,
        initialMs: result.initialMs, population: result.population, restoredDataRequests: result.restoredDataRequests });
    } finally {
      clearTimeout(timer);
      await Promise.all(contexts.map(context => context.close()));
    }
  }
  return results;
}

module.exports = { run };
