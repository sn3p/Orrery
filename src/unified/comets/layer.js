// Both renderers retain effective data/options across partial option updates.
export function syncCometLayer(renderer, shared, create) {
  if (!shared) return false;
  const settings = { ...renderer.cometSettings, ...shared };
  if (renderer.comets && shared.cometCatalogue !== undefined
    && shared.cometCatalogue !== renderer.cometCatalogue) {
    renderer.comets.destroy();
    renderer.comets = null;
  }
  renderer.cometCatalogue = settings.cometCatalogue;
  if (settings.cometData && !renderer.comets && renderer.initialized) {
    renderer.comets = create(settings.cometData, settings.cometCatalogue);
  }
  if (settings.cometData && renderer.comets) renderer.comets.setData(settings.cometData);
  renderer.cometSettings = settings;
  renderer.updateComets?.(renderer.lastJed);
  return ['cometsShown', 'cometPaths', 'cometIds', 'cometData', 'cometCatalogue']
    .some(key => shared[key] !== undefined);
}
