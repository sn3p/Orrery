// Registry metadata stays engine-free. The public route loads Three.js on demand.
// Pixi remains a separate chunk and does not require WebGL2.
export const DEFAULT_RENDERER = "three";

export const renderers = {
  three: { name: "Three.js", label: "Three.js (3D)", load: () => import(/* webpackChunkName: "three" */ "./three/ThreeRenderer.js")
    .then(({ default: Renderer }) => options => new Renderer(options)) },
  pixi: { name: "Pixi", label: "Pixi.js (2D)", load: () => import(/* webpackChunkName: "pixi" */ "./pixi/PixiRenderer.js")
    .then(({ default: Renderer }) => options => new Renderer(options)) },
};

export function selectRenderer(id = DEFAULT_RENDERER, registry = renderers, fallback = DEFAULT_RENDERER) {
  const known = Object.hasOwn(registry, id);
  const resolved = known ? id : fallback;
  const entry = registry[resolved];
  return { id: resolved, create: options => entry.load().then(create => create(options)),
    notice: known ? "" : `Unknown renderer. Showing ${entry.name}.` };
}
