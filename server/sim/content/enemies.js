// server/sim/content/enemies.js — enemy special types (特训敌人) and individual enemy abilities (DESIGN §7).
//
// Battle side: install(battle) registers ONE set of global dispatch hooks per battle (ensureInstalled — idempotent,
// bosses.js calls it too) and attaches an ability list to every spawned enemy whose key has a kit in KITS.
// Every number comes from the enemy's talent / skill blackboard (data/enemies.json, merged with the wave template's
// `overrides[key].talents/skills` — the engine only applies `overrides.stats`). Numbers that exist nowhere in the
// data are named constants below, marked [ASSUMED] or sourced from the official term table (gamedata_const
// termDescriptionDict) / PRTS.
//
// Runtime model: `enemy.mem.ab = { key, t (talent bb), tS (talent bbStr), sk {prefabKey → {cd, icd, sp, bb, bs}},
//   list [abilities], times, hitShield, atkType, immune, … }`. An ability is a plain object with optional methods
//   spawn(b,e,a,ab) · dealt(c,…) ('damaged' by one of e's ATTACKS on an ally, non-element) · taken(c,…) ('damaged' on e,
//   non-element) · hitIn(c,…) ('hit' on e, late: after every other hit handler) · hitOut(c,…) ('hit' from e, early) ·
//   (`c.source` is null for 无来源 damage — element bursts; target-side reactions that must still fire, e.g. damage
//   sharing, read `c.source || c.credit`, `credit` naming the unit that filled the gauge) ·
//   before(c,…) (beforeAttack of e) · attack(c,…) · blocked(c,…) · killed(c,…) (return true = revived; the kill is then
//   hidden from later 'kill' handlers) · death(c,…) · status(c,…) (statusApplied on e) · burst(c,…) (elementBurst on e)
//   · tick(b,e,a,dt) every `iv` s (every tick when iv is 0) · skill: `cd`/`left`(=icd)/`cond`/`fire` (cooldown runs
//   continuously; fires when ready, the enemy can act and `cond` holds). `sil: true` = the ability's handbook line
//   is flagged SILENCE (沉默 disables it: exactly the data's `format: "SILENCE"` lines); stun / freeze / sleep block
//   skills. Enemy SP skills ("数次攻击后…"): SP +1 per attack, the (spCost+1)-th attack is the skill attack (official
//   粉碎攻坚手 text: spCost 2 = "攻击2次后，下一次攻击").
// Shared mechanics: reborn() — "首次被击倒后重生 / 第二形态" (the first KO is hidden from kill credit and bounty; a
//   rebirth of Reborn.duration s, untargetable and inert, then the new form); artsBarrier() — "吸收法术伤害的屏障"
//   (absorbs arts after RES); frontGuard() — "来自正面的伤害降低" (facing = walking direction or the bigger crowd);
//   unbalanced() — 失衡 detection (displacement beyond the enemy's own speed; engine displace() has no hook);
//   husk() — "被击倒时暂时变为…，一段时间后重生" (Revive[Trigger]: every knock-out of the first form ⇒ 1 s 重生 ⇒ a walking
//   hit-count husk — 隐匿 逐火 embers, the unblockable 再生 puppet — until the real death or its revival); every 重生
//   (reborn / husk / statue) clears the enemy's statuses and the buffs allies gave it (rebirthCleanse, PRTS 特殊机制
//   §重生 "清空自身身上除白名单外所有Buff"); a data-unarmed
//   enemy armed by a form (转译基底) sets `e.profile` noAttack / melee / dmgType / maxTargets and attacks through the
//   engine (ai.js enemyAttack); float() — 近地悬浮 (an air unit that
//   keeps its ground path, Unit.isFlying; kitSyufo / kitParrot lose it when stunned). `e.profile.canTarget(ally)` = the
//   enemy's own target rule (只攻击地面单位 …), applied by the engine to the candidates before its priority order; a
//   special priority (优先攻击防御力最高的… / 生命上限最高的…) sorts by its key, ties by taunt then latest deployed
//   (targeting.js aggroCmp — PRTS 索敌: 特殊优先级 → 仇恨值). Area effects — splash, blasts, area skills and statuses,
//   pulses, the zones an enemy leaves, chain / bounce jumps, 周围四格 additions, whole-column / whole-field skills —
//   select with areaAllies / areaAlliesInTiles / fieldAllies (targeting.js areaSelectable; PRTS 作战机制 §AOE伤害判定
//   "AOE的判定是对攻击范围内的每个可以被选中的敌人进行判定"): no 隐匿 ally, the one blocking the enemy included (GitHub #97), no untargetable
//   or sleeping one, no airborne 起飞 one for a ground enemy; 迷彩 is not checked (splash-type, 中点判定 / 格子判定 and
//   aura effects ignore it — ba.camou "无法躲避溅射类攻击", PRTS 异常效果 迷彩; the sites with no such reading are
//   [ASSUMED] in DESIGN §22.12). Buff auras select with auraAllies (auraSelectable: 隐匿 kept out, 起飞 not). A locked
//   target (an attack's, a channel's, a C4's) is hit as a direct pick, only the others around it as an area
//   (targetAndArea). Until 0.1.2 they took every ally in the area (GitHub issue #32 item 6; DESIGN §22.12). An airborne ally
//   (起飞, flag `liftoff`) is no target of a ground enemy (对地规避, targeting.js evadesGround): targetsNear / allTargets
//   skip it through canTargetAlly, the area selectors through areaSelectable, and the engine refuses a ground enemy's
//   damage and statuses on it. Not selections, so they still reach it (`ignoreSelect`): abilities PRTS marks "无视无法
//   选择 / 无视(目标)可选性" (【污染秽蚀】, 【盲信之誓】, 萨卡兹悖谬暴虐兵长's 暴击 splash, 假想敌：淤困's burst spread),
//   direct picks of the attacker (碎铳之簧's counter — PRTS 异常效果 "'直接选中'的能力…不受这些仅在选择时生效的异常效果
//   制约"), the blasts of flying units credited to a ground leader (刺胄之弹, 斩胄之剑 / 破胄之锤) and the ticks of a debuff
//   already on it (出血, 沙狱, “庞贝”'s burning, 淤困, 【自然涌动】 — a tick selects nobody). Ground enemies' buff auras
//   (深池伙友卫队, 扎罗's 远古威慑) and the sourceless 毒雾 of 假想敌：蚀裂 still reach it [ASSUMED, §21.22] while keeping
//   a 隐匿 ally out; 寒霜's aura (PRTS: its debuff "无视隐匿状态起作用") and map / tile effects (“墓碑” — PRTS: a map effect —,
//   【国度】, the chimera's 源石污染区 [ASSUMED]) reach every ally.
//
// Special types (factions.json):
//   FLY        — engine (FLY motion, ranged-only targeting). Flyer kits below (御4, 护障, 寒霜, 萨科塔之翼/眼, 黑云 …).
//   TIMES 频次 — "需要N次伤害击倒": maxHp := N hits; engine buff flag hitCount — every damage instance (any type, element
//                bursts included) removes exactly 1 on its own DamageInfo (茶器 hitCountArts: phys removes 0); HP loss
//                (loseHp) bypasses the rule. The faction's enemies
//                create those units (death spawns, embers, blades, 再生).
//   ELEMENT    — element damage on hit = ATK × ep_damage_ratio into the ally's gauge. 侵蚀 (erosion) is an engine
//                gauge whose burst is the official one (termDescription ba.dt.erosion: "永久降低100点防御力并受到800点物理伤害").
//   DOT        — damage zones (污染秽蚀: true damage, one tick per second however many cover a unit, "可对空，无视无法选择"
//                — `ignoreSelect`, 起飞 / 隐匿 allies included; 燃烧区域: the enemy's area selection — PRTS 集团军重型火炮
//                "碰撞不受迷彩制约，不可对空", no 无视无法选择 —, so no 起飞 or 隐匿 ally; 假想敌：蚀裂's sourceless
//                毒雾 skips a 隐匿 ally, not a 起飞 one), bleeding (removed by healing), pulsing damage around an enemy
//                (area selection).
//   INVISIBLE  — permanent `stealth` flag (engine: untargetable unless blocked or revealed). An operator's radius area
//                damage skips an unblocked one too (Battle.foesInRadius: profession splash around a struck target,
//                skill circles — PRTS 作战机制 §AOE伤害判定 "对攻击范围内的每个可以被选中的敌人进行判定"; until 0.1.1 it
//                still hit it); tile selectors (enemiesInKeys) always skipped it. After a block it hides again only
//                STEALTH_RESTORE (3) s later — or after the "（解除阻挡N秒后恢复）" of its PRTS page (STEALTH_RESTORE_BY_KEY,
//                清明's veil 0 s) — Battle._stealthSwitch / targeting.js enemyStealthed (until 0.1.2: at once).
//                The mirror rule for an ally's 隐匿 — enemy area effects skip it even when it blocks the enemy (0.1.3, GitHub #97) — is areaAllies.
//   REFLECTION — 折射 (ba.refraction "生效时，法术抗性+70"): RES +refracting.magic_resistance while NOT silenced
//                (the ability line is SILENCE-flagged: silencing turns it off); 镜膜 also gets max HP +100 % while on.
//   SPECIAL    — mostly stats; prisoners, 穿刺手, 暴虐兵长, 镜卫, 动力装甲 … below.
// Every enemy key of data/enemies.json is either in KITS (this file), BOSS_KEYS (bosses.js) or STATS_ONLY (with the
// reason) — pinned by test/content/enemies_bosses.test.js. Bounty (悬赏) leaders are included: multi-form ones
// (巨大的丑东西, 杰斯顿, 自在, 锏, 扎罗) get their second form; event-only mechanics (芦苇, 摄影区, 狂欢时刻, 悬索桥, 唤血祭坛,
// 封冻/供暖器, 赘生甲壳, 锁链, 血债账款, 晦明) have no counterpart in this mode and are listed where they apply.
//
// fx kinds emitted (battle.fx(kind, {x, y, …})): 'explode' {r, kind} · 'zone' {r, dur, kind} · 'telegraph' {r, dur,
//   kind, tiles?, id?, form?} (delayed strikes, charges, 'reborn' with form 'reborn') · 'beam' {from, to, kind} ·
//   'summon' {id, key} · 'ember' {id, hits, dur, form: 'husk'} · 'revive' {id, kind?, form: 'form2' | 'revived' | 'fly'}
//   · 'stone' {id, dur, form: 'stone'} · 'blink' {id, fx, fy} · 'charge' {id, tx, ty} · 'expose' {id} · 'shieldBreak'
//   {id} · 'liberate' {id} · 'phase' {id, kind, dur?, form?} (form changes — 掠海漂移体 'crawl', 暴鸰 'bombed',
//   translator_* — and barrier / charge states) · 'lpLoss' {value, reason} · 'steal' · 'ignite'. Forms go through
//   setForm(): the unit keeps it (`e.form`, UnitInfo `form`) and the fx's `form` is the model's clip set from then on
//   (render/app.js → UnitView.setForm, units.js FORMS); the client keeps every fx with a `form` through catch-ups and
//   hidden tabs (shared/protocol.js fxForm).
// Custom hook: 'lpLoss' {amount, reason, source} — leader "扣除目标生命" effects; also summed into result.lpLoss.

import { TICK, MOVE_SCALE, ELEMENT, ATTACK_PAUSE, PROJECTILE_SPEEDS, ALLY_COLLIDER_RADIUS, COLS } from '../constants.js';
import { canTargetAlly, sortAllyTargets, aggroCmp, enemyStealthed, areaSelectable, auraSelectable } from '../targeting.js';
import { mitigate, periodicDamage } from '../damage.js';

// ---------------------------------------------------------------------------------------------------------------
// constants (numbers that exist nowhere in the data)

/** 侵蚀 → engine gauge. */
export const EROSION = 'erosion';
/** Official erosion burst on operators (gamedata_const termDescriptionDict ba.dt.erosion; engine constants ELEMENT.erosion.ally). */
export const EROSION_BURST = Object.freeze({ defDown: ELEMENT.erosion.ally.defDown, physDamage: ELEMENT.erosion.ally.damage });
/** 假想敌：淤困: element damage its host's burst spreads to the allies of the 4 tiles around (PRTS 假想敌：淤困 "附着对象元素爆发时
 *  …对附着对象及周围4格内的所有我方单位…造成1000同类型元素损伤"; the host itself is in its 爆发冷却). */
const PARASITE_SPREAD = 1000;
/** 重生 of a Revive[Trigger] knock-out before its husk (PRTS 深池逐火战士 and 假想敌：再生 天赋: "被击倒后重生，持续1s，随后变为
 *  怨恨的余烬 / 再生状态，1s内不移动且持有无敌+无法阻挡+失衡免疫"; both models' knock-out clips last 1 s). */
export const HUSK_REBIRTH = 1;
/** 转译基底·α: "变化过程持续2s" (PRTS 天赋; the model's A_Die_B / _C / _D change clips last 2 s); the original form's
 *  immunities ("免疫晕眩/沉睡/寒冷/冻结/浮空/恐惧", plus 失衡免疫). */
export const TRANSLATOR_CHANGE = 2;
const TRANSLATOR_IMMUNE = Object.freeze(['stun', 'sleep', 'cold', 'freeze', 'levitate', 'fear']);
/** Death-explosion radius when the enemy has no official radius [ASSUMED]. */
const BOOM_RADIUS = 1.25;
/** 萨卡兹枯朽战车 秽蚀轰击: radius of the 【污染秽蚀】 it leaves at its target (PRTS 萨卡兹枯朽战车 技能 "在目标位置生成半径1.7，
 *  持续10s的【污染秽蚀】" — the skill blackboard's range_radius 2.2 is its trigger range; the zone's radius is in no table). */
const TANK_ZONE_RADIUS = 1.7;
/** 【污染秽蚀】 ticks once per second; "同名效果不叠加": a unit inside several zones takes one tick per second. */
const POLLUTION_INTERVAL = 1;
/** "数个目标" of 假想敌：骨刺 while stealthed [ASSUMED]. */
const ACBUNN_TARGETS = 3;
/**
 * 隐匿 that comes back sooner after a block than the general 3 s (PRTS 作战机制 §隐匿 "对于绝大部分可隐匿的敌人而言…不被阻挡的
 * 3秒后重新进入隐匿"; engine STEALTH_RESTORE): the enemy pages' 天赋 "隐匿（解除阻挡N秒后恢复）" — PRTS text search
 * "解除阻挡0秒后恢复" (21 enemies; these 6 are in this mode) and "解除阻挡1秒后恢复" (the two 家族灭迹人), checked
 * 2026-10-03. Every other stealthy enemy here has a plain "隐匿" (3 s), the 深池逐火 embers included. 清明 / 堂皇's veil
 * ("获得隐匿（解除阻挡0秒后恢复）") is kitInvisShield's.
 */
const STEALTH_RESTORE_BY_KEY = Object.freeze({
  enemy_10031_cnvsld: 0,     // 业余竞演者
  enemy_10034_cnvsax: 0,     // 节日爵士乐手
  enemy_9008_acbunn: 0,      // 假想敌：骨刺
  enemy_2034_sythef: 0,      // 流泪小子
  enemy_2034_sythef_2: 0,    // 流泪小子 (its stronger copy)
  enemy_1389_winbab_2: 0,    // 访问团强攻冠军
  enemy_1283_sgkill: 1,      // 家族灭迹人
  enemy_1283_sgkill_2: 1,    // 家族暗影灭迹人
});
/** 假想敌：再生 shield aura radius (PRTS 假想敌：再生 天赋 "进入此形态时，使半径1.8范围内的其他敌方单位（无视其可选性）获得5层…护盾"). */
const ACPUPP_AURA_RADIUS = 1.8;
/** 重弩突袭者 直击 reach along a row/column [ASSUMED]; the skill's length and its charge before the bolt (PRTS 直击 "蓄力1.4s后
 *  向目标方向发射1支弩箭…※技能持续2.5s"). */
const CROSS_REACH = 6, CROSS_SKILL = 2.5, CROSS_CHARGE = 1.4;
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
/** 帝国炮火先兆者 shell (PRTS "普通攻击向目标所在位置发射一枚于3秒后命中的弹道，弹道对半径1.2范围内的所有我方单位造成攻击力
 *  100%的无来源物理伤害 … ※弹道始终使用缓存攻击力"): flight time and blast radius. */
const SHELL_FLIGHT = 3, SHELL_RADIUS = 1.2;
/** 假想敌：黑云 抓取: the blackboard radius counts ×2.5 (PRTS "2.5倍可变半径": range_radius 1.5 → 3.75), at most 3 prey,
 *  "短暂延迟后" the 延迟吞噬 lands (delay [ASSUMED] 0.5 s); its SP (= 全弹发射 hits) caps at the data's spData.maxSp. */
const GRAB_RADIUS_SCALE = 2.5, GRAB_MAX_PREY = 3, GRAB_DELAY = 0.5;
/** 孽罪奇美拉 污染模式 aura (PRTS 天赋 "自身半径1.2范围内的所有单位…每0.5秒受到50真实持续伤害（同类效果取最高）"): radius,
 *  damage period (s). */
const CHIMERA_AURA_RADIUS = 1.2, CHIMERA_AURA_EVERY = 0.5;
/** 自行炮 Cannon (PRTS 高准度伦蒂尼姆城防自行炮 技能 "以攻击范围内生命上限最高的我方单位为中心，生成9格的炮击区域，6s内每0.5s对炮击
 *  区域中生命比例最高的我方单位进行攻击…(最多进行10次攻击)"): shot interval (s), shot cap; 3 shots 1 s apart [ASSUMED] until
 *  0.1.1. 备注: during the skill animation 失衡免疫 + 晕眩 / 冻结 / 浮空 / 沉睡免疫 — held over the bombardment [ASSUMED length]. */
const CANNON_EVERY = 0.5, CANNON_SHOTS = 10;
const CANNON_IMMUNE = Object.freeze(['stun', 'freeze', 'cold', 'levitate', 'sleep']);
/** 枯朽之种 summoned per BornBugs cast ("数个") [ASSUMED]. */
const BUGS_PER_CAST = 3;
/** Radius of 骸骨拷打者's "周围" death sensing when its talent has no Attack.range_radius [ASSUMED]. */
const TORTURER_RADIUS = 1;
/** Barrel zone radius of 咸鳞汁推荐者 [ASSUMED]. */
const BARREL_RADIUS = 1.5;
/** 碎骨's grenade (PRTS 碎骨 天赋 "未被阻挡时发射榴弹对目标及其周围八格的我方单位造成相当于攻击力26%的物理伤害，并令其在5秒内
 *  防御力下降50%"; the blackboard has only defdown.def −0.5): share of ATK on every unit hit, DEF-down duration (s).
 *  Until 0.1.3: the full attack on the target, 100 % on the 4 neighbours, 3 s [ASSUMED]. */
const SKULSR_GRENADE_SCALE = 0.26, SKULSR_DEFDOWN_DUR = 5;
/** Splash radius (中点判定 around the target) of 烹泉 / 沏虹's attack (PRTS 天赋 "普通攻击对目标对及目标周围半径1.0范围内的所有
 *  我方单位造成法术普通伤害（无视迷彩，不可对空）") and of 集团军重型火炮's shell (PRTS "对目标半径1.0范围内的所有我方单位造成攻击力
 *  100%的物理伤害（此弹道会强制击中主目标，碰撞无视迷彩，不可对空）"). */
const TEA_SPLASH_RADIUS = 1, SHELL_SPLASH_RADIUS = 1;
/** 集团军重型火炮's 【燃烧区域】: PRTS "碰撞半径1.5" with the source note "1.5倍可变半径" — ×1.5 on the blackboard's
 *  ProjectileBoomRange.attack@projectile_range (1). Until 0.1.3 the zone took the blackboard's 1. */
const UACANN_ZONE_SCALE = 1.5;
/** 烹泉 / 沏虹 死亡爆炸 radius (PRTS 天赋 "死亡爆炸（爆炸半径1.25，造成攻击力100%法术溅射伤害并施加15s【烹泉减益】…）"; until
 *  0.1.3 the attack range, 2). */
const TEA_BOOM_RADIUS = 1.25;
/** “庞贝”'s self-blast while blocked (PRTS 天赋 "对<固定半径>半径1.4范围内的所有我方单位造成1000预计算的无途径法术溅射伤害（不可
 *  对空）"; the blackboard has only the damage and the 10 s; until 0.1.3: radius 1 [ASSUMED]). */
const POMPEII_BLAST_RADIUS = 1.4;
/** “巨大的丑东西” first form: its unblocked ranged attack (PRTS 天赋 "未被阻挡时，可对半径2.5范围内的1名非飞行的我方单位进行远程攻击，
 *  对目标及其周围8格内的所有我方单位造成攻击力100%的物理伤害" — the data's attack radius is 0, so it had no ranged attack until
 *  0.1.3) and its self-destruct ("首次被击倒后进行持续10s的重生…：重生开始的2.17s后进行自爆，对半径3.0范围内所有我方单位造成攻击力
 *  150%的物理伤害和16s晕眩"; until 0.1.3: radius 2.5 at once [ASSUMED]). */
const MCM_RANGE = 2.5, MCM_BOMB_DELAY = 2.17;
/** “复仇者” 【冲锋】 (PRTS 技能 "仅自身未被阻挡且存在符合条件的可选目标时可触发：选择3.0半径内位于自身下个检查点前的后续路径上(包含
 *  自身当前所在地块)的距离自身最近的我方单位…"): the search radius. The blackboard's range_radius is 1.5; PRTS's figure is the
 *  one used. Until 0.1.3: any unit within 1.5, 隐匿 / 迷彩 ones included. */
const RUSH_RADIUS = 3;
/** W's C4 fuse and blast radius [ASSUMED]. */
const C4_FUSE = 1, C4_RADIUS = 1;
/** Every Nth attack for "数次攻击后" abilities without an SP cost in the data [ASSUMED]; with a cost N = spCost + 1
 *  (official 粉碎攻坚手 text for spCost 2: "攻击2次后，下一次攻击" ⇒ 3rd; 码头水手 / 澪 / 清扫小队 spCost 3 ⇒ 4th). */
const NTH_ATTACK = 3;
export const nthOf = (s) => (s && s.sp > 0 ? s.sp + 1 : NTH_ATTACK);
/** 鼠王 【唱沙】 cross reach and 【沙狱】 "及其周围" radius [ASSUMED]. */
const DRIFT_REACH = 1, SANDSTORM_RADIUS = 1;
/** “巨大的丑东西” self-destruct radius (PRTS 天赋 "对半径3.0范围内所有我方单位…"; 2.5 [ASSUMED] until 0.1.3). */
const MCM_BOMB_RADIUS = 3;
/** 自在 【纬地经天】: tiles covered along the row and the column of the centre ("十字型") [ASSUMED]. */
const XI_CROSS_REACH = 2;
/** 扎罗 (PRTS 扎罗，“狼之主” 天赋; no numbers in the data): form-2 attack radius ("进行远程攻击，普通攻击为2连击，攻击范围半径1.25"),
 *  【远古威慑】 aura radius / ASPD ("自身1.5半径范围内的我方单位攻击速度-50(指定状况下生效)" — during the 重生 and in the second form).
 *  Until 0.1.3: 2.5 / 2.5 / −30, the aura only during the 重生 [ASSUMED]. */
const WOLF_RANGE = 1.25, WOLF_AWE_RADIUS = 1.5, WOLF_AWE_ASPD = -50;
/** 失衡 movement speed that turns 弧光锋卫's per-interval bleed into HP per tile moved [ASSUMED]. */
const UNBALANCE_SPEED = 5;
/** 乌顶巨角卢鲁 【角力对决】: the operator cannot be pushed (fixed tiles) ⇒ "更多伤害" multiplier [ASSUMED]. */
const ELK_FAIL_SCALE = 2;

// ---------------------------------------------------------------------------------------------------------------
// per-battle state + installation

const STATE = new WeakMap();
function stOf(b) {
  let st = STATE.get(b);
  if (!st) { st = { lpLoss: 0, freedAll: false, deathWatch: new Set() }; STATE.set(b, st); }
  return st;
}

/** Register the global dispatch hooks once per battle (idempotent). */
export function ensureInstalled(b) {
  const st = stOf(b);
  if (st.installed) return st;
  st.installed = true;
  b.on('enemySpawn', ({ enemy }) => onSpawn(b, enemy), { priority: 100 });
  b.on('hit', (c) => onHitOut(b, c), { priority: 200 });
  b.on('hit', (c) => chaliceShare(b, c), { priority: -400 });
  b.on('hit', (c) => onHitIn(b, c), { priority: -500 });
  b.on('damaged', (c) => onDamaged(b, c), { priority: 50 });
  b.on('beforeAttack', (c) => onBeforeAttack(b, c), { priority: 50 });
  b.on('attack', (c) => { if (c.attacker && c.attacker.side === 'enemy') dispatch(b, c.attacker, 'attack', c); }, { priority: 50 });
  b.on('blocked', (c) => dispatch(b, c.enemy, 'blocked', c), { priority: 50 });
  b.on('kill', (c) => onKill(b, c), { priority: 1000 });
  b.on('death', (c) => onDeath(b, c), { priority: 50 });
  b.on('beforeStatus', (c) => {
    const ab = c.target && c.target.mem && c.target.mem.ab;
    if (!ab) return;
    if (ab.immune && ab.immune.has(c.status)) c.cancel = true;
  }, { priority: 50 });
  b.on('statusApplied', (c) => { if (c.target && c.target.side === 'enemy') dispatch(b, c.target, 'status', c); }, { priority: 50 });
  b.on('heal', (c) => {
    // 逐腐兽 bleeding ends when the target receives healing (natural regeneration excluded)
    if (c.amount > 0 && c.target && c.target.side === 'ally' && !(c.opts && c.opts.regen) && c.target.findBuff('ab:bleed')) b.removeBuff(c.target, 'ab:bleed');
  }, { priority: -50 });
  b.on('elementBurst', (c) => onBurst(b, c), { priority: 50 });
  b.on('tick', (c) => onTick(b, c.dt), { priority: 50 });
  b.on('battleEnd', ({ result }) => { if (st.lpLoss > 0 && result) result.lpLoss = (result.lpLoss ?? 0) + st.lpLoss; });
  return st;
}

export function install(battle) { ensureInstalled(battle); }
export function registerMeta() {}

// ---------------------------------------------------------------------------------------------------------------
// ability bookkeeping

/** The enemy's ability record (created on demand). */
export function abOf(b, e) {
  if (e.mem.ab) return e.mem.ab;
  const key = e.defId;
  const ov = (b.enemyOverrides && (b.enemyOverrides[key] ?? b.enemyOverrides[e.def && e.def.key])) || null;
  const raw = (e.def && e.def.raw) || {};
  const t = { ...((e.def && e.def.talent) || {}), ...((ov && ov.talents && ov.talents.bb) || {}) };
  const tS = { ...((raw.talents && raw.talents.bbStr) || {}), ...((ov && ov.talents && ov.talents.bbStr) || {}) };
  const sk = {};
  for (const s of (ov && Array.isArray(ov.skills) ? ov.skills : (e.def && e.def.skills) || [])) {
    if (!s || s.prefabKey == null) continue;
    sk[s.prefabKey] = { cd: num(s.cooldown, 0), icd: num(s.initCooldown, 0), sp: num(s.spCost, 0), bb: s.bb || {}, bs: s.bbStr || {} };
  }
  e.mem.ab = { key, t, tS, sk, list: [], times: null, hitShield: 0, atkType: null, immune: null, origMaxHp: e.base.maxHp };
  return e.mem.ab;
}

/** Attach abilities to an enemy (calls their spawn()). */
export function attach(b, e, list) {
  const ab = abOf(b, e);
  for (const a of list) {
    if (!a) continue;
    if (a.cd != null) a.left = num(a.left, num(a.icd, 0));
    ab.list.push(a);
    if (a.spawn) safe(b, e, () => a.spawn(b, e, a, ab));
  }
  return ab;
}

function safe(b, e, fn) {
  try { return fn(); } catch (err) { b._handlerError('content:enemies', e, err); return undefined; }
}

function dispatch(b, e, name, c) {
  const ab = e && e.mem && e.mem.ab;
  if (!ab) return false;
  let any = false;
  for (const a of ab.list) {
    const f = a[name];
    if (!f) continue;
    if (a.sil && e.s.flags.silence) continue;
    try { if (f.call(a, c, b, e, a, ab)) any = true; } catch (err) { b._handlerError(`enemies:${name}`, e, err); }
  }
  return any;
}

const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
/** First finite talent value among keys. */
export function T(ab, ...keys) { for (const k of keys) { const v = ab.t[k]; if (typeof v === 'number' && Number.isFinite(v)) return v; } return undefined; }

export function silenced(e) { return !!e.s.flags.silence; }
export function canCast(e, sil) { return e.alive && !e.hidden && !e.s.flags.stun && !(sil && e.s.flags.silence); }

// ---------------------------------------------------------------------------------------------------------------
// global dispatchers

function onSpawn(b, e) {
  const kit = KITS[e.defId];
  if (typeof kit !== 'function') return;
  const ab = abOf(b, e);
  const list = safe(b, e, () => kit(ab, e, b)) || [];
  attach(b, e, list);
}

function onHitOut(b, c) {
  const s = c.source;
  if (!s || s.side !== 'enemy' || !s.mem.ab || c.dmg.cancel) return;
  const ab = s.mem.ab;
  if (ab.atkType && c.dmg.isAttack && c.dmg.type !== 'element') c.dmg.type = ab.atkType;
  dispatch(b, s, 'hitOut', c);
}

function onHitIn(b, c) {
  const t = c.target;
  if (!t || t.side !== 'enemy' || !t.mem.ab || c.dmg.cancel) return;
  const ab = t.mem.ab;
  dispatch(b, t, 'hitIn', c);
  if (c.dmg.cancel) return;
  const ty = c.dmg.type;
  if (ab.hitShield > 0 && (ty === 'phys' || ty === 'arts')) {
    // "可以抵挡一次物理或法术伤害" / 再生's aura shield: the whole instance is negated
    c.dmg.cancel = true;
    ab.hitShield--;
    if (ab.hitShield <= 0) b.fx('shieldBreak', { x: t.x, y: t.y, id: t.id });
  }
}

function onDamaged(b, c) {
  const { source: s, target: t, dmg } = c;
  if (!dmg || dmg.type === 'element') return;
  if (t && t.side === 'enemy' && t.mem.ab) dispatch(b, t, 'taken', c);
  if (s && s.side === 'enemy' && s.mem.ab && dmg.isAttack && t && t.side === 'ally') dispatch(b, s, 'dealt', c);
}

function onBeforeAttack(b, c) {
  const a = c.attacker;
  if (a && a.side === 'enemy' && a.mem.ab) dispatch(b, a, 'before', c);
}

function onKill(b, c) {
  const v = c.victim;
  if (!v || v.side !== 'enemy' || !v.mem.ab) return;
  if (dispatch(b, v, 'killed', c) && v.hp > 0) c.stopPropagation = true; // revived: not a kill for anyone else
}

function onDeath(b, c) {
  const u = c.unit;
  const st = stOf(b);
  if (u && u.side === 'enemy' && u.mem.ab) dispatch(b, u, 'death', c);
  if (st.deathWatch.size) for (const w of [...st.deathWatch]) { if (!w.alive) { st.deathWatch.delete(w); continue; } dispatch(b, w, 'otherDeath', c); }
}

function onBurst(b, c) {
  const t = c.target;
  if (!t) return;
  if (t.side === 'enemy') { if (t.mem.ab) dispatch(b, t, 'burst', c); return; }
  // 假想敌：淤困 parasite: the host's burst spreads the same element to the 4 neighbouring allies — PRTS 天赋 "（中点判定，
  // 无视目标可选性，不受迷彩制约）": every ally there, 隐匿 / untargetable / airborne 起飞 ones included (`ignoreSelect`)
  const par = t.findBuff('ab:parasite');
  if (par && par.data && par.data.src) {
    const src = par.data.src;
    for (const o of alliesInTiles(b, t.tileR, t.tileC, 'plus', 1)) if (o !== t) elem(b, src, o, c.element, par.data.spread, { ignoreSelect: true });
  }
}

function onTick(b, dt) {
  const list = b.enemies;
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const e = list[i];
    if (!e || !e.alive || !e.mem.ab) continue;
    const ab = e.mem.ab;
    for (let j = 0; j < ab.list.length; j++) {
      const a = ab.list[j];
      if (!e.alive) break;
      if (a.tick) {
        if (!(a.sil && e.s.flags.silence)) {
          if (!(a.iv > 0)) safe(b, e, () => a.tick(b, e, a, dt));
          else {
            a._acc = (a._acc ?? 0) + dt;
            let k = 0;
            while (a._acc >= a.iv - 1e-9 && k++ < 4 && e.alive) { a._acc -= a.iv; safe(b, e, () => a.tick(b, e, a, a.iv)); }
          }
        }
      }
      if (a.fire && a.cd != null) {
        a.left -= dt;
        if (a.left <= 1e-9 && canCast(e, a.sil) && (!a.cond || safe(b, e, () => a.cond(b, e, a)))) {
          a.left = Math.max(TICK, a.cd);
          a.casts = (a.casts ?? 0) + 1;
          e.skillAnimUntil = b.time + 0.5;
          safe(b, e, () => a.fire(b, e, a));
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// helpers (exported for bosses.js)

/** Element damage (erosion mapped onto the engine gauge); `ignoreSelect` / `tags` as hurt(). */
export function elem(b, src, tgt, el, amount, { ignoreSelect = false, tags = [] } = {}) {
  if (!tgt || !tgt.alive || !(amount > 0)) return 0;
  const element = el === 'erosion' ? EROSION : el;
  return b.dealDamage(src, tgt, { type: 'element', element, amount, ignoreSelect, tags: ['enemyAbility', ...tags] });
}

/**
 * Skill / ability damage (no dodge unless asked). `ignoreSelect` = no selection the target's 无法选择 effects stop
 * (abilities that "无视无法选择", direct picks, a flying unit's blast credited to a ground leader): it also reaches an
 * airborne 起飞 ally, which a ground enemy's damage otherwise skips (damage.js, targeting.js evadesGround).
 */
export function hurt(b, src, tgt, amount, type = 'phys', { canDodge = false, tags = [], isSkill = true, ignoreSelect = false } = {}) {
  if (!tgt || !tgt.alive || !(amount > 0)) return 0;
  return b.dealDamage(src, tgt, { amount, type, canDodge, isSkill, ignoreSelect, tags: ['enemyAbility', ...tags] });
}

/** Allies whose tile is within `n` of (r, c): 'plus' = Manhattan (周围四格), 'box' = Chebyshev (周围8格). */
export function alliesInTiles(b, r, c, shape = 'plus', n = 1) {
  const out = [];
  for (const a of b.allies()) {
    if (a.hidden) continue;
    const dr = Math.abs(a.tileR - r), dc = Math.abs(a.tileC - c);
    if (shape === 'plus' ? dr + dc <= n : Math.max(dr, dc) <= n) out.push(a);
  }
  return out;
}

/** Allies within radius that enemy `e` could target (ranged rules: stealth / untargetable skipped). */
export function targetsNear(b, e, r, { ranged = true, x = e.x, y = e.y } = {}) {
  return b.alliesInRadius(x, y, r).filter((a) => canTargetAlly(e, a, ranged));
}

/** Every targetable ally on the field. */
export function allTargets(b, e) {
  return b.allies().filter((a) => canTargetAlly(e, a, true));
}

/**
 * The allies an AREA effect of enemy `src` selects within `r` of (x, y) — splash, blast, area skill / status, pulse, zone
 * tick, chain or bounce jump (targeting.js areaSelectable: no 隐匿 ally, the blocker included, no untargetable or sleeping ally, no 起飞 one
 * for a ground `src`; 迷彩 is not checked). `src` = the enemy whose effect it is (null: none — 隐匿 still applies). A
 * locked target goes first through targetAndArea. Abilities PRTS marks "无视无法选择 / 无视可选性" use b.alliesInRadius with
 * `ignoreSelect` instead.
 */
export function areaAllies(b, src, x, y, r) {
  return b.alliesInRadius(x, y, r).filter((a) => areaSelectable(src, a));
}

/** alliesInTiles for an area effect of `src` (周围四格 / 周围八格 / cross / 3×3 areas — 格子判定): areaSelectable. */
export function areaAlliesInTiles(b, src, r, c, shape = 'plus', n = 1) {
  return alliesInTiles(b, r, c, shape, n).filter((a) => areaSelectable(src, a));
}

/** Every ally on the field a whole-field ability of `src` selects ("对场上所有我方单位…": 【大潮】, 【斥退】 …). */
export function fieldAllies(b, src) {
  return b.allies().filter((a) => areaSelectable(src, a));
}

/**
 * The allies within `r` of (x, y) a buff aura of enemy `src` takes (targeting.js auraSelectable: no 隐匿 ally, the blocker included,
 * untargetable or sleeping ally — PRTS "隐匿状态下的单位一般无法被敌方的…Buff选择器选中"; an airborne 起飞 ally is still
 * taken [ASSUMED, §21.22]). 寒霜's aura, which PRTS says ignores 隐匿, keeps b.alliesInRadius (allyAura).
 */
export function auraAllies(b, src, x, y, r) {
  return b.alliesInRadius(x, y, r).filter((a) => auraSelectable(src, a));
}

/**
 * A locked target `t` and the allies an area takes around it: the target was picked directly when the ability started
 * (an attack's target, a channel's or a C4's lock), so a 隐匿 it gains meanwhile does not save it — PRTS 异常效果 "'直接选中'
 * 的能力不会进行具体的目标选择，故同样不受这些仅在选择时生效的异常效果制约"; only the others are an area selection (`area`).
 */
export function targetAndArea(t, area) {
  return t && t.alive && t.deployed ? [t, ...area.filter((u) => u !== t)] : area;
}

/** Engine priority (blocker → taunt → latest deployed) on a copy. */
export function byPriority(e, list) { return sortAllyTargets(e, list.slice()); }

/**
 * An HP-loss / damage zone. `tick(units)` runs every `iv` s for `life` s on the allies inside: `pick(x, y, r)` chooses
 * them — by default every ally in the circle (【污染秽蚀】 "无视无法选择"); the other zones (dmgZone, 烹泉's steam) pass
 * their area selection (areaAllies).
 */
export function zone(b, { x, y, r, life, iv = 1, kind = 'zone', tick, pick = null }) {
  b.fx('zone', { x, y, r, dur: life, kind });
  let left = life;
  const h = b.every(iv, () => {
    tick(pick ? pick(x, y, r) : b.alliesInRadius(x, y, r));
    left -= iv;
    if (left <= 1e-6) h.cancel();
  });
  return h;
}

/** Remaining route of an enemy from its current position (for summons / phantoms that continue its path). */
export function remainingRoute(e) {
  const R = e.route;
  const here = [e.y, e.x];
  if (!R || !Array.isArray(R.legs) || !R.legs.length) return { motion: e.motion === 'FLY' ? 'FLY' : 'WALK', start: here, end: here, checkpoints: [] };
  const steps = [];
  let end = null;
  for (let i = Math.max(0, R.legIdx); i < R.legs.length; i++) {
    const L = R.legs[i];
    if (L.final) { end = [L.r, L.c]; break; }
    if (L.t === 'move') steps.push({ t: 'move', p: [L.r, L.c] });
    else if (L.t === 'wait') steps.push({ t: 'wait', s: i === R.legIdx && R.waitLeft != null ? R.waitLeft : L.time });
    else if (L.t === 'disappear') steps.push({ t: 'disappear' });
    else if (L.t === 'appear') steps.push({ t: 'appear', p: [L.r, L.c] });
  }
  if (!end) { const last = R.legs[R.legs.length - 1]; end = last && last.r != null ? [last.r, last.c] : [Math.round(e.y), Math.round(e.x)]; }
  const route = { motion: e.motion === 'FLY' ? 'FLY' : 'WALK', start: here, end, checkpoints: [] };
  if (steps.length) route.steps = steps;
  return route;
}

/** A route that keeps an enemy in place (content moves it by hand). */
export function stayRoute(e, secs = 99999) {
  const p = [Math.round(e.y), Math.round(e.x)];
  return { motion: e.motion === 'FLY' ? 'FLY' : 'WALK', start: p, end: p, steps: [{ t: 'wait', s: secs }] };
}

/**
 * Mods copied onto a split or summoned child. The parent's stat multipliers travel; a kill bounty does not
 * (owner 2026-10-04: the main body alone carries it — GitHub #67, #89-2). `bountyId` is the 悬赏 card and
 * `bountyCoins` is the coin copy the match writes for 联防. The parent object is left as it is.
 */
function modsWithoutBounty(mods) {
  if (!mods || typeof mods !== 'object') return mods ?? null;
  if (mods.bountyId == null && mods.bountyCoins == null) return mods;
  const copy = { ...mods };
  delete copy.bountyId;
  delete copy.bountyCoins;
  return copy;
}

/** Spawn `n` enemies at the parent's position that continue its route. Returns the spawned units. */
export function spawnChildren(b, parent, key, n, opts = {}) {
  const out = [];
  const route = opts.route ?? remainingRoute(parent);
  const cnt = Math.max(0, Math.min(20, Math.floor(n)));
  const mods = modsWithoutBounty(opts.mods ?? parent.mods ?? null);
  for (let i = 0; i < cnt; i++) {
    const off = cnt > 1 ? (i - (cnt - 1) / 2) * 0.2 : 0;
    const pos = opts.pos ?? [parent.y, parent.x + off];
    const c = b.spawnEnemy(key, {
      pos, route, mods, tag: opts.tag ?? null, countInTotal: opts.countInTotal,
      ownerPlayerId: parent.ownerId ?? null, sourcePlayerId: parent.sourcePlayerId ?? null,
    });
    if (c) out.push(c);
  }
  if (out.length) b.fx('summon', { x: parent.x, y: parent.y, id: parent.id, key, n: out.length });
  return out;
}

/** Move a unit straight toward (tx, ty) by `dist` tiles. Returns true on arrival. */
export function stepToward(u, tx, ty, dist) {
  const dx = tx - u.x, dy = ty - u.y;
  const d = Math.hypot(dx, dy);
  if (d <= dist + 1e-9) { u.x = tx; u.y = ty; return true; }
  u.x += (dx / d) * dist;
  u.y += (dy / d) * dist;
  return false;
}

/** Set a 频次 unit's hits (maxHp := hits, full). */
export function setHits(e, n) {
  const h = Math.max(1, Math.round(n));
  e.base.maxHp = h;
  e.markDirty();
  void e.s;
  e.hp = h;
}

const HIT_COUNT_KEY = 'ab:hitCount';
/** 频次 on/off: every damage instance removes exactly 1 HP (engine flag; `artsOnly` = 茶器, physical instances remove 0). */
export function hitCount(b, e, on, artsOnly = false) {
  if (!on) { b.removeBuff(e, HIT_COUNT_KEY); return; }
  b.addBuff(e, { key: HIT_COUNT_KEY, persist: true, flags: artsOnly ? { hitCountArts: true } : { hitCount: true } });
}
export const isHitCount = (e) => !!e.findBuff(HIT_COUNT_KEY);

/**
 * The enemy's model takes another form (render/units.js FORMS: a clip set of its skeleton): kept on the unit
 * (`e.form`, published by snapshot.js unitInfo — a view built mid-battle from fieldMeta(): a teammate's field watched
 * later, 联防 observers, a reconnect — starts in it) and announced by the fx `fxKind` (+ id, x, y, `params`) carrying it
 * as `form` (a 'phase' fx also as its `kind`). The `form` key marks the fx as state (shared/protocol.js fxForm): the
 * client never drops it, not in a catch-up frame nor while its tab is hidden. Barrier / charge 'phase' kinds are no
 * forms: they go through b.fx directly, without `form`.
 */
export function setForm(b, e, form, fxKind = 'phase', params = null) {
  e.form = form;
  b.fx(fxKind, fxKind === 'phase' ? { ...params, x: e.x, y: e.y, id: e.id, kind: form, form } : { ...params, x: e.x, y: e.y, id: e.id, form });
}

/** Leader "扣除目标生命" effects: recorded for the match (hook 'lpLoss' + result.lpLoss). */
export function lpLoss(b, amount, reason, source = null) {
  if (!(amount > 0)) return;
  const st = stOf(b);
  st.lpLoss += amount;
  b.fx('lpLoss', { x: source ? source.x : 0, y: source ? source.y : 0, value: amount, reason });
  b.emit('lpLoss', { amount, reason, source });
}

/** 暴露: damage taken ×scale for `dur` s. */
export function expose(b, u, dur, scale) {
  if (!u || !u.alive || !(dur > 0)) return;
  b.addBuff(u, { key: 'ab:exposed', duration: dur, refresh: 'extend', mods: { dmgTakenMul: scale }, visible: true });
  b.fx('expose', { x: u.x, y: u.y, id: u.id });
}

/**
 * Final HP damage the pipeline would deal for a phys/arts/true/elemental `dmg` before shields (mitigation is linear in
 * the amount) — the same terms as damage.js dealDamage (元素伤害: 元素抗性 + elementalTakenMul, no dmgTakenMul).
 */
export function expectedFinal(src, tgt, dmg) {
  const ts = tgt.s, ss = src && src.s && !dmg.sourceless ? src.s : null, ty = dmg.type; // 无来源 (bursts): no source stats
  const v = mitigate(dmg.amount, ty, ts, {
    defIgnorePct: (dmg.defIgnorePct || 0) + (ss ? ss.defIgnorePct : 0), defIgnoreFlat: (dmg.defIgnoreFlat || 0) + (ss ? ss.defIgnoreFlat : 0),
    resIgnorePct: (dmg.resIgnorePct || 0) + (ss ? ss.resIgnorePct : 0), resIgnoreFlat: (dmg.resIgnoreFlat || 0) + (ss ? ss.resIgnoreFlat : 0),
    elementalRes: ty === 'elemental' ? (tgt.def?.epDamageResistance ?? 0) : 0,
  });
  let mul = (dmg.mul ?? 1) * (ty === 'elemental' ? 1 : ts.dmgTakenMul); // 脆弱 skips 元素伤害 (damage.js)
  if (ss) mul *= ss.dmgDealtMul * (ty === 'phys' ? ss.physDealtMul : ty === 'arts' ? ss.artsDealtMul : 1);
  mul *= ty === 'phys' ? ts.physTakenMul : ty === 'arts' ? ts.artsTakenMul : ty === 'elemental' ? ts.elementalTakenMul : ts.trueTakenMul;
  const f = v * mul;
  return Number.isFinite(f) && f > 0 ? f : 0;
}

/**
 * "吸收法术伤害的屏障": absorb up to `left` of an arts instance in a `hit` handler (after RES, like a shield) by scaling
 * the instance down (cancelled when fully absorbed). Returns the amount absorbed.
 */
export function absorbArts(c, left) {
  if (!c || c.dmg.type !== 'arts' || !(left > 0) || c.dmg.cancel) return 0;
  const f = expectedFinal(c.source, c.target, c.dmg);
  if (!(f > 0)) return 0;
  const take = Math.min(left, f);
  if (take >= f - 1e-9) c.dmg.cancel = true;
  else c.dmg.amount *= (f - take) / f;
  return take;
}

/** Timed buff on each unit (same key never stacks: aura semantics). */
function auraBuff(b, u, key, iv, mods, flags = null, visible = false) {
  b.addBuff(u, { key, duration: iv + 0.1, refresh: 'replace', mods, flags, visible });
}

/** Mark an ally/enemy ability as watching every death on the field. */
function watchDeaths(b, e) { stOf(b).deathWatch.add(e); }

const tileOf = (u) => [Math.round(u.y), Math.round(u.x)];
const onTerrain = (b, u, terrain) => { const [r, c] = tileOf(u); return b.grid.tile(r, c).terrain === terrain; };

// ---------------------------------------------------------------------------------------------------------------
// archetypes

/**
 * 隐匿: permanent stealth. Blocked it is lifted; it hides again STEALTH_RESTORE s after the block ends, or after its own
 * "（解除阻挡N秒后恢复）" (STEALTH_RESTORE_BY_KEY → buff `data.stealthRestore`; Battle._stealthSwitch).
 */
const stealth = () => ({
  spawn(b, e, a, ab) {
    const n = STEALTH_RESTORE_BY_KEY[ab.key];
    b.addBuff(e, { key: 'ab:stealth', flags: { stealth: true }, persist: true, data: n != null ? { stealthRestore: n } : {} });
  },
});
/** 无法被阻挡. */
const unblockable = () => ({ spawn(b, e) { b.addBuff(e, { key: 'ab:unblockable', flags: { unblockable: true }, persist: true }); } });
/**
 * "受到伤害时开始奔跑，移动速度+N%" (鸭爵 `run.attack@move_speed`): the first damage it takes ⇒ move speed ×(1 + v) for good —
 * PRTS 鸭爵 天赋 "移动速度+400%" for v 4, PRTS 卫戍协议：盟约 下半/PRTS盟约记录 鸭爵 备注 "受伤后移动速度+300%" for the act2 v 3.
 */
const runWhenHit = (v) => ({ taken(c, b, e, a) { if (a.on || !(v > 0)) return; a.on = true; b.addBuff(e, { key: 'ab:duckRun', persist: true, mods: { moveMul: 1 + v } }); } });
/** 频次: maxHp = hits. */
const times = (artsOnly = false) => ({ spawn(b, e) { setHits(e, e.def.maxHp); hitCount(b, e, true, artsOnly); } });
/** "只能被阻挡数大于等于N的单位阻挡". */
const blockWeight = (n) => ({ spawn(b, e) { e.blockWeight = n; } });
const taunt = (n) => ({ spawn(b, e) { if (n) b.addBuff(e, { key: 'ab:taunt', mods: { taunt: n }, persist: true }); } });
const maxTargets = (n) => ({ spawn(b, e) { if (n > 1) e.profile.maxTargets = n; } });
/** Element damage on every attack hit: ATK × ratio. */
const ep = (el, ratio, sil = false) => ({ sil, dealt(c, b, e) { if (ratio > 0) elem(b, e, c.target, el, e.s.atk * ratio); } });
/** Status on every attack hit. */
const onHitStatus = (key, dur, value) => ({ dealt(c, b, e) { if (dur > 0) b.applyStatus(c.target, key, { duration: dur, source: e, value }); } });
/**
 * A normal attack that splashes around its target (PRTS: "对主目标造成…普通伤害，对溅射目标造成…溅射伤害"): 碎骨's grenade,
 * “巨大的丑东西” / “墓碑”'s unblocked ranged attack, 烹泉 / 沏虹's attack, 集团军重型火炮's shell. Its mode is fixed when the
 * attack starts (`before`): `unblocked` = only an attack begun while not blocked splashes (the others are the plain melee
 * hit at `meleeScale`). The main target takes the engine's attack at `scale` × ATK (e.profile.atkScale, a normal attack:
 * on-hit effects apply); when it lands (the main hit's 'hit', before its dodge) the others around the target take
 * `scale` × ATK as a splash — an area selection (areaAllies / areaAlliesInTiles: no 隐匿 ally, the blocker included
 * (GitHub #97), no airborne 起飞 one for a ground enemy; 迷彩 is not checked — DESIGN §22.12). `tiles` 1 = the target's tile and
 * its 8 neighbours (格子判定), else `radius` around the target (中点判定). `noAir`: "不可对空" (a flying ally — the 炎佑
 * dragon — is skipped; without it "可溅射飞行单位"). `dodge`: the splash hits may be dodged (烹泉 / 沏虹, whose PRTS 天赋 calls
 * them 法术普通伤害 — a normal attack's damage); a 溅射伤害 splash cannot. `onEach(b, e, u)` runs on every unit hit (the target
 * after its damage).
 */
function splashAttack({ scale = 1, meleeScale = 1, unblocked = true, tiles = 0, radius = 0, noAir = false, dodge = false, fxKind = 'splash', onEach = null } = {}) {
  return {
    before(c, b, e, a) { a.splash = !unblocked || !e.blockedBy; e.profile.atkScale = a.splash ? scale : meleeScale; },
    hitOut(c, b, e, a) {
      const t = c.target;
      if (!a.splash || !c.dmg.isAttack || !t) return;
      b.fx('explode', { x: t.x, y: t.y, r: tiles > 0 ? tiles + 0.5 : radius, kind: fxKind, ...(tiles > 0 ? { tiles: 'box' } : {}) });
      const area = tiles > 0 ? areaAlliesInTiles(b, e, t.tileR, t.tileC, 'box', tiles) : areaAllies(b, e, t.x, t.y, radius);
      for (const u of area) {
        if (u === t || (noAir && u.isFlying)) continue;
        hurt(b, e, u, e.s.atk * scale, c.dmg.type, { tags: ['splash'], canDodge: dodge });
        if (onEach && u.alive) onEach(b, e, u);
      }
    },
    dealt(c, b, e, a) { if (a.splash && onEach && c.target.alive) onEach(b, e, c.target); },
  };
}
/**
 * Tile keys of an enemy's path up to its next checkpoint, its own tile included (PRTS “复仇者” 冲锋 "位于自身下个检查点前的后续
 * 路径上(包含自身当前所在地块)"): the tiles its current move leg crosses — the straight segments through the leg's smoothed
 * waypoints (ai.js planLeg; the last one is the leg's checkpoint), sampled every quarter tile.
 */
function pathKeysAhead(e) {
  const keys = new Set([Math.round(e.y) * COLS + Math.round(e.x)]);
  const R = e.route;
  if (!R || !Array.isArray(R.pts)) return keys;
  let x = e.x, y = e.y;
  for (let i = R.ptIdx ?? 0; i < R.pts.length; i++) {
    const p = R.pts[i], n = Math.max(1, Math.ceil(Math.hypot(p.x - x, p.y - y) * 4));
    for (let k = 1; k <= n; k++) keys.add(Math.round(y + ((p.y - y) * k) / n) * COLS + Math.round(x + ((p.x - x) * k) / n));
    x = p.x; y = p.y;
  }
  return keys;
}
/** "不会攻击飞行单位" (an engine candidate filter, ai.js enemyAttack: the 炎佑 dragon is a flying ally). */
const noAirTargets = () => ({ spawn(b, e) { e.profile.canTarget = (u) => !u.isFlying; } });
/**
 * 抵抗 (ba.buffres, the engine `resist` status: control durations halved, 麻痹 loses 1 stack every 5 s) + optional
 * immunities. Value from the talent's `Buff.one_minus_status_resistance` when present (−0.5 ⇒ half).
 */
const resist = (immune = []) => ({
  spawn(b, e, a, ab) {
    const v = -(T(ab, 'Buff.one_minus_status_resistance') ?? -0.5);
    b.applyStatus(e, 'resist', { source: e, value: v > 0 ? Math.min(1, v) : 0.5 });
    if (immune.length) ab.immune = new Set([...(ab.immune || []), ...immune]);
  },
});
const immuneTo = (...keys) => ({ spawn(b, e, a, ab) { ab.immune = new Set([...(ab.immune || []), ...keys]); } });

/** Every Nth attack: status on the targets ("攻击2次后，下一次攻击会晕眩目标"). */
const nthAttackStatus = (n, key, dur, sil = true) => ({
  sil,
  spawn(b, e, a) { a.n = 0; },
  attack(c, b, e, a) {
    a.n++;
    if (a.n % n) return;
    for (const t of c.targets) if (t.alive && dur > 0) b.applyStatus(t, key, { duration: dur, source: e });
  },
});
/** Every Nth attack deals ×scale (+ optional element). */
const nthAttackPower = (n, scale, el = null, ratio = 0) => ({
  spawn(b, e, a) { a.n = 0; a.power = false; },
  before(c, b, e, a) { a.power = (a.n + 1) % n === 0; },
  hitOut(c, b, e, a) { if (a.power && c.dmg.isAttack) c.dmg.amount *= scale; },
  dealt(c, b, e, a) { if (a.power && el && ratio > 0) elem(b, e, c.target, el, e.s.atk * ratio); },
  attack(c, b, e, a) { a.n++; },
});

/** Aura on other enemies within r: timed buff refreshed every iv s. */
const enemyAura = (r, key, mods, sil = true, iv = 0.5) => ({
  sil, iv,
  tick(b, e) { for (const o of b.enemiesInRadius(e.x, e.y, r)) if (o !== e) auraBuff(b, o, key, iv, mods); },
});
/**
 * Aura on allies within r — every ally there, 隐匿 ones included: its one user, 寒霜, is PRTS's own example of an enemy
 * debuff that "无视隐匿状态起作用" (PRTS 作战机制 §隐匿与Buff的关系: "敌方寒霜的攻速下降Debuff").
 */
const allyAura = (r, key, mods, sil = true, iv = 0.5, flags = null) => ({
  sil, iv,
  tick(b, e) { for (const u of b.alliesInRadius(e.x, e.y, r)) auraBuff(b, u, key, iv, mods, flags, true); },
});

/** Self ATK buff once HP first drops below ratio. */
const lowHpBuff = (ratio, mods, key = 'ab:lowhp') => ({
  taken(c, b, e, a) {
    if (a.on || !(e.hpRatio < ratio)) return;
    a.on = true;
    b.addBuff(e, { key, mods, persist: true, visible: true });
  },
});

/** Death spawn ("被击倒后生成N个<X>"). */
const deathSpawn = (key, cnt, extra = {}) => ({
  death(c, b, e) { if (c.reason === 'killed' && key && cnt > 0) spawnChildren(b, e, key, cnt, extra); },
});

/**
 * Death explosion on the allies within r it can select (areaAllies — PRTS 高能源石虫 / 冰爆源石虫 / 卷心籽 死亡爆炸 "…无视迷彩，
 * 不可对空", no 无视无法选择: a 隐匿 ally is spared; the dead enemy blocks nobody).
 */
const deathBoom = ({ scale, type = 'phys', r = BOOM_RADIUS, status = null, sil = true, cond = null }) => ({
  sil,
  death(c, b, e, a) {
    if (c.reason !== 'killed' || (cond && !cond(e, a))) return;
    const atk = e.s.atk;
    b.fx('explode', { x: e.x, y: e.y, r, kind: 'deathBoom', id: e.id });
    for (const u of areaAllies(b, e, e.x, e.y, r)) {
      if (scale > 0) hurt(b, e, u, atk * scale, type);
      if (status && u.alive) b.applyStatus(u, status.key, { duration: status.dur, source: e, value: status.value });
    }
  },
});

/** 折射: RES +v (and optional max HP +hpPct) while not silenced. */
const refraction = (res, hpPct = 0) => ({
  silAware: true,                                                    // SILENCE-flagged: silence switches it off in tick()
  tick(b, e, a) {
    const on = !e.s.flags.silence;
    if (on === a.on) return;
    a.on = on;
    if (on) b.addBuff(e, { key: 'ab:refraction', mods: hpPct ? { resFlat: res, hpPct } : { resFlat: res }, persist: true, visible: true });
    else b.removeBuff(e, 'ab:refraction');
  },
});

/**
 * 近地悬浮 (ba.float "无法被阻挡或近战攻击"; PRTS 术语释义: "此类效果开始时，单位强制解除阻挡，随后行动方式变为飞行（算作空中
 * 单位）… 无论飞行与否，单位只会采用地面寻路"): while floating the enemy carries the 'ab:float' buff — unblockable, an air unit for
 * every targeting / ground-only rule (flag `float` ⇒ Unit.isFlying: melee operators, 迷迭香's ground-only shots and
 * splash, ground traps and terrain skip it; ranged attacks hit it) with 失衡免疫 (`noDisplace`, "初始模式：近地悬浮，失衡
 * 免疫" on the enemies' PRTS pages) — its `motion` stays WALK, so it keeps the ground path (and 浮空 can still lift it:
 * Battle.applyStatus refuses data flyers only). Losing the float is each
 * enemy's own ability (PRTS; 缚地 "使部分近地悬浮敌人掉落" is "实为敌人自身的能力"): kitSyufo, kitParrot. 喷气人's 飞行模式 is
 * the same state for 7 s (its 'ab:takeoff' buff carries the flags; kitLeaderMisc).
 */
const FLOAT_KEY = 'ab:float';
const setFloat = (b, e, on) => {
  if (on) b.addBuff(e, { key: FLOAT_KEY, flags: { unblockable: true, float: true, noDisplace: true }, persist: true });
  else b.removeBuff(e, FLOAT_KEY);
};
const float = () => ({ spawn(b, e) { setFloat(b, e, true); } });
/** The enemies whose kit spawns them hovering (float()): the match's bot counts them as air units (bot.js fieldModel). */
export const HOVER_KEYS = Object.freeze(['enemy_2025_syufo', 'enemy_10045_parrot']);

/**
 * "生命值首次降至一半以下时，在数秒内陷入恐惧" (SelfFear; PRTS “萨科塔之翼/之眼/昂首” "生命值首次低于50%时，对自身施加持续5s的恐惧，
 * 在5s内移动速度最终提升至150%"). The fear's source is the enemy itself, so it has no 恐惧可达地块: for SelfFear.fear s it
 * flies to random points of its own tile (±0.25) at ×move_speed — the engine's 恐惧 movement (fear.js; user playtest #6
 * item 13, "小范围乱飞") — then flies on along its route.
 */
const selfFear = (ab) => ({
  taken(c, b, e, a) {
    if (a.done || !(e.hpRatio < 0.5)) return;
    a.done = true;
    const fear = T(ab, 'SelfFear.fear') ?? 0;
    if (fear > 0) b.applyStatus(e, 'fear', { duration: fear, source: e });
    // PRTS “萨科塔之翼/之眼”: "在5s内移动速度最终提升至150%" — move_speed 1.5 is the final multiplier
    const ms = T(ab, 'SelfFear.move_speed') ?? 0, sd = T(ab, 'SelfFear.speed_duration') ?? 0;
    if (ms > 0 && sd > 0) b.addBuff(e, { key: 'ab:fearRun', duration: sd, mods: { moveMul: ms }, flags: { unblockable: true } });
  },
});

/** Prisoners (禁锢 → 解放). */
function prisoner(ab, { freeAll = false } = {}) {
  const t = (k) => T(ab, k) ?? 0;
  const liberate = (b, e, a) => {
    if (a.free || !e.alive) return;
    a.free = true;
    b.removeBuff(e, 'ab:confined');
    b.addBuff(e, { key: 'ab:liberty', persist: true, visible: true, mods: {
      atkPct: t('liberty.atk'), defIgnorePct: t('liberty.def_penetrate'), resFlat: t('liberty.magic_resistance'), hpRegen: t('liberty.hp_recovery_per_sec') } });
    b.fx('liberate', { x: e.x, y: e.y, id: e.id });
    if (freeAll && !stOf(b).freedAll) {
      // "第一次解放时同时解放全场敌人"
      stOf(b).freedAll = true;
      for (const o of b.aliveEnemies()) for (const x of (o.mem.ab ? o.mem.ab.list : [])) if (x.liberate && !x.free) x.liberate(b, o, x);
    }
  };
  return {
    liberate,
    spawn(b, e, a) {
      a.n = 0; a.free = false;
      b.addBuff(e, { key: 'ab:confined', persist: true, visible: true, mods: { aspd: t('confinement.attack_speed'), defFlat: t('confinement.def') } });
    },
    attack(c, b, e, a) { if (!a.free && ++a.n >= (T(ab, 'confinement.times') ?? 4)) liberate(b, e, a); },
  };
}

/** Free every confined prisoner on the field (重犯's first liberation, 杰斯顿's killer form). */
function freeAllPrisoners(b) {
  for (const o of b.aliveEnemies()) for (const x of (o.mem.ab ? o.mem.ab.list : [])) if (x.liberate && !x.free) x.liberate(b, o, x);
}

/**
 * 重生 "清空自身身上除白名单外所有Buff" (PRTS 特殊机制 §重生): at a 重生 (reborn(), husk(), statue()) the enemy loses every
 * buff an operator / summon / device put on it and every source-less catalogue status (晕眩, 减速, 恐惧, 脆弱, 诱导 … —
 * buffs.js STATUS). Kept [ASSUMED: the whitelist]: its talents and traits (`persist` buffs, and what it or another enemy
 * gave it — 锏's 抵抗 is a self-applied status, enemy auras refresh every few tenths of a second anyway) and the field's
 * state buffs without a source (on-tile terrain, airflow — re-applied by position — and element burst locks). Without it
 * a 逐火 knocked out while feared (叙拉古 / 妮芙: 恐惧 makes it unblockable) stayed unblockable — so, 隐匿, untargetable —
 * as an ember until the fear ran out. 活性源石's lasting effect (devices.js touchInfection) is no field state but a timed
 * buff that outlives the tile, so it is cleared like any buff (PRTS 特殊机制 非首次标记: "如无特殊说明，也默认同常规Buff一样
 * 可被重生清除"); contact gives it again while the enemy stands on the tile. Kept, its 1 s ticks — each a hit of a husk's
 * 特殊生命值 — killed a 逐火 ember that had crossed the tile long before it could stand up (review of GitHub #33 item 6).
 */
/**
 * The end of a 重生 (PRTS 特殊机制 §重生 "重生结束时，重置自身的通用技能与当前形态的技能冷却为初始冷却"): every ability with a
 * cooldown starts again from its initial cooldown (until 0.1.1 the countdowns ran on through the 重生).
 */
function rebirthCooldowns(e) {
  for (const s of (e.mem.ab && e.mem.ab.list) || []) if (s.cd != null) s.left = num(s.icd, 0);
}

/** devices.js' lasting 活性源石 effect: a timed buff, not field state — cleared at a 重生 (rebirthCleanse). */
const INFECTION_BUFF = 'terrain:infection';

function rebirthCleanse(b, e) {
  for (const x of e.buffs.slice()) {
    if (x.persist || (x.source && x.source.side === 'enemy')) continue;
    if (x.source || x.status || x.key === INFECTION_BUFF) b.removeBuff(e, x);
  }
}

/**
 * "首次被击倒后重生 / 进入第二形态": the first knock-out is hidden (kill credit and bounty wait for the real death) and starts
 * a rebirth of `dur` s — statuses cleared (rebirthCleanse), invulnerable, untargetable, released by its blocker, inert
 * (no move / attack / skill).
 * `onKo(b, e, a)` runs at once (self-destruct, freeing prisoners …), `during(b, e, a, elapsed)` every tick of it; then the
 * enemy stands up with `hpRatio` of its max HP, `onReborn(b, e, a)` switches the form and `invincible` s of 无敌 follow.
 * `a.state`: undefined → 'reborn' → 'form2'. The 'telegraph' fx of the knock-out carries `form: 'reborn'` and the 'revive'
 * fx `form: 'form2'`: models with those clip sets (render/units.js FORMS — 锏, 扎罗, “复仇者”, 杰斯顿) play them.
 */
function reborn({ dur = 0, hpRatio = 1, invincible = 0, onKo = null, during = null, onReborn = null, key = 'ab:reborn' } = {}) {
  const finish = (b, e, a) => {
    if (!e.alive || a.state !== 'reborn') return;
    a.state = 'form2';
    b.removeBuff(e, key);
    e.profile.noAttack = a.noAtk;
    if (onReborn) safe(b, e, () => onReborn(b, e, a));
    e.hp = Math.max(1, e.s.maxHp * Math.max(0, Math.min(1, hpRatio)));
    if (invincible > 0) b.addBuff(e, { key: `${key}:inv`, duration: invincible, visible: true, flags: { invulnerable: true } });
    if (e.route) e.route.pts = null;
    e.atkCd = 0;
    rebirthCooldowns(e);
    setForm(b, e, 'form2', 'revive', { kind: 'reborn' });
  };
  return {
    killed(c, b, e, a) {
      if (a.state) return false;
      a.state = 'reborn';
      a.t0 = b.time;
      a.noAtk = e.profile.noAttack;
      rebirthCleanse(b, e);
      e.hp = Math.min(1, e.s.maxHp);
      if (onKo) safe(b, e, () => onKo(b, e, a));
      if (!(dur > 0)) { finish(b, e, a); return true; }
      e.profile.noAttack = true;
      b.addBuff(e, {
        key, duration: dur, visible: true, persist: true,
        flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true, stun: true },
        onTick: during ? ({ battle }) => during(battle, e, a, battle.time - a.t0) : null,
        onExpire: ({ battle }) => finish(battle, e, a),
      });
      setForm(b, e, 'reborn', 'telegraph', { r: 1, dur, kind: 'reborn' });
      return true;
    },
  };
}

/** 正面减伤: phys/arts damage from allies in front of the enemy (`a.facing` side) × (1 − cut); `face` updates a.facing. */
function frontGuard(cut, face) {
  return {
    spawn(b, e, a) { a.facing = -1; a.px = e.x; },
    tick(b, e, a) { face(b, e, a); },
    hitIn(c, b, e, a) {
      const s = c.source, ty = c.dmg.type;
      if (!s || s.side !== 'ally' || (ty !== 'phys' && ty !== 'arts') || !(cut > 0)) return;
      if ((s.x - e.x) * a.facing > 1e-6) c.dmg.mul *= Math.max(0, 1 - cut);
    },
  };
}
/** Faces its walking direction (horizontal component; keeps the last one while standing). */
const faceMove = (b, e, a) => { const dx = e.x - a.px; if (Math.abs(dx) > 1e-6) a.facing = dx > 0 ? 1 : -1; a.px = e.x; };
/** "始终面向我方干员数量较多的方向": the side with more deployed operators (ties keep the current facing; PRTS 圆仔 "无视其可选性":
 *  隐匿 operators count). */
const faceCrowd = (b, e, a) => {
  let l = 0, r = 0;
  for (const u of b.allies()) { if (u.kind !== 'op') continue; if (u.x > e.x + 1e-6) r++; else if (u.x < e.x - 1e-6) l++; }
  if (r !== l) a.facing = r > l ? 1 : -1;
};

/**
 * 失衡 (unbalanced movement): being pushed / pulled by operators. battle.displace() has no hook, so it is detected as
 * movement beyond the enemy's own route speed between two ticks (teleport legs excluded). `onMove(b, e, a, tiles)`.
 */
function unbalanced(onMove) {
  return {
    tick(b, e, a, dt) {
      const px = a.px, py = a.py, hid = a.hid;
      a.px = e.x; a.py = e.y; a.hid = e.hidden;
      if (px == null || hid || e.hidden) return;
      const own = e.s.moveSpeed * MOVE_SCALE * dt * 1.5 + 1e-3;
      const extra = Math.hypot(e.x - px, e.y - py) - own;
      a.lx = px; a.ly = py;                                          // where the move started (direction for onMove)
      if (extra > 0.05) onMove(b, e, a, extra);
    },
  };
}

/** An arts-only barrier ("吸收法术伤害的屏障") of `amount`; `a.left` = what is left, `refresh(b, e)` restores it. */
function artsBarrier(amount, { key = 'ab:artsBarrier', whileUp = null } = {}) {
  return {
    refresh(b, e, a) {
      a.left = amount;
      b.fx('phase', { x: e.x, y: e.y, id: e.id, kind: 'artsBarrier', value: amount });
      if (whileUp) b.addBuff(e, { key, persist: true, visible: true, mods: whileUp });
    },
    spawn(b, e, a) { if (amount > 0) a.refresh(b, e, a); },
    hitIn(c, b, e, a) {
      if (!(a.left > 0)) return;
      a.left -= absorbArts(c, a.left);
      if (a.left > 1e-6) return;
      a.left = 0;
      b.fx('shieldBreak', { x: e.x, y: e.y, id: e.id });
      // the bonus it grants ends once the overflow of the breaking hit has landed (never before: an HP bonus removed
      // first would rescale HP and make the overflow count twice)
      if (c.dmg.cancel) b.removeBuff(e, key); else a.breaking = true;
    },
    taken(c, b, e, a) { if (a.breaking) { a.breaking = false; b.removeBuff(e, key); } },
  };
}

/**
 * "被击倒时暂时变为…，一段时间后重生" (talent Revive[Trigger]: 逐火 embers, 假想敌：再生's puppet). A knock-out of the first form is
 * no kill (credit, bounty and the kill count wait for the real death): HUSK_REBIRTH s of 重生 first — statuses cleared
 * (rebirthCleanse: a feared warrior is no unblockable ember), invulnerable, untargetable, unblockable, immobile, 失衡免疫
 * (PRTS 深池逐火战士 天赋 "被击倒后重生，持续1s，随后变为怨恨的余烬，1s内不移动且持有无敌+无法阻挡+失衡免疫"; PRTS 特殊机制 §重生) —
 * then the husk until `delay` s after that: `hits` HP of 特殊生命值机制 (every damage instance removes 1 — PRTS 特殊机制
 * §特殊生命值机制; engine flag hitCount), no attack (缴械), walking its route on — 隐匿 (`stealthy`: targetable only while
 * blocked and for 3 s after a block ends, the block the knock-out itself releases included — targeting.js
 * enemyStealthed; drawn solid meanwhile) and / or unblockable (`unblock`: 再生's 傀儡 "不可被阻挡"). Killing the husk is
 * the real death; a husk still standing after `delay` s stands up in its first form with full HP, and every later
 * knock-out starts it again ("一次又一次地站起").
 * `onHusk(b, e)` runs as the husk begins, after the 重生 ("进入此形态时": 再生's shields).
 * User report after 0.1.0 (#8): the v2.5 ember stood still, stealthed AND unblockable — nobody could ever target it.
 * fx (setForm): 'ember' {id, hits, dur, form: 'husk'} at the knock-out, 'revive' {id, form: 'revived'} when it stands
 * up (the renderer switches the model's clip set: render/units.js FORMS).
 */
function husk({ hits, delay, stealthy = true, unblock = false, onHusk = null, key = 'ab:ember' }) {
  const revive = (b, e, a) => {
    if (!e.alive || a.state !== 'husk') return;
    a.state = null;
    hitCount(b, e, false);
    e.base.maxHp = a.max;
    e.markDirty();
    void e.s;
    e.hp = e.s.maxHp;
    e.profile.noAttack = a.noAtk;
    b.removeBuff(e, key);
    b.removeBuff(e, `${key}:reborn`);
    if (e.route) e.route.pts = null;
    e.atkCd = 0;
    setForm(b, e, 'revived', 'revive');
  };
  return {
    killed(c, b, e, a) {
      // an HP loss (流失 bypasses 无敌) during the 1 s 重生 cannot cut it short
      if (a.state === 'husk' && b.time < a.rebornUntil) { e.hp = e.s.maxHp; return true; }
      if (a.state === 'husk' || !(hits > 0) || !(delay > 0)) return false;   // the husk's knock-out is the real death
      a.state = 'husk';
      a.rebornUntil = b.time + HUSK_REBIRTH;
      a.noAtk = e.profile.noAttack;
      a.max = a.max ?? e.base.maxHp;
      rebirthCleanse(b, e);
      e.profile.noAttack = true;
      e.lastAttackAt = -Infinity;                         // the snapshot shows no attack of the fallen warrior
      setHits(e, hits);
      hitCount(b, e, true);
      b.addBuff(e, { key, visible: true, persist: true, flags: { disarm: true, ...(stealthy ? { stealth: true } : {}), ...(unblock ? { unblockable: true } : {}) } });
      b.addBuff(e, { key: `${key}:reborn`, duration: HUSK_REBIRTH, flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true, noDisplace: true } });
      // the 重生's 无法阻挡 ends a block at once (as applyStatus does for a status): a warrior knocked out while blocked
      // leaves an ember whose 隐匿 is switched off until STEALTH_RESTORE (3) s after that block ended
      // (Battle._stealthSwitch) — ~2 s after the 1 s 重生, which stays 无敌 + untargetable — so ranged operators and
      // operator splash can finish it although its blocker took the next warrior meanwhile (players after 0.1.1: "the
      // stealth monster revives forever"). [ASSUMED] the order: the 重生's cleanse first, then the ember's 隐匿 with the
      // block-end switch (PRTS documents neither the order of 重生 vs that switch nor whether it survives the 重生)
      b._unblock(e);
      if (e.route) e.route.pts = null;
      setForm(b, e, 'husk', 'ember', { hits, dur: HUSK_REBIRTH + delay });
      b.after(HUSK_REBIRTH, () => { if (e.alive && a.state === 'husk') { rebirthCooldowns(e); if (onHusk) onHusk(b, e); } }, { owner: e });
      b.after(HUSK_REBIRTH + delay, () => revive(b, e, a), { owner: e });
      return true;
    },
  };
}

/**
 * 守墓石像 / 愤怒的守墓石像 (PRTS 天赋): 地面模式 — melee attacks only while blocked; the first defeat is an instant 重生
 * (statuses cleared: rebirthCleanse) to 100 % HP into 转换模式 for stone.duration s — "无法被阻挡，自缚，失衡免疫，免疫浮空。
 * 防御力增加800，法术抗性增加30", no attack [ASSUMED: PRTS lists none] — then 飞行模式, "变为飞行单位，失衡免疫": a flyer
 * no push or pull moves, whose ranged attacks (the data's 1.6 radius) deal arts damage and never target flyers; the HP is
 * not refilled again. Its pages list no 静态刚体 (data `staticBody` stays off), so the 失衡免疫 of the flight is a persistent
 * `noDisplace` buff. 浮空 is refused from the statue on (`ab.immune`; data flyers refuse it anyway). [ASSUMED] a 浮空 it
 * already carries at the knock-out runs out. fx forms 'stone' / 'fly' (its Sleep and *_2 clips, render/units.js FORMS).
 * <破碎支柱> (an event device) has no counterpart in this mode.
 */
function statue(ab) {
  const dur = T(ab, 'stone.duration') ?? 0;
  return {
    spawn(b, e) { e.profile.melee = true; },
    killed(c, b, e, a, ab2) {
      if (a.done || !(dur > 0)) return false;
      a.done = true;
      a.noAtk = e.profile.noAttack;
      rebirthCleanse(b, e);                                 // "进行重生。重生瞬间完成"
      rebirthCooldowns(e);
      e.profile.noAttack = true;
      e.hp = e.s.maxHp;
      ab2.immune = new Set([...(ab2.immune || []), 'levitate']);
      setForm(b, e, 'stone', 'stone', { dur });
      b.addBuff(e, {
        key: 'ab:stone', duration: dur, visible: true, flags: { noMove: true, selfBound: true, unblockable: true, noDisplace: true },
        mods: { defFlat: T(ab, 'stone.def') ?? 0, resFlat: T(ab, 'stone.magic_resistance') ?? 0 },
        onExpire: ({ battle }) => {
          if (!e.alive) return;
          e.motion = 'FLY';
          Object.assign(e.profile, { noAttack: a.noAtk, melee: false, dmgType: 'arts', canTarget: (u) => !u.isFlying });
          battle.addBuff(e, { key: 'ab:flight', persist: true, flags: { noDisplace: true } });
          if (e.route) e.route.pts = null;
          setForm(battle, e, 'fly', 'revive', { kind: 'fly' });
        },
      });
      return true;
    },
  };
}

/**
 * Bleeding on hit (逐腐兽): arts damage per second, removed by healing. A tick selects nobody (`ignoreSelect`): it keeps
 * hurting an ally that took off (起飞) after the bleed landed; so do the other enemy debuff DoTs (沙狱, burnDot, 淤困).
 */
function bleed(ab) {
  const dmg = T(ab, 'Bleeding.attack@bleeding_damage') ?? 0, dur = T(ab, 'Bleeding.attack@duration') ?? 0;
  return {
    dealt(c, b, e) {
      if (!(dmg > 0 && dur > 0)) return;
      b.addBuff(c.target, {
        key: 'ab:bleed', duration: dur, refresh: 'replace', interval: 1, visible: true,
        onTick: ({ battle, unit }) => battle.dealDamage(e, unit, { amount: dmg, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'bleed'] }),
      });
    },
  };
}

/**
 * 【污染秽蚀】 zone (PRTS 萨卡兹枯朽战士 / 萨卡兹枯朽战车: "范围内位于低地/高地的我方干员和召唤物每秒受到50/25点真实普通伤害
 * （可对空，无视无法选择、迷彩；同名效果不叠加）"): `low` true damage per second on low ground, `high` on high ground, to every
 * ally inside (flyers, stealthed, untargetable and airborne 起飞 ones included — `ignoreSelect`; an airborne 蒂比 stands on
 * her low tile: `low`); a unit inside several zones takes one tick per second (`mem.pollutedAt`: the last tick it took).
 */
function pollution(b, src, x, y, r, life, low, high) {
  zone(b, { x, y, r, life, iv: POLLUTION_INTERVAL, kind: 'pollution', tick(units) {
    for (const u of units) {
      const v = u.ground ? low : high;
      if (!(v > 0) || b.time - (u.mem.pollutedAt ?? -Infinity) < POLLUTION_INTERVAL - 1e-6) continue;
      u.mem.pollutedAt = b.time;
      hurt(b, src, u, v, 'true', { tags: ['pollution'], ignoreSelect: true });
    }
  } });
}

/**
 * Damage zone (`amount` per tick, tagged `kind`). Unlike 【污染秽蚀】 it does not ignore 无法选择: it ticks on the allies
 * its area selection takes (areaAllies: no unblocking 隐匿, untargetable or sleeping ally; no airborne 起飞 one for a ground
 * enemy — PRTS 集团军重型火炮 【燃烧区域】 "碰撞不受迷彩制约，不可对空": 迷彩 only). A sourceless zone (`src` null: 假想敌：蚀裂's
 * 毒雾, an enemy's 死亡爆炸 with no 无视可选性 note on PRTS) selects as an effect with no selecting enemy: 隐匿 kept out, an
 * airborne 起飞 ally reached (§21.22; until 0.1.2 it took everyone inside). `noAir`: "不可对空" — a flying ally (the 炎佑
 * dragon) is skipped too (集团军重型火炮's 【燃烧区域】, since 0.1.3).
 */
function dmgZone(b, src, x, y, r, life, iv, amount, type = 'arts', kind = 'zone', el = null, elAmount = 0, { noAir = false } = {}) {
  zone(b, { x, y, r, life, iv, kind, pick: (zx, zy, zr) => areaAllies(b, src, zx, zy, zr).filter((u) => !(noAir && u.isFlying)), tick(units) {
    for (const u of units) {
      hurt(b, src, u, amount, type, { tags: [kind] });
      if (el && elAmount > 0) elem(b, src, u, el, elAmount, { tags: [kind] });
    }
  } });
}

/** A cooldown skill ability (`id` labels it for tests / other abilities). */
const skill = (s, fire, { cond = null, sil = false, cd = null, icd = null, id = null } = {}) => (s || cd != null) && fire ? ({
  id: id ?? null, sil, cd: cd ?? s.cd, icd: icd ?? s.icd, cond, fire,
}) : null;

/** Blink past the blocker along the path (弑君者 / 卢西恩). Returns the start position. */
export function blinkForward(b, e, dist) {
  const from = { x: e.x, y: e.y };
  const R = e.route;
  let left = dist;
  if (R && R.pts && R.ptIdx < R.pts.length) {
    let i = R.ptIdx;
    while (left > 1e-9 && i < R.pts.length) {
      const p = R.pts[i];
      const d = Math.hypot(p.x - e.x, p.y - e.y);
      if (d <= left) { e.x = p.x; e.y = p.y; left -= d; i++; } else { stepToward(e, p.x, p.y, left); left = 0; }
    }
  } else if (R && R.legs && R.legs[R.legIdx] && R.legs[R.legIdx].r != null) {
    const L = R.legs[R.legIdx];
    stepToward(e, L.c, L.r, dist);
  }
  // never end inside a wall
  if (!b.grid.groundPassable(Math.round(e.y), Math.round(e.x)) && e.motion !== 'FLY') { e.x = from.x; e.y = from.y; return null; }
  b.addBuff(e, { key: 'ab:blink', duration: 1, flags: { invulnerable: true, unblockable: true } });
  if (R) R.pts = null;
  b.fx('blink', { x: e.x, y: e.y, id: e.id, fx: from.x, fy: from.y });
  return from;
}

// ---------------------------------------------------------------------------------------------------------------
// kits by archetype (functions reused by several keys)

const kitEp = (el, ...keys) => (ab) => [ep(el, T(ab, ...keys) ?? 0)];
const kitStealth = () => [stealth()];
const kitTimes = (artsOnly = false) => () => [times(artsOnly), unblockable()];
const kitRefraction = (ab) => [refraction(T(ab, 'refracting.magic_resistance', 'Refracting.magic_resistance') ?? 0)];
const kitPrisoner = (freeAll = false) => (ab) => [prisoner(ab, { freeAll })];
const kitDeathSpawn = (extra = []) => (ab) => [deathSpawn(ab.tS['DeadSpawn.enemy_key'], T(ab, 'DeadSpawn.cnt') ?? 0), ...extra];
const kitStun3 = (ab) => [nthAttackStatus(nthOf(ab.sk.stuncombat), 'stun', (ab.sk.stuncombat && ab.sk.stuncombat.bb.stun) || 0, true)];
const kitSelfFear = (ab) => [selfFear(ab)];
/** 深池逐火战士 / 精锐战士 / 护卫: knock-out ⇒ 1 s 重生 ⇒ a walking, 隐匿, disarmed 余烬 / 火灰 of prop_max_hp hits for `interval` s
 *  (PRTS 深池逐火战士 天赋: "基础最大生命值临时变为5…具有特殊生命值机制，不进行攻击，获得隐匿、缴械，10s后若未被击倒则变回战士形态并恢复所有
 *  生命"); blocking it lifts the 隐匿, so its blocker (and every operator in range) can beat it — also during the 3 s
 *  after a block ends, the warrior's own block that the knock-out releases included (Battle._stealthSwitch). */
const kitEmber = (ab) => [husk({ hits: T(ab, 'Revive[Trigger].prop_max_hp'), delay: T(ab, 'Revive[Trigger].interval') })];
const kitPolluted = (ab) => [{
  death(c, b, e) {
    if (c.reason !== 'killed') return;
    pollution(b, e, e.x, e.y, T(ab, 'PollutedDie.projectile_range') ?? 1, T(ab, 'PollutedDie.projectile_life_time') ?? 0,
      T(ab, 'PollutedDie.polluted_damage_low') ?? 0, T(ab, 'PollutedDie.polluted_damage_high') ?? 0);
  },
}];

function kitPhalanx(ab, e) {
  const def = T(ab, 'auraDefup.def') ?? 0;
  const r = (e.def.raw && e.def.raw.stats && e.def.raw.stats.rawRangeRadius) || 1.5;
  return [...kitRefraction(ab), {
    iv: 0.5,
    tick(b, e2) {
      let n = 0;
      for (const o of b.enemiesInRadius(e2.x, e2.y, r)) if (o !== e2 && o.defId === e2.defId) n++;
      if (n > 0) auraBuff(b, e2, 'ab:phalanx', 0.5, { defFlat: def * n });
    },
  }];
}

function kitBlades(ab) {
  const cnt = T(ab, 'DeadSpawn.cnt') ?? 0, add = T(ab, 'DeadSpawn.cnt_add') ?? 0, atk = T(ab, 'Atkup.atk', 'AtkUp.atk') ?? 0;
  const key = ab.tS['DeadSpawn.enemy_key'];
  return [{
    spawn(b, e, a) { a.used = 0; },
    attack(c, b, e, a) {
      if (a.used >= cnt) return;
      a.used++;
      b.addBuff(e, { key: 'ab:blade', refresh: 'stack', stacks: 1, maxStacks: Math.max(1, cnt), mods: { atkPct: atk }, persist: true, visible: true });
    },
    death(c, b, e, a) { if (c.reason === 'killed' && key) spawnChildren(b, e, key, Math.max(1, cnt + add * a.used)); },
  }];
}

function kitDeepsea(ab, { swim = false, drown = false }) {
  return [{
    iv: 0.25,
    spawn(b, e) { if (swim) e.mem.immuneDrown = true; },
    tick(b, e, a, dt) {
      const wet = onTerrain(b, e, 'deepsea');
      if (swim) {
        if (wet && !a.wet) b.addBuff(e, { key: 'ab:swim', mods: { atkPct: T(ab, 'Swim.atk') ?? 0 }, flags: { stealth: true }, visible: true });
        if (!wet && a.wet) b.removeBuff(e, 'ab:swim');
        if (wet) b.removeBuff(e, 'terrain:deepsea');   // 免疫水蚀: drop devices.js' deep-water debuff
      }
      // PRTS 码头水手 "水蚀状态下或处于清澈水域时，每秒受到1000点无来源真实伤害" (伤害分类: 深水区/涨潮水蚀 is BUFF damage):
      // damage, not a 流失 — 脆弱 scales it (player report D1 audit)
      if (drown && wet) { const v = T(ab, 'Drown.damage') ?? 0; if (v > 0) b.dealDamage(null, e, { ...periodicDamage(v * dt), tags: ['dot', 'periodic', 'drown'] }); }
      a.wet = wet;
    },
    // 免疫水蚀: the deep-water tick (devices.js, tag 'deepsea') and drowning — not 环境伤害 ('terrain', e.g. 活性源石)
    hitIn(c, b, e, a) { if (swim && a.wet && c.dmg.tags && c.dmg.tags.some((t) => t === 'deepsea' || t === 'drown')) c.dmg.cancel = true; },
  }];
}

/** 源石污染区 (act1 m04 infection tiles). */
function infectionArts() {
  return { hitOut(c, b, e) { if (c.dmg.isAttack && onTerrain(b, e, 'infection')) c.dmg.type = 'arts'; } };
}

function kitChimera(ab) {
  const dmg = T(ab, 'OrigAura.damage') ?? 0, spr = T(ab, 'OrigAura.sp_recover_ratio') ?? 0;
  const activate = (b, e, a) => {
    if (a.on || !onTerrain(b, e, 'infection')) return;
    a.on = true;
    e.mem.ab.atkType = 'arts';
    b.fx('telegraph', { x: e.x, y: e.y, r: CHIMERA_AURA_RADIUS, kind: 'chimera', id: e.id });
  };
  return [{
    hitOut(c, b, e, a) { if (c.dmg.isAttack && !a.on) { activate(b, e, a); if (a.on) c.dmg.type = 'arts'; } },
    iv: 0.25,
    tick(b, e, a) {
      activate(b, e, a);
      if (!a.on) return;
      a.acc = (a.acc ?? 0) + 0.25;
      const pulse = a.acc >= CHIMERA_AURA_EVERY - 1e-9;
      if (pulse) a.acc -= CHIMERA_AURA_EVERY;
      for (const u of b.alliesInRadius(e.x, e.y, CHIMERA_AURA_RADIUS)) {
        auraBuff(b, u, 'ab:originium', 0.25, { spRecoveryMul: Math.max(0, 1 + spr) }, null, true);
        // PRTS "持续视为受到源石污染区影响…每0.5秒受到50真实持续伤害": a damage instance (受击回复, the 重装 trigger), not a
        // 流失 — 无来源 like the 源石污染区 terrain it stands for [ASSUMED], the chimera keeps the credit; "同类效果取最高": one
        // tick per unit per period however many chimeras reach it (`mem.chimeraAt`; every chimera's is 50). A terrain
        // effect, not an area selection: 隐匿 allies inside are reached too ("所有单位" [ASSUMED], DESIGN §22.12)
        if (!pulse || !(dmg > 0) || b.time - (u.mem.chimeraAt ?? -Infinity) < CHIMERA_AURA_EVERY - 1e-6) continue;
        u.mem.chimeraAt = b.time;
        b.dealDamage(e, u, { ...periodicDamage(dmg), tags: ['dot', 'pollution'] });
      }
    },
  }];
}

function kitNazg(ab, e) {
  const r = (e.def.raw && e.def.raw.stats && e.def.raw.stats.rawRangeRadius) || e.base.rangeRadius || 1.3;
  return [{
    before(c, b, e2) {
      const l = targetsNear(b, e2, r);
      if (onTerrain(b, e2, 'infection')) for (const u of b.allies()) if (!l.includes(u) && onTerrain(b, u, 'infection') && canTargetAlly(e2, u, true)) l.push(u);
      if (l.length) c.targets = byPriority(e2, l);
    },
  }];
}

function kitTidmag(ab) {
  return [ep('erosion', T(ab, 'EpDamage.attack@ep_damage_ratio') ?? 0), {
    before(c, b, e) {
      // PRTS 控潮术师 "对目标所在地块及周围四格内的所有我方单位造成法术普通伤害": the 周围四格 are an area selection (格子判定:
      // a 迷彩 ally is hit; an unblocking 隐匿 or an airborne 起飞 one is not — areaAlliesInTiles)
      const t0 = c.targets[0];
      if (!t0) return;
      const l = c.targets.slice();
      for (const u of areaAlliesInTiles(b, e, t0.tileR, t0.tileC, 'plus', 1)) if (!l.includes(u)) l.push(u);
      c.targets = l;
    },
  }];
}

/** 深溟巢涌者 / 富营养的巢涌者: one pulse every second (PRTS "每秒"; not its attack interval, so 攻速 changes leave it alone). */
const NEST_PULSE_INTERVAL = 1;
const NEST_PULSE_TAG = 'nestPulse';
/**
 * 深溟巢涌者 / 富营养的巢涌者 (PRTS 天赋): "不进行普通攻击", 抵抗 (一减状态抵抗率 −0.5) and 停顿免疫; "未处于消失状态时，令攻击范围
 * 内的所有我方单位每秒受到攻击力100%的无途径法术伤害" and "每次输出伤害时，再造成攻击力5%的神经损伤" (`EpDamage.ep_damage_ratio`).
 * A talent aura, not an attack: `noAttack`, so it walks on while it hurts (ai.js attackStand holds only attackers — until
 * 0.1.3 the pulse was its normal attack, which made it stand for its whole 1 s clip whenever an ally was in range:
 * community report 「…错误的设置了攻击时不移动导致卡在原地」, GitHub #93), needs no target and pauses while it is hidden on a
 * DISAPPEAR leg (消失). The pulse is an area selection (areaAllies: a 迷彩 ally and a flying one — the 炎佑 dragon — are
 * hit, a 隐匿 one is not) of radius `rangeRadius` around its centre, like 鼎沸's. [ASSUMED] the pulse can be dodged (闪避:
 * PRTS names no attack type, which the site reads as 普通伤害 — the 烹泉 splash rule) and a dodged one adds no 神经.
 */
function kitDsubrl(ab, e) {
  const ratio = T(ab, 'EpDamage.ep_damage_ratio') ?? 0;
  return [resist(['sluggish']), {
    spawn(b, e2) {
      e2.profile.noAttack = true;
      // 每次输出伤害时: every pulse that reaches the unit (not dodged, not cancelled — the old attack's `dealt` rule)
      if (ratio > 0) b.on('damaged', (c) => { if (c.source === e2 && c.dmg && c.dmg.tags.includes(NEST_PULSE_TAG)) elem(b, e2, c.target, 'neural', e2.s.atk * ratio); }, { owner: e2 });
    },
    iv: NEST_PULSE_INTERVAL,
    tick(b, e2) {
      if (e2.hidden) return;
      const r = e2.base.rangeRadius || 1.6;
      const l = areaAllies(b, e2, e2.x, e2.y, r);
      if (!l.length) return;
      b.fx('pulse', { x: e2.x, y: e2.y, r, id: e2.id, element: 'neural' });
      for (const u of l) hurt(b, e2, u, e2.s.atk, 'arts', { canDodge: true, tags: [NEST_PULSE_TAG] });
    },
  }];
}

/** 掠海漂移体 爬行模式: the stun it takes on dropping (PRTS "进入爬行模式并晕眩0.5秒"; not in its blackboard). */
const SYUFO_CRAWL_STUN = 0.5;
/** 吉兆飞鳞 【失温坠落】: the stun when a freeze ends (PRTS "冻结结束时，获得0.05秒晕眩"). */
const PARROT_CHILL_STUN = 0.05;

/**
 * 掠海漂移体 (PRTS): 初始模式 近地悬浮 + 失衡免疫, 不会攻击飞行单位; 受晕眩/无法行动/沉睡/冻结/缚地影响后进入爬行模式 for
 * good and is stunned 0.5 s — a ground unit (blockable, melee operators hit it) that "仅进行阻挡攻击" (only its blocker).
 * The engine has 晕眩 / 冻结 / 沉睡 (no operator here applies 无法行动 or 缚地). Erosion on every attack.
 */
function kitSyufo(ab) {
  return [float(), ep('erosion', T(ab, 'EpDamage.attack@ep_damage_ratio') ?? 0), {
    spawn(b, e) { e.profile.canTarget = (u) => !u.isFlying; },
    status(c, b, e, a) {
      if (a.crawl || !(c.status === 'stun' || c.status === 'freeze' || c.status === 'sleep')) return;
      a.crawl = true;
      setFloat(b, e, false);
      e.profile.melee = true;
      b.applyStatus(e, 'stun', { duration: SYUFO_CRAWL_STUN, source: null });
      setForm(b, e, 'crawl');
    },
  }];
}

/**
 * 吉兆飞鳞 (PRTS): 近地悬浮 (失衡免疫), no normal attack; 受晕眩/无法行动/沉睡/缚地影响后进入晕眩模式 — the float is off, it
 * cannot be blocked and is stunned `Stun.duration` (8) s — and floats again once none of those effects holds it
 * (初始模式); 冻结 grounds it only when the freeze ends (【失温坠落】: 0.05 s stun). 首次受到伤害后 its speed is ×
 * `M0SpeedUp.move_speed` for `M0SpeedUp.duration` s ("最终提升至300%"; never in 晕眩模式, dropped when its mode
 * changes). 搬运模式 (carrying a 寻险水手) needs a level checkpoint (`ThrowEnemy.checkpoint` 0 = never) — not in this mode.
 */
function kitParrot(ab) {
  const down = T(ab, 'Stun.duration') ?? 0;
  return [float(), {
    taken(c, b, e, a) {
      if (a.ran || a.down) return;
      a.ran = true;
      b.addBuff(e, { key: 'ab:parrotRun', duration: T(ab, 'M0SpeedUp.duration') ?? 0, mods: { moveMul: T(ab, 'M0SpeedUp.move_speed') ?? 1 } });
    },
    status(c, b, e, a) {
      if (c.status === 'freeze') { a.chill = true; return; }
      if (a.down || !(c.status === 'stun' || c.status === 'sleep')) return;
      a.down = true;
      setFloat(b, e, false);
      b.removeBuff(e, 'ab:parrotRun');
      b.addBuff(e, { key: 'ab:parrotDown', flags: { unblockable: true }, persist: true });
      if (down > 0) b.applyStatus(e, 'stun', { duration: down, source: null });
      b.fx('phase', { x: e.x, y: e.y, id: e.id, kind: 'grounded' });
    },
    tick(b, e, a) {
      if (a.chill && !e.s.flags.freeze) { a.chill = false; b.applyStatus(e, 'stun', { duration: PARROT_CHILL_STUN, source: null }); }
      // "离开上述异常效果影响后进入初始模式": s.flags.stun also holds while asleep / frozen (units.js), so a sleep that
      // outlasts the mode stun keeps it down
      if (a.down && !e.s.flags.stun) {
        a.down = false;
        b.removeBuff(e, 'ab:parrotDown');
        b.removeBuff(e, 'ab:parrotRun');
        setFloat(b, e, true);
        b.fx('phase', { x: e.x, y: e.y, id: e.id, kind: 'float' });
      }
    },
  }];
}

/**
 * 萨卡兹枯朽战车 / 尖端 (PRTS; enemy_database spData "初始技力 2 / 技力上限 2 / 攻击回复"): an attack made with full SP is the
 * skill 秽蚀轰击 — "对目标造成100%物理普通伤害，同时在目标位置生成半径1.7，持续10s的【污染秽蚀】" — and empties the SP; every
 * other attack gains 1. Initial SP = max, so the FIRST attack is the skill, then every 3rd (attacks 1, 4, 7 …). Talent:
 * "普通攻击只攻击位于低地的我方单位，且不会攻击飞行单位" (a candidate filter, ai.js enemyAttack: a FLY ally such as the 炎佑 dragon on a
 * low tile is no target either); "被阻挡时进行近战攻击，造成攻击力200%的伤害" — normal attacks on its blocker ×chuang_atk_scale.
 * [ASSUMED] the skill also fires on its blocker and deals the skill's own 100 % there (PRTS names no blocked exception:
 * enemy SP skills fire as soon as they are ready and its condition — a low-ground non-flying ally within 2.2 — holds for
 * the blocker), so a blocked tank hits 100 / 200 / 200 % … (v2.4.1: 200 % on every attack, the skill included).
 * Reach: the 2.2 range circle takes an ally whose 0.25 collider touches it (ai.js enemyAttack, constants.js
 * ALLY_COLLIDER_RADIUS; PRTS 作战机制 §碰撞体积) — 2.45 from the ally's centre, 21 tiles around it instead of 13 (user
 * playtest #6 follow-up: the user remembers a long-reaching, hard-hitting ranged attack; the data scale stays 100 %).
 */
function kitTank(ab, e) {
  const melee = T(ab, 'Empty.attack@chuang_atk_scale') ?? 1;
  const sk = ab.sk.PollutedRangedAtk || null;
  const s = sk ? sk.bb : {};
  const spd = (e.def.raw && e.def.raw.sp) || null;
  const max = Math.max(1, num(spd && spd.maxSp, 0) || (sk && sk.sp) || (T(ab, 'Empty.sp') ?? 2));
  const init = Math.min(max, Math.max(0, num(spd && spd.initSp, 0)));
  return [{
    spawn(b, e2, a) { a.sp = init; a.skill = false; e2.profile.canTarget = (u) => !!u.ground && !u.isFlying; },
    // SP full: this attack is 秽蚀轰击 (a blocked hit lands at once, inside this attack, while `a.skill` is set)
    before(c, b, e2, a) { a.skill = a.sp >= max; },
    hitOut(c, b, e2, a) { if (c.dmg.isAttack && !a.skill && c.target === e2.blockedBy) c.dmg.amount *= melee; },
    attack(c, b, e2, a) {
      if (!a.skill) { a.sp = Math.min(max, a.sp + 1); return; }
      a.skill = false;
      a.sp = 0;
      const t = c.targets[0];
      if (t) pollution(b, e2, t.x, t.y, TANK_ZONE_RADIUS, s.projectile_life_time ?? 0, s.polluted_damage_low ?? 0, s.polluted_damage_high ?? 0);
    },
  }];
}

function kitDeathEye(ab, e) {
  const s = ab.sk.DeathEye;
  const r = e.base.rangeRadius || 2.5;
  return [ep('apoptosis', T(ab, 'empty.attack@ep_damage_ratio') ?? 0), skill(s, (b, e2, a) => {
    const t = byPriority(e2, targetsNear(b, e2, r))[0];
    if (!t) return;
    const dur = s.bb.hit_duration ?? 0;
    b.addBuff(e2, { key: 'ab:channel', duration: dur, flags: { disarm: true } });
    b.fx('beam', { x: e2.x, y: e2.y, from: e2.id, to: t.id, kind: 'deathEye', dur });
    let n = 0;
    const h = b.every(1, () => {
      if (!e2.alive) { h.cancel(); return; }
      // a stun / silence (SILENCE-flagged ability) or the locked target's fall interrupts the channel: no burst
      if (e2.s.flags.stun || e2.s.flags.silence || !t.alive) { h.cancel(); b.removeBuff(e2, 'ab:channel'); b.fx('beam', { x: e2.x, y: e2.y, from: e2.id, to: t.id, kind: 'deathEyeEnd' }); return; }
      hurt(b, e2, t, e2.s.atk * (s.bb.atk_scale ?? 0), 'arts');
      if (++n >= dur) {
        h.cancel();
        b.fx('explode', { x: t.x, y: t.y, r: 1, kind: 'apoptosis' });
        // "对目标及其周围4格的我方单位": the locked target (a 隐匿 it gained mid-channel does not save it) + an area around it
        for (const u of targetAndArea(t, areaAllies(b, e2, t.x, t.y, 1))) elem(b, e2, u, 'apoptosis', e2.s.atk * (s.bb.ep_damage_ratio ?? 0));
      }
    }, { owner: e2 });
  }, { sil: true, cond: (b, e2) => targetsNear(b, e2, r).length > 0 })];
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

function kitCrossbow(ab) {
  const s = ab.sk.CrossAttack;
  const aligned = (b, e) => b.allies().filter((u) => canTargetAlly(e, u, true) && (Math.abs(u.y - e.y) < 0.5 || Math.abs(u.x - e.x) < 0.5) && Math.hypot(u.x - e.x, u.y - e.y) <= CROSS_REACH);
  const nearest = (b, e, l) => l.sort((p, q) => Math.hypot(p.x - e.x, p.y - e.y) - Math.hypot(q.x - e.x, q.y - e.y))[0];
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
  }, { sil: true, cond: (b, e) => aligned(b, e).length > 0 })];
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
    // priority: the blocker first), floor(10.6 / 0.5) = 21 ticks at 0.5 … 10.5 s. The channel also ends when that target
    // is gone, makes no normal attacks meanwhile and is never re-cast over itself — the 10 s cooldown (enemy_database
    // skill 'fire') runs out mid-channel, the next cast waits for its end [ASSUMED "持续施法", as 死亡之眼].
    sil: true, cd: s.cd, icd: s.icd, cond: (b, e2) => revealed(e2) && !(e2.mem.jazzChannel && !e2.mem.jazzChannel.cancelled) && targetsNear(b, e2, r).length > 0,
    fire(b, e2) {
      const dur = s.bb['enemy_cnvsax[cd].duration'] ?? 0, iv = s.bb.hit_interval ?? 0.5;
      const t = byPriority(e2, targetsNear(b, e2, r))[0];
      if (!t || !(dur > 0) || !(iv > 0)) return;
      const n = Math.max(1, Math.floor(dur / iv + 1e-9));
      const buff = b.addBuff(e2, { key: 'ab:channel', duration: dur, flags: { disarm: true } });
      let k = 0;
      const end = () => { h.cancel(); e2.mem.jazzChannel = null; if (buff) b.removeBuff(e2, buff); };
      const h = b.every(iv, () => {
        if (!e2.alive || e2.s.flags.silence || !t.alive || !t.deployed) { end(); return; }
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
      if (partner && Math.hypot(partner.x - e.x, partner.y - e.y) <= r + 1e-9 && e.base.bat > 0) auraBuff(b, e, 'ab:shadowSync', 0.5, { batPct: bat / e.base.bat });
    },
  }];
}

function kitHolyGuard(ab) {
  const r = T(ab, 'traitAbility.range_radius') ?? 1.1, aspd = T(ab, 'traitAbility.attack_speed') ?? 0;
  return [...kitRefraction(ab), {
    iv: 0.5,
    tick(b, e) {
      const on = b.enemiesInRadius(e.x, e.y, r).some((o) => /enemy_1175_dushdo/.test(o.defId));
      if (!on) return;
      // a buff aura (auraAllies): no 隐匿 operator, the blocker included (PRTS 作战机制 §隐匿与Buff的关系 — no 无视 note on
      // its page), but an airborne 起飞 one still [ASSUMED, as §21.22's ground-enemy auras]
      for (const u of auraAllies(b, e, e.x, e.y, r)) auraBuff(b, u, 'ab:forceField', 0.5, { aspd }, null, true);
    },
  }];
}

function kitRush(ab) {
  const ms = T(ab, 'rush.dlancer_t[trigger].move_speed') ?? 0, iv = T(ab, 'rush.dlancer_t[trigger].interval') ?? 0.5;
  const max = T(ab, 'rush.dlancer_t[trigger].trig_cnt') ?? 0, first = T(ab, 'firstattack.atk_scale') ?? 0;
  return [{
    iv,
    spawn(b, e, a) { a.n = 0; },
    tick(b, e, a) {
      if (!e.moving || e.blockedBy || a.n >= max) return;
      a.n++;
      b.addBuff(e, { key: 'ab:rush', mods: { moveMul: 1 + ms * a.n }, persist: true });
    },
    blocked(c, b, e, a) { a.charge = a.n; },
    hitOut(c, b, e, a) {
      if (!c.dmg.isAttack || !(a.charge > 0) || !(max > 0)) return;
      c.dmg.amount *= 1 + (first / 100) * (a.charge / max); // 被阻挡后的首次攻击: extra damage from the built-up speed
    },
    attack(c, b, e, a) { if (a.charge > 0) { a.charge = 0; a.n = 0; b.removeBuff(e, 'ab:rush'); } },
  }];
}

/**
 * 萨卡兹悖谬暴虐兵长: blocked only by a blocker with ≥ 3 free block; its first hit also strikes the units around its target
 * (PRTS 技能0 暴击 "对目标和周围4格的我方单位造成攻击力150%的物理普通伤害（无视无法选择，无视迷彩）※此技能仅能触发一次"):
 * the splash ignores 无法选择, so it reaches an airborne 起飞 ally too (`ignoreSelect`).
 */
function kitFirstAoe(ab) {
  const scale = T(ab, 'AOEAttack.atk_scale') ?? 0;
  return [blockWeight(3), {
    dealt(c, b, e, a) {
      if (a.done) return;
      a.done = true;
      b.fx('explode', { x: c.target.x, y: c.target.y, r: 1, kind: 'aoeAttack' });
      for (const u of b.alliesInRadius(c.target.x, c.target.y, 1)) {
        if (u !== c.target) hurt(b, e, u, e.s.atk * scale, 'phys', { ignoreSelect: true, tags: ['aoeAttack'] });
      }
    },
  }];
}

function kitDefDecay(ab) {
  const max = T(ab, 'def_reduce.max_stack_cnt') ?? 0, def = T(ab, 'def_reduce.def') ?? 0, res = T(ab, 'def_reduce.magic_resistance') ?? 0;
  return [{
    taken(c, b, e) {
      if (!(max > 0)) return;
      b.addBuff(e, { key: 'ab:defDecay', refresh: 'stack', stacks: 1, maxStacks: max, persist: true, mods: { defFlat: def / max, resFlat: res / max } });
    },
  }];
}

function kitExposeOnHit(ab) {
  const dur = T(ab, 'Expose.weak[limit]') ?? 0, scale = T(ab, 'Expose.damage_scale') ?? 1;
  return [{ sil: true, taken(c, b) { const s = c.source; if (s && s.side === 'ally' && s.alive && s.kind !== 'device') expose(b, s, dur, scale); } }];
}

/** 远眺: knocked out ⇒ 暴露 on every ally within r — PRTS 天赋 "（可被沉默；无视其可选性）": 隐匿 / untargetable ones too. */
function kitExposeOnDeath(ab) {
  const dur = T(ab, 'Expose.weak[limit]') ?? 0, scale = T(ab, 'Expose.damage_scale') ?? 1, r = T(ab, 'Expose.range_radius') ?? 1;
  return [{ sil: true, death(c, b, e) { if (c.reason !== 'killed') return; b.fx('explode', { x: e.x, y: e.y, r, kind: 'expose' }); for (const u of b.alliesInRadius(e.x, e.y, r)) expose(b, u, dur, scale); } }];
}

/**
 * 淤困's "受到的元素损伤提高至130%" on its host: an `elementHit` multiplier (SIM.md §7.2 — every "受到的元素损伤±N%"; on an
 * operator at priority 20, before a 损伤屏障), never 元素伤害. One battle-wide handler, installed with the first host.
 */
function ensureParasiteHook(b) {
  const st = stOf(b);
  if (st.parasiteHook) return;
  st.parasiteHook = true;
  b.on('elementHit', (c) => {
    const bf = c.target && c.dmg && c.dmg.type === 'element' ? c.target.findBuff('ab:parasite') : null;
    const m = bf && bf.data ? bf.data.epMul : 1;
    if (m > 0 && m !== 1) c.dmg.mul *= m;
  }, { priority: 20 });
}

function kitParasite(ab) {
  const scale = T(ab, '1.atk_scale') ?? 0, elMul = T(ab, '1.ep_damage_scale') ?? 1;
  return [taunt(-1), {
    iv: 0.2,
    tick(b, e, a) {
      const host = e.blockedBy && e.blockedBy.alive ? e.blockedBy : null;
      if (a.host && a.host !== host) { b.removeBuff(a.host, 'ab:parasite'); a.host = null; }
      if (!host || a.host === host) return;
      a.host = host;
      ensureParasiteHook(b);
      b.fx('beam', { x: e.x, y: e.y, from: e.id, to: host.id, kind: 'parasite' });
      b.addBuff(host, {
        // "受到的元素损伤提高至130%": a 元素损伤 multiplier on the element hit (ensureParasiteHook), not 元素伤害
        key: 'ab:parasite', visible: true, interval: 1, data: { src: e, spread: PARASITE_SPREAD, epMul: elMul },
        onTick: ({ battle, unit }) => { if (e.alive) battle.dealDamage(e, unit, { amount: e.s.atk * scale, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'parasite'] }); },
      });
    },
    death(c, b, e, a) { if (a.host) b.removeBuff(a.host, 'ab:parasite'); },
  }];
}

function kitBoneSpike() {
  return [stealth(), {
    before(c, b, e) {
      if (!enemyStealthed(e)) return;                             // 隐匿状态下同时攻击数个目标 (back 0 s after a block)
      const l = byPriority(e, targetsNear(b, e, e.base.rangeRadius));
      if (l.length) c.targets = l.slice(0, ACBUNN_TARGETS);
    },
  }];
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
  const maxAmmo = Math.max(1, num(e.def.raw && e.def.raw.sp && e.def.raw.sp.maxSp, 3));
  const grabR = (k ? num(k.bb.range_radius, 1.5) : 1.5) * GRAB_RADIUS_SCALE;
  const dur = k ? num(k.bb.duration, 4) : 4;
  const isPrey = (b, e2, o) => o !== e2 && o.alive && !o.hidden && o.isFlying && o.def.rank === 'NORMAL' && !o.isBoss && !o.findBuff('ab:devoured');
  const prey = (b, e2) => b.enemiesInRadius(e2.x, e2.y, grabR).filter((o) => isPrey(b, e2, o));
  return [
    skill(k, (b, e2) => {
      const list = prey(b, e2).sort((p, q) => Math.hypot(p.x - e2.x, p.y - e2.y) - Math.hypot(q.x - e2.x, q.y - e2.y)).slice(0, GRAB_MAX_PREY);
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
            e2.mem.ab.ammo = Math.min(maxAmmo, (e2.mem.ab.ammo ?? 0) + num(k.bb.sp, 1));
            b.kill(o, null);
          }, { owner: e2 });
        }
      }, { owner: e2 });
    }, { sil: true, cond: (b, e2) => prey(b, e2).length > 0 }),
    skill(f, (b, e2) => {
      const hits = Math.floor(e2.mem.ab.ammo ?? 0);
      if (!(hits > 0)) return;
      e2.mem.ab.ammo = 0;
      for (let i = 0; i < hits; i++) {
        const t = b.rng.pick(allTargets(b, e2));
        if (!t) break;
        b.fx('beam', { x: e2.x, y: e2.y, from: e2.id, to: t.id, kind: 'fireWeapon' });
        hurt(b, e2, t, e2.s.atk * num(f.bb.atk_scale, 1), 'phys');
      }
    }, { sil: true, cond: (b, e2) => (e2.mem.ab.ammo ?? 0) >= Math.max(1, num(f.sp, 1)) && allTargets(b, e2).length > 0 }),
  ];
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
      for (const o of b.enemiesInRadius(e.x, e.y, ACPUPP_AURA_RADIUS)) if (o !== e && block > 0) { const oab = abOf(b, o); oab.hitShield = Math.max(oab.hitShield, block); }
    },
  })];
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
 *  selection — every ally but an unblocking 隐匿 / untargetable / sleeping one (fieldAllies; no 无视无法选择). */
function kitRoar(ab) {
  const s = ab.sk.Roar;
  return [selfFear(ab), skill(s, (b, e) => {
    b.fx('telegraph', { x: e.x, y: e.y, r: 99, kind: 'roar', id: e.id });
    for (const u of fieldAllies(b, e)) b.addBuff(u, { key: 'ab:roar', duration: s.bb.duration ?? 0, refresh: 'extend', mods: { aspd: s.bb.attack_speed ?? 0 }, visible: true });
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
 * later and deals 100 % of the ATK at launch as physical damage without a source to every ally within SHELL_RADIUS
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
        b.fx('bombardShell', { x, y, id: e.id, r: SHELL_RADIUS, t: SHELL_FLIGHT });
        b.after(SHELL_FLIGHT, () => {
          b.fx('bombard', { x, y, r: SHELL_RADIUS, kind: 'emppnt' });
          for (const u of areaAllies(b, e, x, y, SHELL_RADIUS)) hurt(b, null, u, atk, 'phys', { isSkill: false, tags: ['shell'] });
        });
      }
    },
  }];
}

function kitIgnitable(ab) {
  return [deathBoom({ scale: T(ab, 'boom.atk_scale') ?? 0, type: 'arts', cond: (e) => !!e.mem.ab.ignited, sil: true })];
}

function kitFlameVine(ab) {
  const add = T(ab, 'pow.add_max_atk') ?? 0, time = T(ab, 'pow.time') ?? 0;
  const first = T(ab, 'pow.attack@ep_damage_ratio') ?? 0, normal = T(ab, 'pow.attack@ep_damage_ratio_normal') ?? 0;
  return [{
    iv: 0.5,
    spawn(b, e, a) { a.t0 = b.time; a.first = true; },
    tick(b, e, a) {
      if (!a.first || !(time > 0)) return;
      const k = Math.min(1, (b.time - a.t0) / time);
      b.addBuff(e, { key: 'ab:pow', mods: { atkPct: add * k }, persist: true });
    },
    dealt(c, b, e, a) {
      const t = c.target;
      if (a.first) {
        // 首次攻击 (PRTS 灼藤): every other ally of the target's 3×3 (range x-4, "格子判定，不受迷彩制约") takes 100 % ATK
        // arts splash and everyone there 25 % ATK burn — an area selection (no unblocking 隐匿 ally); then the ATK ramp
        // ends and later attacks add 20 %
        a.first = false;
        b.fx('explode', { x: t.x, y: t.y, r: 1.5, kind: 'flameVine' });
        for (const u of targetAndArea(t, areaAlliesInTiles(b, e, t.tileR, t.tileC, 'box', 1))) { if (u !== t) hurt(b, e, u, e.s.atk, 'arts'); elem(b, e, u, 'burn', e.s.atk * first); }
        b.removeBuff(e, 'ab:pow');
      } else elem(b, e, t, 'burn', e.s.atk * normal);
    },
    attack(c, b, e) {
      // ignites nearby 卷心籽
      for (const o of b.enemiesInRadius(e.x, e.y, 1.5)) if (o.defId === 'enemy_10065_ftzlc' && o.mem.ab && !o.mem.ab.ignited) { o.mem.ab.ignited = true; b.fx('ignite', { x: o.x, y: o.y, id: o.id }); }
    },
  }];
}

function kitDekght(ab) {
  const rage = { atkPct: T(ab, 'triggerrage.atk') ?? 0, aspd: T(ab, 'triggerrage.attack_speed') ?? 0, moveMul: 1 + (T(ab, 'triggerrage.move_speed') ?? 0) };
  const partnerRage = {
    otherDeath(c, b, e, a) {
      const u = c.unit;
      if (a.raged || !u || u === e || !/enemy_1513_dekght/.test(u.defId || '')) return;
      a.raged = true;
      b.addBuff(e, { key: 'ab:rage', mods: rage, persist: true, visible: true });
    },
    spawn(b, e) { watchDeaths(b, e); },
  };
  return partnerRage;
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

function kitNucleus(ab) {
  return [{
    taken(c, b, e, a) { if (a.on) return; a.on = true; b.addBuff(e, { key: 'ab:combat', persist: true, visible: true, mods: { moveMul: T(ab, '0.move_speed') ?? 1 } }); },
    iv: T(ab, '1.interval') ?? 1,
    // 【孽生者的神经毒素】 "（无视迷彩，同名效果不叠加…）": an area selection (no unblocking 隐匿 ally)
    tick(b, e, a) { if (!a.on) return; for (const u of areaAllies(b, e, e.x, e.y, T(ab, '1.range_radius') ?? 0)) elem(b, e, u, 'neural', e.s.atk * (T(ab, '1.ep_damage_ratio') ?? 0)); },
  }];
}

function kitLeaderMisc(key, ab, e) {
  switch (key) {
    case 'enemy_1050_lslime': {
      const dot = { dmg: T(ab, 'dot.damage') ?? 0, iv: T(ab, 'dot.interval') ?? 1, dur: T(ab, 'dot.duration') ?? 0 };
      return [maxTargets(4), lowHpBuff(T(ab, 'selfbuff.hp_ratio') ?? 0.5, { aspd: T(ab, 'selfbuff.attack_speed') ?? 0 }), {
        dealt(c, b, e2) {
          if (!(dot.dur > 0)) return;
          b.addBuff(c.target, { key: 'ab:burnDot', duration: dot.dur, refresh: 'replace', interval: dot.iv, visible: true,
            onTick: ({ battle, unit }) => battle.dealDamage(e2, unit, { amount: dot.dmg, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] }) });
        },
      }, {
        // 被阻挡时会进行自爆 — PRTS “庞贝” 天赋: "被阻挡时，每10秒（受晕眩/无法行动/沉睡/冻结/浮空影响时暂停计时，解除阻挡时重置计时）对
        // 半径1.4范围内的所有我方单位造成1000预计算的无途径法术溅射伤害（不可对空）": the clock runs only while it is blocked and can
        // act, and restarts at 0 on every new block (until 0.1.3: a fixed 10 s clock from its spawn, radius 1, flyers hit)
        iv: 0,
        tick(b, e2, a, dt) {
          if (!e2.blockedBy) { a.held = 0; return; }
          if (!e2.canAct) return;
          a.held = (a.held || 0) + dt;
          if (a.held + 1e-9 < (T(ab, 'rangedamage.interval') ?? 10)) return;
          a.held = 0;
          b.fx('explode', { x: e2.x, y: e2.y, r: POMPEII_BLAST_RADIUS, kind: 'selfBlast' });
          for (const u of areaAllies(b, e2, e2.x, e2.y, POMPEII_BLAST_RADIUS)) if (!u.isFlying) hurt(b, e2, u, T(ab, 'rangedamage.attack@damage') ?? 0, 'arts', { tags: ['splash'] });
        },
      }];
    }
    case 'enemy_1500_skulsr': {
      // PRTS 碎骨 天赋: "不会攻击飞行单位"; below half HP ATK +50 %; "未被阻挡时发射榴弹对目标及其周围八格的我方单位造成相当于攻击力
      // 26%的物理伤害，并令其在5秒内防御力下降50%" ("榴弹对主目标造成物理普通伤害，对溅射目标造成物理溅射伤害，可溅射飞行单位") — the
      // 26 % / 5 s / 3×3 are PRTS's, the −50 % is the blackboard's defdown.def. A blocked attack is its plain melee hit. The
      // splash is an area selection: a 隐匿 operator is spared, the one blocking this enemy included (GitHub #97; #32
      // item 6, DESIGN §22.12). Community report #14 (0.1.2): the grenade used to be a full attack + 100 % on 4 neighbours.
      const dd = -(T(ab, 'defdown.def') ?? 0);
      return [lowHpBuff(T(ab, 'atkup.hp_ratio') ?? 0.5, { atkPct: T(ab, 'atkup.atk') ?? 0 }), noAirTargets(),
        splashAttack({ scale: SKULSR_GRENADE_SCALE, tiles: 1, fxKind: 'grenade',
          onEach: (b, e2, u) => { if (dd) b.applyStatus(u, 'defDown', { duration: SKULSR_DEFDOWN_DUR, source: e2, value: dd }); } })];
    }
    case 'enemy_1502_crowns': {
      const s = ab.sk.blink;
      return [skill(s, (b, e2) => blinkForward(b, e2, s.bb.dist ?? 1.5), { sil: true, cond: (b, e2) => !!e2.blockedBy })];
    }
    case 'enemy_1504_cqbw': {
      const s = ab.sk.C4;
      return [skill(s, (b, e2) => {
        const l = byPriority(e2, targetsNear(b, e2, s.bb.range_radius ?? e2.base.rangeRadius));
        const n = e2.hpRatio < 0.5 ? 2 : 1; // 生命值降至一半以下时炸药包的使用数量增加
        for (const t of l.slice(0, n)) {
          const x = t.x, y = t.y;
          b.fx('telegraph', { x, y, r: C4_RADIUS, dur: C4_FUSE, kind: 'c4' });
          // the C4 sits on its target (PRTS "在…1个非飞行的我方单位身上安装C4"): it is hit; the blast around it is an area
          b.after(C4_FUSE, () => { b.fx('explode', { x, y, r: C4_RADIUS, kind: 'c4' }); for (const u of targetAndArea(t, areaAllies(b, e2, x, y, C4_RADIUS))) hurt(b, e2, u, e2.s.atk * (s.bb.atk_scale ?? 1), 'phys'); });
        }
      }, { cond: (b, e2) => targetsNear(b, e2, s.bb.range_radius ?? e2.base.rangeRadius).length > 0 })];
    }
    case 'enemy_1509_mousek': {
      // 出场时拥有能够吸收大量法术伤害的屏障，屏障存在时防御力大幅增加 (arts-only barrier + DEF while it holds)
      const bar = artsBarrier(T(ab, 'shield.dynamic') ?? 0, { key: 'ab:sandDef', whileUp: { defFlat: T(ab, 'defup.def') ?? 0 } });
      const ds = ab.sk.DriftSand, ss = ab.sk.SandStorm;
      return [bar, lowHpBuff(T(ab, 'enrage.hp_ratio') ?? 0.5, { dmgDealtMul: T(ab, 'enrage.damage_scale') ?? 1 }),
        // 【唱沙】 the highest-max-HP unit on the field and everything in its cross: physical `damage`
        skill(ds, (b, e2) => {
          const t = allTargets(b, e2).sort((p, q) => q.s.maxHp - p.s.maxHp || aggroCmp(p, q))[0];
          if (!t) return;
          b.fx('telegraph', { x: t.tileC, y: t.tileR, r: DRIFT_REACH, kind: 'driftSand', tiles: 'plus', id: e2.id });
          // the cross ("伤害无视迷彩", no 无视无法选择): an area selection
          for (const u of areaAlliesInTiles(b, e2, t.tileR, t.tileC, 'plus', DRIFT_REACH)) hurt(b, e2, u, ds.bb.damage ?? 0, 'phys');
        }, { cond: (b, e2) => allTargets(b, e2).length > 0 }),
        // 【沙狱】 the lowest-max-HP unit and those around it: ATK −`atk` and `damage` arts per second for `duration` s
        skill(ss, (b, e2) => {
          const t = allTargets(b, e2).sort((p, q) => p.s.maxHp - q.s.maxHp || aggroCmp(p, q))[0];
          if (!t) return;
          const dur = ss.bb.duration ?? 0, x = t.x, y = t.y;
          b.fx('zone', { x, y, r: SANDSTORM_RADIUS, dur, kind: 'sandStorm', id: e2.id });
          // the 沙狱弹道 "击中…范围内的所有我方单位（弹道可对空）" selects: an airborne 起飞 ally and an unblocking 隐匿 one
          // are skipped (no 无视无法选择 — areaAllies)
          for (const u of areaAllies(b, e2, x, y, SANDSTORM_RADIUS)) {
            b.addBuff(u, { key: 'ab:sandStorm', duration: dur, refresh: 'replace', interval: 1, visible: true, mods: { atkPct: ss.bb.atk ?? 0 },
              onTick: ({ battle, unit }) => battle.dealDamage(e2, unit, { amount: ss.bb.damage ?? 0, type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', 'sandStorm'] }) });
          }
        }, { cond: (b, e2) => allTargets(b, e2).length > 0 }),
      ];
    }
    case 'enemy_1511_mdrock': {
      // 拥有屏障吸收法术伤害，屏障存在时大幅提升生命上限与攻击速度; 周期性刷新屏障
      const s = ab.sk.RefreshShield;
      const bar = artsBarrier(s ? s.bb.dynamic ?? 0 : T(ab, 'shield.dynamic') ?? 0, { key: 'ab:rockPower',
        whileUp: { hpPct: (s ? s.bb.max_hp : null) ?? T(ab, 'shield.max_hp') ?? 0, aspd: (s ? s.bb.attack_speed : null) ?? T(ab, 'shield.attack_speed') ?? 0 } });
      return [bar, {
        // 攻击时攻击力永久提升，最多六层 (the blackboard ATK is the 6-stack total [ASSUMED split])
        attack(c, b, e2) { b.addBuff(e2, { key: 'ab:rockCharge', refresh: 'stack', stacks: 1, maxStacks: 6, persist: true, mods: { atkPct: (T(ab, 'charge.attack@enemy_mdrock_s_1[charge].atk') ?? 0) / 6 } }); },
      }, skill(s, (b, e2) => bar.refresh(b, e2, bar))];
    }
    case 'enemy_1513_dekght': {
      // 攻击时使目标与周围四格的单位受到物理伤害; 【蓄力攻击】 charge `duration` s, then ATK×atk_scale on the target's cross
      const s = ab.sk.ChargeAttack;
      // the 周围四格 of every attack (PRTS "对溅射目标造成物理溅射伤害") and 【蓄力锤】's cross: area selections
      return [kitDekght(ab), { before(c, b, e2) { const t = c.targets[0]; if (t) for (const u of areaAlliesInTiles(b, e2, t.tileR, t.tileC, 'plus', 1)) if (!c.targets.includes(u)) c.targets.push(u); } },
        skill(s, (b, e2) => {
          const t = e2.blockedBy;
          const dur = s.bb.duration ?? 0, r = t.tileR, cc = t.tileC;
          b.addBuff(e2, { key: 'ab:charging', duration: dur, visible: true, flags: { disarm: true } });
          b.fx('telegraph', { x: cc, y: r, r: 1, dur, kind: 'chargeAttack', tiles: 'plus', id: e2.id });
          b.after(dur, () => {
            if (!e2.alive || e2.s.flags.stun) return;
            b.fx('explode', { x: cc, y: r, r: 1, kind: 'chargeAttack', tiles: 'plus' });
            for (const u of areaAlliesInTiles(b, e2, r, cc, 'plus', 1)) hurt(b, e2, u, e2.s.atk * (s.bb['dekght[aoe].atk_scale'] ?? s.bb.atk_scale ?? 1), 'phys');
          }, { owner: e2 });
        }, { cond: (b, e2) => !!(e2.blockedBy && e2.blockedBy.alive) })];
    }
    case 'enemy_1513_dekght_2': {
      // 同时攻击两名目标; 爆炸箭: three targets, after `interval` s ATK×atk_scale arts on each target's cross
      const s = ab.sk.TripleAttack;
      const cands = (b, e2) => byPriority(e2, targetsNear(b, e2, e2.base.rangeRadius || 2.5));
      return [kitDekght(ab), maxTargets(2), skill(s, (b, e2) => {
        const delay = s.bb['dekght_2[aoe].interval'] ?? 0, scale = s.bb['dekght_2[aoe].atk_scale'] ?? 1;
        for (const t of cands(b, e2).slice(0, 3)) {
          const r = t.tileR, cc = t.tileC;
          b.fx('telegraph', { x: cc, y: r, r: 1, dur: delay, kind: 'blastArrow', tiles: 'plus', id: e2.id });
          b.after(delay, () => {
            if (!e2.alive) return;
            b.fx('explode', { x: cc, y: r, r: 1, kind: 'blastArrow', tiles: 'plus' });
            // "对主目标造成法术普通伤害，对溅射目标造成法术溅射伤害": the arrow's target + the 周围四格 (an area)
            for (const u of targetAndArea(t, areaAlliesInTiles(b, e2, r, cc, 'plus', 1))) hurt(b, e2, u, e2.s.atk * scale, 'arts');
          }, { owner: e2 });
        }
      }, { cond: (b, e2) => cands(b, e2).length > 0 })];
    }
    case 'enemy_1539_reid': {
      // 生命值降至一半以下时攻击力大幅度提升; 首次被击倒后重生 (Reborn.duration s), 恢复一半生命值;
      // 【冲锋】 (PRTS 技能 "仅自身未被阻挡且存在符合条件的可选目标时可触发：选择3.0半径内位于自身下个检查点前的后续路径上(包含自身当前
      // 所在地块)的距离自身最近的我方单位，将其所在地块中心设置为自身下一检查点；技能使用成功后，自身移动速度+200%，持续4.5s"): a target
      // it may select (targetsNear: no 隐匿 / 迷彩 / 起飞 / untargetable operator) within RUSH_RADIUS standing on its own path to
      // the next checkpoint (its tile included) ⇒ move speed ×(1+move_speed) for `duration` s. It walks that path anyway, so
      // the re-aim at the target's tile is not a separate move. Until 0.1.3: any unit within the blackboard's 1.5, 隐匿 / 迷彩
      // ones included, off its path too.
      const rush = ab.sk.Rush;
      const prey = (b, e2) => {
        const keys = pathKeysAhead(e2);
        return targetsNear(b, e2, RUSH_RADIUS).filter((u) => u.ground && keys.has(u.tileR * COLS + u.tileC));
      };
      return [lowHpBuff(T(ab, 'atkup.hp_ratio') ?? 0.5, { atkPct: T(ab, 'AtkUp.atk', 'atkup.atk') ?? 0 }),
        reborn({ dur: T(ab, 'Reborn.duration') ?? 0, hpRatio: T(ab, 'Reborn.hp_ratio') ?? 0.5, invincible: T(ab, 'Reborn.invincible') ?? 0 }),
        skill(rush, (b, e2) => {
          b.addBuff(e2, { key: 'ab:rush', duration: rush.bb.duration ?? 0, refresh: 'replace', visible: true, mods: { moveMul: 1 + (rush.bb.move_speed ?? 0) } });
          b.fx('charge', { x: e2.x, y: e2.y, id: e2.id, kind: 'avengerRush' });
        }, { cond: (b, e2) => !e2.blockedBy && prey(b, e2).length > 0 })];
    }
    case 'enemy_2003_rockman': {
      const s = ab.sk.StunAttack;
      const cands = (b, e2) => targetsNear(b, e2, (e2.def.raw.stats && e2.def.raw.stats.rawRangeRadius) || 2.5).filter((u) => !u.s.flags.stun);
      return [skill(s, (b, e2) => {
        const t = byPriority(e2, cands(b, e2))[0];
        if (!t) return;
        b.addProjectile({ from: e2, target: t, speed: 8, visual: 'lob', source: e2, onHit: (c) => {
          if (!c.target || !c.target.alive) return;
          hurt(b, e2, c.target, e2.s.atk * (s.bb.atk_scale ?? 1), 'phys');
          if (c.target.alive) b.applyStatus(c.target, 'stun', { duration: s.bb.stun ?? 0, source: e2 });
        } });
      }, { cond: (b, e2) => cands(b, e2).length > 0 })];
    }
    case 'enemy_2004_balloon': {
      // 喷气人 · 升空 when blocked → 飞行模式 for `duration` s: PRTS 喷气人 "近地悬浮，不可阻挡，失衡免疫，移动速度+50%，不进行
      // 攻击" — an air unit meanwhile (flag `float`: melee cannot hit it; it keeps the ground path, as setFloat), never
      // displaced; "切换为飞行模式后，1.5秒内移动速度最终降低90% … 结束后，1.333秒内不可阻挡，移动速度最终降低90%" (PRTS numbers:
      // the blackboard has only the duration and the +50 %).
      const s = ab.sk.TakeOff;
      const BRAKE = { moveMul: 0.1 }, BRAKE_UP = 1.5, LANDING = 1.333;
      return [skill(s, (b, e2) => {
        b.addBuff(e2, {
          key: 'ab:takeoff', duration: s.bb.duration ?? 0, flags: { unblockable: true, float: true, noDisplace: true }, mods: { moveMul: 1 + (s.bb['balloon_s[fly].move_speed'] ?? 0) }, visible: true,
          onExpire: ({ battle }) => { if (e2.alive) battle.addBuff(e2, { key: 'ab:landing', duration: LANDING, flags: { unblockable: true }, mods: BRAKE }); },
        });
        b.addBuff(e2, { key: 'ab:takeoffBrake', duration: BRAKE_UP, mods: BRAKE });
        b.fx('telegraph', { x: e2.x, y: e2.y, r: 0.5, kind: 'takeoff', id: e2.id });
      }, { cond: (b, e2) => !!e2.blockedBy })];
    }
    case 'enemy_2005_axetro':
      return [{
        attack(c, b, e2, a) {
          a.last = b.time;
          b.addBuff(e2, { key: 'ab:axeStack', refresh: 'stack', stacks: 1, maxStacks: T(ab, 'atkup.max_stack_cnt') ?? 1, persist: true, mods: { atkPct: T(ab, 'atkup.atk') ?? 0, aspd: T(ab, 'atkup.attack_speed') ?? 0 } });
        },
        iv: 0.5,
        tick(b, e2, a) { if (a.last != null && b.time - a.last >= (T(ab, 'checker.delay') ?? 4)) { a.last = null; b.removeBuff(e2, 'ab:axeStack'); } },
      }];
    case 'enemy_2008_flking': {
      // 使全战场我方所有单位攻击力、防御力减半 (text; the blackboard's atkdown.atk_scale is not the halving),
      // 部署费用回复速度减半，再部署时间加倍; 周期性地添加正比于自身最大生命值的伤害防护屏障. The halving is a map effect
      // (PRTS “墓碑” "※文字描述中的削弱实际属于地图效果，不属于敌人本身的能力"): every ally, 隐匿 / airborne ones included
      const s = ab.sk.refreshshield;
      // its attack — PRTS “墓碑” 天赋: "自身造成的远程途径伤害的攻击倍率降低至40%" (the blackboard's atkdown.atk_scale), "未被阻挡时会
      // 进行远程攻击，对目标及其周围八格内的所有我方单位造成物理伤害，不会攻击飞行单位" ("可溅射飞行单位"); blocked, a melee hit at
      // 100 %. Until 0.1.3: a single-target hit at 100 % either way.
      return [noAirTargets(), splashAttack({ scale: T(ab, 'atkdown.atk_scale') ?? 1, tiles: 1 }), {
        iv: 0.5,
        tick(b) {
          for (const u of b.allies()) {
            auraBuff(b, u, 'ab:tombstone', 0.5, { atkMul: 0.5, defMul: 0.5 }, null, true);
            // persistent so it still counts when the unit falls (the redeploy timer is set at death)
            b.addBuff(u, { key: 'ab:tombRedeploy', duration: 0.6, refresh: 'replace', persist: true, mods: { redeployMul: 2 } });
          }
        },
      }, {
        tick(b, e2, a, dt) { for (const p of b.players) b.addDp(p.playerId, -0.5 * b.flags.dpPerSec * dt); },
      }, skill(s, (b, e2) => b.addBuff(e2, { key: 'ab:tombShield', shield: e2.s.maxHp * (s.bb.hp_ratio ?? 0), persist: true }))];
    }
    case 'enemy_2048_smgrd':
      // 持续在自身周围8格生成【国度】 (the 3×3 around its tile), 大幅降低其中我方单位的攻击速度; 对【国度】中的我方单位造成高额物理伤害.
      // 【国度】 is a tile effect ("将该地块及其周围8格范围内的可部署位生成【国度】"): every ally on it, 隐匿 ones too [ASSUMED]
      return [{
        iv: 0.5,
        tick(b, e2) { for (const u of alliesInTiles(b, Math.round(e2.y), Math.round(e2.x), 'box', 1)) auraBuff(b, u, 'ab:blackFog', 0.5, { aspd: T(ab, 'BlackFog.attack_speed') ?? 0 }, null, true); },
        hitOut(c, b, e2) {
          const t = c.target;
          if (c.dmg.isAttack && t.side === 'ally' && Math.max(Math.abs(t.tileR - Math.round(e2.y)), Math.abs(t.tileC - Math.round(e2.x))) <= 1) c.dmg.amount *= T(ab, 'DamageUp.atk_scale') ?? 1;
        },
      }];
    case 'enemy_2050_smsha': {
      const cold = T(ab, 'Attack.attack@freeze') ?? 0, n = T(ab, 'Attack.attack@chain.max_target') ?? 1, fall = T(ab, 'Attack.attack@chain.atk_scale') ?? 1;
      const jr = T(ab, 'Attack.attack@projectile_range') ?? 1.6;
      const cb = ab.sk.ChainBuff;
      return [onHitStatus('cold', cold), {
        dealt(c, b, e2) {
          let prev = c.target;
          const hit = new Set([prev]);
          for (let k = 1; k < n; k++) {
            // a jump selects within jr of the last target (中点判定): no unblocking 隐匿 or airborne 起飞 ally (areaAllies)
            const nx = areaAllies(b, e2, prev.x, prev.y, jr).find((u) => !hit.has(u));
            if (!nx) break;
            hit.add(nx);
            hurt(b, e2, nx, e2.s.atk * Math.pow(fall, k), 'arts');
            if (nx.alive && cold > 0) b.applyStatus(nx, 'cold', { duration: cold, source: e2 });
            prev = nx;
          }
        },
      },
      // 【反自然馈赠】 (SILENCE): "attacks" another enemy in range and jumps between up to chain.max_target enemies
      // (projectile_range per jump), raising their move speed and ASPD for `duration` s
      skill(cb, (b, e2) => {
        const bb = cb.bb, jump = bb.projectile_range ?? jr, max = bb['chain.max_target'] ?? 3;
        const near = (x, y, r, seen) => b.enemiesInRadius(x, y, r).filter((o) => o !== e2 && !seen.has(o))
          .sort((p, q) => Math.hypot(p.x - x, p.y - y) - Math.hypot(q.x - x, q.y - y) || p.spawnSeq - q.spawnSeq)[0];
        const seen = new Set();
        let prev = e2, cur = near(e2.x, e2.y, e2.base.rangeRadius || 3.5, seen);
        while (cur && seen.size < max) {
          seen.add(cur);
          b.fx('beam', { x: prev.x, y: prev.y, from: prev.id, to: cur.id, kind: 'chainBuff' });
          b.addBuff(cur, { key: 'ab:chainBuff', duration: bb.duration ?? 0, refresh: 'replace', visible: true, mods: { moveMul: 1 + (bb.move_speed ?? 0), aspd: bb.attack_speed ?? 0 } });
          prev = cur;
          cur = near(cur.x, cur.y, jump, seen);
        }
      }, { sil: true, cond: (b, e2) => b.enemiesInRadius(e2.x, e2.y, e2.base.rangeRadius || 3.5).some((o) => o !== e2) })];
    }
    case 'enemy_2052_smgia': {
      // 数次攻击后晕眩; 受到来自自然环境的伤害时 (terrain damage), 自身在短时间内获得高额脆弱 (damage taken ×damage_scale)
      const lim = T(ab, 'Weak.weak[limit]') ?? 0, scale = T(ab, 'Weak.damage_scale') ?? 1;
      return [nthAttackStatus(nthOf(ab.sk.StunAttack), 'stun', (ab.sk.StunAttack && ab.sk.StunAttack.bb.stun) || 0, false), {
        taken(c, b, e2) {
          if (!(lim > 0) || !(c.amount > 0) || !(c.dmg.tags && c.dmg.tags.includes('terrain'))) return;
          b.addBuff(e2, { key: 'ab:natureWeak', duration: lim, refresh: 'replace', visible: true, mods: { dmgTakenMul: scale } });
        },
      }];
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------------------------------------------
// multi-form leaders (悬赏 bounty targets): the first knock-out switches them to their second form (reborn helper)

/** Distance from point p to segment a–b. */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** A second normal hit on the same target ("二连击"): same damage type, no further on-hit procs. */
const doubleHit = (on = () => true, extra = null) => ({
  dealt(c, b, e, a) {
    if (!on(b, e, a) || !c.target.alive) return;
    b.dealDamage(e, c.target, { amount: e.s.atk, type: c.dmg.type, canDodge: true, tags: ['enemyAbility', 'secondHit'], ...(extra ? extra(c, b, e) : {}) });
  },
});

/** 巨大的丑东西 · melee ×rage; KO ⇒ self-destruct (big stun) and the 大祭司 pilot ejects: no attack, unblockable, own DEF/RES,
 *  faster, loses bird_run.damage true HP per second. (巨蕈/木桩 tiles and its ranged splash attack have no counterpart here:
 *  its data radius is 0.) */
function kitUglyThing(ab) {
  const rage = T(ab, 'combat.attack@mcmstr_rage_attack.atk_scale') ?? 1;
  const bomb = ab.sk['bomb[reborning]'] ? ab.sk['bomb[reborning]'].bb : {};
  const run = { spd: T(ab, 'bird_run.move_speed') ?? 0, def: T(ab, 'bird_run.def'), res: T(ab, 'bird_run.magic_resistance'), dmg: T(ab, 'bird_run.damage') ?? 0 };
  const P = { pilot: false };
  return [
    // 远程攻击造成溅射伤害，近战攻击造成更高伤害 — PRTS 天赋: unblocked, a ranged attack on 1 non-flying unit within 2.5 hitting it
    // and its 8 surrounding tiles for 100 % ATK ("可溅射飞行单位"); blocked, a melee hit at mcmstr_rage_attack.atk_scale
    { spawn(b, e) { e.base.rangeRadius = Math.max(e.base.rangeRadius || 0, MCM_RANGE); e.profile.canTarget = (u) => !u.isFlying; } },
    splashAttack({ scale: 1, meleeScale: rage, tiles: 1 }),
    reborn({
      dur: T(ab, 'reborn.duration') ?? 0,
      onKo(b, e) {                                  // 生命值降至0后自爆，造成大范围晕眩 (an area selection), 2.17 s into the 重生
        const x = e.x, y = e.y;
        b.fx('telegraph', { x, y, r: MCM_BOMB_RADIUS, dur: MCM_BOMB_DELAY, kind: 'mechBomb', id: e.id });
        b.after(MCM_BOMB_DELAY, () => {
          if (!e.alive || e.removed) return;
          b.fx('explode', { x, y, r: MCM_BOMB_RADIUS, kind: 'mechBomb', id: e.id });
          for (const u of areaAllies(b, e, x, y, MCM_BOMB_RADIUS)) {
            hurt(b, e, u, e.s.atk * (bomb.atk_scale ?? 0), 'phys');
            if (u.alive && bomb.stun > 0) b.applyStatus(u, 'stun', { duration: bomb.stun, source: e });
          }
        }, { owner: e });
      },
      onReborn(b, e) {                              // 大祭司形态: 不进行攻击，无法被阻挡，每秒受到真实伤害
        P.pilot = true;
        e.profile.noAttack = true;
        b.addBuff(e, {
          key: 'ab:pilot', persist: true, visible: true, flags: { unblockable: true }, interval: 1,
          mods: { moveMul: 1 + run.spd, defFlat: run.def != null ? run.def - e.base.def : 0, resFlat: run.res != null ? run.res - e.base.res : 0 },
          onTick: ({ battle, unit }) => { if (run.dmg > 0) battle.dealDamage(null, unit, { amount: run.dmg, type: 'true', canDodge: false, tags: ['enemyAbility', 'pilotBurn'] }); },
        });
      },
    }),
  ];
}

/** 杰斯顿·威廉姆斯 · 狱警: RES +enhance, ranged arts, every (sp+1)th attack stuns max_target units; KO ⇒ (reborn.duration s)
 *  杀手: frees every prisoner, DEF/ATK/ASPD/speed up, melee physical, every (sp+1)th attack hits `times` × ignoring def_penetrate. */
function kitWarden(ab) {
  const en = (k) => T(ab, `enhance.${k}`) ?? 0;
  const iron = ab.sk.ironsandstorm, pierce = ab.sk.armorpiercing;
  const P = { killer: false, n: 0, power: false };
  const pen = () => (pierce && pierce.bb.def_penetrate) || 0;
  return [{
    spawn(b, e, a, ab2) {
      ab2.atkType = 'arts';                                    // 攻击造成远程法术伤害
      e.profile.melee = false;
      b.addBuff(e, { key: 'ab:warden', persist: true, visible: true, mods: { resFlat: en('magic_resistance') } });  // 法术抗性大幅提升
    },
    before(c, b) { const s = P.killer ? pierce : iron; P.power = !!s && (P.n + 1) % nthOf(s) === 0; },
    hitOut(c) { if (P.killer && P.power && c.dmg.isAttack) c.dmg.defIgnorePct = Math.min(1, (c.dmg.defIgnorePct || 0) + pen()); },
    dealt(c, b, e) {
      if (!P.killer || !P.power || !pierce) return;
      for (let i = 1; i < (pierce.bb.times ?? 1) && c.target.alive; i++) b.dealDamage(e, c.target, { amount: e.s.atk, type: 'phys', defIgnorePct: pen(), canDodge: true, isSkill: true, tags: ['enemyAbility', 'armorPiercing'] });
    },
    attack(c, b, e) {
      P.n++;
      if (!P.power || P.killer || !iron) return;
      // 能使多名单位晕眩: the skill attack stuns up to max_target units in its range (its target first)
      const l = byPriority(e, targetsNear(b, e, e.base.rangeRadius || 2));
      for (const t of c.targets) if (!l.includes(t)) l.unshift(t);
      for (const u of l.slice(0, iron.bb.max_target ?? 1)) if (u.alive) b.applyStatus(u, 'stun', { duration: iron.bb.stun ?? 0, source: e });
    },
  }, reborn({
    dur: T(ab, 'reborn.duration') ?? 0,
    onKo(b) { freeAllPrisoners(b); },                         // 进入杀手形态时解放全场敌人
    onReborn(b, e) {
      P.killer = true; P.n = 0;
      e.mem.ab.atkType = null;                                 // 攻击造成近战物理伤害
      e.profile.melee = true;
      b.removeBuff(e, 'ab:warden');
      b.addBuff(e, { key: 'ab:killer', persist: true, visible: true,
        mods: { defFlat: en('def'), atkFlat: en('atk'), batPct: en('base_attack_time') / (e.base.bat || 1), moveFlat: en('move_speed') } });
    },
  })];
}

/** “自在” · 【纬地经天】 arts cross on the nearest unit (form 2: + the farthest); 【破桎而出】 barrier — unbroken after its
 *  duration ⇒ ATK×atk_scale arts around; KO ⇒ second form (ATK up, double hits, stronger 破桎而出). 晦明 attributes n/a. */
function kitXi(ab) {
  const cross = ab.sk.CrossAttack, sb = ab.sk.ShieldBurst, sb2 = ab.sk.ShieldBurstReborn;
  const P = { form2: false };
  const byDist = (b, e) => allTargets(b, e).sort((p, q) => Math.hypot(p.x - e.x, p.y - e.y) - Math.hypot(q.x - e.x, q.y - e.y) || aggroCmp(p, q));
  const crossAt = (b, e, t) => {
    const r0 = t.tileR, c0 = t.tileC;
    b.fx('telegraph', { x: c0, y: r0, r: XI_CROSS_REACH, kind: 'xiCross', tiles: 'plus', id: e.id });
    // "伤害无视迷彩", no 无视无法选择: the cross is an area selection
    for (const u of areaAlliesInTiles(b, e, r0, c0, 'plus', XI_CROSS_REACH)) if (u.tileR === r0 || u.tileC === c0) hurt(b, e, u, e.s.atk * ((cross && cross.bb.atk_scale) ?? 1), 'arts');
  };
  const burst = (s) => (b, e) => {
    const dur = s.bb.duration ?? 0, r = s.bb.range_radius ?? 0;
    b.fx('telegraph', { x: e.x, y: e.y, r, dur, kind: 'breakFree', id: e.id });
    b.addBuff(e, { key: 'ab:xiShield', duration: dur, shield: s.bb.dynamic ?? 0, visible: true,
      // expiry (not breaking: a broken barrier is removed without onExpire) = the barrier held
      onExpire: ({ battle }) => {
        if (!e.alive) return;
        battle.fx('explode', { x: e.x, y: e.y, r, kind: 'breakFree', id: e.id });
        for (const u of areaAllies(battle, e, e.x, e.y, r)) hurt(battle, e, u, e.s.atk * (s.bb.atk_scale ?? 0), 'arts');
      } });
  };
  const re = reborn({
    dur: T(ab, 'reborn.duration') ?? 0, invincible: T(ab, 'reborn.invincible') ?? 0,
    onKo(b, e) { b.removeBuff(e, 'ab:xiShield'); },
    onReborn(b, e) {
      P.form2 = true;
      b.addBuff(e, { key: 'ab:xiReborn', persist: true, visible: true, mods: { atkPct: T(ab, 'reborn.atk') ?? 0 } });   // 攻击力提升
      if (s2) s2.left = s2.icd;
    },
  });
  const s1 = skill(sb, burst(sb), { cond: () => !P.form2 });
  const s2 = skill(sb2, sb2 ? burst(sb2) : null, { cond: () => P.form2 });
  return [re, s1, s2, doubleHit(() => P.form2),                   // 普通攻击进行两次
    skill(cross, (b, e) => {
      const l = byDist(b, e);
      if (!l.length) return;
      crossAt(b, e, l[0]);
      if (P.form2 && l.length > 1) crossAt(b, e, l[l.length - 1]);   // 额外对最远目标释放
    }, { cond: (b, e) => allTargets(b, e).length > 0 })];
}

/** 锏 · 抵抗; DEF penetration against its blocker; 【速杀】 passes through its blocker hitting those on the way; 【肆虐风雪】
 *  AoE; KO ⇒ second form: stealth, more penetration, double hits, 【瞬息杀机】 at every 25 % HP lost (SP cleared + no attacks
 *  / heals around it). <降雪> absent. */
function kitMace(ab) {
  const pen1 = T(ab, 'DefPenetrate.enemy_blkswb_t_2.def_penetrate') ?? 0, pen2 = T(ab, 'DefPenetrate.enemy_blkswb_t_2[reborn].def_penetrate') ?? pen1;
  const cs = { ratio: T(ab, 'ClearSp.hp_ratio') ?? 0, dur: T(ab, 'ClearSp.duration') ?? 0, r: T(ab, 'ClearSp.range_radius') ?? 0 };
  const P = { form2: false, next: 1 };
  const penOn = (c, e) => (c.target === e.blockedBy ? (P.form2 ? pen2 : pen1) : 0);
  // its blocker is hit (PRTS 技能 "对之前阻挡自身的单位造成…"); the others on the way are an area selection (areaSelectable)
  const blink = (s) => (b, e) => {
    const bl = e.blockedBy;
    const from = blinkForward(b, e, s.bb.dist ?? 1.5);
    if (!from) return;
    for (const u of b.allies()) {
      if (u !== bl && (segDist(u.x, u.y, from.x, from.y, e.x, e.y) > 0.5 || !areaSelectable(e, u))) continue;
      hurt(b, e, u, e.s.atk * (s.bb.atk_scale ?? 1), 'phys');
    }
  };
  const circle = (s) => (b, e) => {
    const r = s.bb.range_radius ?? 0;
    b.fx('explode', { x: e.x, y: e.y, r, kind: 'blizzard', id: e.id });
    for (const u of areaAllies(b, e, e.x, e.y, r)) hurt(b, e, u, e.s.atk * (s.bb.atk_scale ?? 1), 'phys');
  };
  // cast with a target in the circle — the trigger selection (targetsNear: PRTS 选择器 "所有触发选择器通常不无视迷彩"): no
  // airborne (起飞) operator for a ground enemy (§21.22), no unblocking 隐匿 or 迷彩 one
  const inR = (b, e, s) => targetsNear(b, e, (s && s.bb.range_radius) || 0).length > 0;
  return [resist(), {
    hitOut(c, b, e) { const p = penOn(c, e); if (c.dmg.isAttack && p > 0) c.dmg.defIgnorePct = Math.min(1, (c.dmg.defIgnorePct || 0) + p); },
    taken(c, b, e) {                                             // 【瞬息杀机】 every hp_ratio of max HP lost (second form)
      if (!P.form2 || !(cs.ratio > 0)) return;
      while (e.alive && e.hpRatio <= P.next - cs.ratio + 1e-9 && P.next - cs.ratio > 1e-9) {
        P.next -= cs.ratio;
        b.fx('explode', { x: e.x, y: e.y, r: cs.r, kind: 'clearSp', id: e.id });
        for (const u of areaAllies(b, e, e.x, e.y, cs.r)) {
          const sk = u.skill;
          if (sk && !sk.noSkill && sk.kind !== 'passive' && !sk.active && sk.spCost > 0) { sk.sp = 0; sk.charges = 0; }   // 清空技力 (stored charges too)
          if (cs.dur > 0) b.applyStatus(u, 'disarm', { duration: cs.dur, source: e });
        }
      }
    },
  }, doubleHit(() => P.form2, (c, b, e) => ({ defIgnorePct: penOn(c, e) })),
  skill(ab.sk.Blink, blink(ab.sk.Blink || { bb: {} }), { id: 'blink', cond: (b, e) => !P.form2 && !!e.blockedBy }),
  skill(ab.sk.Blink2, blink(ab.sk.Blink2 || { bb: {} }), { id: 'blink2', cond: (b, e) => P.form2 && !!e.blockedBy }),
  skill(ab.sk.CircleAttack, circle(ab.sk.CircleAttack || { bb: {} }), { id: 'circle', cond: (b, e) => !P.form2 && inR(b, e, ab.sk.CircleAttack) }),
  skill(ab.sk.CircleAttack2, circle(ab.sk.CircleAttack2 || { bb: {} }), { id: 'circle2', cond: (b, e) => P.form2 && inR(b, e, ab.sk.CircleAttack2) }),
  reborn({
    dur: T(ab, 'Reborn.duration') ?? 0, invincible: T(ab, 'Reborn.invincible') ?? 0,
    onReborn(b, e) { P.form2 = true; P.next = 1; b.addBuff(e, { key: 'ab:stealth', flags: { stealth: true }, persist: true }); },
  })];
}

/** 扎罗，“狼之主” · first form: damage taken −30 %, not stunnable, 【溶血骇惧】; KO ⇒ a Reborn.duration s 重生 (its HP refills,
 *  【远古威慑】 slows the units around it) ⇒ second form: ranged double hits within WOLF_RANGE, ATK/ASPD up, invincible at first,
 *  【远古威慑】 still on. 【溶血骇惧】 (PRTS 技能 "使场上最多3名我方单位攻击速度-70，获得无法撤退，逐渐流失生命（从0/秒开始线性递增，在
 *  40秒后达到最大流失速度30%最大生命值/秒），持续时间无限 … 场上存在被此技能影响的单位时狼之主获得静默 … 释放此技能时狼之主记录自身当前
 *  生命值，累计损失20%生命值后解除场上全部我方单位的技能效果"): the FearCage blackboard's attack_speed, hp_ratio (the loss rate
 *  reached at duration_bleed s), hp_ratio_offset (the cure); its SP (the cast's cooldown, spCost s at +1/s [ASSUMED]) stands
 *  still while a unit is caught (静默), each ended effect gives back sp, and the last one starts duration_wait s more of 静默
 *  ("每结束1个技能效果狼之主回复5SP，场上技能效果全部结束时狼之主获得7s静默"). Until 0.1.3 the loss peaked at 5 % [ASSUMED], the buff
 *  ended after 40 s, hp_ratio (30 %) was read as the cure and the cast came every spCost s whatever was caught. Not modelled:
 *  血债账款 / 【狂暴怒嗥】. */
function kitWolfLord(ab) {
  const fc = ab.sk.FearCage;
  const P = { form2: false, caught: 0, waitUntil: -Infinity, cast: null };
  const caught = (b) => b.allies().some((u) => u.findBuff('ab:fearCage'));
  const cure = (b) => { for (const u of b.allies()) { const d = u.findBuff('ab:fearCage'); if (d) b.removeBuff(u, d); } };
  // 【远古威慑】 (a buff aura, auraAllies): no 隐匿 operator, the blocker included, an airborne 起飞 one still — as 深池伙友卫队's
  const awe = (b, e) => { for (const u of auraAllies(b, e, e.x, e.y, WOLF_AWE_RADIUS)) auraBuff(b, u, 'ab:ancientAwe', 0.2, { aspd: WOLF_AWE_ASPD }, null, true); };
  return [{
    spawn(b, e, a, ab2) {
      ab2.immune = new Set([...(ab2.immune || []), 'stun']);   // 第一形态: 不可被晕眩
      b.addBuff(e, { key: 'ab:wolfGuard', persist: true, visible: true, mods: { dmgTakenMul: 1 - (T(ab, 'Passive.damage_resistance') ?? 0) } });
    },
    iv: 0.1,
    tick(b, e, a, dt) {
      if (P.form2) { awe(b, e); return; }                      // 第二形态: 【远古威慑】生效
      if (!fc) return;
      // afflicted units recover once 扎罗 lost hp_ratio_offset of its HP since the cast
      const cut = Math.abs(fc.bb.hp_ratio_offset ?? 0.2);
      let n = 0;
      for (const u of b.allies()) {
        const d = u.findBuff('ab:fearCage');
        if (!d || d.data.src !== e) continue;
        if (e.hpRatio <= d.data.hp0 - cut + 1e-9) b.removeBuff(u, d); else n++;
      }
      if (P.cast) {
        if (n < P.caught) {                                      // ended effects (cured, knocked out): +sp each
          P.cast.left -= (fc.bb.sp ?? 0) * (P.caught - n);
          if (n === 0) P.waitUntil = b.time + (fc.bb.duration_wait ?? 0);
        }
        if (n > 0 || b.time < P.waitUntil) P.cast.left += dt;    // 静默: its SP stands still
      }
      P.caught = n;
    },
  },
  // 【溶血骇惧】 every spCost s (enemy SP +1/s [ASSUMED]), first form only, never during its 静默
  P.cast = skill(fc, (b, e) => {
    const l = b.rng.shuffle(allTargets(b, e).filter((u) => u.kind === 'op' && !u.findBuff('ab:fearCage'))).slice(0, fc.bb.max_target ?? 3);
    const ramp = Math.max(1, fc.bb.duration_bleed ?? 40), peak = fc.bb.hp_ratio ?? 0;
    for (const u of l) {
      b.fx('beam', { x: e.x, y: e.y, from: e.id, to: u.id, kind: 'fearCage' });
      b.addBuff(u, { key: 'ab:fearCage', refresh: 'replace', visible: true, interval: 1, data: { src: e, hp0: e.hpRatio, t0: b.time },
        mods: { aspd: fc.bb.attack_speed ?? 0 },
        onTick: ({ battle, unit, buff }) => {
          // its 扎罗 gone from the field without a 重生 (leaked, removed): the effect ends, no loss this tick [ASSUMED — no
          // official text; the 重生's onKo cure covers its knock-out]. Until 0.1.3 a leak left it draining for good.
          const src = buff.data.src;
          if (!src || !src.alive || src.removed) { battle.removeBuff(unit, buff); return; }
          const k = Math.min(1, (battle.time - buff.data.t0) / ramp);
          battle.loseHp(unit, unit.s.maxHp * peak * k, { source: e });
        } });
    }
  }, { cd: fc ? fc.sp || fc.cd : null, icd: fc ? fc.sp || fc.icd : null, cond: (b, e) => !P.form2 && !caught(b) && b.time >= P.waitUntil && allTargets(b, e).some((u) => u.kind === 'op') }),
  doubleHit(() => P.form2),                                     // 攻击变为远程二连击
  reborn({
    dur: T(ab, 'Reborn.duration') ?? 0, invincible: T(ab, 'Passive2.invincible_time') ?? 0,
    onKo(b, e) {
      cure(b);
      b.removeBuff(e, 'ab:wolfGuard');
      if (e.mem.ab.immune) e.mem.ab.immune.delete('stun');
    },
    during(b, e, a, t) {                                         // 重生期间【远古威慑】生效; its HP refills slowly
      const dur = T(ab, 'Reborn.duration') ?? 1;
      e.hp = Math.max(1, e.s.maxHp * Math.min(1, t / Math.max(TICK, dur)));
      awe(b, e);
    },
    onReborn(b, e) {
      P.form2 = true;
      e.profile.melee = false;
      e.base.rangeRadius = Math.max(e.base.rangeRadius || 0, WOLF_RANGE);
      b.addBuff(e, { key: 'ab:wolfRage', persist: true, visible: true, mods: { atkPct: T(ab, 'Passive2.atk') ?? 0, batPct: (T(ab, 'Passive2.base_attack_time') ?? 0) / (e.base.bat || 1) } });
    },
  })];
}

/**
 * 转译基底·α (PRTS 转译基底·α 天赋; enemy_database talents Passive / Mode_*_Passive / Mode_Fuchou_Anger; skills ChangeToB/C/D):
 * 原始形态 — no attack, every damage instance is cancelled ("受到伤害时取消此伤害"), 失衡免疫, immune to 晕眩/沉睡/寒冷/冻结/浮空/
 * 恐惧. The 4th physical damage instance taken ⇒ 寻仇者, the 4th arts one ⇒ 特战术师, being blocked ⇒ 幽灵 — once ("仅可变化一次");
 * the change takes TRANSLATOR_CHANGE (2) s, standing still and still in the original form [ASSUMED: immobile, damage
 * still cancelled]; then the form's flat stat changes apply (move speed relative to the data's 1.0, attack interval
 * +N s, 重量等级 +N):
 *   寻仇者 (form B): melee only, physical; ATK +100 % while HP < 50 % (Mode_Fuchou_Anger.atk);
 *   特战术师 (form D): ranged only (the data's 2.4 radius), arts, 2 targets at once — flyers included [ASSUMED: the
 *     translator's text "仅进行远程攻击，同时攻击2个目标，造成法术伤害" names no exception; the standalone PRTS 特战术师's talent
 *     "不会攻击飞行单位" may carry over — then `canTarget: (u) => !u.isFlying` in finish()];
 *   幽灵 (form C): no stat change, unblockable, no attack (PRTS 转译基底·α "幽灵形态 无属性变化；无法被阻挡" — no attack line,
 *     unlike the armed forms — and the linked PRTS 幽灵 天赋 "不进行普通攻击，无法被阻挡", 攻击方式 不攻击).
 * The armed forms attack through the engine's enemy attack (ai.js enemyAttack, `profile.dmgType`), so attack clips,
 * projectiles and the attack hooks are the normal ones. Before its change ends it cannot be killed at all (damage is
 * cancelled; an HP loss stops at 1 HP) — user report after 0.1.0 (#5): its model never changed (no FORMS clip set), so
 * it died on the manifest's die clip, the 寻仇者's B_Die, from its first-form look; and the v2.5 kit let damage through,
 * so some lineups killed it before either counter reached 4. fx 'phase' {id, kind: translator_fuchou | _shushi | _youling} starts the model's 2 s
 * change clip (render/units.js FORMS). Form letters: B / C / D follow the talents' order Fuchou / Youling / Shushi — C,
 * the only clip set without an attack, is the non-attacking 幽灵 (skills ChangeToB / C / D).
 */
function kitTranslator(ab, e) {
  const t = (k) => T(ab, k) ?? 0;
  const P = { phys: 0, arts: 0, form: null, done: false, anger: false };
  const PRE = { fuchou: 'Mode_Fuchou_Passive', shushi: 'Mode_Shushi_Passive', youling: 'Mode_Youling_Passive' };
  const mods = (pre) => ({
    hpFlat: t(`${pre}.max_hp`), atkFlat: t(`${pre}.atk`), defFlat: t(`${pre}.def`), resFlat: t(`${pre}.magic_resistance`),
    moveMul: Math.max(0, 1 + t(`${pre}.move_speed`) / (e.def.moveSpeed || 1)), batPct: t(`${pre}.base_attack_time`) / (e.base.bat || 1),
    massFlat: t(`${pre}.mass_level`),
  });
  const finish = (b, e2) => {
    if (!e2.alive || P.done) return;
    P.done = true;
    b.removeBuff(e2, 'ab:origin');
    ab.immune = null;
    b.addBuff(e2, { key: 'ab:form', persist: true, visible: true, mods: mods(PRE[P.form]), flags: P.form === 'youling' ? { unblockable: true } : null });
    if (P.form !== 'youling') {
      const melee = P.form === 'fuchou';
      Object.assign(e2.profile, { noAttack: false, melee, dmgType: melee ? 'phys' : 'arts', maxTargets: melee ? 1 : 2 });
      e2.atkCd = 0;
    }
    if (e2.route) e2.route.pts = null;
  };
  const change = (b, e2, form) => {
    if (P.form || !e2.alive) return;
    P.form = form;
    b.addBuff(e2, { key: 'ab:change', duration: TRANSLATOR_CHANGE, persist: true, flags: { noMove: true }, onExpire: ({ battle }) => finish(battle, e2) });
    setForm(b, e2, `translator_${form}`, 'phase', { dur: TRANSLATOR_CHANGE });
  };
  return [{
    spawn(b, e2) {
      b.addBuff(e2, { key: 'ab:origin', persist: true, flags: { noDisplace: true } });
      ab.immune = new Set(TRANSLATOR_IMMUNE);
    },
    hitIn(c, b, e2) {
      if (P.done) return;
      const s = c.source || c.credit, ty = c.dmg.type;
      if (!P.form && s && s.side === 'ally') {
        if (ty === 'phys' && ++P.phys >= (t('Passive.phy_max_count') || 4)) change(b, e2, 'fuchou');
        else if (ty === 'arts' && ++P.arts >= (t('Passive.magic_max_count') || 4)) change(b, e2, 'shushi');
      }
      c.dmg.cancel = true;
    },
    // an HP loss (流失 — no 伤害 instance, so not cancelled: 隐德来希's 心烛 hand-over …) cannot knock it out before its
    // change ends: its original form has no death clip of its own (A_Die_B / _C / _D are the changes) [ASSUMED floor 1 HP]
    killed(c, b, e2) {
      if (P.done) return false;
      e2.hp = Math.max(1, e2.hp);
      return true;
    },
    blocked(c, b, e2) { change(b, e2, 'youling'); },
    tick(b, e2) {
      // 寻仇者: "生命值低于50%时，攻击力+100%"
      if (P.form !== 'fuchou' || !P.done) return;
      const on = e2.hpRatio < 0.5;
      if (on === P.anger) return;
      P.anger = on;
      if (on) b.addBuff(e2, { key: 'ab:anger', persist: true, visible: true, mods: { atkPct: t('Mode_Fuchou_Anger.atk') } });
      else b.removeBuff(e2, 'ab:anger');
    },
  }];
}

/** 乌顶巨角卢鲁 · 【角力对决】 when blocked: charges `duration` s (no normal attacks; a stun or 失衡 interrupts), then hits its
 *  blocker; operators hold fixed tiles, so the push always fails ⇒ extra damage and a fail_duration stun. */
function kitElk(ab) {
  const s = ab.sk.skill;
  const P = { ch: null };
  const stop = (b, e) => { P.ch = null; b.removeBuff(e, 'ab:elkCharge'); };
  return [{
    tick(b, e) {
      const ch = P.ch;
      if (!ch) return;
      if (e.s.flags.stun || !ch.t.alive || e.blockedBy !== ch.t) { stop(b, e); b.fx('phase', { x: e.x, y: e.y, id: e.id, kind: 'chargeBroken' }); return; }
      if (b.time + 1e-9 < ch.until) return;
      stop(b, e);
      b.fx('explode', { x: ch.t.x, y: ch.t.y, r: 0.5, kind: 'elkClash' });
      hurt(b, e, ch.t, e.s.atk * ((s && s.bb.atk_scale_s) ?? 1) * ELK_FAIL_SCALE, 'phys');
      const st = T(ab, 'data.attack@fail_duration') ?? 0;
      if (ch.t.alive && st > 0) b.applyStatus(ch.t, 'stun', { duration: st, source: e });
    },
  }, unbalanced((b, e) => { if (P.ch) stop(b, e); }),
  skill(s, (b, e) => {
    const dur = s.bb.duration ?? 0;
    P.ch = { t: e.blockedBy, until: b.time + dur };
    b.addBuff(e, { key: 'ab:elkCharge', duration: dur + 0.1, visible: true, flags: { disarm: true } });
    b.fx('telegraph', { x: e.blockedBy.x, y: e.blockedBy.y, r: 0.5, dur, kind: 'elkCharge', id: e.id });
  }, { cond: (b, e) => !P.ch && !!(e.blockedBy && e.blockedBy.alive) })];
}

// ---------------------------------------------------------------------------------------------------------------
// KITS: enemyKey → (ab, e, battle) => ability list. One line per key (name · what).

export const KITS = Object.freeze({
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
  enemy_1207_sfji: kitBlades,                                        // 沉沙 · each attack spends a blade (+ATK); death: unspent blades → 铜矛头 (≥1)
  enemy_1207_sfji_2: kitBlades,                                      // 新硎 · same (铁矛头)
  enemy_1209_sfden: kitInvisShield,                                  // 清明 · veils nearby enemies (stealth) every 15 s; death: 铜灯盘
  enemy_1209_sfden_2: kitInvisShield,                                // 堂皇 · same (铁灯盘)
  enemy_1203_sfhu: kitTeapot,                                        // 烹泉 · death: 4 青瓷茶器 + ASPD-down arts blast zone
  enemy_1203_sfhu_2: kitTeapot,                                      // 沏虹 · death: 4 彩瓷茶器 + blast zone
  enemy_1288_duskls: kitEmber,                                       // 深池逐火战士 · every KO: 1 s 重生 ⇒ walking 隐匿 5-hit ember (block it to hit it), back after 10 s
  enemy_1288_duskls_2: kitEmber,                                     // 深池逐火精锐战士 · same
  enemy_1292_duskld: kitEmber,                                       // 深池逐火护卫 · 10-hit 火灰
  enemy_9010_acpupp: kitRegen,                                       // 假想敌：再生 · every KO: 1 s 重生 ⇒ walking unblockable 15-hit puppet (15 s) + 5-hit shields within 1.8

  // --- ELEMENT 元素
  enemy_1148_dssbr: kitEp('neural', 'epdamage.attack@ep_damage_ratio'),       // 底海滑动者 · neural on hit
  enemy_1148_dssbr_2: kitEp('neural', 'epdamage.attack@ep_damage_ratio'),     // 富营养的滑动者 · neural on hit
  enemy_1158_divman: (ab) => kitDeepsea(ab, { swim: true }),          // 潜水员 · in deep water: ATK up + stealth; immune to 水蚀
  enemy_1160_hvyslr: (ab) => [...kitStun3(ab), ...kitDeepsea(ab, { drown: true })],   // 码头水手 · every (spCost+1)th attack stuns; drowns in deep water
  enemy_1160_hvyslr_2: (ab) => [...kitStun3(ab), ...kitDeepsea(ab, { drown: true })], // 码头水手长 · same
  enemy_1161_tidmag: kitTidmag,                                      // 控潮术师 · attack hits target + 4 neighbours, erosion
  enemy_1161_tidmag_2: kitTidmag,                                    // 领潮员 · same
  enemy_1162_magmot: (ab) => [...kitTidmag(ab), deathSpawn(ab.tS['DeathRattle.enemy_key'], 1)], // 术师快艇 · same + 控潮术师 on death
  enemy_1305_mhslim: kitEp('burn', 'EpDamage.attack@ep_damage_ratio'),        // 灼热源石虫 · burn on hit
  enemy_1305_mhslim_2: kitEp('burn', 'EpDamage.attack@ep_damage_ratio'),      // 炽焰源石虫 · burn on hit
  enemy_2021_syfish: kitEp('erosion', 'EpDamage.attack@ep_damage_ratio'),     // 骨海漂流体 · erosion on hit
  enemy_2025_syufo: kitSyufo,                                        // 掠海漂移体 · 近地悬浮 (drops to 爬行模式 when stunned) + erosion
  enemy_1229_darmy: kitEp('apoptosis', 'epdamage.attack@ep_damage_ratio'),    // 萨卡兹王庭军战士 · apoptosis on hit
  enemy_1229_darmy_2: kitEp('apoptosis', 'epdamage.attack@ep_damage_ratio'),  // 萨卡兹王庭军精锐战士 · apoptosis on hit
  enemy_1275_dwlock_2: kitDeathEye,                                  // 萨卡兹王庭军精锐术师 · apoptosis on hit + DeathEye channel → group apoptosis
  enemy_1439_dslntf: kitNucleus,                                     // 元核孽生者 · first damage: combat state (speed ×, neural pulse around)
  enemy_1439_dslntf_2: kitNucleus,                                   // 异光体孽生者 · same
  enemy_9007_acelem: kitParasite,                                    // 假想敌：淤困 · taunt −1; parasitises its blocker (arts/s, element taken ×, its burst spreads 1000)
  enemy_10065_ftzlc: kitIgnitable,                                   // 卷心籽 · ignited by 灼藤 → arts death blast
  enemy_10067_ftsjc: kitFlameVine,                                   // 灼藤 · ATK ramps until the 1st attack (3×3 arts + burn), burn on hit, ignites 卷心籽

  // --- DOT 持续
  enemy_1234_dsubrl: kitDsubrl,                                      // 深溟巢涌者 · no attack: an arts pulse on every ally in range each second + neural; 抵抗, immune 停顿
  enemy_1234_dsubrl_2: kitDsubrl,                                    // 富营养的巢涌者 · same
  enemy_1267_nhpbr: kitPolluted,                                     // 萨卡兹枯朽战士 · death: 污染秽蚀 zone (50 / 25 true per second)
  enemy_1267_nhpbr_2: kitPolluted,                                   // 萨卡兹枯朽战士组长 · same
  enemy_1270_nhstlk: (ab) => [bleed(ab)],                            // 逐腐兽 · bleeding (arts/s, cleared by healing)
  enemy_1270_nhstlk_2: (ab) => [bleed(ab)],                          // 疯狂的逐腐兽 · same
  enemy_1272_nhtank: kitTank,                                        // 萨卡兹枯朽战车 · ground targets only, melee ×2, 秽蚀轰击 on attacks 1, 4, 7 …
  enemy_1272_nhtank_2: kitTank,                                      // 尖端萨卡兹枯朽战车 · same
  enemy_9006_actoxi: (ab) => [{                                      // 假想敌：蚀裂 · death: poison cloud on its killer
    sil: true,
    death(c, b, e) {
      if (c.reason !== 'killed') return;
      const k = c.killer && c.killer.side === 'ally' && c.killer.alive ? c.killer : null;
      const atk = e.s.atk;
      // a sourceless zone (`src` null): its ticks skip a 隐匿 / untargetable / sleeping operator (PRTS 假想敌：蚀裂: no 无视
      // 可选性 note — PRTS 作战机制's "无来源的毒雾" that reaches 隐匿 units is the stage hazard), not an airborne 起飞 one
      const cloud = (x, y) => dmgZone(b, null, x, y, T(ab, '1.projectile_range') ?? 0.8, T(ab, '1.projectile_life_time') ?? 0, T(ab, '1.interval') ?? 1, atk * (T(ab, '1.damage_atk_scale') ?? 0), 'arts', 'poison');
      if (k) b.addProjectile({ from: e, target: k, speed: 8, visual: 'lob', source: null, hitDead: true, onHit: (h) => cloud(h.x ?? k.x, h.y ?? k.y) });
      else cloud(e.x, e.y);
    },
  }],
  // 集团军重型火炮 · PRTS 天赋: "不会攻击飞行单位"; the shell hits every unit within 1.0 of its target for 100 % ATK ("此弹道会强制
  // 击中主目标，碰撞无视迷彩，不可对空"; no splash until 0.1.3) and each hit on the main target leaves a 3 s 【燃烧区域】 of radius
  // projectile_range × UACANN_ZONE_SCALE
  enemy_10122_uacann_2: (ab) => [noAirTargets(), splashAttack({ unblocked: false, radius: SHELL_SPLASH_RADIUS, noAir: true, fxKind: 'shell' }), {
    dealt(c, b, e) {
      // 【燃烧区域】 "不可对空": a flying ally (the 炎佑 dragon) standing in it takes nothing (until 0.1.3 it burned)
      dmgZone(b, e, c.target.x, c.target.y, (T(ab, 'ProjectileBoomRange.attack@projectile_range') ?? 1) * UACANN_ZONE_SCALE, T(ab, 'ProjectileBoomRange.attack@projectile_life_time') ?? 0, 1, T(ab, 'ProjectileBoomRange.attack@value') ?? 0, 'arts', 'burning', null, 0, { noAir: true });
    },
  }],
  enemy_10054_cjhot: (ab, e) => [immuneTo('sluggish'), {             // 鼎沸 · pulses arts + burn around itself; immune 停顿
    iv: e.base.bat || 1,
    tick(b, e2) {
      const r = (e2.def.raw.stats && e2.def.raw.stats.rawRangeRadius) || 1.6;
      b.fx('explode', { x: e2.x, y: e2.y, r, kind: 'boil' });
      for (const u of areaAllies(b, e2, e2.x, e2.y, r)) { hurt(b, e2, u, e2.s.atk * (T(ab, 'aoe.atk_scale') ?? 1), 'arts'); elem(b, e2, u, 'burn', e2.s.atk * (T(ab, 'aoe.ep_damage_ratio') ?? 0)); }
    },
  }],

  // --- REFLECTION 折射
  enemy_1165_duhond: kitRefraction,                                  // 深池侦察犬 · refraction
  enemy_1165_duhond_2: kitRefraction,                                // 深池侦察犬pro · refraction
  enemy_1166_dusbr: kitRefraction,                                   // 深池侦察兵 · refraction
  enemy_1166_dusbr_2: kitRefraction,                                 // 深池侦察队长 · refraction
  enemy_1168_dumage: kitRefraction,                                  // 深池暗影术师 · refraction
  enemy_1168_dumage_2: kitRefraction,                                // 深池暗影术师队长 · refraction
  enemy_1170_dushld: kitRefraction,                                  // 深池重甲卫士 · refraction
  enemy_1170_dushld_2: kitRefraction,                                // 深池重甲卫士队长 · refraction
  enemy_1169_duphlx: kitPhalanx,                                     // 深池方阵步兵 · refraction + DEF +200 per nearby same unit
  enemy_1169_duphlx_2: kitPhalanx,                                   // 深池方阵指挥官 · same
  enemy_1172_dugago: (ab) => [...kitRefraction(ab), statue(ab)],     // 守墓石像 · refraction; melee when blocked; 1st KO → unblockable statue 10 s → arts flyer
  enemy_1172_dugago_2: (ab) => [...kitRefraction(ab), statue(ab)],   // 愤怒的守墓石像 · same
  enemy_1174_duholy: kitHolyGuard,                                   // 深池伙友卫队 · refraction; ASPD-down field next to 影刃 (taunt from data)
  enemy_1174_duholy_2: kitHolyGuard,                                 // 深池伙友卫队精英 · same
  enemy_9011_acrefr: (ab) => [refraction(T(ab, 'Refracting.magic_resistance') ?? 0, T(ab, 'Refracting.max_hp') ?? 0)], // 假想敌：镜膜 · refraction + max HP while active

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
  enemy_1269_nhfly: () => [{                                         // 枯朽之种 · no normal attack: dives onto a nearby operator and self-destructs
    spawn(b, e) { e.profile.noAttack = true; },
    tick(b, e, a, dt) {
      if (a.t && !a.t.alive) { a.t = null; b.removeBuff(e, 'ab:dive'); }
      if (!a.t) {
        const l = targetsNear(b, e, e.base.rangeRadius || 1).sort((p, q) => Math.hypot(p.x - e.x, p.y - e.y) - Math.hypot(q.x - e.x, q.y - e.y));
        if (!l.length) return;
        a.t = l[0];
        b.addBuff(e, { key: 'ab:dive', flags: { noMove: true } });
      }
      if (!stepToward(e, a.t.x, a.t.y, Math.max(e.s.moveSpeed, 0.5) * MOVE_SCALE * dt) && Math.hypot(a.t.x - e.x, a.t.y - e.y) > 0.3) return;
      hurt(b, e, a.t, e.s.atk, 'phys');
      b.fx('explode', { x: e.x, y: e.y, r: 0.5, kind: 'seed' });
      b.kill(e, null);
    },
  }],

  // --- SPECIAL 特异 / others
  enemy_1045_hammer: kitStun3,                                       // 粉碎攻坚手 · every 3rd attack stuns
  enemy_1045_hammer_2: kitStun3,                                     // 粉碎攻坚组长 · same
  enemy_1116_liprr: kitPrisoner(),                                   // 普通囚犯 · confined (ASPD −50) → freed after 4 attacks (ATK +50 %)
  enemy_1116_liprr_2: kitPrisoner(),                                 // 老练囚犯 · same
  enemy_1118_lidbox_2: kitPrisoner(),                                // 拳师囚犯 · + DEF penetration when freed
  enemy_1119_vofsd: kitPrisoner(),                                   // 强壮囚犯 · + RES and regen when freed
  enemy_1121_lifbos: kitPrisoner(true),                              // 重犯 · confined DEF up; first liberation frees every prisoner
  enemy_1121_lifbos_2: kitPrisoner(true),                            // 传奇重犯 · same
  enemy_1072_dlancer: kitRush,                                       // 萨卡兹穿刺手 · accelerates while walking; first hit after block ×speed
  enemy_1320_wdrrl_2: kitFirstAoe,                                   // 萨卡兹悖谬暴虐兵长 · block ≥3 only; first attack splashes
  enemy_1302_ymtro_2: () => [blockWeight(4)],                        // “越长尘” · block ≥4 only (passengers n/a)
  enemy_1329_cbshld: kitDefDecay,                                    // 弧光镜卫 · DEF/RES drop with every damage instance
  enemy_1329_cbshld_2: kitDefDecay,                                  // 弧光镜卫长 · same
  enemy_1249_lysdb_2: (ab) => [{ spawn(b, e, a, ab2) { ab2.hitShield = T(ab, 'Shield.max_block_damage_cnt') ?? 0; } }], // 莱茵生命防卫科高级成员 · blocks one phys/arts hit
  enemy_1402_tgshd_2: kitExposeOnHit,                                // 重装侦察兵 · exposes its attackers 5 s
  enemy_1081_sotisd: (ab) => [taunt(T(ab, 'taunt.taunt_level') ?? 0)], // 游击队盾卫 · taunt +1
  enemy_1427_lrnazg: kitNazg,                                        // “灵幛” · attack hits everyone around it (+ on infection tiles)
  enemy_1422_lrsldr: () => [infectionArts()],                        // 萨卡兹枯朽前锋 · arts attacks on 源石污染区 (infection tiles)
  enemy_1422_lrsldr_2: () => [infectionArts()],                      // 萨卡兹枯朽辟路前锋 · same
  enemy_1425_lrcmra: kitChimera,                                     // 孽罪奇美拉 · activated on infection: arts attacks + pollution aura
  enemy_1425_lrcmra_2: kitChimera,                                   // 渎罪奇美拉 · same
  enemy_1430_lrrook: (ab) => [{                                      // 愧悔魂灵圣杯 · shares damage taken by nearby ground enemies
    spawn(b, e, a) { a.r = T(ab, 'takeDmg.range_radius') ?? 1.7; a.share = T(ab, 'takeDmg.damage_scale') ?? 0; stOf(b).chalices = (stOf(b).chalices ?? 0) + 1; },
    death(c, b) { stOf(b).chalices = Math.max(0, (stOf(b).chalices ?? 1) - 1); },
  }],
  enemy_1025_reveng: (ab) => [lowHpBuff(0.5, { atkPct: T(ab, 'atkup.atk') ?? 0 })],     // 寻仇者 · ATK up below half HP
  enemy_1021_bslime: (ab) => [deathBoom({ scale: T(ab, 'boom.atk_scale') ?? 0 })],       // 高能源石虫 · death: phys blast
  enemy_1067_snslime: (ab, e) => [deathBoom({ scale: T(ab, 'boom.atk_scale') ?? 0, r: (e.def.raw.stats && e.def.raw.stats.rawRangeRadius) || BOOM_RADIUS, status: { key: 'cold', dur: T(ab, 'boom.freeze') ?? 0 } })], // 冰爆源石虫 · death: phys blast + cold
  enemy_1069_icebrk_2: (ab) => [{ hitOut(c, b, e) { if (c.dmg.isAttack && c.target.s.flags.freeze) c.dmg.amount *= T(ab, 'atkup.atk_scale') ?? 1; } }], // 雪怪小队破冰者 · ×3 vs frozen
  enemy_1026_aghost: () => [unblockable()],                          // 幽灵组长 · unblockable
  enemy_1062_rager_2: (ab) => [{ iv: 1, tick(b, e) { const v = T(ab, 'periodic_damage.damage') ?? 0; if (v > 0) b.dealDamage(null, e, periodicDamage(v)); } }], // 狂暴宿主组长 · "自身每秒受到500无来源真实伤害" (damage, not 流失)
  enemy_1183_mlasrt: (ab) => [ep('erosion', T(ab, 'EpDamage.attack@ep_damage_ratio') ?? 0), nthAttackPower(nthOf(ab.sk.PowerAttack), (ab.sk.PowerAttack && ab.sk.PowerAttack.bb.atk_scale) || 1)], // 无胄盟清扫小队 · erosion; every 4th attack ×1.5
  enemy_1273_stmgun_2: (ab) => {                                     // 高准度伦蒂尼姆城防自行炮 · locks the highest max-HP unit in range, bombards the highest HP% on its 9 tiles
    // the allies in its range (the engine's ranged reach: radius + the ally collider)
    const inRange = (b, e) => allTargets(b, e).filter((a) => Math.hypot(a.x - e.x, a.y - e.y) <= (e.base.rangeRadius || 0) + ALLY_COLLIDER_RADIUS + 1e-9);
    return [skill(ab.sk.Cannon, (b, e) => {
      const lock = inRange(b, e).sort((p, q) => q.s.maxHp - p.s.maxHp)[0];
      if (!lock) return;
      const r0 = Math.round(lock.y), c0 = Math.round(lock.x);
      const dur = CANNON_SHOTS * CANNON_EVERY;
      b.fx('telegraph', { x: c0, y: r0, r: 1.5, dur, kind: 'cannon' });
      b.addBuff(e, { key: 'ab:cannon', duration: dur, flags: { noDisplace: true } });
      const ab2 = e.mem.ab;
      const had = new Set(ab2.immune || []);
      ab2.immune = new Set([...had, ...CANNON_IMMUNE]);
      for (let i = 1; i <= CANNON_SHOTS; i++) b.after(i * CANNON_EVERY, () => {
        if (!e.alive) return;
        if (i === CANNON_SHOTS) ab2.immune = had;
        // each shot picks inside the 9-tile zone (格子判定): an area selection — a 迷彩 ally may be shot, an unblocking 隐匿
        // one not (areaSelectable; it used to skip 迷彩 like a normal attack)
        const t = b.allies().filter((a) => areaSelectable(e, a) && Math.abs(Math.round(a.y) - r0) <= 1 && Math.abs(Math.round(a.x) - c0) <= 1)
          .sort((p, q) => q.hpRatio - p.hpRatio)[0];
        if (t) { b.fx('explode', { x: t.x, y: t.y, r: 0.5, kind: 'cannon' }); hurt(b, e, t, e.s.atk * (ab.sk.Cannon.bb.atk_scale ?? 0), 'arts'); }
      }, { owner: e });
    }, { cond: (b, e) => inRange(b, e).length > 0 })];
  },
  // 萨卡兹骸骨拷打者 · heals + ATK stack when a unit within Attack.range_radius is knocked out; leaves 2 血珀 on death — they
  // stay where it fell and wait for a 唤血祭坛 that this mode has none of (inert, not counted)
  enemy_1364_spnaxe_2: (ab) => [{
    death(c, b, e) {
      const key = ab.tS['Summon.enemy_key'], n = T(ab, 'Summon.cnt') ?? 0;
      if (c.reason !== 'killed' || !key || !(n > 0)) return;
      spawnChildren(b, e, key, n, { route: stayRoute(e), countInTotal: false, mods: null });
    },
  }, {
    spawn(b, e) { watchDeaths(b, e); },
    otherDeath(c, b, e) {
      const u = c.unit;
      if (!u || u === e || c.reason !== 'killed' || Math.hypot(u.x - e.x, u.y - e.y) > (T(ab, 'Attack.range_radius') ?? TORTURER_RADIUS) + 1e-9) return;
      b.heal(e, e, e.s.maxHp * (T(ab, 'Attack.hp_ratio') ?? 0), { self: true });
      b.addBuff(e, { key: 'ab:torture', refresh: 'stack', stacks: 1, maxStacks: T(ab, 'Attack.max_stack_cnt') ?? 1, persist: true, mods: { atkPct: T(ab, 'Attack.atk') ?? 0 } });
    },
    hitOut(c, b, e) { if (c.dmg.isAttack && c.target !== e.blockedBy) c.dmg.amount *= T(ab, 'Attack.attack@ranged_atk_scale') ?? 1; },
  }],
  enemy_1501_demonk: () => [maxTargets(2)],                          // 萨卡兹百夫长 · attacks 2 targets
  enemy_10018_sgrobh: () => [maxTargets(2)],                         // “独轮车玩具” · attacks 2 targets
  enemy_2001_duckmi: (ab) => [unblockable(), runWhenHit(T(ab, 'run.attack@move_speed') ?? 0)],   // 鸭爵 · unblockable, no attack; runs +400 % once hurt
  enemy_2001_duckmi_2: (ab) => [unblockable(), runWhenHit(T(ab, 'run.attack@move_speed') ?? 0)], // 鸭爵 (鸭爵 strategy) · same, +300 %
  enemy_10159_mntrjn: () => [unblockable()],                         // 伊利昂的木驮兽 · unblockable (passengers n/a)
  enemy_2009_csaudc: kitEp('neural', 'combat.attack@ep_damage_ratio'), // 骇笑看客 · neural on hit
  enemy_2010_csdcr: (ab) => [ep('neural', T(ab, 'attack.attack@ep_damage_ratio') ?? 0), { // 绯红歌伶 · neural on hit; every 20 hits taken: global enemy ASPD up
    taken(c, b, e, a) {
      a.n = (a.n ?? 0) + 1;
      if (a.n < (T(ab, 'AttackSpeedUp.stack_cnt') ?? Infinity)) return;
      a.n = 0;
      b.fx('telegraph', { x: e.x, y: e.y, r: 99, kind: 'songOfWar', id: e.id });
      for (const o of b.aliveEnemies()) b.addBuff(o, { key: 'ab:songOfWar', duration: T(ab, 'AttackSpeedUp.duration') ?? 0, refresh: 'extend', mods: { aspd: T(ab, 'AttackSpeedUp.attack_speed') ?? 0 }, visible: true });
    },
  }],
  enemy_10001_trslim: (ab) => [skill(ab.sk.StartRun, (b, e) => {    // 简饲源石虫 · below half: runs (faster, unblockable 3 s)
    const s = ab.sk.StartRun.bb;
    b.addBuff(e, { key: 'ab:run', duration: s.block_free_time ?? 0, mods: { moveMul: 1 + (s.move_speed ?? 0) }, flags: { unblockable: true }, visible: true });
  }, { sil: true, cond: (b, e) => e.hpRatio < 0.5 })],
  enemy_10027_vtsk: (ab) => {                                        // “帝国的甲胄” · entrance barrage on the highest-HP unit; ranged ×0.8; 3-hit charge attack
    const ap = ab.sk.Appear, mc = ab.sk.MultiCombat;
    return [{
      spawn(b, e) {
        const n = ap ? ap.bb.times ?? 0 : 0;
        b.after(0.5, () => {
          if (!e.alive || !n) return;
          const lock = allTargets(b, e).sort((p, q) => q.hp - p.hp)[0];
          if (!lock) return;
          b.fx('telegraph', { x: lock.x, y: lock.y, r: 1, kind: 'barrage', id: e.id });
          for (let i = 0; i < n; i++) {
            // "对碰撞范围内的1名当前生命值最高的我方单位" — an area selection: never an airborne 起飞 ally nor an unblocking
            // 隐匿 one (PRTS “帝国的甲胄”; areaAlliesInTiles)
            const t = areaAlliesInTiles(b, e, lock.tileR, lock.tileC, 'box', 1).sort((p, q) => q.hp - p.hp)[0];
            if (t) hurt(b, e, t, e.s.atk, 'phys');
          }
        }, { owner: e });
      },
      hitOut(c, b, e) { if (c.dmg.isAttack && c.target !== e.blockedBy) c.dmg.amount *= T(ab, 'range.attack@atk_scale_range') ?? 1; },
    }, mc ? {
      cd: mc.cd, icd: mc.icd, fire(b, e) { e.mem.ab.multi = mc.bb.times ?? 1; },
      dealt(c, b, e) {
        const m = e.mem.ab.multi;
        if (!(m > 1)) return;
        e.mem.ab.multi = 0;
        for (let i = 1; i < m; i++) hurt(b, e, c.target, e.s.atk, 'phys');
      },
    } : null];
  },
  enemy_10044_wintun: (ab) => {                                      // 咸鳞汁推荐者 · fast with the barrel; first attack (SILENCE): big hit + buff zone for enemies
    const s = ab.sk.BlockedBoom ? ab.sk.BlockedBoom.bb : {};
    return [{
      sil: true,                                                     // silenced: the barrel is kept (and its speed) until an unsilenced attack
      spawn(b, e) { b.addBuff(e, { key: 'ab:barrel', persist: true, mods: { moveMul: T(ab, '1.move_speed') ?? 1 } }); },
      hitOut(c, b, e, a) { if (!a.done && c.dmg.isAttack) c.dmg.amount *= s.blockee_atk_scale ?? 1; },
      attack(c, b, e, a) {
        if (a.done) return;
        a.done = true;
        b.removeBuff(e, 'ab:barrel');
        const x = e.x, y = e.y, life = s.fixed_duration ?? 0;
        b.fx('zone', { x, y, r: BARREL_RADIUS, dur: life, kind: 'barrel' });
        let left = life;
        const h = b.every(0.5, () => {
          for (const o of b.enemiesInRadius(x, y, BARREL_RADIUS)) auraBuff(b, o, 'ab:barrelZone', 0.5, { aspd: s.attack_speed ?? 0, dodgePhys: s.prob ?? 0 });
          left -= 0.5;
          if (left <= 0) h.cancel();
        });
      },
    }];
  },
  enemy_10045_parrot: kitParrot,                                     // 吉兆飞鳞 · 近地悬浮 (grounded 8 s when stunned); sprints when first hit
  enemy_10087_hlchgr: (ab) => [{                                     // 圣堂剑士 · spends ammo (every 6 s, max 5) for permanent speed/ATK
    iv: T(ab, 'SkillTrigger.interval') ?? 6,
    tick(b, e, a) {
      a.n = (a.n ?? 0) + 1;
      if (a.n > 5) return;
      const s = ab.sk.ForeverEnhance ? ab.sk.ForeverEnhance.bb : {};
      b.addBuff(e, { key: 'ab:enhance', refresh: 'stack', stacks: 1, maxStacks: 5, persist: true, mods: { moveFlat: (s.move_speed_add ?? 0) * e.base.moveSpeed, atkPct: s.atk_add ?? 0 } });
    },
  }],
  enemy_10094_crstf: kitEp('neural', 'ep.ep_damage_ratio'),          // 临时收音师 · neural on hit (filming zones n/a → always)
  enemy_10097_crshd: (ab) => [                                       // 心虚设计师 · neural to its blocker every s; front damage −80 % (faces its walk)
    { iv: 1, tick(b, e) { if (e.blockedBy) elem(b, e, e.blockedBy, 'neural', e.s.atk * (T(ab, 'block.ep_damage_ratio') ?? 0)); } },
    frontGuard(T(ab, 'weakness.damage_resistance') ?? 0, faceMove),  // 减少来自正面的物理/法术伤害 (cameras absent: it never turns)
  ],
  enemy_10098_crhro: (ab) => [ep('neural', T(ab, 'inside.attack@ep_damage_ratio') ?? 0), // 主角阵营角色 · neural on hit; 重生 once (reborn.duration s, full HP)
    reborn({ dur: T(ab, 'reborn.duration') ?? 0, invincible: T(ab, 'reborn.invincible') ?? 0 })],
  enemy_10099_crvln: kitEp('neural', 'inside.attack@ep_damage_ratio'), // 反派阵营角色 · neural on hit
  enemy_10116_ymgtop: (ab) => {                                     // 水遁忍者 · spinning phase (SILENCE): phys AoE every s; 失衡 stops it
    const spin = {
      sil: true, cd: ab.sk.SwitchModeTrigger ? ab.sk.SwitchModeTrigger.cd : 60, icd: ab.sk.SwitchModeTrigger ? ab.sk.SwitchModeTrigger.icd : 10,
      fire(b, e, a) { a.until = b.time + (T(ab, 'EndRotate.rotate_duration') ?? 0); b.fx('telegraph', { x: e.x, y: e.y, r: 1, kind: 'spin', id: e.id }); },
      iv: T(ab, 'RotateDamage.interval') ?? 1,
      // "每秒对半径1.0范围内的所有我方单位造成…（无视迷彩，不可对空），自身受阻止攻击类异常效果影响期间无法造成此伤害": an area
      // selection, skipped while 晕眩 / 冻结 / 浮空 (flag stun), 沉睡 or 缴械 hold it (PRTS 异常效果 §阻止攻击; until 0.1.3 it spun on)
      tick(b, e, a) {
        if (!(a.until > b.time) || e.s.flags.stun || e.s.flags.sleep || e.s.flags.disarm) return;
        for (const u of areaAllies(b, e, e.x, e.y, T(ab, 'RotateDamage.attack@range_radius') ?? 1)) hurt(b, e, u, e.s.atk * (T(ab, 'RotateDamage.attack@atk_scale') ?? 1), 'phys');
      },
    };
    // 漩涡形态 "不进行普通攻击" (PRTS 天赋): no blocked attack while it spins (until 0.1.3 its blocker took both)
    const noAtk = { tick(b, e) { e.profile.noAttack = spin.until > b.time; } };
    return [spin, noAtk, unbalanced((b, e) => { if (spin.until > b.time) { spin.until = 0; b.fx('phase', { x: e.x, y: e.y, id: e.id, kind: 'spinStop' }); } })];
  },
  enemy_10118_ymgprc: (ab) => {                                      // 澪 · double hits; 寒晖: every 4th attack (spCost 3) is a ×1.5 double hit
    const scale = (ab.sk.PowerAttack && ab.sk.PowerAttack.bb.atk_scale) || 1;
    const pw = nthAttackPower(nthOf(ab.sk.PowerAttack), scale);
    return [pw, { dealt(c, b, e) { hurt(b, e, c.target, e.s.atk * (pw.power ? scale : 1), 'phys', { isSkill: false }); } }];
  },
  enemy_10127_rkmbst_2: (ab) => [taunt(1), { spawn(b, e) {           // 异质裂兽·α · M0 shield (damage ×0.5, ASPD +100, barrier)
    b.addBuff(e, { key: 'ab:m0', persist: true, visible: true, mods: { dmgTakenMul: 1 - (T(ab, 'M0Shield.damage_resistance') ?? 0), aspd: T(ab, 'M0Shield.attack_speed') ?? 0 } });
    const sh = e.s.maxHp * (T(ab, 'M0Shield.init_shield_hp_ratio') ?? 0);
    if (sh > 0) b.addBuff(e, { key: 'ab:m0barrier', shield: sh, persist: true });
  } }],
  enemy_10156_mncrer: (ab) => [{ sil: true, death(c, b, e) {         // 新手祭司学徒 · death: heals nearby enemies
    if (c.reason !== 'killed') return;
    const r = T(ab, 'Boom.projectile_range') ?? 1, amt = e.s.atk * (T(ab, 'Boom.heal_scale') ?? 0);
    b.fx('explode', { x: e.x, y: e.y, r, kind: 'heal' });
    for (const o of b.enemiesInRadius(e.x, e.y, r)) if (o !== e) b.heal(e, o, amt);
  } }],
  enemy_10162_mnctpt: (ab) => [{                                     // 自制投石机 · 3-hit attacks with small splash
    dealt(c, b, e) {
      const n = T(ab, 'Attack.attack@times') ?? 1, r = T(ab, 'Attack.attack@projectile_range') ?? 0;
      const t = c.target;
      for (let i = 1; i < n; i++) hurt(b, e, t, e.s.atk, 'phys');
      // the stone's splash ("碰撞无视迷彩"): an area selection — no unblocking 隐匿 ally
      if (r > 0) for (const u of areaAllies(b, e, t.x, t.y, r)) if (u !== t) for (let i = 0; i < n; i++) hurt(b, e, u, e.s.atk, 'phys');
    },
  }],
  enemy_1050_lslime: (ab, e) => kitLeaderMisc('enemy_1050_lslime', ab, e),   // “庞贝” · 4 targets, burning DoT, self-blast when blocked, ASPD up below half
  enemy_1500_skulsr: (ab, e) => kitLeaderMisc('enemy_1500_skulsr', ab, e),   // 碎骨 · unblocked grenades (splash + DEF down); ATK up below half
  enemy_1502_crowns: (ab, e) => kitLeaderMisc('enemy_1502_crowns', ab, e),   // 弑君者 · blinks past its blocker
  enemy_1504_cqbw: (ab, e) => kitLeaderMisc('enemy_1504_cqbw', ab, e),       // W · C4 (2 below half)
  enemy_1509_mousek: (ab, e) => kitLeaderMisc('enemy_1509_mousek', ab, e),   // 鼠王 · opening barrier with DEF up; enrage below half
  enemy_1511_mdrock: (ab, e) => kitLeaderMisc('enemy_1511_mdrock', ab, e),   // 泥岩 · stacking ATK, refreshed barrier (+HP/ASPD while up)
  enemy_1513_dekght: (ab, e) => kitLeaderMisc('enemy_1513_dekght', ab, e),   // 腐败骑士 · plus-shaped hits; rage when 凋零骑士 dies
  enemy_1513_dekght_2: (ab, e) => kitLeaderMisc('enemy_1513_dekght_2', ab, e), // 凋零骑士 · 2 targets; rage when 腐败骑士 dies
  enemy_1539_reid: (ab, e) => kitLeaderMisc('enemy_1539_reid', ab, e),       // “复仇者” · ATK up below half; revives once at 50 %
  enemy_2003_rockman: (ab, e) => kitLeaderMisc('enemy_2003_rockman', ab, e), // 迷路的巨像 · long-stun boulder on a non-stunned unit
  enemy_2004_balloon: (ab, e) => kitLeaderMisc('enemy_2004_balloon', ab, e), // 喷气人 · takes off when blocked: 7 s hovering, unblockable, 失衡免疫
  enemy_2005_axetro: (ab, e) => kitLeaderMisc('enemy_2005_axetro', ab, e),   // “遗弃者” · attack stacks, reset after 4 s idle
  enemy_2008_flking: (ab, e) => kitLeaderMisc('enemy_2008_flking', ab, e),   // “墓碑” · operators' ATK/DEF halved; periodic barrier
  enemy_2048_smgrd: (ab, e) => kitLeaderMisc('enemy_2048_smgrd', ab, e),     // “邪魔的利刃” · 国度 ASPD-down around it, ×2.5 inside
  enemy_2050_smsha: (ab, e) => kitLeaderMisc('enemy_2050_smsha', ab, e),     // 陷落雪祀 · cold + 3-target chain
  enemy_2052_smgia: (ab, e) => kitLeaderMisc('enemy_2052_smgia', ab, e),     // 纠缠藤蔓 · every 3rd attack stuns 15 s; fragile after terrain damage

  // --- multi-form leaders and other bounty (悬赏) targets
  enemy_1512_mcmstr: kitUglyThing,                                   // “巨大的丑东西” · melee ×3; KO ⇒ stun blast, fleeing 大祭司 (true HP loss/s)
  enemy_1516_jakill: kitWarden,                                      // 杰斯顿·威廉姆斯 · ranged arts + multi-stun ⇒ killer form (frees prisoners, armour piercing)
  enemy_1517_xi: kitXi,                                              // “自在” · cross arts, 破桎而出 barrier blast ⇒ form 2 (double hits, 2 crosses)
  enemy_1525_blkswb: kitMace,                                        // 锏 · 抵抗, DEF pen, 速杀 blink, AoE ⇒ form 2 (stealth, double hits, SP clear)
  enemy_1535_wlfmster: kitWolfLord,                                  // 扎罗 · −30 % damage, 溶血骇惧 ⇒ 远古威慑 rebirth ⇒ ranged double hits
  enemy_10081_mpplai: kitTranslator,                                 // 转译基底·α · damage cancelled; 4th phys / 4th arts hit or blocked ⇒ 2 s change ⇒ 寻仇者 / 特战术师 / 幽灵
  enemy_10144_xdelk_2: kitElk,                                       // 乌顶巨角卢鲁 · 角力对决 charge on its blocker (push fails ⇒ damage + stun)
  // 圆仔 · PRTS 天赋 "无法攻击/被阻挡；受到来源于正面的物理和法术伤害-80%；自身始终朝向我方干员数量最多的方向" (no attack: applyWay
  // NONE; its 倒走 / 【炫耀】 is "仅用于演出，无额外效果"): unblockable, faces the bigger crowd, front damage −80 %
  enemy_2085_skzjxd: (ab) => [unblockable(), frontGuard(T(ab, 'Weakness.damage_resistance') ?? 0, faceCrowd)],
  enemy_2085_skzjxd_2: (ab) => [unblockable(), frontGuard(T(ab, 'Weakness.damage_resistance') ?? 0, faceCrowd)], // (鸭爵 strategy) same
  // 失衡 (pushed / pulled by operators)
  enemy_1328_cbjedi: (ab) => [unbalanced((b, e, a, d) => {           // 弧光锋卫 · takes damage in proportion to the distance moved while unbalanced
    // PRTS 修正 "失衡移动时持续受到真实伤害", "处于失衡状态时，每0.066s受到400点无来源真实持续伤害" (伤害分类: 弧光锋卫失衡状态下的自残
    // 伤害 is BUFF damage): damage, not a 流失 (player report D1 audit)
    const v = T(ab, 'unbalanced_bleed.damage') ?? 0, iv = T(ab, 'unbalanced_bleed.interval') ?? 1;
    if (v > 0 && iv > 0) b.dealDamage(null, e, { ...periodicDamage((v * d) / (iv * UNBALANCE_SPEED)), tags: ['dot', 'periodic', 'unbalanced'] });
  })],
  enemy_10112_ymgds: (ab) => [unbalanced((b, e) => {                 // 冒失的小弟 · stunned after being unbalanced
    const st = T(ab, 'StunAfterUnbalance.stun') ?? 0;
    if (st > 0) b.applyStatus(e, 'stun', { duration: st, source: null });
  })],
  enemy_10138_xdsnow: (ab) => [unbalanced((b, e, a) => {             // 雪孩子 · pushed / pulled into high ground ⇒ hitWall.value damage
    const dx = e.x - a.lx, dy = e.y - a.ly, d = Math.hypot(dx, dy);
    if (!(d > 0)) return;
    const r = Math.round(e.y + (dy / d) * 0.6), c = Math.round(e.x + (dx / d) * 0.6);
    if (b.grid.isLow(r, c) && b.grid.groundPassable(r, c)) return;   // stopped by nothing: no collision
    b.fx('explode', { x: e.x, y: e.y, r: 0.4, kind: 'wallHit', id: e.id });
    hurt(b, null, e, T(ab, 'hitWall.value') ?? 0, 'true', { tags: ['wallHit'] });
  })],
  // 拥霜羽兽 · PRTS 天赋 "不会攻击飞行单位"; unbalanced once ⇒ 失去蛋的模式 "不进行普通攻击，不可阻挡，移动速度最终提升至200%" (until
  // 0.1.3 it kept its ranged attack without the egg and stood for each attack clip — ai.js attackStand —, and shot the 炎佑 dragon)
  enemy_10141_xdpeng_2: (ab) => [noAirTargets(), unbalanced((b, e, a) => {
    if (a.done) return;
    a.done = true;
    e.profile.noAttack = true;
    b.addBuff(e, { key: 'ab:noEgg', persist: true, visible: true, flags: { unblockable: true }, mods: { moveMul: 1 + (T(ab, 'speed.move_speed') ?? 0) } });
  })],
});

/** Keys deliberately left to their data stats (reason). */
export const STATS_ONLY = Object.freeze({
  enemy_1000_gopro_2: 'plain melee', enemy_1001_bigbo: 'plain leader (bounty)', enemy_1005_yokai: 'FLY, no attack (engine)',
  enemy_1005_yokai_2: 'FLY ranged (engine)', enemy_1005_yokai_3: 'FLY ranged (engine)', enemy_1006_shield: 'heavy defender',
  enemy_1006_shield_2: 'heavy defender', enemy_1006_shield_3: 'heavy defender', enemy_1007_slime: 'plain',
  enemy_1010_demon: 'plain', enemy_1010_demon_2: 'plain', enemy_1041_lazerd: 'FLY arts (engine)', enemy_1041_lazerd_2: 'FLY arts (engine)',
  enemy_1043_zomsbr: 'regen is data (hpRecoveryPerSec 80)', enemy_1061_zomshd: 'regen is data (hpRecoveryPerSec 200)',
  enemy_1046_agent: 'plain', enemy_1071_dftman: 'plain', enemy_1092_mdgint: 'plain (bounty)',
  enemy_1251_lysyta: 'R-series armour interaction absent', enemy_1251_lysyta_2: 'same',
  enemy_1252_lysytb_2: 'same', enemy_1254_lypa_2: 'no listed ability', enemy_1325_cbgpro: 'plain', enemy_1325_cbgpro_2: 'plain',
  enemy_1367_dseed: 'altar pulse absent (骸骨拷打者 leaves them inert, uncounted, in place)',
  enemy_1381_winman: 'plain', enemy_1381_winman_2: 'plain', enemy_1387_winshd: '封冻/供暖器 zones absent', enemy_1415_mmkabi_2: 'chains absent',
  enemy_1433_dsbasi: 'plain', enemy_1433_dsbasi_2: 'plain', enemy_1438_dspred: '赘生甲壳 absent',
  enemy_2002_bearmi: 'plain', enemy_2002_bearmi_2: 'plain',
  enemy_9012_acloon: '炎佑 is a bond summon (bonds.js)', enemy_10040_cnvbln: '狂欢时刻 absent', enemy_10043_sailor: 'bridges/cannons absent',
  enemy_10073_mpcar: 'plain', enemy_10124_uashld_2: 'taunt is data; 矿工游击队 absent',
});

// 圣杯 damage sharing: ground enemies near a living chalice pass `share` of the damage they take to it.
function chaliceShare(b, c) {
  const st = stOf(b);
  if (!(st.chalices > 0)) return;
  const t = c.target;
  if (!t || t.side !== 'enemy' || t.isFlying || c.dmg.cancel || c.dmg.type === 'element' || (c.dmg.tags && c.dmg.tags.includes('chalice'))) return;
  for (const o of b.enemies) {
    if (!o.alive || o === t || o.defId !== 'enemy_1430_lrrook' || !o.mem.ab) continue;
    const a = o.mem.ab.list[0];
    if (!a || !(a.share > 0) || Math.hypot(o.x - t.x, o.y - t.y) > a.r) continue;
    const part = c.dmg.amount * a.share;
    c.dmg.amount -= part;
    // a 无来源 burst's share stays 无来源, credited like the burst (damage.js)
    b.dealDamage(c.dmg.sourceless ? c.credit : c.source, o, { amount: part, type: c.dmg.type, canDodge: false, sourceless: c.dmg.sourceless, tags: [...(c.dmg.tags || []), 'chalice'] });
    break;
  }
}
