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
  const legacy = require("../webpack.config");
  const baseline = path.join(directory, "legacy");
  const stats = await compile({ ...legacy, mode: "production",
    output: { ...legacy.output, path: baseline, clean: true }, performance: { hints: false } });
  assert(![...stats.compilation.modules].some(module => module.resource?.includes(`${path.sep}unified${path.sep}`)),
    "Legacy import graph excludes the preview");
  const original = fingerprint(baseline);
  // Exercise the exact Pages command twice, including stale sibling output.
  for (let round = 0; round < 2; round++) {
    fs.mkdirSync("dist/next", { recursive: true });
    fs.writeFileSync("dist/stale-root.txt", "old");
    fs.writeFileSync("dist/next/stale-preview.txt", "old");
    const log = execFileSync("npm", ["run", "build", "--", "--output-clean"], { encoding: "utf8" });
    fs.writeFileSync(path.join(directory, `build-${round}.log`), log);
    assert.deepEqual(fingerprint("dist", true), original, "Assembled root is byte-identical to the standalone legacy build");
    assert(fs.existsSync("dist/next/index.html"));
    assert.deepEqual(fs.readFileSync("dist/next/data/catalog.json"), fs.readFileSync("data/catalog.json"),
      "Preview ships the exact historical100k catalogue bytes");
    assert(!fs.existsSync("dist/next/stale-preview.txt"));
  }
  execFileSync("npm", ["run", "build:next", "--", "--output-clean"], { stdio: "pipe" });
  assert.deepEqual(fingerprint("dist", true), original, "Preview-only cleaning cannot delete or change the root");
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
  fs.writeFileSync(path.join(directory, "legacy-hashes.json"), JSON.stringify(original, null, 2) + "\n");
  console.log("Repeated Pages builds and preview-only rebuild preserve exact legacy output; overlapping CLI overrides fail before cleaning.");
})().catch(error => { console.error(error); process.exitCode = 1; });
