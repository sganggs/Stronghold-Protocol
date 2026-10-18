// Operator-owned prep DSL; no process-wide registration and no author-supplied effect key.
import { compileDslMeta } from './dslMeta.js';
import { diyRecordOf } from '../../shared/diy.js';
import { pieceBonds } from './bondsMeta.js';
const compiled = new WeakMap(), tables = new WeakMap();
function traitsOf(gd) {
  const source = gd?.raw?.garrisons;
  if (!source) return [];
  if (!tables.has(source)) tables.set(source, Object.values(source).filter(g => g.operatorTrait));
  return tables.get(source);
}
export const hasTraitFor = (gd, charId) => traitsOf(gd).some(g => g.operatorTrait.charId === charId);

/** Participating layer nodes. Declaration caps describe possibilities, never proof of an earned gain. */
export function operatorTraitLayerAllowance(player, gd) {
  const out = new Map(), table = traitsOf(gd);
  if (!table.length) return out;
  for (const u of player.units ?? []) {
    if (u.kind === 'token') continue;
    const base = gd.chess(u.chessId);
    const rec = u.standIn === true ? gd.standIn?.(u.chessId) : u.diy && base?.isDiy ? diyRecordOf(base, u.diy, gd.raw) : base;
    if (!rec) continue;
    const ownBonds = pieceBonds({ chess: () => rec, item: id => gd.item(id), bond: id => gd.bond(id) },
      { id: u.chessId, items: (u.items ?? []).map(id => ({ id })) });
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (node.layers) {
        const { bond, maxPerBattle = Infinity } = node.layers;
        for (const id of bond === 'selfActive' ? ownBonds : [bond]) out.set(id, (out.get(id) ?? 0) + maxPerBattle);
      }
      for (const value of Object.values(node)) visit(value);
    };
    for (const g of table) if (g.operatorTrait.charId === rec.charId && g.operatorTrait.elite === !!rec.isGolden) visit(g.operatorTrait.spec.talents);
  }
  return out;
}
// [ASSUMED] Derive these fields on the server, including bosses; no client cap proves a burst happened.
export const requiresTraitLayerAuthority = (spec, gd) => spec?.flags?.layerGainsEnabled !== false
  && (spec?.players ?? []).some(p => operatorTraitLayerAllowance(p, gd).size > 0);

const EVENTS = { onTraitGain: 'gain', onTraitDeploy: 'deploy', onRoundStart: 'roundStart', onBuy: 'buy', onSold: 'sell',
  onMerge: 'merge', onLevelUp: 'levelUp', onBattleResult: 'battleResult' };

export function operatorTraitHandler(tr, hook) {
  let map = compiled.get(tr);
  if (!map) { map = new Map(); compiled.set(tr, map); }
  if (map.has(hook)) return map.get(hook);
  const on = (tr.spec.meta?.on ?? []).filter(e => e.when === (hook === 'onGain' ? 'gain' : EVENTS[hook])).map(e => ({ ...e, when: 'roundStart',
    do: (e.do ?? []).flatMap(action => action.gainItem
      ? Array.from({ length: action.gainItem.count ?? 1 }, () => ({ gainItem: { item: action.gainItem.item } })) : [action]) }));
  const result = on.length ? { [hook]: compileDslMeta({ dsl: 1, meta: { on } }, { pluginId: tr.pluginId }).onRoundStart } : {};
  map.set(hook, result); return result;
}

export function dispatchOperatorTraits(dispatcher, ps, hook, ev) {
  if (!EVENTS[hook] || !ps.alive) return;
  const table = traitsOf(ps.gd);
  if (!table.length) return;
  // [ASSUMED] Gain/deploy concern only that copy. Other hooks run once per owned character;
  // an elite copy takes precedence. A self-sale uses the removed copy's form once. Bench/temp count as owned.
  const pieces = hook === 'onTraitGain' || hook === 'onTraitDeploy' ? [ev.piece] : ps.allChess();
  const holders = new Map();
  for (const piece of pieces) {
    if (piece?.kind !== 'chess') continue;
    const rec = ps.gd.chess(piece.id);
    if (!rec) continue;
    if (!holders.has(rec.charId) || rec.isGolden) holders.set(rec.charId, { piece, rec });
  }
  if (hook === 'onSold' && ev.piece?.kind === 'chess') {
    const rec = ps.gd.chess(ev.piece.id);
    if (rec) holders.set(rec.charId, { piece: ev.piece, rec });
  }
  for (const g of table) {
    const tr = g.operatorTrait, holder = holders.get(tr.charId);
    if (!holder || tr.elite !== !!holder.rec.isGolden) continue;
    const key = `trait:${g.garrisonId}`;
    dispatcher._call(ps, key, operatorTraitHandler(tr, hook), hook, { kind: 'garrison', key, piece: holder.piece, garrison: g }, ev);
  }
}
