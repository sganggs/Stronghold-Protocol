// server/sim/content/support/index.js — shared helpers of content wave B (bonds, garrisons, items, bands, choices).
//
// Battle side and prep side read the same frozen game data (server/data.js). Everything here is pure and deterministic;
// battle helpers only go through the public Battle API (docs/SIM.md §6). Wave-B submodules import from this file and
// never edit it; module-specific helpers live in the submodules.
//
// Conventions shared by every wave-B module (details in docs/CONTENT.md):
//   * Attribute bonuses ("+X%" ATK / DEF / max HP) from bonds, bands, equipment, 机变 cards and the per-layer 特质 are
//     "直接乘算" (PRTS 盟约记录; PRTS 游戏数据基础: 直接乘算 values are summed with every other 直接乘算, a skill's "攻击力+X%"
//     included) → `directMods({ atk, def, hp })` = the additive `atkPct` / `defPct` / `hpPct` (constants.js
//     DIRECT_BONUS_STACKING; 'multiply' restores the v2.5 per-source ×(1 + x) `atkMul`). "提升至X%" effects stay
//     multipliers. ASPD stays additive (`aspd`), damage bonuses are `dmgDealtMul`, redeploy changes `redeployMul`.
//   * Match-long passives use `passiveBuff()` (persist + allowDead + replace): idempotent by key, survive death.
//   * Buff keys / fx `src` are namespaced: `bond:<bondId>…`, `item:<itemKey>…`, `gar:<effectKey>…`, `band:<bandId>…`,
//     `choice:<effectId>…`.
//   * IN_BATTLE layer gains go through `gainLayers()` (requireActive, per-source per-battle caps, 魔王-compatible source).
//   * Prep-side facts a battle needs (hand size, operators gained this round, teammates' bands …) arrive in
//     `PlayerBattleInput.contentInfo`, written by the `global:contentb_info` meta handler (support/meta.js).

import { getData } from '../../../data.js';
import { COLS, DIRECT_BONUS_STACKING } from '../../constants.js';
import { frontOf, offsetTile } from '../../dir.js';
import { bodyInKeys, bodyDist, bodyInRadius, bodyOnTile, bodyTileReach } from '../../body.js';

export { COLS };
/** Where an enemy can be hit (a huge enemy's whole hit rectangle, sim/body.js) — for every range test on enemies. */
export { bodyInKeys, bodyDist, bodyInRadius, bodyOnTile, bodyTileReach };

// =====================================================================================================================
// numbers & data

/** Finite number from a number or numeric string, else `d`. */
export const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d));
const own = (o, k) => (o && typeof o === 'object' && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k) ? o[k] : null);
const QUIET = Object.freeze({ warn() {}, error() {}, info() {} });

let DATA = null;
/** Frozen data/*.json (process singleton of server/data.js). Never mutate. */
export function gameData() {
  if (!DATA) {
    try { DATA = getData({ log: QUIET }) || {}; } catch { DATA = {}; }
  }
  return DATA;
}
/** Tests only: swap the data object (null → reload the singleton). Also drops derived caches. */
export function setGameData(d) { DATA = d ?? null; CORE = null; }

export const bondRecord = (id) => own(gameData().bonds, id);
export const itemRecord = (id) => own(gameData().items, id);
export const garrisonRecord = (id) => own(gameData().garrisons, id);
export const bandRecord = (id) => own(gameData().bands, id);
export const effectRecord = (id) => own(gameData().effects, id);
export const chessRecord = (id) => own(gameData().chess, id);
/** Registry key of an item: id without the `_a` / `_b` suffix (Arts have none). */
export const itemKeyOf = (id) => String(id ?? '').replace(/_[ab]$/, '');
/** True for golden (进阶) items / elite chess ids. */
export const isGoldenId = (id) => /_b$/.test(String(id ?? ''));

/**
 * Buffs of a data record (bond / item / band / effect / garrison-like) as `{ key, bbKey, p }` where `key` is the
 * buff key, `bbKey` the `bbStr.key` (battle rune key, may be null) and `p = { ...bb, ...bbStr }`.
 */
export function buffsOf(rec) {
  const out = [];
  for (const b of (rec && Array.isArray(rec.buffs) ? rec.buffs : [])) {
    if (!b || typeof b !== 'object') continue;
    out.push({ key: b.key ?? null, bbKey: b.bbStr && typeof b.bbStr.key === 'string' ? b.bbStr.key : null, p: { ...(b.bb || {}), ...(b.bbStr || {}) } });
  }
  return out;
}

/** `{ ...bb, ...bbStr }` of the first buff of `rec` whose key or bbStr.key equals `key` (or matches a RegExp), else null. */
export function buffParams(rec, key) {
  for (const b of buffsOf(rec)) {
    const hit = key instanceof RegExp ? key.test(b.key ?? '') || key.test(b.bbKey ?? '') : b.key === key || b.bbKey === key;
    if (hit) return b.p;
  }
  return null;
}

let CORE = null;
/** Core (核心, isPower) bond ids. */
export function coreBondIds() {
  if (!CORE) {
    CORE = new Set();
    for (const [id, b] of Object.entries(gameData().bonds || {})) if (b && b.isCore) CORE.add(id);
  }
  return CORE;
}
export const isCoreBond = (id) => coreBondIds().has(id);

// =====================================================================================================================
// battle: players & bonds (live: in-battle layer gains update `battle.getPlayer(pid).bonds[id].layers`)

export const player = (battle, pid) => (battle && pid != null ? battle.getPlayer(pid) : null);
/** Live bond state `{ count, active, tier, layers }` of a player, or null. */
export function bondState(battle, pid, bondId) {
  const b = player(battle, pid)?.bonds?.[bondId];
  return b && typeof b === 'object' ? b : null;
}
/** Tier reached (0 when inactive). */
export function bondTier(battle, pid, bondId) {
  const b = bondState(battle, pid, bondId);
  return b && b.active ? Math.max(1, Math.floor(num(b.tier, 1))) : 0;
}
export const bondActive = (battle, pid, bondId, minTier = 1) => bondTier(battle, pid, bondId) >= minTier;
/** Live layers (also while the bond is inactive). */
export const bondLayers = (battle, pid, bondId) => Math.max(0, num(bondState(battle, pid, bondId)?.layers, 0));
/** Ids of the player's active bonds. */
export function activeBondIds(battle, pid) {
  const out = [];
  const bonds = player(battle, pid)?.bonds;
  if (bonds && typeof bonds === 'object') for (const [id, b] of Object.entries(bonds)) if (b && b.active) out.push(id);
  return out;
}
/** Active bond with the most layers (ties → data order); null when none is active. */
export function topActiveBond(battle, pid) {
  let best = null, bl = -1;
  for (const id of Object.keys(gameData().bonds || {})) {
    if (!bondActive(battle, pid, id)) continue;
    const l = bondLayers(battle, pid, id);
    if (l > bl) { bl = l; best = id; }
  }
  return best;
}

/** Prep-side facts for this player's battle (support/meta.js `global:contentb_info`), or {} when absent (tests). */
export function contentInfo(battle, pid) {
  const ci = player(battle, pid)?.input?.contentInfo;
  return ci && typeof ci === 'object' ? ci : {};
}
/** Band ids of every alive player of the match (own first); falls back to this battle's players. */
export function matchBands(battle, pid) {
  const mb = contentInfo(battle, pid).matchBands;
  if (Array.isArray(mb) && mb.length) return mb;
  return (battle.players || []).map((p) => p.bandId).filter(Boolean);
}

// =====================================================================================================================
// battle: units, membership, items

const EMPTY = Object.freeze([]);
export const isOp = (u) => !!u && u.kind === 'op';
export const onField = (u) => !!u && u.alive && u.deployed;
/** Elite (精锐) chess. */
export const isElite = (u) => !!(u && u.def && (u.def.golden || isGoldenId(u.def.id)));
/** Shop tier (阶) of an operator (tokens: their summoner's tier, else 1). */
export function tierOf(u) {
  if (!u) return 1;
  if (u.kind === 'op') return Math.max(1, Math.floor(num(u.def?.tier ?? u.def?.raw?.tier, 1)));
  if (u.ownerUnit) return tierOf(u.ownerUnit);
  return 1;
}
/**
 * "地面干员": a melee-position (地面位, deploy class MELEE) operator, whatever tile it stands on — the official vocabulary
 * names the deploy class, not the tile (game data: this mode's map card 「可以部署高台干员和地面干员的地面」, 「可将高台干员
 * 部署于其上」, 「所有地面干员阻挡数+2」; PRTS corrected 琴柳's 地面干员 to 地面位干员). Read by 不屈, the 战栗维式重锤 proc and
 * 休谟斯 回收利用 (community report 「不屈盟约效果高台干员也错误的吃到了」, 0.1.3). The tile (`unit.ground`) stays what the
 * enemies' 地面单位 targeting reads.
 */
export const isGroundOp = (u) => isOp(u) && u.def?.position === 'MELEE';
/** Base (normal) chess id of an operator (normal and elite share it). */
export const baseChessId = (u) => String(u?.def?.baseId ?? u?.defId ?? '').replace(/_b$/, '_a');

/** Equipment ids carried by a unit (golden ids when merged). */
export const itemsOf = (u) => (u && Array.isArray(u.items) ? u.items : EMPTY);
export const hasItemKey = (u, key) => itemsOf(u).some((id) => itemKeyOf(id) === key);
export const goldenItemCount = (u) => itemsOf(u).filter(isGoldenId).length;

const BONDS = new WeakMap();
/**
 * A unit's own bonds: the chess's data bonds + bonds granted by 变形同构体 (an item with `canGiveBond` worn together
 * with an item that has a `giveBondId`; same rule as server/match/bondsMeta.js pieceBonds). Tokens / enemies: [].
 */
export function unitBonds(u) {
  if (!isOp(u)) return EMPTY;
  const cached = BONDS.get(u);
  const items = itemsOf(u);
  const key = items.join('|');
  if (cached && cached.key === key) return cached.bonds;
  const out = [...(Array.isArray(u.def?.bonds) ? u.def.bonds : Array.isArray(u.def?.raw?.bonds) ? u.def.raw.bonds : [])];
  if (items.length >= 2) {
    const recs = items.map((id) => itemRecord(id)).filter(Boolean);
    if (recs.some((r) => r.canGiveBond)) {
      for (const r of recs) {
        if (r.canGiveBond) continue;
        if (typeof r.giveBondId === 'string' && bondRecord(r.giveBondId) && !out.includes(r.giveBondId)) out.push(r.giveBondId);
      }
    }
  }
  const bonds = Object.freeze(out);
  BONDS.set(u, { key, bonds });
  return bonds;
}

/**
 * Does `u` receive the effects of `bondId`? Own bonds (incl. 变形同构体 grants), and — 调和 (maniShip) — an operator
 * of the 调和 bond enjoys every core bond while 调和 is active (research 02 §2.1; callers still check the core bond is
 * active themselves).
 */
export function isMember(battle, u, bondId) {
  const own = unitBonds(u);
  if (own.includes(bondId)) return true;
  return isCoreBond(bondId) && own.includes('maniShip') && bondActive(battle, u.ownerId, 'maniShip');
}

/**
 * Operators (optionally tokens) of player `pid` that receive `bondId`'s effects.
 * opts: { fieldOnly = false (alive & deployed only), tokens = false }
 */
export function bondMembers(battle, pid, bondId, { fieldOnly = false, tokens = false } = {}) {
  const out = [];
  for (const u of battle.allyUnits) {
    if (u.ownerId !== pid) continue;
    if (u.kind !== 'op' && !(tokens && u.kind === 'token')) continue;
    if (fieldOnly && !onField(u)) continue;
    const who = u.kind === 'token' ? u.ownerUnit : u;
    if (who && isMember(battle, who, bondId)) out.push(u);
  }
  return out;
}

/** Operators of a player (every one created from the board, dead or alive unless fieldOnly). */
export function playerOps(battle, pid, { fieldOnly = false } = {}) {
  const out = [];
  for (const u of battle.allyUnits) if (u.kind === 'op' && u.ownerId === pid && (!fieldOnly || onField(u))) out.push(u);
  return out;
}

// =====================================================================================================================
// battle: geometry (tile relations use the unit's direction `dir` (sim/dir.js): "身前" = one step along its forward
// vector; relative offsets [dRow, dCol] are facing-RIGHT and rotated like range grids)

export const N4 = Object.freeze([[1, 0], [-1, 0], [0, 1], [0, -1]]);
export const N8 = Object.freeze([[1, -1], [1, 0], [1, 1], [0, -1], [0, 1], [-1, -1], [-1, 0], [-1, 1]]);
/** Tile `k` steps in front of (k < 0: behind) a unit's tile, along its direction. */
export const frontTile = (u, k = 1) => frontOf(u.tileR, u.tileC, u.dir, k);
/** The two tiles beside a unit (perpendicular to its direction): [its left-hand tile, its right-hand tile]. */
export const sideTiles = (u) => [offsetTile(u.tileR, u.tileC, 1, 0, u.dir), offsetTile(u.tileR, u.tileC, -1, 0, u.dir)];
/** Deployed ally on (r, c) owned by `pid` (any owner when pid is null), else null. */
export function allyAt(battle, r, c, pid = null) {
  if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
  const u = battle.unitAt(r, c);
  if (!u || u.side !== 'ally' || !u.alive || u.kind === 'device') return null;
  return pid == null || u.ownerId === pid ? u : null;
}
/** Deployed allies of the same owner on the given relative offsets ([dRow, dCol] facing RIGHT, rotated by `u.dir`). */
export function alliesAround(battle, u, offsets = N4) {
  const out = [];
  for (const [dr, dc] of offsets) {
    const [r, c] = offsetTile(u.tileR, u.tileC, dr, dc, u.dir);
    const a = allyAt(battle, r, c, u.ownerId);
    if (a && a !== u) out.push(a);
  }
  return out;
}
/** Deployed operators of the same owner on the unit's row (the unit included). */
export function rowMates(battle, u) {
  const out = [];
  for (const a of battle.allyUnits) if (a.kind === 'op' && a.ownerId === u.ownerId && onField(a) && a.tileR === u.tileR) out.push(a);
  return out;
}
/** Tile key used by range sets (`unit.rangeKeySet`): an ally's tile, an enemy's position tile (range tests: onKeys). */
export const tileKey = (u) => (u.side === 'ally' ? u.tileR * COLS + u.tileC : Math.round(u.y) * COLS + Math.round(u.x));
/** Is `target` on a tile of `keys` (Set or array)? An ally: its tile; an enemy: its body (a huge one: every tile). */
export const onKeys = (target, keys) => {
  if (!target || !keys) return false;
  if (target.side !== 'ally') return bodyInKeys(target, keys);
  const k = tileKey(target);
  return keys instanceof Set ? keys.has(k) : keys.includes(k);
};
/** Is `target` inside `u`'s current attack range (grid ranges)? */
export const inRange = (u, target) => !!(u && target && u.rangeKeySet && onKeys(target, u.rangeKeySet));

// =====================================================================================================================
// battle: buffs, fx, per-battle state

/**
 * Buff mods of a 直接乘算 attribute bonus (bonds, bands, equipment, 机变 cards, per-layer 特质): ratios `atk` / `def` /
 * `hp` (+0.3 = "+30%"; negative lowers) → `atkPct` / `defPct` / `hpPct`, summed by the engine with every other additive
 * percentage (constants.js DIRECT_BONUS_STACKING 'add', the official rule); 'multiply' → `atkMul` / `defMul` / `hpMul`
 * = 1 + x (the v2.5 reading). Zero / non-finite parts are left out; `extra` mods are merged in.
 */
export function directMods({ atk = 0, def = 0, hp = 0 } = {}, extra = null) {
  const m = {};
  const put = (pct, mul, v) => {
    if (!(typeof v === 'number' && Number.isFinite(v)) || v === 0) return;
    if (DIRECT_BONUS_STACKING === 'multiply') m[mul] = Math.max(0, 1 + v);
    else m[pct] = v;
  };
  put('atkPct', 'atkMul', atk);
  put('defPct', 'defMul', def);
  put('hpPct', 'hpMul', hp);
  return extra ? Object.assign(m, extra) : m;
}

/** Match-long passive buff (survives death/redeploy; re-adding the same key replaces it — idempotent). */
export function passiveBuff(battle, u, key, mods, extra = {}) {
  return battle.addBuff(u, { key, mods, persist: true, allowDead: true, refresh: 'replace', ...extra });
}

/** Client VFX anchored on a unit: `battle.fx(kind, { x, y, id, src, key, …extra })`. */
export function fxOn(battle, kind, u, src, key, extra = {}) {
  if (!u) return;
  battle.fx(kind, { x: u.x, y: u.y, id: u.id, src, key, ...extra });
}

const STORES = new WeakMap();
/** Per-battle scratch object for namespace `ns` (created with `init()` on first use). */
export function battleStore(battle, ns, init = () => ({})) {
  let m = STORES.get(battle);
  if (!m) { m = new Map(); STORES.set(battle, m); }
  let s = m.get(ns);
  if (s === undefined) { s = init(); m.set(ns, s); }
  return s;
}

// =====================================================================================================================
// battle: IN_BATTLE layer gains

/**
 * Add IN_BATTLE layers (no-op in 联防 / boss / hidden fields: `battle.flags.layerGainsEnabled`).
 *   playerId       receiving player
 *   bonds          bond id or array of ids (each gets `n`)
 *   n              layers per bond (floored)
 *   requireActive  "使已激活的【X】层数+N" (default true); false = "（无需激活盟约）"
 *   source         unit that caused the gain (garrison owner; 魔王's +1 keys on it through the `layerGain` hook)
 *   reason         'garrison' for 特质 gains (魔王 only boosts those), else 'bond' / 'item' / 'band' / 'choice'
 *   cap, capKey    per-battle cap per (capKey, bond) — "每场战斗至多N层"; hook extras (魔王) don't count toward it
 * Returns the layers actually added (sum over bonds).
 */
export function gainLayers(battle, { playerId, bonds, n, requireActive = true, source = null, reason = 'content', cap = Infinity, capKey = null } = {}) {
  if (!battle || !battle.flags || !battle.flags.layerGainsEnabled || playerId == null) return 0;
  const k0 = Math.floor(num(n, 0));
  if (!(k0 > 0)) return 0;
  const list = Array.isArray(bonds) ? bonds : [bonds];
  const caps = capKey != null && Number.isFinite(cap) ? battleStore(battle, 'support:layerCaps', () => new Map()) : null;
  let total = 0;
  for (const b of list) {
    if (typeof b !== 'string' || !b) continue;
    if (requireActive && !bondActive(battle, playerId, b)) continue;
    let k = k0;
    let ck = null;
    if (caps) {
      ck = `${capKey}|${b}`;
      const used = caps.get(ck) ?? 0;
      k = Math.min(k, Math.max(0, Math.floor(cap) - used));
      if (!(k > 0)) continue;
    }
    const added = battle.addLayers(playerId, b, k, reason, { source });
    if (added > 0) {
      total += added;
      if (ck) caps.set(ck, (caps.get(ck) ?? 0) + k);
    }
  }
  return total;
}

/** Layers already added this battle under (capKey, bond) — for tests / UI. */
export function layersUsed(battle, capKey, bondId) {
  return battleStore(battle, 'support:layerCaps', () => new Map()).get(`${capKey}|${bondId}`) ?? 0;
}
