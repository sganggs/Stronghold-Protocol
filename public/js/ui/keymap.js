// Pure keyboard preferences shared by the settings UI and game shortcut dispatch.
// Codes represent physical keys; Escape stays reserved for closing / cancelling.

export const KEY_ACTIONS = Object.freeze(['refresh', 'freeze', 'levelUp', 'retreat', 'sell', 'ready']);
export const DEFAULT_KEYMAP = Object.freeze({
  refresh: 'KeyR', freeze: 'KeyF', levelUp: 'KeyD', retreat: 'KeyQ', sell: 'KeyX', ready: 'Space',
});

const isBindingCode = (code) => typeof code === 'string' && /^(Key[A-Z]|Digit[0-9]|Space)$/.test(code);

/**
 * Keep valid, unique saved bindings, ignoring inherited and unknown fields. The first action wins a duplicate;
 * missing / invalid actions receive their default where available, then another unused default key.
 * @param {any} raw
 * @returns {Record<string, string>}
 */
export function sanitizeKeymap(raw) {
  const map = {};
  const used = new Set();
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    for (const action of KEY_ACTIONS) {
      if (!Object.prototype.hasOwnProperty.call(raw, action)) continue;
      const code = raw[action];
      if (!isBindingCode(code) || used.has(code)) continue;
      map[action] = code;
      used.add(code);
    }
  }
  // Reserve each remaining action's own default before borrowing one for a displaced action.
  for (const action of KEY_ACTIONS) {
    const code = DEFAULT_KEYMAP[action];
    if (!map[action] && !used.has(code)) {
      map[action] = code;
      used.add(code);
    }
  }
  for (const action of KEY_ACTIONS) {
    if (map[action]) continue;
    const code = KEY_ACTIONS.map((a) => DEFAULT_KEYMAP[a]).find((key) => !used.has(key));
    map[action] = code;
    used.add(code);
  }
  return map;
}

/** Assign a key, swapping with its current action so every action remains usable. Never mutates the input. */
export function rebindKey(raw, action, code) {
  const map = sanitizeKeymap(raw);
  if (!KEY_ACTIONS.includes(action) || !isBindingCode(code)) return map;
  const previous = map[action];
  const collision = KEY_ACTIONS.find((other) => other !== action && map[other] === code);
  if (collision) map[collision] = previous;
  map[action] = code;
  return map;
}

/** The compact label used on buttons, shortcut hints and the settings rows. */
export function keyLabel(code) {
  if (code === 'Escape') return 'Esc';
  if (!isBindingCode(code)) return '—';
  return code.replace(/^(Key|Digit)/, '');
}

/**
 * Read a supported unmodified key press. A present physical code is authoritative, even if unsupported;
 * key-only legacy events fall back to Latin letters, digits and Space. IME and held keys never bind or act.
 * @param {{ code?: string, key?: string, ctrlKey?: boolean, altKey?: boolean, metaKey?: boolean,
 *   shiftKey?: boolean, isComposing?: boolean, keyCode?: number, repeat?: boolean }|null} event
 * @returns {string|null}
 */
export function bindingCodeForEvent(event) {
  if (!event || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey || event.isComposing
    || event.keyCode === 229 || event.repeat) return null;
  if (event.code != null && event.code !== '') return isBindingCode(event.code) ? event.code : null;
  const key = event.key;
  if (typeof key !== 'string') return null;
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^[0-9]$/.test(key)) return `Digit${key}`;
  return key === ' ' ? 'Space' : null;
}
