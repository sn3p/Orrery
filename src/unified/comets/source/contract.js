// Comet-used helpers from OrreryData; MIT lineage and local adaptations in README.md.
export const requireValue = (ok, label, product = "catalogue") => { if (!ok) throw new Error(`Invalid ${product} ${label}.`); };
export function keys(value, expected, optional = [], product = "catalogue") {
  requireValue(value !== null && typeof value === "object" && !Array.isArray(value)
    && expected.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => expected.includes(key) || optional.includes(key)), "fields", product);
}

// Native parsing supplies JSON syntax checks. A bounded-depth lexical pass also
// rejects duplicate keys, including escaped aliases, which JSON.parse discards.
export function parseJSON(text, product = "catalogue") {
  const value = JSON.parse(text);
  const stack = [];
  const tokens = /"(?:[^"\\]|\\[\s\S])*"|[{}\[\]:,]/g;
  let match;
  try {
    while ((match = tokens.exec(text))) {
      const token = match[0], top = stack.at(-1);
      if (token === "{" || token === "[") {
        requireValue(stack.length < 32, "JSON nesting", product);
        stack.push(token === "{" ? { keys: new Set(), key: true } : {});
      } else if (token === "}" || token === "]") stack.pop();
      else if (token === ":" && top?.keys) top.key = false;
      else if (token === "," && top?.keys) top.key = true;
      else if (token[0] === '"' && top?.keys && top.key) {
        const key = JSON.parse(token);
        requireValue(!top.keys.has(key), "duplicate JSON key", product);
        top.keys.add(key);
      }
    }
  } finally {
    // Engines retain the last successful regexp input through legacy RegExp.$_.
    // Don't retain a whole-file JSON string on success or validation failure.
    /^$/.test("");
  }
  return value;
}

export function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export async function verifyBytes(bytes, ref, product = "catalogue") {
  requireValue(bytes.byteLength === ref.bytes, `byte length for ${ref.url}`, product);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
  requireValue(hash === ref.sha256, `checksum for ${ref.url}`, product);
}
