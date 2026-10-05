// server/sim/ai.js — operator attack loop and enemy AI (route following, blocking, attacks) (DESIGN §5.5).
//
// Operators/tokens: attack cooldown counts down while able to act; when ready and a valid target exists the
// DEFAULT skill trigger is checked ("about to attack"), then the attack is performed with the effective profile
// (profession profile + active skill overrides). Ranged profiles fire projectiles; damage applies on impact.
// Enemies: follow compiled route legs (move / wait / disappear / appear). WALK legs follow the official flow field
// of the leg's target (grid.js, research 08 §3.4): from the tile it stands on the enemy walks straight to the centre
// of `next[tile]`, then on to `next[next[tile]]` … (tile centre to tile centre, so the Bresenham line-of-sight check
// of the smoothing guarantees it never clips a wall or crate corner); the plan is re-read when the grid version
// changes (obstacles) or content displaces the enemy (route.pts = null). FLY legs fly straight between checkpoints; the
// path always follows `motion` — a hovering (近地悬浮) enemy is an air unit for targeting and blocking (Unit.isFlying)
// but walks the ground. An unblocked enemy touching an ally with free block capacity — within its block radius (0.7071
// ground, 0.8944 air, devices 0.4472; Battle._checkBlock) — is blocked, moving or not, so an enemy overlapping an
// operator is taken over once its blocker is gone. Blocked enemies fight their blocker (ranged ones may pick anyone in
// range, blocker first); every blocker whose attack hits enemies — a ranged operator on a melee tile included — may
// always target the enemies it blocks, in range or not, whatever its facing, and targets them first (acquireTargets,
// Battle.blockedTargets; user playtest #6: "阻挡了就一定要能打到"); a heal attack keeps selecting injured allies while
// its unit blocks (PRTS 卫戍协议/帮助 "对于医疗干员（咒愈师分支除外），攻击目标为需要治疗的单位").
// Unblocked ranged enemies attack allies within their radius and stand for each attack's clip — through its wind-up
// and until the clip ends — then walk on (attackStand, GitHub #58; ATTACK_PAUSE after the strike when no clip is known;
// 「不停止移动」 attackers never stop); the candidates pass the enemy's own rule (`e.profile.canTarget`) and are ordered
// blocker → taunt → latest deployed (targeting.js sortAllyTargets). An enemy's damage type is its data's unless content
// arms it (`e.profile.dmgType`: 转译基底's forms, whose data never attacks). Reaching the final leg's end = leak. A `fear` (恐惧) status suspends the route: the
// enemy runs between random checkpoints away from the fear's source (fear.js moveFeared; a self-inflicted fear
// flutters inside its own tile); an `attract` (诱导) status walks it to the status point instead (moveAttracted);
// both re-plan the route when released (恐惧 outranks 诱导).

import { ATTACK_PAUSE, ALLY_COLLIDER_RADIUS, MOVE_SCALE, PROJECTILE_SPEEDS, PROJECTILE_SPEED, BOOMERANG_RETURN_SPEED, COLS, CHAIN_RADIUS } from './constants.js';
import { sortEnemyTargets, sortAllyTargets, canTargetEnemy, canTargetAlly, tileKeyOf } from './targeting.js';
import { reduceElement } from './damage.js';
import { straightClear } from './grid.js';
import { moveFeared, endFear } from './fear.js';

// ---------------------------------------------------------------------------------------------------------------
// profiles

/** Effective attack profile of an ally unit (base profile + active skill overrides). */
export function effectiveProfile(u) {
  const base = u.profile;
  const sk = u.skill;
  const ov = sk ? sk.attackOverride() : null;
  const tg = sk ? sk.targetingOverride() : null;
  if (!ov && !tg) return base;
  const p = Object.assign({}, base);
  p.isSkill = true;
  if (ov) {
    for (const k in ov) {
      if (k === 'onHit') p.skillOnHit = ov.onHit;
      else if (k === 'onEachHit') p.skillOnEachHit = ov.onEachHit;
      else if (k === 'dmgMul' && typeof ov.dmgMul === 'number') p.skillDmgMul = ov.dmgMul;
      else p[k] = ov[k];
    }
    if (ov.dmgType === 'heal' && !p.heal) p.heal = { mode: 'single' };
    if (ov.dmgType && ov.dmgType !== 'heal' && !ov.heal) p.heal = null;
  }
  if (tg) {
    if (tg.maxTargets != null) p.maxTargets = tg.maxTargets;
    if (tg.priority) p.priority = tg.priority;
    if (tg.allInRange != null) p.allInRange = tg.allInRange;
    if (tg.canHitFly != null) p.canHitFly = tg.canHitFly;
  }
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// ally attack loop

export function updateAlly(b, u, dt) {
  if (u.atkCd > 0 && u.canAct) u.atkCd = Math.max(0, u.atkCd - dt);
  if (u.blocking.length) enforceBlockCapacity(b, u);
  if (!u.canAct || !u.profile) return;
  // a rangeExtend change (buff added / expired) rebuilds the range — also for units that never attack (auras)
  if (b.rangeChanged(u)) b._refreshRange(u);
  const sk = u.skill;
  let prof = effectiveProfile(u);
  if (prof.noAttack) return;
  if (prof.noAttackUnlessSkill && !(sk && sk.active)) return;
  if (u.s.flags.disarm) return;
  if (u.atkCd > 0) return;
  if (prof.canAttack && !prof.canAttack(b, u)) return;
  let targets = acquireTargets(b, u, prof);
  if (!targets.length) { u.trait.hadTarget = false; return; }
  u.trait.hadTarget = true;
  if (sk && sk.onAboutToAttack()) {
    prof = effectiveProfile(u);
    if (prof.noAttack || !u.alive) return;
    targets = acquireTargets(b, u, prof);
    if (!targets.length) return;
  }
  performAttack(b, u, prof, targets);
  u.atkCd = Math.max(u.atkCd, u.s.interval);
}

/** Release blocked enemies beyond the current block capacity (latest blocked first). */
export function enforceBlockCapacity(b, u) {
  const cap = u.alive && u.deployed ? u.s.blockCnt : 0;
  let used = 0;
  for (const e of u.blocking) used += e.blockWeight ?? 1;
  while (used > cap && u.blocking.length) {
    const e = u.blocking.pop();
    if (e.blockedBy === u) { e.blockedBy = null; b._stealthSwitch(e); }   // a released 隐匿 enemy hides again later
    used -= e.blockWeight ?? 1;
  }
}

/** Collect targets for an ally with profile `prof`. */
export function acquireTargets(b, u, prof) {
  // a heal attack (医师 / 群愈师 / 疗养师 / 链愈师 / 行医, a skill attack turned into a heal) selects injured allies only,
  // never the enemies its unit blocks — a blocking healer keeps healing: PRTS 卫戍协议/帮助 "对于医疗干员（咒愈师分支除外），
  // 攻击目标为需要治疗的单位" (the blocked-first rule below is for attackers of enemies; community feedback after 0.1.0, E2)
  if (prof.heal && prof.dmgType === 'heal') {
    let cands = b.injuredAlliesInKeys(u.rangeKeys, u, !!prof.heal.elementHealRatio);
    // a heal restricted to allies at or below an HP ratio (塞雷娅 S1 急救 "血量小于等于一半")
    if (prof.heal.hpAtMost > 0) cands = cands.filter((a) => a.hpRatio <= prof.heal.hpAtMost + 1e-9);
    if (!cands.length) return cands;
    let n = prof.heal.mode === 'multi' ? Math.max(1, prof.heal.count || 3) : 1;
    if (prof.maxTargets > n) n = Math.floor(prof.maxTargets);   // skill targeting override (e.g. heal 2 targets)
    return cands.slice(0, n + Math.max(0, Math.floor(u.s.maxTargets)));
  }
  // fortress: melee while blocking, ranged splash otherwise
  if (prof.fortress) {
    if (u.blocking.length) {
      const t = u.blocking.filter((e) => canTargetEnemy(u, e, { canHitFly: false }));
      prof._fortressMelee = true;
      return t.slice(0, 1);
    }
    prof._fortressMelee = false;
  }
  if (prof.hitAllBlocked && u.blocking.length) {
    const t = u.blocking.filter((e) => canTargetEnemy(u, e, prof));
    if (t.length) return t;
  }
  const cands = b.enemiesInKeys(u.rangeKeys, u, prof);
  // "可以选择且优先选择阻挡单位" (PRTS 选择器): the enemies a unit blocks are always selectable by it — the block radius
  // (0.7071) reaches past its own tile, so a blocked enemy may stand outside a short range or behind its facing (user
  // playtest #5 item 4); a ranged operator on a melee tile too (user playtest #6: "阻挡了就一定要能打到")
  if (u.blocking.length) for (const e of b.blockedTargets(u, prof)) if (!cands.includes(e)) cands.push(e);
  if (!cands.length) return cands;
  if (prof.allInRange) return cands;
  const n = Math.max(1, Math.floor((prof.maxTargets || 1) + u.s.maxTargets));
  sortEnemyTargets(b, u, cands, prof.priority);
  return n >= cands.length ? cands : cands.slice(0, n);
}

/** Perform an attack/heal with profile `prof` against `targets`. opts: { noAmmo } (Battle.forceAttack). */
export function performAttack(b, u, prof, targets, opts = null) {
  const isSkill = !!prof.isSkill;
  if (b._hooks.beforeAttack) {
    const ctx = { attacker: u, targets, isSkill, profile: prof };
    b.emit('beforeAttack', ctx);
    targets = (ctx.targets || []).filter((t) => t && t.alive);
    if (!targets.length || !u.alive) return;
  }
  u.lastAttackAt = b.time;
  u.stats.attacks++;
  const attackId = ++b._attackSeq; // every damage instance of this attack (all targets, splash, chain) carries it
  const isHeal = !!(prof.heal && prof.dmgType === 'heal');
  // 首次接敌 (official voice type ENCOUNTER_ENEMY, ≥ 3 s between two such lines): one event the first time a unit
  // attacks an enemy, whatever the attack is — the client answers with that operator's 行动开始 line (audio.js voice).
  if (!isHeal && u.side === 'ally' && !u.mem.engaged && targets.some((t) => t && t.side === 'enemy')) {
    u.mem.engaged = true;
    b._ev(['engage', u.id]);
  }
  const ranged = !prof._fortressMelee && prof.attack === 'ranged' && prof.projectile && prof.projectile !== 'none' && prof.projectile !== 'beam';
  const vis = prof._fortressMelee ? 'none' : (prof.projectile || 'none');
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    b._ev(['atk', u.id, t.id, vis]);
    if (isHeal) { doHeal(b, u, prof, t); continue; }
    const info = { isSkill, index: i, attackId };
    if (ranged && t.side === 'enemy' && prof.projectile === 'boomerang') {
      throwBoomerang(b, u, prof, t, info);
    } else if (ranged && t.side === 'enemy') {
      const speed = PROJECTILE_SPEEDS[prof.projectile] ?? PROJECTILE_SPEED;
      // projectiles land even if the shooter died meanwhile (damage is credited to it)
      b.addProjectile({ from: u, target: t, speed, visual: prof.projectile, source: u, hitDead: prof.splashRadius > 0,
        onHit: (c) => resolveHit(b, u, prof, c.target, info, c.x, c.y) });
    } else {
      resolveHit(b, u, prof, t, info, t.x, t.y);
    }
  }
  if (b._hooks.attack) b.emit('attack', { attacker: u, targets, isSkill });
  if (u.skill) u.skill.onAttackPerformed(targets, isSkill, !!(opts && opts.noAmmo));
  if (prof.afterAttack) b._safe(() => prof.afterAttack(b, u, targets), 'profile.afterAttack', u);
}

/**
 * 回环射手 boomerang (projectile 'boomerang', professions.js loopshooter): it flies out to the target at
 * PROJECTILE_SPEEDS.boomerang and the attack hits on arrival; a target that died / vanished meanwhile is not hit (the
 * boomerang still flies to its last position — a splash profile would burst there), then it flies back to the thrower's
 * current position at BOOMERANG_RETURN_SPEED, dealing nothing on the way back, and is caught (u.trait.boomerangsOut −1:
 * the thrower attacks again once every boomerang is back). A thrower knocked out / withdrawn meanwhile loses it — nothing
 * returns to a unit off the field or to a later deployment of it (the deploy hook hands it a fresh one).
 */
function throwBoomerang(b, u, prof, t, info) {
  const seq = u.deploySeq;
  u.trait.boomerangsOut = (u.trait.boomerangsOut || 0) + 1;
  const home = () => u.alive && u.deployed && u.deploySeq === seq;
  b.addProjectile({ from: u, target: t, speed: PROJECTILE_SPEEDS.boomerang, visual: 'boomerang', source: u, hitDead: true,
    onHit: (c) => {
      // (guarded on its own: a content error in the hit must not cost the thrower its boomerang for the battle)
      if (c.target || prof.splashRadius > 0) b._safe(() => resolveHit(b, u, prof, c.target, info, c.x, c.y), 'boomerang.hit', u);
      if (!home()) return;
      // hitDead: flies on to the thrower's last position even while it is hidden, caught there when it is still home
      b.addProjectile({ from: { x: c.x, y: c.y }, target: u, speed: BOOMERANG_RETURN_SPEED, visual: 'boomerangReturn', source: u, hitDead: true,
        onHit: () => { if (home() && u.trait.boomerangsOut > 0) u.trait.boomerangsOut--; } });
    } });
}

/** Apply one attack hit (called on impact for projectiles). `target` may be null (splash on a dead target's spot). */
export function resolveHit(b, u, prof, target, info, x, y) {
  const atk = u.s.atk;
  const scale = (prof.atkScale ?? 1) * u.s.atkScaleMul;
  let dealtTotal = 0;
  const baseType = prof.dmgType === 'heal' || prof.dmgType === 'none' ? 'phys' : prof.dmgType;
  const skillMul = prof.skillDmgMul ?? 1;
  const attackId = info.attackId ?? 0;
  // per-victim callbacks (main target, every splash / chain victim): profile `onEachHit(b, u, victim, hctx)` and
  // SkillSpec `attack.onEachHit(ctx)` — `attack.onHit` stays once per attack with the main target
  const each = prof.onEachHit || prof.skillOnEachHit ? (victim, dealt, kind) => {
    const hc = { dealt, kind, isSplash: kind === 'splash', isChain: kind === 'chain', main: target, attackId, isSkill: info.isSkill };
    if (prof.onEachHit) b._safe(() => prof.onEachHit(b, u, victim, hc), 'profile.onEachHit', u);
    if (prof.skillOnEachHit && u.skill) {
      const fn = prof.skillOnEachHit;
      b._safe(() => fn({ battle: b, unit: u, skill: u.skill, bb: u.skill.bb, target: victim, ...hc }), 'skill.attack.onEachHit', u);
    }
  } : null;
  if (target && target.alive) {
    let mulT = skillMul;
    if (prof.dmgMul) { const m = typeof prof.dmgMul === 'function' ? prof.dmgMul(b, u, target) : prof.dmgMul; if (Number.isFinite(m)) mulT *= m; }
    const hits = prof.hitsFn ? prof.hitsFn(b, u) : Math.max(1, prof.hits || 1);
    let dealtMain = 0;
    for (let h = 0; h < hits && target.alive; h++) {
      dealtMain += b.dealDamage(u, target, { amount: atk * scale * mulT, type: baseType, isAttack: true, isSkill: info.isSkill, tags: prof.tags || [], attackId });
    }
    dealtTotal += dealtMain;
    if (prof.onHitStatus && target.alive) b.applyStatus(target, prof.onHitStatus.key, { duration: prof.onHitStatus.duration, source: u, value: prof.onHitStatus.value });
    if (each) each(target, dealtMain, 'main');
    x = target.x; y = target.y;
  }
  // splash: a 中点判定 radius around the target's position — a huge enemy counts by its 判定中心 (Battle.enemiesInRadius)
  if (prof.splashRadius > 0) {
    const r = prof.splashRadius;
    const sc = prof.splashScale ?? 1;
    for (const e of b.foesInRadius(x, y, r, true)) {
      if (e === target) continue;
      if (prof.groundOnly && e.isFlying) continue;
      if (!prof.canHitFly && e.isFlying && !prof.splashHitsFly) continue;
      if (e.s.flags.untargetable) continue;
      const d = b.dealDamage(u, e, { amount: atk * scale * sc * skillMul, type: baseType, isAttack: true, isSplash: true, isSkill: info.isSkill, attackId });
      dealtTotal += d;
      if (each) each(e, d, 'splash');
    }
  }
  // chain
  if (prof.chain && target) {
    const hit = new Set([target.id]);
    let prev = target;
    const n = Math.max(1, prof.chain.count || 3);
    for (let k = 1; k < n; k++) {
      let best = null, bd = Infinity;
      for (const e of b.enemiesInRadius(prev.x, prev.y, prof.chain.radius || CHAIN_RADIUS)) {
        if (hit.has(e.id) || !canTargetEnemy(u, e, prof)) continue;
        const d = Math.hypot(e.x - prev.x, e.y - prev.y);
        if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && best && e.spawnSeq < best.spawnSeq)) { bd = d; best = e; }
      }
      if (!best) break;
      hit.add(best.id);
      b._ev(['atk', prev.id, best.id, 'chain']);
      const d = b.dealDamage(u, best, { amount: atk * scale * skillMul * Math.pow(1 - (prof.chain.falloff ?? 0.15), k), type: baseType, isAttack: true, isSkill: info.isSkill, tags: ['chain'], attackId });
      dealtTotal += d;
      if (prof.chain.sluggish && best.alive) b.applyStatus(best, 'sluggish', { duration: prof.chain.sluggish, source: u });
      if (each) each(best, d, 'chain');
      prev = best;
    }
    if (prof.chain.sluggish && target.alive) b.applyStatus(target, 'sluggish', { duration: prof.chain.sluggish, source: u });
  }
  const hctx = { dealt: dealtTotal, x, y, isSkill: info.isSkill };
  if (prof.afterHit) b._safe(() => prof.afterHit(b, u, target, hctx), 'profile.afterHit', u);
  if (prof.skillOnHit && u.skill) {
    const fn = prof.skillOnHit;
    b._safe(() => fn({ battle: b, unit: u, skill: u.skill, bb: u.skill.bb, target, dealt: dealtTotal, x, y }), 'skill.attack.onHit', u);
  }
  if (u.skill && u.skill.active && u.skill.spec.onHit) {
    const fn = u.skill.spec.onHit;
    b._safe(() => fn({ battle: b, unit: u, skill: u.skill, bb: u.skill.bb, target, dealt: dealtTotal, x, y }), 'skill.onHit', u);
  }
}

function doHeal(b, u, prof, t) {
  const atk = u.s.atk;
  const scale = (prof.atkScale ?? 1) * (prof.healScale ?? 1) * u.s.atkScaleMul;
  const h = prof.heal || { mode: 'single' };
  let amount = atk * scale;
  if (h.farMul && Math.max(Math.abs(t.tileR - u.tileR), Math.abs(t.tileC - u.tileC)) > (h.nearDist ?? 2)) amount *= h.farMul;
  if (h.elementHealRatio) reduceElement(t, atk * h.elementHealRatio);
  b.heal(u, t, amount);
  if (h.mode === 'chain') {
    const seen = new Set([t.id]);
    let prev = t;
    const n = Math.max(1, h.count || 3);
    for (let k = 1; k < n; k++) {
      let best = null, bd = Infinity;
      for (const a of b.alliesInRadius(prev.x, prev.y, 2.5, null)) {
        // 禁疗 / noHeal units are no heal target for the bounces either (as injuredAlliesInKeys; 史尔特尔's 余烬, GitHub #52)
        if (seen.has(a.id) || a.hp >= a.s.maxHp || a.kind === 'device' || a.s.flags.noHeal || (a.profile && a.profile.noHeal)) continue;
        const d = a.hpRatio;
        if (d < bd) { bd = d; best = a; }
      }
      if (!best) break;
      seen.add(best.id);
      b._ev(['atk', prev.id, best.id, 'chainHeal']);
      b.heal(u, best, amount * Math.pow(1 - (h.falloff ?? 0.25), k));
      prev = best;
    }
  }
  if (u.skill && u.skill.active && u.skill.spec.onHit) {
    const fn = u.skill.spec.onHit;
    b._safe(() => fn({ battle: b, unit: u, skill: u.skill, bb: u.skill.bb, target: t, heal: amount, x: t.x, y: t.y }), 'skill.onHit', u);
  }
}

// ---------------------------------------------------------------------------------------------------------------
// enemy routes

/**
 * Compile a RouteSpec into legs. With `rect`, positional legs are clamped onto the field: a checkpoint outside the
 * rect (e.g. h07_01's extra fly route along row 6) could never be reached because positions are clamped to the rect
 * every tick — the enemy would hover at the border forever instead of finishing its route.
 */
export function compileRoute(route, rect = null) {
  const legs = [];
  const cr = (r) => (rect ? Math.max(rect.r0, Math.min(rect.r1, r)) : r);
  const cc = (c) => (rect ? Math.max(rect.c0, Math.min(rect.c1, c)) : c);
  for (const cp of route.checkpoints || []) {
    if (cp.type === 'MOVE') legs.push({ t: 'move', r: cr(cp.pos[0]), c: cc(cp.pos[1]) });
    else if (cp.type === 'WAIT') legs.push({ t: 'wait', time: Number.isFinite(cp.time) ? Math.max(0, cp.time) : 0 });
    else if (cp.type === 'DISAPPEAR') legs.push({ t: 'disappear' });
    else if (cp.type === 'APPEAR') legs.push({ t: 'appear', r: cr(cp.pos[0]), c: cc(cp.pos[1]) });
  }
  if (route.end) legs.push({ t: 'move', r: cr(route.end[0]), c: cc(route.end[1]), final: true });
  return legs;
}

/**
 * Flow field of a WALK leg target usable from tile key `k`: the live field, else the obstacle-free one (the goal is
 * walled off by hard blocks), else null.
 */
function legField(b, r, c, k) {
  const g = b.grid;
  const f = g.flowField(r, c);
  if (k >= 0 && f.dist[k] >= 0) return f;
  const f2 = g.flowField(r, c, { ignoreObstacles: true });
  if (k >= 0 && f2.dist[k] >= 0) return f2;
  return null;
}

const tileKey = (b, e) => {
  const r = Math.round(e.y), c = Math.round(e.x);
  return b.grid.inBounds(r, c) ? r * COLS + c : -1;
};

/**
 * Build the waypoint list (world points) for the current move leg. Ground legs: the smoothed flow-field chain from
 * the enemy's tile (next[tile], next[next[tile]], …, the target) — straight to the target when no field reaches it.
 */
function planLeg(b, e, leg) {
  const R = e.route;
  let pts;
  if (e.motion === 'FLY') {
    pts = [{ x: leg.c, y: leg.r }];
  } else {
    const k = tileKey(b, e);
    const f = legField(b, leg.r, leg.c, k);
    pts = [];
    if (f) {
      let x = k;
      let guard = COLS * 32;
      while (x !== f.dest && guard-- > 0) {
        x = f.next[x];
        if (x < 0) break;
        pts.push({ x: x % COLS, y: (x / COLS) | 0 });
      }
    }
    const last = pts[pts.length - 1];
    if (!last || last.x !== leg.c || last.y !== leg.r) pts.push({ x: leg.c, y: leg.r });
    // The smoothed chain is line-of-sight clear from the tile CENTRE only. An enemy re-planning off-centre (pushed,
    // released by 诱导, an obstacle change mid-segment) first steps back to its tile centre when the straight line to
    // the first waypoint would cut a tile it cannot walk (a fence corner, a crate) — else it would walk inside it.
    if (f && (e.x !== k % COLS || e.y !== ((k / COLS) | 0)) && !straightClear(b.grid, e.x, e.y, pts[0])) {
      pts.unshift({ x: k % COLS, y: (k / COLS) | 0 });
    }
  }
  R.pts = pts;
  R.ptIdx = 0;
  R.version = b.grid.version;
  // suffix lengths for remaining-distance queries
  const suf = new Float64Array(pts.length);
  for (let i = pts.length - 2; i >= 0; i--) suf[i] = suf[i + 1] + Math.hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
  R.suffix = suf;
}

/** Estimated length of legs after index `idx` (cached per grid version). */
function tailLength(b, e, idx) {
  const R = e.route;
  if (R.tailVersion !== b.grid.version || !R.tail) {
    R.tail = new Float64Array(R.legs.length + 1);
    // walk legs backwards: need the start point of each move leg = target of the previous positional leg
    const starts = [];
    let pr = Math.round(e.spawnY ?? e.y), pc = Math.round(e.spawnX ?? e.x);
    for (let i = 0; i < R.legs.length; i++) {
      starts.push([pr, pc]);
      const L = R.legs[i];
      if (L.t === 'move' || L.t === 'appear') { pr = L.r; pc = L.c; }
    }
    for (let i = R.legs.length - 1; i >= 0; i--) {
      const L = R.legs[i];
      let len = 0;
      if (L.t === 'move') {
        const [sr, sc] = starts[i];
        len = Math.hypot(L.r - sr, L.c - sc);
        if (e.motion !== 'FLY' && b.grid.inBounds(sr, sc)) {
          const f = legField(b, L.r, L.c, sr * COLS + sc);
          const fl = f ? b.grid.fieldLength(f, sr * COLS + sc) : Infinity;
          if (Number.isFinite(fl)) len = fl;
        }
      }
      R.tail[i] = R.tail[i + 1] + len;
    }
    R.tailVersion = b.grid.version;
  }
  return R.tail[idx] ?? 0;
}

/** Remaining path distance of an enemy to its goal (tiles). */
export function remainingDistance(b, e) {
  const R = e.route;
  if (!R) return 0;
  let d = tailLength(b, e, R.legIdx + 1);
  const leg = R.legs[R.legIdx];
  if (leg && leg.t === 'move' && R.pts && R.ptIdx < R.pts.length) {
    const p = R.pts[R.ptIdx];
    d += Math.hypot(p.x - e.x, p.y - e.y) + R.suffix[R.ptIdx];
  } else if (leg && leg.t === 'move') {
    d += Math.hypot(leg.c - e.x, leg.r - e.y);
  }
  return d;
}

// ---------------------------------------------------------------------------------------------------------------
// enemy update

export function updateEnemy(b, e, dt) {
  const R = e.route;
  if (!e.alive) return;
  // hidden (teleporting) enemies only advance wait legs
  const stunned = e.s.flags.stun;
  if (e.atkCd > 0 && !stunned && !e.hidden) e.atkCd = Math.max(0, e.atkCd - dt);
  // true: an unblocked ranged enemy in the wind-up of its next attack with a target in range (it stands)
  const winding = !e.hidden && !stunned && enemyAttack(b, e);
  if (!e.alive) return;
  // a stun / freeze / sleep cuts the attack clip short: no stand left once it ends [ASSUMED]
  if (stunned && !e.hidden) { e.atkStandUntil = -Infinity; return; }
  if (e.blockedBy) {
    const bl = e.blockedBy;
    // (unblockable/levitate/fear may also arrive through a plain addBuff, which does not unblock by itself; a
    // stunned/sleeping blocker — noBlock — lets go)
    const ef = e.s.flags;
    if (!bl.alive || !bl.deployed || bl.hidden || bl.s.flags.noBlock || bl.s.flags.sleep || ef.unblockable || ef.levitate || ef.fear) b._unblock(e);
    else return;
  }
  if (!e.hidden && b._checkBlock(e)) return;
  if (b.time < e.pauseUntil) return;
  // standing for an attack clip (attackStand, GitHub #58): only the walking waits — a checkpoint's WAIT keeps running
  // and DISAPPEAR / APPEAR legs still happen (advanceRoute); drawn idle (the client plays the clip, then Move again);
  // a 恐惧 runs at once (it cannot attack)
  const standing = winding || (b.time < e.atkStandUntil && !e.s.flags.fear);
  if (e.s.flags.noMove) { e.moving = false; return; }   // standing (a 重生, a form change): drawn idle, not walking
  // 恐惧 (ba.fear "无法被阻挡并四散逃跑"; PRTS 诱发移动: 恐惧 outranks 诱导): runs to random tiles of the fan away from
  // its source — a self-inflicted fear flutters inside its own tile (fear.js); the route re-plans once it ends
  if (e.s.flags.fear && !e.hidden) { moveFeared(b, e, dt); return; }
  if (e.mem.fearMove) endFear(e);
  // 诱导 (ba.attract "无法被阻挡并向目标位置移动"): walks to the attract point instead of following its route
  if (e.s.flags.attract) { if (standing) e.moving = false; else moveAttracted(b, e, dt); return; }
  advanceRoute(b, e, dt, R, standing);
}

/**
 * 诱导: walk the enemy (own speed; ground: grid path, flyers: straight) to the point of its `attract` status
 * (Battle._setAttractPoint) and keep it there. The path re-plans from where the enemy stands when an obstacle changed
 * or something else moved it since its last step (a push / pull, or a 恐惧 that outranked the 诱导 for a while) —
 * a stale path would walk through walls. Its route re-plans from wherever it stands once the status ends (route.pts
 * is reset whenever it moved).
 */
function moveAttracted(b, e, dt) {
  let A = null;
  for (const x of e.buffs) if (x.status === 'attract' && x.data && x.data.attract) { A = x.data.attract; break; }
  if (!A) { e.moving = false; return; }
  if (!A.pts || A.ver !== b.grid.version || e.x !== A.px || e.y !== A.py) {
    const sr = Math.round(e.y), sc = Math.round(e.x);
    let pts = null;
    if (e.motion !== 'FLY') { // (a hovering 近地悬浮 enemy is an air unit but walks the ground: motion decides the path)
      const path = b.grid.waypoints(sr, sc, A.r, A.c) || b.grid.waypoints(sr, sc, A.r, A.c, { ignoreObstacles: true });
      if (path) {
        pts = [];
        for (let i = 0; i < path.length; i++) {
          const [r, c] = path[i];
          if (i === 0 && Math.abs(e.x - c) < 1e-6 && Math.abs(e.y - r) < 1e-6) continue;
          pts.push({ x: c, y: r });
        }
      }
    }
    A.pts = pts || [{ x: A.c, y: A.r }];
    A.i = 0;
    A.ver = b.grid.version;
  }
  let dist = e.s.moveSpeed * MOVE_SCALE * dt;
  let moved = false;
  while (dist > 1e-9 && A.i < A.pts.length) {
    const p = A.pts[A.i];
    const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
    if (d <= dist) { e.x = p.x; e.y = p.y; dist -= d; A.i++; } else { e.x += (dx / d) * dist; e.y += (dy / d) * dist; dist = 0; }
    moved = true;
  }
  A.px = e.x; A.py = e.y;
  e.moving = moved;
  if (moved && e.route) e.route.pts = null;
}

/**
 * One tick along the route legs. `standing` (an attack clip, attackStand): the time-based legs go on — a WAIT runs
 * down, DISAPPEAR / APPEAR happen (leaving the field ends the clip) — and a MOVE leg holds (GitHub #58 review).
 */
function advanceRoute(b, e, dt, R, standing = false) {
  let budget = dt;
  let guard = 16;
  while (budget > 1e-9 && guard-- > 0 && e.alive) {
    const leg = R.legs[R.legIdx];
    if (!leg) { b.leak(e); return; }
    if (leg.t === 'wait') {
      if (R.waitLeft == null) R.waitLeft = leg.time;
      const use = Math.min(budget, R.waitLeft);
      R.waitLeft -= use;
      budget -= use;
      e.moving = false;
      if (R.waitLeft <= 1e-9) { R.waitLeft = null; R.legIdx++; R.pts = null; }
      continue;
    }
    if (leg.t === 'disappear') {
      b._setHidden(e, true);
      e.atkStandUntil = -Infinity; standing = false;   // off the field: its attack clip is over
      R.legIdx++; R.pts = null;
      continue;
    }
    if (leg.t === 'appear') {
      e.x = leg.c; e.y = leg.r;
      b._setHidden(e, false);
      R.legIdx++; R.pts = null;
      continue;
    }
    // move
    if (standing) { e.moving = false; return; }   // the walking waits for the attack clip
    if (!R.pts || R.version !== b.grid.version) planLeg(b, e, leg);
    const speed = e.s.moveSpeed * MOVE_SCALE;
    if (speed <= 0) { e.moving = false; return; }
    let dist = speed * budget;
    e.moving = true;
    let steps = 64;
    while (dist > 1e-9 && steps-- > 0) {
      if (!R.pts || R.version !== b.grid.version) planLeg(b, e, leg);
      if (R.ptIdx >= R.pts.length) break;
      const p = R.pts[R.ptIdx];
      const dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy);
      if (d <= dist) {
        e.x = p.x; e.y = p.y;
        dist -= d;
        R.ptIdx++;
      } else {
        e.x += (dx / d) * dist;
        e.y += (dy / d) * dist;
        dist = 0;
      }
      if (b._checkBlock(e)) return;
    }
    budget = dist / speed;
    if (R.pts && R.ptIdx >= R.pts.length) {
      if (leg.final) { b.leak(e); return; }
      R.legIdx++;
      R.pts = null;
    }
  }
}

/**
 * How long an unblocked ranged enemy stands for one attack (GitHub #58 — the owner's decision of 2026-10-04 from
 * first-hand memory of the official game: a ranged enemy stops for each attack's animation and walks on between
 * attacks; the handbook names attacking on the move as a special ability, “十字路口”量产型's 「不停止移动的四向攻击」).
 * [ASSUMED] the stand lasts exactly its attack clip — data/enemies.json `attackAnim` { dur, hit }: the clip the client
 * plays for its attacks and its strike frame (tools/build-data.mjs, from the asset manifest) —, `hit` of it before
 * the strike (the wind-up, while a target is in range) and the rest after it, both shortened when the attacks come
 * quicker than the clip (it then plays faster: render/spine.js, the same rule) — no source gives a length. An enemy in
 * another form (掠海漂移体's crawl, 转译基底's forms, 杰斯顿's second form) stands for its base clip [ASSUMED]; known
 * mismatches: 扎罗's second form stands 1.433 s (A_Attack) though its B_Attack lasts 2.0 s (2.5 s interval: ~0.4 s of
 * walking during the recovery), 转译基底's 特战术师 stands 2.0 s (B_Attack) though its D_Attack lasts 1.667 s — a per-form
 * clip needs the client's FORMS mapping (render/units.js) in shared data.
 * Returns the wind-up and rest (s) into `out`: an enemy with no attack clip known stands ATTACK_PAUSE after the strike
 * (the old rule), a 「不停止移动」 one (`attackMoves`: data or content) never stops.
 */
export function attackStand(e, out = { wind: 0, rest: 0 }) {
  out.wind = 0; out.rest = 0;
  if (e.profile?.attackMoves ?? e.def?.attackMoves) return out;
  const a = e.def?.attackAnim;
  if (!a || !(a.dur > 0)) { out.rest = ATTACK_PAUSE; return out; }
  const iv = e.s.interval;
  const speed = iv > 0 && iv < a.dur ? a.dur / iv : 1;
  const hit = Number.isFinite(a.hit) ? Math.min(a.dur, Math.max(0, a.hit)) : a.dur / 2;
  out.wind = hit / speed;
  out.rest = (a.dur - hit) / speed;
  return out;
}
const STAND = { wind: 0, rest: 0 };

/**
 * One tick of an enemy's attack: attacks when its cooldown is over and a target is in reach. Returns true while an
 * unblocked ranged enemy is in the wind-up of its next attack (cooldown ≤ its clip's wind-up, attackStand) with a
 * target in range: it stands (updateEnemy).
 */
function enemyAttack(b, e) {
  const def = e.def;
  if (e.profile && e.profile.noAttack) return false;
  const dmgType = (e.profile && e.profile.dmgType) || def.dmgType;
  if (dmgType === 'none' || e.s.atk <= 0) return false;
  if (e.s.flags.fear || e.s.flags.disarm) return false;
  if (e.s.flags.tremble && e.blockedBy) return false; // 战栗: 被阻挡后无法进行普通攻击
  if (dmgType === 'heal') { if (e.atkCd <= 0) enemyHeal(b, e, e.base.rangeRadius); return false; }
  // applyWay MELEE enemies only ever hit their blocker, even when their data carries a rangeRadius (粉碎攻坚手 2.5,
  // 宿主士兵 2.5, 深池伙友卫队 1.4 … — that radius belongs to their abilities/splash, handled by content).
  // Content may flip it with `e.profile.melee = false`.
  const melee = e.profile?.melee ?? def.applyWay === 'MELEE';
  const radius = melee ? 0 : e.base.rangeRadius;
  // the range circle takes an ally whose 0.25 collider touches it (PRTS 作战机制 §碰撞体积: 索敌 uses the colliders)
  const reach = radius > 0 ? radius + ALLY_COLLIDER_RADIUS : 0;
  // `e.profile.canTarget(ally)`: the enemy's own target rule (只攻击地面单位, 不会攻击飞行单位 …; content/enemies.js),
  // applied to the candidates before the priority sort and the target count
  const own = e.profile && typeof e.profile.canTarget === 'function' ? e.profile.canTarget : null;
  if (e.atkCd > 0) {
    // the wind-up of the next attack (GitHub #58): an unblocked ranged enemy stands once a target is in range
    if (e.blockedBy || radius <= 0 || !(e.atkCd <= attackStand(e, STAND).wind + 1e-9)) return false;
    return b.alliesInRadius(e.x, e.y, reach, null).some((a) => canTargetAlly(e, a, true) && (!own || own(a)));
  }
  let targets = [];
  if (e.blockedBy) {
    const bl = e.blockedBy;
    if (radius > 0) {
      targets = b.alliesInRadius(e.x, e.y, reach, null).filter((a) => a === bl || canTargetAlly(e, a, true));
      if (!targets.includes(bl) && bl.alive) targets.push(bl);
    } else if (bl.alive && bl.deployed) targets = [bl];
  } else if (radius > 0) {
    targets = b.alliesInRadius(e.x, e.y, reach, null).filter((a) => canTargetAlly(e, a, true));
  }
  if (own && targets.length) targets = targets.filter((a) => own(a));
  if (targets.length > 1) sortAllyTargets(e, targets);
  if (!targets.length) return false;
  // 麻痹 (ba.palsy): each stack interrupts one normal attack
  const palsy = e.buffs.length ? e.findBuff('palsy') : null;
  if (palsy) {
    if (--palsy.stacks <= 0) b.removeBuff(e, palsy); else e.markDirty();
    e.atkCd = e.s.interval;
    // the interrupted attack ends its clip: the old short stand after it (PRTS 异常效果 麻痹: 0.5 s 麻痹震颤 — not modelled)
    if (!e.blockedBy && radius > 0 && !(e.profile?.attackMoves ?? def.attackMoves)) e.atkStandUntil = b.time + ATTACK_PAUSE;
    b.fx('palsy', { x: e.x, y: e.y, id: e.id });
    return false;
  }
  const n = Math.max(1, Math.floor(e.profile?.maxTargets ?? 1) + Math.floor(e.s.maxTargets));
  if (targets.length > n) targets = targets.slice(0, n);
  if (b._hooks.beforeAttack) {
    const ctx = { attacker: e, targets, isSkill: false, profile: e.profile };
    b.emit('beforeAttack', ctx);
    targets = (ctx.targets || []).filter((t) => t && t.alive);
    if (!targets.length || !e.alive) return false;
  }
  e.lastAttackAt = b.time;
  e.stats.attacks++;
  const attackId = ++b._attackSeq;
  const type = dmgType === 'heal' ? 'arts' : dmgType;
  const rangedShot = radius > 0 && !(e.blockedBy && targets[0] === e.blockedBy && radius < 1);
  // content-resolved attacks (`e.profile.deferHit`: 帝国炮火先兆者's shell landing 3 s later): the attack itself happens
  // — the 'atk' event (kind `e.profile.shot`, drawn by the content's own fx), cooldown, pause, the 'attack' hook — and
  // the content's 'attack' handler deals its damage
  const deferred = !!(e.profile && e.profile.deferHit);
  for (const t of targets) {
    b._ev(['atk', e.id, t.id, deferred ? (e.profile.shot || 'none') : rangedShot ? 'enemy' : 'none']);
    if (deferred) continue;
    const hit = (tt) => {
      if (!tt || !tt.alive || !e.alive && !rangedShot) return;
      b.dealDamage(e, tt, { amount: e.s.atk * (e.profile?.atkScale ?? 1), type, isAttack: true, attackId });
    };
    if (rangedShot && Math.hypot(t.x - e.x, t.y - e.y) > 0.75) {
      b.addProjectile({ from: e, target: t, speed: PROJECTILE_SPEEDS.enemy, visual: 'enemy', source: e, onHit: (c) => hit(c.target) });
    } else hit(t);
  }
  if (b._hooks.attack) b.emit('attack', { attacker: e, targets, isSkill: false });
  e.atkCd = e.s.interval;
  // stands for the rest of its attack clip (attackStand; the wind-up was stood before the strike)
  if (!e.blockedBy && radius > 0) e.atkStandUntil = b.time + attackStand(e, STAND).rest;
  return false;
}

/** Enemy healers (dmgType 'heal'): heal the lowest-HP% other enemy within their radius. */
function enemyHeal(b, e, radius) {
  let best = null;
  for (const o of b.enemiesInRadius(e.x, e.y, Math.max(radius, 1))) {
    if (o === e || o.hp >= o.s.maxHp || o.bossPool) continue;
    if (!best || o.hpRatio < best.hpRatio) best = o;
  }
  if (!best) return;
  e.lastAttackAt = b.time;
  e.stats.attacks++;
  b._ev(['atk', e.id, best.id, 'orb']);
  b.heal(e, best, e.s.atk);
  e.atkCd = e.s.interval;
}

export { tileKeyOf, COLS };
