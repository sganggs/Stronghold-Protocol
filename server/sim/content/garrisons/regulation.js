// server/sim/content/garrisons/regulation.js — 规程·序列Ⅰ IN_BATTLE 特质 (act3autochess@V3_1).
//
// Keyed by effectKey / blackboard key, never by garrison id. Default data has none of these keys, so install()
// only reaches them when the loaded tables do. Official range grids (range_table.json) are hardcoded: the tables
// the sim ships do not carry range_table. A payload (a child another garrison's garrison_trigger_buff points at,
// or a row with garrison_event_key and no garrison_type) does not fire itself — battle.js fireGain calls runChild.
//
// This module must not import battle.js (battle.js imports it).

import * as S from '../support/index.js';
import { absoluteRangeKeys } from '../../targeting.js';
import { COLS } from '../../constants.js';

const ids = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);

/** Official range grids, offsets facing RIGHT (range_table.json). */
const GRIDS = Object.freeze({
  '0-1': Object.freeze([[0, 0]]),
  '1-1': Object.freeze([[0, 0], [0, 1]]),
  '1-5': Object.freeze([[0, 1]]),
  'x-5': Object.freeze([[1, 0], [0, -1], [0, 0], [0, 1], [-1, 0]]),
  'x-4': Object.freeze([[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 0], [0, 1], [1, -1], [1, 0], [1, 1]]),
  'b-4': Object.freeze([[0, -1]]),
  'x-1': Object.freeze([[2, 0], [1, -1], [1, 0], [1, 1], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, -1], [-1, 0], [-1, 1], [-2, 0]]),
});

/** ep_type → the burst-lock buff key. WATER is 侵蚀. */
const EP_LOCK = Object.freeze({ WATER: 'erosionBurst', FIRE: 'burnBurst', SANITY: 'neuralBurst', DARK: 'apoptosisBurst' });

/**
 * [ASSUMED] bond id of 【乌萨斯】 for the temp-layer extra. The blackboard names no bond; the text does, and every
 * published row of this effect sits on 乌萨斯 operators. The bond's own 2→4 is not added here.
 */
const URSUS_BOND = 'ursusShip';

function scopeMode(it) {
  const bb = it.bb || {};
  // use_global_range 0 means "not the whole field" (garrison_144); only 1 opts in.
  if (S.num(bb.use_global_range, 0) === 1) return 'global';
  if (S.num(bb.use_attack_range, 0) === 1 || S.num(bb.bond_use_char_range, 0) === 1) return 'attack';
  if (it.bbStr && it.bbStr.range_id) return 'grid';
  const desc = (it.g && it.g.desc) || '';
  // [ASSUMED] no range field but the text says 攻击范围内 (garrison_70 has neither range_id nor at_root), or at_root
  // with no range (garrison_10 / garrison_64): the carrier's attack range.
  if (desc.includes('攻击范围') || S.num(bb.at_root, 0) === 1) return 'attack';
  return 'none';
}

/**
 * [ASSUMED] 自身及周围 / 自身及身前 keeps the carrier's tile. 周围 or 身前 drops it (x-4 周围八格, 1-1 身前, x-1 周围12格).
 * 0-1 is self. A later 自身 that names the grant recipient (garrison_49 使自身及身后) is not 自身及周围.
 */
function gridExcludesSelf(it) {
  const desc = (it.g && it.g.desc) || '';
  const rid = (it.bbStr && it.bbStr.range_id) || '';
  if (rid === '0-1') return false;
  if (/自身及周围|自身及身前/.test(desc)) return false;
  if (/周围|身前/.test(desc)) return true;
  return false;
}

function attackKeys(u) {
  if (u.rangeKeySet && u.rangeKeySet.size) return u.rangeKeySet;
  return new Set(absoluteRangeKeys(u.rangeGrid, u.tileR, u.tileC, u.dir));
}

/** Tile keys the effect watches, or null for the whole field. Death keeps tileR / tileC / dir (the body stays). */
function rangeKeySet(it) {
  const mode = scopeMode(it);
  if (mode === 'global') return null;
  const u = it.unit;
  if (!u || !Number.isInteger(u.tileR) || !Number.isInteger(u.tileC)) return new Set();
  if (mode === 'attack') return attackKeys(u);
  if (mode === 'grid') {
    const grid = GRIDS[it.bbStr.range_id];
    if (!grid) return new Set();
    const set = new Set(absoluteRangeKeys(grid, u.tileR, u.tileC, u.dir));
    if (gridExcludesSelf(it)) set.delete(u.tileR * COLS + u.tileC);
    return set;
  }
  return new Set();
}

/** Is `target` inside the effect's range? Global range matches any unit; the caller filters the side. */
export function inGarrisonRange(battle, it, target) {
  if (!target) return false;
  if (scopeMode(it) === 'global') return true;
  return S.onKeys(target, rangeKeySet(it));
}

function allyOpsInRange(battle, it) {
  const out = [];
  const global = scopeMode(it) === 'global';
  const keys = global ? null : rangeKeySet(it);
  for (const t of battle.allyUnits) {
    if (!S.isOp(t) || t.ownerId !== it.unit.ownerId || !S.onField(t)) continue;
    if (!global && !S.onKeys(t, keys)) continue;
    out.push(t);
  }
  return out;
}

function bondsOf(battle, it) {
  switch (it.bbStr.bond_type) {
    case 'bond_self': return S.unitBonds(it.unit).filter((b) => S.bondActive(battle, it.unit.ownerId, b));
    case 'bond_actived_maxstack': { const b = S.topActiveBond(battle, it.unit.ownerId); return b ? [b] : []; }
    case 'bond_allinrange': return [];
    default: return ids(it.bbStr.bond_id);
  }
}

function amountOf(it) {
  const bb = it.bb || {};
  if (it.bbStr.bond_add_type === 'by_charlevel') return S.tierOf(it.unit) * S.num(bb.bond_add_count, 1);
  return S.num(bb.bond_add_count, 0);
}

/** Layer grant mirroring fireGain's by_count / bond_self / bond_by_id path. Not a trigger-buff. */
export function gainLike(battle, it, { capKey = null, source = null, bonds = null, n = null } = {}) {
  const list = bonds || bondsOf(battle, it);
  const amt = n == null ? amountOf(it) : n;
  if (!list.length || !(amt > 0)) return 0;
  return S.gainLayers(battle, {
    playerId: it.unit.ownerId, bonds: list, n: amt, requireActive: true,
    source: source || it.unit, reason: 'garrison', cap: it.cap, capKey: capKey || it.capKey,
  });
}

function bondSteps(battle, it) {
  const div = Math.max(1, S.num(it.bb.denominator, 1));
  let sum = 0;
  for (const b of ids(it.bbStr.bond_id)) if (S.bondActive(battle, it.unit.ownerId, b)) sum += S.bondLayers(battle, it.unit.ownerId, b);
  return Math.floor(sum / div);
}
function onLayerChange(battle, fn) {
  let pending = false;
  const defer = () => {
    if (pending) return;
    pending = true;
    battle.after(0, () => { pending = false; fn(); });
  };
  battle.on('bondLayersChanged', defer, { priority: -100 });
}

/**
 * bond_allinrange (garrison_237): each operator on bond_range_id gets the grant on their own active bonds. b-4 is the
 * tile behind only (range_table). The carrier is not one of them: 佩佩's 「自身及身后一格」 is two rows, 49 (bond_self → the
 * carrier) and 237 (b-4 → the one behind); the elite's 237_b shows the pair's shared text, the normal 237_a reads only
 * 身后一格 (round 84 — the carrier was paid twice before).
 */
export function grantBondRange(battle, it) {
  const u = it.unit;
  const grid = GRIDS[it.bbStr.bond_range_id] || GRIDS['b-4'];
  const keys = new Set(absoluteRangeKeys(grid, u.tileR, u.tileC, u.dir));
  const targets = [];
  for (const t of battle.allyUnits) {
    if (!S.isOp(t) || t.ownerId !== u.ownerId || !S.onField(t) || t === u) continue;
    if (S.onKeys(t, keys)) targets.push(t);
  }
  let total = 0;
  for (const t of targets) {
    const bonds = S.unitBonds(t).filter((b) => S.bondActive(battle, t.ownerId, b));
    total += gainLike(battle, it, { bonds, source: u });
  }
  return total;
}

function onBattleStart(battle, fn, { immediate = true } = {}) {
  battle.on('battleStart', fn);
  // A listener installed after the battle has started would otherwise run at once. bondstackmax and
  // act3autochess_gar_event_battlestart pass immediate:false — their template is one mode-change, not a late birth.
  if (immediate && battle.started) fn();
}

// ---------------------------------------------------------------------------------------------------------------------
// payloads (run from the parent via runChild — never from the installer's own listener)

function runAddSp(battle, it) {
  const sp = S.num(it.bb.sp, 0);
  if (!(sp > 0)) return;
  const need = ids(it.bbStr.bond_id);
  for (const t of allyOpsInRange(battle, it)) {
    if (need.length && !need.every((b) => S.isMember(battle, t, b))) continue;
    if (t.skill && !t.skill.noSkill) t.skill.gainSp(sp, 'garrison');
  }
}

function applyRespawnCut(battle, u, cut) {
  if (!u || !Number.isFinite(u.respawnAt)) return;
  if (cut.ratio) {
    const rem = Math.max(0, u.respawnAt - battle.time);
    u.respawnAt = battle.time + rem * cut.value;
  } else {
    u.respawnAt = Math.max(battle.time, u.respawnAt - cut.value);
  }
}

function ensureRespawnHook(battle) {
  if (battle._garRespawnHook) return;
  battle._garRespawnHook = true;
  // Registered on the first cut, not for every battle. A listener added during the current death does not see it
  // (hooks.js snapshots), so units already down are cut immediately by runMinusRespawn.
  battle.on('death', ({ unit }) => {
    if (!unit || unit.side !== 'ally' || unit.kind !== 'op') return;
    const cuts = unit.mem && unit.mem.respawnCut;
    if (Array.isArray(cuts)) {
      for (const c of cuts) applyRespawnCut(battle, unit, c);
      unit.mem.respawnCut = [];
    }
    const pending = battle._benchCuts && battle._benchCuts[unit.uid];
    if (Array.isArray(pending)) {
      for (const c of pending) applyRespawnCut(battle, unit, c);
      delete battle._benchCuts[unit.uid];
    }
  });
}

function pushPendingCut(u, cut) {
  if (!u.mem.respawnCut) u.mem.respawnCut = [];
  u.mem.respawnCut.push(cut);
}

function queueBenchCut(battle, uid, cut) {
  if (!battle._benchCuts) battle._benchCuts = {};
  if (!battle._benchCuts[uid]) battle._benchCuts[uid] = [];
  battle._benchCuts[uid].push(cut);
}

/**
 * [ASSUMED] a cut of the remaining redeploy timer. is_ratio 0 subtracts seconds; is_ratio 1 multiplies what is left
 * (0.7 keeps 70%, the text's −30%). On-field operators take it on their next death. Already-down operators take it
 * now. Bench pieces have no match-side timer: the cut waits until that uid is a battle unit.
 * The carrier is not a beneficiary (the text does not say 自身).
 */
function runMinusRespawn(battle, it) {
  ensureRespawnHook(battle);
  const cut = S.num(it.bb.is_ratio, 0) === 1
    ? { ratio: true, value: S.num(it.bb.remaining_respawn_time, 1) }
    : { ratio: false, value: S.num(it.bb.remaining_respawn_time, 0) };
  const host = it.unit;
  if (S.num(it.bb.use_to_attackrange, 0) === 1) {
    for (const t of battle.allyUnits) {
      if (!S.isOp(t) || t.ownerId !== host.ownerId || t === host) continue;
      if (!inGarrisonRange(battle, it, t)) continue;
      if (S.onField(t)) pushPendingCut(t, cut);
      else applyRespawnCut(battle, t, cut);
    }
  }
  if (S.num(it.bb.use_to_hand, 0) === 1) {
    const bench = battle.getPlayer(host.ownerId)?.input?.bench || [];
    for (const e of bench) {
      if (!e || e.uid == null) continue;
      const u = battle.allyUnits.find((x) => x.uid === e.uid);
      if (u && !S.onField(u)) applyRespawnCut(battle, u, cut);
      else if (u) pushPendingCut(u, cut);
      else queueBenchCut(battle, e.uid, cut);
    }
  }
}

function applyStackMax(battle, it) {
  if (it._stackApplied) return;
  it._stackApplied = true;
  const global = scopeMode(it) === 'global';
  const keys = global ? null : rangeKeySet(it);
  const need = ids(it.bbStr.filter_bond_ids);
  const bySelf = S.num(it.bb.filter_bond_by_self, 0) === 1;
  const mine = new Set(S.unitBonds(it.unit));
  const flat = Object.prototype.hasOwnProperty.call(it.bb, 'max_add');
  const factor = Object.prototype.hasOwnProperty.call(it.bb, 'max_factor');
  for (const t of battle.allyUnits) {
    if (!S.isOp(t) || t.ownerId !== it.unit.ownerId || !S.onField(t)) continue;
    if (bySelf && t === it.unit) continue;
    if (bySelf && !S.unitBonds(t).some((b) => mine.has(b))) continue;
    // filter_bond_ids is ANY: AutoChessFilterCharacterBondIds._FilterBondId returns true on the first listed bond the
    // operator has, 调和 included through IsManiAffectedBond (garrison_227 / 228: 【谢拉格】 or 【灵巧】).
    if (need.length && !need.some((b) => S.isMember(battle, t, b))) continue;
    if (!global && !S.onKeys(t, keys)) continue;
    for (const inst of battle._garInstances || []) {
      if (inst.unit !== t || !Number.isFinite(inst.cap)) continue;
      if (flat) inst.cap += S.num(it.bb.max_add, 0);
      else if (factor) inst.cap = Math.floor(inst.cap * (1 + S.num(it.bb.max_factor, 0)));
    }
  }
}

function chessRanged(battle, chessId) {
  const rec = S.chessRecord(chessId) || battle.data?.getChess?.(chessId);
  return rec?.position === 'RANGED';
}

/** The incoming chess can stand here: own board, buildable for its position, no living unit, no body, not reserved. */
function tilePlaceable(battle, ps, r, c, chessId) {
  if (!Number.isInteger(r) || !Number.isInteger(c)) return false;
  if (!battle.onOwnBoard(ps, r, c)) return false;
  if (!battle.grid.inRect(r, c) || !battle.grid.canStand(r, c, { ranged: chessRanged(battle, chessId) })) return false;
  if (battle.unitAt(r, c)) return false;
  if (battle.downOn(r, c)) return false;
  if (battle.isReservedTile(r, c)) return false;
  return true;
}

/**
 * A switch with the bench. Templates act3autochess_gar_effect_switchhand_triggergar (耀骑士临光 garrison_58) and
 * act3autochess_gar_effect_switchcharinhand[trigger] (历阵锐枪芬 garrison_224) use AutoChessMarkSwitchWithHand with
 * _selectType RIGHT, _putType ORIGINAL, _checkBond (switch_bond_id), _checkBuildable and _checkOriginBuildable: the
 * node of 卡西米尔 6's [switch] (handSwitch in bonds/regulation.js, whose text reads 「被击倒时离场，并召唤…上场」), and
 * switchcharinhand[trigger] InstantKills its owner right after marking. So the carrier leaves the battle (removed: its
 * body goes and it does not redeploy) and the incoming chess stands on the carrier's tile (ORIGINAL; tileR / tileC, the
 * tile it fell on). The pick is the highest bench idx (the existing reading of 最右侧) with every switch bond
 * (【卡西米尔】【突袭】 is an AND) that can stand on that tile; when none can, there is no switch and the carrier stays
 * down and redeploys. Until round 84 the carrier stayed down and the chess landed on the rightmost empty tile
 * ([ASSUMED]: the body held the tile). The match hand is not touched — the bench entry stays, and a uid already
 * created as a unit is skipped.
 */
function summonFromBench(battle, it) {
  const fell = it.unit;
  if (!fell || fell.alive || fell.removed) return null;
  const ps = battle.getPlayer(fell.ownerId);
  const bench = ps?.input?.bench;
  if (!ps || !Array.isArray(bench) || !bench.length) return null;
  const need = ids(it.bbStr.switch_bond_id);
  const picks = bench.filter((e) => e && e.kind === 'chess'
    && (!need.length || need.every((b) => (Array.isArray(e.bonds) ? e.bonds : []).includes(b)))
    && !battle.allyUnits.some((u) => u.uid === e.uid))
    .sort((a, b) => (b.idx | 0) - (a.idx | 0));
  const tile = [fell.tileR, fell.tileC];
  for (const e of picks) {
    fell.removed = true; // isDown is false once removed, so its body no longer holds the tile
    if (!tilePlaceable(battle, ps, tile[0], tile[1], e.chessId)) { fell.removed = false; continue; }
    const u = battle._createAllyFromInput(ps, { ...e, row: tile[0], col: tile[1], abs: true });
    if (!u) { fell.removed = false; continue; }
    const pending = battle._benchCuts && battle._benchCuts[u.uid];
    if (Array.isArray(pending)) {
      u.mem.respawnCut = pending.slice();
      delete battle._benchCuts[u.uid];
    }
    battle._setupUnit(u);
    if (typeof battle._installGarrisonLate === 'function') battle._installGarrisonLate(u);
    if (!battle.redeploy(u, { free: true, tile })) { u.removed = true; fell.removed = false; continue; }
    return u;
  }
  return null;
}

function grantSwitchLayers(battle, it, unit) {
  if (!unit) return;
  const bonds = S.unitBonds(unit).filter((b) => S.bondActive(battle, unit.ownerId, b));
  gainLike(battle, it, { bonds, capKey: `gar:${it.gid}:${unit.id}`, source: it.unit });
}

const PAYLOADS = {
  act3autochess_gar_effect_addsp_inrange: runAddSp,
  act3autochess_gar_effect_minus_respawn: runMinusRespawn,
  act3autochess_gar_effect_bondstackmax: applyStackMax,
  act3autochess_gar_effect_attrbybond_inrange: snapshotAura,
  'act3autochess_gar_effect_switchcharinhand[trigger]'(battle, it) { summonFromBench(battle, it); },
};

/** Run the child garrison a trigger_buff parent points at, once. */
export function runChild(battle, parent) {
  const gid = parent.bbStr && parent.bbStr.garrison_trigger_buff_garrison_key;
  const g = gid ? S.garrisonRecord(gid) : null;
  if (!g) return;
  const fn = PAYLOADS[g.effectKey];
  if (!fn) return;
  const bb = g.bb || {};
  const cap = S.num(bb.max_add_count_per_battle, 0) > 0 ? S.num(bb.max_add_count_per_battle) : Infinity;
  fn(battle, {
    unit: parent.unit, g, gid: g.garrisonId, key: g.effectKey, bb, bbStr: g.bbStr || {},
    cap, capKey: `gar:${g.garrisonId}:${parent.unit.id}`, cnt: 0, k: -1, payload: true,
  });
}

/**
 * Extra temporary 【乌萨斯】 layers this player's on-field carriers add on top of the bond's own kill grant.
 * The bond task reads this and must not also add it. Several carriers take the max, they do not sum.
 * Power (≥6 distinct on-field 乌萨斯 charIds) reads `ex_bond_cnt[power]`.
 */
export function ursusTempExtra(battle, playerId) {
  if (!battle || playerId == null) return 0;
  const seen = new Set();
  for (const u of battle.allyUnits) {
    if (u.ownerId !== playerId || !S.isOp(u) || !S.onField(u)) continue;
    if (!S.unitBonds(u).includes(URSUS_BOND)) continue;
    const cid = u.def && u.def.charId;
    if (cid) seen.add(cid);
  }
  const power = seen.size >= 6;
  let best = 0;
  for (const it of battle._garInstances || []) {
    if (it.key !== 'act3autochess_gar_effect_ursusexbondcnt') continue;
    if (it.unit.ownerId !== playerId || !S.onField(it.unit)) continue;
    const n = power ? S.num(it.bb['ex_bond_cnt[power]'], 0) : S.num(it.bb.ex_bond_cnt, 0);
    if (n > best) best = n;
  }
  return best;
}

function runBattleStart(battle, it) {
  if (it.payload) return;
  if (it.bbStr.garrison_type === 'garrison_trigger_buff') { runChild(battle, it); return; }
  if (S.num(it.bb.bond_add_as_tmp, 0) !== 1) return;
  const n = amountOf(it);
  if (!(n > 0)) return;
  for (const b of bondsOf(battle, it)) {
    if (!S.bondActive(battle, it.unit.ownerId, b)) continue;
    battle.addTempLayers(it.unit.ownerId, b, n);
  }
}

/**
 * One snapshot of floor(layers / denominator) onto the allies already in range. The parent
 * act2autochess_gar_event_onstart (ON_OWNER_POST_BORN) calls this on every deployment of the holder, redeploys
 * and 【移动】 included. No layer-change listener: a later gain does not rewrite it, and it is not recreated after
 * attr_duration. Steps of 0 apply nothing and do not clear a buff that is still running. Units who have since
 * left the cross keep what they were given.
 * [ASSUMED] a later deployment of the same holder replaces the remaining duration (refresh 'replace'). The created
 * buff's disableOverride is true; the task's redeploy contract is a new 30s, so this garrison's own re-application
 * is not blocked.
 */
function snapshotAura(battle, it) {
  const steps = bondSteps(battle, it);
  if (!(steps > 0)) return;
  const mods = {};
  if (S.num(it.bb.attack_speed_base, 0)) mods.aspd = S.num(it.bb.attack_speed_base, 0) * steps;
  if (S.num(it.bb.atk_base, 0)) Object.assign(mods, S.directMods({ atk: S.num(it.bb.atk_base, 0) * steps }));
  if (!Object.keys(mods).length) return;
  const duration = S.num(it.bb.attr_duration, 0);
  const key = `gar:${it.gid}:aura`;
  for (const t of allyOpsInRange(battle, it)) {
    battle.addBuff(t, { key, duration, refresh: 'replace', mods });
  }
}

function probPasses(battle, it) {
  // [ASSUMED] garrison_prob_key 1 with no `prob` field is certainty — no rng draw.
  if (!Object.prototype.hasOwnProperty.call(it.bb, 'prob')) return true;
  return battle.rng() < S.num(it.bb.prob, 1);
}

function fireRow(battle, it) {
  if (it.bbStr.garrison_type === 'garrison_trigger_buff') runChild(battle, it);
  else gainLike(battle, it);
}

export const REGULATION_INSTALLERS = {
  act3autochess_gar_effect_addsp_inrange() {},
  act3autochess_gar_effect_minus_respawn() {},
  act3autochess_gar_effect_bondstackmax(battle, list) {
    // ON_BUFF_TRIGGER from the battlestart parent, which is only ON_AUTO_CHESS_MODE_CHANGED. A carrier who
    // installLate's after the battle has started does not apply. A child installed before start still hears battleStart.
    const run = () => { for (const it of list) if (!it.payload) applyStackMax(battle, it); };
    onBattleStart(battle, run, { immediate: false });
  },
  'act3autochess_gar_effect_switchcharinhand[trigger]'(battle, list) {
    const live = list.filter((it) => !it.payload);
    if (!live.length) return;
    battle.on('death', ({ unit, reason }) => {
      if (reason !== 'killed') return;
      for (const it of live) if (it.unit === unit) summonFromBench(battle, it);
    });
  },
  act3autochess_gar_effect_switchhand_triggergar(battle, list) {
    battle.on('death', ({ unit, reason }) => {
      if (reason !== 'killed') return;
      for (const it of list) {
        if (it.unit !== unit || it.payload) continue;
        const summoned = summonFromBench(battle, it);
        grantSwitchLayers(battle, it, it.unit);
        grantSwitchLayers(battle, it, summoned);
      }
    });
  },
  act3autochess_gar_effect_ursusexbondcnt() {},
  act3autochess_gar_effect_ex_bond_cnt(battle, list) {
    // AutoChessAddCharacterExtraBondCnt sits on the buff owner. Only that operator's own
    // 卫戍 / 装备 gains grow, and two carriers do not add onto the same gain.
    battle.on('layerGain', (ctx) => {
      if (ctx.reason !== 'garrison' && ctx.reason !== 'item') return;
      if (!ctx.source) return;
      for (const it of list) {
        if (ctx.source !== it.unit) continue;
        if (it.unit.ownerId !== ctx.playerId || !S.onField(it.unit)) continue;
        ctx.n += S.num(it.bb.extra_cnt, 0);
      }
    });
  },
  act3autochess_gar_effect_firstdamgecold(battle, list) {
    for (const it of list) it.seen = new Set();
    battle.on('damaged', ({ source, credit, target, amount }) => {
      if (!(amount > 0) || !target || target.side !== 'enemy') return;
      for (const it of list) {
        if (source !== it.unit && credit !== it.unit) continue;
        if (it.seen.has(target.id)) continue;
        it.seen.add(target.id);
        battle.applyStatus(target, 'cold', { duration: S.num(it.bb.cold, 0), source: it.unit });
      }
    });
  },
  act3autochess_gar_effect_attackslow_inrange(battle, list) {
    battle.on('damaged', ({ source, credit, target, amount }) => {
      if (!(amount > 0) || !target) return;
      for (const it of list) {
        const steps = bondSteps(battle, it);
        if (!(steps > 0)) continue;
        const dealers = allyOpsInRange(battle, it);
        if (!dealers.some((d) => d === source || d === credit)) continue;
        // [ASSUMED] each damaging hit (amount > 0) refreshes one slow; 0 damage does not. Bands do not stack.
        battle.addBuff(target, {
          key: `gar:${it.gid}:slow`, duration: S.num(it.bb.slow_duration, 0), refresh: 'replace',
          mods: { moveMul: 1 + S.num(it.bb.numerator, 0) * steps },
        });
      }
    });
  },
  // Payload of act2autochess_gar_event_onstart. The child does not listen: a battleStart pass would include
  // allies who were not born at the holder's POST_BORN, and a layer listener is not in the template.
  act3autochess_gar_effect_attrbybond_inrange() {},
  act3autochess_gar_effect_block_eprecoverspeed_inrange(battle, list) {
    const arm = () => {
      for (const it of list) {
        it._epRate = S.num(it.bb.ep_break_recover_speed_base, 0) * bondSteps(battle, it);
        it._epLock = EP_LOCK[it.bbStr.ep_type] || null;
      }
    };
    onBattleStart(battle, arm);
    onLayerChange(battle, arm);
    battle.on('tick', ({ dt }) => {
      if (!(dt > 0)) return;
      for (const it of list) {
        if (!(it._epRate > 0) || !it._epLock) continue;
        for (const e of battle.enemies) {
          if (!e || !e.alive) continue;
          const lock = e.findBuff(it._epLock);
          if (lock && Number.isFinite(lock.timeLeft)) lock.timeLeft -= dt * it._epRate;
        }
      }
    });
  },
  act3autochess_gar_event_battlestart(battle, list) {
    onBattleStart(battle, () => { for (const it of list) runBattleStart(battle, it); }, { immediate: false });
  },
  act3autochess_gar_event_onstart_inrange(battle, list) {
    battle.on('deploy', ({ unit }) => {
      if (!unit || unit.kind !== 'op') return;
      for (const it of list) {
        if (it.payload || unit.ownerId !== it.unit.ownerId) continue;
        if (!inGarrisonRange(battle, it, unit)) continue;
        fireRow(battle, it);
      }
    });
  },
  act1autochess_gar_event_enemykilled_inrange(battle, list) {
    battle.on('kill', ({ victim }) => {
      if (!victim || victim.side !== 'enemy') return;
      for (const it of list) {
        if (it.payload || !S.onField(it.unit)) continue;
        if (!inGarrisonRange(battle, it, victim)) continue;
        it.cnt++;
        if (it.cnt % Math.max(1, S.num(it.bb.kill_count, 1)) !== 0) continue;
        fireRow(battle, it);
      }
    });
  },
  act3autochess_gar_event_enemy_epbreak_inrange(battle, list) {
    battle.on('elementBurst', ({ target }) => {
      if (!target || target.side !== 'enemy') return;
      for (const it of list) {
        if (it.payload || !S.onField(it.unit)) continue;
        if (!inGarrisonRange(battle, it, target)) continue;
        if (!probPasses(battle, it)) continue;
        fireRow(battle, it);
      }
    });
  },
};
