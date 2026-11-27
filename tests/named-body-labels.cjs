const assert = require('node:assert/strict');

// Public paired-feed inventory and app-owned presentation, including clipped labels.
const colors = {
  Mercury: 'rgb(236, 205, 158)', Venus: 'rgb(236, 205, 158)', Earth: 'rgb(152, 192, 255)',
  Mars: 'rgb(255, 188, 131)', Jupiter: 'rgb(197, 195, 189)', Saturn: 'rgb(236, 205, 158)',
  Uranus: 'rgb(169, 221, 221)', Neptune: 'rgb(126, 159, 232)', Ceres: 'rgb(184, 173, 160)',
  Pluto: 'rgb(212, 182, 161)', Haumea: 'rgb(201, 200, 211)', Makemake: 'rgb(202, 165, 142)',
  Eris: 'rgb(211, 216, 224)',
};
module.exports = async (page, { dwarfs = false } = {}) => {
  const expected = dwarfs ? colors : Object.fromEntries(Object.entries(colors).slice(0, 8));
  const labels = page.locator('.orrery-planet-label');
  assert.equal(await labels.count(), dwarfs ? 13 : 8, 'Label groups retain their independent inventories');
  assert.deepEqual(await labels.evaluateAll(elements => Object.fromEntries(
    elements.map(element => [element.dataset.planet, getComputedStyle(element).color]))), expected);
  assert.equal(await page.locator('.orrery-planet-label[data-classification="dwarf-planet"]').count(), dwarfs ? 5 : 0);
};
