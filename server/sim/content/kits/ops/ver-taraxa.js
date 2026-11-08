// server/sim/content/kits/ops/ver-taraxa.js — 风絮 (char_4222_taraxa), 规程·序列Ⅰ.
// Watchman has no profession entry, so she heals as a medic. attack@base_attack_time is the new interval, not a
// batMod delta (passing the "间隔大幅度缩短" sentence into batMod would treat 0.2 as a ratio). Fly height / duration
// keys are animation only.

import { alliesInGridOf, cheb, holdProtect, num, talentBb, up } from '../shared/tier1.js';
import { kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_taraxa_1';
const S2 = 'skchr_taraxa_2';
const LIFTOFF = Object.freeze({ liftoff: true, blockFly: true });
// [ASSUMED] 周围 has no radius key. Chebyshev 1 is the eight tiles around the healed ally.
const SPLASH_R = 1;

const airborne = (a) => !!(a && (a.s.flags.liftoff || a.isFlying));

function lift(battle, unit) {
  battle.releaseBlocked(unit);
  battle.fx('takeoff', { x: unit.x, y: unit.y, id: unit.id });
}
function land(battle, unit) {
  battle.releaseBlocked(unit);
}

function splashHeal(battle, unit, target, scale, n) {
  if (!(n > 0) || !(scale > 0) || !target) return;
  const near = [];
  for (const a of battle.allyUnits) {
    if (!up(a) || a.kind === 'device' || a === target || cheb(target, a) > SPLASH_R) continue;
    if (!battle.allySelectable(a, unit)) continue;
    near.push(a);
  }
  near.sort((a, b) => a.hpRatio - b.hpRatio || a.deploySeq - b.deploySeq);
  const amount = unit.s.atk * scale;
  for (const a of near.slice(0, n)) battle.heal(unit, a, amount);
}

function taraxa(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const resist = num(t0.damage_resistance);
  const block = num(t0.block_cnt);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'duration', duration: posDur(rec),
      flags: LIFTOFF,
      attack: { healScale: num(sbb['attack@heal_scale'], 1) },
      onStart({ battle, unit }) {
        const next = num(sbb['attack@base_attack_time']);
        unit.mem.taraxaBat = unit.base.bat;
        if (next > 0) { unit.base.bat = next; unit.markDirty(); }
        lift(battle, unit);
      },
      onEnd({ battle, unit }) {
        if (unit.mem.taraxaBat != null) { unit.base.bat = unit.mem.taraxaBat; unit.markDirty(); }
        unit.mem.taraxaBat = null;
        land(battle, unit);
      },
    };
    if (id === S2) return {
      kind: 'duration', duration: posDur(rec),
      flags: LIFTOFF,
      mods: { atkPct: num(sbb['attack@atk']) },
      attack: { healScale: num(sbb['attack@heal_scale'], 1) },
      onStart({ battle, unit }) { lift(battle, unit); },
      onEnd({ battle, unit }) { land(battle, unit); },
      onHit({ battle, unit, target }) {
        splashHeal(battle, unit, target, num(sbb['attack@heal_scale_2']), Math.floor(num(sbb['attack@splash_num'])));
      },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      battle.on('beforeAttack', (ctx) => {
        if (ctx.attacker !== unit || !unit.skill?.active) return;
        if (unit.skill.id === S1) {
          const all = battle.injuredAlliesInKeys(unit.rangeKeys, unit);
          const pick = all.length ? battle.rng.pick(all) : null;
          ctx.targets = pick ? [pick] : [];
          return;
        }
        if (unit.skill.id !== S2) return;
        const injured = battle.injuredAlliesInKeys(unit.rangeKeys, unit);
        const targets = [];
        if (injured[0]) targets.push(injured[0]);
        // [ASSUMED] the extra 起飞 ally is added only once a heal target exists: a heal attack does not start otherwise.
        const extra = alliesInGridOf(battle, unit).find((a) => a !== injured[0] && airborne(a));
        if (extra) targets.push(extra);
        if (targets.length) ctx.targets = targets;
      }, { owner: unit });
      if (!(resist > 0) && !(block > 0)) return;
      const key = `taraxa:block:${unit.id}`;
      battle.every(0.25, () => {
        if (!up(unit)) return;
        for (const a of alliesInGridOf(battle, unit)) {
          if (!airborne(a)) continue;
          if (resist > 0) holdProtect(battle, a, resist, 0.5, unit);
          if (block > 0) battle.addBuff(a, { key, mods: { blockCnt: block }, duration: 0.5, refresh: 'replace', source: unit, tags: ['talent'] });
        }
      }, { owner: unit });
    },
  };
}

export default { char_4222_taraxa: taraxa };
