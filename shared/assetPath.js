// File-name sanitizer shared by the asset pipeline and the browser cache.
// Keeps [A-Za-z0-9._-]; everything else (spaces, brackets, '#') becomes '_'.

/**
 * @param {string} name
 * @returns {string}
 */
export function safeName(name) {
  const s = String(name).replace(/[^A-Za-z0-9._-]/g, '_');
  return s.length ? s : '_';
}
