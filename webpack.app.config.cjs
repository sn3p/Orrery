const path = require("node:path");
const base = require("./webpack.next.config.js");
const { PromotionAssetsPlugin } = require("./scripts/promotion.cjs");
const { prepareCatalog, catalogPlugins, stageCatalog, checkOutput } = require("./scripts/catalog.cjs");

module.exports = async (_env, argv = {}) => {
  if (argv.outputPath !== undefined || Object.keys(argv).some(key => key.startsWith("static"))) {
    throw new Error("The promoted app does not accept --output-path or static overrides; build dist, then copy the complete site.");
  }
  const output = path.resolve(__dirname, "dist");
  let plugins = [...base.plugins, new PromotionAssetsPlugin()];
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
          await stageCatalog(prepared, path.join(compiler.outputPath, "next"));
          staged = true;
        }
      });
    } });
  }
  return { ...base, plugins, output: { ...base.output, path: output },
    devServer: { ...base.devServer, open: ["/"], devMiddleware: { publicPath: "/" },
      setupMiddlewares(middlewares, server) {
        // Match static hosts' directory normalization, preserving query strings.
        server.app.get(/^\/next$/, (req, res) => res.redirect(302, "/next/" + new URL(req.url, "http://localhost").search));
        server.app.get("/favicon.ico", (_req, res) => res.status(204).end());
        return middlewares;
      },
    },
  };
};
