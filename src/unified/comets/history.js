// Event dates are descriptive metadata, never simulation dates or visibility gates.
export function eventDate(date) {
  const bce = date.year <= 0;
  const year = String(bce ? 1 - date.year : date.year);
  const parts = [year];
  if (date.precision !== 'year') parts.push(String(date.month).padStart(2, '0'));
  if (date.precision === 'day') parts.push(String(date.day).padStart(2, '0'));
  return `${parts.join('-')}${bce ? ' BCE' : ''} (${date.calendar === 'gregorian' ? 'Gregorian' : 'calendar unspecified'})`;
}
export function historyEvents(entry, sources) {
  return (entry.discovery?.events ?? []).map(event => ({
    text: `${eventDate(event.date)}: ${event.kind.replaceAll('_', ' ')}${event.certainty === 'day-disputed' ? ' (day disputed)' : ''}${event.people.length ? ` — ${event.people.join(', ')}` : ''}.`
      + (event.note ? ` ${event.note}` : ''),
    citations: event.sources.map(key => ({ label: key, url: sources[key].url })),
  }));
}
