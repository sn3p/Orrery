const path = require("node:path");
const base = require("./webpack.next.config.js");
const { prepareCatalog, catalogPlugins, stageCatalog, checkOutput } = require("./scripts/catalog.cjs");

module.exports = async (_env, argv = {}) => {
  if (argv.watch && Object.keys(argv).some(key => key.startsWith("outputClean"))) {
    throw new Error("Watch does not accept --output-clean overrides; use npm run build for a clean assembled site.");
  }
  if (argv.outputPath !== undefined || Object.keys(argv).some(key => key.startsWith("static"))) {
    throw new Error("The promoted app does not accept --output-path or static overrides; build dist, then copy the complete site.");
  }
  const output = path.resolve(__dirname, "dist");
  let plugins = [...base.plugins];
  if (process.env.CATALOG_CONFIG) {
    const config = path.resolve(process.env.CATALOG_CONFIG);
    await checkOutput(config, output, true);
    const prepared = await prepareCatalog(config, { publicDefaults: true });
    plugins = catalogPlugins({ plugins }, prepared.runtime);
    plugins.push({ apply(compiler) {
      let staged = false;
      compiler.hooks.afterEmit.tapPromise("VerifiedCatalogueFiles", async () => {
        if (!staged || compiler.options.output.clean) {
          await stageCatalog(prepared, compiler.outputPath);
          staged = true;
        }
      });
    } });
  }
  // Watch preserves current root chunks and retained catalogue pins, while
  // removing payloads from the retired legacy/preview deployment.
  const clean = argv.watch
    ? { keep: name => !["next", "data", "bundle.js", "main.css", "data/catalog.json"].includes(name)
      && !name.startsWith("next/") }
    : base.output.clean;
  return { ...base, plugins, output: { ...base.output, path: output, clean },
    devServer: { ...base.devServer, open: ["/"], devMiddleware: { publicPath: "/" },
      setupMiddlewares(middlewares, server) {
        // Do not let a previous build's HTML leak through the static fallback.
        server.app.get(/^\/next(?:\/|$)|^\/(?:bundle\.js|main\.css|data\/catalog\.json)$/, (_req, res) => res.sendStatus(404));
        server.app.get("/favicon.ico", (_req, res) => res.status(204).end());
        return middlewares;
      },
    },
  };
};
