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
