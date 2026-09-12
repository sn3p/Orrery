const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");

const manifestName = "benchmark-source.json";
const hash = value => crypto.createHash("sha256").update(value).digest("hex");

async function checkoutSource(cwd = process.cwd()) {
  // Stream generated-asset diffs, which can exceed execFile's output limit.
  const diffSHA256 = await new Promise((resolve, reject) => {
    const digest = crypto.createHash("sha256");
    const diff = spawn("git", ["diff", "--binary", "HEAD"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let error = "";
    diff.stdout.on("data", chunk => digest.update(chunk));
    diff.stderr.on("data", chunk => { error += chunk; });
    diff.on("error", reject);
    diff.on("close", code => code === 0 ? resolve(digest.digest("hex")) : reject(new Error(error || `git diff exited ${code}`)));
  });
  return {
    revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim(),
    sourceDirty: execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim() !== "",
    diffSHA256,
  };
}

function fingerprints(directory) {
  const files = [];
  function visit(relative = "") {
    for (const entry of fs.readdirSync(path.join(directory, relative), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      // The source stamp describes the build; including it would hash itself.
      if (name === manifestName) continue;
      if (entry.isDirectory()) visit(name);
      else if (entry.isFile()) files.push([name, hash(fs.readFileSync(path.join(directory, name)))]);
      else throw new Error(`Benchmark build contains an unsupported file: ${name}`);
    }
  }
  visit();
  return {
    // Include paths as well as bytes so additions, removals and renamed assets
    // invalidate attribution, including HTML/CSS and auxiliary scripts.
    buildSHA256: hash(JSON.stringify(files)),
    bundleSHA256: hash(fs.readFileSync(path.join(directory, "bundle.js"))),
    catalogSHA256: hash(fs.readFileSync(path.join(directory, "data/catalog.json"))),
  };
}

function recordSource(directory, source) {
  fs.writeFileSync(path.join(directory, manifestName), JSON.stringify({
    ...source, ...fingerprints(directory),
  }, null, 2) + "\n");
}

function bundleSource(directory) {
  const actual = fingerprints(directory);
  let recorded;
  try { recorded = JSON.parse(fs.readFileSync(path.join(directory, manifestName), "utf8")); } catch { /* Source may be unknown for external bundles. */ }
  const verified = recorded && /^[a-f0-9]{40}$/.test(recorded.revision)
    && typeof recorded.sourceDirty === "boolean"
    && Object.keys(actual).every(key => recorded[key] === actual[key]);
  return { ...actual, revision: verified ? recorded.revision : null,
    sourceDirty: verified ? recorded.sourceDirty : null,
    provenance: verified ? "recorded-build" : "unknown-source" };
}

module.exports = { checkoutSource, fingerprints, recordSource, bundleSource };
