// PNG width/height from the IHDR chunk. No Node Buffer, so a service worker can import it.

const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * @param {Uint8Array | ArrayBuffer} buf
 * @returns {{ width: number, height: number } | null}
 */
export function pngSize(buf) {
  const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf || []);
  if (b.length < 24) return null;
  for (let i = 0; i < 8; i++) if (b[i] !== SIG[i]) return null;
  if (b[12] !== 0x49 || b[13] !== 0x48 || b[14] !== 0x44 || b[15] !== 0x52) return null;
  const width = ((b[16] << 24) | (b[17] << 16) | (b[18] << 8) | b[19]) >>> 0;
  const height = ((b[20] << 24) | (b[21] << 16) | (b[22] << 8) | b[23]) >>> 0;
  if (!width || !height || width > 32768 || height > 32768) return null;
  return { width, height };
}
