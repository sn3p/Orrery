// Keep the public build aliases; both assemble the promoted site. Explicit
// catalogue production builds publish a complete verified directory atomically.
const path = require("node:path");
const { spawn } = require("node:child_process");

(async () => {
  const args = process.argv.slice(2);
  const preview = args[0] === "--preview";
  if (preview) args.shift();
  // Webpack accepts the explicit boolean spelling too. Normalize it before
  // webpack-cli can apply output.clean to every compiler.
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--output-clean=true") args[index] = "--output-clean";
    else if (/^--(?:no-)?output-clean/.test(args[index]) && args[index] !== "--output-clean") {
      throw new Error("Production builds clean once; use --output-clean without a false value.");
    }
  }
  if (!process.env.CATALOG_CONFIG) {
    const child = spawn(process.execPath, [require.resolve("webpack-cli/bin/cli.js"),
      "--config", "webpack.build.config.js",
      // Root cleaning is owned by the first compiler. Applying this CLI flag
      // to both compilers would erase the cached-document compatibility assets.
      "--mode", "production", ...args.filter(arg => arg !== "--output-clean")], { stdio: "inherit" });
    child.on("error", error => { console.error(error); process.exitCode = 1; });
    child.on("exit", code => { process.exitCode = code ?? 1; });
    return;
  }
  if (args.some(arg => arg !== "--output-clean")) {
    throw new Error("Configured catalogue builds accept only --output-clean; their verified output is dist/.");
  }
  const result = await require("./catalog.cjs").buildTrial(path.resolve(process.env.CATALOG_CONFIG),
    "dist", { publicDefaults: true, assembled: true });
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
