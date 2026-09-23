import { formatIsoDay, parseIsoDay, toJED } from "../js/utils.js";
import { validDate } from "../js/asteroidOrbits.js";
import { DEFAULT_RENDERER } from "./renderers.js";

export function parseShareDate(value) {
  const date = parseIsoDay(value);
  if (!date) return null;
  const jed = toJED(date);
  return validDate(jed) ? jed : null;
}

export function shareSearch({ renderer, date, defaultRenderer = DEFAULT_RENDERER } = {}, currentSearch = "") {
  const params = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);
  if (renderer && renderer !== defaultRenderer) params.set("renderer", renderer);
  else params.delete("renderer");
  if (date !== undefined) {
    if (date) params.set("date", date);
    else params.delete("date");
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}

export function replaceShareUrl(state, loc = typeof location === "undefined" ? null : location,
  hist = typeof history === "undefined" ? null : history) {
  if (!loc || typeof hist?.replaceState !== "function") return;
  const search = shareSearch(state, loc.search);
  const next = `${loc.pathname}${search}${loc.hash}`;
  const current = `${loc.pathname}${loc.search}${loc.hash}`;
  if (next === current) return;
  try { hist.replaceState(hist.state, "", next); }
  catch { /* file: URLs and sandboxed histories may reject replacement. */ }
}

export function shareDateValue(jed, startJed) {
  if (!Number.isFinite(jed)) return null;
  const day = formatIsoDay(jed);
  return Number.isFinite(startJed) && day === formatIsoDay(startJed) ? null : day;
}
