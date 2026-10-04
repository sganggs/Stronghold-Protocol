// server/sim/content/tokens.js — summons / tokens (data/tokens.json), the 炎 bond summon “炎佑” and band map characters.
//
// Kits: `kits[tokenId] = (bb, raw, def) => Kit` (content/index.js resolves token kits here). bb = the token's skill
// blackboard of the owner-level variant, raw = the tokens.json record, def = normalised token def (variant merged:
// stats / talents / trait / skill at the owner's phase — a golden owner gets the `_b` variant).
// Every tokenId of data/tokens.json has a kit, so `battle.spawnToken(owner, tokenId, r, c)` works with data defaults
// even when the summoner's kit passes no options:
//   医疗探机      heal profile (data), untargetable, self-destructs after its withdraw skill time (10 s)
//   诅咒娃娃      no attack, aura: enemies in its range ATK/DEF + bb.atk/bb.def (−25 %/−30 %), 15 s (skill duration);
//                 leaves when 巫恋 leaves (PRTS 备注) — the drone stays when 赫默 leaves (PRTS 医疗探机 备注)
//   沙之碑        on appear: owner ATK × atk_scale arts + stun (skill range 3×3), blocks 3 (no attack), talent duration 20 s
//   战术装备      on appear: stun around (bb.stun), blocked enemies DEF + talent def (−160), talent duration 25 s
//   “小自在”      arts melee blocker, talent duration 25 s; kills emit `summonKill` (夕's 化境 is the 夕 kit's job)
//   斯卡蒂的海嗣  untargetable range extension of 浊心斯卡蒂: heals allies in its range (owner ATK × trait ratio /s);
//                 while the owner's skill runs: owner ATK × atk_scale true dmg/s to enemies + 鼓舞 owner ATK × bb.atk;
//                 talent duration 25/30 s, then redeploys after respawnTime (30/25 s, DP cost from data)
//   “耀阳”        on appear: owner ATK × atk_scale true + stun in the skill grid (+1 hit if the previously deployed
//                 operator is 卡西米尔); golden trait ×atk_scale vs blocked enemies; lasts while the owner's skill runs
//   纸偶          on appear: token ATK × damage_scale arts to the 8 surrounding tiles; does not block (data)
//   狼群          “狼影” 2→3 (+1 per talent interval): block = shadows, hits = shadows; fatal with >1 shadow ⇒ lose one,
//                 full HP; its and 伺夜's attacks ignore def_penetrate_fixed DEF of enemies it blocks; while 伺夜's
//                 timed skill runs every attack damage instance (each bite) of the pack / 伺夜 on an enemy it blocks
//                 adds 伺夜 ATK × bb scale arts; module: ×damage_scale damage from enemies it blocks; is its owner's
//                 tactician 援军 (1.5× trait), leaves with it; respawns respawnTime s after being killed
//   流形          copy skill (SP from data, golden +sp; starts only when an operator can be copied, else waits ready):
//                 copies scale × HP/ATK/DEF/RES, block, BAT/ASPD, range and the damage type of the nearest allied
//                 operator; no attack before its copy; ranged copy splits every N attacks (clone lasts the talent
//                 interval), melee copy steals ATK/DEF per hit (capped); killed ⇒ back uncopied after the talent interval
//                 (never while 缪尔赛思 is down: her redeploy brings it back; split clones are never her 援军)
//   香槟炸弹      untargetable trap: the first ground enemy touching its tile takes owner ATK × atk_scale phys (+1 hit
//                 after duration_switch s on the field) and sluggish; the bomb is used up ('expired', never a knock-out;
//                 its blast fx carries `consumed: true` so clients play the explosion, not a death sound)
//   从不混淆的方向 untargetable marker; when the owner's skill ends it vanishes and the owner returns to its tile
//   黄金盟誓      attacks deal true damage (trait); lasts while the owner's skill runs; 维娜 S3 places one on every
//                 free deployable tile around her (kits/tier6.js) — no per-owner deploy limit (SKILL_SUMMON_UNCAPPED)
//   防护单元      untargetable, invulnerable device placed by the player (a hand piece, user playtest #6): shield =
//                 凯瑟琳 max HP × max_shield_ratio on the operator in its range (range 1-1: the tile it faces; effects do
//                 not stack — `cathy:shield`, read by 凯瑟琳 S1 岁月锻打), in full whenever it takes a new operator,
//                 refilled by shield_ratio_each_trigger /s when the target was not hit for `interval` s (always while
//                 凯瑟琳's timed skill runs, owner bb overwrite_ratio)
//   投递坐标 / 风雪之眼 / 保护目标  inert pieces (no attack; 风雪之眼 untargetable) — their effects belong to the owner kit
//   炎佑 (enemy_9012_acloon)  flying ally: flies after the highest-aggro enemy of the field and hovers over it, stays
//                 put when there is none; 3-target arts + burn on every hit, 元素脆弱 aura, 祛恶之焰 channel (yanyouKit)
//   预备干员-医疗 / Touch (band map characters)  generic kit / 恳切福音 kit
// Common rules: deploy limit per owner for tokens running these kits (data `deployLimit`; the oldest is withdrawn —
// except SKILL_SUMMON_UNCAPPED, whose data limit is the hand count the skill does not obey),
// `summonKill` hook ({ token, owner, victim }) whenever a token kills, lifetimes never outlive a shorter
// `opts.duration`; summon tiles skip `battle.isReservedTile` (home tiles of pieces not deployed yet).
// Managed mode: when the summoner runs a hand-authored kit (content/kits), the owner-coupled parts of its summon
// (海嗣 pulses/lifetime/respawn, 纸偶 burst, 流形 copy/steal/split/respawn/guard, 狼群 S3 bonus & DEF ignore) are
// left to that kit; kits that pass `opts.kit` to spawnToken replace these token kits entirely.
// Tacticians (伺夜/缪尔赛思): the player's board 狼群/流形 piece deploys right before its owner so the owner's kit
// sees its 援军 standing; with the engine's default reinforcement the talent token replaces the generic 援军. Without
// a board piece the token takes a tactical point: a free walkable tile of the owner's range on an enemy ground path
// first (`tacticalPoint`), then the one nearest to the owner.
// Placed summons (PRTS 卫戍协议/帮助 §作战阶段; user playtest #6): every board summon piece marks the tile its summon
// deploys on. The talent ones the owner holds from the start (狼群, 海嗣, 流形, 凯瑟琳's devices) deploy with the
// board, after the operators. A skill's summon (赫默's 医疗探机, 巫恋's 诅咒娃娃: "获得一个…") also deploys once with the
// board, for free and ignoring the holding ("在赫默的技能未开启前未持有该召唤物，但作战开始时无视持有状态自动部署1个";
// settled by the user after playtest #6 — shared/constants.js SKILL_SUMMON_START_DEPLOY, re-exported here; false =
// the playtest #4 reading, `deferDeploy`: off the field until the skill). Then it is docked on its tile
// (`dockSkillSummons`; the tile stays reserved) and takes the field there each time the owner's skill gives one
// (`releaseSkillSummon`; PRTS "若战场区初始部署有召唤物，若召唤物在战斗期间退场，将在满足条件后立即原地再部署1个"): one
// in stock at most ("最多可库存1个"), after the token's redeploy time once it left, free [ASSUMED: no DP], never while
// its owner is off the field — a stocked one deploys as soon as the owner is back. A skill's summon or a device
// (凯瑟琳) that was not placed never appears (the hidden 待部署区 deploys nothing by itself), nor does 海嗣; only the
// tacticians' 狼群 / 流形 still come as 援军 on a tactical point (above).
// Fallbacks (only while the summoner still uses the generic kit — a hand-authored kit takes over): skill summons
// (赫默/巫恋 through their placed pieces as above; 蜜蜡/风丸/维娜/耀骑士临光/迷迭香 S3 on a tile of their own) spawn at
// skill start — also under a hand-authored kit when only the SELECTED skill runs the generic spec (a non-default skill
// the kit has no `skills` entry for) — and 夕 spawns 小自在 on its first attack.
// Operator loadouts (DESIGN §16): variants, `sources` and counts are those of the owner's selected skill / module
// (variantOf / tokenSources: getToken(id, owner.defId, owner.def.loadout)); a skill summon runs only when that skill
// makes the token (Battle.spawnToken also refuses summons the owner's loadout does not produce).
//
// Exports for other content: spawnYanyou, spawnMapChar, findSummonTile, summonToken, tacticalPoint, wolfShadows,
// releaseSkillSummon, SKILL_SUMMON_START_DEPLOY, CAT_SHIELD_KEY, TOKEN_IDS.

import { COLS, ROWS, MOVE_SCALE } from '../constants.js';
import { absoluteRangeKeys, sortEnemyTargets, canTargetEnemy } from '../targeting.js';
import { bodyInKeys, bodyOnTile } from '../body.js';
import { hasHp } from '../damage.js';
import { genericKit } from './generic.js';
import { normDir, localOrder } from '../dir.js';
import { SKILL_SUMMON_START_DEPLOY } from '../../../shared/constants.js';

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d));
const GRID_3X3 = Object.freeze([[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]]);
const GRID_PLUS = Object.freeze([[1, 0], [0, -1], [0, 0], [0, 1], [-1, 0]]);
/** Buff key of the 爬行号·防护单元 shield on an operator (凯瑟琳 S1 岁月锻打 buffs the operators holding one). */
export const CAT_SHIELD_KEY = 'cathy:shield';

export const TOKEN_IDS = Object.freeze({
  healDrone: 'token_10000_silent_healrb',
  curseDoll: 'token_10006_vodfox_doll',
  obelisk: 'token_10011_beewax_oblisk',
  rosmonGear: 'token_10012_rosmon_shield',
  duskDragon: 'token_10015_dusk_drgn',
  seaborn: 'token_10017_skadi2_dedant',
  radiantSword: 'token_10019_nearl2_sword',
  paperDoll: 'token_10022_kazema_shadow',
  wolfPack: 'token_10028_vigil_wolf',
  manifold: 'token_10030_mlyss_wtrman',
  champagne: 'token_10031_swire2_gdtrap',
  ulpiaMarker: 'token_10039_ulpia_block',
  goldenOath: 'token_10040_siege2_vlion',
  catShield: 'token_10041_cathy_catsld',
  deliveryTarget: 'token_10056_angel2_target',
  eagle1: 'token_10057_svash2_eagle1',
  eagle2: 'token_10057_svash2_eagle2',
  eagle3: 'token_10057_svash2_eagle3',
  iceTarget: 'token_10058_sbell2_icetgt',
  yanyou: 'enemy_9012_acloon',
  reserveMedic: 'char_605_cmedic',
  touch: 'char_613_acmedc',
});

// ---------------------------------------------------------------------------------------------------------------
// battle state & small helpers

const STATE = new WeakMap();
function stateOf(battle) {
  let s = STATE.get(battle);
  if (!s) { s = { lastOp: new Map(), catTargets: new Map() }; STATE.set(battle, s); }
  return s;
}

/**
 * A tokens.json owner variant with the owner's selected skill / module applied (DESIGN §16; the merge of simdata
 * getToken): `bySkill[skillIndex]` (token skill, count, sources) and `byModule[moduleId]` (both hold non-default
 * choices only). `lo` = the owner def's `loadout`.
 */
function withLoadout(v, lo) {
  if (!v || !lo || typeof lo !== 'object') return v;
  let out = v;
  if (Number.isInteger(lo.skillIndex) && v.bySkill && v.bySkill[lo.skillIndex]) out = { ...out, ...v.bySkill[lo.skillIndex] };
  if (typeof lo.moduleId === 'string' && v.byModule && v.byModule[lo.moduleId]) out = { ...out, ...v.byModule[lo.moduleId] };
  return out;
}

/** The owner's own variant of a token record (chess id, else its normal `_a` sibling) with its loadout; null if none. */
function ownVariant(raw, owner) {
  const vs = raw?.variants;
  const oid = owner?.defId;
  if (!vs || typeof vs !== 'object' || !oid) return null;
  const v = vs[oid] ?? vs[String(oid).replace(/_b$/, '_a')] ?? null;
  return v ? withLoadout(v, owner.def?.loadout) : null;
}

/**
 * Owner-level tokens.json variant of a token unit for its owner's selected skill / module (the def already merges it;
 * this reads fields normaliseToken drops). Without an own variant of the owner: the record's first variant.
 */
function variantOf(unit) {
  const vs = unit.def?.raw?.variants;
  if (!vs || typeof vs !== 'object') return null;
  return ownVariant(unit.def.raw, unit.ownerUnit) ?? Object.values(vs)[0] ?? null;
}

/** First talent blackboard of `def` holding `key`. */
function talentWith(def, key) {
  for (const t of def?.talents ?? []) if (t && t.bb && t.bb[key] != null) return t;
  return null;
}
const talentBb = (def, key) => talentWith(def, key)?.bb ?? {};

/** Summoner ATK ("相当于攻击力…%" of a summon skill is the summoner's); the token's own ATK without an owner. */
const ownerAtk = (u) => (u.ownerUnit && u.ownerUnit.s ? u.ownerUnit.s.atk : u.s.atk);
const ownerOf = (u) => (u.ownerUnit && u.ownerUnit.side === 'ally' ? u.ownerUnit : null);
/**
 * The summoner runs a hand-authored kit (content/kits): owner-coupled effects of its summon (auras driven by the
 * owner, copies, respawns, owner-skill bonuses) are that kit's job — the token kit keeps only its intrinsic rules.
 * Evaluated lazily: board tokens may be set up before their owner's kit is resolved.
 */
const managed = (u) => !!(u.ownerUnit && u.ownerUnit.kit && u.ownerUnit.kit.generic !== true);
const baseKey = (id) => String(id ?? '').replace(/_[ab]$/, '');

function onDeploy(battle, unit, fn, priority = 0) {
  battle.on('deploy', (ctx) => { if (ctx.unit === unit) fn(ctx); }, { owner: unit, priority });
}

function untargetable(battle, unit) {
  battle.addBuff(unit, { key: 'trait:untargetable', flags: { untargetable: true }, persist: true, allowDead: true });
}

/** Withdraw the token `seconds` after this deployment (the same deployment only). */
function scheduleLifetime(battle, unit, seconds) {
  const s = num(seconds, 0);
  if (!(s > 0)) return;
  const seq = unit.deploySeq;
  unit.mem.expiresAt = battle.time + s;
  battle.after(s, () => { if (unit.alive && unit.deploySeq === seq) battle.retreat(unit, { reason: 'expired', permanent: true }); }, { owner: unit });
}

/** Visible enemies whose body is on any of the absolute tile keys (sim/body.js); auras / bursts hit stealthed ones. */
function enemiesOnKeys(battle, keys) {
  const set = keys instanceof Set ? keys : new Set(keys);
  const out = [];
  for (const e of battle.enemies) {
    if (!e.alive || e.hidden) continue;
    if (bodyInKeys(e, set)) out.push(e);
  }
  return out;
}

/**
 * Appear burst: damage (optional) + status (optional) on the enemies of `grid` around the token. Returns victims. Air
 * units (Unit.isFlying) are hit too **[ASSUMED]**: PRTS has no 对空 note on any of them — 沙之碑 (蜜蜡 S2), 迷迭香的战术装备
 * ("对自身攻击范围内的敌人造成晕眩"), “耀阳”, 纸偶 (风丸 折纸生花) — so a stun here also drops a hovering 掠海漂移体.
 */
function burst(battle, unit, { grid, amount = 0, type = 'phys', stun = 0, hits = 1, source = unit, fx = 'summonBurst' }) {
  const keys = absoluteRangeKeys(grid || GRID_3X3, unit.tileR, unit.tileC, unit.dir, 0);
  const victims = enemiesOnKeys(battle, keys);
  for (const e of victims) {
    for (let i = 0; i < hits && e.alive && amount > 0; i++) battle.dealDamage(source, e, { amount, type, isSkill: true, canDodge: false, tags: ['summon', 'burst'] });
    if (stun > 0 && e.alive) battle.applyStatus(e, 'stun', { duration: stun, source });
  }
  battle.fx(fx, { x: unit.x, y: unit.y, id: unit.id, token: unit.defId, n: victims.length });
  return victims;
}

/**
 * Redeploy a placeable token after it was killed (and optionally after it expired), like operators: `delay` s later,
 * on its own tile, paying its DP cost. Tokens are otherwise removed for good by the engine — the piece is kept
 * (`removed = false`) so its hooks survive and `battle.redeploy` accepts it.
 */
function enableRespawn(battle, unit, { delay, onExpire = false, unlessManaged = false, requireOwner = false }) {
  battle.on('death', (ctx) => {
    if (ctx.unit !== unit || battle.finished || unit.mem.isClone || (unlessManaged && managed(unit))) return;
    if (unit.mem.replaced) { unit.mem.replaced = false; return; }
    const r = ctx.reason;
    if (!(r === 'killed' || (onExpire && r === 'expired'))) return;
    const d = num(typeof delay === 'function' ? delay(unit) : delay, -1);
    if (!(d >= 0)) return;
    unit.removed = false;
    unit.mem.respawnAt = battle.time + d;
    battle.every(0.25, (b, sched) => {
      if (unit.alive || unit.removed) { sched.cancel(); return; }
      // a tactician's 援军 never comes back without its tactician (its redeploy brings the piece back, see
      // ensureReinforcement)
      if ((typeof requireOwner === 'function' ? requireOwner() : requireOwner) && !(unit.ownerUnit && unit.ownerUnit.alive)) { sched.cancel(); return; }
      if (b.time + 1e-9 < unit.mem.respawnAt) return;
      if (b.redeploy(unit, { free: false })) sched.cancel();
    }, { owner: unit });
  }, { owner: unit, priority: -10 });
}

/** Lifetime bound to the owner's running timed skill (the token vanishes when that activation ends). */
function bindToOwnerSkill(battle, unit) {
  onDeploy(battle, unit, () => {
    const o = ownerOf(unit);
    unit.mem.boundActivation = o && o.skill && o.skill.active && o.skill.isTimed ? o.skill.activations : null;
  });
  battle.on('skillEnd', (ctx) => {
    if (!unit.alive || ctx.unit !== unit.ownerUnit || unit.mem.boundActivation == null) return;
    if (ctx.skill.activations === unit.mem.boundActivation) battle.retreat(unit, { reason: 'expired', permanent: true });
  }, { owner: unit });
}

// ---------------------------------------------------------------------------------------------------------------
// placed skill summons (user playtest #6; see the header "Placed summons")

// SKILL_SUMMON_START_DEPLOY (shared/constants.js — also read by the summon card's hint): true = the PRTS reading the
// user settled after playtest #6, the placed piece of a skill's summon also deploys once, for free, at the battle
// start; false = the playtest #4 reading (it comes with the skill). Re-exported for content and tests.
export { SKILL_SUMMON_START_DEPLOY };
/** Seconds between two tries of a docked piece whose tile is busy / whose redeploy time is still running. */
const DOCK_RETRY = 0.5;

/**
 * How the owner's loadout makes a board summon piece of a manually deployable summon (owner-loadout `sources`):
 * 'skill' (only its skill makes it), 'none' (the owner's skill / module makes none — 赫默 on S1 with a drone piece; the
 * match never hands such a card out), else null (a talent summon, or not a placed hand piece).
 */
function pieceSource(battle, u) {
  if (!u || u.kind !== 'token' || u.uid == null || !u.ownerUnit || u.ownerUnit.kind !== 'op') return null;
  if (u.def?.raw?.placeable !== true) return null;
  const src = tokenSources(battle, u.defId, u.ownerUnit);
  if (src.includes('talent')) return null;
  if (src.includes('skill')) return 'skill';
  return src.length ? 'none' : null;
}

/**
 * Dock the board pieces of skill summons (before the start): off the field with the board (`deferDeploy`, unless
 * SKILL_SUMMON_START_DEPLOY), and whenever one leaves (10 s drone, 15 s doll) it stays its tile's piece — not removed,
 * its hooks kept, Battle.isReservedTile — ready again after the token's redeploy time (data respawnTime, 5 s). A piece
 * its owner's loadout does not make never deploys.
 */
function dockSkillSummons(battle) {
  for (const u of battle.allyUnits) {
    const how = pieceSource(battle, u);
    if (how === 'none') { u.deferDeploy = true; continue; }
    if (how !== 'skill') continue;
    u.mem.docked = true;
    u.mem.readyAt = -Infinity;
    if (!SKILL_SUMMON_START_DEPLOY) u.deferDeploy = true;
    battle.on('death', (ctx) => {
      if (ctx.unit !== u || battle.finished) return;
      u.removed = false;
      u.mem.readyAt = battle.time + Math.max(0, num(u.base.respawnTime, 0));
      deployDocked(battle, u);
    }, { owner: u, priority: -10 });
    // the owner back on the field with one in stock: the condition of the PRTS redeploy is met at once
    battle.on('deploy', (ctx) => {
      if (ctx.unit === u.ownerUnit && !battle.finished) deployDocked(battle, u);
    }, { owner: u });
  }
}

/**
 * Deploy a docked piece on its tile when its owner holds one and it is ready; retried while it waits. Not while the
 * owner is off the field [ASSUMED: as in the base game, a summon is deployed only while its owner stands] — the stock
 * stays, and the piece deploys as soon as the owner is back (its `deploy` hook, dockSkillSummons).
 */
function deployDocked(battle, u) {
  const stock = u.ownerUnit?.mem.summonStock;
  if (!stock || !(stock[u.defId] > 0) || u.alive || u.removed || battle.finished || !u.ownerUnit.alive) return false;
  const wait = u.mem.readyAt - battle.time;
  if (wait > 1e-9 || !battle.redeploy(u, { free: true })) {
    if (!u.mem.dockRetry) {
      u.mem.dockRetry = true;
      battle.after(Math.max(wait, DOCK_RETRY), () => { u.mem.dockRetry = false; deployDocked(battle, u); }, { owner: u });
    }
    return false;
  }
  stock[u.defId]--;
  battle.fx('summon', { x: u.x, y: u.y, id: u.id, token: u.defId });
  return true;
}

/**
 * The owner's skill gives it one `tokenId` ("获得一个医疗无人机"; at most `cap` in stock — "最多可库存1个"): its placed
 * piece takes the field on its own tile now, or as soon as it is ready (the previous one still up / just gone).
 * Returns the piece deployed now, else null — also when the player placed none (the summon then never appears).
 */
export function releaseSkillSummon(battle, owner, tokenId, { cap = 1 } = {}) {
  if (!owner) return null;
  const pieces = battle.allyUnits.filter((t) => t.kind === 'token' && t.defId === tokenId && t.ownerUnit === owner && t.mem.docked);
  if (!pieces.length) return null;
  const stock = owner.mem.summonStock || (owner.mem.summonStock = {});
  stock[tokenId] = Math.min(Math.max(1, Math.floor(num(cap, 1))), (stock[tokenId] || 0) + 1);
  for (const p of pieces) if (deployDocked(battle, p)) return p;
  return null;
}

function inRectTile(battle, r, c) { return Number.isInteger(r) && Number.isInteger(c) && battle.grid.inRect(r, c); }

/**
 * A tile a summon may take: inside the field, nobody on it, and not the home tile of a board unit that has not
 * deployed yet / waits to redeploy (the initial deployment runs one unit after another, a summon must not steal a later
 * unit's tile).
 */
export function tileFree(battle, r, c) {
  return inRectTile(battle, r, c) && !battle.isReservedTile(r, c);
}

function mostAdvancedEnemy(battle) {
  let best = null, bd = Infinity;
  for (const e of battle.enemies) {
    if (!e.alive || e.hidden) continue;
    const d = battle.remainingDistance(e);
    if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && best && e.spawnSeq < best.spawnSeq)) { bd = d; best = e; }
  }
  return best;
}

function countNear(list, r, c, rad = 1) {
  let n = 0;
  for (const u of list) if (Math.abs(Math.round(u.y) - r) <= rad && Math.abs(Math.round(u.x) - c) <= rad) n++;
  return n;
}

/**
 * Pick a summon tile for `owner` (null when none). placement:
 *   'ally'     — any standable tile in the owner's range covering the most injured allies (a healing skill summon that
 *                is no hand piece; 医疗探机 itself is placed by the player — releaseSkillSummon)
 *   'enemy'    — any standable tile in range covering the most enemies (a debuff skill summon that is no hand piece;
 *                诅咒娃娃 itself is placed by the player)
 *   'melee'    — melee-deployable tile in range, on the enemy path and near the enemies first (沙之碑)
 *   'adjacent' — melee-deployable tile among the 8 surrounding tiles (纸偶, 黄金盟誓)
 *   'plus'     — melee-deployable tile among the 4 neighbours (“耀阳”)
 *   'path'     — ground-passable standable tile in range nearest to the leading enemy (香槟炸弹)
 *   'near'     — any standable tile nearest to opts.at ({x,y}) inside the range (小自在)
 */
export function findSummonTile(battle, owner, placement = 'melee', opts = {}) {
  if (!owner || owner.tileR == null) return null;
  let keys;
  if (placement === 'adjacent') keys = absoluteRangeKeys(GRID_3X3, owner.tileR, owner.tileC, owner.dir, 0);
  else if (placement === 'plus') keys = absoluteRangeKeys(GRID_PLUS, owner.tileR, owner.tileC, owner.dir, 0);
  else if (opts.grid) keys = absoluteRangeKeys(opts.grid, owner.tileR, owner.tileC, owner.dir, 0);
  else keys = owner.rangeKeys || [];
  const melee = opts.melee ?? (placement === 'melee' || placement === 'adjacent' || placement === 'plus');
  const enemies = battle.enemies.filter((e) => e.alive && !e.hidden);
  const focus = opts.at ?? mostAdvancedEnemy(battle) ?? owner;
  // injured allies a heal could reach: never 孤立 (Battle.alliesFor) nor 禁疗 units (炎佑, the 禁疗 summons)
  const injured = placement === 'ally'
    ? battle.alliesFor(owner, owner.ownerId).filter((a) => a.hp < a.s.maxHp - 1e-6 && !(a.s.flags.noHeal || a.profile?.noHeal))
    : null;
  let best = null, bestS = null;
  for (const k of keys) {
    const r = (k / COLS) | 0, c = k % COLS;
    if (!tileFree(battle, r, c)) continue;
    if (!battle.grid.canStand(r, c, { ranged: !melee })) continue;
    const gp = battle.grid.groundPassable(r, c, true) ? 1 : 0;
    if (placement === 'path' && !gp) continue;
    let cover = 0;
    if (placement === 'enemy' || placement === 'melee') cover = countNear(enemies, r, c, 1);
    else if (placement === 'ally') cover = countNear(injured, r, c, 1);
    const d = placement === 'ally' ? Math.hypot(c - owner.x, r - owner.y) : Math.hypot(c - focus.x, r - focus.y);
    // last: the tile's offset in the owner's facing-RIGHT frame (for a RIGHT owner = the tile key order), so equal
    // candidates resolve the same way whichever direction the owner faces
    const [lr, lc] = localOrder(r - owner.tileR, c - owner.tileC, owner.dir);
    const s = [-cover, placement === 'ally' || placement === 'enemy' || placement === 'near' ? 0 : -gp, d, lr, lc];
    let less = !bestS;
    if (!less) for (let i = 0; i < s.length; i++) { if (s[i] < bestS[i] - 1e-9) { less = true; break; } if (s[i] > bestS[i] + 1e-9) break; }
    if (less) { best = [r, c]; bestS = s; }
  }
  return best;
}

/** Spawn `tokenId` for `owner` on a tile chosen by findSummonTile. Returns the token or null. */
export function summonToken(battle, owner, tokenId, placement = 'melee', opts = {}) {
  const tile = opts.tile ?? findSummonTile(battle, owner, placement, opts);
  if (!tile) return null;
  return battle.spawnToken(owner, tokenId, tile[0], tile[1], opts.spawn ?? {});
}

// ---------------------------------------------------------------------------------------------------------------
// token kits

const inert = ({ hideFromEnemies = false, block = null } = {}) => () => ({
  skill: null,
  trait: { noAttack: true },
  install(battle, unit) {
    if (hideFromEnemies) untargetable(battle, unit);
    if (block != null) battle.addBuff(unit, { key: 'token:block', persist: true, allowDead: true, mods: { blockCnt: block } });
  },
});

/** 医疗探机 (赫默 S2): heals nearby allies (data heal profile), self-destructs after the withdraw skill time. */
function healDrone() {
  return {
    skill: null,
    install(battle, unit) {
      const v = variantOf(unit);
      const sk = v?.skill ?? unit.def?.raw?.skill ?? null;
      let life = /^skcom_withdraw/.test(String(sk?.skillId ?? sk?.id ?? '')) ? num(sk.duration, 0) : 0;
      if (!(life > 0)) { const m = String(sk?.desc ?? sk?.description ?? '').match(/(\d+(?:\.\d+)?)秒后自动销毁/); if (m) life = +m[1]; }
      onDeploy(battle, unit, () => scheduleLifetime(battle, unit, life));
    },
  };
}

/** 诅咒娃娃 (巫恋 S2): ATK/DEF debuff aura on the enemies in its range; lasts its skill duration. */
function curseDoll(bb, raw, def) {
  const mods = {};
  if (num(bb.atk, 0) !== 0) mods.atkPct = num(bb.atk, 0);
  if (num(bb.def, 0) !== 0) mods.defPct = num(bb.def, 0);
  const life = num(def?.skill?.duration, 0);
  const AURA = 0.2;
  return {
    skill: {
      kind: 'passive',
      onStart({ unit }) { unit.mem.auraAcc = AURA; },
      onTick({ battle, unit, dt }) {
        unit.mem.auraAcc = (unit.mem.auraAcc ?? 0) + (dt ?? battle.dt);
        if (unit.mem.auraAcc < AURA - 1e-9) return;
        unit.mem.auraAcc = 0;
        for (const e of enemiesOnKeys(battle, unit.rangeKeySet || unit.rangeKeys || [])) {
          battle.addBuff(e, { key: 'token:curseDoll', duration: AURA + 0.15, refresh: 'extend', mods, source: unit });
        }
      },
    },
    trait: { noAttack: true },
    install(battle, unit) {
      onDeploy(battle, unit, () => scheduleLifetime(battle, unit, life));
      // PRTS 诅咒娃娃 备注: "巫恋退场时强制撤退场上的诅咒娃娃" (knocked out or withdrawn)
      battle.on('death', (ctx) => { if (ctx.unit === unit.ownerUnit && unit.alive) battle.retreat(unit, { reason: 'expired', permanent: true }); }, { owner: unit });
    },
  };
}

/** 沙之碑 (蜜蜡 S2): appear burst (owner ATK × atk_scale arts + stun, skill range), blocks 3, talent duration. */
function obelisk(bb, raw, def) {
  const grid = def?.skill?.rangeGrid ?? GRID_3X3;
  const life = num(talentBb(def, 'duration').duration, 0);
  return {
    skill: null,
    trait: { noAttack: true }, // a blocking pillar (the 蜜蜡 kit's obelisk does not attack either) [ASSUMED]
    install(battle, unit) {
      onDeploy(battle, unit, () => {
        burst(battle, unit, { grid, amount: ownerAtk(unit) * num(bb.atk_scale, 0), type: 'arts', stun: num(bb.stun, 0), source: unit });
        scheduleLifetime(battle, unit, life);
      });
    },
  };
}

/** 迷迭香的战术装备 (display-only for the pool's S2): appear stun, blocked enemies DEF + talent def, talent duration. */
function rosmonGear(bb, raw, def) {
  const t = talentBb(def, 'duration');
  const life = num(t.duration, 0);
  const defFlat = num(t.def, 0);
  return {
    skill: null,
    trait: { noAttack: true },
    install(battle, unit) {
      onDeploy(battle, unit, () => {
        burst(battle, unit, { grid: def?.skill?.rangeGrid ?? GRID_3X3, stun: num(bb.stun, 0), fx: 'summonStun' });
        scheduleLifetime(battle, unit, life);
      });
      if (defFlat !== 0) {
        battle.on('tick', () => {
          if (!unit.alive || !unit.blocking.length) return;
          for (const e of unit.blocking) if (e.alive) battle.addBuff(e, { key: 'token:rosmonGear', duration: 0.2, refresh: 'extend', mods: { defFlat }, source: unit });
        }, { owner: unit });
      }
    },
  };
}

/** “小自在” (夕 talent 点睛): arts melee blocker with a talent lifetime. */
function duskDragon(bb, raw, def) {
  const life = num(talentBb(def, 'duration').duration, 0);
  return {
    skill: null,
    install(battle, unit) {
      onDeploy(battle, unit, () => scheduleLifetime(battle, unit, unit.mem.lifeOverride ?? life));
    },
  };
}

/** 斯卡蒂的海嗣 (浊心斯卡蒂 talent 远古血亲): range extension of its owner (heal aura / S3 damage + 鼓舞). */
function seaborn(bb, raw, def) {
  const life = num(talentBb(def, 'duration').duration, 0);
  const healRatio = num(def?.traitBb?.['attack@atk_to_hp_recovery_ratio'], 0);
  const dmgScale = num(bb.atk_scale, 0);
  const inspire = num(bb.atk, 0);
  return {
    skill: null,
    trait: { noAttack: true },
    install(battle, unit) {
      onDeploy(battle, unit, () => { unit.mem.pulseAcc = 0; if (!managed(unit)) scheduleLifetime(battle, unit, life); });
      enableRespawn(battle, unit, { delay: (u) => u.base.respawnTime, onExpire: true, unlessManaged: true });
      battle.on('tick', ({ dt }) => {
        if (!unit.alive || !unit.deployed || !unit.canAct || managed(unit)) return;
        unit.mem.pulseAcc = (unit.mem.pulseAcc ?? 0) + dt;
        if (unit.mem.pulseAcc < 1 - 1e-9) return;
        unit.mem.pulseAcc -= 1;
        const o = ownerOf(unit);
        const atk = ownerAtk(unit);
        const keys = unit.rangeKeySet || new Set(unit.rangeKeys || []);
        const skillOn = !!(o && o.alive && o.skill && o.skill.active && o.skill.kind !== 'passive');
        if (skillOn) {
          for (const e of enemiesOnKeys(battle, keys)) battle.dealDamage(unit, e, { amount: atk * dmgScale, type: 'true', isSkill: true, canDodge: false, tags: ['seaborn'] });
          if (inspire > 0) {
            for (const a of battle.alliesInGrid(unit)) {
              if (a === unit || a === o) continue; // 自身不受鼓舞影响
              battle.addBuff(a, { key: `inspire:${o.id}`, duration: 1.25, refresh: 'replace', mods: { atkFlat: atk * inspire }, source: unit });
            }
          }
        } else if (healRatio > 0) {
          const ownerKeys = o && o.alive && o.deployed ? (o.rangeKeySet || new Set(o.rangeKeys || [])) : null;
          for (const a of battle.alliesInGrid(unit)) {
            if (a === unit || a.hp >= a.s.maxHp - 1e-6) continue;
            if (ownerKeys && ownerKeys.has(a.tileR * COLS + a.tileC)) continue; // the owner's own aura already heals it
            battle.heal(unit, a, atk * healRatio);
          }
        }
      }, { owner: unit });
    },
  };
}

/**
 * “耀阳” (耀骑士临光 S3): appear burst (true, owner ATK × atk_scale, stun — air units too [ASSUMED: no 对空 note on PRTS
 * “耀阳”]), blocks 2, lasts while the owner's skill runs.
 */
function radiantSword(bb, raw, def) {
  const grid = def?.skill?.rangeGrid ?? GRID_PLUS;
  // 精锐 owner's module (isToken part): "攻击被阻挡的敌人时攻击力提升至115%" — any blocked enemy
  const blockedScale = num(def?.traitBb?.atk_scale, 1);
  return {
    skill: null,
    trait: blockedScale !== 1 ? { dmgMul: (b, u, t) => (t && t.blockedBy ? blockedScale : 1) } : {},
    install(battle, unit) {
      bindToOwnerSkill(battle, unit);
      onDeploy(battle, unit, () => {
        const last = stateOf(battle).lastOp.get(unit.ownerId);
        const kaz = !!(last && (last.def?.bonds || []).includes('kazimierzShip'));
        burst(battle, unit, { grid, amount: ownerAtk(unit) * num(bb.atk_scale, 0), type: 'true', stun: num(bb.stun, 0), hits: kaz ? 2 : 1, source: unit, fx: 'radiantSword' });
      });
    },
  };
}

/** 纸偶 (风丸 S2): appear burst = its own ATK × damage_scale arts on the 8 surrounding tiles. */
function paperDoll(bb, raw, def) {
  const scale = num(talentBb(def, 'damage_scale').damage_scale, 0);
  return {
    skill: null,
    install(battle, unit) {
      onDeploy(battle, unit, () => { if (scale > 0 && !managed(unit)) burst(battle, unit, { grid: GRID_3X3, amount: unit.s.atk * scale, type: 'arts', source: unit, fx: 'paperDoll' }); });
    },
  };
}

/** Current “狼影” count of a 狼群 token (0 when not a wolf pack). */
export function wolfShadows(unit) { return unit && unit.defId === TOKEN_IDS.wolfPack ? (unit.mem.shadows ?? 0) : 0; }

/** 狼群 (伺夜 talent 狼群领袖/狼群天性; S3 bb on the token). */
function wolfPack(bb, raw, def) {
  const leader = talentWith(def, 'vigil_wolf_t_1_enhance[trigger].max_stack_cnt') ?? def?.talents?.[0] ?? null;
  const lb = leader?.bb ?? {};
  const interval = num(lb['vigil_wolf_t_1_enhance[trigger].interval'] ?? lb.interval, 0);
  const perBlock = num(lb['vigil_wolf_t_1_enhance[trigger].block_cnt'] ?? lb.block_cnt, 1);
  const mMax = String(leader?.description ?? '').match(/至多(\d+)只/);
  const maxShadows = mMax ? +mMax[1] : 1 + num(lb['vigil_wolf_t_1_enhance[trigger].max_stack_cnt'], 0);
  const defPen = num(talentBb(def, 'def_penetrate_fixed').def_penetrate_fixed, 0);
  const guardMul = num(talentWith(def, 'prob')?.bb?.damage_scale, 1); // module: 援军受到来自自身阻挡单位的伤害降低
  const s3Key = Object.keys(bb || {}).find((k) => /atk_scale$/.test(k));
  const s3Scale = s3Key ? num(bb[s3Key], 0) : 0;
  const setShadows = (battle, unit, n) => {
    unit.mem.shadows = n;
    battle.addBuff(unit, { key: 'wolf:shadows', persist: true, allowDead: true, refresh: 'replace', mods: { blockCnt: n * perBlock } });
  };
  return {
    skill: null,
    trait: { hitsFn: (b, u) => Math.max(1, u.mem.shadows ?? 1) },
    install(battle, unit) {
      // initial shadows: 伺夜's talent text ("初始两只"), else one below the maximum
      const ot = (ownerOf(unit)?.def?.talents || []).map((t) => t.description || '').join(' ');
      const mi = ot.match(/初始(两|二|\d+)只/);
      const initShadows = Math.max(1, Math.min(maxShadows, mi ? (/\d/.test(mi[1]) ? +mi[1] : 2) : maxShadows - 1));
      onDeploy(battle, unit, () => {
        setShadows(battle, unit, initShadows);
        unit.hp = unit.s.maxHp;
        const seq = unit.deploySeq;
        if (interval > 0) {
          battle.every(interval, (b, sched) => {
            if (!unit.alive || unit.deploySeq !== seq) { sched.cancel(); return; }
            if ((unit.mem.shadows ?? 0) < maxShadows) {
              setShadows(b, unit, (unit.mem.shadows ?? 0) + 1);
              b.fx('wolfShadow', { x: unit.x, y: unit.y, id: unit.id, n: unit.mem.shadows });
            }
          }, { owner: unit });
        }
        const o = ownerOf(unit);
        if (o && o.profile?.sub === 'tactician') o.trait.reinforcement = unit;
      }, 20);
      battle.on('fatal', (ctx) => {
        if (ctx.unit !== unit || ctx.prevented || !((unit.mem.shadows ?? 0) > 1)) return;
        ctx.prevented = true;
        setShadows(battle, unit, unit.mem.shadows - 1);
        unit.hp = unit.s.maxHp;
        battle.fx('wolfShadowLost', { x: unit.x, y: unit.y, id: unit.id, n: unit.mem.shadows });
      }, { owner: unit, priority: -50 });
      // 狼群天性 ("伺夜和狼群对其的攻击无视其175防御力") and the owner's S3 bonus ("狼群与伺夜攻击被狼群阻挡的单位造成伤害
      // 时，额外造成相当于伺夜攻击力N%的法术伤害", one per damage instance = per bite) cover the pack's and 伺夜's own
      // attacks; with a hand-authored 伺夜 kit (managed) that kit applies both. The module guard is intrinsic.
      const packOrOwner = (s) => s === unit || (s != null && s === ownerOf(unit));
      if (defPen > 0 || guardMul !== 1) {
        battle.on('hit', (ctx) => {
          const { source, target, dmg } = ctx;
          if (defPen > 0 && target && target.blockedBy === unit && unit.alive && packOrOwner(source) && dmg.isAttack && !managed(unit)) dmg.defIgnoreFlat += defPen;
          if (target === unit && guardMul !== 1 && source && source.blockedBy === unit) dmg.mul *= guardMul;
        }, { owner: unit });
      }
      if (s3Scale > 0) {
        battle.on('damaged', (ctx) => {
          const e = ctx.target, o = ownerOf(unit);
          if (!o || !ctx.dmg?.isAttack || !packOrOwner(ctx.source) || !e || e.side !== 'enemy' || !e.alive || e.blockedBy !== unit) return;
          if (!unit.alive || !o.alive || !o.skill?.active || !o.skill.isTimed || managed(unit)) return;
          battle.dealDamage(ctx.source, e, { amount: o.s.atk * s3Scale, type: 'arts', isSkill: true, canDodge: false, tags: ['vigil'] });
        }, { owner: unit });
      }
      // the 援军 leaves with its tactician (a hand-authored 伺夜 kit does the same for its pack) and a killed pack
      // does not come back while its tactician is down (the tactician's redeploy brings it back)
      const tacticianOwner = () => ownerOf(unit)?.profile?.sub === 'tactician';
      battle.on('death', (ctx) => {
        if (ctx.unit !== unit.ownerUnit || !unit.alive || managed(unit) || !tacticianOwner()) return;
        battle.retreat(unit, { reason: 'expired', permanent: true });
      }, { owner: unit });
      enableRespawn(battle, unit, { delay: (u) => u.base.respawnTime, requireOwner: tacticianOwner });
    },
  };
}

/**
 * The operator a 流形 copies ("可复制待部署区一名干员"): the nearest (Chebyshev tiles) living operator of its player on
 * the field, not the summoner; ties → higher base ATK → lower id. (The remake deploys the whole board at battle start,
 * so the official "operator waiting to deploy" is read as the nearest deployed operator — same pick as the 缪尔赛思
 * kit, content/kits/tier6.js.) Null when there is none: the 流形 then waits with its copy skill ready.
 */
export function pickCopyTarget(battle, unit) {
  let best = null, bs = null;
  for (const a of battle.allyUnits) {
    if (a.kind !== 'op' || !a.alive || !a.deployed || a.removed || a.hidden || a === unit.ownerUnit || a.ownerId !== unit.ownerId) continue;
    const d = Math.max(Math.abs(a.tileR - unit.tileR), Math.abs(a.tileC - unit.tileC));
    const s = [d, -a.base.atk, a.id];
    let less = !bs;
    if (!less) for (let i = 0; i < 3; i++) { if (s[i] < bs[i]) { less = true; break; } if (s[i] > bs[i]) break; }
    if (less) { best = a; bs = s; }
  }
  return best;
}

const MANIFOLD_STATS = Object.freeze(['maxHp', 'atk', 'def', 'res', 'blockCnt', 'bat', 'aspd']);
const MANIFOLD_PROFILE = Object.freeze(['attack', 'projectile', 'canHitFly', 'dmgType', 'heal', 'noAttack', 'noAttackUnlessSkill']);

/** Apply a 流形 copy of `target` (scale × base stats, block, attack timing, range, damage type). */
function applyManifoldCopy(battle, unit, target, scale) {
  const tb = target.base;
  const b = unit.base;
  b.maxHp = Math.max(1, tb.maxHp * scale);
  b.atk = tb.atk * scale;
  b.def = tb.def * scale;
  b.res = tb.res * scale;
  b.blockCnt = tb.blockCnt;
  b.bat = tb.bat;
  b.aspd = tb.aspd;
  unit.markDirty();
  unit.hp = unit.s.maxHp;
  if (Array.isArray(target.rangeGrid) && target.rangeGrid.length) {
    unit.rangeGrid = target.rangeGrid;
    battle.refreshRange(unit); // current + initial range of the copied grid
  }
  const tp = target.profile || {};
  const ranged = tp.attack === 'ranged' || target.def?.position === 'RANGED';
  const p = unit.profile;
  if (p) {
    p.attack = ranged ? 'ranged' : 'melee';
    // the talent's list of copied attributes (生命上限 … 伤害类型) names no attack shape: a 阵法术师 / 轰击术师's instant
    // 'beam' (rangeAoe: every enemy in range) becomes a plain single-target bolt, like a healer's orb
    p.projectile = ranged ? (tp.projectile && tp.projectile !== 'none' && tp.projectile !== 'orb' && tp.projectile !== 'beam' ? tp.projectile : 'bolt') : 'none';
    p.canHitFly = ranged ? true : !!tp.canHitFly;
    // 初始伤害类型（不攻击、治疗类型则不继承）
    if (!(tp.dmgType === 'heal' || tp.dmgType === 'none' || tp.noAttack || tp.noAttackUnlessSkill)) p.dmgType = tp.dmgType;
    p.heal = null;
    p.noAttack = false; // a 流形 attacks only once it copied an operator
    p.noAttackUnlessSkill = false;
  }
  battle.removeBuff(unit, 'mlyss:steal');
  unit.mem.copy = { id: target.id, defId: target.defId, ranged, scale };
  unit.mem.stolenAtk = 0;
  unit.mem.stolenDef = 0;
  unit.mem.atkCount = 0;
  battle.fx('manifoldCopy', { x: unit.x, y: unit.y, id: unit.id, from: target.id });
}

/** A split clone takes its origin's current copy (stats, range, attack profile) as it is. */
function cloneManifold(battle, clone, origin) {
  for (const k of MANIFOLD_STATS) clone.base[k] = origin.base[k];
  if (Array.isArray(origin.rangeGrid) && origin.rangeGrid.length) { clone.rangeGrid = origin.rangeGrid; battle.refreshRange(clone); }
  if (clone.profile && origin.profile) for (const k of MANIFOLD_PROFILE) clone.profile[k] = origin.profile[k];
  if (clone.profile) clone.profile.noAttack = false;
  clone.markDirty();
  clone.hp = clone.s.maxHp;
  clone.mem.copy = origin.mem.copy ? { ...origin.mem.copy } : null;
}

/**
 * 流形 (缪尔赛思 talent 净水即生命; token skill 流形 + token talents: copy scale, steal/split numbers, module).
 * Official rules (data texts):
 *   - token skill "可复制待部署区一名干员" (SP 95/100, 1 charge): the copy happens when the skill starts ("技能开启时复制
 *     目标90%…"); the skill only starts with an operator to copy (never wasted on nobody — it waits, ready);
 *   - an uncopied 流形 (block 0, range = its own tile) does not attack: attacking starts with its copy;
 *   - "其被击败后会在25秒后自动刷新": killed ⇒ back after the talent interval (never after expiring / being replaced),
 *     one 流形 at a time (deployLimit 1; split clones aside), each comes back uncopied and copies again;
 *   - ranged copy: every N attacks a clone on a free deployable tile of the 4 neighbours, lasting `interval` s; clones
 *     never copy, split or come back; melee copy: ATK/DEF steal per hit (capped, reset by a new copy).
 */
function manifold(bb, raw, def) {
  const tCopy = talentBb(def, 'scale');
  const tSteal = talentBb(def, 'steal_atk');
  const tSp = talentBb(def, 'sp');
  const guardMul = num(talentBb(def, 'damage_scale').damage_scale, 1);
  const scale = num(tCopy.scale, 1);
  const respawn = num(tCopy.interval, 0);
  const stealAtk = num(tSteal.steal_atk, 0), stealAtkMax = num(tSteal.steal_atk_max, 0);
  const stealDef = num(tSteal.steal_def, 0), stealDefMax = num(tSteal.steal_def_max, 0);
  const splitEvery = Math.floor(num(tSteal['mlyss_wtrman_t_2[range].max_stack_cnt'], 0));
  const splitLife = num(tSteal.interval, 0);
  const sk = def?.skill;
  const spCost = num(sk?.spCost, 0);
  const initSp = Math.min(spCost, num(sk?.initSp, 0));
  const firstSp = num(tSp.sp, 0); // golden 净水即生命: "首次部署后立即获得5点技力" (first deployment only)
  const split = (battle, unit) => {
    const tile = findSummonTile(battle, unit, 'plus', { melee: false });
    if (!tile) return;
    const st = stateOf(battle);
    st.spawningClone = true; // read by the clone's install (before its deploy: deploy limits / tactician link skip it)
    let c = null;
    try { c = battle.spawnToken(unit.ownerUnit ?? unit.ownerId, TOKEN_IDS.manifold, tile[0], tile[1], { duration: splitLife }); } finally { st.spawningClone = false; }
    if (!c) return;
    cloneManifold(battle, c, unit);
    battle.fx('manifoldSplit', { x: c.x, y: c.y, id: c.id, from: unit.id });
  };
  return {
    skill: {
      // started by the install tick below only when there is an operator to copy (rule NEVER: no auto-cast on nobody)
      kind: 'toggle', trigger: 'NEVER', spType: 'time', spCost, initSp,
      onStart({ battle, unit }) {
        if (unit.mem.noCopy || managed(unit)) return;
        const t = pickCopyTarget(battle, unit);
        if (t) applyManifoldCopy(battle, unit, t, scale);
      },
    },
    // no attack before the first copy (applyManifoldCopy / the 缪尔赛思 kit's copy switch it on)
    trait: {
      noAttack: true,
      afterHit: (b, u, target) => {
        const c = u.mem.copy;
        if (!c || c.ranged || !target || !target.alive || target.side !== 'enemy' || managed(u)) return;
        const ga = Math.max(0, Math.min(stealAtk, stealAtkMax - (u.mem.stolenAtk ?? 0)));
        const gd = Math.max(0, Math.min(stealDef, stealDefMax - (u.mem.stolenDef ?? 0)));
        if (!(ga > 0 || gd > 0)) return;
        u.mem.stolenAtk = (u.mem.stolenAtk ?? 0) + ga;
        u.mem.stolenDef = (u.mem.stolenDef ?? 0) + gd;
        b.addBuff(u, { key: 'mlyss:steal', refresh: 'replace', mods: { atkFlat: u.mem.stolenAtk, defFlat: u.mem.stolenDef } });
        // the robbed enemy keeps exactly what was taken from it (a capped last steal takes less than steal_atk)
        const robbed = (target.mem.mlyssRobbed ??= { atk: 0, def: 0 });
        robbed.atk += ga; robbed.def += gd;
        b.addBuff(target, { key: 'mlyss:stolen', refresh: 'replace', mods: { atkFlat: -robbed.atk, defFlat: -robbed.def }, source: u });
      },
      afterAttack: (b, u) => {
        const c = u.mem.copy;
        if (!c || !c.ranged || u.mem.isClone || !(splitEvery > 0) || managed(u)) return;
        u.mem.atkCount = (u.mem.atkCount ?? 0) + 1;
        if (u.mem.atkCount % splitEvery === 0) split(b, u);
      },
    },
    install(battle, unit) {
      if (stateOf(battle).spawningClone) { unit.mem.isClone = true; unit.mem.noCopy = true; }
      // the uncopied 流形 (data stats, own-tile range, no attack): every (re)deployment starts from it again
      const defaults = { base: Object.fromEntries(MANIFOLD_STATS.map((k) => [k, unit.base[k]])), rangeGrid: unit.rangeGrid, profile: {} };
      if (unit.profile) for (const k of MANIFOLD_PROFILE) defaults.profile[k] = unit.profile[k];
      onDeploy(battle, unit, () => {
        if (unit.mem.isClone) return;
        if (unit.mem.copy || unit.mem.mlyss) { // redeployed after a copy (this kit's / the 缪尔赛思 kit's)
          Object.assign(unit.base, defaults.base);
          if (unit.profile) Object.assign(unit.profile, defaults.profile);
          if (unit.rangeGrid !== defaults.rangeGrid) { unit.rangeGrid = defaults.rangeGrid; battle.refreshRange(unit); }
          battle.removeBuff(unit, 'mlyss:steal');
          battle.removeBuff(unit, 'mlyss:stolen');
          unit.markDirty();
          unit.hp = unit.s.maxHp;
        }
        unit.mem.copy = null;
        unit.mem.mlyss = null;
        const o = ownerOf(unit);
        if (o && o.profile?.sub === 'tactician') o.trait.reinforcement = unit;
        // a hand-authored 缪尔赛思 kit grants the first-deployment SP itself (it tracks her first 流形 across respawns)
        if (firstSp > 0 && !unit.mem.firstSpDone && !managed(unit) && unit.skill) { unit.mem.firstSpDone = true; unit.skill.gainSp(firstSp, 'talent'); }
      }, 20);
      // copy skill: starts once ready AND an operator to copy exists (both modes: the 缪尔赛思 kit copies on skillStart)
      if (!unit.mem.noCopy) {
        battle.on('tick', () => {
          const sk = unit.skill;
          if (!sk || !unit.alive || !unit.deployed || sk.active || !sk.ready || sk.opCooling || !unit.canAct || unit.s.flags.silence) return;
          if (pickCopyTarget(battle, unit)) sk.activate('MLYSS_WTRMAN');
        }, { owner: unit });
      }
      // module 梳妆流形 (isToken part on the token talents): 援军受到来自自身阻挡单位的伤害降低15% — intrinsic to the token,
      // applied here for managed tokens too (the 缪尔赛思 kit leaves it to this kit when the token runs it)
      if (guardMul !== 1) {
        battle.on('hit', (ctx) => { if (ctx.target === unit && ctx.source && ctx.source.blockedBy === unit) ctx.dmg.mul *= guardMul; }, { owner: unit });
      }
      // like the 缪尔赛思 kit: no respawn while its summoner is down (her redeploy brings it back, ensureReinforcement)
      if (respawn > 0) enableRespawn(battle, unit, { delay: respawn, unlessManaged: true, requireOwner: () => !!unit.ownerUnit });
    },
  };
}

/** 香槟炸弹 (琳琅诗怀雅 S2): untargetable trap consumed by the first ground enemy touching its tile. */
function champagne(bb) {
  const scale = num(bb['attack@atk_scale'] ?? bb.atk_scale, 0);
  const slug = num(bb['attack@sluggish'] ?? bb.sluggish, 0);
  const extraAfter = num(bb.duration_switch, Infinity);
  return {
    skill: {
      kind: 'passive',
      onTick({ battle, unit }) {
        if (!unit.alive) return;
        let hit = null;
        for (const e of battle.enemies) {
          if (!e.alive || e.hidden || e.isFlying) continue;
          // touching its tile: a huge enemy on any tile of its body (body.js)
          const on = e.hitArea ? bodyOnTile(e, unit.tileR, unit.tileC) : Math.abs(e.x - unit.tileC) <= 0.5 && Math.abs(e.y - unit.tileR) <= 0.5;
          if (on && (!hit || e.spawnSeq < hit.spawnSeq)) hit = e;
        }
        if (!hit) return;
        const hits = battle.time - unit.deployedAt >= extraAfter - 1e-9 ? 2 : 1;
        const amount = ownerAtk(unit) * scale;
        for (let i = 0; i < hits && hit.alive; i++) battle.dealDamage(unit, hit, { amount, type: 'phys', isSkill: true, tags: ['summon', 'trap'] });
        if (hit.alive && slug > 0) battle.applyStatus(hit, 'sluggish', { duration: slug, source: unit });
        battle.fx('champagneBomb', { x: unit.x, y: unit.y, id: unit.id, target: hit.id, hits, consumed: true });
        battle.retreat(unit, { reason: 'expired', permanent: true });
      },
    },
    trait: { noAttack: true },
    install(battle, unit) { untargetable(battle, unit); },
  };
}

/**
 * 从不混淆的方向 (乌尔比安 S3): marker of the owner's original tile; the owner returns there when the skill ends — a
 * 【移动】 (Battle.moveRedeploy, SP emptied: PRTS 乌尔比安 S3 备注 "【返回】时将清空技力"). The 乌尔比安 kit brings him back
 * itself (its onEnd retreats the marker first); this is the fallback for a kit that only places the marker.
 */
function ulpiaMarker() {
  return {
    skill: null,
    trait: { noAttack: true },
    install(battle, unit) {
      untargetable(battle, unit);
      bindToOwnerSkill(battle, unit);
      const home = () => {
        if (!unit.alive) return;
        const r = unit.tileR, c = unit.tileC;
        battle.retreat(unit, { reason: 'expired', permanent: true });
        const o = ownerOf(unit);
        if (o && o.alive && o.deployed && (o.tileR !== r || o.tileC !== c) && battle.moveRedeploy(o, r, c, { clearSp: true })) battle.fx('ulpiaReturn', { x: c, y: r, id: o.id });
      };
      // runs before bindToOwnerSkill's plain retreat (higher priority): retreat + bring the owner home
      battle.on('skillEnd', (ctx) => {
        if (ctx.unit === unit.ownerUnit && unit.mem.boundActivation != null && ctx.skill.activations === unit.mem.boundActivation) home();
      }, { owner: unit, priority: 10 });
      battle.on('death', (ctx) => { if (ctx.unit === unit.ownerUnit && unit.alive) battle.retreat(unit, { reason: 'expired', permanent: true }); }, { owner: unit });
    },
  };
}

/** 黄金盟誓 (维娜·维多利亚 S3): attacks deal true damage (trait); lasts while the owner's skill runs. */
function goldenOath(bb, raw, def) {
  const trueDmg = /真实伤害/.test(String(def?.trait ?? ''));
  return {
    skill: null,
    trait: trueDmg ? { dmgType: 'true' } : {},
    install(battle, unit) { bindToOwnerSkill(battle, unit); },
  };
}

/**
 * 爬行号·防护单元 (凯瑟琳 talent 定向支援信号; a hand piece the player places and turns, user playtest #6): "使一名干员
 * 获得相当于凯瑟琳生命上限20%的屏障（若目标最近5秒内未受攻击，则每秒补充…不超过初始上限），装置效果不叠加" — the operator
 * on its range (1-1: its tile + the tile it faces) gets the full shield when the device takes it (deploy, or a new /
 * redeployed operator there), then the refill; untargetable ("不会受到攻击") and invulnerable (enemy AoE sweeping every
 * ally in a radius would otherwise destroy the 100-HP device). The buff key is 凯瑟琳 S1 岁月锻打's test.
 */
function catShield(bb, raw, def) {
  const t = talentBb(def, 'max_shield_ratio');
  const idle = num(t.interval, 0);
  const every = num(t['catsld_t_1[timer][interval].interval'], 1);
  const maxRatio = num(t.max_shield_ratio, 0);
  const refill = num(t.shield_ratio_each_trigger, 0);
  return {
    skill: null,
    trait: { noAttack: true },
    install(battle, unit) {
      const st = stateOf(battle);
      battle.addBuff(unit, { key: 'token:catDevice', flags: { invulnerable: true }, persist: true, allowDead: true });
      const ownerHp = () => { const o = ownerOf(unit); return o ? o.s.maxHp : unit.s.maxHp; };
      const valid = (a) => a && a.alive && a.deployed && a.kind === 'op';
      const pick = () => {
        let best = null;
        for (const k of unit.rangeKeys || []) {
          const a = battle.unitAt((k / COLS) | 0, k % COLS);
          if (!valid(a) || a.ownerId !== unit.ownerId) continue;
          const holder = st.catTargets.get(a.id);
          if (holder && holder !== unit && holder.alive) continue; // 装置效果不叠加
          best = a;
          break;
        }
        if (unit.mem.target && st.catTargets.get(unit.mem.target.id) === unit) st.catTargets.delete(unit.mem.target.id);
        unit.mem.target = best;
        if (best) st.catTargets.set(best.id, unit);
        return best;
      };
      const give = (a, amount) => {
        const cap = ownerHp() * maxRatio;
        if (!(cap > 0) || !(amount > 0)) return;
        const b = a.findBuff(CAT_SHIELD_KEY);
        if (b) { b.shield = Math.min(cap, (b.shield || 0) + amount); a.markDirty(); } else battle.addBuff(a, { key: CAT_SHIELD_KEY, shield: Math.min(cap, amount), duration: Infinity, visible: true, source: unit });
      };
      const connect = () => {
        const a = pick();
        if (a) { give(a, ownerHp() * maxRatio); battle.fx('catShield', { x: a.x, y: a.y, id: a.id, from: unit.id }); }
        return a;
      };
      onDeploy(battle, unit, connect);
      battle.every(every, () => {
        if (!unit.alive || !unit.deployed) return;
        const a = unit.mem.target;
        if (!valid(a)) { connect(); return; }
        const o = ownerOf(unit);
        const skillOn = !!(o && o.alive && o.skill && o.skill.active && o.skill.isTimed);
        const rate = skillOn ? num(o.skill.bb?.overwrite_ratio, refill) : refill;
        if (skillOn || battle.time - a.lastHitAt >= idle - 1e-9) give(a, ownerHp() * rate * every);
      }, { owner: unit });
      battle.on('death', (ctx) => {
        if (ctx.unit === unit && unit.mem.target && st.catTargets.get(unit.mem.target.id) === unit) st.catTargets.delete(unit.mem.target.id);
      }, { owner: unit });
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// 炎佑 (enemy_9012_acloon as an ally)

/** Enemy-shaped 炎佑 record (enemies.json) for data sets without the tokens.json entry; null when tokens.json has it. */
function yanyouFallbackDef(battle) {
  if (battle.data.getToken?.(TOKEN_IDS.yanyou)) return null;
  return battle.data.rawEnemy?.(TOKEN_IDS.yanyou) ?? null;
}

/**
 * 炎佑 (PRTS “炎佑” 级别0(卫戍协议), enemy_database enemy_9012_acloon; user playtest #4 item 12):
 *   * moves on its own — "持续追踪全场范围内仇恨值最高的敌方单位": it flies after the highest-aggro targetable enemy of
 *     the whole field (the operator order: taunt, least remaining path, earliest spawned; while 祛恶之焰 channels, its
 *     locked target) and hovers over it (YANYOU_STOP short of its position; a 2nd 炎佑 of 9 炎 hovers 0.8 row beside the
 *     first); with no enemy on the field it stays where it is (user playtest #4: "停留在最后在的位置，而不是往一个固定位置
 *     返回"; PRTS says it then tracks a random tile — the user's first-hand account wins);
 *   * normal attack: rangeRadius 2.0, arts, 3 targets ("可同时攻击3个目标", talent 1.attack@max_target);
 *   * every damage it deals adds burn = ATK × 2.ep_damage_ratio (20 %: "自身造成伤害时，附加攻击力20%的灼燃损伤"; the
 *     official 下半 notice: "祛恶之焰附带的灼燃损伤调整为基于炎佑的攻击力") — normal attacks AND flame ticks;
 *   * 元素脆弱 aura: enemies within YANYOU_FRAGILE_RADIUS (1.5, PRTS "自身<固定半径>半径1.5范围内") take 元素伤害 (burst
 *     damage) × 2.damage_scale (1.2) — not the gauge fill (damage.js);
 *   * immune to element damage ("即将受到元素损伤前取消此元素损伤");
 *   * 祛恶之焰 [模式乙] (the 炎 bond's mode, Skill_2; cooldown / initCooldown 15, atk_scale 0.6, hit_duration 20,
 *     range_radius 1.0): "触发索敌和普通攻击相同：锁定1个目标持续施法，最多持续20秒，每秒对目标周围半径1.0范围内的所有
 *     敌方单位造成攻击力60%的法术伤害（范围伤害为中点判定…对被锁定的目标也不例外）※施法期间受到沉默影响后，立即结束技能".
 *     It fires when a normal attack would (SP = the 15 s cooldown), locks that attack's first target, channels on it
 *     (no normal attacks meanwhile), deals the 1 s ticks (the first at once) and ends after 20 s, when the locked
 *     target is gone (dead, left, untargetable — "锁定1个目标…最多持续") or when silenced; the cooldown then runs again
 *     [ASSUMED: the cooldown counts from the end of the channel, like the engine's timed skills]. While stunned /
 *     frozen the channel keeps its lock but deals nothing.
 */
const YANYOU_STOP = 0.25;             // [ASSUMED] how close it hovers to the tracked enemy (tiles)
const YANYOU_FRAGILE_RADIUS = 1.5;    // PRTS "在场期间自身<!--固定半径-->半径1.5范围内的敌方单位受到20%的元素脆弱"
const YANYOU_AURA_EVERY = 0.2;        // aura refresh period (s); the status lasts two periods
const YANYOU_PROFILE = Object.freeze({ canHitFly: true });

/** Highest-aggro targetable enemy of the whole field for `u` (operator order, targeting.js sortEnemyTargets). */
function topAggroEnemy(battle, u) {
  let best = null, bk = null;
  for (const e of battle.enemies) {
    if (!canTargetEnemy(u, e, YANYOU_PROFILE)) continue;
    const k = [-(e.s.taunt || 0), battle.remainingDistance(e), e.spawnSeq];
    if (!bk || k[0] < bk[0] || (k[0] === bk[0] && (k[1] < bk[1] - 1e-9 || (Math.abs(k[1] - bk[1]) <= 1e-9 && k[2] < bk[2])))) { best = e; bk = k; }
  }
  return best;
}

function yanyouKit(bb, raw) {
  // enemy-shaped record: `talents` is one { bb } object, `skills` the enemy skill list
  const tal = raw?.talents && !Array.isArray(raw.talents) ? raw.talents.bb ?? {} : raw?.talent ?? {};
  const skills = Array.isArray(raw?.skills) ? raw.skills : [];
  // the 炎 bond summons 模式乙 (Skill_2, PRTS: "由核心盟约-炎召唤时为模式乙"); 模式甲 (Skill) hits the target only
  const sk = skills.find((s) => s.prefabKey === 'Skill_2') ?? skills.find((s) => s.prefabKey === 'Skill') ?? skills[0] ?? {};
  const maxTargets = Math.max(1, Math.floor(num(tal['1.attack@max_target'], 1)));
  const epRatio = num(tal['2.ep_damage_ratio'], 0);
  const fragMul = num(tal['2.damage_scale'], 1);
  const radius = num(raw?.stats?.rangeRadius, 0) > 0 ? num(raw.stats.rangeRadius, 0) : 2;
  const moveSpeed = num(raw?.stats?.moveSpeed, 1);
  const cd = num(sk.cooldown, 0);
  const initCd = num(sk.initCooldown, cd);
  const flameScale = num(sk.bb?.atk_scale, 0);
  const flameDur = num(sk.bb?.hit_duration, 0);
  const flameR = num(sk.bb?.range_radius, 0);
  /** The channel's locked target while it is still valid (alive, on the field, targetable), else null. */
  const lockOf = (u) => {
    const t = u.mem.flame?.target;
    return t && t.alive && canTargetEnemy(u, t, YANYOU_PROFILE) ? t : null;
  };
  const refreshKeys = (u) => {
    // cached while it hovers in place — unless the engine rebuilt the range from the (dummy) grid meanwhile
    // (a rangeExtend buff / skill range switch calls _refreshRange around its spawn tile)
    if (u.mem.keysAt && u.rangeKeys === u.mem.keysRef && Math.abs(u.mem.keysAt.x - u.x) < 0.05 && Math.abs(u.mem.keysAt.y - u.y) < 0.05) return;
    const keys = [];
    const r0 = Math.floor(u.y - radius), r1 = Math.ceil(u.y + radius), c0 = Math.floor(u.x - radius), c1 = Math.ceil(u.x + radius);
    for (let r = Math.max(0, r0); r <= Math.min(ROWS - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(COLS - 1, c1); c++) if (Math.hypot(c - u.x, r - u.y) <= radius + 1e-9) keys.push(r * COLS + c);
    }
    u.rangeKeys = keys;
    u.rangeKeySet = new Set(keys);
    u.baseRangeKeys = keys;
    u.mem.keysRef = keys;
    u.mem.keysAt = { x: u.x, y: u.y };
  };
  return {
    skill: cd > 0 && flameDur > 0 ? {
      kind: 'duration', duration: flameDur, spType: 'time', spCost: cd, initSp: Math.max(0, cd - initCd), trigger: 'DEFAULT',
      attack: { noAttack: true },                                  // channelling: no normal attacks
      onStart({ battle, unit }) {
        // "触发索敌和普通攻击相同": the normal attack's first target
        const list = battle.enemiesInKeys(unit.rangeKeys, unit, YANYOU_PROFILE);
        sortEnemyTargets(battle, unit, list, null);
        unit.mem.flame = { target: list[0] ?? null, acc: 1 };
        if (!list[0]) unit.skill.end('noTarget');
      },
      onTick({ battle, unit, dt }) {
        const f = unit.mem.flame;
        if (!f) return;
        if (unit.s.flags.silence) { unit.skill.end('silence'); return; }
        const t = lockOf(unit);
        if (!t) { unit.skill.end('targetLost'); return; }
        if (!unit.canAct) return;                                  // stunned / frozen: the lock holds, no damage
        f.acc += dt ?? battle.dt;
        if (f.acc < 1 - 1e-9) return;
        f.acc -= 1;
        // centre-point AoE around the locked target, searched again every second (the target itself included)
        const hit = flameR > 0 ? battle.foesInRadius(t.x, t.y, flameR) : [];
        if (!hit.includes(t)) hit.unshift(t);
        for (const e of hit) battle.dealDamage(unit, e, { amount: unit.s.atk * flameScale, type: 'arts', isSkill: true, tags: ['flame'] });
        battle.fx('yanyouFlame', { x: t.x, y: t.y, id: unit.id, target: t.id, r: flameR, n: hit.length, dur: 1 });
      },
      onEnd({ unit }) { unit.mem.flame = null; },
    } : null,
    trait: { attack: 'ranged', dmgType: 'arts', projectile: 'bolt', canHitFly: true, maxTargets, heal: null, noAttack: false },
    install(battle, unit) {
      unit.motion = 'FLY';
      if (!(unit.base.spRecovery > 0)) unit.base.spRecovery = 1; // the cooldown ticks as time SP (data spRecovery 0)
      unit.base.blockCnt = 0;
      const speed = moveSpeed * MOVE_SCALE;
      onDeploy(battle, unit, () => { unit.mem.keysAt = null; refreshKeys(unit); });
      // every damage it deals adds burn (not the burn itself, not element bursts; not a killing blow — the hook runs
      // before the kill, at 0 HP: no burst on the corpse)
      if (epRatio > 0) {
        battle.on('damaged', (ctx) => {
          const t = ctx.target;
          if (ctx.source !== unit || !t || t.side !== 'enemy' || !hasHp(t)) return;
          if (ctx.type === 'element' || ctx.type === 'elemental' || !(ctx.amount > 0)) return;
          battle.dealDamage(unit, ctx.target, { type: 'element', element: 'burn', amount: unit.s.atk * epRatio, tags: ['yanyou'] });
        }, { owner: unit });
      }
      // "即将受到元素损伤前取消此元素损伤"
      battle.on('elementHit', (ctx) => { if (ctx.target === unit) ctx.dmg.cancel = true; }, { owner: unit });
      let auraAcc = YANYOU_AURA_EVERY;
      battle.on('tick', ({ dt }) => {
        if (!unit.alive || !unit.deployed) return;
        if (unit.canAct && !unit.s.flags.noMove && speed > 0) {
          const tgt = lockOf(unit) ?? topAggroEnemy(battle, unit);
          if (tgt) {
            const dx = tgt.x - unit.x, dy = tgt.y + num(unit.mem.hoverDy, 0) - unit.y;
            const d = Math.hypot(dx, dy);
            if (d > YANYOU_STOP + 1e-6) {
              const step = Math.min(d - YANYOU_STOP, speed * dt);
              const R = battle.rect;
              unit.x = Math.max(R.c0, Math.min(R.c1, unit.x + (dx / d) * step));
              unit.y = Math.max(R.r0, Math.min(R.r1, unit.y + (dy / d) * step));
            }
          }
        }
        refreshKeys(unit);
        auraAcc += dt;
        if (fragMul > 1 && auraAcc >= YANYOU_AURA_EVERY - 1e-9) {
          auraAcc = 0;
          for (const e of battle.foesInRadius(unit.x, unit.y, YANYOU_FRAGILE_RADIUS)) {
            battle.applyStatus(e, 'elemFragile', { duration: 2 * YANYOU_AURA_EVERY, value: fragMul - 1, source: unit });
          }
        }
      }, { owner: unit });
    },
  };
}

/** Free field tile for a flyer: the player's half, void/non-deployable tiles first, nearest to the half's centre. */
function airTile(battle, playerId, taken) {
  const R = battle.rect;
  const ps = battle.getPlayer(playerId);
  let c0 = R.c0, c1 = R.c1;
  if (battle.players.length > 1 && ps) { if (ps.half === 'R') c0 = Math.max(c0, 11); else c1 = Math.min(c1, 10); }
  const cr = (R.r0 + R.r1) / 2, cc = (c0 + c1) / 2;
  let best = null, bs = null;
  for (let r = R.r0; r <= R.r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (taken.has(r * COLS + c) || !tileFree(battle, r, c)) continue;
      const t = battle.grid.tile(r, c);
      const cls = t.build === 'NONE' && t.pass !== 'ALL' ? 0 : t.build === 'NONE' ? 1 : 2;
      const s = [cls, Math.hypot(r - cr, c - cc), r * COLS + c];
      let less = !bs;
      if (!less) for (let i = 0; i < 3; i++) { if (s[i] < bs[i] - 1e-9) { less = true; break; } if (s[i] > bs[i] + 1e-9) break; }
      if (less) { best = [r, c]; bs = s; }
    }
  }
  return best;
}

/**
 * 炎 bond summon: spawn `count` “炎佑” for `playerId` (flying ally that picks its own targets; bonds.js computes the
 * numbers). atk / hp (0.3 × the 炎 sums at battle start) are ADDED to the template stats (600 / 12000): PRTS "登场时使
 * 自身攻击力、生命值增加召唤自身的玩家场地上的所有【炎】盟约干员攻击力、生命值的30%（最终加算）". atkMul (9 炎: ×1.5,
 * [ASSUMED] on the whole ATK) and dmgTakenMul (9 炎: 0.1) are applied as a persistent buff. Returns the spawned units.
 */
export function spawnYanyou(battle, playerId, { atk, hp, atkMul = 1, dmgTakenMul = 1, count = 1 } = {}) {
  const rec = battle.data.rawToken?.(TOKEN_IDS.yanyou) ?? battle.data.rawEnemy?.(TOKEN_IDS.yanyou) ?? null;
  if (!rec) return [];
  const def = yanyouFallbackDef(battle);
  const n = Math.max(0, Math.min(Math.floor(num(count, 1)), Math.max(1, Math.floor(num(rec.deployLimit ?? rec.stats?.deployLimit, 2)))));
  const out = [];
  const taken = new Set();
  const base = rec.stats || {};
  const stats = {};
  if (num(atk, -1) >= 0) stats.atk = num(base.atk, 0) + num(atk, 0);
  if (num(hp, 0) > 0) stats.maxHp = num(base.maxHp, 0) + num(hp, 1);
  const ps = battle.getPlayer(playerId);
  for (let i = 0; i < n; i++) {
    const tile = airTile(battle, playerId, taken);
    if (!tile) break;
    taken.add(tile[0] * COLS + tile[1]);
    const u = battle.spawnToken(playerId, TOKEN_IDS.yanyou, tile[0], tile[1], { ...(def ? { def } : {}), stats, dir: ps ? ps.dir : 'RIGHT' });
    if (!u) continue;
    const mods = {};
    if (num(atkMul, 1) !== 1 && num(atkMul, 1) >= 0) mods.atkMul = num(atkMul, 1);
    if (num(dmgTakenMul, 1) !== 1 && num(dmgTakenMul, 1) >= 0) mods.dmgTakenMul = num(dmgTakenMul, 1);
    if (Object.keys(mods).length) battle.addBuff(u, { key: 'bond:yanyou', persist: true, allowDead: true, mods });
    u.mem.hoverDy = out.length === 0 ? 0 : (out.length % 2 ? 0.8 : -0.8); // the 2nd one hovers beside the first
    u.hp = u.s.maxHp;
    battle.fx('yanyouSummon', { x: u.x, y: u.y, id: u.id, playerId });
    out.push(u);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// band map characters (预备干员-医疗 / Touch)

/**
 * Talents of the band map characters (data talents of the character record):
 *   plain stat talent  "攻击力+4%" (预备干员-医疗 攻击提升) → persistent ATK/DEF/HP/ASPD buff
 *   攫升  "治疗目标时使其获得3点技力" (Touch) → every heal by the character gives the healed unit `sp` SP
 *   超脱  "攻击范围内的友方干员被击倒时获得5点技力" (Touch) → an allied operator knocked out on a tile of its range: +`sp` SP
 */
function mapCharTalents(def) {
  const out = [];
  for (const t of def?.talents ?? []) {
    const bb = t?.bb ?? {};
    const text = String(t?.description ?? '');
    const sp = num(bb.sp, 0);
    if (sp > 0 && /治疗.*技力/.test(text)) {
      out.push({ install(battle, unit) {
        battle.on('heal', (ctx) => {
          const tg = ctx.target;
          if (ctx.source !== unit || !tg || tg === unit || tg.kind === 'device' || !tg.skill || !(ctx.amount > 0)) return;
          tg.skill.gainSp(sp, 'talent');
        }, { owner: unit, priority: -200 });
      } });
    } else if (sp > 0 && /被击倒/.test(text)) {
      out.push({ install(battle, unit) {
        battle.on('death', (ctx) => {
          const d = ctx.unit;
          if (ctx.reason !== 'killed' || !unit.alive || !unit.deployed || !unit.skill || !d || d === unit || d.kind !== 'op' || d.ownerId !== unit.ownerId) return;
          if ((unit.rangeKeySet || new Set(unit.rangeKeys || [])).has(d.tileR * COLS + d.tileC)) {
            unit.skill.gainSp(sp, 'talent');
            battle.fx('spGain', { x: unit.x, y: unit.y, id: unit.id, n: sp });
          }
        }, { owner: unit });
      } });
    } else if (!/时|每|若|当/.test(text)) {
      const mods = {};
      if (num(bb.atk, 0)) mods.atkPct = num(bb.atk, 0);
      if (num(bb.def, 0)) mods.defPct = num(bb.def, 0);
      if (num(bb.max_hp, 0)) mods.hpPct = num(bb.max_hp, 0);
      if (num(bb.attack_speed, 0)) mods.aspd = num(bb.attack_speed, 0);
      if (Object.keys(mods).length) {
        out.push({ install(battle, unit) { battle.addBuff(unit, { key: `talent:${t.name || 'stat'}`, persist: true, allowDead: true, mods, tags: ['talent'] }); } });
      }
    }
  }
  return out;
}

/** 预备干员-医疗: generic kit (治疗强化·β型 ATK +50 %) + its stat talent. */
function reserveMedicKit(bb, raw, def) {
  const k = def?.skill ? genericKit(bb, raw, def) : { skill: null, talents: [] };
  return { ...k, talents: [...(k.talents ?? []), ...mapCharTalents(def)] };
}

/** Touch 恳切福音: +ATK, 2 heal targets in the skill range, ×heal_scale on allies ≤ hp_ratio, +addition heal. */
function touchKit(bb, raw, def) {
  const sk = def?.skill;
  if (!sk) return { skill: null, talents: mapCharTalents(def) };
  const hpRatio = num(bb.hp_ratio, 0), boost = num(bb.heal_scale, 1), extra = num(bb['attack@addition_heal_scale'], 0);
  const targeting = {};
  if (num(bb['attack@max_target'], 0) > 1) targeting.maxTargets = Math.floor(num(bb['attack@max_target'], 1));
  if (sk.rangeGrid && sk.rangeGrid.length) targeting.rangeGrid = sk.rangeGrid;
  return {
    talents: mapCharTalents(def),
    skill: {
      kind: sk.duration > 0 ? 'duration' : 'instant', heal: true,
      mods: num(bb.atk, 0) ? { atkPct: num(bb.atk, 0) } : undefined,
      targeting,
      onHit({ battle, unit, target, heal }) {
        if (!(extra > 0) || !target || !(heal > 0)) return;
        // "每次治疗2个目标，并额外治疗一次…治疗量为主目标的30%": one extra heal per heal action, for the main
        // (first = most injured) target — onHit runs once per healed target
        const n = unit.stats.attacks;
        if (unit.mem.touchExtraAt === n) return;
        unit.mem.touchExtraAt = n;
        let best = target.hp < target.s.maxHp - 1e-6 ? target : null;
        for (const a of battle.alliesInRadius(target.x, target.y, 1, unit.ownerId)) {
          if (a === target || a.hp >= a.s.maxHp - 1e-6 || a.s.flags.noHeal || a.profile?.noHeal) continue; // (禁疗 / 孤立)
          if (Math.abs(a.tileR - target.tileR) + Math.abs(a.tileC - target.tileC) !== 1) continue;
          if (!best || a.hpRatio < best.hpRatio) best = a;
        }
        // 30 % of the main target's heal as it was applied (×heal_scale when that target was at ≤ hp_ratio)
        const main = unit.mem.touchMainHeal && unit.mem.touchMainHeal.target === target ? unit.mem.touchMainHeal.amount : heal;
        unit.mem.touchExtra = true; // the extra heal is a share of the main heal: no second ×heal_scale
        try { battle.heal(unit, best ?? target, main * extra); } finally { unit.mem.touchExtra = false; }
      },
    },
    install(battle, unit) {
      battle.on('heal', (ctx) => {
        if (ctx.source !== unit || !unit.skill?.active || unit.mem.touchExtra) return;
        if (boost !== 1 && hpRatio > 0 && ctx.target.hpRatio <= hpRatio + 1e-9) ctx.amount *= boost;
        unit.mem.touchMainHeal = { target: ctx.target, amount: ctx.amount };
      }, { owner: unit });
    },
  };
}

/**
 * Spawn a band map character (char_605_cmedic 预备干员-医疗 / char_613_acmedc Touch) at its stage position on the
 * player's half (data/stages.json `mapChars`; `_multi_only` positions only with a partner). Returns the unit or null.
 */
export function spawnMapChar(battle, playerId, tokenId, { alias = null } = {}) {
  const list = battle.stage?.raw?.mapChars ?? battle.stage?.mapChars ?? [];
  const ps = battle.getPlayer(playerId);
  const multi = battle.players.length > 1;
  const cands = list.filter((m) => m && m.key === tokenId && Array.isArray(m.pos) && (alias == null || m.alias === alias)
    && (multi || !/multi_only/.test(String(m.alias))) && battle.grid.inRect(m.pos[0], m.pos[1]));
  // the player's own board columns on this field (board cols 2–10 mapped: unite R = 10–18, boss R mirrored 18–10)
  let span = null;
  if (ps && typeof battle.mapTile === 'function') {
    const a = battle.mapTile(ps, 9, 2)[1], b = battle.mapTile(ps, 9, 10)[1];
    span = [Math.min(a, b), Math.max(a, b)];
  }
  const halfOk = (m) => !ps || battle.players.length < 2 || (span ? m.pos[1] >= span[0] && m.pos[1] <= span[1] : (ps.half === 'R' ? m.pos[1] >= 11 : m.pos[1] <= 10));
  cands.sort((a, b) => (halfOk(b) ? 1 : 0) - (halfOk(a) ? 1 : 0) || (/multi_only/.test(String(a.alias)) ? 1 : 0) - (/multi_only/.test(String(b.alias)) ? 1 : 0));
  for (const m of cands) {
    if (!tileFree(battle, m.pos[0], m.pos[1])) continue;
    // stage positions are field tiles: their direction is taken as it is (default RIGHT)
    const u = battle.spawnToken(playerId, tokenId, m.pos[0], m.pos[1], { dir: normDir(m.dir) });
    if (u) return u;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------
// registry

const RAW_KITS = {
  [TOKEN_IDS.healDrone]: healDrone,
  [TOKEN_IDS.curseDoll]: curseDoll,
  [TOKEN_IDS.obelisk]: obelisk,
  [TOKEN_IDS.rosmonGear]: rosmonGear,
  [TOKEN_IDS.duskDragon]: duskDragon,
  [TOKEN_IDS.seaborn]: seaborn,
  [TOKEN_IDS.radiantSword]: radiantSword,
  [TOKEN_IDS.paperDoll]: paperDoll,
  [TOKEN_IDS.wolfPack]: wolfPack,
  [TOKEN_IDS.manifold]: manifold,
  [TOKEN_IDS.champagne]: champagne,
  [TOKEN_IDS.ulpiaMarker]: ulpiaMarker,
  [TOKEN_IDS.goldenOath]: goldenOath,
  [TOKEN_IDS.catShield]: catShield,
  [TOKEN_IDS.deliveryTarget]: inert({ hideFromEnemies: true }),
  [TOKEN_IDS.eagle1]: inert({ hideFromEnemies: true }),
  [TOKEN_IDS.eagle2]: inert({ hideFromEnemies: true }),
  [TOKEN_IDS.eagle3]: inert({ hideFromEnemies: true }),
  [TOKEN_IDS.iceTarget]: inert(),
  [TOKEN_IDS.yanyou]: yanyouKit,
  [TOKEN_IDS.reserveMedic]: reserveMedicKit,
  [TOKEN_IDS.touch]: touchKit,
};
/** tokenId → kit fn; kits built here carry `fromTokens: true` (deploy limits only police those). */
export const kits = Object.freeze(Object.fromEntries(Object.entries(RAW_KITS).map(([id, f]) => [id, (bb, raw, def) => {
  const k = f(bb ?? {}, raw ?? {}, def ?? null);
  if (k && typeof k === 'object') k.fromTokens = true;
  return k;
}])));
export default kits;

// ---------------------------------------------------------------------------------------------------------------
// battle install: deploy limits, kill credit, last-deployed operator, tactician pairing, generic-kit fallbacks

/**
 * Skill summons spawned at skill start while the summoner's SELECTED skill runs the generic spec — a generic kit, or a
 * hand-authored kit without a spec for a non-default selected skill (content/index.js selectSkillSpec, `skillSource:
 * 'generic'`) — and the data says that skill makes the token (owner-loadout `sources` has 'skill'). Placement per
 * token; 迷迭香 S3 “如你所愿”: "立即在攻击范围内的近战位部署两个战术装备" (the token's deployLimit — 2, 20 with
 * module uniequip_003_rosmon — only caps how many stand; SKILL_SUMMON_PER_CAST). 医疗探机 / 诅咒娃娃 are hand pieces
 * (data `placeable`): their entries only mark them as skill summons — releaseSkillSummon deploys the player's piece on
 * its own tile, and their 'ally' / 'enemy' placement would apply only to data without such a piece.
 */
const SKILL_SUMMONS = Object.freeze({
  [TOKEN_IDS.healDrone]: 'ally',
  [TOKEN_IDS.curseDoll]: 'enemy',
  [TOKEN_IDS.obelisk]: 'melee',
  [TOKEN_IDS.paperDoll]: 'adjacent',
  [TOKEN_IDS.goldenOath]: 'adjacent',
  [TOKEN_IDS.radiantSword]: 'plus',
  [TOKEN_IDS.rosmonGear]: 'melee',
});
/**
 * Pieces per cast of the skill summons placed several at a time (skill description; default 1). 黄金盟誓: "立即在天赋
 * 一生效范围内可部署地面召唤" — every free tile of the 8 around 维娜 (EN client "Summons Golden Vows on deployable tiles
 * within Talent 1's range"; player report B3 after 0.1.0).
 */
const SKILL_SUMMON_PER_CAST = Object.freeze({ [TOKEN_IDS.rosmonGear]: 2, [TOKEN_IDS.goldenOath]: 8 });
/**
 * Skill summons the per-owner deploy limit does not apply to: the data `deployLimit` (character_table phase maxDeployCount 1)
 * of 黄金盟誓 is a hand count, while 维娜 S3 summons one on every free deployable tile of her talent-1 area at once.
 */
const SKILL_SUMMON_UNCAPPED = new Set([TOKEN_IDS.goldenOath]);
/** Tactician talent tokens that replace the engine's generic 援军. */
const TACTICIAN_TOKENS = new Set([TOKEN_IDS.wolfPack, TOKEN_IDS.manifold]);

const tokenIdsOf = (u) => (u.def?.tokens || []).map((t) => (typeof t === 'string' ? t : t?.tokenId)).filter(Boolean);
/**
 * How `owner` (its chess and selected skill / module, DESIGN §16) produces `tokenId`: the owner-loadout def's
 * `sources` (getToken(id, owner.defId, owner.def.loadout)); [] when the token has no variant of the owner's own.
 */
function tokenSources(battle, tokenId, owner) {
  const own = ownVariant(battle.data.rawToken?.(tokenId), owner);
  if (!own) return [];
  const d = battle.data.getToken?.(tokenId, owner.defId, owner.def?.loadout ?? null);
  return Array.isArray(d?.sources) ? d.sources : (own.sources ?? []);
}

function deployLimitOf(u) {
  const v = variantOf(u);
  return num(v?.stats?.deployLimit ?? v?.deployLimit ?? u.def?.raw?.deployLimit ?? u.def?.raw?.stats?.deployLimit, Infinity);
}

/**
 * Tactical point (战术点) of a tactician when the player placed no 援军 piece: `Battle.findTacticalPoint` — a free
 * walkable tile of its initial range, on an enemy ground path first (where a player would put the blocker), then
 * nearest to the tactician. Shared by every tactician kit (tier3 伺夜, the tokens' own fallback).
 */
export function tacticalPoint(battle, owner) {
  return battle.findTacticalPoint(owner);
}

/** Make sure a tactician's 援军 is its real talent token (board piece, or a fresh summon on a tactical point). */
function ensureReinforcement(battle, owner, tokenId) {
  // (split 流形 clones — this file's `isClone`, the 缪尔赛思 kit's `mlyssClone` — are never the 援军)
  const mine = battle.allyUnits.filter((t) => t.kind === 'token' && t.defId === tokenId && t.ownerUnit === owner && !t.mem.isClone && !t.mem.mlyssClone);
  const live = mine.find((t) => t.alive);
  if (live) { owner.trait.reinforcement = live; return live; }
  const waiting = mine.find((t) => !t.alive && !t.removed);
  if (waiting && battle.redeploy(waiting, { free: true })) { owner.trait.reinforcement = waiting; return waiting; }
  // the tactical point the player chose (the board piece's tile, else the last one's) when still usable, else the
  // shared tactical point
  const inRange = new Set(owner.baseRangeKeys || owner.rangeKeys || []);
  const prev = mine.slice().sort((a, b) => (b.uid != null) - (a.uid != null) || b.deploySeq - a.deploySeq)
    .map((t) => [t.homeR, t.homeC]).find(([r, c]) => Number.isInteger(r) && Number.isInteger(c) && inRange.has(r * COLS + c)
      && tileFree(battle, r, c) && battle.grid.canStand(r, c, { ranged: true }));
  const best = prev ?? tacticalPoint(battle, owner);
  if (!best) return null;
  const t = battle.spawnToken(owner, tokenId, best[0], best[1]);
  if (t) owner.trait.reinforcement = t;
  return t;
}

export function install(battle) {
  const st = stateOf(battle);

  // the placed pieces of skill summons wait on their tiles for the skill (user playtest #6, see the header)
  dockSkillSummons(battle);

  // last deployed operator per player (“耀阳”: 上一名部署干员势力为【卡西米尔】) — tokens are not operators
  battle.on('deploy', (ctx) => {
    const u = ctx.unit;
    if (u && u.kind === 'op' && u.side === 'ally') st.lastOp.set(u.ownerId, u);
  }, { priority: -100 });

  // deploy limit per owner (data deployLimit): a new summon withdraws the oldest one of the same kind
  battle.on('deploy', (ctx) => {
    const u = ctx.unit;
    if (!u || u.kind !== 'token' || !u.ownerUnit || u.mem.isClone || !u.kit?.fromTokens || SKILL_SUMMON_UNCAPPED.has(u.defId)) return;
    const lim = deployLimitOf(u);
    if (!(lim >= 1) || !Number.isFinite(lim)) return;
    const same = battle.allyUnits.filter((t) => t.alive && t.kind === 'token' && t.defId === u.defId && t.ownerUnit === u.ownerUnit && !t.mem.isClone && t.kit?.fromTokens);
    if (same.length <= lim) return;
    same.sort((a, b) => a.deploySeq - b.deploySeq);
    for (const t of same.slice(0, same.length - lim)) {
      if (t === u) continue;
      t.mem.replaced = true; // withdrawn by the limit: no respawn (enableRespawn), or two pieces would take turns forever
      battle.retreat(t, { reason: 'expired', permanent: true });
    }
  }, { priority: -90 });

  // summon kills (夕 化境, …): owner kits listen to `summonKill`
  battle.on('kill', (ctx) => {
    const k = ctx.killer;
    if (k && k.kind === 'token' && k.ownerUnit && ctx.victim && ctx.victim.side === 'enemy') battle.emit('summonKill', { token: k, owner: k.ownerUnit, victim: ctx.victim });
  }, { priority: -100 });

  for (const owner of battle.allyUnits) {
    if (owner.kind !== 'op') continue;
    const toks = tokenIdsOf(owner);
    if (!toks.length) continue;
    const base = baseKey(owner.def?.baseId ?? owner.defId);

    // tactician 援军 = its talent token: board piece first; replaces the engine's generic 援军 when that one is in use
    const tac = toks.find((t) => TACTICIAN_TOKENS.has(t));
    if (tac && owner.profile?.sub === 'tactician') {
      const engineDefault = !!(owner.profile.install && owner.profile.install.name === 'installTactician');
      battle.on('deploy', (ctx) => {
        if (ctx.unit !== owner) return;
        if (engineDefault) { ensureReinforcement(battle, owner, tac); return; }
        // a hand-authored kit summons its own 援军 unless one stands: bring the player's board piece in first
        const piece = battle.allyUnits.find((t) => t.kind === 'token' && t.defId === tac && t.ownerUnit === owner && t.uid != null && !t.mem.isClone);
        if (piece && ctx.initial && !piece.alive && !piece.removed && piece.deploySeq === 0) battle.redeploy(piece, { free: true });
        if (piece && piece.alive) owner.trait.reinforcement = piece;
      }, { owner, priority: 50 });
    }

    // generic-kit fallbacks (a hand-authored kit for the summoner replaces them); skill summons also run when only the
    // selected skill falls back to the generic spec (a non-default skill the kit has no `skills` entry for)
    const kitGeneric = !!owner.kit?.generic;
    if (kitGeneric || owner.kit?.skillSource === 'generic') {
      const skillSummons = toks.filter((t) => SKILL_SUMMONS[t] && tokenSources(battle, t, owner).includes('skill'));
      if (skillSummons.length) {
        battle.on('skillStart', (ctx) => {
          if (ctx.unit !== owner) return;
          for (const t of skillSummons) {
            // a hand piece (医疗探机 / 诅咒娃娃) deploys where the player placed it — nowhere when not placed
            if (battle.data.rawToken?.(t)?.placeable === true) { releaseSkillSummon(battle, owner, t); continue; }
            for (let i = 0; i < (SKILL_SUMMON_PER_CAST[t] ?? 1); i++) if (!summonToken(battle, owner, t, SKILL_SUMMONS[t])) break;
          }
        }, { owner });
      }
    }
    if (!kitGeneric) continue;
    if (toks.includes(TOKEN_IDS.duskDragon) && base === 'chess_char_5_12') {
      const life = num(owner.def?.talents?.find((t) => t.tokenKey === TOKEN_IDS.duskDragon)?.bb?.['attack@tokenduration'], 0);
      battle.on('deploy', (ctx) => { if (ctx.unit === owner) owner.mem.duskPending = true; }, { owner });
      battle.on('attack', (ctx) => {
        if (ctx.attacker !== owner || !owner.mem.duskPending) return;
        const t = (ctx.targets || []).find((x) => x && x.side === 'enemy');
        if (!t) return;
        owner.mem.duskPending = false;
        const tile = findSummonTile(battle, owner, 'near', { melee: true, at: { x: t.x, y: t.y } });
        if (!tile) return;
        const d = battle.spawnToken(owner, TOKEN_IDS.duskDragon, tile[0], tile[1], life > 0 ? { duration: life } : {});
        if (d) battle.fx('duskDragon', { x: d.x, y: d.y, id: d.id });
      }, { owner });
    }
  }
}

export function registerMeta(registry) {} // no prep-side effects: token pieces are handled by the match
