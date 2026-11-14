// Colours of the official theme prefabs (prefabs.json stores #RRGGBB / #RRGGBBAA).

/** #RRGGBB / #RRGGBBAA → [r, g, b, a] (0–255, a 0–1); white when unreadable. @param {string|null|undefined} hex */
export function parseHex(hex) {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(String(hex || ''));
  if (!m) return [255, 255, 255, 1];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) / 255 : 1];
}

/** Base colour with a pose's channel overrides (0–1). @param {string|null|undefined} hex @param {any} over */
export function mixColor(hex, over) {
  const [r, g, b, a] = parseHex(hex);
  if (!over) return [r, g, b, a];
  return [
    over.r != null ? Math.round(over.r * 255) : r,
    over.g != null ? Math.round(over.g * 255) : g,
    over.b != null ? Math.round(over.b * 255) : b,
    over.a != null ? over.a : a,
  ];
}
