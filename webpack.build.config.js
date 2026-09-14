const legacy = require("./webpack.config");
const preview = require("./webpack.next.config");

// Cleaning dist must finish before the preview writes dist/next. This dependency
// also applies when the Pages command explicitly passes --output-clean.
module.exports = (_env, argv = {}) => {
  // webpack-cli applies --output-path to EVERY compiler after loading this
  // config. Reject it before either clean can run and erase a sibling build.
  if (argv.outputPath !== undefined) {
    throw new Error("The assembled build does not accept --output-path: it would overlap the root and preview. Build dist, then copy the assembled directory.");
  }
  return [
    { ...legacy, name: "legacy", output: { ...legacy.output, clean: true } },
    { ...preview, name: "preview", dependencies: ["legacy"] },
  ];
};
