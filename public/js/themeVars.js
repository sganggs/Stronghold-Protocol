// Theme variables of the player's switched-on cosmetic plugins (DESIGN §34.14).
// Applied on this page only, with element.style.setProperty — no stylesheet, so a page's CSP stays as it is.
// A value is checked again here (shared/plugins/theme.js) before it is written. Switching a plugin off removes
// the properties it was the last to set. Nothing here is sent to the server or to another player.

import { acceptThemeValue } from '../../shared/plugins/theme.js';

/**
 * Write `winners` onto `root` and remove names in `previous` that are no longer set.
 * A missing root, or a root without a style, applies nothing and returns an empty set.
 * @param {HTMLElement | null | undefined} root
 * @param {{ name?: string, value?: string }[]} winners
 * @param {Set<string> | null | undefined} previous
 * @returns {Set<string>} the names now set
 */
export function applyThemeProperties(root, winners, previous) {
  const prev = previous instanceof Set ? previous : new Set();
  const next = new Set();
  if (!root?.style?.setProperty || !root.style.removeProperty) return next;
  const list = Array.isArray(winners) ? winners : [];
  for (const w of list) {
    if (typeof w?.name !== 'string') continue;
    const value = acceptThemeValue(w.name, w.value);
    if (!value) continue;
    root.style.setProperty(w.name, value);
    next.add(w.name);
  }
  for (const name of prev) if (!next.has(name)) root.style.removeProperty(name);
  return next;
}
