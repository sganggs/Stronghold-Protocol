// server/sim/content/kits/ops/ver-highmo.js — 海沫 (char_4066_highmo), 规程·序列Ⅰ.
// The reaper self-heal stays the profession. Talent 1 「在【水月与深蓝之树】中」 is IS3-only and is not applied.

import { textCount } from '../../../../../shared/plugins/textNumber.js';
import { isHpLoss } from '../../../attack.js';
import { num, skillBbOf, talentBb, up } from '../shared/tier1.js';
import { descOf, kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_highmo_1';
const S2 = 'skchr_highmo_2';

function highmo(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'instant',
      attack: {
        atkScale: num(sbb.atk_scale, 1),
        hits: textCount(descOf(rec), /连续攻击(两|\d+)次/, 2, 'highmo-s1'),
      },
    };
    if (id === S2) return {
      kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk), dodgePhys: num(sbb.prob) },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      // [ASSUMED] 「每攻击到一个敌人回复自身N元素损伤，最大生效数等于阻挡数」 uses the reaper trait's 0.05s window and
      // the block-count stat (not how many she is blocking right now). The text names no element, so every gauge
      // recovers N. A block count of 0 does not open the window.
      const healN = num(t0.value);
      if (healN > 0) {
        let windowEnd = -Infinity, accepted = 0, limit = 0;
        battle.on('damageOutput', (c) => {
          if (c.source !== unit || !up(unit) || !c.target || c.target.side !== 'enemy' || !(c.amount > 0)) return;
          if (!c.dmg || !c.dmg.isAttack || isHpLoss(c.dmg) || c.dmg.type === 'element') return;
          if (battle.time + 1e-9 >= windowEnd) {
            limit = Math.max(0, Math.floor(unit.s.blockCnt));
            if (!limit) return;
            windowEnd = battle.time + 0.05;
            accepted = 0;
          }
          if (accepted >= limit) return;
          accepted++;
          battle.healElement({ target: unit, amount: healN });
        }, { owner: unit });
      }
      const ratio = num(skillBbOf(chess, S2).hp_ratio);
      if (!(ratio > 0)) return;
      battle.on('kill', (c) => {
        const v = c.victim;
        if (!up(unit) || !v || v.side !== 'enemy') return;
        if (!unit.skill?.active || unit.skill.id !== S2) return;
        if (!battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).includes(v)) return;
        battle.heal({ source: unit, target: unit, amount: unit.s.maxHp * ratio, self: true });
      }, { owner: unit });
    },
  };
}

export default { char_4066_highmo: highmo };
