const { Compilation } = require("webpack");

class PromotionAssetsPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap("PromotionAssets", compilation => {
      compilation.hooks.processAssets.tap({ name: "PromotionAssets", stage: Compilation.PROCESS_ASSETS_STAGE_REPORT }, () => {
        // PR73 pages may still have old HTML or unloaded lazy chunks. Keep the
        // same bytes at their previous /next/ paths through release acceptance.
        for (const { name, source, info } of compilation.getAssets()) {
          if (name !== "index.html") compilation.emitAsset("next/" + name, source, info);
        }
      });
    });
  }
}
module.exports = { PromotionAssetsPlugin };
