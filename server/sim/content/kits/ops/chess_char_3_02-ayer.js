// server/sim/content/kits/ops/chess_char_3_02-ayer.js — 断崖 (char_294_ayer) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import {
  num, defOf, talentBb, traitBb, altSkills, instantKindOf, alive, gridKeys, fx, copyGrid, NINE, aura,
} from '../shared/tier3.js';
import { installLordArtsAddition } from '../shared/lord.js';

export default {
  // ---- 3_02 断崖 · 领主 — S2 浮游刃启动: arts, wider range, each attack hits every enemy blocked by allies around her
  chess_char_3_02_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const tb = traitBb(d);
    const tGrid = copyGrid(d.talents?.[0]?.rangeGrid) ?? NINE;
    const extra = num(bb.atk_scale, 1);
    const moduleArts = num(tb.atk_scale_m, 0);
    const skillGrid = copyGrid(d.skill?.rangeGrid);
    const kit = {
      skill: {
        kind: 'duration',
        attack: { dmgType: 'arts', atkScale: num(bb['attack@atk_scale'], 1) },
        onAttack({ battle, unit }) {
          // PRTS corrects the skill text to "自身与周围8格": include her own blocked enemies too.
          const seen = new Set();
          for (const a of battle.allyUnits) {
            if (!alive(a) || a.kind === 'device' || !a.blocking.length) continue;
            if (Math.abs(a.tileR - unit.tileR) > 1 || Math.abs(a.tileC - unit.tileC) > 1) continue;
            for (const e of a.blocking) {
              if (!e.alive || seen.has(e)) continue;
              seen.add(e);
              battle.dealDamage(unit, e, { amount: unit.s.atk * extra, type: 'arts', isSkill: true, tags: ['skill', 'melee', 'ayerBlade'] });
              fx(battle, 'strike', e, { src: unit.id, skill: 'ayer_2' });
            }
          }
        },
      },
      // S1 多导向散射弹丸: next attack hits up to max_target enemies in range for atk_scale arts + 停顿
      skills: altSkills(chess, d, bb, {
        skchr_ayer_1: (s) => {
          const slug = num(s.bb.sluggish, 0);
          return {
            kind: instantKindOf(s),
            targeting: { maxTargets: Math.max(1, Math.floor(num(s.bb.max_target, 1))) },
            attack: {
              dmgType: 'arts', atkScale: num(s.bb.atk_scale, 1),
              onEachHit({ battle, unit, target }) {
                if (slug > 0 && target && target.alive && target.side === 'enemy') battle.applyStatus(target, 'sluggish', { duration: slug, source: unit });
              },
            },
          };
        },
      }),
      talents: [{ install(battle, unit) {
        aura(battle, unit, { key: 'talent:ayer_aspd', side: 'ally', tiles: () => gridKeys(tGrid, unit), filter: (a) => a.kind === 'op', mods: { aspd: num(t0.attack_speed) } });
      } }],
    };
    if (skillGrid) kit.skill.targeting = { rangeGrid: skillGrid };
    // ayer_e_002_tr excludes HitBlockee (our ayerBlade), then reads the current skill's atk_scale.
    if (moduleArts > 0) kit.install = (battle, unit) => {
      installLordArtsAddition(battle, unit, c => {
        if (c.dmg.tags.includes('ayerBlade')) return 0;
        // A pending S1 ends when its projectile is launched; the projectile retains the skill attack flag.
        const skillAttack = c.dmg.isAttack && c.dmg.isSkill;
        return moduleArts * (unit.skill && (unit.skill.active || skillAttack) ? num(unit.skill.bb.atk_scale, 1) : 1);
      });
    };
    return kit;
  },
};
