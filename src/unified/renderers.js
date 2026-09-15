// Metadata stays engine-free so Pixi never requires Three or WebGL2 to boot.
const renderers = {
  pixi: options => import(/* webpackChunkName: "pixi" */ "./pixi/PixiRenderer.js")
    .then(({ default: Renderer }) => new Renderer(options)),
  three: options => import(/* webpackChunkName: "three" */ "./three/ThreeRenderer.js")
    .then(({ default: Renderer }) => new Renderer(options)),
};

export function selectRenderer(id = "pixi") {
  const known = Object.hasOwn(renderers, id);
  return { id: known ? id : "pixi", create: renderers[known ? id : "pixi"],
    notice: known ? "" : "Unknown renderer. Showing Pixi." };
}
