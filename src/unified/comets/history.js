// Event dates are descriptive metadata, never simulation dates or visibility gates.
export function eventDate(date) {
  const year = date.year <= 0 ? `${1 - date.year} BCE` : String(date.year);
  const parts = [year];
  if (date.precision !== 'year') parts.push(String(date.month).padStart(2, '0'));
  if (date.precision === 'day') parts.push(String(date.day).padStart(2, '0'));
  return `${parts.join('-')} (${date.calendar === 'gregorian' ? 'Gregorian' : 'calendar unspecified'})`;
}
export function historyEvents(entry, sources) {
  return (entry.discovery?.events ?? []).map(event => ({
    text: `${eventDate(event.date)}: ${event.kind.replaceAll('_', ' ')}${event.people.length ? ` — ${event.people.join(', ')}` : ''}.`
      + (event.note ? ` ${event.note}` : ''),
    citations: event.sources.map(key => ({ label: key, url: sources[key].url })),
  }));
}
