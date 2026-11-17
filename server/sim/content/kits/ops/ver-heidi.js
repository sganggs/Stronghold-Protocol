// server/sim/content/kits/ops/ver-heidi.js — 海蒂 (char_4045_heidi), 第一期 (DESIGN §35.22.9).
// The trait regen is the bard profile. 私人信使 (talent index 1, sp_recovery_per_sec) is 破碎日冕 only and is not applied.
// The module's +8% while two other operators are in range is 最终加算 (atkFinal): the text says it is not affected by skills.

import { alliesInGridOf, moduleBb, num, talentBb, toggleBuff, up } from '../shared/tier1.js';
import { inspireStat, kitSkills } from '../shared/version.js';

const S1 = 'skchr_heidi_1';
const S2 = 'skchr_heidi_2';

function heidi(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const sid = chess?.skill?.skillId ?? def?.skill?.id;
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'duration', duration: rec?.duration,
      onTick({ battle, unit }) {
        const block = num(sbb.block_cnt);
        const val = unit.s.atk * num(sbb.atk);
        for (const a of alliesInGridOf(battle, unit)) {
          inspireStat(battle, a, val, unit, 'atk');
          if (block) battle.addBuff(a, { key: `heidi:block:${unit.id}`, mods: { blockCnt: block }, duration: 0.6, refresh: 'replace', source: unit });
        }
      },
    };
    if (id === S2) return {
      kind: 'duration', duration: rec?.duration,
      mods: { blockCnt: num(sbb.block_cnt) },
      onStart({ unit }) {
        unit.mem.heidiProf = unit.profile;
        unit.profile = { ...unit.profile, auraRatio: num(sbb['attack@atk_to_hp_recovery_ratio']) };
      },
      onTick({ battle, unit }) {
        for (const a of alliesInGridOf(battle, unit)) {
          inspireStat(battle, a, unit.s.def * num(sbb.def), unit, 'def');
          inspireStat(battle, a, unit.s.maxHp * num(sbb.max_hp), unit, 'hp');
        }
      },
      onEnd({ unit }) {
        if (unit.mem.heidiProf) unit.profile = unit.mem.heidiProf;
        unit.mem.heidiProf = null;
      },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      unit.mem.noInspire = true;
      const mods = sid === S1 ? { atkPct: num(t0.atk) } : sid === S2 ? { defPct: num(t0.def) } : null;
      if (mods && Object.values(mods)[0]) battle.every(0.5, () => {
        if (!up(unit)) return;
        for (const a of alliesInGridOf(battle, unit)) {
          if (a === unit) continue;
          battle.addBuff(a, { key: `heidi:keen:${unit.id}`, mods, duration: 0.7, refresh: 'replace', source: unit });
        }
      }, { owner: unit, immediate: true });
      const hidden = moduleBb(chess);
      const bonus = num(hidden.atk), cnt = num(hidden.cnt, 2);
      if (bonus > 0) toggleBuff(battle, unit, 'heidi:mod', () => {
        let n = 0;
        for (const a of alliesInGridOf(battle, unit)) if (a !== unit && a.kind === 'op') n++;
        return n >= cnt;
      }, () => ({ atkFinal: unit.base.atk * bonus }));
    },
  };
}

export default { char_4045_heidi: heidi };
