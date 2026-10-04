// server/sim/content/bosses.js — scripted leaders (boss_1…boss_10) and their parts (DESIGN §7, research 05 §5, 06 §10.1).
//
// install(battle) ensures the enemy dispatch hooks (enemies.js) and attaches a boss kit to every spawned leader / part
// listed in BOSS_KITS. Damage dealt TO a leader routes to the shared boss pool through the engine (tag 'boss' +
// sharedBoss); parts that "传递伤害" push the damage they take into the pool with a 无来源 battle.loseHp(leader, …)
// credited to the attacker (PART_TRANSFER = 1, "等量"). Numbers come from the (template-overridden) talent / skill blackboards; the rest are named
// constants ([ASSUMED] or PRTS-sourced). Boss HP rules ("<20 %", "≤50 %") read the leader's HP ratio, which the engine
// syncs from the shared pool, so both mirrored copies switch phase together.
//
// Wave template: branches / extraRoutes / devices / patrol steps are read from the template the battle was built
// from — `opts.waveTemplate|template|templateId|waveId` when the match passes it, else inferred from data/waves.json
// (the template whose leader spawn matches and whose route list equals battle.routes). Without a template the
// fallbacks spawn summons at the leader and route them to the nearest goal. Branch spawns keep their literal key
// unless the match passes the round's placeholder replacements as `opts.slotKeys` ({ NF: key, N: key, … }).
//   · patrol: a leader / part walking `patrol` steps loops them (never reaches the goal: 卢西恩 lpr 30, 铳, 碎铳之簧).
//   · 'boss_battle_multi_player' (铳, 卢西恩): with ≥2 players on the field the mirrored copy is spawned from the branch
//     (skipped if the match already spawned a second copy, or opts.bossMirror === false).
//
// Leaders (see each kit for details):
//   boss_1/8 假想敌：胄      random arts beam (range 8); 灭顶之灾 one 刺胄之弹 at the highest-ATK operator in range (8-hit
//                            flying shell, 3×3 stun + phys DoT on arrival); <20 %: damage ×0.5 (no extra shell: PRTS
//                            能力修正); 死亡集群 drones — a drone that dies costs the leader 2 % of its max HP = the shared
//                            pool's (DRONE_LINK_BASE, [ASSUMED] reading). boss_8 adds 斩胄之剑 / 破胄之锤.
//   斩胄之剑 / 破胄之锤      初始模式: hover invulnerable next to 胄, AoE attacks (锤 150 % ATK). 出击模式: blink to the
//                            level's blink route, fly at the lowest-ATK operator (3×3 stun + DoT); 15 hits shoot it
//                            down (瘫痪: stun 10 s, ground unit, damage ×1.3). Either way a new 初始模式 copy with its HP
//                            replaces it at home. Every damage it takes costs 胄 as much (PART_TRANSFER, 无来源, 等量) —
//                            grounded per both texts, during the dive per the PRTS talent [ASSUMED]. The shell, 剑 and
//                            锤 are 失衡免疫 + 静态刚体 (PRTS 天赋): no push or pull moves them.
//   boss_2/9 假想敌：铳      unblockable; highest-DEF target in range; erosion; ASPD ramp (+80 × 5) on the same target
//                            (floor 20); 最终之罚 charge at the highest-DEF ground unit (disabled by the h07_02 override).
//                            boss_9: damage ×0.2 while springs live, 盲信之誓 links (100 phys/s on the lines), 末日布道 dash.
//   碎铳之簧 a/b/c           arts barrier (absorbs arts after RES; phys ×0.1, counter phys + erosion) / element shield
//                            (phys+arts ×0.1, broken by its own element burst; every (spCost+1)-th attack a bouncing erosion
//                            shot) / 5-hit shield (every (spCost+1)-th attack a ten-hit combo); unblockable while shielded;
//                            shield back 25 s after breaking; every damage taken costs 铳 as much (PART_TRANSFER, 无来源)
//                            and, split, the other springs.
//   boss_3/10 假想敌：管     summons 余音 (dark) every 40 s (20 s < 50 %); normal attacks strike dark 余音 (their pulse hurts
//                            operators); 裂管之奏 3 strikes on every dark 余音 (AoE arts + apoptosis). boss_10 + 假想敌：弦
//                            (invulnerable, gold 余音, 断弦之奏 AoE + flips them dark; leaves with 管).
//   余音                     10-hit unit, block ≥ 2 only; gold (ASPD +50) / dark (ATK +50 %, slower) forms that swap after
//                            10 strikes; pulses on every hit taken; 合奏 every 5 s.
//   boss_4 盐风主教昆图斯     2 highest-DEF targets (+ neural); 3 growth stages (33 % HP lost or 75 s / 200 s): 大潮 global
//                            arts + neural, 崩坍 delayed strikes on 2/4/8 highest-DEF units, 断裂生殖 tentacles (stun),
//                            物种爆发 LP loss (stage 3).
//   boss_5 卢西恩            evade 40 % while unblocked, DEF pen 40 %, neural on hit; AoE skill (radius 2); blinks past its
//                            blocker leaving a 不祥幻影 (same kit minus blink). Template overrides (0.2 / 0.12) apply.
//   boss_6 阿利斯泰尔        王权号令 (SP 1/s, plus-shaped 200 % strike + random equipment drop); 莫非王土 animates the
//                            latest equipment on the field (2 s after it appears, then once per 王权号令 cycle) (sword strike / directional vest + barrier / wand disarm); ≤50 %: DEF +100 %,
//                            RES +45, animates 2; 斥退 at 999 s.
//   boss_7 “萨米的意志”      冰凌 (its normal attack) hits a whole column; 自然涌动 stun + arts DoT; <50 %: damage taken
//                            ×(1−0.6), 2 targets; Doom at 600 s (LP −30). Targets via fairOrder (two players alternate).
// The huge leaders (SELF_BOUND: 胄 ×2, 管 ×2, 昆图斯, 阿利斯泰尔, 萨米的意志 — the 巨型单位 with a data `hitArea`) are
// 自缚 + 无法被阻挡 (PRTS 天赋): a persistent noMove + unblockable buff from spawn, so they never walk their route.
// Every leader (tag boss) ignores 侵蚀 gauge damage ("最终攻势中，敌方领袖不会受到侵蚀损伤").
// An airborne (起飞) operator is no selection of a ground leader or part (对地规避: canTargetAlly, the damage pipeline,
// the area selectors); still reach it (`ignoreSelect`): the 刺胄之弹 / 剑 / 锤 blasts (flying units, 无来源 DoT; 掷剑 /
// 掷锤 pick their operator "（无视无法选择）"), the 盲信之誓 chains ("无视无法选择"), the 法术护盾 counter on its attacker
// (a direct pick) and the ticks of a debuff already on it (【自然涌动】: a tick selects nobody).
// Every area effect of a leader or part — pulses, strikes around an echo, blasts, charges and tramples, crosses, columns,
// whole-field skills — selects with enemies.js areaAllies / areaAlliesInTiles / fieldAllies (targeting.js
// areaSelectable): no 隐匿 operator, the one blocking the unit included (GitHub #97), no untargetable or sleeping one, no 起飞 one for a
// ground unit; 迷彩 is not checked (splash-type, 中点判定 / 格子判定 or "无视迷彩" on PRTS; the rest [ASSUMED], DESIGN
// §22.12). Only 【盲信之誓】 ("无视无法选择、迷彩") takes everyone on its lines.
// LP effects ('lpLoss' hook + result.lpLoss) must be applied by the match (see the report of this module's owner).
// fx kinds: 'beam' 'shell' 'explode' 'telegraph' 'charge' 'link' 'dash' 'column' 'tide' 'rockfall' 'tentacle' 'equip'
//   'sword' 'vest' 'blink' 'summon' 'grow' 'phase' 'lpLoss' (x, y + extra {id, r, tiles, kind, tx, ty …}).

import { MOVE_SCALE } from '../constants.js';
import { aggroCmp, areaSelectable } from '../targeting.js';
import { compileRoute } from '../ai.js';
import { normalizeRoute } from '../simdata.js';
import {
  ensureInstalled, abOf, attach, T, elem, hurt, targetsNear, allTargets, byPriority, areaAllies, areaAlliesInTiles, fieldAllies,
  remainingRoute, stayRoute, stepToward, setHits, hitCount, lpLoss, blinkForward, canCast, absorbArts, nthOf,
} from './enemies.js';

// ---------------------------------------------------------------------------------------------------------------
// constants

/**
 * Share of the damage a 剑/锤 or a 碎铳之簧 takes that its leader loses: 1, 等量 — PRTS talents (“斩胄之剑” / “破胄之锤”
 * "受到伤害时令假想敌：胄受到等量的无来源生命流失"; 碎铳之簧 (all three) "…令全场范围内仇恨值最高的1名假想敌：铳受到等量的无来源
 * 生命流失"); the enemy data carries no ratio blackboard (the handbook's "以一定比例" is that 1). The loss is 无来源 (hooks see
 * no source; the attacker keeps the credit — stats, the per-player pool tally) and follows EVERY damage taken: a
 * 剑/锤 only takes damage outside its invulnerable 初始模式 (its 出击模式 dive and 【瘫痪】). The two official texts
 * disagree on the dive: the PRTS talent says "受到伤害时" (any damage), the in-game handbook (data/enemies.json abilities,
 * PRTS 能力) "被击落时受到伤害以一定比例传递" (only once shot down) — the dive hits passing on is [ASSUMED] (the talent
 * text; ≤ 15 hits per dive). A loss passed on to a leader is one hit for 限伤 (sim/damage.js leaderHitCancelled, via
 * Battle.loseHp). v2.5: 0.5 [ASSUMED], and a 剑/锤 passed damage on only while grounded (DESIGN §20.10, §20.13).
 */
export const PART_TRANSFER = 1;
/** The 斩胄之剑 / 破胄之锤 share — the same PRTS 等量 as PART_TRANSFER (kept as a name for the blade kit and its tests). */
export const BLADE_TRANSFER = PART_TRANSFER;
/** 破胄之锤 normal attack: 150 % ATK (PRTS 天赋 "普通攻击对攻击范围内的所有我方单位造成攻击力150%的物理普通伤害"; 斩胄之剑 100 %). */
const BLADE_ATK_SCALE = Object.freeze({ enemy_9015_acstmb: 1.5 });
/**
 * Level branches of each part (act1autochess_h08_01 / _s): 斩胄之剑 spawns on the start of `left_hand_origin` (3,12),
 * 破胄之锤 on `right_hand_origin` (3,8). `<hand>_blink` = the preset route 掷剑 blinks to (its start; PRTS "将自身路径改为
 * 关卡预设路径并闪现至路径起点"), `<hand>_origin` = the route the new 初始模式 copy is summoned on ("以关卡预设路径召唤").
 */
const BLADE_HAND = Object.freeze({ enemy_9014_acstma: 'left_hand', enemy_9015_acstmb: 'right_hand' });
/**
 * 死亡集群: a drone that dies (PRTS 能力修正 "该无人机单位死亡时", whoever kills it) costs 胄 `hp_ratio` (2 %) of "最大生命值"
 * (PRTS 假想敌：胄 "该妖怪死亡时令假想敌：胄受到最大生命值2%的真实伤害"). WHICH max HP is not documented [ASSUMED reading]:
 *   'pool' (default, = v2.5): the leader's max HP as the battle shows it — the shared pool (the engine syncs the unit's
 *          HP to it). It is the same HP the "自身生命值低于20%" talent reads, and that one must read the pool (the
 *          unit's data 600 000 is above the co-op 标准 pool 247 500 and above every solo pool, where a fixed 600 000
 *          would never drop below 20 %). A drone = 2 % of the leader bar in every mode and difficulty (终极 72 000).
 *   'unit': the in-battle unit's data max HP (600 000 / hidden 1 200 000, 不死) — 12 000 / 24 000 per drone at every
 *          difficulty: 0.33 % of the 终极 bar but 19 % of the solo 标准 bar (61 875), so drones decide solo fights.
 * Round 2 of the boss-HP review tried 'unit'; the review measured the solo regression, so the default is back to 'pool'.
 * 限伤 (shared/constants.js BOSS_HIT_LIMIT): the loss is one hit through Battle.loseHp — it lands up to the largest pool
 * today (boss_8 终极 7 200 000 → 144 000) and would be cancelled above a 14 999 950 pool (ceil(0.02 × pool) ≥ 300000).
 */
export const DRONE_LINK_BASE = 'pool';
/** 卢西恩 / 不祥幻影 AoE radius (PRTS "半径2"). */
const LUCIEN_AOE_RADIUS = 2;
/** 余音 on-hit pulse radius (PRTS 1.6) and 合奏 radii per form (PRTS gold 0.8 / dark 1.6). */
const ECHO_PULSE_RADIUS = 1.6;
const ECHO_ENSEMBLE_RADIUS = Object.freeze({ gold: 0.8, dark: 1.6 });
/** "只能被阻挡数大于等于2的单位阻挡". */
const ECHO_BLOCK_WEIGHT = 2;
/** 裂管之奏 strike spacing (s). */
const PIPE_STRIKE_GAP = 0.4;
/** 断裂生殖 tentacle: stun duration and reach around its device tile [ASSUMED]. */
const TENTACLE_STUN = 5, TENTACLE_RADIUS = 1;
/** 崩坍 delay (PRTS 1 s), targets per growth stage (PRTS 2/4/8) and 物种爆发 delay (PRTS 4 s). */
const ROCKFALL_DELAY = 1, ROCKFALL_TARGETS = [2, 4, 8], DOOM_DELAY = 4;
/** 铳: minimum attack speed (PRTS "最低20") and charge hit radius (PRTS 0.35 — also “碎铳之簧”'s 追逐模式 trample). */
const ASPD_FLOOR = 20, CHARGE_RADIUS = 0.35;
/** 盲信之誓 link half-width (PRTS 0.5). */
const LINK_WIDTH = 0.5;
/** 碎铳之簧 bullet bounce falloff / reach [ASSUMED], combo = 十连击; tag of the damage share passed between springs. */
const SPRING_BOUNCE_FALLOFF = 0.85, SPRING_BOUNCE_RANGE = 2, SPRING_COMBO_HITS = 10, SPRING_SHARE_TAG = 'springShare';
/**
 * Leaders that are 自缚 and cannot be blocked — the 天赋 line of every 巨型单位 page (PRTS 假想敌：胄 (both copies) "自缚、
 * 不可阻挡", 假想敌：管 (+ 隐秘核心) / 盐风主教昆图斯 / 阿利斯泰尔，帝国余晖 / “萨米的意志” "自缚 … 无法被阻挡"). 自缚 (PRTS
 * 异常效果 UNMOVABLE_PRIVATE) = 无法移动, like 束缚 but never recognised as 束缚: flag noMove, not bind. They stand where
 * they spawn whatever their route says (the official routes walk to a goal; only the talent holds them), so their
 * hit area (body.js) stays on the pipe block. These are exactly the enemies with a data `hitArea`.
 */
export const SELF_BOUND = Object.freeze([
  'enemy_9013_acstmk', 'enemy_9013_acstmk_2', 'enemy_9021_acduml', 'enemy_9021_acduml_2', 'enemy_1521_dslily',
  'enemy_9032_aclionk', 'enemy_9033_acdeer',
]);
/** 阿利斯泰尔: enemy SP per second [ASSUMED] and 莫非王土 delay after each 王权号令 [ASSUMED]. */
const ENEMY_SP_PER_SEC = 1, ANIMATE_DELAY = 2;
const EQUIP_KEYS = Object.freeze(['enemy_10028_vtswd', 'enemy_10029_vtshld', 'enemy_10030_vtwand']);
const SHELL_KEY = 'enemy_9016_acstmr', ECHO_KEY = 'enemy_9023_acdums', PHANTOM_KEY = 'enemy_2017_csphts';

// ---------------------------------------------------------------------------------------------------------------
// per-battle state, template resolution

const STATE = new WeakMap();
function stOf(b) {
  let st = STATE.get(b);
  if (!st) { st = { tpl: undefined, mirrored: new Set() }; STATE.set(b, st); }
  return st;
}

const pairEq = (a, b) => Array.isArray(a) && Array.isArray(b) && Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6;

/** The wave template this battle was built from (or null). */
export function templateOf(b) {
  const st = stOf(b);
  if (st.tpl !== undefined) return st.tpl;
  const o = b.opts || {};
  for (const cand of [o.waveTemplate, o.template, o.templateId, o.waveId]) {
    if (!cand) continue;
    const t = typeof cand === 'string' ? b.data.getWave(cand) : cand;
    if (t && typeof t === 'object') { st.tpl = t; return t; }
  }
  let best = null, bestScore = 0;
  const ids = typeof b.data.waveIds === 'function' ? b.data.waveIds() : [];
  for (const id of ids) {
    const w = b.data.getWave(id);
    if (!w || !Array.isArray(w.spawns) || !Array.isArray(w.routes)) continue;
    if (!w.spawns.some((s) => s && s.tag === 'boss' && BOSS_KITS[s.key ?? s.enemyKey])) continue;
    if (w.routes.length !== b.routes.length) continue;
    let score = 1;
    if (w.routes.every((r, i) => { const n = normalizeRoute(r); const m = b.routes[i]; return m && pairEq(n.start, m.start) && pairEq(n.end, m.end); })) score += 8;
    if (/_s$/.test(id) === (b.players.length <= 1)) score += 1;
    if (score > bestScore) { best = w; bestScore = score; }
  }
  st.tpl = bestScore >= 9 ? best : null;
  return st.tpl;
}

const legSig = (legs) => legs.map((l) => `${l.t}:${l.r ?? ''},${l.c ?? ''},${l.time ?? ''}`).join('|');

/** Raw template route an enemy is walking (matched on compiled legs). */
function rawRouteOf(b, e, tpl) {
  if (!tpl || !e.route || !Array.isArray(e.route.legs)) return null;
  const sig = legSig(e.route.legs);
  for (const r of [...(tpl.routes || []), ...(tpl.extraRoutes || [])]) {
    if (!r) continue;
    try { if (legSig(compileRoute(normalizeRoute(r), b.rect)) === sig) return r; } catch { /* skip */ }
  }
  return null;
}

/** Fallback route from a position to the nearest goal. */
function toGoal(b, x, y, motion = 'WALK') {
  const ends = b.grid.specialTiles('end');
  let best = ends[0] ?? [Math.round(y), Math.round(x)], bd = Infinity;
  for (const p of ends) { const d = Math.hypot(p[0] - y, p[1] - x); if (d < bd) { bd = d; best = p; } }
  return { motion, start: [y, x], end: best, checkpoints: [] };
}

/** The extra route of a template branch's first spawn (or null). */
function branchRoute(tpl, name) {
  const br = tpl && tpl.branches && tpl.branches[name];
  const s = Array.isArray(br) && Array.isArray(br[0]) ? br[0][0] : null;
  return (s && tpl.extraRoutes && tpl.extraRoutes[s.routeIndex]) || null;
}

/** Spawn one phase of a template branch. Returns the spawned enemies. */
function branchSpawn(b, tpl, name, phaseIdx, { fallback = null, mods = null, at = null } = {}) {
  const br = tpl && tpl.branches && tpl.branches[name];
  if (!Array.isArray(br) || !br.length) return fallback ? fallback() : [];
  const phase = br[Math.max(0, Math.min(phaseIdx, br.length - 1))] || [];
  const out = [];
  for (const s of phase) {
    if (!s || (s.action && String(s.action).toUpperCase() !== 'SPAWN')) continue;
    // placeholder slots (NF/N…) of branch spawns: the match may pass the round's replacements as opts.slotKeys
    const key = (s.slot && b.opts && b.opts.slotKeys && b.opts.slotKeys[s.slot]) || s.key || s.enemyKey;
    if (!key || !String(key).startsWith('enemy_')) continue;
    const route = tpl.extraRoutes && tpl.extraRoutes[s.routeIndex];
    for (let i = 0; i < Math.max(1, s.count ?? 1); i++) {
      const u = b.spawnEnemy(key, { route: route || (at ? toGoal(b, at.x, at.y) : undefined), pos: route ? undefined : at ? [at.y, at.x] : undefined, tag: s.tag ?? null, countInTotal: s.unharmful ? false : undefined, mods });
      if (u) out.push(u);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// install

export function install(battle) {
  ensureInstalled(battle);
  battle.on('enemySpawn', ({ enemy }) => onSpawn(battle, enemy), { priority: 90 });
  // "最终攻势中，敌方领袖不会受到侵蚀损伤" (PRTS 卫戍协议：盟约/PRTS盟约记录 规则; research 06 §10.1): leaders ignore erosion gauge damage
  battle.on('elementHit', (c) => { if (c.target && c.target.isBoss && c.dmg.element === 'erosion') c.dmg.cancel = true; }, { priority: 100 });
}
export function registerMeta() {}

function onSpawn(b, e) {
  const kit = BOSS_KITS[e.defId];
  if (typeof kit !== 'function') return;
  if (SELF_BOUND.includes(e.defId)) b.addBuff(e, { key: 'boss:selfBound', persist: true, flags: { noMove: true, selfBound: true, unblockable: true } });
  const tpl = templateOf(b);
  const ab = abOf(b, e);
  let list = [];
  try { list = kit(ab, e, b, tpl) || []; } catch (err) { b._handlerError('content:bosses', e, err); }
  attach(b, e, list);
  // patrol loop for leaders / parts
  const raw = rawRouteOf(b, e, tpl);
  if (raw && Array.isArray(raw.steps) && raw.steps.some((s) => s && s.t === 'patrol')) attach(b, e, [patrolLoop()]);
  // mirrored leader for 2 players (boss_battle_multi_player)
  if (e.isBoss || e.tag === 'boss') mirror(b, e, tpl);
}

function patrolLoop() {
  return {
    tick(b, e) {
      const R = e.route;
      if (!R || !Array.isArray(R.legs) || R.legs.length < 2) return;
      if (R.legIdx >= R.legs.length - 1) { R.legIdx = 0; R.pts = null; R.waitLeft = null; }
    },
  };
}

function mirror(b, e, tpl) {
  const st = stOf(b);
  const br = tpl && tpl.branches && tpl.branches.boss_battle_multi_player;
  if (!Array.isArray(br) || !br.length || st.mirrored.has(e.defId) || (b.opts && b.opts.bossMirror === false)) return;
  if (b.players.length < 2 || e.mem.mirror) return;
  st.mirrored.add(e.defId);
  for (const s of br[0] || []) {
    const key = s.key ?? s.enemyKey;
    if (key !== e.defId) continue;
    b.after(Math.max(0, (s.time ?? 0) - b.time), () => {
      if (b.aliveEnemies().filter((o) => o.defId === key && o.isBoss).length >= 2) return; // the match already did it
      const route = tpl.extraRoutes && tpl.extraRoutes[s.routeIndex];
      const u = b.spawnEnemy(key, { route: route || undefined, tag: 'boss', mods: e.mods });
      if (u) u.mem.mirror = true;
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// shared bits

const opsOnly = (list) => list.filter((u) => u.kind === 'op');
const nearestOf = (b, e, pred) => {
  let best = null, bd = Infinity;
  for (const o of b.enemies) { if (!o.alive || o === e || !pred(o)) continue; const d = Math.hypot(o.x - e.x, o.y - e.y); if (d < bd) { bd = d; best = o; } }
  return best;
};
/** Apply a floor to an enemy whose data attack speed is 0 (skill-driven leaders: 铳/管/弦). */
function aspdFloor(b, e, extra = 0) {
  const rawAspd = e.def.raw && e.def.raw.stats ? Number(e.def.raw.stats.aspd) : NaN;
  if (!(rawAspd === 0)) return;
  b.addBuff(e, { key: 'boss:aspd', persist: true, mods: { aspd: Math.max(ASPD_FLOOR, rawAspd + extra) - e.base.aspd } });
}
/**
 * Engine target priority (blocker → taunt → latest deployed), made fair for two players on one boss field: within the top
 * priority tier the picks alternate between the players' units, starting with the other player each call. Both
 * players deploy at t = 0, so "latest deployed" alone would always single out the second player [ASSUMED fairness
 * rule]. `P.turn` keeps the rotation.
 */
export function fairOrder(b, e, list, P) {
  const l = byPriority(e, list);
  if (b.players.length < 2 || l.length < 2) return l;
  const key = (u) => `${e.blockedBy === u ? 0 : 1}|${u.s.taunt || 0}`;
  const top = key(l[0]);
  const tier = l.filter((u) => key(u) === top), rest = l.filter((u) => key(u) !== top);
  const ids = b.players.map((p) => p.playerId);
  P.turn = ((P.turn ?? -1) + 1) % ids.length;
  const queues = ids.map((pid) => tier.filter((u) => u.ownerId === pid));
  const out = [];
  for (let k = 0; out.length < tier.length && k < tier.length * ids.length + ids.length; k++) {
    const q = queues[(P.turn + k) % ids.length];
    if (q.length) out.push(q.shift());
  }
  for (const u of tier) if (!out.includes(u)) out.push(u);
  return out.concat(rest);
}

/**
 * Stun + phys DoT on the 3×3 around (r, c), credited to `src` (胄). The blast is a flying unit's — `by`: 刺胄之弹 /
 * 斩胄之剑 / 破胄之锤 (PRTS 行动方式 飞行) — and its damage 无来源, so 对地规避 does not stop it: `ignoreSelect` (an airborne
 * 起飞 ally in the 3×3 is stunned and hurt like the others, although the credited 胄 walks). It is still that unit's area
 * selection (PRTS: "令自身周围8格内的所有我方单位…" / "…无视迷彩，可对空", no 无视无法选择): areaAlliesInTiles of `by` — no
 * 隐匿 ally, the one blocking it included (GitHub #97; 掷剑 / 掷锤's "无视无法选择" is their pick of the operator they fly at, not the blast).
 */
function stunBlast(b, src, by, r, c, stun, dot, dur, kind) {
  b.fx('explode', { x: c, y: r, r: 1.5, kind, tiles: 'box' });
  for (const u of areaAlliesInTiles(b, by, r, c, 'box', 1)) {
    if (stun > 0) b.applyStatus(u, 'stun', { duration: stun, source: src, ignoreSelect: true });
    if (dot > 0 && dur > 0) b.addBuff(u, { key: `boss:${kind}Dot`, duration: dur, refresh: 'replace', interval: 1, visible: true,
      onTick: ({ battle, unit }) => battle.dealDamage(src, unit, { amount: dot, type: 'phys', canDodge: false, ignoreSelect: true, tags: ['enemyAbility', kind] }) });
  }
}
/** Distance from point p to segment a–b. */
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

// ---------------------------------------------------------------------------------------------------------------
// 假想敌：胄 (boss_1 / boss_8) + 刺胄之弹 + 斩胄之剑 / 破胄之锤

function kitHelm(ab, e, b, tpl) {
  const s1 = ab.sk['1'], s2 = ab.sk['2'];
  const lowRatio = T(ab, '1.hp_ratio') ?? 0, lowScale = T(ab, '1.damage_scale') ?? 1;
  const P = { low: false };
  const range = () => e.base.rangeRadius || 8;
  // 灭顶之灾 "触发索敌和普通攻击相同：选择攻击范围内攻击力最高的1名我方干员" (PRTS 技能, both copies)
  const shellTargets = (b2) => opsOnly(targetsNear(b2, e, range()));
  return [
    {
      spawn(b2, e2, a, ab2) { ab2.atkType = 'arts'; },
      before(c, b2, e2) { const l = targetsNear(b2, e2, range()); if (l.length) c.targets = [b2.rng.pick(l)]; }, // 随机选择目标
      attack(c, b2, e2) { const t = c.targets[0]; if (t) b2.fx('beam', { x: e2.x, y: e2.y, from: e2.id, to: t.id, kind: 'helmRay' }); },
      iv: 0.25,
      tick(b2, e2) {
        if (P.low || !(e2.hpRatio < lowRatio)) return;
        P.low = true;                                     // <20 %: damage taken ×0.5 (no extra shell: see 灭顶之灾)
        b2.addBuff(e2, { key: 'boss:helmGuard', persist: true, visible: true, mods: { physTakenMul: lowScale, artsTakenMul: lowScale } }); // 物理与法术伤害降低
        b2.fx('phase', { x: e2.x, y: e2.y, id: e2.id, kind: 'helmLow' });
      },
    },
    s1 && {
      cd: s1.cd, icd: s1.icd, cond: (b2) => shellTargets(b2).length > 0,
      // 【灭顶之灾】 one shell, also below 20 %: the handbook's "额外发射<刺胄之弹>" is wrong in game (PRTS 能力修正 原因 6
      // "描述与游戏实际表现不符合": "【灭顶之灾】不会额外发射") and no blackboard holds a second shell (skill 1 has none)
      fire(b2, e2) {
        const t = shellTargets(b2).sort((p, q) => q.s.atk - p.s.atk || aggroCmp(p, q))[0];
        if (t) fireShell(b2, e2, t);
      },
    },
    s2 && {
      cd: s2.cd, icd: s2.icd,
      // 【死亡集群】: a drone on the branch route; when it dies (PRTS 能力修正 "该无人机单位死亡时", whoever kills it) the leader
      // loses hp_ratio × max HP. Drone HP: `summon.hp_ratio` (隐秘核心 only) scales it [ASSUMED: the summon's max HP]; the
      // `max_hp` 0.5 both copies carry is not read [ASSUMED] — no source says what it does (PRTS 技能 lists the 2 % only,
      // the 妖怪 page has no summon rule, the level gives the 妖怪 no override; as an attribute key it would be +50 %).
      fire(b2, e2) {
        const hpMul = s2.bb['summon.hp_ratio'] > 0 ? s2.bb['summon.hp_ratio'] : null;
        const key = s2.bs.enemy_key ?? 'enemy_1005_yokai';
        const drones = branchSpawn(b2, tpl, s2.bs.branch_id ?? 'boss_summon_enemy', 0, {
          mods: hpMul ? { hpMul } : null, at: { x: e2.x, y: e2.y },
          fallback: () => [b2.spawnEnemy(key, { pos: [e2.y, e2.x], route: toGoal(b2, e2.x, e2.y, 'FLY'), mods: hpMul ? { hpMul } : null })].filter(Boolean),
        });
        b2.fx('summon', { x: e2.x, y: e2.y, id: e2.id, key, n: drones.length });
        const ratio = s2.bb.hp_ratio ?? 0;
        for (const d of drones) attach(b2, d, [{
          death(c, b3) {
            if (c.reason !== 'killed' || !(ratio > 0)) return;                 // a leak is no death
            const boss = e2.alive ? e2 : b3.aliveEnemies().find((o) => o.isBoss && o.defId === e2.defId);
            const by = c.killer && c.killer.side === 'ally' ? c.killer : null;  // credited to the killing operator
            if (boss) { b3.loseHp(boss, droneLinkBase(boss) * ratio, { source: by }); b3.fx('beam', { x: d.x, y: d.y, from: d.id, to: boss.id, kind: 'droneLink' }); }
          },
        }]);
      },
    },
  ];
}

/**
 * Max HP the 死亡集群 drone link reads (DRONE_LINK_BASE): 'pool' = the leader's shown max HP (the shared pool), 'unit' =
 * the unit's data max HP (template × spawn hpMul).
 */
export function droneLinkBase(boss, base = DRONE_LINK_BASE) {
  if (base !== 'unit' || !boss.def || !(boss.def.maxHp > 0)) return boss.s.maxHp;
  const m = boss.mods && Number(boss.mods.hpMul);
  return boss.def.maxHp * (Number.isFinite(m) && m > 0 ? m : 1);
}

/** Launch a 刺胄之弹 from `boss` at `target`'s tile. */
function fireShell(b, boss, target) {
  const tr = target.tileR, tc = target.tileC;
  const sh = b.spawnEnemy(SHELL_KEY, { pos: [boss.y, boss.x], route: { motion: 'FLY', start: [boss.y, boss.x], end: [tr, tc], steps: [{ t: 'wait', s: 99999 }] }, tag: 'part', countInTotal: false, ownerPlayerId: boss.ownerId });
  if (!sh) return null;
  sh.mem.ab.shell = { tr, tc, boss };
  b.fx('shell', { x: boss.x, y: boss.y, id: sh.id, tx: tc, ty: tr, r: 1.5, kind: 'helmShell' });
  return sh;
}

function kitShell(ab, e) {
  const stun = T(ab, 'killed.duration') ?? 0, dot = T(ab, 'killed.value') ?? 0;
  return [{
    spawn(b, e2) {
      setHits(e2, e2.def.maxHp); hitCount(b, e2, true);                       // 需要数次攻击击倒
      b.addBuff(e2, { key: 'boss:shellGuard', persist: true, flags: { noDisplace: true } }); // 失衡免疫 (PRTS 天赋; also 静态刚体)
    },
    tick(b, e2, a, dt) {
      const s = e2.mem.ab.shell;
      if (!s || a.done) return;
      if (!stepToward(e2, s.tc, s.tr, e2.s.moveSpeed * MOVE_SCALE * dt)) return;
      a.done = true;                                            // arrival: 3×3 long stun + phys DoT
      stunBlast(b, s.boss && s.boss.alive ? s.boss : e2, e2, s.tr, s.tc, stun, dot, stun, 'helmShell');
      b.kill(e2, null);
    },
  }];
}

/**
 * “斩胄之剑” / “破胄之锤” (PRTS 天赋 + 技能 掷剑 / 掷锤; numbers from skill 1's blackboard).
 *   初始模式 ('hover'): 无敌 + 自缚 [ASSUMED: also untargetable, so operators spend no attacks on it]; AoE physical attack
 *     on every ally in its range (锤 150 % ATK, BLADE_ATK_SCALE).
 *   掷剑 (skill 1 cd / icd, an operator on the field) → 出击模式 ('dive'): no normal attack, vulnerable; blinks to the start
 *     of its `<hand>_blink` route and flies at the tile of the lowest-ATK operator (无视无法选择).
 *   Arriving (no 【瘫痪】): `stun` s stun + `dot_damage`/s for `dot_duration` s on the 3×3 around it, then it is replaced.
 *   Once, after `max_hit_cnt` damage instances: 【瘫痪】 ('down') — `special_stun_duration` s, but it ends with its own
 *     `stun` s stun ("该晕眩结束时也会结束【瘫痪】"): ground unit, damage taken ×`damage_scale`; when it ends, replaced.
 *   Replaced: a new 初始模式 copy with its current HP is summoned on its `<hand>_origin` route (at home without a template),
 *     then it is killed (强制击杀自身; a part: no kill count, no bounty). The copy is a new unit [ASSUMED: only its HP is
 *     inherited] — its 掷剑 starts from the initial cooldown again, so the data's cooldown (80 s) never comes into play.
 *   Every damage it takes is lost by 假想敌：胄 too (BLADE_TRANSFER = PART_TRANSFER 1, 无来源, credited to the attacker).
 */
function kitBlade(ab, e, b, tpl) {
  const s = ab.sk['1'];
  const bb = s ? s.bb : {};
  const hand = BLADE_HAND[e.defId];
  const P = { state: 'hover', home: { x: e.x, y: e.y }, hits: 0, target: null };
  const leader = (b2) => nearestOf(b2, e, (o) => o.isBoss && /enemy_9013_acstmk/.test(o.defId));
  const hover = (b2, on) => {
    if (on) b2.addBuff(e, { key: 'boss:hover', persist: true, visible: true, flags: { invulnerable: true, untargetable: true } });
    else b2.removeBuff(e, 'boss:hover');
  };
  const replace = (b2, e2) => { // 以关卡预设路径召唤一个继承自身生命值的初始模式的 copy，随后强制击杀自身
    P.state = 'gone';
    e2.motion = 'FLY';
    const origin = hand ? branchRoute(tpl, `${hand}_origin`) : null;
    const home = [P.home.y, P.home.x];
    const n = b2.spawnEnemy(e2.defId, {
      route: origin || { motion: 'FLY', start: home, end: home, steps: [{ t: 'wait', s: 99999 }] }, pos: origin ? undefined : home,
      tag: e2.tag, countInTotal: false, mods: e2.mods, ownerPlayerId: e2.ownerId,
    });
    if (n) { n.hp = Math.min(n.s.maxHp, e2.hp); b2.fx('blink', { x: n.x, y: n.y, id: n.id, fx: e2.x, fy: e2.y }); }
    b2.kill(e2, null);
  };
  const shotDown = (b2, e2) => { // 【瘫痪】
    P.state = 'down';
    e2.motion = 'WALK';                                              // 变为地面单位（不改变寻路方式）
    const stun = bb.stun ?? 0;
    b2.applyStatus(e2, 'stun', { duration: stun, source: null, force: true });
    b2.addBuff(e2, { key: 'boss:downed', duration: Math.min(bb.special_stun_duration ?? stun, stun), visible: true,
      mods: { dmgTakenMul: bb.damage_scale ?? 1 }, onExpire: () => { if (e2.alive && P.state === 'down') replace(b2, e2); } });
    b2.fx('phase', { x: e2.x, y: e2.y, id: e2.id, kind: 'shotDown' });
  };
  return [
    {
      spawn(b2, e2) {
        hover(b2, true);
        // 自缚 (moved by hand) · 不可阻挡 · 失衡免疫 (PRTS 天赋 "{{特殊机制|静态刚体}}，不可阻挡、失衡免疫…" — data `staticBody` too)
        b2.addBuff(e2, { key: 'boss:anchor', persist: true, flags: { noMove: true, selfBound: true, unblockable: true, noDisplace: true } });
        if (BLADE_ATK_SCALE[e2.defId]) e2.profile.atkScale = BLADE_ATK_SCALE[e2.defId];
      },
      // 范围物理伤害 — "普通攻击对攻击范围内的所有我方单位造成…物理普通伤害": a normal attack on every operator it can target
      // (canTargetAlly: no 隐匿 or 迷彩 one — it is never blocked —, PRTS 选择器: a normal attack does not ignore 迷彩; until
      // 0.1.2 it took them all, `ranged: false`)
      before(c, b2, e2) { const l = targetsNear(b2, e2, e2.base.rangeRadius || 1.6); if (l.length) c.targets = l; },
      taken(c, b2, e2) {
        if (c.amount > 0) { // 受到伤害时令假想敌：胄受到等量的无来源生命流失 (【瘫痪】; 出击模式 [ASSUMED], see PART_TRANSFER)
          const L = leader(b2);
          const src = c.source || c.credit;                                    // a 无来源 burst still passes on (credited)
          if (L) b2.loseHp(L, c.amount * BLADE_TRANSFER, { source: src && src.side === 'ally' ? src : null, from: c.dmg, sourceless: true });
        }
        if (P.state === 'dive' && e2.alive && ++P.hits >= (bb.max_hit_cnt ?? Infinity)) shotDown(b2, e2); // 仅1次
      },
      tick(b2, e2, a, dt) {
        if (P.state !== 'dive' || !canCast(e2)) return;                         // a stunned blade does not fly on
        const t = P.target;
        if (!stepToward(e2, t.c, t.r, e2.s.moveSpeed * MOVE_SCALE * dt)) return;
        // arrival: 3×3 stun + DoT (无来源: credited to 胄, as the shell's), then the 初始模式 copy takes over
        stunBlast(b2, leader(b2) || e2, e2, t.r, t.c, bb.stun ?? 0, bb.dot_damage ?? 0, bb.dot_duration ?? 0, 'bladeDive');
        replace(b2, e2);
      },
    },
    s && {
      cd: s.cd, icd: s.icd, cond: (b2) => P.state === 'hover' && opsOnly(allTargets(b2, e)).length > 0, // 存在至少1名可选我方干员
      fire(b2, e2) { // 【掷剑】/【掷锤】 → 出击模式
        const t = opsOnly(b2.allies()).sort((p, q) => p.s.atk - q.s.atk || aggroCmp(p, q))[0];
        if (!t) return;
        P.state = 'dive'; P.hits = 0; P.target = { r: t.tileR, c: t.tileC };
        hover(b2, false);
        b2.addBuff(e2, { key: 'boss:sortie', persist: true, flags: { disarm: true } }); // 出击模式：不进行普通攻击
        const blink = hand ? branchRoute(tpl, `${hand}_blink`) : null;
        if (blink && Array.isArray(blink.start)) {
          const from = { x: e2.x, y: e2.y };
          e2.x = blink.start[1]; e2.y = blink.start[0];
          b2.fx('blink', { x: e2.x, y: e2.y, id: e2.id, fx: from.x, fy: from.y });
        }
        b2.fx('charge', { x: e2.x, y: e2.y, id: e2.id, tx: t.tileC, ty: t.tileR, kind: 'bladeDive' });
      },
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// 假想敌：铳 (boss_2 / boss_9) + 碎铳之簧

const isGun = (o) => /enemy_9017_achunt/.test(o.defId);
const isSpring = (o) => /enemy_90(18|19|20)_actrp/.test(o.defId);

function kitGun(ab, e, b) {
  const hidden = /_2$/.test(e.defId);
  const step = T(ab, '2.attack_speed') ?? 0, maxN = T(ab, '2.max_stack_cnt') ?? 0;
  const P = { last: null, n: 0, charge: null };
  const range = () => e.base.rangeRadius || 2;
  const setAspd = (b2) => aspdFloor(b2, e, step * P.n);
  const s1 = ab.sk['1'], s2 = ab.sk['2'], s3 = ab.sk['3'];
  const groundTargets = (b2) => allTargets(b2, e).filter((u) => u.ground);
  const list = [
    {
      spawn(b2, e2) { b2.addBuff(e2, { key: 'boss:unblockable', persist: true, flags: { unblockable: true } }); setAspd(b2); },
      before(c, b2, e2) { const l = targetsNear(b2, e2, range()); if (l.length) c.targets = [l.sort((p, q) => q.s.def - p.s.def || aggroCmp(p, q))[0]]; }, // 优先攻击防御力最高的单位
      attack(c, b2) {
        const t = c.targets[0];
        if (t === P.last) P.n = Math.min(maxN, P.n + 1); else { P.last = t; P.n = 0; }
        setAspd(b2);
      },
      dealt(c, b2, e2) { elem(b2, e2, c.target, 'erosion', e2.s.atk * (T(ab, '1.ep_damage_ratio') ?? 0)); }, // 攻击时附带侵蚀损伤
      tick(b2, e2, a, dt) {
        const ch = P.charge;
        if (!ch) return;
        const t = ch.target;
        const sp = (e2.s.moveSpeed + (T(ab, '3.move_speed') ?? 0)) * MOVE_SCALE * dt;
        const nx = e2.x, ny = e2.y;
        const arrived = stepToward(e2, t.x, t.y, sp);
        if (!b2.grid.groundPassable(Math.round(e2.y), Math.round(e2.x))) { e2.x = nx; e2.y = ny; }
        // "对进入自身0.35半径范围内的我方单位（包括飞行单位）造成一次…": an area selection (areaAllies)
        for (const u of areaAllies(b2, e2, e2.x, e2.y, CHARGE_RADIUS)) if (!ch.hit.has(u)) { ch.hit.add(u); hurt(b2, e2, u, e2.s.atk * (T(ab, '3.atk_scale') ?? 1), 'phys'); }
        if (arrived || b2.time >= ch.until || (e2.x === nx && e2.y === ny)) {
          P.charge = null;
          b2.removeBuff(e2, 'boss:charge');
          if (e2.route) e2.route.pts = null;
        }
      },
    },
    s1 && {
      cd: s1.cd, icd: s1.icd, cond: (b2) => groundTargets(b2).length > 0 && !P.charge,
      fire(b2, e2) { // 【最终之罚】 charge at the highest-DEF ground unit
        const t = groundTargets(b2).sort((p, q) => q.s.def - p.s.def || aggroCmp(p, q))[0];
        if (!t) return;
        const dur = T(ab, '3.duration') ?? 0;
        P.charge = { target: { x: t.x, y: t.y }, until: b2.time + dur, hit: new Set() };
        b2.addBuff(e2, { key: 'boss:charge', duration: dur, visible: true, flags: { noMove: true, disarm: true } });
        b2.fx('charge', { x: e2.x, y: e2.y, id: e2.id, tx: t.x, ty: t.y, kind: 'finalPenance' });
      },
    },
  ];
  if (hidden) {
    list.push({
      iv: 0.25,
      tick(b2, e2) { // 【未尽的告解】 physical / arts damage taken ×4.damage_scale while the 碎铳之簧 it came with remain
        const springs = b2.enemies.some((o) => o.alive && isSpring(o));
        if (springs) { const m = T(ab, '4.damage_scale') ?? 1; b2.addBuff(e2, { key: 'boss:confession', duration: 0.35, refresh: 'replace', mods: { physTakenMul: m, artsTakenMul: m } }); }
      },
    });
    if (s3) list.push({
      iv: s3.bb.interval ?? 1,
      tick(b2, e2) { // 【盲信之誓】 links: phys per second on operators standing on a line ("无视无法选择、迷彩": 起飞 too)
        for (const sp of b2.enemies) {
          if (!sp.alive || !isSpring(sp)) continue;
          b2.fx('link', { x: e2.x, y: e2.y, from: e2.id, to: sp.id, kind: 'faithLink', dur: s3.bb.interval ?? 1 });
          for (const u of b2.allies()) if (segDist(u.x, u.y, e2.x, e2.y, sp.x, sp.y) <= LINK_WIDTH) hurt(b2, e2, u, s3.bb.value ?? 0, 'phys', { ignoreSelect: true, tags: ['faithLink'] });
        }
      },
    });
    if (s2) list.push({
      cd: s2.cd, icd: s2.icd, cond: (b2) => b2.enemies.some((o) => o.alive && isSpring(o)),
      fire(b2, e2) { // 【末日布道】 springs dash to 铳, invulnerable, trampling operators
        // PRTS “碎铳之簧” 追逐模式 "不进行普通攻击": `disarm` for the dash (until 0.1.3 it kept shooting while it ran)
        for (const sp of b2.enemies) {
          if (!sp.alive || !isSpring(sp) || !sp.mem.ab) continue;
          sp.mem.ab.dash = { until: b2.time + (s2.bb.dog_duration ?? 0), mul: 1 + (s2.bb.move_speed ?? 0), gun: e2, hit: new Set() };
          b2.addBuff(sp, { key: 'boss:dash', duration: s2.bb.dog_duration ?? 0, visible: true, flags: { invulnerable: true, noMove: true, unblockable: true, disarm: true } });
          b2.fx('dash', { x: sp.x, y: sp.y, id: sp.id, tx: e2.x, ty: e2.y });
        }
      },
    });
  }
  return list;
}

function kitSpring(ab, e) {
  const kind = /9018/.test(e.defId) ? 'arts' : /9019/.test(e.defId) ? 'element' : 'hits';
  const scale = T(ab, '1.damage_scale') ?? 1, regen = T(ab, '1.regenerate_duration') ?? 0;
  const P = { up: false, barrier: 0, hits: 0, downAt: null };
  const gun = (b) => nearestOf(b, e, (o) => isGun(o));
  const raise = (b) => {
    P.up = true;
    if (kind === 'arts') P.barrier = e.s.maxHp * (T(ab, '1.shield_ratio') ?? 0);
    if (kind === 'hits') P.hits = T(ab, '1.block_damage_max_times') ?? 0;
    b.addBuff(e, { key: 'boss:springShield', persist: true, visible: true, flags: { unblockable: true } }); // 护盾生效时，自身无法被阻挡
    b.fx('phase', { x: e.x, y: e.y, id: e.id, kind: `spring_${kind}` });
  };
  const drop = (b) => { P.up = false; P.downAt = b.time; b.removeBuff(e, 'boss:springShield'); b.fx('shieldBreak', { x: e.x, y: e.y, id: e.id }); };
  const sk = ab.sk['1'];
  return [
    {
      spawn(b) { raise(b); },
      hitIn(c, b, e2) {
        if (!P.up) return;
        const ty = c.dmg.type;
        if (kind === 'arts') {                           // 法术屏障: absorbs arts (after RES, like a shield); phys ×0.1 + counter
          if (ty === 'arts') {
            P.barrier -= absorbArts(c, P.barrier);
            if (P.barrier <= 1e-6) { P.barrier = 0; drop(b); }
          } else if (ty === 'phys') {
            c.dmg.mul *= scale;
            // the counter "对来源造成…无来源物理附加伤害" picks its attacker directly — no selection, so an airborne 起飞
            // attacker takes it too (PRTS 异常效果 无法选择: "'直接选中'的能力…不受这些仅在选择时生效的异常效果制约")
            const s = c.source, o = { ignoreSelect: true, tags: ['springCounter'] };
            if (s && s.side === 'ally' && s.alive) { hurt(b, e2, s, e2.s.atk * (T(ab, '1.atk_scale') ?? 0), 'phys', o); elem(b, e2, s, 'erosion', e2.s.atk * (T(ab, '1.ep_damage_ratio') ?? 0), o); }
          }
        } else if (kind === 'element') {                 // 元素护盾: phys/arts heavily reduced
          if (ty === 'phys' || ty === 'arts') c.dmg.mul *= scale;
        } else if (ty === 'phys' || ty === 'arts' || ty === 'true') { // 频次护盾: negates N hits
          c.dmg.cancel = true;
          if (--P.hits <= 0) drop(b);
        }
      },
      burst(c, b) { if (kind === 'element' && P.up) drop(b); },  // 自身元素损伤爆发时，护盾消失
      taken(c, b, e2) {
        if (!(c.amount > 0)) return;
        if (c.dmg.tags && c.dmg.tags.includes(SPRING_SHARE_TAG)) return;       // a share never passes on again
        const s0 = c.source || c.credit;                                       // a 无来源 burst still passes on (credited)
        const src = s0 && s0.side === 'ally' ? s0 : null;
        // 【盲信之誓】 受到伤害时令假想敌：铳受到等量的无来源生命流失 (PRTS); the even split to the other springs follows the
        // 隐秘核心 handbook ("传递给<假想敌：铳>和场上其他<“碎铳之簧”>") — not in the PRTS talent, [ASSUMED] amount
        const g = gun(b);
        if (g) b.loseHp(g, c.amount * PART_TRANSFER, { source: src, from: c.dmg, sourceless: true });
        const others = b.enemies.filter((o) => o.alive && o !== e2 && isSpring(o));
        for (const o of others) b.loseHp(o, (c.amount * PART_TRANSFER) / others.length, { source: src, from: c.dmg, tags: [SPRING_SHARE_TAG], sourceless: true });
      },
      tick(b, e2, a, dt) {
        if (!P.up && P.downAt != null && b.time - P.downAt >= regen) raise(b);
        const d = e2.mem.ab.dash;
        if (!d) return;
        const g = d.gun && d.gun.alive ? d.gun : gun(b);
        const arrived = !g || stepToward(e2, g.x, g.y, e2.s.moveSpeed * d.mul * MOVE_SCALE * dt) || Math.hypot(g.x - e2.x, g.y - e2.y) < 1;
        // 追逐模式 "对进入自身0.35半径范围内的我方单位（包括飞行单位）造成一次攻击力100%的物理普通伤害" (until 0.1.3: radius 0.5)
        for (const u of areaAllies(b, e2, e2.x, e2.y, CHARGE_RADIUS)) if (!d.hit.has(u)) { d.hit.add(u); hurt(b, e2, u, e2.s.atk, 'phys'); }
        if (arrived || b.time >= d.until) { e2.mem.ab.dash = null; b.removeBuff(e2, 'boss:dash'); if (e2.route) e2.route.pts = null; }
      },
    },
    // while shielded, every (spCost+1)-th attack (enemy SP +1 per attack, as 粉碎攻坚手's official text) adds the shield's
    // special attack on that attack's target
    (kind === 'element' || kind === 'hits') && sk && {
      attack(c, b, e2, a) {
        if (!P.up) return;
        a.n = (a.n ?? 0) + 1;
        if (a.n % nthOf(sk)) return;
        const t0 = c.targets.find((u) => u && u.alive);
        if (!t0) return;
        if (kind === 'element') { // bouncing element bullet: `times` targets, weaker after each bounce
          const times = sk.bb.times || 1, ratio = sk.bb.ep_damage_ratio || 0;
          let t = t0;
          const hit = new Set();
          for (let k = 0; k < times && t; k++) {
            hit.add(t);
            b.fx('beam', { x: e2.x, y: e2.y, from: e2.id, to: t.id, kind: 'springBullet' });
            elem(b, e2, t, 'erosion', e2.s.atk * ratio * Math.pow(SPRING_BOUNCE_FALLOFF, k));
            const prev = t;
            t = areaAllies(b, e2, prev.x, prev.y, SPRING_BOUNCE_RANGE).filter((u) => !hit.has(u)).sort((p, q) => Math.hypot(p.x - prev.x, p.y - prev.y) - Math.hypot(q.x - prev.x, q.y - prev.y) || aggroCmp(p, q))[0];
          }
        } else { // 十连击
          b.fx('beam', { x: e2.x, y: e2.y, from: e2.id, to: t0.id, kind: 'springCombo' });
          for (let i = 0; i < SPRING_COMBO_HITS && t0.alive; i++) hurt(b, e2, t0, e2.s.atk * (sk.bb.atk_scale || 0), 'phys');
        }
      },
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// 假想敌：管 (boss_3 / boss_10) + 假想敌：弦 + “余音”

const echoesOf = (b, form) => b.enemies.filter((o) => o.alive && o.defId === ECHO_KEY && o.mem.ab && o.mem.ab.form === form);

/** Switch an echo's form. */
export function setEchoForm(b, echo, form) {
  const ab = echo.mem.ab;
  if (!ab) return;
  ab.form = form;
  ab.strikes = 0;
  const mods = form === 'gold' ? { aspd: T(ab, '1.attack_speed') ?? 0 } : { atkPct: T(ab, '2.atk') ?? 0, moveMul: 1 - (T(ab, '2.move_speed') ?? 0) };
  b.addBuff(echo, { key: 'boss:echoForm', persist: true, visible: true, mods });
  b.fx('phase', { x: echo.x, y: echo.y, id: echo.id, kind: `echo_${form}` });
}

/** An echo takes a strike/hit: pulse around it (PRTS “余音” "受到伤害时对半径1.6范围内的我方单位造成…": an area selection of the
 *  echo — no unblocking 隐匿 operator) and count towards the form switch. */
export function echoHit(b, echo) {
  const ab = echo.mem.ab;
  if (!ab || !echo.alive) return;
  const atk = echo.s.atk;
  b.fx('explode', { x: echo.x, y: echo.y, r: ECHO_PULSE_RADIUS, kind: 'echoPulse' });
  for (const u of areaAllies(b, echo, echo.x, echo.y, ECHO_PULSE_RADIUS)) {
    hurt(b, echo, u, atk * (T(ab, '3.atk_scale') ?? 0), 'arts');
    elem(b, echo, u, 'apoptosis', atk * (T(ab, '3.ep_damage_ratio') ?? 0));
  }
  const need = ab.form === 'gold' ? T(ab, '1.hit_times_to_switch') : T(ab, '2.hit_times_to_switch');
  ab.strikes = (ab.strikes ?? 0) + 1;
  if (need > 0 && ab.strikes >= need) setEchoForm(b, echo, ab.form === 'gold' ? 'dark' : 'gold');
}

function kitEcho(ab, e) {
  const s = ab.sk.Skill;
  return [
    {
      spawn(b, e2) { setHits(e2, e2.def.maxHp); hitCount(b, e2, true); e2.blockWeight = ECHO_BLOCK_WEIGHT; setEchoForm(b, e2, 'dark'); },
      taken(c, b, e2) { const s = c.source || c.credit; if (s && s.side === 'ally') echoHit(b, e2); }, // 受到伤害时以自身为中心造成一次范围伤害 (a 无来源 burst too)
    },
    s && {
      cd: s.cd, icd: s.icd,
      fire(b, e2) { // 合奏
        const gold = e2.mem.ab.form === 'gold';
        const r = gold ? ECHO_ENSEMBLE_RADIUS.gold : ECHO_ENSEMBLE_RADIUS.dark;
        const ratio = gold ? T(ab, '4.ep_damage_ratio_passion') ?? 0 : T(ab, '4.ep_damage_ratio_depassion') ?? 0;
        b.fx('explode', { x: e2.x, y: e2.y, r, kind: gold ? 'ensembleGold' : 'ensembleDark' });
        for (const u of areaAllies(b, e2, e2.x, e2.y, r)) { hurt(b, e2, u, e2.s.atk, 'arts'); elem(b, e2, u, 'apoptosis', e2.s.atk * ratio); }
      },
    },
  ];
}

/** 管 / 弦 core: summon loop, strikes on its own form of 余音, skill. */
function pipeCore(ab, e, b, tpl, { form, prefix }) {
  const hi = T(ab, `1.${prefix}_t_1[high_hp].interval`) ?? 40, lo = T(ab, `1.${prefix}_t_1[low_hp].interval`) ?? hi, thr = T(ab, '1.hp_ratio') ?? 0;
  const key = ab.tS['1.enemy_key'] ?? ECHO_KEY;
  const P = { acc: 0, atk: Infinity };   // first strike as soon as an echo of its form exists (engine attack rule)
  const summon = (b2, e2) => {
    const got = branchSpawn(b2, tpl, 'summon_enemy', 0, { at: { x: e2.x, y: e2.y }, fallback: () => [b2.spawnEnemy(key, { pos: [e2.y, e2.x], route: toGoal(b2, e2.x, e2.y) })].filter(Boolean) });
    for (const u of got) if (u.defId === ECHO_KEY && form === 'gold') setEchoForm(b2, u, 'gold');
    b2.fx('summon', { x: e2.x, y: e2.y, id: e2.id, key, n: got.length });
  };
  return {
    spawn(b2, e2) { e2.profile.noAttack = true; aspdFloor(b2, e2); },
    tick(b2, e2, a, dt) {
      P.acc += dt;
      if (P.acc >= (e2.hpRatio < thr ? lo : hi)) { P.acc = 0; summon(b2, e2); }
      if (!canCast(e2, false)) return;
      P.atk += dt;
      if (P.atk < e2.s.interval) return;
      const t = b2.rng.pick(echoesOf(b2, form));                 // 优先攻击…形态余音
      if (!t) return;
      P.atk = 0;
      e2.lastAttackAt = b2.time;
      e2.stats.attacks++;
      b2.fx('beam', { x: e2.x, y: e2.y, from: e2.id, to: t.id, kind: `${prefix}Strike` });
      echoHit(b2, t);
    },
  };
}

function kitPipe(ab, e, b, tpl) {
  const s = ab.sk['1'];
  return [
    pipeCore(ab, e, b, tpl, { form: 'dark', prefix: 'acduml' }),
    {
      death(c, b2) { for (const o of b2.aliveEnemies()) if (o.defId === 'enemy_9022_acdumm') b2.kill(o, null); }, // 弦 leaves with 管
    },
    s && {
      cd: s.cd, icd: s.icd, cond: (b2) => echoesOf(b2, 'dark').length > 0,
      fire(b2, e2) { // 【裂管之奏】 three strikes on every dark echo
        const r = s.bb.range_radius ?? 0, ep = s.bb.ep_damage_ratio ?? 0;
        for (const echo of echoesOf(b2, 'dark')) for (let k = 0; k < 3; k++) b2.after(k * PIPE_STRIKE_GAP, () => {
          if (!e2.alive || !echo.alive) return;
          b2.fx('explode', { x: echo.x, y: echo.y, r, kind: 'pipeStrike' });
          for (const u of areaAllies(b2, e2, echo.x, echo.y, r)) { hurt(b2, e2, u, e2.s.atk, 'arts'); elem(b2, e2, u, 'apoptosis', e2.s.atk * ep); }
          echoHit(b2, echo);
        }, { owner: e2 });
      },
    },
  ];
}

function kitString(ab, e, b, tpl) {
  const s = ab.sk['1'];
  return [
    pipeCore(ab, e, b, tpl, { form: 'gold', prefix: 'acdumm' }),
    { spawn(b2, e2) { b2.addBuff(e2, { key: 'boss:eternal', persist: true, flags: { invulnerable: true, untargetable: true } }); } }, // 永久无敌
    s && {
      cd: s.cd, icd: s.icd, cond: (b2) => echoesOf(b2, 'gold').length > 0,
      fire(b2, e2) { // 【断弦之奏】 AoE on every gold echo, which then turns dark
        const r = s.bb.range_radius ?? 0, ep = s.bb.ep_damage_ratio ?? 0;
        for (const echo of echoesOf(b2, 'gold')) {
          b2.fx('explode', { x: echo.x, y: echo.y, r, kind: 'stringStrike' });
          for (const u of areaAllies(b2, e2, echo.x, echo.y, r)) { hurt(b2, e2, u, e2.s.atk, 'arts'); elem(b2, e2, u, 'apoptosis', e2.s.atk * ep); }
          setEchoForm(b2, echo, 'dark');
        }
      },
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------
// 盐风主教昆图斯 (boss_4)

function kitQuintus(ab, e, b, tpl) {
  const P = { stage: 0, t0: null, stageAt: null, tent: 0 };
  const stageSkills = [['Tidewater', 'Rockfall', 'SummonTentac'], ['TidewaterG1', 'RockfallG1', 'SummonTentacG1'], ['TidewaterG2', 'RockfallG2', 'SummonTentacG2', 'Doom']];
  const skills = [];
  const atkRatio = T(ab, 'epdamage.attack@ep_damage_ratio') ?? 0;
  const mk = (name, stage) => {
    const s = ab.sk[name];
    if (!s) return null;
    const kind = name.replace(/G\d$/, '');
    const a = { cd: s.cd, icd: s.icd, stage, cond: () => P.stage === stage, fire: (b2, e2) => QUINTUS[kind](b2, e2, s, P, tpl) };
    skills.push(a);
    return a;
  };
  const list = [{
    spawn(b2, e2) { P.t0 = b2.time; P.stageAt = b2.time; e2.profile.maxTargets = 2; },
    before(c, b2, e2) { // 同时攻击防御最高的两个单位
      const l = targetsNear(b2, e2, e2.base.rangeRadius || 99).sort((p, q) => q.s.def - p.s.def || aggroCmp(p, q));
      if (l.length) c.targets = l.slice(0, 2);
    },
    dealt(c, b2, e2) { elem(b2, e2, c.target, 'neural', e2.s.atk * atkRatio); },
    iv: 0.25,
    tick(b2, e2) {
      const lost = 1 - e2.hpRatio;
      if (P.stage === 0 && (lost >= (T(ab, 'growup1.hp_ratio') ?? 1) || b2.time - P.t0 >= (T(ab, 'growup1.interval') ?? Infinity))) grow(b2, e2, 1);
      else if (P.stage === 1 && (lost >= 2 * (T(ab, 'growup2.hp_ratio') ?? 1) || b2.time - P.stageAt >= (T(ab, 'growup2.interval') ?? Infinity))) grow(b2, e2, 2);
    },
  }];
  const grow = (b2, e2, n) => {
    P.stage = n; P.stageAt = b2.time;
    b2.addBuff(e2, { key: 'boss:grow', persist: true, visible: true, mods: { atkPct: T(ab, `atkup${n}.atk`) ?? 0 } });
    for (const a of skills) if (a.stage === n) a.left = a.icd;   // the new form's skills start from their initial cooldown
    b2.fx('grow', { x: e2.x, y: e2.y, id: e2.id, stage: n });
  };
  stageSkills.forEach((names, i) => names.forEach((n) => list.push(mk(n, i))));
  return list;
}

const QUINTUS = {
  Tidewater(b, e, s) { // 【大潮】 "对场上所有我方单位…": every operator it can select (fieldAllies): arts + neural
    b.fx('tide', { x: e.x, y: e.y, id: e.id });
    for (const u of fieldAllies(b, e)) { hurt(b, e, u, e.s.atk * (s.bb.atk_scale ?? 0), 'arts'); elem(b, e, u, 'neural', e.s.atk * (s.bb.ep_damage_ratio ?? 0)); }
  },
  Rockfall(b, e, s, P) { // 【崩坍】 delayed strikes on the N highest-DEF units
    const n = ROCKFALL_TARGETS[Math.min(P.stage, ROCKFALL_TARGETS.length - 1)];
    const ts = allTargets(b, e).sort((p, q) => q.s.def - p.s.def || aggroCmp(p, q)).slice(0, n);
    for (const t of ts) {
      b.fx('rockfall', { x: t.x, y: t.y, id: t.id, dur: ROCKFALL_DELAY });
      b.after(ROCKFALL_DELAY, () => { if (e.alive && t.alive) hurt(b, e, t, e.s.atk * (s.bb.atk_scale ?? 0), 'phys'); }, { owner: e });
    }
  },
  SummonTentac(b, e, s, P, tpl) { // 【断裂生殖】 tentacles at the template devices (phase i on the i-th cast)
    const br = tpl && tpl.branches && tpl.branches[s.bs.branch_id ?? 'dslily_dstnta'];
    let spots = [];
    if (Array.isArray(br) && br.length) {
      const phase = br[Math.min(P.tent, br.length - 1)] || [];
      const devs = (tpl.devices || []);
      for (const a of phase) { const d = devs.find((x) => x.alias === a.key); if (d && d.pos) spots.push(d.pos); }
    }
    if (!spots.length) { const t = b.rng.pick(allTargets(b, e)); if (t) spots = [[t.tileR, t.tileC]]; }
    P.tent++;
    for (const [r, c] of spots) {
      b.fx('tentacle', { x: c, y: r, r: TENTACLE_RADIUS, dur: TENTACLE_STUN });
      for (const u of areaAllies(b, e, c, r, TENTACLE_RADIUS)) b.applyStatus(u, 'stun', { duration: TENTACLE_STUN, source: e });
    }
  },
  Doom(b, e, s) { // 【物种爆发】
    b.fx('telegraph', { x: e.x, y: e.y, r: 99, dur: DOOM_DELAY, kind: 'speciesBurst', id: e.id });
    b.after(DOOM_DELAY, () => { if (e.alive) lpLoss(b, Math.abs(s.bb.value ?? 0), 'speciesBurst', e); }, { owner: e });
  },
};

// ---------------------------------------------------------------------------------------------------------------
// 卢西恩，“猩红血钻” (boss_5) + 不祥幻影

function lucienCore(ab, e) {
  const pen = T(ab, 'penetrate.def_penetrate') ?? 0, prob = T(ab, 'evade.prob') ?? 0, epr = T(ab, 'combat.attack@ep_damage_ratio') ?? 0;
  const s = ab.sk.aoe;
  return [
    {
      spawn(b, e2) { if (pen > 0) b.addBuff(e2, { key: 'boss:pierce', persist: true, mods: { defIgnorePct: pen } }); },
      tick(b, e2, a) { // 未被阻挡时有几率闪避物理与法术攻击
        const on = !e2.blockedBy && prob > 0;
        if (on === a.on) return;
        a.on = on;
        if (on) b.addBuff(e2, { key: 'boss:evade', persist: true, mods: { dodgePhys: prob, dodgeArts: prob } });
        else b.removeBuff(e2, 'boss:evade');
      },
      dealt(c, b, e2) { elem(b, e2, c.target, 'neural', e2.s.atk * epr); },
    },
    s && {
      // cast with a target in the radius (PRTS 技能 "需要目标"; 不祥幻影 "仅在半径2范围内存在我方单位时触发"): the trigger
      // selection (targetsNear — PRTS 选择器 "所有触发选择器通常不无视迷彩"): an airborne (起飞) operator evades a ground
      // leader (对地规避 — counting her spent the skill on nobody, §21.22), nor does an unblocking 隐匿 or 迷彩 one count
      cd: s.cd, icd: s.icd, cond: (b) => targetsNear(b, e, LUCIEN_AOE_RADIUS).length > 0,
      fire(b, e2) {
        // "该技能伤害无视迷彩": an area selection (areaAllies) — a 迷彩 operator is hit, an unblocking 隐匿 one not
        b.fx('explode', { x: e2.x, y: e2.y, r: LUCIEN_AOE_RADIUS, kind: 'crimsonAoe' });
        for (const u of areaAllies(b, e2, e2.x, e2.y, LUCIEN_AOE_RADIUS)) { hurt(b, e2, u, e2.s.atk * (s.bb.atk_scale ?? 0), 'phys'); elem(b, e2, u, 'neural', e2.s.atk * (s.bb.ep_damage_ratio ?? 0)); }
      },
    },
  ];
}

function kitLucien(ab, e) {
  const s = ab.sk.blink;
  return [...lucienCore(ab, e), s && {
    cd: s.cd, icd: s.icd, cond: () => !!e.blockedBy,
    fire(b, e2) { // blink past the blocker, leaving a 不祥幻影 on its path
      const route = remainingRoute(e2);
      const from = blinkForward(b, e2, s.bb.dist ?? 1.5);
      if (!from) return;
      const ph = b.spawnEnemy(PHANTOM_KEY, { pos: [from.y, from.x], route, ownerPlayerId: e2.ownerId, sourcePlayerId: e2.sourcePlayerId });
      if (ph) b.fx('summon', { x: from.x, y: from.y, id: e2.id, key: PHANTOM_KEY, n: 1 });
    },
  }];
}

// ---------------------------------------------------------------------------------------------------------------
// 阿利斯泰尔，帝国余晖 (boss_6)

function kitLion(ab, e, b) {
  const eq = ab.sk.equip, eqA = ab.sk.equipA, st = ab.sk.store, stA = ab.sk.storeA, su = ab.sk.Suicide;
  const P = { sp: 0, adv: false, nextAnim: null, wand: false };
  const wandDef = b.data.getEnemy('enemy_10030_vtwand');
  const disarm = wandDef && wandDef.talent ? wandDef.talent['1.disarmed_duration'] ?? 0 : 0;
  const range = () => e.base.rangeRadius || 3.4;
  const cost = eq ? (eq.sp > 0 ? eq.sp : 25) : Infinity;
  /** Equipment lying on this field, oldest first. */
  const equipment = (b2) => b2.enemies.filter((q) => q.alive && EQUIP_KEYS.includes(q.defId)).sort((p, q) => p.spawnSeq - q.spawnSeq);
  const decree = (b2, e2) => { // 【王权号令】 plus-shaped strike + random equipment
    const sk = P.adv && eqA ? eqA : eq;
    const t = b2.rng.pick(targetsNear(b2, e2, range()));
    if (!t) return false;
    const r0 = t.tileR, c0 = t.tileC;
    const tiles = [[r0, c0], [r0 + 1, c0], [r0 - 1, c0], [r0, c0 + 1], [r0, c0 - 1]];
    b2.fx('telegraph', { x: c0, y: r0, r: 1, kind: 'royalDecree', tiles: 'plus', id: e2.id });
    for (const u of areaAlliesInTiles(b2, e2, r0, c0, 'plus', 1)) hurt(b2, e2, u, e2.s.atk * ((sk && sk.bb.atk_scale) || 0), 'phys');
    const taken = equipment(b2);
    const free = tiles.filter(([r, c]) => b2.grid.inRect(r, c) && b2.grid.isLow(r, c) && b2.grid.groundPassable(r, c) && !b2.unitAt(r, c)
      && !taken.some((q) => Math.round(q.y) === r && Math.round(q.x) === c));
    const spot = b2.rng.pick(free);
    if (spot) {
      const key = b2.rng.pick(EQUIP_KEYS);
      const q = b2.spawnEnemy(key, { pos: spot, route: { motion: 'FLY', start: spot, end: spot, steps: [{ t: 'wait', s: 99999 }] }, tag: 'part', countInTotal: false, ownerPlayerId: e2.ownerId });
      if (q) b2.fx('equip', { x: spot[1], y: spot[0], id: q.id, key });
    }
    return true;
  };
  const animate = (b2, e2) => { // 【莫非王土】 the latest equipment (2 at ≤50 %)
    const n = P.adv && stA ? stA.bb.max_target ?? 2 : 1;
    const sk = P.adv && stA ? stA : st;
    for (const q of equipment(b2).slice(-n)) {
      if (q.defId === 'enemy_10028_vtswd') {
        const t = b2.rng.pick(targetsNear(b2, e2, range()));
        if (t) { b2.fx('sword', { x: q.x, y: q.y, from: q.id, to: t.id }); hurt(b2, e2, t, e2.s.atk * ((sk && sk.bb.atk_scale) || 0), 'phys'); }
      } else if (q.defId === 'enemy_10029_vtshld') {
        const side = Math.sign(q.x - e2.x) || -1;
        b2.addBuff(e2, { key: 'boss:vest', shield: (sk && sk.bb.dynamic) || 0, persist: true, visible: true, data: { side, cut: (sk && sk.bb.damage_resistance) || 0 } });
        b2.fx('vest', { x: e2.x, y: e2.y, id: e2.id, side });
      } else if (q.defId === 'enemy_10030_vtwand') {
        P.wand = true;   // [substitute for 黄金回响]: next attack becomes arts and disarms its target
        b2.fx('equip', { x: q.x, y: q.y, id: q.id, key: q.defId, kind: 'wand' });
      }
      b2.kill(q, null);
    }
  };
  return [
    {
      tick(b2, e2, a, dt) {
        if (!P.adv && e2.hpRatio <= (T(ab, 'advance.hp_ratio') ?? 0)) { // ≤50 %: DEF +100 %, RES +45, animate two
          P.adv = true;
          b2.addBuff(e2, { key: 'boss:advance', persist: true, visible: true, mods: { defPct: T(ab, 'advance.def') ?? 0, resFlat: T(ab, 'advance.magic_resistance') ?? 0 } });
          b2.fx('phase', { x: e2.x, y: e2.y, id: e2.id, kind: 'lionAdvance' });
        }
        if (!canCast(e2, false)) return;
        P.sp += dt * ENEMY_SP_PER_SEC;
        if (P.sp >= cost && decree(b2, e2)) P.sp = 0;
        // 【莫非王土】: ANIMATE_DELAY s after equipment first lies on the field, then once per 王权号令 cycle
        const has = equipment(b2).length > 0;
        if (!has) { P.nextAnim = null; return; }
        if (P.nextAnim == null) P.nextAnim = b2.time + ANIMATE_DELAY;
        if (b2.time >= P.nextAnim) { animate(b2, e2); P.nextAnim = b2.time + (Number.isFinite(cost) ? cost : ANIMATE_DELAY); }
      },
      hitIn(c, b2, e2) { // vest: damage from its side ×(1 − damage_resistance) while the barrier holds
        const v = e2.findBuff('boss:vest');
        if (v && v.shield > 0 && c.source && Math.sign(c.source.x - e2.x) === v.data.side) c.dmg.mul *= 1 - v.data.cut;
      },
      hitOut(c, b2, e2) { if (P.wand && c.dmg.isAttack) c.dmg.type = 'arts'; },
      dealt(c, b2, e2) { if (!P.wand) return; P.wand = false; if (disarm > 0) b2.applyStatus(c.target, 'disarm', { duration: disarm, source: e2 }); },
    },
    su && {
      cd: su.cd, icd: su.icd,
      fire(b2, e2) { // 【斥退】 "对场上所有我方单位…": every operator it can select (fieldAllies)
        b2.fx('telegraph', { x: e2.x, y: e2.y, r: 99, kind: 'repel', id: e2.id });
        for (const u of fieldAllies(b2, e2)) hurt(b2, e2, u, e2.s.atk * (su.bb.atk_scale ?? 0), 'arts');
        lpLoss(b2, Math.abs(su.bb.value ?? 0), 'repel', e2);
      },
    },
  ];
}

function kitEquip() {
  return [{ spawn(b, e) { b.addBuff(e, { key: 'boss:equip', persist: true, flags: { invulnerable: true, untargetable: true, noMove: true } }); } }];
}

// ---------------------------------------------------------------------------------------------------------------
// “萨米的意志” (boss_7)

function kitDeer(ab, e) {
  const dr = T(ab, 'Madness.damage_resistance') ?? 0;
  const atkN = T(ab, 'Madness.enemy_smdeer_mad[attack].max_cnt') ?? 1, skN = T(ab, 'Madness.enemy_smdeer_mad[skill].max_target') ?? 1;
  const lasso = ab.sk.Lasso, doom = ab.sk.Doom;
  const P = { low: false, acc: Infinity };   // like engine attacks, the first 冰凌 comes as soon as it has a target
  return [
    {
      spawn(b, e2) { e2.profile.noAttack = true; },
      tick(b, e2, a, dt) {
        if (!P.low && e2.hpRatio < 0.5) { // <50 %: damage taken reduced, extra targets
          P.low = true;
          b.addBuff(e2, { key: 'boss:madness', persist: true, visible: true, mods: { physTakenMul: 1 - dr, artsTakenMul: 1 - dr } }); // 物理和法术伤害降低
          b.fx('phase', { x: e2.x, y: e2.y, id: e2.id, kind: 'deerMadness' });
        }
        if (!canCast(e2, false)) return;
        P.acc += dt;
        if (P.acc < e2.s.interval) return;
        const cands = fairOrder(b, e2, allTargets(b, e2), P);
        if (!cands.length) return;
        P.acc = 0;
        const cols = [];
        for (const t of cands) { if (!cols.includes(t.tileC)) cols.push(t.tileC); if (cols.length >= (P.low ? atkN : 1)) break; }
        for (const c of cols) { // 【冰凌】 its normal attack: the whole column (an area selection: no unblocking 隐匿 operator)
          const hit = b.allies().filter((u) => u.tileC === c && areaSelectable(e2, u));
          b.fx('column', { x: c, y: e2.y, c, id: e2.id });
          for (const u of hit) b.dealDamage(e2, u, { amount: e2.s.atk, type: 'phys', isAttack: true });
        }
        e2.lastAttackAt = b.time;
        e2.stats.attacks++;
      },
    },
    lasso && {
      cd: lasso.cd, icd: lasso.icd, cond: (b) => allTargets(b, e).length > 0,
      fire(b, e2) { // 【自然涌动】 stun + arts per second
        const n = P.low ? skN : (lasso.bb.max_target ?? 1);
        const dur = lasso.bb.projectile_life_time ?? 0;
        for (const t of fairOrder(b, e2, allTargets(b, e2), P).slice(0, n)) {
          b.fx('beam', { x: e2.x, y: e2.y, from: e2.id, to: t.id, kind: 'naturalSurge', dur });
          b.applyStatus(t, 'stun', { duration: dur, source: e2 });
          b.addBuff(t, { key: 'boss:surge', duration: dur, interval: 1, visible: true,
            onTick: ({ battle, unit }) => battle.dealDamage(e2, unit, { amount: e2.s.atk * (lasso.bb.atk_scale ?? 0), type: 'arts', canDodge: false, ignoreSelect: true, tags: ['enemyAbility'] }) });
        }
      },
    },
    doom && {
      cd: doom.cd, icd: doom.icd,
      fire(b, e2) {
        b.fx('telegraph', { x: e2.x, y: e2.y, r: 99, kind: 'samiDoom', id: e2.id });
        for (const u of fieldAllies(b, e2)) hurt(b, e2, u, e2.s.atk * (doom.bb.atk_scale ?? 0), 'arts');
        lpLoss(b, Math.abs(doom.bb.value ?? 0), 'samiDoom', e2);
      },
    },
  ];
}

// ---------------------------------------------------------------------------------------------------------------

export const BOSS_KITS = Object.freeze({
  enemy_9013_acstmk: kitHelm,          // boss_1 假想敌：胄
  enemy_9013_acstmk_2: kitHelm,        // boss_8 假想敌：胄 (隐秘核心)
  enemy_9014_acstma: kitBlade,         // “斩胄之剑”
  enemy_9015_acstmb: kitBlade,         // “破胄之锤”
  enemy_9016_acstmr: kitShell,         // 刺胄之弹
  enemy_9017_achunt: kitGun,           // boss_2 假想敌：铳
  enemy_9017_achunt_2: kitGun,         // boss_9 假想敌：铳 (隐秘核心)
  enemy_9018_actrpa: kitSpring,        // “碎铳之簧” 法术护盾
  enemy_9019_actrpb: kitSpring,        // “碎铳之簧” 元素护盾
  enemy_9020_actrpc: kitSpring,        // “碎铳之簧” 频次护盾
  enemy_9021_acduml: kitPipe,          // boss_3 假想敌：管
  enemy_9021_acduml_2: kitPipe,        // boss_10 假想敌：管 (隐秘核心)
  enemy_9022_acdumm: kitString,        // 假想敌：弦
  enemy_9023_acdums: kitEcho,          // “余音”
  enemy_1521_dslily: kitQuintus,       // boss_4 盐风主教昆图斯
  enemy_2016_csphtm: kitLucien,        // boss_5 卢西恩，“猩红血钻”
  enemy_2017_csphts: lucienCore,       // 不祥幻影
  enemy_9032_aclionk: kitLion,         // boss_6 阿利斯泰尔，帝国余晖
  enemy_10028_vtswd: kitEquip,         // 未装配刀片 (inert until animated)
  enemy_10029_vtshld: kitEquip,        // 防护背心
  enemy_10030_vtwand: kitEquip,        // 冲击式施术单元
  enemy_9033_acdeer: kitDeer,          // boss_7 “萨米的意志”
});
export const BOSS_KEYS = Object.freeze(Object.keys(BOSS_KITS));
