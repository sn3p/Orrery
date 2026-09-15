const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const { stripVTControlCharacters } = require("node:util");
const tar = require("tar");
const { gzipSync } = require("node:zlib");
const { acquireArchive, packBundle } = require("../scripts/catalog-archive.cjs");
const { verifyBundle, hashFile, buildTrial, prepareCatalog } = require("../scripts/catalog.cjs");
const cases = require("./fixtures/consumer-v1/cases.json");
const root = path.resolve(__dirname, "..");
const fixtures = path.join(__dirname, "fixtures/consumer-v1");
const pin = cases.bundles.ties.pin;

async function temporary(t) {
  await fs.mkdir(path.join(root, ".context"), { recursive: true });
  const directory = await fs.mkdtemp(path.join(root, ".context/delivery-test-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function host(t, filename) {
  let body = await fs.readFile(filename), status = 200, requests = 0, interrupted = false, compressed = false;
  const server = http.createServer((req, res) => {
    requests++;
    res.writeHead(status, compressed ? { "Content-Encoding": "gzip" } : {});
    if (interrupted) { res.write(body.subarray(0, 20)); res.destroy(); }
    else res.end(compressed ? gzipSync(body) : body);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { url: `http://127.0.0.1:${server.address().port}/bundle.tar.gz`,
    get requests() { return requests; }, body(value) { body = value; }, status(value) { status = value; },
    interrupt(value) { interrupted = value; }, compress(value) { compressed = value; } };
}

async function command(args, env = {}) {
  const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, CATALOG_CONFIG: "", ...env } });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { output += chunk; });
  const [code] = await once(child, "exit");
  return { code, output };
}
// npm is normally supplied by npm test. Direct node --test uses the sibling CLI.
function npmArgs(args) {
  const cli = process.env.npm_execpath || path.resolve(path.dirname(process.execPath), "../lib/node_modules/npm/bin/npm-cli.js");
  return [cli, ...args];
}

test("pinned HTTP archive acquisition: complete cold/warm/repair, transfer errors and independent index trust", async t => {
  const directory = await temporary(t), filename = path.join(directory, "bundle.tar.gz");
  const digest = await packBundle(path.join(fixtures, "ties"), pin, filename);
  const server = await host(t, filename), archive = { ...digest, url: server.url };
  const cache = path.join(directory, "cache");
  const acquired = await acquireArchive(archive, pin, cache);
  await verifyBundle(acquired, pin);
  assert.equal(server.requests, 1);
  server.status(404);
  assert.equal(await acquireArchive(archive, pin, cache), acquired, "Warm verified cache works offline");
  assert.equal(server.requests, 1);
  await fs.rm(path.join(acquired, "chunks/000001.json"));
  await assert.rejects(acquireArchive(archive, pin, cache), /404/);
  assert(await fs.stat(path.join(acquired, "index.json")), "Failed repair preserves the existing cache");
  server.status(200); server.compress(true);
  await acquireArchive(archive, pin, cache); await verifyBundle(acquired, pin);
  assert.equal(server.requests, 3);
  for (const [name, reference, indexPin] of [
    ["hash", { ...archive, sha256: "0".repeat(64) }, pin],
    ["oversize", { ...archive, bytes: archive.bytes - 1 }, pin],
    ["short", { ...archive, bytes: archive.bytes + 1 }, pin],
    ["index", archive, { ...pin, sha256: "0".repeat(64) }],
  ]) await assert.rejects(acquireArchive(reference, indexPin, path.join(directory, name)));
  server.interrupt(true);
  await assert.rejects(acquireArchive(archive, pin, path.join(directory, "interrupted")));
  await verifyBundle(acquired, pin);
  assert(!(await fs.readdir(directory)).some(name => name.startsWith(".catalog-acquire-")));
});

test("a checksum-valid archive still rejects links, duplicate entries and incomplete producer inventory", async t => {
  const directory = await temporary(t), filename = path.join(directory, "invalid.tar.gz");
  const source = path.join(directory, "source");
  await fs.cp(path.join(fixtures, "ties"), source, { recursive: true });
  await fs.symlink("index.json", path.join(source, "link"));
  for (const entries of [["index.json", "link"], ["index.json", "index.json"], ["index.json"]]) {
    await tar.c({ file: filename, cwd: source, gzip: true, portable: true }, entries);
    const server = await host(t, filename);
    await assert.rejects(acquireArchive({ ...await hashFile(filename), url: server.url }, pin, path.join(directory, "cache")));
  }
});

test("archive redirects validate every destination, support relative chains and stop loops", async t => {
  const directory = await temporary(t), filename = path.join(directory, "bundle.tar.gz");
  const digest = await packBundle(path.join(fixtures, "ties"), pin, filename);
  const body = await fs.readFile(filename), requests = [];
  let location;
  const statuses = [301, 302, 303, 307, 308];
  const server = http.createServer((req, res) => {
    requests.push(req.url);
    const step = /^\/chain\/(\d+)$/.exec(req.url);
    if (step && Number(step[1]) < statuses.length) {
      res.writeHead(statuses[Number(step[1])], { Location: String(Number(step[1]) + 1) });
    } else if (req.url === "/redirect") {
      res.writeHead(302, location === undefined ? {} : { Location: location });
    } else { res.end(body); return; }
    res.end("redirect body must not be used as the archive");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const archive = { ...digest, url: origin + "/redirect" };
  for (const [name, target] of [
    ["http", `http://0.0.0.0:${server.address().port}/forbidden`],
    ["credentials", origin.replace("//", "//user:password@") + "/forbidden"],
    ["fragment", origin + "/forbidden#fragment"],
    ["protocol", "file:///forbidden"],
  ]) {
    location = target; requests.length = 0;
    await assert.rejects(acquireArchive(archive, pin, path.join(directory, name)), /Use an HTTPS archive URL/);
    assert.deepEqual(requests, ["/redirect"], "Reject the destination before making its request");
  }
  requests.length = 0;
  const cache = path.join(directory, "valid");
  const acquired = await acquireArchive({ ...digest, url: origin + "/chain/0" }, pin, cache);
  await verifyBundle(acquired, pin);
  assert.deepEqual(requests, Array.from({ length: 6 }, (_, i) => "/chain/" + i));
  // Failed repair through redirects must preserve the previous cache contents.
  const chunk = path.join(acquired, "chunks/000001.json");
  await fs.writeFile(chunk, "damaged cache retained for inspection");
  for (const [target, expected, count] of [
    ["/redirect", /Too many catalogue archive redirects/, 6],
    [undefined, /Catalogue archive redirect has no Location/, 1],
    ["http://[invalid", /Invalid URL/, 1],
  ]) {
    location = target; requests.length = 0;
    await assert.rejects(acquireArchive(archive, pin, cache), expected);
    assert.equal(requests.length, count);
    assert.equal(await fs.readFile(chunk, "utf8"), "damaged cache retained for inspection");
  }
  assert(!(await fs.readdir(directory)).some(name => name.startsWith(".catalog-acquire-")));
});

test("private assembly preserves prior output on compile/final-copy failure and rejects concurrent replacement", async t => {
  const directory = await temporary(t), config = path.join(directory, "config.json"), output = path.join(directory, "site");
  await fs.writeFile(config, JSON.stringify({ bundle: path.join(fixtures, "ties"), pin, mode: "indexed" }));
  const entry = path.join(directory, "entry.js");
  await fs.writeFile(entry, "globalThis.selection = __CATALOG_SELECTION__;");
  const built = await buildTrial(config, output, { entry, publicDefaults: true });
  assert(!Object.hasOwn(built.runtime, "startJed")); assert(!Object.hasOwn(built.runtime, "speed"));
  const before = await hashFile(path.join(output, "index.html"));
  await fs.writeFile(entry, "import './missing-module.js';");
  await assert.rejects(buildTrial(config, output, { entry }));
  assert.deepEqual(await hashFile(path.join(output, "index.html")), before);
  await fs.writeFile(entry, "globalThis.selection = __CATALOG_SELECTION__;");
  const original = fs.copyFile;
  fs.copyFile = async (source, destination, ...args) => {
    if (destination.includes(".build-lock/site/data/")) throw new Error("Simulated staging failure");
    return original(source, destination, ...args);
  };
  try { await assert.rejects(buildTrial(config, output, { entry }), /Simulated staging failure/); }
  finally { fs.copyFile = original; }
  assert.deepEqual(await hashFile(path.join(output, "index.html")), before);
  await verifyBundle(built.bundle, pin);
  await fs.mkdir(output + ".build-lock");
  await assert.rejects(buildTrial(config, output, { entry }), /locked/);
  await fs.rm(output + ".build-lock", { recursive: true });
});

test("configured builds reject unsupported start dates without replacing published output", async t => {
  const directory = await temporary(t), config = path.join(directory, "config.json"), output = path.join(directory, "site");
  const entry = path.join(directory, "entry.js");
  await fs.writeFile(entry, "globalThis.selection = __CATALOG_SELECTION__;");
  const settings = { mode: "indexed", latest: "http://127.0.0.1:9/latest.json" };
  await fs.writeFile(config, JSON.stringify(settings));
  await buildTrial(config, output, { entry });
  const inventory = async target => {
    const names = (await fs.readdir(target, { recursive: true, withFileTypes: true }))
      .filter(item => item.isFile()).map(item => path.relative(target, path.join(item.parentPath, item.name))).sort();
    return Promise.all(names.map(async name => ({ name, ...await hashFile(path.join(target, name)) })));
  };
  const before = await inventory(output), dist = path.join(root, "dist"), beforeDist = await inventory(dist);
  const backup = path.join(directory, "original-dist");
  await fs.cp(dist, backup, { recursive: true });
  try {
    for (const startJed of [1e300, -1e300, 2440587.5 - 100000001, 2440587.5 + 100000001]) {
      await fs.writeFile(config, JSON.stringify({ ...settings, startJed }));
      await assert.rejects(buildTrial(config, output, { entry }), /Invalid catalogue startJed/);
      assert.deepEqual(await inventory(output), before);
      await assert.rejects(fs.stat(output + ".build-lock"), { code: "ENOENT" });
      for (const script of ["build", "build:next"]) {
        const rejected = await command(npmArgs(["run", script, "--", "--output-clean"]), { CATALOG_CONFIG: config });
        assert.notEqual(rejected.code, 0, rejected.output);
        assert.match(rejected.output, /Invalid catalogue startJed/);
        assert.deepEqual(await inventory(dist), beforeDist, "Rejected date preserves every published root/preview asset");
        await assert.rejects(fs.stat(dist + ".build-lock"), { code: "ENOENT" });
      }
    }
  } finally {
    await fs.rm(dist, { recursive: true, force: true });
    await fs.cp(backup, dist, { recursive: true });
  }
});

test("catalogue profiles accept supported date boundaries and retain optional playback defaults", async t => {
  const directory = await temporary(t), config = path.join(directory, "config.json");
  const profiles = [{ mode: "indexed", latest: "http://127.0.0.1:9/latest.json" },
    ...["indexed", "whole"].map(mode => ({ mode, bundle: path.join(fixtures, "ties"), pin }))];
  for (const settings of profiles) {
    for (const publicDefaults of [false, true]) {
      for (const startJed of [2440587.5 - 100000000, 2444270.5, 2440587.5 + 100000000]) {
        await fs.writeFile(config, JSON.stringify({ ...settings, startJed, speed: -1.5 }));
        const { runtime } = await prepareCatalog(config, { publicDefaults });
        assert.equal(runtime.startJed, startJed); assert.equal(runtime.speed, -1.5);
      }
      await fs.writeFile(config, JSON.stringify(settings));
      const { runtime } = await prepareCatalog(config, { publicDefaults });
      assert.equal(runtime.startJed, publicDefaults ? undefined : 2444270.5);
      assert.equal(runtime.speed, publicDefaults ? undefined : 1.5);
    }
    for (const startJed of [1e300, -1e300, null, "2444270.5"]) {
      await fs.writeFile(config, JSON.stringify({ ...settings, startJed }));
      await assert.rejects(prepareCatalog(config), /Invalid catalogue startJed/);
    }
  }
});

test("explicit retention survives update and rollback with each original pin", async t => {
  const directory = await temporary(t), config = path.join(directory, "config.json"), output = path.join(directory, "site");
  const entry = path.join(directory, "entry.js");
  await fs.writeFile(entry, "globalThis.selection = __CATALOG_SELECTION__;");
  const profiles = ["ties", "empty"].map(name => ({ bundle: path.join(fixtures, name), pin: cases.bundles[name].pin }));
  const server = http.createServer(async (req, res) => {
    try { res.end(await fs.readFile(path.join(output, req.url))); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const { default: Source } = await import("../src/unified/catalog/CatalogSource.js");
  const opened = [];
  t.after(() => opened.forEach(source => source.close()));
  const collect = async read => { const rows = []; for await (const event of read) if (event.type === "batch") rows.push(...event.records); return rows; };
  for (const [current, retained] of [[0, 1], [1, 0], [0, 1]]) {
    await fs.writeFile(config, JSON.stringify({ ...profiles[current], mode: "indexed", retained: [profiles[retained]] }));
    await buildTrial(config, output, { entry, publicDefaults: true });
    for (const profile of profiles) await verifyBundle(path.join(output, "data/delivery-v1-" + profile.pin.sha256), profile.pin);
    if (opened.length === 0) {
      const source = await Source.open({ ...pin, url: `http://127.0.0.1:${server.address().port}/data/delivery-v1-${pin.sha256}/index.json` });
      opened.push(source);
      assert.equal((await collect(source.read({ start: 0, end: 2 }))).length, 2);
    } else {
      // Already-open source requests previously unfetched chunks after replacement.
      assert.equal((await collect(opened[0].read({ start: 2, end: 6 }))).length, 4);
      const other = profiles[1].pin;
      const source = await Source.open({ ...other, url: `http://127.0.0.1:${server.address().port}/data/delivery-v1-${other.sha256}/index.json` });
      opened.push(source);
      assert.equal((await collect(source.read({ start: 0, end: 0 }))).length, 0);
    }
  }
  await fs.writeFile(config, JSON.stringify({ ...profiles[0], mode: "indexed", retained: [profiles[1]] }));
  // The public command must keep old indexed clients alive during rollback.
  const dist = path.join(root, "dist"), backup = path.join(directory, "original-dist");
  await fs.cp(dist, backup, { recursive: true });
  try {
    const rollback = await command(npmArgs(["run", "build", "--", "--output-clean"]), { CATALOG_CONFIG: config });
    assert.equal(rollback.code, 0, rollback.output);
    for (const profile of profiles) await verifyBundle(path.join(root, "dist/next/data/delivery-v1-" + profile.pin.sha256), profile.pin);
  } finally {
    await fs.rm(dist, { recursive: true, force: true });
    await fs.cp(backup, dist, { recursive: true });
  }
  const built = await buildTrial(config, output, { entry, publicDefaults: true });
  assert.equal(built.runtime.pin.sha256, profiles[0].pin.sha256);
  assert.equal((await collect(opened[0].read({ start: 2, end: 6 }))).length, 4);
});


test("normal configured builds preserve the entire prior site on late failure", async t => {
  const directory = await temporary(t), config = path.join(directory, "config.json");
  const dist = path.join(root, "dist"), backup = path.join(directory, "original-dist");
  await fs.cp(dist, backup, { recursive: true });
  const inventory = async () => {
    const names = (await fs.readdir(dist, { recursive: true, withFileTypes: true }))
      .filter(item => item.isFile()).map(item => path.relative(dist, path.join(item.parentPath, item.name))).sort();
    return Promise.all(names.map(async name => ({ name, ...await hashFile(path.join(dist, name)) })));
  };
  const preload = path.join(directory, "late-failure.cjs");
  await fs.writeFile(preload, `require(${JSON.stringify(path.join(root, "webpack.next.config.js"))}).plugins.push({
    apply(compiler) { compiler.hooks.afterEmit.tap("SimulatedLateFailure", () => { throw new Error("Simulated late compilation failure"); }); }
  });`);
  try { for (const script of ["build", "build:next"]) {
    await fs.writeFile(config, JSON.stringify({ mode: "indexed", latest: "http://127.0.0.1:9/latest.json" }));
    const initial = await command(npmArgs(["run", script]), { CATALOG_CONFIG: config });
    assert.equal(initial.code, 0, initial.output);
    await fs.writeFile(path.join(dist, "next/previous-site.txt"), "Preserve the complete working site.");
    const before = await inventory();
    await fs.writeFile(config, JSON.stringify({ mode: "whole", bundle: path.join(fixtures, "ties"), pin }));
    const failed = await command(npmArgs(["run", script, "--", "--output-clean"]),
      { CATALOG_CONFIG: config, NODE_OPTIONS: `--require ${JSON.stringify(preload)}` });
    assert.notEqual(failed.code, 0); assert.match(failed.output, /Simulated late compilation failure/);
    assert.deepEqual(await inventory(), before, "Even emitted assets stay private until all compilation/staging succeeds");
    const restored = await command(npmArgs(["run", script]), { CATALOG_CONFIG: config });
    assert.equal(restored.code, 0, restored.output);
    await verifyBundle(path.join(dist, "next/data/delivery-v1-" + pin.sha256), pin);
    await assert.rejects(fs.stat(path.join(dist, "next/previous-site.txt")), { code: "ENOENT" });
    await assert.rejects(fs.stat(dist + ".build-lock"), { code: "ENOENT" });
  } } finally {
    await fs.rm(dist, { recursive: true, force: true });
    await fs.cp(backup, dist, { recursive: true });
  }
});
