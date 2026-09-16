import { test } from 'node:test';
import assert from 'node:assert/strict';
import CatalogLoader, { LOOKAHEAD_SECONDS, MIN_LOOKAHEAD_CHUNKS } from '../src/unified/catalog/CatalogLoader.js';

// Chunk shape of the live catalogue: fixed row counts, so date spans shrink from
// decades to weeks. Dates are Julian days; 2451545 is 2000-01-01.
const J2000 = 2451545;
// A zero span continues the previous chunk's last date: a discovery-date tie
// crossing the chunk boundary, as the producer contract allows.
function makeSource(spans, rows = 100) {
  const chunks = []; let start = 0, date = J2000 - 365 * 30;
  for (const span of spans) {
    if (span === 0) date = chunks.at(-1).last_disc;
    chunks.push({ start, end: start + rows, first_disc: date, last_disc: date + span, url: `c${chunks.length}.json` });
    start += rows; date += span + 1;
  }
  const total = start;
  return { closed: false, mode: 'indexed', sourceId: 's', info: { catalog_id: 'c', counts: { discovery_export: total }, chunks },
    countThrough(jd) { for (const c of chunks) { if (jd < c.first_disc) return c.start; if (jd <= c.last_disc) return c.start + Math.ceil(rows * (jd - c.first_disc + 1) / (c.last_disc - c.first_disc + 1)); } return total; },
    read() { return { [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }) }; }, close() { this.closed = true; } };
}
const spans = [365 * 20, 365 * 5, 365, 120, 60, 30, 30, 30, 30, 30, 30, 30, 365 * 10];
function playing(source, date, daysPerSecond) {
  const loader = new CatalogLoader({ activate() {}, commit() {}, changed() {} });
  loader.activate(source, date);
  loader.request?.controller.abort(); loader.request = null;
  loader.initialRendered = true;
  loader.demand(date, { playing: true, hidden: false, daysPerSecond });
  return loader;
}
const chunkOf = (source, end) => source.info.chunks.findIndex(c => c.end === end) + 1;

test('paused or hidden playback reads only the required chunks', () => {
  const source = makeSource(spans);
  const date = source.info.chunks[1].first_disc + 10;
  const loader = playing(source, date, 480);
  loader.demand(date, { playing: false });
  assert.equal(chunkOf(source, loader.targetEnd()), 2);
  loader.demand(date, { playing: true, hidden: true });
  assert.equal(chunkOf(source, loader.targetEnd()), 2);
});

test('slow years keep the minimum chunk lookahead', () => {
  const source = makeSource(spans);
  const loader = playing(source, source.info.chunks[0].first_disc + 100, 90);
  assert.equal(chunkOf(source, loader.targetEnd()), 1 + MIN_LOOKAHEAD_CHUNKS);
});

test('fast playback through dense years covers LOOKAHEAD_SECONDS of simulated time', () => {
  const source = makeSource(spans);
  const date = source.info.chunks[4].first_disc;
  const loader = playing(source, date, 180 / LOOKAHEAD_SECONDS);
  const horizon = date + 180;
  const covered = source.info.chunks.filter(c => c.first_disc <= horizon).length;
  assert(covered > 5 + MIN_LOOKAHEAD_CHUNKS, 'fixture exercises the time-based branch');
  assert.equal(chunkOf(source, loader.targetEnd()), covered);
  loader.demand(date, { daysPerSecond: 90 / LOOKAHEAD_SECONDS });
  assert.equal(chunkOf(source, loader.targetEnd()), 5 + MIN_LOOKAHEAD_CHUNKS, 'lower speed shrinks the target');
  loader.demand(date, { daysPerSecond: -4800 });
  assert.equal(chunkOf(source, loader.targetEnd()), 5 + MIN_LOOKAHEAD_CHUNKS, 'reverse playback needs no forward horizon');
});

test('a discovery-date tie crossing chunks at the horizon includes every tied chunk', () => {
  // Chunk 4 ends exactly at the horizon; chunks 5 to 8 all start on that same
  // date, beyond the minimum-chunk floor of 5 + MIN_LOOKAHEAD_CHUNKS.
  const source = makeSource([365 * 20, 365 * 5, 365, 120, 180, 0, 0, 0, 0, 30, 30, 30, 365 * 10]);
  const date = source.info.chunks[4].first_disc;
  const loader = playing(source, date, 180 / LOOKAHEAD_SECONDS);
  const horizon = date + 180;
  assert.equal(source.info.chunks[4].last_disc, horizon);
  assert.equal(source.info.chunks[8].first_disc, horizon);
  assert(source.info.chunks[9].first_disc > horizon);
  assert.equal(chunkOf(source, loader.targetEnd()), 9);
  assert(loader.targetEnd() >= source.countThrough(horizon), 'every discovery at or before the horizon is targeted');
});

test('lookahead is capped at the catalogue end and speed must be finite', () => {
  const source = makeSource(spans);
  const last = source.info.chunks.at(-1);
  const loader = playing(source, last.first_disc + 1, 1e6);
  assert.equal(loader.targetEnd(), source.info.counts.discovery_export);
  assert.throws(() => loader.demand(last.first_disc, { daysPerSecond: NaN }), /playback speed/);
});
