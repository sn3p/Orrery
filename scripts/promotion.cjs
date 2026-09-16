const { Compilation, sources } = require("webpack");
const fs = require("node:fs");
const path = require("node:path");
const { gunzipSync } = require("node:zlib");
const priorStyles = path.resolve(__dirname, "../src/unified/compat/pr73-main.css");
const priorScripts = path.resolve(__dirname, "../src/unified/compat/pr73-assets");

class PromotionAssetsPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap("PromotionAssets", compilation => {
      compilation.fileDependencies.add(priorStyles);
      const scripts = fs.readdirSync(priorScripts).filter(name => name.endsWith(".js.gz"));
      for (const name of scripts) compilation.fileDependencies.add(path.join(priorScripts, name));
      compilation.hooks.processAssets.tap({ name: "PromotionAssets", stage: Compilation.PROCESS_ASSETS_STAGE_REPORT }, () => {
        // PR73 pages may still have old HTML or unloaded lazy chunks. Keep the
        // same bytes at their previous /next/ paths through release acceptance.
        for (const { name, source, info } of compilation.getAssets()) {
          if (name !== "index.html") compilation.emitAsset("next/" + name, source, info);
        }
        // New UI styling changes its CSS hash; cached PR73 HTML still needs
        // the original stylesheet. Remove this snapshot with promotion cleanup.
        compilation.emitAsset("next/assets/main.ee865e1e.css", new sources.RawSource(fs.readFileSync(priorStyles)));
        // Runtime fixes change the entry/chunk hashes too. These frozen PR73
        // bytes keep cached pages usable until the same compatibility cleanup.
        for (const name of scripts) compilation.emitAsset("next/assets/" + name.slice(0, -3),
          new sources.RawSource(gunzipSync(fs.readFileSync(path.join(priorScripts, name)))), { minimized: true });
      });
    });
  }
}
module.exports = { PromotionAssetsPlugin };
