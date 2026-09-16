import { requireValue } from "./contract.js";

// Speculative reads while playing cover this much playback at the current
// speed. Chunks are cut by row count in discovery order, so a fixed chunk count
// spans years in the 1980s but under half a second of speed-8 playback in the
// 2000s; a time-based target keeps one fetch round trip from stalling a frame.
export const LOOKAHEAD_SECONDS = 3;
export const MIN_LOOKAHEAD_CHUNKS = 3;

// Playback needs a retained prefix, not arbitrary interval merging. Source reads
// own ordered verification; this layer owns ordered CPU commitment and demand.
// The application separately supplies a receipt from the active renderer.
export default class CatalogLoader {
  constructor({ activate, commit, changed, retryDelays = [250, 1000] }) {
    this.activateCloud = activate;
    this.commitCloud = commit;
    this.changed = changed;
    this.retryDelays = retryDelays;
    this.generation = 0;
    this.disposed = false;
    this.clear();
  }

  clear() {
    this.generation++;
    this.request?.controller.abort();
    this.source?.close();
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.source = null;
    this.request = null;
    this.committedCount = 0;
    this.graphicsCount = 0;
    this.graphicsValid = false;
    this.initialRendered = false;
    this.error = null;
    this.errorKind = null;
    this.failedRequiredCount = 0;
    this.failures = 0;
  }

  activate(source, date) {
    requireValue(!this.disposed && !source.closed, "loader source");
    requireValue(Number.isFinite(date), "Julian day");
    this.clear();
    this.source = source;
    this.date = date;
    this.playing = false;
    this.hidden = false;
    this.daysPerSecond = 0;
    this.activateCloud(source.info.counts.discovery_export);
    this.changed();
    this.pump();
  }

  get requiredCount() { return this.source ? this.source.countThrough(this.date) : 0; }
  get buffering() { return !!this.source && this.requiredCount > this.committedCount; }
  readyToDraw(date) { return !!this.source && this.source.countThrough(date) <= this.committedCount; }
  sceneComplete(date = this.date) {
    return this.graphicsValid && this.readyToDraw(date) && this.source.countThrough(date) <= this.graphicsCount;
  }

  demand(date, { playing = this.playing, hidden = this.hidden, daysPerSecond = this.daysPerSecond } = {}) {
    if (this.disposed || !this.source) return false;
    requireValue(Number.isFinite(daysPerSecond), "playback speed");
    const required = this.source.countThrough(date);
    const resume = (!this.playing && playing) || (this.hidden && !hidden);
    this.date = date;
    this.playing = playing;
    this.hidden = hidden;
    this.daysPerSecond = daysPerSecond;
    this.cancelUnneededRead();
    // A speculative failure gets a fresh bounded attempt once those records
    // become necessary. Recovery signals may also retry a required read, but
    // repeated frames at the same blocked date cannot create a retry loop.
    if (this.errorKind === "read" && ((this.buffering && required > this.failedRequiredCount) || resume)) this.retry();
    this.pump();
    return this.readyToDraw(date);
  }

  cancelUnneededRead() {
    if (this.request && this.request.end > this.targetEnd() && !this.buffering) this.request.controller.abort();
  }

  targetEnd() {
    const count = this.requiredCount, total = this.source.info.counts.discovery_export;
    if (this.source.mode === "whole") return count ? total : 0;
    const chunks = this.source.info.chunks;
    const requiredChunks = count ? this.chunkIndex(chunk => chunk.end < count) + 1 : 0;
    if (!(this.initialRendered && this.playing && !this.hidden)) return chunks[requiredChunks - 1]?.end ?? 0;
    // Reverse playback only needs the committed prefix; forward playback covers
    // LOOKAHEAD_SECONDS of simulated time, never fewer than MIN_LOOKAHEAD_CHUNKS.
    const horizon = this.date + Math.max(0, this.daysPerSecond) * LOOKAHEAD_SECONDS;
    const horizonChunks = this.chunkIndex(chunk => chunk.last_disc < horizon) + 1;
    const target = Math.min(chunks.length, Math.max(requiredChunks + MIN_LOOKAHEAD_CHUNKS, horizonChunks));
    return chunks[target - 1]?.end ?? 0;
  }

  // First chunk index for which `before` is false; chunks are ordered by rows and dates.
  chunkIndex(before) {
    const chunks = this.source.info.chunks;
    let lo = 0, hi = chunks.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (before(chunks[mid])) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  accept(event, generation) {
    if (this.disposed || generation !== this.generation || !this.source
      || event.sourceId !== this.source.sourceId || event.catalogId !== this.source.info.catalog_id) return false;
    if (event.end <= this.committedCount) return false;
    requireValue(event.type === "batch" && event.start === this.committedCount, "noncontiguous commitment");
    // Synchronous preparation validates the complete batch before extending
    // the retained CPU prefix; graphics commitment is acknowledged separately.
    this.commitCloud(event);
    this.committedCount = event.end;
    this.failures = 0;
    this.cancelUnneededRead();
    this.changed();
    return true;
  }

  rendered(count = this.committedCount) {
    if (!this.source || this.disposed) return;
    requireValue(Number.isSafeInteger(count) && count >= 0 && count <= this.committedCount, "graphics prefix");
    this.graphicsCount = count;
    this.graphicsValid = true;
    if (this.sceneComplete(this.date)) this.initialRendered = true;
    this.pump();
  }

  loseGraphics() { this.graphicsValid = false; this.changed(); }

  pump() {
    if (!this.source || this.disposed || this.request || this.retryTimer || this.error) return;
    const end = this.targetEnd(), start = this.committedCount;
    if (end <= start) return;
    const generation = this.generation, source = this.source, controller = new AbortController();
    const request = this.request = { start, end, controller };
    request.done = (async () => {
      try {
        for await (const event of source.read({ start, end }, { signal: controller.signal })) {
          if (generation !== this.generation || this.disposed) break;
          if (event.type === "batch") {
            try { this.accept(event, generation); }
            catch (error) {
              // Valid producer data may exceed this renderer's Float32 limits.
              // Re-fetching cannot fix preparation or commitment exceptions.
              this.error = error;
              this.errorKind = "commit";
              this.changed();
              return;
            }
          }
        }
      } catch (error) {
        if (generation !== this.generation || this.disposed || error.name === "AbortError") return;
        if (this.failures < this.retryDelays.length) {
          const delay = this.retryDelays[this.failures++];
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            if (generation === this.generation && !this.disposed) this.pump();
          }, delay);
        } else {
          this.error = error;
          this.errorKind = "read";
          this.failedRequiredCount = this.requiredCount;
        }
        this.changed();
      } finally {
        if (generation === this.generation && this.request === request) {
          this.request = null;
          this.pump();
        }
      }
    })();
  }

  retry() {
    if (this.disposed || this.errorKind === "commit") return;
    this.error = null;
    this.errorKind = null;
    this.failures = 0;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.changed();
    this.pump();
  }

  dispose() {
    if (this.disposed) return;
    this.clear();
    this.disposed = true;
  }
}
