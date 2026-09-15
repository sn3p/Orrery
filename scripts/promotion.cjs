const { Compilation, sources } = require("webpack");

// A relative, same-origin target also works under GitHub Pages' /Orrery/ base.
// Keep the entire query (including unknown parameters) and fragment unchanged.
const forwardingHTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>Orrery has moved</title></head>
<body><p>Orrery is now at its main address. <a id="destination" href="../">Open Orrery</a></p>
<script>
  const destination = new URL('../', location.href);
  destination.search = location.search;
  destination.hash = location.hash;
  document.getElementById('destination').href = destination.href;
  location.replace(destination.href);
</script></body></html>`;

class PromotionAssetsPlugin {
  apply(compiler) {
    compiler.hooks.thisCompilation.tap("PromotionAssets", compilation => {
      compilation.hooks.processAssets.tap({ name: "PromotionAssets", stage: Compilation.PROCESS_ASSETS_STAGE_REPORT }, () => {
        // PR73 pages may still have old HTML or unloaded lazy chunks. Keep the
        // same bytes at their previous /next/ paths through release acceptance.
        for (const { name, source, info } of compilation.getAssets()) {
          if (name !== "index.html") compilation.emitAsset("next/" + name, source, info);
        }
        compilation.emitAsset("next/index.html", new sources.RawSource(forwardingHTML));
      });
    });
  }
}
module.exports = { PromotionAssetsPlugin, forwardingHTML };
