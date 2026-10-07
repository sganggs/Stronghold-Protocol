// Local keyboard preferences. The pure keymap module stays usable without Preact / the browser store.
import { createStore, useStore, loadPref, savePref } from '../store.js';
import { KEY_ACTIONS, DEFAULT_KEYMAP, sanitizeKeymap, rebindKey } from './keymap.js';

export const keymapStore = createStore(sanitizeKeymap(loadPref('keymap', null)));
const selectKeymap = (map) => map;

export function useKeymap() {
  return useStore(selectKeymap, undefined, keymapStore);
}

function applyKeymap(map) {
  if (KEY_ACTIONS.every((action) => keymapStore.get()[action] === map[action])) return false;
  keymapStore.set(map);
  return true;
}

export function updateKeybinding(action, code) {
  const map = rebindKey(keymapStore.get(), action, code);
  if (applyKeymap(map)) savePref('keymap', map);
}

export function resetKeybindings() {
  applyKeymap({ ...DEFAULT_KEYMAP });
  savePref('keymap', DEFAULT_KEYMAP);
}

// A second tab's edits, reset, removal or clear take effect here without writing back and causing an echo.
globalThis.addEventListener?.('storage', (event) => {
  if (event.key !== null && event.key !== 'sp.pref.keymap') return;
  try {
    if (event.storageArea && event.storageArea !== globalThis.localStorage) return;
  } catch { return; }
  let raw = null;
  try { raw = event.newValue == null ? null : JSON.parse(event.newValue); } catch { /* use defaults */ }
  applyKeymap(sanitizeKeymap(raw));
});
