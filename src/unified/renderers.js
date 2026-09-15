// Metadata stays engine-free so Pixi never requires Three or WebGL2 to boot.
export const renderers = {
  pixi: { label: "Pixi.js (2D)", load: () => import(/* webpackChunkName: "pixi" */ "./pixi/PixiRenderer.js")
    .then(({ default: Renderer }) => options => new Renderer(options)) },
  three: { label: "Three.js (3D)", load: () => import(/* webpackChunkName: "three" */ "./three/ThreeRenderer.js")
    .then(({ default: Renderer }) => options => new Renderer(options)) },
};

export function selectRenderer(id = "pixi", registry = renderers) {
  const known = Object.hasOwn(registry, id);
  const entry = registry[known ? id : "pixi"];
  return { id: known ? id : "pixi", create: options => entry.load().then(create => create(options)),
    notice: known ? "" : "Unknown renderer. Showing Pixi." };
}
