// server/sim/content/kits/ops/chess_char_1_08-texas.js — 德克萨斯 (char_102_texas) kit, tier 1.
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { num, talentBb, enemiesInGrid, skillBbOf, RING1 } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_08 德克萨斯 剑雨: +cost DP; every enemy around (skill grid) takes two hits of atk_scale × ATK arts and is
  // stunned `stun` s — air units too (PRTS 备注 "※可对空"). 战术快递: +cost initial DP. (Elite hidden runtime_cost −4
  // "首次部署时部署费用-4": the initial deployment is free in battle ⇒ no effect.)
  // Alternate S1 冲锋号令·γ型 (AUTO, no target): +cost DP at once. An AUTO skill keeps its normal rule in this mode
  // (research 03 §1.4: only MANUAL skills are converted by the trigger table) ⇒ it fires as soon as SP is full.
  chess_char_1_08_a: (bb, chess, def) => ({
    skills: {
      'skcom_charge_cost[3]': {
        kind: 'instant', trigger: 'SP_FULL',
        onStart({ battle, unit }) {
          const n = num(skillBbOf(chess, 'skcom_charge_cost[3]').cost);
          battle.addDp(unit.ownerId, n, unit);
          battle.fx('dp', { x: unit.x, y: unit.y, n, id: unit.id });
        },
      },
    },
    skill: {
      kind: 'instant',
      onStart({ battle, unit }) {
        battle.addDp(unit.ownerId, num(bb.cost), unit);
        battle.fx('dp', { x: unit.x, y: unit.y, n: num(bb.cost), id: unit.id });
        const grid = def?.skill?.rangeGrid;
        const foes = grid ? enemiesInGrid(battle, unit, grid) : battle.foesInRadius(unit.x, unit.y, RING1).filter((e) => !e.s.flags.untargetable);
        battle.fx('aoe', { x: unit.x, y: unit.y, radius: 2, id: unit.id, skill: 'swordRain' });
        for (const e of foes) {
          for (let i = 0; i < 2 && e.alive; i++) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'arts', isSkill: true, tags: ['skill'] });
          if (e.alive) battle.applyStatus(e, 'stun', { duration: num(bb.stun), source: unit });
        }
      },
    },
    talents: [{ install(battle, unit) {
      const n = num(talentBb(chess, 0).cost);
      if (n > 0) battle.on('battleStart', () => battle.addDp(unit.ownerId, n), { owner: unit });
    } }],
  }),
};
