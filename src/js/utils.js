import { UNIX_EPOCH_JULIAN_DATE } from "./constants.js";

// Gregorian to Julian date
export function toJED(d) {
  return d / 86400000 + UNIX_EPOCH_JULIAN_DATE;
}

// Julian to Gregorian date
export function fromJED(jed) {
  return new Date(86400000 * (-UNIX_EPOCH_JULIAN_DATE + jed));
}

// ISO uses a sign and six-digit year outside 0000–9999, so fixed-width
// slicing would truncate otherwise valid dates from the supported Date range.
export function formatIsoDay(jed) {
  return fromJED(jed).toISOString().split("T", 1)[0];
}

export function parseIsoDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) return null;
  return date;
}
