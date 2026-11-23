const { test } = require('./fixtures.cjs');
for (const part of ['state', 'failures', 'lifecycle', 'data', 'options', 'network']) {
  test(`Renderer switching ${part}`, { tag: ['@core', '@graphics', '@ui', '@data'] }, async ({ check }) => { await check('switching', { part }); });
}

for (const scenario of require('../startup-switching.cjs').scenarios) {
  test(`Renderer switching before the first catalogue commit / ${scenario.id}`,
    { tag: ['@core', '@graphics', '@ui', '@data'] }, async ({ check }) => {
      await check('startup-switching', { scenario });
    });
}
