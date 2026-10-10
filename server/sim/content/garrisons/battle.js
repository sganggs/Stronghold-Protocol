// server/sim/content/garrisons/battle.js — IN_BATTLE 特质 (garrisons) of the operators on the field.
//
// Each operator carries `unit.def.raw.garrisonIds` (elite chess carry the `_b` garrisons); the IN_BATTLE ones are
// dispatched here by their effectKey (bbStr.key for battle runes, else effectType — docs/DATA.md §4):
//
//   ADD_BOND            grants `give_garrison_id` to other operators before the first deployment (targets parsed from
//                       the text: 身前一格 / 身前一格【X】/ 自身和身前一格 / 同一行最右边 / 所有【X】). A unit owns a garrison id
//                       at most once (耀骑士临光 already carries the 144/159 it grants to itself). A granted trait keeps
//                       its data cap like a native one: 华法琳's garrison_95 stops at 7 / 14 layers per battle (PRTS 下半
//                       3月27日更新#2: 「从 初始12/精锐24 降低至 初始7/精锐14」; GitHub #175, PR #192 by @kukiC).
//   layer events        act1autochess_gar_event_useskill (skillStart) · _selfkillenemy (kill, every check_cnt) ·
//                       _selfdead (death 'killed'; texts with 替身 also on every substitute ⇄ body swap, read from the
//                       dollkeeper flag unit.trait.doll) · _consume_ammo (ammoUsed; range_id 0-1 self, 1-1 front tile,
//                       x-5 self + 4 adjacent, pooled counter) · _enemy_abflag_inrange (an enemy in range ENTERS
//                       'freeze', × prob) · act2autochess_gar_event_onstart (every deploy) ·
//                       act2autochess_gar_event_allyenemy_sleepstun_inrange (an enemy or operator in range ENTERS
//                       sleep / stun). "进入…时": re-applying a running status (a refresh) is not a new entry
//                       (engine statusApplied ctx.entered) — except a pulse that re-applies its own short status as a
//                       fresh one (applyStatus `reenter`: 缇缇 S2's sleep ward, DESIGN §24.8).
//                       Targets: bond_by_id / bond_self (own active bonds) / bond_actived_maxstack;
//                       amounts: by_count / by_charcount_samerow / by_charlevel; conditions character_same_row /
//                       character_same_col (≥ check_count incl. self). Gains go through support.gainLayers with
//                       reason 'garrison', source = the trait's owner, cap = max_add_count_per_battle per (instance, bond)
//                       — per instance for bond_actived_maxstack (塑心: the highest bond may change, the cap does not).
//   act1autochess_gar_event_addition_cnt (魔王)  layerGain: a 'garrison' gain whose source stands on the tile in front
//                       of 魔王 (range_id 1-1) — or was knocked out there this instant (幽灵鲨 "被击倒时"; engine ctx.tile)
//                       — gets +extra_cnt per bond (the extra does not count toward the source's per-battle cap).
//   stat traits         GAIN_BUFF (battleRuneKey char_attribute_mul "攻击力和生命值+20%": a rune on the chess's base
//                       attributes, so atkMul / hpMul), attr_common_global_buff (spRecoveryFlat; "+X%" ATK / HP would be
//                       直接乘算), attrByBond ("每叠加N层…+X%": 直接乘算, support directMods),
//                       respawnTimeByBond, attrByBond_add_onstart, ab_damageScaleByBond — layer readers use
//                       floor(Σ layers of the listed ACTIVE bonds / divide_num) and are recomputed after every layer
//                       gain (research 02 §5 [ASSUMED] only active bonds count).
//   hit modifiers       act1autochess_gar_eff_attack_enemy (dmg.amount × atk vs check_tag enemies),
//                       ab_damageScaleByBond (bound / sluggish targets), _chaos (弱点伤害, research 04 glossary:
//                       phys/arts → whichever deals MORE after the engine's mitigation incl. the attacker's DEF/RES
//                       ignore and dealt/taken multipliers; a tie keeps the type).
//   NONE                风丸 "2 copies merge" — prep rule (chess.upgradeNum 2), nothing in battle.
//
// Hooks: priority 0, except 弱点伤害 (hit, WEAKNESS_PRIORITY −10: decided on the final amount after the ATK
// multipliers). install() registers nothing when no operator carries an IN_BATTLE garrison.

import * as S from '../support/index.js';
import { mitigate } from '../../damage.js';
import { frontOf } from '../../dir.js';

const ids = (s) => String(s ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const EMPTY = Object.freeze([]);
/** Status keys for check_ab_flag values used by the data (16 = 冻结). */
const AB_FLAG_STATUS = Object.freeze({ 16: 'freeze' });

function garrisonIdsOf(u) {
  const list = u?.def?.raw?.garrisonIds ?? u?.def?.garrisonIds;
  return Array.isArray(list) ? list : EMPTY;
}

// ---------------------------------------------------------------------------------------------------------------------
// install

export function install(battle) {
  const all = [];
  const owned = new Map(); // unit → Set(garrisonId)
  const add = (unit, g, grantedBy = null) => {
    let set = owned.get(unit);
    if (!set) { set = new Set(); owned.set(unit, set); }
    if (set.has(g.garrisonId)) return null;
    set.add(g.garrisonId);
    const bb = g.bb || {};
    const cap = S.num(bb.max_add_count_per_battle, 0) > 0 ? S.num(bb.max_add_count_per_battle) : Infinity;
    const it = {
      unit, g, gid: g.garrisonId, key: g.effectKey, bb, bbStr: g.bbStr || {}, grantedBy,
      cap, capKey: `gar:${g.garrisonId}:${unit.id}`, cnt: 0, k: -1,
    };
    all.push(it);
    return it;
  };
  for (const u of battle.allyUnits) {
    if (!S.isOp(u)) continue;
    for (const gid of garrisonIdsOf(u)) {
      const g = S.garrisonRecord(gid);
      if (g && g.eventType === 'IN_BATTLE') add(u, g);
    }
  }
  if (!all.length) return;

  const grants = [];
  for (const it of all.slice()) {
    if (it.key !== 'ADD_BOND') continue;
    const g2 = S.garrisonRecord(it.bbStr.give_garrison_id);
    if (!g2 || g2.eventType !== 'IN_BATTLE') continue;
    for (const t of grantTargets(battle, it)) {
      const got = add(t, g2, it);
      if (got) grants.push(got);
    }
  }

  const by = new Map();
  for (const it of all) {
    let arr = by.get(it.key);
    if (!arr) { arr = []; by.set(it.key, arr); }
    arr.push(it);
  }
  for (const [key, list] of by) {
    const inst = INSTALLERS[key];
    if (inst) inst(battle, list);
  }
  installHitMods(battle, by);
  installReaders(battle, by);

  if (grants.length) {
    battle.on('battleStart', () => {
      for (const it of grants) S.fxOn(battle, 'garrisonGrant', it.unit, `gar:${it.grantedBy.gid}`, it.gid, { from: it.grantedBy.unit.id });
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// ADD_BOND targets (before deployment: home tiles)

function opsOf(battle, pid) {
  const out = [];
  for (const u of battle.allyUnits) if (S.isOp(u) && u.ownerId === pid && !u.removed) out.push(u);
  return out;
}
function opAtHome(battle, pid, r, c) {
  for (const u of battle.allyUnits) if (S.isOp(u) && u.ownerId === pid && !u.removed && u.homeR === r && u.homeC === c) return u;
  return null;
}

function grantTargets(battle, it) {
  const u = it.unit;
  const desc = it.g.desc || '';
  const need = it.bbStr.check_bond_id || null;
  const ok = (t) => !!t && (!need || S.isMember(battle, t, need));
  const front = () => { const [fr, fc] = frontOf(u.homeR, u.homeC, u.dir); return opAtHome(battle, u.ownerId, fr, fc); };
  if (desc.includes('所有')) return opsOf(battle, u.ownerId).filter(ok);
  if (desc.includes('同一行最右边')) {
    let best = null;
    for (const t of opsOf(battle, u.ownerId)) {
      if (t.homeR !== u.homeR) continue;
      // a board position ("最右边" of the player's own board: the mirrored Final Assault right side counts from the left)
      const col = (x) => (x.player && x.player.mirror ? -x.homeC : x.homeC);
      if (!best || col(t) > col(best)) best = t;
    }
    return ok(best) ? [best] : [];
  }
  const out = [];
  if (desc.includes('自身和身前') && ok(u)) out.push(u);
  const f = front();
  if (ok(f)) out.push(f);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// layer gains

function targetBonds(battle, it) {
  const u = it.unit;
  switch (it.bbStr.bond_type) {
    case 'bond_self': return S.unitBonds(u).filter((b) => S.bondActive(battle, u.ownerId, b));
    case 'bond_actived_maxstack': { const b = S.topActiveBond(battle, u.ownerId); return b ? [b] : EMPTY; }
    default: return ids(it.bbStr.bond_id);
  }
}

function amountOf(battle, it) {
  const bb = it.bb;
  switch (it.bbStr.bond_add_type) {
    case 'by_charcount_samerow': return S.rowMates(battle, it.unit).length * S.num(bb.bond_add_count_multi, S.num(bb.bond_add_count, 1));
    case 'by_charlevel': return S.tierOf(it.unit) * S.num(bb.bond_add_count, 1);
    default: return S.num(bb.bond_add_count, 0);
  }
}

function conditionMet(battle, it) {
  const ck = it.bbStr.conditionkey;
  const need = S.num(it.bb.check_count, 0);
  if (ck === 'character_same_row') return S.rowMates(battle, it.unit).length >= need;
  if (ck === 'character_same_col') {
    let n = 0;
    for (const a of battle.allyUnits) if (S.isOp(a) && a.ownerId === it.unit.ownerId && S.onField(a) && a.tileC === it.unit.tileC) n++;
    return n >= need;
  }
  return true;
}

/** Fire a layer-gain garrison instance. Returns the layers added. */
export function fireGain(battle, it) {
  if (!conditionMet(battle, it)) return 0;
  const bonds = targetBonds(battle, it);
  if (!bonds.length) return 0;
  let n = amountOf(battle, it);
  // bond_actived_maxstack (塑心 garrison_90 "当前已激活且层数最多的盟约层数+1（每场作战至多10层）"): the cap is the instance's
  // own over the battle, whichever bond is the highest at each gain — per (instance, bond) a change of the highest bond
  // granted a fresh 10 (PR #178 review). The base amount counts toward it (魔王's extra does not, as in gainLayers).
  const whole = it.bbStr.bond_type === 'bond_actived_maxstack' && Number.isFinite(it.cap);
  if (whole) {
    n = Math.min(Math.floor(n), Math.max(0, Math.floor(it.cap) - (it.wholeUsed ?? 0)));
    if (!(n > 0)) return 0;
  }
  const added = S.gainLayers(battle, {
    playerId: it.unit.ownerId, bonds, n, requireActive: true, source: it.unit, reason: 'garrison',
    cap: whole ? Infinity : it.cap, capKey: whole ? null : it.capKey,
  });
  if (whole && added > 0) it.wholeUsed = (it.wholeUsed ?? 0) + n;
  if (added > 0) S.fxOn(battle, 'garrison', it.unit, `gar:${it.gid}`, it.key, { n: added });
  return added;
}

const byUnit = (list) => {
  const m = new Map();
  for (const it of list) {
    let a = m.get(it.unit);
    if (!a) { a = []; m.set(it.unit, a); }
    a.push(it);
  }
  return m;
};

function isFrontOf(holder, u) {
  if (!u || u === holder || u.ownerId !== holder.ownerId || !S.onField(u)) return false;
  const [fr, fc] = frontOf(holder.tileR, holder.tileC, holder.dir);
  return u.tileR === fr && u.tileC === fc;
}
/**
 * 魔王: the gain's source (an operator of the holder's player) stands in front of it. `tile` = the engine's layerGain
 * ctx.tile: where the source stands, or where it was knocked out this very instant (幽灵鲨 "被击倒时" gains fire on death).
 */
function sourceInFront(holder, u, tile) {
  if (!u || u === holder || u.ownerId !== holder.ownerId || !S.isOp(u) || !Array.isArray(tile)) return false;
  const [fr, fc] = frontOf(holder.tileR, holder.tileC, holder.dir);
  return tile[0] === fr && tile[1] === fc;
}
function ammoScope(it, u) {
  const h = it.unit;
  switch (it.bbStr.range_id) {
    case '1-1': return S.onField(h) && isFrontOf(h, u);
    case 'x-5': return u === h || (S.onField(h) && S.onField(u) && u.ownerId === h.ownerId && S.isOp(u) && Math.abs(u.tileR - h.tileR) + Math.abs(u.tileC - h.tileC) === 1);
    default: return u === h;
  }
}

const INSTALLERS = {
  act1autochess_gar_event_useskill(battle, list) {
    const m = byUnit(list);
    battle.on('skillStart', ({ unit }) => {
      const arr = m.get(unit);
      if (arr) for (const it of arr) fireGain(battle, it);
    });
  },

  act1autochess_gar_event_selfkillenemy(battle, list) {
    const m = byUnit(list);
    for (const it of list) it.allies = /我方干员/.test(it.g.desc || '');
    battle.on('kill', ({ killer, victim }) => {
      const arr = killer ? m.get(killer) : null;
      if (!arr || !victim) return;
      for (const it of arr) {
        if (!(victim.side === 'enemy' || (it.allies && victim.side === 'ally' && victim.kind === 'op'))) continue;
        it.cnt++;
        if (it.cnt % Math.max(1, S.num(it.bb.check_cnt, 1)) === 0) fireGain(battle, it);
      }
    });
  },

  act1autochess_gar_event_selfdead(battle, list) {
    const m = byUnit(list);
    battle.on('death', ({ unit, reason }) => {
      if (reason !== 'killed') return;
      const arr = m.get(unit);
      if (arr) for (const it of arr) fireGain(battle, it);
    });
    const swaps = list.filter((it) => /替身/.test(it.g.desc || ''));
    if (!swaps.length) return;
    for (const it of swaps) it.doll = false;
    battle.on('tick', () => {
      for (let i = 0; i < swaps.length; i++) {
        const it = swaps[i];
        const u = it.unit;
        const doll = !!(u.trait && u.trait.doll);
        if (doll === it.doll) continue;
        it.doll = doll;
        if (u.alive && u.deployed) fireGain(battle, it);
      }
    });
  },

  act1autochess_gar_event_consume_ammo(battle, list) {
    battle.on('ammoUsed', ({ unit }) => {
      if (!unit) return;
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        if (!ammoScope(it, unit)) continue;
        it.cnt++;
        if (it.cnt % Math.max(1, S.num(it.bb.consume_count, 1)) === 0) fireGain(battle, it);
      }
    });
  },

  act1autochess_gar_event_enemy_abflag_inrange(battle, list) {
    const watched = new Set(list.map((it) => AB_FLAG_STATUS[S.num(it.bb.check_ab_flag, 16)] ?? 'freeze'));
    // "进入冻结时": only a new entry (engine ctx.entered — a refresh of a running freeze is not one)
    battle.on('statusApplied', ({ target, status, entered }) => {
      if (!target || !watched.has(status) || !entered || target.side !== 'enemy') return;
      for (const it of list) {
        if (status !== (AB_FLAG_STATUS[S.num(it.bb.check_ab_flag, 16)] ?? 'freeze')) continue;
        if (!S.onField(it.unit) || !S.inRange(it.unit, target)) continue;
        if (battle.rng() < S.num(it.bb.prob, 1)) fireGain(battle, it);
      }
    });
  },

  act2autochess_gar_event_onstart(battle, list) {
    const m = byUnit(list);
    battle.on('deploy', ({ unit }) => {
      const arr = m.get(unit);
      if (arr) for (const it of arr) fireGain(battle, it);
    });
    // Player-confirmed: 远牙's granted trait also gains on each body / substitute switch (DESIGN §28.5).
    // Restrict this extra trigger to that trait; use its existing amounts, active-bond checks and battle cap.
    const farTooth = byUnit(list.filter((it) => it.gid === 'garrison_108_a' || it.gid === 'garrison_108_b'));
    if (farTooth.size) battle.on('dollSwap', ({ unit }) => {
      const arr = farTooth.get(unit);
      if (arr) for (const it of arr) fireGain(battle, it);
    });
  },

  act2autochess_gar_event_allyenemy_sleepstun_inrange(battle, list) {
    battle.on('statusApplied', ({ target, status, entered }) => { // "进入沉睡/晕眩时": new entries only (ctx.entered)
      if (!target || (status !== 'sleep' && status !== 'stun') || !entered) return;
      if (!(target.side === 'enemy' || (target.side === 'ally' && target.kind === 'op'))) return;
      for (const it of list) if (S.onField(it.unit) && S.inRange(it.unit, target)) fireGain(battle, it);
    });
  },

  act1autochess_gar_event_addition_cnt(battle, list) {
    battle.on('layerGain', (ctx) => {
      if (ctx.reason !== 'garrison' || !ctx.source) return;
      for (const it of list) {
        const h = it.unit;
        if (h.ownerId !== ctx.playerId || !S.onField(h)) continue;
        if (it.bbStr.range_id && it.bbStr.range_id !== '1-1') continue;
        if (sourceInFront(h, ctx.source, ctx.tile)) ctx.n += S.num(it.bb.extra_cnt, 0);
      }
    });
  },

  GAIN_BUFF(battle, list) {
    for (const it of list) {
      const mods = {};
      if (S.num(it.bb.atk, 0) > 0) mods.atkMul = S.num(it.bb.atk);
      if (S.num(it.bb.max_hp, 0) > 0) mods.hpMul = S.num(it.bb.max_hp);
      if (S.num(it.bb.def, 0) > 0) mods.defMul = S.num(it.bb.def);
      S.passiveBuff(battle, it.unit, `gar:${it.gid}`, mods);
    }
  },

  attr_common_global_buff(battle, list) {
    for (const it of list) {
      const mods = {};
      if (S.num(it.bb.sp_recovery_per_sec, 0)) mods.spRecoveryFlat = S.num(it.bb.sp_recovery_per_sec);
      Object.assign(mods, S.directMods({ atk: S.num(it.bb.atk, 0), hp: S.num(it.bb.max_hp, 0) }));
      if (S.num(it.bb.attack_speed, 0)) mods.aspd = S.num(it.bb.attack_speed);
      S.passiveBuff(battle, it.unit, `gar:${it.gid}`, mods);
    }
  },

  // grants are resolved in install(); 风丸's rule lives in the prep economy
  ADD_BOND() {},
  NONE() {},
};

// ---------------------------------------------------------------------------------------------------------------------
// layer readers (每叠加N层)

const READERS = new Set([
  'act1autochess_gar_eff_attrByBond', 'act1autochess_gar_eff_respawnTimeByBond',
  'act2autochess_gar_eff_attrByBond_add_onstart', 'act2autochess_gar_eff_ab_damageScaleByBond',
]);

/** floor(Σ layers of the listed active bonds / divide_num). */
export function stepsOf(battle, it) {
  const div = Math.max(1, S.num(it.bb.divide_num, 1));
  let sum = 0;
  for (const b of it.bonds ?? (it.bonds = ids(it.bbStr.bond_id))) if (S.bondActive(battle, it.unit.ownerId, b)) sum += S.bondLayers(battle, it.unit.ownerId, b);
  return Math.floor(sum / div);
}

function attrMods(bb, k) {
  // "每叠加N层，本干员攻击力+X%": a 直接乘算 bonus like every other "+X%" of the 卫戍 systems (support directMods)
  const m = S.directMods({ atk: S.num(bb.atk, 0) * k, hp: S.num(bb.max_hp, 0) * k, def: S.num(bb.def, 0) * k });
  if (S.num(bb.attack_speed, 0)) m.aspd = S.num(bb.attack_speed) * k;
  if (S.num(bb.hp_recovery_per_sec, 0)) m.hpRegen = S.num(bb.hp_recovery_per_sec) * k;
  if (S.num(bb.sp_recovery_per_sec, 0)) m.spRecoveryFlat = S.num(bb.sp_recovery_per_sec) * k;
  return m;
}

function applyReader(battle, it) {
  const k = stepsOf(battle, it);
  if (k === it.k) return;
  it.k = k;
  const u = it.unit;
  const key = `gar:${it.gid}`;
  switch (it.key) {
    case 'act1autochess_gar_eff_attrByBond':
      if (k > 0) S.passiveBuff(battle, u, key, attrMods(it.bb, k));
      else battle.removeBuff(u, key);
      break;
    case 'act1autochess_gar_eff_respawnTimeByBond':
      // 耀骑士临光's 144: −1.5 % / −3 % per 3 卡西米尔 layers with no minimum in the blackboard (divide_num, respawn_time
      // only) — clamped at 0 like every other redeploy multiplier, so a knock-out timer can reach 0 s (GitHub #370;
      // until 0.2.1 a 0.05 floor kept it at 5 % of the base time from 192 layers, 96 for the elite)
      if (k > 0) S.passiveBuff(battle, u, key, { redeployMul: Math.max(0, 1 + S.num(it.bb.respawn_time, 0) * k) });
      else battle.removeBuff(u, key);
      break;
    case 'act2autochess_gar_eff_attrByBond_add_onstart': {
      const b = u.findBuff(key);
      if (b && b.timeLeft > 0) onstartBuff(battle, it, b.timeLeft);
      break;
    }
    default: break; // damageScale reads it.k in the hit hook
  }
}

function onstartBuff(battle, it, duration) {
  const k = Math.max(0, it.k);
  const key = `gar:${it.gid}`;
  if (!(k > 0) || !(duration > 0)) { battle.removeBuff(it.unit, key); return; }
  battle.addBuff(it.unit, { key, duration, refresh: 'replace', mods: { atkFlat: S.num(it.bb.atk, 0) * k, hpFlat: S.num(it.bb.max_hp, 0) * k } });
}

function installReaders(battle, by) {
  const list = [];
  for (const key of READERS) for (const it of by.get(key) ?? EMPTY) list.push(it);
  if (!list.length) return;
  const recompute = () => { for (const it of list) applyReader(battle, it); };
  recompute();
  let pending = false;
  battle.on('layerGain', () => {
    if (pending) return;
    pending = true;
    battle.after(0, () => { pending = false; recompute(); });
  });
  const onstart = by.get('act2autochess_gar_eff_attrByBond_add_onstart');
  if (onstart) {
    const m = byUnit(onstart);
    battle.on('deploy', ({ unit }) => {
      const arr = m.get(unit);
      if (!arr) return;
      for (const it of arr) { it.k = stepsOf(battle, it); onstartBuff(battle, it, S.num(it.bb.duration, 0)); }
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// hit modifiers

/**
 * 弱点伤害 (research 04 §glossary: "each hit is dealt as whichever of physical/arts yields MORE damage against that
 * target's DEF/RES"): the engine's own mitigation formula incl. the attacker's DEF/RES ignore stats; a tie keeps the
 * original type.
 */
export function weaknessType(source, target, dmg) {
  const ss = source && source.s ? source.s : null;
  const ign = {
    defIgnorePct: S.num(dmg.defIgnorePct, 0) + (ss ? S.num(ss.defIgnorePct, 0) : 0),
    defIgnoreFlat: S.num(dmg.defIgnoreFlat, 0) + (ss ? S.num(ss.defIgnoreFlat, 0) : 0),
    resIgnorePct: S.num(dmg.resIgnorePct, 0) + (ss ? S.num(ss.resIgnorePct, 0) : 0),
    resIgnoreFlat: S.num(dmg.resIgnoreFlat, 0) + (ss ? S.num(ss.resIgnoreFlat, 0) : 0),
  };
  const ph = mitigate(dmg.amount, 'phys', target.s, ign) * (ss ? S.num(ss.physDealtMul, 1) : 1) * S.num(target.s.physTakenMul, 1);
  const ar = mitigate(dmg.amount, 'arts', target.s, ign) * (ss ? S.num(ss.artsDealtMul, 1) : 1) * S.num(target.s.artsTakenMul, 1);
  if (ar > ph + 1e-9) return 'arts';
  if (ph > ar + 1e-9) return 'phys';
  return dmg.type;
}
const bound = (t) => !!(t.s && t.s.flags && t.s.flags.bind) || !!t.findBuff('bind');

/** Priority of the 弱点伤害 conversion: after every default-priority hit modifier, so the final amount decides. */
export const WEAKNESS_PRIORITY = -10;

function installHitMods(battle, by) {
  const m = new Map();
  const push = (it, kind) => {
    let a = m.get(it.unit);
    if (!a) { a = []; m.set(it.unit, a); }
    a.push({ it, kind });
  };
  for (const it of by.get('act1autochess_gar_eff_attack_enemy') ?? EMPTY) push(it, 'tag');
  for (const it of by.get('act2autochess_gar_eff_ab_damageScaleByBond') ?? EMPTY) push(it, 'ab');
  if (m.size) {
    battle.on('hit', ({ source, target, dmg }) => {
      const arr = source ? m.get(source) : null;
      if (!arr || !target || target.side !== 'enemy' || !dmg || dmg.type === 'element') return;
      for (let i = 0; i < arr.length; i++) {
        const { it, kind } = arr[i];
        if (kind === 'tag') {
          // an ATK multiplier: fixed-value DoT ticks are not ATK-based
          if (Array.isArray(dmg.tags) && dmg.tags.includes('dot')) continue;
          const tags = target.def && target.def.tags;
          if (Array.isArray(tags) && tags.includes(it.bbStr.check_tag)) dmg.amount *= S.num(it.bb.atk, 1);
        } else if (it.k > 0) {
          const hit = (S.num(it.bb.check_ab_flag, 0) && bound(target)) || (S.num(it.bb.check_sluggish, 0) && !!target.findBuff('sluggish'));
          if (hit) dmg.mul = S.num(dmg.mul, 1) * (1 + S.num(it.bb.damage_scale_per_stack, 0) * it.k);
        }
      }
    });
  }
  const chaos = new Set((by.get('act1autochess_gar_eff_chaos') ?? EMPTY).map((it) => it.unit));
  if (chaos.size) {
    battle.on('hit', ({ source, target, dmg }) => {
      if (!source || !chaos.has(source) || !target || target.side !== 'enemy' || !dmg) return;
      if (dmg.type === 'phys' || dmg.type === 'arts') dmg.type = weaknessType(source, target, dmg);
    }, { priority: WEAKNESS_PRIORITY });
  }
}
