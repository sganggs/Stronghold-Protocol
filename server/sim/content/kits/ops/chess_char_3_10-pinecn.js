// server/sim/content/kits/ops/chess_char_3_10-pinecn.js — 松果 (char_440_pinecn) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import { num, defOf, talentBb, selectedId, altSkills, instantKindOf, copyGrid } from '../shared/tier3.js';

export default {
  // ---- 3_10 松果 · 散射手 — S2 电能过载: ATK + growing with each use (a→d), shorter range; 便携电源: SP regen for 60 s
  chess_char_3_10_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const sel = selectedId(chess, d);
    const steps = Object.keys(bb).filter((k) => /\[[a-z]\]\.atk$/.test(k)).sort().map((k) => num(bb[k]));
    if (!steps.length) steps.push(num(bb.atk));
    const skillGrid = copyGrid(d.skill?.rangeGrid);
    const kit = {
      trait: { visualStyle: 'shotgunWave' }, // cosmetic opt-in; not shared by the scattershooter profession
      skill: {
        kind: 'duration',
        onStart({ battle, unit }) {
          const uses = unit.mem.pinecnS2Uses ?? 0;
          unit.mem.pinecnS2Uses = uses + 1;
          const atk = steps[Math.min(steps.length - 1, uses)];
          battle.addBuff(unit, { key: 'skill:pinecn_atk', mods: { atkPct: atk } });
        },
        onEnd({ battle, unit }) { battle.removeBuff(unit, 'skill:pinecn_atk'); },
      },
      // S1 RMA长钉 (charges): "立即以165%的攻击力进行一次攻击，无视敌人180的防御力" — an extra shot fired at once (all
      // enemies in range, front-row × of the trait), on top of the normal attack it was cast before
      skills: altSkills(chess, d, bb, {
        skchr_pinecn_1: (s) => ({
          kind: instantKindOf(s),
          // (the DEF ignore rides on the shots' tag: they land after the instant skill has ended)
          attack: { atkScale: num(s.bb.atk_scale, 1), tags: ['skill', 'pinecnSpike'] },
          onStart({ battle, unit }) { battle.forceAttack(unit); },
        }),
      }),
      talents: [{ install(battle, unit) {
        battle.on('deploy', (ctx) => {
          if (ctx.unit !== unit) return;
          // PRTS 松果: count skill uses since this deployment; the runtime's activation identity stays cumulative.
          unit.mem.pinecnS2Uses = 0;
          battle.addBuff(unit, { key: 'talent:pinecn_power', duration: num(t0.duration, 60), mods: { spRecoveryFlat: num(t0.sp_recovery_per_sec) } });
        }, { owner: unit });
      } }],
    };
    if (sel === 'skchr_pinecn_1') {
      const pen = num(bb.def_penetrate_fixed, 0);
      kit.install = (battle, unit) => battle.on('hit', (ctx) => {
        if (ctx.source === unit && pen > 0 && ctx.dmg.tags?.includes('pinecnSpike')) ctx.dmg.defIgnoreFlat += pen;
      }, { owner: unit });
    }
    if (skillGrid) {
      kit.skill.targeting = { rangeGrid: skillGrid };
      // "攻击范围缩短": offensive skills fire with an enemy inside the SKILL range (research 03 §1.4) — with the
      // initial (wider) range she would open the skill on enemies the shortened range cannot reach
      kit.skill.trigger = { rule: 'CUSTOM_RANGE', grid: skillGrid };
    }
    return kit;
  },
};
