const { test } = require('./fixtures.cjs');

for (const [part, title] of [
  ['entries', 'Three direct entry, lazy isolation and startup recovery'],
  ['graphics', 'Three scenes, independent GPU numerics and upload budgets'],
  ['data', 'Three catalogue ties, delivery modes, latest and replacement'],
  ['frames', 'Three GPU failure receipts, rollback and recovery'],
  ['lifecycle', 'Three camera, playback, retained recovery and disposal'],
]) {
  test(`${title}`, { tag: part === 'graphics' ? ['@graphics'] : ['@core', '@graphics', '@data'] }, async ({ check }) => { await check('three', { part }); });
}
