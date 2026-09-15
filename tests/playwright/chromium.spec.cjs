const { test } = require('./fixtures.cjs');

for (const application of ['legacy', 'unified']) {
  test.describe(application, () => {
    const tag = application === 'unified' ? ' @standalone' : '';
    test(`RAF scheduling ownership${tag}`, async ({ check }) => {
      await check('scheduling', { application });
    });
    test(`typography, mobile input, fonts and loading states${tag}`, async ({ check }) => {
      await check('ui', { application });
    });
    test(`benchmark CLI provenance and failure reports${tag}`, async ({ check }) => {
      await check('benchmark', { application, method: 'runCLI' });
    });
  });
}
test('legacy development hot updates and full reload', async ({ check }) => {
  await check('hmr');
});
for (const command of ['serve', 'serve:next']) {
  for (const renderer of ['pixi', 'three']) {
    test(`${command} promoted development ${renderer}, hot updates and forwarding`, async ({ check }) => {
      await check('next-dev', { command, renderer });
    });
  }
}
test('ordinary clean clone, HMR and default benchmark provenance', async ({ check }) => {
  await check('benchmark-clone');
});
test('runner context cleanup, failure exit and diagnostics', async ({ check }) => {
  await check('harness-browser');
});
