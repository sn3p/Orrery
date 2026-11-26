const assert = require('node:assert/strict');

// Public paired-feed inventory and app-owned presentation, including clipped labels.
const colors = {
  Mercury: 'rgb(236, 205, 158)', Venus: 'rgb(236, 205, 158)', Earth: 'rgb(152, 192, 255)',
  Mars: 'rgb(255, 188, 131)', Jupiter: 'rgb(197, 195, 189)', Saturn: 'rgb(236, 205, 158)',
  Uranus: 'rgb(169, 221, 221)', Neptune: 'rgb(126, 159, 232)', Ceres: 'rgb(184, 173, 160)',
  Pluto: 'rgb(212, 182, 161)', Haumea: 'rgb(201, 200, 211)', Makemake: 'rgb(202, 165, 142)',
  Eris: 'rgb(211, 216, 224)',
};
module.exports = async page => {
  const labels = page.locator('.orrery-planet-label');
  assert.equal(await labels.count(), 13, 'All mode retains eight planet and five dwarf labels');
  assert.deepEqual(await labels.evaluateAll(elements => Object.fromEntries(
    elements.map(element => [element.dataset.planet, getComputedStyle(element).color]))), colors);
  assert.equal(await page.locator('.orrery-planet-label[data-classification="dwarf-planet"]').count(), 5);
};
