const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { serve } = require('./support.cjs');
const loading = require('./catalog-loading.cjs');

const parts = {
  loading,
  lifecycle: require('./catalog-lifecycle.cjs'),
  frames: require('./frame-commit.cjs'),
  benchmark: require('./catalog-benchmark.cjs'),
};

async function run({ browser, name, output = path.resolve('.context/pr3/browser', name), part = 'all', step }) {
  assert(part === 'all' || Object.hasOwn(parts, part), `Unknown catalogue test part: ${part}`);
  assert(part !== 'benchmark' || name === 'chromium', 'Catalogue measurements require Chromium CDP');
  await fs.mkdir(output, { recursive: true });
  // Keep the copied multi-profile site out of report/CI evidence globs while
  // retaining a separate copy for every native test (and diagnostic browser).
  const site = output + '-site';
  if (process.env.ORRERY_PREBUILT_FIXTURES) require('./fixture-builds.cjs').copyPrepared('catalog', site);
  else await loading.build(site);
  const server = await serve(site), results = [];
  try {
    const selected = part === 'all' ? Object.keys(parts).filter(item => item !== 'benchmark' || name === 'chromium') : [part];
    for (const item of selected) {
      const check = () => parts[item].run(browser, server.url, output, name);
      results.push({ part: item, cases: await (step ? step(`Catalogue ${item}`, check) : check()) });
      await fs.writeFile(path.join(output, 'results.json'), JSON.stringify({ name, results }, null, 2));
    }
    console.log(`${name}: catalogue ${part} passed.`);
  } finally { await server.close(); }
}

module.exports = { run };
if (require.main === module) {
  (async () => {
    const standalone = require('./standalone.cjs');
    await standalone.run(run);
    if (!process.exitCode) await standalone.run(options => require('./next-dev.cjs').run({ ...options,
      output: path.resolve('.context/pr3/browser/dev'), catalogConfig: path.resolve('catalog-profiles/ties-indexed.json'),
    }), { chromiumOnly: true });
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
