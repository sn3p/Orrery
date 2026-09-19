export const CLASS_OTHER = 0;
export const CLASS_NEA = 1;
export const CLASS_TROJAN = 2;
export const CLASS_DISTANT = 3;
export const CLASS_BELT = 4;
export const CLASS_COUNT = 5;

export const JUPITER_AU = 5.204;
export const NEA_PERIHELION_AU = 1.3;
export const TROJAN_A_MIN = 4.8;
export const TROJAN_A_MAX = 5.4;
export const TROJAN_E_MAX = 0.3;

export const DEFAULT_POPULATION_PRESET = "all";

export const POPULATION_PRESETS = {
  all: "all",
  nea: "nea",
  trojans: "trojans",
  distant: "distant",
  withoutBelt: "without-belt",
};

export const POPULATION_PRESET_OPTIONS = {
  All: "all",
  "Near Earth": "nea",
  "Jupiter Trojans": "trojans",
  Distant: "distant",
  "Without the belt": "without-belt",
};

export const POPULATION_PRESET_HINTS = {
  all: "Numbered minor planets with known discovery dates. Most are in the main belt.",
  nea: "Perihelion closer than 1.3 AU. Sparse at 1980; this numbered catalog is a sample.",
  trojans: "Share Jupiter’s orbit (L4/L5). Thin at 1980; swarms read after the 2000s.",
  distant: "Beyond Jupiter, grouped by orbit shape in this app, not official MPC types.",
  "without-belt": "Hide the main-belt doughnut. Near Earth, Trojans and distant remain.",
};

const PRESET_MASKS = {
  all: (1 << CLASS_COUNT) - 1,
  nea: 1 << CLASS_NEA,
  trojans: 1 << CLASS_TROJAN,
  distant: 1 << CLASS_DISTANT,
  "without-belt": ((1 << CLASS_COUNT) - 1) ^ (1 << CLASS_BELT),
};

export function isPopulationPreset(value) {
  return Object.hasOwn(PRESET_MASKS, value);
}

export function populationMask(preset) {
  return PRESET_MASKS[preset] ?? PRESET_MASKS[DEFAULT_POPULATION_PRESET];
}

export function populationHint(preset) {
  return POPULATION_PRESET_HINTS[preset] ?? POPULATION_PRESET_HINTS[DEFAULT_POPULATION_PRESET];
}

export function classifyOrbit(a, e) {
  const q = a * (1 - e);
  if (q < NEA_PERIHELION_AU) return CLASS_NEA;
  if (a > TROJAN_A_MIN && a < TROJAN_A_MAX && e < TROJAN_E_MAX) return CLASS_TROJAN;
  if (a >= JUPITER_AU) return CLASS_DISTANT;
  return CLASS_BELT;
}

export function classifyCatalogue(data) {
  const classes = new Uint8Array(data.length);
  const sorted = Array.from({ length: data.length }, (_, index) => index)
    .sort((a, b) => data[a].disc - data[b].disc);
  sorted.forEach((sourceIndex, index) => {
    classes[index] = classifyOrbit(data[sourceIndex].a, data[sourceIndex].e);
  });
  return classes;
}

export function countClassTallies(classes, start, end, tallies = new Uint32Array(CLASS_COUNT)) {
  for (let i = start; i < end; i++) tallies[classes[i]]++;
  return tallies;
}

export function visibleFromTallies(tallies, preset) {
  const mask = populationMask(preset);
  let count = 0;
  for (let id = 0; id < CLASS_COUNT; id++) {
    if (mask & (1 << id)) count += tallies[id];
  }
  return count;
}

export function resyncClassTallies(classes, count, preset, tallies = new Uint32Array(CLASS_COUNT)) {
  tallies.fill(0);
  countClassTallies(classes, 0, count, tallies);
  return { tallies, tallyCount: count, visibleCount: visibleFromTallies(tallies, preset) };
}

export function advanceClassTallies(classes, from, to, preset, tallies) {
  if (to < from) {
    for (let i = to; i < from; i++) {
      const id = classes[i];
      if (!tallies[id]) return resyncClassTallies(classes, to, preset, tallies);
      tallies[id]--;
    }
  } else countClassTallies(classes, from, to, tallies);
  return { tallies, tallyCount: to, visibleCount: visibleFromTallies(tallies, preset) };
}

export const populationGLSL = `
float populationVisible(float classId, float classMask) {
  return step(0.5, mod(floor(classMask / exp2(floor(classId + 0.5))), 2.0));
}
`;
