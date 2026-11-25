const words = value => String(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const compact = value => words(value).replaceAll(' ', '');
const indexes = new WeakMap();
export function searchComets(catalogue, query) {
  const needle = compact(query);
  if (!needle) return query.trim() ? [] : catalogue;
  let index = indexes.get(catalogue);
  if (!index) {
    index = catalogue.map(entry => {
      const parts = words(entry.name).split(' ');
      return {entry, terms: [entry.id, ...(entry.aliases ?? [])].map(compact), designation: compact(entry.designation ?? entry.id), name: parts.join(''),
        starts: parts.map((_, i) => parts.slice(i).join(''))};
    });
    indexes.set(catalogue, index);
  }
  const groups = [[], [], [], []];
  for (const item of index) {
    const rank = item.designation === needle ? 0
      : item.starts.some(start => start.startsWith(needle)) ? 1
      : item.designation.startsWith(needle) ? 2
      : item.terms.some(term => term.includes(needle)) || item.name.includes(needle) || item.designation.includes(needle) ? 3 : -1;
    if (rank >= 0) groups[rank].push(item.entry);
  }
  return groups.flat();
}
