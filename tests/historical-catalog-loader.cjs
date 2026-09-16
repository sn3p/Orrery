module.exports = function(source) {
  // Watch invalidation must also reload Node's cached validation dependencies.
  for (const dependency of ['./historical-catalog.cjs', './fixtures/historical100k/manifest.json']) {
    const filename = require.resolve(dependency);
    this.addDependency(filename);
    delete require.cache[filename];
  }
  return require('./historical-catalog.cjs').decodeCatalog(source);
};
module.exports.raw = true;
