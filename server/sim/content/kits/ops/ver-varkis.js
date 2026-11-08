// server/sim/content/kits/ops/ver-varkis.js — 摆渡人 (char_4166_varkis), 规程·序列Ⅰ.
// 强攻手 "同时攻击阻挡的所有敌人" is the profession trait. 米诺斯 = nationId minos (character_table).
// 永志不忘 "提升至": talent_atk_scale is the attack multiplier, strongest source wins [ASSUMED: 同名].
// S1 "连续攻击三次" has no times key: three hits. S2's overflow is a barrier (not the generic overheal buff)
// that decays only after the skill, at dynamic_dec_per_sec HP per second [ASSUMED: not a fraction of max HP].
// The self-heal is once per attack action [ASSUMED], not once per blocked target.

import { num, talentBb, traitBb, toggleBuff, up } from '../shared/tier1.js';
import { chargeKind, kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_varkis_1';
const S2 = 'skchr_varkis_2';
const BARRIER = 'varkis:barrier';
const GUARD = 'varkis:guard';
const MINOS = new WeakMap();

const isMinos = (a) => !!a && a.kind === 'op' && (a.def?.raw?.nationId ?? a.def?.nationId) === 'minos';

function pourBarrier(battle, unit, add, capRatio) {
  if (!(add > 0)) return;
  const cap = unit.s.maxHp * (capRatio > 0 ? capRatio : 1);
  const cur = unit.findBuff(BARRIER);
  const next = Math.min(cap, (cur ? cur.shield : 0) + add);
  if (cur) { cur.shield = next; return; }
  const buff = battle.addBuff(unit, { key: BARRIER, shield: next });
  if (buff && unit.mem.varkisDecay) buff.onTick = (ctx) => decayBarrier(ctx, num(unit.mem.varkisRate));
}

function decayBarrier({ battle, unit, buff, dt }, rate) {
  if (!unit.mem.varkisDecay || !(rate > 0)) return;
  buff.shield -= rate * dt;
  if (!(buff.shield > 1e-6)) battle.removeBuff(unit, buff);
}

function installMinos(battle, unit, scale) {
  if (!(scale > 0)) return;
  let list = MINOS.get(battle);
  if (!list) {
    list = [];
    MINOS.set(battle, list);
    battle.on('hit', (ctx) => {
      const atk = ctx.source;
      const dmg = ctx.dmg;
      if (!isMinos(atk) || !dmg?.isAttack || !ctx.target || ctx.target.side !== 'enemy') return;
      let best = 0;
      for (const s of list) if (s.scale > best && up(s.unit)) best = s.scale;
      if (!(best > 1) && best !== 0) return;
      if (!(best > 0) || ctx.target.hpRatio > atk.hpRatio) return;
      dmg.mul *= best;
    });
  }
  list.push({ unit, scale });
}

function varkis(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const tb = traitBb(chess);
  const scale = num(t0.talent_atk_scale, 1);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      id, kind: chargeKind(rec),
      attack: { atkScale: num(sbb.atk_scale, 1), hits: 3 },
    };
    if (id === S2) return {
      id, kind: 'duration', duration: posDur(rec),
      attack: {
        atkScale: num(sbb['attack@s2_atk_scale'], 1),
        onHit({ battle, unit }) {
          if (unit.mem.varkisHealT === battle.time) return;
          unit.mem.varkisHealT = battle.time;
          const amt = unit.s.maxHp * num(sbb['attack@hp_ratio']);
          const room = Math.max(0, unit.s.maxHp - unit.hp);
          battle.heal(unit, unit, amt, { self: true });
          pourBarrier(battle, unit, amt - room, num(sbb.max_hp_ratio, 1));
        },
      },
      onStart({ unit }) {
        unit.mem.varkisDecay = false;
        const b = unit.findBuff(BARRIER);
        if (b) b.onTick = null;
      },
      onEnd({ unit }) {
        unit.mem.varkisDecay = true;
        unit.mem.varkisRate = num(sbb.dynamic_dec_per_sec);
        const b = unit.findBuff(BARRIER);
        if (b) b.onTick = (ctx) => decayBarrier(ctx, num(sbb.dynamic_dec_per_sec));
      },
    };
    return { id, kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      installMinos(battle, unit, scale);
      const gate = num(tb.hp_ratio), cut = num(tb.damage_resistance);
      if (tb.hp_ratio != null && tb.damage_resistance != null && cut > 0) {
        toggleBuff(battle, unit, GUARD, () => unit.hpRatio > gate, { physTakenMul: 1 - cut });
      }
    },
  };
}

export default { char_4166_varkis: varkis };
