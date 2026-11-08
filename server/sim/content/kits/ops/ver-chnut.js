// server/sim/content/kits/ops/ver-chnut.js — 褐果 (char_4041_chnut), 规程·序列Ⅰ.
// 行医 heals element as well as HP (the profession). 脚踏实地 multiplies that element recovery on ground allies.
// S2 "连续治疗同一目标" raises both from the second heal of that target onward [ASSUMED: the first is unboosted].

import { alliesInGridOf, num, skillBbOf, talentBb, traitBb } from '../shared/tier1.js';
import { chargeKind, gridOf, kitSkills } from '../shared/version.js';

const S1 = 'skchr_chnut_1';
const S2 = 'skchr_chnut_2';

function pickPatient(battle, unit) {
  let list = alliesInGridOf(battle, unit);
  const others = list.filter((a) => a !== unit);
  if (others.length) list = others;
  let best = null;
  for (const a of list) if (!best || a.hpRatio < best.hpRatio) best = a;
  return best;
}

function chnut(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const tb = traitBb(chess);
  const gscale = num(t0.ep_heal_scale, 1);
  const ratio = num(tb.ep_heal_ratio, 0.5);
  const s2bb = skillBbOf(chess, S2);
  const cont = num(s2bb['attack@heal_continuously_scale'], 1);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      id, kind: chargeKind(rec),
      onStart({ battle, unit }) {
        const patient = pickPatient(battle, unit);
        if (!patient) return;
        const ground = patient.isFlying ? 1 : gscale;
        unit.mem.chnutDirect = true;
        try {
          battle.heal({ source: unit, target: patient, amount: unit.s.atk });
          battle.healElement({ target: patient, amount: unit.s.atk * num(sbb.trait_scale, 1) * ground });
        } finally {
          unit.mem.chnutDirect = false;
        }
      },
    };
    if (id === S2) return {
      id, kind: 'duration', duration: rec?.duration > 0 ? rec.duration : undefined,
      mods: { aspd: num(sbb.attack_speed) },
      targeting: { rangeGrid: gridOf(rec) },
      onStart({ unit }) { unit.mem.chnutPrev = null; },
    };
    return { id, kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      battle.on('heal', (ctx) => {
        if (ctx.source !== unit || ctx.opts?.regen || unit.mem.chnutDirect || !ctx.target) return;
        const sk = unit.skill;
        const s2on = !!(sk && sk.active && sk.id === S2);
        const repeat = s2on && ctx.target.id === unit.mem.chnutPrev;
        if (repeat && cont !== 1) ctx.amount *= cont;
        const applied = unit.s.atk * ratio;
        const ground = ctx.target.isFlying ? 1 : gscale;
        const extra = applied * ground * (repeat ? cont : 1) - applied;
        if (extra > 0) battle.healElement({ target: ctx.target, amount: extra });
        if (s2on) unit.mem.chnutPrev = ctx.target.id;
      }, { owner: unit });
    },
  };
}

export default { char_4041_chnut: chnut };
