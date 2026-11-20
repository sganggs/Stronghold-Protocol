// Transport policy is independent of the variable-length binParts format and the unchanged mesh layout.
export const SCENE_BIN_PART_BYTES = 15_000_000;
export const SCENE_TRANSPORT_LIMITS = Object.freeze({ maxBytes: 60_000_000, maxParts: 256 });

/** Validate all part sizes before allocation or reads. Manifest keys derive from array indices. */
export function sceneBinParts(doc, limits = SCENE_TRANSPORT_LIMITS) {
  const parts = doc?.binParts;
  if (!Number.isSafeInteger(limits?.maxBytes) || limits.maxBytes <= 0
    || !Number.isSafeInteger(limits?.maxParts) || limits.maxParts <= 0
    || !Number.isSafeInteger(doc?.binBytes) || doc.binBytes <= 0 || doc.binBytes > limits.maxBytes
    || !Array.isArray(parts) || !parts.length || parts.length > limits.maxParts) return null;
  const sizes = [];
  let total = 0;
  for (const size of parts) {
    if (!Number.isSafeInteger(size) || size <= 0 || size > SCENE_BIN_PART_BYTES
      || size > limits.maxBytes - total) return null;
    sizes.push(size);
    total += size;
  }
  return total === doc.binBytes ? sizes : null;
}

/** One destination, one awaited part at a time. Incomplete data never reaches the mesh parser. */
export async function readSceneBuffer(doc, readPart, limits = SCENE_TRANSPORT_LIMITS) {
  const sizes = sceneBinParts(doc, limits);
  if (!sizes || typeof readPart !== 'function') return null;
  try {
    const joined = new Uint8Array(doc.binBytes);
    let offset = 0;
    for (let i = 0; i < sizes.length; i++) {
      let bytes = await readPart(i ? `bin${i}` : 'bin');
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== sizes[i]) return null;
      joined.set(new Uint8Array(bytes), offset);
      offset += sizes[i];
      bytes = null; // Do not retain this response across the next await; collection timing belongs to the browser.
    }
    return joined.buffer;
  } catch { return null; }
}
