// server/sim/content/kits/ops/ver-mantic.js — 狮蝎 (char_215_mantic), 第一期 (DESIGN §35.22.9).
// Stalker dodge (`prob`) is the profession. The module slow is the hidden talent `move_speed` (攻击范围内所有敌人移动速度−20%).

import { batMod, isMainHit, moduleBb, num, onHitBy, talentBb, up } from '../shared/tier1.js';
import { descOf, installRangeSlow, kitSkills } from '../shared/version.js';

const S1 = 'skchr_mantic_1';
const S2 = 'skchr_mantic_2';
const HIDE = 'mantic:hide';

function mantic(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const sid = chess?.skill?.skillId ?? def?.skill?.id;
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return { kind: 'passive' };
    if (id === S2) return {
      kind: 'duration', duration: rec?.duration,
      mods: { atkPct: num(sbb.atk), batPct: batMod(sbb.base_attack_time, chess, descOf(rec)) },
      attack: {
        onHit({ battle, unit, target }) {
          const d = num(sbb['attack@stun']);
          if (target?.alive && d > 0) battle.applyStatus(target, 'stun', { duration: d, source: unit });
        },
      },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      installRangeSlow(battle, unit, moduleBb(chess).move_speed);
      if (sid === S1) {
        const slow = Math.abs(num(skillBb(chess, S1, 'move_speed')));
        const dur = num(skillBb(chess, S1, 'duration'));
        if (slow > 0 && dur > 0) onHitBy(battle, unit, ({ target, dmg }) => {
          if (dmg.isAttack && isMainHit(dmg) && target?.alive) battle.applyStatus(target, 'slow', { value: slow, duration: dur, source: unit });
        });
      }
      const bonus = num(t0.atk);
      const delay = num(t0.delay, 5);
      const hide = () => { if (!unit.findBuff(HIDE)) battle.addBuff(unit, { key: HIDE, flags: { stealth: true }, tags: ['talent'] }); };
      battle.on('deploy', (c) => {
        if (c.unit !== unit) return;
        unit.mem.manticSeen = null;
        unit.mem.manticReveal = false;
        hide();
      }, { owner: unit });
      battle.on('beforeAttack', (ctx) => {
        if (ctx.attacker !== unit) return;
        if (unit.findBuff(HIDE)) { battle.removeBuff(unit, HIDE); unit.mem.manticReveal = true; }
        unit.mem.manticSeen = battle.time; // [ASSUMED] an attack while visible restarts the timer back into stealth
      }, { owner: unit });
      if (bonus) onHitBy(battle, unit, ({ dmg }) => {
        if (!unit.mem.manticReveal || !dmg.isAttack || !isMainHit(dmg)) return;
        unit.mem.manticReveal = false;
        dmg.mul *= 1 + bonus;
      });
      battle.on('tick', () => {
        if (!up(unit) || unit.findBuff(HIDE) || unit.mem.manticSeen == null) return;
        if (battle.time - unit.mem.manticSeen + 1e-9 >= delay) hide();
      }, { owner: unit });
    },
  };
}

function skillBb(chess, id, key) {
  const rec = (chess?.skills ?? []).find((s) => s && s.skillId === id) ?? (chess?.skill?.skillId === id ? chess.skill : null);
  return rec?.bb?.[key];
}

export default { char_215_mantic: mantic };
