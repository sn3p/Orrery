const { test } = require('./fixtures.cjs');

test('default indexed catalogue through both public renderers @standalone', async ({ check }) => {
  await check('default-catalog');
});
