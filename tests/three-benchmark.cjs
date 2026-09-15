const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { measure } = require('../benchmarks/catalog-loading.cjs');
const { serve } = require('./support.cjs');

async function run({ browser, name, output = path.resolve('.context/pr4/benchmark') }) {
  assert.equal(name, 'chromium');
  await fs.mkdir(output, { recursive: true });
  const site = output + '-site';
  if (process.env.ORRERY_PREBUILT_FIXTURES) require('./fixture-builds.cjs').copyPrepared('catalog', site);
  else await require('./catalog-loading.cjs').build(site);
  const server = await serve(site), results = [];
  try {
    for (const mode of ['empty-indexed', 'indexed', 'whole', 'historical']) {
      const result = await measure(browser, server.url + '/catalog-' + mode + '/?renderer=three', 'native', 0);
      assert.equal(result.renderer, 'three'); assert.equal(result.webGLVersion, 2);
      assert.equal(result.initialGpuMethod, 'fenceSync');
      assert(Number.isFinite(result.initialGpuMs) && result.initialGpuMs >= result.initialSubmissionMs);
      assert.equal(result.population, mode.startsWith('empty') ? 0 : mode === 'historical' ? 100000 : 6);
      assert.equal(result.canonicalBytes, result.population * 60);
      assert.equal(result.catalogCpuBytes, result.population * 68);
      assert.equal(result.nominalGpuBytes, result.population * 40);
      assert.equal(result.restoredDataRequests, 0); assert.deepEqual(result.errors, []);
      results.push({ mode, ...result });
    }
    await fs.writeFile(path.join(output, 'results.json'), JSON.stringify(results, null, 2));
  } finally { await server.close(); }
}
module.exports = { run };
