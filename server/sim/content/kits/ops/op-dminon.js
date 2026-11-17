// server/sim/content/kits/ops/op-dminon.js — 国度 (char_4246_dminon) 自选 operator kit: 6★ 伏击客 (特种), an owned-6★ pick
// of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and the module AMB-X “空瓶罐们” at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4246_dminon): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7,
// AMB-X at stage 1 (tier 5: its stats and trait addition) or 3 (tier 6: also 实质坍缩 −20 / 20 %) — the owner's decision
// of 2026-10-05; the player's potential (此身为界 600 % from 潜能 5, 500 % below: the composed record). Sources:
// character_table / skill_table / battle_equip_table (zh_CN 2.7.91, as built into backups.json) and PRTS 国度
// (https://prts.wiki/w/国度 oldid 447273: the 备注 of both talents and the three skills, the 此身为界 修正 撤退 → 离场).
// - The field “国度”: every 国度 spreads it over the tiles of his current attack range (实质坍缩 "自身攻击范围内弥漫“国度”":
//   y-1, S2's y-3, S3's y-10 and its spread tiles, any 攻击距离 bonus) while he is on the field. PRTS: "所有“国度”在不同
//   国度(干员)之间通用，但可以分别弥漫" — the 国度 is the union of the fields of every 国度 on the field (two players of a
//   pair field) — and "自身弥漫的“国度”于离场后清除（无需解锁第二天赋）" — his part goes the moment he leaves. A unit is on
//   it by the tile rule (格子判定: the tile of its position, a huge enemy's rectangle — Battle.enemiesOnTiles, body.js
//   bodyInKeys) [ASSUMED: a field laid on tiles, PRTS "对目标所在格及其周围四格弥漫“国度”"], so an enemy whose collider only
//   reaches a range tile is struck by his attacks but is not on the 国度; the field's effects select like any selector (no
//   隐匿 / untargetable enemy) [ASSUMED].
// - Trait (伏击客) "对攻击范围内所有敌人造成伤害；拥有50%的物理和法术闪避且不容易成为敌人的攻击目标": the stalker profile —
//   every enemy of his range at once, melee, ground only, physical — and 50 % physical / arts dodge (trait bb prob). The
//   taunt level −1 is in his stats (PRTS 伏击客 "嘲讽等级为-1"): the kit trait installs the dodge without the profile's
//   second −1, as op-ascln.js. AMB-X adds "攻击范围内所有敌人移动速度-20%" (hidden talent move_speed): every enemy of his
//   current range (air units too) moves ×(1 + move_speed), one slow per 国度 — "多个伏击客X模组之间的减速效果可叠加" (PRTS,
//   as op-ascln.js).
// - T1 实质坍缩 (bb attack_speed / atk_scale; AMB-X stage 3: −20 / 20 %): ground enemies on the 国度 have ASPD +attack_speed,
//   held every tick while they stand on it [ASSUMED: a continuous field], one cut whoever spreads the field — PRTS "攻击速度
//   降低效果不可叠加": the strongest of the 国度 on the field [ASSUMED: strongest]. "每秒受到攻击力13%的法术伤害": PRTS
//   "自身每隔1秒对所有处于“国度”内的单位造成法术普通伤害" and "此天赋也会对其他国度(干员)的“国度”内的敌人造成伤害" — each 国度
//   on his own 1 s clock from his deployment (the first 1 s after it [ASSUMED]) deals atk_scale × his ATK as arts damage
//   (普通伤害: attack type NORMAL, dodgeable, not a skill) to every ground enemy on the 国度, while stunned too [ASSUMED].
// - T2 此身为界 (bb atk_scale / stun): PRTS 修正 "自身离场时" and 备注 "因任何原因离场均可触发此天赋，但如果是因“被击倒”而离场，
//   则会延迟0.7秒产生伤害" / "依靠弹道存储触发天赋时的攻击力（缓存攻击力）与场上的“国度”状态，因此处于三技能期间离场时此天赋
//   可享受攻击力加成与“国度”扩大增益": every removal of his (the `death` hook: a knock-out — 0.7 s later —, a 撤退 or forced
//   exit — at once [ASSUMED: no flight time] —, the 突袭 jump, which is a retreat and a redeploy [ASSUMED: a 离场]; the end of
//   a battle is none [ASSUMED]) deals atk_scale × the ATK he had as he left, as arts damage, and stuns `stun` s every
//   ground enemy standing, when it lands, on the 国度 as it was — his field then (S2 / S3 range, spread tiles) and the other
//   国度's —; the damage first, the stun on those it leaves alive [ASSUMED]. "随后所有“国度”消失": his own field is gone at
//   once (PRTS above) and the S1 marks with it; another 国度 keeps spreading his own over his range [ASSUMED]. The cache:
//   the knock-out (`kill` hook) or the running skill's end (its onEnd runs before the buffs are dropped) give the exact
//   state, else the state at the end of the last tick.
// - S1 停步 (MANUAL, data DEFAULT, 20 s; bb attack_speed / sluggish): ASPD +attack_speed; PRTS "“首次踏上”的实现方式为每隔？帧
//   对“国度”上所有不持有自身的【停步标记】的目标施加停顿与【停步标记】Buff" / "自身施加的【停步标记】持续直至自身离场或自身技能
//   结束。不同国度(干员)的【停步标记】互不干扰": every tick [ASSUMED: the frame count is unknown] each enemy on the 国度 without
//   his mark — air units too [ASSUMED: the text says 每个敌人, unlike the talents] — gets 停顿 (the catalogue `sluggish`,
//   `sluggish` s) and his mark, which goes when the skill ends or he leaves.
// - S2 受戮 (MANUAL, data ACTIVE_RANGE on its y-3, 20 s): range y-3, ATK +atk; PRTS "“无法闪避”的机制为令影响对象受到的所有
//   物理/法术伤害无法因闪避取消": every physical / arts damage instance an enemy on the 国度 takes (air units too, whoever
//   deals it) carries the 'dodge' cancellation mask while it runs. "第二次及以后使用时额外使攻击速度+30，且持续时间无限": from
//   the second cast of a deployment [ASSUMED: counted per deployment, as 提丰's S2 — PRTS 提丰 "每次部署提丰时，重新计算该技能
//   的使用次数"] ASPD +attack_speed and no end (a toggle the kit ends after `duration` s on the first cast, as op-typhon.js).
// - S3 无人的国度 (MANUAL, data ACTIVE_RANGE on its y-10, 36 s; bb atk / attack_speed / attack@aoe_atk_scale / attack@cd):
//   range y-10, ATK +atk, ASPD +attack_speed. "同时攻击“国度”上的所有敌人": the enemies on another 国度's field join each of
//   his attacks (his own field is his range already) — they start none [ASSUMED: "同时"], ground only like his attacks
//   [ASSUMED: no 可对空 note]. PRTS "技能期间每隔0.15秒向“国度”上的我方单位施加以下Buff（光环效果）：当该单位受到来源于行动类型为
//   地面、不处于消失状态的敌人类单位（不考虑阵营）的伤害时，尝试让施加此效果的国度(干员)向伤害来源扩散国度" and "自身的扩散国度的
//   效果存在0.5秒触发冷却，每次扩散时会对目标所在格及其周围四格(x-5 range)弥漫“国度”，并同步“扩大”自身的攻击范围": every 0.15 s
//   the allies on the 国度 get his buff (it lapses 2 ticks after the next pulse would refresh it [ASSUMED]); every enemy damage
//   instance it observes (the ON_TAKE_DAMAGE convention: tier1 byEnemyDamage, a dodged one too — PRTS 伤判效果 "绝大部分效果
//   （例如反伤、受伤计数等）仍可处理") from a ground (not an air unit: targeting.js evadesGround's 行动方式), visible enemy
//   spreads his field — once per attack@cd s — to the source's tile and its four neighbours, which join his attack range
//   (Battle.setExtraRange), and deals attack@aoe_atk_scale × his ATK physical to every enemy standing on those five tiles
//   (the tile rule of the field it lays) [ASSUMED: the aoe key ⇒ the spread area; air units too, no 对空 note].
//   "技能结束时重置自身的“国度”状态回等同于自身的攻击范围": the
//   spread tiles go at its end (after 此身为界 cached them when he leaves).

import { num, talentBb, moduleBb, traitBb, skillRec, up, byEnemyDamage } from '../shared/tier1.js';
import { absoluteRangeKeys, canTargetEnemy } from '../../../targeting.js';
import { bodyInKeys } from '../../../body.js';
import { TICK, COLS } from '../../../constants.js';
import { roundHalfEven } from '../../../detmath.js';

const S1 = 'skchr_dminon_1';
const S2 = 'skchr_dminon_2';
const S3 = 'skchr_dminon_3';
/** 此身为界 "如果是因“被击倒”而离场，则会延迟0.7秒产生伤害" (PRTS 备注; no blackboard key). */
export const KO_DELAY = 0.7;
/** 实质坍缩's damage period: "自身每隔1秒…造成法术普通伤害" (PRTS 备注; the text's 每秒). */
export const COLLAPSE_IV = 1;
/** S3's buff on the allies on the 国度: "每隔0.15秒…施加…（光环效果）" (PRTS 备注). */
export const S3_AURA_IV = 0.15;
/** Its lifetime: past the next pulse (4–5 ticks later) by 2 ticks [ASSUMED]. */
const S3_AURA_DUR = S3_AURA_IV + 2 * TICK;
/** The ASPD cut, held every tick: it outlives one tick and lapses in the next (as tier1 PROTECT_TICK_HOLD). */
const HOLD = 1.5 * TICK;
/** The 国度 on screen: his field's tiles in a 'domain' fx this often (render/fx/zones.js domainField, as “邪魔的利刃”'s). */
const DOMAIN_FX_IV = 0.5;
/** AMB-X slow: the kits' range-aura period / lifetime (as op-ascln.js). */
const AURA_IV = 0.25;
const AURA_DUR = 0.4;
/** 此身为界 reads its cache before the 复活 handlers (13 … 10) may redeploy him inside the same `death` hook. */
const DEATH_PRIORITY = 20;
/** S2's cancellation mask goes on before any content's own dodge roll in a `hit` hook. */
const NO_DODGE_PRIORITY = 400;
/** S3's spread: "目标所在格及其周围四格(x-5 range)" (PRTS; offsets — the direction does not matter). */
const X5 = Object.freeze([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]);
const GROUND = Object.freeze({ canHitFly: false });
const ANY = Object.freeze({ canHitFly: true });

/** The ASPD cut on an enemy (one whoever spreads the field: battle.applyStrongest) and the tag of his talent damage. */
export const COLLAPSE = 'dminon:collapse';
export const BOUNDARY_TAG = 'dminon:boundary';
export const SPREAD_TAG = 'dminon:spread';
const S2_ASPD = 'dminon:s2:aspd';
/** S1's 【停步标记】 of `u` on an enemy. */
export const haltKey = (u) => `dminon:halt#${u.id}`;
/** S3's buff of `u` on an ally standing on the 国度. */
export const guardKey = (u) => `dminon:s3#${u.id}`;
/** AMB-X's slow of `u` on an enemy. */
export const ambxKey = (u) => `dminon:ambx#${u.id}`;

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const skillOn = (u, id) => !!(u.skill && u.skill.active && u.skill.id === id);
const aspdMods = (v) => ({ aspd: -v });

// ---- the shared field ------------------------------------------------------------------------------------------------
/** battle → the 国度 of the battle, in setup order: [{ unit, aspd }] (aspd = his 实质坍缩 cut, positive). */
const DOMS = new WeakMap();
const domsOf = (battle) => DOMS.get(battle) ?? [];

function register(battle, unit, aspd) {
  let list = DOMS.get(battle);
  if (!list) DOMS.set(battle, (list = []));
  if (!list.some((d) => d.unit === unit)) list.push({ unit, aspd });
}

/**
 * The tiles of the 国度 now: the range tiles of every 国度 on the field — an array (Battle.enemiesOnTiles reads it by index);
 * one 国度's own `rangeKeys` when he is the only one.
 */
export function fieldKeys(battle) {
  let one = null, many = null;
  for (const { unit } of domsOf(battle)) {
    if (!up(unit) || !unit.rangeKeys) continue;
    if (!one) { one = unit.rangeKeys; continue; }
    if (!many) many = new Set(one);
    for (const k of unit.rangeKeys) many.add(k);
  }
  return many ? [...many] : (one ?? []);
}

/** Does `x` (an enemy or an ally) stand on the 国度 now — the tile of its position (a huge enemy: its rectangle)? */
export function onField(battle, x) {
  for (const { unit } of domsOf(battle)) if (up(unit) && unit.rangeKeySet && bodyInKeys(x, unit.rangeKeySet)) return true;
  return false;
}

/**
 * The enemies `unit` can select (`profile`) standing on `tiles` now — the tile rule (bodyInKeys) by their position this
 * instant —, for the effects that may run in the enemy phase (an enemy's hit, a removal), where the per-tick tile index
 * of Battle.enemiesOnTiles still holds the previous tick's positions.
 */
function foesNow(battle, unit, tiles, profile) {
  const set = new Set(tiles);
  return battle.enemies.filter((e) => e.alive && e.deployed && !e.hidden && bodyInKeys(e, set) && canTargetEnemy(unit, e, profile));
}

// ---- 此身为界's cache ----------------------------------------------------------------------------------------------------
/** His ATK and his field now (the arrays the engine replaces on every range rebuild: a reference is a snapshot). */
function cacheLeave(unit) {
  const c = unit.mem.dminonLeave ?? (unit.mem.dminonLeave = { seq: 0, atk: 0, keys: null });
  c.seq = unit.deploySeq;
  c.atk = unit.s.atk;
  c.keys = unit.rangeKeys;
}

/** 此身为界 lands: `atk` × atk_scale arts and the stun on every ground enemy standing on `tiles`. */
function boundary(battle, unit, atk, tiles, tb) {
  const scale = num(tb.atk_scale), stun = num(tb.stun);
  battle.fx('aoe', { x: unit.x, y: unit.y, id: unit.id, skill: BOUNDARY_TAG });
  for (const e of foesNow(battle, unit, tiles, GROUND)) {
    if (scale > 0) battle.dealDamage({ source: unit, target: e, amount: atk * scale, type: 'arts', tags: ['talent', BOUNDARY_TAG] });
    if (stun > 0 && e.alive) battle.applyStatus(e, 'stun', { duration: stun, source: unit });
  }
}

// ---- S1 / S3 ---------------------------------------------------------------------------------------------------------
/** S1: every enemy on the 国度 without his mark — 停顿 `dur` s and the mark. */
function halt(battle, unit, dur) {
  const key = haltKey(unit);
  for (const e of battle.enemiesOnTiles(fieldKeys(battle), unit, ANY)) {
    if (e.findBuff(key)) continue;
    battle.addBuff(e, { key, source: unit, tags: ['skill'] });
    if (dur > 0) battle.applyStatus(e, 'sluggish', { duration: dur, source: unit });
  }
}

/** S3: spread his field to the tile of `src` and its four neighbours (cooldown `cd`), `scale` × ATK physical on them. */
function spread(battle, unit, src, cd, scale) {
  if (!up(unit) || !skillOn(unit, S3)) return;
  const m = unit.mem;
  if (battle.time < (m.dminonSpreadAt ?? -Infinity) - 1e-9) return;
  m.dminonSpreadAt = battle.time + cd;
  const tiles = absoluteRangeKeys(X5, roundHalfEven(src.y), roundHalfEven(src.x), 'RIGHT', 0);
  const own = m.dminonSpread ?? (m.dminonSpread = []);
  const before = own.length;
  for (const k of tiles) if (!own.includes(k)) own.push(k);
  if (own.length > before) battle.setExtraRange(unit, own);
  battle.fx('aoe', { x: src.x, y: src.y, radius: 1, id: unit.id, skill: SPREAD_TAG });
  if (!(scale > 0)) return;
  for (const e of foesNow(battle, unit, tiles, ANY)) {
    battle.dealDamage({ source: unit, target: e, amount: unit.s.atk * scale, type: 'phys', isSkill: true, tags: ['skill', SPREAD_TAG] });
  }
}

export default {
  char_4246_dminon: (bb, chess) => {
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const hidden = moduleBb(chess);
    const dodge = num(traitBb(chess).prob, 0.5);
    const picked = chess?.skill?.skillId ?? null;
    const grid = (rec) => (rec?.rangeGrid ? { rangeGrid: rec.rangeGrid.map((p) => [p[0], p[1]]) } : undefined);
    const cd = num(b3['attack@cd'], 0.5), aoe = num(b3['attack@aoe_atk_scale']);

    // S3: his buff on the allies on the 国度 — its injury observer (one per 国度, kept by the buff's 'extend' refresh) spreads
    // his field towards a ground enemy that damages its holder
    const guard = (battle, unit) => {
      if (!up(unit) || !skillOn(unit, S3)) return;
      const observeInjury = unit.mem.dminonObserve ??= (ctx) => {
        const src = ctx.source;
        if (!byEnemyDamage(ctx) || !src.alive || src.hidden || src.isFlying) return;
        spread(ctx.battle, unit, src, cd, aoe);
      };
      const key = guardKey(unit);
      for (const a of battle.allyUnits) {
        if (!a.alive || !a.deployed || a.hidden || a.kind === 'device' || !battle.allySelectable(a, unit) || !onField(battle, a)) continue;
        battle.addBuff(a, { key, duration: S3_AURA_DUR, refresh: 'extend', source: unit, tags: ['skill'], observeInjury });
      }
    };

    return {
      trait: {
        // 伏击客: the dodge; the taunt level −1 is in his stats (no second −1)
        install(battle, unit) {
          const p = num(unit.profile?.dodge, dodge);
          if (p > 0) battle.addBuff(unit, { key: 'trait:stalker', mods: { dodgePhys: p, dodgeArts: p }, persist: true, allowDead: true });
        },
      },
      skills: {
        [S1]: {
          kind: 'duration',
          mods: { aspd: num(b1.attack_speed) },
          onStart({ battle, unit }) { halt(battle, unit, num(b1.sluggish)); },
          onTick({ battle, unit }) { halt(battle, unit, num(b1.sluggish)); },
          onEnd({ battle, unit, reason }) {
            if (reason === 'death') cacheLeave(unit);
            const key = haltKey(unit);
            for (const e of battle.enemies) if (e.findBuff(key)) battle.removeBuff(e, key);
          },
        },
        [S2]: {
          kind: 'toggle',
          mods: { atkPct: num(b2.atk) },
          targeting: grid(s2),
          onStart({ battle, unit, skill }) {
            unit.mem.dminonS2Uses = (unit.mem.dminonS2Uses ?? 0) + 1;
            const later = unit.mem.dminonS2Uses > 1;
            skill.timeLeft = later ? Infinity : Math.max(0.01, skill.duration);
            if (later && num(b2.attack_speed)) battle.addBuff(unit, { key: S2_ASPD, mods: { aspd: num(b2.attack_speed) }, tags: ['skill'] });
          },
          onTick({ skill, dt }) {
            if (!Number.isFinite(skill.timeLeft)) return;
            skill.timeLeft -= dt;
            if (skill.timeLeft <= 1e-9) skill.end('duration');
          },
          onEnd({ battle, unit, reason }) {
            if (reason === 'death') cacheLeave(unit);
            battle.removeBuff(unit, S2_ASPD);
          },
        },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk), aspd: num(b3.attack_speed) },
          targeting: grid(s3),
          onStart({ battle, unit }) {
            unit.mem.dminonSpread = [];
            unit.mem.dminonSpreadAt = -Infinity;
            unit.mem.dminonGuard?.cancel();
            unit.mem.dminonGuard = battle.every(S3_AURA_IV, () => guard(battle, unit), { owner: unit, immediate: true });
          },
          onEnd({ battle, unit, reason }) {
            if (reason === 'death') cacheLeave(unit);   // 此身为界 keeps the expanded field
            unit.mem.dminonGuard?.cancel();
            unit.mem.dminonGuard = null;
            const key = guardKey(unit);
            for (const a of battle.allyUnits) if (a.findBuff(key)) battle.removeBuff(a, key);
            unit.mem.dminonSpread = null;
            battle.setExtraRange(unit, null);
          },
        },
      },
      talents: [
        { install(battle, unit) { // 实质坍缩: the field's ASPD cut and its damage
          const scale = num(t0.atk_scale);
          register(battle, unit, Math.abs(num(t0.attack_speed)));
          // the field on screen (no gameplay part): his tiles every DOMAIN_FX_IV s, fading once he has left
          battle.every(DOMAIN_FX_IV, () => {
            if (!up(unit) || !unit.rangeKeys?.length) return;
            const tiles = unit.rangeKeys.map((k) => [Math.floor(k / COLS), k % COLS]);
            battle.fx('domain', { x: unit.x, y: unit.y, id: unit.id, key: `domain:${unit.id}`, tiles, dur: 1.5 * DOMAIN_FX_IV });
          }, { owner: unit, immediate: true });
          battle.on('tick', () => {
            if (!up(unit)) return;
            cacheLeave(unit);
            // the cut: the first 国度 on the field holds it, with the strongest value of those on the field
            let first = null, v = 0;
            for (const d of domsOf(battle)) if (up(d.unit)) { first ??= d.unit; if (d.aspd > v) v = d.aspd; }
            if (first !== unit || !(v > 0)) return;
            for (const e of battle.enemiesOnTiles(fieldKeys(battle), unit, GROUND)) {
              battle.applyStrongest(e, COLLAPSE, { duration: HOLD, value: v, mods: aspdMods, source: unit });
            }
          }, { owner: unit });
          // the damage: his own 1 s clock from each deployment, on every ground enemy of the 国度
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== unit) return;
            unit.mem.dminonClock?.cancel();
            unit.mem.dminonClock = !(scale > 0) ? null : battle.every(COLLAPSE_IV, () => {
              if (!up(unit)) return;
              const amount = unit.s.atk * scale;
              for (const e of battle.enemiesOnTiles(fieldKeys(battle), unit, GROUND)) {
                battle.dealDamage({ source: unit, target: e, amount, type: 'arts', tags: ['talent', COLLAPSE] });
              }
            }, { owner: unit });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 此身为界: on every removal, the cached ATK on the 国度 as it was
          battle.on('kill', (ctx) => { if (ctx.victim === unit && unit.alive) cacheLeave(unit); }, { owner: unit });
          battle.on('death', (ctx) => {
            if (ctx.unit !== unit) return;
            const c = unit.mem.dminonLeave;
            const fresh = !!c && c.seq === unit.deploySeq;
            const atk = fresh ? c.atk : unit.s.atk;
            const tiles = new Set(fresh && c.keys ? c.keys : (unit.rangeKeys ?? []));
            for (const { unit: o } of domsOf(battle)) if (o !== unit && up(o) && o.rangeKeys) for (const k of o.rangeKeys) tiles.add(k);
            const keys = [...tiles];
            if (ctx.reason === 'killed') battle.after(KO_DELAY, () => boundary(battle, unit, atk, keys, t1), { owner: unit });
            else boundary(battle, unit, atk, keys, t1);
          }, { owner: unit, priority: DEATH_PRIORITY });
        } },
      ],
      install(battle, unit) {
        // the uses of S2 are counted per deployment
        battle.on('deploy', (ctx) => { if (ctx.unit === unit) unit.mem.dminonS2Uses = 0; }, { owner: unit });
        // AMB-X: every enemy of his range moves ×(1 + move_speed) (one slow per 国度: they stack)
        const mx = num(hidden.move_speed);
        if (mx < 0) {
          const key = ambxKey(unit);
          battle.every(AURA_IV, () => {
            if (!up(unit)) return;
            for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, ANY)) {
              battle.addBuff(e, { key, duration: AURA_DUR, mods: { moveMul: Math.max(0, 1 + mx) }, source: unit, tags: ['module'] });
            }
          }, { owner: unit, immediate: true });
        }
        if (picked === S2) {
          // 受戮: no phys / arts damage instance an enemy on the 国度 takes is cancelled by a dodge while it runs
          battle.on('hit', (ctx) => {
            const d = ctx.dmg, e = ctx.target;
            if (!d || !e || e.side !== 'enemy' || (d.type !== 'phys' && d.type !== 'arts') || !up(unit) || !skillOn(unit, S2)) return;
            if (d.ignoreCancelReasons?.includes('dodge') || !onField(battle, e)) return;
            d.ignoreCancelReasons = [...(d.ignoreCancelReasons ?? []), 'dodge'];
          }, { owner: unit, priority: NO_DODGE_PRIORITY });
        }
        if (picked === S3) {
          // 同时攻击“国度”上的所有敌人: the ground enemies on another 国度's field join his attack
          battle.on('beforeAttack', (ctx) => {
            if (ctx.attacker !== unit || !up(unit) || !skillOn(unit, S3)) return;
            const keys = fieldKeys(battle);
            if (keys === unit.rangeKeys) return;
            const have = new Set(ctx.targets);
            const add = battle.enemiesOnTiles(keys, unit, ctx.profile ?? unit.profile).filter((e) => !have.has(e));
            if (add.length) ctx.targets = ctx.targets.concat(add);
          }, { owner: unit });
        }
      },
    };
  },
};
