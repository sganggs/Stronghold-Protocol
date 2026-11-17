// server/sim/content/kits/ops/ver-bluep.js — 蓝毒 (char_129_bluep), 规程·序列Ⅰ.
// Fast-shot priority and the empty trait are the profession. MAR-Y "范围内存在地面敌人时攻击速度+8" is refused by
// traitMods (the same sentence as 空弦 / 能天使) and applied here. attack@times is the extra shot M3's sentence
// describes; at these ranks the sentence is only the extra targets, so times is not a hit count.

import { hasHp } from '../../../attack.js';
import { isMainHit, moduleBb, num, onHitBy, talentBb } from '../shared/tier1.js';
import { descOf, extraTargets, kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_bluep_1';
const S2 = 'skchr_bluep_2';

function bluep(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const poisonDur = num(t0.duration);
  const poisonDmg = num(t0.poison_damage);
  const ground = num(moduleBb(chess).attack_speed);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    const extra = extraTargets(descOf(rec));
    const maxTargets = extra > 0 ? 1 + extra : undefined;
    if (id === S1) return {
      kind: 'instant',
      attack: { atkScale: num(sbb.atk_scale, 1) },
      targeting: maxTargets ? { maxTargets } : undefined,
    };
    if (id === S2) return {
      kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk) },
      targeting: maxTargets ? { maxTargets } : undefined,
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      if (poisonDur > 0 && poisonDmg > 0) onHitBy(battle, unit, ({ target, dmg }) => {
        if (!isMainHit(dmg) || !hasHp(target)) return;
        const key = `bluep:poison:${unit.id}`;
        battle.addBuff(target, {
          key, duration: poisonDur, refresh: 'extend', interval: 1, source: unit, tags: ['talent', 'dot'],
          data: { dmg: poisonDmg },
          onTick({ battle: bt, unit: tgt }) {
            if (!tgt.alive || !hasHp(tgt)) return;
            bt.dealDamage({
              source: unit, target: tgt, amount: poisonDmg, type: 'arts',
              calculation: 'precomputed', tags: ['talent', 'dot', 'bluep:poison'],
            });
          },
        });
      });
      if (!(ground > 0)) return;
      const key = 'bluep:ground';
      let on = false;
      battle.every(0.1, () => {
        const n = upGround(battle, unit);
        const want = n >= 1;
        if (want === on && (!want || unit.findBuff(key))) return;
        on = want;
        if (want) battle.addBuff(unit, { key, mods: { aspd: ground }, tags: ['talent'] });
        else battle.removeBuff(unit, key);
      }, { owner: unit });
    },
  };
}

function upGround(battle, unit) {
  if (!unit.alive || !unit.deployed || !unit.rangeKeys) return 0;
  return battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).filter((e) => !e.isFlying).length;
}

export default { char_129_bluep: bluep };
