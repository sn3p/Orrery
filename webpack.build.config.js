const app = require("./webpack.app.config.cjs");

// Only the current app is published. Legacy compilers remain test oracles.
module.exports = async (_env, argv = {}) => {
  if (process.env.CATALOG_CONFIG) {
    throw new Error("Configured assembled builds require npm run build or build:next for atomic publication.");
  }
  return { ...await app(_env, argv), name: "app" };
};
