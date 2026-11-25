const words = value => String(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const compact = value => words(value).replaceAll(' ', '');
export function searchComets(catalogue, query) {
  const needle = compact(query);
  if (!needle) return catalogue;
  return catalogue.map((entry, index) => {
    const name = words(entry.name), designation = compact(entry.designation ?? entry.id);
    const rank = designation === needle ? 0
      : name.split(' ').some((_, i, parts) => parts.slice(i).join('').startsWith(needle)) ? 1
      : designation.startsWith(needle) ? 2
      : compact(name).includes(needle) || designation.includes(needle) ? 3 : 4;
    return { entry, index, rank };
  }).filter(item => item.rank < 4).sort((a, b) => a.rank - b.rank || a.index - b.index).map(item => item.entry);
}
