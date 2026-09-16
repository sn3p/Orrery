const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const webpack = require("webpack");

function files(directory) {
  return fs.readdirSync(directory, { recursive: true }).filter(name => fs.statSync(path.join(directory, name)).isFile()).sort();
}
function fingerprint(directory, excludePreview = false) {
  return Object.fromEntries(files(directory).filter(name => !excludePreview || !name.startsWith(`next${path.sep}`))
    .map(name => [name, createHash("sha256").update(fs.readFileSync(path.join(directory, name))).digest("hex")]));
}
async function compile(config) {
  const compiler = webpack(config);
  return new Promise((resolve, reject) => compiler.run((error, stats) => compiler.close(closeError => {
    if (error || closeError || stats.hasErrors()) reject(error || closeError || new Error(stats.toString("errors-only")));
    else resolve(stats);
  })));
}

(async () => {
  const directory = path.resolve(".context/next-preview/build");
  fs.mkdirSync(directory, { recursive: true });
  // Preserve the active app output while retiring the second public build.
  const config = await require("../webpack.app.config.cjs")();
  const baseline = path.join(directory, "current-app");
  const stats = await compile({ ...config, mode: "production",
    output: { ...config.output, path: baseline, clean: true }, performance: { hints: false } });
  assert(![...stats.compilation.modules].some(module => /src[\\/]js[\\/](?:Orrery|Gui|index)\.js$/.test(module.resource || "")),
    "Public import graph excludes the legacy application");
  require("./build-boundaries.cjs").assertNoTestImports(stats);
  const original = fingerprint(baseline);
  // Exercise the exact Pages command twice, including stale sibling output.
  for (let round = 0; round < 2; round++) {
    fs.mkdirSync("dist/next", { recursive: true });
    fs.writeFileSync("dist/stale-root.txt", "old");
    fs.writeFileSync("dist/next/stale-preview.txt", "old");
    fs.writeFileSync("dist/next/index.html", "old redirect");
    const log = execFileSync("npm", ["run", "build", "--", round === 0 ? "--output-clean" : "--output-clean=true"], { encoding: "utf8" });
    fs.writeFileSync(path.join(directory, `build-${round}.log`), log);
    require('./site-assets.cjs')('dist');
    assert.deepEqual(fingerprint("dist"), original, "Production command emits exactly one current app");
    assert(!fs.existsSync("dist/stale-root.txt"));
    const javascript = files("dist/assets").filter(name => name.endsWith(".js"))
      .map(name => fs.readFileSync(path.join("dist/assets", name), "utf8")).join("\n");
    assert(javascript.includes(require("../catalog-profiles/latest.json").latest), "Default app selects the producer descriptor");
  }

  const promoted = fingerprint("dist");
  execFileSync("npm", ["run", "build:next", "--", "--output-clean"], { stdio: "pipe" });
  assert.deepEqual(fingerprint("dist"), promoted, "Deprecated build:next alias emits the same complete promoted site");
  const overridden = path.join(directory, "output-override");
  fs.mkdirSync(overridden, { recursive: true });
  fs.writeFileSync(path.join(overridden, "index.html"), "existing site");
  const savedOutput = fingerprint(overridden), savedDist = fingerprint("dist");
  for (const args of [["--output-path", overridden], [`--output-path=${overridden}`]]) {
    const result = spawnSync("npm", ["run", "build", "--", "--output-clean", ...args], { encoding: "utf8" });
    assert.notEqual(result.status, 0, "An overlapping CLI output override must fail");
    assert.match(result.stderr, /does not accept --output-path/);
    assert.deepEqual(fingerprint(overridden), savedOutput, "Rejected override cannot clean the existing output");
    assert.deepEqual(fingerprint("dist"), savedDist, "Rejected override cannot alter either default entry");
  }
  fs.writeFileSync(path.join(directory, "current-app-hashes.json"), JSON.stringify(original, null, 2) + "\n");
  console.log("Repeated Pages builds emit only the current app; overlapping CLI overrides fail before cleaning.");
})().catch(error => { console.error(error); process.exitCode = 1; });
