// Transport policy is independent of the variable-length binParts format and the unchanged mesh layout.
export const SCENE_BIN_PART_BYTES = 15_000_000;
export const SCENE_TRANSPORT_LIMITS = Object.freeze({ maxBytes: 60_000_000, maxParts: 256 });

/** Validate the entire declaration before allocating or requesting a part. Keys index the asset manifest. */
export function sceneBinParts(doc, limits = SCENE_TRANSPORT_LIMITS) {
  const parts = doc?.binParts;
  if (!Number.isSafeInteger(limits?.maxBytes) || limits.maxBytes <= 0
    || !Number.isSafeInteger(limits?.maxParts) || limits.maxParts <= 0
    || !Number.isSafeInteger(doc?.binBytes) || doc.binBytes <= 0 || doc.binBytes > limits.maxBytes
    || !Array.isArray(parts) || !parts.length || parts.length > limits.maxParts) return null;
  let total = 0;
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part?.key !== (i ? `bin${i}` : 'bin') || !Number.isSafeInteger(part.bytes)
      || part.bytes <= 0 || part.bytes > SCENE_BIN_PART_BYTES || part.bytes > limits.maxBytes - total) return null;
    total += part.bytes;
  }
  return total === doc.binBytes ? parts : null;
}

/** One destination, one awaited part at a time. Incomplete data never reaches the mesh parser. */
export async function readSceneBuffer(doc, readPart, limits = SCENE_TRANSPORT_LIMITS) {
  const parts = sceneBinParts(doc, limits);
  if (!parts || typeof readPart !== 'function') return null;
  try {
    const joined = new Uint8Array(doc.binBytes);
    let offset = 0;
    for (const part of parts) {
      let bytes = await readPart(part.key);
      if (!(bytes instanceof ArrayBuffer) || bytes.byteLength !== part.bytes) return null;
      joined.set(new Uint8Array(bytes), offset);
      offset += part.bytes;
      bytes = null; // Do not retain this response across the next await; collection timing belongs to the browser.
    }
    return joined.buffer;
  } catch { return null; }
}
