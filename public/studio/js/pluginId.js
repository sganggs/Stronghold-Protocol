// public/studio/js/pluginId.js — why a typed plugin id fails the create-plugin dialog (GitHub #701).
// The legal set is isPluginId (shared/plugins/manifest.js): /^[a-z0-9][a-z0-9-]{1,31}$/ — 2 to 32 characters,
// a lower-case letter or a digit first, then lower-case letters, digits and "-". `19p` is legal.
// [ASSUMED] No source ranks several faults. The dialog shows the first of: too short (under 2), an upper-case
// letter, a leading "-", a character outside that set, too long (over 32). An empty field is not a fault here:
// the dialog keeps the generic hint and leaves 创建插件 disabled while the id is still being suggested.

/** @typedef {'short' | 'upper' | 'lead' | 'char' | 'long'} PluginIdIssue */

/**
 * @param {unknown} id
 * @returns {PluginIdIssue | null} null when `id` is empty or legal
 */
export function pluginIdIssue(id) {
  if (typeof id !== 'string' || id.length === 0) return null;
  if (id.length < 2) return 'short';
  if (/[A-Z]/.test(id)) return 'upper';
  if (id.startsWith('-')) return 'lead';
  if (/[^a-z0-9-]/.test(id)) return 'char';
  if (id.length > 32) return 'long';
  return null;
}
