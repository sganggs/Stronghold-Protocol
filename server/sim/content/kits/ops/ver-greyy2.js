// server/sim/content/kits/ops/ver-greyy2.js — 承曦格雷伊 (char_1027_greyy2), 规程·序列Ⅰ.
// Bombarder splash and the two aftershocks are the profession. attack@enable_third_attack is not a shockTimes key
// (TUNE reads attack@times), so the third hit is a trait override. The ball is not makeZone: 8 / 1.5 would round to
// five pulses and drop the one at 7.5 s.

import { enemiesInGrid, isMainHit, num, onHitBy, talentBb, traitBb, up } from '../shared/tier1.js';
import { chargeKind, kitSkills, posDur } from '../shared/version.js';

const S1 = 'skcom_quickattack[3]';
const S2 = 'skchr_greyy2_2';
// [ASSUMED] no radius key. 周围 covers the aimed tile; 1.0 holds that tile (the trait splash 0.9 is the class attack).
const BALL_R = 1;

function launchBall(battle, unit, sbb) {
  const aim = enemiesInGrid(battle, unit, null, { canHitFly: false, groundOnly: true })[0];
  if (!aim) return;
  const x = aim.x, y = aim.y;
  const iv = Math.max(0.05, num(sbb.interval, 1.5));
  const dur = num(sbb.projectile_delay_time);
  const scale = num(sbb.atk_scale);
  const prob = num(sbb.prob);
  const slow = num(sbb.sluggish);
  let atk = unit.s.atk;
  let elapsed = 0;
  const pulse = () => {
    if (up(unit)) atk = unit.s.atk;
    battle.fx('zone', { x, y, radius: BALL_R, dur, id: unit.id, skill: S2 });
    // [ASSUMED] 所有敌人 names no 地面 limit, so the pulses reach flying enemies. Her trait attack stays ground-only.
    for (const e of battle.foesInRadius(x, y, BALL_R, true)) {
      battle.dealDamage(unit, e, {
        amount: atk * scale, type: 'arts', isSkill: true, tags: ['skill', 'greyy2:ball'],
      });
      if (e.alive && slow > 0 && battle.rng.chance(prob)) battle.applyStatus(e, 'sluggish', { duration: slow, source: unit });
    }
  };
  pulse();
  if (!(dur > 0)) return;
  // [ASSUMED] the ball is not owned by her: a knock-out does not cancel the remaining pulses.
  battle.every(iv, (_b, sc) => {
    elapsed += iv;
    if (elapsed > dur + 1e-9) { sc.cancel(); return; }
    pulse();
  });
}

function greyy2(_bb, chess, def) {
  const tb = traitBb(chess);
  const t0 = talentBb(chess, 0);
  const slowP = num(t0['attack@prob']);
  const slowD = num(t0['attack@sluggish']);
  const third = tb['attack@enable_third_attack'] ? 3 : 0;
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk), aspd: num(sbb.attack_speed) },
    };
    if (id === S2) return {
      kind: chargeKind(rec),
      onStart({ battle, unit }) { launchBall(battle, unit, sbb); },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    trait: third ? { shockTimes: third } : undefined,
    install(battle, unit) {
      if (!(slowP > 0) || !(slowD > 0)) return;
      onHitBy(battle, unit, ({ target, dmg }) => {
        if (!isMainHit(dmg) || !target.alive) return;
        if (!battle.rng.chance(slowP)) return;
        battle.applyStatus(target, 'sluggish', { duration: slowD, source: unit });
      });
    },
  };
}

export default { char_1027_greyy2: greyy2 };
