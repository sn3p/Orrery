import PlanetLabel from '../PlanetLabel.js';

// Share the existing screen-space label placement and edge handling.
export function cometLabel(container, comet) {
  const label = new PlanetLabel(container, comet.name, comet.color);
  label.element.classList.add('orrery-comet-label');
  delete label.element.dataset.planet;
  label.element.dataset.comet = comet.id;
  // Comet names are longer than the planet labels' fixed edge allowance.
  // Measure once after the font settles, rather than forcing layout each frame.
  let width;
  container.ownerDocument.fonts?.ready.then(() => { width = undefined; });
  const place = label.place.bind(label);
  label.place = (x, y, viewport) => {
    place(x, y, viewport);
    if (label.element.hidden) return;
    width ??= label.element.offsetWidth;
    label.element.dataset.side = x + width + 15 > viewport.width ? 'left' : 'right';
  };
  return label;
}
