// server/sim/content/enemies/special.js — SPECIAL 特异 kits (prisoners, 穿刺手, 暴虐兵长, 镜卫, chimeras, 圣杯, the act-2 specials
// …) and their part of KITS (split from content/enemies.js).

import { ALLY_COLLIDER_RADIUS } from '../../constants.js';
import { canTargetAlly, areaSelectable } from '../../targeting.js';
import { periodicDamage } from '../../attack.js';
import {
  BOOM_RADIUS, nthOf, stOf, T, elem, hurt, targetsNear, allTargets, areaAllies, areaAlliesInTiles, byPriority,
  stayRoute, spawnChildren, expose, auraBuff, watchDeaths, onTerrain, castSlot, grantHitShield, attackSkillOf,
} from './helpers.js';
import {
  unblockable, runWhenHit, blockWeight, taunt, maxTargets, ep, nthAttackPower, lowHpBuff, deathBoom, setFloat, float,
  reborn, frontGuard, unbalanced, skill, kitEp, kitPrisoner, kitStun3,
} from './archetypes.js';
import { hypot } from '../../detmath.js';
import { passengerBus } from './passengers.js';
import { boundedCount, PLUGIN_TIMES_MAX } from '../../../../shared/plugins/limits.js';
import { bbCap } from '../../../../shared/plugins/officialBounds.js';
import { stepOf, STEP_PER_TICK } from '../../../../shared/plugins/steps.js';

// ---------------------------------------------------------------------------------------------------------------
// constants (numbers that exist nowhere in the data)

/** 孽罪奇美拉 污染模式 aura (PRTS 天赋 "自身半径1.2范围内的所有单位…每0.5秒受到50真实持续伤害（同类效果取最高）"): radius,
 *  damage period (s). */
const CHIMERA_AURA_RADIUS = 1.2, CHIMERA_AURA_EVERY = 0.5;

/** 自行炮 Cannon (PRTS 高准度伦蒂尼姆城防自行炮 技能 "以攻击范围内生命上限最高的我方单位为中心，生成9格的炮击区域，6s内每0.5s对炮击
 *  区域中生命比例最高的我方单位进行攻击…(最多进行10次攻击)"): shot interval (s), shot cap; 3 shots 1 s apart [ASSUMED] until
 *  0.1.1. 备注: during the skill animation 失衡免疫 + 晕眩 / 冻结 / 浮空 / 沉睡免疫 — held over the bombardment [ASSUMED length]. */
const CANNON_EVERY = 0.5, CANNON_SHOTS = 10;

const CANNON_IMMUNE = Object.freeze(['stun', 'freeze', 'cold', 'levitate', 'sleep']);

/** Radius of 骸骨拷打者's "周围" death sensing when its talent has no Attack.range_radius [ASSUMED]. */
const TORTURER_RADIUS = 1;

/** Barrel zone radius of 咸鳞汁推荐者 [ASSUMED]. */
const BARREL_RADIUS = 1.5;

// ---------------------------------------------------------------------------------------------------------------
// kits

/** 源石污染区 (act1 m04 infection tiles). */
function infectionArts() {
  return { hitOut(c, b, e) { if (c.dmg.isAttack && onTerrain(b, e, 'infection')) c.dmg.type = 'arts'; } };
}

function kitChimera(ab) {
  const dmg = T(ab, 'OrigAura.damage') ?? 0, spr = T(ab, 'OrigAura.sp_recover_ratio') ?? 0;
  const activate = (b, e, a) => {
    if (a.on || !onTerrain(b, e, 'infection')) return;
    a.on = true;
    e.mem.ab.atkType = 'arts';
    castSlot(b, e, ab.sk.triggerAnim);   // its activation (triggerAnim): the skill slot for the client, display only
    b.fx('telegraph', { x: e.x, y: e.y, r: CHIMERA_AURA_RADIUS, kind: 'chimera', id: e.id });
  };
  return [{
    hitOut(c, b, e, a) { if (c.dmg.isAttack && !a.on) { activate(b, e, a); if (a.on) c.dmg.type = 'arts'; } },
    iv: 0.25,
    tick(b, e, a) {
      activate(b, e, a);
      if (!a.on) return;
      a.acc = (a.acc ?? 0) + 0.25;
      const pulse = a.acc >= CHIMERA_AURA_EVERY - 1e-9;
      if (pulse) a.acc -= CHIMERA_AURA_EVERY;
      for (const u of b.alliesInRadius(e.x, e.y, CHIMERA_AURA_RADIUS)) {
        auraBuff(b, u, 'ab:originium', 0.25, { spRecoveryMul: Math.max(0, 1 + spr) }, null, true);
        // PRTS "持续视为受到源石污染区影响…每0.5秒受到50真实持续伤害": a damage instance (受击回复, the 重装 trigger), not a
        // 流失 — 无来源 like the 源石污染区 terrain it stands for [ASSUMED], the chimera keeps the credit; "同类效果取最高": one
        // tick per unit per period however many chimeras reach it (`mem.chimeraAt`; every chimera's is 50). A terrain
        // effect, not an area selection: 隐匿 allies inside are reached too ("所有单位" [ASSUMED], DESIGN §22.12)
        if (!pulse || !(dmg > 0) || b.time - (u.mem.chimeraAt ?? -Infinity) < CHIMERA_AURA_EVERY - 1e-6) continue;
        u.mem.chimeraAt = b.time;
        b.dealDamage(e, u, { ...periodicDamage(dmg), tags: ['dot', 'pollution'] });
      }
    },
  }];
}

function kitNazg(ab, e) {
  const r = (e.def.raw && e.def.raw.stats && e.def.raw.stats.rawRangeRadius) || e.base.rangeRadius || 1.3;
  return [{
    before(c, b, e2) {
      const l = targetsNear(b, e2, r);
      if (onTerrain(b, e2, 'infection')) for (const u of b.allies()) if (!l.includes(u) && onTerrain(b, u, 'infection') && canTargetAlly(e2, u, true)) l.push(u);
      if (l.length) c.targets = byPriority(e2, l);
    },
  }];
}

/** 吉兆飞鳞 【失温坠落】: the stun when a freeze ends (PRTS "冻结结束时，获得0.05秒晕眩"). */
const PARROT_CHILL_STUN = 0.05;

/**
 * 吉兆飞鳞 (PRTS): 近地悬浮 (失衡免疫), no normal attack; 受晕眩/无法行动/沉睡/缚地影响后进入晕眩模式 — the float is off, it
 * cannot be blocked and is stunned `Stun.duration` (8) s — and floats again once none of those effects holds it
 * (初始模式); 冻结 grounds it only when the freeze ends (【失温坠落】: 0.05 s stun). 首次受到伤害后 its speed is ×
 * `M0SpeedUp.move_speed` for `M0SpeedUp.duration` s ("最终提升至300%"; never in 晕眩模式, dropped when its mode
 * changes). 搬运模式 (carrying a 寻险水手) needs a level checkpoint (`ThrowEnemy.checkpoint` 0 = never) — not in this mode.
 */
function kitParrot(ab) {
  const down = T(ab, 'Stun.duration') ?? 0;
  return [float(), {
    taken(c, b, e, a) {
      if (a.ran || a.down) return;
      a.ran = true;
      b.addBuff(e, { key: 'ab:parrotRun', duration: T(ab, 'M0SpeedUp.duration') ?? 0, mods: { moveMul: T(ab, 'M0SpeedUp.move_speed') ?? 1 } });
    },
    status(c, b, e, a) {
      if (c.status === 'freeze') { a.chill = true; return; }
      if (a.down || !(c.status === 'stun' || c.status === 'sleep' || c.status === 'groundbind')) return;
      a.down = true;
      setFloat(b, e, false);
      b.removeBuff(e, 'ab:parrotRun');
      b.addBuff(e, { key: 'ab:parrotDown', flags: { unblockable: true }, persist: true });
      if (down > 0) b.applyStatus(e, 'stun', { duration: down, source: null });
      b.fx('phase', { x: e.x, y: e.y, id: e.id, kind: 'grounded' });
    },
    tick(b, e, a) {
      if (a.chill && !e.s.flags.freeze) { a.chill = false; b.applyStatus(e, 'stun', { duration: PARROT_CHILL_STUN, source: null }); }
      // "离开上述异常效果影响后进入初始模式": s.flags.stun also holds while asleep / frozen (units.js), so a sleep that
      // outlasts the mode stun keeps it down; so does a 缚地 (flag `groundbind`)
      if (a.down && !e.s.flags.stun && !e.s.flags.groundbind) {
        a.down = false;
        b.removeBuff(e, 'ab:parrotDown');
        b.removeBuff(e, 'ab:parrotRun');
        setFloat(b, e, true);
        b.fx('phase', { x: e.x, y: e.y, id: e.id, kind: 'float' });
      }
    },
  }];
}

/**
 * 萨卡兹穿刺手 (PRTS 天赋; the battle prefab's Rush / FirstAttack abilities — templates dlancer_t_listener[a] / [b] / [c],
 * dlancer_t[trigger], dlancer_t_atk): every RUSH_LISTEN (0.1) s — 晕眩 (STUNNED) or 束缚 (UNMOVABLE) ends the acceleration
 * and its speed layers with it; not blocked and not accelerating starts it. While it accelerates, every
 * `rush.dlancer_t[trigger].interval` (0.5) s — the first one 0.5 s after the start — one more layer of move speed
 * +`move_speed` (50 %, MULTIPLIER, the layers add up), at most `trig_cnt` (25) tries — blocked or not, frozen, asleep or
 * slowed or not (only the two flags stop it). Every normal attack carries dlancer_t_atk: while it accelerates, the hit
 * adds 当前移动速度 × `firstattack.atk_scale` (600) physical damage — a second instance, melee, no 受击回复 (ignoreForSp) —
 * and ends the acceleration, so once blocked only its first hit has it. Until 0.2.0 it kept accelerating through a stun
 * and kept the speed after it, and the first hit after a block multiplied the attack instead (×(1 + 6 × layers / 25)),
 * a stun in between included (community report of 2026-10-06, item 36).
 */
const RUSH_LISTEN = 0.1;

function kitRush(ab) {
  const ms = T(ab, 'rush.dlancer_t[trigger].move_speed') ?? 0;
  const iv = stepOf('rush.dlancer_t[trigger].interval', T(ab, 'rush.dlancer_t[trigger].interval') ?? 0.5, 0.5);
  const max = boundedCount(T(ab, 'rush.dlancer_t[trigger].trig_cnt') ?? 0, bbCap('rush.dlancer_t[trigger].trig_cnt'), 0);
  const scale = T(ab, 'firstattack.atk_scale') ?? 0;
  // 晕眩 / 束缚 only (the client's STUNNED / UNMOVABLE flags: not 冻结, 沉睡 or 浮空, which hold flags.stun here too)
  const held = (e) => e.buffs.some((x) => x.status === 'stun' || x.status === 'bind');
  const stop = (b, e, a) => { a.on = false; a.n = 0; b.removeBuff(e, 'ab:rush'); };
  return [{
    iv: RUSH_LISTEN,
    // the listeners first look at once (waitFirstTriggerInterval 0): a walker spawned unblocked starts at t = 0
    spawn(b, e, a) { a.on = !e.blockedBy && !held(e); a.n = 0; a.tries = 0; a.acc = 0; },
    tick(b, e, a, dt) {
      if (held(e)) { if (a.on) stop(b, e, a); return; }
      if (!a.on) {
        if (!e.blockedBy) { a.on = true; a.tries = 0; a.acc = 0; }
        return;
      }
      if (a.tries >= max || !(iv > 0)) return;
      a.acc += dt;
      let grew = false;
      let guard = 0;
      while (a.acc >= iv - 1e-9 && a.tries < max && guard++ < STEP_PER_TICK) { a.acc -= iv; a.tries++; a.n++; grew = true; } // loop-cap: stepOf interval
      if (grew) b.addBuff(e, { key: 'ab:rush', mods: { moveMul: 1 + ms * a.n }, persist: true });
    },
    dealt(c, b, e, a) {
      if (!a.on) return;
      const t = c.target;
      const amount = e.s.moveSpeed * scale;
      stop(b, e, a);
      if (t && t.alive && amount > 0) b.dealDamage(e, t, { amount, type: 'phys', canDodge: false, isSkill: true, noSp: true, tags: ['enemyAbility', 'rush'] });
    },
  }];
}

/**
 * 萨卡兹悖谬暴虐兵长: blocked only by a blocker with ≥ 3 free block; its first hit also strikes the units around its target
 * (PRTS 技能0 暴击 "对目标和周围4格的我方单位造成攻击力150%的物理普通伤害（无视无法选择，无视迷彩）※此技能仅能触发一次"):
 * the splash ignores 无法选择, so it reaches an airborne 起飞 ally too (`ignoreSelect`).
 */
function kitFirstAoe(ab) {
  const scale = T(ab, 'AOEAttack.atk_scale') ?? 0;
  return [blockWeight(3), {
    // the splashing first attack is its AOEAttack: the skill slot for the client (castSlot, display only)
    before(c, b, e, a) { if (!a.done && !a.cast) { a.cast = true; castSlot(b, e, ab.sk.AOEAttack); } },
    dealt(c, b, e, a) {
      if (a.done) return;
      a.done = true;
      b.fx('explode', { x: c.target.x, y: c.target.y, r: 1, kind: 'aoeAttack' });
      for (const u of b.alliesInRadius(c.target.x, c.target.y, 1)) {
        if (u !== c.target) hurt(b, e, u, e.s.atk * scale, 'phys', { ignoreSelect: true, tags: ['aoeAttack'] });
      }
    },
  }];
}

function kitDefDecay(ab) {
  const max = T(ab, 'def_reduce.max_stack_cnt') ?? 0, def = T(ab, 'def_reduce.def') ?? 0, res = T(ab, 'def_reduce.magic_resistance') ?? 0;
  return [{
    taken(c, b, e) {
      if (!(max > 0)) return;
      b.addBuff(e, { key: 'ab:defDecay', refresh: 'stack', stacks: 1, maxStacks: max, persist: true, mods: { defFlat: def / max, resFlat: res / max } });
    },
  }];
}

function kitExposeOnHit(ab) {
  const dur = T(ab, 'Expose.weak[limit]') ?? 0, scale = T(ab, 'Expose.damage_scale') ?? 1;
  return [{ sil: true, taken(c, b) { const s = c.source; if (s && s.side === 'ally' && s.alive && s.kind !== 'device') expose(b, s, dur, scale); } }];
}

/**
 * 自制投石机 (PRTS 天赋). A normal stone is a physical attack that splashes every ally within 1.5 of the impact
 * (the page's 半径1.5; the blackboard `projectile_range` 0.5 is the 入戏 stone, not this volley). `times` stones
 * land `hit_interval` (0.3 s) apart, each its own damage instance — DEF, shields and 「每次受到攻击」 effects
 * (坚守 thorns, cd 0.2 s) see them separately. The attack does not end when the target is lost: a later stone
 * still splashes at the last aim, and a stone already scheduled still lands if the catapult dies (no `owner`
 * on the timer, so offOwner does not cancel it). 入戏(敌方) — a buff key or flag `inPlay`, which this mode's
 * tables never grant — aims each stone at a random point of the side-`offset_bound`*2 square (默认 ±3, side 6)
 * and splashes `projectile_range` (0.5) there, without forcing a hit on the main target. The roll is `battle.rng`.
 */
const CATAPULT_SPLASH = 1.5;
const CATAPULT_STONE = 'catapult:stone';

function catapultInPlay(e) {
  if (e?.s?.flags?.inPlay) return true;
  for (const bf of e?.buffs ?? []) if (bf && (bf.key === 'inPlay' || bf.flags?.inPlay)) return true;
  return false;
}

function catapultSplash(b, e, x, y, r, skip) {
  if (!(r > 0)) return;
  for (const u of areaAllies(b, e, x, y, r)) {
    if (u === skip) continue;
    b.dealDamage(e, u, { amount: e.s.atk, type: 'phys', isAttack: true, isSplash: true, tags: [CATAPULT_STONE] });
  }
}

/** One stone. `forcePrimary` hits the locked ally when they are still selectable, then splashes around the impact. */
function catapultStone(b, e, aim, radius, forcePrimary, inPlay, bound) {
  let x = aim.x, y = aim.y;
  const t = aim.target;
  if (inPlay) {
    if (t && t.alive) { x = t.x; y = t.y; aim.x = x; aim.y = y; }
    const span = bound > 0 ? bound : 0;
    x += (b.rng() * 2 - 1) * span;
    y += (b.rng() * 2 - 1) * span;
    catapultSplash(b, e, x, y, radius, null);
    return;
  }
  if (t && t.alive) { x = t.x; y = t.y; aim.x = x; aim.y = y; }
  let skip = null;
  if (forcePrimary && t && t.alive && canTargetAlly(e, t, true)) {
    b.dealDamage(e, t, { amount: e.s.atk, type: 'phys', isAttack: true, tags: [CATAPULT_STONE] });
    skip = t;
  }
  catapultSplash(b, e, x, y, radius, skip);
}

function catapultVolley(ab, b, e, aim) {
  const n = Math.max(1, Math.floor(boundedCount(T(ab, 'Attack.attack@times') ?? 1, PLUGIN_TIMES_MAX, 1)));
  const interval = T(ab, 'Attack.attack@hit_interval') ?? 0.3;
  const inPlay = catapultInPlay(e);
  const radius = inPlay ? (T(ab, 'Attack.attack@projectile_range') ?? 0.5) : CATAPULT_SPLASH;
  const bound = T(ab, 'Attack.attack@offset_bound') ?? 3;
  for (let i = 0; i < n; i++) {
    const fire = () => catapultStone(b, e, aim, radius, true, inPlay, bound);
    if (i === 0 || !(interval > 0)) fire();
    else b.after(interval * i, fire);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// this family's part of KITS (content/enemies.js spreads the parts in this order)

/**
 * 心虚设计师: while a living blocker stands off the same column, the front is that side; otherwise the walk
 * (faceMove). The unit's `dir` and the display-only snapshot `face` use the same sign, so the model turns with the
 * cut. A blocker on the same column keeps the last sign [ASSUMED: PRTS names the front, not a same-column tie].
 */
function faceCrshd(b, e, a) {
  const blk = e.blockedBy;
  let sign = null;
  if (blk && blk.alive) {
    const dx = blk.x - e.x;
    if (Math.abs(dx) > 1e-6) sign = dx > 0 ? 1 : -1;
  } else {
    const dx = e.x - a.px;
    if (Math.abs(dx) > 1e-6) sign = dx > 0 ? 1 : -1;
  }
  if (sign != null) a.facing = sign;
  e.facing = a.facing;
  e.mem.publishFacing = true;
  a.px = e.x;
}

export const SPECIAL_KITS = Object.freeze({
  // --- SPECIAL 特异 / others
  enemy_1045_hammer: kitStun3,                                       // 粉碎攻坚手 · every 3rd attack stuns
  enemy_1045_hammer_2: kitStun3,                                     // 粉碎攻坚组长 · same
  enemy_1116_liprr: kitPrisoner(),                                   // 普通囚犯 · confined (ASPD −50) → freed after 4 attacks (ATK +50 %)
  enemy_1116_liprr_2: kitPrisoner(),                                 // 老练囚犯 · same
  enemy_1118_lidbox_2: kitPrisoner(),                                // 拳师囚犯 · + DEF penetration when freed
  enemy_1119_vofsd: kitPrisoner(),                                   // 强壮囚犯 · + RES and regen when freed
  enemy_1121_lifbos: kitPrisoner(true),                              // 重犯 · confined DEF up; first liberation frees every prisoner
  enemy_1121_lifbos_2: kitPrisoner(true),                            // 传奇重犯 · same
  enemy_1072_dlancer: kitRush,                                       // 萨卡兹穿刺手 · accelerates while walking; first hit after block ×speed
  enemy_1320_wdrrl_2: kitFirstAoe,                                   // 萨卡兹悖谬暴虐兵长 · block ≥3 only; first attack splashes
  enemy_1302_ymtro_2: (ab) => [blockWeight(4), passengerBus(ab)],    // “越长尘” · block ≥4, carries up to Bus.max_cnt
  enemy_1329_cbshld: kitDefDecay,                                    // 弧光镜卫 · DEF/RES drop with every damage instance
  enemy_1329_cbshld_2: kitDefDecay,                                  // 弧光镜卫长 · same
  enemy_1249_lysdb_2: (ab) => [{ spawn(b, e) { grantHitShield(b, e, T(ab, 'Shield.max_block_damage_cnt') ?? 0); } }], // 莱茵生命防卫科高级成员 · blocks one phys/arts hit
  enemy_1402_tgshd_2: kitExposeOnHit,                                // 重装侦察兵 · exposes its attackers 5 s
  enemy_1081_sotisd: (ab) => [taunt(T(ab, 'taunt.taunt_level') ?? 0)], // 游击队盾卫 · taunt +1
  enemy_1427_lrnazg: kitNazg,                                        // “灵幛” · attack hits everyone around it (+ on infection tiles)
  enemy_1422_lrsldr: () => [infectionArts()],                        // 萨卡兹枯朽前锋 · arts attacks on 源石污染区 (infection tiles)
  enemy_1422_lrsldr_2: () => [infectionArts()],                      // 萨卡兹枯朽辟路前锋 · same
  enemy_1425_lrcmra: kitChimera,                                     // 孽罪奇美拉 · activated on infection: arts attacks + pollution aura
  enemy_1425_lrcmra_2: kitChimera,                                   // 渎罪奇美拉 · same
  enemy_1430_lrrook: (ab) => [{                                      // 愧悔魂灵圣杯 · shares damage taken by nearby ground enemies
    spawn(b, e, a) { a.r = T(ab, 'takeDmg.range_radius') ?? 1.7; a.share = T(ab, 'takeDmg.damage_scale') ?? 0; stOf(b).chalices = (stOf(b).chalices ?? 0) + 1; },
    death(c, b) { stOf(b).chalices = Math.max(0, (stOf(b).chalices ?? 1) - 1); },
  }],
  enemy_1025_reveng: (ab) => [lowHpBuff(0.5, { atkPct: T(ab, 'atkup.atk') ?? 0 })],     // 寻仇者 · ATK up below half HP
  enemy_1021_bslime: (ab) => [deathBoom({ scale: T(ab, 'boom.atk_scale') ?? 0 })],       // 高能源石虫 · death: phys blast
  enemy_1067_snslime: (ab, e) => [deathBoom({ scale: T(ab, 'boom.atk_scale') ?? 0, r: (e.def.raw.stats && e.def.raw.stats.rawRangeRadius) || BOOM_RADIUS, status: { key: 'cold', dur: T(ab, 'boom.freeze') ?? 0 } })], // 冰爆源石虫 · death: phys blast + cold
  enemy_1069_icebrk_2: (ab) => [{ hitOut(c, b, e) { if (c.dmg.isAttack && c.target.s.flags.freeze) c.dmg.amount *= T(ab, 'atkup.atk_scale') ?? 1; } }], // 雪怪小队破冰者 · ×3 vs frozen
  enemy_1026_aghost: () => [unblockable()],                          // 幽灵组长 · unblockable
  enemy_1062_rager_2: (ab) => [{ iv: 1, tick(b, e) { const v = T(ab, 'periodic_damage.damage') ?? 0; if (v > 0) b.dealDamage(null, e, periodicDamage(v)); } }], // 狂暴宿主组长 · "自身每秒受到500无来源真实伤害" (damage, not 流失)
  enemy_1183_mlasrt: (ab) => [ep('erosion', T(ab, 'EpDamage.attack@ep_damage_ratio') ?? 0), nthAttackPower(nthOf(ab.sk.PowerAttack), (ab.sk.PowerAttack && ab.sk.PowerAttack.bb.atk_scale) || 1, null, 0, ab.sk.PowerAttack)], // 无胄盟清扫小队 · erosion; every 4th attack ×1.5
  enemy_1273_stmgun_2: (ab) => {                                     // 高准度伦蒂尼姆城防自行炮 · locks the highest max-HP unit in range, bombards the highest HP% on its 9 tiles
    // the allies in its range (the engine's ranged reach: radius + the ally collider)
    const inRange = (b, e) => allTargets(b, e).filter((a) => hypot(a.x - e.x, a.y - e.y) <= (e.base.rangeRadius || 0) + ALLY_COLLIDER_RADIUS + 1e-9);
    return [skill(ab.sk.Cannon, (b, e) => {
      const lock = inRange(b, e).sort((p, q) => q.s.maxHp - p.s.maxHp)[0];
      if (!lock) return;
      const r0 = Math.round(lock.y), c0 = Math.round(lock.x);
      const dur = CANNON_SHOTS * CANNON_EVERY;
      b.fx('telegraph', { x: c0, y: r0, r: 1.5, dur, kind: 'cannon' });
      b.addBuff(e, { key: 'ab:cannon', duration: dur, flags: { noDisplace: true } });
      const ab2 = e.mem.ab;
      const had = new Set(ab2.immune || []);
      ab2.immune = new Set([...had, ...CANNON_IMMUNE]);
      for (let i = 1; i <= CANNON_SHOTS; i++) b.after(i * CANNON_EVERY, () => {
        if (!e.alive) return;
        if (i === CANNON_SHOTS) ab2.immune = had;
        // each shot picks inside the 9-tile zone (格子判定): an area selection — a 迷彩 ally may be shot, an unblocking 隐匿
        // one not (areaSelectable; it used to skip 迷彩 like a normal attack)
        const t = b.allies().filter((a) => areaSelectable(e, a) && Math.abs(Math.round(a.y) - r0) <= 1 && Math.abs(Math.round(a.x) - c0) <= 1)
          .sort((p, q) => q.hpRatio - p.hpRatio)[0];
        if (t) { b.fx('explode', { x: t.x, y: t.y, r: 0.5, kind: 'cannon' }); hurt(b, e, t, e.s.atk * (ab.sk.Cannon.bb.atk_scale ?? 0), 'arts'); }
      }, { owner: e });
    }, { cond: (b, e) => inRange(b, e).length > 0, turn: attackSkillOf('enemy_1273_stmgun_2', 'Cannon') })];   // the attack's turn (DESIGN §35.52)
  },
  // 萨卡兹骸骨拷打者 · heals + ATK stack when a unit within Attack.range_radius is knocked out; leaves 2 血珀 on death — they
  // stay where it fell, uncounted, and bleed out (enemy_1367_dseed). This mode has no 唤血祭坛 to pulse them.
  enemy_1364_spnaxe_2: (ab) => [{
    death(c, b, e) {
      const key = ab.tS['Summon.enemy_key'], n = T(ab, 'Summon.cnt') ?? 0;
      if (c.reason !== 'killed' || !key || !(n > 0)) return;
      spawnChildren(b, e, key, n, { route: stayRoute(e), countInTotal: false, mods: null });
    },
  }, {
    spawn(b, e) { watchDeaths(b, e); },
    otherDeath(c, b, e) {
      const u = c.unit;
      if (!u || u === e || c.reason !== 'killed' || hypot(u.x - e.x, u.y - e.y) > (T(ab, 'Attack.range_radius') ?? TORTURER_RADIUS) + 1e-9) return;
      b.heal(e, e, e.s.maxHp * (T(ab, 'Attack.hp_ratio') ?? 0), { self: true });
      b.addBuff(e, { key: 'ab:torture', refresh: 'stack', stacks: 1, maxStacks: T(ab, 'Attack.max_stack_cnt') ?? 1, persist: true, mods: { atkPct: T(ab, 'Attack.atk') ?? 0 } });
    },
    hitOut(c, b, e) { if (c.dmg.isAttack && c.target !== e.blockedBy) c.dmg.amount *= T(ab, 'Attack.attack@ranged_atk_scale') ?? 1; },
  }],
  // 血珀 · PRTS 天赋: 自缚, 失衡免疫, 不攻击, 无法被阻挡. With no 唤血祭坛 / 沥血王座 on the field, lose Passive.hp_ratio of
  // max HP per second (true 流失, can kill). The handbook line is the altar rebirth ("在祭坛处重生为新生血裔"); this mode
  // has no altar, so that pulse is not modelled. Passive.damage_resistance is 0 (0% 庇护) and applies nothing.
  enemy_1367_dseed: (ab) => [{
    spawn(b, e) {
      e.profile.noAttack = true;
      b.addBuff(e, { key: 'ab:dseed', persist: true, flags: { selfBound: true, noMove: true, unblockable: true, noDisplace: true } });
    },
    iv: 1,
    tick(b, e) {
      const r = T(ab, 'Passive.hp_ratio') ?? 0;
      if (r > 0) b.loseHp(e, e.s.maxHp * r);
    },
  }],
  enemy_1501_demonk: () => [maxTargets(2)],                          // 萨卡兹百夫长 · attacks 2 targets
  enemy_10018_sgrobh: () => [maxTargets(2)],                         // “独轮车玩具” · attacks 2 targets
  enemy_2001_duckmi: (ab) => [unblockable(), runWhenHit(T(ab, 'run.attack@move_speed') ?? 0)],   // 鸭爵 · unblockable, no attack; runs +400 % once hurt
  enemy_2001_duckmi_2: (ab) => [unblockable(), runWhenHit(T(ab, 'run.attack@move_speed') ?? 0)], // 鸭爵 (鸭爵 strategy) · same, +300 %
  enemy_10159_mntrjn: (ab) => [unblockable(), passengerBus(ab, true)], // 伊利昂的木驮兽 · unblockable; bus.max_cnt / bus.move_speed
  enemy_2009_csaudc: kitEp('neural', 'combat.attack@ep_damage_ratio'), // 骇笑看客 · neural on hit
  enemy_2010_csdcr: (ab) => [ep('neural', T(ab, 'attack.attack@ep_damage_ratio') ?? 0), { // 绯红歌伶 · neural on hit; every 20 hits taken: global enemy ASPD up
    taken(c, b, e, a) {
      a.n = (a.n ?? 0) + 1;
      if (a.n < (T(ab, 'AttackSpeedUp.stack_cnt') ?? Infinity)) return;
      a.n = 0;
      b.fx('telegraph', { x: e.x, y: e.y, r: 99, kind: 'songOfWar', id: e.id });
      for (const o of b.aliveEnemies()) b.addBuff(o, { key: 'ab:songOfWar', duration: T(ab, 'AttackSpeedUp.duration') ?? 0, refresh: 'extend', mods: { aspd: T(ab, 'AttackSpeedUp.attack_speed') ?? 0 }, visible: true });
    },
  }],
  enemy_10001_trslim: (ab) => [skill(ab.sk.StartRun, (b, e) => {    // 简饲源石虫 · below half: runs (faster, unblockable 3 s)
    const s = ab.sk.StartRun.bb;
    b.addBuff(e, { key: 'ab:run', duration: s.block_free_time ?? 0, mods: { moveMul: 1 + (s.move_speed ?? 0) }, flags: { unblockable: true }, visible: true });
  }, { sil: true, cond: (b, e) => e.hpRatio < 0.5 })],
  enemy_10027_vtsk: (ab) => {                                        // “帝国的甲胄” · entrance barrage on the highest-HP unit; ranged ×0.8; 3-hit charge attack
    const ap = ab.sk.Appear, mc = ab.sk.MultiCombat;
    return [{
      spawn(b, e) {
        const n = boundedCount(ap ? ap.bb.times ?? 0 : 0, PLUGIN_TIMES_MAX, 0);
        b.after(0.5, () => {
          if (!e.alive || !n) return;
          const lock = allTargets(b, e).sort((p, q) => q.hp - p.hp)[0];
          if (!lock) return;
          castSlot(b, e, ap);   // the entrance barrage is its Appear skill (display only)
          b.fx('telegraph', { x: lock.x, y: lock.y, r: 1, kind: 'barrage', id: e.id });
          for (let i = 0; i < n; i++) {
            // "对碰撞范围内的1名当前生命值最高的我方单位" — an area selection: never an airborne 起飞 ally nor an unblocking
            // 隐匿 one (PRTS “帝国的甲胄”; areaAlliesInTiles)
            const t = areaAlliesInTiles(b, e, lock.tileR, lock.tileC, 'box', 1).sort((p, q) => q.hp - p.hp)[0];
            if (t) hurt(b, e, t, e.s.atk, 'phys');
          }
        }, { owner: e });
      },
      hitOut(c, b, e) { if (c.dmg.isAttack && c.target !== e.blockedBy) c.dmg.amount *= T(ab, 'range.attack@atk_scale_range') ?? 1; },
    }, mc ? {
      cd: mc.cd, icd: mc.icd, sk: mc, fire(b, e) { e.mem.ab.multi = boundedCount(mc.bb.times ?? 1, PLUGIN_TIMES_MAX, 1); },
      dealt(c, b, e) {
        const m = e.mem.ab.multi;
        if (!(m > 1)) return;
        e.mem.ab.multi = 0;
        for (let i = 1; i < m; i++) hurt(b, e, c.target, e.s.atk, 'phys');
      },
    } : null];
  },
  enemy_10044_wintun: (ab) => {                                      // 咸鳞汁推荐者 · fast with the barrel; first attack (SILENCE): big hit + buff zone for enemies
    const s = ab.sk.BlockedBoom ? ab.sk.BlockedBoom.bb : {};
    return [{
      sil: true,                                                     // silenced: the barrel is kept (and its speed) until an unsilenced attack
      spawn(b, e) { b.addBuff(e, { key: 'ab:barrel', persist: true, mods: { moveMul: T(ab, '1.move_speed') ?? 1 } }); },
      // the barrel blow is its BlockedBoom: the skill slot for the client (castSlot, display only)
      before(c, b, e, a) { if (!a.done) castSlot(b, e, ab.sk.BlockedBoom); },
      hitOut(c, b, e, a) { if (!a.done && c.dmg.isAttack) c.dmg.amount *= s.blockee_atk_scale ?? 1; },
      attack(c, b, e, a) {
        if (a.done) return;
        a.done = true;
        b.removeBuff(e, 'ab:barrel');
        const x = e.x, y = e.y, life = s.fixed_duration ?? 0;
        b.fx('zone', { x, y, r: BARREL_RADIUS, dur: life, kind: 'barrel' });
        let left = life;
        const h = b.every(0.5, () => {
          for (const o of b.enemiesInRadius(x, y, BARREL_RADIUS)) auraBuff(b, o, 'ab:barrelZone', 0.5, { aspd: s.attack_speed ?? 0, dodgePhys: s.prob ?? 0 });
          left -= 0.5;
          if (left <= 0) h.cancel();
        });
      },
    }];
  },
  enemy_10045_parrot: kitParrot,                                     // 吉兆飞鳞 · 近地悬浮 (grounded 8 s when stunned); sprints when first hit
  enemy_10087_hlchgr: (ab) => [{                                     // 圣堂剑士 · spends ammo (every 6 s, max 5) for permanent speed/ATK
    iv: T(ab, 'SkillTrigger.interval') ?? 6,
    tick(b, e, a) {
      a.n = (a.n ?? 0) + 1;
      if (a.n > 5) return;
      castSlot(b, e, ab.sk.ForeverEnhance);   // each enhancement is its ForeverEnhance (display only)
      const s = ab.sk.ForeverEnhance ? ab.sk.ForeverEnhance.bb : {};
      b.addBuff(e, { key: 'ab:enhance', refresh: 'stack', stacks: 1, maxStacks: 5, persist: true, mods: { moveFlat: (s.move_speed_add ?? 0) * e.base.moveSpeed, atkPct: s.atk_add ?? 0 } });
    },
  }],
  enemy_10094_crstf: kitEp('neural', 'ep.ep_damage_ratio'),          // 临时收音师 · neural on hit (filming zones n/a → always)
  enemy_10097_crshd: (ab) => [                                       // 心虚设计师 · neural to its blocker every s; front damage −80 % (faces the blocker, else the walk)
    { iv: 1, tick(b, e) { if (e.blockedBy) elem(b, e, e.blockedBy, 'neural', e.s.atk * (T(ab, 'block.ep_damage_ratio') ?? 0)); } },
    frontGuard(T(ab, 'weakness.damage_resistance') ?? 0, faceCrshd), // 减少来自正面的物理/法术伤害 (#869)
  ],
  enemy_10098_crhro: (ab) => [ep('neural', T(ab, 'inside.attack@ep_damage_ratio') ?? 0), // 主角阵营角色 · neural on hit; 重生 once (reborn.duration s, full HP)
    reborn({ dur: T(ab, 'reborn.duration') ?? 0, invincible: T(ab, 'reborn.invincible') ?? 0 })],
  enemy_10099_crvln: kitEp('neural', 'inside.attack@ep_damage_ratio'), // 反派阵营角色 · neural on hit
  enemy_10116_ymgtop: (ab) => {                                     // 水遁忍者 · spinning phase (SILENCE): phys AoE every s; 失衡 stops it
    const spin = {
      sil: true, cd: ab.sk.SwitchModeTrigger ? ab.sk.SwitchModeTrigger.cd : 60, icd: ab.sk.SwitchModeTrigger ? ab.sk.SwitchModeTrigger.icd : 10,
      fire(b, e, a) { a.until = b.time + (T(ab, 'EndRotate.rotate_duration') ?? 0); b.fx('telegraph', { x: e.x, y: e.y, r: 1, kind: 'spin', id: e.id }); },
      iv: T(ab, 'RotateDamage.interval') ?? 1,
      // "每秒对半径1.0范围内的所有我方单位造成…（无视迷彩，不可对空），自身受阻止攻击类异常效果影响期间无法造成此伤害": an area
      // selection, skipped while 晕眩 / 冻结 / 浮空 (flag stun), 沉睡 or 缴械 hold it (PRTS 异常效果 §阻止攻击; until 0.1.3 it spun on);
      // 不可对空: never a flying ally (the 炎佑 dragon — until 0.2.1 it was hit)
      tick(b, e, a) {
        if (!(a.until > b.time) || e.s.flags.stun || e.s.flags.sleep || e.s.flags.disarm) return;
        for (const u of areaAllies(b, e, e.x, e.y, T(ab, 'RotateDamage.attack@range_radius') ?? 1)) if (!u.isFlying) hurt(b, e, u, e.s.atk * (T(ab, 'RotateDamage.attack@atk_scale') ?? 1), 'phys');
      },
    };
    // 漩涡形态 "不进行普通攻击" (PRTS 天赋): no blocked attack while it spins (until 0.1.3 its blocker took both)
    const noAtk = { tick(b, e) { e.profile.noAttack = spin.until > b.time; } };
    return [spin, noAtk, unbalanced((b, e) => { if (spin.until > b.time) { spin.until = 0; b.fx('phase', { x: e.x, y: e.y, id: e.id, kind: 'spinStop' }); } })];
  },
  enemy_10118_ymgprc: (ab) => {                                      // 澪 · double hits; 寒晖: every 4th attack (spCost 3) is a ×1.5 double hit
    const scale = (ab.sk.PowerAttack && ab.sk.PowerAttack.bb.atk_scale) || 1;
    const pw = nthAttackPower(nthOf(ab.sk.PowerAttack), scale, null, 0, ab.sk.PowerAttack);
    return [pw, { dealt(c, b, e) { hurt(b, e, c.target, e.s.atk * (pw.power ? scale : 1), 'phys', { isSkill: false }); } }];
  },
  enemy_10127_rkmbst_2: (ab) => [taunt(1), { spawn(b, e) {           // 异质裂兽·α · M0 shield (damage ×0.5, ASPD +100, barrier)
    b.addBuff(e, { key: 'ab:m0', persist: true, visible: true, mods: { dmgTakenMul: 1 - (T(ab, 'M0Shield.damage_resistance') ?? 0), aspd: T(ab, 'M0Shield.attack_speed') ?? 0 } });
    const sh = e.s.maxHp * (T(ab, 'M0Shield.init_shield_hp_ratio') ?? 0);
    if (sh > 0) b.addBuff(e, { key: 'ab:m0barrier', shield: sh, persist: true });
  } }],
  enemy_10156_mncrer: (ab) => [{ sil: true, death(c, b, e) {         // 新手祭司学徒 · death: heals nearby enemies
    if (c.reason !== 'killed') return;
    const r = T(ab, 'Boom.projectile_range') ?? 1, amt = e.s.atk * (T(ab, 'Boom.heal_scale') ?? 0);
    b.fx('explode', { x: e.x, y: e.y, r, kind: 'heal' });
    for (const o of b.enemiesInRadius(e.x, e.y, r)) if (o !== e) b.heal(e, o, amt);
  } }],
  enemy_10162_mnctpt: (ab) => [{                                     // 自制投石机 · 3 physical attacks, 1.5 splash; 索敌不受阻挡影响
    // PRTS 天赋 「索敌不受阻挡影响，且不会因丢失目标而结束攻击」: its target selection ignores its block — a 隐匿 blocker (an
    // operator on the 排气格栅) is no target, so with nobody else in range it does not attack (the official game, community
    // report of 2026-10-06, item 24); it picks by 仇恨值, not its blocker first. The volley itself is the kit's
    // (profile.deferHit): three physical attacks `hit_interval` apart, each splashing, including after the target is lost.
    spawn(b, e) { e.profile.blockFree = true; e.profile.deferHit = true; },
    before(c, b, e) {
      e.profile.deferHit = true;
      const t = c.targets && c.targets[0];
      e.mem.catapultAim = t ? { target: t, x: t.x, y: t.y } : (e.mem.catapultAim || { target: null, x: e.x, y: e.y });
    },
    attack(c, b, e) {
      catapultVolley(ab, b, e, e.mem.catapultAim || { target: null, x: e.x, y: e.y });
    },
    // a follow-up stone is itself an attack, so `dealt` runs again; the tag keeps it from starting another volley
    dealt(c) { if (c.dmg?.tags?.includes(CATAPULT_STONE)) return; },
  }],
});
