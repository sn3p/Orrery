// Moving discovery resolves once to two immutable, independently verified products.
import { keys, requireValue, validatePin } from '../../catalog/contract.js';
import { validateNamedReference } from './NamedBodySource.js';
import { fetchLatest, validatedURL } from './transport.js';

export function validatePairedURL(value) {
  requireValue(typeof value === 'string', 'paired URL');
  const url = validatedURL(value);
  requireValue(!url.search && !url.hash, 'paired URL');
  return url.href;
}
export function validatePairedSelection(selection) {
  if (selection.pairedLatest === undefined) return;
  validatePairedURL(selection.pairedLatest);
  requireValue((selection.mode ?? 'indexed') === 'indexed'
    && ['pin', 'latest', 'namedBodies', 'bundle', 'archive', 'retained'].every(key => selection[key] === undefined), 'conflicting paired selection');
}
export async function resolvePairedLatest(url, { signal } = {}) {
  const { latest } = await fetchLatest(validatePairedURL(url), signal, 'paired catalogue');
  keys(latest, ['paired_catalogue_version', 'asteroids', 'namedBodies']);
  requireValue(latest.paired_catalogue_version === 1, 'paired version');
  validatePin(latest.asteroids);
  validateNamedReference(latest.namedBodies);
  for (const ref of [latest.asteroids, latest.namedBodies]) validatePairedURL(ref.url);
  return { pin: latest.asteroids, namedBodies: latest.namedBodies };
}
