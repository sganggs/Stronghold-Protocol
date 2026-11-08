// server/sim/content/kits/ops/ver-swllow.js — 灰喉 (char_367_swllow), 规程·序列Ⅰ.

import { textCount } from '../../../../../shared/plugins/textNumber.js';
import { moduleBb, num, statBuff, talentBb, traitBb, up } from '../shared/tier1.js';
import { chargeKind, descOf, kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_swllow_1';
const S2 = 'skchr_swllow_2';

function swllow(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const prob = num(t0.prob);
  const crit = num(t0.atk_scale, 1);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      // `cnt` is the charge count (maxChargeTime). The shot count is the text 「连续射击N次」.
      kind: chargeKind(rec),
      attack: {
        atkScale: num(sbb.atk_scale, 1),
        hits: textCount(descOf(rec), /连续射击(\d+)次/, 2, 'swllow-s1'),
      },
    };
    if (id === S2) return {
      kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk) },
      attack: { hits: textCount(descOf(rec), /(\d+)连射/, 3, 'swllow-s2') },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    // [ASSUMED] the elite 「攻击时有概率攻击力提升至150%」 multiplies the attack (on top of the fastshot fly scale
    // and a skill atkScale). It does not replace either. prob 0 (normal) leaves the profession dmgMul in place.
    trait: prob > 0 ? {
      dmgMul(battle, unit, target) {
        const fly = target?.isFlying ? (unit.profile.flyScale ?? 1) : 1;
        return fly * (battle.rng.chance(prob) ? crit : 1);
      },
    } : undefined,
    install(battle, unit) {
      statBuff(battle, unit, 'swllow:wind', { aspd: num(t0.attack_speed) });
      // MAR-Y 「范围内存在地面敌人时攻击速度+N」 is the hidden module talent. The trait line is empty of ASPD,
      // so this is the only copy. [ASSUMED] re-checked every 0.1s, the same cadence as the other MAR-Y kits.
      const ground = num(moduleBb(chess).attack_speed);
      if (!(ground > 0)) return;
      let on = false;
      battle.every(0.1, () => {
        const n = up(unit) ? battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).filter((e) => !e.isFlying).length : 0;
        const want = n >= 1;
        if (want === on && (!want || unit.findBuff('swllow:ground'))) return;
        on = want;
        if (want) battle.addBuff(unit, { key: 'swllow:ground', mods: { aspd: ground }, tags: ['talent'] });
        else battle.removeBuff(unit, 'swllow:ground');
      }, { owner: unit });
    },
  };
}

export default { char_367_swllow: swllow };
