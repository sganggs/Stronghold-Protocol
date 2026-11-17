// server/sim/content/kits/ops/ver-nothin.js — 乌有 (char_455_nothin), 规程·序列Ⅰ.
// The DP drain and the retreat when it cannot be paid are the merchant profession. performAttack stamps
// lastAttackAt before the hit, so the ambush is decided in beforeAttack and applied on the hit.

import { isMainHit, num, onHitBy, skillBbOf, statBuff, talentBb } from '../shared/tier1.js';
import { kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_nothin_1';
const S2 = 'skchr_nothin_2';

function nothin(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const delay = num(t0.delay);
  const ambush = num(t0.atk_scale, 1);
  const stun = num(t0.stun);
  const s1 = skillBbOf(chess, S1);
  const s2 = skillBbOf(chess, S2);
  const selected = chess?.skill?.skillId ?? def?.skill?.id ?? null;
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      // The built trigger is DEFAULT. 「当生命低于N%时」opens it; an enemy in range does not.
      kind: 'duration', duration: posDur(rec), trigger: 'NEVER',
      attack: { noAttack: true },
      flags: { noBlock: true },
      mods: { taunt: num(sbb.taunt_level), hpRegenRatio: num(sbb.hp_recovery_per_sec_by_max_hp_ratio) },
    };
    if (id === S2) return {
      kind: 'toggle',
      mods: { atkPct: num(sbb.atk) },
      onStart({ battle, unit }) {
        const roll = battle.rng.int(3);
        unit.mem.nothinBranch = roll;
        if (roll === 1) battle.addBuff(unit, { key: 'nothin:branch', mods: { aspd: num(sbb.attack_speed) }, source: unit });
        else if (roll === 2) battle.addBuff(unit, { key: 'nothin:branch', mods: { dodgePhys: num(sbb.prob), blockCnt: num(sbb.block_cnt) }, source: unit });
      },
      onEnd({ battle, unit }) {
        unit.mem.nothinBranch = null;
        battle.removeBuff(unit, 'nothin:branch');
      },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      if (selected === S1 && num(s1.block_cnt)) statBuff(battle, unit, 'nothin:block', { blockCnt: num(s1.block_cnt) });
      battle.on('deploy', (ctx) => {
        if (ctx.unit === unit) unit.mem.nothinAt = battle.time;
      }, { owner: unit });
      battle.on('beforeAttack', (ctx) => {
        if (ctx.attacker !== unit) return;
        unit.mem.nothinAmbush = delay > 0 && battle.time - (unit.mem.nothinAt ?? battle.time) >= delay - 1e-9;
      }, { owner: unit });
      onHitBy(battle, unit, ({ target, dmg }) => {
        if (!isMainHit(dmg)) return;
        if (unit.mem.nothinAmbush) {
          if (ambush !== 1) dmg.mul *= ambush;
          if (stun > 0 && target.alive) battle.applyStatus(target, 'stun', { duration: stun, source: unit });
          unit.mem.nothinAmbush = false;
        }
        unit.mem.nothinAt = battle.time;
      });
      const slow = num(s2['nothin_s_2[a][attack_speed_down].attack_speed']);
      const slowDur = num(s2['nothin_s_2[a][attack_speed_down].duration']);
      if (slow && slowDur > 0) onHitBy(battle, unit, ({ target, dmg }) => {
        if (unit.skill?.id !== S2 || !unit.skill.active || unit.mem.nothinBranch !== 0) return;
        if (!isMainHit(dmg) || !target.alive) return;
        battle.addBuff(target, { key: 'nothin:slow', mods: { aspd: slow }, duration: slowDur, refresh: 'replace', source: unit });
      });
      if (selected !== S1) return;
      const ratio = num(s1.max_hp_ratio);
      battle.on('tick', () => {
        if (!unit.alive || !unit.deployed) return;
        const sk = unit.skill;
        if (!sk || sk.id !== S1 || !sk.ready || sk.active) return;
        if (ratio > 0 && unit.hpRatio < ratio - 1e-9) sk.activate('hp');
      }, { owner: unit });
    },
  };
}

export default { char_455_nothin: nothin };
