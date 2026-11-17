// Battle-input previews: detached board state and a capability-limited meta context (META §1.5 / §2.2).
import { computeBonds } from './bondsMeta.js';

/** A candidate never occupies the live board, even between scheduler yields. No recompute() side effects. */
export function previewPlayer(ps, board = ps.board) {
  const copy = Object.create(ps);
  copy.board = structuredClone(board);
  const deployed = new Set([...copy.board.values()].map((p) => p.uid));
  copy.hand = structuredClone(ps.hand.map((p) => p && deployed.has(p.uid) ? null : p));
  copy.temp = structuredClone(ps.temp.map((p) => p && deployed.has(p.uid) ? null : p));
  copy.bonds = computeBonds(ps.gd, copy);
  // battleInput checks deployment legality; the planner already used this map. Do not evict live pieces or dirty views.
  const map = ps.m.deployMapFor(ps, ps.m.deployFieldOf(ps));
  copy.deployMap = () => map;
  copy._legalityStale = false;
  return copy;
}

// Only these context functions may reach a live read. Every other function is a no-op by default, including future
// mutation APIs. Returned objects and source metadata are copied; teammates/player receive the same restricted view.
const READS = new Set(['funds', 'lp', 'alive', 'bandId', 'teamMedicGranted', 'shopLevel', 'bond', 'bonds',
  'bondActive', 'bondCount', 'layers', 'board', 'hand', 'temp', 'piece', 'pieceAt', 'chessRecord', 'pieceBonds',
  'garrisonsOf', 'stats', 'roundStats', 'shopSlots', 'counter', 'pieceCounter', 'effect', 'rollChess', 'rollItem', 'rollPool',
  'seedFor']);
const NOOP = () => undefined;

/** Data lookups are read APIs; hide prototypes and return detached records/properties, including Maps and Sets. */
function dataView(gd) {
  const cache = new Map();
  // GameData's two lookup memos also belong to the estimate. The underlying records are immutable data.
  const lookup = Object.create(gd);
  lookup._standIns = new Map(gd._standIns);
  lookup._bandBonds = new Map(gd._bandBonds);
  return new Proxy(Object.create(null), {
    get(_target, key) {
      if (typeof key !== 'string' || key === 'constructor' || key.startsWith('_')) return undefined;
      if (!cache.has(key)) {
        const value = lookup[key];
        cache.set(key, typeof value === 'function' ? (...args) => structuredClone(value.apply(lookup, args)) : structuredClone(value));
      }
      return cache.get(key);
    },
    set: () => true,
    defineProperty: () => false,
    deleteProperty: () => false,
    setPrototypeOf: () => false,
  });
}

/** Called only by the isolated dispatcher. The RNG and caches belong to that preview, never the match. */
export function previewContext(ctx, state, { teammates, player }) {
  const out = Object.create(null);
  for (const key of Object.keys(ctx)) {
    if (['data', 'gd', 'rng', 'teammates', 'player'].includes(key)) continue;
    const value = ctx[key];
    out[key] = typeof value === 'function'
      ? READS.has(key) ? (...args) => structuredClone(value(...args)) : NOOP
      : structuredClone(value);
  }
  if (!state.data.has(ctx.gd)) state.data.set(ctx.gd, dataView(ctx.gd));
  out.gd = state.data.get(ctx.gd);
  Object.defineProperty(out, 'data', { enumerable: true, get: () => out.gd.raw });
  out.rng = state.rng;
  out.teammates = teammates;
  out.player = player;
  return out;
}
