// Exercise the hook's real store subscription and guarded renderer methods without mounting a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createStore } from '../../public/js/store.js';

test('mounted fields adopt public skins, follow updates and identity, and unsubscribe on unmount', async () => {
  const source = readFileSync(new URL('../../public/js/ui/fieldHost.js', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace(/^export /gm, '');
  const players = [{ playerId: 'p_1', skins: { char_498_inside: 'char_498_inside@kitchen#2' } }];
  const store = createStore({ me: { playerId: 'p_0' }, match: { public: { players } } });
  const settingsStore = createStore({ otherSkins: true });
  const calls = [], cleanups = [];
  const raw = { setMe: (id) => calls.push(['me', id]), setSkins: (p) => calls.push(['skins', p]), destroy() {} };
  const events = { addEventListener() {}, removeEventListener() {} };
  vm.runInNewContext(source + `
    mountFieldView = async () => guardView(raw, 'engine');
    useFieldView({ current: {} });
  `, { store, settingsStore, raw, AbortController, console, window: events, document: events,
    useState: (s) => [s, () => {}], useRef: (s) => ({ current: s }),
    useEffect: (fn) => cleanups.push(fn()),
  });
  await Promise.resolve();
  assert.deepEqual(calls, [['me', 'p_0'], ['skins', players]]);
  store.set({ unrelated: true });
  assert.equal(calls.length, 2, 'snapshot and UI updates do not reapply choices');
  const cleared = [{ playerId: 'p_1' }];
  store.set({ match: { public: { players: cleared } } });
  assert.deepEqual(calls.at(-1), ['skins', cleared]);
  store.set({ me: { playerId: 'p_1' } });
  assert.deepEqual(calls.at(-1), ['me', 'p_1']);
  for (const cleanup of cleanups) cleanup();
  const count = calls.length;
  store.set({ match: { public: { players } }, me: { playerId: 'p_0' } });
  assert.equal(calls.length, count, 'the disposed view receives no further state');
});
