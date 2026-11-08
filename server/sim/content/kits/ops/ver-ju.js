// server/sim/content/kits/ops/ver-ju.js — 矩 (char_4221_ju), 规程·序列Ⅰ.
// 重伤 is 嵯峨's DYING buff (same key, so 矩不攻击重伤单位 sees either source). A shared-pool boss never takes it:
// that damage has no fatal step. S2's extra hit has no delay key [ASSUMED: 0.5 s after the enemy is first seen
// below half HP, once per enemy, dropped if the skill stops first].

import { DYING, isDying } from './op-saga.js';
import { enemiesInGrid, giveSp, num, talentBb } from '../shared/tier1.js';
import { chargeKind, kitSkills, posDur } from '../shared/version.js';

const S1 = 'skchr_ju_1';
const S2 = 'skchr_ju_2';
const EXTRA = 0.5;

function applyDying(battle, ju, e, { sp, life, ms }) {
  if (!e || !e.alive || isDying(e)) return;
  battle.addBuff(e, {
    key: DYING, source: ju, visible: true,
    mods: { moveMul: Math.max(0, 1 + ms), hpRegen: -1e9 },
    flags: { unblockable: true, healFree: true, noHeal: true },
    data: { sp, until: battle.time + life, hidden: !!e.hidden },
    onTick: ({ battle: b, unit: x, buff }) => {
      const d = buff.data;
      if ((d.hidden && !x.hidden) || (!x.hidden && b.time + 1e-9 >= d.until)) { b.kill(x, null); return; }
      d.hidden = !!x.hidden;
    },
  });
  battle.fx('dying', { x: e.x, y: e.y, id: e.id, from: ju.id });
}

function ju(_bb, chess, def) {
  const t0 = talentBb(chess, 0);
  const { skills, skill } = kitSkills(chess, def, (id, rec, sbb) => {
    if (id === S1) return {
      id, kind: chargeKind(rec),
      attack: { atkScale: num(sbb.atk_scale_s1, 1) },
    };
    if (id === S2) return {
      id, kind: 'duration', duration: posDur(rec),
      mods: { atkPct: num(sbb.atk) },
      targeting: { maxTargets: num(sbb['attack@max_target_s2'], 2) },
      onStart({ unit }) { unit.mem.juSeen = new Set(); unit.mem.juQ = []; },
      onTick({ battle, unit }) {
        const gate = num(sbb.hp_ratio, 0.5);
        const seen = unit.mem.juSeen;
        const queue = unit.mem.juQ;
        for (const e of enemiesInGrid(battle, unit, null)) {
          if (!e.alive || !(e.hpRatio < gate) || seen.has(e.id)) continue;
          seen.add(e.id);
          queue.push({ id: e.id, until: battle.time + EXTRA });
        }
        const now = battle.time;
        const inRange = new Set(enemiesInGrid(battle, unit, null).map((e) => e.id));
        const left = [];
        for (const q of queue) {
          if (now + 1e-9 < q.until) { left.push(q); continue; }
          const e = battle.enemies.find((x) => x.id === q.id && x.alive);
          if (e && e.hpRatio < gate && inRange.has(e.id)) {
            battle.dealDamage({
              source: unit, target: e, amount: unit.s.atk * num(sbb.atk_scale_s2_extra, 1),
              type: 'phys', isSkill: true, tags: ['ju:extra'],
            });
          }
        }
        unit.mem.juQ = left;
      },
    };
    return { id, kind: 'instant' };
  });
  return {
    skills, skill,
    trait: { priority: 'heaviest', skipEnemy: (e) => isDying(e) },
    install(battle, unit) {
      const sp = num(t0.sp);
      const life = num(t0.interval, 10);
      const ms = num(t0.move_speed);
      battle.on('fatal', (ctx) => {
        const e = ctx.unit;
        if (!e || e.side !== 'enemy' || e.bossPool || isDying(e)) return;
        if (ctx.source !== unit && ctx.credit !== unit) return;
        ctx.prevented = true;
        applyDying(battle, unit, e, { sp, life, ms });
      }, { owner: unit });
      battle.on('kill', (ctx) => {
        const victim = ctx.victim ?? ctx.unit;
        const buff = victim && typeof victim.findBuff === 'function' ? victim.findBuff(DYING) : null;
        if (!buff || buff.source !== unit) return;
        giveSp(ctx.killer, buff.data.sp, 'talent');
      }, { owner: unit });
      if (t0.atk_scale > 1 && t0.value != null) {
        const gate = num(t0.value);
        const mul = num(t0.atk_scale);
        battle.on('hit', (ctx) => {
          if (ctx.source !== unit || !ctx.dmg?.isAttack || !ctx.target) return;
          if ((ctx.target.weight ?? 0) >= gate) ctx.dmg.mul *= mul;
        }, { owner: unit });
      }
      battle.on('beforeAttack', (ctx) => {
        if (ctx.attacker !== unit) return;
        const sk = unit.skill;
        if (!sk?.pending || sk.id !== S1) return;
        ctx.targets = (ctx.targets || []).filter((e) => e && e.hpRatio <= 0.5);
      }, { owner: unit });
    },
  };
}

export default { char_4221_ju: ju };
