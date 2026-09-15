const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const http = require("node:http");
const tar = require("tar");
const { verifyBundle, hashFile, stageBundle, buildTrial } = require("../scripts/catalog.cjs");
const { acquireArchive } = require("../scripts/catalog-archive.cjs");
const cases = require("./fixtures/consumer-v1/cases.json");
const root = path.resolve(__dirname, "..");
const fixtures = path.join(__dirname, "fixtures/consumer-v1");

async function temporary(t) {
  await fs.mkdir(path.join(root, ".context"), { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, ".context/delivery-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

// Keep every integrity check valid so a checksum error cannot mask a missing
// semantic check. Mutate private copies only; original producer fixtures stay pinned.
async function repin(source, change) {
  const indexPath = path.join(source, "index.json"), manifestPath = path.join(source, "full/manifest.json");
  const index = JSON.parse(await fs.readFile(indexPath, "utf8"));
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  change(manifest, index);
  await fs.writeFile(manifestPath, JSON.stringify(manifest) + "\n");
  Object.assign(index.provenance.manifest, await hashFile(manifestPath));
  const full = path.join(source, "full"), sums = [];
  for (const name of (await fs.readdir(full)).filter(name => name !== "SHA256SUMS").sort()) {
    sums.push((await hashFile(path.join(full, name))).sha256 + "  " + name + "\n");
  }
  await fs.writeFile(path.join(full, "SHA256SUMS"), sums.join(""));
  await fs.writeFile(indexPath, JSON.stringify(index) + "\n");
  return { url: "index.json", ...await hashFile(indexPath) };
}

const reordered = value => Object.fromEntries(Object.entries(value).reverse());

test("manifest verification rejects checksum-valid semantic contradictions", async t => {
  const directory = await temporary(t);
  const mutations = [
    ["export tool differs from its identity", m => { m.tool_version = "999.0.0"; }, /Manifest export identity/],
    ["identity tool differs from export", m => { m.identity.tool_version = "999.0.0"; }, /Manifest export identity/],
    ["identity snapshot", m => { m.identity.snapshot_version = "snapshot-v1-" + "0".repeat(64); }, /Manifest export identity/],
    ["identity schema", m => { m.identity.schema_version = 2; }, /Manifest export identity/],
    ...["profile", "limit", "select", "sort"].map(key => ["identity selection " + key,
      m => { m.identity.selection[key] = key === "limit" ? 1 : "different"; }, /Manifest export identity/]),
    ["missing identity", m => { delete m.identity; }, /Manifest/],
    ["null identity", m => { m.identity = null; }, /Manifest export identity/],
    ["missing identity field", m => { delete m.identity.tool_version; }, /Manifest export identity/],
    ["extra identity field", m => { m.identity.extra = true; }, /Manifest export identity/],
    ["extra identity selection field", m => { m.identity.selection.extra = true; }, /Manifest export identity/],
    ["missing original tool", m => { delete m.tool_version; }, /Manifest/],
    ...[null, 123, "", " \t"].map(value => ["invalid original tool " + JSON.stringify(value),
      m => { m.tool_version = m.identity.tool_version = value; }, /Manifest export tool/]),
    ["index catalog ID", (m, i) => { i.catalog_id = "export-v1-" + "0".repeat(64); }, /Manifest catalog identity/],
    ["coordinated false catalog ID", (m, i) => { m.data_version = i.catalog_id = "export-v1-" + "0".repeat(64); }, /Manifest export identity/],
    ["coordinated changed export tool retains stale ID", m => { m.tool_version = m.identity.tool_version = "999.0.0"; }, /Manifest export identity/],
    ...["selection", "counts", "exclusions", "sources", "snapshot_version", "schema_version"].map(key => [
      "common field " + key, m => { m[key] = null; }, new RegExp("Manifest differs from index: " + key)]),
    ["extra manifest field", m => { m.extra = true; }, /Manifest fields/],
    ["extra artifact", m => { m.artifacts.extra = m.artifacts["NOTICE.txt"]; }, /Manifest artifact/],
    ...["master.jsonl.gz", "catalog.json", "catalog.json.gz"].flatMap(name => [
      [name + " profile", m => { m.artifacts[name].profile = "wrong"; }, /Manifest artifact/],
      [name + " records", m => { m.artifacts[name].records++; }, /Manifest artifact/],
      [name + " missing records", m => { delete m.artifacts[name].records; }, /Manifest artifact/],
    ]),
    ["extra notice metadata", m => { m.artifacts["NOTICE.txt"].records = 0; }, /Manifest artifact/],
    ["artifact hash", m => { m.artifacts["catalog.json"].sha256 = "0".repeat(64); }, /Manifest artifact/],
    ["artifact bytes", m => { m.artifacts["catalog.json"].bytes++; }, /Manifest artifact/],
    ...[null, "2026-02-29T00:00:00Z", "2026-01-01T24:00:00Z", "0000-01-01T00:00:00Z", "2026-01-01"].map(value => [
      "creation time " + JSON.stringify(value), m => { m.created_at = value; }, /Manifest creation time/]),
    ["missing compression", m => { delete m.compression; }, /Manifest/],
    ["extra compression profile", m => { m.compression.extra = m.compression.master; }, /Manifest compression/],
    ...["master", "catalog"].flatMap(name => [
      ...["format", "level", "mtime", "zlib"].map(key => [name + " compression " + key,
        m => { m.compression[name][key] = "wrong"; }, /Manifest compression/]),
      [name + " extra compression field", m => { m.compression[name].extra = true; }, /Manifest compression/],
    ]),
  ];
  for (const [number, [name, change, error]] of mutations.entries()) await t.test(name, async () => {
    const source = path.join(directory, String(number));
    await fs.cp(path.join(fixtures, "ties"), source, { recursive: true });
    const pin = await repin(source, change);
    await assert.rejects(verifyBundle(source, pin), error);
  });
});

test("original exports remain valid across indexing versions and JSON key order", async t => {
  const directory = await temporary(t);
  for (const name of ["ties", "empty"]) {
    const source = path.join(directory, name);
    await verifyBundle(path.join(fixtures, name), cases.bundles[name].pin);
    await fs.cp(path.join(fixtures, name), source, { recursive: true });
    const pin = await repin(source, (manifest, index) => {
      index.producer.tool_version = "999.0.0";
      manifest.identity = reordered(manifest.identity);
      manifest.identity.selection = reordered(manifest.identity.selection);
      manifest.selection = reordered(manifest.selection);
    });
    const { info } = await verifyBundle(source, pin);
    assert.equal(info.producer.tool_version, "999.0.0");
    const staged = await stageBundle(source, pin, path.join(directory, "cache"));
    await verifyBundle(staged, pin);
  }
});

test("export identity hashes match the producer's ordered ASCII JSON", async t => {
  const directory = await temporary(t), source = path.join(directory, "source");
  await fs.cp(path.join(fixtures, "ties"), source, { recursive: true });
  // Produced independently by OrreryData22a9e6d identity_digest('export', ...).
  // Its original-export version permits any nonempty string, including DEL,
  // BMP and astral characters; the indexing tool has a separate version field.
  const pin = await repin(source, (manifest, index) => {
    manifest.tool_version = manifest.identity.tool_version = "old-\u007f-研究-🚀";
    manifest.selection.limit = manifest.identity.selection.limit = index.selection.limit = Number.MAX_SAFE_INTEGER;
    manifest.data_version = index.catalog_id = "export-v1-15bbd57c96393b79ecbcf3b86971e8dfa456b6eb8d3e2796cbbef66d8d877ebf";
    manifest.identity = reordered(manifest.identity);
    manifest.identity.selection = reordered(manifest.identity.selection);
    index.selection = reordered(index.selection);
    manifest.created_at = "2024-02-29T23:59:59Z";
  });
  await verifyBundle(source, pin);
});

test("contradictory provenance cannot reach builds, packed archives or downloaded caches", async t => {
  const directory = await temporary(t), source = path.join(directory, "source"), output = path.join(directory, "site");
  await fs.cp(path.join(fixtures, "ties"), source, { recursive: true });
  const pin = await repin(source, manifest => { manifest.tool_version = "999.0.0"; });
  const sourceHash = await hashFile(path.join(source, "full/manifest.json"));
  const error = /Manifest export identity/;
  const cache = path.join(directory, "cache"), destination = path.join(cache, "delivery-v1-" + pin.sha256);
  await assert.rejects(stageBundle(source, pin, cache), error);
  await assert.rejects(fs.stat(destination), { code: "ENOENT" });
  await fs.mkdir(output);
  await fs.writeFile(path.join(output, "previous.txt"), "Previous site");
  const config = path.join(directory, "profile.json");
  for (const mode of ["indexed", "whole"]) for (const retained of [false, true]) {
    await fs.writeFile(config, JSON.stringify(retained
      ? { mode, bundle: path.join(fixtures, "empty"), pin: cases.bundles.empty.pin, retained: [{ bundle: source, pin }] }
      : { mode, bundle: source, pin }));
    await assert.rejects(buildTrial(config, output), error);
    assert.deepEqual(await fs.readdir(output), ["previous.txt"]);
    assert.equal(await fs.readFile(path.join(output, "previous.txt"), "utf8"), "Previous site");
    await assert.rejects(fs.stat(output + ".build-lock"), { code: "ENOENT" });
    await assert.rejects(fs.stat(path.join(root, ".context/catalog-cache", path.basename(destination))), { code: "ENOENT" });
  }
  const filename = path.join(directory, "packed.tar.gz");
  await fs.writeFile(config, JSON.stringify({ bundle: source, pin }));
  const packed = spawnSync(process.execPath, ["scripts/catalog.cjs", "pack", config, filename], { cwd: root, encoding: "utf8" });
  assert.notEqual(packed.status, 0, packed.stdout + packed.stderr);
  assert.match(packed.stderr, error);
  await assert.rejects(fs.stat(filename), { code: "ENOENT" });
  // Bypass the packer's guard to represent an externally supplied, pinned archive.
  const names = (await verifyBundle(path.join(fixtures, "ties"), cases.bundles.ties.pin)).names;
  await tar.c({ file: filename, cwd: source, gzip: true, portable: true }, names);
  const body = await fs.readFile(filename);
  const server = http.createServer((req, res) => res.end(body));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const archive = { url: `http://127.0.0.1:${server.address().port}/bundle.tar.gz`, ...await hashFile(filename) };
  for (const warm of [false, true]) {
    if (warm) await fs.cp(source, destination, { recursive: true });
    await assert.rejects(acquireArchive(archive, pin, cache), error);
    if (warm) assert.deepEqual(await hashFile(path.join(destination, "full/manifest.json")), sourceHash);
    else await assert.rejects(fs.stat(destination), { code: "ENOENT" });
    assert(!(await fs.readdir(directory)).some(name => name.startsWith(".catalog-acquire-")));
  }
  assert.deepEqual(await hashFile(path.join(source, "full/manifest.json")), sourceHash);
});
