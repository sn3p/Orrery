const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const webpack = require("webpack");

async function compile(entry, output, { application = process.env.ORRERY_TEST_APP || 'unified' } = {}) {
  if (application !== "unified") throw new Error(`Unsupported fixture application: ${application}`);
  const config = require("./webpack-fixture.cjs");
  const plugins = entry === "./tests/bundled-entry.js"
    ? config.plugins.map(plugin => plugin.constructor.name === "HtmlWebpackPlugin"
      ? new (require("html-webpack-plugin"))({ template: "./src/unified/index.html" }) : plugin)
    : config.plugins;
  await new Promise((resolve, reject) => {
    const compiler = webpack({ ...config, mode: "production", entry, plugins,
      output: { ...config.output, path: path.resolve(output) }, performance: { hints: false } });
    compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error || new Error(stats.toString("errors-only")));
      else resolve();
    }));
  });
}

async function build(entry, output, options = {}) {
  if (process.env.ORRERY_PREBUILT_FIXTURES) {
    const { copyFixture } = require('./fixture-builds.cjs');
    copyFixture(entry, output, options.application || process.env.ORRERY_TEST_APP || 'unified');
  } else {
    await compile(entry, output, options);
  }
}

async function serve(directory) {
  const root = path.resolve(directory);
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname.endsWith("/favicon.ico")) { res.writeHead(204); res.end(); return; }
    const filename = path.resolve(root, "." + pathname + (pathname.endsWith("/") ? "index.html" : ""));
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
    if (fs.statSync(filename).isDirectory()) {
      res.writeHead(301, { Location: pathname + "/" + new URL(req.url, "http://localhost").search });
      res.end(); return;
    }
    res.setHeader("Content-Type", { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2" }[path.extname(filename)] || "application/octet-stream");
    fs.createReadStream(filename).pipe(res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

module.exports = { build, compile, serve };
