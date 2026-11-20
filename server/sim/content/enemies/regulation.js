// server/sim/content/enemies/regulation.js — 规程·序列Ⅰ special enemies (CRITIC / REBORN and the new draws).
//
// Kept off KITS: test/content/enemies_bosses.test.js requires every KITS key in the default enemies.json.
// enemies.js onSpawn falls back to REGULATION_KITS. This module does not import enemies.js.
//
// Official numbers are read from the enemy record. Points with no blackboard are marked [ASSUMED].

import { hypot, sin, cos } from '../../detmath.js';
import { ALLY_COLLIDER_RADIUS, PROJECTILE_SPEEDS, MOVE_SCALE } from '../../constants.js';
import { canTargetAlly, areaSelectable } from '../../targeting.js';
import { isHpLoss } from '../../attack.js';
import {
  hurt, elem, areaAllies, areaAlliesInTiles, fieldAllies, targetsNear, auraAllies, remainingRoute, stayRoute, spawnChildren, nthOf, canCast, BOOM_RADIUS, auraBuff, watchDeaths,
  unbalancedNow, castSlot, stepToward,
} from './helpers.js';
import { skill, stealth, ep, refraction, reborn, deathBoom, blockWeight, noAirTargets } from './archetypes.js';

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

/**
 * 萨卡兹子裔轰击者 / 毁击者: PRTS 萨卡兹子裔轰击者 「攻击发射高爆弹，抵达目标位置后延迟4s引爆，对半径1.1范围内的我方单位造成物理伤害」.
 * The attack is the engine's (cooldown, stand, the 'atk' event of kind 'bomb'); its shell (projectile_enemy_dthrow: a
 * ParacurveMovement at `_speed` 8 = PROJECTILE_SPEEDS.bomb, `_delayTime` 4) flies to where the target stood, then blows up
 * `Attack.attack@projectile_delay_time` s later on every ally its area selection takes within
 * `Attack.attack@projectile_radius` — whoever stands there then, the dead thrower's shell too (the projectile is not
 * managed by its source). [ASSUMED] 100 % of the ATK at the throw (no multiplier in the data or the PRTS line). The death
 * replacement stays kitDthrowDeath's.
 */
function kitDthrow(ab) {
  const delay = tv(ab, 'Attack.attack@projectile_delay_time', 4);
  const radius = tv(ab, 'Attack.attack@projectile_radius', 1.1);
  const blast = (b, e, atk, x, y) => {
    b.fx('explode', { x, y, r: radius, kind: 'dthrowShell' });
    for (const u of areaAllies(b, e, x, y, radius)) hurt(b, e, u, atk, 'phys', { isSkill: false, tags: ['shell'] });
  };
  return [...kitDthrowDeath(ab), {
    spawn(b, e) { e.profile.deferHit = true; e.profile.shot = 'bomb'; },
    attack(c, b, e) {
      const atk = e.s.atk * (e.profile.atkScale ?? 1);
      for (const t of c.targets) {
        b.addProjectile({ from: e, to: { x: t.x, y: t.y }, speed: PROJECTILE_SPEEDS.bomb, visual: 'bomb', source: e,
          onHit: (h) => {
            const x = h.x, y = h.y;
            b.fx('telegraph', { x, y, r: radius, dur: delay, kind: 'dthrowShell', id: e.id });
            if (delay > 0) b.after(delay, () => blast(b, e, atk, x, y));
            else blast(b, e, atk, x, y);
          } });
      }
    },
  }];
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

/**
 * 萨卡兹骸骨卫士长: PRTS 「受到我方默认类单位造成的伤害后令伤害来源在5s内攻击速度-40（重复时不叠加，不重置持续时间）」 — template
 * enemy_spnshd_atk_speed: ON_TAKE_DAMAGE (no 流失), the damage's source verified as a unit of our side it may select
 * (VertifyTarget ENEMY / DEFAULT, ignoreTargetFree false: areaSelectable — no 隐匿, untargetable, sleeping or airborne 起飞 one,
 * no device), then ATTACK_SPEED ADDITION `Summon.attack_speed` for `Summon.duration` s with override UNIQUE (one shared key,
 * refresh 'keep': a second hit, from any 卫士长, neither stacks nor restarts it). A 无来源 hit names no source. [ASSUMED]
 * 默认类 = every ally that is no device (炎佑 included). The two 血珀 stay kitSpnshdDeath's; the 反巫术变位炸弹 aura has no
 * counterpart in this mode.
 */
function kitSpnshd(ab) {
  const aspd = tv(ab, 'Summon.attack_speed', -40);
  const dur = tv(ab, 'Summon.duration', 5);
  return [...kitSpnshdDeath(ab), {
    taken(c, b, e) {
      const s = c.source;
      if (!(dur > 0) || !s || s.side !== 'ally' || isHpLoss(c.dmg) || !areaSelectable(e, s)) return;
      b.addBuff(s, { key: 'reg:spnshdSlow', duration: dur, refresh: 'keep', mods: { aspd } });
    },
  }];
}

/**
 * 新生血裔: PRTS 「平时仅进行近战攻击，造成法术伤害；攻击时，攻击倍率提升至：(100% + 20%×目标当前阻挡的敌人数量）；成功造成伤害后，治疗
 * 自身相当于伤害量220%的生命值」. The melee arts attack is the data's (applyWay MELEE, dmgType arts). Template
 * enemy_dfello_damge_up: ON_CALCULATE_DAMAGE, atk_scale = |block count × `DamageUp.scale_ratio` + `DamageUp.add_on`| on
 * the attack (before DEF / RES) — the enemies its target is blocking now, itself included; enemy_dslime_vampire: after
 * the damage, a heal of `vampire.heal_scale` × the damage dealt. 「被击倒时留下<血珀>」 (`Summon.enemy_key` ×
 * `Summon.cnt`, template enemy_dfello_summon[dseed]) is the bone defender's path (kitSpnshdDeath).
 */
function kitDfello(ab) {
  const ratio = tv(ab, 'DamageUp.scale_ratio', 0.2);
  const add = tv(ab, 'DamageUp.add_on', 1);
  const heal = tv(ab, 'vampire.heal_scale', 2.2);
  return [{
    hitOut(c) {
      const t = c.target;
      if (!t || !c.dmg || !c.dmg.isAttack) return;
      let n = 0;
      for (const o of t.blocking || []) if (o && o.alive && o.blockedBy === t) n++;
      c.dmg.amount *= Math.abs(n * ratio + add);
    },
    dealt(c, b, e) {
      if (heal > 0 && c.amount > 0 && e.alive) b.heal(e, e, c.amount * heal, { self: true });
    },
  }, ...kitSpnshdDeath(ab)];
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
 *  `max_valid_stack_cnt` (6), recomputed from whoever is actually blocking it. These four keys are the 重生造物 of the
 *  data (their handbook line 「重生造物（受到的物理和法术伤害大幅降低）」): `mem.rebornCreation` marks them for the
 *  补给车 auras (kitDsuply), whose 凋亡 riders their attacks carry. */
function kitRebornCreation(ab) {
  const dr = tv(ab, 'dmg_res.damage_resistance', 0.9);
  const blockStep = tv(ab, 'buff_to_blocker.block_cnt', 1);
  const blockCap = tv(ab, 'buff_to_blocker.max_valid_stack_cnt', 6);
  const mul = Math.max(0, 1 - dr);
  return [{
    spawn(b, e, a) {
      a.blocker = null;
      e.mem.rebornCreation = true;
      e.mem.rebornBlockStep = blockStep;
      e.mem.rebornBlockCap = blockCap;
      b.addBuff(e, { key: 'reg:rebornCreation', persist: true, mods: { physTakenMul: mul, artsTakenMul: mul } });
    },
    // each 补给车 aura held (kitDsuply: one buff per cart kind) adds its own 凋亡 instance to an attack that lands
    dealt(c, b, e) {
      const t = c.target;
      if (!t) return;
      const shares = [];
      for (const x of e.buffs) if (x.data && x.data.dsuplyEp > 0) shares.push(x.data.dsuplyEp);
      for (const s of shares) elem(b, e, t, 'apoptosis', e.s.atk * s);
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

// --- companions whose abilities come from their PRTS pages (round 84; the round-83 audit's open list) ------------

/**
 * The ally a straight shot of `e` along (dx, dy) — one axis, a unit step — meets first: its centre within 0.5 of the line
 * (the row / column band), at most `reach` ahead and no more than an ally collider behind the shooter's centre, nearest
 * first (ties by id). `pick(u)` admits a candidate.
 */
function firstOnLine(b, e, dx, dy, reach, pick) {
  let best = null;
  let bd = Infinity;
  for (const u of b.allies()) {
    if (!pick(u)) continue;
    const along = dx ? (u.x - e.x) * dx : (u.y - e.y) * dy;
    const off = dx ? Math.abs(u.y - e.y) : Math.abs(u.x - e.x);
    if (off >= 0.5 || along < -ALLY_COLLIDER_RADIUS || along > reach + 1e-9) continue;
    if (!best || along < bd - 1e-9 || (Math.abs(along - bd) <= 1e-9 && u.id < best.id)) { best = u; bd = along; }
  }
  return best;
}

/** The unit step [dx, dy] of the dominant axis from `e` towards `t` (a tie, or the same point, reads as a row). */
const axisTo = (e, t) => {
  const dx = t.x - e.x, dy = t.y - e.y;
  return Math.abs(dx) >= Math.abs(dy) ? [dx < 0 ? -1 : 1, 0] : [0, dy < 0 ? -1 : 1];
};

/**
 * 速射轻弩手 / 速射劲弩手 直击 (`CrossAttack`, cooldown 5, initCooldown 2; PRTS 速射轻弩手 「与我方处于同一直线上时进行直击：向目标
 * 方向发射3支弩箭，每支弩箭对击中的首个目标造成攻击力100%的物理伤害」). The official ability is a MultiRangedAttack (fx index
 * units.enemy_1403_gunsho.skills.crossattack: 1 + `additionalTimes` 2 shots, `triggerDelta` 0.1 s apart, animKey Skill =
 * GUNSHO_CLIP in data/assets.json; projectile_enemy_gunsho at `_speed` 5), so it takes the attack's turn (DESIGN §35.52):
 * its trigger is its own line check (`own`), its cooldown counts from the clip's end, it stands through the clip. The
 * nearest ally it can target (canTargetAlly: a ranged pick) in its row or column sets the direction; each bolt flies at
 * the first such ally in that direction then. [ASSUMED] the reach (GUNSHO_REACH, as 重弩突袭者's 直击), the first bolt at
 * the cast, a stun / silence or its death cancelling the bolts not yet shot (as 重弩突袭者), a bolt whose ally falls in
 * flight hitting nothing. Not in ENEMY_ATTACK_SKILL_CLIP: that table holds the default season's keys only.
 */
const GUNSHO_SHOTS = 3, GUNSHO_GAP = 0.1, GUNSHO_CLIP = 1.567, GUNSHO_BOLT_SPEED = 5, GUNSHO_REACH = 6;

function kitGunsho(ab) {
  const sk = ab.sk.CrossAttack;
  const target = (b, e) => {
    let best = null;
    let bd = Infinity;
    for (const u of b.allies()) {
      if (!canTargetAlly(e, u, true)) continue;
      const dx = u.x - e.x, dy = u.y - e.y;
      if (!(Math.abs(dy) < 0.5 || Math.abs(dx) < 0.5)) continue;
      const d = hypot(dx, dy);
      if (d > GUNSHO_REACH + 1e-9) continue;
      if (!best || d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && u.id < best.id)) { best = u; bd = d; }
    }
    return best;
  };
  return [skill(sk, (b, e) => {
    const t = target(b, e);
    if (!t) return;
    const [dx, dy] = axisTo(e, t);
    b.addBuff(e, { key: 'reg:gunshoAim', duration: GUNSHO_CLIP, flags: { noMove: true } });
    const shoot = () => {
      if (!e.alive || e.hidden || e.s.flags.stun || e.s.flags.silence) return;
      const u = firstOnLine(b, e, dx, dy, GUNSHO_REACH, (o) => canTargetAlly(e, o, true));
      if (!u) return;
      const atk = e.s.atk;
      b.addProjectile({ from: e, target: u, speed: GUNSHO_BOLT_SPEED, visual: 'enemy', source: e,
        onHit: (h) => { if (h.target && h.target.alive) hurt(b, e, h.target, atk, 'phys', { tags: ['crossBolt'] }); } });
    };
    shoot();
    for (let i = 1; i < GUNSHO_SHOTS; i++) b.after(GUNSHO_GAP * i, shoot, { owner: e });
  }, { sil: true, cond: (b, e) => !!target(b, e), turn: { atk: true, clip: GUNSHO_CLIP, own: true } })];
}

/**
 * 无畏掷弹兵 (PRTS: 「仅一次，未受沉默影响且未被阻挡时，受到伤害后进入掷弹模式；掷弹模式下无法攻击/被阻挡」; 投弹 [掷弹模式]
 * 「向自身上/下/左/右方向各发射一个炸弹（炸弹为直击弹道），每个炸弹接触到首个我方单位时爆炸，对1.1半径范围内我方单位造成攻击力200%的物理
 * 伤害 ※技能结束后退出掷弹模式，移动速度+0.7，重量-2 ※此技能仅能触发一次，不可沉默，触发技能不需要目标」). Template
 * enemy_boomer_skill_trigger: ON_TAKE_DAMAGE (no 流失), not SILENCED, not blocked → the D2L mode, whose one skill Bomb
 * (`atk_scale`, `projectile_range`) is a NoTargetRangedAttack on Skill_1 (BOOMER_CLIP, data/assets.json); each bomb is a
 * projectile_enemy_boomer at `_speed` 5 and bursts on the first ally (canTargetAlly) in its direction, the burst an area
 * selection; then the Light mode: `Light.move_speed` flat, `Light.mass_level` 重量. [ASSUMED] it stands through the clip,
 * the four bombs leave at its start, a bomb flies on to the field's edge (no range in the data or PRTS; nobody in its way:
 * no burst) and bursts where its ally stood if that ally falls first.
 */
const BOOMER_CLIP = 1.467, BOOMER_BOMB_SPEED = 5;
/** 上 / 右 / 下 / 左 as [dx, dy], in the official neighbour order (grid.js FOUR_WAYS; UP = row + 1). */
const FOUR_DIRS = Object.freeze([[0, 1], [1, 0], [0, -1], [-1, 0]]);

function kitBoomer(ab) {
  const sk = ab.sk.Bomb;
  const scale = bb(sk, 'atk_scale', 2);
  const radius = bb(sk, 'projectile_range', 1.1);
  const speed = tv(ab, 'Light.move_speed', 0.7);
  const mass = tv(ab, 'Light.mass_level', -2);
  const blast = (b, e, atk, x, y) => {
    b.fx('explode', { x, y, r: radius, kind: 'boomerBomb' });
    for (const u of areaAllies(b, e, x, y, radius)) hurt(b, e, u, atk, 'phys', { tags: ['boomerBomb'] });
  };
  const light = (b, e, a) => {
    if (!e.alive || a.mode !== 'bomb') return;
    a.mode = 'light';
    b.addBuff(e, { key: 'reg:boomerLight', persist: true, mods: { moveFlat: speed, massFlat: mass } });
  };
  return [{
    taken(c, b, e, a) {
      if (a.mode || !e.alive || !(e.hp > 0) || isHpLoss(c.dmg) || e.s.flags.silence || e.blockedBy) return;
      a.mode = 'bomb';
      b.addBuff(e, { key: 'reg:boomerBomb', duration: BOOMER_CLIP, flags: { unblockable: true, disarm: true, noMove: true },
        onExpire: ({ battle }) => light(battle, e, a) });
      if (sk) castSlot(b, e, sk);
      const atk = e.s.atk * scale;
      for (const [dx, dy] of FOUR_DIRS) {
        const t = firstOnLine(b, e, dx, dy, Infinity, (u) => canTargetAlly(e, u, true));
        if (!t) continue;
        b.addProjectile({ from: e, target: t, speed: BOOMER_BOMB_SPEED, visual: 'enemy', source: e, hitDead: true,
          onHit: (h) => blast(b, e, atk, h.x, h.y) });
      }
    },
  }];
}

/**
 * 萨卡兹子裔补给车 / 改装补给车 (PRTS 萨卡兹子裔补给车 「不会攻击飞行单位；在场时，场上所有重生造物攻击力提升10%（最多叠加5层），且攻击时
 * 附加各自攻击力10%的凋亡损伤（可被沉默）※与萨卡兹子裔改装补给车提供的效果分别计算」). Its talent `aura` is a SilenceableTalent
 * GlobalAuraAbility (fx index); the buff template enemy_dsuply_t[aura] (`_2`: enemy_dsuply_2_t[aura]) gives every 重生造物
 * one STACK of `[attr_buff]` (ATK MULTIPLIER `.atk`) per cart, valid up to `.max_valid_stack_cnt`, and on each damage it
 * calculates 凋亡 = its ATK × `aura.ep_damage_ratio` × the valid stacks (`_multiplyWithBuffValidStackCnt`). So: n living
 * carts of one kind not silenced and not hidden → atkPct `.atk` × min(n, cap) and an 凋亡 share × min(n, cap) on each
 * attack (kitRebornCreation's rider), one buff per kind. [ASSUMED] the share multiplies with the stacks as the template
 * says (PRTS's line reads 10 % flat: the two agree for one cart), it rides the attacks only (PRTS 「攻击时」), the creation's
 * own silence does not stop it, and it lingers DSUPLY_HOLD s after the last cart is gone or silenced.
 */
const DSUPLY_HOLD = 0.1;

function kitDsuply(ab) {
  const talent = (suffix, d) => {
    const k = Object.keys(ab.t).find((x) => x.startsWith('aura.') && x.endsWith(`[attr_buff].${suffix}`));
    return k ? tv(ab, k, d) : d;
  };
  const atk = talent('atk', 0.1);
  const cap = Math.max(0, Math.round(talent('max_valid_stack_cnt', 5)));
  const share = tv(ab, 'aura.ep_damage_ratio', 0.1);
  return [noAirTargets(), {
    sil: true,
    tick(b, e) {
      let lead = null;
      let n = 0;
      for (const o of b.enemies) {
        if (!o.alive || o.hidden || o.defId !== e.defId || o.s.flags.silence) continue;
        if (!lead) lead = o;
        n++;
      }
      if (lead !== e) return;                                 // the earliest of its kind writes for all of them
      const v = Math.min(cap, n);
      if (!(v > 0)) return;
      for (const o of b.enemies) {
        if (!o.alive || o.hidden || !o.mem.rebornCreation) continue;
        b.addBuff(o, { key: `reg:dsuply:${e.defId}`, duration: DSUPLY_HOLD, refresh: 'replace', mods: { atkPct: atk * v }, data: { dsuplyEp: share * v } });
      }
    },
  }];
}

/**
 * 狂暴凶豕兽 (PRTS 「占用2个阻挡数；拥有冲撞光环：碰撞半径0.5，可对空，只会选择位于低地地块的我方单位，造成当前移动速度×800的预计算近战
 * 途径物理伤害与0秒晕眩；每0.1秒检测一次：①若受晕眩/冻结/浮空/束缚影响，停止冲撞 ②若未受上述异常效果影响、且未被阻挡，开始冲撞；冲撞时，
 * 每0.333秒尝试获得1层移动速度+33.3%的增益，最多尝试35次（增益于停止冲撞时解除；每次开始冲撞后3秒内的加速尝试将失败），同时普通攻击附加
 * 的Buff会额外造成一次当前移动速度×600的预计算近战途径物理伤害，成功造成该额外伤害后停止冲撞」), as the templates enemy_mhboar_t_listener
 * [a]–[e] / [trigger] / _t_atk / _crash read:
 *   - block weight BOAR_BLOCK (the handbook 「只能被阻挡数大于等于2的单位阻挡」; the data's blockCnt is 1);
 *   - the listener every BOAR_LISTEN s, its first look at the spawn (as 萨卡兹穿刺手's): 晕眩 / 冻结 / 浮空 / 束缚 (statuses
 *     stun / freeze / levitate / bind — not 沉睡) end the rush and its layers; free of them and unblocked it starts one —
 *     a block does not end it;
 *   - every `Rush.mhboar_t[trigger].interval` s of a rush one try, at most `trig_cnt`, each a layer of move speed
 *     +`move_speed` (MULTIPLIER, the layers add up) unless it falls inside the first `Rush.mhboar_t_predelay.predelay` s;
 *   - a normal attack that lands during a rush adds 当前移动速度 × `FirstAttack.atk_scale` and, once that settles, ends it;
 *   - the crash aura: an ally on low ground (`ground`) coming within BOAR_CRASH_RADIUS — flyers there too, the area
 *     selection's rules otherwise — takes 当前移动速度 × `Crash.atk_scale` if the boar walks on its own then
 *     (IfEnemyIsMovingBySelf), and `Crash.stun` s of stun (0 in the data); once per entry.
 * Both extra hits are precomputed melee physical damage (calculation 'precomputed', applyWay MELEE) that gives 受击回复 SP
 * (`_ignoreForSp` false, unlike 穿刺手's). [ASSUMED] neither can be dodged (as 穿刺手's), and the aura's entry bookkeeping.
 */
const BOAR_LISTEN = 0.1, BOAR_BLOCK = 2, BOAR_CRASH_RADIUS = 0.5;

function kitMhboar(ab) {
  const ms = tv(ab, 'Rush.mhboar_t[trigger].move_speed', 0.333);
  const iv = tv(ab, 'Rush.mhboar_t[trigger].interval', 0.333);
  const tries = Math.max(0, Math.min(100, Math.round(tv(ab, 'Rush.mhboar_t[trigger].trig_cnt', 35))));
  const predelay = tv(ab, 'Rush.mhboar_t_predelay.predelay', 3);
  const firstScale = tv(ab, 'FirstAttack.atk_scale', 600);
  const crashScale = tv(ab, 'Crash.atk_scale', 800);
  const crashStun = tv(ab, 'Crash.stun', 0);
  const P = { on: false, tries: 0, n: 0, acc: 0 };
  const held = (e) => e.buffs.some((x) => x.status === 'stun' || x.status === 'freeze' || x.status === 'levitate' || x.status === 'bind');
  const start = () => { P.on = true; P.tries = 0; P.n = 0; P.acc = 0; };
  const stop = (b, e) => { P.on = false; P.n = 0; b.removeBuff(e, 'reg:boarRush'); };
  const hit = (b, e, u, amount, tag, onApplied = null) => b.dealDamage({
    source: e, target: u, amount, type: 'phys', calculation: 'precomputed', applyWay: 'MELEE', attackType: 'NORMAL', canDodge: false,
    isSkill: true, tags: ['enemyAbility', tag], ...(onApplied ? { onApplied } : {}),
  });
  return [blockWeight(BOAR_BLOCK), {
    iv: BOAR_LISTEN,
    spawn(b, e) { if (!e.blockedBy && !held(e)) start(); },
    tick(b, e) {
      if (held(e)) { if (P.on) stop(b, e); return; }
      if (!P.on && !e.blockedBy) start();
    },
  }, {
    tick(b, e, a, dt) {
      if (!P.on || P.tries >= tries || !(iv > 0)) return;
      P.acc += dt;
      let grew = false;
      for (let k = 0; k < 8 && P.acc >= iv - 1e-9 && P.tries < tries; k++) {
        P.acc -= iv;
        P.tries++;
        if (P.tries * iv >= predelay - 1e-9) { P.n++; grew = true; }
      }
      if (grew) b.addBuff(e, { key: 'reg:boarRush', persist: true, mods: { moveMul: 1 + ms * P.n } });
    },
    dealt(c, b, e) {
      const t = c.target;
      if (!P.on || !t || !t.alive || !(t.hp > 0)) return;
      const amount = e.s.moveSpeed * firstScale;
      if (amount > 0) hit(b, e, t, amount, 'boarRush', () => { if (P.on) stop(b, e); });
    },
  }, {
    spawn(b, e, a) { a.inside = new Map(); },
    tick(b, e, a) {
      const now = new Set();
      for (const u of areaAllies(b, e, e.x, e.y, BOAR_CRASH_RADIUS)) {
        if (!u.ground) continue;
        now.add(u);
        if (a.inside.get(u) === u.deploySeq) continue;
        a.inside.set(u, u.deploySeq);
        if (!e.moving) continue;
        const amount = e.s.moveSpeed * crashScale;
        if (amount > 0) hit(b, e, u, amount, 'boarCrash');
        if (crashStun > 0 && u.alive) b.applyStatus(u, 'stun', { duration: crashStun, source: e });
      }
      for (const u of [...a.inside.keys()]) if (!now.has(u)) a.inside.delete(u);
    },
  }];
}

/**
 * 神勇的帕拉杜利斯 冲锋 (`rush`, cooldown 10, initCooldown 5; PRTS: [初始模式] 「仅未被阻挡、且移动方向同一行/列的前方存在非飞行我方单位时
 * 可触发：标记并开始追踪目标所在地块中心；技能结束时进入冲锋模式」; 冲锋模式 「无法攻击/被阻挡；①仅一次，对进入半径0.45的我方单位造成攻击力
 * 200%的无途径物理伤害（每次进入此模式时刷新次数，不可对空），成功造成伤害后停止进行追踪并强制触发技能【正常结束】 ②到达追踪位置后强制
 * 触发技能【正常结束】」, 正常结束 back to the initial mode). The rush ability plays Skill_Begin (MNCTUR_BEGIN, data/assets.json),
 * the cooldown counting from its end; then the Run mode walks it straight at its own speed to the marked tile's centre,
 * unblockable and without attacks, and the first non-flying ally its area selection takes within MNCTUR_COLLIDE ends it
 * with `CollideChar.atk_scale_collide` × ATK (applyWay NONE). The 入戏 branch (`rushEndAdvance`: through our units to a
 * wall, then true damage and a stun on itself) needs the stage's trap_pirene field state, which no 规程 field has: left
 * out. [ASSUMED] it stands through Skill_Begin and a stun / its death then cancels the charge; the target is the nearest
 * such ally its ranged pick takes (canTargetAlly), on a walkable tile with walkable tiles all the way (the charge never
 * leaves the road), no limit on the distance; stunned, bound or 失衡 it holds still in the Run mode; the collision cannot be
 * dodged; no stand for the Skill_End clip.
 */
const MNCTUR_BEGIN = 1, MNCTUR_COLLIDE = 0.45;

function kitMnctur(ab) {
  const sk = ab.sk.rush;
  const endSk = ab.sk.rushEndNormal;
  const scale = tv(ab, 'CollideChar.atk_scale_collide', 2);
  const P = { mode: null, to: null };
  const heading = (e) => {
    const R = e.route;
    if (!R || !R.pts || !(R.ptIdx < R.pts.length)) return null;
    const p = R.pts[R.ptIdx];
    if (Math.abs(p.x - e.x) < 1e-6 && Math.abs(p.y - e.y) < 1e-6) return null;
    return axisTo(e, p);
  };
  const clearLine = (b, e, t, dx) => {
    const fixed = dx ? Math.round(e.y) : Math.round(e.x);
    const from = dx ? Math.round(e.x) : Math.round(e.y);
    const to = dx ? t.tileC : t.tileR;
    const step = to >= from ? 1 : -1;
    for (let i = from, k = 0; k < 40; i += step, k++) {
      if (!(dx ? b.grid.walkable(fixed, i) : b.grid.walkable(i, fixed))) return false;
      if (i === to) return true;
    }
    return false;
  };
  const ahead = (b, e) => {
    const d = heading(e);
    if (!d) return null;
    const [dx, dy] = d;
    return firstOnLine(b, e, dx, dy, Infinity, (u) => !u.isFlying && canTargetAlly(e, u, true)
      && (dx ? (u.x - e.x) * dx : (u.y - e.y) * dy) > 0 && clearLine(b, e, u, dx));
  };
  const finish = (b, e) => {
    if (P.mode !== 'run') return;
    P.mode = null;
    P.to = null;
    b.removeBuff(e, 'reg:mncturRun');
    if (e.route) e.route.pts = null;
    if (endSk) castSlot(b, e, endSk);
  };
  const run = (b, e) => {
    if (P.mode !== 'mark') return;
    if (!e.alive || e.hidden || e.s.flags.stun) { P.mode = null; P.to = null; return; }
    P.mode = 'run';
    b.addBuff(e, { key: 'reg:mncturRun', flags: { unblockable: true, disarm: true, noMove: true } });
    b._unblock(e);
    b.fx('charge', { x: e.x, y: e.y, id: e.id, tx: P.to.x, ty: P.to.y, kind: 'mnctur' });
  };
  return [
    skill(sk, (b, e) => {
      const t = ahead(b, e);
      if (!t) return;
      P.mode = 'mark';
      P.to = { x: t.tileC, y: t.tileR };
      b.addBuff(e, { key: 'reg:mncturMark', duration: MNCTUR_BEGIN, flags: { noMove: true } });
      b.fx('telegraph', { x: P.to.x, y: P.to.y, r: 0.5, dur: MNCTUR_BEGIN, kind: 'mncturMark', id: e.id });
      b.after(MNCTUR_BEGIN, () => run(b, e), { owner: e });
    }, { cond: (b, e) => P.mode == null && !e.blockedBy && !!ahead(b, e), turn: { clip: MNCTUR_BEGIN } }),
    {
      tick(b, e, a, dt) {
        if (P.mode !== 'run') return;
        const still = e.s.flags.stun || e.s.flags.bind || e.s.flags.groundbind || unbalancedNow(b, e);
        let arrived = false;
        if (!still) {
          const px = e.x, py = e.y;
          arrived = stepToward(e, P.to.x, P.to.y, e.s.moveSpeed * MOVE_SCALE * dt);
          if (!b.grid.walkable(Math.round(e.y), Math.round(e.x))) { e.x = px; e.y = py; arrived = true; }
        }
        let hitU = null;
        let hd = Infinity;
        for (const u of areaAllies(b, e, e.x, e.y, MNCTUR_COLLIDE)) {
          if (u.isFlying) continue;
          const d = hypot(u.x - e.x, u.y - e.y);
          if (!hitU || d < hd - 1e-9 || (Math.abs(d - hd) <= 1e-9 && u.id < hitU.id)) { hitU = u; hd = d; }
        }
        if (hitU) {
          b.dealDamage({ source: e, target: hitU, amount: e.s.atk * scale, type: 'phys', applyWay: 'NONE', attackType: 'NORMAL',
            canDodge: false, isSkill: true, tags: ['enemyAbility', 'mncturRush'] });
          b.fx('explode', { x: hitU.x, y: hitU.y, r: 0.5, kind: 'mncturRush' });
          finish(b, e);
          return;
        }
        if (arrived) finish(b, e);
      },
    },
  ];
}

/**
 * 诡核集养者 / 异光体集养者 (PRTS: 「拥有分裂检测器：被施加调整值后，若自身生命值低于50%且未受沉默影响，则强制触发技能【应激分裂】，成功触发技能
 * 后撤去分裂检测器」; 应激分裂 「在自身所在地块中心0.6边长正方形范围内随机位置以自身路径召唤1只与自身当前生命比例相同的、分裂检测器不生效的
 * 诡核集养者」). Templates dsdivi_tr_1[listener] (ON_APPLIED_MODIFIER: below `0.hp_ratio`, not SILENCED, no split mark) and
 * dsdivi_tr_1 / [2] (summon the skill's `enemy_key` on its own route, ±`offset_bound` around its tile's centre, WALK_ONLY,
 * the split mark at once, dsdivi_tr_1[copy_hp] copying the HP ratio; `_delayTime` 0). Each damage instance it survives —
 * a 流失 too — is a modifier; the offset is two draws of the battle rng (x, then y). The child is uncounted, as every
 * runtime summon here. [ASSUMED] a stun does not stop the forced trigger, the parent does not stand for the Skill clip;
 * the talent's `0.interval` / `0.offset_bound` are not used (the summon has no delay; PRTS's 0.6 square is the skill's
 * `offset_bound` 0.3). Round 84 §37.318 had kept it out (the listener's filter reads a literal 0); PRTS's 50 % is the
 * talent's `0.hp_ratio`.
 */
function kitDsdivi(ab) {
  const sk = ab.sk['0'];
  const ratio = tv(ab, '0.hp_ratio', 0.5);
  const bound = bb(sk, 'offset_bound', 0.3);
  const childKey = sv(sk && sk.bs, 'enemy_key');
  return [{
    taken(c, b, e, a) {
      if (a.done || e.mem.dsdiviSplit || !e.alive || e.hidden || !(e.hp > 0)) return;
      if (e.s.flags.silence || !(e.hpRatio < ratio)) return;
      a.done = true;
      const ox = (b.rng() * 2 - 1) * bound;
      const oy = (b.rng() * 2 - 1) * bound;
      const pos = [Math.round(e.y) + oy, Math.round(e.x) + ox];
      if (sk) castSlot(b, e, sk);
      const kids = spawnChildren(b, e, childKey || e.defId, 1, { countInTotal: false, pos, route: remainingRoute(e) });
      for (const k of kids) {
        k.mem.dsdiviSplit = true;
        k.hp = Math.min(k.s.maxHp, k.s.maxHp * e.hpRatio);
      }
    },
  }];
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
  enemy_1361_dthrow: kitDthrow,
  enemy_1361_dthrow_2: same(kitDthrow),
  enemy_1363_spnshd_2: kitSpnshd,
  enemy_1360_dfello: kitDfello,
  enemy_1224_dsuply: kitDsuply,
  enemy_1224_dsuply_2: same(kitDsuply),
  enemy_1403_gunsho: kitGunsho,
  enemy_1403_gunsho_2: same(kitGunsho),
  enemy_1405_boomer_2: kitBoomer,
  enemy_1309_mhboar_2: kitMhboar,
  enemy_10163_mnctur_2: kitMnctur,
  enemy_1436_dsdivi: kitDsdivi,
  enemy_1436_dsdivi_2: same(kitDsdivi),
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
