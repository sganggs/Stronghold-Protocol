// server/sim/content/kits/ops/chess_char_5_23-reckpr.js — 录武官 (char_4196_reckpr) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import { isHpLoss } from '../../../attack.js';
import {
  num, on, inRange, talent, traitBb, mods, isOp, lazySkills, instantKind, lowHpHealUp,
} from '../shared/tier5.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 录武官 — S2 一点关窍 (25 s): ATK +; healed allies get a 10 s buff healing 80/120 HP on every hit taken.
  // T1 学成于聚: an op in range starting a skill → +1 SP and ASPD +16 for 8 s. Module (elite): heals below 50 % ×1.15.
  // S1 触类旁通 (2/3 charges): the next heal restores heal_scale × ATK and heals max_target allies.
  chess_char_5_23_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), tb = traitBb(chess);
    const dur = num(bb['attack@buff_duration'], 10), value = num(bb['attack@fixed_heal_value']);
    return {
      skills: lazySkills({
        skchr_reckpr_1: () => ({ kind: instantKind(chess, def), heal: true, attack: { healScale: num(bb.heal_scale, 1), maxTargets: Math.max(1, num(bb.max_target, 2)) } }),
      }),
      skill: {
        kind: 'duration', heal: true,
        mods: mods({ atkPct: num(bb.atk) }),
        onHit({ battle, unit, target }) {
          // "治疗干员后为其施加一个增益": operators only (summons are 友方单位, not 干员)
          if (!target || !target.alive || !isOp(target) || !(value > 0)) return;
          battle.addBuff(target, { key: 'reckpr:guard', duration: dur, visible: true, data: { src: unit, value } });
        },
      },
      talents: [{ install(battle, unit) { // 学成于聚
        battle.on('skillStart', (c) => {
          const a = c.unit;
          if (a === unit || !isOp(a) || !on(unit) || !inRange(unit, a)) return;
          if (num(t0.prob, 1) < 1 && !battle.rng.chance(num(t0.prob, 1))) return;
          unit.skill?.gainSp(num(t0.sp), 'talent');
          if (num(t0.attack_speed)) battle.addBuff(unit, { key: 'reckpr:learn', duration: num(t0.duration, 8), mods: { aspd: num(t0.attack_speed) } });
        }, { owner: unit });
      } }],
      install(battle, unit) {
        battle.on('damaged', (c) => {
          const a = c.target;
          if (a.side !== 'ally' || !(c.amount > 0) || a.hp <= 0 || c.type === 'element' || isHpLoss(c.dmg)) return; // (not a 流失)
          const b = a.findBuff('reckpr:guard');
          if (b && b.data.src === unit) battle.heal(unit, a, num(b.data.value));
        }, { owner: unit });
        lowHpHealUp(battle, unit, tb);   // PHY-X: reckpr_e_002_tr filters LT (strictly below)
      },
    };
  },
};
