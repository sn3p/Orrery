const { test } = require('./fixtures.cjs');

test('default indexed catalogue through both public renderers @standalone', async ({ check }) => {
  await check('default-catalog');
});

test('development texture lifecycle and speed-eight buffering @standalone', async ({ check }) => {
  await check('runtime-diagnostics');
});
