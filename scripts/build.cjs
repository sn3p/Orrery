// Keep the historical webpack commands and their CLI options. Explicit
// catalogue production builds publish a complete verified directory atomically.
const path = require("node:path");
const { spawn } = require("node:child_process");

(async () => {
  const args = process.argv.slice(2);
  const preview = args[0] === "--preview";
  if (preview) args.shift();
  if (!process.env.CATALOG_CONFIG) {
    const child = spawn(process.execPath, [require.resolve("webpack-cli/bin/cli.js"),
      "--config", preview ? "webpack.next.app.config.cjs" : "webpack.build.config.js",
      "--mode", "production", ...args], { stdio: "inherit" });
    child.on("error", error => { console.error(error); process.exitCode = 1; });
    child.on("exit", code => { process.exitCode = code ?? 1; });
    return;
  }
  if (args.some(arg => arg !== "--output-clean")) {
    throw new Error("Configured catalogue builds accept only --output-clean; their verified output is dist/ or dist/next/.");
  }
  const result = await require("./catalog.cjs").buildTrial(path.resolve(process.env.CATALOG_CONFIG),
    preview ? "dist/next" : "dist", { publicDefaults: true, assembled: !preview });
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
