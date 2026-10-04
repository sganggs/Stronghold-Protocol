// server/sim/content/bonds/core.js — the 8 core bonds (核心盟约, research 02 §3.1–3.8), battle side + prep side.
//
//   炎 yanShip           members ATK +(base_atk + atk_per_stack·L); 6: one “炎佑” (its template ATK / max HP + 30 %
//                        of the 炎 ATK / max HP sums at battle start — PRTS "增加…（最终加算）"); 9: two 炎佑, ATK ×atk,
//                        damage taken ×(1 − damage_resistance)
//   (every bond "+X%" ATK / max HP here is 直接乘算 — S.directMods, additive with the other percentages, PRTS 盟约记录)
//   萨尔贡 sargonShip    member skill start → every member on the field gets an independent stack (ASPD +base_attack_speed
//                        for base_time + time_per_stack·L s, ≤ max_buff_stack_cnt); 6: each stack also ATK +base_atk
//                        (additive, one 直接乘算 buff); 6 + band_narant: instead lends the caster's equipment (tier ≤
//                        filter_item_level) to the 8 surrounding operators (items.js lendItemEffects)
//   维多利亚 victoriaShip members carrying equipment deal ×(base_damage_scale + damage_scale_per_stack·L);
//                        6: ATK +atk_normal_equip per item (+atk_golden_equip more per golden item; 直接乘算);
//                        prep: every `layer` layers → `count` item(s) from `pool` (bond_layer_added_reward_equip)
//   谢拉格 kjeragShip    members deal ×base_damage_scale, vs cold / frozen enemies ×(base_ex_damage_scale +
//                        ex_damage_scale_per_stack·L) instead; 6: cold wind (devices.js kjeragColdWind)
//   拉特兰 lateranoShip  member ammo skills start with floor(ammo × (1 + base_ammo_percent + ammo_percent_per_stack·L));
//                        6: every ammo used by a member → all members ATK +atk_per_consume (≤ max_atk_for_consume)
//   阿戈尔 egirShip      members max HP +(base_max_hp + max_hp_per_stack·L) (直接乘算); battle start devour (see devour());
//                        5: the first max_free_respawn_cnt members knocked out for the first time redeploy at once (free)
//   叙拉古 siracusaShip  every member deployment: ASPD +(base + per·L) for (base_duration + per·L) s; 6: 隐匿 for the same
//                        time, and while hidden / end_duration s after, attacks proc (PRD, nominal `prob`) base_damage +
//                        damage_per_stack·L true damage + fear `fear` s
//   卡西米尔 kazimierzShip every deployment of one of the player's operators (initial ones included): members ATK
//                        +atk_when_born, total ≤ base_max_atk_when_born + max_atk_when_born_per_stack·L; 6: blocking
//                        members pulse damage_atk_scale×ATK true damage + stun around them every damage_interval s,
//                        non-blocking members' attacks add pure_atk_scale×ATK true damage
//
// Numbers: data/bonds.json buffs (support.buffParams by bbStr.key); 炎佑's 30 % is parsed from the effect text.
// Tiers: a bond's upper tier is reached when count ≥ the blackboard threshold (power_bond_char_cnt / ex_bond_char_cnt)
// or the bond's tier index says so. Members = support.isMember (own bonds, 变形同构体, 调和 enjoying core bonds).
// Live layers: effects that read L at a moment (stack duration, ammo, deploy buffs, proc damage, cold multiplier) read
// the live value; standing buffs (炎 ATK, 维多利亚, 阿戈尔 HP, 卡西米尔 cap) are refreshed one tick after a `layerGain`.
// Two players in one field: everything is per player (own members, own deployments); the 谢拉格 wind and 炎佑 act on
// every enemy of the field (debuffs on shared enemies help both, research 06 §8.6).
// Hook priorities: 拉特兰 skillStart −10 (after kits' own ammo changes), 阿戈尔 death 11 (5-tier revive, before 不屈's
// death 10), layerGain −100 (after 魔王-style modifiers).

import * as S from '../support/index.js';
import { mitigate } from '../../damage.js';
import { spawnYanyou } from '../tokens.js';
import { kjeragColdWind } from '../devices.js';
import * as items from '../items.js';

const num = S.num;

/** Injection point for tests (lendItemEffects stub); null ⇒ items.js export. */
export const deps = { lendItemEffects: null };

const BUFF_KEYS = Object.freeze({
  yanShip: 'act1autochess_bond_eff_yan',
  sargonShip: 'act1autochess_bond_eff_sargon',
  victoriaShip: 'act1autochess_bond_eff_victoria',
  kjeragShip: 'act1autochess_bond_eff_kjerag',
  lateranoShip: 'act1autochess_bond_eff_laterano',
  egirShip: 'act1autochess_bond_eff_egir',
  siracusaShip: 'act2autochess_bond_eff_siracusa',
  kazimierzShip: 'act2autochess_bond_eff_kazimierz',
});
const SARGON_SHARE_KEY = 'act2autochess_bond_eff_sargon[share]';
const VICTORIA_REWARD_KEY = 'bond_layer_added_reward_equip';
const VICTORIA_COUNTER = 'bond:victoria:hammers';

/** Bond effect blackboard `{ ...bb, ...bbStr }` of a core bond (null when the data record is missing). */
export function bondBb(bondId, key = BUFF_KEYS[bondId]) {
  return S.buffParams(S.bondRecord(bondId), key);
}

/** Has player `pid` reached the tier of `bondId` that needs `cnt` members? (active + count / tier index) */
export function reached(battle, pid, bondId, cnt) {
  const st = S.bondState(battle, pid, bondId);
  if (!st || !st.active) return false;
  const need = num(cnt, 0);
  if (!(need > 0)) return true;
  if (num(st.count, 0) >= need) return true;
  const th = S.bondRecord(bondId)?.thresholds;
  const idx = Array.isArray(th) ? th.indexOf(need) : -1;
  return idx >= 0 && S.bondTier(battle, pid, bondId) >= idx + 1;
}

/** "总和的30%" → 0.3 (炎佑 stat share, text only). */
export function yanyouShare() {
  const text = String(S.bondRecord('yanShip')?.effectDesc ?? S.bondRecord('yanShip')?.desc ?? '');
  const m = /总和的\s*(\d+(?:\.\d+)?)\s*%/.exec(text);
  const v = m ? +m[1] / 100 : NaN;
  return v > 0 && v <= 10 ? v : 0.3;
}

const PRD = new Map();
/**
 * Pseudo-random-distribution constant C for a nominal probability p: attempt n since the last proc succeeds with
 * min(1, C·n), and the long-run proc rate equals p (3 % → C ≈ 0.00139, research 02 §3.7).
 */
export function prdConstant(p) {
  if (!(p > 0)) return 0;
  if (p >= 1) return 1;
  if (PRD.has(p)) return PRD.get(p);
  const rate = (c) => {
    let exp = 0, notYet = 1;
    const nMax = Math.ceil(1 / c) + 1;
    for (let n = 1; n <= nMax && notYet > 0; n++) {
      const pn = Math.min(1, n * c);
      exp += n * notYet * pn;
      notYet *= 1 - pn;
    }
    return exp > 0 ? 1 / exp : 1;
  };
  let lo = 0, hi = p;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (rate(mid) < p) lo = mid; else hi = mid;
  }
  const c = (lo + hi) / 2;
  PRD.set(p, c);
  return c;
}

// =====================================================================================================================
// per-battle plumbing

/** Shared per-battle state: layer refreshers, one hit / damaged / skillStart dispatch per battle. */
function core(battle) {
  return S.battleStore(battle, 'bonds:core', () => ({
    refreshers: new Map(), // `${pid}|${bondId}` → [fn]
    pending: new Set(),
    hitFns: new Map(),     // source unit → [fn(ctx)]
    dmgFns: new Map(),     // source unit → [fn(ctx)]
    hooked: new Set(),
  }));
}

function onLayers(battle, pid, bondId, fn) {
  const st = core(battle);
  const k = `${pid}|${bondId}`;
  if (!st.refreshers.has(k)) st.refreshers.set(k, []);
  st.refreshers.get(k).push(fn);
  if (st.hooked.has('layerGain')) return;
  st.hooked.add('layerGain');
  battle.on('layerGain', (c) => {
    const key = `${c.playerId}|${c.bondId}`;
    const list = st.refreshers.get(key);
    if (!list || st.pending.has(key)) return;
    st.pending.add(key);
    // the gain is recorded after the hook: re-read the live layers next tick
    battle.after(0, () => { st.pending.delete(key); for (const f of list) f(); });
  }, { priority: -100 });
}

function onUnitHit(battle, unit, fn) {
  const st = core(battle);
  if (!st.hitFns.has(unit)) st.hitFns.set(unit, []);
  st.hitFns.get(unit).push(fn);
  if (st.hooked.has('hit')) return;
  st.hooked.add('hit');
  battle.on('hit', (c) => {
    const list = c.source ? st.hitFns.get(c.source) : undefined;
    if (list) for (let i = 0; i < list.length; i++) list[i](c);
  });
}

function onUnitDamaged(battle, unit, fn) {
  const st = core(battle);
  if (!st.dmgFns.has(unit)) st.dmgFns.set(unit, []);
  st.dmgFns.get(unit).push(fn);
  if (st.hooked.has('damaged')) return;
  st.hooked.add('damaged');
  battle.on('damaged', (c) => {
    const list = c.source ? st.dmgFns.get(c.source) : undefined;
    if (list) for (let i = 0; i < list.length; i++) list[i](c);
  });
}

const isEnemyTarget = (t) => !!t && t.side === 'enemy' && t.alive;
const ownTag = (dmg, tag) => !!dmg && Array.isArray(dmg.tags) && dmg.tags.includes(tag);

// =====================================================================================================================
// 炎

function installYan(battle, pid, bb, members) {
  const L = () => S.bondLayers(battle, pid, 'yanShip');
  const apply = () => {
    const mods = S.directMods({ atk: num(bb.base_atk) + num(bb.atk_per_stack) * L() });
    for (const u of members) S.passiveBuff(battle, u, 'bond:yan', mods);
  };
  apply();
  onLayers(battle, pid, 'yanShip', apply);
  if (!reached(battle, pid, 'yanShip', bb.power_bond_char_cnt)) return;
  const ex = reached(battle, pid, 'yanShip', bb.ex_bond_char_cnt);
  battle.on('battleStart', () => {
    // PRTS: the sums count real 炎 operators only (调和 operators' stats are not collected unless they are 炎 too)
    let atk = 0, hp = 0;
    for (const u of S.playerOps(battle, pid, { fieldOnly: true })) {
      if (!S.unitBonds(u).includes('yanShip')) continue;
      atk += num(u.s.atk, 0);
      hp += num(u.s.maxHp, 0);
    }
    if (!(hp > 0)) return;
    const share = yanyouShare();
    const out = spawnYanyou(battle, pid, {
      atk: atk * share, hp: hp * share, count: ex ? 2 : 1,
      atkMul: ex ? num(bb.atk, 1) : 1,
      dmgTakenMul: ex ? Math.max(0, 1 - num(bb.damage_resistance, 0)) : 1,
    });
    for (const y of out) y.mem.bondYan = true;
  }, { once: true });
}

// =====================================================================================================================
// 萨尔贡

function installSargon(battle, pid, bb, members) {
  const memberSet = new Set(members);
  const ps = S.player(battle, pid);
  const share = S.buffParams(S.bondRecord('sargonShip'), SARGON_SHARE_KEY);
  const band = ps?.bandId ?? null;
  const narant = !!(share && band && share.valid_in_band === band);
  const main = narant ? share : bb;
  const six = reached(battle, pid, 'sargonShip', num(main.power_bond_char_cnt, 6));
  const atkStacks = six && !narant && !(bb.invalid_in_band && bb.invalid_in_band === band);
  const maxStacks = Math.max(1, Math.floor(num(main.max_buff_stack_cnt, 25)));
  const perAtk = num(bb.base_atk, 0);
  const syncAtk = (u) => {
    if (!atkStacks) return;
    let n = 0;
    for (const b of u.buffs) if (b.key === 'bond:sargon') n++;
    if (n > 0 && u.alive) battle.addBuff(u, { key: 'bond:sargon:atk', mods: S.directMods({ atk: perAtk * n }) });
    else battle.removeBuff(u, 'bond:sargon:atk');
  };
  battle.on('skillStart', ({ unit }) => {
    if (!memberSet.has(unit)) return;
    const L = S.bondLayers(battle, pid, 'sargonShip');
    const dur = num(main.base_time, 0) + num(main.time_per_stack, 0) * L;
    if (dur > 0) {
      for (const m of members) {
        if (!S.onField(m)) continue;
        battle.addBuff(m, {
          key: 'bond:sargon', duration: dur, refresh: 'independent', maxStacks,
          mods: { aspd: num(main.base_attack_speed, 0) },
          onExpire: ({ unit: u }) => syncAtk(u), onRemove: ({ unit: u }) => syncAtk(u),
        });
        syncAtk(m);
      }
    }
    if (narant && six) lendAround(battle, unit, share, S.bondLayers(battle, pid, 'sargonShip'));
  });
}

function lendAround(battle, from, share, L) {
  if (!S.itemsOf(from).length) return;
  const lend = typeof deps.lendItemEffects === 'function' ? deps.lendItemEffects
    : typeof items.lendItemEffects === 'function' ? items.lendItemEffects : null;
  if (!lend) return;
  const duration = num(share.base_power_time, 0) + num(share.power_time_per_stack, 0) * L;
  if (!(duration > 0)) return;
  const maxTier = num(share.filter_item_level, 5);
  let n = 0;
  for (const a of S.alliesAround(battle, from, S.N8)) {
    if (!S.isOp(a)) continue;
    lend(battle, from, a, { maxTier, duration });
    n++;
  }
  if (n) S.fxOn(battle, 'bondShare', from, 'bond:sargonShip', 'narant', { n, duration });
}

// =====================================================================================================================
// 维多利亚

function installVictoria(battle, pid, bb, members) {
  const apply = () => {
    const mul = num(bb.base_damage_scale, 1) + num(bb.damage_scale_per_stack, 0) * S.bondLayers(battle, pid, 'victoriaShip');
    for (const u of members) {
      if (S.itemsOf(u).length >= 1) S.passiveBuff(battle, u, 'bond:victoria', { dmgDealtMul: mul });
    }
  };
  apply();
  onLayers(battle, pid, 'victoriaShip', apply);
  if (!reached(battle, pid, 'victoriaShip', bb.power_bond_char_cnt)) return;
  const normal = num(bb.atk_normal_equip, 0), golden = normal + num(bb.atk_golden_equip, 0);
  for (const u of members) {
    const ids = S.itemsOf(u);
    if (!ids.length) continue;
    let add = 0;
    for (const id of ids) add += S.isGoldenId(id) ? golden : normal;
    if (add > 0) S.passiveBuff(battle, u, 'bond:victoria:atk', S.directMods({ atk: add }));
  }
}

// =====================================================================================================================
// 谢拉格

function installKjerag(battle, pid, bb, members) {
  const base = num(bb.base_damage_scale, 1);
  for (const u of members) S.passiveBuff(battle, u, 'bond:kjerag', { dmgDealtMul: base });
  const ex = num(bb.base_ex_damage_scale, base), per = num(bb.ex_damage_scale_per_stack, 0);
  const onHit = (c) => {
    const t = c.target;
    if (!isEnemyTarget(t) || !c.dmg) return;
    const f = t.s.flags;
    if (!f.cold && !f.freeze) return;
    const target = ex + per * S.bondLayers(battle, pid, 'kjeragShip');
    if (base > 0 && target > 0) c.dmg.mul *= target / base;
  };
  for (const u of members) onUnitHit(battle, u, onHit);
  if (reached(battle, pid, 'kjeragShip', bb.power_bond_char_cnt)) kjeragColdWind(battle, pid, bb);
}

// =====================================================================================================================
// 拉特兰

function installLaterano(battle, pid, bb, members) {
  const memberSet = new Set(members);
  battle.on('skillStart', ({ unit, skill }) => {
    if (!memberSet.has(unit) || !skill || skill.kind !== 'ammo' || !(skill.ammoLeft > 0)) return;
    const mul = 1 + num(bb.base_ammo_percent, 0) + num(bb.ammo_percent_per_stack, 0) * S.bondLayers(battle, pid, 'lateranoShip');
    const n = Math.floor(skill.ammoLeft * mul + 1e-9);
    if (Number.isFinite(n) && n > skill.ammoLeft) skill.ammoLeft = n;
  }, { priority: -10 });
  if (!reached(battle, pid, 'lateranoShip', bb.power_bond_char_cnt)) return;
  const per = num(bb.atk_per_consume, 0), cap = num(bb.max_atk_for_consume, Infinity);
  if (!(per > 0)) return;
  const st = { used: 0, bonus: 0 };
  battle.on('ammoUsed', ({ unit }) => {
    if (!memberSet.has(unit) || st.bonus >= cap) return;
    st.used++;
    st.bonus = Math.min(cap, st.used * per);
    for (const m of members) S.passiveBuff(battle, m, 'bond:laterano:ammo', S.directMods({ atk: st.bonus }));
  });
}

// =====================================================================================================================
// 阿戈尔

/**
 * Battle-start devour (research 02 §3.6 algorithm): members in order (further left on the player's own board — the
 * Final Assault right side is mirrored, so its board-left is the field's right — then higher on the board first) mark
 * the operator on the tile in front of them (one step along each member's own direction `dir`), and through marked
 * members the tiles in front of
 * those (chain); never themselves, a unit already marked by them or a unit that marked them. The marker gains the base
 * ATK (atkFlat) and block count of everything it marked; then each mark makes its target lose damage_value HP as a
 * 物理流失 (PRTS 盟约记录: "造成5000点物理流失", 修正 "【吞噬】的物理流失来源为被付与目标自身；单位被【吞噬】击杀时，击杀来源始终为
 * 对应标记的付与来源"; PRTS 作战机制: a 物理流失 "会受到目标当前防御力…影响而相应衰减") — less the target's DEF as a physical hit
 * (its own source: no DEF ignore), then battle.loseHp: no shields, dodge or damage multipliers (DEF-free until 0.1.1); the
 * kill is credited to the marker — in marking order. A target knocked out during the pass has its remaining marks
 * cancelled, also when it is back at once (the 5-tier 立刻复活, 不屈's 立刻重新部署, 埃芒加德 / M3茧甲): PRTS 盟约记录 "目标首次被
 * 击倒后解除自身被付与但还未触发的【吞噬】效果". A marker off the field gives no further mark (the rule since 0.1.0; one knocked
 * out and back in the same pass still gives its marks).
 * Each devoured operator adds its tier to 阿戈尔 once (IN_BATTLE gain, disabled in 联防 / boss fields).
 * Tokens / devices / empty tiles are never devoured.
 */
function devour(battle, pid, bb, members) {
  const memberSet = new Set(members);
  // "更靠左和靠上": left first (on the player's own board: mirrored players count from the field's right), then top
  // first — row 0 is the BOTTOM row (DESIGN §3), so the top of the board is the highest row index. The order is a
  // board position, independent of the members' directions (only "身前" follows each member's `dir`).
  const boardCol = (u) => (u.player && u.player.mirror ? -u.tileC : u.tileC);
  const order = members.filter(S.onField).sort((a, b) =>
    boardCol(a) - boardCol(b) || b.tileR - a.tileR || a.id - b.id);
  const opAt = (u) => {
    const [r, c] = S.frontTile(u);
    const a = S.allyAt(battle, r, c, pid);
    return a && S.isOp(a) && a.alive ? a : null;
  };
  const markedBy = new Map(); // marker → [targets]
  const marks = [];
  for (const m of order) {
    const mine = [];
    const seen = new Set([m]);
    const queue = [m];
    for (let guard = 0; queue.length && guard < 64; guard++) {
      const x = queue.shift();
      const t = opAt(x);
      if (!t || seen.has(t)) continue;
      if ((markedBy.get(t) ?? []).includes(m)) continue;
      seen.add(t);
      mine.push(t);
      if (memberSet.has(t)) queue.push(t);
    }
    markedBy.set(m, mine);
    if (!mine.length) continue;
    let atk = 0, block = 0;
    for (const t of mine) { atk += num(t.base.atk, 0); block += num(t.base.blockCnt, 0); marks.push([m, t]); }
    const mods = {};
    if (atk > 0) mods.atkFlat = atk;
    if (block > 0) mods.blockCnt = block;
    if (Object.keys(mods).length) S.passiveBuff(battle, m, 'bond:egir:devour', mods);
  }
  const amount = num(bb.damage_value, 0);
  const layered = new Set();
  // a target knocked out during the pass = off the field, or in another deployment than when the marks were placed (items
  // deploymentOf: the 5-tier revive and 不屈 redeploy it, 埃芒加德 / M3茧甲 revive it in place) — a revived member was
  // standing again when its pending marks used to knock it out a second time and spend every revive at t = 0 (GitHub #33)
  const dep = new Map();
  for (const [, t] of marks) if (!dep.has(t)) dep.set(t, items.deploymentOf(t));
  const knocked = (t) => !t.alive || items.deploymentOf(t) !== dep.get(t);
  for (const [m, t] of marks) {
    if (knocked(t) || !m.alive) continue;
    S.fxOn(battle, 'devour', t, 'bond:egirShip', 'devour', { from: m.id });
    if (amount > 0) battle.loseHp(t, mitigate(amount, 'phys', t.s), { source: m, tags: ['bond:egir:devour'] });
    if (!layered.has(t)) {
      layered.add(t);
      S.gainLayers(battle, { playerId: pid, bonds: 'egirShip', n: S.tierOf(t), source: m, reason: 'bond' });
    }
  }
}

function installEgir(battle, pid, bb, members) {
  const apply = () => {
    const mods = S.directMods({ hp: num(bb.base_max_hp, 0) + num(bb.max_hp_per_stack, 0) * S.bondLayers(battle, pid, 'egirShip') });
    for (const u of members) S.passiveBuff(battle, u, 'bond:egir', mods);
  };
  apply();
  onLayers(battle, pid, 'egirShip', apply);
  battle.on('battleStart', () => devour(battle, pid, bb, members), { once: true });
  if (!reached(battle, pid, 'egirShip', bb.power_bond_char_cnt)) return;
  // 5: "前3名【阿戈尔】干员首次被击倒时立刻复活" — PRTS: the knocked-out unit's next deployment has 0 redeploy time and
  // 0 cost, i.e. it IS knocked out (被击倒 triggers, 克莱门莎, 幽灵鲨 … fire) and redeploys at once where it lies (the
  // engine's rest tile, Battle._layBody: the tile it was knocked out on — a raid-relocated member comes back where it
  // fell —, or its own home when it fell on another board piece's home; PRTS 卫戍协议/帮助 §作战阶段 单位部署) with full
  // HP, SP reset and `deploy` effects (卡西米尔 / 叙拉古). Death priority 11: before 不屈 (10),
  // whose redeploy "also consumes a 复活 charge" — with this order the charge is always the one used, same outcome.
  // A member the battle-start devour knocks out spends a charge like any other first knock-out; the marks still pending
  // on it are cancelled (devour), so it stays standing.
  const memberSet = new Set(members);
  const max = Math.max(0, Math.floor(num(bb.max_free_respawn_cnt, 0)));
  const st = { knocked: new Set(), revives: 0 };
  battle.on('death', (c) => {
    const u = c.unit;
    if (c.reason !== 'killed' || !memberSet.has(u) || st.knocked.has(u)) return;
    st.knocked.add(u);
    if (st.revives >= max || u.alive || u.removed) return;
    if (!battle.redeploy(u, { free: true })) return;
    st.revives++;
    S.fxOn(battle, 'revive', u, 'bond:egirShip', 'respawn', { n: st.revives });
  }, { priority: 11 });
}

// =====================================================================================================================
// 叙拉古

function installSiracusa(battle, pid, bb, members) {
  const memberSet = new Set(members);
  const six = reached(battle, pid, 'siracusaShip', bb.power_bond_char_cnt);
  const end = num(bb.end_duration, 0);
  battle.on('deploy', ({ unit }) => {
    if (!memberSet.has(unit)) return;
    const L = S.bondLayers(battle, pid, 'siracusaShip');
    const dur = num(bb.base_duration, 0) + num(bb.duration_per_stack, 0) * L;
    if (!(dur > 0)) return;
    battle.addBuff(unit, { key: 'bond:siracusa', duration: dur, mods: { aspd: num(bb.base_attack_speed, 0) + num(bb.attack_speed_per_stack, 0) * L } });
    if (!six) return;
    unit.mem.siraStealthEnd = Infinity;
    const off = ({ unit: u }) => { u.mem.siraStealthEnd = battle.time; };
    battle.addBuff(unit, { key: 'bond:siracusa:stealth', duration: dur, flags: { stealth: true }, status: 'stealth', onExpire: off, onRemove: off });
  });
  if (!six) return;
  const c = prdConstant(num(bb.prob, 0));
  if (!(c > 0)) return;
  const st = { n: 0 };
  const onDmg = (ctx) => {
    const u = ctx.source, t = ctx.target, dmg = ctx.dmg;
    if (!dmg || !dmg.isAttack || dmg.isSplash || !isEnemyTarget(t) || ownTag(dmg, 'bond:siracusa')) return;
    const hidden = u.s.flags.stealth || battle.time <= num(u.mem.siraStealthEnd, -Infinity) + end + 1e-9;
    if (!hidden) return;
    st.n++;
    if (!(battle.rng() < Math.min(1, c * st.n))) return;
    st.n = 0;
    const amount = num(bb.base_damage, 0) + num(bb.damage_per_stack, 0) * S.bondLayers(battle, pid, 'siracusaShip');
    S.fxOn(battle, 'bondProc', t, 'bond:siracusaShip', 'assassin', { from: u.id, amount });
    if (amount > 0) battle.dealDamage(u, t, { amount, type: 'true', canDodge: false, tags: ['bond:siracusa'] });
    if (t.alive && num(bb.fear, 0) > 0) battle.applyStatus(t, 'fear', { duration: num(bb.fear, 0), source: u });
  };
  for (const u of members) onUnitDamaged(battle, u, onDmg);
}

// =====================================================================================================================
// 卡西米尔

function installKazimierz(battle, pid, bb, members) {
  const st = { deploys: 0 };
  const apply = () => {
    const cap = num(bb.base_max_atk_when_born, 0) + num(bb.max_atk_when_born_per_stack, 0) * S.bondLayers(battle, pid, 'kazimierzShip');
    const bonus = Math.max(0, Math.min(cap, st.deploys * num(bb.atk_when_born, 0)));
    if (!(bonus > 0)) return;
    for (const u of members) S.passiveBuff(battle, u, 'bond:kazimierz', S.directMods({ atk: bonus }));
  };
  battle.on('deploy', ({ unit }) => {
    if (!S.isOp(unit) || unit.ownerId !== pid) return;
    st.deploys++;
    apply();
  });
  onLayers(battle, pid, 'kazimierzShip', apply);
  if (!reached(battle, pid, 'kazimierzShip', bb.power_bond_char_cnt)) return;
  const iv = num(bb.damage_interval, 0), radius = num(bb.range_radius, 0), scale = num(bb.damage_atk_scale, 0), stun = num(bb.stun, 0);
  if (iv > 0 && scale > 0) {
    battle.every(iv, () => {
      for (const m of members) {
        if (!S.onField(m) || !m.blocking || !m.blocking.length) continue;
        const hits = battle.foesInRadius(m.x, m.y, radius);
        if (!hits.length) continue;
        const amount = scale * m.s.atk;
        for (const e of hits) {
          if (!e.alive) continue;
          battle.dealDamage(m, e, { amount, type: 'true', canDodge: false, isSplash: true, tags: ['bond:kazimierz'] });
          if (e.alive && stun > 0) battle.applyStatus(e, 'stun', { duration: stun, source: m });
        }
        S.fxOn(battle, 'aoe', m, 'bond:kazimierzShip', 'pulse', { radius, dmgType: 'true', n: hits.length });
      }
    });
  }
  const pure = num(bb.pure_atk_scale, 0);
  if (!(pure > 0)) return;
  const onDmg = (ctx) => {
    const u = ctx.source, t = ctx.target, dmg = ctx.dmg;
    if (!dmg || !dmg.isAttack || !isEnemyTarget(t) || ownTag(dmg, 'bond:kazimierz')) return;
    if (u.blocking && u.blocking.length) return;
    battle.dealDamage(u, t, { amount: pure * u.s.atk, type: 'true', canDodge: false, tags: ['bond:kazimierz'] });
  };
  for (const u of members) onUnitDamaged(battle, u, onDmg);
}

// =====================================================================================================================
// entry points

const INSTALLERS = Object.freeze({
  yanShip: installYan,
  sargonShip: installSargon,
  victoriaShip: installVictoria,
  kjeragShip: installKjerag,
  lateranoShip: installLaterano,
  egirShip: installEgir,
  siracusaShip: installSiracusa,
  kazimierzShip: installKazimierz,
});

export function install(battle) {
  if (!battle || !Array.isArray(battle.players)) return;
  for (const p of battle.players) {
    const pid = p.playerId;
    if (!p.bonds || typeof p.bonds !== 'object') continue;
    for (const [bondId, fn] of Object.entries(INSTALLERS)) {
      if (!S.bondActive(battle, pid, bondId)) continue;
      const bb = bondBb(bondId);
      if (!bb) continue;
      const members = S.bondMembers(battle, pid, bondId);
      if (!members.length) continue;
      fn(battle, pid, bb, members);
    }
  }
}

/**
 * 维多利亚 hammer milestones: every `layer` layers pay `count` item(s) of `pool` once (counter = milestones paid).
 * A bond effect, so it pays only while 维多利亚 is active (official tip "叠加的盟约…只有在盟约被激活时才会发挥作用");
 * milestones crossed while it was inactive ("无需激活" sources such as 烛煌) are paid the next time a hook sees it active
 * (research 02 §3.3 / §8 Q7: the payout counts layers added while inactive) — same rule as 远见 / 奇迹 (addon/meta.js).
 */
export function payHammers(ctx) {
  if (!ctx.bondActive('victoriaShip')) return 0;
  const p = S.buffParams(ctx.data?.bonds?.victoriaShip ?? S.bondRecord('victoriaShip'), VICTORIA_REWARD_KEY);
  const step = Math.floor(num(p?.layer, 0));
  if (!p || !(step > 0)) return 0;
  const due = Math.floor(ctx.layers('victoriaShip') / step);
  const count = Math.max(0, Math.floor(num(p.count, 1)));
  let granted = 0;
  // re-read the counter every milestone: grantItem dispatches onGain, which re-enters this function (nested payments
  // must not be paid twice by the outer loop)
  for (let guard = 0; guard < 100; guard++) {
    const paid = ctx.counter(VICTORIA_COUNTER);
    if (paid >= due) break;
    ctx.setCounter(VICTORIA_COUNTER, paid + 1);
    for (let i = 0; i < count; i++) {
      const id = ctx.rollItem({ pool: p.pool });
      if (id && ctx.grantItem(id, { source: 'bond:victoriaShip' })) granted++;
    }
  }
  if (granted && typeof ctx.toast === 'function') ctx.toast('【维多利亚】获得{0}件维式重锤', 'info', [granted]);
  return granted;
}

/** Hooks on which owed hammers are (caught up and) paid; onLayers only for 维多利亚's own gains. */
const HAMMER_HOOKS = Object.freeze(['onLayers', 'onRoundStart', 'onPrepStart', 'onPrepEnd', 'onBuy', 'onGain', 'onSold', 'onMerge']);

export function registerMeta(registry) {
  const prev = typeof registry.get === 'function' ? registry.get('bond:victoriaShip') : null;
  const handler = { ...(prev || {}) };
  for (const hook of HAMMER_HOOKS) {
    const before = prev && typeof prev[hook] === 'function' ? prev[hook] : null;
    handler[hook] = function hammers(ctx, ev) {
      if (before) before.call(this, ctx, ev);
      if (hook === 'onLayers' && !(ev && ev.bondId === 'victoriaShip')) return;
      payHammers(ctx);
    };
  }
  registry.bond('victoriaShip', handler);
}
