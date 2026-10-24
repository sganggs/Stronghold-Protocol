// server/sim/content/kits/ops/chess_char_4_06-kroos2.js — 寒芒克洛丝 (char_1021_kroos2) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { num, tbb, batFlat, skillActive, isSel, alt, withDefaults } from '../shared/tier4.js';

export default withDefaults({
  // ===== 寒芒克洛丝 (fastshot) S2 封喉 — double shot → 4 shots after 40 hits; talent 中的 (20 % ×1.5 + 0.2 s stun)
  //       S1 无痕 (ATK up, double shot, 迷彩 = the engine's `camou` flag: only an enemy she blocks targets her)
  chess_char_4_06_a: (bb, chess, def) => {
    const t0 = tbb(def, 0);
    const need = num(bb['attack@max_stack_count'], 40);
    const S2 = isSel(def, 'skchr_kroos2_2');
    return {
      skills: alt(def, {
        skchr_kroos2_1: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk) },
          flags: { camou: true },
          attack: { hits: 2, visualVolley: true },
          onStart({ battle, unit }) { battle.fx('camouflage', { x: unit.x, y: unit.y, id: unit.id }); },
        }),
      }),
      skill: {
        kind: 'duration',
        mods: { batPct: batFlat(def, bb.base_attack_time) },
        attack: { hitsFn: (battle, unit) => ((unit.mem.kroosHits ?? 0) >= need ? 4 : 2), visualVolley: true },
        onStart({ unit }) { unit.mem.kroosHits = 0; },
      },
      talents: [{ install(battle, unit) {
        // 中的: the ×1.5 is rolled before mitigation; the stun (and the S2 "击中目标" count) only for shots that landed
        const crits = new WeakSet();
        battle.on('hit', (c) => {
          if (c.source !== unit || !c.dmg.isAttack || c.target.side !== 'enemy') return;
          if (battle.rng.chance(num(t0.prob, 0.2))) { c.dmg.mul *= num(t0.atk_scale, 1.5); crits.add(c.dmg); }
        }, { owner: unit });
        battle.on('damaged', (c) => {
          if (c.source !== unit || !c.dmg || !c.dmg.isAttack || c.target.side !== 'enemy') return;
          if (S2 && skillActive(unit)) {
            unit.mem.kroosHits = (unit.mem.kroosHits ?? 0) + 1;
            if (unit.mem.kroosHits === need) battle.fx('quadShot', { x: unit.x, y: unit.y, id: unit.id });
          }
          if (!crits.has(c.dmg)) return;
          crits.delete(c.dmg);
          if (c.target.alive) battle.applyStatus(c.target, 'stun', { duration: num(t0.stun, 0.2), source: unit });
          battle.fx('crit', { x: c.target.x, y: c.target.y, id: c.target.id });
        }, { owner: unit });
      } }],
    };
  },
});
