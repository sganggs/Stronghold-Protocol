// server/sim/content/enemies/helpers.js — shared helpers of the enemy kits (split from content/enemies.js; the module
// map is in its header): the constants several families use, the per-battle state, the ability bookkeeping (abOf /
// attach / dispatch, T, canCast …) and the selection and damage helpers (elem, hurt, areaAllies & friends, zone,
// spawnChildren, setForm, lpLoss, expose …).

import { ELEMENT } from '../../constants.js';
import { canTargetAlly, sortAllyTargets, areaSelectable, auraSelectable } from '../../targeting.js';
import { hypot } from '../../detmath.js';

// ---------------------------------------------------------------------------------------------------------------
// constants (numbers that exist nowhere in the data)

/** 侵蚀 → engine gauge. */
export const EROSION = 'erosion';

/** Official erosion burst on operators (gamedata_const termDescriptionDict ba.dt.erosion; engine constants ELEMENT.erosion.ally). */
export const EROSION_BURST = Object.freeze({ defDown: ELEMENT.erosion.ally.defDown, physDamage: ELEMENT.erosion.ally.damage });

/** 重生 of a Revive[Trigger] knock-out before its husk (PRTS 深池逐火战士 and 假想敌：再生 天赋: "被击倒后重生，持续1s，随后变为
 *  怨恨的余烬 / 再生状态，1s内不移动且持有无敌+无法阻挡+失衡免疫"; both models' knock-out clips last 1 s). */
export const HUSK_REBIRTH = 1;

/** Death-explosion radius when the enemy has no official radius [ASSUMED]. */
const BOOM_RADIUS = 1.25;

/** 【污染秽蚀】 ticks once per second; "同名效果不叠加": a unit inside several zones takes one tick per second. */
const POLLUTION_INTERVAL = 1;

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

/**
 * 隐匿 of the 鸭爵 strategy's swapped-in enemies (spawn tag 'duck': content/bands/meta.js duckReplace) comes back no sooner
 * than this many seconds after a block ends — in practice 流泪小子 (enemy_2034_sythef_2, the only one of the four with 隐匿;
 * officially 0 s, STEALTH_RESTORE_BY_KEY). A deliberate deviation from the official game: the owner's decision of
 * 2026-10-07 「鸭爵策略产生的泪眼汪汪…要不等待个1秒这样再重新隐匿」 (community report of 2026-10-07, GitHub #214). The same
 * enemy anywhere else — the 流泪小子 of a bounty card (enemy_2034_sythef), a test spawn — keeps the official time.
 */
const DUCK_STEALTH_RESTORE = 1;

/** Splash radius (中点判定 around the target) of 烹泉 / 沏虹's attack (PRTS 天赋 "普通攻击对目标对及目标周围半径1.0范围内的所有
 *  我方单位造成法术普通伤害（无视迷彩，不可对空）") and of 集团军重型火炮's shell (PRTS "对目标半径1.0范围内的所有我方单位造成攻击力
 *  100%的物理伤害（此弹道会强制击中主目标，碰撞无视迷彩，不可对空）"). */
const TEA_SPLASH_RADIUS = 1, SHELL_SPLASH_RADIUS = 1;

/** Every Nth attack for "数次攻击后" abilities without an SP cost in the data [ASSUMED]; with a cost N = spCost + 1
 *  (official 粉碎攻坚手 text for spCost 2: "攻击2次后，下一次攻击" ⇒ 3rd; 码头水手 / 澪 / 清扫小队 spCost 3 ⇒ 4th). */
const NTH_ATTACK = 3;

export const nthOf = (s) => (s && s.sp > 0 ? s.sp + 1 : NTH_ATTACK);

// ---------------------------------------------------------------------------------------------------------------
// per-battle state + installation

const STATE = new WeakMap();

function stOf(b) {
  let st = STATE.get(b);
  if (!st) { st = { lpLoss: 0, freedAll: false, deathWatch: new Set() }; STATE.set(b, st); }
  return st;
}

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
  // `slot`: the skill's index in its data record's skills[] (data/enemies.json — the order the client resolves a
  // ['cast', id, slot] event's prefabKey by: castSlot); an override's skill keeps the slot of its prefabKey there
  const base = (e.def && Array.isArray(e.def.skills)) ? e.def.skills : [];
  const list = ov && Array.isArray(ov.skills) ? ov.skills : base;
  list.forEach((s, i) => {
    if (!s || s.prefabKey == null) return;
    const at = base.findIndex((x) => x && x.prefabKey === s.prefabKey);
    sk[s.prefabKey] = { cd: num(s.cooldown, 0), icd: num(s.initCooldown, 0), sp: num(s.spCost, 0), pr: num(s.priority, 0), bb: s.bb || {}, bs: s.bbStr || {}, slot: at >= 0 ? at : i };
  });
  e.mem.ab = { key, t, tS, sk, list: [], times: null, atkType: null, immune: null, origMaxHp: e.base.maxHp };
  return e.mem.ab;
}

/** Native ordinary-priority phys/arts count shield; repeated grants keep the held instance and stronger count. */
export function grantHitShield(battle, enemy, count) {
  if (!Number.isFinite(count) || !(count > 0)) return null;
  const key = 'ab:hitShield';
  const held = enemy.findBuff(key);
  if (held) {
    held.shieldHits = Math.max(held.shieldHits, count);
    enemy.markDirty();
    return held;
  }
  return battle.addBuff(enemy, { key, shieldHits: count, shieldType: ['phys', 'arts'],
    onRemove({ buff }) {
      if (!(buff.shieldHits > 0)) battle.fx('shieldBreak', { x: enemy.x, y: enemy.y, id: enemy.id });
    } });
}

/**
 * A display-only client event: enemy `e` uses its skill `s` (an `ab.sk` entry) — ['cast', id, slot] with the slot of
 * its data record's skills[] (`s.slot`) and, when the skill's blackboard has one, its `duration` (render/app.js: the
 * slot's skill clip, render/vfx/skillfx.js: that skill's official effects for the window). `turnClip` (s, ≥ 0): an
 * attack-class skill cast in the attack's turn (enemies.js attackTurnSkill) — ['cast', id, slot, dur, clip], the
 * length of its official clip, 0 when its ability names none: the client plays that clip (or the attack clip) in
 * place of the attack (render/units.js UnitView.onCast; DESIGN §35.57). No gameplay effect: no state, no random draw
 * (DESIGN §8.2; golden counts the event, nothing else moves).
 */
export function castSlot(b, e, s, turnClip = null) {
  if (!b || !e || !s || !Number.isInteger(s.slot)) return;
  const d = s.bb && typeof s.bb.duration === 'number' && s.bb.duration > 0 ? Math.round(s.bb.duration * 100) / 100 : 0;
  if (turnClip != null) b._ev(['cast', e.id, s.slot, d, Math.round(Math.max(0, turnClip) * 1000) / 1000]);
  else b._ev(d > 0 ? ['cast', e.id, s.slot, d] : ['cast', e.id, s.slot]);
}

/**
 * The attack-class skills of the non-leader enemies and bounty leaders that run on a cooldown (the boss records' leaders
 * and parts: bosses.js ATTACK_SKILL_CLIP; DESIGN §35.29 / §35.52): enemy key → skill prefabKey → the length in s of the
 * clip its official ability plays (fx/index.json units.<key>.skills.<prefabKey>.abilities[].animKey → data/assets.json
 * enemies.<key>.spine.animations), 0 when the ability names no clip. The class of each official ability (from the
 * client's `battle/enm_pfb_*.ab`): 重弩突袭者 `CrossAttack` RangedAttack; 萨卡兹王庭军精锐术师 `DeathEye` an AbilitySequenceGroup
 * of two RangedAttacks [ASSUMED: a group of attacks counts as one]; 假想敌：黑云 `FireWeapon` an AbilitySequenceGroup with
 * a MultiRangedAttack (Skill_2); 高准度伦蒂尼姆城防自行炮 `Cannon`, W `C4`, 凋零骑士 `TripleAttack`, 迷路的巨像 `StunAttack`,
 * 陷落雪祀 `ChainBuff` RangedAttack (Skill); 鼠王 `DriftSand` / `SandStorm` RangedAttack (Skill_1 / Skill_2); 腐败骑士
 * `ChargeAttack`, “自在” `ShieldBurst` / `ShieldBurstReborn`, 扎罗 `FearCage` MeleeAttack (no clip); “自在” `CrossAttack`
 * RangedAttackWithExtraActions (Skill_01_02); 锏 `CircleAttack` MeleeAttack (A_Skill2) / `CircleAttack2` MultiMeleeAttack
 * (B_Skill2); 节日爵士乐手 `fire` RangedAttack (no clip). Each one takes the attack's turn (enemies.js attackTurnSkill —
 * PRTS 「大多数技能自动触发会占用攻击间隔」) and its cooldown counts from its clip's end. Not here: 暴鸰's `boomb` (its one
 * bomb is its attack: no normal attack to share a turn with) and the SP attacks (粉碎攻坚手, 澪, 杰斯顿 …: the attack itself).
 */
export const ENEMY_ATTACK_SKILL_CLIP = Object.freeze({
  enemy_1404_msnip: { CrossAttack: 0 },
  enemy_1275_dwlock_2: { DeathEye: 0 },
  enemy_9009_acfort: { FireWeapon: 2 },
  enemy_1273_stmgun_2: { Cannon: 10 },
  enemy_1504_cqbw: { C4: 4.8 },
  enemy_1509_mousek: { DriftSand: 2.333, SandStorm: 1.333 },
  enemy_1513_dekght: { ChargeAttack: 0 },
  enemy_1513_dekght_2: { TripleAttack: 1.667 },
  enemy_2003_rockman: { StunAttack: 2.333 },
  enemy_2050_smsha: { ChainBuff: 1.667 },
  enemy_1517_xi: { CrossAttack: 1.333, ShieldBurst: 0, ShieldBurstReborn: 0 },
  enemy_1525_blkswb: { CircleAttack: 2.067, CircleAttack2: 2.067 },
  enemy_1535_wlfmster: { FearCage: 0 },
  enemy_10034_cnvsax: { fire: 0 },
});

/**
 * The attack-turn fields (`atk`, `clip`, `own`) of skill `prefabKey` of enemy key `key` (ENEMY_ATTACK_SKILL_CLIP), {} when
 * it is no attack-class skill. `own` (default true): its trigger is a selector of its own (`cond`), so it also takes a
 * ready attack's turn with no swing (enemies.js onTick); false when the trigger is the attack's target (its blocker).
 */
export function attackSkillOf(key, prefabKey, own = true) {
  const clip = ENEMY_ATTACK_SKILL_CLIP[key]?.[prefabKey];
  return clip == null ? {} : { atk: true, clip, own };
}

/** Attach abilities to an enemy (calls their spawn()). */
export function attach(b, e, list) {
  const ab = abOf(b, e);
  for (const a of list) {
    if (!a) continue;
    if (a.cd != null) a.left = num(a.left, num(a.icd, 0));
    if (a.atk && a.own) ab.ownTurn = true;   // enemies.js onTick: a turn without a swing (attackTurnSkill ownOnly)
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

/**
 * Is enemy `e` in its 失衡 (UNBALANCE) state now (battle/displacement.js _unbalance; the 1e-9 keeps a float-summed
 * end — 35/30 s — on its frame)? PRTS 异常效果图鉴/失衡免疫: 「失衡期间无法自主移动、发动攻击、使用技能」 — content skills
 * (canCast), blinks and scripted moves wait for its end.
 */
export function unbalancedNow(b, e) { return !!(b && e && b.time < e.unbalanceUntil - 1e-9); }

/** Can enemy `e` use a skill now: alive, on the field, not stunned, not silenced (`sil`), not in its 失衡 state (`b` given). */
export function canCast(e, sil, b = null) { return e.alive && !e.hidden && !e.s.flags.stun && !(sil && e.s.flags.silence) && !unbalancedNow(b, e); }

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
 * airborne 起飞 ally, which a ground enemy's damage otherwise skips (attack/helpers.js liftoffEvades, targeting.js evadesGround).
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
export function zone(b, { x, y, r, life, iv = 1, kind = 'zone', tick, pick = null, id = null }) {
  // `id` is the zone's source, display only (the client's effect binding). The golden digest counts the fx kind, not this field.
  b.fx('zone', { x, y, r, dur: life, kind, ...(id != null ? { id } : {}) });
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
  const d = hypot(dx, dy);
  if (d <= dist + 1e-9) { u.x = tx; u.y = ty; return true; }
  u.x += (dx / d) * dist;
  u.y += (dy / d) * dist;
  return false;
}

/** Set a 频次 unit's hits (maxHp := hits, full): `n` rounded to a whole count, at least 1. */
export function setHits(e, n) {
  const h = Math.max(1, Math.round(n));
  e.base.maxHp = h;
  e.markDirty();
  void e.s;
  e.hp = h;
}

const HIT_COUNT_KEY = 'ab:hitCount';

/** 频次 on/off: every damage instance removes exactly 1 HP (engine flag; `artsOnly` = 茶器: only arts and true instances remove 1, phys and 元素伤害 remove 0 — DESIGN §35.32, PRTS 青瓷茶器). */
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

/** Timed buff on each unit (same key never stacks: aura semantics). */
function auraBuff(b, u, key, iv, mods, flags = null, visible = false) {
  b.addBuff(u, { key, duration: iv + 0.1, refresh: 'replace', mods, flags, visible });
}

/** Mark an ally/enemy ability as watching every death on the field. */
function watchDeaths(b, e) { stOf(b).deathWatch.add(e); }

const tileOf = (u) => [Math.round(u.y), Math.round(u.x)];

const onTerrain = (b, u, terrain) => { const [r, c] = tileOf(u); return b.grid.tile(r, c).terrain === terrain; };

// used by the other enemy modules (content/enemies.js and content/enemies/*.js)
export {
  BOOM_RADIUS, POLLUTION_INTERVAL, STEALTH_RESTORE_BY_KEY, DUCK_STEALTH_RESTORE, TEA_SPLASH_RADIUS, SHELL_SPLASH_RADIUS, stOf, safe, dispatch,
  num, auraBuff, watchDeaths, onTerrain,
};
