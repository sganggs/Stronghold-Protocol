// server/sim/content/kits/ops/ver-wanqin.js — 万顷 (char_4119_wanqin), 第一期 (DESIGN §35.22.9).
// Block count 0 during a skill is the bearer profile. The front ally's +block is the trait blackboard.

import { RING1, alliesInGridOf, num, talentBb, traitBb, up } from '../shared/tier1.js';
import { beginDp, endDp, frontAlly, gridOf, kitSkills, tickDp } from '../shared/version.js';

const S1 = 'skcom_assist_cost[3]';
const S2 = 'skchr_wanqin_2';

function wanqin(_bb, chess, def) {
  const tb = traitBb(chess);
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      kind: 'duration', duration: rec?.duration, flags: { disarm: true },
      onStart({ unit }) { beginDp(unit, 'wanqinDp', sbb.interval, sbb.value / Math.max(1, num(sbb.cost, 1)), sbb.cost); },
      onTick({ battle, unit, dt }) { tickDp(battle, unit, 'wanqinDp', dt); },
      onEnd({ battle, unit, reason }) { endDp(battle, unit, 'wanqinDp', reason); },
    };
    if (id === S2) return {
      kind: 'duration', duration: rec?.duration, flags: { disarm: true },
      onStart({ battle, unit, skill: sk }) {
        beginDp(unit, 'wanqinDp', sbb['wanqin_s_2[cost].interval'], sbb.value / Math.max(1, num(sbb['wanqin_s_2[cost].cost'], 1)), sbb['wanqin_s_2[cost].cost']);
        unit.mem.wanqinHeal = 0;
        const aspd = num(sbb['attack@attack_speed']);
        const g = gridOf(rec);
        if (aspd) for (const a of alliesInGridOf(battle, unit, g)) {
          if (a !== unit && a.dir === unit.dir) battle.addBuff(a, { key: `wanqin:aspd:${unit.id}`, mods: { aspd }, duration: sk.timeLeft, source: unit });
        }
      },
      onTick({ battle, unit, dt }) {
        tickDp(battle, unit, 'wanqinDp', dt);
        // [ASSUMED] the heal pulse is once per elapsed second: the text says 每秒 and the blackboard has no heal interval
        // (wanqin_s_2[cost].interval is the DP drip).
        unit.mem.wanqinHeal = (unit.mem.wanqinHeal ?? 0) + dt;
        const scale = num(sbb['attack@heal_scale']);
        const g = gridOf(rec);
        let guard = 0;
        while (unit.mem.wanqinHeal + 1e-9 >= 1 && guard++ < 8) { // loop-cap: one heal per second
          unit.mem.wanqinHeal -= 1;
          for (const a of alliesInGridOf(battle, unit, g)) if (a !== unit) battle.heal(unit, a, unit.s.atk * scale);
        }
      },
      onEnd({ battle, unit, reason }) { endDp(battle, unit, 'wanqinDp', reason); unit.mem.wanqinHeal = 0; },
    };
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      const extra = num(tb.block_cnt);
      if (extra) battle.every(0.25, () => {
        const ally = up(unit) && unit.skill?.active ? frontAlly(battle, unit) : null;
        const prev = unit.mem.wanqinFront;
        if (prev && prev !== ally) battle.removeBuff(prev, `wanqin:front:${unit.id}`);
        unit.mem.wanqinFront = ally || null;
        if (ally) battle.addBuff(ally, { key: `wanqin:front:${unit.id}`, mods: { blockCnt: extra }, duration: 0.4, refresh: 'replace', source: unit });
      }, { owner: unit });
      const common = num(t0['wanqin_t_1[hp_common].max_hp']);
      const extraHp = num(t0['wanqin_t_1[hp_common].wanqin_t_1[hp_extra].max_hp']);
      if (common || extraHp) battle.every(0.5, () => {
        if (!up(unit)) return;
        for (const a of battle.alliesInRadius(unit.x, unit.y, RING1)) {
          if (a === unit) continue;
          const pct = common + (a.dir === unit.dir ? extraHp : 0);
          if (pct) battle.addBuff(a, { key: `wanqin:hp:${unit.id}`, mods: { hpPct: pct }, duration: 0.7, refresh: 'replace', source: unit });
        }
      }, { owner: unit, immediate: true });
    },
  };
}

export default { char_4119_wanqin: wanqin };
