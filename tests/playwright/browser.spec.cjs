const { test } = require('./fixtures.cjs');
const fs = require('node:fs');
const path = require('node:path');

test('historical fixture assets, nested deployment, keyboard and reload', { tag: ['@core', '@ui', '@build'] }, async ({ check }, testInfo) => {
  const output = testInfo.outputPath('evidence');
  const nested = path.join(output, 'Orrery'), prior = path.join(output, 'legacy-site');
  for (const state of ['stale', 'dangling', 'fresh']) {
    await test.step(`${state} prior nested deployment`, async () => {
      fs.rmSync(nested, { recursive: true, force: true });
      fs.rmSync(prior, { recursive: true, force: true });
      if (state === 'stale') {
        fs.mkdirSync(prior, { recursive: true });
        fs.writeFileSync(path.join(prior, 'index.html'), '<title>Obsolete fixture</title>');
      }
      if (state !== 'fresh') fs.symlinkSync(prior, nested, 'dir');
      await check('assets');
    });
  }
});
test('preview entry, responsive layouts, lazy assets and recovery', { tag: ['@core', '@ui', '@build'] }, async ({ check }) => {
  await check('next');
});
test('preview footer loading, buffering, failure and empty states', { tag: ['@ui', '@data'] }, async ({ check }) => {
  await check('next-status');
});
test('raw App lifecycle, scene states and exact recovery', { tag: ['@graphics'] }, async ({ check }) => {
  await check('unified', { application: 'unified' });
});
test('representative production scene and recovery checks', { tag: ['@core'] }, async ({ check }) => {
  await check('unified', { application: 'unified', compact: true });
});

for (const application of ['unified']) {
  test.describe(application, () => {
    test('GPU numerics, uploads, pixels and recovery', { tag: ['@graphics'] }, async ({ check }) => {
      await check('gpu', { application });
    });
    test('rendering, readouts, lifecycle and production UI', { tag: application === 'unified' ? ['@graphics', '@ui'] : ['@graphics'] }, async ({ check }) => {
      await check('rendering', { application });
    });
    for (const [part, title] of [
      ['options', 'options controls, keyboard and responsive layout'],
      ['pixelRatio', 'pixel ratio and display transitions'],
      ['texture', 'texture recovery and resolution lifecycle'],
    ]) {
      test(title, { tag: application === 'unified' ? ['@graphics', '@ui'] : ['@graphics'] }, async ({ check }) => {
        await check('options-browser', { application, part });
      });
    }
    test('benchmark frames, resolution, interruption and recovery', { tag: ['@graphics'] }, async ({ check }) => {
      await check('benchmark', { application });
    });
  });
}

test('promoted root, retired preview route, missing chunks and recovery', { tag: ['@build'] }, async ({ check }) => {
  await check('promotion');
});
test('configured promotion, root catalogue pins and chronological loading', { tag: ['@build'] }, async ({ check }) => {
  await check('promotion', { method: 'configured' });
});
