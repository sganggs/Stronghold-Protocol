// server/sim/content/kits/ops/chess_char_1_06-vendla.js — 刺玫 (char_494_vendla) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { num, talentBb, up, alliesInGridOf, skillBbOf } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_06 刺玫 荆藤庇荫: ATK +atk; the ally with the highest max HP in range gets taunt +taunt_level; whenever that ally is
  // attacked, 刺玫 deals atk_scale × ATK arts to the attacker, and the trait heal of THAT damage (scale × damage) goes to
  // that ally ("并仅对该角色触发刺玫特性"; en "…and activates her Trait on the ally"). Her own attacks keep healing the
  // lowest-HP ally in range — herself included — while the skill runs: client buff vendla_tr heals through the
  // S2TraitHealRange selector (the vendla_s_2 holder) only for a damage whose modifier carries the key vendla_s_2 (the
  // counter, vendla_s_2[extra_damage]), else through TraitHealRange (_excludeOwner 0, 禁疗 excluded). Until 0.2.0 every
  // damage she dealt during the skill healed the protégé, usually at full HP, so she healed nobody (community report of
  // 2026-10-06 「刺玫开技能（装备源石药剂）之后不能治疗」 — her 源石溶剂 drain went unhealed).
  // 土壤基肥改良: the highest-max-HP ally in range receives heal_scale × healing ("受到的治疗效果提升") — never its natural /
  // skill HP regeneration (the 生命回复速度 attribute is "不受治疗加成影响": 宴 分神, 角峰 体能强化; PRTS).
  // Alternate S1 战术咏唱·γ型: ASPD +attack_speed (the trait heal keeps going to the most injured ally in range).
  // Elite module INC-X (heal 60 % of the damage) is the incantation profile of the module trait (TUNE.incantationmedic).
  chess_char_1_06_a: (bb, chess) => {
    const hs = num(talentBb(chess, 0).heal_scale, 1);
    const tauntKey = 'vendla:taunt';
    const counterKey = unit => `vendla:counter:${unit.id}`;
    // the protégé only exists while 荆藤庇荫 runs (mem.protege is set by its onStart only)
    const protege = (u) => (u.skill?.active && up(u.mem.protege) ? u.mem.protege : null);
    return {
      skills: { 'skcom_magic_rage[3]': { kind: 'duration', mods: { aspd: num(skillBbOf(chess, 'skcom_magic_rage[3]').attack_speed) } } },
    // The shared incantation trait honors traitAlly on S2 counter damage.
      skill: {
        kind: 'duration', mods: { atkPct: num(bb.atk) },
        onStart({ battle, unit, skill }) {
          const cands = alliesInGridOf(battle, unit).sort((a, b) => b.s.maxHp - a.s.maxHp || a.deploySeq - b.deploySeq);
          const p = cands[0] ?? null;
          unit.mem.protege = p;
          if (!p) return;
          battle.addBuff(p, { key: tauntKey, duration: skill.duration + 0.1, mods: { taunt: num(bb.taunt_level, 1) }, visible: true, source: unit });
          battle.addBuff(p, { key: counterKey(unit), source: unit, duration: skill.duration + 0.1, tags: ['skill'], observeInjury(ctx) {
            // Native vendla_s_2 filters only the enemy source; neither damage tags nor the provider's action state.
            if (protege(unit) !== p || ctx.source?.side !== 'enemy' || !ctx.source.alive) return;
            battle.dealDamage({ source: unit, target: ctx.source, amount: unit.s.atk * num(bb.atk_scale), type: 'arts',
              isSkill: true, attackType: 'NORMAL', applyWay: 'RANGED', calculation: 'precomputed',
              ignoreSelect: true, tags: ['counter'], traitAlly: p });
            battle.fx('counter', { x: ctx.source.x, y: ctx.source.y, id: unit.id });
          } });
          battle.fx('taunt', { x: p.x, y: p.y, id: p.id });
        },
        onEnd({ battle, unit }) {
          if (unit.mem.protege) {
            const taunt = unit.mem.protege.findBuff(tauntKey);
            if (taunt?.source === unit) battle.removeBuff(unit.mem.protege, taunt);
            battle.removeBuff(unit.mem.protege, counterKey(unit));
          }
          unit.mem.protege = null;
        },
      },
      talents: [{ install(battle, unit) {
        if (hs !== 1) {
          let cacheT = -1, top = null;
          battle.on('heal', (ctx) => {
            if (!up(unit) || ctx.opts?.regen) return;
            if (cacheT !== battle.time) {
              cacheT = battle.time;
              top = alliesInGridOf(battle, unit).sort((a, b) => b.s.maxHp - a.s.maxHp || a.deploySeq - b.deploySeq)[0] ?? null;
            }
            if (ctx.target === top) ctx.amount *= hs;
          }, { owner: unit });
        }
      } }],
    };
  },
};
