import { formatIsoDay, toJED } from "../js/utils.js";

// A simulation instant within one second of the wall clock counts as the present.
export const PRESENT_SLACK = 1 / 86400;
// Match PlaybackClock's per-frame cap so a live hold still ages discovery markers.
export const MAX_FRAME_SECONDS = 0.25;

export function currentJed(milliseconds = Date.now()) {
  const date = milliseconds instanceof Date ? milliseconds : new Date(milliseconds);
  return toJED(date);
}

export function frameSeconds(previous, timestamp) {
  if (previous == null || !Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.min((timestamp - previous) / 1000, MAX_FRAME_SECONDS));
}

// Free-running step. `speed` is jedDelta, already 0 while paused or held.
// `advance` is the story-clock day step; it is 0 while the wall clock is in charge.
export function stepPresent({ jed, advance, speed, hold, following, now }) {
  if (!hold || speed < 0) return { jed: jed + advance, following: false };
  if (!(speed > 0)) return { jed, following: !!following };
  if (following || jed + advance >= now) return { jed: now, following: true };
  return { jed: jed + advance, following: false };
}

// An explicit date. Future dates clamp to now while the hold is on.
// A past date leaves the wall clock until forward playback returns.
export function seekPresent({ jed, hold, now }) {
  if (!hold) return { jed, following: false };
  if (jed > now) return { jed: now, following: true };
  return { jed, following: jed >= now - PRESENT_SLACK };
}

// Turning the option on. A date already past now seeks back to the clock.
// A past date only arms the ceiling.
export function armPresent({ jed, now }) {
  if (jed > now) return { jed: now, following: true, seek: true };
  if (jed >= now - PRESENT_SLACK) return { jed, following: true, seek: false };
  return { jed, following: false, seek: false };
}

// Turning real time on. Today's calendar day, or any later instant, moves to
// the clock and plays forward. An earlier day only arms the ceiling.
export function engagePresent({ jed, now, speed, resumeSpeed = 0 }) {
  const onLiveDay = jed > now || formatIsoDay(jed) === formatIsoDay(now);
  if (!onLiveDay) return { jed, following: false, seek: false, speed };
  const next = speed > 0 ? speed : (resumeSpeed > 0 ? resumeSpeed : 1.5);
  return { jed: now, following: true, seek: jed > now || jed < now - PRESENT_SLACK, speed: next };
}
