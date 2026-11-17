// server/sim/content/kits/ops/ver-turdus.js — 乌啾 (char_4224_turdus), 规程·序列Ⅰ.
// The chain-healer trait (hop count and falloff, including an elite module's falloff) stays with the
// profession. This kit heals the primary itself, then continues the chain so a hop onto her can be
// strengthened and followed by one extra hop. [ASSUMED] S2's 增益治疗 is a heal of her current ATK × the
// scale once a second, not a 生命回复速度 buff, and it stops when she leaves.

import { chainHealNext } from '../../../ai.js';
import { powi } from '../../../detmath.js';
import { num, skillBbOf, talentBb, up } from '../shared/tier1.js';
import { kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_turdus_1';
const S2 = 'skchr_turdus_2';

function healBase(unit) {
  const p = unit.profile || {};
  return unit.s.atk * (p.atkScale ?? 1) * (p.healScale ?? 1) * unit.s.atkScaleMul;
}

function turdus(_bb, chess) {
  const t0 = talentBb(chess, 0);
  const tScale = num(t0['attack@chain.atk_scale_2'] ?? t0['chain.atk_scale_2'], 1);
  const s1extra = num(skillBbOf(chess, S1)['attack@chain.extra_value']);
  const { skills, skill } = kitSkills(chess, null, (id, rec, sbb) => {
    if (id === S1) {
      return {
        kind: 'duration',
        duration: posDur(rec),
        mods: { aspd: num(sbb.attack_speed) },
      };
    }
    if (id === S2) {
      const ratio = num(sbb['turdus_s2[self_damage].hp_ratio']);
      const dur = num(sbb.bonus_duration);
      const healScale = num(sbb['turdus_s2[continues_heal].heal_scale']);
      return {
        kind: 'instant',
        onStart({ battle, unit }) {
          battle.loseHp(unit, unit.hp * ratio);
          if (!unit.alive) return;
          const burst = { dur, hit: new Set() };
          unit.mem.turdusBurst = burst;
          try { battle.forceAttack(unit); } finally { unit.mem.turdusBurst = null; }
          const ids = [...burst.hit];
          const ticks = Math.max(0, Math.round(dur));
          if (!(ticks > 0) || !(healScale > 0) || !ids.length) return;
          let n = 0;
          battle.every(1, (b, sc) => {
            if (!up(unit) || ++n > ticks) { sc.cancel(); return; }
            const amount = unit.s.atk * healScale;
            for (const id of ids) {
              const a = b.allyUnits.find((x) => x.id === id);
              if (a?.alive && a.deployed) b.heal(unit, a, amount, { turdusHoT: true });
            }
          }, { owner: unit });
        },
      };
    }
    return { kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      const h = unit.profile.heal || { count: 3, falloff: 0.25 };
      const saved = { count: num(h.count, 3), falloff: num(h.falloff, 0.25) };
      unit.profile.heal = { ...h, mode: 'single' };
      const hop = (from, to, amount, opts) => {
        battle._ev(['atk', from.id, to.id, 'chainHeal']);
        battle.heal(unit, to, amount, opts);
      };
      const continueChain = (primary) => {
        if (!primary) return;
        let count = saved.count;
        if (unit.skill?.active && unit.skill.id === S1) count += s1extra;
        const base = healBase(unit);
        const seen = new Set([primary.id]);
        const reached = [primary];
        let prev = primary;
        const extraHop = (from, amount) => {
          const to = chainHealNext(battle, unit, from, seen);
          if (!to) return null;
          hop(from, to, amount, { turdusExtra: true });
          seen.add(to.id);
          reached.push(to);
          return to;
        };
        if (primary === unit) {
          const to = extraHop(primary, base * tScale);
          if (to) prev = to;
        }
        for (let k = 1; k < count; k++) {
          const next = chainHealNext(battle, unit, prev, seen);
          if (!next) break;
          let amount = base * powi(1 - saved.falloff, k);
          const opts = {};
          if (next === unit) {
            amount *= tScale;
            opts.turdusScaled = true;
          }
          hop(prev, next, amount, opts);
          seen.add(next.id);
          reached.push(next);
          prev = next;
          if (next === unit) {
            const to = extraHop(next, amount);
            if (to) prev = to;
          }
        }
        const burst = unit.mem.turdusBurst;
        if (!burst) return;
        for (const a of reached) {
          if (burst.hit.has(a.id)) continue;
          burst.hit.add(a.id);
          battle.applyStatus(a, 'camou', { duration: burst.dur, source: unit });
        }
      };
      battle.on('beforeAttack', (ctx) => {
        if (ctx.attacker !== unit) return;
        unit.mem.turdusChain = !!(ctx.targets && ctx.targets.length);
      }, { owner: unit, priority: -50 });
      battle.on('attack', (ctx) => {
        if (ctx.attacker !== unit || !unit.mem.turdusChain) return;
        try { continueChain(ctx.targets && ctx.targets[0]); } finally { unit.mem.turdusChain = false; }
      }, { owner: unit });
      battle.on('heal', (ctx) => {
        if (!unit.mem.turdusChain || ctx.source !== unit || ctx.target !== unit) return;
        const o = ctx.opts || {};
        if (o.turdusScaled || o.regen || o.turdusHoT || o.turdusExtra) return;
        ctx.amount *= tScale;
      }, { owner: unit });
    },
  };
}

export default { char_4224_turdus: turdus };
