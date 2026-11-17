// server/sim/content/kits/ops/chess_char_1_20-liskam.js — 雷蛇 (char_107_liskam) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import {
  num, talentBb, talentGrid, moduleOn, up, hurtSpDamage, giveSp, onDamagedOn, alliesInGridOf, statBuff, installReveal,
  skillBbOf,
} from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_20 雷蛇 反击电弧 (hurt SP): attack interval ×(1 + base_attack_time) (PRTS "攻击间隔增大(+70%)": a RATIO for this skill,
  // 1.2 → 2.04 s — not +0.7 s), ATK +atk, arts attacks on up to attack@max_target enemies,
  // attack@buff_prob to stun attack@stun s; afterwards 雷蛇 is stunned `stun` s.
  // 技能策略 → DEFAULT (PR #12; DESIGN §21.29): 反击电弧 is an offensive skill (ATK +125 %, arts hits on up to 3 enemies,
  // stun); the official 下半 TANK row (TAKE_DAMAGE for every MANUAL 重装 skill) made it — and 深巡's S2 — wait for a hit
  // (GitHub issue #4). The owner's deliberate deviation from that row (2026-10-03, community feedback) gives both
  // 哨戒铁卫 S2s the basic strategy; the data says DEFAULT too (rawRule keeps the official TAKE_DAMAGE).
  // 战术防御: when attacked, +sp SP to herself and to one random ally in the talent grid. Elite 雷抗: RES +magic_resistance.
  // Elite module (SPT-X): stealth of enemies inside the range is cancelled.
  // Alternate S1 充能防御 (AUTO, hurt SP, "技能自动开启" — an AUTO skill takes no 技能策略: SP_FULL, so the hit that fills SP
  // sets it off): PRTS "技能拥有8s的持续时间": for bb.duration s DEF +def, and the next damage instance taken is blocked
  // (cancelled — a blocked hit "导致第一天赋无法触发": no 战术防御 SP, no hurt SP).
  chess_char_1_20_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const grid = talentGrid(chess, 0);
    const S1 = 'skchr_liskam_1';
    const b1 = skillBbOf(chess, S1);
    const blockKey = 'liskam:block';
    return {
      skills: {
        [S1]: {
          kind: 'duration', duration: num(b1.duration, 8), mods: { defPct: num(b1.def) }, trigger: 'SP_FULL',
          onStart({ battle, unit, skill }) {
            battle.addBuff(unit, { key: blockKey, duration: skill.duration + 0.05, tags: ['skill'], visible: true,
              injury(c) {
                if (!c.block()) return;
                battle.removeBuff(unit, c.buff);
                battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id });
              },
            });
            battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id });
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, blockKey); },
        },
      },
      install(battle, unit) {
        if (moduleOn(chess) && chess.isGolden) installReveal(battle, unit);
      },
      skill: {
        trigger: 'DEFAULT',
        kind: 'duration', mods: { atkPct: num(bb.atk), batPct: Math.max(0, num(bb.base_attack_time)) },
        targeting: { maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 1))) },
        attack: {
          dmgType: 'arts',
          onHit({ battle, unit, target }) {
            if (target && target.alive && battle.rng.chance(num(bb['attack@buff_prob']))) battle.applyStatus(target, 'stun', { duration: num(bb['attack@stun']), source: unit });
          },
        },
        onEnd({ battle, unit, reason }) {
          if (reason !== 'death' && unit.alive && num(bb.stun) > 0) battle.applyStatus(unit, 'stun', { duration: num(bb.stun), source: unit });
        },
      },
      talents: [{ install(battle, unit) {
        const sp = num(t.sp);
        if (sp > 0) {
          // PRTS 备注 "仅伤害量不为0且能够触发受击回复的伤害才能触发此天赋": any such damage, not only an enemy attack
          // (a zone tick, the 源石溶剂 drain — player report D1 audit)
          onDamagedOn(battle, unit, (ctx) => {
            if (!hurtSpDamage(ctx) || !up(unit)) return;
            giveSp(unit, sp);
            const mates = alliesInGridOf(battle, unit, grid ?? [[1, 0], [0, -1], [0, 1], [-1, 0]]).filter((a) => a !== unit && a.skill && !a.skill.noSkill);
            const m = battle.rng.pick(mates);
            if (m) giveSp(m, sp);
          });
        }
        statBuff(battle, unit, 'talent:liskam', { resFlat: num(talentBb(chess, 1).magic_resistance) });
      } }],
    };
  },
};
