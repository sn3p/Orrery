module.exports = function(source) {
  // Invalidate watch builds if provenance or validation changes too.
  this.addDependency(require.resolve('./historical-catalog.cjs'));
  this.addDependency(require.resolve('./fixtures/historical100k/manifest.json'));
  return require('./historical-catalog.cjs').decodeCatalog(source);
};
module.exports.raw = true;
