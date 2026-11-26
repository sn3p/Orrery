// Keep transport failures distinct from integrity, schema and preparation errors.
export class CatalogueRequestError extends Error {
  constructor(message, { status = null, cause } = {}) {
    super(message, { cause });
    this.name = 'CatalogueRequestError';
    this.status = status;
  }
}
async function transport(operation, signal) {
  try { return await operation(); }
  catch (cause) {
    if (signal?.aborted || cause.name === 'AbortError') throw cause;
    throw new CatalogueRequestError('Catalogue network request failed.', { cause });
  }
}
export const request = (url, options) => transport(() => fetch(url, options), options?.signal);
export const readResponse = (reader, signal) => transport(() => reader.read(), signal);
export const isRequestFailure = error => error instanceof CatalogueRequestError;
export const isMissingResource = error => isRequestFailure(error) && [404, 410].includes(error.status);
