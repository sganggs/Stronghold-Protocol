// server/sim/content/kits/ops/ver-liesel.js — 复奏 (char_4031_liesel), 规程·序列Ⅰ.
// Splash-caster radius stays with the profession. The talent multiplies an attack (main and splash) when
// enough enemies stand in that splash. S2 is an instant cast, so the same check is done per strike.

/** [ASSUMED] 溅射范围扩大 has no radius in the chess blackboard. 夕 S1 uses 1.7 for the same words (PRTS 溅射半径扩大至1.7). */
const LIESEL_SPLASH = 1.7;

import { enemiesInGrid, num, talentBb, up } from '../shared/tier1.js';
import { chargeKind, kitSkills } from '../shared/version.js';

const S1 = 'skchr_liesel_1';
const S2 = 'skchr_liesel_2';

function liesel(_bb, chess) {
  const t0 = talentBb(chess, 0);
  const hasTalent = t0.damage_scale != null;
  const boost = num(t0.damage_scale, 1);
  const minN = num(t0.min_target_cnt, 3);
  const { skills, skill } = kitSkills(chess, null, (id, rec, sbb) => {
    if (id === S1) {
      return {
        kind: chargeKind(rec),
        attack: { atkScale: num(sbb.atk_scale, 1), splashRadius: LIESEL_SPLASH },
      };
    }
    if (id === S2) {
      const scale = num(sbb.atk_scale, 1);
      const n = Math.max(1, Math.floor(num(sbb.max_target_cnt, 1)));
      const dotScale = num(sbb['liesel_s_2[dot].atk_scale']);
      const dotDur = Math.round(num(sbb['liesel_s_2[dot].duration']));
      return {
        kind: 'instant',
        onStart({ battle, unit }) {
          const targets = enemiesInGrid(battle, unit, null, { n });
          const hit = new Set();
          for (const e of targets) {
            if (!e?.alive) continue;
            const cluster = battle.foesInRadius(e.x, e.y, LIESEL_SPLASH, true);
            // [ASSUMED] the expanded radius applies to this instant cast, and one enemy can take several strikes' splashes.
            const mul = hasTalent && cluster.length >= minN ? boost : 1;
            const amount = unit.s.atk * scale * mul;
            battle.dealDamage(unit, e, { amount, type: 'arts', tags: ['liesel:cast'] });
            hit.add(e.id);
            for (const o of cluster) {
              if (o === e || !o.alive) continue;
              battle.dealDamage(unit, o, { amount, type: 'arts', isSplash: true, tags: ['liesel:cast'] });
              hit.add(o.id);
            }
          }
          // [ASSUMED] the DoT snapshots ATK at cast and stops when she leaves. The first tick is one second later.
          if (!(dotDur > 0) || !(dotScale > 0) || !hit.size) return;
          const snap = unit.s.atk;
          let ticks = 0;
          battle.every(1, (b, sc) => {
            if (!up(unit) || ++ticks > dotDur) { sc.cancel(); return; }
            for (const foe of b.enemies) {
              if (!hit.has(foe.id) || !foe.alive) continue;
              b.dealDamage(unit, foe, { amount: snap * dotScale, type: 'arts', tags: ['liesel:dot', 'dot'] });
            }
          }, { owner: unit });
        },
      };
    }
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      if (!hasTalent) return;
      battle.on('beforeAttack', (ctx) => {
        if (ctx.attacker !== unit) return;
        unit.mem.lieselBoost = false;
        const primary = ctx.targets && ctx.targets[0];
        if (!primary) return;
        const r = ctx.profile?.splashRadius || unit.profile?.splashRadius || 1.1;
        if (battle.foesInRadius(primary.x, primary.y, r, true).length >= minN) unit.mem.lieselBoost = true;
      }, { owner: unit });
      battle.on('hit', (ctx) => {
        if (ctx.source !== unit || !unit.mem.lieselBoost || !ctx.dmg?.isAttack) return;
        const tags = ctx.dmg.tags || [];
        if (tags.includes('dot') || tags.includes('liesel:dot') || tags.includes('liesel:cast')) return;
        ctx.dmg.mul *= boost;
      }, { owner: unit });
    },
  };
}

export default { char_4031_liesel: liesel };
