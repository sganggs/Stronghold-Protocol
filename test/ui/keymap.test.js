import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { KEY_ACTIONS, DEFAULT_KEYMAP, sanitizeKeymap, rebindKey, keyLabel, bindingCodeForEvent } from '../../public/js/ui/keymap.js';

function assertComplete(map) {
  assert.deepEqual(Object.keys(map).sort(), [...KEY_ACTIONS].sort());
  assert.equal(new Set(Object.values(map)).size, KEY_ACTIONS.length);
  for (const code of Object.values(map)) assert.match(code, /^(Key[A-Z]|Digit[0-9]|Space)$/);
}

describe('keyboard bindings', () => {
  test('defaults retain all six original game shortcuts and are immutable', () => {
    assert.deepEqual(KEY_ACTIONS, ['refresh', 'freeze', 'levelUp', 'retreat', 'sell', 'ready']);
    assert.deepEqual(DEFAULT_KEYMAP, { refresh: 'KeyR', freeze: 'KeyF', levelUp: 'KeyD', retreat: 'KeyQ', sell: 'KeyX', ready: 'Space' });
    assert.ok(Object.isFrozen(KEY_ACTIONS));
    assert.ok(Object.isFrozen(DEFAULT_KEYMAP));
    assertComplete(DEFAULT_KEYMAP);
  });

  test('bad persisted values and inherited fields restore defaults', () => {
    for (const raw of [null, undefined, true, 12, 'KeyA', [], ['KeyA'], { refresh: 'Escape', freeze: 'Numpad1', ready: 'Enter' },
      Object.create({ refresh: 'KeyA', sell: 'KeyB' })]) {
      assert.deepEqual(sanitizeKeymap(raw), DEFAULT_KEYMAP);
    }
    const raw = JSON.parse('{"__proto__":{"refresh":"KeyA"},"constructor":"KeyB","unknown":"KeyC","freeze":"KeyZ"}');
    const map = sanitizeKeymap(raw);
    assert.deepEqual(map, { ...DEFAULT_KEYMAP, freeze: 'KeyZ' });
    assert.equal(Object.getPrototypeOf(map), Object.prototype);
    assert.equal(Object.hasOwn(map, '__proto__'), false);
  });

  test('partial, duplicate and displaced defaults always produce a complete unique map', () => {
    const duplicate = sanitizeKeymap({ refresh: 'KeyA', freeze: 'KeyA', levelUp: false, retreat: 'Digit9' });
    assert.deepEqual(duplicate, { ...DEFAULT_KEYMAP, refresh: 'KeyA', retreat: 'Digit9' });
    const displaced = sanitizeKeymap({ refresh: 'KeyF', freeze: 'KeyD' });
    assert.equal(displaced.refresh, 'KeyF');
    assert.equal(displaced.freeze, 'KeyD');
    assert.equal(displaced.levelUp, 'KeyR');
    for (const map of [duplicate, displaced, sanitizeKeymap({ ready: 'KeyR', sell: 'Space' })]) {
      assertComplete(map);
      assert.deepEqual(sanitizeKeymap(map), map, 'sanitization is idempotent');
    }
  });

  test('rebinding swaps a collision, frees an unused old key and never changes its input', () => {
    const original = { ...DEFAULT_KEYMAP };
    const swapped = rebindKey(original, 'refresh', 'KeyF');
    assert.deepEqual(swapped, { ...DEFAULT_KEYMAP, refresh: 'KeyF', freeze: 'KeyR' });
    assert.deepEqual(original, DEFAULT_KEYMAP);
    const custom = rebindKey(swapped, 'ready', 'Digit1');
    assert.equal(custom.ready, 'Digit1');
    assert.equal(Object.values(custom).includes('Space'), false);
    const swappedAgain = rebindKey(custom, 'retreat', 'Digit1');
    assert.equal(swappedAgain.retreat, 'Digit1');
    assert.equal(swappedAgain.ready, 'KeyQ');
    assertComplete(swappedAgain);
  });

  test('unknown actions, reserved keys, malformed codes and same-key edits have no effect', () => {
    for (const action of ['escape', '__proto__', 'constructor', '', undefined]) {
      assert.deepEqual(rebindKey(DEFAULT_KEYMAP, action, 'KeyA'), DEFAULT_KEYMAP);
    }
    for (const code of ['Escape', 'Enter', 'Tab', 'ArrowLeft', 'Numpad1', 'F1', 'keyA', 'KeyAA', 'Digit10', '', null, {}, 1]) {
      assert.deepEqual(rebindKey(DEFAULT_KEYMAP, 'refresh', code), DEFAULT_KEYMAP);
    }
    assert.deepEqual(rebindKey(DEFAULT_KEYMAP, 'refresh', 'KeyR'), DEFAULT_KEYMAP);
  });

  test('labels are shared by settings and gameplay hints', () => {
    for (const [code, label] of [['KeyR', 'R'], ['KeyZ', 'Z'], ['Digit0', '0'], ['Digit9', '9'], ['Space', 'Space'], ['Escape', 'Esc']]) {
      assert.equal(keyLabel(code), label);
    }
    assert.equal(keyLabel(undefined), '—');
  });
});

describe('key press normalization', () => {
  test('physical code wins over the character on another keyboard layout', () => {
    assert.equal(bindingCodeForEvent({ code: 'KeyQ', key: 'a' }), 'KeyQ');
    assert.equal(bindingCodeForEvent({ code: 'Digit1', key: '&' }), 'Digit1');
    assert.equal(bindingCodeForEvent({ code: 'KeyR', key: 'к' }), 'KeyR');
    assert.equal(bindingCodeForEvent({ code: 'Space', key: ' ' }), 'Space');
    for (const code of ['Numpad1', 'ArrowLeft', 'F1', 'Escape', 'Unidentified', 1]) {
      assert.equal(bindingCodeForEvent({ code, key: 'r' }), null, String(code));
    }
  });

  test('legacy events without codes support Latin letters, digits and Space', () => {
    for (const [key, code] of [['r', 'KeyR'], ['R', 'KeyR'], ['z', 'KeyZ'], ['0', 'Digit0'], ['9', 'Digit9'], [' ', 'Space']]) {
      assert.equal(bindingCodeForEvent({ key }), code);
      assert.equal(bindingCodeForEvent({ key, code: '' }), code);
    }
    for (const key of ['Escape', 'Enter', 'Tab', 'Dead', 'Process', 'Unidentified', 'é', 'р', '', null, 1]) {
      assert.equal(bindingCodeForEvent({ key }), null);
    }
    assert.equal(bindingCodeForEvent(null), null);
  });

  test('modifiers, held keys and IME composition cannot bind or trigger actions', () => {
    for (const flag of ['ctrlKey', 'altKey', 'metaKey', 'shiftKey', 'repeat', 'isComposing']) {
      assert.equal(bindingCodeForEvent({ code: 'KeyR', key: 'r', [flag]: true }), null, flag);
    }
    assert.equal(bindingCodeForEvent({ code: 'KeyR', key: 'r', keyCode: 229 }), null);
  });
});

let storeSequence = 0;
async function loadStore(t, initial = null, options = {}) {
  const state = { raw: initial, writes: [], readError: false, writeError: false, ...options };
  const storage = {
    getItem(key) {
      assert.equal(key, 'sp.pref.keymap');
      if (state.readError) throw new Error('storage unavailable');
      return state.raw;
    },
    setItem(key, raw) {
      assert.equal(key, 'sp.pref.keymap');
      if (state.writeError) throw new Error('quota exceeded');
      state.raw = raw;
      state.writes.push(raw);
    },
  };
  let onStorage;
  for (const [key, value] of Object.entries({ localStorage: storage, addEventListener: (type, listener) => {
    assert.equal(type, 'storage');
    onStorage = listener;
  } })) {
    const old = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (old) Object.defineProperty(globalThis, key, old);
      else delete globalThis[key];
    });
  }
  const api = await import(`../../public/js/ui/keymapStore.js?test=${++storeSequence}`);
  return { ...api, state, storage, emit: (event) => onStorage({ key: 'sp.pref.keymap', storageArea: storage, ...event }) };
}

describe('persisted keyboard bindings', () => {
  test('loads, updates, reloads and resets preferences without changing other settings', async (t) => {
    const api = await loadStore(t, JSON.stringify({ refresh: 'KeyA' }));
    assert.equal(api.keymapStore.get().refresh, 'KeyA');
    let notifications = 0;
    const unsubscribe = api.keymapStore.subscribe(() => notifications++);
    api.updateKeybinding('freeze', 'KeyA');
    assert.equal(api.keymapStore.get().refresh, 'KeyF');
    assert.equal(api.keymapStore.get().freeze, 'KeyA');
    assert.deepEqual(JSON.parse(api.state.raw), api.keymapStore.get());
    assert.equal(notifications, 1);
    api.updateKeybinding('freeze', 'KeyA');
    api.updateKeybinding('refresh', 'Escape');
    assert.equal(api.state.writes.length, 1, 'same or invalid binding does not write');
    const reloaded = await import(`../../public/js/ui/keymapStore.js?test=${++storeSequence}`);
    assert.deepEqual(reloaded.keymapStore.get(), api.keymapStore.get());
    api.resetKeybindings();
    assert.deepEqual(api.keymapStore.get(), DEFAULT_KEYMAP);
    assert.deepEqual(JSON.parse(api.state.raw), DEFAULT_KEYMAP);
    assert.equal(notifications, 2);
    unsubscribe();
  });

  test('invalid JSON and unavailable storage leave keyboard controls usable', async (t) => {
    const api = await loadStore(t, '{broken JSON');
    assert.deepEqual(api.keymapStore.get(), DEFAULT_KEYMAP);
    api.state.writeError = true;
    assert.doesNotThrow(() => api.updateKeybinding('refresh', 'Digit5'));
    assert.equal(api.keymapStore.get().refresh, 'Digit5');
    assert.doesNotThrow(() => api.resetKeybindings());
    assert.deepEqual(api.keymapStore.get(), DEFAULT_KEYMAP);
    api.state.readError = true;
    const unavailable = await import(`../../public/js/ui/keymapStore.js?test=${++storeSequence}`);
    assert.deepEqual(unavailable.keymapStore.get(), DEFAULT_KEYMAP);
  });

  test('other tabs synchronize updates, malformed data, removal and clear without writing back', async (t) => {
    const api = await loadStore(t);
    api.emit({ newValue: JSON.stringify({ retreat: 'Digit8' }) });
    assert.equal(api.keymapStore.get().retreat, 'Digit8');
    api.emit({ key: 'sp.pref.settings', newValue: '{}' });
    api.emit({ storageArea: {}, newValue: '{}' });
    assert.equal(api.keymapStore.get().retreat, 'Digit8', 'unrelated preferences and session storage are ignored');
    api.emit({ newValue: '{broken' });
    assert.deepEqual(api.keymapStore.get(), DEFAULT_KEYMAP);
    for (const event of [{ newValue: null }, { key: null, newValue: null }]) {
      api.emit({ newValue: JSON.stringify({ sell: 'Digit2' }) });
      assert.equal(api.keymapStore.get().sell, 'Digit2');
      api.emit(event);
      assert.deepEqual(api.keymapStore.get(), DEFAULT_KEYMAP);
    }
    assert.equal(api.state.writes.length, 0, 'storage events never cause a persistence loop');
  });
});
