// server/sim/content/kits/ops/chess_char_6_16-halo2.js — 溯光星源 (char_1047_halo2) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.

import { canTargetEnemy } from '../../../targeting.js';
import { bodyDist, bodyInRange } from '../../../body.js';
import {
  num, bv, tbb, moduleBb, live, ANY, enemiesIn, onDefaultSkill, selectedSkill, batOf, pullToward, aura, N4,
} from '../shared/tier6.js';
import { alliesInGridOf, holdArcane, spTimeBonus } from '../shared/tier1.js';

// ------------------------------------------------------------------------------------------------------------------
// 溯光星源 chess_char_6_16 (凝滞师) — S3 并流连锁; 数据建模; 能源解析
//
// Module 远方问候 (DEC-X, CN 2.7.91; the tier-6 elite fields stage 3), read from its talent parts (index −1) and the
// composed 能源解析:
// - 特性追加 「攻击范围内存在敌人时技力自然恢复速度+0.2/秒」 (sp_recovery_per_sec): extra natural SP while an enemy is in
//   her current range — one +0.2 whatever their number, the time-SP skills only (S2 recovers by attacking).
// - 能源解析 (stages 2 / 3): the composed talent's own numbers (脆弱 damage_scale, raised to damage_scale_max after more
//   than `interval` s in her range: stage 3 12 % → 21 % at full potential, 10 % → 19 % below 潜能 4) — the talent install
//   below already reads them; and 「溯光星源与周围4格的干员获得12%术法充盈」, the part holding damage_scale and the x-5
//   grid: 术法充盈 (shared/tier1.js MAGIC_ARCANE, 同名效果取最高: arts damage dealt ×damage_scale) on her and the
//   operators on that grid [ASSUMED: operators only — 干员, no summons], refreshed while she is on the field.

function halo2(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), mod = moduleBb(chess);
  const arcane = (chess?.talents || []).find((t) => t && t.index === -1 && num(t.bb?.damage_scale) > 1) ?? null;
  const isDef = onDefaultSkill(chess), sid = selectedSkill(chess, def);
  const skillGrid = def?.skill?.rangeGrid?.length ? def.skill.rangeGrid : null;
  const n = Math.max(1, Math.floor(num(bb['attack@max_target'], 1))), share = num(bb['attack@atk_share']);
  const slug = (unit) => unit.profile?.onHitStatus?.key === 'sluggish' ? num(unit.profile.onHitStatus.duration) : 0;
  const skills = {
    // S1 星图闪烁: ATK +atk; every attack then bounces attack@chain.max_target times between enemies (back and forth
    // allowed, never twice in a row on one; attack@projectile_range tiles), each bounce a full hit with her 停顿
    skchr_halo2_1: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      attack: {
        onHit({ battle, unit, target }) {
          if (!target) return;
          const jumps = Math.max(0, Math.floor(num(bb['attack@chain.max_target'], 3))), R = num(bb['attack@projectile_range'], 1.7);
          let prev = target, px = target.x, py = target.y;
          for (let i = 0; i < jumps; i++) {
            let best = null, bd = Infinity;
            for (const e of battle.foesInRadius(px, py, R)) {
              if (e === prev || !canTargetEnemy(unit, e, ANY)) continue;
              const d = bodyDist(e, px, py);
              if (d < bd - 1e-9) { bd = d; best = e; }
            }
            if (!best) break;
            battle.dealDamage(unit, best, { amount: unit.s.atk, type: 'arts', isAttack: true, isSkill: true, tags: ['chain'] });
            const sd = slug(unit);
            if (sd > 0 && best.alive) battle.applyStatus(best, 'sluggish', { duration: sd, source: unit });
            prev = best; px = best.x; py = best.y;
          }
        },
      },
    },
    // S2 星束引力 (attack SP): the next attack targets the enemy of her range farthest from its goal (install), atk_scale
    // × ATK arts with a `sluggish` s 停顿, and links up to max_target enemies within ability_range_radius of it: pulled
    // toward it (force) and hit by atk_scale_link × ATK arts
    skchr_halo2_2: {
      kind: 'instant',
      attack: {
        atkScale: num(bb.atk_scale, 1),
        onHitStatus: { key: 'sluggish', duration: num(bb.sluggish, 3) },
        onHit({ battle, unit, target }) {
          if (!target) return;
          const R = num(bb.ability_range_radius, 2), k = Math.max(0, Math.floor(num(bb.max_target, 2)));
          const near = battle.foesInRadius(target.x, target.y, R).filter((e) => e !== target && canTargetEnemy(unit, e, ANY))
            .sort((a, b) => bodyDist(a, target.x, target.y) - bodyDist(b, target.x, target.y) || a.spawnSeq - b.spawnSeq)
            .slice(0, k);
          for (const e of near) {
            battle.fx('link', { x: e.x, y: e.y, id: unit.id, ids: [target.id, e.id] });
            pullToward(battle, { x: target.x, y: target.y }, e, num(bb.force), 0.3);
            if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale_link, num(bb.atk_scale, 1)), type: 'arts', isSkill: true, tags: ['skill', 'link'] });
          }
        },
      },
    },
  };
  return {
    skills,
    install(battle, unit) {
      // DEC-X 特性追加: +sp_recovery_per_sec natural SP while an enemy is in her current range (see the header)
      spTimeBonus(battle, unit, num(mod.sp_recovery_per_sec), () => enemiesIn(battle, unit).length > 0);
      if (sid !== 'skchr_halo2_2') return;
      battle.on('beforeAttack', (ctx) => { // "选择攻击范围内距离目标点最远的1个敌人为目标"
        if (ctx.attacker !== unit || !unit.skill?.active || !unit.skill.pending) return;
        const c = battle.enemiesInKeys(unit.rangeKeys, unit, ctx.profile);
        if (!c.length) return;
        let best = c[0];
        for (const e of c) if (battle.remainingDistance(e) > battle.remainingDistance(best) + 1e-9) best = e;
        ctx.targets = [best];
      }, { owner: unit });
    },
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), batPct: batOf(bb.base_attack_time, def) },
      targeting: { maxTargets: n, ...(skillGrid ? { rangeGrid: skillGrid } : {}) },
      onStart({ unit }) { unit.mem.haloLocks = []; },
      onEnd({ unit }) { unit.mem.haloLocks = []; },
    },
    talents: [
      { install(battle, unit) { // S3: persistent locks + damage transfer between linked targets
        if (!isDef) return;
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !unit.skill?.active) return;
          const valid = (e) => e && e.alive && canTargetEnemy(unit, e, ANY) && bodyInRange(e, unit.rangeKeySet);
          const keep = (unit.mem.haloLocks || []).filter(valid);
          for (const e of ctx.targets) if (keep.length < n && !keep.includes(e)) keep.push(e);
          ctx.targets = keep.slice(0, n);
          const fresh = ctx.targets.some((e) => !(unit.mem.haloLocks || []).includes(e));
          unit.mem.haloLocks = ctx.targets.slice();
          if (fresh && ctx.targets.length > 1) battle.fx('link', { x: ctx.targets[0].x, y: ctx.targets[0].y, id: unit.id, ids: ctx.targets.map((e) => e.id) });
        }, { owner: unit });
        battle.on('hit', (ctx) => {
          const locks = unit.mem.haloLocks;
          if (!(share > 0) || !unit.skill?.active || !locks || locks.length < 2 || ctx.dmg.type !== 'arts' || ctx.dmg.tags.includes('link')) return;
          if (!locks.includes(ctx.target) || unit.mem.haloLinking) return;
          // re-entrancy guard: a transferred hit (or anything it causes, e.g. enemy damage sharing) never re-links
          unit.mem.haloLinking = true;
          try {
            for (const o of locks) if (o !== ctx.target && o.alive) {
              battle.dealDamage(ctx.source ?? unit, o, { amount: ctx.dmg.amount * share, type: 'arts', canDodge: false, isSkill: true, tags: ['skill', 'link'] });
            }
          } finally { unit.mem.haloLinking = false; }
        }, { owner: unit });
      } },
      { install(battle, unit) { // 数据建模 (+ module ATK at max stacks)
        const as = num(t0.attack_speed), max = Math.max(1, Math.floor(num(t0.max_stack_cnt, 18))), fullAtk = num(mod.atk);
        battle.on('deploy', ({ unit: u }) => { if (u === unit) unit.mem.haloStack = 0; }, { owner: unit });
        battle.on('statusApplied', (ctx) => {
          if (ctx.source !== unit || ctx.status !== 'sluggish' || !live(unit) || (unit.mem.haloStack || 0) >= max) return;
          unit.mem.haloStack = (unit.mem.haloStack || 0) + 1;
          const k = unit.mem.haloStack;
          battle.addBuff(unit, { key: 'halo2:model', mods: { aspd: as * k, atkPct: k >= max ? fullAtk : 0 } });
        }, { owner: unit });
      } },
      { install(battle, unit) { // 能源解析
        const base = bv(t1, 'damage_scale', 1), maxS = bv(t1, 'damage_scale_max', base), iv = bv(t1, 'interval', 7);
        const stay = new WeakMap();
        aura(battle, unit, 0.25, () => {
          const inR = enemiesIn(battle, unit);
          for (const e of battle.enemies) if (!inR.includes(e)) stay.delete(e);
          for (const e of inR) {
            const t = (stay.get(e) ?? 0) + 0.25;
            stay.set(e, t);
            const v = t > iv ? maxS : base;
            // 脆弱 (ba.fragile, 同名效果取最高): the catalogue status, refreshed while the enemy stays in range
            if (v > 1) battle.applyStatus(e, 'fragile', { duration: 0.4, value: v - 1, source: unit });
          }
        });
        // DEC-X stages 2 / 3: 术法充盈 on her and the operators of the module part's grid (see the header)
        const arc = num(arcane?.bb?.damage_scale, 1) - 1;
        if (arc > 0) {
          const grid = arcane.rangeGrid?.length ? arcane.rangeGrid : N4;
          aura(battle, unit, 0.25, () => {
            for (const a of new Set([unit, ...alliesInGridOf(battle, unit, grid)])) if (a.kind === 'op') holdArcane(battle, a, arc, 0.4, unit);
          });
        }
      } },
    ],
  };
}

export default {
  chess_char_6_16_a: halo2,
};
