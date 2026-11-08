// server/sim/content/kits/ops/ver-acrbot.js — “暴躁铁皮” (char_618_acrbot), 规程·序列Ⅰ.
// 无法被友方治疗 is the unyield profession. The equipment-slot sentence is not simulated (no equip grid here).
// 荒蛮之心 splashes from the stripped base ATK. S1 cleanses 异常 already on her and refuses new ones
// [ASSUMED: the immunity covers a stun she is opened under, and every 异常 while the skill runs].
// She swings at allies in range: appended when the swing already has an enemy, and forced on the tick when it does not.

import { alliesInGridOf, batMod, num, statBuff, talentBb, traitBb } from '../shared/tier1.js';
import { ABNORMAL, cleanseAbnormal } from '../shared/tier6.js';
import { descOf, kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_acrbot_1';

function acrbot(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const t1 = talentBb(chess, 1);
  const tb = traitBb(chess);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      id, kind: 'duration', duration: posDur(rec),
      mods: {
        batPct: batMod(sbb.base_attack_time, chess, descOf(rec)),
        atkPct: num(sbb.atk),
        hpPct: num(sbb.max_hp),
      },
      onStart({ battle, unit }) { cleanseAbnormal(battle, unit); },
    };
    return { id, kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      statBuff(battle, unit, 'acrbot:chief', {
        rangeExtend: num(t1.ability_range_forward_extend),
        blockCnt: num(t1.block_cnt),
      });
      // Elite module: damage_scale 0.85 is the damage still taken ("降低15%"). The normal trait has no key.
      const cut = num(tb.damage_scale);
      if (tb.damage_scale != null && cut > 0 && cut < 1) {
        battle.on('hit', (ctx) => {
          if (ctx.target !== unit || !ctx.dmg || !ctx.source) return;
          if (!unit.blocking?.includes(ctx.source)) return;
          ctx.dmg.mul *= cut;
        }, { owner: unit });
      }
      battle.on('beforeStatus', (ctx) => {
        if (ctx.target !== unit) return;
        const sk = unit.skill;
        if (!sk?.active || sk.id !== S1) return;
        if (ABNORMAL.has(ctx.status)) ctx.cancel = true;
      }, { owner: unit });
      battle.on('beforeAttack', (ctx) => {
        if (ctx.attacker !== unit) return;
        const sk = unit.skill;
        if (!sk?.active || sk.id !== S1) return;
        const targets = ctx.targets || [];
        if (!targets.some((t) => t && t.side === 'enemy')) return;
        for (const a of alliesInGridOf(battle, unit)) {
          if (a !== unit && !targets.includes(a)) targets.push(a);
        }
        ctx.targets = targets;
      }, { owner: unit });
      battle.on('tick', () => {
        if (!unit.alive || !unit.deployed || unit.atkCd !== 0 || !unit.canAct || unit.s.flags.disarm) return;
        const sk = unit.skill;
        if (!sk?.active || sk.id !== S1) return;
        const allies = alliesInGridOf(battle, unit).filter((a) => a !== unit);
        if (!allies.length) return;
        if (battle.forceAttack(unit, allies)) unit.atkCd = unit.s.interval;
      }, { owner: unit });
      battle.on('death', (ctx) => {
        if (ctx.unit !== unit || ctx.reason !== 'killed') return;
        const amount = unit.s.atk * num(t0.atk_scale, 1);
        const stun = num(t0.stun);
        const radius = num(t0.projectile_range, 1.7);
        for (const e of battle.foesInRadius(unit.x, unit.y, radius, true)) {
          battle.dealDamage({ source: unit, target: e, amount, type: 'arts', isSkill: true, tags: ['skill'] });
          if (e.alive && stun > 0) battle.applyStatus(e, 'stun', { duration: stun, source: unit });
        }
      }, { owner: unit });
    },
  };
}

export default { char_618_acrbot: acrbot };
