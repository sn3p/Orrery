const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const webpack = require("webpack");

async function build(entry, output) {
  const config = require("../webpack.config");
  await new Promise((resolve, reject) => {
    const compiler = webpack({ ...config, mode: "production", entry,
      output: { ...config.output, path: path.resolve(output) }, performance: { hints: false } });
    compiler.run((error, stats) => compiler.close(() => {
      if (error || stats.hasErrors()) reject(error || new Error(stats.toString("errors-only")));
      else resolve();
    }));
  });
}

async function serve(directory) {
  const root = path.resolve(directory);
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    if (pathname.endsWith("/favicon.ico")) { res.writeHead(204); res.end(); return; }
    const filename = path.resolve(root, "." + pathname + (pathname.endsWith("/") ? "index.html" : ""));
    if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
    res.setHeader("Content-Type", { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".woff2": "font/woff2" }[path.extname(filename)] || "application/octet-stream");
    fs.createReadStream(filename).pipe(res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

module.exports = { build, serve };
