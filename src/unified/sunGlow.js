// Soft halo around the Sun, shared by both renderers. The light starts at 30%
// at the Sun's edge and eases out quadratically to nothing at 4 Sun radii, so
// the outer edge fades without a visible rim.
export const SUN_GLOW_EXTENT = 4;
const COLOR = "253, 240, 137";
const EDGE_ALPHA = 0.3;
const STEPS = 10;

const rgba = alpha => `rgba(${COLOR}, ${alpha})`;
const alphaAt = offset => EDGE_ALPHA * ((1 - offset) / (1 - 1 / SUN_GLOW_EXTENT)) ** 2;

// Gradient stops from the centre (0) to the outer edge (1). A halo drawn over
// the core (Three's additive sprite) starts at `inner` and leaves the core
// untouched; a halo drawn beneath it can fade from the centre.
export function sunGlowStops(inner = 0) {
  const stops = inner > 0 ? [{ offset: 0, color: rgba(0) }, { offset: inner, color: rgba(0) }] : [];
  for (let i = 0; i <= STEPS; i++) {
    const offset = inner + (1 - inner) * i / STEPS;
    stops.push({ offset, color: rgba(alphaAt(offset)) });
  }
  return stops;
}
