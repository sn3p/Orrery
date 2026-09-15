const { test } = require('./fixtures.cjs');
for (const part of ['state', 'failures', 'lifecycle', 'data', 'options', 'network']) {
  test(`Renderer switching ${part} @standalone`, async ({ check }) => { await check('switching', { part }); });
}
