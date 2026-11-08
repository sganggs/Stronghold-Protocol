// server/sim/content/kits/ops/ver-buildr.js — 青枳 (char_488_buildr), 规程·序列Ⅰ.
// Pioneer block-2 is the stat line. The second cast's periodic DP is not beginDp: that helper stops after a packet
// count, and this cast does not end. S2 is a toggle that counts its own duration (棘刺 S3's pattern, op-thorns.js): a
// duration skill may not hold an infinite timeLeft (test/helpers/battleHarness.js checkInvariants).

import { num, talentBb, toggleBuff, traitBb, up } from '../shared/tier1.js';
import { kitSkills, posDur } from '../shared/version.js';

const S1 = 'skcom_charge_cost[3]';
const S2 = 'skchr_buildr_2';

function buildr(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const tb = traitBb(chess);
  const hp = num(t0.max_hp);
  const wait = num(t0.interval);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      // [ASSUMED] the built trigger is DEFAULT. 「立即获得部署费用」fires when SP is full (讯使 / 德克萨斯).
      kind: 'instant', trigger: 'SP_FULL',
      onStart({ battle, unit }) { battle.addDp(unit.ownerId, num(sbb.cost), unit); },
    };
    if (id === S2) return {
      kind: 'toggle', duration: posDur(rec),
      onStart({ battle, unit, skill }) {
        // [ASSUMED] later casts still grant the immediate cost. "额外" is the periodic packet, not a replacement of it.
        battle.addDp(unit.ownerId, num(sbb.cost), unit);
        const uses = (unit.mem.buildrUses || 0) + 1;
        unit.mem.buildrUses = uses;
        const second = uses >= 2;
        const atk = num(second ? sbb['buildr_s_2[b].atk'] : sbb.atk);
        const defv = num(second ? sbb['buildr_s_2[b].def'] : sbb.def);
        const mods = {};
        if (atk) mods.atkPct = atk;
        if (defv) mods.defPct = defv;
        if (Object.keys(mods).length) battle.addBuff(unit, { key: 'buildr:s2', mods, source: unit });
        skill.timeLeft = second ? Infinity : Math.max(0.01, skill.duration);
        if (!second) { unit.mem.buildrDp = null; return; }
        unit.mem.buildrDp = {
          acc: 0,
          iv: num(sbb['buildr_s_2[b].interval']),
          per: num(sbb['buildr_s_2[b].cost']),
        };
      },
      onTick({ battle, unit, skill, dt }) {
        if (Number.isFinite(skill.timeLeft)) {
          skill.timeLeft -= dt;
          if (skill.timeLeft <= 1e-9) { skill.end('duration'); return; }
        }
        const m = unit.mem.buildrDp;
        if (!m || !(m.iv > 0) || !(m.per > 0)) return;
        m.acc += dt;
        let guard = 0;
        while (m.acc + 1e-9 >= m.iv && guard++ < 8) { // loop-cap: 8 packets per tick
          m.acc -= m.iv;
          battle.addDp(unit.ownerId, m.per, unit);
        }
      },
      onEnd({ battle, unit }) {
        battle.removeBuff(unit, 'buildr:s2');
        unit.mem.buildrDp = null;
      },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      const atk = num(tb.atk), defv = num(tb.def);
      if (atk || defv) toggleBuff(battle, unit, 'buildr:block', () => unit.blocking.length > 0, { atkPct: atk, defPct: defv });
      if (!(hp > 0) || !(wait > 0)) return;
      battle.on('deploy', (ctx) => {
        if (ctx.unit !== unit) return;
        // [ASSUMED] "第二次及以后" counts this deployment, not the whole battle.
        unit.mem.buildrUses = 0;
        const seq = unit.deploySeq;
        battle.after(wait, () => {
          if (!up(unit) || unit.deploySeq !== seq) return;
          battle.addBuff(unit, { key: 'buildr:hp', mods: { hpPct: hp }, source: unit, tags: ['talent'] });
        }, { owner: unit });
      }, { owner: unit });
    },
  };
}

export default { char_488_buildr: buildr };
