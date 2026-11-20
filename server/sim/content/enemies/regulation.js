// server/sim/content/enemies/regulation.js — 规程·序列Ⅰ special enemies (CRITIC / REBORN and the new draws).
//
// Kept off KITS: test/content/enemies_bosses.test.js requires every KITS key in the default enemies.json.
// enemies.js onSpawn falls back to REGULATION_KITS. This module does not import enemies.js.
//
// Official numbers are read from the enemy record. Points with no blackboard are marked [ASSUMED].

import { hypot, sin, cos } from '../../detmath.js';
import { ALLY_COLLIDER_RADIUS, PROJECTILE_SPEEDS } from '../../constants.js';
import { canTargetAlly } from '../../targeting.js';
import {
  hurt, elem, areaAllies, areaAlliesInTiles, fieldAllies, targetsNear, auraAllies, remainingRoute, stayRoute, spawnChildren, nthOf, canCast, BOOM_RADIUS, auraBuff, watchDeaths,
  unbalancedNow,
} from './helpers.js';
import { skill, stealth, ep, refraction, reborn, deathBoom } from './archetypes.js';

const num = (v, d) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v)) return +v;
  return d;
};
const tv = (ab, key, d) => num(ab && ab.t ? ab.t[key] : undefined, d);
const sv = (map, key) => {
  const v = map && map[key];
  return typeof v === 'string' && v ? v : '';
};
const bb = (sk, key, d) => num(sk && sk.bb ? sk.bb[key] : undefined, d);

function spEvery(sk, fire, sil = false) {
  if (!sk || !(sk.sp > 0)) return null;
  return {
    sk, sil,
    tick(b, e, a, dt) {
      if (!canCast(e, sil, b)) return;
      a.acc = (a.acc ?? 0) + dt;
      if (a.acc + 1e-9 < sk.sp) return;
      a.acc = 0;
      fire(b, e, a);
    },
  };
}

function timed(sk, fire, extra = {}) {
  if (!sk || !fire) return null;
  if (sk.sp > 0 && !(sk.cd > 0)) return spEvery(sk, fire, !!extra.sil);
  if (sk.cd > 0) return skill(sk, fire, extra);
  return null;
}

function replaceLater(b, e, key, delay, n = 1) {
  if (!key || !(n > 0)) return;
  const pos = [e.y, e.x];
  const route = remainingRoute(e);
  const spawn = () => spawnChildren(b, e, key, n, { countInTotal: false, pos, route });
  if (!(delay > 0)) { spawn(); return; }
  // Keep an otherwise empty field alive until its replacement arrives; ordinary visual timers must not do so.
  b.after(delay, spawn, { holdsBattle: true });
}

function nearestAlly(b, src, from, range, seen) {
  let best = null;
  let bd = range;
  for (const u of areaAllies(b, src, from.x, from.y, range)) {
    if (!u || seen.has(u.id)) continue;
    const d = hypot(u.x - from.x, u.y - from.y);
    if (d > range + 1e-9) continue;
    if (!best || d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && u.id < best.id)) { best = u; bd = d; }
  }
  return best;
}

// --- CRITIC ----------------------------------------------------------------------------------------------

/** 战线推进者: the first attack after each block has ATK ×sheltr ×(1+atk), before DEF. PowerHit is not a cooldown. */
function kitChghmr(ab) {
  const sheltr = tv(ab, 'DmgUp.sheltr_atk_scale', 2.5);
  const atk = bb(ab.sk.PowerHit, 'atk', 0.8);
  return [{
    sil: true,
    blocked(c, b, e, a) { a.armed = true; },
    hitOut(c, b, e, a) {
      if (!a.armed || !c.dmg || !c.dmg.isAttack) return;
      a.armed = false;
      c.dmg.amount *= sheltr * (1 + atk);
    },
  }];
}

/** 管乐家: +atk per second while unblocked; the next attack spends the stacks and stuns.
 *  switchMode (沉郁 / 热情) has no field-wide variation signal — left unused. */
function kitLtnclr(ab) {
  const flat = tv(ab, 'atkboostCore.atk', 30);
  const cap = tv(ab, 'atkboostCore.max_stack_count', 30);
  const stun = tv(ab, 'atkboostCore.attack@stun_duration', 10);
  return [{
    tick(b, e, a, dt) {
      if (e.blockedBy) return;
      a.acc = (a.acc ?? 0) + dt;
      if (a.acc + 1e-9 < 1) return;
      a.acc -= 1;
      a.stacks = Math.min(cap, (a.stacks ?? 0) + 1);
      b.addBuff(e, { key: 'reg:boost', persist: true, refresh: 'replace', mods: { atkFlat: flat * a.stacks } });
    },
    dealt(c, b, e, a) {
      if (!(a.stacks > 0)) return;
      if (stun > 0 && c.target && c.target.alive) b.applyStatus(c.target, 'stun', { duration: stun, source: e });
      a.stacks = 0;
      b.removeBuff(e, 'reg:boost');
    },
  }];
}

/** Target tile plus its orthogonal neighbours. The handbook cross has no radius. [ASSUMED] plus-1. */
function plusTiles(r, c, n) {
  const out = [[r, c]];
  for (let i = 1; i <= n; i++) out.push([r + i, c], [r - i, c], [r, c + i], [r, c - i]);
  return out;
}

/**
 * “投石机” / “榴弹炮”: the first attack throws one snowball (rawRangeRadius 2.5; the built rangeRadius is 0
 * because applyWay is MELEE). Talent FirstAttack.attack@first_atk_scale. Then melee only.
 * The cross radius is not on the blackboard. [ASSUMED] plus-1, the target tile and four orthogonal neighbours.
 * The client draws the existing 'lob' arc from the attack event; the sim shell uses the same speed.
 */
function kitWingnt(ab) {
  const scale = tv(ab, 'FirstAttack.attack@first_atk_scale', 1.5);
  return [{
    spawn(b, e) {
      const raw = e.def && e.def.raw && e.def.raw.stats;
      const reach = Number(raw && raw.rawRangeRadius);
      e.base.rangeRadius = Number.isFinite(reach) && reach > 0 ? reach : 2.5;
      e.profile.melee = false;
      e.profile.deferHit = true;
      e.profile.shot = 'lob';
    },
    attack(c, b, e, a) {
      if (a.thrown) return;
      a.thrown = true;
      const atk = e.s.atk * scale;
      e.profile.melee = true;
      e.profile.deferHit = false;
      e.base.rangeRadius = 0;
      for (const t of c.targets) {
        b.addProjectile({
          from: e, target: t, speed: PROJECTILE_SPEEDS.lob, visual: 'lob', source: e, hitDead: true,
          onHit: (hit) => {
            const r = Math.round(hit.y), col = Math.round(hit.x);
            b.fx('explode', { x: hit.x, y: hit.y, r: 1, kind: 'snowball', tiles: plusTiles(r, col, 1) });
            for (const u of areaAlliesInTiles(b, e, r, col, 'plus', 1)) {
              hurt(b, e, u, atk, 'phys', { isSkill: false, tags: ['splash', 'snowball'] });
            }
          },
        });
      }
    },
  }];
}

/** 雪怪小队: the same frozen-target amp as 雪怪小队破冰者, at this row's atkup.atk_scale. Regulation-only, so it stays off SPECIAL_KITS. */
function kitSnsbr(ab) {
  const scale = tv(ab, 'atkup.atk_scale', 1);
  return [{
    hitOut(c) {
      if (!c.dmg || !c.dmg.isAttack || !c.target || !c.target.s.flags.freeze) return;
      c.dmg.amount *= scale;
    },
  }];
}

/** 冰爆源石虫·α: the 冰爆源石虫 death blast. boom.freeze is the cold duration. Radius is rawRangeRadius. */
function kitSnslime(ab, e) {
  const scale = tv(ab, 'boom.atk_scale', 0);
  const cold = tv(ab, 'boom.freeze', 0);
  const raw = e.def && e.def.raw && e.def.raw.stats && e.def.raw.stats.rawRangeRadius;
  const r = typeof raw === 'number' && raw > 0 ? raw : undefined;
  return [deathBoom({ scale, r, status: cold > 0 ? { key: 'cold', dur: cold } : null })];
}

/** 冰原卫法者: silenced death boom (cold and freeze); unbalanced self HP loss is not silenced. */
function kitKrgrg(ab) {
  const scale = tv(ab, 'boom.atk_scale', 1);
  const cold = tv(ab, 'boom.cold', 0);
  const freeze = tv(ab, 'boom.freeze', 0);
  const bleed = tv(ab, 'unbalanced_bleed.damage', 0);
  const iv = tv(ab, 'unbalanced_bleed.interval', 0.066);
  return [
    {
      sil: true,
      death(c, b, e) {
        if (c.reason !== 'killed') return;
        for (const u of areaAllies(b, e, e.x, e.y, BOOM_RADIUS)) {
          if (scale > 0) hurt(b, e, u, e.s.atk * scale, 'arts');
          if (!u.alive) continue;
          if (cold > 0) b.applyStatus(u, 'cold', { duration: cold, source: e });
          if (freeze > 0 && u.alive) b.applyStatus(u, 'freeze', { duration: freeze, source: e });
        }
      },
    },
    {
      tick(b, e, a, dt) {
        if (!(bleed > 0) || !(iv > 0) || !unbalancedNow(b, e)) return;
        a.acc = (a.acc ?? 0) + dt;
        for (let n = 0; n < 4 && a.acc + 1e-9 >= iv && e.alive; n++) {
          a.acc -= iv;
          b.dealHPLose(e, bleed);
        }
      },
    },
  ];
}

/** 寻路者信使: one headshot (handbook ammo cap; no ammo key), then melee. */
function kitMtrbty(ab) {
  const scale = tv(ab, 'shotbuff.attack@headshot_atk_scale', 1.5);
  const disarm = tv(ab, 'shotbuff.attack@headshot_disarmed_duration', 15);
  const sp = tv(ab, 'shotbuff.attack@headshot_sp', -1);
  const trap = tv(ab, 'shotbuff.attack@headshot_trapdamage', 5000);
  return [{
    hitOut(c, b, e, a) {
      if (a.spent || !c.dmg || !c.dmg.isAttack) return;
      a.spent = true;
      c.dmg.mul *= scale;
      e.profile.melee = true;
    },
    dealt(c, b, e, a) {
      if (a.paid || !c.target) return;
      a.paid = true;
      const u = c.target;
      if (disarm > 0 && u.alive) b.applyStatus(u, 'disarm', { duration: disarm, source: e });
      if (u.skill && sp !== 0) u.skill.sp = Math.max(0, (u.skill.sp ?? 0) + sp);
      if (trap > 0 && u.kind === 'device' && u.alive) hurt(b, e, u, trap, 'arts');
    },
  }];
}

/** 马特奥的近卫: two phys shots down a shared row or column. Unblocked damage resistance. */
function kitBdguad(ab) {
  const sk = ab.sk.CrossBomb;
  const dr = tv(ab, 'DmgResist.damage_resistance', 0.4);
  return [
    sk && skill(sk, (b, e) => {
      const range = bb(sk, 'projectile_range', 1.1);
      const times = Math.max(1, Math.min(4, bb(sk, 'times', 2)));
      const scale = bb(sk, 'atk_scale', 0.5);
      let best = null;
      let bd = Infinity;
      for (const u of b.allies()) {
        if (!u.alive) continue;
        const line = Math.abs(u.y - e.y) < 0.5 || Math.abs(u.x - e.x) < 0.5;
        if (!line) continue;
        const d = hypot(u.x - e.x, u.y - e.y);
        if (d > range + 1e-9) continue;
        if (!best || d < bd || (d === bd && u.id < best.id)) { best = u; bd = d; }
      }
      if (!best) return;
      const shot = () => { if (best.alive) hurt(b, e, best, e.s.atk * scale, 'phys'); };
      shot();
      for (let i = 1; i < times; i++) b.after(0.3 * i, shot);
    }, {
      sil: true,
      cond: (b, e) => {
        const range = bb(sk, 'projectile_range', 1.1);
        for (const u of b.allies()) {
          if (!u.alive) continue;
          const line = Math.abs(u.y - e.y) < 0.5 || Math.abs(u.x - e.x) < 0.5;
          if (line && hypot(u.x - e.x, u.y - e.y) <= range + 1e-9) return true;
        }
        return false;
      },
    }),
    {
      hitIn(c, b, e) {
        if (e.blockedBy) return;
        const ty = c.dmg && c.dmg.type;
        if (ty !== 'phys' && ty !== 'arts') return;
        c.dmg.mul *= Math.max(0, 1 - dr);
      },
    },
  ];
}

const SOUL_VORTEX = 'enemy_1428_lrsoul';
const SOUL_CAP = 3;
// The atk_boost trigger interval and the laser's lifetime are not on the skill blackboard. [ASSUMED] 1s.
const LASER_STEP = 1;

function nearestVortex(b, e, range) {
  let best = null;
  let bd = range;
  for (const o of b.enemies) {
    if (!o || !o.alive || o === e || o.defId !== SOUL_VORTEX) continue;
    const d = hypot(o.x - e.x, o.y - e.y);
    if (d > range + 1e-9) continue;
    if (!best || d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && o.id < best.id)) { best = o; bd = d; }
  }
  return best;
}

/** One straight line through the locked target. [ASSUMED] the dominant axis of wizard → target, the whole row or column. */
function laserLine(b, e, target) {
  const horizontal = Math.abs(target.x - e.x) >= Math.abs(target.y - e.y);
  const line = [];
  for (const u of fieldAllies(b, e)) {
    if (horizontal ? Math.abs(u.y - target.y) < 0.5 : Math.abs(u.x - target.x) < 0.5) line.push(u);
  }
  return line;
}

function laserTarget(b, e) {
  const range = e.base.rangeRadius > 0 ? e.base.rangeRadius : 1.7;
  let best = null;
  let bd = Infinity;
  for (const u of targetsNear(b, e, range)) {
    const d = hypot(u.x - e.x, u.y - e.y);
    if (!best || d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && u.id < best.id)) { best = u; bd = d; }
  }
  return best;
}

function laserDamage(b, e, line, scale, ramp) {
  const amount = e.s.atk * scale * (1 + ramp);
  let far = null;
  let fd = -1;
  for (const u of line) {
    if (!u || !u.alive) continue;
    hurt(b, e, u, amount, 'arts', { isSkill: true, tags: ['laser'] });
    const d = hypot(u.x - e.x, u.y - e.y);
    if (!far || d > fd) { far = u; fd = d; }
  }
  if (far) b.fx('beam', { x: e.x, y: e.y, from: e.id, to: far.id, kind: 'soulLaser' });
}

/**
 * 聚焦 / 棱镜魂灵残迹. Pickup radius is not on captureSoul. [ASSUMED] it equals the attack rangeRadius.
 * Holding any vortex and a target in range spends every stack on Laser. ATK MULTIPLIER ramps by atk_step
 * up to atk_ladder × stacks (atkPct: the ramp starts at 0). Each tick deals ATK × atk_scale.
 * Capture is an InstantKill: no player bounty. [ASSUMED] the stage still counts the vortex as gone.
 */
function kitLrwzrd(ab) {
  const sk = ab.sk.Laser;
  const ladder = bb(sk, 'atk_ladder', 0.25);
  const scale = bb(sk, 'atk_scale', 0.4);
  const step = bb(sk, 'atk_step', 0.4);
  return [
    {
      tick(b, e, a, dt) {
        const ch = e.mem.soulLaser;
        if (ch) {
          ch.acc += dt;
          if (ch.acc + 1e-9 < LASER_STEP) return;
          ch.acc -= LASER_STEP;
          ch.ramp = Math.min(ch.cap, ch.ramp + ch.step);
          laserDamage(b, e, ch.line, ch.scale, ch.ramp);
          if (ch.ramp + 1e-9 >= ch.cap) {
            e.mem.soulLaser = null;
            e.profile.noAttack = false;
          }
          return;
        }
        if ((e.mem.soulStacks || 0) >= SOUL_CAP || !canCast(e, false, b)) return;
        const range = e.base.rangeRadius > 0 ? e.base.rangeRadius : 1.7;
        const soul = nearestVortex(b, e, range);
        if (!soul) return;
        e.mem.soulStacks = (e.mem.soulStacks || 0) + 1;
        soul.bounty = null;
        b.kill(soul, null);
      },
    },
    timed(sk, (b, e) => {
      const stacks = e.mem.soulStacks || 0;
      if (!(stacks > 0) || e.mem.soulLaser) return;
      const target = laserTarget(b, e);
      if (!target) return;
      e.mem.soulStacks = 0;
      const cap = Math.abs(ladder * stacks);
      const ramp = Math.min(step, cap);
      const line = laserLine(b, e, target);
      laserDamage(b, e, line, scale, ramp);
      if (ramp + 1e-9 < cap) {
        e.mem.soulLaser = { acc: 0, ramp, cap, step, scale, line };
        e.profile.noAttack = true;
      }
    }, {
      cond: (b, e) => (e.mem.soulStacks || 0) > 0 && !e.mem.soulLaser && !!laserTarget(b, e),
    }),
  ];
}

/** 魂灵法骸: the cooldown stands in for one orbiting fragment (no stage-prop pickup). [ASSUMED] */
function kitLrmzrd(ab) {
  const sk = ab.sk.summonFireball;
  const scale = bb(sk, 'atk_scale', 1);
  const maxN = bb(sk, 'max_projectile_count', 3);
  return [
    {
      tick(b, e, a, dt) {
        const list = e.mem.regFrags;
        if (!list || !list.length) return;
        const next = [];
        for (let i = 0; i < list.length; i++) {
          const f = list[i];
          f.ang += 2 * dt;
          const x = e.x + cos(f.ang) * 1;
          const y = e.y + sin(f.ang) * 1;
          let spent = false;
          for (const u of areaAllies(b, e, x, y, 0.4)) {
            hurt(b, e, u, e.s.atk * f.scale, 'arts');
            spent = true;
            break;
          }
          if (!spent) next.push(f);
        }
        e.mem.regFrags = next;
      },
    },
    timed(sk, (b, e) => {
      const list = e.mem.regFrags || (e.mem.regFrags = []);
      if (list.length >= maxN) return;
      list.push({ ang: list.length * 2.094, scale });
    }),
  ];
}

/** 假想敌：丛生: the first damage to each target is doubled, then that target cannot be healed. */
function kitAccrit(ab) {
  const scale = tv(ab, 'CriticalHit.damage_scale', 2);
  const dur = tv(ab, 'CriticalHit.duration', 5);
  return [{
    spawn(b, e, a) { a.seen = {}; },
    hitOut(c, b, e, a) {
      const t = c.target;
      if (!t || !c.dmg || a.seen[t.id]) return;
      a.seen[t.id] = true;
      c.dmg.mul *= scale;
      if (dur > 0) b.addBuff(t, { key: 'reg:crit', duration: dur, flags: { healFree: true, noHeal: true } });
    },
  }];
}

// --- REBORN (death replacement — not the reborn() archetype, except 1104_3) ----------------------------

/** Child soldiers / mechanics: their unsilenceable deathrattle uses the pinned key and delay. */
function kitDeathrattle(ab) {
  const key = sv(ab.tS, 'deathrattle.enemy_key');
  const delay = tv(ab, 'deathrattle.delay', 1);
  return [{ death(c, b, e) { if (c.reason === 'killed') replaceLater(b, e, key, delay); } }];
}

/** Bombardiers use Attack's child key and delay for their death replacement (PRTS talent). */
function kitDthrowDeath(ab) {
  const key = sv(ab.tS, 'Attack.enemy_key');
  const delay = tv(ab, 'Attack.delay', 1);
  return [{ death(c, b, e) { if (c.reason === 'killed') replaceLater(b, e, key, delay); } }];
}

/** Bone defender: reuse the stationary Blood Amber path already used by the bone torturer. */
function kitSpnshdDeath(ab) {
  const key = sv(ab.tS, 'Summon.enemy_key');
  const count = tv(ab, 'Summon.cnt', 0);
  return [{
    death(c, b, e) {
      if (c.reason !== 'killed' || !key || !(count > 0)) return;
      spawnChildren(b, e, key, count, { route: stayRoute(e), countInTotal: false, mods: null });
    },
  }];
}

function auraOf(b, e, ab) {
  const key = sv(ab.tS, 'deathrattle.enemy_key');
  const step = tv(ab, 'aura.atk', 0);
  const cap = tv(ab, 'aura.max_valid_stack_cnt', 6);
  if (!key || !(step > 0)) return;
  let n = 0;
  for (const o of b.aliveEnemies()) if (o.defId === key) n++;
  n = Math.min(cap, n);
  if (n > 0) b.addBuff(e, { key: 'reg:lord', duration: 0.35, refresh: 'replace', mods: { atkPct: step * n } });
  else b.removeBuff(e, 'reg:lord');
}

function kitDklord(ab) {
  const key = sv(ab.tS, 'deathrattle.enemy_key');
  const delay = tv(ab, 'deathrattle.delay', 1);
  return [{
    tick(b, e) { auraOf(b, e, ab); },
    death(c, b, e) { if (c.reason === 'killed') replaceLater(b, e, key, delay, 1); },
  }];
}

/** 责罚者: spCost 3 reads as the 4th attack (nthOf). Splash stun. Attack.enemy_key replaces it on death (PRTS: no delay). */
function kitDfat(ab) {
  const sk = ab.sk.StunAttack;
  const n = nthOf(sk);
  const dur = bb(sk, 'stun', 4);
  const key = sv(ab.tS, 'Attack.enemy_key');
  return [
    {
      sil: true,
      attack(c, b, e, a) {
        a.n = (a.n ?? 0) + 1;
        if (a.n % n) return;
        if (!(dur > 0)) return;
        for (const u of areaAllies(b, e, e.x, e.y, BOOM_RADIUS)) b.applyStatus(u, 'stun', { duration: dur, source: e });
      },
    },
    { death(c, b, e) { if (c.reason === 'killed') replaceLater(b, e, key, 0, 1); } },
  ];
}

function kitDkmage(ab) {
  const ratio = tv(ab, 'epdamage.attack@ep_damage_ratio', 0);
  const jumps = Math.max(0, tv(ab, 'epdamage.attack@max_target', 4) - 1);
  const scale = tv(ab, 'epdamage.attack@chain.atk_scale', 0.85);
  const range = tv(ab, 'epdamage.attack@projectile_range', 1.6);
  const key = sv(ab.tS, 'deathrattle.enemy_key');
  const delay = tv(ab, 'deathrattle.delay', 1);
  return [
    ratio > 0 ? ep('apoptosis', ratio) : null,
    {
      dealt(c, b, e) {
        if (!(jumps > 0) || !c.target) return;
        let from = c.target;
        const seen = new Set([from.id]);
        let mul = scale;
        for (let i = 0; i < jumps && i < 8; i++) {
          const nxt = nearestAlly(b, e, from, range, seen);
          if (!nxt) break;
          seen.add(nxt.id);
          hurt(b, e, nxt, e.s.atk * mul, 'arts');
          if (ratio > 0) elem(b, e, nxt, 'apoptosis', e.s.atk * ratio * mul);
          mul *= scale;
          from = nxt;
        }
      },
    },
    { death(c, b, e) { if (c.reason === 'killed') replaceLater(b, e, key, delay, 1); } },
  ];
}

/** 饲育者: weighted death spawn (dsfull_tr_1 RandomAction prob1, otherwise prob2, otherwise enemy_3).
 *  The child buff is MOVE_SPEED MULTIPLIER, loadFromBlackboard, value fallback 0. Talent 0.move_speed 2 is ×2.
 *  _useRandomDelay is false and _delayTime is 0, so the summon is immediate. */
function kitDsfull(ab) {
  const p1 = tv(ab, '0.prob1', 0.2);
  const p2 = tv(ab, '0.prob2', 0.5);
  const mul = tv(ab, '0.move_speed', 2);
  const cnt = tv(ab, '0.cnt', 1);
  return [{
    death(c, b, e) {
      if (c.reason !== 'killed') return;
      const r = b.rng();
      let key = sv(ab.tS, '0.enemy_3');
      if (r < p1) key = sv(ab.tS, '0.enemy_1');
      else if (r < p1 + p2) key = sv(ab.tS, '0.enemy_2');
      if (!key) return;
      const pos = [e.y, e.x];
      const route = remainingRoute(e);
      const kids = spawnChildren(b, e, key, cnt, { countInTotal: false, pos, route });
      for (let i = 0; i < kids.length; i++) {
        b.addBuff(kids[i], { key: 'reg:fast', persist: true, mods: { moveMul: mul } });
      }
    },
  }];
}

/**
 * “左手”泰特斯: reborn() plus a silenced ATK cut on the highest-ATK ally. The cut shows on that operator as the 'weaken'
 * status icon (round 83: a report said it did not seem to work — it did, with nothing drawn on the operator; the official
 * skill keeps wind_buff_01 on its target meanwhile). Its value stays the additive atkPct of the blackboard.
 */
function kitLfkght(ab) {
  const sk = ab.sk.AtkDesWeaken;
  return [
    reborn({ dur: tv(ab, 'reborn.duration', 5) }),
    timed(sk, (b) => {
      let best = null;
      for (const u of b.allies()) {
        if (!u.alive) continue;
        if (!best || u.s.atk > best.s.atk || (u.s.atk === best.s.atk && u.id < best.id)) best = u;
      }
      if (!best) return;
      b.addBuff(best, { key: 'reg:weaken', duration: bb(sk, 'duration', 25), mods: { atkPct: bb(sk, 'atk', -0.5) }, visible: true, status: 'weaken' });
    }, { sil: true }),
  ];
}

/** 沸血骑士团精锐: each other enemy knock-down adds enhance.atk and enhance.attack_speed, up to enhance.max_stack_cnt.
 *  A leak is not a knock-down [ASSUMED]: the line says 死亡, and the other 规程 death hooks count reason 'killed' only. */
function kitWdkght(ab) {
  const atk = tv(ab, 'enhance.atk', 0.1);
  const aspd = tv(ab, 'enhance.attack_speed', 5);
  const cap = tv(ab, 'enhance.max_stack_cnt', 10);
  return [{
    spawn(b, e) { watchDeaths(b, e); },
    otherDeath(c, b, e) {
      const v = c.unit;
      if (c.reason !== 'killed' || !v || v === e || v.side !== 'enemy') return;
      b.addBuff(e, {
        key: 'reg:wdkght', refresh: 'stack', stacks: 1, maxStacks: cap, persist: true,
        mods: { atkPct: atk, aspd },
      });
    },
  }];
}

function kitHarchn(ab) {
  const key = sv(ab.tS, 'deathrattle.enemy_key');
  const cnt = tv(ab, 'deathrattle.cnt', 4);
  const delay = tv(ab, 'deathrattle.delay', 0.2);
  const sk = ab.sk.SummonToken;
  return [
    {
      sil: true,
      death(c, b, e) { if (c.reason === 'killed') replaceLater(b, e, key, delay, cnt); },
    },
    timed(sk, (b, e) => {
      const k = sv(sk.bs, 'enemy_key') || key;
      const n = bb(sk, 'cnt', 1);
      const pos = [e.y, e.x];
      const route = remainingRoute(e);
      spawnChildren(b, e, k, n, { countInTotal: false, pos, route });
    }, { sil: true }),
  ];
}

/** 寄生者: a nearby enemy's knock-down summons 大君之赐. Not its own death.
 *  被击倒 is reason 'killed' (a leak is not a knock-down). The summoned gift's own
 *  knock-down does not count: each parasite in range would replace one dead gift
 *  with another, and two of them grow without bound [ASSUMED]. */
function kitAcpara(ab) {
  const key = sv(ab.tS, 'Aura.enemy_key');
  const radius = tv(ab, 'Aura.range_radius', 1.5);
  return [{
    sil: true,
    spawn(b, e) { watchDeaths(b, e); },
    otherDeath(c, b, e) {
      const v = c.unit;
      if (c.reason !== 'killed' || !v || v === e || v.side !== 'enemy' || !key) return;
      if (v.defId === key) return;
      if (hypot(v.x - e.x, v.y - e.y) > radius + 1e-9) return;
      spawnChildren(b, e, key, 1, { countInTotal: false, pos: [v.y, v.x], route: remainingRoute(e) });
    },
  }];
}

// --- the other new draws --------------------------------------------------------------------------------

/** 假想敌：影役: stealth, and block count −1 on allies in range (one shared buff, so it does not stack). */
function kitAcblk(ab) {
  const radius = tv(ab, 'Aura.range_radius', 1.8);
  const block = tv(ab, 'Aura.block_cnt', -1);
  return [
    stealth(),
    {
      tick(b, e) {
        for (const u of auraAllies(b, e, e.x, e.y, radius)) {
          if (u.kind !== 'op') continue;
          auraBuff(b, u, 'reg:blockdown', 0.25, { blockCnt: block }, null, true);
        }
      },
    },
  ];
}

/** 假想敌：镜眼: refraction, and a silenced ASPD cut on the source of arts damage. */
function kitAcrefm(ab) {
  const res = tv(ab, 'refracting.magic_resistance', 70);
  const aspd = tv(ab, 'refracting.attack_speed', -50);
  const dur = tv(ab, 'refracting.duration', 3);
  return [
    refraction(res),
    {
      sil: true,
      taken(c, b) {
        if (!c.dmg || c.dmg.type !== 'arts' || !c.source || !c.source.alive) return;
        if (!(dur > 0)) return;
        b.addBuff(c.source, { key: 'reg:refslow', duration: dur, refresh: 'replace', mods: { aspd } });
      },
    },
  ];
}

/** 假想敌：镜波: refraction, and on death the lowest-RES enemy nearby gains RES. */
function kitAcrefd(ab) {
  const res = tv(ab, 'refracting.magic_resistance', 70);
  const radius = tv(ab, 'refracting.range_radius', 1.2);
  const bonus = tv(ab, 'refracting.acrefd[magic-resistance].magic_resistance', 10);
  return [
    refraction(res),
    {
      sil: true,
      death(c, b, e) {
        if (c.reason !== 'killed' || !(bonus > 0)) return;
        let best = null;
        for (const o of b.enemiesInRadius(e.x, e.y, radius)) {
          if (!o.alive || o === e) continue;
          if (!best || o.s.res < best.s.res || (o.s.res === best.s.res && o.id < best.id)) best = o;
        }
        if (best) b.addBuff(best, { key: 'reg:res', persist: true, mods: { resFlat: bonus } });
      },
    },
  ];
}

/** “模拟宝藏”: a hostage when the enemy record itself is spawned. It does not attack (applyWay NONE)
 *  and does not move. The command deploys an ally device instead (content/bands/commands.js): enemy
 *  contact and the survival coin live there, so this kit is not the payoff. */
function kitAchest() {
  return [{
    spawn(b, e) {
      e.profile.noAttack = true;
      b.addBuff(e, { key: 'reg:hostage', persist: true, flags: { noMove: true } });
    },
  }];
}

/** Recompute the block-count bonus on `u` from the Reborn Creations (`enemy_bloodsucker_block_cnt`) it holds. */
function syncRebornBlocker(b, u) {
  if (!u || !u.alive) return;
  let total = 0;
  let cap = 6;
  for (const o of u.blocking || []) {
    if (!o.alive || o.blockedBy !== u || !(o.mem?.rebornBlockStep > 0)) continue;
    total += o.mem.rebornBlockStep;
    if (o.mem.rebornBlockCap > 0) cap = Math.min(cap, o.mem.rebornBlockCap);
  }
  total = Math.min(cap, total);
  if (total > 0) b.addBuff(u, { key: 'reg:rebornBlocker', persist: true, refresh: 'replace', mods: { blockCnt: total } });
  else b.removeBuff(u, 'reg:rebornBlocker');
}

/** 大君之触 / 仁慈之触 / 大君之赐 / 慷慨之赐: 90% phys/arts DR (`dmg_res.damage_resistance`; true damage is not in
 *  that key). No buff template names `dmg_res`, so silence not removing it is [ASSUMED] (the sibling block buff
 *  `enemy_bloodsucker_block_cnt[control]` is explicitly unsilenceable). +1 blockCnt per blocked copy, capped by
 *  `max_valid_stack_cnt` (6), recomputed from whoever is actually blocking it. */
function kitRebornCreation(ab) {
  const dr = tv(ab, 'dmg_res.damage_resistance', 0.9);
  const blockStep = tv(ab, 'buff_to_blocker.block_cnt', 1);
  const blockCap = tv(ab, 'buff_to_blocker.max_valid_stack_cnt', 6);
  const mul = Math.max(0, 1 - dr);
  return [{
    spawn(b, e, a) {
      a.blocker = null;
      e.mem.rebornBlockStep = blockStep;
      e.mem.rebornBlockCap = blockCap;
      b.addBuff(e, { key: 'reg:rebornCreation', persist: true, mods: { physTakenMul: mul, artsTakenMul: mul } });
    },
    blocked(c, b, e, a) {
      const prev = a.blocker;
      a.blocker = c.blocker ?? e.blockedBy ?? null;
      if (prev && prev !== a.blocker) syncRebornBlocker(b, prev);
      if (a.blocker) syncRebornBlocker(b, a.blocker);
    },
    tick(b, e, a) {
      const cur = e.blockedBy ?? null;
      if (cur === a.blocker) return;
      const prev = a.blocker;
      a.blocker = cur;
      if (prev) syncRebornBlocker(b, prev);
      if (cur) syncRebornBlocker(b, cur);
    },
    death(c, b, e, a) {
      const prev = a.blocker;
      a.blocker = null;
      if (prev) syncRebornBlocker(b, prev);
    },
  }];
}

/** “喷射罐” / “喷爆罐”: Attack_Begin (0.6 s) -> Attack_Loop (1.0 s, OnAttack at 0) × `Boom.attack@times` (3) -> Attack_End
 *  (0.267 s), next spray after `Boom.attack@cooldown` (4 s) from spray start [ASSUMED: exact C# channel cadence uses
 *  1.0 s Attack_Loop × times scaled by ASPD and `cooldown` from spray start; CC or losing the target ends the spray];
 *  silenced death blast (`Boom.atk_scale` arts + `Boom.freeze` s cold, BOOM_RADIUS [ASSUMED]). */
function kitWinbom(ab) {
  const times = Math.max(1, Math.round(tv(ab, 'Boom.attack@times', 3)));
  const cd = tv(ab, 'Boom.attack@cooldown', 4);
  const boomScale = tv(ab, 'Boom.atk_scale', 1);
  const boomCold = tv(ab, 'Boom.freeze', 10);
  return [
    {
      attack(c, b, e, a) {
        const t = c.targets && c.targets[0];
        if (!t || !(times > 1)) return;
        const scale = 100 / Math.max(10, e.s.aspd || 100);
        a.spray = {
          target: t,
          depSeq: c.targetDeployments?.get(t) ?? t.deploySeq,
          left: times - 1,
          timer: 1,
          pendingCd: Math.max(e.s.interval, cd * scale),
          standUntil: b.time + times * scale,
        };
      },
      tick(b, e, a, dt) {
        const s = a.spray;
        if (!s) return;
        if (s.pendingCd != null) {
          e.atkCd = s.pendingCd;
          s.pendingCd = null;
          e.atkStandUntil = Math.max(e.atkStandUntil, s.standUntil);
          return;
        }
        if (!canCast(e, false, b) || e.s.flags.fear || e.s.flags.disarm || (e.s.flags.tremble && e.blockedBy)) {
          a.spray = null;
          b._cutAttackStand(e);
          return;
        }
        const t = s.target;
        const reach = (e.base.rangeRadius || 1) + ALLY_COLLIDER_RADIUS;
        const valid = t && t.alive && t.deploySeq === s.depSeq
          && (e.blockedBy === t ? !!t.deployed : (canTargetAlly(e, t, true) && hypot(t.x - e.x, t.y - e.y) <= reach + 1e-9));
        if (!valid) {
          a.spray = null;
          b._cutAttackStand(e);
          return;
        }
        const rate = Math.max(10, e.s.aspd || 100) / 100;
        s.timer -= dt * rate;
        if (s.timer > 1e-9) return;
        s.timer += 1;
        s.left--;
        const depSeq = s.depSeq;
        const rangedShot = !(e.blockedBy && t === e.blockedBy && (e.base.rangeRadius || 1) < 1);
        b._ev(['atk', e.id, t.id, rangedShot ? 'enemy' : 'none']);
        const attackId = ++b._attackSeq;
        const hit = (tt, isProjectile = false) => {
          if (!tt || !tt.alive || tt.deploySeq !== depSeq) return;
          if (!e.alive && !rangedShot) return;
          b.dealDamage(e, tt, { amount: e.s.atk * (e.profile?.atkScale ?? 1), type: 'arts', isAttack: true, attackId, isProjectile });
        };
        if (rangedShot && hypot(t.x - e.x, t.y - e.y) > 0.75) {
          b.addProjectile({ from: e, target: t, speed: PROJECTILE_SPEEDS.enemy, visual: 'enemy', source: e, onHit: (c) => hit(c.target, true) });
        } else hit(t);
        if (s.left <= 0) {
          a.spray = null;
          e.atkStandUntil = Math.max(e.atkStandUntil, b.time + 0.267);
        } else {
          e.atkStandUntil = Math.max(e.atkStandUntil, b.time + 1 / rate);
        }
      },
    },
    deathBoom({ scale: boomScale, type: 'arts', status: boomCold > 0 ? { key: 'cold', dur: boomCold } : null }),
  ];
}

const same = (kit) => kit;

export const REGULATION_KITS = Object.freeze({
  enemy_1406_chghmr: kitChghmr,
  enemy_1375_ltnclr: kitLtnclr,
  enemy_1375_ltnclr_2: same(kitLtnclr),
  enemy_1385_winbom: kitWinbom,
  enemy_1385_winbom_2: same(kitWinbom),
  enemy_1388_wingnt: kitWingnt,
  enemy_1388_wingnt_2: same(kitWingnt),
  enemy_1191_krgrg: kitKrgrg,
  enemy_1191_krgrg_2: same(kitKrgrg),
  enemy_1064_snsbr: kitSnsbr,
  enemy_1067_snslime_2: kitSnslime,
  enemy_1219_mtrbty: kitMtrbty,
  enemy_1409_bdguad_2: kitBdguad,
  enemy_1429_lrwzrd: kitLrwzrd,
  enemy_1429_lrwzrd_2: same(kitLrwzrd),
  enemy_1431_lrmzrd: kitLrmzrd,
  enemy_1431_lrmzrd_2: same(kitLrmzrd),
  enemy_9040_accrit: kitAccrit,
  enemy_1220_dzoms: kitRebornCreation,
  enemy_1220_dzoms_2: same(kitRebornCreation),
  enemy_1221_dzomg: kitRebornCreation,
  enemy_1221_dzomg_2: same(kitRebornCreation),
  enemy_1222_dpvt: kitDeathrattle,
  enemy_1222_dpvt_2: same(kitDeathrattle),
  enemy_1223_dmech: kitDeathrattle,
  enemy_1223_dmech_2: same(kitDeathrattle),
  enemy_1361_dthrow: kitDthrowDeath,
  enemy_1361_dthrow_2: same(kitDthrowDeath),
  enemy_1363_spnshd_2: kitSpnshdDeath,
  enemy_1226_dklord: kitDklord,
  enemy_1226_dklord_2: same(kitDklord),
  enemy_1362_dfat: kitDfat,
  enemy_1362_dfat_2: same(kitDfat),
  enemy_1225_dkmage: kitDkmage,
  enemy_1225_dkmage_2: same(kitDkmage),
  enemy_1437_dsfull: kitDsfull,
  enemy_1437_dsfull_2: same(kitDsfull),
  enemy_1104_lfkght_3: kitLfkght,
  enemy_1104_lfkght: same(kitLfkght),
  enemy_1103_wdkght_2: kitWdkght,
  enemy_1133_harchn: kitHarchn,
  enemy_1133_harchn_2: same(kitHarchn),
  enemy_1131_sbeast: same(kitHarchn),
  enemy_1131_sbeast_2: same(kitHarchn),
  enemy_1132_sarchn: same(kitHarchn),
  enemy_1132_sarchn_2: same(kitHarchn),
  enemy_9030_acpara: kitAcpara,
  enemy_9034_acblk: kitAcblk,
  enemy_9039_acrefm: kitAcrefm,
  enemy_9031_acrefd: kitAcrefd,
  enemy_9038_achest: kitAchest,
});
