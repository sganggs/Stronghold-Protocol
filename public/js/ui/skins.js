// Compat shim (stronghold-ui-hub package) — install ONLY when the target has no public/js/ui/skins.js.
// The original lets a player pick operator skins (kept locally and synced to the room). Without skins: an empty
// selection that 干员调配's export / import can still carry (nothing else reads it).
import { createStore } from '../store.js';

export const skinsStore = createStore({ entries: {}, sync: 'idle' });

/** Replace the whole selection. @param {Record<string, string>} entries chessId → skinId */
export function setSkins(entries) {
  const next = {};
  for (const [chessId, skinId] of Object.entries(entries && typeof entries === 'object' ? entries : {})) {
    if (typeof skinId === 'string' && skinId) next[chessId] = skinId;
  }
  skinsStore.set({ entries: next });
}
