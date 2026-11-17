// server/sim/content/kits/ops/ver-glider.js — 蜜莓 (char_449_glider), 第一期 (DESIGN §35.22.9).
// The trait's element heal ratio is the wandermedic profile. "N名" is read from the skill text (the blackboard has no count).

import { alliesInGridOf, num, skillBbOf, skillRec, talentBb, up } from '../shared/tier1.js';
import { descOf, elemLoad, kitSkills, namedCount } from '../shared/version.js';

const S1 = 'skchr_glider_1';
const S2 = 'skchr_glider_2';

function glider(_bb, chess, def) {
  const hp = num(talentBb(chess, 0).max_hp);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'instant',
      attack: {},
      onHit({ battle, unit }) {
        const targets = (unit.mem.gliderTg || []).slice();
        unit.mem.gliderTg = null;
        const dur = num(sbb['glider_s_1.duration']);
        const iv = Math.max(0.05, num(sbb['glider_s_1.interval'], 1));
        const ratio = num(sbb['glider_s_1.ep_heal_ratio']);
        // [ASSUMED] the pulse count follows a zone: round(duration / interval), the first one immediate.
        const n = Math.max(1, Math.round(dur / iv));
        const once = () => {
          const amount = unit.s.atk * ratio;
          for (const t of targets) if (t?.alive) battle.healElement({ target: t, amount });
        };
        once();
        if (n <= 1) return;
        let k = 1;
        const h = battle.every(iv, () => {
          if (++k > n) { h.cancel(); return; }
          once();
        }, { owner: unit });
      },
    };
    if (id === S2) return { kind: 'duration', duration: rec?.duration, mods: { atkPct: num(sbb.atk) } };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      battle.on('beforeAttack', (ctx) => {
        if (ctx.attacker !== unit || !unit.skill) return;
        const sk = unit.skill;
        const s1 = sk.id === S1 && sk.pending;
        const s2 = sk.id === S2 && sk.active;
        if (!s1 && !s2) return;
        const cands = battle.injuredAlliesInKeys(unit.rangeKeys, unit, true);
        cands.sort((a, b) => elemLoad(b) - elemLoad(a) || a.hpRatio - b.hpRatio || a.deploySeq - b.deploySeq);
        const n = s1 ? namedCount(descOf(skillRec(chess, S1)), 2) : num(skillBbOf(chess, S2)['attack@max_target'], 1);
        if (cands.length) ctx.targets = cands.slice(0, Math.max(1, n));
        if (s1) unit.mem.gliderTg = (ctx.targets || []).slice();
      }, { owner: unit });
      if (hp > 0) battle.every(0.5, () => {
        if (!up(unit)) return;
        for (const a of alliesInGridOf(battle, unit)) {
          if (a === unit) continue;
          const ranged = a.def?.position === 'RANGED' || a.profile?.attack === 'ranged';
          if (!ranged) continue;
          battle.addBuff(a, { key: `glider:hp:${unit.id}`, mods: { hpPct: hp }, duration: 0.7, refresh: 'replace', source: unit });
        }
      }, { owner: unit, immediate: true });
    },
  };
}

export default { char_449_glider: glider };
