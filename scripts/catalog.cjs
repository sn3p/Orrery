// Complete pinned-bundle provisioning. Never resolves a mutable "latest" release.
const fs = require("node:fs/promises");
const { createReadStream } = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { createGunzip } = require("node:zlib");
const { isDeepStrictEqual } = require("node:util");
const root = path.resolve(__dirname, "..");
const cache = path.join(root, ".context/catalog-cache");
const overlaps = (a, b) => a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);

// Outputs and generated caches may not exist yet. Resolve their existing
// ancestors as well as complete input paths so aliases cannot hide overlap.
async function canonicalPath(filename) {
  filename = path.resolve(filename);
  try { return await fs.realpath(filename); }
  catch (error) {
    const parent = path.dirname(filename);
    if (error.code !== "ENOENT" || parent === filename) throw error;
    return path.join(await canonicalPath(parent), path.basename(filename));
  }
}

async function lockInstallation(directory) {
  const deadline = Date.now() + 300_000;
  while (true) {
    try { await fs.mkdir(directory); return; }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      // A crashed publisher may leave recovery data here. Never steal its lock
      // or delete the previous bundle; report its location after a bounded wait.
      if (Date.now() >= deadline) throw new Error("Catalogue installation is locked: " + directory);
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
}

async function hashFile(filename, decompress = false) {
  const input = createReadStream(filename), stream = decompress ? input.pipe(createGunzip()) : input;
  if (decompress) input.on("error", error => stream.destroy(error));
  const digest = createHash("sha256");
  let bytes = 0;
  for await (const chunk of stream) { digest.update(chunk); bytes += chunk.length; }
  return { bytes, sha256: digest.digest("hex") };
}

async function verifyBundle(directory, pin) {
  const { parseJSON, validateIndex, verifyBytes, MAX_INDEX_BYTES, validateReference } = await import("../src/unified/catalog/contract.js");
  validateReference(pin, "index.json");
  if (pin.bytes < 1 || pin.bytes > MAX_INDEX_BYTES) throw new Error("Invalid index size.");
  const regular = async file => {
    if (!(await fs.lstat(file)).isFile()) throw new Error("Expected regular file: " + file);
  };
  if (!(await fs.lstat(directory)).isDirectory()) throw new Error("Expected real bundle directory.");
  await regular(path.join(directory, "index.json"));
  if ((await fs.stat(path.join(directory, "index.json"))).size !== pin.bytes) throw new Error("Index length mismatch.");
  const bytes = await fs.readFile(path.join(directory, "index.json"));
  await verifyBytes(bytes, pin);
  const info = validateIndex(parseJSON(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  const descriptors = [info.full, ...info.chunks];
  const references = [...Object.values(info.provenance), ...descriptors.flatMap(file => [file, file.gzip])];
  const names = ["index.json", "full/SHA256SUMS", ...references.map(file => file.url)].sort();
  const actual = [];
  for (const name of await fs.readdir(directory)) {
    const file = path.join(directory, name);
    if (name === "full" || name === "chunks") {
      if (!(await fs.lstat(file)).isDirectory()) throw new Error("Expected real directory: " + name);
      for (const child of await fs.readdir(file)) actual.push(name + "/" + child);
    } else actual.push(name);
  }
  if (!isDeepStrictEqual(actual.sort(), names)) throw new Error("Bundle inventory mismatch.");
  for (const name of names) await regular(path.join(directory, name));
  for (const ref of references) {
    const actual = await hashFile(path.join(directory, ref.url));
    if (actual.bytes !== ref.bytes || actual.sha256 !== ref.sha256) throw new Error("Artifact checksum mismatch: " + ref.url);
  }
  for (const ref of descriptors) {
    const decoded = await hashFile(path.join(directory, ref.gzip.url), true);
    if (decoded.bytes !== ref.bytes || decoded.sha256 !== ref.sha256) throw new Error("Gzip content mismatch: " + ref.url);
  }
  const manifest = parseJSON(await fs.readFile(path.join(directory, info.provenance.manifest.url), "utf8"));
  const fields = (value, expected, label) => {
    if (!value || typeof value !== "object" || Array.isArray(value)
      || !isDeepStrictEqual(Object.keys(value).sort(), expected.sort())) throw new Error("Manifest " + label + " fields mismatch.");
  };
  fields(manifest, ["data_version", "identity", "snapshot_version", "schema_version", "tool_version", "created_at",
    "selection", "sources", "counts", "exclusions", "compression", "artifacts"], "fields");
  for (const key of ["selection", "counts", "exclusions", "sources", "snapshot_version", "schema_version"]) {
    if (!isDeepStrictEqual(manifest[key], info[key])) throw new Error("Manifest differs from index: " + key);
  }
  if (manifest.data_version !== info.catalog_id) throw new Error("Manifest catalog identity mismatch.");
  if (typeof manifest.tool_version !== "string" || !manifest.tool_version.trim()) throw new Error("Manifest export tool version is invalid.");
  // The index identifies the indexing tool, which may be newer than the
  // original exporter. Bind the export's own version to its complete identity.
  // Schema-defined key order and ASCII JSON match OrreryData identity_digest.
  const selection = Object.fromEntries(["profile", "limit", "select", "sort"].map(key => [key, info.selection[key]]));
  const identity = { snapshot_version: info.snapshot_version, tool_version: manifest.tool_version,
    schema_version: info.schema_version, selection };
  const encodedIdentity = JSON.stringify(identity).replace(/[\u007f-\uffff]/g,
    character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
  if (!isDeepStrictEqual(manifest.identity, identity)
    || manifest.data_version !== "export-v1-" + createHash("sha256").update(encodedIdentity).digest("hex")) {
    throw new Error("Manifest export identity mismatch.");
  }
  const created = manifest.created_at;
  if (typeof created !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(created)
    || created.startsWith("0000") || !Number.isFinite(Date.parse(created))
    || new Date(created).toISOString() !== created.replace("Z", ".000Z")) throw new Error("Manifest creation time is invalid.");
  fields(manifest.compression, ["master", "catalog"], "compression");
  for (const compression of Object.values(manifest.compression)) {
    fields(compression, ["format", "level", "mtime", "zlib"], "compression");
    if (compression.format !== "gzip" || compression.level !== 6 || compression.mtime !== 0
      || typeof compression.zlib !== "string" || !/^[0-9]+(?:\.[0-9]+)+[a-zA-Z0-9.+-]*$/.test(compression.zlib)) {
      throw new Error("Manifest compression metadata is invalid.");
    }
  }
  const fullRefs = references.filter(ref => ref.url.startsWith("full/"));
  const artifacts = fullRefs.filter(ref => ref.url !== "full/manifest.json");
  fields(manifest.artifacts, artifacts.map(ref => path.basename(ref.url)), "artifact");
  for (const ref of artifacts) {
    const name = path.basename(ref.url), expected = { bytes: ref.bytes, sha256: ref.sha256 };
    if (name === "master.jsonl.gz") Object.assign(expected, { profile: "master", records: info.counts.master_records });
    else if (["catalog.json", "catalog.json.gz"].includes(name)) {
      Object.assign(expected, { profile: "discovery", records: info.counts.discovery_export });
    }
    if (!isDeepStrictEqual(manifest.artifacts[name], expected)) throw new Error("Manifest artifact mismatch: " + ref.url);
  }
  // The producer uses Python/ASCII lexical sorting, independent of locale.
  const expected = fullRefs.map(ref => path.basename(ref.url)).sort()
    .map(name => fullRefs.find(ref => path.basename(ref.url) === name).sha256 + "  " + name + "\n").join("");
  if (await fs.readFile(path.join(directory, "full/SHA256SUMS"), "utf8") !== expected) throw new Error("SHA256SUMS mismatch.");
  return { info, names };
}

async function stageBundle(source, pin, destinationRoot = cache) {
  return (await stageVerifiedBundle(source, pin, destinationRoot, await verifyBundle(source, pin))).directory;
}

async function stageVerifiedBundle(source, pin, destinationRoot, verified) {
  source = path.resolve(source);
  destinationRoot = path.resolve(destinationRoot);
  if (overlaps(source, destinationRoot)) throw new Error("Source and staging directories must be disjoint.");
  source = await fs.realpath(source);
  destinationRoot = await canonicalPath(destinationRoot);
  if (overlaps(source, destinationRoot)) throw new Error("Source and staging directories must be disjoint.");
  const { names } = verified;
  await fs.mkdir(destinationRoot, { recursive: true });
  const destination = path.join(destinationRoot, "delivery-v1-" + pin.sha256);
  try { return { directory: destination, verified: await verifyBundle(destination, pin) }; }
  catch { /* A missing, incomplete or corrupt generated cache is replaceable. */ }
  const temp = await fs.mkdtemp(path.join(destinationRoot, ".staging-"));
  try {
    for (const name of names) {
      await fs.mkdir(path.dirname(path.join(temp, name)), { recursive: true });
      await fs.copyFile(path.join(source, name), path.join(temp, name));
    }
    verified = await verifyBundle(temp, pin);
    // Different output builds share this cache. Serialize only publication,
    // then recheck: another verified copy may have won while this one staged.
    const lock = path.join(destinationRoot, ".install-" + pin.sha256);
    await lockInstallation(lock);
    const previous = path.join(lock, "previous");
    let preserveRecovery = false;
    try {
      try { return { directory: destination, verified: await verifyBundle(destination, pin) }; }
      catch { /* Only an absent or invalid destination may be replaced. */ }
      let hadPrevious = false;
      try { await fs.rename(destination, previous); hadPrevious = true; }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      try { await fs.rename(temp, destination); }
      catch (error) {
        if (hadPrevious) {
          try { await fs.rename(previous, destination); }
          catch (restoreError) {
            preserveRecovery = true;
            throw new Error("Restore previous catalogue from " + previous, { cause: restoreError });
          }
        }
        throw error;
      }
    } finally { if (!preserveRecovery) await fs.rm(lock, { force: true, recursive: true }); }
  } finally { await fs.rm(temp, { force: true, recursive: true }); }
  return { directory: destination, verified };
}

async function prepareCatalog(configPath, { publicDefaults = false } = {}) {
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  if (!["indexed", "whole"].includes(config.mode)) throw new Error("Choose indexed or whole mode.");
  const { validDate } = await import("../src/js/asteroidOrbits.js");
  if (config.startJed !== undefined && !validDate(config.startJed)) throw new Error("Invalid catalogue startJed.");
  if (config.speed !== undefined && !Number.isFinite(config.speed)) throw new Error("Invalid catalogue speed.");
  const playback = {};
  if (config.startJed !== undefined || !publicDefaults) playback.startJed = config.startJed ?? 2444270.5;
  if (config.speed !== undefined || !publicDefaults) playback.speed = config.speed ?? 1.5;
  if (Object.hasOwn(config, "latest")) {
    if (config.mode !== "indexed" || Object.keys(config).some(key => !["mode", "latest", "startJed", "speed"].includes(key))) {
      throw new Error("Latest catalogue selection accepts indexed mode, latest URL and optional date/speed only.");
    }
    const { validateLatestURL } = await import("../src/unified/catalog/contract.js");
    const runtime = { mode: "indexed", latest: validateLatestURL(config.latest).href, ...playback };
    return { staged: [], runtime };
  }
  if (config.retained !== undefined && !Array.isArray(config.retained)) throw new Error("retained must be an array of pinned bundles.");
  const inputs = [config, ...(config.retained || [])];
  const staged = [];
  for (const input of inputs) {
    if (!input || (typeof input.bundle === "string") === !!input.archive) {
      throw new Error("Choose exactly one local bundle or pinned archive.");
    }
    const source = input.bundle !== undefined
      ? path.resolve(path.dirname(configPath), input.bundle)
      : await require("./catalog-archive.cjs").acquireArchive(input.archive, input.pin);
    const item = await stageVerifiedBundle(source, input.pin, cache, await verifyBundle(source, input.pin));
    if (!staged.some(other => other.pin.sha256 === input.pin.sha256)) staged.push({ ...item, pin: input.pin });
  }
  const runtime = { pin: { ...config.pin, url: "data/" + path.basename(staged[0].directory) + "/index.json" }, mode: config.mode, ...playback };
  return { staged, runtime };
}

function catalogPlugins(base, runtime) {
  const webpack = require("webpack");
  return base.plugins.map(plugin => plugin instanceof webpack.DefinePlugin
    && Object.hasOwn(plugin.definitions, "__CATALOG_SELECTION__")
    ? new webpack.DefinePlugin({ ...plugin.definitions, __CATALOG_SELECTION__: JSON.stringify(runtime) }) : plugin);
}

async function stageCatalog(prepared, output) {
  for (const item of prepared.staged) {
    await stageVerifiedBundle(item.directory, item.pin, path.join(output, "data"), item.verified);
  }
}

async function checkOutput(configPath, output, assembled = false) {
  if (!(assembled && output === path.join(root, "dist")) && output !== path.join(root, "dist/next") && !output.startsWith(path.join(root, ".context") + path.sep)) {
    throw new Error("Trial output must be dist/next or a generated directory inside .context.");
  }
  const config = JSON.parse(await fs.readFile(configPath, "utf8"));
  const canonicalOutput = await canonicalPath(output);
  const sources = [config, ...(Array.isArray(config.retained) ? config.retained : [])]
    .filter(input => typeof input?.bundle === "string").map(input => path.resolve(path.dirname(configPath), input.bundle));
  for (const protectedPath of [...sources, cache, path.join(root, ".context/catalog-downloads"), path.resolve(configPath)]) {
    if (overlaps(output, protectedPath) || overlaps(canonicalOutput, await canonicalPath(protectedPath))) {
      throw new Error("Trial output overlaps an input, config or cache.");
    }
  }
  for (let directory = output; directory !== root; directory = path.dirname(directory)) {
    try { if ((await fs.lstat(directory)).isSymbolicLink()) throw new Error("Trial output must not traverse symlinks."); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
}

async function buildTrial(configPath, output = path.join(root, ".context/catalog-site"),
  { entry = "./src/unified/index.js", publicDefaults = false, assembled = false } = {}) {
  output = path.resolve(output);
  await checkOutput(configPath, output, assembled);
  await fs.mkdir(path.dirname(output), { recursive: true });
  // A competing build must not replace this output. An interrupted lock retains
  // its private stage/previous output for inspection rather than deleting it.
  const lock = (output === path.join(root, "dist/next") ? path.join(root, "dist") : output) + ".build-lock";
  try { await fs.mkdir(lock); }
  catch (error) { if (error.code === "EEXIST") throw new Error("Catalogue output is locked: " + lock); throw error; }
  const temporary = path.join(lock, "site"), previous = path.join(lock, "previous");
  let preserveRecovery = false;
  try {
    const prepared = await prepareCatalog(configPath, { publicDefaults });
    const webpack = require("webpack"), base = require("../webpack.next.config.js");
    const previewOutput = temporary;
    await new Promise((resolve, reject) => {
      const compiler = webpack({ ...base, mode: "production", name: "app",
        plugins: catalogPlugins(base, prepared.runtime), entry,
        output: { ...base.output, path: previewOutput, clean: true } });
      compiler.run((error, stats) => compiler.close(() => {
        if (error || stats.hasErrors()) reject(error || new Error(stats.toString("errors-only")));
        else resolve();
      }));
    });
    await stageCatalog(prepared, previewOutput);
    let siteBytes = 0;
    for (const name of await fs.readdir(temporary, { recursive: true, withFileTypes: true })) {
      if (name.isFile()) siteBytes += (await fs.stat(path.join(name.parentPath, name.name))).size;
    }
    if (siteBytes > 900_000_000) throw new Error("Catalogue site exceeds its 900 MB Pages preparation budget.");
    let hadPrevious = false;
    try { await fs.rename(output, previous); hadPrevious = true; }
    catch (error) { if (error.code !== "ENOENT") throw error; }
    try { await fs.rename(temporary, output); }
    catch (error) {
      if (hadPrevious) {
        try { await fs.rename(previous, output); }
        catch (restoreError) { preserveRecovery = true; throw new Error("Restore previous output from " + previous, { cause: restoreError }); }
      }
      throw error;
    }
    return { output, bundle: prepared.runtime?.pin ? path.join(output, "data", path.basename(prepared.staged[0].directory)) : null,
      runtime: prepared.runtime, siteBytes, retained: prepared.staged.slice(prepared.runtime?.pin ? 1 : 0).map(item => item.pin.sha256) };
  } finally { if (!preserveRecovery) await fs.rm(lock, { force: true, recursive: true }); }
}

module.exports = { verifyBundle, stageBundle, buildTrial, hashFile, prepareCatalog, catalogPlugins, stageCatalog, checkOutput };
if (require.main === module) {
  const [command, config, output] = process.argv.slice(2);
  if (command === "pack" && config && output) {
    (async () => {
      const settings = JSON.parse(await fs.readFile(config, "utf8"));
      if (typeof settings.bundle !== "string") throw new Error("Packing requires a local complete bundle.");
      const filename = path.resolve(output), bundle = path.resolve(path.dirname(config), settings.bundle);
      if (!filename.startsWith(path.join(root, ".context") + path.sep) || !filename.endsWith(".tar.gz")) {
        throw new Error("Archive output must be a .tar.gz file inside .context.");
      }
      const [canonicalFilename, canonicalBundle, canonicalContext] = await Promise.all([
        canonicalPath(filename), fs.realpath(bundle), canonicalPath(path.join(root, ".context")),
      ]);
      if (!canonicalFilename.startsWith(canonicalContext + path.sep)) {
        throw new Error("Archive output must be a .tar.gz file inside .context.");
      }
      if (overlaps(filename, bundle) || overlaps(canonicalFilename, canonicalBundle)) {
        throw new Error("Archive output must be outside the source bundle.");
      }
      try { await fs.lstat(filename); throw new Error("Archive output already exists."); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      await fs.mkdir(path.dirname(filename), { recursive: true });
      const archive = await require("./catalog-archive.cjs").packBundle(bundle, settings.pin, filename);
      console.log(JSON.stringify({ filename, archive, pin: settings.pin }, null, 2));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  } else if (command !== "build" || !config) {
    console.error("Usage: node scripts/catalog.cjs build CONFIG.json [OUTPUT_DIRECTORY] | pack CONFIG.json OUTPUT.tar.gz");
    process.exitCode = 1;
  } else buildTrial(path.resolve(config), output).then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
