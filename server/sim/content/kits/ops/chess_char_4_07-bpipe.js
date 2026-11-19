// server/sim/content/kits/ops/chess_char_4_07-bpipe.js — 风笛 (char_222_bpipe) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { sortEnemyTargets } from '../../../targeting.js';
import { num, tbb, batFlat, alt, withDefaults } from '../shared/tier4.js';

export default withDefaults({
  // ===== 风笛 (charger) S2 高效冲击 — next attack 145 % ×2 (charges); talents 精密填弹 / 军事传统
  //       S1 迅捷打击·γ型; S3 闭膛连发 (BAT +0.7 s, block +1, ATK/DEF up, triple hits); module CHG-Y (“棍棒与口袋”):
  //       attacks on enemies below 40 % HP use 115 % ATK
  chess_char_4_07_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const tb = def.traitBb || {};
    return {
      skills: alt(def, {
        'skcom_quickattack[3]': () => ({ kind: 'duration', mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) } }),
        skchr_bpipe_3: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk), defPct: num(bb.def), blockCnt: num(bb.block_cnt, 1), batPct: batFlat(def, bb.base_attack_time) },
          attack: { hits: 3 },
          onStart({ battle, unit }) { battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id }); },
        }),
      }),
      install(battle, unit) {
        const hr = num(tb.hp_ratio, 0), sc = num(tb.atk_scale, 0);
        if (!(hr > 0) || !(sc > 0)) return;
        battle.on('hit', (c) => { // 攻击力提升至115% (before mitigation)
          if (c.source === unit && c.dmg.isAttack && c.target.side === 'enemy' && c.target.hpRatio < hr) c.dmg.amount *= sc;
        }, { owner: unit });
      },
      skill: {
        kind: (def.skill?.maxCharges ?? 1) > 1 ? 'charges' : 'instant',
        attack: { atkScale: num(bb.atk_scale, 1.45), hits: 2 },
        onStart({ battle, unit }) { battle.fx('charge', { x: unit.x, y: unit.y, id: unit.id }); },
      },
      talents: [
        { install(battle, unit) { // 精密填弹: 25 % → ×1.3 and one extra target
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit) return;
            unit.mem.bpBoost = battle.rng.chance(num(t0.prob, 0.25));
            if (!unit.mem.bpBoost) return;
            const extra = battle.enemiesInKeys(unit.rangeKeys, unit, c.profile).filter((e) => !c.targets.includes(e));
            sortEnemyTargets(battle, unit, extra, c.profile?.priority ?? null);
            if (extra[0]) c.targets = [...c.targets, extra[0]];
          }, { owner: unit });
          battle.on('hit', (c) => { // 攻击力提升至 atk_scale, before DEF
            if (c.source === unit && c.dmg.isAttack && unit.mem.bpBoost) c.dmg.amount *= num(t0.atk_scale, 1.3);
          }, { owner: unit });
          battle.on('attack', (c) => { if (c.attacker === unit) unit.mem.bpBoost = false; }, { owner: unit });
        } },
        { install(battle, unit) { // 军事传统: every 先锋 of the team starts with +6 SP
          battle.on('deploy', (c) => {
            const u = c.unit;
            if (u.side !== 'ally' || u.kind !== 'op' || u.ownerId !== unit.ownerId || u.def?.profession !== 'PIONEER' || !u.skill || (u.skill.active && u.skill.isTimed)) return;
            u.skill.gainSp(num(t1.sp, 6), 'init');
          }, { owner: unit });
        } },
      ],
    };
  },
});
