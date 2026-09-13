const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const webpack = require("webpack");
const config = require("../webpack.config");

(async () => {
  const directory = path.resolve(".context/build-test");
  fs.mkdirSync(directory, { recursive: true });
  const entry = path.join(directory, "entry.js");
  const css = path.join(directory, "probe.css");
  const json = path.join(directory, "probe.json");
  fs.writeFileSync(json, '[ { "value": 1 } ]\n');
  fs.writeFileSync(entry, 'import "./probe.css";\nimport jsonURL from "./probe.json";\nwindow.jsonURL = jsonURL;\nwindow.buildProbe = "initial";\n');
  fs.writeFileSync(css, '.build-probe {\n  color: rgb(255, 0, 0);\n  padding: 0px 0px 0px 0px;\n}\n');
  const options = output => ({ ...config, entry, output: { ...config.output, path: output },
    performance: { hints: false }, stats: "errors-only" });
  const originalEnv = process.env.NODE_ENV;
  try {
    for (const [mode, environment] of [["development", "production"], ["production", "development"],
      [undefined, "development"], ["none", "production"]]) {
      process.env.NODE_ENV = environment;
      const output = path.join(directory, mode || "default");
      const compiler = webpack({ ...options(output), ...(mode ? { mode } : {}) });
      const stats = await new Promise((resolve, reject) => compiler.run((error, stats) =>
        compiler.close(() => error ? reject(error) : resolve(stats))));
      assert(!stats.hasErrors(), stats.toString("errors-only"));
      assert.equal(fs.readFileSync(path.join(output, "data/probe.json"), "utf8"), fs.readFileSync(json, "utf8"),
        "JSON is emitted once at its stable URL with unchanged bytes");
      assert.equal([...stats.compilation.modules].find(module => module.resource === json).type, "asset/resource");
      const production = mode === "production" || mode === undefined;
      assert.equal(stats.compilation.getAsset("bundle.js").info.minimized === true, production,
        `${mode || "default"} JS ignores NODE_ENV=${environment}`);
      const outputCSS = fs.readFileSync(path.join(output, "main.css"), "utf8");
      assert.equal(outputCSS.includes("rgb(255, 0, 0)"), !production,
        `${mode || "default"} CSS uses the same webpack mode as JS`);
      assert.equal(outputCSS.includes("0px 0px 0px 0px"), !production);
    }
  } finally {
    if (originalEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = originalEnv;
  }

  // Exercise the user's watch command and real rebuilds without editing source.
  const output = path.join(directory, "watch");
  fs.rmSync(output, { recursive: true, force: true });
  const wrapper = path.join(directory, "webpack.cjs");
  fs.writeFileSync(wrapper, `const base = require(${JSON.stringify(path.resolve("webpack.config.js"))});\n`
    + `module.exports = { ...base, entry: ${JSON.stringify(entry)}, output: { ...base.output, path: ${JSON.stringify(output)} }, stats: "errors-only" };\n`);
  const child = spawn("npm", ["run", "watch", "--", "--config", wrapper], {
    env: { ...process.env, NODE_ENV: "production" }, stdio: ["ignore", "pipe", "pipe"], detached: true,
  });
  let log = "";
  child.stdout.on("data", data => log += data); child.stderr.on("data", data => log += data);
  const closed = new Promise(resolve => child.on("exit", resolve));
  async function until(test) {
    const end = Date.now() + 30000;
    while (!test()) {
      if (child.exitCode !== null || Date.now() > end) throw new Error(`Watch failed: ${log}`);
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  const contains = (filename, text) => fs.existsSync(path.join(output, filename))
    && fs.readFileSync(path.join(output, filename), "utf8").includes(text);
  try {
    await until(() => contains("bundle.js", "initial") && contains("main.css", "rgb(255, 0, 0)"));
    fs.writeFileSync(entry, 'import "./probe.css";\nimport jsonURL from "./probe.json";\nwindow.jsonURL = jsonURL;\nwindow.buildProbe = "watch edit";\n');
    await until(() => contains("bundle.js", "watch edit"));
    fs.writeFileSync(css, '.build-probe {\n  color: rgb(0, 255, 0);\n  padding: 0px 0px 0px 0px;\n}\n');
    await until(() => contains("main.css", "rgb(0, 255, 0)"));
    assert(contains("main.css", "0px 0px 0px 0px"), "Watch keeps CSS readable after rebuild");
    fs.writeFileSync(json, '[ { "value": 2 } ]\n');
    await until(() => contains("data/probe.json", '"value": 2'));
    assert.equal(fs.readFileSync(path.join(output, "data/probe.json"), "utf8"), fs.readFileSync(json, "utf8"));
    assert(contains("bundle.js", "eval("), "Watch keeps webpack development output after rebuild");
  } finally {
    process.kill(-child.pid, "SIGTERM"); await closed;
    fs.writeFileSync(path.join(directory, "watch.log"), log);
  }
  console.log("Build modes follow webpack rather than stale NODE_ENV; npm watch rebuilds readable JS, CSS and native JSON assets.");
})().catch(error => { console.error(error); process.exitCode = 1; });
