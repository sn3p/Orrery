// Shared bounded transport and cancellation for pinned browser data products.
import { requireValue, parseJSON, verifyBytes } from './contract.js';

const title = product => product[0].toUpperCase() + product.slice(1);
export const aborted = (product = 'catalogue') => new DOMException(`${title(product)} read cancelled.`, 'AbortError');
export const check = (signal, product = 'catalogue') => { if (signal?.aborted) throw aborted(product); };
export const decodeJSON = (bytes, product = 'catalogue') => parseJSON(new TextDecoder('utf-8', { fatal: true }).decode(bytes), product);

export function linkCancellation(controller, signals) {
  if (signals.some(signal => signal.aborted)) { controller.abort(); return () => {}; }
  const cancel = () => controller.abort();
  for (const signal of signals) signal.addEventListener('abort', cancel, { once: true });
  return () => { for (const signal of signals) signal.removeEventListener('abort', cancel); };
}

async function readBounded(response, max, label, signal, product, exact = false) {
  check(signal, product);
  requireValue(response.body !== null && response.body !== undefined, `${label} (missing response body)`, product);
  const bytes = new Uint8Array(max), reader = response.body.getReader();
  let length = 0;
  try {
    while (true) {
      check(signal, product);
      const { value, done } = await reader.read();
      check(signal, product);
      if (done) break;
      requireValue(length + value.length <= bytes.length, label, product);
      bytes.set(value, length); length += value.length;
    }
    if (exact) requireValue(length === max, label, product);
    return exact ? bytes : bytes.subarray(0, length);
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function fetchVerified(ref, url, signal, product = 'catalogue') {
  try {
    check(signal, product);
    const response = await fetch(url, { signal, redirect: 'error' });
    check(signal, product);
    if (!response.ok) throw new Error(`${title(product)} request failed (${response.status}): ${ref.url}`);
    // Content-Length can describe compressed HTTP bytes. Enforce the trusted
    // decoded length while streaming before allocating/parsing oversized bodies.
    const bytes = await readBounded(response, ref.bytes, `byte length for ${ref.url}`, signal, product, true);
    check(signal, product);
    await verifyBytes(bytes, ref, product);
    check(signal, product);
    return bytes;
  } catch (error) {
    check(signal, product);
    throw error;
  }
}

export async function fetchLatest(url, signal, product = 'catalogue') {
  try {
    const location = new URL(url);
    // URL parsing normalizes IPv4 spellings and compressed IPv6 addresses.
    const loopback = ['localhost', 'localhost.', '[::1]'].includes(location.hostname)
      || /^127(?:\.\d{1,3}){3}$/.test(location.hostname);
    requireValue((location.protocol === 'https:' || (location.protocol === 'http:' && loopback))
      && !location.username && !location.password, 'latest URL (HTTPS required outside loopback)', product);
    check(signal, product);
    const response = await fetch(location.href, { signal, cache: 'no-cache', redirect: 'error' });
    check(signal, product);
    if (!response.ok) throw new Error(`${title(product)} discovery failed (${response.status}).`);
    const bytes = await readBounded(response, 4096, 'latest descriptor size', signal, product);
    check(signal, product);
    return { location, latest: decodeJSON(bytes, product) };
  } catch (error) {
    check(signal, product);
    throw error;
  }
}
