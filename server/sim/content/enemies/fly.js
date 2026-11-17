// server/sim/content/enemies/fly.js — FLY 飞行 kits (auras, 暴鸰, the “萨科塔”, 假想敌：黑云, shells, seeds) and their part of KITS
// (split from content/enemies.js).

import { TICK, PROJECTILE_SPEEDS, ALLY_COLLIDER_RADIUS } from '../../constants.js';
import {
  num, T, hurt, targetsNear, allTargets, areaAllies, areaAlliesInTiles, fieldAllies, byPriority, spawnChildren,
  setForm, expose, unbalancedNow, attackSkillOf,
} from './helpers.js';
import { enemyAura, allyAura, selfFear, skill, kitSelfFear } from './archetypes.js';
import { hypot } from '../../detmath.js';
import { bbCap, fieldCap } from '../../../../shared/plugins/officialBounds.js';

// ---------------------------------------------------------------------------------------------------------------
// constants (numbers that exist nowhere in the data)

/** 暴鸰 投弹: the target's tile and its 8 neighbours (PRTS "对目标及其周围八格的我方单位造成100%物理伤害"). */
const BOMB_REACH = 1;

/** 暴鸰 投弹: the bomb leaves on the OnAttack event of the cast's Attack clip (the official battle prefab's Boomb ability:
 *  animKey Attack, `_waitForAttackEvent`; the skeleton's OnAttack is on frame 8 of the 30 fps clip — data/assets.json
 *  hits.Attack 0.267, rounded — so exactly 8 sim ticks). It then flies as projectile_bombd (`_speed` 5 =
 *  PROJECTILE_SPEEDS.droneBomb, homing, `_ignoreCamouflage`). */
export const BOMBD_RELEASE = 8 / 30;

/** 暴鸰 投弹: the cast ends once the bomb has landed and no sooner than this after the release (the Boomb ability:
 *  `_fireAttackFinishWhenProjectileInvalid` 1, `_minPostDelayWhenProjectileInvalid` 0.667, `_waitForAnimEndWhenProjectileInvalid`
 *  0). Then its buff bomb_s (template switch_mode_restart_fsm: mode S1 + the move-speed modifier) — PRTS "技能结束后移速最终
 *  提升至200%"; the cast's end clip is already the bomb-less Idle_2 (`_endAnimKey`). */
export const BOMBD_POST_DELAY = 0.667;

/** 帝国炮火先兆者 shell (PRTS 天赋 of both 先兆者 "普通攻击向目标所在位置发射一枚于3秒后命中的弹道，弹道对半径1.2范围内的所有我方单位造成
 *  攻击力100%的无来源物理伤害（此弹道不会强制击中主目标，碰撞无视迷彩）… ※弹道始终使用缓存攻击力"): flight time and the written
 *  blast radius. The landing is a 碰撞 — PRTS 作战机制 §碰撞体积: collider tests are the common way, an ally's collider a
 *  circle of ALLY_COLLIDER_RADIUS — so an ally is hit when its collider touches the 1.2 circle: centre distance ≤ 1.45
 *  (SHELL_REACH), the impact tile and the 8 around it (a diagonal tile centre is √2 ≈ 1.414 away; two tiles, 2, stay
 *  out) — the 3×3 a player saw in the official game (GitHub #364; until 0.2.2 the bare 1.2: the cross only).
 *  [ASSUMED] for this shell (its text names the 碰撞); other content zones keep their point radius (constants.js). */
const SHELL_FLIGHT = 3, SHELL_RADIUS = 1.2, SHELL_REACH = SHELL_RADIUS + ALLY_COLLIDER_RADIUS;

/** 假想敌：黑云 抓取: the blackboard radius counts ×2.5 (PRTS "2.5倍可变半径": range_radius 1.5 → 3.75), at most 3 prey,
 *  "短暂延迟后" the 延迟吞噬 lands (delay [ASSUMED] 0.5 s); its SP (= 全弹发射 hits) caps at the data's spData.maxSp. */
const GRAB_RADIUS_SCALE = 2.5, GRAB_MAX_PREY = 3, GRAB_DELAY = 0.5;

/** 枯朽之种 summoned per BornBugs cast ("数个") [ASSUMED]. */
const BUGS_PER_CAST = 3;
/** 枯朽之种's self-destruct attack projectile speed (PRTS 枯朽之种). */
const SEED_PROJECTILE_SPEED = 10;

// ---------------------------------------------------------------------------------------------------------------
// kits

/** 远眺: knocked out ⇒ 暴露 on every ally within r — PRTS 天赋 "（可被沉默；无视其可选性）": 隐匿 / untargetable ones too. */
function kitExposeOnDeath(ab) {
  const dur = T(ab, 'Expose.weak[limit]') ?? 0, scale = T(ab, 'Expose.damage_scale') ?? 1, r = T(ab, 'Expose.range_radius') ?? 1;
  return [{ sil: true, death(c, b, e) { if (c.reason !== 'killed') return; b.fx('explode', { x: e.x, y: e.y, r, kind: 'expose' }); for (const u of b.alliesInRadius(e.x, e.y, r)) expose(b, u, dur, scale); } }];
}

/**
 * 假想敌：黑云 (PRTS): 抓取 (KillOthers, cd 10 / icd 5) "仅半径3.75范围内存在未持有【延迟吞噬】的敌方飞行普通单位时可触发：
 * 选择至多3名满足上述条件的目标，短暂延迟后对其施加4秒【延迟吞噬】：束缚，效果结束时令给予方+1SP，随后强制击杀受予方 ※技能
 * 持续4秒，期间持有束缚" (the nearest prey first [ASSUMED]); 全弹发射 (FireWeapon, cd 10 / icd 5, SP cost 1) "仅全场范围内存在
 * 我方单位时可触发：清空自身SP，进行一次多连击，每击选择全场范围内的1名随机我方单位，对其造成攻击力130%的物理伤害 ※多连击的
 * 连击次数等于本技能消耗的SP数量" — SP (技力上限 spData.maxSp 3) only comes from the grabs.
 */
function kitBlackCloud(ab, e) {
  const k = ab.sk.KillOthers, f = ab.sk.FireWeapon;
  // [ASSUMED] DESIGN §32.5: salvo length is sp.maxSp. Official 黑云 maxSp is 3.
  const maxAmmo = Math.min(fieldCap('enemy.sp.maxSp'), Math.max(1, num(e.def.raw && e.def.raw.sp && e.def.raw.sp.maxSp, 3)));
  const grabR = (k ? num(k.bb.range_radius, 1.5) : 1.5) * GRAB_RADIUS_SCALE;
  const dur = k ? num(k.bb.duration, 4) : 4;
  const isPrey = (b, e2, o) => o !== e2 && o.alive && !o.hidden && o.isFlying && o.def.rank === 'NORMAL' && !o.isBoss && !o.findBuff('ab:devoured');
  const prey = (b, e2) => b.enemiesInRadius(e2.x, e2.y, grabR).filter((o) => isPrey(b, e2, o));
  return [
    skill(k, (b, e2) => {
      const list = prey(b, e2).sort((p, q) => hypot(p.x - e2.x, p.y - e2.y) - hypot(q.x - e2.x, q.y - e2.y)).slice(0, GRAB_MAX_PREY);
      if (!list.length) return;
      b.addBuff(e2, { key: 'ab:grabbing', duration: dur, flags: { bind: true, noMove: true } });   // 技能持续4秒，期间持有束缚
      b.fx('beam', { x: e2.x, y: e2.y, from: e2.id, to: list[0].id, kind: 'devour' });
      b.after(GRAB_DELAY, () => {
        if (!e2.alive) return;
        for (const o of list) {
          if (!o.alive) continue;
          b.addBuff(o, { key: 'ab:devoured', duration: dur, visible: true, flags: { bind: true, noMove: true, disarm: true } });
          b.after(dur, () => {
            if (!o.alive || !e2.alive) return;
            const gain = num(k.bb.sp, 1);
            const step = gain > bbCap('sp') ? bbCap('sp') : gain;
            e2.mem.ab.ammo = Math.min(maxAmmo, (e2.mem.ab.ammo ?? 0) + step);
            b.kill(o, null);
          }, { owner: e2 });
        }
      }, { owner: e2 });
    }, { sil: true, cond: (b, e2) => prey(b, e2).length > 0 }),
    skill(f, (b, e2) => {
      const hits = Math.min(maxAmmo, Math.floor(e2.mem.ab.ammo ?? 0));
      if (!(hits > 0)) return;
      e2.mem.ab.ammo = 0;
      for (let i = 0; i < hits; i++) {
        const t = b.rng.pick(allTargets(b, e2));
        if (!t) break;
        b.fx('beam', { x: e2.x, y: e2.y, from: e2.id, to: t.id, kind: 'fireWeapon' });
        hurt(b, e2, t, e2.s.atk * num(f.bb.atk_scale, 1), 'phys');
      }
    }, { sil: true, cond: (b, e2) => (e2.mem.ab.ammo ?? 0) >= Math.max(1, num(f.sp, 1)) && allTargets(b, e2).length > 0,
      turn: attackSkillOf('enemy_9009_acfort', 'FireWeapon') }),   // the attack's turn (DESIGN §35.52)
  ];
}

function kitSteal(ab) {
  const n = T(ab, 'DamageOrBullet.attack@minus_bullet') ?? 1;
  return [selfFear(ab), {
    // PRTS “萨科塔之眼” 天赋: "不会攻击飞行单位" (the 炎佑 dragon is one) — a candidate filter (ai.js enemyAttack): its next
    // ground target in range instead
    spawn(b, e) { e.profile.canTarget = (u) => !u.isFlying; },
    hitOut(c, b, e) {
      if (!c.dmg.isAttack) return;
      const t = c.target;
      // 攻击时尝试夺走目标1发弹药，若无法夺走弹药则造成高额物理伤害
      if (t.skill && t.skill.active && t.skill.kind === 'ammo' && t.skill.ammoLeft > 0) {
        t.skill.ammoLeft = Math.max(0, t.skill.ammoLeft - n);
        if (t.skill.ammoLeft <= 0) t.skill.end('ammo');
      } else if ((t.trait && t.trait.ammo) > 0) {
        t.trait.ammo = Math.max(0, t.trait.ammo - n);
      } else return;
      c.dmg.cancel = true;
      b.fx('steal', { x: t.x, y: t.y, id: t.id, from: e.id });
    },
  }];
}

/** “萨科塔昂首” 【祈祷邀约】 (PRTS "令全场我方单位（不可对空，无视迷彩）获得15s【受邀祈祷】攻击速度-30"): a whole-field skill
 *  selection — every ally but an unblocking 隐匿 / untargetable / sleeping one (fieldAllies; no 无视无法选择) and, 不可对空, a
 *  flying one (the 炎佑 dragon; until 0.2.1 it was slowed too). */
function kitRoar(ab) {
  const s = ab.sk.Roar;
  return [selfFear(ab), skill(s, (b, e) => {
    b.fx('telegraph', { x: e.x, y: e.y, r: 99, kind: 'roar', id: e.id });
    for (const u of fieldAllies(b, e)) if (!u.isFlying) b.addBuff(u, { key: 'ab:roar', duration: s.bb.duration ?? 0, refresh: 'extend', mods: { aspd: s.bb.attack_speed ?? 0 }, visible: true });
  }, { sil: true })];
}

/**
 * 暴鸰 (PRTS): "不进行普通攻击"; 投弹 (boomb, cooldown / initCooldown 1) "仅攻击范围内存在我方单位时可触发：对目标及其周围八格
 * 的我方单位造成100%物理伤害（对主目标造成物理普通伤害，对溅射目标造成物理溅射伤害，伤害无视迷彩）技能结束后移速最终提升至200%
 * ※此技能仅能触发一次，不可沉默". The official battle prefab (enemy_1040_bombd, read from the client) drops the bomb as a
 * projectile: the cast plays the Attack clip, the bomb leaves on its OnAttack event (BOMBD_RELEASE) and flies to the
 * target (projectile_bombd), and the drone switches to its bomb-less mode (S1, buff bomb_s: the *_2 clips, no bottle).
 * User feedback after 0.1.0 (D4 "炸弹无法正常投放"): the damage used to land in the tick of the trigger while the drone
 * kept its bomb on screen. Now: the drone hovers through its cast; at the release an 'atk' event of kind 'droneBomb'
 * (the client winds the Attack clip up to it and flies the bomb) and setForm 'bombed' (fx 'phase' {kind, form: 'bombed'}
 * — render FORMS: the *_2 clips, which the view starts once the Attack clip is over — the official end clip Idle_2;
 * `e.form` → UnitInfo.form; the client keeps the fx through catch-ups, shared/protocol.js fxForm); on arrival the target (the ranged target by engine priority) takes 100 % ATK and every other ally of
 * the 8 tiles around where it lands 100 % ATK splash (camouflage ignored); a target gone mid-flight: the bomb lands
 * where it was. The cast ends once the bomb has landed, at least BOMBD_POST_DELAY after the release: move speed
 * ×boomb.move_speed, and it flies on. A stun / freeze / sleep before the release interrupts the cast (Boomb
 * `_immuneStunWhenAffecting` 0, like the other enemy channels here): nothing leaves the drone, it keeps its bomb and casts
 * again after the skill's cooldown (1 s, counted from the interrupt) once it is free and an operator is in range.
 * [ASSUMED] no drop when the drone is dead at the release; the ATK at the release; the hover through the cast (its own
 * hold, `pauseUntil`: the drone has no normal attack — `noAttack` —, so ai.js attackStand, the stand of a ranged enemy
 * for its attack clip, never runs for it; the drop is its only attack-like cast); the
 * bomb-less look from the release (the bomb leaves the drone on that frame of the Attack clip; at the cast end — 1 tick
 * before the clip ends — the client would draw the bomb back for a frame); an interrupted cast does not use up the one
 * trigger (`_maxTriggerTime` 1 — the bomb is still on the drone); a stun after the release does not stop the cast end.
 */
function kitBombd(ab) {
  const s = ab.sk.boomb;
  const ms = (s && s.bb.move_speed) || 0;
  const reach = (e) => e.base.rangeRadius || 2;
  const land = (b, e, atk, t, x, y) => {
    const r = t ? t.tileR : Math.round(y), c = t ? t.tileC : Math.round(x);
    b.fx('explode', { x, y, r: BOMB_REACH + 0.5, kind: 'bomb', tiles: 'box' });
    if (t) hurt(b, e, t, atk, 'phys');
    // the splash on the 8 tiles is an area selection ("伤害无视迷彩", no 无视无法选择): no unblocking 隐匿 ally
    for (const u of areaAlliesInTiles(b, e, r, c, 'box', BOMB_REACH)) if (u !== t) hurt(b, e, u, atk, 'phys', { tags: ['splash'] });
  };
  // the end of the cast (bomb_s): 移速最终提升至200%; it flies on
  const finish = (b, e) => {
    if (!e.alive) return;
    e.pauseUntil = b.time;
    if (ms > 0) b.addBuff(e, { key: 'ab:bombRun', mods: { moveMul: ms }, persist: true });
  };
  // the cast before its release: { a: the skill ability, rel: the scheduled release }
  let pending = null;
  // a stun / freeze / sleep before the release: the bomb stays on; the skill re-arms with its cooldown
  const interrupt = (b, e) => {
    const { a, rel } = pending;
    pending = null;
    rel.cancel();
    e.pauseUntil = b.time;
    a.left = Math.max(TICK, num(s.cd, 1));
  };
  return [
    { spawn(b, e) { e.profile.noAttack = true; },
      tick(b, e) { if (pending && e.s.flags.stun) interrupt(b, e); } },
    skill(s, (b, e, a) => {
      const t = byPriority(e, targetsNear(b, e, reach(e)))[0];
      if (!t) return;
      a.cd = Infinity; a.left = Infinity;                               // 仅能触发一次
      e.skillAnimUntil = -1;           // the cast is drawn through its 'atk' event: the client winds the Attack clip up to it
      // hovers through the cast, until `finish` (bounded: the bomb lands within its projectile's maxAge, 10 s)
      e.pauseUntil = Math.max(e.pauseUntil, b.time + BOMBD_RELEASE + 10 + BOMBD_POST_DELAY);
      let landed = false, waited = false;
      const done = () => { if (landed && waited) finish(b, e); };
      pending = { a, rel: null };
      pending.rel = b.after(BOMBD_RELEASE, () => {
        if (pending && e.alive && e.s.flags.stun) { interrupt(b, e); return; }  // stunned after this tick's ability pass
        pending = null;
        if (!e.alive) return;
        const atk = e.s.atk;
        b._ev(['atk', e.id, t.id, 'droneBomb']);
        setForm(b, e, 'bombed');                           // UnitInfo.form: a view built later draws it bomb-less
        b.addProjectile({ from: e, target: t, speed: PROJECTILE_SPEEDS.droneBomb, visual: 'droneBomb', source: e, hitDead: true,
          onHit: (c) => { land(b, e, atk, c.target, c.x, c.y); landed = true; done(); } });
        b.after(BOMBD_POST_DELAY, () => { waited = true; done(); }, { owner: e });
      }, { owner: e });
    }, { cond: (b, e) => targetsNear(b, e, reach(e)).length > 0 }),
  ];
}

/**
 * 帝国炮火先兆者 / 中枢先兆者 (PRTS): every normal attack fires a shell at the target's position that lands SHELL_FLIGHT s
 * later and deals 100 % of the ATK at launch as physical damage without a source to every ally whose collider touches the
 * SHELL_RADIUS circle (SHELL_REACH)
 * (it may miss the target that moved away; "碰撞无视迷彩"). The landing is the shell's area selection (areaAllies of the
 * enemy that fired it: no unblocking 隐匿 ally; the damage stays 无来源). The attack itself is the engine's (cooldown,
 * pause, 'atk' event of kind 'mortar'); the damage is the shell's (ai.js `profile.deferHit`).
 */
function kitShell() {
  return [{
    spawn(b, e) { e.profile.deferHit = true; e.profile.shot = 'mortar'; },
    attack(c, b, e) {
      const atk = e.s.atk * (e.profile.atkScale ?? 1);
      for (const t of c.targets) {
        const x = t.x, y = t.y;
        // (the telegraph and the blast are drawn at the reach: every ally whose centre lies in the circle is hit)
        b.fx('bombardShell', { x, y, id: e.id, r: SHELL_REACH, t: SHELL_FLIGHT });
        b.after(SHELL_FLIGHT, () => {
          b.fx('bombard', { x, y, r: SHELL_REACH, kind: 'emppnt' });
          for (const u of areaAllies(b, e, x, y, SHELL_REACH)) hurt(b, null, u, atk, 'phys', { isSkill: false, tags: ['shell'] });
        });
      }
    },
  }];
}

// ---------------------------------------------------------------------------------------------------------------
// this family's part of KITS (content/enemies.js spreads the parts in this order)

export const FLY_KITS = Object.freeze({
  // --- FLY 飞行 (motion is engine; abilities)
  enemy_1017_defdrn: (ab) => [enemyAura(T(ab, 'defup.range_radius') ?? 2.5, 'ab:defdrn', { defFlat: T(ab, 'defup.def') ?? 0 })],        // 御4 · DEF aura
  enemy_1355_mrfly: (ab, e) => [enemyAura(e.base.rangeRadius || 2.5, 'ab:mrfly', { resFlat: T(ab, 'magdef_add.magic_resistance') ?? 0 })], // 护障 · RES aura
  enemy_1355_mrfly_2: (ab, e) => [enemyAura(e.base.rangeRadius || 2.5, 'ab:mrfly', { resFlat: T(ab, 'magdef_add.magic_resistance') ?? 0 })], // 护障·P · RES aura
  enemy_1042_frostd: (ab) => [allyAura(T(ab, 'defup.range_radius') ?? 2.5, 'ab:frost', { aspd: (T(ab, 'atkSpeedDown.attack_speed') ?? 0) * 100 })], // 寒霜 · ASPD −50 aura on operators
  enemy_1040_bombd: kitBombd,                                        // 暴鸰 · no normal attack: ONE bomb (target + 8 tiles), then ×2 speed
  enemy_10083_hlbird: kitSelfFear,                                   // “萨科塔之翼” · below half HP: 5 s self-fear, flutters in its tile ×1.5
  enemy_10084_hlegle: kitSteal,                                      // “萨科塔之眼” · fear below half; steals 1 ammo instead of hitting
  enemy_10085_hllevi_2: kitRoar,                                     // “萨科塔昂首” · fear below half; 祈祷邀约 global ASPD −30
  enemy_1407_hummbd: kitExposeOnDeath,                               // 远眺 · death: exposes operators around (damage taken ×1.2)
  enemy_9009_acfort: kitBlackCloud,                                  // 假想敌：黑云 · devours ≤ 3 normal flyers for ammo, fires it all at random allies
  enemy_1112_emppnt: kitShell,                                       // 帝国炮火先兆者 · attacks are shells landing 3 s later (r 1.2)
  enemy_1112_emppnt_2: kitShell,                                     // 帝国炮火中枢先兆者 · same
  enemy_1321_wdarft: (ab) => [skill(ab.sk.BornBugs, (b, e) => spawnChildren(b, e, 'enemy_1269_nhfly', BUGS_PER_CAST))], // 枯朽萃聚使徒 · spawns 枯朽之种
  enemy_1269_nhfly: () => [{                                         // 枯朽之种 · becomes a projectile when self-destructing
    spawn(b, e) { e.profile.noAttack = true; },
    tick(b, e, a) {
      if (a.shot || unbalancedNow(b, e)) return;
      const l = targetsNear(b, e, e.base.rangeRadius || 1).sort((p, q) => hypot(p.x - e.x, p.y - e.y) - hypot(q.x - e.x, q.y - e.y));
      if (!l.length) return;
      const target = l[0], atk = e.s.atk;
      // PRTS 枯朽之种: attack radius 2 and projectile speed 10. Keep its model as the projectile's visual while
      // removing it from operator target selection. [ASSUMED] A lost target leaves the shot to burst at its last point.
      b.addBuff(e, { key: 'ab:dive', flags: { noMove: true, untargetable: true, invulnerable: true, unblockable: true } });
      a.shot = b.addProjectile({ from: e, target, speed: SEED_PROJECTILE_SPEED, source: e, hitDead: true,
        onHit: ({ target: hit, x, y }) => {
          e.x = x; e.y = y;
          if (hit) hurt(b, e, hit, atk, 'phys');
          b.fx('explode', { x, y, r: 0.5, kind: 'seed' });
          b.kill(e, null);
        },
      });
      b.on('tick', () => {
        if (!e.alive) return;
        if (!b.projectiles.list.includes(a.shot)) { b.kill(e, null); return; } // e.g. 逻各斯 S3 cleared the shot
        e.x = a.shot.x; e.y = a.shot.y;
      }, { owner: e });
    },
  }],
});
