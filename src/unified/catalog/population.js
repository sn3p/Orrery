export const CLASS_OTHER = 0;
export const CLASS_NEA = 1;
export const CLASS_TROJAN = 2;
export const CLASS_DISTANT = 3;
export const CLASS_BELT_INNER = 4;
export const CLASS_BELT_MIDDLE = 5;
export const CLASS_BELT_OUTER = 6;
export const CLASS_HILDA = 7;
export const CLASS_HUNGARIA = 8;
export const CLASS_COUNT = 9;

export const JUPITER_AU = 5.204;
export const NEA_PERIHELION_AU = 1.3;
export const TROJAN_A_MIN = 4.8;
export const TROJAN_A_MAX = 5.4;
export const TROJAN_E_MAX = 0.3;
// Kirkwood gaps split the belt at 2.50 and 2.82 AU; 3.28 AU is its outer edge.
export const BELT_INNER_MAX_AU = 2.5;
export const BELT_MIDDLE_MAX_AU = 2.82;
export const HILDA_A_MIN = 3.7;
export const HILDA_A_MAX = 4.2;
export const HUNGARIA_A_MAX = 2.0;
export const HUNGARIA_I_MIN = 16;
export const HUNGARIA_I_MAX = 34;
export const HUNGARIA_E_MAX = 0.18;

// The three zones are the doughnut. Hildas and Hungarias sit beside it and
// stay when the belt is hidden.
export const BELT_MASK = (1 << CLASS_BELT_INNER) | (1 << CLASS_BELT_MIDDLE) | (1 << CLASS_BELT_OUTER);
const ALL_MASK = (1 << CLASS_COUNT) - 1;
const MINORITY_MASK = (1 << CLASS_NEA) | (1 << CLASS_TROJAN) | (1 << CLASS_DISTANT);
const EDGE_MASK = (1 << CLASS_HILDA) | (1 << CLASS_HUNGARIA);
// Trial switch: with group colors on, All paints the belt zones too. False
// keeps the belt gray on All and paints the zones only on the belt presets.
export const PAINT_BELT_ON_ALL = true;

export const DEFAULT_POPULATION_PRESET = "all";

export const POPULATION_PRESETS = {
  all: "all",
  nea: "nea",
  hungarias: "hungarias",
  belt: "belt",
  beltInner: "belt-inner",
  beltMiddle: "belt-middle",
  beltOuter: "belt-outer",
  hildas: "hildas",
  trojans: "trojans",
  distant: "distant",
  withoutBelt: "without-belt",
};

// Sun outward, then the exclusion.
export const POPULATION_PRESET_OPTIONS = {
  All: "all",
  "Near Earth": "nea",
  Hungarias: "hungarias",
  "Main belt": "belt",
  "Inner belt": "belt-inner",
  "Middle belt": "belt-middle",
  "Outer belt": "belt-outer",
  Hildas: "hildas",
  "Jupiter Trojans": "trojans",
  Distant: "distant",
  "Without the belt": "without-belt",
};

export const POPULATION_PRESET_HINTS = {
  all: "Numbered minor planets with known discovery dates. Most are in the main belt.",
  nea: "Perihelion closer than 1.3 AU. Sparse at 1980; this numbered catalog is a sample.",
  hungarias: "Inside 2 AU on tilted orbits (16–34°). A ring inside the belt edge; the tilt reads in 3D.",
  belt: "The doughnut between Mars and Jupiter: inner, middle and outer zones by orbit size.",
  "belt-inner": "Orbits smaller than 2.5 AU, up to the first Kirkwood gap. The densest zone.",
  "belt-middle": "Orbits between 2.5 and 2.82 AU, between two Kirkwood gaps.",
  "belt-outer": "Orbits from 2.82 AU out to the belt edge near 3.3 AU, Cybeles included.",
  hildas: "Orbits near 4 AU in a 3:2 resonance with Jupiter. A triangle locked to the planet.",
  trojans: "Share Jupiter’s orbit (L4/L5). Thin at 1980; swarms read after the 2000s.",
  distant: "Beyond Jupiter, grouped by orbit shape in this app, not official MPC types.",
  "without-belt": "Hide the main-belt doughnut. Near Earth, Hungarias, Hildas, Trojans and distant remain.",
};

const PRESET_MASKS = {
  all: ALL_MASK,
  nea: 1 << CLASS_NEA,
  hungarias: 1 << CLASS_HUNGARIA,
  belt: BELT_MASK,
  "belt-inner": 1 << CLASS_BELT_INNER,
  "belt-middle": 1 << CLASS_BELT_MIDDLE,
  "belt-outer": 1 << CLASS_BELT_OUTER,
  hildas: 1 << CLASS_HILDA,
  trojans: 1 << CLASS_TROJAN,
  distant: 1 << CLASS_DISTANT,
  "without-belt": ALL_MASK ^ BELT_MASK,
};

// Resting hues. #00ff00 stays the arrival color and is not a class color.
// The belt is one rose hue, light to dark from the inner to the outer zone.
export const CLASS_REST_COLOR = {
  [CLASS_NEA]: 0x2ec4b6,
  [CLASS_TROJAN]: 0xd4a017,
  [CLASS_DISTANT]: 0xa78bfa,
  [CLASS_BELT_INNER]: 0xffb3c6,
  [CLASS_BELT_MIDDLE]: 0xf0567a,
  [CLASS_BELT_OUTER]: 0xa3244a,
  [CLASS_HILDA]: 0x4f86f7,
  [CLASS_HUNGARIA]: 0xff8a3d,
};

const HIGHLIGHT_MASKS = {
  all: PAINT_BELT_ON_ALL ? ALL_MASK ^ (1 << CLASS_OTHER) : MINORITY_MASK | EDGE_MASK,
  "without-belt": MINORITY_MASK | EDGE_MASK,
};

export function isPopulationPreset(value) {
  return Object.hasOwn(PRESET_MASKS, value);
}

export function populationMask(preset) {
  return PRESET_MASKS[preset] ?? PRESET_MASKS[DEFAULT_POPULATION_PRESET];
}

// The menu chooses which points are drawn. Group colors only paints that set:
// a single group takes its hue, and the belt on All follows PAINT_BELT_ON_ALL.
export function highlightMask(preset, colorize = false) {
  if (!colorize || !isPopulationPreset(preset)) return 0;
  return HIGHLIGHT_MASKS[preset] ?? PRESET_MASKS[preset];
}

// Packed for a vec3 uniform array indexed by class id; unpainted ids are black
// and never reach the shader because the color mask excludes them.
export function classColorArray() {
  const colors = new Float32Array(CLASS_COUNT * 3);
  for (const [id, hex] of Object.entries(CLASS_REST_COLOR)) colors.set(colorChannels(hex), id * 3);
  return colors;
}

// colorName is the spoken hue for the legend; the swatch itself is only CSS.
const LEGEND_GROUPS = [
  { id: CLASS_NEA, name: "Near Earth", color: CLASS_REST_COLOR[CLASS_NEA], colorName: "teal" },
  { id: CLASS_HUNGARIA, name: "Hungarias", color: CLASS_REST_COLOR[CLASS_HUNGARIA], colorName: "orange" },
  { id: CLASS_BELT_INNER, name: "Inner belt", color: CLASS_REST_COLOR[CLASS_BELT_INNER], colorName: "light rose" },
  { id: CLASS_BELT_MIDDLE, name: "Middle belt", color: CLASS_REST_COLOR[CLASS_BELT_MIDDLE], colorName: "rose" },
  { id: CLASS_BELT_OUTER, name: "Outer belt", color: CLASS_REST_COLOR[CLASS_BELT_OUTER], colorName: "dark rose" },
  { id: CLASS_HILDA, name: "Hildas", color: CLASS_REST_COLOR[CLASS_HILDA], colorName: "blue" },
  { id: CLASS_TROJAN, name: "Jupiter Trojans", color: CLASS_REST_COLOR[CLASS_TROJAN], colorName: "gold" },
  { id: CLASS_DISTANT, name: "Distant", color: CLASS_REST_COLOR[CLASS_DISTANT], colorName: "violet" },
];

export function legendGroups(preset, colorize = false) {
  const mask = highlightMask(preset, colorize);
  return LEGEND_GROUPS.filter(group => mask & (1 << group.id));
}

export function colorChannels(hex) {
  return [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
}

export function populationHint(preset) {
  return POPULATION_PRESET_HINTS[preset] ?? POPULATION_PRESET_HINTS[DEFAULT_POPULATION_PRESET];
}

// Inclination is in degrees. Leftovers join the nearest zone: Mars-crossers
// are inner, Cybeles and the thin stretch up to Jupiter are outer.
export function classifyOrbit(a, e, i = 0) {
  const q = a * (1 - e);
  if (q < NEA_PERIHELION_AU) return CLASS_NEA;
  if (a > TROJAN_A_MIN && a < TROJAN_A_MAX && e < TROJAN_E_MAX) return CLASS_TROJAN;
  if (a >= JUPITER_AU) return CLASS_DISTANT;
  if (a >= HILDA_A_MIN && a < HILDA_A_MAX) return CLASS_HILDA;
  if (a < HUNGARIA_A_MAX && i >= HUNGARIA_I_MIN && i <= HUNGARIA_I_MAX && e <= HUNGARIA_E_MAX) return CLASS_HUNGARIA;
  if (a < BELT_INNER_MAX_AU) return CLASS_BELT_INNER;
  if (a < BELT_MIDDLE_MAX_AU) return CLASS_BELT_MIDDLE;
  return CLASS_BELT_OUTER;
}

export function classifyCatalogue(data) {
  const classes = new Uint8Array(data.length);
  const sorted = Array.from({ length: data.length }, (_, index) => index)
    .sort((a, b) => data[a].disc - data[b].disc);
  sorted.forEach((sourceIndex, index) => {
    const row = data[sourceIndex];
    classes[index] = classifyOrbit(row.a, row.e, row.i);
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
