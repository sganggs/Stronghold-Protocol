// server/sim/content/kits/ops/chess_char_1_12-estell.js — 艾丝黛尔 (char_127_estell) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { absoluteRangeKeys } from '../../../targeting.js';
import { bodyInRange } from '../../../body.js';
import { num, talentBb, talentGrid, traitBb, up, cheb, onHitOn, skillBbOf } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_12 艾丝黛尔 舍身突击 (hurt SP): ATK +atk, cannot be healed by others. 自愈能力: an enemy dying within the talent
  // grid (8 surrounding tiles) heals her hp_ratio × max HP. Elite module (CEN-Y): above hp_ratio HP, physical damage
  // taken −damage_resistance.
  // Alternate S1 攻击力强化·β型: ATK +atk (she stays a heal target).
  chess_char_1_12_a: (bb, chess) => {
    const t = talentBb(chess, 0);
    const grid = talentGrid(chess, 0);
    const tb = traitBb(chess);
    // 舍身突击 is `skill` on the season where it is the default, and also keyed: 规程's default is the β型,
    // so a selected S2 must still find this spec (selectSkillSpec only falls back to `skill` for the default).
    const rush = { kind: 'duration', mods: { atkPct: num(bb.atk) }, flags: { noHeal: true } };
    return {
      skill: rush,
      skills: {
        skchr_estell_2: rush,
        'skcom_atk_up[2]': { kind: 'duration', mods: { atkPct: num(skillBbOf(chess, 'skcom_atk_up[2]').atk) } },
      },
      talents: [{ install(battle, unit) {
        battle.on('death', (ctx) => {
          const e = ctx.unit;
          if (e.side !== 'enemy' || ctx.reason !== 'killed' || !up(unit)) return;
          const near = grid ? bodyInRange(e, absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0)) : cheb(unit, e) <= 1;
          if (near) battle.heal(unit, unit, unit.s.maxHp * num(t.hp_ratio), { self: true, tags: ['talent'] });
        }, { owner: unit });
        if (tb.damage_resistance != null) {
          onHitOn(battle, unit, ({ dmg }) => { if (dmg.type === 'phys' && unit.hpRatio > num(tb.hp_ratio)) dmg.mul *= 1 - num(tb.damage_resistance); });
        }
      } }],
    };
  },
};
