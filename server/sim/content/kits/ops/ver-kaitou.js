// server/sim/content/kits/ops/ver-kaitou.js — 折光 (char_499_kaitou), 规程·序列Ⅰ.
// Primcaster has an empty profession profile: the element damage is this kit. "法术伤害N%的凋亡损伤" is N × the HP
// just removed; "相当于攻击力N%的元素伤害" is N × ATK, and only while the target is in an 凋亡 burst.

import { hasHp } from '../../../attack.js';
import { num, talentBb, toggleBuff, traitBb, up } from '../shared/tier1.js';
import { descOf, extraTargets, kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_kaitou_1';
const S2 = 'skchr_kaitou_2';
const BURST = ['burnBurst', 'neuralBurst', 'necrosisBurst', 'apoptosisBurst', 'erosionBurst'];
const inApoptosis = (e) => !!e?.findBuff?.('apoptosisBurst');
const anyBurst = (e) => BURST.some((k) => e.findBuff(k));

function kaitou(_bb, chess, def) {
  const warn = num(talentBb(chess, 0).atk);
  const scale = num(traitBb(chess).damage_scale);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return { kind: 'duration', duration: posDur(rec), mods: { atkPct: num(sbb.atk) } };
    if (id === S2) {
      const extra = extraTargets(descOf(rec));
      return {
        kind: 'duration', duration: posDur(rec),
        mods: { aspd: num(sbb.attack_speed) },
        targeting: extra > 0 ? { maxTargets: 1 + extra } : undefined,
      };
    }
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      if (warn > 0) toggleBuff(battle, unit, 'kaitou:warn', () => {
        if (!up(unit) || !unit.rangeKeys) return false;
        return battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).some(inApoptosis);
      }, { atkPct: warn });
      battle.on('hit', (ctx) => {
        if (ctx.source !== unit || !ctx.target || ctx.target.side !== 'enemy') return;
        const dmg = ctx.dmg;
        if (!dmg || !dmg.isAttack || (dmg.type !== 'arts' && dmg.type !== 'phys')) return;
        if (scale > 1 && anyBurst(ctx.target)) dmg.mul *= scale;
        if (!unit.skill?.active) return;
        const extra = num(unit.skill.bb['attack@extra_ep_damage_scale']);
        if (!(extra > 0) || !inApoptosis(ctx.target) || !hasHp(ctx.target)) return;
        battle.dealDamage(unit, ctx.target, {
          amount: unit.s.atk * extra, type: 'elemental', element: 'apoptosis',
          isSkill: true, tags: ['skill', 'kaitou:burst'],
        });
      }, { owner: unit });
      battle.on('damaged', (ctx) => {
        if (ctx.source !== unit || !unit.skill?.active || !ctx.target) return;
        const dmg = ctx.dmg;
        if (!dmg?.isAttack || (dmg.type !== 'arts' && dmg.type !== 'phys')) return;
        const ratio = num(unit.skill.bb['attack@ep_damage_ratio']);
        if (!(ratio > 0) || !(ctx.amount > 0) || !hasHp(ctx.target)) return;
        battle.dealDamage(unit, ctx.target, {
          amount: ctx.amount * ratio, type: 'element', element: 'apoptosis',
          isSkill: true, tags: ['skill', 'kaitou:apop'],
        });
      }, { owner: unit });
    },
  };
}

export default { char_499_kaitou: kaitou };
