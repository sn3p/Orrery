const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fs = require("node:fs/promises");
const path = require("node:path");
const { measure } = require("../benchmarks/catalog-loading.cjs");
const execute = promisify(execFile), root = path.resolve(__dirname, "..");

test("catalogue benchmark rejects invalid duration and network profiles before building", async () => {
  for (const [name, values] of [["DURATION_SECONDS", ["", " ", "NaN", "Infinity", "-1", "1e308"]],
    ["PROFILES", ["", "native,", "native,unknown", "10mbps"]], ["RENDERER", ["", "unknown", "constructor"]]]) {
    for (const value of values) {
      await assert.rejects(execute(process.execPath, ["benchmarks/catalog-loading.cjs", "/missing-config.json"], {
        cwd: root, timeout: 5000,
        env: { ...process.env, DURATION_SECONDS: "0", PROFILES: "native", [name]: value },
      }), error => error.code === 1 && !error.killed && error.stderr.includes(name));
    }
  }
});

test("catalogue measurements release the browser context if CDP setup fails", async () => {
  let closed = 0;
  const context = { newPage: async () => ({}), newCDPSession: async () => { throw new Error("controlled CDP failure"); },
    close: async () => { closed++; } };
  await assert.rejects(measure({ newContext: async () => context }, "http://localhost/", "native", 0), /controlled CDP failure/);
  assert.equal(closed, 1);
});

test("catalogue benchmark closes its HTTP server when browser launch fails", async t => {
  const directory = await fs.mkdtemp(path.join(root, ".context/benchmark-launch-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const preload = path.join(directory, "fail-launch.cjs");
  await fs.writeFile(preload, `require(${JSON.stringify(require.resolve("playwright"))}).chromium.launch = async () => { throw new Error("controlled launch failure"); };`);
  await assert.rejects(execute(process.execPath, ["--require", preload, "benchmarks/catalog-loading.cjs", "catalog-profiles/ties-indexed.json"], {
    cwd: root, timeout: 20000,
    env: { ...process.env, DURATION_SECONDS: "0", PROFILES: "native", OUTPUT: path.join(directory, "report.json") },
  }), error => error.code === 1 && !error.killed && error.stderr.includes("controlled launch failure"));
});
