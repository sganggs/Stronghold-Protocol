// server/sim/content/kits/ops/ver-pianst.js — 车尔尼 (char_4047_pianst), 规程·序列Ⅰ.
// 回声 reflects atk_scale × his current ATK when he takes arts. magic_resistance on S1 is a multiplier (0.65 → ×1.65),
// not +65 RES. S2's fxbound / interval keys are VFX and are not simulated. S2's end burst is the 3×3 he stands in
// [ASSUMED: 周围 includes his own tile; the 8-neighbour ring would miss an enemy he is blocking].

import { enemiesInGrid, num, statBuff, talentBb, traitBb } from '../shared/tier1.js';
import { kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_pianst_1';
const S2 = 'skchr_pianst_2';
const STACK = 'pianst:stack';
const GRID3 = Object.freeze([[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 0], [0, 1], [1, -1], [1, 0], [1, 1]]);

function artsAttack() {
  return { dmgType: 'arts' };
}

function pianst(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const echo = num(t0.atk_scale);
  const traitScale = num(traitBb(chess).atk_scale);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      id, kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk), resMul: 1 + num(sbb.magic_resistance) },
      attack: artsAttack(),
    };
    if (id === S2) return {
      id, kind: 'duration', duration: posDur(rec),
      mods: { hpPct: num(sbb.max_hp), taunt: num(sbb.taunt_level) },
      attack: artsAttack(),
      onEnd({ battle, unit }) {
        const amount = unit.s.atk * num(sbb.atk_scale, 1);
        for (const e of enemiesInGrid(battle, unit, GRID3)) {
          battle.dealDamage({ source: unit, target: e, amount, type: 'arts', isSkill: true, tags: ['skill'] });
        }
        battle.removeBuff(unit, STACK);
      },
    };
    return { id, kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      statBuff(battle, unit, 'pianst:echo', { resFlat: num(t0.magic_resistance) });
      const per = num(skillBbOfStack(chess));
      const cap = Math.max(1, Math.floor(num(skillBbOfCap(chess), 10)));
      battle.on('hit', (ctx) => {
        const d = ctx.dmg;
        if (!d) return;
        const tags = d.tags;
        if (tags && (tags.includes('pianst:echo') || tags.includes('pianst:trait'))) return;
        if (ctx.target === unit && d.type === 'arts' && ctx.source?.side === 'enemy' && ctx.source.alive && echo > 0) {
          battle.dealDamage({
            source: unit, target: ctx.source, amount: unit.s.atk * echo, type: 'arts', isSkill: true, tags: ['pianst:echo'],
          });
        }
        if (!(traitScale > 0)) return;
        const sk = unit.skill;
        if (!sk?.active) return;
        const mine = ctx.source === unit && d.isAttack;
        // `hit` carries the incoming amount on dmg (there is no ctx.amount; that field is the later `damaged` event).
        const taken = ctx.target === unit && ctx.source?.side === 'enemy' && d.type !== 'element' && d.amount > 0;
        if (!mine && !taken) return;
        const other = mine ? ctx.target : ctx.source;
        if (!other?.alive) return;
        battle.dealDamage({
          source: unit, target: other, amount: unit.s.atk * traitScale, type: 'arts', isSkill: true, tags: ['pianst:trait'],
        });
      }, { owner: unit });
      battle.on('damaged', (ctx) => {
        const sk = unit.skill;
        if (ctx.target !== unit || !sk?.active || sk.id !== S2) return;
        if (ctx.source?.side !== 'enemy' || ctx.type === 'element' || !(ctx.amount > 0)) return;
        if (!(per > 0)) return;
        battle.addBuff(unit, { key: STACK, refresh: 'stack', maxStacks: cap, mods: { atkPct: per } });
      }, { owner: unit });
    },
  };
}

function skillBbOfStack(chess) {
  const s = (chess?.skills ?? []).find((x) => x && x.skillId === S2);
  return s?.bb?.atk;
}

function skillBbOfCap(chess) {
  const s = (chess?.skills ?? []).find((x) => x && x.skillId === S2);
  return s?.bb?.max_stack_cnt;
}

export default { char_4047_pianst: pianst };
