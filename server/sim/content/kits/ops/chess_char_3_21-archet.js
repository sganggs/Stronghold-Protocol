// server/sim/content/kits/ops/chess_char_3_21-archet.js — 空弦 (char_332_archet) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import { canTargetEnemy } from '../../../targeting.js';
import { bodyDist } from '../../../body.js';
import {
  num, defOf, talentBb, moduleTalentBb, altSkills, instantKindOf, groundAspd, alive, fx, enemiesOn, isLeader, giveSp,
} from '../shared/tier3.js';

/** The unit's own profile damage multiplier on `target` (fastshot fly bonus …) for damage a kit deals itself. */
function profileMul(battle, unit, target) {
  const f = unit.profile?.dmgMul;
  const m = typeof f === 'function' ? f(battle, unit, target) : f;
  return typeof m === 'number' && Number.isFinite(m) ? m : 1;
}
/** Targetable enemies within `r` tiles of (x, y), nearest first (spawn order breaks ties), excluding `skip`. */
function enemiesAround(battle, unit, x, y, r, skip = null) {
  const out = battle.foesInRadius(x, y, r).filter((e) => !(skip && skip.has(e)) && canTargetEnemy(unit, e, { canHitFly: true }));
  const d = (e) => bodyDist(e, x, y);
  return out.sort((a, b) => d(a) - d(b) || (a.spawnSeq ?? a.id) - (b.spawnSeq ?? b.id));
}
/** 周围 (around a target) for 空弦's scatter / bounce arrows (PRTS S1 "溅射半径1.5", S2 "单次最大弹射距离1.5"). */
const AROUND_R = 1.5;

export default {
  // ---- 3_21 空弦 · 速射手 — S3 箭矢·暴风: ATK +, range +1, 3 hits × 2 targets; 兰登战术: attack-SP snipers +1 SP / 2.5 s;
  //      铁弦: one-hit shield at deployment, +7 SP when it breaks; 精锐 module MAR-Y: ASPD + with ground enemies in range
  //      S1 箭矢·散逸: next attack ×atk_scale + up to max_target−1 other enemies around the target × atk_scale_2;
  //      S2 箭矢·追猎 (charges): an arrow fired at once hits its target `times` times, then bounces to the nearest enemy
  //      around not hit yet with one hit fewer each bounce (5, 4, 3, 2, 1). 精锐 MAR-X: fly × (profession layer);
  //      ISW-A (集成战略 only): no range bonus here.
  chess_char_3_21_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0), t1 = talentBb(d, 1);
    const mod = moduleTalentBb(chess);
    const skill = {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      attack: { hits: Math.max(1, Math.floor(num(bb['attack@times'], 1))) },
    };
    const tg = {};
    if (num(bb.ability_range_forward_extend) > 0) tg.rangeExtend = Math.round(bb.ability_range_forward_extend);
    if (num(bb['attack@max_target']) > 1) tg.maxTargets = Math.floor(bb['attack@max_target']);
    if (Object.keys(tg).length) skill.targeting = tg;
    const physHit = (battle, unit, e, scale, tag) => battle.dealDamage(unit, e, { amount: unit.s.atk * scale * profileMul(battle, unit, e), type: 'phys', isSkill: true, tags: ['skill', tag] });
    const kit = {
      skill,
      skills: altSkills(chess, d, bb, {
        skchr_archet_1: (s) => {
          const more = Math.max(0, Math.floor(num(s.bb.max_target, 4)) - 1);
          const sc2 = num(s.bb.atk_scale_2, 1);
          return {
            kind: instantKindOf(s),
            attack: {
              atkScale: num(s.bb.atk_scale, 1),
              onHit({ battle, unit, target, x, y }) {
                const cx = target ? target.x : x, cy = target ? target.y : y;
                if (!Number.isFinite(cx) || !Number.isFinite(cy) || !(more > 0)) return;
                const others = enemiesAround(battle, unit, cx, cy, AROUND_R, new Set([target])).slice(0, more);
                for (const e of others) physHit(battle, unit, e, sc2, 'archetScatter');
                if (others.length) fx(battle, 'volley', unit, { targets: others.map((e) => e.id), skill: 'archet_1' });
              },
            },
          };
        },
        skchr_archet_2: (s) => {
          const times = Math.max(1, Math.floor(num(s.bb.times, 5)));
          const sc = num(s.bb.atk_scale, 1);
          return {
            kind: instantKindOf(s),
            onStart({ battle, unit }) {
              const first = enemiesOn(battle, unit, unit.rangeKeys, 1, unit.profile)[0];
              if (!first) return;
              const seen = new Set();
              const fire = (from, target, n) => {
                seen.add(target);
                battle.addProjectile({
                  from, target, speed: 16, visual: 'arrow', source: unit, hitDead: true,
                  onHit: ({ target: t, x, y }) => {
                    if (t && t.alive) for (let i = 0; i < n && t.alive; i++) physHit(battle, unit, t, sc, 'archetPursuit');
                    if (n <= 1) return;
                    const next = enemiesAround(battle, unit, x, y, AROUND_R, seen)[0];
                    if (next) fire({ x, y }, next, n - 1);
                  },
                });
              };
              fire(unit, first, times);
              fx(battle, 'volley', unit, { target: first.id, skill: 'archet_2' });
            },
          };
        },
      }),
      talents: [
        { install(battle, unit) { // 兰登战术
          unit.mem.archetTactics = true;
          battle.every(num(t0.interval, 2.5), () => {
            if (!alive(unit) || !isLeader(battle, unit, 'archetTactics')) return;
            for (const a of battle.allies(unit.ownerId)) {
              if (a.kind === 'op' && a.def?.profession === 'SNIPER' && a.skill?.spType === 'attack') giveSp(a, num(t0.sp, 1), 'talent');
            }
          }, { owner: unit });
        } },
        { install(battle, unit) { // 铁弦
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== unit) return;
            battle.addBuff(unit, {
              key: 'talent:archet_shield', shieldHits: 1, visible: true,
              onRemove: ({ unit: u, buff }) => {
                if (buff.shieldHits > 0 || !u.alive) return;
                giveSp(u, num(t1.sp), 'talent');
                fx(battle, 'shieldBreak', u);
              },
            });
            fx(battle, 'shield', unit);
          }, { owner: unit });
        } },
      ],
    };
    if (mod && num(mod.attack_speed) > 0) kit.install = groundAspd('trait:archet_ground', num(mod.attack_speed));
    return kit;
  },
};
