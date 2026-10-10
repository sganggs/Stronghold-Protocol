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
// ground, 0.8944 air, devices 0.4472; Battle._checkBlock) — is blocked, moving or not (stunned or frozen too: GitHub
// #232), so an enemy overlapping an operator is taken over once its blocker is gone; never one holding 不可阻挡 (恐惧,
// 诱导, 浮空, 沉睡): an enemy falling asleep is let go by its blocker, whose slot frees, and stays where it is until it
// wakes (DESIGN §24.9). Blocked enemies fight their blocker (ranged ones may pick anyone in
// range, blocker first); every blocker whose attack hits enemies — a ranged operator on a melee tile included — may
// always target the enemies it blocks, in range or not, whatever its facing, and targets them first (acquireTargets,
// Battle.blockedTargets; user playtest #6: "阻挡了就一定要能打到"); a heal attack keeps selecting injured allies while
// its unit blocks (PRTS 卫戍协议/帮助 "对于医疗干员（咒愈师分支除外），攻击目标为需要治疗的单位"). An ally target
// (Battle.setAllyTarget: 白铁's 铁钳号·原型机, an enemy-camp summon our operators attack, 嘲讽等级 −2) on the range comes after
// every enemy (acquireTargets) and a ranged attack flies to it like to an enemy.
// Every enemy attack strikes at its clip's damage frame after its swing starts (attackWindup; a stun before the frame
// cuts the swing — enemyAttack, GitHub #187). Unblocked ranged enemies attack allies within their radius and stand for
// each attack's clip — through its wind-up and until the clip ends — then walk on (attackStand, GitHub #58;
// ATTACK_PAUSE after the strike when no clip is known; 「不停止移动」 attackers never stop); every enemy whose block ends
// after its strike (its blocker stunned by that strike, knocked out, retreated) stands for the rest of the clip too
// (PRTS 状态机: an enemy's COMBAT state ends with its attack, not with its blocker); the candidates pass the
// enemy's own rule (`e.profile.canTarget`) and are ordered
// blocker → taunt → latest deployed (targeting.js sortAllyTargets). An enemy's damage type is its data's unless content
// arms it (`e.profile.dmgType`: 转译基底's forms, whose data never attacks). Reaching the final leg's end = leak — on a
// portal entrance it is a teleport to the far exit and a walk to that side's blue door instead (portalPickup). A `fear`
// (恐惧) status suspends the route: the enemy runs between random checkpoints away from the fear's source (fear.js
// moveFeared; a self-inflicted fear flutters inside its own tile); an `attract` (诱导) status walks it to the status
// point instead (moveAttracted); both re-plan the route when released (恐惧 outranks 诱导).

import { ATTACK_PAUSE, ALLY_COLLIDER_RADIUS, MOVE_SCALE, PROJECTILE_SPEEDS, PROJECTILE_SPEED, BOOMERANG_RETURN_SPEED, COLS, CHAIN_RADIUS } from './constants.js';
import { sortEnemyTargets, sortAllyTargets, canTargetEnemy, canTargetAlly, tileKeyOf } from './targeting.js';
import { reduceElement } from './damage.js';
import { straightClear } from './grid.js';
import { moveFeared, endFear } from './fear.js';
import { hypot, powi } from './detmath.js';

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

/**
 * One tick off an attack cooldown. What is left within 1e-9 of 0 is 0 (the engine's timer tolerance, as skills.js
 * `timeLeft`, buff intervals and `every()`): 1 s counted down in thirty steps of 1/30 leaves 2.1e-16 in floating point,
 * which held every attack whose interval is a whole number of ticks — 1 s, 3 s, 4 s … — one tick longer (PR #402; PRTS
 * 作战机制 帧对齐: 1 s is 30 frames). A non-integer count still ends on the tick that crosses 0 (docs/SIM.md §2).
 */
export function attackCountdown(cd, dt) {
  const left = cd - dt;
  return left > 1e-9 ? left : 0;
}

export function updateAlly(b, u, dt) {
  if (u.atkCd > 0 && u.canAct) u.atkCd = attackCountdown(u.atkCd, dt);
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
  // (a 秘术师's `canAttack` is its own target rule: false = no valid target — 深靛's bound enemies, 维伊's marked ones)
  if (prof.canAttack && !prof.canAttack(b, u)) { if (prof.storeEnergy) { u.trait.hadTarget = false; storeEnergy(b, u, prof); } return; }
  let targets = acquireTargets(b, u, prof);
  // A DEFAULT charged heal can replace this attack with an eligible ally even when no enemy exists.
  // Run after cooldown/control checks so silence, disarm and the exact attack cadence still apply (#406).
  if (!targets.length && sk?.triggerAllies && sk.onAboutToAttack()) {
    prof = effectiveProfile(u);
    if (prof.noAttack || !u.alive) return;
    targets = acquireTargets(b, u, prof);
  }
  if (!targets.length) { u.trait.hadTarget = false; storeEnergy(b, u, prof); return; }
  u.trait.hadTarget = true;
  if (sk && sk.onAboutToAttack()) {
    prof = effectiveProfile(u);
    if (prof.noAttack || !u.alive) return;
    targets = acquireTargets(b, u, prof);
    if (!targets.length) { storeEnergy(b, u, prof); return; }   // the cast left none (a range change): still this check
  }
  performAttack(b, u, prof, targets);
  u.atkCd = Math.max(u.atkCd, u.s.interval);
}

/**
 * The attack check of a ready unit found no valid target: a 秘术师 profile stores one energy instead (`storeEnergy`,
 * professions.js installMystic — PRTS 分支特性信息 秘术师 "若无有效目标且能量储存数未满，则改为储存一份攻击能量（属于攻击
 * 行为）": the attack interval starts again); with a full store it idles, ready to attack.
 */
function storeEnergy(b, u, prof) {
  if (prof.storeEnergy && prof.storeEnergy(b, u)) u.atkCd = Math.max(u.atkCd, u.s.interval);
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
  const cands = b.enemiesInKeys(u.rangeKeys, u, prof);
  // "可以选择且优先选择阻挡单位" (PRTS 选择器): the enemies a unit blocks are always selectable by it — the block radius
  // (0.7071) reaches past its own tile, so a blocked enemy may stand outside a short range or behind its facing (user
  // playtest #5 item 4); a ranged operator on a melee tile too (user playtest #6: "阻挡了就一定要能打到")
  if (u.blocking.length) for (const e of b.blockedTargets(u, prof)) if (!cands.includes(e)) cands.push(e);
  // an ally target (Battle.setAllyTarget: 白铁's 铁钳号·原型机, an enemy-camp summon with 嘲讽等级 −2) after every enemy
  const extra = b._allyTargets && b._allyTargets.size ? b.allyTargetsInKeys(u.rangeKeys, u) : null;
  if (extra && extra.length) {
    if (prof.allInRange) return cands.concat(extra);
    sortEnemyTargets(b, u, cands, prof.priority);
    const all = cands.concat(extra);
    const n = targetCount(u, prof);
    return n >= all.length ? all : all.slice(0, n);
  }
  if (!cands.length) return cands;
  if (prof.allInRange) return cands;
  const n = targetCount(u, prof);
  sortEnemyTargets(b, u, cands, prof.priority);
  return n >= cands.length ? cands : cands.slice(0, n);
}

/**
 * How many targets one attack of `u` takes. `hitAllBlocked` — "同时攻击阻挡的所有敌人": the 强攻手 / 重剑手 / 推击手 traits and every
 * skill worded so, whose client selectors carry `_limitedMaxTargetNumToBlockedCnt` (with `_allowZeroBlockCntLimit` off) —
 * takes up to its block count, never fewer than 1, from its range and the enemies it blocks, the blocked ones first
 * (acquireTargets' order): PRTS 分支特性信息 强攻手 / 重剑手 / 推击手 "普通攻击最大目标数等于阻挡数（不会低于1）", PRTS 作战机制 §AOE伤害判定
 * "锁定人数的无弹道AOE攻击（例如近卫分支“强攻手”）…在抬手时选取范围内的全体目标（不超过其攻击目标上限）", PRTS 忍冬 S3 备注 "可对空" (a
 * flyer she cannot block). Until 0.2.0 it struck the blocked enemies only (one in range when it blocked none).
 */
function targetCount(u, prof) {
  const base = prof.hitAllBlocked ? Math.max(1, Math.floor(u.s.blockCnt)) : (prof.maxTargets || 1);
  return Math.max(1, Math.floor(base + u.s.maxTargets));
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
  // 秘术师: the stored energies leave with this attack, at its main target (professions.js installMystic)
  const energy = !isHeal && prof.releaseEnergy ? prof.releaseEnergy(b, u) : 0;
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    b._ev(['atk', u.id, t.id, vis]);
    if (isHeal) { doHeal(b, u, prof, t); continue; }
    const info = { isSkill, index: i, attackId, energy: i === 0 ? energy : 0 };
    const foe = t.side === 'enemy' || b.isAllyTarget(t);
    if (ranged && foe && prof.projectile === 'boomerang') {
      throwBoomerang(b, u, prof, t, info);
    } else if (ranged && foe) {
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
 * Content: a catch fires the hook `boomerangCaught` { unit, attackId, isSkill, x, y } (娜仁图亚 LPS-Y "每回收5次回旋投射物",
 * S3 "投射物全部回收时"); an attack profile with `boomerangOnward(ctx)` (a skill's attack override: 娜仁图亚 S1's bounces,
 * S2's dash) takes the flight over after the first hit — ctx { battle, unit, profile, target, x, y, attackId, isSkill,
 * home(), hit(target, x, y) (resolveHit with this attack's profile), comeBack(x, y) (sends it back from there, once;
 * returns the return projectile or null) } — and a content error there sends it back from the hit point.
 */
function throwBoomerang(b, u, prof, t, info) {
  const seq = u.deploySeq;
  u.trait.boomerangsOut = (u.trait.boomerangsOut || 0) + 1;
  const home = () => u.alive && u.deployed && u.deploySeq === seq;
  let sent = false;
  const comeBack = (x, y) => {
    if (sent || !home()) return null;
    sent = true;
    // hitDead: flies on to the thrower's last position even while it is hidden, caught there when it is still home
    return b.addProjectile({ from: { x, y }, target: u, speed: BOOMERANG_RETURN_SPEED, visual: 'boomerangReturn', source: u, hitDead: true,
      onHit: (r) => {
        if (!home() || !(u.trait.boomerangsOut > 0)) return;
        u.trait.boomerangsOut--;
        if (b._hooks.boomerangCaught) b.emit('boomerangCaught', { unit: u, attackId: info.attackId ?? 0, isSkill: !!info.isSkill, x: r.x, y: r.y });
      } });
  };
  b.addProjectile({ from: u, target: t, speed: PROJECTILE_SPEEDS.boomerang, visual: 'boomerang', source: u, hitDead: true,
    onHit: (c) => {
      // (guarded on its own: a content error in the hit must not cost the thrower its boomerang for the battle)
      if (c.target || prof.splashRadius > 0) b._safe(() => resolveHit(b, u, prof, c.target, info, c.x, c.y), 'boomerang.hit', u);
      if (!home()) return;
      if (typeof prof.boomerangOnward === 'function') {
        const ctx = { battle: b, unit: u, profile: prof, target: c.target, x: c.x, y: c.y, attackId: info.attackId ?? 0, isSkill: !!info.isSkill,
          home, comeBack, hit: (tgt, x, y) => b._safe(() => resolveHit(b, u, prof, tgt, info, x, y), 'boomerang.hit', u) };
        if (b._safe(() => { prof.boomerangOnward(ctx); return true; }, 'boomerang.onward', u) === true) return;
      }
      comeBack(c.x, c.y);
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
    const hits = prof.hitsFn ? prof.hitsFn(b, u, info) : Math.max(1, prof.hits || 1);
    // `hitDmgMul` (professions.js header): each instance's 伤害倍率 — the DamageInfo `mul`, after DEF / RES — and only the
    // first instance may give 受击回复 (砾's two 50 % hits, PRTS 砾 特性备注)
    const split = Number.isFinite(prof.hitDmgMul) && prof.hitDmgMul > 0 ? prof.hitDmgMul : null;
    let dealtMain = 0;
    for (let h = 0; h < hits && target.alive; h++) {
      const d = { amount: atk * scale * mulT, type: baseType, isAttack: true, isSkill: info.isSkill, tags: prof.tags || [], attackId };
      if (split != null) { d.mul = split; if (h > 0) d.noSp = true; }
      dealtMain += b.dealDamage(u, target, d);
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
        const d = hypot(e.x - prev.x, e.y - prev.y);
        if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && best && e.spawnSeq < best.spawnSeq)) { bd = d; best = e; }
      }
      if (!best) break;
      hit.add(best.id);
      b._ev(['atk', prev.id, best.id, 'chain']);
      const d = b.dealDamage(u, best, { amount: atk * scale * skillMul * powi(1 - (prof.chain.falloff ?? 0.15), k), type: baseType, isAttack: true, isSkill: info.isSkill, tags: ['chain'], attackId });
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

/**
 * The next unit of a 链愈师 heal chain of `healer` from `prev` — PRTS 分支特性信息 链愈师: "跳跃范围为x-4，无特殊说明的场合一次
 * 治疗链不会对已跳跃过的单位重复跳跃", "优先跳跃至范围内生命比例最低＞部署时间点最晚的我方单位。可选择满生命我方单位为跳跃目标，但仍受
 * 禁疗制约": an ally on the 3×3 of tiles around prev's (range x-4), not yet in this chain (`seen` ids), no device, no hidden
 * or 孤立 unit, no 禁疗 / 无法被治疗 one (as Battle.injuredAlliesInKeys: the healer's `healThrough` lets its own summon in —
 * 凯尔希 / Mon3tr); the lowest HP ratio first — a full-HP ally too, healed for nothing, and the chain jumps on from it —,
 * then the latest deployed (aggroSeq). Null when none. Shared by the profession (doHeal) and Mon3tr's kit.
 */
export function chainHealNext(b, healer, prev, seen) {
  const through = healer && healer.profile && typeof healer.profile.healThrough === 'function' ? healer.profile.healThrough : null;
  const r0 = prev.tileR, c0 = prev.tileC;
  let best = null;
  for (const a of b.allyUnits) {
    if (!a.alive || !a.deployed || a.hidden || a.kind === 'device' || seen.has(a.id)) continue;
    if (Math.abs(a.tileR - r0) > 1 || Math.abs(a.tileC - c0) > 1) continue;
    if (a !== healer && (a.s.flags.isolated || (a.s.flags.noHeal && !(through && through(healer, a))) || (a.profile && a.profile.noHeal))) continue;
    if (!best || a.hpRatio < best.hpRatio - 1e-12 || (Math.abs(a.hpRatio - best.hpRatio) <= 1e-12 && a.aggroSeq > best.aggroSeq)) best = a;
  }
  return best;
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
      const best = chainHealNext(b, u, prev, seen);
      if (!best) break;
      seen.add(best.id);
      b._ev(['atk', prev.id, best.id, 'chainHeal']);
      b.heal(u, best, amount * powi(1 - (h.falloff ?? 0.25), k));
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
  for (let i = pts.length - 2; i >= 0; i--) suf[i] = suf[i + 1] + hypot(pts[i + 1].x - pts[i].x, pts[i + 1].y - pts[i].y);
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
        len = hypot(L.r - sr, L.c - sc);
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
    d += hypot(p.x - e.x, p.y - e.y) + R.suffix[R.ptIdx];
  } else if (leg && leg.t === 'move') {
    d += hypot(leg.c - e.x, leg.r - e.y);
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
  if (stunned || e.hidden || e.s.flags.fear) b._cutAttackStand(e);
  // 失衡 (UNBALANCE, battle/displacement.js _unbalance): a state machine, not a status — 浮空 ends it (PRTS 术语释义 浮空
  // 「触发浮空时清除受到的推/拉力…无法陷入失衡」); while it lasts the enemy neither walks nor starts a normal attack
  if (e.s.flags.levitate && e.unbalanceUntil > b.time) e.unbalanceUntil = -Infinity;
  const unbalanced = b.time < e.unbalanceUntil - 1e-9;   // (the 1e-9: a float-summed end such as 35/30 s keeps its frame)
  const prevCd = e.atkCd;
  if (e.atkCd > 0 && !stunned && !e.hidden) e.atkCd = attackCountdown(e.atkCd, dt);
  // a stun / freeze / sleep / 浮空 / 失衡 — or leaving the field — takes the enemy out of its attack: a swing short of its
  // damage frame does not land, and the attack starts again from its wind-up afterwards (enemyAttack)
  if (e.swing && (stunned || e.hidden || unbalanced)) e.swing = false;
  // true: an unblocked ranged enemy in the wind-up of its next attack with a target in range (it stands)
  const winding = !e.hidden && !stunned && !unbalanced && enemyAttack(b, e, prevCd);
  if (!e.alive) return;
  // a stun / freeze / sleep cuts the attack clip short: no stand left once it ends [ASSUMED]. 沉睡 also holds 不可阻挡
  // (PRTS 异常效果 SLEEPING = 无法行动+无敌+不可阻挡): a sleeper's blocker lets go — its swing was cut above; Battle.applyStatus
  // (battle/status.js) releases it at once, this catches a sleep added as a plain buff (`flags.sleep` makes it `stun` too,
  // units.js) — and it stays where it is until it wakes (DESIGN §24.9). 晕眩 / 冻结 hold no 不可阻挡 (PRTS 异常效果: the
  // STUN / FROZEN state machines stop the enemy's moves and attacks, not its being blocked; 术语释义 冻结 names no block):
  // it is still blocked by contact where it stands, like a standing enemy — an operator redeployed or deployed onto it,
  // another one taking it over or one whose capacity frees up blocks it, and the block lifts its 隐匿 (GitHub #232; until
  // 0.2.0 the check waited for the status to end). The contact rule of a moving enemy (Battle._checkBlock, which still
  // refuses 沉睡 / 浮空 / 恐惧 / 不可阻挡): one stunned short of its blocker is blocked once it walks into contact
  if (stunned && !e.hidden) {
    e.atkStandUntil = -Infinity;
    if (e.blockedBy && e.s.flags.sleep) b._unblock(e);
    b._checkBlock(e);
    return;
  }
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
  // a 恐惧 runs at once (it cannot attack). 失衡 holds the walking too — under 恐惧 / 诱导 as well (失衡免疫 says 「失衡期间
  // 无法自主移动」; no source exempts a fear)
  const standing = winding || unbalanced || (b.time < e.atkStandUntil && !e.s.flags.fear);
  if (e.s.flags.noMove) { e.moving = false; return; }   // standing (a 重生, a form change): drawn idle, not walking
  // 恐惧 (ba.fear "无法被阻挡并四散逃跑"; PRTS 诱发移动: 恐惧 outranks 诱导): runs to random tiles of the fan away from
  // its source — a self-inflicted fear flutters inside its own tile (fear.js); the route re-plans once it ends
  if (e.s.flags.fear && !e.hidden) { if (unbalanced) e.moving = false; else moveFeared(b, e, dt); return; }
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
    const dx = p.x - e.x, dy = p.y - e.y, d = hypot(dx, dy);
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
    if (!leg) {
      if (!portalPickup(b, e)) { b.leak(e); return; }
      continue;
    }
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
      b._cutAttackStand(e);
      b._setHidden(e, true);
      e.atkStandUntil = -Infinity; standing = false;   // off the field: its attack clip is over
      R.legIdx++; R.pts = null;
      continue;
    }
    if (leg.t === 'appear') {
      e.x = leg.c; e.y = leg.r;
      b._setHidden(e, false);
      // a relocation is a forced state switch: it ends a 失衡 (PRTS 失衡位移机制 「被强制切换至其他状态机」)
      e.unbalanceUntil = -Infinity;
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
      const d = hypot(dx, dy);
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
      if (leg.final) {
        if (!portalPickup(b, e)) { b.leak(e); return; }
      }
      R.legIdx++;
      R.pts = null;
    }
  }
}

/**
 * Boss-field portal pickup (tile_telin / tile_telout; GitHub #336, PR #337 by @2321Robin, both with a recording of the
 * official game): a route that ENDS on a portal entrance does not leak there — the enemy is teleported out of the far
 * exit and walks on to the blue door on the entrance's side, where it leaks. The boss / Hidden Core circuits end on
 * an entrance ([1,3] / [1,17]; 137 routes of data/waves.json); their mid-route crossings are the routes' own DISAPPEAR /
 * WAIT / APPEAR steps, every MOVE onto an entrance being followed by a DISAPPEAR, so only the route's end needs this.
 * Appends vanish → wait → reappear → walk-to-door legs to the live route and returns true (false: not on an entrance,
 * or no exit in the field). The exit is the telout farthest from the entrance, the door the end tile nearest to it:
 * every explicit pair of the data (95, routes and extra routes) reads [1,3] / [1,17] → [5,10] — the farther of the two
 * telouts [5,10] / [2,10] of the battle stages — and the doors [2,2] / [2,18] stand beside the entrances. Inside the
 * portal the enemy stays hidden PORTAL_WAIT s, the wait of the explicit crossings of the same tiles (WAIT 3 s in 85 of
 * the 95; 5 s in 9, 1 s in 1). [ASSUMED] the pairing (no tile carries a link) and the 3 s (no source times this one).
 */
const PORTAL_WAIT = 3;
function portalPickup(b, e) {
  const r = Math.round(e.y), c = Math.round(e.x);
  if (!b.grid.inBounds(r, c) || b.grid.tile(r, c).special !== 'telin') return false;
  const outs = b.grid.specialTiles('telout');
  if (!outs.length) return false;
  const dist = (p) => hypot(p[0] - r, p[1] - c);
  const out = outs.reduce((a, x) => (dist(x) > dist(a) ? x : a));
  const R = e.route;
  R.legs.splice(R.legIdx + 1, 0, { t: 'disappear' }, { t: 'wait', time: PORTAL_WAIT }, { t: 'appear', r: out[0], c: out[1] });
  const ends = b.grid.specialTiles('end');
  if (ends.length) {
    const door = ends.reduce((a, x) => (dist(x) < dist(a) ? x : a));
    R.legs.push({ t: 'move', r: door[0], c: door[1], final: true });
  }
  R.pts = null;
  R.tailVersion = -1;   // the appended tail invalidates the cached remaining-distance suffixes
  return true;
}

/**
 * How long an enemy stands for one attack: an unblocked ranged enemy for its whole clip (GitHub #58 — the owner's
 * decision of 2026-10-04 from first-hand memory of the official game: a ranged enemy stops for each attack's animation
 * and walks on between attacks; the handbook names attacking on the move as a special ability, “十字路口”量产型's
 * 「不停止移动的四向攻击」), and any enemy for the rest of it after the strike once its block ends meanwhile (enemyAttack;
 * PRTS 状态机 ATTACK / COMBAT "攻击结束后回退到MOVE状态", 0.2.0).
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
  const speed = clipSpeed(e, a);
  const hit = clipHit(a);
  out.wind = hit / speed;
  out.rest = (a.dur - hit) / speed;
  return out;
}
const STAND = { wind: 0, rest: 0 };
/** The attack clip's strike frame (s into the clip); half the clip when the manifest names none. */
const clipHit = (a) => (Number.isFinite(a.hit) ? Math.min(a.dur, Math.max(0, a.hit)) : a.dur / 2);
/** The clip plays faster when the attacks come quicker than it. */
const clipSpeed = (e, a) => { const iv = e.s.interval; return iv > 0 && iv < a.dur ? a.dur / iv : 1; };

/**
 * The damage frame of an enemy's normal attack: seconds from the start of its swing to the strike — its attack clip's
 * strike frame (data/enemies.json `attackAnim.hit`, half the clip when the manifest names none), shortened with the clip
 * when the attacks come quicker than it (as attackStand; a 「不停止移动」 attacker swings on the move); 0 with no clip known
 * (the strike as the swing starts — the rule before 0.2.0).
 */
export function attackWindup(e) {
  const a = e.def?.attackAnim;
  return a && a.dur > 0 ? clipHit(a) / clipSpeed(e, a) : 0;
}

/**
 * The allies `e` could hit now: its blocker (and, with a range, the others in reach), passing its own target rule. An
 * enemy whose 索敌不受阻挡影响 (profile `blockFree`: 自制投石机) selects as if unblocked: the allies in reach it may target.
 */
function attackTargets(b, e, radius, reach, own) {
  let targets = [];
  if (e.blockedBy && !(radius > 0 && e.profile && e.profile.blockFree)) {
    const bl = e.blockedBy;
    if (radius > 0) {
      targets = b.alliesInRadius(e.x, e.y, reach, null).filter((a) => a === bl || canTargetAlly(e, a, true));
      if (!targets.includes(bl) && bl.alive) targets.push(bl);
    } else if (bl.alive && bl.deployed) targets = [bl];
  } else if (radius > 0) {
    targets = b.alliesInRadius(e.x, e.y, reach, null).filter((a) => canTargetAlly(e, a, true));
  }
  if (own && targets.length) targets = targets.filter((a) => own(a));
  return targets;
}

/**
 * One tick of an enemy's attack. Its cooldown (`atkCd`) counts down to the damage frame of its next attack: the swing
 * starts `attackWindup` before it — the cooldown down to the wind-up with a target in reach (attackTargets) — and lasts
 * while a target stays in reach; at the frame the attack is made on the targets in reach then. An enemy whose cooldown
 * ran out before it had a target (walking, a swing cut short) swings from the start: the whole wind-up from that tick.
 * A swing short of its frame is cut by a stun / freeze / sleep / 浮空 / leaving the field (updateEnemy), 缴械, 恐惧, 战栗
 * while blocked, or losing every target: no damage, and the next swing starts from its wind-up again — PRTS 状态机
 * (ATTACK / COMBAT "每帧检查异常状态，若有则切换到异常状态的状态") and 异常效果 (STUNNED, DISARMED "正在进行的普通攻击将被
 * 中断"); GitHub #187 / #170 (a 0.1 s 卡西米尔 pulse, 忍冬 S3's 0.2 s stun). A strike already made stays made (a shot in
 * flight lands). An enemy with no attack clip known has no wind-up: it strikes as the swing starts (the old rule).
 * [ASSUMED] the targets are taken at the frame (the swing needs one in reach every tick; the official selection happens
 * as the swing starts); an enemy healer's heal has no wind-up.
 * Returns true while an unblocked ranged enemy swings (its wind-up): it stands (updateEnemy). `prevCd`: the cooldown
 * before this tick's countdown.
 */
function enemyAttack(b, e, prevCd) {
  const def = e.def;
  if (e.profile && e.profile.noAttack) { e.swing = false; return false; }
  const dmgType = (e.profile && e.profile.dmgType) || def.dmgType;
  if (dmgType === 'none' || e.s.atk <= 0) { e.swing = false; return false; }
  // 恐惧 / 缴械 / 战栗 (被阻挡后无法进行普通攻击): no normal attack, and the one swung is interrupted
  if (e.s.flags.fear || e.s.flags.disarm || (e.s.flags.tremble && e.blockedBy)) { e.swing = false; return false; }
  if (dmgType === 'heal') { if (e.atkCd <= 0) enemyHeal(b, e, e.base.rangeRadius); return false; }
  // applyWay MELEE enemies only ever hit their blocker, even when their data carries a rangeRadius (粉碎攻坚手 2.5,
  // 宿主士兵 2.5, 深池伙友卫队 1.4 … — that radius belongs to their abilities/splash, handled by content).
  // Content may flip it with `e.profile.melee = false`.
  const melee = e.profile?.melee ?? def.applyWay === 'MELEE';
  const radius = melee ? 0 : e.base.rangeRadius;
  // the range circle takes an ally whose 0.25 collider touches it (PRTS 作战机制 §碰撞体积: 索敌 uses the colliders)
  const reach = radius > 0 ? radius + ALLY_COLLIDER_RADIUS : 0;
  // `e.profile.canTarget(ally)`: the enemy's own target rule (只攻击地面单位, 不会攻击飞行单位 …; content/enemies/*.js),
  // applied to the candidates before the priority sort and the target count
  const own = e.profile && typeof e.profile.canTarget === 'function' ? e.profile.canTarget : null;
  const wind = attackWindup(e);
  if (e.atkCd > wind + 1e-9) { e.swing = false; return false; }   // the cooldown runs
  let targets = attackTargets(b, e, radius, reach, own);
  if (!targets.length) { e.swing = false; return false; }          // ready, nobody in reach: no swing (or it is cut)
  if (!e.swing) {
    e.swing = true;
    // ready before this tick (it walked with its cooldown over, or its swing was cut): the whole wind-up from now
    if (prevCd < wind) e.atkCd = wind;
  }
  // the wind-up (GitHub #58): an unblocked ranged enemy stands through it (a 「不停止移动」 one walks on)
  if (e.atkCd > 0) return !e.blockedBy && radius > 0 && !(e.profile?.attackMoves ?? def.attackMoves);
  e.swing = false;
  if (targets.length > 1) sortAllyTargets(e, targets);
  // `enemyAttackStart` { enemy, targets }: the enemy starts a normal attack, before 麻痹 may interrupt it (the client's
  // ON_BEFORE_ABILITY_SPELL_ON of an attack that 麻痹 can interrupt — 酒神 堕梦 "攻击范围内的敌人普通攻击时受到70点神经损伤",
  // PRTS 备注 "于敌人成功普通攻击前之前触发（意味着触发的元素爆发可打断当次普攻…）": a burst it causes interrupts this attack)
  if (b._hooks.enemyAttackStart) {
    b.emit('enemyAttackStart', { enemy: e, targets });
    if (!e.alive || e.s.flags.stun) return false;
  }
  // 麻痹 (ba.palsy): each stack interrupts one normal attack. The `palsyTrigger` hook { enemy, buff, keep } fires as it
  // does (PRTS 真言 备注: "触发麻痹时" = the attack interrupted by 麻痹, not a stack gained): a handler may set `keep` — the
  // stack is not consumed (真言 噤声限域 "触发麻痹时有N%概率不消耗麻痹层数") — or deal damage (the enemy may die there)
  const palsy = e.buffs.length ? e.findBuff('palsy') : null;
  if (palsy) {
    let keep = false;
    if (b._hooks.palsyTrigger) {
      keep = !!b.emit('palsyTrigger', { enemy: e, buff: palsy, keep: false }).keep;
      if (!e.alive) return false;
    }
    if (!keep) { if (--palsy.stacks <= 0) b.removeBuff(e, palsy); else e.markDirty(); }
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
  // A lethal strike may immediately redeploy its target. Post-attack effects still belong to the struck deployment.
  const targetDeployments = new Map(targets.map((t) => [t, t.deploySeq]));
  for (const t of targets) {
    b._ev(['atk', e.id, t.id, deferred ? (e.profile.shot || 'none') : rangedShot ? 'enemy' : 'none']);
    if (deferred) continue;
    // a shot that flies as a projectile is 远程途径 (DamageInfo `isProjectile`; PRTS 作战机制 "有弹道的攻击固定为10，无弹道的攻击
    // 固定为01"): what only 近战途径 damage triggers skips it (薇薇安娜's 散华 护盾, kits/ops/op-vvana.js)
    const hit = (tt, isProjectile = false) => {
      if (!tt || !tt.alive || !e.alive && !rangedShot) return;
      b.dealDamage(e, tt, { amount: e.s.atk * (e.profile?.atkScale ?? 1), type, isAttack: true, attackId, isProjectile });
    };
    if (rangedShot && hypot(t.x - e.x, t.y - e.y) > 0.75) {
      b.addProjectile({ from: e, target: t, speed: PROJECTILE_SPEEDS.enemy, visual: 'enemy', source: e, onHit: (c) => hit(c.target, true) });
    } else hit(t);
  }
  if (b._hooks.attack) b.emit('attack', { attacker: e, targets, targetDeployments, isSkill: false });
  e.atkCd = e.s.interval;
  // stands for the rest of its attack clip (attackStand; the wind-up was stood before the strike) — every enemy, blocked
  // or not: PRTS 状态机, an enemy's ATTACK / COMBAT state "攻击结束后回退到MOVE状态" and checks only 异常状态 every frame
  // (only a character's COMBAT "检测到不存在阻挡对象时强行切回IDLE状态"), so an enemy whose block ends after its strike — the
  // strike stunned its blocker (流泪小子: 晕眩 "无法…阻挡"), knocked it out, or the blocker retreated — finishes its clip
  // before it walks on (until 0.2.0 it walked on at once; community report of 2026-10-07 「哭狗瞬间隐匿没有后摇」). A
  // blocked enemy never walks, so the stand matters only once it is free; a stun / freeze / sleep / 浮空, hiding or a
  // displacement (失衡) ends it (updateEnemy, advanceRoute, Battle.displace)
  e.atkStandUntil = b.time + attackStand(e, STAND).rest;
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
