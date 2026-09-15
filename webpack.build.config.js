const legacy = require("./webpack.config");
const app = require("./webpack.app.config.cjs");

// Keep old root assets for cached PR73 documents through release acceptance.
// The unified compiler replaces index.html after the legacy build finishes.
module.exports = async (_env, argv = {}) => {
  if (argv.outputPath !== undefined) {
    throw new Error("The assembled build does not accept --output-path: build dist, then copy the complete site.");
  }
  const promoted = await app(_env, argv);
  return [
    { ...legacy, name: "legacy", output: { ...legacy.output, clean: true } },
    { ...promoted, name: "app", dependencies: ["legacy"], output: { ...promoted.output, clean: false } },
  ];
};
