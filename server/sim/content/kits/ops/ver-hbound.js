// server/sim/content/kits/ops/ver-hbound.js — 旅骨 (char_4232_hbound), 规程·序列Ⅰ.
// 炼金单元: a zone that keeps pulsing after she leaves. Native projectile travel is not simulated
// [ASSUMED: the unit lands at once, as 锡人]. 潜水作业 cuts the hit rate of a ground enemy standing in one;
// weight ≥ value uses the heavy cut, and the harsher overlapping zone wins [ASSUMED]. Flyers are not rolled.

import { cancelDamage } from '../../../attack.js';
import { enemiesInGrid, makeZone, moduleBb, num, spTimeBonus, talentBb } from '../shared/tier1.js';
import { chargeKind, kitSkills } from '../shared/version.js';

const S1 = 'skchr_hbound_1';
const S2 = 'skchr_hbound_2';
const ZONES = new WeakMap();

function zonesOf(battle) {
  let list = ZONES.get(battle);
  if (list) return list;
  list = [];
  ZONES.set(battle, list);
  const rolls = new WeakMap();
  battle.on('hit', (ctx) => {
    const src = ctx.source;
    const d = ctx.dmg;
    if (!src || src.side !== 'enemy' || !d?.isAttack) return;
    if (d.type !== 'phys' && d.type !== 'arts') return;
    if (src.isFlying) return;
    let cut = 0;
    for (const z of list) {
      if (battle.time > z.until + 1e-9) continue;
      const dx = src.x - z.x;
      const dy = src.y - z.y;
      if (dx * dx + dy * dy > z.radius * z.radius + 1e-9) continue;
      const c = (src.weight ?? 0) >= z.heavyAt ? z.heavyCut : z.cut;
      if (c > cut) cut = c;
    }
    if (!(cut > 0)) return;
    const id = d.attackId ?? 0;
    let rec = rolls.get(src);
    if (!rec || rec.id !== id) {
      rec = { id, miss: battle.rng() < cut };
      rolls.set(src, rec);
    }
    if (rec.miss) cancelDamage(d, 'miss');
  }, { priority: 300 });
  return list;
}

function throwZone(battle, unit, sbb, talent, heavySkill) {
  const found = enemiesInGrid(battle, unit, null, { n: 1, groundOnly: true })[0];
  const fwd = unit.fwd;
  const x = found ? found.x : unit.x + fwd[1];
  const y = found ? found.y : unit.y + fwd[0];
  const delay = num(sbb.projectile_delay_time);
  const interval = num(sbb.interval, 1) || 1;
  const radius = num(sbb.projectile_range, 1.5);
  const atk = unit.s.atk;
  const list = zonesOf(battle);
  const zone = {
    x, y, radius, until: battle.time + delay,
    cut: Math.abs(num(talent.hitrate)), heavyCut: Math.abs(num(talent.heavy_hitrate)), heavyAt: num(talent.value, 3),
  };
  list.push(zone);
  unit.mem.hZones = (unit.mem.hZones || 0) + 1;
  const scale = num(sbb.atk_scale);
  const heavyScale = heavySkill ? num(sbb.heavy_atk_scale) : 0;
  const heavyAt = num(sbb.value, 3);
  const slow = Math.abs(num(sbb.move_speed));
  makeZone(battle, unit, {
    x, y, radius, duration: delay, interval,
    onPulse(b) {
      for (const e of b.foesInRadius(x, y, radius, true)) {
        if (!e.alive || e.isFlying || e.s.flags.untargetable) continue;
        const heavy = heavySkill && (e.weight ?? 0) >= heavyAt;
        b.dealDamage({
          source: null, credit: unit, target: e, amount: atk * scale + (heavy ? atk * heavyScale : 0),
          type: 'arts', attackType: 'BUFF', calculation: 'precomputed', isSkill: true, tags: ['dot', 'zone'],
        });
        if ((heavySkill ? heavy : slow > 0) && e.alive && slow > 0) {
          b.applyStatus(e, 'slow', { value: slow, duration: interval + 0.25, source: unit });
        }
      }
    },
  });
  battle.after(delay, () => {
    const i = list.indexOf(zone);
    if (i >= 0) list.splice(i, 1);
    unit.mem.hZones = Math.max(0, (unit.mem.hZones || 0) - 1);
  });
}

function hbound(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const per = num(moduleBb(chess).sp_recovery_per_sec);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1 || id === S2) return {
      id, kind: chargeKind(rec),
      onStart({ battle, unit }) { throwZone(battle, unit, sbb, t0, id === S2); },
    };
    return { id, kind: 'instant' };
  });
  return {
    skills, skill,
    install(battle, unit) {
      unit.mem.hZones = 0;
      zonesOf(battle);
      spTimeBonus(battle, unit, per, () => unit.mem.hZones > 0);
    },
  };
}

export default { char_4232_hbound: hbound };
