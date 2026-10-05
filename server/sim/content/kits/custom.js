// Stronghold-Protocol custom operator kits. The DIY catalog preserves the official charId on each
// runtime def, so these factories can share the normal SkillSpec runtime without native roster IDs.

import { num, talentBb, onHitBy } from './tier1.js';

import { performAttack } from '../../ai.js';
import wang from './custom-wang.js';
import oblvns from './custom-oblvns.js';
import demetr from './custom-demetr.js';
const selectedId = (chess, def) => chess?.skill?.skillId ?? def?.skill?.id ?? def?.skill?.skillId ?? null;
const gridOf = (def) => def?.skill?.rangeGrid ?? def?.skill?.trigger?.customRangeGrid ?? null;
const op = (u) => u && u.kind === 'op' && u.alive && u.deployed;
const enemy = (u) => u && u.side === 'enemy' && u.alive && !u.hidden;
const battime = (def) => num(def?.stats?.bat, 1) || 1;
const flatBat = (def, value) => Math.max(-0.9, num(value) / battime(def));
const allInRange = (battle, unit) => battle.enemiesInKeys(unit.rangeKeys || [], unit, { canHitFly: true });
const skillTargeting = (def, extra = {}) => ({ ...(gridOf(def) ? { rangeGrid: gridOf(def) } : {}), ...extra });
const damage = (battle, unit, target, amount, type = 'phys', tags = ['skill']) => {
  if (enemy(target) && amount > 0) return battle.dealDamage(unit, target, { amount, type, isSkill: true, tags });
  return 0;
};
const poison = (battle, unit, target, amount, duration, key, maxStacks = 1) => {
  if (!enemy(target) || !(amount > 0) || !(duration > 0)) return;
  battle.addBuff(target, { key, duration, refresh: maxStacks > 1 ? 'stack' : 'replace', maxStacks, interval: 1, source: unit, visible: true,
    onTick: ({ unit: victim, buff }) => { if (victim.alive) battle.dealDamage(unit, victim, { amount: amount * buff.stacks, type: 'arts', tags: ['talent', 'dot'] }); } });
};

function schwarz(bb, chess, def) {
  const sid = selectedId(chess, def), t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
  const skills = {
    skchr_shwaz_1: { kind: 'instant', attack: { atkScale: num(bb.atk_scale, 1) } },
    skchr_shwaz_2: { kind: 'duration', mods: { atkPct: num(bb.atk) } },
    skchr_shwaz_3: { kind: 'duration', mods: { atkPct: num(bb.atk), batPct: flatBat(def, bb.base_attack_time) }, targeting: skillTargeting(def) },
  };
  return { skill: skills[sid], skills, talents: [{ install(battle, unit) {
    onHitBy(battle, unit, ({ target, dmg }) => {
      if (!dmg.isAttack || !enemy(target)) return;
      const probability = unit.skill.active ? num(bb['talent@prob'], num(t0.prob)) : num(t0.prob);
      if (!battle.rng.chance(probability)) return;
      dmg.amount *= num(t0.atk_scale, 1);
      battle.addBuff(target, { key: `shwaz:def:${unit.id}`, duration: num(t0.defdown_duration), mods: { defPct: num(t0.def) }, source: unit, visible: true });
    });
    const carried = chess.module?.active && chess.module.level >= 2;
    const count = () => battle.allyUnits.filter((a) => a.ownerId === unit.ownerId && a.kind === 'op' && a.def.profession === 'SNIPER' && (carried ? !a.removed : op(a))).length;
    battle.every(0.25, () => {
      if ((!carried && !op(unit)) || count() < 2) return;
      for (const a of battle.allies(unit.ownerId)) if (op(a) && a.def.profession === 'SNIPER') battle.addBuff(a, { key: `shwaz:crossfire:${unit.id}`, duration: 0.4, mods: { atkPct: num(t1.atk) }, source: unit });
    }, { owner: unit, immediate: true });
  } }] };
}


function siege(bb, chess, def) {
  const sid = selectedId(chess, def), t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
  const skills = {
    'skcom_charge_cost[3]': { kind: 'instant', trigger: 'SP_FULL',
      onStart({ battle, unit }) { battle.addDp(unit.ownerId, num(bb.cost)); } },
    skchr_siege_2: { kind: 'charges', charges: def.skill.maxCharges,
      targeting: { ...skillTargeting(def), allInRange: true, canHitFly: false },
      attack: { atkScale: num(bb.atk_scale, 1), allInRange: true, hitAllBlocked: false, splashRadius: 0 },
      onAttack({ battle, unit }) { battle.addDp(unit.ownerId, num(bb.cost)); } },
    skchr_siege_3: { kind: 'duration', mods: { batPct: flatBat(def, bb.base_attack_time) },
      attack: { atkScale: num(bb['attack@atk_scale'], 1), onEachHit({ battle, unit, target }) {
        if (enemy(target) && battle.rng.chance(num(bb['attack@buff_prob']))) battle.applyStatus(target, 'stun', { duration: num(bb['attack@stun']), source: unit });
      } } },
  };
  return { skills, skill: skills[sid], talents: [{ install(battle, unit) {
    const apply = () => {
      if (!op(unit)) return;
      for (const a of battle.allies(unit.ownerId)) if (op(a) && a.def.profession === 'PIONEER') {
        const extra = a === unit && chess.module?.active && chess.module.level >= 2 ? 2 : 1;
        battle.addBuff(a, { key: `siege:king:${unit.id}`, duration: 0.4, mods: { atkPct: num(t0.atk) * extra, defPct: num(t0.def) * extra }, source: unit });
      }
      const tb = def.traitBb;
      if (unit.blocking.length && (num(tb.atk) || num(tb.def))) battle.addBuff(unit, { key: 'siege:module', duration: 0.4, mods: { atkPct: num(tb.atk), defPct: num(tb.def) } });
    };
    battle.every(0.25, apply, { owner: unit, immediate: true });
    battle.on('kill', ({ victim }) => {
      if (!op(unit) || victim?.side !== 'enemy') return;
      const grid = def.talents[1]?.rangeGrid;
      if (grid && battle.unitsInGrid(unit, grid, { side: 'enemy' }).includes(victim)) unit.skill.gainSp(num(t1.sp), 'talent');
    }, { owner: unit });
  } }] };
}

function thorns(bb, chess, def) {
  const sid = selectedId(chess, def), t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
  const rangedScale = num(def.traitBb.atk_scale, 0.8);
  let deployment = -1, casts = 0;
  const skills = {
    'skcom_atk_up[3]': { kind: 'duration', mods: { atkPct: num(bb.atk) } },
    skchr_thorns_2: { kind: 'duration', mods: { atkPct: num(bb.atk), defPct: num(bb.def) },
      targeting: skillTargeting(def), attack: { noAttack: true },
      onStart({ unit }) { unit.mem.thornsCounterAt = -Infinity; } },
    skchr_thorns_3: { kind: 'duration', duration: def.skill.duration, targeting: skillTargeting(def),
      onStart({ unit, skill }) {
        if (deployment !== unit.deploySeq) { deployment = unit.deploySeq; casts = 0; }
        const twice = ++casts >= 2;
        unit.profile.rangedScale = 1;
        skill.spec.mods = { atkPct: num(bb[twice ? 'thorns_s_3[b].atk' : 'atk']), aspd: num(bb[twice ? 'thorns_s_3[b].attack_speed' : 'attack_speed']) };
        skill._applyMods();
        if (twice) skill.timeLeft = Infinity;
      },
      onEnd({ unit }) { unit.profile.rangedScale = rangedScale; } },
  };
  return { skills, skill: skills[sid], trait: {
    afterHit(battle, unit, target) {
      const scale = num(def.traitBb.atk_scale_m);
      if (scale > 0 && enemy(target)) battle.dealDamage(unit, target, { amount: unit.s.atk * scale, type: 'arts', tags: ['module'] });
    },
  }, talents: [{ install(battle, unit) {
    onHitBy(battle, unit, ({ target, dmg }) => {
      if (!dmg.isAttack) return;
      const ranged = target.base.rangeRadius > 0;
      poison(battle, unit, target, num(t0[ranged ? 'damage[ranged]' : 'damage[normal]']), num(t0.duration), `thorns:poison:${unit.id}`, num(t0.max_cnt, 1));
    });
    battle.on('damaged', ({ target, dmg }) => {
      if (target !== unit || sid !== 'skchr_thorns_2' || !unit.skill.active || !unit.canAct || !dmg?.isAttack) return;
      if (battle.time < (unit.mem.thornsCounterAt ?? -Infinity) + num(bb.cooldown)) return;
      const profile = { ...unit.profile, noAttack: false, isSkill: true, attack: 'ranged', projectile: 'beam', maxTargets: num(bb.max_target, 4) };
      const targets = battle.enemiesInKeys(unit.rangeKeys, unit, profile).slice(0, profile.maxTargets);
      if (!targets.length) return;
      unit.mem.thornsCounterAt = battle.time;
      performAttack(battle, unit, profile, targets);
    }, { owner: unit });
    battle.every(1, () => {
      if (op(unit) && battle.time - unit.lastAttackAt >= num(t1.delay)) battle.heal(unit, unit, unit.s.maxHp * num(t1.hp_recovery_per_sec_by_max_hp_ratio), { self: true, tags: ['talent'] });
    }, { owner: unit });
  } }] };
}

function blaze(bb, chess, def) {
  const sid = selectedId(chess, def), t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
  const skills = {
    skchr_huang_1: { kind: 'instant', attack: { atkScale: num(bb.atk_scale, 1) } },
    skchr_huang_2: { kind: 'toggle', mods: { atkPct: num(bb.atk), defPct: num(bb.def) }, targeting: skillTargeting(def) },
    skchr_huang_3: { kind: 'duration', duration: def.skill.duration,
      targeting: { rangeGrid: [[0, 1]], allInRange: true },
      attack: { hitAllBlocked: false, allInRange: true, projectile: 'beam' },
      onStart({ unit }) { unit.mem.blazeRamp = 0; },
      onTick({ battle, unit, dt }) {
        unit.mem.blazeRamp = Math.min(1, unit.mem.blazeRamp + dt / def.skill.duration);
        battle.addBuff(unit, { key: 'blaze:ramp', mods: { atkPct: num(bb.atk) * unit.mem.blazeRamp, defPct: num(bb.def) * unit.mem.blazeRamp }, tags: ['skill'] });
      },
      onEnd({ battle, unit, reason }) {
        if (reason !== 'death' && op(unit)) {
          for (const e of battle.foesInRadius(unit.x, unit.y, 1.5, true)) damage(battle, unit, e, unit.s.atk * num(bb.damage_by_atk_scale), 'phys');
          battle.loseHp(unit, unit.s.maxHp * num(bb.hp_ratio), { source: unit, tags: ['skill'] });
        }
        battle.removeBuff(unit, 'blaze:ramp');
      },
    },
  };
  return { skills, skill: skills[sid], trait: {
    dmgMul(battle, unit, target) { return target.blockedBy ? num(def.traitBb.atk_scale, 1) : 1; },
  }, talents: [{ install(battle, unit) {
    const save = () => {
      if (unit.mem.blazeSaved || !op(unit)) return false;
      unit.mem.blazeSaved = true;
      unit.mem.blazeLockUntil = battle.time + num(t0['huang_t_1[lock].duration']);
      unit.hp = Math.min(unit.s.maxHp, unit.hp + unit.s.maxHp * num(t0['huang_t_1[heal].hp_ratio']));
      return true;
    };
    battle.on('deploy', ({ unit: u }) => {
      if (u !== unit) return;
      unit.mem.blazeSaved = false;
      unit.mem.blazeLockUntil = -Infinity;
      unit.mem.blazeResist = false;
    }, { owner: unit });
    battle.on('fatal', (ctx) => {
      if (ctx.unit !== unit || ctx.prevented) return;
      save();
      if (battle.time < unit.mem.blazeLockUntil) {
        ctx.prevented = true;
        unit.hp = Math.max(unit.hp, unit.s.maxHp * num(t0['huang_t_1[lock].min_hp_ratio']));
      }
    }, { owner: unit, priority: 10 });
    battle.on('damaged', ({ target }) => {
      if (target !== unit || !op(unit)) return;
      if (unit.hpRatio < num(t0.hp_ratio)) save();
      if (battle.time < unit.mem.blazeLockUntil) unit.hp = Math.max(unit.hp, unit.s.maxHp * num(t0['huang_t_1[lock].min_hp_ratio']));
    }, { owner: unit });
    battle.on('tick', () => {
      if (!op(unit)) return;
      const age = battle.time - unit.deployedAt;
      if (!unit.mem.blazeResist && age >= num(t1.interval)) {
        unit.mem.blazeResist = true;
        battle.applyStatus(unit, 'resist', { duration: Infinity, value: Math.abs(num(t1.one_minus_status_resistance)), source: unit });
      }
      const atkAt = num(t1['huang_t_2[e_002_atk].interval'], Infinity);
      const aspdAt = num(t1['huang_t_2[e_002_atk_speed].interval'], Infinity);
      if (age >= atkAt || age >= aspdAt) battle.addBuff(unit, { key: 'blaze:module', mods: {
        atkPct: age >= atkAt ? num(t1['huang_t_2[e_002_atk].atk']) : 0,
        aspd: age >= aspdAt ? num(t1['huang_t_2[e_002_atk_speed].attack_speed']) : 0,
      } });
    }, { owner: unit });
  } }] };
}

function eyja(bb, chess, def) {
  const sid = selectedId(chess, def), t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
  let deployment = -1, casts = 0;
  const skills = {
    skchr_amgoat_1: { kind: 'duration',
      onStart({ unit, skill }) {
        if (deployment !== unit.deploySeq) { deployment = unit.deploySeq; casts = 0; }
        skill.spec.mods = { aspd: num(bb['amgoat_s_1[a].attack_speed']), atkPct: ++casts >= 2 ? num(bb['amgoat_s_1[b].atk']) : 0 };
        skill._applyMods();
      },
    },
    skchr_amgoat_2: { kind: 'charges', charges: def.skill.maxCharges,
      attack: { dmgType: 'arts', atkScale: num(bb.fk, 1), splashRadius: 1.5, splashScale: 0.5,
        onEachHit({ battle, unit, target }) {
          if (enemy(target)) battle.addBuff(target, { key: `eyja:res:${unit.id}`, duration: num(bb.duration), mods: { resMul: 1 + num(bb.magic_resistance) }, source: unit });
        },
      },
    },
    skchr_amgoat_3: { kind: 'duration', mods: { atkPct: num(bb.atk), batPct: flatBat(def, bb.base_attack_time) },
      targeting: { ...skillTargeting(def), maxTargets: num(bb['attack@max_target'], 1) }, attack: {},
    },
  };
  return { skills, skill: skills[sid], talents: [{ install(battle, unit) {
    const carriedAura = chess.module?.active && chess.module.level >= 2;
    const apply = () => {
      if (!carriedAura && !op(unit)) return;
      for (const a of battle.allies(unit.ownerId)) if (op(a) && a.def.profession === 'CASTER') battle.addBuff(a, { key: `eyja:flame:${unit.id}`, duration: 0.4, mods: { atkPct: num(t0.atk) }, source: unit });
    };
    battle.every(0.25, apply, { immediate: true, owner: unit });
    battle.on('deploy', ({ unit: u }) => {
      if (u === unit) unit.skill.gainSp(num(t1.sp_min) + battle.rng.int(num(t1.sp_max) - num(t1.sp_min)), 'talent');
    }, { owner: unit });
    if (num(def.traitBb.magic_resist_penetrate_fixed)) battle.addBuff(unit, { key: 'eyja:module', persist: true, allowDead: true, mods: { resIgnoreFlat: num(def.traitBb.magic_resist_penetrate_fixed) } });
    battle.on('beforeAttack', (ctx) => {
      if (ctx.attacker !== unit || sid !== 'skchr_amgoat_3' || !unit.skill.active) return;
      const targets = battle.enemiesInKeys(unit.rangeKeys, unit, ctx.profile);
      ctx.targets = battle.rng.shuffle(targets).slice(0, num(bb['attack@max_target'], 1));
    }, { owner: unit });
  } }] };
}

function ifrit(bb, chess, def) {
  const sid = selectedId(chess, def), t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
  const distanceScale = (unit, target) => {
    const tb = def.traitBb;
    const dist = Math.hypot(target.x - unit.x, target.y - unit.y);
    const span = Math.max(1, num(tb.max_dist) - num(tb.min_dist));
    return 1 + num(tb.damage_scale) * Math.max(0, Math.min(1, (dist - num(tb.min_dist)) / span));
  };
  const skills = {
    skchr_ifrit_1: { kind: 'duration', mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) } },
    skchr_ifrit_2: { kind: 'charges', charges: def.skill.maxCharges,
      attack: { atkScale: num(bb.atk_scale, 1), onEachHit({ battle, unit, target }) {
        if (!enemy(target)) return;
        battle.addBuff(target, { key: `ifrit:def:${unit.id}`, duration: num(bb.duration), mods: { defFlat: num(bb.def) }, source: unit });
        battle.addBuff(target, { key: `ifrit:burn:${unit.id}`, duration: num(bb.duration), interval: 1, source: unit,
          onTick: ({ unit: victim }) => damage(battle, unit, victim, unit.s.atk * num(bb['burn.atk_scale']), 'arts', ['skill', 'dot']) });
      } },
    },
    skchr_ifrit_3: { kind: 'duration', attack: { noAttack: true },
      onStart({ unit }) { unit.mem.ifritAura = 0; },
      onTick({ battle, unit, dt }) {
        unit.mem.ifritAura += dt;
        if (unit.mem.ifritAura + 1e-9 < 1) return;
        unit.mem.ifritAura -= 1;
        for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: false, groundOnly: true })) {
          battle.addBuff(e, { key: `ifrit:res:${unit.id}`, duration: 1.1, mods: { resFlat: num(bb.magic_resistance) }, source: unit });
          damage(battle, unit, e, unit.s.atk * num(bb.atk_scale) * distanceScale(unit, e), 'arts', ['skill', 'dot']);
        }
        battle.loseHp(unit, unit.s.maxHp * num(bb.hp_ratio), { source: unit, tags: ['skill'] });
      },
    },
  };
  return { skills, skill: skills[sid], trait: { dmgMul: (_battle, unit, target) => distanceScale(unit, target) }, talents: [{ install(battle, unit) {
    battle.every(0.25, () => {
      if (!op(unit)) return;
      for (const e of allInRange(battle, unit)) battle.addBuff(e, { key: `ifrit:talent:${unit.id}`, duration: 0.4, mods: { resMul: Math.max(0, 1 + num(t0.magic_resistance)) }, source: unit });
    }, { owner: unit, immediate: true });
    let elapsed = 0;
    battle.on('tick', ({ dt }) => {
      if (!op(unit)) return;
      elapsed += dt;
      const interval = num(t1.interval, 6);
      if (elapsed + 1e-9 < interval) return;
      elapsed -= interval;
      const extra = battle.rng.chance(num(t1['ifrit_e_002[dice_sp].prob'])) ? num(t1['ifrit_e_002[dice_sp].sp']) : 0;
      unit.skill.gainSp(num(t1.sp) + extra, 'talent');
    }, { owner: unit });
  } }] };
}

// The catalog offers only the first ADVANCED module for each external operator. Module bb values are
// merged into talents by the builder; the kit consumes those resolved values without inventing garrison state.

export const customKits = Object.freeze({
  char_340_shwaz: schwarz,
  char_112_siege: siege,
  char_293_thorns: thorns,
  char_017_huang: blaze,
  char_180_amgoat: eyja,
  char_134_ifrit: ifrit,
  char_2027_wang: wang,
  char_4182_oblvns: oblvns,
  char_4037_demetr: demetr,
});

export default customKits;
