// server/sim/content/kits/ops/chess_char_4_15-reckpr.js — 录武官 (char_4196_reckpr) kit, tier 4 (hidden).
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { COLS } from '../../../constants.js';
import { isHpLoss } from '../../../attack.js';
import { num, tbb, keySet, skillActive, installLowHpHealBonus, withDefaults } from '../shared/tier4.js';

export default withDefaults({
  // ===== 录武官 (physician, hidden) S2 一点关窍 — +ATK; healed allies regain 80 HP per hit taken for 10 s; 学成于聚
  chess_char_4_15_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const tb = def.traitBb || {};
    return {
      skill: {
        kind: 'duration', heal: true,
        mods: { atkPct: num(bb.atk) },
        onStart({ battle, unit }) { battle.fx('knack', { x: unit.x, y: unit.y, id: unit.id }); },
        onHit({ battle, unit, target }) {
          if (target && target.alive && target.side === 'ally' && target.kind === 'op') battle.addBuff(target, { key: `reckpr:guard:${unit.id}`, duration: num(bb['attack@buff_duration'], 10), visible: true, source: unit });
        },
      },
      talents: [{ install(battle, unit) { // 学成于聚: an operator in range casts ⇒ +1 SP and ASPD +16 for 8 s
        battle.on('skillStart', (c) => {
          const a = c.unit;
          if (a === unit || a.side !== 'ally' || a.kind !== 'op' || !unit.alive || !unit.deployed || !keySet(unit).has(a.tileR * COLS + a.tileC)) return;
          if (!battle.rng.chance(num(t0.prob, 1))) return;
          if (!skillActive(unit)) unit.skill?.gainSp(num(t0.sp, 1), 'talent');
          battle.addBuff(unit, { key: 'reckpr:t1', duration: num(t0.duration, 8), mods: { aspd: num(t0.attack_speed, 16) }, maxStacks: Math.max(1, num(t0.max_stack_cnt, 1)) });
        }, { owner: unit });
      } }],
      install(battle, unit) {
        battle.on('damaged', (c) => {
          const t = c.target;
          if (t.side !== 'ally' || !t.alive || !(c.amount > 0) || isHpLoss(c.dmg) || !t.findBuff(`reckpr:guard:${unit.id}`)) return;
          battle.heal(unit, t, num(bb['attack@fixed_heal_value'], 80));
        }, { owner: unit });
        installLowHpHealBonus(battle, unit, tb);   // PHY-X: reckpr_e_002_tr filters LT (strictly below)
      },
    };
  },
});
