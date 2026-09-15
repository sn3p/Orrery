const path = require('node:path');
const { test } = require('./fixtures.cjs');

test('catalogue benchmark completion, empty data and GPU timing @standalone', async ({ check }) => {
  // Ten independently bounded measurements include WebGL1/2 and recovery.
  test.setTimeout(360_000);
  await check('catalog-suite', { part: 'benchmark' });
});
test('catalogue configured preview development and HMR @standalone', async ({ check }) => {
  await check('next-dev', { catalogConfig: path.resolve('catalog-profiles/ties-indexed.json') });
});


test('Three catalogue benchmark memory, GPU completion and recovery @standalone', async ({ check }) => {
  await check('three-benchmark');
});
test('Three configured preview development and HMR @standalone', async ({ check }) => {
  await check('next-dev', { catalogConfig: require('node:path').resolve('catalog-profiles/ties-indexed.json'), renderer: 'three' });
});
