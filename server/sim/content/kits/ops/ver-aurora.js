// server/sim/content/kits/ops/ver-aurora.js — 极光 (char_422_aurora), 第一期 (DESIGN §35.22.9).
// Normal form: no SP unless she blocks (trait text; no sp_recover_ratio). Elite: ×(1 + sp_recover_ratio) while she
// blocks nobody, the same reading as 森蚺. The magazine is the number in the skill text — the flattened blackboard has no ammo key.

import { batMod, num, skillBbOf, toggleBuff, traitBb, talentBb } from '../shared/tier1.js';
import { ammoInText, descOf, kitSkills, resistValue } from '../shared/version.js';

const S1 = 'skchr_aurora_1';
const S2 = 'skchr_aurora_2';

function aurora(_bb, chess, def) {
  const tb = traitBb(chess);
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'duration', duration: rec?.duration,
      mods: { defPct: num(sbb.def), blockCnt: num(sbb.block_cnt) },
      onStart({ battle, unit, skill: sk }) {
        const r = resistValue(sbb.one_minus_status_resistance);
        if (r > 0) battle.applyStatus(unit, 'resist', { value: r, duration: sk.timeLeft, source: unit });
      },
      onEnd({ battle, unit }) {
        const st = num(sbb.stun);
        if (st > 0) battle.applyStatus(unit, 'stun', { duration: st, source: unit });
      },
    };
    if (id === S2) {
      // [ASSUMED] 9 when the text has no 「N发子弹」: the flattened blackboard has no ammo key, and the shop text says 装有9发子弹.
      const ammo = ammoInText(descOf(rec)) || 9;
      return {
        kind: 'ammo', ammo,
        mods: { atkPct: num(sbb.atk), batPct: batMod(sbb.base_attack_time, chess, descOf(rec)) },
        attack: {
          onHit({ battle, unit, target }) {
            if (!target?.alive || target.s?.flags?.freeze) return;
            const cold = num(sbb['attack@cold']);
            if (cold > 0) battle.applyStatus(target, 'cold', { duration: cold, source: unit });
          },
        },
      };
    }
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      const notBlocking = () => unit.blocking.length === 0;
      if (tb.sp_recover_ratio == null) toggleBuff(battle, unit, 'aurora:duel', notBlocking, null, { flags: { noSp: true } });
      else toggleBuff(battle, unit, 'aurora:duel', notBlocking, { spRecoveryMul: Math.max(0, 1 + num(tb.sp_recover_ratio)) });
      const ratio = num(t0.hp_recovery_per_sec_by_max_hp_ratio);
      const spRatio = num(t0.sp_ratio, 0.5);
      if (ratio > 0) toggleBuff(battle, unit, 'aurora:rest', () => {
        const sk = unit.skill;
        return !!sk && !sk.active && sk.sp <= sk.spCost * spRatio + 1e-9;
      }, { hpRegenRatio: ratio }, { flags: { disarm: true } });
      // A frozen target takes atk_scale × base ATK instead of the skilled ATK, and is not chilled again.
      battle.on('hit', (c) => {
        if (c.source !== unit || !c.dmg?.isAttack) return;
        const sk = unit.skill;
        if (!sk?.active || sk.id !== S2) return;
        const t = c.target;
        if (!t?.s?.flags?.freeze) return;
        const sb = skillBbOf(chess, S2);
        const atk = num(sb.atk), scale = num(sb.atk_scale, 1), denom = 1 + atk;
        if (denom > 1e-6) c.dmg.mul *= scale / denom;
      }, { owner: unit });
    },
  };
}

export default { char_422_aurora: aurora };
