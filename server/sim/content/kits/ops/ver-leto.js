// server/sim/content/kits/ops/ver-leto.js — 烈夏 (char_194_leto), 规程·序列Ⅰ.
// The lord ranged penalty is the profession (atk_scale). The hidden "攻击范围内存在2名及以上敌人时攻击速度+12" is
// traitMods. Neither is repeated. The student list is the same set as op-poca.js (character_table teamId student).

import { num, talentBb, up } from '../shared/tier1.js';
import { kitSkills, posDur } from '../shared/version.js';

const S1 = 'skcom_quickattack[3]';
const S2 = 'skchr_leto_2';
const STUDENTS = new Set(['char_196_sunbr', 'char_115_headbr', 'char_194_leto', 'char_405_absin', 'char_195_glassb',
  'char_197_poca', 'char_1051_headb2']);

const isStudent = (a) => !!a && a.kind === 'op' && STUDENTS.has(a.def?.charId);

function leto(_bb, chess, def) {
  const aspd = num(talentBb(chess, 0).attack_speed);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk), aspd: num(sbb.attack_speed) },
    };
    if (id === S2) return {
      kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk) },
      targeting: { maxTargets: Math.max(1, Math.floor(num(sbb['attack@max_target'], 1))) },
      onStart({ battle, unit }) {
        unit.mem.letoProf = unit.profile;
        unit.profile = { ...unit.profile, rangedScale: 1 };
        for (const a of battle.allyUnits) {
          if (a === unit || !isStudent(a) || !up(a)) continue;
          const sk = a.skill;
          if (!sk || sk.noSkill || !sk.ready || a.s.flags.silence) continue;
          if (sk.active && sk.isTimed) continue;
          sk.activate('leto');
        }
      },
      onEnd({ unit }) {
        if (unit.mem.letoProf) unit.profile = unit.mem.letoProf;
        unit.mem.letoProf = null;
      },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      if (!(aspd > 0)) return;
      const key = `leto:rush:${unit.id}`;
      battle.every(0.25, () => {
        const on = up(unit) && !!(unit.skill && unit.skill.active && unit.skill.isTimed);
        for (const a of battle.allyUnits) {
          if (!isStudent(a) || !up(a)) continue;
          if (on) battle.addBuff(a, { key, mods: { aspd }, duration: 0.45, refresh: 'replace', source: unit, tags: ['talent'] });
          else if (a.findBuff(key)) battle.removeBuff(a, key);
        }
      }, { owner: unit });
    },
  };
}

export default { char_194_leto: leto };
