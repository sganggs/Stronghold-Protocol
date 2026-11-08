// server/sim/content/kits/ops/ver-aosta.js — 奥斯塔 (char_346_aosta), 规程·序列Ⅰ.
// The reaperrange front-line scale stays the profession. The bleed says 不受特性影响, so it is a separate arts tick.

import { batMod, isMainHit, num, onHitBy, skillBbOf, talentBb, up } from '../shared/tier1.js';
import { descOf, kitSkills, posDur } from '../shared/version.js';

const S1 = 'skcom_quickattack[3]';
const S2 = 'skchr_aosta_2';

function aosta(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk), aspd: num(sbb.attack_speed) },
    };
    if (id === S2) return {
      kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk), batPct: batMod(sbb.base_attack_time, chess, descOf(rec)) },
      attack: {
        onHit({ battle, unit, target }) {
          const dur = num(sbb['attack@frozen_duration']);
          if (target?.alive && dur > 0) battle.applyStatus(target, 'bind', { duration: dur, source: unit });
        },
      },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      const scale = num(t0.atk_scale);
      const dur = num(t0.duration);
      if (!(scale > 0) || !(dur > 0)) return;
      // [ASSUMED] one arts tick per second (the template has no interval; the talent duration is 3s). Applied from an
      // attack hit only while the target is unblocked, and each tick skips — it does not remove the buff — while the
      // target is blocked or 奥斯塔 is off the field. The S2 multiplier is read live, not snapshotted. Not an attack,
      // so it cannot re-apply itself, and the front-line scale never multiplies it.
      onHitBy(battle, unit, ({ target, dmg }) => {
        if (!isMainHit(dmg) || !target?.alive || target.blockedBy) return;
        if (dmg.tags && dmg.tags.includes('aosta:bleed')) return;
        battle.addBuff(target, {
          key: `aosta:bleed:${unit.id}`, duration: dur, interval: 1, refresh: 'replace', source: unit,
          tags: ['aosta:bleed', 'dot'],
          onTick({ battle: b, unit: tgt }) {
            if (!up(unit) || tgt.blockedBy) return;
            const mul = unit.skill?.active && unit.skill.id === S2 ? num(skillBbOf(chess, S2).talent_scale, 1) : 1;
            b.dealDamage({
              source: unit, target: tgt, amount: unit.s.atk * scale * mul, type: 'arts',
              attackType: 'BUFF', isSkill: true, tags: ['aosta:bleed', 'dot'],
            });
          },
        });
      });
    },
  };
}

export default { char_346_aosta: aosta };
