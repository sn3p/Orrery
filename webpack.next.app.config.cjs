const path = require("node:path");
const base = require("./webpack.next.config.js");
const { prepareCatalog, catalogPlugins, stageCatalog, checkOutput } = require("./scripts/catalog.cjs");

module.exports = async (_env, argv = {}) => {
  if (!process.env.CATALOG_CONFIG) return base;
  if (Object.keys(argv).some(key => key.startsWith("static")) || argv.outputPath !== undefined) {
    throw new Error("Configured preview must keep its output and static files under dist/next.");
  }
  const config = path.resolve(process.env.CATALOG_CONFIG);
  await checkOutput(config, base.output.path);
  const prepared = await prepareCatalog(config, { publicDefaults: true });
  const data = { apply(compiler) {
    if (path.resolve(compiler.options.output.path) !== base.output.path) throw new Error("Configured preview output must remain dist/next.");
    let staged = false;
    compiler.hooks.afterEmit.tapPromise("VerifiedCatalogueFiles", async () => {
      if (!staged || compiler.options.output.clean) {
        await stageCatalog(prepared, compiler.outputPath);
        staged = true;
      }
    });
  } };
  return { ...base, plugins: [...catalogPlugins(base, prepared.runtime), data] };
};
