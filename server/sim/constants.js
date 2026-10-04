// server/sim/constants.js — simulation timing, conversions and tuning knobs (DESIGN §3, §4, §5).
// Pure data; every value here is safe to tweak for balancing. Nothing in the sim reads wall-clock time.

import { GEO } from '../../shared/constants.js';

/** Fixed simulation step in game seconds (DESIGN §4). */
export const TICK = 1 / 30;
/** Snapshots are produced every N ticks by the match (20 Hz at 2× real time). */
export const SNAPSHOT_EVERY = 3;

export const ROWS = GEO.ROWS;
export const COLS = GEO.COLS;

/** tilesPerSecond = moveSpeed × MOVE_SCALE (DESIGN §3). */
export const MOVE_SCALE = 0.5;
/**
 * An unblocked ranged enemy stands for each attack's clip (ai.js attackStand, GitHub #58); one whose model has no attack
 * clip known (no `attackAnim` in data/enemies.json) stands this long after each attack instead, as do all after an
 * attack 麻痹 interrupts (DESIGN §5.5).
 */
export const ATTACK_PAUSE = 0.35;
/**
 * Collider radius of an allied unit (PRTS 作战机制 §碰撞体积与位置识别: "我方干员碰撞体积基本均为以0.25格为半径的圆形" —
 * "关于碰撞体积与远程索敌，碰撞箱碰撞是为最常用的方式，索敌抬手等均使用碰撞箱"; the Ifrit 0.1 collider example). A ranged enemy's
 * normal attack takes an ally whose collider touches its range circle: centre distance ≤ rangeRadius + this
 * (ai.js enemyAttack; user playtest #6 follow-up — 萨卡兹枯朽战车's 2.2 reaches 2.45). [ASSUMED] every ally, summons
 * included; enemy skills / zones of content keep their own (point) radius.
 */
export const ALLY_COLLIDER_RADIUS = 0.25;
/**
 * Block contact (PRTS 游戏数据基础 §阻挡半径; 作战机制 §碰撞体积与位置识别 "中点判定 … 案例: 阻挡"): an unblocked enemy whose
 * position lies within the blocker's radius of the blocker's centre touches it — compared on squared distances, as the
 * official client does. Ground blocking 0.70709997 (² 0.49999037); air blocking (起飞 / blockFly units against flyers)
 * 0.8944 (² 0.79995137); devices override it (阻隔工事 / 障碍物 0.4472). Used by Battle._checkBlock (user playtest #5).
 */
export const BLOCK_RADIUS = Object.freeze({ ground: 0.70709997, fly: 0.8944, device: 0.4472 });
export const BLOCK_RADIUS_SQ = Object.freeze({ ground: 0.49999037, fly: 0.79995137, device: 0.4472 * 0.4472 });
/**
 * An enemy's 隐匿 after a block ends (s): PRTS 作战机制 §隐匿 "对于绝大部分可隐匿的敌人而言，在被我方单位阻挡后会解除隐匿，不被
 * 阻挡的3秒后重新进入隐匿" / §隐匿与Buff的关系 "阻挡状态解除后3s开关重新被开启而恢复隐匿". An enemy page's "（解除阻挡N秒后
 * 恢复）" overrides it per 隐匿 source (buff `data.stealthRestore`: content/enemies.js). Battle._stealthSwitch; our
 * operators' 隐匿 / 迷彩 are never lifted by blocking ("我方干员并不会因为阻挡而解除隐匿").
 */
export const STEALTH_RESTORE = 3;
/** Default projectile speed in tiles/s for ranged operators/enemies. */
export const PROJECTILE_SPEED = 12;
/**
 * Projectile speeds per visual kind (tiles/s). `none`/`beam` are instant. `boomerang` (回环射手 跃跃) is the OUTBOUND
 * flight to the target — PRTS 跃跃 特性 note "投射物飞行速度15，返回时飞行速度3.75"; the way back is
 * BOOMERANG_RETURN_SPEED (ai.js throwBoomerang). `droneBomb` = 暴鸰's bomb (the official projectile_bombd `_speed` 5;
 * content/enemies.js kitBombd).
 */
export const PROJECTILE_SPEEDS = Object.freeze({ arrow: 14, bolt: 11, bomb: 8, lob: 8, orb: 10, drone: 16, enemy: 10, boomerang: 15, droneBomb: 5 });
/** 回环射手: speed (tiles/s) of a boomerang flying back from its hit point to its thrower (PRTS "返回时飞行速度3.75"). */
export const BOOMERANG_RETURN_SPEED = 3.75;

/** Minimum damage ratio after mitigation (5 % of the pre-mitigation amount). */
export const MIN_DAMAGE_RATIO = 0.05;

/** Element gauge capacity of operators and normal/elite enemies; leaders (rank BOSS) hold 2000 (ba.dt.*2). */
export const ELEMENT_GAUGE_MAX = 1000;
export const ELEMENT_GAUGE_MAX_LEADER = 2000;
/** Element names with a gauge on every unit. `necrosis` is a legacy spare gauge (凋亡 is `apoptosis`). */
export const ELEMENTS = Object.freeze(['burn', 'neural', 'necrosis', 'apoptosis', 'erosion']);
/**
 * Element bursts — official term table (gamedata_const termDescriptionDict):
 *   `ally` = an operator/summon hit by enemy damage (ba.dt.burning / neural / apoptosis / erosion),
 *   `enemy` = an enemy hit by operators (the "·我方" terms ba.dt.burning2 / neural2 / apoptosis2 / erosion2;
 *   `elemDamage` is 元素伤害: HP damage through 元素抗性 instead of DEF/RES, × elementalTakenMul = 元素脆弱).
 * Burst damage is 无来源 (PRTS 元素): no damage-dealt multiplier or penetration of the unit that filled the gauge.
 * `duration` = the burst's 爆发冷却 (PRTS 元素 table "持续时间": 10 s, 凋亡 15 s, 侵蚀 on enemies 8 s — the operators'
 * 侵蚀 burst has its 10 s cooldown too): while it runs NO element of the unit fills or recovers, and when it ends every
 * gauge of the unit resets (damage.js).
 * `necrosis` keeps the engine's earlier invented burst (no official counterpart) for legacy content.
 */
export const ELEMENT = Object.freeze({
  burn: Object.freeze({
    burstDamage: 1200, burstType: 'arts', resDown: 20, duration: 10,
    ally: Object.freeze({ damage: 1200, type: 'arts', resDown: 20, duration: 10 }),
    enemy: Object.freeze({ elemDamage: 7000, resDown: 20, duration: 10 }),
  }),
  neural: Object.freeze({
    burstDamage: 1000, burstType: 'true', stun: 10, duration: 10,
    ally: Object.freeze({ damage: 1000, type: 'true', stun: 10, duration: 10 }),
    enemy: Object.freeze({ elemDamage: 6000, palsy: 3, duration: 10 }),
  }),
  apoptosis: Object.freeze({
    dps: 100, duration: 15,
    ally: Object.freeze({ dps: 100, dpsType: 'arts', spLossPerSec: 1, duration: 15 }),
    enemy: Object.freeze({ elemDps: 800, weaken: 0.5, duration: 15 }),
  }),
  erosion: Object.freeze({
    ally: Object.freeze({ damage: 800, type: 'phys', defDown: 100, duration: 10 }),
    enemy: Object.freeze({ elemDamage: 5000, defDown: 120, duration: 8 }),
  }),
  necrosis: Object.freeze({ dps: 100, duration: 12, atkDownPct: 0.2 }),
});
/**
 * Official element order (PRTS 元素: SANITY 1 神经, WATER 2 侵蚀, FIRE 3 灼燃, DARK 4 凋亡; the legacy `necrosis` last):
 * the tie-break of the "当前损伤元素" a unit shows — the fullest gauge, then the lower id (damage.js elementView).
 */
export const ELEMENT_ORDER = Object.freeze(['neural', 'erosion', 'burn', 'apoptosis', 'necrosis']);
/** 麻痹 (ba.palsy): each stack cancels one normal attack of an enemy; at most 3 stacks, lasts until consumed. */
export const PALSY_MAX = 3;

/**
 * Push / pull (位移; user playtest #6 item 14). The 受力等级 is the source's 力度 minus the target's current 重量等级
 * (massLevel, 失重 counts) — PRTS 游戏数据基础 §重量公式 (力度: 微小力 −1, 小力 0, 中力 1, 较大力 2, 大力 3, 大力+1 4, 特大力
 * 5) and PRTS 推与拉. PUSH_TILES = the official push distance per 受力等级 (游戏数据基础 "推力-位移近似对应表": ≤ −3 → 0,
 * −2 → 0.12, −1 → 0.44, 0 → 1.7, 1 → 2.14, 2 → 2.96, ≥ 3 → 3.53 tiles). Pulls (拖拽 / 捕网, "拉力-位移近似对应表"):
 * ≥ 0 → all the way to the pull point (必定拉至身前), −1 → PULL_WEAK_SHARE of the starting distance, −2 → PULL_CRAWL
 * tiles, ≤ −3 → nothing. A pull "至面前" aims at the point PULL_ORIGIN tiles in front of the puller (拉力起点 "干员前方0.5格
 * 距离处") and stops once the target is within PULL_STOP_RADIUS of the puller's centre (急停 "拖拽者中心半径0.6708").
 * A directional push (推击手, 野鬃 S2 — the client buff template knockback[dir] —, 朝部署方向) on a target more than 45°
 * off the direction or nearer than PUSH_DIRECTIONAL_MIN_DIST becomes radial with 受力等级 −2 (推与拉 "特殊修正";
 * knockback[dir] _decreaseForceLevelWhenNotInDirection 2).
 * PRTS 推与拉 gives two columns of 理想移动距离: 弹道 (a push carried by a projectile — "温蒂的23技能、阿消的12技能"; equal
 * to the 游戏数据基础 table above) and 特效 (an effect push, one frame less of travel — "食铁兽的12技能、见行者的12技能"):
 * PUSH_TILES_EFFECT, used by the skills in PUSH_EFFECT_SKILLS (见行者 S1 护身射击 / S2 惊爆射击, the only 特效 pushers of
 * the pool PRTS names). [ASSUMED: every other push of the pool (野鬃, 山, 莫斯提马, 琳琅诗怀雅, 圣聆初雪, 薄绿) uses the 弹道
 * column — PRTS does not classify them; the two columns differ by 7–12 %.]
 */
export const PUSH_TILES = Object.freeze({ '-2': 0.12, '-1': 0.44, 0: 1.7, 1: 2.14, 2: 2.96, 3: 3.53 });
export const PUSH_TILES_EFFECT = Object.freeze({ '-2': 0.085, '-1': 0.374, 0: 1.562, 1: 1.987, 2: 2.773, 3: 3.331 });
export const PUSH_EFFECT_SKILLS = Object.freeze(new Set(['skchr_forcer_1', 'skchr_forcer_2']));
export const PULL_WEAK_SHARE = 0.35;
export const PULL_CRAWL = 0.03;
export const PULL_ORIGIN = 0.5;
export const PULL_STOP_RADIUS = 0.6708;
export const PUSH_DIRECTIONAL_MIN_DIST = 0.25;

/**
 * Fallback freeze when a second 寒冷 lands and neither the remaining cold nor the incoming one has a duration
 * (Battle.applyStatus). A real duration uses max(remaining, incoming) — PRTS 术语释义 寒冷 「持续时间取双方之中最高」.
 */
export const COLD_FREEZE_DURATION = 3;
/** 浮空 (ba.levitate): the duration is halved on units heavier than this weight (massLevel). */
export const LEVITATE_HALF_WEIGHT = 3;
/** 抵抗 (ba.buffres): default share of a resisted status's duration that is removed (0.5 = 减半). */
export const RESIST_DEFAULT = 0.5;
/** 抵抗: a resisting unit loses one 麻痹 stack every RESIST_PALSY_DECAY seconds ("麻痹等状态每5秒流失1层"). */
export const RESIST_PALSY_DECAY = 5;
export const COLD_ASPD = -30;
export const FREEZE_RES_DOWN = 15;

/** Default DP rules (DESIGN §5.5), overridable by Battle opts.flags. */
export const DP_DEFAULTS = Object.freeze({ dpInit: 10, dpPerSec: 1, dpMax: 99 });
/**
 * Cooldown of the automatic skill operations (PRTS 卫戍协议/帮助 §作战阶段 技能操作: "自动操作具有3s冷却，在完成一次操作或作战
 * 开始时部署的单位将进入冷却"), in battle seconds [ASSUMED: the game clock, like every skill timer]: the engine auto-casts
 * a MANUAL skill no sooner than this after its previous cast and after the unit's battle-start deployment
 * (skills.js; Battle._deploy `initial` sets `opReadyAt` from `battle.flags.startOpCooldown`, default this value). Kits
 * with an automatic cast of their own check `skill.opCooling`. AUTO skills fire by their own rule and are not
 * operations.
 */
export const AUTO_OP_COOLDOWN = 3;
/**
 * State of a knocked-out operator waiting to redeploy on the tile it lies on (b.snap `down` entries, Battle.snapshot):
 * its respawn timer runs (COUNTING), then it waits for the player's DP to reach its cost (WAIT_DP) or for its tile to be
 * free (WAIT_TILE — a safeguard: no ally deploys on a body's tile, Battle.downOn). render/units.js mirrors these codes.
 */
export const DOWN_STATE = Object.freeze({ COUNTING: 0, WAIT_DP: 1, WAIT_TILE: 2 });
/**
 * Removal reason of an operator that enters a battle already knocked out: a 联防 helper's operator down at the end of
 * its own combat (PlayerBattleInput `carryState.down`; PRTS 卫戍协议/帮助 §联防阶段 "上一阶段为退场状态的干员强制退场").
 * Battle.start deploys it with everyone, then withdraws it at once with HP 0 — down on its own tile like a knocked-out
 * operator (Battle.isDown, b.snap `down`), its redeploy timer running from then — without the knock-out hooks (`kill`,
 * `death` with reason 'killed'), which fired in its own combat. render/app.js mirrors the string (no fall, no death
 * burst).
 */
export const FORCED_EXIT = 'forcedExit';

/** Safety cap for battles with an infinite time limit (boss rounds are force-ended by the match). */
export const MAX_BATTLE_TIME = 3600;
/** A battle that raised this many internal errors is force-ended as a timeout. */
export const MAX_INTERNAL_ERRORS = 200;

/** Time (s) a dead unit stays in snapshots with the DIE animation. */
export const DIE_ANIM_TIME = 0.8;
/** Time (s) the ATTACK / DEPLOY animation code is reported after the action. */
export const ATTACK_ANIM_TIME = 0.35;
export const DEPLOY_ANIM_TIME = 0.5;

/** Stage devices that act as ground obstacles for pathing (阻隔工事). */
export const OBSTACLE_DEVICES = Object.freeze({ trap_1105_accrate: { hp: 100, name: '阻隔工事' } });

/**
 * ASPD (攻击速度) clamps for every unit. The attribute's floor is 20 (PRTS 数值范围: ATTACK_SPEED 默认下限 20; 游戏数据基础
 * "攻击速度属性实际被限制了下限为20" — so two −50 slows on base 100 leave ASPD 20, interval = 5 × BAT, not 10 × BAT; user
 * playtest #6 item 17). The interval formula's own 10–600 clamp ("参与攻击间隔计算时会被限定在10~600以内") then only binds
 * at the top.
 */
export const ASPD_MIN = 20;
export const ASPD_MAX = 600;

/** Client event buffer cap (events are dropped oldest-first beyond this when nobody drains). */
export const EVENT_BUFFER_CAP = 50000;

/** Nested hook emits deeper than this are skipped (content recursion, e.g. a `damaged` handler dealing damage). */
export const MAX_HOOK_DEPTH = 32;
/** spawnEnemy refuses to exceed this many living enemies on one field (runaway content spawn loops). */
export const MAX_ALIVE_ENEMIES = 600;

/** Heal-over-time / regen events are aggregated and only emitted when they reach this amount. */
export const REGEN_EVENT_MIN = 1;

/** Row offset mapping board rows (9..12) onto boss-field rows (2..5). */
export const BOSS_ROW_OFFSET = -7;

/**
 * Shared boss pool (Final Assault / Hidden Core): a pool holding less than this many HP is empty — the hit that would
 * leave less takes the rest (server SharedBossPool, browser LocalBossPool) and a browser pool reading below it is 0.
 * Pool HP is a float: the server subtracts each field's reported damage per player, the browser shows `server hp −
 * unacknowledged local damage`, and their rounding could leave dust (3.6e-12) that no hit could remove — the local
 * cumulative counter absorbed it — so the leader stood at "0 HP" until the overtime drain ended the run (user playtest
 * #6 item 5). With the rule a pool always reads 0 or at least 1 HP: 0 on the HUD = the leader is down.
 */
export const BOSS_POOL_MIN_HP = 1;

/**
 * How the percentage attribute bonuses (ATK / DEF / max HP "+X%") of the 卫戍 systems combine: 盟约, 策略, 装备, the
 * 机变 cards and the per-layer 特质 (garrisons' 每叠加N层 …+X%). Official: PRTS 卫戍协议：盟约 下半/PRTS盟约记录 "盟约效果，
 * 策略效果，装备效果提供的属性加成均为直接乘算"; 直接乘算 is the modifier class whose values are SUMMED with every other
 * 直接乘算 — a skill's "攻击力+X%" included — before multiplying (PRTS 游戏数据基础 属性基本公式 "直接乘算结果 D_t = t₁ + t₂ +
 * … + tₙ", A = (A₀ + D_p)(1 + D_t); PRTS 作战机制 X₂ = X₁(1 + b₁% + b₂%)). 'add' = that rule: the engine's additive
 * atkPct / defPct / hpPct (content/support directMods). 'multiply' = the v2.5 reading (each source its own ×(1 + x)
 * atkMul / defMul / hpMul), which compounded: at 600 精准 layers a ranged operator with four more such bonuses dealt
 * ×74 instead of ×12 and Final Assault leaders fell in seconds (user report after playtest #6). "提升至X%/X倍" effects
 * (炎佑 ×1.5, 攻击海怪敌人时攻击力提升至150%) and the char_attribute_mul 特质 (+20 % / +25 % on the chess itself, a rune on
 * the base attributes) stay multipliers.
 */
export const DIRECT_BONUS_STACKING = 'add';

/** 链术师 jump radius (PRTS 溅射半径一览, 特性: "链术师 … 1.7"; 1.8 until 0.1.1). */
export const CHAIN_RADIUS = 1.7;
