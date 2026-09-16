const { test } = require('./fixtures.cjs');

for (const renderer of ['pixi', 'three']) {
  test(`${renderer} public startup, controls, DPR, recovery and reload`, { tag: '@smoke' }, async ({ check }) => {
    await check('smoke', { renderer });
  });
}
