const { test } = require('./fixtures.cjs');

for (const application of ['unified']) {
  test.describe(application, () => {
    test('RAF scheduling ownership', { tag: application === 'unified' ? ['@core', '@graphics'] : ['@graphics'] }, async ({ check }) => {
      await check('scheduling', { application });
    });
    test('typography, mobile input, fonts and loading states', { tag: application === 'unified' ? ['@ui'] : ['@graphics'] }, async ({ check }) => {
      await check('ui', { application });
    });
    test('benchmark CLI provenance and failure reports', { tag: ['@graphics', '@build'] }, async ({ check }) => {
      await check('benchmark', { application, method: 'runCLI' });
    });
  });
}
for (const command of ['serve', 'serve:next']) {
  for (const renderer of ['pixi', 'three']) {
    test(`${command} promoted development ${renderer}, hot updates and retired preview route`, { tag: ['@dev'] }, async ({ check }) => {
      await check('next-dev', { command, renderer });
    });
  }
}
test('ordinary clean clone, HMR and default benchmark provenance', { tag: ['@dev', '@build'] }, async ({ check }) => {
  await check('benchmark-clone');
});
test('runner context cleanup, failure exit and diagnostics', { tag: ['@dev'] }, async ({ check }) => {
  await check('harness-browser');
});
