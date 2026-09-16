const { test } = require('./fixtures.cjs');

test('catalogue loading, demand, transport and actual entry', { tag: ['@core', '@data'] }, async ({ check }) => {
  await check('catalog-suite', { part: 'loading' });
});
test('catalogue replacement, recovery and latest selection', { tag: ['@core', '@data'] }, async ({ check }) => {
  await check('catalog-suite', { part: 'lifecycle' });
});
test('catalogue frame commits, GPU failures and recovery', { tag: ['@core', '@data'] }, async ({ check }) => {
  await check('catalog-suite', { part: 'frames' });
});
