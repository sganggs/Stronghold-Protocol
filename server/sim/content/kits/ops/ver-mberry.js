// server/sim/content/kits/ops/ver-mberry.js — 桑葚 (char_473_mberry), 第一期 (DESIGN §35.22.9).
// The trait element-heal ratio (and the hidden talent that repeats it) is the wandermedic profile.
// S2's element-injury cut is the strongest on the hit, the same slot as 哈洛德's 我即军营.

import { COLS } from '../../../constants.js';
import { batMod, num, skillBbOf, talentBb, up } from '../shared/tier1.js';
import { chargeKind, descOf, elemLoad, kitSkills } from '../shared/version.js';

const S1 = 'skchr_mberry_1';
const S2 = 'skchr_mberry_2';

function mberry(_bb, chess, def) {
  const atk = num(talentBb(chess, 0).atk);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: chargeKind(rec),
      attack: {
        healScale: num(sbb.heal_scale, 1),
        heal: { mode: 'single', elementHealRatio: num(sbb.ep_heal_ratio) },
      },
    };
    if (id === S2) return {
      kind: 'duration', duration: rec?.duration,
      mods: { batPct: batMod(sbb.base_attack_time, chess, descOf(rec)) },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      battle.on('beforeAttack', (ctx) => {
        if (ctx.attacker !== unit || !unit.skill) return;
        const sk = unit.skill;
        const on = (sk.id === S1 && sk.pending) || (sk.id === S2 && sk.active);
        if (!on) return;
        const cands = battle.injuredAlliesInKeys(unit.rangeKeys, unit, true);
        cands.sort((a, b) => elemLoad(b) - elemLoad(a) || a.hpRatio - b.hpRatio || a.deploySeq - b.deploySeq);
        if (cands.length) ctx.targets = [cands[0]];
      }, { owner: unit });
      battle.on('elementHit', (ctx) => {
        const sk = unit.skill;
        if (!up(unit) || !sk?.active || sk.id !== S2) return;
        const a = ctx.target, d = ctx.dmg;
        if (!a || a.side !== 'ally' || !d || d.type !== 'element') return;
        const keys = unit.rangeKeySet || new Set(unit.rangeKeys || []);
        if (!keys.has(a.tileR * COLS + a.tileC)) return;
        const r = Math.max(0, Math.min(1, num(skillBbOf(chess, S2).ep_damage_resistance)));
        if (!(r > 0)) return;
        const prev = d.haroldCut || 0;
        if (r <= prev) return;
        d.mul *= (1 - r) / (1 - prev);
        d.haroldCut = r;
      }, { owner: unit, priority: 20 });
      if (atk > 0) battle.every(0.5, () => {
        const medics = [];
        for (const a of battle.allyUnits) if (up(a) && a.kind === 'op' && a.def?.profession === 'MEDIC') medics.push(a);
        if (!up(unit) || !medics.some((a) => a !== unit)) return;
        for (const a of medics) battle.addBuff(a, { key: 'mberry:aide', mods: { atkPct: atk }, duration: 0.7, refresh: 'replace', source: unit });
      }, { owner: unit });
    },
  };
}

export default { char_473_mberry: mberry };
