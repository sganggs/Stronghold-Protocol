// canonical.mjs — the one canonical form both sides sign/verify over.
//
// Rule (locked in 最终执行方案-服务器清单与热更新.md §1.3): the signed payload is the JSON
// document with its `sig` field removed, serialized as UTF-8 with object keys sorted
// recursively, no insignificant whitespace and no trailing newline; array order is preserved.
//
// The Java verifier (CanonicalJson.java) implements exactly this, so a signature produced here
// verifies on-device. Keep the two in step — the interop test in tools/apk/../edtest guards it.

/**
 * Serializes a JSON value the way JSON.stringify would, except object keys are sorted.
 * Only JSON-representable values are accepted; numbers must be integers (the manifests carry
 * no floats, and integer formatting is the only form that round-trips identically in Java).
 */
export function canonicalize(value) {
  if (value === null || value === undefined) return 'null';
  const t = typeof value;
  if (t === 'number') {
    if (!Number.isFinite(value)) throw new Error('non-finite number in payload');
    if (!Number.isInteger(value)) throw new Error(`non-integer number in payload: ${value}`);
    return String(value);
  }
  if (t === 'boolean') return value ? 'true' : 'false';
  if (t === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (t === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
  }
  throw new Error(`unsupported value type in payload: ${t}`);
}

/** Canonical bytes of a document, ignoring its `sig` field. */
export function canonicalBytes(doc) {
  const { sig, ...rest } = doc;
  return Buffer.from(canonicalize(rest), 'utf8');
}
