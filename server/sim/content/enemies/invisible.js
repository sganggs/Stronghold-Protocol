// server/sim/content/enemies/invisible.js — INVISIBLE 隐匿 kits (stealthy enemies) and their part of KITS (split from
// content/enemies.js).

import { canTargetAlly, enemyStealthed } from '../../targeting.js';
import { ALLY_COLLIDER_RADIUS } from '../../constants.js';
import { T, elem, hurt, targetsNear, byPriority, auraBuff, castSlot, attackSkillOf } from './helpers.js';
import { stealth, onHitStatus, skill, kitStealth } from './archetypes.js';
import { hypot } from '../../detmath.js';

// ---------------------------------------------------------------------------------------------------------------
// constants (numbers that exist nowhere in the data)

/** 假想敌：骨刺's targets at once while its 隐匿 holds: 3 — the level's own description 「隐匿；隐匿状态下同时攻击3个目标。」
 *  (enemy_database; the handbook line says 「数个目标」) and PRTS 天赋 「隐匿期间可同时攻击3个目标」 (GitHub #365). */
const ACBUNN_TARGETS = 3;

/** 重弩突袭者 直击 reach along a row/column [ASSUMED]; the skill's length and its charge before the bolt (PRTS 直击 "蓄力1.4s后
 *  向目标方向发射1支弩箭…※技能持续2.5s"). */
const CROSS_REACH = 6, CROSS_SKILL = 2.5, CROSS_CHARGE = 1.4;

// ---------------------------------------------------------------------------------------------------------------
// kits

function kitCrossbow(ab) {
  const s = ab.sk.CrossAttack;
  const aligned = (b, e) => b.allies().filter((u) => canTargetAlly(e, u, true) && (Math.abs(u.y - e.y) < 0.5 || Math.abs(u.x - e.x) < 0.5) && hypot(u.x - e.x, u.y - e.y) <= CROSS_REACH);
  const nearest = (b, e, l) => l.sort((p, q) => hypot(p.x - e.x, p.y - e.y) - hypot(q.x - e.x, q.y - e.y))[0];
  // PRTS 重弩突袭者: 天赋 "隐匿（被阻挡，主动攻击期间均可解除）"; 直击 "蓄力1.4s后向目标方向发射1支弩箭，对击中的首个目标造成攻击力100%
  // 的法术伤害与5s晕眩 ※技能持续2.5s": revealed for the whole skill, the bolt leaves CROSS_CHARGE s in — at the nearest unit still
  // in line in the aimed direction; it stands meanwhile [ASSUMED], and a stun / silence or its death before the release
  // cancels the shot [ASSUMED]. The blackboard's duration (2) is not the skill's length PRTS gives. Until 0.1.3: revealed
  // 2 s, the bolt at once.
  return [stealth(), skill(s, (b, e) => {
    const t = nearest(b, e, aligned(b, e));
    if (!t) return;
    const bb = s.bb;
    const dx = Math.sign(Math.round(t.x - e.x)), dy = Math.sign(Math.round(t.y - e.y));
    b.addBuff(e, { key: 'ab:revealed', duration: CROSS_SKILL, flags: { reveal: true } });
    b.addBuff(e, { key: 'ab:aim', duration: CROSS_SKILL, flags: { noMove: true, disarm: true } });
    b.after(CROSS_CHARGE, () => {
      if (!e.alive || e.hidden || e.s.flags.stun || e.s.flags.silence) return;
      const tt = nearest(b, e, aligned(b, e).filter((u) => Math.sign(Math.round(u.x - e.x)) === dx && Math.sign(Math.round(u.y - e.y)) === dy));
      if (!tt) return;
      b.addProjectile({ from: e, target: tt, speed: 12, visual: 'enemy', source: e, onHit: (c) => {
        if (!c.target || !c.target.alive) return;
        hurt(b, e, c.target, e.s.atk * (bb.atk_scale ?? 1), 'arts');
        if (bb.stun > 0 && c.target.alive) b.applyStatus(c.target, 'stun', { duration: bb.stun, source: e });
      } });
    }, { owner: e });
  }, { sil: true, cond: (b, e) => aligned(b, e).length > 0, turn: attackSkillOf('enemy_1404_msnip', 'CrossAttack') })];   // the attack's turn (DESIGN §35.52)
}

/**
 * 山海众头目 / 山海众秘使 (PRTS 天赋 "隐匿，该隐匿每次生效后自身获得强击标记（不可叠加）"; 技能 破隐一击 "仅持有强击标记且被阻挡时可
 * 触发：对阻挡目标造成攻击力200%的物理普通伤害，技能开始时消耗强击标记"): the mark comes with its 隐匿 — at the spawn and every
 * time it hides again (3 s after a block, Battle._stealthSwitch; or once a 反隐 ends) — and its next attack (a melee
 * one: blocked) spends it at InvisibleCombat.atk_scale. A new block inside the 3 s gives no new mark (until 0.1.2 every
 * block did).
 */
function kitShadowKiller(ab) {
  const scale = (ab.sk.InvisibleCombat && ab.sk.InvisibleCombat.bb.atk_scale) || 1;
  return [stealth(), {
    spawn(b, e, a) { a.power = true; a.on = true; },
    tick(b, e, a) { const on = enemyStealthed(e); if (on && !a.on) a.power = true; a.on = on; },
    // the marked attack is 破隐一击: its skill slot for the client (castSlot, display only)
    before(c, b, e, a) { if (a.power) castSlot(b, e, ab.sk.InvisibleCombat); },
    hitOut(c, b, e, a) { if (a.power && c.dmg.isAttack) c.dmg.amount *= scale; },
    attack(c, b, e, a) { a.power = false; },
  }];
}

function kitJazz(ab, e) {
  const s = ab.sk.fire;
  const r = (e.def.raw && e.def.raw.stats && e.def.raw.stats.rawRangeRadius) || 2.5;
  const revealed = (u) => !enemyStealthed(u);                  // blocked, 反隐 (its 隐匿 returns 0 s after a block)
  return [stealth(), {
    // PRTS 天赋 "隐匿期间不进行普通攻击；未受隐匿影响时进入反击模式：仅进行阻挡攻击，造成100%物理伤害": its normal attack only ever
    // hits its blocker (`melee`), so a revealed (反隐) unblocked one neither shoots nor stands for its attack clip (until
    // 0.1.3 it shot everyone within its 2.5 range and stood still while it had a target — ai.js attackStand)
    spawn(b, e2) { e2.profile.noAttack = true; e2.profile.melee = true; },
    tick(b, e2) { e2.profile.noAttack = !revealed(e2); },      // 平时不攻击，失去隐匿时反击
  }, s ? {
    // 狂欢式演奏 (PRTS 节日爵士乐手, 反击模式): "仅攻击范围内存在我方单位时可触发：锁定目标持续施法，最多持续10.6s，每0.5s对目标
    // 造成攻击力20%的法术伤害和攻击力10%的灼燃损伤 ※施法期间受到沉默影响后，立即结束技能" — ONE locked target (its own
    // priority: the blocker first), floor(10.6 / 0.5) = 21 ticks at 0.5 … 10.5 s. The channel holds the walking (ai.js reads
    // the `ab:channel` buff, not `noMove`: a route WAIT / a portal, the leak and a 恐惧 keep going, as under an attack clip) and
    // makes no normal attacks meanwhile; it ends when the buff runs out or on 沉默 / 眩晕 (冻结, 沉睡 and 浮空 set `stun` too,
    // units.js) / the locked target's fall. Its cooldown restarts at the END of the channel: `fire`'s own 10 s is shorter than
    // the 10.5 s channel, so counted from the cast the next one would fire the moment this one ends and it would never walk
    // again [ASSUMED "持续施法", as 死亡之眼; PRTS 「同一技能的冷却时间于该技能结束时开始计时」].
    // the attack's turn (RangedAttack: DESIGN §35.52) — while revealed, its trigger the targets in its radius (`own`)
    sil: true, cd: s.cd, icd: s.icd, sk: s, ...attackSkillOf('enemy_10034_cnvsax', 'fire'),
    cond: (b, e2) => revealed(e2) && !(e2.mem.jazzChannel && !e2.mem.jazzChannel.cancelled) && targetsNear(b, e2, r).length > 0,
    fire(b, e2, a) {
      const dur = s.bb['enemy_cnvsax[cd].duration'] ?? 0, iv = s.bb.hit_interval ?? 0.5;
      const t = byPriority(e2, targetsNear(b, e2, r))[0];
      if (!t || !(dur > 0) || !(iv > 0)) return;
      const n = Math.max(1, Math.floor(dur / iv + 1e-9));
      // 持续施法 stands still — but through the channel buff, not `noMove` (see above)
      const buff = b.addBuff(e2, { key: 'ab:channel', duration: dur, flags: { disarm: true } });
      let k = 0;
      const end = () => {
        h.cancel(); e2.mem.jazzChannel = null; if (buff) b.removeBuff(e2, buff);
        if (a && a.cd != null) a.left = Math.max(a.left, a.cd);   // the cooldown runs from the channel's end
      };
      const h = b.every(iv, () => {
        if (!e2.alive || e2.s.flags.silence || e2.s.flags.stun || !t.alive || !t.deployed) { end(); return; }
        b.fx('beam', { x: e2.x, y: e2.y, from: e2.id, to: t.id, kind: 'jazzFire' });
        hurt(b, e2, t, e2.s.atk * (s.bb.atk_scale ?? 0), 'arts');
        elem(b, e2, t, 'burn', e2.s.atk * (s.bb.ep_damage_ratio ?? 0));
        if (++k >= n) end();
      }, { owner: e2 });
      e2.mem.jazzChannel = h;
    },
  } : null];
}

function kitShadowBlade(ab) {
  const bat = ab.t['traitAbility.base_attack_time'] ?? 0;
  return [stealth(), {
    iv: 0.5,
    tick(b, e) {
      const partner = b.enemiesInRadius(e.x, e.y, 3).find((o) => /enemy_1174_duholy/.test(o.defId));
      const r = partner && partner.mem.ab ? (T(partner.mem.ab, 'traitAbility.range_radius') ?? 1.1) : 1.1;
      if (partner && hypot(partner.x - e.x, partner.y - e.y) <= r + 1e-9 && e.base.bat > 0) auraBuff(b, e, 'ab:shadowSync', 0.5, { batPct: bat / e.base.bat });
    },
  }];
}

/**
 * 假想敌：骨刺 — PRTS 天赋 (级别0): 「自身普通攻击索敌不受阻挡影响」 — profile `blockFree` (as 自制投石机): blocked, and so out of its
 * 隐匿, it still picks by priority among the allies in reach, not its blocker first, and a 隐匿 / 迷彩 blocker is no target
 * (targeting.js canTargetAlly); 「不会攻击飞行单位」 — profile `canTarget`; 「隐匿（解除阻挡0秒后恢复）」 — stealth(); 「隐匿期间
 * 可同时攻击3个目标」: while its 隐匿 holds, the first ACBUNN_TARGETS by priority among the allies its normal attack could hit
 * (ai.js attackTargets: the same reach — rangeRadius + the ally collider — and the same rules); one otherwise. Until
 * 0.2.2 (PR #365 by @Sukvii, the PRTS lines checked for this port): blocker first, flyers hit, the 3 picked within the bare
 * rangeRadius.
 */
function kitBoneSpike() {
  return [stealth(), {
    spawn(b, e) {
      e.profile.blockFree = true;
      e.profile.canTarget = (u) => !u.isFlying;
    },
    before(c, b, e) {
      if (!enemyStealthed(e)) return;
      const l = byPriority(e, targetsNear(b, e, e.base.rangeRadius + ALLY_COLLIDER_RADIUS).filter(e.profile.canTarget));
      if (l.length) c.targets = l.slice(0, ACBUNN_TARGETS);
    },
  }];
}

// ---------------------------------------------------------------------------------------------------------------
// this family's part of KITS (content/enemies.js spreads the parts in this order)

export const INVISIBLE_KITS = Object.freeze({
  // --- INVISIBLE 隐匿
  enemy_1009_lurker: kitStealth,                                     // 潜伏者 · stealth
  enemy_1019_jshoot: kitStealth,                                     // 隐形弩手 · stealth
  enemy_1019_jshoot_2: kitStealth,                                   // 隐形弩手组长 · stealth
  enemy_1023_jmage: kitStealth,                                      // 隐形术师 · stealth
  enemy_1283_sgkill: kitStealth,                                     // 家族灭迹人 · stealth (清算时刻 n/a)
  enemy_1283_sgkill_2: kitStealth,                                   // 家族暗影灭迹人 · stealth
  enemy_1299_ymkilr: kitShadowKiller,                                // 山海众头目 · stealth; its 隐匿 turning on brings the mark: next attack ×InvisibleCombat.atk_scale (§22.8)
  enemy_1299_ymkilr_2: kitShadowKiller,                              // 山海众秘使 · same
  enemy_1389_winbab_2: kitStealth,                                   // 访问团强攻冠军 · stealth (供暖器 priority n/a)
  enemy_1404_msnip: kitCrossbow,                                     // 重弩突袭者 · stealth + 直击 (row/column bolt: arts + stun, reveals itself)
  enemy_10031_cnvsld: kitStealth,                                    // 业余竞演者 · stealth
  enemy_10034_cnvsax: kitJazz,                                       // 节日爵士乐手 · stealth; revealed: attacks its blocker only; channel on one target (arts + burn)
  enemy_10042_prtrop: kitStealth,                                    // 架桥船工 · stealth (bridges n/a)
  enemy_10042_prtrop_2: kitStealth,                                  // 扶桥老手 · stealth
  enemy_9008_acbunn: kitBoneSpike,                                   // 假想敌：骨刺 · stealth; hits 3 targets while stealthed
  enemy_1175_dushdo_2: kitShadowBlade,                               // 深池伙友影刃精英 · stealth; BAT −1.3 s next to 卫队精英
  enemy_2034_sythef: (ab) => [stealth(), onHitStatus('stun', T(ab, 'Combat.attack@stun'))],   // 流泪小子 · stealth, attacks stun
  enemy_2034_sythef_2: (ab) => [stealth(), onHitStatus('stun', T(ab, 'Combat.attack@stun'))], // 流泪小子 · same
});
