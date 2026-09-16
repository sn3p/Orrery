const { test } = require('./fixtures.cjs');

test('default indexed catalogue through both public renderers', { tag: ['@core', '@data'] }, async ({ check }) => {
  await check('default-catalog');
});

test('development texture lifecycle and speed-eight buffering', { tag: ['@graphics', '@data'] }, async ({ check }) => {
  await check('runtime-diagnostics');
});
