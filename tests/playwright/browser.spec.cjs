const { test } = require('./fixtures.cjs');

test('production assets, nested deployment, keyboard and reload', async ({ check }) => {
  await check('assets');
});
test('preview entry, responsive layouts, lazy assets and recovery', async ({ check }) => {
  await check('next');
});
test('preview footer loading, buffering, failure and empty states @standalone', async ({ check }) => {
  await check('next-status');
});
test('raw App lifecycle and exact legacy/preview parity @standalone', async ({ check }) => {
  await check('unified', { application: 'legacy' });
});

for (const application of ['legacy', 'unified']) {
  test.describe(application, () => {
    const tag = application === 'unified' ? ' @standalone' : '';
    test(`GPU numerics, uploads, pixels and recovery${tag}`, async ({ check }) => {
      await check('gpu', { application });
    });
    test(`rendering, readouts, lifecycle and production UI${tag}`, async ({ check }) => {
      await check('rendering', { application });
    });
    for (const [part, title] of [
      ['options', 'options controls, keyboard and responsive layout'],
      ['pixelRatio', 'pixel ratio and display transitions'],
      ['texture', 'texture recovery and resolution lifecycle'],
    ]) {
      test(`${title}${tag}`, async ({ check }) => {
        await check('options-browser', { application, part });
      });
    }
    test(`benchmark frames, resolution, interruption and recovery${tag}`, async ({ check }) => {
      await check('benchmark', { application });
    });
  });
}
