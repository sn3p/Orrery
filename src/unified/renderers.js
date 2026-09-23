// Registry metadata stays engine-free. The public route loads Three.js on demand.
// Pixi remains a separate chunk and does not require WebGL2.
export const DEFAULT_RENDERER = "three";
const fallbackLabels = { pixi: "Pixi", three: "Three.js" };

export const renderers = {
  three: { label: "Three.js (3D)", load: () => import(/* webpackChunkName: "three" */ "./three/ThreeRenderer.js")
    .then(({ default: Renderer }) => options => new Renderer(options)) },
  pixi: { label: "Pixi.js (2D)", load: () => import(/* webpackChunkName: "pixi" */ "./pixi/PixiRenderer.js")
    .then(({ default: Renderer }) => options => new Renderer(options)) },
};

export function selectRenderer(id = DEFAULT_RENDERER, registry = renderers, fallback = DEFAULT_RENDERER) {
  const fallbackId = [fallback, DEFAULT_RENDERER, ...Object.keys(registry)].find(key => Object.hasOwn(registry, key));
  const known = Object.hasOwn(registry, id);
  const resolved = known ? id : fallbackId;
  const entry = registry[resolved];
  const shown = fallbackLabels[resolved] ?? entry.label;
  return { id: resolved, create: options => entry.load().then(create => create(options)),
    notice: known ? "" : `Unknown renderer. Showing ${shown}.` };
}
