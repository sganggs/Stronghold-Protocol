// server/sim/content/kits/ops/chess_char_4_17-hsguma.js — 星熊 (char_136_hsguma) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { AURA, num, tbb, whileDeployed, pulse, toggleBuff, isSel, alt, withDefaults } from '../shared/tier4.js';
import { byEnemyDamage } from '../shared/tier1.js';

export default withDefaults({
  // ===== 星熊 (protector) S2 荆棘 (passive) — DEF +13 %, answers every enemy damage instance with 65 % ATK phys on its source; talents
  //       S1 战意 (TAKE_DAMAGE: DEF/ATK up); S3 力之锯 (ATK/DEF up, cuts every enemy on her front tile — all enemies of her
  //       range); module PRO-X (护身符): DEF +20 % while blocking
  chess_char_4_17_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const tb = def.traitBb || {};
    const S2 = isSel(def, 'skchr_hsguma_2');
    return {
      skills: alt(def, {
        skchr_hsguma_1: () => ({ kind: 'duration', mods: { defPct: num(bb.def), atkPct: num(bb.atk) } }),
        skchr_hsguma_3: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk), defPct: num(bb.def) },
          targeting: { allInRange: true },
          onStart({ battle, unit }) { battle.fx('overclock', { x: unit.x, y: unit.y, id: unit.id }); },
        }),
      }),
      skill: { kind: 'passive', mods: { defPct: num(bb.def) } },
      talents: [
        { install(battle, unit) {
          // PRTS 星熊: unqualified damage block, including true damage; HP loss skips injury effects.
          battle.addBuff(unit, { key: 'hsguma:armor', persist: true, allowDead: true, injury(c) {
            if (c.block(num(t0.prob, 0.25))) battle.fx('block', { x: unit.x, y: unit.y, id: unit.id });
          } });
        } },
        { install(battle, unit) { // 特种作战策略: 重装 allies DEF +6 %
          whileDeployed(battle, unit, AURA, () => { for (const a of battle.allies(unit.ownerId)) if (a.def?.profession === 'TANK') pulse(battle, a, 'hsguma:def', { defPct: num(t1.def, 0.06) }); });
        } },
      ],
      install(battle, unit) {
        const bd = num(tb.def, 0); // module PRO-X: 阻挡敌人时防御力+20%
        if (bd) whileDeployed(battle, unit, 0.1, () => toggleBuff(battle, unit, 'hsguma:module', unit.blocking.length > 0, { defPct: bd }));
        if (!S2) return;
        // PRTS 伤判效果: inverse damage still observes an instance cancelled by dodge/block.
        battle.addBuff(unit, { key: 'hsguma:thorns', persist: true, allowDead: true, observeInjury(c) {
          const src = c.source;
          if (!unit.alive || !byEnemyDamage(c) || !src.alive) return;
          battle.dealDamage({ source: unit, target: src, amount: unit.s.atk * num(bb.atk_scale, 0.65),
            type: 'phys', dodgeMode: 'ignore', ignoreSelect: true, isSkill: true, tags: ['counter'] });
          battle.fx('thorns', { x: unit.x, y: unit.y, id: unit.id });
        } });
      },
    };
  },
});
