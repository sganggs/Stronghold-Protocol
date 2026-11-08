// server/sim/content/kits/ops/ver-quercu.js — 夏栎 (char_492_quercu), 规程·序列Ⅰ.
// Trait: arts while idle; a running skill heals for heal_scale × ATK. 丛林的荫庇 is 庇护 while an ally in range
// is strictly above hp_ratio. The text names no period [ASSUMED: the shared 0.5 s pulse, held 0.75 s].

import { alliesInGridOf, giveSp, holdProtect, num, talentBb, traitBb, up } from '../shared/tier1.js';
import { kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_quercu_1';
const S2 = 'skchr_quercu_2';

function healAttack(scale) {
  return { dmgType: 'heal', heal: { mode: 'single' }, healScale: scale, projectile: 'none' };
}

function quercu(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const scale = num(traitBb(chess).heal_scale, 0.75);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      id, kind: 'toggle',
      mods: { atkPct: num(sbb.atk) },
      attack: healAttack(scale),
    };
    if (id === S2) return {
      id, kind: 'duration', duration: posDur(rec),
      mods: { aspd: num(sbb.attack_speed) },
      attack: healAttack(scale),
      onHit({ target }) { giveSp(target, num(sbb.sp), 'quercu'); },
    };
    return { id, kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      const gate = num(t0.hp_ratio, 0.7);
      const cut = num(t0.damage_resistance);
      if (!(cut > 0)) return;
      // [ASSUMED] no period in the text: refresh 庇护 every 0.5 s and hold it 0.75 s.
      battle.every(0.5, () => {
        if (!up(unit)) return;
        for (const a of alliesInGridOf(battle, unit)) {
          if (a.hpRatio > gate) holdProtect(battle, a, cut, 0.75, unit);
        }
      }, { owner: unit, immediate: true });
    },
  };
}

export default { char_492_quercu: quercu };
