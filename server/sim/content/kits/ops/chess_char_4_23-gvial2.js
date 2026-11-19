// server/sim/content/kits/ops/chess_char_4_23-gvial2.js — 百炼嘉维尔 (char_1026_gvial2) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import {
  num, tbb, grid, whileDeployed, toggleBuff, skillActive, isSel, alt, pullToFront, withDefaults,
} from '../shared/tier4.js';

export default withDefaults({
  // ===== 百炼嘉维尔 (centurion) S3 丛林之魂 — ATK/ASPD/block up, takes 50 % now, the rest as 20 s HP loss; talents; module
  //       S1 精准痛击 (ATK up, heals herself 30 %/35 % of the damage dealt); S2 链锯强袭 (wider range, ATK/DEF up, pulls
  //       unblocked enemies it hits to her front); module CEN-Y (好锯多磨): −20 % physical damage taken above 50 % HP
  chess_char_4_23_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const tb = def.traitBb || {};
    const dr = Math.max(0, Math.min(0.99, num(bb.damage_resistance, 0.5)));
    const fin = num(bb.final_duration, 20), iv = Math.max(1 / 30, num(bb.interval, 0.1));
    const S3 = isSel(def, 'skchr_gvial2_3');
    const g = grid(def.skill?.rangeGrid);
    return {
      skills: alt(def, {
        skchr_gvial2_1: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk) },
          onHit({ battle, unit, dealt }) { if (dealt > 0 && unit.alive) battle.heal(unit, unit, dealt * num(bb.heal_scale, 0.3), { self: true }); },
        }),
        skchr_gvial2_2: () => ({
          kind: 'duration',
          mods: { atkPct: num(bb.atk), defPct: num(bb.def) },
          targeting: g ? { rangeGrid: g } : undefined,
          attack: { onEachHit({ battle, unit, target }) { if (target && target.alive && !target.blockedBy) pullToFront(battle, unit, target, num(bb['attack@force'], 1)); } },
          onStart({ battle, unit }) { battle.fx('overload', { x: unit.x, y: unit.y, id: unit.id }); },
        }),
      }),
      skill: {
        kind: 'duration',
        mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed), blockCnt: num(bb.block_cnt, 2) },
        onStart({ battle, unit }) { unit.mem.gvialDebt = 0; battle.fx('jungleSoul', { x: unit.x, y: unit.y, id: unit.id }); },
        onEnd({ battle, unit, reason }) {
          const debt = unit.mem.gvialDebt ?? 0;
          unit.mem.gvialDebt = 0;
          if (reason === 'death' || !unit.alive || !(debt > 0)) return;
          const per = debt * iv / fin;
          battle.addBuff(unit, { key: 'gvial:bleed', refresh: 'independent', maxStacks: 10, duration: fin + 1e-6, interval: iv, visible: true,
            onTick: ({ unit: u }) => battle.loseHp(u, per) });
        },
      },
      talents: [
        { install(battle, unit) { // 战地巨斧: ATK/DEF +10 %, +4 % per extra blocked enemy
          whileDeployed(battle, unit, 0.1, () => {
            const extra = Math.max(0, unit.blocking.length - 1);
            toggleBuff(battle, unit, 'gvial:t1', true, { atkPct: num(t0.atk, 0.1) + num(t0.atk_add, 0.04) * extra, defPct: num(t0.def, 0.1) + num(t0.def_add, 0.04) * extra });
          });
        } },
        { install(battle, unit) { // 医学背景: healing received +20 %, +40 % below half HP
          battle.on('heal', (c) => { if (c.target === unit) c.amount *= unit.hpRatio < num(t1.hp_ratio, 0.5) ? num(t1.heal_scale_2, 1.4) : num(t1.heal_scale_1, 1.2); }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        const s = num(tb.atk_scale, 0); // module (elite): ATK raised to atk_scale against blocked enemies, before DEF
        if (s > 0) battle.on('hit', (c) => { if (c.source === unit && c.dmg.isAttack && c.target.blockedBy === unit) c.dmg.amount *= s; }, { owner: unit });
        const yr = num(tb.hp_ratio, 0), yd = num(tb.damage_resistance, 0); // module CEN-Y: 生命值高于50%时受到的物理伤害降低20%
        if (yr > 0 && yd > 0) battle.on('hit', (c) => { if (c.target === unit && c.dmg.type === 'phys' && unit.hpRatio > yr) c.dmg.mul *= 1 - yd; }, { owner: unit });
        if (!S3) return;
        const deferred = new WeakSet();
        battle.on('hit', (c) => {
          if (c.target !== unit || !skillActive(unit)) return;
          c.dmg.mul *= 1 - dr;
          deferred.add(c.dmg);
        }, { owner: unit, priority: -5 });
        battle.on('damaged', (c) => {
          if (c.target !== unit || !deferred.has(c.dmg)) return;
          deferred.delete(c.dmg);
          if (c.amount > 0) unit.mem.gvialDebt = (unit.mem.gvialDebt ?? 0) + (c.amount * dr) / (1 - dr);
        }, { owner: unit });
      },
    };
  },
});
