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
import { lendItemEffects } from '../items.js';
import { damageAttackType, isHpLoss } from '../../attack.js';
import { msg } from '../../../../shared/i18n.js';
import { bbCap } from '../../../../shared/plugins/officialBounds.js';

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
// Official element gauges. The 炎 template rolls element_type 1..6; the engine has these five.
// [ASSUMED] 5 → necrosis and 6 → neural again. No sixth gauge exists in the sim.
const YAN_ELEMENTS = Object.freeze(['neural', 'erosion', 'burn', 'apoptosis', 'necrosis', 'neural']);

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
  if (!dmg || isHpLoss(dmg) || dmg.type === 'element' || dmg.type === 'elemental') return true;
  if (damageAttackType(dmg) === 'ADDITION' || tagged(dmg, 'addition') || tagged(dmg, 'dot') || tagged(dmg, 'periodic')) return true;
  return false;
}
function onLayers(battle, pid, bondId, fn) {
  const st = S.battleStore(battle, 'bonds:reg:layers', () => ({ map: new Map(), pending: new Set(), hooked: false }));
  const k = `${pid}|${bondId}`;
  if (!st.map.has(k)) st.map.set(k, []);
  st.map.get(k).push(fn);
  if (st.hooked) return;
  st.hooked = true;
  battle.on('layerGain', (c) => {
    const key = `${c.playerId}|${c.bondId}`;
    const list = st.map.get(key);
    if (!list || st.pending.has(key)) return;
    st.pending.add(key);
    battle.after(0, () => { st.pending.delete(key); for (const f of list) f(); });
  }, { priority: -100 });
}

/** Temp layers (乌萨斯 kill node `_isTemp`). Not normal layers; a garrison may convert them later. */
export function tempBondLayers(battle, pid, bondId) {
  const st = S.battleStore(battle, 'bonds:reg:temp', () => ({}));
  return num(st[`${pid}|${bondId}`]);
}
function addTemp(battle, pid, bondId, n) {
  if (!(n > 0)) return;
  const st = S.battleStore(battle, 'bonds:reg:temp', () => ({}));
  const k = `${pid}|${bondId}`;
  st[k] = num(st[k]) + n;
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

function handSwitch(battle, dead, bondId, { meleeOnly = false, cap = Infinity, counter } = {}) {
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
    return true;
  }
  return false;
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
  const slowKey = 'act3autochess_bond_eff_sargon_power[tile_buff][slow]';
  const magKey = 'act3autochess_bond_eff_sargon_power[tile_buff][mag_damage]';
  const mag2Key = 'act3autochess_bond_eff_sargon_power[tile_buff][mag_damage_2]';
  const covered = () => {
    const out = [];
    for (const e of battle.enemies) {
      if (!e.alive) continue;
      if (members.some((m) => S.onField(m) && S.inRange(m, e))) out.push(e);
    }
    return out;
  };
  const skillOn = () => members.some((m) => S.onField(m) && m.skill && m.skill.active);
  const refreshSlow = () => {
    const L = S.bondLayers(battle, pid, 'sargonShip');
    let slow = scaled(tile, `${slowKey}.slow_base`, `${slowKey}.slow_per_stack`, L, `${slowKey}.slow_max`);
    if (skillOn()) slow = Math.min(num(tile[`${slowKey}.slow_max`], slow), slow + slow);
    const inside = new Set(covered());
    for (const e of battle.enemies) {
      if (!e.alive) continue;
      if (!inside.has(e)) { if (e.findBuff && e.findBuff('bond:sargon:slow')) battle.removeBuff(e, 'bond:sargon:slow'); continue; }
      battle.addBuff(e, { key: 'bond:sargon:slow', duration: 1.25, refresh: 'replace', mods: { moveMul: Math.max(0, 1 - slow) } });
    }
  };
  refreshSlow();
  battle.every(1, refreshSlow);
  const iv = num(tile[`${magKey}.interval`], 5);
  if (iv > 0) {
    battle.every(iv, () => {
      const L = S.bondLayers(battle, pid, 'sargonShip');
      const amount = scaled(tile, `${magKey}.magic_damage_base`, `${magKey}.magic_damage_per_stack`, L, `${magKey}.magic_damage_max`);
      const bind = num(tile[`${magKey}.unmovable_duration`], 0);
      if (!(amount > 0)) return;
      for (const e of covered()) {
        battle.dealDamage({ source: null, target: e, amount, type: 'arts', attackType: 'BUFF', tags: ['bond:sargon', 'periodic'] });
        if (e.alive && bind > 0) battle.applyStatus(e, 'bind', { duration: bind, source: null });
      }
    });
  }
  // mag_damage_2 triggerInterval is 1s (buff template), and only while the skill aura buff is on the enemy.
  battle.every(1, () => {
    if (!skillOn()) return;
    const L = S.bondLayers(battle, pid, 'sargonShip');
    const amount = scaled(tile, `${mag2Key}.magic_damage_base`, `${mag2Key}.magic_damage_per_stack`, L, `${mag2Key}.magic_damage_max`);
    if (!(amount > 0)) return;
    for (const e of covered()) {
      battle.dealDamage({ source: null, target: e, amount, type: 'arts', attackType: 'BUFF', tags: ['bond:sargon', 'periodic'] });
    }
  });
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
    // [ASSUMED]. SwitchMode and FrozenBreak stay on the enemy record and are not run here.
    const atkMul = 1 + num(tb['BondBuff.base_atk']) + num(tb['BondBuff.attack_per_stack']) * steps;
    const hpMul = 1 + num(tb['BondBuff.base_max_hp']) + num(tb['BondBuff.max_hp_per_stack']) * steps;
    const st = raw.stats || {};
    battle.spawnToken(anchor, GIANT, tile[0], tile[1], {
      def: raw, anySource: true,
      stats: {
        atk: num(st.atk) * atkMul,
        maxHp: num(st.maxHp) * hpMul,
        blockCnt: num(tb['BlockEnemy.block_cnt'], st.blockCnt),
      },
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
  battle.on('damaged', (c) => {
    const u = c.source, t = c.target, dmg = c.dmg;
    if (!set.has(u) || !t || t.side !== 'enemy' || !t.alive || rider(dmg) || tagged(dmg, 'bond:siracusa')) return;
    if (!(battle.rng() < prob)) return;
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
  const set = new Set(members);
  const window = num(bb.ex_damage_duration, 0);
  battle.on('damaged', (c) => {
    const u = c.source, t = c.target, dmg = c.dmg;
    if (!set.has(u) || !t || t.side !== 'enemy' || !t.alive || rider(dmg) || tagged(dmg, 'bond:kazimierz')) return;
    const fresh = window > 0 && battle.time <= num(u.deployedAt, -Infinity) + window + 1e-9;
    const casting = !!(u.skill && u.skill.active);
    if (!fresh && !casting) return;
    const scale = scaled(bb, 'ex_atk_scale_base', 'ex_atk_scale_per_stack', S.bondLayers(battle, pid, 'kazimierzShip'), 'ex_atk_scale_max');
    if (!(scale > 0)) return;
    battle.dealDamage({ source: u, target: t, amount: scale * num(u.s.atk), type: 'true', attackType: 'ADDITION',
      tags: ['addition', 'bond:kazimierz'] });
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
    handSwitch(battle, u, 'egirShip', { meleeOnly: false, cap, counter: 'egir2' });
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
    if (c.reason !== 'killed' || !c.unit || c.unit.side !== 'enemy') return;
    const killer = c.killer;
    const who = killer && killer.kind === 'token' ? killer.ownerUnit : killer;
    if (!set.has(who)) return;
    const n = six ? num(bb['temp_bond_stack_cnt[power]'], 4) : num(bb.temp_bond_stack_cnt, 2);
    const extra = num(bb.extra_bond_stack_cnt, 0);
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
      const radius = num(bb.range_radius, 1);
      const amount = num(bb.atk_scale, 0) * st.atk;
      if (amount > 0) {
        for (const e of battle.enemies) {
          if (!e.alive || e === t || !inRadius(e, t.x, t.y, radius)) continue;
          battle.dealDamage({ source: who, target: e, amount, type: 'arts', isSplash: true, tags: ['bond:iberia', 'addition'] });
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
  apply();
  onLayers(battle, pid, 'lethaniaShip', apply);
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
    const tile = nearestOpen(battle, anchor.tileR, anchor.tileC, 5) || nearestOpen(battle, anchor.tileR, anchor.tileC, null);
    if (!tile) return;
    // [ASSUMED] the note and the chorus are allied tokens built from the enemy record (they are not in tokens.json).
    const u = battle.spawnToken(anchor, id, tile[0], tile[1], { def: raw, anySource: true });
    if (!u) return;
    const tb = talentBb(raw);
    const aspd = num(tb['Aura.base_attack_speed']);
    if (aspd) S.passiveBuff(battle, u, 'bond:lethania:aura', { aspd });
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
  battle.on('battleStart', () => { for (const m of members) if (S.onField(m)) summonOne(m); }, { once: true });
  if (!power) return;
  const ops = new Set(members.filter(S.isOp));
  battle.on('death', (c) => {
    const u = c.unit;
    if (!u || c.reason !== 'killed' || u.kind !== 'op' || !ops.has(u)) return;
    const anchor = members.find(S.onField) || u;
    summonOne(anchor);
  }, { priority: -1 });
}

function installDoc(battle, pid, effectId, members) {
  const bb = bbOf('docShip', effectId, K.doc);
  const three = reached(battle, pid, 'docShip', bb.power_bond_char_cnt);
  battle.every(1, () => {
    const L = S.bondLayers(battle, pid, 'docShip');
    const healR = num(bb.heal_base) + num(bb.heal_per_stack) * L;
    const epR = num(bb.ep_heal_base) + num(bb.ep_heal_per_stack) * L;
    const res = three ? num(bb.damage_res_base) + num(bb.damage_res_per_stack) * L : 0;
    const covered = new Map();
    for (const m of members) {
      if (!S.onField(m)) continue;
      const atk = num(m.s.atk);
      for (const a of battle.allyUnits) {
        if (!a.alive || a.ownerId !== pid || !S.isOp(a) || !S.inRange(m, a)) continue;
        // [ASSUMED] overlapping members each heal; HP and element recovery stack.
        if (healR > 0) battle.heal({ source: m, target: a, amount: healR * atk });
        if (epR > 0) battle.healElement({ target: a, amount: epR * atk });
        if (res > 0) {
          const prev = covered.get(a) || 0;
          if (res > prev) covered.set(a, res);
        }
      }
    }
    for (const [a, v] of covered) {
      // [ASSUMED] 庇护 is damage_res as damage taken (strongest of overlapping members, not summed).
      S.passiveBuff(battle, a, 'bond:doc:res', { dmgTakenMul: Math.max(0, 1 - v) });
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

/**
 * 奥术 on a season whose first env_gbuff_new is the act3 arts rider (atk_base, no base_damage_scale).
 * Called from addon/battle.js. Default data returns immediately.
 */
export function installArcaneExtra(battle) {
  if (!S.isVersionData() || !battle) return;
  const sample = bondBb('arcaneShip', K.arcane);
  // a season without the act3 rider (第一期 has no 奥术 at all: null) keeps its own path
  if (!sample || sample.base_damage_scale != null || sample.atk_base == null) return;
  battle.on('damaged', (c) => {
    const t = c.target, dmg = c.dmg;
    if (!t || t.side !== 'enemy' || !t.alive || !dmg || dmg.type === 'element' || dmg.type === 'elemental' || isHpLoss(dmg)) return;
    const src = c.source;
    const pid = src && src.ownerId;
    if (!pid || !S.bondActive(battle, pid, 'arcaneShip')) return;
    const enemy = bondBb('arcaneShip', K.arcaneEnemy);
    if (!reached(battle, pid, 'arcaneShip', enemy.power_bond_char_cnt)) return;
    const L = S.bondLayers(battle, pid, 'arcaneShip');
    const floor = Math.max(num(enemy.magic_res_max_min, -100), num(enemy.magic_res_max_base, -30) + num(enemy.magic_res_max_per_stack) * L);
    const hits = (t.mem.arcaneResHits || 0) + 1;
    t.mem.arcaneResHits = hits;
    const acc = Math.max(floor, hits * num(enemy.magic_res_add, -1));
    const effective = num(t.base?.res) + acc;
    const shown = Math.min(100, Math.max(0, effective));
    const official = (100 - effective) / 100;
    const engine = (100 - shown) / 100;
    const mods = { resFlat: acc };
    if (engine > 0 && Math.abs(official - engine) > 1e-9) mods.artsTakenMul = official / engine;
    S.passiveBuff(battle, t, 'bond:arcane:res', mods);
  });
  battle.on('statusApplied', (c) => {
    if (!c || c.status !== 'stealth' || !c.target || c.target.side !== 'enemy') return;
    for (const p of battle.players || []) {
      const pid = p.playerId;
      if (!reached(battle, pid, 'arcaneShip', bondBb('arcaneShip', K.arcane).power_bond_char_cnt)) continue;
      const members = S.bondMembers(battle, pid, 'arcaneShip', { fieldOnly: true });
      if (members.some((m) => S.inRange(m, c.target))) {
        battle.removeStatus(c.target, 'stealth');
        return;
      }
    }
  });
}

/** Extra arts hit of the act3 奥术 rider. addon calls this only when base_damage_scale is absent. */
export function arcaneRider(battle, ctx, bb) {
  const dmg = ctx.dmg, src = ctx.source, t = ctx.target;
  if (!src || !t || !dmg || rider(dmg) || tagged(dmg, 'bond:arcane')) return;
  const scale = Math.abs(num(bb.atk_base) + num(bb.atk_per_stack) * S.bondLayers(battle, src.ownerId, 'arcaneShip'));
  if (!(scale > 0)) return;
  battle.dealDamage({
    source: src, target: t, amount: scale * num(src.s.atk), type: 'arts', attackType: 'ADDITION',
    tags: ['addition', 'bond:arcane'],
  });
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
