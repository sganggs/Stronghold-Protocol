// server/sim/content/kits/ops/chess_char_6_06-pepe.js — 佩佩 (char_4058_pepe) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.

import {
  num, tbb, live, selectedSkill, batOf, skillGridOf, hasAbnormal, cleanseAbnormal, aura,
} from '../shared/tier6.js';

// ------------------------------------------------------------------------------------------------------------------
// 佩佩 chess_char_6_06 (撼地者) — S3 时光震荡; 往昔传承; 弥漫莲香; module 晴雨

function pepe(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const sid = selectedSkill(chess, def);
  const stackAtk = num(bb['attack@atk']), maxStack = Math.max(0, Math.floor(num(bb['attack@max_stack_cnt'])));
  const ext = num(bb['attack@ability_range_forward_extend']);
  const stun = num(bb['attack@stun']), stunMain = num(bb['attack@stun_main'], stun);
  // 往昔传承: "技能期间每击倒1名敌人，技能结束时获得N点技力，至多回复M点" (any timed skill of hers)
  const pastSp = (unit, skill) => {
    const gain = Math.min(num(t0.max_sp, Infinity), (unit.mem.pepeKills || 0) * num(t0.sp));
    unit.mem.pepeKills = 0;
    if (gain > 0 && unit.alive) skill.gainSp(gain, 'talent');
  };
  const skills = {
    // S1 盖戳！: next attack at atk_scale × ATK (splash included); castable while under a 异常状态, which it cleanses
    // (install below)
    skchr_pepe_1: { kind: 'instant', attack: { atkScale: num(bb.atk_scale, 1) } },
    // S2 阻遏混乱锤: skill range, ATK / ASPD +, random target in range; every use gives later casts ASPD
    // +attack_speed_extra (≤ max_stack_cnt stacks)
    skchr_pepe_2: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) },
      ...(skillGridOf(def) ? { targeting: { rangeGrid: skillGridOf(def) } } : {}),
      onStart({ battle, unit }) {
        unit.mem.pepeKills = 0;
        const n = unit.mem.pepeRage || 0;
        if (n > 0) battle.addBuff(unit, { key: 'pepe:rage', mods: { aspd: num(bb.attack_speed_extra) * n } });
        unit.mem.pepeRage = Math.min(Math.floor(num(bb.max_stack_cnt, 2)), n + 1);
      },
      onEnd({ battle, unit, skill }) { battle.removeBuff(unit, 'pepe:rage'); pastSp(unit, skill); },
    },
  };
  return {
    skills,
    install(battle, unit) {
      if (sid === 'skchr_pepe_1') {
        battle.on('tick', () => { // "处于异常状态时可以释放技能并清除异常状态"
          const sk = unit.skill;
          if (!live(unit) || !sk || !sk.ready || sk.active || !hasAbnormal(unit)) return;
          cleanseAbnormal(battle, unit);
          sk.activate('abnormal');
        }, { owner: unit });
      }
      if (sid === 'skchr_pepe_2') {
        battle.on('beforeAttack', (ctx) => { // 随机攻击范围内的目标 (and the enemies she blocks — Battle.blockedTargets)
          if (ctx.attacker !== unit || !unit.skill?.active) return;
          const c = battle.enemiesInKeys(unit.rangeKeys, unit, ctx.profile);
          for (const e of battle.blockedTargets(unit, ctx.profile)) if (!c.includes(e)) c.push(e);
          if (c.length) ctx.targets = [battle.rng.pick(c)];
        }, { owner: unit });
      }
    },
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), batPct: batOf(bb.base_attack_time, def) },
      attack: {
        splashRadius: 1,
        onHit({ battle, unit, target }) { if (target && target.alive && stunMain > 0) battle.applyStatus(target, 'stun', { duration: stunMain, source: unit }); },
      },
      onStart({ unit, skill }) {
        unit.mem.pepeStack = 0;
        unit.mem.pepeKills = 0;
        unit.mem.pepeR0 = num(unit.profile?.splashRadius, 1);
        skill.spec.attack.splashRadius = unit.mem.pepeR0;
      },
      onAttack({ battle, unit, skill }) {
        if (unit.mem.pepeStack >= maxStack) return;
        unit.mem.pepeStack++;
        battle.addBuff(unit, { key: 'pepe:tremor', mods: { atkPct: stackAtk * unit.mem.pepeStack } });
        skill.spec.attack.splashRadius = unit.mem.pepeR0 + ext * unit.mem.pepeStack;
      },
      onEnd({ battle, unit, skill }) {
        battle.removeBuff(unit, 'pepe:tremor');
        skill.spec.attack.splashRadius = unit.mem.pepeR0 ?? 1;
        pastSp(unit, skill);
      },
    },
    talents: [
      { install(battle, unit) { // S3 splash stun + 往昔传承 kill counter
        battle.on('damaged', (ctx) => {
          if (ctx.source !== unit || !unit.skill?.active || !ctx.dmg?.isSplash || !ctx.target.alive || stun <= 0) return;
          battle.applyStatus(ctx.target, 'stun', { duration: stun, source: unit });
        }, { owner: unit });
        battle.on('kill', ({ killer, victim }) => {
          if (killer === unit && victim.side === 'enemy' && unit.skill?.active) unit.mem.pepeKills = (unit.mem.pepeKills || 0) + 1;
        }, { owner: unit });
      } },
      { install(battle, unit) { // 弥漫莲香: every 近卫 op ATK +16 %
        const atk = num(t1.atk);
        if (atk) aura(battle, unit, 0.5, () => {
          for (const a of battle.allyUnits) if (live(a) && a.kind === 'op' && a.def?.profession === 'WARRIOR') battle.addBuff(a, { key: 'pepe:lotus', mods: { atkPct: atk }, duration: 0.75, refresh: 'replace' });
        });
      } },
      { install(battle, unit) { // elite module: ≥ cnt enemies in the splash area ⇒ this attack's ATK × atk_scale_e, before DEF
        const sc = num(tb.atk_scale_e, 1), cnt = num(tb.cnt, Infinity);
        if (!(sc > 1)) return;
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit) return;
          const t = ctx.targets[0];
          const r = num(ctx.profile?.splashRadius, 1);
          unit.mem.pepeBoost = !!t && battle.foesInRadius(t.x, t.y, r).length >= cnt;
        }, { owner: unit });
        battle.on('hit', (ctx) => { if (ctx.source === unit && ctx.dmg.isAttack && unit.mem.pepeBoost) ctx.dmg.amount *= sc; }, { owner: unit });
        battle.on('attack', (ctx) => { if (ctx.attacker === unit) unit.mem.pepeBoost = false; }, { owner: unit, priority: -100 });
      } },
    ],
  };
}

export default {
  chess_char_6_06_a: pepe,
};
