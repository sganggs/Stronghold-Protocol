// server/sim/content/enemies/times.js — TIMES 频次 kits (hit-count units and the enemies that create them) and their part
// of KITS (split from content/enemies.js).

import { TEA_SPLASH_RADIUS, grantHitShield, T, hurt, areaAllies, spawnChildren } from './helpers.js';
import { splashAttack, husk, skill, kitTimes, kitDeathSpawn, kitEmber } from './archetypes.js';

// ---------------------------------------------------------------------------------------------------------------
// constants (numbers that exist nowhere in the data)

/** 假想敌：再生 shield aura radius (PRTS 假想敌：再生 天赋 "进入此形态时，使半径1.8范围内的其他敌方单位（无视其可选性）获得5层…护盾"). */
const ACPUPP_AURA_RADIUS = 1.8;

/** 烹泉 / 沏虹 死亡爆炸 radius (PRTS 天赋 "死亡爆炸（爆炸半径1.25，造成攻击力100%法术溅射伤害并施加15s【烹泉减益】…）"; until
 *  0.1.3 the attack range, 2). */
const TEA_BOOM_RADIUS = 1.25;

// ---------------------------------------------------------------------------------------------------------------
// kits

/**
 * 沉沙 / 新硎 断刃 (PRTS 天赋): 「攻击力+80%，持有4个【断刃】 / 每次成功攻击后消耗1个【断刃】，攻击结束时若已耗尽【断刃】，则立刻
 * 切换为无断刃模式并失去攻击力加成」 (popup: the switch 「清空当次攻击间隔」, so it attacks again at once) / 「因坠落以外的原因死亡后…
 * 召唤自身剩余【断刃】数量的铜矛头 / 铁矛头（至少召唤1个）」. ONE layer of Atkup.atk / AtkUp.atk (沉沙 0.7 — its PRTS page repeats
 * 新硎's 80 %, the blackboard says 0.7 — / 新硎 0.8) from the spawn while it holds a blade (DeadSpawn.cnt = 4), removed when
 * an attack spends the last one; that attack's cooldown is then cleared (ai.js sets it after the 'attack' hook, so this
 * tick's 'tick' clears it and the next attack comes on the next tick). Unspent blades (cnt + cnt_add × spent, ≥ 1)
 * become 矛头 when it is killed (a leak is no death; the mode has no 坠落), at once and side by side (spawnChildren — the
 * 0.7 s random delay and the 1.0 square of the text are not modelled). Until 0.2.0 each attack stacked one more layer
 * and none was ever removed (GitHub #107: 新硎 1350 → 3510 ATK after two hits).
 */
function kitBlades(ab) {
  const cnt = T(ab, 'DeadSpawn.cnt') ?? 0, add = T(ab, 'DeadSpawn.cnt_add') ?? 0, atk = T(ab, 'Atkup.atk', 'AtkUp.atk') ?? 0;
  const key = ab.tS['DeadSpawn.enemy_key'];
  return [{
    spawn(b, e, a) {
      a.used = 0;
      if (cnt > 0 && atk) b.addBuff(e, { key: 'ab:blade', mods: { atkPct: atk }, persist: true, visible: true });
    },
    attack(c, b, e, a) {
      if (a.used >= cnt) return;
      if (++a.used < cnt) return;
      b.removeBuff(e, 'ab:blade'); // 无断刃模式
      a.clearCd = true;
    },
    tick(b, e, a) { if (a.clearCd) { a.clearCd = false; e.atkCd = 0; } },
    death(c, b, e, a) { if (c.reason === 'killed' && key) spawnChildren(b, e, key, Math.max(1, cnt + add * a.used)); },
  }];
}

function kitInvisShield(ab, e) {
  const s = ab.sk.InvisibleShield;
  const r = (e.def.raw && e.def.raw.stats && e.def.raw.stats.rawRangeRadius) || 2;
  return [...kitDeathSpawn()(ab), skill(s, (b, e2) => {
    // 辉光照耀 "使【范围隐匿】生效3s" (PRTS 清明 / 堂皇) = the talent's InvisibleShield.duration (3 for both); 清明's skill
    // blackboard says 5 — until 0.1.3 that 5 was used
    const dur = T(ab, 'InvisibleShield.duration') ?? s.bb.duration ?? 0;
    b.fx('telegraph', { x: e2.x, y: e2.y, r, kind: 'invisShield', id: e2.id });
    // "获得隐匿（解除阻挡0秒后恢复）" (PRTS 清明 / 堂皇 天赋): the veil's 隐匿 is back as soon as a block ends
    for (const o of b.enemiesInRadius(e2.x, e2.y, r)) if (o !== e2 && dur > 0) b.addBuff(o, { key: 'ab:veiled', duration: dur, flags: { stealth: true }, visible: true, data: { stealthRestore: 0 } });
  })];
}

/** 假想敌：再生 (PRTS 假想敌：再生 天赋) · knock-out ⇒ 1 s 重生 ⇒ 再生状态: a 傀儡 of prop_max_hp (15) hits that is 不可阻挡 for
 *  `interval` (15) s and walks on ("1s内不移动": only the 重生 stands; its model has a 傀儡 walk cycle, B_Move), back with full
 *  HP if still standing; entering it gives the other enemies within 1.8 (targetable or not) max_damage_block_cnt (5)
 *  hit shields. */
function kitRegen(ab) {
  const hits = T(ab, 'Revive[Trigger].prop_max_hp'), delay = T(ab, 'Revive[Trigger].interval'), block = T(ab, 'Aura.max_damage_block_cnt') ?? 0;
  return [husk({
    hits, delay, stealthy: false, unblock: true, key: 'ab:regen',
    onHusk(b, e) {
      // "进入此形态时，使半径1.8范围内的其他敌方单位（无视其可选性）获得5层吸收物理/法术伤害的护盾"
      b.fx('telegraph', { x: e.x, y: e.y, r: ACPUPP_AURA_RADIUS, kind: 'regenShield', id: e.id });
      for (const o of b.enemiesInRadius(e.x, e.y, ACPUPP_AURA_RADIUS)) if (o !== e && block > 0) grantHitShield(b, o, block);
    },
  })];
}

/**
 * 烹泉 / 沏虹 (PRTS 天赋): every normal attack hits its target and every unit within TEA_SPLASH_RADIUS of it ("法术普通伤害
 * （无视迷彩，不可对空）" — splashAttack, blocked or not); 死亡爆炸 "（爆炸半径1.25，造成攻击力100%法术溅射伤害并施加15s【烹泉减益】，
 * 无视迷彩，不可对空）", 【烹泉减益】 "攻击速度-40，且固定每3秒额外-0（可被抵抗，可叠加，每层持续时间和效果独立计算）" — DeadBoom.
 * attack_speed / duration; one layer per blast, each its own buff. Until 0.1.3: no attack splash; the blast took the attack
 * radius (2) and left a 15 s steam zone re-applying the ASPD cut to whoever stood in it [ASSUMED]. The attack splash, a 法术普通
 * 伤害, can be dodged like the attack itself; the blast (法术溅射伤害) cannot.
 */
function kitTeapot(ab) {
  return kitDeathSpawn([splashAttack({ unblocked: false, radius: TEA_SPLASH_RADIUS, noAir: true, dodge: true, fxKind: 'artsSplash' }), {
    sil: true,
    death(c, b, e) {
      if (c.reason !== 'killed') return;
      const aspd = T(ab, 'DeadBoom.attack_speed') ?? 0, dur = T(ab, 'DeadBoom.duration') ?? 0;
      const r = TEA_BOOM_RADIUS, atk = e.s.atk, x = e.x, y = e.y;
      // an area selection (no 无视无法选择 note): an airborne 起飞 ally and an unblocking 隐匿 one are skipped, flyers too
      b.fx('explode', { x, y, r, kind: 'teaBoom', id: e.id });
      for (const u of areaAllies(b, e, x, y, r)) {
        if (u.isFlying) continue;
        hurt(b, null, u, atk, 'arts', { tags: ['teaBoom'] });
        if (u.alive && dur > 0 && aspd) b.addBuff(u, { key: `ab:teaBoom:${e.id}`, duration: dur, refresh: 'replace', mods: { aspd }, visible: true });
      }
    },
  }])(ab);
}

// ---------------------------------------------------------------------------------------------------------------
// this family's part of KITS (content/enemies.js spreads the parts in this order)

export const TIMES_KITS = Object.freeze({
  // --- TIMES 频次 (hit-count units + their creators)
  enemy_1196_msfyin: kitTimes(),                                     // 木制瑞印 · 2 hits, unblockable
  enemy_1196_msfyin_2: kitTimes(),                                   // 红木瑞印 · 3 hits
  enemy_1198_msfshu: kitTimes(),                                     // 小说卷轴 · 3 hits
  enemy_1198_msfshu_2: kitTimes(),                                   // 诗画卷轴 · 4 hits
  enemy_1200_msfjin: kitTimes(),                                     // 青铜镜 · 30 hits
  enemy_1200_msfjin_2: kitTimes(),                                   // 黄铜镜 · 35 hits
  enemy_1202_msfzhi: kitTimes(),                                     // 木制镇纸 · 3 hits
  enemy_1202_msfzhi_2: kitTimes(),                                   // 红木镇纸 · 4 hits
  enemy_1204_msfhu: kitTimes(true),                                  // 青瓷茶器 · 4 arts/true hits
  enemy_1204_msfhu_2: kitTimes(true),                                // 彩瓷茶器 · 6 arts/true hits
  enemy_1208_msfji: kitTimes(),                                      // 铜矛头 · 25 hits
  enemy_1208_msfji_2: kitTimes(),                                    // 铁矛头 · 30 hits
  enemy_1210_msfden: kitTimes(),                                     // 铜灯盘 · 35 hits
  enemy_1210_msfden_2: kitTimes(),                                   // 铁灯盘 · 45 hits
  enemy_1195_sfyin: kitDeathSpawn(),                                 // 磨砻 · death: 2 木制瑞印
  enemy_1195_sfyin_2: kitDeathSpawn(),                               // 明鉴 · death: 2 红木瑞印
  enemy_1197_sfshu: kitDeathSpawn(),                                 // 俗心 · death: 3 小说卷轴
  enemy_1197_sfshu_2: kitDeathSpawn(),                               // 雅气 · death: 3 诗画卷轴
  enemy_1199_sfjin: kitDeathSpawn(),                                 // 身观 · death: 1 青铜镜 (taunt from data)
  enemy_1207_sfji: kitBlades,                                        // 沉沙 · +ATK while it holds a blade (4, one per attack); death: unspent blades → 铜矛头 (≥1)
  enemy_1207_sfji_2: kitBlades,                                      // 新硎 · same (铁矛头)
  enemy_1209_sfden: kitInvisShield,                                  // 清明 · veils nearby enemies (stealth) every 15 s; death: 铜灯盘
  enemy_1209_sfden_2: kitInvisShield,                                // 堂皇 · same (铁灯盘)
  enemy_1203_sfhu: kitTeapot,                                        // 烹泉 · death: 4 青瓷茶器 + ASPD-down arts blast zone
  enemy_1203_sfhu_2: kitTeapot,                                      // 沏虹 · death: 4 彩瓷茶器 + blast zone
  enemy_1288_duskls: kitEmber,                                       // 深池逐火战士 · every KO: 1 s 重生 ⇒ walking 隐匿 5-hit ember (block it to hit it), back after 10 s
  enemy_1288_duskls_2: kitEmber,                                     // 深池逐火精锐战士 · same
  enemy_1292_duskld: kitEmber,                                       // 深池逐火护卫 · 10-hit 火灰
  enemy_9010_acpupp: kitRegen,                                       // 假想敌：再生 · every KO: 1 s 重生 ⇒ walking unblockable 15-hit puppet (15 s) + 5-hit shields within 1.8
});
