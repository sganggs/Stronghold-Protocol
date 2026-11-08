// server/sim/content/kits/ops/ver-christ.js — Miss.Christine (char_4198_christ), 规程·序列Ⅰ.

import { enemiesInGrid, num, onHitBy, talentBb, traitBb, up } from '../shared/tier1.js';
import { kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_christ_1';
const S2 = 'skchr_christ_2';

function christ(_bb, chess, def) {
  const tb = traitBb(chess);
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk) },
      targeting: { maxTargets: Math.max(1, Math.floor(num(sbb['attack@max_target'], 1))) },
      attack: {
        onHit({ battle, unit, target, dealt }) {
          const ratio = num(sbb['attack@ep_damage_ratio']);
          if (!target?.alive || !(dealt > 0) || !(ratio > 0)) return;
          battle.dealElementDamage({ source: unit, target, amount: dealt * ratio, element: 'neural' });
        },
      },
    };
    if (id === S2) return {
      // `atk: 0` is not a modifier. She does not attack for the whole skill.
      kind: 'duration', duration: posDur(rec),
      attack: { noAttack: true },
      onStart({ battle, unit }) {
        // [ASSUMED] the spirit anchors on the enemy she would attack first, at that enemy's position (向目标所在的位置).
        // No enemy in range: no spirit, and she still stops attacking. Not a token. Pulses start after one interval.
        const anchor = enemiesInGrid(battle, unit, null, { canHitFly: true })[0];
        if (!anchor) return;
        const x = anchor.x, y = anchor.y;
        const interval = num(sbb.interval, 1);
        const total = Math.max(1, Math.round(num(sbb.projectile_delay_time, rec?.duration) / Math.max(interval, 1 / 30)));
        const radius = num(sbb.projectile_range, 1.5);
        const arts = num(sbb.atk_scale);
        const ep = num(sbb.atk_scale_ep);
        let n = 0;
        battle.every(interval, (b, sc) => {
          if (!up(unit) || !unit.skill?.active || unit.skill.id !== S2) { sc.cancel(); return; }
          for (const e of b.foesInRadius(x, y, radius)) {
            if (!e.alive) continue;
            b.dealDamage({
              source: unit, target: e, amount: unit.s.atk * arts, type: 'arts', isSkill: true, tags: ['christ:spirit'],
            });
            if (ep > 0 && e.alive && e.findBuff('neuralBurst')) {
              b.dealDamage({
                source: unit, target: e, amount: unit.s.atk * ep, type: 'elemental', isSkill: true, tags: ['christ:spirit:ep'],
              });
            }
          }
          if (++n >= total) sc.cancel();
        }, { owner: unit });
      },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      const feast = num(t0.atk_scale);
      if (feast > 0) battle.on('statusApplied', (c) => {
        if (c.status !== 'palsy' || !c.entered || !up(unit)) return;
        const e = c.target;
        if (!e || e.side !== 'enemy' || !e.alive) return;
        if (!battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).includes(e)) return;
        battle.dealDamage({
          source: unit, target: e, amount: unit.s.atk * feast, type: 'elemental', isSkill: true, tags: ['christ:feast'],
        });
      }, { owner: unit });
      // Module 「处于元素爆发期间的敌人受到的伤害提升」: every HP damage she deals while the target's burst lock holds.
      // Gauge fills never reach this hook. The burst's own hit has no source, so it is not multiplied.
      const amp = num(tb.damage_scale);
      if (amp > 1) onHitBy(battle, unit, ({ target, dmg }) => {
        if (target?.s?.flags?.burstLock) dmg.amount *= amp;
      });
    },
  };
}

export default { char_4198_christ: christ };
