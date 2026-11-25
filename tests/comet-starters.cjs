// Derive policy-dependent expectations from the app and the fixture's membership.
// The exact approved policy is asserted independently in comets.test.mjs.
module.exports = async function starterIdsFor(objects) {
  if (!objects) {
    const fs = require('node:fs'), path = require('node:path');
    const root = path.join(__dirname, 'fixtures/comets-v2');
    const latest = JSON.parse(fs.readFileSync(path.join(root, 'latest.json')));
    objects = JSON.parse(fs.readFileSync(path.join(root, latest.index.url))).objects;
  }
  const { STARTER_COMET_IDS } = await import('../src/unified/comets/model.js');
  const available = new Set(objects.map(entry => typeof entry === 'string' ? entry : entry.id));
  return STARTER_COMET_IDS.filter(id => available.has(id));
};
