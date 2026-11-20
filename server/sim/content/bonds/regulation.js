// server/sim/content/bonds/regulation.js — 规程·序列Ⅰ bond clauses (act3autochess V3_1).
//
// Dispatch is by effectId. 规程 reuses yan / sargon / kjerag / siracusa / kazimierz with new effect ids; a band can
// swap those ids back (and victoria → victoria_2, egir → egir_2). This module does not import core.js: core calls
// bindLegacy after its installers exist, then installEffect / installExtra from install().
// Default data never enters here (core.install only calls us when support.isVersionData()).
//
// Standing ATK / HP / DEF ratios are 直接乘算 (support.directMods). Live layers: support.bondLayers. A missing
// threshold is not reached on version data, same rule as core.reached.

import * as S from '../support/index.js';
import { ursusTempExtra } from '../garrisons.js';
import { lendItemEffects } from '../items.js';
import { damageAttackType, isHpLoss } from '../../attack.js';
import { bodyInKeys } from '../../body.js';
import { COLS } from '../../constants.js';
import { tileKeyOf } from '../../targeting.js';
import { msg } from '../../../../shared/i18n.js';
import { bbCap } from '../../../../shared/plugins/officialBounds.js';
import { captureLethaniaBirthMode, lethaniaSummon, pursueGroundEnemy } from './lethania.js';

const num = S.num;

/** Bond ids whose 规程 effect id differs from 盟约. core.install dispatches these by effectId. */
export const EFFECT_KEYED_BONDS = new Set(['yanShip', 'sargonShip', 'kjeragShip', 'siracusaShip', 'kazimierzShip']);

/** Buff keys this season introduces. Named so the blackboard audit can see them. */
const K = Object.freeze({
  yan: 'act3autochess_bond_eff_yan',
  yanEnemy: 'act3autochess_bond_eff_yan[enemy]',
  sargon: 'act3autochess_bond_eff_sargon',
  sargonPower: 'act3autochess_bond_eff_sargon_power',
  sargonTile: 'act3autochess_bond_eff_sargon_power[tile_listener]',
  kjerag: 'act3autochess_bond_eff_kjerag',
  kjeragPower: 'act3autochess_bond_eff_kjerag_power',
  siracusa: 'act3autochess_bond_eff_siracusa',
  kazimierz: 'act3autochess_bond_eff_kazimierz',
  victoria: 'act3autochess_bond_eff_victoria',
  egir: 'act3autochess_bond_eff_egir',
  ursus: 'act3autochess_bond_eff_ursus',
  iberia: 'act3autochess_bond_eff_iberia[enemy]',
  iberiaDot: 'act3autochess_bond_eff_iberia[enemy][dot]',
  lethania: 'act3autochess_bond_eff_lethania',
  lethaniaEnemy: 'act3autochess_bond_eff_lethania[enemy]',
  doc: 'act3autochess_bond_eff_doc',
  arcane: 'act3autochess_bond_eff_arcane',
  arcaneEnemy: 'act3autochess_bond_eff_arcane_power[enemy]',
  reward: 'bond_layer_added_reward_equip',
});

const NOTE = 'enemy_9025_aclts';
const CHORUS = 'enemy_9026_acltm';
const GIANT = 'enemy_9024_acsgnt';
const KJERAG_ICE = 'bond:kjerag:ice';
// Official abnormal set of act3autochess_bond_eff_siracusa (buff template abnormal_buff[random_creator]).
const SIRACUSA_STATUS = Object.freeze(['stun', 'fear', 'attract', 'cold', 'palsy', 'groundbind']);
// The 炎 template (act3autochess_bond_eff_yan_power) rolls element_type with RandomSetter over [1, 6): the client
// computes min + (max − min) · NextDouble() and floors it (FP.AsInt), so 1..5 are equally likely; 6 comes up only when
// the float cast of NextDouble() rounds to 1 (about 3e-8), and 6 is E_NUM, not an element.
// Torappu.ElementType: 1 SANITY 神经, 2 WATER 侵蚀, 3 FIRE 灼燃, 4 DARK 凋亡, 5 ANGER 狂躁 (6 is E_NUM, the count).
// The engine has no 狂躁 gauge; necrosis stands in for it.
const YAN_ELEMENTS = Object.freeze(['neural', 'erosion', 'burn', 'apoptosis', 'necrosis']);

let legacy = {};
/** core.js passes its 盟约 installers once they exist. */
export function bindLegacy(map) { legacy = map || {}; }

function effectBb(effectId, key) {
  return S.buffParams(S.effectRecord(effectId), key);
}
function bondBb(bondId, key) {
  return S.buffParams(S.bondRecord(bondId), key);
}
/** Prefer the bond record (a season copies its effect's buffs); a swapped effect id still finds the effect record. */
function bbOf(bondId, effectId, key) {
  return bondBb(bondId, key) || effectBb(effectId, key) || {};
}
function reached(battle, pid, bondId, cnt) {
  const st = S.bondState(battle, pid, bondId);
  if (!st || !st.active) return false;
  const need = num(cnt, 0);
  if (!(need > 0)) return !S.isVersionData();
  if (num(st.count, 0) >= need) return true;
  const th = S.bondRecord(bondId)?.thresholds;
  const idx = Array.isArray(th) ? th.indexOf(need) : -1;
  return idx >= 0 && S.bondTier(battle, pid, bondId) >= idx + 1;
}
function scaled(bb, baseKey, perKey, L, maxKey) {
  let v = num(bb[baseKey]) + num(bb[perKey]) * L;
  const cap = maxKey != null ? bb[maxKey] : undefined;
  if (typeof cap === 'number' && cap !== 0) v = Math.min(v, cap);
  return v;
}
function tagged(dmg, tag) {
  return !!dmg && Array.isArray(dmg.tags) && dmg.tags.includes(tag);
}
function rider(dmg) {
  // 伊比利亚 still uses this narrower gate (element, addition, dot, periodic, 流失). The 奥术 rider does not:
  // act3autochess_bond_eff_arcane filters cancelled modifiers and attack type ADDITION only (arcaneRider).
  if (!dmg || isHpLoss(dmg) || dmg.type === 'element' || dmg.type === 'elemental') return true;
  if (damageAttackType(dmg) === 'ADDITION' || tagged(dmg, 'addition') || tagged(dmg, 'dot') || tagged(dmg, 'periodic')) return true;
  return false;
}
/**
 * True when act3autochess_bond_eff_kazimierz_power[ex_damage] must not append true damage.
 * Two FilterDamageModifier nodes: a cancelled modifier, then attack type ADDITION followed by IfNot.
 * 流失 is not an output-damage modifier. Element, dot and periodic are not excluded.
 */
function kazimierzRiderSkips(dmg) {
  if (!dmg || dmg.cancel || isHpLoss(dmg)) return true;
  // The 'addition' tag marks our riders that the official client deals as ADDITION (as in arcaneRiderSkips).
  if (damageAttackType(dmg) === 'ADDITION' || tagged(dmg, 'addition') || tagged(dmg, 'bond:kazimierz')) return true;
  return false;
}
/** Element and periodic hits already sit near MAX_HOOK_DEPTH. Deal the rider on the next tick. */
function kazimierzRiderDefers(dmg) {
  return dmg.type === 'element' || dmg.type === 'elemental' || tagged(dmg, 'dot') || tagged(dmg, 'periodic');
}
/** True when act3autochess_bond_eff_arcane must not append an arts hit. */
function arcaneRiderSkips(dmg) {
  // First FilterDamageModifier only rejects a cancelled modifier. 流失 is not an output-damage modifier.
  if (!dmg || dmg.cancel || isHpLoss(dmg)) return true;
  // Second filter is attack type ADDITION, then IfNot. The appended hit is itself ADDITION and tagged so it
  // cannot schedule another rider even if a later hook rewrites the attack type.
  if (damageAttackType(dmg) === 'ADDITION' || tagged(dmg, 'addition') || tagged(dmg, 'bond:arcane')) return true;
  return false;
}
/** Element and periodic hits are inside chains that already sit near MAX_HOOK_DEPTH. Deal those next tick. */
function arcaneRiderDefers(dmg) {
  return dmg.type === 'element' || dmg.type === 'elemental' || tagged(dmg, 'dot') || tagged(dmg, 'periodic');
}
function onLayers(battle, pid, bondId, fn) {
  const st = S.battleStore(battle, 'bonds:reg:layers', () => ({ map: new Map(), pending: new Set(), hooked: false }));
  const k = `${pid}|${bondId}`;
  if (!st.map.has(k)) st.map.set(k, []);
  st.map.get(k).push(fn);
  if (st.hooked) return;
  st.hooked = true;
  const refresh = (c) => {
    const key = `${c.playerId}|${c.bondId}`;
    const list = st.map.get(key);
    if (!list || st.pending.has(key)) return;
    st.pending.add(key);
    battle.after(0, () => { st.pending.delete(key); for (const f of list) f(); });
  };
  battle.on('bondLayersChanged', refresh, { priority: -100 });
}

/** Compatibility reader: every temporary source now uses the battle's ledger. */
export function tempBondLayers(battle, pid, bondId) {
  return battle.tempLayers(pid, bondId);
}
function addTemp(battle, pid, bondId, n) {
  return battle.addTempLayers(pid, bondId, n);
}

function enemyRaw(battle, id) {
  const e = battle.data?.getEnemy?.(id);
  return e?.raw || null;
}
function talentBb(raw) {
  if (!raw) return {};
  if (raw.talents && raw.talents.bb) return raw.talents.bb;
  return {};
}
function skillBb(raw, key) {
  const sk = (raw && raw.skills || []).find((s) => s && s.prefabKey === key);
  return (sk && sk.bb) || {};
}

const GIANT_SIT = 'kjerag:giant:sit';

/**
 * 不眠雪山 as an allied token. Official summon is a controller trap; one token at battle start stays [ASSUMED].
 * Starts 覆雪坐定 (noMove, block from BlockEnemy). SwitchMode.interval with no attack switches to 覆雪苏醒
 * and reuses the Leithania ground pursuit at the record's moveSpeed. An enemy inside Switch2Snowy.range_radius
 * sits again. [ASSUMED] that 0.8 is the sit condition — the skill blackboard has no other key.
 * Splash: sitting uses BlockEnemy.attack@ability_range_radius, awake uses PowerAttack.range_radius.
 * [ASSUMED] which radius belongs to which form; both forms splash (handbook).
 * FrozenBreak ×atk_scale then clears freeze, sitting only (handbook 覆雪坐定). The template itself has no mode check.
 * 神迹之声 is not run: spData is INCREASE_WITH_TIME initSp 10 / maxSp 18 / increment 1 (enemy_database,
 * omitted from the built record) and Attract.range_radius 1.5, but the attract buff's lifetime is only on the prefab.
 */
function giantKit(raw) {
  const tb = talentBb(raw);
  const st = raw.stats || {};
  const radius = num(st.rangeRadius, 2.4);
  const sitSplash = num(tb['BlockEnemy.attack@ability_range_radius'], 1.5);
  const wakeSplash = num(skillBb(raw, 'PowerAttack').range_radius, 1.1);
  const wakeAfter = num(tb['SwitchMode.interval'], 5);
  const sitRange = num(skillBb(raw, 'Switch2Snowy').range_radius, 0.8);
  const frozenScale = num(tb['FrozenBreak.atk_scale'], 3.5);
  const sit = (battle, unit) => {
    unit.mem.kjeragMode = 'sit';
    unit.mem.kjeragQuiet = 0;
    unit.profile.splashRadius = sitSplash;
    // install runs before deploy, while the token is still not alive (battle/status.js addBuff).
    battle.addBuff(unit, { key: GIANT_SIT, persist: true, refresh: 'replace', allowDead: true, flags: { noMove: true } });
  };
  const wake = (battle, unit) => {
    unit.mem.kjeragMode = 'awake';
    unit.mem.kjeragQuiet = 0;
    unit.profile.splashRadius = wakeSplash;
    battle.removeBuff(unit, GIANT_SIT);
  };
  return {
    trait: {
      attack: 'ranged',
      dmgType: 'arts',
      projectile: 'bolt',
      canHitFly: true,
      attackRangeRadius: radius,
      strictAttackRange: true,
      splashRadius: sitSplash,
      splashScale: 1,
    },
    install(battle, unit) {
      unit.motion = 'GROUND';
      sit(battle, unit);
      battle.on('attack', (c) => {
        if (c.attacker === unit && !c.isSkill) unit.mem.kjeragQuiet = 0;
      }, { owner: unit });
      battle.on('hit', (c) => {
        if (c.source !== unit || unit.mem.kjeragMode !== 'sit' || !c.dmg || c.dmg.cancel) return;
        const t = c.target;
        if (!t || !t.findBuff || !t.findBuff('freeze')) return;
        c.dmg.mul *= frozenScale;
        battle.removeStatus(t, 'freeze');
      }, { owner: unit });
      battle.on('tick', ({ dt }) => {
        if (!unit.alive) return;
        if (unit.mem.kjeragMode === 'sit') {
          unit.profile.splashRadius = sitSplash;
          unit.mem.kjeragQuiet = (unit.mem.kjeragQuiet || 0) + dt;
          if (unit.mem.kjeragQuiet + 1e-9 >= wakeAfter) wake(battle, unit);
        } else {
          unit.profile.splashRadius = wakeSplash;
          const r2 = sitRange * sitRange;
          for (const e of battle.enemies) {
            if (!e.alive || !e.deployed) continue;
            const dx = e.x - unit.x, dy = e.y - unit.y;
            if (dx * dx + dy * dy <= r2 + 1e-9) { sit(battle, unit); break; }
          }
        }
        pursueGroundEnemy(battle, unit, dt);
      }, { owner: unit });
    },
  };
}
/**
 * WALK tile for a 莱塔尼亚 note (SummonEnemyWithRuntimeRoute, _summonOnNearestPassableTile, _motionMode WALK,
 * _avoidHighland false). Passable is the tile's WALK mask (`pass === 'ALL'`), not the pathfinding obstacle bit:
 * a 射击台 hard-block and a crate stay valid landings, and highland is not filtered again. A FLY-only wall,
 * a hole, or a tile outside the rect is not. The death tile wins when it is already that mask.
 * [ASSUMED] distance is Manhattan; a tie keeps the earlier row, then the earlier column (the scan order).
 */
function nearestWalkTile(battle, fromR, fromC) {
  const grid = battle.grid;
  // ignoreObstacles: the summon node reads the map mask. 射击台 / 阻隔工事 are pathing obstacles, not this filter.
  if (grid.walkable(fromR, fromC, true)) return [fromR, fromC];
  const R = battle.rect;
  let best = null, bestD = Infinity;
  for (let r = R.r0; r <= R.r1; r++) {
    for (let c = R.c0; c <= R.c1; c++) {
      if (!grid.walkable(r, c, true)) continue;
      const d = Math.abs(r - fromR) + Math.abs(c - fromC);
      if (d < bestD) { bestD = d; best = [r, c]; }
    }
  }
  return best;
}
/** Chebyshev radius. [ASSUMED] range id `x-5` is 5 tiles from the anchor, the square the summon node names. */
function nearestOpen(battle, fromR, fromC, radius) {
  const R = battle.rect;
  let best = null, bestD = Infinity;
  for (let r = R.r0; r <= R.r1; r++) {
    for (let c = R.c0; c <= R.c1; c++) {
      if (radius != null && Math.max(Math.abs(r - fromR), Math.abs(c - fromC)) > radius) continue;
      if (!battle.grid.canStand(r, c)) continue;
      if (battle.unitAt(r, c) || battle.downOn(r, c)) continue;
      const d = Math.abs(r - fromR) + Math.abs(c - fromC);
      if (d < bestD) { bestD = d; best = [r, c]; }
    }
  }
  return best;
}
function inRadius(u, x, y, r) {
  const dx = u.x - x, dy = u.y - y;
  return dx * dx + dy * dy <= r * r + 1e-9;
}

function handSwitch(battle, dead, bondId, { meleeOnly = false, cap = Infinity, counter, onSwitched } = {}) {
  const st = S.battleStore(battle, 'bonds:reg:switch', () => ({ n: {}, taken: new Set() }));
  const pid = dead.ownerId;
  const key = counter || bondId;
  if (num(st.n[`${pid}|${key}`]) >= cap) return false;
  const pieces = (S.contentInfo(battle, pid).handPieces || []).filter((p) => p && Array.isArray(p.bonds) && p.bonds.includes(bondId));
  pieces.sort((a, b) => num(b.slot) - num(a.slot) || String(b.id).localeCompare(String(a.id)));
  const r = dead.tileR, c = dead.tileC;
  for (const p of pieces) {
    const slotKey = `${pid}:${p.slot}`;
    if (st.taken.has(slotKey)) continue;
    if (meleeOnly && String(p.position || '').toUpperCase() !== 'MELEE') continue;
    dead.removed = true;
    const spawned = typeof battle.spawnOperator === 'function'
      ? battle.spawnOperator(pid, p.id, r, c, {}) : null;
    if (!spawned) { dead.removed = false; continue; }
    st.taken.add(slotKey);
    st.n[`${pid}|${key}`] = num(st.n[`${pid}|${key}`]) + 1;
    if (typeof onSwitched === 'function') onSwitched(spawned, dead);
    return true;
  }
  return false;
}
/**
 * 阿戈尔_2 attr_extend: the devoured ATK / block / HP on the dying operator (GT 0 only) are added onto
 * whoever was switched in. Hand pieces are 阿戈尔 members, so attr_other (non-members) is the same mods.
 * The bond HP% buff is not part of this copy. 卡西米尔 does not pass onSwitched.
 */
function copyEgirDevour(battle, spawned, dead) {
  const buff = typeof dead.findBuff === 'function' ? dead.findBuff('bond:egir:devour') : null;
  const mods = buff && buff.mods;
  if (!mods) return;
  const next = {};
  if (num(mods.atkFinal) > 0) next.atkFinal = num(mods.atkFinal);
  if (num(mods.blockCnt) > 0) next.blockCnt = num(mods.blockCnt);
  if (num(mods.hpFlat) > 0) next.hpFlat = num(mods.hpFlat);
  if (Object.keys(next).length) S.passiveBuff(battle, spawned, 'bond:egir:devour', next);
}

// =====================================================================================================================
// changed effects

function installYan2(battle, pid, effectId, members) {
  const bb = bbOf('yanShip', effectId, K.yan);
  const enemy = bbOf('yanShip', effectId, K.yanEnemy);
  const apply = () => {
    const mods = S.directMods({ atk: num(bb.atk_base) + num(bb.atk_per_stack) * S.bondLayers(battle, pid, 'yanShip') });
    for (const u of members) S.passiveBuff(battle, u, 'bond:yan', mods);
  };
  apply();
  onLayers(battle, pid, 'yanShip', apply);
  const set = new Set(members);
  battle.on('damaged', (c) => {
    const u = c.source, t = c.target, dmg = c.dmg;
    if (!set.has(u) || !t || t.side !== 'enemy' || !t.alive || rider(dmg) || tagged(dmg, 'bond:yan')) return;
    if (!reached(battle, pid, 'yanShip', bb.power_bond_char_cnt)) return;
    const scale = scaled(bb, 'ex_atk_scale_base', 'ex_atk_scale_per_stack', S.bondLayers(battle, pid, 'yanShip'), 'ex_atk_scale_max');
    if (!(scale > 0)) return;
    const roll = Math.floor(battle.rng() * YAN_ELEMENTS.length);
    const element = YAN_ELEMENTS[roll] || 'burn';
    battle.dealElementDamage({ source: u, target: t, amount: scale * num(u.s.atk), element, tags: ['bond:yan'] });
  });
  if (!reached(battle, pid, 'yanShip', enemy.power_bond_char_cnt)) return;
  const rateOf = () => {
    const L = S.bondLayers(battle, pid, 'yanShip');
    return scaled(enemy, 'ep_break_recover_speed_base', 'ep_break_recover_speed_per_stack', L, 'ep_break_recover_speed_max');
  };
  // The attribute is EP_BREAK_RECOVER_SPEED. Same reading as 异客 S3: it shortens the burst lock, not the gauge fill.
  battle.every(0.5, () => {
    const rate = rateOf();
    if (!(rate > 0)) return;
    for (const e of battle.enemies) {
      if (!e.alive || !e.buffs) continue;
      for (const b of e.buffs) {
        if (b.flags && b.flags.burstLock && Number.isFinite(b.timeLeft)) b.timeLeft -= 0.5 * rate;
      }
    }
  });
}

/**
 * Slow fraction on sand. The tile slow template clamps by slow_max, then, while the aura buff is present,
 * adds that fraction to itself with an empty max (no second clamp).
 */
function sargonSlow(tileBb, slowKey, layers, aura) {
  let slow = scaled(tileBb, `${slowKey}.slow_base`, `${slowKey}.slow_per_stack`, layers, `${slowKey}.slow_max`);
  if (aura) slow += slow;
  return slow;
}

function installSargon2(battle, pid, effectId, members) {
  const bb = bbOf('sargonShip', effectId, K.sargon);
  const tile = bbOf('sargonShip', effectId, K.sargonTile);
  const power = reached(battle, pid, 'sargonShip', bbOf('sargonShip', effectId, K.sargonPower).power_bond_char_cnt);
  const set = new Set(members);
  const maxStacks = Math.max(1, Math.floor(num(bb.max_buff_stack_cnt, 25)));
  battle.on('skillStart', ({ unit }) => {
    if (!set.has(unit)) return;
    const L = S.bondLayers(battle, pid, 'sargonShip');
    const dur = num(bb.base_time) + num(bb.time_per_stack) * L;
    if (!(dur > 0)) return;
    for (const m of members) {
      if (!S.onField(m)) continue;
      battle.addBuff(m, {
        key: 'bond:sargon', duration: dur, refresh: 'independent', maxStacks,
        mods: { aspd: num(bb.base_attack_speed) },
      });
    }
  });
  if (!power) return;
  // One persistent sand tile per member skill cast (ON_SKILL_START → FindNearestTileInRangeToBB, WALK_ONLY,
  // flag ac_bond_eff_sargon_power[sand]). The tile stays for the battle. No client graphic: nothing in this sim
  // draws a bond tile (妮芙 fear tiles are a status on the enemy, not a ground overlay).
  const slowKey = 'act3autochess_bond_eff_sargon_power[tile_buff][slow]';
  const magKey = 'act3autochess_bond_eff_sargon_power[tile_buff][mag_damage]';
  const mag2Key = 'act3autochess_bond_eff_sargon_power[tile_buff][mag_damage_2]';
  const sand = new Set();
  const tracked = new Map();
  // [ASSUMED] skip a tile that is already sand; if every in-range walk tile is sand, the cast lays nothing.
  // [ASSUMED] nearest is squared Euclidean from the operator tile, then the smaller row, then the smaller col.
  // The operator's own tile is eligible. FindNearestTileInRangeToBB's metric is not in the tables.
  // [ASSUMED] non-WALK terrain and hard blocks are skipped; a crate stays eligible (grid.walkable).
  function nearestSandTile(unit) {
    const keys = unit.rangeKeySet;
    if (!keys || !keys.size || unit.tileR == null || unit.tileC == null) return null;
    const ur = unit.tileR;
    const uc = unit.tileC;
    let best = null;
    for (const k of keys) {
      const r = (k / COLS) | 0;
      const c = k - r * COLS;
      if (sand.has(k) || !battle.grid.walkable(r, c)) continue;
      const dr = r - ur;
      const dc = c - uc;
      const d = dr * dr + dc * dc;
      if (!best || d < best.d || (d === best.d && (r < best.r || (r === best.r && c < best.c)))) best = { r, c, k, d };
    }
    return best;
  }
  // [ASSUMED] the aura is this caster's current attack range. Prefab act3autochess_bond_sargon_range is not in the tables.
  function castingCovers(e) {
    for (const m of members) {
      if (!S.onField(m) || !m.skill || !m.skill.active) continue;
      if (S.inRange(m, e)) return true;
    }
    return false;
  }
  function pulse(e, baseKey, perKey, maxKey) {
    if (!e.alive || battle.finished) return;
    const amount = scaled(tile, baseKey, perKey, S.bondLayers(battle, pid, 'sargonShip'), maxKey);
    if (!(amount > 0)) return;
    battle.dealDamage({
      source: null, target: e, amount, type: 'arts', attackType: 'BUFF', tags: ['bond:sargon', 'periodic'],
    });
  }
  function applySlow(e, st) {
    const aura = castingCovers(e);
    const slow = sargonSlow(tile, slowKey, S.bondLayers(battle, pid, 'sargonShip'), aura);
    if (st.aura === aura && st.slow === slow && e.findBuff && e.findBuff('bond:sargon:slow')) return;
    st.aura = aura;
    st.slow = slow;
    battle.addBuff(e, {
      key: 'bond:sargon:slow', duration: Infinity, refresh: 'replace',
      mods: { moveMul: Math.max(0, 1 - slow) },
    });
  }
  // Per enemy, from the moment it starts occupying any sand tile. mag_damage waits first_trigger_interval, then
  // interval. The bind is created before the damage filter and is not a derived buff, so leaving does not clear it.
  // mag_damage_2's 1s comes from the template triggerInterval (no blackboard key) and keeps ticking when the aura is off.
  function arm(e, st) {
    const mine = () => tracked.get(e) === st && e.alive && !battle.finished && bodyInKeys(e, sand);
    const magIv = num(tile[`${magKey}.interval`], 5);
    const magFirst = num(tile[`${magKey}.first_trigger_interval`], magIv);
    if (magFirst > 0 && magIv > 0) {
      const loop = () => {
        if (!mine()) return;
        const bind = num(tile[`${magKey}.unmovable_duration`], 0);
        if (bind > 0) battle.applyStatus(e, 'bind', { duration: bind, source: null });
        if (e.alive) pulse(e, `${magKey}.magic_damage_base`, `${magKey}.magic_damage_per_stack`, `${magKey}.magic_damage_max`);
        if (mine()) battle.after(magIv, loop);
      };
      battle.after(magFirst, loop);
    }
    const loop2 = () => {
      if (!mine()) return;
      if (castingCovers(e)) pulse(e, `${mag2Key}.magic_damage_base`, `${mag2Key}.magic_damage_per_stack`, `${mag2Key}.magic_damage_max`);
      if (mine()) battle.after(1, loop2);
    };
    battle.after(1, loop2);
  }
  // [ASSUMED] a flyer or a hidden enemy on the tile counts; the listener templates do not filter motion or stealth.
  // A huge enemy counts when any covered tile is sand (bodyInKeys). Two players who sand the same tile each pulse.
  function leave(e) {
    if (!tracked.has(e)) return;
    tracked.delete(e);
    if (e.findBuff && e.findBuff('bond:sargon:slow')) battle.removeBuff(e, 'bond:sargon:slow');
  }
  function scan() {
    if (!sand.size) return;
    const seen = new Set();
    for (const e of battle.enemies) {
      if (!e) continue;
      seen.add(e);
      if (!e.alive || !bodyInKeys(e, sand)) {
        if (tracked.has(e)) leave(e);
        continue;
      }
      let st = tracked.get(e);
      if (!st) {
        st = { aura: null, slow: null };
        tracked.set(e, st);
        applySlow(e, st);
        arm(e, st);
      } else applySlow(e, st);
    }
    for (const e of [...tracked.keys()]) if (!seen.has(e)) leave(e);
  }
  battle.on('skillStart', ({ unit }) => {
    if (!set.has(unit) || !S.onField(unit)) return;
    const picked = nearestSandTile(unit);
    if (picked) sand.add(picked.k);
    if (sand.size) scan();
  });
  battle.on('skillEnd', ({ unit }) => {
    if (!set.has(unit) || !sand.size) return;
    scan();
  });
  battle.on('tick', () => { if (sand.size) scan(); });
}

function installKjerag2(battle, pid, effectId, members) {
  const bb = bbOf('kjeragShip', effectId, K.kjerag);
  // The combat blackboard also carries power_bond_char_cnt. Passing that through would start the 盟约 cold wind.
  if (typeof legacy.kjerag === 'function') legacy.kjerag(battle, pid, { ...bb, power_bond_char_cnt: 0 }, members);
  const power = bbOf('kjeragShip', effectId, K.kjeragPower);
  if (!reached(battle, pid, 'kjeragShip', power.power_bond_char_cnt || bb.power_bond_char_cnt)) return;
  battle.on('battleStart', () => {
    const anchor = members.find((u) => S.onField(u) || u.tileR != null);
    if (!anchor) return;
    const tile = nearestOpen(battle, anchor.tileR, anchor.tileC, 5);
    if (!tile) return;
    const raw = enemyRaw(battle, GIANT);
    if (!raw) return;
    const tb = talentBb(raw);
    const step = num(tb['BondBuff.stackStep'], 0);
    const steps = step > 0 ? Math.floor(S.bondLayers(battle, pid, 'kjeragShip') / step) : 0;
    // BondBuff on the enemy talent: ATK / HP scale by floor(layers / stackStep). The official summon is a
    // controller trap on mode change; this remake has no controller, so one allied token at battle start is
    // [ASSUMED]. The token's kit runs SwitchMode and FrozenBreak (giantKit).
    const atkMul = 1 + num(tb['BondBuff.base_atk']) + num(tb['BondBuff.attack_per_stack']) * steps;
    const hpMul = 1 + num(tb['BondBuff.base_max_hp']) + num(tb['BondBuff.max_hp_per_stack']) * steps;
    const st = raw.stats || {};
    const blockCnt = num(tb['BlockEnemy.block_cnt'], st.blockCnt);
    battle.spawnToken(anchor, GIANT, tile[0], tile[1], {
      def: {
        ...raw,
        id: GIANT,
        profession: 'CASTER',
        attackKind: 'ranged',
        dmgType: 'arts',
        canHitFly: true,
        projectile: 'bolt',
        rangeGrid: [[0, 0]],
      },
      anySource: true,
      lethaniaPursuit: true,
      position: { x: tile[1], y: tile[0] },
      stats: {
        atk: num(st.atk) * atkMul,
        maxHp: num(st.maxHp) * hpMul,
        blockCnt,
        moveSpeed: num(st.moveSpeed, 0.4),
        rangeRadius: num(st.rangeRadius, 2.4),
      },
      kit: giantKit(raw),
    });
  }, { once: true });
}

function installSiracusa2(battle, pid, effectId, members) {
  const bb = bbOf('siracusaShip', effectId, K.siracusa);
  const set = new Set(members);
  const six = reached(battle, pid, 'siracusaShip', bb.power_bond_char_cnt);
  battle.on('deploy', ({ unit }) => {
    if (!set.has(unit)) return;
    const L = S.bondLayers(battle, pid, 'siracusaShip');
    const dur = num(bb.base_duration) + num(bb.duration_per_stack) * L;
    if (!(dur > 0)) return;
    battle.addBuff(unit, {
      key: 'bond:siracusa', duration: dur,
      mods: { aspd: num(bb.base_attack_speed) + num(bb.attack_speed_per_stack) * L },
    });
  });
  if (!six) return;
  const prob = num(bb.prob, 0);
  // siracusa_power EnsureBlackboardDefaultValue create_cd 0.2, overrideIfExists. Not on the bond blackboard.
  // The add runs only after Dice succeeds (no AlwaysNext), so a miss does not start the window.
  // FilterAbilityFamily ATTACK_OR_COMBAT is not applied: this engine has no ability-family field on damage.
  const createCd = 0.2;
  const nextAt = new WeakMap();
  battle.on('damaged', (c) => {
    const u = c.source, t = c.target, dmg = c.dmg;
    if (!set.has(u) || !t || t.side !== 'enemy' || !t.alive || rider(dmg) || tagged(dmg, 'bond:siracusa')) return;
    const now = battle.time;
    if (now + 1e-9 < num(nextAt.get(u), 0)) return;
    if (!(battle.rng() < prob)) return;
    nextAt.set(u, now + createCd);
    const L = S.bondLayers(battle, pid, 'siracusaShip');
    const dur = scaled(bb, 'ab_buff_duration_base', 'ab_buff_duration_per_stack', L, 'ab_buff_duration_max');
    const status = SIRACUSA_STATUS[Math.floor(battle.rng() * SIRACUSA_STATUS.length)];
    if (dur > 0 && status) battle.applyStatus(t, status, { duration: dur, source: u });
  });
  const limit = num(bb.abnormal_buff_count_limit, 2);
  const radius = 1.1; // official AOEDamage radius on the enemy periodic; not a blackboard field
  battle.every(1, () => {
    const L = S.bondLayers(battle, pid, 'siracusaShip');
    const amount = num(bb.damage_value_base) + num(bb.damage_value_per_stack) * L;
    if (!(amount > 0)) return;
    for (const e of battle.enemies) {
      if (!e.alive || abnormalCount(e) < limit) continue;
      for (const o of battle.enemies) {
        if (!o.alive || !inRadius(o, e.x, e.y, radius)) continue;
        battle.dealDamage({ source: null, credit: members[0] || null, target: o, amount, type: 'true',
          attackType: 'BUFF', tags: ['bond:siracusa', 'periodic'] });
      }
    }
  });
}
function abnormalCount(u) {
  const f = u.s?.flags || {};
  let n = 0;
  if (f.stun) n++;
  if (f.cold) n++;
  if (f.fear) n++;
  if (f.attract) n++;
  if (f.groundbind) n++;
  if (u.buffs && u.buffs.some((b) => b.status === 'palsy' || b.palsy)) n++;
  return n;
}

function installKazimierz2(battle, pid, effectId, members) {
  const bb = bbOf('kazimierzShip', effectId, K.kazimierz);
  if (typeof legacy.kazimierz === 'function') legacy.kazimierz(battle, pid, bb, members);
  const six = reached(battle, pid, 'kazimierzShip', bb.power_bond_char_cnt);
  if (!six) return;
  // act3autochess_bond_eff_kazimierz_power: ON_BUFF_START and ON_SKILL_CAST_SUCCEED both CreateBuff
  // [ex_damage] (overrideType EXTEND, maxStackCnt 1, lifeTimeType LIMITED, durationKey ex_damage_duration,
  // lifeTime 20 when the key is missing). EXTEND resets the remaining time to the full duration
  // (the same meaning as op-zuole.js), it does not add the two windows together.
  // lifeTime 20 is the fallback; the 规程 blackboard stores ex_damage_duration 30.
  const duration = num(bb.ex_damage_duration, 20);
  const until = new WeakMap();
  const member = (u) => !!u && u.ownerId === pid && S.isMember(battle, u, 'kazimierzShip');
  const open = (u, at) => { if (duration > 0 && u) until.set(u, at + duration); };
  for (const u of members) if (S.onField(u)) open(u, num(u.deployedAt, battle.time));
  battle.on('deploy', ({ unit, move }) => {
    // A tile move also emits deploy (battle/tiles.js). ON_BUFF_START is a new deployment
    // (battle start, redeploy, handSwitch spawn), not a move.
    if (move || !member(unit)) return;
    open(unit, battle.time);
  });
  // ON_SKILL_CAST_SUCCEED: skillStart is emitted only after Skill.activate succeeds.
  battle.on('skillStart', ({ unit }) => {
    if (!member(unit)) return;
    open(unit, battle.time);
  });
  battle.on('damaged', (c) => {
    const u = c.source, t = c.target, dmg = c.dmg;
    // [ASSUMED] an alive enemy. The template's target is MODIFIER_TARGET and has no side node.
    if (!member(u) || !t || t.side !== 'enemy' || !t.alive || kazimierzRiderSkips(dmg)) return;
    const end = until.get(u);
    if (end == null || battle.time > end + 1e-9) return;
    // _finalAbs on the scale. per_stack is 0 on the 规程 blackboard, so this stays 0.65.
    const scale = Math.abs(scaled(bb, 'ex_atk_scale_base', 'ex_atk_scale_per_stack', S.bondLayers(battle, pid, 'kazimierzShip'), 'ex_atk_scale_max'));
    if (!(scale > 0)) return;
    const amount = scale * num(u.s.atk);
    const deal = () => {
      if (!t.alive || t.removed) return;
      battle.dealDamage({ source: u, target: t, amount, type: 'true', attackType: 'ADDITION',
        tags: ['addition', 'bond:kazimierz'] });
    };
    // [ASSUMED] one tick later for element / dot / periodic, same hook-depth accommodation as the 奥术 rider.
    // The amount is snapshotted while the window is open; the deferred hit does not re-test the window.
    if (kazimierzRiderDefers(dmg)) battle.after(0, deal, { owner: u });
    else deal();
  });
  const ops = new Set(members.filter((u) => S.isOp(u) && S.isGroundOp(u)));
  battle.on('death', (c) => {
    const u = c.unit;
    if (!u || c.reason !== 'killed' || c.revivedBy || !ops.has(u) || u.alive || u.removed) return;
    if (!S.isGroundOp(u)) return;
    // 不屈 (priority 10) and 阿戈尔's free redeploy (11) run first. A unit still down is replaced from the bench.
    handSwitch(battle, u, 'kazimierzShip', { meleeOnly: true });
  }, { priority: 0 });
}

function installVictoria2(battle, pid, effectId, members) {
  const bb = bbOf('victoriaShip', effectId, K.victoria);
  const apply = () => {
    const mul = num(bb.base_damage_scale, 1) + num(bb.damage_scale_per_stack) * S.bondLayers(battle, pid, 'victoriaShip');
    for (const u of members) {
      if (S.itemsOf(u).length >= 1) S.passiveBuff(battle, u, 'bond:victoria', { dmgDealtMul: mul });
    }
  };
  apply();
  onLayers(battle, pid, 'victoriaShip', apply);
  if (!reached(battle, pid, 'victoriaShip', bb.power_bond_char_cnt)) return;
  const set = new Set(members);
  battle.on('skillStart', ({ unit }) => {
    if (!set.has(unit) || !S.itemsOf(unit).length) return;
    const L = S.bondLayers(battle, pid, 'victoriaShip');
    const duration = scaled(bb, 'share_equip_duration_base', 'share_equip_duration_per_stack', L, 'share_equip_duration_max');
    if (!(duration > 0) || typeof lendItemEffects !== 'function') return;
    for (const a of S.alliesAround(battle, unit, S.N8)) {
      if (!S.isOp(a)) continue;
      lendItemEffects(battle, unit, a, { duration });
    }
  });
}

function installEgir2(battle, pid, effectId, members) {
  const bb = bbOf('egirShip', effectId, K.egir);
  if (typeof legacy.egir === 'function') legacy.egir(battle, pid, bb, members, { respawn: false });
  if (!reached(battle, pid, 'egirShip', bb.power_bond_char_cnt)) return;
  const cap = Math.max(0, Math.floor(num(bb.switch_cnt_max, 0)));
  if (!(cap > 0)) return;
  const ops = new Set(members.filter(S.isOp));
  battle.on('death', (c) => {
    const u = c.unit;
    if (!u || c.reason !== 'killed' || c.revivedBy || !ops.has(u) || u.alive || u.removed) return;
    handSwitch(battle, u, 'egirShip', {
      meleeOnly: false, cap, counter: 'egir2',
      onSwitched: (spawned, dead) => copyEgirDevour(battle, spawned, dead),
    });
  }, { priority: 0 });
}

// =====================================================================================================================
// new bonds

function installUrsus(battle, pid, effectId, members) {
  const bb = bbOf('ursusShip', effectId, K.ursus);
  const apply = () => {
    const L = S.bondLayers(battle, pid, 'ursusShip');
    const mods = S.directMods({
      atk: num(bb.atk_base) + num(bb.atk_per_stack) * L,
      hp: num(bb.hp_base) + num(bb.hp_per_stack) * L,
    });
    for (const u of members) S.passiveBuff(battle, u, 'bond:ursus', mods);
  };
  apply();
  onLayers(battle, pid, 'ursusShip', apply);
  const set = new Set(members);
  const six = reached(battle, pid, 'ursusShip', bb.power_bond_char_cnt);
  battle.on('death', (c) => {
    // act3autochess_bond_eff_ursus ON_TARGET_KILLED has no side, faction or unit-type filter.
    // The bond text 「击倒其他单位」 excludes the credited member's own finish. The template node
    // itself has no self-exclusion node; that reading is the published description.
    if (c.reason !== 'killed' || !c.unit) return;
    const dead = c.unit;
    const killer = c.killer;
    const who = killer && killer.kind === 'token' ? killer.ownerUnit : killer;
    if (!who || who === dead || !set.has(who)) return;
    const n = six ? num(bb['temp_bond_stack_cnt[power]'], 4) : num(bb.temp_bond_stack_cnt, 2);
    const extra = ursusTempExtra(battle, pid);
    addTemp(battle, pid, 'ursusShip', n + (extra > 0 ? extra : 0));
  });
  battle.on('hit', (c) => {
    const u = c.target, dmg = c.dmg;
    if (!set.has(u) || !dmg || dmg.type === 'true' || tagged(dmg, 'bond:ursus')) return;
    const L = S.bondLayers(battle, pid, 'ursusShip');
    const r = scaled(bb, 'damage_one_minus_base', 'damage_one_minus_per_stack', L, 'damage_one_minus_max');
    const cut = Math.max(0, Math.min(num(bb.damage_one_minus_max, 1), r));
    if (!(cut > 0)) return;
    const beforeMul = num(dmg.mul, 1);
    dmg.mul = beforeMul * (1 - cut);
    const bleed = Math.abs(num(dmg.amount) * beforeMul * cut) / 10;
    const src = c.source;
    if (!(bleed > 0) || !src) return;
    if (u.mem.ursusBleed) u.mem.ursusBleed.cancel();
    let ticks = 0;
    const timer = battle.every(1, () => {
      ticks++;
      if (ticks > 10 || !u.alive || !src.alive) { timer.cancel(); return; }
      battle.dealDamage({ source: src, target: u, amount: bleed, type: 'true', tags: ['bond:ursus', 'periodic'] });
    }, { owner: u, immediate: true });
    u.mem.ursusBleed = timer;
  });
  if (!six) return;
  battle.every(1, () => {
    const L = S.bondLayers(battle, pid, 'ursusShip');
    const scale = num(bb.atk_scale_base) + num(bb.atk_scale_per_stack) * L;
    if (!(scale > 0)) return;
    for (const m of members) {
      if (!S.onField(m) || !m.blocking || !m.blocking.length) continue;
      const amount = scale * num(m.s.atk);
      for (const e of m.blocking) {
        if (!e || !e.alive) continue;
        battle.dealDamage({ source: m, target: e, amount, type: 'arts', tags: ['bond:ursus', 'periodic'] });
      }
    }
  });
}

function installIberia(battle, pid, effectId, members) {
  const bb = bbOf('iberiaShip', effectId, K.iberia);
  const set = new Set(members);
  const six = reached(battle, pid, 'iberiaShip', bb.power_bond_char_cnt);
  const speedKey = 'act3autochess_bond_eff_iberia[enemy][speed]';
  const dotCap = 10; // CreateBuff maxStackCnt on act3autochess_bond_eff_iberia[enemy][dot]
  const cd = new WeakMap();
  const whoOf = (u) => {
    if (!u) return null;
    if (set.has(u)) return u;
    // [ASSUMED] 炼金单元 is a token whose owner is an 伊比利亚 member.
    if (u.kind === 'token' && u.ownerUnit && set.has(u.ownerUnit)) return u.ownerUnit;
    return null;
  };
  battle.on('damaged', (c) => {
    const t = c.target, dmg = c.dmg;
    if (!t || t.side !== 'enemy' || !t.alive || !dmg || tagged(dmg, 'bond:iberia') || rider(dmg)) return;
    const who = whoOf(c.source);
    if (!who) return;
    let stamp = cd.get(t);
    if (!stamp) { stamp = new Map(); cd.set(t, stamp); }
    const now = battle.time;
    if (now < num(stamp.get(who), -Infinity)) return;
    stamp.set(who, now + 0.2);
    const st = t.mem.iberia || (t.mem.iberia = { stacks: 0, until: 0, atk: 0, slow: 0, slowUntil: 0, timer: null });
    st.stacks = Math.min(dotCap, st.stacks + 1);
    st.until = now + num(bb.dot_duration, 10);
    st.atk = num(who.s.atk);
    st.power = six;
    // Speed and the splash sit after FilterByBlackboardValue is_power. The DoT above does not.
    if (six) {
      const slowMax = num(bb[`${speedKey}.max_stack_cnt`], 20);
      st.slow = Math.min(slowMax, st.slow + 1);
      st.slowUntil = now + num(bb[`${speedKey}.speed_duration`], 10);
      const move = num(bb[`${speedKey}.move_speed`], -0.04);
      battle.addBuff(t, {
        key: 'bond:iberia:slow', duration: num(bb[`${speedKey}.speed_duration`], 10), refresh: 'replace',
        // [ASSUMED] move_speed is an additive attribute-style factor (1 + value × stacks), floored at 0.
        mods: { moveMul: Math.max(0, 1 + move * st.slow) },
      });
      const prob = num(bb.prob_base) + num(bb.prob_per_stack) * S.bondLayers(battle, pid, 'iberiaShip');
      if (battle.rng() < prob) {
        // AOEDamage _radius is the literal 1. range_radius on the bond blackboard is not read here.
        // damage_target_cnt defaults to 1 (EnsureBlackboardDefaultValue, overrideIfExists) and is not on the bond bb.
        const amount = num(bb.atk_scale, 0) * st.atk;
        if (amount > 0) {
          const hits = [];
          for (const e of battle.enemies) {
            if (!e.alive || e === t || !inRadius(e, t.x, t.y, 1)) continue;
            hits.push(e);
          }
          // [ASSUMED] RANDOM walks battle.enemies order. One roll when more than one candidate.
          if (hits.length > 1) {
            const i = Math.floor(battle.rng() * hits.length);
            hits.splice(0, hits.length, hits[i]);
          }
          for (const e of hits) {
            battle.dealDamage({ source: who, target: e, amount, type: 'arts', isSplash: true, tags: ['bond:iberia', 'addition'] });
          }
        }
      }
    }
    // One timer for the enemy's life. Expiry clears stacks but keeps the timer, so a later stack does not start a second one.
    if (st.timer) return;
    st.timer = battle.every(1, () => {
      if (!t.alive) return;
      if (!(st.stacks > 0) || battle.time > st.until + 1e-9) { st.stacks = 0; return; }
      const L = S.bondLayers(battle, pid, 'iberiaShip');
      let scale = (num(bb.dot_atk_scale_base) + num(bb.dot_atk_scale_per_stack) * L) * st.stacks;
      if (st.power) scale += scale; // template BlackboardAdd of the scale onto itself when is_power > 0
      if (scale > 0) {
        battle.dealDamage({ source: who, target: t, amount: scale * st.atk, type: 'arts', tags: ['bond:iberia', 'dot', 'periodic'] });
      }
    }, { owner: t });
  });
}

function installLethania(battle, pid, effectId, members) {
  const bb = bbOf('lethaniaShip', effectId, K.lethania);
  const power = reached(battle, pid, 'lethaniaShip', bb.power_bond_char_cnt);
  const apply = () => {
    const mods = S.directMods({ atk: num(bb.atk_base) + num(bb.atk_per_stack) * S.bondLayers(battle, pid, 'lethaniaShip') });
    for (const u of members) S.passiveBuff(battle, u, 'bond:lethania', mods);
    for (const u of battle.allyUnits) {
      if (u.ownerId === pid && u.kind === 'token' && (u.defId === NOTE || u.defId === CHORUS)) {
        S.passiveBuff(battle, u, 'bond:lethania', mods);
      }
    }
  };
  // 一个乐部's attack-speed aura (talent Aura, buff acltm[atk-spd]): AutochessCreateBuffToSpecifiedChar gives every
  // 【莱塔尼亚】 operator on the field (bond filter, no range) ATTACK_SPEED + base_attack_speed + attack_speed_per_stack ·
  // floor(layers / stackStep) for as long as the chorus lives; the chorus itself is not an operator and gets nothing.
  // Each chorus adds its own buff (disableOverride), so two choruses give +40. The client refreshes the value every
  // second; here it is recomputed when a chorus spawns or dies and when the layers change (same value: per_stack is 0).
  // [ASSUMED] only the bond owner's operators: the client's side + map-layer check is read as one player's board.
  const chorusAura = () => {
    const tb = talentBb(enemyRaw(battle, CHORUS));
    const step = num(tb['Aura.stackStep'], 0);
    const L = S.bondLayers(battle, pid, 'lethaniaShip');
    const each = num(tb['Aura.base_attack_speed']) + num(tb['Aura.attack_speed_per_stack']) * (step > 0 ? Math.floor(L / step) : 0);
    const n = battle.allyUnits.filter((u) => u.alive && u.ownerId === pid && u.kind === 'token' && u.defId === CHORUS).length;
    for (const u of members) {
      if (n > 0 && each) S.passiveBuff(battle, u, 'bond:lethania:aura', { aspd: n * each });
      else battle.removeBuff(u, 'bond:lethania:aura');
    }
  };
  apply();
  onLayers(battle, pid, 'lethaniaShip', () => { apply(); chorusAura(); });
  const aliveNotes = () => battle.allyUnits.filter((u) => u.ownerId === pid && u.alive && u.kind === 'token'
    && (u.defId === NOTE || u.defId === CHORUS)).length;
  const summonOne = (anchor) => {
    const cap = power ? num(bb.summon_cnt_max_2, 20) : num(bb.summon_cnt_max_1, 10);
    // [ASSUMED] the cap counts living notes, not every summon ever created.
    if (aliveNotes() >= cap || !anchor) return;
    const L = S.bondLayers(battle, pid, 'lethaniaShip');
    const p = Math.min(num(bb.summon_prob_max, 1), num(bb.summon_prob_base, 1) + num(bb.summon_prob_per_stack) * L);
    if (!(battle.rng() < p)) return;
    let id = NOTE;
    if (power) {
      const big = Math.min(num(bb.big_prob_max, 1), num(bb.big_prob_base) + num(bb.big_prob_per_stack) * L);
      if (battle.rng() < big) id = CHORUS;
    }
    const raw = enemyRaw(battle, id);
    if (!raw) return;
    const R = battle.rect;
    const deathTile = tileKeyOf(anchor);
    if (deathTile < 0) return;
    const row0 = Math.max(R.r0, Math.min(R.r1, Math.floor(deathTile / COLS)));
    const col0 = Math.max(R.c0, Math.min(R.c1, deathTile % COLS));
    const spot = nearestWalkTile(battle, row0, col0);
    if (!spot) return;
    const [row, col] = spot;
    // [ASSUMED] the note and the chorus are allied tokens built from the enemy record (they are not in tokens.json).
    // They may share the tile with another pursuer, an ally, a 射击台, or a downed body. A death tile whose
    // mask is not WALK (highland wall, a hole) uses the nearest WALK tile instead of the death-cell centre.
    const u = battle.spawnToken(pid, id, row, col, {
      ...lethaniaSummon(id, raw), lethaniaPursuit: true, position: { x: col, y: row },
    });
    if (!u) return;
    if (id === NOTE) captureLethaniaBirthMode(battle, u);
    const tb = talentBb(raw);
    if (id === CHORUS) chorusAura();
    const ratio = num(tb['Bleeding.hp_ratio']);
    const iv = num(tb['Bleeding.interval'], 1);
    if (ratio > 0 && iv > 0) {
      battle.every(iv, () => {
        if (!u.alive) return;
        battle.dealHPLose({ source: u, target: u, amount: ratio * u.s.maxHp, type: 'true', tags: ['bond:lethania:bleed'] });
      }, { owner: u });
    }
    apply();
  };
  battle.on('death', (c) => {
    const u = c.unit;
    if (u && u.defId === CHORUS && u.ownerId === pid) chorusAura();
    // HP_ZERO and HP_ZERO_WITH_NO_SOURCE both arrive as reason 'killed'. FALLDOWN is 'falldown'; the engine
    // does not emit it yet (nothing sends a unit into a hole), so this listener stays quiet until one exists.
    if (!u || (c.reason !== 'killed' && c.reason !== 'falldown')) return;
    if (u.side === 'enemy') { summonOne(u); return; }
    if (power && u.side === 'ally' && u.kind === 'op' && u.ownerId === pid) summonOne(u);
  });
}

// Bard trait rhythm (professions.js BARD_REGEN_IV / BARD_REGEN_DUR). The 聚合 ability prefab
// (act3autochess_bond_doc_ability) is not in the tables, so the aura reuses it [ASSUMED]: short enough
// to follow ATK, layers and the live range, and gone within half a second of leaving that range.
const DOC_REGEN_IV = 0.25;
const DOC_REGEN_DUR = 0.5;

/** 「我方单位」for 聚合 recovery: this player's operators and summons. */
function docRecoverTarget(u, pid) {
  // [ASSUMED] 装置 (kind device) and a unit that is not this player's ally (a 变约 on the other side) are not 「我方单位」.
  return !!u && u.alive && !u.removed && u.deployed && u.ownerId === pid && u.side === 'ally'
    && (u.kind === 'op' || u.kind === 'token');
}

function installDoc(battle, pid, effectId, members) {
  const bb = bbOf('docShip', effectId, K.doc);
  const three = reached(battle, pid, 'docShip', bb.power_bond_char_cnt);
  const sheltered = new Set(); // this player's operators holding 庇护 from this installer
  // Official template act3autochess_bond_eff_doc writes HP_RECOVERY_PER_SEC from the member's current ATK.
  // That is 生命回复速度, not a heal (PRTS 禁疗: changing 生命回复速度 is not a healing ability), so
  // 武者 / 收割者 / 不屈者 profile.noHeal and healFree do not stop it (GitHub #983). One buff per member
  // so overlapping members add, the way two bards do. Not bardRegen(): its hook would let 魔王 scale 聚合.
  // Covered = the member's current attack range, skill-widened grids included (rangeKeySet). The member
  // itself only when its own tile is in that range.
  battle.every(DOC_REGEN_IV, () => {
    const L = S.bondLayers(battle, pid, 'docShip');
    const healR = num(bb.heal_base) + num(bb.heal_per_stack) * L;
    if (!(healR > 0)) return;
    for (const m of members) {
      if (!S.onField(m)) continue;
      const v = healR * num(m.s.atk);
      if (!(v > 0)) continue;
      const key = `bond:doc:regen:${m.id}`;
      for (const a of battle.allyUnits) {
        if (!docRecoverTarget(a, pid) || !S.inRange(m, a)) continue;
        battle.addBuff(a, { key, duration: DOC_REGEN_DUR, source: m, mods: { hpRegen: v } });
      }
    }
  });
  battle.every(1, () => {
    const L = S.bondLayers(battle, pid, 'docShip');
    const epR = num(bb.ep_heal_base) + num(bb.ep_heal_per_stack) * L;
    const res = three ? num(bb.damage_res_base) + num(bb.damage_res_per_stack) * L : 0;
    const covered = new Map();
    for (const m of members) {
      if (!S.onField(m)) continue;
      const atk = num(m.s.atk);
      for (const a of battle.allyUnits) {
        if (!a.alive || a.ownerId !== pid || !S.inRange(m, a)) continue;
        // The engine has no EP_RECOVERY_PER_SEC (element gauges do not tick down by themselves).
        // [ASSUMED] keep a 1 s healElement of the same ratio, on the same 「我方单位」as the HP aura.
        if (epR > 0 && docRecoverTarget(a, pid)) battle.healElement({ target: a, amount: epR * atk });
        // 庇护 stays 「所有干员」only, strongest of overlapping members, not summed (§37.272).
        if (res > 0 && S.isOp(a)) {
          const prev = covered.get(a) || 0;
          if (res > prev) covered.set(a, res);
        }
      }
    }
    for (const [a, v] of covered) {
      // [ASSUMED] 庇护 is damage_res as damage taken (strongest of overlapping members, not summed).
      S.passiveBuff(battle, a, 'bond:doc:res', { dmgTakenMul: Math.max(0, 1 - v) });
      sheltered.add(a);
    }
    // 「【聚合】干员攻击范围内的所有干员获得一定比例的庇护」: an operator no member covers any more (it left the range, the
    // range shrank when a skill ended, the member fell) loses it at the next check (GitHub #976 review, round 83).
    // [ASSUMED] still the 1 s check; the ability prefab that holds the official aura is not in the tables.
    for (const a of sheltered) {
      if (covered.has(a)) continue;
      battle.removeBuff(a, 'bond:doc:res');
      sheltered.delete(a);
    }
  });
}

// =====================================================================================================================
// entry

const BY_EFFECT = Object.freeze({
  bondeffect_yan_2: installYan2,
  bondeffect_sargon_2: installSargon2,
  bondeffect_kjerag_2: installKjerag2,
  bondeffect_siracusa_2: installSiracusa2,
  bondeffect_kazimierz_2: installKazimierz2,
  bondeffect_victoria_2: installVictoria2,
  bondeffect_egir_2: installEgir2,
});

/** @returns {boolean} true when this effect id is handled here (core must not also run the 盟约 installer). */
export function installEffect(battle, pid, bondId, effectId, members) {
  const fn = BY_EFFECT[effectId];
  if (!fn) return false;
  fn(battle, pid, effectId, members);
  return true;
}

const EXTRA = Object.freeze([
  ['ursusShip', 'bondeffect_ursus', installUrsus],
  ['iberiaShip', 'bondeffect_iberia', installIberia],
  ['lethaniaShip', 'bondeffect_lethania', installLethania],
  ['docShip', 'bondeffect_doc', installDoc],
]);

export function installExtra(battle) {
  if (!S.isVersionData() || !battle || !Array.isArray(battle.players)) return;
  for (const p of battle.players) {
    const pid = p.playerId;
    for (const [bondId, effectId, fn] of EXTRA) {
      if (!S.bondActive(battle, pid, bondId)) continue;
      const cur = S.bondRecord(bondId)?.effectId;
      if (cur && cur !== effectId) continue;
      const members = S.bondMembers(battle, pid, bondId);
      if (!members.length) continue;
      fn(battle, pid, cur || effectId, members);
    }
  }
}

const ARCANE_REVEAL = 'bond:arcane:reveal';

/** Max arcane layers in this battle, and whether any player's prep count reached `need`. Pair / 联防 share one Battle. */
function arcaneArea(battle, need) {
  let maxLayers = 0;
  let met = false;
  for (const p of battle.players || []) {
    const pid = p.playerId;
    const layers = S.bondLayers(battle, pid, 'arcaneShip');
    if (layers > maxLayers) maxLayers = layers;
    if (reached(battle, pid, 'arcaneShip', need)) met = true;
  }
  return { maxLayers, met };
}

/**
 * 隐匿失效 while a powered arcane member's range covers the enemy. The ability prefab
 * (act3autochess_bond_mag_power[immune_invisible]) is not in the tables.
 * [ASSUMED] leaving the range restores 隐匿: the effect text conditions 失效 on standing in range,
 * the same way an operator module's 「攻击范围内敌人的隐匿效果失效」 does. Not a dispel.
 */
function syncArcaneStealth(battle) {
  const need = bondBb('arcaneShip', K.arcane).power_bond_char_cnt;
  const members = [];
  for (const p of battle.players || []) {
    if (!reached(battle, p.playerId, 'arcaneShip', need)) continue;
    for (const m of S.bondMembers(battle, p.playerId, 'arcaneShip', { fieldOnly: true })) members.push(m);
  }
  for (const e of battle.enemies || []) {
    if (!e) continue;
    const held = typeof e.findBuff === 'function' && e.findBuff(ARCANE_REVEAL);
    const inside = e.alive && e.s?.flags?.stealth && members.some((m) => S.inRange(m, e));
    if (inside) {
      if (!held) battle.addBuff(e, { key: ARCANE_REVEAL, flags: { reveal: true }, duration: Infinity, refresh: 'replace' });
    } else if (held) battle.removeBuff(e, ARCANE_REVEAL);
  }
}

/**
 * 奥术 on a season whose first env_gbuff_new is the act3 arts rider (atk_base, no base_damage_scale).
 * Called from addon/battle.js. Default data returns immediately.
 */
export function installArcaneExtra(battle) {
  if (!S.isVersionData() || !battle) return;
  const sample = bondBb('arcaneShip', K.arcane);
  // a season without the act3 rider (第一期 has no 奥术 at all: null) keeps its own path
  if (!sample || sample.base_damage_scale != null || sample.atk_base == null) return;
  const enemy0 = bondBb('arcaneShip', K.arcaneEnemy);
  // Power clauses (RES shred, 隐匿失效) exist only once some player in this battle reached 3. Skipping the
  // listener and the 0.2 s poll otherwise keeps battles that never meet it off this scheduler.
  if (!arcaneArea(battle, enemy0.power_bond_char_cnt).met) return;
  battle.on('damaged', (c) => {
    const t = c.target, dmg = c.dmg;
    // Enemy template act3autochess_bond_eff_arcane_power[enemy]: ANY_ATTACK_EXCEPT_ELEMENT, cancelled hits
    // dropped, source and the continuous shared mask not filtered. The buff stays when the MAX char count
    // in this battle is ≥ power_bond_char_cnt (_useMaxBondCharCntInCurArea). The floor uses the MAX layers
    // in this battle (_useMaxBondStackCntInCurArea), not the hitter's.
    if (!t || t.side !== 'enemy' || !t.alive || !dmg || dmg.type === 'element' || dmg.type === 'elemental' || isHpLoss(dmg)) return;
    const enemy = bondBb('arcaneShip', K.arcaneEnemy);
    const area = arcaneArea(battle, enemy.power_bond_char_cnt);
    if (!area.met) return;
    const L = area.maxLayers;
    const floor = Math.max(num(enemy.magic_res_max_min, -100), num(enemy.magic_res_max_base, -30) + num(enemy.magic_res_max_per_stack) * L);
    // The template stores magic_resistance and adds magic_res_add when it is still above the floor.
    // A later, deeper floor (the other player's layers rose) steps by one, it does not replay every past hit.
    const prev = num(t.mem.arcaneResAcc, 0);
    if (!(prev > floor)) return;
    const acc = Math.max(floor, prev + num(enemy.magic_res_add, -1));
    t.mem.arcaneResAcc = acc;
    const effective = num(t.base?.res) + acc;
    const shown = Math.min(100, Math.max(0, effective));
    const official = (100 - effective) / 100;
    const engine = (100 - shown) / 100;
    const mods = { resFlat: acc };
    if (engine > 0 && Math.abs(official - engine) > 1e-9) mods.artsTakenMul = official / engine;
    S.passiveBuff(battle, t, 'bond:arcane:res', mods);
  });
  battle.every(0.2, () => syncArcaneStealth(battle));
  battle.on('statusApplied', (c) => {
    if (!c || c.status !== 'stealth' || !c.target || c.target.side !== 'enemy') return;
    syncArcaneStealth(battle);
  });
}

/** Extra arts hit of the act3 奥术 rider. addon calls this only when base_damage_scale is absent. */
export function arcaneRider(battle, ctx, bb) {
  const dmg = ctx.dmg, src = ctx.source, t = ctx.target;
  if (!src || !t || !dmg || arcaneRiderSkips(dmg)) return;
  const scale = Math.abs(num(bb.atk_base) + num(bb.atk_per_stack) * S.bondLayers(battle, src.ownerId, 'arcaneShip'));
  if (!(scale > 0)) return;
  // Snapshot ATK now: the official node applies during the modifier event, not a tick later.
  const amount = scale * num(src.s.atk);
  const deal = () => {
    if (!t.alive || t.removed) return;
    battle.dealDamage({
      source: src, target: t, amount, type: 'arts', attackType: 'ADDITION',
      tags: ['addition', 'bond:arcane'],
    });
  };
  // after(0) is flushed at the next tick's scheduled phase, after this emit has unwound. Ordinary hits stay
  // in this chain: deferring them would move every 3+ 奥术 fight by one tick. A rider hit is ADDITION, so it
  // does not enter deal() again.
  if (arcaneRiderDefers(dmg)) battle.after(0, deal, { owner: src });
  else deal();
}

/**
 * 谢拉格不融冰: every `layer` layers of kjeragShip, `count` item(s) from `pool`.
 * No-op when the bond record has no bond_layer_added_reward_equip (盟约 谢拉格, and a swap back to it).
 * The item's own effect belongs to the items task.
 */
export function payKjeragIce(ctx) {
  if (!ctx || typeof ctx.bondActive !== 'function' || !ctx.bondActive('kjeragShip')) return 0;
  const rec = ctx.data?.bonds?.kjeragShip ?? S.bondRecord('kjeragShip');
  const effectId = rec?.effectId;
  const p = S.buffParams(rec, K.reward) || (effectId ? S.buffParams(S.effectRecord(effectId), K.reward) : null);
  const step = Math.floor(num(p?.layer, 0));
  if (!p || !(step > 0)) return 0;
  const due = Math.floor(ctx.layers('kjeragShip') / step);
  const count = Math.min(bbCap('count'), Math.max(0, Math.floor(num(p.count, 1))));
  let granted = 0;
  for (let guard = 0; guard < 100; guard++) {
    const paid = ctx.counter(KJERAG_ICE);
    if (paid >= due) break;
    ctx.setCounter(KJERAG_ICE, paid + 1);
    for (let i = 0; i < count; i++) {
      const id = ctx.rollItem({ pool: p.pool });
      if (id && ctx.grantItem(id, { source: 'bond:kjeragShip' })) granted++;
    }
  }
  if (granted && typeof ctx.toast === 'function') ctx.toast(msg('【谢拉格】获得{n}件谢拉格不融冰', { n: granted }), 'info');
  return granted;
}
