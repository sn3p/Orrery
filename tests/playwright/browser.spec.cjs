const { test } = require('./fixtures.cjs');

test('historical fixture assets, nested deployment, keyboard and reload', { tag: ['@core', '@ui', '@build'] }, async ({ check }) => {
  await check('assets');
});
test('preview entry, responsive layouts, lazy assets and recovery', { tag: ['@core', '@ui', '@build'] }, async ({ check }) => {
  await check('next');
});
test('preview footer loading, buffering, failure and empty states', { tag: ['@ui', '@data'] }, async ({ check }) => {
  await check('next-status');
});
test('atomic date seeks, unified progress and discovery baselines', { tag: ['@core', '@ui', '@data', '@graphics'] }, async ({ check }) => {
  await check('date-seek');
});
test('first-visit introduction, playback hold and About', { tag: ['@core', '@ui'] }, async ({ check }) => {
  await check('intro');
});
test('main playback and date controls', { tag: ['@core', '@ui'] }, async ({ check }) => {
  await check('timeline');
});
test('raw App lifecycle, scene states and exact recovery', { tag: ['@graphics', '@extended'] }, async ({ check }) => {
  await check('unified', { application: 'unified' });
});
test('representative production scene and recovery checks', { tag: ['@core'] }, async ({ check }) => {
  await check('unified', { application: 'unified', compact: true });
});

test.describe('unified', () => {
  const application = 'unified';
  test('GPU numerics, uploads, pixels and recovery', { tag: ['@graphics', '@extended'] }, async ({ check }) => {
    await check('gpu', { application });
  });
  test('rendering, readouts, lifecycle and production UI', { tag: ['@graphics', '@ui'] }, async ({ check }) => {
    await check('rendering', { application });
  });
  for (const [part, title] of [
    ['options', 'options controls, keyboard and responsive layout'],
    ['pixelRatio', 'pixel ratio and display transitions'],
    ['texture', 'texture recovery and resolution lifecycle'],
  ]) {
    test(title, { tag: ['@graphics', '@ui'] }, async ({ check }) => {
      await check('options-browser', { application, part });
    });
  }
  test('benchmark frames, resolution, interruption and recovery', { tag: ['@graphics', '@extended'] }, async ({ check }) => {
    await check('benchmark', { application });
  });
});

test('promoted root, retired preview route, missing chunks and recovery', { tag: ['@build'] }, async ({ check }) => {
  await check('promotion');
});
test('configured promotion, root catalogue pins and chronological loading', { tag: ['@build'] }, async ({ check }) => {
  await check('promotion', { method: 'configured' });
});

// Keep the same acceptance scenarios, with independent per-renderer budgets
// and cleanup. The former monolith opened 52 contexts and timed out on WebKit.
const cometTags = ['@core', '@ui', '@graphics', '@data'];
test('comet selection persistence, races and history', { tag: cometTags }, async ({ check }) => {
  await check('comets-browser', { part: 'selection' });
});
for (const renderer of ['three', 'pixi']) {
  test(`comet controls, scientific positions and populations (${renderer})`, { tag: cometTags }, async ({ check }) => {
    await check('comets-browser', { part: 'controls', rendererIds: [renderer] });
  });
  test(`comet acquisition, replacement and public startup (${renderer})`, { tag: cometTags }, async ({ check }) => {
    await check('comets-browser', { part: 'lifecycle', rendererIds: [renderer] });
  });
}

test('named planets and dwarfs: paired data, both renderers, controls and recovery', { tag: ['@core', '@data', '@graphics', '@ui'] }, async ({ check }) => {
  await check('named-bodies-browser');
});
