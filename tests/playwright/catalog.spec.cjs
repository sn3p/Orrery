const { test } = require('./fixtures.cjs');

test('catalogue loading, demand, transport and actual entry @standalone', async ({ check }) => {
  await check('catalog-suite', { part: 'loading' });
});
test('catalogue replacement, recovery and latest selection @standalone', async ({ check }) => {
  await check('catalog-suite', { part: 'lifecycle' });
});
test('catalogue frame commits, GPU failures and recovery @standalone', async ({ check }) => {
  await check('catalog-suite', { part: 'frames' });
});
