// server/sim/content/kits/tier6.js — hand-authored kits for every tier-6 chess (阶 VI, DIY slots excluded) plus the
// hidden chess granted by effects (盟约·辅助干员 chess_char_1_15, band Pith "优等生"; 妮芙 chess_char_6_10 is the hidden
// tier-6 entry). `export default { [baseChessId]: (bb, chess, def) => Kit }` (docs/SIM.md §7.2).
//
// Every number comes from the blackboards (skill bb at the chess level: normal Lv4 / elite Lv7; talents from
// `def.talents[i].bb`, elite module upgrades included; module-only talent parts from `chess.talents[index −1]`; trait
// module upgrades from `def.traitBb`). A few numbers exist only in the official text; they are parsed from it
// (e.g. 锏 "总计10次斩击", 艾雅法拉 "5连发", 仇白 "额外攻击2个目标", 海嗣 duration). The profession defaults of
// professions.js (bard aura, phalanx guard, chain bounces, funnel ramp, bombarder aftershocks, geek drain, tactician
// reinforcement …) are kept and built upon.
//
// Simplifications (one line per id; see also the report of the content phase):
//  1_15 盟约·辅助干员  every damage she deals attaches all three elements, neural → burn → apoptosis (see pithst).
//  6_01 蕾缪安   locks every 0.5 s while an enemy is in range (ends early — and bombs — when the range empties);
//                the shells then follow one every 0.3 s (PRTS), each landing 0.3 s after it is fired [ASSUMED flight];
//                the 1.5 radius (PRTS "碰撞箱判定") is read as the centre distance like every engine radius; knocked
//                out / withdrawn after the end, she fires no further shell (those already in the air still land);
//                "wanted" needs a continuous 8 s stay in some 拉特兰 range; wanted targets are added to her range tiles.
//  6_02 圣聆初雪 "诱导" (ba.attract 无法被阻挡并向目标位置移动) = the engine `attract` status for attract_time: the enemy
//                is unblockable and walks (own speed, grid path) to the nearest ground tile around her, then waits there;
//                snow lives on the ground tiles of her current range; the frozen "保护目标" token is not used (she just
//                freezes herself).
//  6_03 余       the fire wall is her column; "crossing" = source and target on opposite sides of it; bullet clearing =
//                cancelling a ranged enemy hit that crosses it; talent 2 given to all ops = each op regenerates itself
//                (elite: and gets the ×1.14 arts vs burning targets); 庇护 = phys/arts taken ×(1−0.25).
//  6_04 浊心斯卡蒂 S3 HP drain is non-lethal (like the geek drain); 鼓舞 = flat ATK added after the target's multipliers;
//                海嗣 is inert (no attack) and only extends her aura (and her DEFAULT trigger); it expires after its
//                duration and is re-summoned after its redeploy time when DP ≥ its cost (auto-redeploy emulation).
//  6_05 异客     storm zone radius 1.5 tiles (not in data); strikes chain like her trait (4 targets, trait falloff);
//                the storm stops when she leaves the field.
//  6_06 佩佩     splash stun via `damaged` (isSplash) hook; module ×1.15 when ≥3 enemies in the splash area.
//  6_07 维娜     "attack enemies blocked by allies in talent range" = those enemies' tiles are added to her range;
//                S3 puts a 黄金盟誓 on every free deployable melee tile of her talent-1 area (fences too), each for
//                the skill duration (the token's maxDeployCount 1 is its hand limit — tokens.js).
//  6_08 焰影苇草 灼痕 = marker (ATK −20 %) + the 法术脆弱 status (同名效果取最高); applied during S3 it lasts until the
//                skill ends (duration = remaining skill time).
//  6_09 塑心     cannot normal attack; each skill charge is one attack; 精神逆构 multiplies every apoptosis gauge fill on
//                enemies in her range (`elementHit`; several 塑心 do not stack — the strongest applies).
//  6_10 妮芙     失魂 = 元素伤害 ('elemental') per second while the target's apoptosis burst lasts.
//  6_11 缪尔赛思 流形 copies the nearest allied operator of its player on the field (no hand/bench in battle; same pick
//                as content/tokens.js) when its own skill starts; it copies the listed stats + range + damage type (not
//                splash/chain/multi-hit shapes); clones do not split again. MLYSS_WTRMAN trigger = DEFAULT or an enemy
//                in a (copied) 流形's range. An uncopied 流形 never attacks and its copy skill waits (ready) until someone
//                can be copied. "被击败后25秒后自动刷新": one pending respawn at a time, only while she is on the field
//                and no 流形 of hers stands (her knock-out cancels it; her redeploy re-summons it as her 援军).
//  6_12 迷迭香   "溅射范围扩大": S2 radius 1.5 (PRTS 溅射半径一览; ×1.3 [ASSUMED] until 0.1.1); 感知稳定 picks among the
//                owner's deployed casters (none ⇒ no buff).
//  6_13 新约能天使 bombardment radius 1 tile (not in data).
//  6_14 流明     S3 heals an abnormal ally even at full HP (forced heal); 抵抗 = the engine `resist` status.
//  6_15 仇白     入隙 reads the target's sluggish/bind statuses; module adds 10 % ATK arts per hit.
//  6_16 溯光星源 link transfers the pre-mitigation arts amount × share to the other locked target(s); 能源解析 = the
//                脆弱 status (同名效果取最高).
//  6_17 耀骑士临光 "上一名部署干员" = the op of the same owner deployed right before her (deploy order).
//  6_18 荒芜拉普兰德 S3 drones are virtual (fx events) flying PRTS's 技能流程 (spread attack@times s, chase 2.0 → 4.0
//                tiles/s; [ASSUMED] the turn rate is not modelled: straight at the target); every drone is out, so she
//                makes no normal attack herself, while each drone on its target attacks like a normal drone (her attack
//                interval, ATK × its own funnel ramp; neither attack nor skill damage — PRTS 备注); 头狼 stage 2
//                "特殊能力失效" = silence; stage 3 = +1 drone (normal attacks hit once more; S3 releases one more drone,
//                mid-skill too). Base drone count 1.
//  6_19 锏       10 slashes every d_hit_interval, pulls every p_hit_interval, final blow (skill range) at the end;
//                S3 slashes and pulls air units too (PRTS 备注 "可对空"; a 静态刚体 — every drone of the mode — is hit
//                but stays put: Battle._displaceable).
//  6_20 纯烬艾雅法拉 5 shots are padded by cycling targets when fewer injured allies exist.
//
// Operator loadouts (DESIGN §16): every visible chess also authors its selectable NON-default skills in `skills`
// ({ [skillId]: SkillSpec }, built from the SELECTED skill's `bb`: normal Lv4 / elite Lv7; triggers from that skill's
// data). Talent / install hooks written for the default skill check `onDefaultSkill(chess)` (余 闲云隐市 for all, 维娜
// S3 targets, 焰影苇草 灼痕 until the skill ends, 流明 S3 bullets, 溯光星源 S3 locks, 耀骑士临光 S3 true damage, 缪尔赛思
// S3 bind, 浊心斯卡蒂 tide). Module choices read the loadout-resolved record (trait.bb, talents, hidden module parts);
// the module-specific code: 浊心斯卡蒂 新生代, 维娜 秩序圣“球”, 焰影苇草 “独属自己的一隅”, 塑心 音乐家的旅程, 缪尔赛思
// 落叶四季, 仇白 欲雪时, 耀骑士临光 “骑士家族”, 锏 新合同, 纯烬艾雅法拉 想要留下的生命 (生息演算 / 集成战略-only parts of
// the RA / IS modules are not modelled). Alternate-skill simplifications:
//  6_01 S2 the aim (disarmed meanwhile) spends its bullet when it begins; target = a wanted enemy (lowest DEF first).
//  6_02 S1 casts with an enemy in her range (data SEARCH read as "search in range" [ASSUMED]; the engine SEARCH =
//       any enemy on the field wasted both charges); the snow spreads along her facing line (≤ trig_cnt tiles);
//       S2 "目标点变为冻结状态" = the frozen 保护目标 token (icetgt, one at a time) on a protection point (goal tile) reaching
//       max snow, deploy attributes ignored, whose snow is used up (PRTS 备注; until 0.1.3 any standable tile froze, never the
//       gate); spreads go to the thinnest 4-neighbour; the 20 % DoT ticks once per second.
//  6_03 S2 teleport = the ground-reachable (grid path) enemies of the skill grid moved onto his tile, in the cast's
//       tick (PRTS: 0.13 s after the damage), leaders included unless 自缚.
//  6_04 S1 transfer: the ally takes ×(1 − share), she takes the rest as true damage from the attacker; module 新生代
//       "30点伤害减免" = +30 effective DEF (physical) / −30 ÷ (1 − RES) before mitigation (arts).
//  6_06 S2 the ASPD stacks last the whole battle; S1 "异常状态时可以释放" = cleanse + cast (tick check).
//  6_07 S2 passive counts the OTHER allies of the talent-1 area.
//  6_08 S2 carriers = operators of her range (ground first, then lowest HP); a fireball shoots an enemy of the carrier's
//       range (else hers).
//  6_09 S2 partner = the highest-ATK other operator of her range (re-picked every 0.5 s); S3 picks by base stats.
//  6_11 S1 one DP every interval, the remainder when it ends; module 落叶四季 "援军阻挡的敌人更容易受到我方的攻击" = the
//       流形 variant's taunt_level (+1) on the enemies it blocks.
//  6_05 S2 / 6_12 S3 base_attack_time scales the base attack time (akdata "乘算负数"); see batOf.
//  6_12 S1 the extra arts hit lands on the main + splash victims (not the aftershocks).
//  6_13 S1 "主动关闭" = skill.stop(); S3 the 投递坐标 (the player's pick) goes next to the first enemy entering her range
//       (at the latest when S3 starts); delivered = the knocked-out non-ranged operator of hers with the latest
//       respawnAt; the bombardment radius is AIRSTRIKE_RADIUS.
//  6_14 S1 the HoT covers the allies within 1.5 tiles of the healed target; S2 "蓄力" = cast with every charge full.
//  6_15 S1 the bind-end explosion radius is 1.2 tiles [ASSUMED].
//  6_16 S1 bounces are full hits within attack@projectile_range, never on the same enemy twice in a row.
//  6_18 S1 "非移动敌人" = blocked / not walking / immobilised enemies; S2 every drone ramps on its own target.
//  6_20 S2 the barrier is one pool over her range at the cast, absorbing gauge fills (before 元素抗性).
//
// Summons: skill summons (黄金盟誓, “耀阳”) are spawned without a kit so content/tokens.js's token kit applies (true
// damage / appear burst / lifetime); the fallbacks here only run when no token kit exists (`kit.fromTokens`).
// Owner-coupled behaviour of placeable summons (海嗣 aura/lifetime/redeploy, 流形 copy/steal/split/respawn) lives in
// these kits — tokens.js skips it for summoners with a hand-authored kit (its `managed()` rule).
// Engine notes: "extra targets" (蕾缪安 wanted, 维娜 S3) use the engine's extra range keys (`battle.setExtraRange`,
// merged into every range rebuild); 海嗣 / 流形 extend their summoner's DEFAULT trigger through
// `skill.addTriggerRange`; element-type damage skips the `hit` hook, so element (损伤) amplification uses the
// `elementHit` hook (`onElementHit`: × dmg.mul before the gauge fill).

import { absoluteRangeKeys, sortEnemyTargets, canTargetEnemy, aggroCmp } from '../../targeting.js';
import { aggregateMods } from '../../buffs.js';
import { COLS, ROWS, PULL_STOP_RADIUS, CHAIN_RADIUS } from '../../constants.js';
import { rotateOffset } from '../../dir.js';
import { bodyDist, bodyInKeys, bodyKeys } from '../../body.js';
import { hasHp } from '../../damage.js';
import { summonToken, TOKEN_IDS } from '../tokens.js';

// ------------------------------------------------------------------------------------------------------------------
// helpers

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** Blackboard value by exact key, else the first key ending with `.key` / `]key` (prefixed official keys). */
function bv(bb, key, d = 0) {
  if (!bb) return d;
  const v = bb[key];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  for (const k of Object.keys(bb)) {
    if (k.endsWith('.' + key) || k.endsWith(']' + key)) {
      const x = bb[k];
      if (typeof x === 'number' && Number.isFinite(x)) return x;
    }
  }
  return d;
}
const tbb = (def, i) => (def && def.talents && def.talents[i] && def.talents[i].bb) || {};
const tdesc = (def, i) => String((def && def.talents && def.talents[i] && def.talents[i].description) || '');
/** Module-only (hidden, index −1) talent parts of a chess record, merged (first occurrence wins). */
function moduleBb(chess) {
  const out = {};
  for (const t of (chess && chess.talents) || []) {
    if (!t || t.index !== -1 || !t.bb) continue;
    for (const [k, v] of Object.entries(t.bb)) if (!(k in out)) out[k] = v;
  }
  return out;
}
const parseN = (text, re, d) => { const m = String(text ?? '').match(re); return m ? +m[1] : d; };
const live = (u) => !!u && u.alive && u.deployed && !u.removed && !u.hidden;
const isElite = (e) => !!e && (e.isBoss || e.def?.rank === 'ELITE' || e.def?.rank === 'BOSS');
const hasBond = (u, id) => !!(u && u.def && Array.isArray(u.def.bonds) && u.def.bonds.includes(id));
const keyOf = (u) => Math.round(u.y) * COLS + Math.round(u.x);
const opsOf = (battle, ownerId) => battle.allies(ownerId).filter((a) => a.kind === 'op');
const ANY = Object.freeze({ canHitFly: true });
const enemiesIn = (battle, unit, keys) => battle.enemiesInKeys(keys || unit.rangeKeys || [], unit, ANY);
const isTok = (t, id, owner) => !!t && t.kind === 'token' && t.defId === id && t.ownerUnit === owner;

/**
 * Whether the SELECTED skill of a loadout-resolved chess record is its default skill (DESIGN §16: `chess.skill` is the
 * selected SkillRecord, `chess.skills[]` flags the default one). Records without skill choices count as default.
 * Talent / install hooks written for the default skill check it (they run under every selected skill).
 */
function onDefaultSkill(chess) {
  const d = (chess?.skills ?? []).find((s) => s && s.isDefault);
  return !d || !chess?.skill || d.skillId === chess.skill.skillId;
}
/** Id of the selected skill (loadout-resolved record, else the def). */
const selectedSkill = (chess, def) => chess?.skill?.skillId ?? def?.skill?.id ?? null;
/**
 * Skill blackboard `base_attack_time` → engine batPct, the rule of the AK damage calculator (akdata attributes.js,
 * checked against the game): a shortening (v < 0) is a FLAT change of the base attack time in seconds (送葬人 −0.5 on
 * 2.3 s ⇒ 1.8 s, the tier1 `batMod` convention), a lengthening (v > 0) scales it (迷迭香 S2 +0.5 ⇒ ×1.5, 佩佩 S3 +0.2 ⇒
 * ×1.2). `mul` = a skill the calculator lists as "攻击间隔缩短，但是是乘算负数" (异客 S2 −0.3 ⇒ ×0.7, 迷迭香 S3 −0.5 ⇒ ×0.5).
 */
function batOf(v, def, mul = false) {
  const x = num(v);
  if (!x) return 0;
  if (x > 0 || mul) return Math.max(-0.9, x);
  const bat = num(def?.stats?.bat, 1) || 1;
  return Math.max(-0.9, x / bat);
}
/** Spec kind of an instant skill (charges when the data gives it several). */
const instantKind = (def) => ((def?.skill?.maxCharges ?? 1) > 1 ? 'charges' : 'instant');
/** The selected skill's own range grid (null: the unit's range). */
const skillGridOf = (def) => (def?.skill?.rangeGrid?.length ? def.skill.rangeGrid : null);

/** 深海猎人 (character_table groupId "abyssal" — checked against the official table; data/chess.json has no group id). */
const ABYSSAL = new Set(['char_143_ghost', 'char_263_skadi', 'char_474_glady', 'char_4145_ulpia', 'char_1023_ghost2']);
/** 莱茵生命 (character_table groupId "rhine") members of this season's pool (checked against the official table). */
const RHINE = new Set(['char_108_silent', 'char_128_plosis', 'char_202_demkni', 'char_249_mlyss', 'char_1047_halo2']);
/**
 * 异常状态 (ba.debuff "包括晕眩、寒冷、冻结等") — the control statuses cleansed by 流明 (抵抗 itself is the engine `resist`
 * status: RESIST_STATUSES). Stat debuffs (虚弱/脆弱/…) are not 异常状态.
 */
const ABNORMAL = new Set(['stun', 'freeze', 'cold', 'sleep', 'silence', 'fear', 'attract', 'tremble', 'bind', 'levitate',
  'disarm', 'palsy', 'sluggish', 'slow']);
const hasAbnormal = (u) => u.buffs.some((b) => b.status && ABNORMAL.has(b.status));
/** Remove every 异常状态 of `u`; returns how many were removed. */
function cleanseAbnormal(battle, u) {
  let n = 0;
  for (const b of u.buffs.slice()) if (b.status && ABNORMAL.has(b.status)) { battle.removeStatus(u, b.status); n++; }
  if (n) battle.fx('cleanse', { x: u.x, y: u.y, id: u.id });
  return n;
}
/**
 * "传送至自身位置": a ground enemy that can reach `unit`'s tile on the ground grid is moved onto it (unblocked, its
 * route re-planned from there — the engine then blocks it on that tile when capacity allows). Flyers stay, and so does a
 * 自缚 unit (flag `selfBound`: 守墓石像's 转换模式, the 7 huge leaders, the 胄 parts' anchor): PRTS 余 S2 备注 "处于消失状态的/
 * 持有自缚的单位不视为可达目标" (束缚 alone does not exempt it, so not `noMove`). Being a leader is no exemption: PRTS gives
 * 卢西恩 and 假想敌：铳 (both sections) 传送抗性 无 — they are teleported like any ground enemy and walk on from his tile (a
 * patrol keeps looping: content/bosses.js patrolLoop). 静态刚体 forbids physical movement, not a teleport (the 备注 names
 * only 消失 / 自缚 / 免疫传送); every 静态刚体 of the mode flies or is 自缚 anyway.
 */
function teleportEnemy(battle, unit, e) {
  if (!e || !e.alive || e.isFlying || e.s.flags.selfBound) return false;
  const r = unit.tileR, c = unit.tileC;
  if (!battle.grid.groundPassable(r, c)) return false;
  const er = Math.round(e.y), ec = Math.round(e.x);
  if ((er !== r || ec !== c) && !battle.grid.findPath(er, ec, r, c)) return false;
  e.x = c; e.y = r;
  battle._unblock(e);
  if (e.route) e.route.pts = null;
  battle.fx('teleport', { x: c, y: r, id: e.id, src: unit.id });
  return true;
}
const AROUND8 = Object.freeze([[1, -1], [1, 0], [1, 1], [0, -1], [0, 1], [-1, -1], [-1, 0], [-1, 1]]);
const N4 = Object.freeze([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]);
/** Every offset of the 19×21 field: "攻击范围扩大至整个战场". */
const WHOLE_FIELD = (() => {
  const g = [];
  for (let dr = -(ROWS - 1); dr <= ROWS - 1; dr++) for (let dc = -(COLS - 1); dc <= COLS - 1; dc++) g.push([dr, dc]);
  return Object.freeze(g);
})();

const STATE = new WeakMap();
/** Per-battle shared state for kits (trackers registered once per battle). */
function bstate(battle) {
  let s = STATE.get(battle);
  if (!s) { s = {}; STATE.set(battle, s); }
  return s;
}

/**
 * Free deployable tiles of `grid` around `unit` (melee ground tiles unless `ranged`). Skips `battle.isReservedTile`
 * (a living unit, or the home tile of a piece that has not deployed yet / waits to redeploy: a summon parked there
 * would keep that operator off the field).
 */
function freeTiles(battle, unit, grid, { ranged = false, ground = true } = {}) {
  const out = [];
  const own = unit.tileR * COLS + unit.tileC;
  for (const k of absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0)) {
    if (k === own) continue;
    const r = (k / COLS) | 0, c = k % COLS;
    if (!battle.grid.inRect(r, c) || battle.isReservedTile(r, c)) continue;
    if (!battle.grid.canStand(r, c, { ranged })) continue;
    if (ground && !battle.grid.groundPassable(r, c, true)) continue;
    out.push([r, c]);
  }
  return out;
}

/** Tile closest to any living enemy (first tile when there is no enemy). */
function bestTile(battle, tiles) {
  if (!tiles.length) return null;
  const en = battle.enemies.filter((e) => e.alive && !e.hidden);
  if (!en.length) return tiles[0];
  let best = tiles[0], bd = Infinity;
  for (const t of tiles) {
    let d = Infinity;
    for (const e of en) d = Math.min(d, Math.hypot(e.x - t[1], e.y - t[0]));
    if (d < bd - 1e-9) { bd = d; best = t; }
  }
  return best;
}

/** Barrier of `total` HP decaying linearly to 0 over `dur` seconds. */
function decayingShield(battle, u, key, total, dur) {
  if (!(total > 0)) return null;
  const decays = dur > 0;
  return battle.addBuff(u, {
    key, shield: total, duration: decays ? dur : Infinity, visible: true, interval: decays ? 0.5 : 0,
    onTick: decays ? ({ unit, buff }) => { buff.shield = Math.max(0, buff.shield - (total * 0.5) / dur); unit.markDirty(); } : null,
  });
}

/**
 * Element (损伤) amplification: element gauge fills skip the `hit` hook but fire `elementHit` { source, target, dmg }
 * before the fill — multiply `dmg.mul` there (one instance, exact burst threshold). `fn(ctx)` returns the factor.
 */
function onElementHit(battle, unit, fn) {
  battle.on('elementHit', (ctx) => {
    if (!ctx.dmg || ctx.dmg.type !== 'element' || !ctx.target) return;
    const f = fn(ctx);
    if (Number.isFinite(f) && f > 0 && f !== 1) ctx.dmg.mul *= f;
  }, { owner: unit });
}

/** Deal `amount` of element `el` (元素损伤) — nothing on a target at 0 HP (a lethal hit's `damaged` hook, see hasHp). */
const elementDmg = (battle, src, tgt, el, amount, tags = ['skill']) =>
  (amount > 0 && hasHp(tgt) ? battle.dealDamage(src, tgt, { type: 'element', element: el, amount, tags }) : 0);

/**
 * 鼓舞 (ba.inspire "获得额外附加的基础属性加成（同类属性取最高）"): +`val` ATK after the target's own multipliers (flat
 * compensated), strongest source wins. Units flagged `mem.noInspire` (浊心斯卡蒂 "自身不受鼓舞影响") never receive it.
 */
function inspire(battle, target, val, src, stat = 'atk') {
  if (!(val > 0) || !live(target) || target.mem.noInspire) return;
  const key = stat === 'def' ? 'inspire:def' : 'inspire';
  const cur = target.findBuff(key);
  if (cur && cur.data && cur.data.src !== src.id && cur.data.val > val && cur.timeLeft > 0.1) return;
  const { add, mul } = aggregateMods(target.buffs.filter((b) => b.key !== key));
  const f = stat === 'def'
    ? Math.max(0, 1 + (add.defPct ?? 0)) * (mul.defMul ?? 1)
    : Math.max(0, 1 + (add.atkPct ?? 0)) * (mul.atkMul ?? 1);
  const flat = f > 1e-6 ? val / f : val;
  battle.addBuff(target, { key, mods: stat === 'def' ? { defFlat: flat } : { atkFlat: flat }, duration: 0.75, refresh: 'replace', source: src, visible: true, data: { src: src.id, val } });
}

/** Deploy-order tracker: last op deployed per owner (read before the update by priority-0 deploy handlers). */
function ensureDeployTracker(battle) {
  const S = bstate(battle);
  if (S.lastOp) return S.lastOp;
  S.lastOp = new Map();
  battle.on('deploy', ({ unit }) => { if (unit.kind === 'op') S.lastOp.set(unit.ownerId, unit); }, { priority: -100 });
  return S.lastOp;
}

/**
 * Pull `e` with 力度 `force` towards the point / unit `unit` ("向自己中心…拖拽", "拉向目标所在位置"), stopping `stop` tiles
 * from it — Battle.pull: the official 力度 − 重量 pull (PRTS 推与拉; user playtest #6 item 14). The default stop is the
 * 急停 radius 0.6708 around a pulling unit. A pulling ally is also the pull's `center`, so an enemy it blocks itself
 * stays where it is held (as in Battle.pullToFront) — e.g. the 流形 S3 pulse then still stuns it.
 */
function pullToward(battle, unit, e, force, stop = PULL_STOP_RADIUS) {
  if (!e || !e.alive || !unit) return 0;
  return battle.pull(e, num(force), { to: { x: unit.x, y: unit.y }, center: unit.side === 'ally' ? unit : null, stop });
}

/** Stat-aura pulse: short buffs refreshed every `period` s on `targets()`. */
function aura(battle, unit, period, fn) {
  battle.every(period, () => { if (live(unit)) fn(); }, { owner: unit });
}

// ------------------------------------------------------------------------------------------------------------------
// 盟约·辅助干员 chess_char_1_15 (巫役) — S1 战术咏唱·双型; 迭代元素

/** 迭代元素's elements in the order they are applied: 神经损伤 "（优先）", then 灼燃损伤, then 凋亡损伤. */
export const PITHST_ELEMENTS = Object.freeze(['neural', 'burn', 'apoptosis']);

/**
 * 迭代元素 "攻击同时附带18%攻击力的神经损伤（优先）、灼燃损伤、凋亡损伤；优先攻击未处于损伤爆发的目标":
 *   * timing = every damage she deals (PRTS 盟约·辅助干员 corrects "攻击同时" to "造成伤害时"): HP damage > 0 — a dodged
 *     or fully absorbed hit deals none; her own element fills and the bursts they cause never re-trigger it; a killing
 *     blow attaches nothing (the target is dead — no burst on the corpse);
 *   * each such damage attaches ep_damage_ratio × ATK of ALL THREE elements, 神经 first, then 灼燃, then 凋亡 (user
 *     playtest #5 #3: the kit used to pick one element "not bursting" — but a burst's 爆发冷却 locks every gauge of the
 *     unit, so it only ever filled 神经). PRTS 元素: when one unit applies several elements that would each fill their
 *     gauge, the element applied first bursts — from her alone 神经 bursts (the "（优先）"), while her 灼燃 / 凋亡 add to
 *     the gauges the team builds (余, 塑心 …). [ASSUMED: simultaneous application — the reading of the official text]
 *   * elite module RIT-X "对精英和领袖敌人造成的元素损伤提升18%" = ep_damage_ratio_boss (0.2124) vs ELITE / BOSS enemies:
 *     a talent ratio, not an "元素损伤提升" (PRTS 备注), so it changes nothing else she deals (e.g. a 灼燃维式重锤).
 * The target pick prefers enemies not in a burst (`priority: 'notBurst'`).
 */
function pithst(bb, chess, def) {
  const t0 = tbb(def, 0);
  const ratio = num(t0.ep_damage_ratio);
  const ratioBoss = num(t0.ep_damage_ratio_boss, ratio);
  return {
    skill: {
      kind: 'duration',
      mods: { aspd: num(bb.attack_speed) },
      targeting: { maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 1))) },
    },
    trait: { priority: 'notBurst' },
    install(battle, unit) {
      if (!(ratio > 0)) return;
      battle.on('damaged', (ctx) => {
        const t = ctx.target, d = ctx.dmg;
        // hasHp: a killing blow attaches nothing (the hook runs before battle.kill, see hasHp)
        if (ctx.source !== unit || !t || t.side !== 'enemy' || !hasHp(t) || !(ctx.amount > 0)) return;
        if (ctx.type === 'element' || ctx.type === 'elemental' || (d && d.tags && d.tags.includes('burst'))) return;
        const amount = unit.s.atk * (isElite(t) ? ratioBoss : ratio);
        for (const el of PITHST_ELEMENTS) elementDmg(battle, unit, t, el, amount, ['talent', 'pithst']);
      }, { owner: unit });
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 蕾缪安 chess_char_6_01 (神射手) — S3 礼炮·强制追思; 跨境追缉许可; 逃犯引渡手续

/** S3 bombardment: one shell every 0.3 s after the skill ends, for at most 10 s (PRTS S3 note, not in the data). */
const LEMUEN_SHELL_INTERVAL = 0.3;
const LEMUEN_SHELL_WINDOW = 10;
/**
 * Shell flight time [ASSUMED]: the first bombardment lands one interval after the skill ends, so every shell of the
 * PRTS count (≤ 33 in the 10 s window) lands inside it; the renderer draws the shell over this time (fx bombardShell).
 */
const LEMUEN_SHELL_FLIGHT = 0.3;

function ensureWanted(battle) {
  const S = bstate(battle);
  if (S.wanted) return S.wanted;
  const W = S.wanted = { lemuens: new Set(), time: new WeakMap() };
  const activeLem = () => [...W.lemuens].filter(live);
  battle.every(0.25, () => {
    const lems = activeLem();
    if (!lems.length) return;
    const need = Math.min(...lems.map((u) => u.mem.wantedInterval));
    const lat = battle.allyUnits.filter((a) => live(a) && a.kind === 'op' && hasBond(a, 'lateranoShip'));
    for (const e of battle.enemies) {
      if (!e.alive || e.hidden || !isElite(e) || e.findBuff('lemuen:wanted')) continue;
      // "停留超过8秒": a continuous stay — leaving every 拉特兰 range restarts the count
      if (!lat.some((a) => a.rangeKeySet && bodyInKeys(e, a.rangeKeySet))) { W.time.delete(e); continue; }
      const t = (W.time.get(e) ?? 0) + 0.25;
      W.time.set(e, t);
      if (t >= need - 1e-9) {
        battle.addBuff(e, { key: 'lemuen:wanted', visible: true });
        battle.fx('wanted', { x: e.x, y: e.y, id: e.id });
      }
    }
  });
  battle.on('hit', (ctx) => {
    const s = ctx.source, t = ctx.target;
    if (!s || !t || s.side !== 'ally' || t.side !== 'enemy' || !hasBond(s, 'lateranoShip')) return;
    if (!ctx.dmg.isAttack && !ctx.dmg.isSkill) return;
    if (!t.findBuff('lemuen:wanted')) return;
    const lems = activeLem();
    if (lems.length) ctx.dmg.mul *= Math.max(...lems.map((u) => u.mem.wantedScale));
  });
  return W;
}

function lemuen(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const aim = Math.max(0.05, num(bb['attack@aim_interval'], 0.5));
  const d1 = num(bb['attack@dist_1'], 0.8);
  const d2 = num(bb['attack@dist_2'], num(bb['attack@projectile_range'], 1.5));
  const s1 = num(bb['attack@proj_atk_scale_1'], 1), s2 = num(bb['attack@proj_atk_scale_2'], 1);
  const pickLock = (battle, unit, locks) => {
    const cands = battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile);
    if (!cands.length) return null;
    sortEnemyTargets(battle, unit, cands, 'lowDef');
    const cnt = (e) => locks.reduce((n, L) => n + (L.e === e ? 1 : 0), 0);
    let best = null;
    for (const e of cands) if (!best || cnt(e) < cnt(best)) best = e;
    return best;
  };
  // S3 bombardment (PRTS 蕾缪安 S3 note — the timing is not in the blackboard): after the skill ends ONE shell every
  // LEMUEN_SHELL_INTERVAL s, in lock order, on a random point of the square of side 2 × emit_offset (PRTS "边长0.4",
  // emit_offset 0.2) around its lock mark — the locked enemy while it is on the field ("持续追踪锁定目标"), else the spot
  // it left ("锁定标记会留在原地") — landing LEMUEN_SHELL_FLIGHT s later; each shell hits every enemy within dist_2 once
  // (limited_hit_time 1): proj_atk_scale_1 × ATK within dist_1 of its point, proj_atk_scale_2 × ATK beyond, all with the
  // ATK cached when the skill ended ("缓存攻击力"); at most LEMUEN_SHELL_WINDOW s of shells ("最多产生33次轰炸").
  const spread = Math.max(0, num(bb['attack@emit_offset'], 0.2));
  const markOf = (L) => {
    const e = L.e;
    if (!L.gone && (!e.alive || !e.hidden)) { L.x = e.x; L.y = e.y; if (!e.alive) L.gone = true; }
    return L;
  };
  const blast = (battle, unit, atk, x, y) => {
    battle.fx('bombard', { x, y, id: unit.id, r: d2 });
    for (const e of battle.foesInRadius(x, y, d2)) {
      if (e.s.flags.untargetable) continue;
      const d = bodyDist(e, x, y);
      battle.dealDamage(unit, e, { amount: atk * (d <= d1 + 1e-9 ? s1 : s2), type: 'phys', isSkill: true, isSplash: true, tags: ['skill', 'bombard'] });
    }
  };
  const bombard = (battle, unit, locks) => {
    const atk = unit.s.atk;
    const seq = unit.deploySeq;
    const n = Math.min(locks.length, Math.floor(LEMUEN_SHELL_WINDOW / LEMUEN_SHELL_INTERVAL + 1e-9));
    const fire = (i) => {
      // knocked out / withdrawn after the skill ended: the shells not fired yet are dropped (those in the air land)
      if (!(unit.alive && unit.deployed && unit.deploySeq === seq)) return;
      const L = markOf(locks[i]);
      // the random offset is drawn in her facing frame (the square turns onto itself): a turned board plays alike
      const [oy, ox] = rotateOffset(battle.rng.range(-spread, spread), battle.rng.range(-spread, spread), unit.dir);
      const x = L.x + ox, y = L.y + oy;
      battle.fx('bombardShell', { x, y, id: unit.id, r: d2, t: LEMUEN_SHELL_FLIGHT, i });
      battle.after(LEMUEN_SHELL_FLIGHT, () => blast(battle, unit, atk, x, y), { owner: unit });
      if (i + 1 < n) battle.after(LEMUEN_SHELL_INTERVAL, () => fire(i + 1), { owner: unit });
    };
    if (n > 0) fire(0);
  };
  // S2 归乡邀约: aimed snipe at a wanted enemy — ATK scale ramps main → fin by ex every interval (at most trig_cnt
  // steps, aim_duration s), fired early once ATK × scale > the target's HP + DEF; ignores dodge; one bullet per aim
  const aimS = {
    main: num(bb['attack@main_atk_scale'], 1), ex: num(bb['attack@ex_atk_scale']), fin: num(bb['attack@fin_atk_scale'], 1),
    iv: Math.max(0.05, num(bb['attack@interval'], 0.25)), steps: Math.floor(num(bb['attack@trig_cnt'], 10)), dur: num(bb['attack@aim_duration'], 2.5),
  };
  const endAim = (battle, unit) => { unit.mem.lemAim = null; battle.removeBuff(unit, 'lemuen:aim'); };
  const skills = {
    // S1 重逢问候: ammo 5, attacks at attack@atk_scale × ATK on one extra target
    skchr_lemuen_1: {
      kind: 'ammo',
      ammo: Math.max(1, Math.floor(num(bb['attack@trigger_time'], 5))),
      attack: { atkScale: num(bb['attack@atk_scale'], 1) },
      targeting: { maxTargets: 2 },
    },
    skchr_lemuen_2: {
      kind: 'ammo',
      ammo: Math.max(1, Math.floor(num(bb['attack@trigger_time'], 6))),
      mods: { aspd: num(bb.attack_speed), atkPct: num(bb.atk) },
      onStart({ battle, unit }) { endAim(battle, unit); },
      onTick({ battle, unit, skill, dt }) {
        const m = unit.mem;
        let A = m.lemAim;
        if (A && (!A.e.alive || A.e.hidden || !A.e.findBuff('lemuen:wanted'))) { endAim(battle, unit); A = null; }
        if (!unit.canAct) return;
        if (!A) {
          const cands = battle.enemies.filter((e) => e.alive && !e.hidden && e.findBuff('lemuen:wanted') && canTargetEnemy(unit, e, ANY));
          if (!cands.length || skill.ammoLeft <= 0) return;
          sortEnemyTargets(battle, unit, cands, 'lowDef');
          A = m.lemAim = { e: cands[0], t: 0 };
          battle.addBuff(unit, { key: 'lemuen:aim', flags: { disarm: true } }); // aiming: no normal attack meanwhile
          skill.ammoLeft--;                                                      // "消耗子弹对其瞄准"
          battle.emit('ammoUsed', { unit, left: skill.ammoLeft, skill });
          battle.fx('lock', { x: A.e.x, y: A.e.y, id: A.e.id, src: unit.id });
        }
        A.t += dt;
        const scale = Math.min(aimS.fin, aimS.main + aimS.ex * Math.min(aimS.steps, Math.floor((A.t + 1e-9) / aimS.iv)));
        const e = A.e;
        if (A.t + 1e-9 < aimS.dur && !(unit.s.atk * scale > e.hp + e.s.def)) return;
        endAim(battle, unit);
        battle.fx('crit', { x: e.x, y: e.y, id: e.id, src: unit.id });
        battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', canDodge: false, isSkill: true, tags: ['skill', 'snipe'] });
        if (skill.active && skill.ammoLeft <= 0) skill.end('ammo');
      },
      onEnd({ battle, unit }) { endAim(battle, unit); },
    },
  };
  return {
    skills,
    skill: {
      kind: 'ammo',
      ammo: Math.max(1, Math.floor(num(bb['attack@trigger_time'], 5))),
      attack: { noAttack: true },
      onStart({ unit }) { unit.mem.lemLocks = []; unit.mem.lemAcc = aim; },
      onTick({ battle, unit, skill, dt }) {
        const m = unit.mem;
        if (!m.lemLocks) return;
        for (const L of m.lemLocks) markOf(L);
        if (!unit.canAct) return;
        m.lemAcc += dt;
        if (m.lemAcc + 1e-9 < aim) return;
        m.lemAcc -= aim;
        const e = pickLock(battle, unit, m.lemLocks);
        if (!e) { if (m.lemLocks.length) skill.end('ammo'); return; }
        m.lemLocks.push({ e, x: e.x, y: e.y });
        battle.fx('lock', { x: e.x, y: e.y, id: e.id, src: unit.id });
        skill.ammoLeft--;
        battle.emit('ammoUsed', { unit, left: skill.ammoLeft, skill });
        if (skill.active && skill.ammoLeft <= 0) skill.end('ammo');
      },
      onEnd({ battle, unit, reason }) {
        // the shells follow one by one after the end (bombard); knocked out / withdrawn mid-lock ('death'): none
        const locks = unit.mem.lemLocks || [];
        unit.mem.lemLocks = null;
        if (reason !== 'death' && unit.alive) bombard(battle, unit, locks);
      },
    },
    // elite module: "攻击的敌人未被击倒时自身额外获得1点技力"
    trait: num(tb.sp) > 0 ? {
      afterHit(battle, unit, target) { if (target && target.alive && unit.skill && !unit.skill.active) unit.skill.gainSp(num(tb.sp), 'trait'); },
    } : null,
    talents: [
      { install(battle, unit) { // 跨境追缉许可
        unit.mem.wantedInterval = num(t0.interval, 8);
        unit.mem.wantedScale = num(t0.damage_scale, 1);
        ensureWanted(battle).lemuens.add(unit);
        let sig = null;
        battle.on('tick', () => { // wanted targets' tiles join her range (engine extra range keys, kept across rebuilds)
          if (!live(unit)) return;
          const keys = [];
          for (const e of battle.enemies) if (e.alive && !e.hidden && e.findBuff('lemuen:wanted')) keys.push(...bodyKeys(e));
          const s = keys.join(',');
          if (s === sig) return;
          sig = s;
          battle.setExtraRange(unit, keys);
        }, { owner: unit });
      } },
      { install(battle, unit) { // 逃犯引渡手续
        const iv = num(t1.interval, 20), atk = num(t1.atk), add = Math.floor(num(t1.add_count)), exAdd = Math.floor(num(t1.ex_add_count));
        const ready = () => live(unit) && battle.time - unit.deployedAt >= iv - 1e-6;
        battle.on('deploy', ({ unit: u }) => {
          if (u !== unit) return;
          const seq = unit.deploySeq;
          battle.after(iv, () => {
            if (!live(unit) || unit.deploySeq !== seq) return;
            if (atk) battle.addBuff(unit, { key: 'lemuen:extradition', mods: { atkPct: atk } });
            battle.fx('talent', { x: unit.x, y: unit.y, id: unit.id, name: 'extradition' });
          }, { owner: unit });
        }, { owner: unit });
        battle.on('skillStart', ({ unit: u, skill }) => {
          if (!ready() || !skill || skill.kind !== 'ammo') return;
          if (u === unit) { if (add > 0) skill.addAmmo(add); }
          else if (exAdd > 0 && u.side === 'ally' && u.kind === 'op' && hasBond(u, 'lateranoShip')) skill.addAmmo(exAdd);
        }, { owner: unit });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 圣聆初雪 chess_char_6_02 (阵法术师) — S3 群山俯首; 无垠的雪景; 圣山的祝福; module 千分之一的心

function sbell2(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), mod = moduleBb(chess);
  const skillGrid = def?.skill?.rangeGrid?.length ? def.skill.rangeGrid : null;
  const maxL = Math.max(1, Math.floor(num(t0.max_cast_cnt, 5)));
  const iceId = (chess?.tokens || []).find((t) => /icetgt/.test(String(t))) || 'token_10058_sbell2_icetgt';
  /**
   * S2 霜涛覆岭 while it runs (`unit.mem.sbellS2`): a layer landing on a tile already at max snow spreads one layer to
   * a neighbouring ground tile (at most max_cast_tile_count spreads per activation); ground enemies on snow take
   * s2_magic_scale × ATK arts per second; an enemy leaving snow gets `cold` s of 寒冷; "积雪在目标点积累至5层时，使目标点变为
   * 冻结状态": a protection point (the blue gate) reaching max snow turns into the frozen 保护目标 (freezeTile).
   */
  const addSnow = (battle, unit, k) => {
    const snow = unit.mem.snow;
    if (!snow) return false;
    const r = (k / COLS) | 0, c = k % COLS;
    if (!battle.grid.inRect(r, c) || !battle.grid.groundPassable(r, c, true)) return false;
    // PRTS 备注 "存在自身的该召唤物的地块不会积雪"
    if (battle.allyUnits.some((t) => isTok(t, iceId, unit) && t.alive && t.tileR === r && t.tileC === c)) return false;
    const S2 = unit.mem.sbellS2;
    const cur = snow.get(k) ?? 0;
    // a protection point already at max snow (its freeze waited for her other token to go) freezes on its next layer
    if (S2 && cur >= maxL && freezeTile(battle, unit, k)) return true;
    if (cur >= maxL) {
      if (!S2 || S2.spreadLeft <= 0) return false;
      // "积雪超过5层时会向周围扩散一层": the thinnest neighbouring ground tile gets the layer
      let best = null, bl = Infinity;
      for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const nr = r + dr, nc = c + dc;
        if (!battle.grid.inRect(nr, nc) || !battle.grid.groundPassable(nr, nc, true)) continue;
        const L = snow.get(nr * COLS + nc) ?? 0;
        if (L < maxL && L < bl) { bl = L; best = nr * COLS + nc; }
      }
      if (best == null) return false;
      S2.spreadLeft--;
      return addSnow(battle, unit, best);
    }
    snow.set(k, cur + 1);
    if (S2 && cur + 1 >= maxL) freezeTile(battle, unit, k);
    return true;
  };
  /**
   * "使目标点变为冻结状态" — PRTS 圣聆初雪 S2 备注: "目标点冻结的实际效果为令圣聆初雪在该地块上召唤一个保护目标（冻结状态）（无视部署
   * 属性），并去除相应地块上的积雪", "可以被'变为冻结状态'的目标点包括常规的保护目标点与促融共竞的保护目标点"; the token's page:
   * "技能发动后于保护目标叠加5层积雪". So only a protection point (a goal tile, glyph E) freezes, whatever its deploy attributes
   * (nobody may stand on a gate): her token icetgt (blocks 3; one at a time, maxDeployCount 1) appears on it and blocks the
   * enemies walking in, and that tile's snow is used up. Until 0.1.3 (community report #32): any free tile a melee
   * operator could stand on froze at max snow, and the gate never did. Returns true when the token appeared.
   */
  const freezeTile = (battle, unit, k) => {
    const r = (k / COLS) | 0, c = k % COLS;
    if (battle.grid.tile(r, c).special !== 'end') return false;
    if (battle.allyUnits.some((t) => isTok(t, iceId, unit) && t.alive)) return false;
    if (battle.isReservedTile(r, c)) return false;
    const ice = battle.spawnToken(unit, iceId, r, c);
    if (!ice) return false;
    unit.mem.snow.delete(k);
    battle.fx('summon', { x: c, y: r, id: ice.id, src: unit.id });
    return true;
  };
  const talents = [
    { install(battle, unit) { // 无垠的雪景 (+ S2 snow rules)
      const ivN = num(t0.interval, 5.5), ivS = num(bb.interval, ivN);
      const slow = num(t0.move_speed), scale = num(t0.talent_magic_scale);
      const snow = new Map();
      unit.mem.snow = snow;
      const last = new WeakMap();
      let acc = 0, dotAcc = 0;
      const lay = () => {
        let n = 0;
        for (const k of unit.rangeKeys || []) if (addSnow(battle, unit, k)) n++;
        if (n) battle.fx('snow', { x: unit.x, y: unit.y, id: unit.id, tiles: n });
      };
      battle.on('deploy', ({ unit: u }) => {
        if (u !== unit) return;
        snow.clear();
        acc = 0;
        if (num(t0.first_snow) > 0) lay();
      }, { owner: unit });
      battle.on('tick', ({ dt }) => {
        if (!live(unit)) return;
        acc += dt;
        if (acc + 1e-9 >= (unit.skill && unit.skill.active ? ivS : ivN)) { acc = 0; lay(); }
        if (!snow.size) return;
        const S2 = unit.mem.sbellS2;
        for (const e of battle.enemies) {
          if (!e.alive || e.hidden) continue;
          const k = keyOf(e);
          const prev = last.get(e);
          if (prev !== k) {
            last.set(e, k);
            const hadSnow = prev !== undefined && !e.isFlying && snow.has(prev);
            if (hadSnow) snow.delete(prev); // first enemy leaving clears it
            if (!e.isFlying && snow.has(k) && scale > 0) battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'arts', tags: ['talent', 'snow'] });
            if (S2 && hadSnow && !snow.has(k) && e.alive && S2.cold > 0) battle.applyStatus(e, 'cold', { duration: S2.cold, source: unit });
          }
          const L = snow.get(k);
          if (L && e.alive && slow) battle.addBuff(e, { key: 'sbell2:snow', duration: 0.2, refresh: 'replace', mods: { moveMul: Math.max(0, 1 + slow * L) }, source: unit });
        }
        if (!S2 || !(S2.dot > 0)) { dotAcc = 0; return; }
        dotAcc += dt;
        if (dotAcc + 1e-9 < 1) return;
        dotAcc -= 1;
        for (const e of battle.enemies) {
          if (e.alive && !e.hidden && !e.isFlying && bodyInKeys(e, snow)) battle.dealDamage(unit, e, { amount: unit.s.atk * S2.dot, type: 'arts', isSkill: true, tags: ['skill', 'snow'] });
        }
      }, { owner: unit });
    } },
    { install(battle, unit) { // 圣山的祝福
      const cold = num(t1.cold), selfFreeze = num(t1.freeze), eFreeze = num(t1.c2e_freeze), hr = num(t1.hp_ratio, 1);
      battle.on('deploy', ({ unit: u }) => { if (u === unit) unit.mem.blessUsed = false; }, { owner: unit });
      battle.on('damaged', (ctx) => {
        if (ctx.target !== unit || !(cold > 0) || ctx.type === 'element') return;
        const s = ctx.source;
        if (s && s.side === 'enemy' && s.alive) battle.applyStatus(s, 'cold', { duration: cold, source: unit });
      }, { owner: unit });
      battle.on('fatal', (ctx) => {
        if (ctx.unit !== unit || ctx.prevented || unit.mem.blessUsed) return;
        ctx.prevented = true;
        unit.mem.blessUsed = true;
        unit.hp = Math.max(1, unit.s.maxHp * hr);
        if (selfFreeze > 0) battle.applyStatus(unit, 'freeze', { duration: selfFreeze, source: unit, force: true });
        if (eFreeze > 0) for (const e of enemiesIn(battle, unit)) battle.applyStatus(e, 'freeze', { duration: eFreeze, source: unit });
        battle.fx('blessing', { x: unit.x, y: unit.y, id: unit.id });
      }, { owner: unit, priority: -50 });
    } },
  ];
  if (num(mod.damage_scale) > 0) {
    talents.push({ install(battle, unit) { // module: +3 % damage per enemy in range (max 5)
      const per = num(mod.damage_scale), cap = Math.max(1, Math.floor(num(mod.max_valid_stack_cnt, 5)));
      aura(battle, unit, 0.25, () => {
        const n = Math.min(cap, enemiesIn(battle, unit).length);
        if (n > 0) battle.addBuff(unit, { key: 'sbell2:heart', mods: { dmgDealtMul: 1 + per * n }, duration: 0.4, refresh: 'replace' });
      });
    } });
  }
  const skills = {
    // S1 铃音吹雪 (SEARCH trigger, 2 charges): atk_scale × ATK arts + `cold` s of 寒冷 on every enemy in range, pushed
    // (force 1 = 中力) along her direction — PRTS 备注 "固定方向推动（不会因角度过大或距离过近而变化方向与力度），且仅对地面
    // 单位产生推力" (Battle.push fixed, official 力度 − 重量 distance); then one snow layer spreads forward over the ground
    // (≤ trig_cnt tiles)
    skchr_sbell2_1: {
      kind: instantKind(def),
      // data trigger SEARCH (the 阵法术师 row, every MANUAL skill of the class: "在初始攻击范围内存在敌人时释放技能") =
      // an enemy inside her initial range, checked every tick — what the engine's DEFAULT does for a phalanx
      // (noAttackUnlessSkill); an enemy anywhere on the field would dump both charges on an enemy spawning at the gate
      trigger: 'DEFAULT',
      onStart({ battle, unit }) {
        const [fr, fc] = unit.fwd;
        const force = num(bb.force);
        for (const e of enemiesIn(battle, unit)) {
          battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 1), type: 'arts', isSkill: true, tags: ['skill'] });
          if (!e.alive) continue;
          if (num(bb.cold) > 0) battle.applyStatus(e, 'cold', { duration: num(bb.cold), source: unit });
          if (!e.isFlying) battle.push(e, force, { from: unit, dir: { x: fc, y: fr }, fixed: true });
        }
        const n = Math.max(0, Math.floor(num(bb.trig_cnt, 5)));
        let laid = 0;
        for (let d = 1; d <= n; d++) {
          const r = unit.tileR + fr * d, c = unit.tileC + fc * d;
          if (!battle.grid.inRect(r, c)) break;
          if (addSnow(battle, unit, r * COLS + c)) laid++;
        }
        battle.fx('frostNova', { x: unit.x, y: unit.y, id: unit.id, tiles: laid });
      },
    },
    // S2 霜涛覆岭 (toggle, 持续时间无限): group attacks at attack@atk_scale_s2 × ATK + the S2 snow rules (addSnow / talent)
    skchr_sbell2_2: {
      kind: 'toggle',
      attack: { atkScale: num(bb['attack@atk_scale_s2'], 1) },
      onStart({ unit }) {
        unit.mem.sbellS2 = { spreadLeft: Math.floor(num(bb['talent@max_cast_tile_count'], 20)), dot: num(bb['talent@s2_magic_scale']), cold: num(bb['talent@cold']) };
      },
      onEnd({ battle, unit }) {
        unit.mem.sbellS2 = null;
        for (const t of battle.allyUnits) if (isTok(t, iceId, unit) && t.alive) battle.retreat(t, { reason: 'expired', permanent: true });
      },
    },
  };
  return {
    skills,
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed), resIgnoreFlat: num(bb.magic_resist_penetrate_fixed) },
      ...(skillGrid ? { targeting: { rangeGrid: skillGrid } } : {}),
      attack: { atkScale: num(bb['attack@atk_scale_s3'], 1) },
      onStart({ battle, unit }) { // 立即诱导攻击范围内的所有敌人至自身周围的可达地面，持续 attract_time 秒
        const dur = num(bb.attract_time);
        if (!(dur > 0)) return;
        let n = 0;
        // 诱导 = the engine `attract` status: unblockable, walked (own speed, grid path) to the point, then its route
        // resumes; it runs its full time even if she falls meanwhile
        for (const e of enemiesIn(battle, unit)) {
          if (e.isFlying || e.isBoss || !e.alive) continue;
          const goal = lureGoal(battle, unit, e);
          if (goal && battle.applyStatus(e, 'attract', { duration: dur, source: unit, point: goal })) n++;
        }
        battle.fx('lure', { x: unit.x, y: unit.y, id: unit.id, n });
      },
    },
    talents,
  };
}

/** The nearest ground tile around `unit` to `e` ("自身周围的可达地面"), or null. */
function lureGoal(battle, unit, e) {
  let goal = null, bd = Infinity;
  for (const [dr, dc] of AROUND8) {
    const r = unit.tileR + dr, c = unit.tileC + dc;
    if (!battle.grid.groundPassable(r, c)) continue;
    const d = Math.hypot(e.x - c, e.y - r);
    if (d < bd - 1e-9) { bd = d; goal = [r, c]; }
  }
  return goal;
}

// ------------------------------------------------------------------------------------------------------------------
// 余 chess_char_6_03 (本源铁卫) — S3 灶里乾坤; 礼尚往来; 闲云隐市; module 人间百味

function yu(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), mod = moduleBb(chess), tb = def?.traitBb || {};
  const isDef = onDefaultSkill(chess), sid = selectedSkill(chess, def);
  const wallProb = isDef ? num(bb.prob) : 0, wallBurn = isDef ? num(bb.ep_damage_ratio) : 0;
  // "将第二天赋效果赋予全场所有干员" belongs to S3 (the default skill) only
  const s3On = (unit) => isDef && !!unit.skill?.active;
  const skills = {
    // S1 今日做东 (TAKE_DAMAGE, hurt SP): passive taunt +taunt_level; active: HP / DEF +, every attack taken ⇒
    // ep_damage_ratio × ATK 灼燃损伤 on the attacker (install below)
    skchr_yu_1: { kind: 'duration', mods: { hpPct: num(bb.max_hp), defPct: num(bb.def) } },
    // S2 厚礼上宾 (cast with an enemy on its x-1: the data's SKILL_RANGE, a deliberate deviation from the 重装 TAKE_DAMAGE
    // row — tools/build-data.mjs TRIGGER_DEVIATIONS, DESIGN §22.10): atk_scale × ATK arts on every enemy of the skill range
    // + the ground-reachable ones teleported onto his tile (leaders too, unless 自缚: teleportEnemy); block +block_cnt, HP /
    // ATK +, normal attacks deal arts damage. The burst hits air units too [ASSUMED: no 对空 note on PRTS]; the teleport
    // takes ground units only ("地面可达目标"). The 'pull' fx only when someone was teleported (each one also gets its own
    // 'teleport' fx). PRTS's 0.13 s between the damage and the teleport is not modelled (same tick).
    skchr_yu_2: {
      kind: 'duration',
      mods: { hpPct: num(bb.max_hp), atkPct: num(bb.atk), blockCnt: num(bb.block_cnt) },
      attack: { dmgType: 'arts' },
      onStart({ battle, unit }) {
        const grid = skillGridOf(def) || AROUND8;
        const foes = battle.unitsInGrid(unit, grid, { side: 'enemy' }).filter((e) => canTargetEnemy(unit, e, ANY));
        for (const e of foes) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 1), type: 'arts', isSkill: true, tags: ['skill'] });
        let n = 0;
        for (const e of foes) if (teleportEnemy(battle, unit, e)) n++;
        if (n > 0) battle.fx('pull', { x: unit.x, y: unit.y, id: unit.id, n });
      },
    },
  };
  return {
    skills,
    install(battle, unit) {
      if (sid !== 'skchr_yu_1') return;
      // 被动效果：自身更容易受到敌人攻击 (while this skill is carried)
      battle.addBuff(unit, { key: 'yu:host', mods: { taunt: num(bb.taunt_level, 1) }, persist: true, allowDead: true });
      battle.on('damaged', (ctx) => {
        const s = ctx.source;
        if (ctx.target !== unit || !unit.skill?.active || !s || s.side !== 'enemy' || !s.alive || !ctx.dmg?.isAttack) return;
        elementDmg(battle, unit, s, 'burn', unit.s.atk * num(bb.ep_damage_ratio), ['skill']);
      }, { owner: unit });
    },
    skill: {
      kind: 'duration',
      mods: { hpPct: num(bb.max_hp), atkPct: num(bb.atk), defPct: num(bb.def) },
      // the wall runs through his tile perpendicular to his direction (RIGHT / LEFT: his column; UP / DOWN: his row —
      // it turns with the deploy direction like a range) [ASSUMED orientation for UP / DOWN]
      onStart({ battle, unit }) {
        const vertical = unit.fwd[0] === 0;
        unit.mem.yuWall = vertical ? { axis: 'x', v: unit.tileC } : { axis: 'y', v: unit.tileR };
        battle.fx('firewall', { x: unit.tileC, y: unit.tileR, id: unit.id, dir: unit.dir, axis: vertical ? 'col' : 'row' });
      },
      onEnd({ unit }) { unit.mem.yuWall = null; },
    },
    talents: [
      { install(battle, unit) { // 礼尚往来: 庇护 while blocking + DoT on blocked enemies
        const dr = num(t0.damage_resistance), sc = bv(t0, 'atk_scale'), er = bv(t0, 'ep_damage_ratio'), iv = Math.max(0.1, bv(t0, 'interval', 1));
        // 庇护 (ba.protect): 受到的物理和法术伤害降低相应比例 — true / element damage is not reduced
        aura(battle, unit, 0.1, () => {
          if (dr > 0 && unit.blocking.length) battle.addBuff(unit, { key: 'yu:shelter', mods: { physTakenMul: 1 - dr, artsTakenMul: 1 - dr }, duration: 0.2, refresh: 'replace' });
        });
        aura(battle, unit, iv, () => {
          for (const e of unit.blocking.slice()) {
            if (!e.alive) continue;
            if (sc > 0) battle.dealDamage(unit, e, { amount: unit.s.atk * sc, type: 'arts', tags: ['talent'] });
            if (er > 0) elementDmg(battle, unit, e, 'burn', unit.s.atk * er, ['talent']);
          }
        });
      } },
      { install(battle, unit) { // 闲云隐市 (all operators while S3 runs)
        const cnt = num(t1.cnt, 4), hr = num(t1.hp_recovery_per_sec_by_max_hp_ratio), er = num(t1.ep_heal_ratio), iv = Math.max(0.1, num(t1.interval, 1));
        aura(battle, unit, iv, () => {
          const ops = opsOf(battle, unit.ownerId);
          if (ops.length < cnt) return;
          for (const a of s3On(unit) ? ops : [unit]) {
            if (hr > 0) battle.heal(unit, a, a.s.maxHp * hr * iv, { self: true, silent: true });
            if (er > 0) battle.reduceElement(a, a.s.maxHp * er * iv);
          }
        });
      } },
      { install(battle, unit) { // S3 fire wall
        const crosses = (a, b) => {
          const w = unit.mem.yuWall;
          if (w == null) return false;
          return w.axis === 'y' ? (a.y - w.v) * (b.y - w.v) < 0 : (a.x - w.v) * (b.x - w.v) < 0;
        };
        battle.on('damaged', (ctx) => {
          const s = ctx.source, t = ctx.target;
          if (!(wallBurn > 0) || unit.mem.yuWall == null || !live(unit) || ctx.type !== 'arts' || !(ctx.amount > 0)) return;
          if (!s || s === unit || s.side !== 'ally' || !t || t.side !== 'enemy' || !t.alive || !crosses(s, t)) return;
          elementDmg(battle, unit, t, 'burn', unit.s.atk * wallBurn, ['skill', 'firewall']);
        }, { owner: unit });
        battle.on('hit', (ctx) => {
          const s = ctx.source, t = ctx.target;
          if (!(wallProb > 0) || unit.mem.yuWall == null || !live(unit) || !s || s.side !== 'enemy' || !t || t.side !== 'ally') return;
          if (!ctx.dmg.isAttack || !(s.base.rangeRadius > 0) || s.blockedBy === t || !crosses(s, t)) return;
          if (battle.rng() < wallProb) {
            ctx.dmg.cancel = true;
            const w = unit.mem.yuWall;
            battle.fx('firewallBlock', w.axis === 'y' ? { x: t.x, y: w.v, id: unit.id } : { x: w.v, y: t.y, id: unit.id });
          }
        }, { owner: unit });
      } },
      { install(battle, unit) { // elite: module element ×1.15 while blocking; 闲云隐市 arts ×1.14 vs burning targets (≥4 ops)
        const epScale = num(tb.ep_damage_scale, 1), cnt = num(mod.cnt, Infinity), ds = num(mod.damage_scale, 1);
        if (epScale > 1) onElementHit(battle, unit, (ctx) => (ctx.source === unit && live(unit) && unit.blocking.length ? epScale : 1));
        // "将第二天赋效果赋予全场所有干员": while S3 runs every operator of hers gets the ×1.14 too
        if (ds > 1) battle.on('hit', (ctx) => {
          const s = ctx.source;
          if (!s || ctx.dmg.type !== 'arts' || !ctx.target || ctx.target.side !== 'enemy' || !ctx.target.findBuff('burnBurst')) return;
          if (s !== unit && !(s.kind === 'op' && s.ownerId === unit.ownerId && live(unit) && s3On(unit))) return;
          if (opsOf(battle, unit.ownerId).length >= cnt) ctx.dmg.mul *= ds;
        }, { owner: unit });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 浊心斯卡蒂 chess_char_6_04 (吟游者) — S3 "潮涌，潮枯"; 远古血亲 (海嗣); 捕食习性; module 蜕化的残迹

function skadi2(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), mod = moduleBb(chess), tb = def?.traitBb || {};
  const isDef = onDefaultSkill(chess), sid = selectedSkill(chess, def);
  const tokId = def?.talents?.[0]?.tokenKey || (chess?.tokens || [])[0] || 'token_10017_skadi2_dedant';
  const auraRatio = num(tb['attack@atk_to_hp_recovery_ratio'], 0.1);
  // S1 / S2 raise the trait heal ("特性效果提高至N%") while they run; S3 (default) turns it into the tide
  const skillRatio = num(bb['attack@atk_to_hp_recovery_ratio'], auraRatio);
  const seaborns = (battle, unit) => battle.allyUnits.filter((t) => isTok(t, tokId, unit) && live(t));
  const covered = (battle, unit, toks) => { // allies inside her range ∪ the seaborns' ranges
    const set = new Set(battle.alliesInGrid(unit));
    for (const t of toks) for (const a of battle.alliesInGrid(t)) set.add(a);
    for (const t of toks) set.delete(t);
    return [...set];
  };
  const inCover = (battle, unit, a) => {
    const k = a.tileR * COLS + a.tileC;
    if (unit.rangeKeySet?.has(k)) return true;
    return seaborns(battle, unit).some((t) => t.rangeKeySet?.has(k));
  };
  const skills = {
    // S1 同归殊途之吟 (SP_FULL): full self heal, max HP +max_hp, trait heal attack@atk_to_hp_recovery_ratio, and
    // damage_resistance of the damage taken by every ally of her (+ 海嗣) range is transferred to her (install)
    skchr_skadi2_1: {
      kind: 'duration',
      mods: { hpPct: num(bb.max_hp) },
      onStart({ battle, unit }) { unit.hp = unit.s.maxHp; battle.fx('heal', { x: unit.x, y: unit.y, id: unit.id }); },
    },
    // S2 同葬无光之愿 (toggle): 鼓舞 ATK / DEF = atk / def × her ATK / DEF on every other ally of her (+ 海嗣) range,
    // trait heal attack@atk_to_hp_recovery_ratio (trait pulse)
    skchr_skadi2_2: { kind: 'toggle' },
  };
  return {
    skills,
    skill: {
      kind: 'duration', // effects run in the trait pulse below ("特性变为…")
      onStart({ battle, unit }) { battle.fx('tide', { x: unit.x, y: unit.y, id: unit.id }); },
    },
    trait: {
      install(battle, unit) { // replaces the bard aura: heal normally, tide (true damage + 鼓舞 + self drain) during S3
        unit.mem.noInspire = true; // 自身不受鼓舞影响
        const isInspire = (b) => b.key === 'inspire' || b.status === 'inspire' || b.key.startsWith('inspire:') || b.key.endsWith(':inspire');
        // "海嗣的攻击范围视为自身攻击范围的延伸": an enemy in a 海嗣's range also satisfies her DEFAULT trigger
        if (unit.skill) unit.skill.addTriggerRange(() => seaborns(battle, unit));
        let n = 0;
        battle.every(0.5, () => {
          if (!unit.canAct) return;
          for (let i = unit.buffs.length - 1; i >= 0; i--) if (isInspire(unit.buffs[i])) battle.removeBuff(unit, unit.buffs[i]);
          n++;
          const toks = seaborns(battle, unit);
          const allies = covered(battle, unit, toks);
          const sk = unit.skill;
          const on = !!(sk && sk.active);
          if (on && isDef) {
            const val = unit.s.atk * num(bb.atk);
            for (const a of allies) if (a !== unit) inspire(battle, a, val, unit);
            if (n % 2 === 0) {
              const dmg = unit.s.atk * num(bb.atk_scale);
              if (dmg > 0) for (const src of [unit, ...toks]) for (const e of enemiesIn(battle, src)) {
                battle.dealDamage(unit, e, { amount: dmg, type: 'true', isSkill: true, tags: ['skill', 'tide'] });
              }
              const loss = unit.s.maxHp * num(bb.hp_ratio);
              if (loss > 0) { if (unit.hp - loss >= 1) battle.loseHp(unit, loss, { source: unit, silent: true }); else unit.hp = Math.min(unit.hp, 1); }
            }
            return;
          }
          if (on && sid === 'skchr_skadi2_2') {
            const va = unit.s.atk * num(bb.atk), vd = unit.s.def * num(bb.def);
            for (const a of allies) if (a !== unit) { inspire(battle, a, va, unit); inspire(battle, a, vd, unit, 'def'); }
          }
          if (n % 2 === 0) {
            const amount = unit.s.atk * (on ? skillRatio : num(unit.profile?.auraRatio, auraRatio));
            for (const a of allies) if (a.hp < a.s.maxHp) battle.heal(unit, a, amount, { aura: true });
          }
        }, { owner: unit });
      },
    },
    install(battle, unit) {
      // S1: "攻击范围内我方所有单位受到伤害的50%直接转移给浊心斯卡蒂承担（同类效果取最高）" — the ally takes (1 − share),
      // she takes the transferred part as true damage from the same attacker
      if (sid === 'skchr_skadi2_1') {
        const share = clamp(num(bb.damage_resistance), 0, 1);
        const TAG = `skadi2:transfer:${unit.id}`;
        battle.on('hit', (ctx) => {
          const t = ctx.target, d = ctx.dmg;
          if (!(share > 0) || !t || t === unit || t.side !== 'ally' || t.kind === 'device' || !live(unit) || !unit.skill?.active) return;
          if (d.type === 'element' || d.type === 'elemental' || d.skadiShare || d.tags?.includes('transfer') || !inCover(battle, unit, t)) return;
          d.skadiShare = { share, tag: TAG }; // 同类效果取最高: one transfer per damage instance
          d.mul *= 1 - share;
        }, { owner: unit, priority: -20 });
        battle.on('damaged', (ctx) => {
          const x = ctx.dmg?.skadiShare;
          if (!x || x.tag !== TAG || !(ctx.amount > 0) || !live(unit)) return;
          battle.dealDamage(ctx.source, unit, { amount: ctx.amount * x.share / Math.max(1e-6, 1 - x.share), type: 'true', canDodge: false, tags: ['transfer'] });
        }, { owner: unit });
      }
      // module 新生代: "自身技能期间，攻击范围内的友军获得30点物理与法术伤害减免" (flat reduction per hit)
      const flat = -num(mod.damage_resistance);
      if (flat > 0) {
        battle.on('hit', (ctx) => {
          const t = ctx.target, d = ctx.dmg;
          if (!t || t.side !== 'ally' || t.kind === 'device' || !live(unit) || !unit.skill?.active || !inCover(battle, unit, t)) return;
          if (d.type === 'phys') d.defIgnoreFlat -= flat; // +flat effective DEF ⇒ −flat damage (above the 5 % floor)
          else if (d.type === 'arts') d.amount = Math.max(0, d.amount - flat / Math.max(0.05, 1 - (t.s.res ?? 0) / 100));
        }, { owner: unit, priority: -10 });
      }
    },
    talents: [
      { install(battle, unit) { // 远古血亲: the seaborn is an inert range extension with a limited life
        battle.on('deploy', ({ unit: t }) => {
          if (!isTok(t, tokId, unit)) return;
          if (t.profile) t.profile.noAttack = true;
          const dur = num(t.def?.talents?.[0]?.bb?.duration, parseN(tdesc(def, 0), /持续(\d+(?:\.\d+)?)秒/, 25));
          const seq = t.deploySeq, r = t.tileR, c = t.tileC;
          battle.after(dur, () => {
            if (!t.alive || t.deploySeq !== seq) return;
            battle.retreat(t, { reason: 'expired', permanent: true });
            const wait = num(t.base.respawnTime, 30), cost = num(t.base.cost, 0);
            let tries = 0;
            const again = () => {
              if (battle.finished || tries++ > 300) return;
              const ps = battle.getPlayer(unit.ownerId);
              if (!live(unit) || !ps || ps.dp + 1e-9 < cost || battle.unitAt(r, c)) { battle.after(1, again, { owner: unit }); return; }
              battle.addDp(unit.ownerId, -cost);
              if (!battle.spawnToken(unit, tokId, r, c)) { battle.addDp(unit.ownerId, cost); battle.after(1, again, { owner: unit }); }
            };
            battle.after(wait, again, { owner: unit });
          }, { owner: t });
        }, { owner: unit });
      } },
      { install(battle, unit) { // 捕食习性 (module 新生代: ATK 9 / 20 %, DEF +8 %, +3 SP per op deployed in range) + module (≥2 other ops in range: ATK +8 %)
        const a1 = num(t1['skadi2_e_003_t_2[atk][1].atk'], bv(t1, 'skadi2_t_2[atk][1].atk', 0));
        const a2 = num(t1['skadi2_e_003_t_2[atk][2].atk'], bv(t1, 'skadi2_t_2[atk][2].atk', a1));
        const d1 = num(t1['skadi2_e_003_t_2[def].def']), sp = num(t1.sp);
        const mCnt = num(mod.cnt, Infinity), mAtk = num(mod.atk);
        aura(battle, unit, 0.5, () => {
          const toks = seaborns(battle, unit);
          const ops = covered(battle, unit, toks).filter((a) => a !== unit && a.kind === 'op');
          const val = ops.some((a) => ABYSSAL.has(a.def?.charId)) ? a2 : ops.length ? a1 : 0;
          const own = battle.alliesInGrid(unit).filter((a) => a !== unit && a.kind === 'op').length;
          const total = val + (own >= mCnt ? mAtk : 0);
          const dPct = ops.length ? d1 : 0;
          if (total > 0 || dPct > 0) battle.addBuff(unit, { key: 'skadi2:predator', mods: { atkPct: total, defPct: dPct }, duration: 0.75, refresh: 'replace' });
        });
        // "我方干员部署于自身或海嗣范围内后，自身立刻获得3点技力"
        if (sp > 0) battle.on('deploy', ({ unit: u }) => {
          if (!u || u === unit || u.kind !== 'op' || u.side !== 'ally' || !live(unit) || !unit.skill) return;
          if (inCover(battle, unit, u)) unit.skill.gainSp(sp, 'talent');
        }, { owner: unit });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 异客 chess_char_6_05 (链术师) — S3 辉煌裂片; 机理分析; 孤卒

const STORM_RADIUS = 1.5; // [ASSUMED] storm zone radius (not in data)

function pasngr(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const skillGrid = def?.skill?.rangeGrid?.length ? def.skill.rangeGrid : null;
  const strike = (battle, unit, first, scale) => {
    const ch0 = unit.profile?.chain || { count: 4, falloff: 0.15, radius: CHAIN_RADIUS };
    // elite module (电磁调节器) upgrades the skill's chain too: skill@chain.atk_scale / skill@sluggish
    const ch = { ...ch0, falloff: tb['skill@chain.atk_scale'] != null ? 1 - num(tb['skill@chain.atk_scale']) : num(ch0.falloff, 0.15) };
    const count = Math.max(1, Math.floor(num(bb['chain.max_target'], ch.count || 4)));
    const slug = num(tb['skill@sluggish'], num(bb.sluggish, ch.sluggish ?? 0));
    const hit = new Set();
    let prev = first;
    for (let i = 0; i < count && prev; i++) {
      hit.add(prev.id);
      battle.fx('lightning', { x: prev.x, y: prev.y, id: prev.id, src: unit.id });
      battle.dealDamage(unit, prev, { amount: unit.s.atk * scale * Math.pow(1 - num(ch.falloff, 0.15), i), type: 'arts', isSkill: true, isAttack: true, tags: ['skill', 'storm'] });
      if (slug > 0 && prev.alive) battle.applyStatus(prev, 'sluggish', { duration: slug, source: unit });
      let best = null, bd = Infinity;
      for (const x of battle.foesInRadius(prev.x, prev.y, ch.radius || CHAIN_RADIUS)) {
        if (hit.has(x.id) || !canTargetEnemy(unit, x, ANY)) continue;
        const d = bodyDist(x, prev.x, prev.y);
        if (d < bd - 1e-9) { bd = d; best = x; }
      }
      prev = best;
    }
  };
  // the chain of her profile (trait / module: bounce count, falloff, 停顿) with skill overrides
  const chainOf = (unit, o) => ({ ...(unit.profile?.chain || { count: 4, falloff: 0.15, radius: CHAIN_RADIUS, sluggish: 0.5 }), ...o });
  const skills = {
    // S1 电能之触: next attack at atk_scale × ATK, bouncing over max_target enemies with a sluggish-s 停顿 (the module's
    // skill@pasngr_s_1.chain.atk_scale sets its falloff)
    skchr_pasngr_1: {
      kind: 'instant',
      attack: { atkScale: bv(bb, 'atk_scale', 1) },
      onStart({ unit, skill }) {
        const o = { count: Math.max(1, Math.floor(bv(bb, 'max_target', 4))), sluggish: bv(bb, 'sluggish', 0.5) };
        if (tb['skill@pasngr_s_1.chain.atk_scale'] != null) o.falloff = 1 - num(tb['skill@pasngr_s_1.chain.atk_scale']);
        skill.spec.attack.chain = chainOf(unit, o);
      },
    },
    // S2 聚焦指令: range +1, ATK +atk, base attack time ×0.7/×0.6 (akdata: 乘算负数), bounces raised to attack@max_target
    skchr_pasngr_2: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), batPct: batOf(bb.base_attack_time, def, true) },
      targeting: { rangeExtend: num(bb.ability_range_forward_extend) },
      attack: {},
      onStart({ unit, skill }) { skill.spec.attack.chain = chainOf(unit, { count: Math.max(1, Math.floor(num(bb['attack@max_target'], 5))) }); },
    },
  };
  return {
    skills,
    skill: {
      kind: 'charges',
      onStart({ battle, unit }) {
        const keys = skillGrid ? absoluteRangeKeys(skillGrid, unit.tileR, unit.tileC, unit.dir, unit.s.rangeExtend) : unit.rangeKeys;
        const cands = enemiesIn(battle, unit, keys);
        if (!cands.length) return;
        const tgt = cands.reduce((a, b) => (b.hp > a.hp ? b : a));
        const cx = tgt.x, cy = tgt.y;
        const dur = num(bb.duration, 4), iv = Math.max(0.1, num(bb.interval, 0.5)), scale = num(bb.atk_scale, 1);
        const n = Math.max(1, Math.round(dur / iv));
        battle.fx('storm', { x: cx, y: cy, id: unit.id, duration: dur, r: STORM_RADIUS });
        let k = 0;
        const seq = unit.deploySeq;
        const h = battle.every(iv, () => {
          if (!live(unit) || unit.deploySeq !== seq) { h.cancel(); return; } // the storm ends when she leaves the field
          if (++k >= n) h.cancel();
          const zone = battle.foesInRadius(cx, cy, STORM_RADIUS).filter((e) => canTargetEnemy(unit, e, ANY));
          const e = battle.rng.pick(zone);
          if (e) strike(battle, unit, e, scale);
        }, { owner: unit });
      },
    },
    talents: [
      { install(battle, unit) { // 机理分析
        const thr = num(t0.hp_ratio, 0.8), ds = bv(t0, 'damage_scale', 1), dur = bv(t0, 'duration', 3);
        const key = `pasngr:enhance:${unit.id}`;
        battle.on('hit', (ctx) => {
          const t = ctx.target;
          if (ctx.source !== unit || !t || t.side !== 'enemy' || ctx.dmg.type === 'element') return;
          if (ctx.dmg.isAttack && t.hpRatio >= thr - 1e-9) battle.addBuff(t, { key, duration: dur, refresh: 'replace', source: unit });
          if (t.findBuff(key)) ctx.dmg.mul *= ds;
        }, { owner: unit });
      } },
      { install(battle, unit) { // 孤卒: no enemy on the 4 surrounding tiles
        const atk = num(t1.atk), spr = num(t1.sp_recovery_per_sec);
        aura(battle, unit, 0.25, () => {
          const near = new Set(absoluteRangeKeys(N4, unit.tileR, unit.tileC, 1, 0));
          if (battle.enemies.some((e) => e.alive && !e.hidden && bodyInKeys(e, near))) return;
          battle.addBuff(unit, { key: 'pasngr:lone', mods: { atkPct: atk, spRecoveryFlat: spr }, duration: 0.4, refresh: 'replace' });
        });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 佩佩 chess_char_6_06 (撼地者) — S3 时光震荡; 往昔传承; 弥漫莲香; module 晴雨

function pepe(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const sid = selectedSkill(chess, def);
  const stackAtk = num(bb['attack@atk']), maxStack = Math.max(0, Math.floor(num(bb['attack@max_stack_cnt'])));
  const ext = num(bb['attack@ability_range_forward_extend']);
  const stun = num(bb['attack@stun']), stunMain = num(bb['attack@stun_main'], stun);
  // 往昔传承: "技能期间每击倒1名敌人，技能结束时获得N点技力，至多回复M点" (any timed skill of hers)
  const pastSp = (unit, skill) => {
    const gain = Math.min(num(t0.max_sp, Infinity), (unit.mem.pepeKills || 0) * num(t0.sp));
    unit.mem.pepeKills = 0;
    if (gain > 0 && unit.alive) skill.gainSp(gain, 'talent');
  };
  const skills = {
    // S1 盖戳！: next attack at atk_scale × ATK (splash included); castable while under a 异常状态, which it cleanses
    // (install below)
    skchr_pepe_1: { kind: 'instant', attack: { atkScale: num(bb.atk_scale, 1) } },
    // S2 阻遏混乱锤: skill range, ATK / ASPD +, random target in range; every use gives later casts ASPD
    // +attack_speed_extra (≤ max_stack_cnt stacks)
    skchr_pepe_2: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) },
      ...(skillGridOf(def) ? { targeting: { rangeGrid: skillGridOf(def) } } : {}),
      onStart({ battle, unit }) {
        unit.mem.pepeKills = 0;
        const n = unit.mem.pepeRage || 0;
        if (n > 0) battle.addBuff(unit, { key: 'pepe:rage', mods: { aspd: num(bb.attack_speed_extra) * n } });
        unit.mem.pepeRage = Math.min(Math.floor(num(bb.max_stack_cnt, 2)), n + 1);
      },
      onEnd({ battle, unit, skill }) { battle.removeBuff(unit, 'pepe:rage'); pastSp(unit, skill); },
    },
  };
  return {
    skills,
    install(battle, unit) {
      if (sid === 'skchr_pepe_1') {
        battle.on('tick', () => { // "处于异常状态时可以释放技能并清除异常状态"
          const sk = unit.skill;
          if (!live(unit) || !sk || !sk.ready || sk.active || !hasAbnormal(unit)) return;
          cleanseAbnormal(battle, unit);
          sk.activate('abnormal');
        }, { owner: unit });
      }
      if (sid === 'skchr_pepe_2') {
        battle.on('beforeAttack', (ctx) => { // 随机攻击范围内的目标 (and the enemies she blocks — Battle.blockedTargets)
          if (ctx.attacker !== unit || !unit.skill?.active) return;
          const c = battle.enemiesInKeys(unit.rangeKeys, unit, ctx.profile);
          for (const e of battle.blockedTargets(unit, ctx.profile)) if (!c.includes(e)) c.push(e);
          if (c.length) ctx.targets = [battle.rng.pick(c)];
        }, { owner: unit });
      }
    },
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), batPct: batOf(bb.base_attack_time, def) },
      attack: {
        splashRadius: 1,
        onHit({ battle, unit, target }) { if (target && target.alive && stunMain > 0) battle.applyStatus(target, 'stun', { duration: stunMain, source: unit }); },
      },
      onStart({ unit, skill }) {
        unit.mem.pepeStack = 0;
        unit.mem.pepeKills = 0;
        unit.mem.pepeR0 = num(unit.profile?.splashRadius, 1);
        skill.spec.attack.splashRadius = unit.mem.pepeR0;
      },
      onAttack({ battle, unit, skill }) {
        if (unit.mem.pepeStack >= maxStack) return;
        unit.mem.pepeStack++;
        battle.addBuff(unit, { key: 'pepe:tremor', mods: { atkPct: stackAtk * unit.mem.pepeStack } });
        skill.spec.attack.splashRadius = unit.mem.pepeR0 + ext * unit.mem.pepeStack;
      },
      onEnd({ battle, unit, skill }) {
        battle.removeBuff(unit, 'pepe:tremor');
        skill.spec.attack.splashRadius = unit.mem.pepeR0 ?? 1;
        pastSp(unit, skill);
      },
    },
    talents: [
      { install(battle, unit) { // S3 splash stun + 往昔传承 kill counter
        battle.on('damaged', (ctx) => {
          if (ctx.source !== unit || !unit.skill?.active || !ctx.dmg?.isSplash || !ctx.target.alive || stun <= 0) return;
          battle.applyStatus(ctx.target, 'stun', { duration: stun, source: unit });
        }, { owner: unit });
        battle.on('kill', ({ killer, victim }) => {
          if (killer === unit && victim.side === 'enemy' && unit.skill?.active) unit.mem.pepeKills = (unit.mem.pepeKills || 0) + 1;
        }, { owner: unit });
      } },
      { install(battle, unit) { // 弥漫莲香: every 近卫 op ATK +16 %
        const atk = num(t1.atk);
        if (atk) aura(battle, unit, 0.5, () => {
          for (const a of battle.allyUnits) if (live(a) && a.kind === 'op' && a.def?.profession === 'WARRIOR') battle.addBuff(a, { key: 'pepe:lotus', mods: { atkPct: atk }, duration: 0.75, refresh: 'replace' });
        });
      } },
      { install(battle, unit) { // elite module: ≥ cnt enemies in the splash area ⇒ this attack ×1.15
        const sc = num(tb.atk_scale_e, 1), cnt = num(tb.cnt, Infinity);
        if (!(sc > 1)) return;
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit) return;
          const t = ctx.targets[0];
          const r = num(ctx.profile?.splashRadius, 1);
          unit.mem.pepeBoost = !!t && battle.foesInRadius(t.x, t.y, r).length >= cnt;
        }, { owner: unit });
        battle.on('hit', (ctx) => { if (ctx.source === unit && ctx.dmg.isAttack && unit.mem.pepeBoost) ctx.dmg.mul *= sc; }, { owner: unit });
        battle.on('attack', (ctx) => { if (ctx.attacker === unit) unit.mem.pepeBoost = false; }, { owner: unit, priority: -100 });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 维娜·维多利亚 chess_char_6_07 (术战者) — S3 俱以我之名; 诸王的叹息; 无拘的锋芒; module 城主的冒险

function siege2(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {}, mod = moduleBb(chess);
  const isDef = onDefaultSkill(chess), sid = selectedSkill(chess, def);
  const tGrid = def?.talents?.[0]?.rangeGrid?.length ? def.talents[0].rangeGrid : [[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]];
  const tokId = (chess?.tokens || []).find((t) => /vlion/.test(String(t))) || 'token_10040_siege2_vlion';
  const mine = (u, unit) => u === unit || (!!u && u.kind === 'token' && u.ownerUnit === unit);
  const skills = {
    // S1 重铸晖光: the next attack also deals atk_scale × ATK true damage to every ground enemy on the skill's 4
    // surrounding tiles (+ her own)
    skchr_siege2_1: {
      kind: 'instant',
      attack: {
        onHit({ battle, unit }) {
          for (const e of battle.unitsInGrid(unit, skillGridOf(def) || N4, { side: 'enemy' })) {
            if (!e.isFlying && e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'true', isSkill: true, tags: ['skill'] });
          }
          battle.fx('aoe', { x: unit.x, y: unit.y, id: unit.id });
        },
      },
    },
    // S2 进赴故土 (toggle): range +1 (skill grid), ATK +atk, one extra target; passive: ≥buff_stack_cnt other allies in
    // the talent-1 area ⇒ SP +sp_recovery_per_sec (install)
    skchr_siege2_2: {
      kind: 'toggle',
      mods: { atkPct: num(bb.atk) },
      targeting: { maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 2))), ...(skillGridOf(def) ? { rangeGrid: skillGridOf(def) } : {}) },
    },
  };
  return {
    skills,
    install(battle, unit) {
      if (sid === 'skchr_siege2_2') {
        const need = Math.max(1, Math.floor(num(bb.buff_stack_cnt, 2))), spr = num(bb.sp_recovery_per_sec);
        if (spr > 0) aura(battle, unit, 0.25, () => {
          const n = battle.unitsInGrid(unit, tGrid, { side: 'ally' }).filter((a) => a !== unit && a.kind !== 'device' && battle.allySelectable(a, unit)).length;
          if (n >= need) battle.addBuff(unit, { key: 'siege2:homeland', mods: { spRecoveryFlat: spr }, duration: 0.4, refresh: 'replace' });
        });
      }
      // module 秩序圣“球”: enemies blocked by her or her summons take 10 % 脆弱 (trait); she and her summons deal ×1.15 to
      // 战栗 targets (talent)
      const frag = num(tb.damage_scale, 1) - 1, tremMul = num(mod.damage_scale, 1);
      if (frag > 0) aura(battle, unit, 0.25, () => {
        for (const e of battle.enemies) if (e.alive && e.blockedBy && mine(e.blockedBy, unit)) battle.applyStatus(e, 'fragile', { duration: 0.4, value: frag, source: unit });
      });
      if (tremMul > 1) battle.on('hit', (ctx) => {
        const t = ctx.target;
        if (!mine(ctx.source, unit) || !t || t.side !== 'enemy' || !(t.findBuff('tremble') || t.s.flags.tremble)) return;
        ctx.dmg.mul *= tremMul;
      }, { owner: unit });
    },
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), batPct: batOf(bb.base_attack_time, def) },
      targeting: { maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 1))) },
      attack: { dmgType: 'true' },
      // "立即在天赋一生效范围内可部署地面召唤“黄金盟誓”" (EN client "Summons Golden Vows on deployable tiles within
      // Talent 1's range"): one on EVERY free tile of the talent-1 area a melee piece could be deployed on — fences
      // (low, deployable, not walkable) included [ASSUMED: the EN wiki's "open low ground tiles"]; player report B3
      onStart({ battle, unit, skill }) {
        const lions = [];
        for (const tile of freeTiles(battle, unit, tGrid, { ground: false })) {
          const lion = battle.spawnToken(unit, tokId, tile[0], tile[1], { duration: skill.timeLeft });
          if (!lion) continue;
          lions.push(lion);
          if (!lion.kit?.fromTokens && lion.profile) lion.profile.dmgType = 'true'; // "攻击造成真实伤害" without a token kit
          battle.fx('summon', { x: lion.x, y: lion.y, id: lion.id, src: unit.id });
        }
        unit.mem.vlions = lions;
      },
      onEnd({ battle, unit }) {
        const lions = unit.mem.vlions || [];
        unit.mem.vlions = null;
        for (const lion of lions) if (lion.alive) battle.retreat(lion, { reason: 'expired', permanent: true });
        battle.setExtraRange(unit, null);
      },
    },
    talents: [
      { install(battle, unit) { // S3: enemies blocked by allies inside the talent area become targetable
        let sig = '';
        if (!isDef) return;
        battle.on('tick', () => { // (engine extra range keys: kept across range rebuilds, cleared at the skill end)
          if (!live(unit) || !unit.skill?.active) { sig = ''; return; }
          const keys = [];
          for (const a of battle.unitsInGrid(unit, tGrid, { side: 'ally' })) for (const e of a.blocking) if (e.alive) keys.push(keyOf(e));
          const s = keys.join(',');
          if (s === sig) return;
          sig = s;
          battle.setExtraRange(unit, keys);
        }, { owner: unit });
      } },
      { install(battle, unit) { // 诸王的叹息
        const dr = num(t0.damage_resistance), atk = num(t0.atk);
        aura(battle, unit, 0.25, () => {
          const allies = battle.unitsInGrid(unit, tGrid, { side: 'ally' }).filter((a) => a.kind !== 'device' && battle.allySelectable(a, unit));
          if (!allies.includes(unit)) allies.push(unit);
          if (dr > 0) for (const a of allies) battle.addBuff(a, { key: 'siege2:sigh', mods: { physTakenMul: 1 - dr }, duration: 0.4, refresh: 'replace' });
          const n = allies.filter((a) => a !== unit).length;
          if (n > 0 && atk) battle.addBuff(unit, { key: 'siege2:kings', mods: { atkPct: atk * n }, duration: 0.4, refresh: 'replace' });
        });
      } },
      { install(battle, unit) { // 无拘的锋芒: first damage on each enemy ⇒ 战栗 (module 秩序圣“球”: 6 s, elite / leader 12 s)
        const durN = num(t1.not_combat_normal, num(t1.not_combat)), durE = num(t1.not_combat_elite, durN);
        const seen = new WeakSet();
        battle.on('damaged', (ctx) => {
          const t = ctx.target;
          if (ctx.source !== unit || !t || t.side !== 'enemy' || seen.has(t)) return;
          const dur = isElite(t) ? durE : durN;
          if (!(dur > 0)) return;
          seen.add(t);
          if (t.alive) battle.applyStatus(t, 'tremble', { duration: dur, source: unit });
        }, { owner: unit });
      } },
      { install(battle, unit) { // elite module: ASPD +8 while not blocking
        const as = num(tb.attack_speed);
        if (as) aura(battle, unit, 0.25, () => { if (!unit.blocking.length) battle.addBuff(unit, { key: 'siege2:free', mods: { aspd: as }, duration: 0.4, refresh: 'replace' }); });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 焰影苇草 chess_char_6_08 (咒愈师) — S3 生命火种; 灼痕; 映耀

function reed2(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {}, mod = moduleBb(chess);
  const isDef = onDefaultSkill(chess);
  const selfAtk = (() => { for (const k of Object.keys(bb)) if (!k.startsWith('talent@') && (k === 'atk' || k.endsWith('.atk'))) return num(bb[k]); return 0; })();
  const sProb = num(bb['talent@prob'], num(t0.prob)), dot = num(bb['talent@s3_atk_scale']);
  const aoe = num(bb['talent@aoe_scale']), aoeR = num(bb['talent@range_radius'], 1.7);
  const scorchAtk = num(t0.atk), scorchFragile = num(t0.damage_scale, 1) - 1;
  // 灼痕: ATK −20 % (marker buff, 不可叠加) + 30 % 法术脆弱 (the catalogue status: 同名效果取最高 with other sources)
  const scorch = (battle, unit, e) => {
    if (!e || !e.alive) return;
    const sk = unit.skill;
    // "灼痕效果持续至技能结束" — S3 (the default skill) only
    const dur = isDef && sk && sk.active ? Math.max(0.1, sk.timeLeft) : num(t0.duration, 6);
    battle.addBuff(e, { key: 'reed2:scorch', duration: dur, refresh: 'extend', mods: scorchAtk ? { atkPct: scorchAtk } : null, visible: true, source: unit });
    if (scorchFragile > 0 && e.alive) battle.applyStatus(e, 'artsFragile', { duration: dur, value: scorchFragile, source: unit });
  };
  const skills = {
    // S1 迅捷打击·γ型
    'skcom_quickattack[3]': { kind: 'duration', mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) } },
    // S2 枯荣共息: up to max_target operators of her range (ground ones first) carry three fireballs for
    // projectile_life_time s: every `cooldown` s one enemy in the carrier's range (else hers) takes atk_scale × her ATK
    // arts, and her trait heals only that carrier (trait scale × the damage)
    skchr_reed2_2: {
      kind: 'duration',
      duration: num(bb.projectile_life_time) > 0 ? num(bb.projectile_life_time) : undefined,
      onStart({ battle, unit, skill }) {
        const n = Math.max(1, Math.floor(num(bb.max_target, 1)));
        const cands = battle.alliesInGrid(unit).filter((a) => a.kind === 'op' && live(a));
        cands.sort((a, b) => (a === unit) - (b === unit) || (b.ground ? 1 : 0) - (a.ground ? 1 : 0) || a.hpRatio - b.hpRatio || a.deploySeq - b.deploySeq);
        unit.mem.reedFire = cands.slice(0, n).map((a) => ({ a, acc: 0 }));
        for (const F of unit.mem.reedFire) {
          battle.addBuff(F.a, { key: `reed2:fireball:${unit.id}`, duration: skill.timeLeft, visible: true, source: unit });
          battle.fx('ember', { x: F.a.x, y: F.a.y, id: F.a.id, src: unit.id, n: 3 });
        }
      },
      onTick({ battle, unit, dt }) {
        const cd = Math.max(0.1, num(bb.cooldown, 1.5));
        for (const F of unit.mem.reedFire || []) {
          if (!live(F.a)) continue;
          F.acc += dt;
          if (F.acc + 1e-9 < cd) continue;
          F.acc -= cd;
          let c = enemiesIn(battle, F.a);
          if (!c.length) c = enemiesIn(battle, unit);
          if (!c.length) continue;
          sortEnemyTargets(battle, F.a, c, null);
          // "每1.5秒对一名敌人造成…法术伤害并仅对该干员触发焰影苇草特性": the trait heal (professions.js
          // installIncantation) runs for this damage and names the carrier instead of the lowest-HP ally in range
          battle.dealDamage(unit, c[0], { amount: unit.s.atk * num(bb.atk_scale, 1), type: 'arts', isSkill: true, tags: ['skill', 'fireball'], traitAlly: F.a });
          battle.fx('strike', { x: c[0].x, y: c[0].y, id: c[0].id, src: F.a.id });
        }
      },
      onEnd({ battle, unit }) {
        for (const F of unit.mem.reedFire || []) battle.removeBuff(F.a, `reed2:fireball:${unit.id}`);
        unit.mem.reedFire = null;
      },
    },
  };
  return {
    skills,
    install(battle, unit) {
      // module “独属自己的一隅”: "攻击范围内存在已受伤的友方干员时，自身造成的伤害提升至110%"
      const ds = num(mod.damage_scale, 1);
      if (ds > 1) aura(battle, unit, 0.25, () => {
        if (battle.injuredAlliesInKeys(unit.rangeKeys, unit).some((a) => a.kind === 'op' && a !== unit)) {
          battle.addBuff(unit, { key: 'reed2:corner', mods: { dmgDealtMul: ds }, duration: 0.4, refresh: 'replace' });
        }
      });
    },
    skill: {
      kind: 'duration',
      mods: { atkPct: selfAtk },
      targeting: { maxTargets: Math.max(1, Math.floor(num(bb.max_target, 1))) },
      onStart({ unit }) { unit.mem.reedAcc = 0; },
      onTick({ battle, unit, dt }) {
        unit.mem.reedAcc += dt;
        if (unit.mem.reedAcc + 1e-9 < 1) return;
        unit.mem.reedAcc -= 1;
        if (!(dot > 0)) return;
        for (const e of battle.enemies) if (e.alive && !e.hidden && e.findBuff('reed2:scorch')) {
          battle.dealDamage(unit, e, { amount: unit.s.atk * dot, type: 'arts', isSkill: true, tags: ['skill', 'scorch'] });
        }
      },
    },
    talents: [
      { install(battle, unit) { // 灼痕 (+ S3 kill explosions)
        battle.on('damaged', (ctx) => {
          const t = ctx.target;
          if (ctx.source !== unit || !t || t.side !== 'enemy' || !t.alive || ctx.type === 'element') return;
          if (ctx.dmg?.tags?.includes('scorch')) return;
          const p = unit.skill?.active ? sProb : num(t0.prob);
          if (p >= 1 || (p > 0 && battle.rng() < p)) scorch(battle, unit, t);
        }, { owner: unit });
        battle.on('kill', ({ victim }) => {
          if (!unit.skill?.active || !live(unit) || victim.side !== 'enemy' || !victim.findBuff('reed2:scorch') || !(aoe > 0)) return;
          const x = victim.x, y = victim.y;
          // deferred to the next scheduler pass: chained explosions must not nest kill → damage → kill hooks
          battle.after(0, () => {
            if (!live(unit)) return;
            battle.fx('scorchBurst', { x, y, id: unit.id, r: aoeR });
            for (const e of battle.foesInRadius(x, y, aoeR, true)) { // splash around the victim: 中点判定
              if (!e.alive) continue;
              battle.dealDamage(unit, e, { amount: unit.s.atk * aoe, type: 'arts', isSkill: true, isSplash: true, tags: ['skill', 'scorch'] });
              scorch(battle, unit, e);
            }
          }, { owner: unit });
        }, { owner: unit });
      } },
      { install(battle, unit) { // 映耀
        const share = num(t1.scale), boost = num(t1.heal_scale, 1);
        battle.on('heal', (ctx) => {
          if (ctx.source !== unit || ctx.target === unit || ctx.opts?.reflect) return;
          if (boost !== 1) ctx.amount *= boost;
          if (share > 0 && ctx.amount > 0) battle.heal(unit, unit, ctx.amount * share, { self: true, reflect: true });
        }, { owner: unit });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 塑心 chess_char_6_09 (巫役) — S1 “黄金的狂喜”; 无词哀歌; 精神逆构; module 强弱法

function cello(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {}, mod = moduleBb(chess);
  const sid = selectedSkill(chess, def);
  const isS1 = sid === 'skchr_cello_1' || !(chess?.skills?.length); // S1 = the default (no loadout info ⇒ default)
  // "第二天赋效果提升至N倍" (S3): every 精神逆构 number scaled around 1 (delta × N) while it runs
  const boost = (c) => (c.mem.celloBoost > 0 ? c.mem.celloBoost : 1);
  const scaled = (v, c) => 1 + (v - 1) * boost(c);
  /** S2 partner: the other operator of her range with the highest ATK (re-picked every 0.5 s). */
  const pickPartner = (battle, unit) => {
    unit.mem.celloPick = 0.5;
    const ops = battle.alliesInGrid(unit).filter((a) => a !== unit && a.kind === 'op');
    unit.mem.celloPartner = ops.reduce((best, a) => (!best || a.s.atk > best.s.atk + 1e-9 ? a : best), null);
  };
  const skills = {
    // S2 “安魂的弥撒”: ASPD +, one extra target; while it runs every damage she or the highest-ATK other operator of her
    // range deals to an enemy also adds ep_damage_ratio × her ATK 凋亡损伤 (install)
    skchr_cello_2: {
      kind: 'duration',
      mods: { aspd: num(bb.attack_speed) },
      targeting: { maxTargets: 2 },
      onStart({ battle, unit }) { pickPartner(battle, unit); },
      onTick({ battle, unit, dt }) {
        unit.mem.celloPick -= dt;
        if (unit.mem.celloPick > 0 && live(unit.mem.celloPartner)) return;
        pickPartner(battle, unit);
      },
      onEnd({ unit }) { unit.mem.celloPartner = null; },
    },
    // S3 “自由的探戈”: stops attacking, skill range, ATK +atk, 精神逆构 ×scale_delta_to_one; the other operators of her
    // range with the highest max HP / ATK / DEF get +20 % of that stat
    skchr_cello_3: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      ...(skillGridOf(def) ? { targeting: { rangeGrid: skillGridOf(def) } } : {}),
      attack: { noAttack: true },
      onStart({ unit }) { unit.mem.celloBoost = num(bb.scale_delta_to_one, 1); unit.mem.celloAcc = Infinity; },
      onTick({ battle, unit, dt }) {
        unit.mem.celloAcc += dt;
        if (unit.mem.celloAcc < 0.5) return;
        unit.mem.celloAcc = 0;
        const ops = battle.alliesInGrid(unit).filter((a) => a !== unit && a.kind === 'op');
        const top = (f) => ops.reduce((best, a) => (!best || f(a) > f(best) + 1e-9 ? a : best), null);
        const give = (a, key, mods) => { if (a) battle.addBuff(a, { key, mods, duration: 0.75, refresh: 'replace', source: unit, visible: true }); };
        give(top((a) => a.base.maxHp), 'cello:tango:hp', { hpPct: num(bb['cello_s_3[max_hp].max_hp']) });
        give(top((a) => a.base.atk), 'cello:tango:atk', { atkPct: num(bb['cello_s_3[atk].atk']) });
        give(top((a) => a.base.def), 'cello:tango:def', { defPct: num(bb['cello_s_3[def].def']) });
      },
      onEnd({ unit }) { unit.mem.celloBoost = 1; },
    },
  };
  return {
    skills,
    // S1 "技能未开启时无法普通攻击" and its 未处于损伤爆发期间 target pick belong to S1 only
    trait: isS1 ? { noAttackUnlessSkill: true, priority: 'notBurst' } : null,
    install(battle, unit) {
      if (sid !== 'skchr_cello_2') return;
      const ratio = num(bb.ep_damage_ratio);
      // PRTS 塑心 S2 备注: "受影响的干员即将造成伤害时，因该效果造成的凋亡损伤生效于当次触发的伤害之前，该造成的凋亡损伤的来源
      // 始终为塑心" — a late `hit` handler (after every handler that may cancel the damage), so the 凋亡 lands while the
      // target is alive and may burst before the damage; 无来源 bursts (source null) never trigger it. It rides the
      // damage about to be dealt, so a hit dodged or absorbed afterwards still carried it [ASSUMED].
      battle.on('hit', (ctx) => {
        const s = ctx.source, t = ctx.target, d = ctx.dmg;
        if (!(ratio > 0) || !unit.skill?.active || !live(unit) || !s || !t || t.side !== 'enemy' || !hasHp(t) || !d || d.cancel) return;
        if (d.type === 'element' || d.type === 'elemental' || !(d.amount > 0) || (s !== unit && s !== unit.mem.celloPartner)) return;
        elementDmg(battle, unit, t, 'apoptosis', unit.s.atk * ratio);
      }, { owner: unit, priority: -1000 });
    },
    skill: {
      kind: 'charges',
      targeting: { priority: 'notBurst' },
      attack: {
        atkScale: num(bb.atk_scale, 1),
        onHit({ battle, unit, target }) { if (target && target.alive) elementDmg(battle, unit, target, 'apoptosis', unit.s.atk * num(bb.ep_damage_ratio)); },
      },
    },
    talents: [
      { install(battle, unit) { // 无词哀歌
        const er = num(t0.ep_damage_ratio), slug = num(t0.sluggish);
        aura(battle, unit, 1, () => {
          for (const e of enemiesIn(battle, unit)) {
            if (er > 0) elementDmg(battle, unit, e, 'apoptosis', unit.s.atk * er, ['talent']);
            if (slug > 0 && e.alive) battle.applyStatus(e, 'sluggish', { duration: slug, source: unit });
          }
        });
      } },
      { install(battle, unit) { // 精神逆构 (+ module element fragile / field-wide + DoT) and trait module (×1.18 vs elite/leader)
        const amp = num(t1.ep_damage_scale, 1), frag = num(t1.damage_scale, 1) - 1, elite = num(tb.ep_damage_scale, 1);
        // module 音乐家的旅程: "在场时，全场敌人…" (field-wide) + damage_value 元素伤害 per second during the burst
        const dot = num(t1.damage_value), fieldWide = t1.damage_value != null, dotIv = Math.max(0.1, num(t1.interval, 1));
        unit.mem.celloAmp = amp;
        unit.mem.celloWide = fieldWide;
        // one battle-wide handler: every apoptosis fill on an enemy inside some 塑心's range (or anywhere for a field-wide
        // one) × the strongest 精神逆构 (the same effect from two 塑心 does not stack)
        const S = bstate(battle);
        if (!S.cellos) {
          S.cellos = new Set();
          battle.on('elementHit', (ctx) => {
            const t = ctx.target, d = ctx.dmg;
            if (!d || d.type !== 'element' || d.element !== 'apoptosis' || !t || t.side !== 'enemy') return;
            let best = 1;
            for (const c of S.cellos) {
              if (!live(c) || !(c.mem.celloWide || bodyInKeys(t, c.rangeKeySet))) continue;
              const v = scaled(c.mem.celloAmp, c);
              if (v > best) best = v;
            }
            if (best > 1) d.mul *= best;
          });
        }
        if (amp > 1) S.cellos.add(unit);
        // 强弱法 (elite trait): her element damage vs elite / leader enemies ×1.18
        if (elite > 1) onElementHit(battle, unit, (ctx) => (ctx.source === unit && ctx.target.side === 'enemy' && isElite(ctx.target) ? elite : 1));
        // "凋亡损伤爆发期间受到5%的元素脆弱" — the 元素脆弱 status (同名效果取最高)
        if (frag > 0) aura(battle, unit, 0.25, () => {
          for (const e of enemiesIn(battle, unit)) if (e.findBuff('apoptosisBurst')) battle.applyStatus(e, 'elemFragile', { duration: 0.4, value: frag * boost(unit), source: unit });
        });
        if (dot > 0) aura(battle, unit, dotIv, () => {
          for (const e of battle.enemies) {
            if (e.alive && !e.hidden && e.findBuff('apoptosisBurst')) battle.dealDamage(unit, e, { amount: dot * boost(unit), type: 'elemental', element: 'apoptosis', canDodge: false, tags: ['talent', 'elementDmg'] });
          }
        });
        // module 音乐家的旅程 trait: "攻击范围内敌人受到10%的元素脆弱"
        const mFrag = num(mod.damage_scale, 1) - 1;
        if (mFrag > 0) aura(battle, unit, 0.25, () => {
          for (const e of enemiesIn(battle, unit)) battle.applyStatus(e, 'elemFragile', { duration: 0.4, value: mFrag, source: unit });
        });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 妮芙 chess_char_6_10 (本源术师, hidden tier-6 entry) — S2 怵然震爆; 失魂; 窥心钥; module 心声

function nymph(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const soul = (battle, unit, t, scale) => {
    const burst = t.findBuff('apoptosisBurst');
    if (!burst || !(scale > 0)) return;
    const key = `nymph:soul:${unit.id}`;
    const cur = t.findBuff(key);
    if (cur) { cur.data.scale = Math.max(cur.data.scale, scale); cur.timeLeft = Math.max(cur.timeLeft, burst.timeLeft); return; }
    battle.addBuff(t, {
      key, duration: Math.max(0.1, burst.timeLeft), interval: 1, source: unit, data: { scale },
      // 元素伤害 = the 'elemental' damage type (no DEF/RES, × elementalTakenMul)
      onTick: ({ unit: e, buff }) => { if (e.findBuff('apoptosisBurst')) battle.dealDamage(unit, e, { amount: unit.s.atk * buff.data.scale, type: 'elemental', element: 'apoptosis', canDodge: false, tags: ['talent', 'elementDmg'] }); },
    });
  };
  return {
    skill: {
      kind: 'charges',
      attack: {
        atkScale: num(bb.atk_scale, 1),
        splashRadius: num(bb.projectile_range, 1.5),
        splashScale: 1,
        onHit({ battle, unit, target }) {
          if (target && target.alive && num(bb.fear) > 0) battle.applyStatus(target, 'fear', { duration: num(bb.fear), source: unit });
          battle.fx('shockBlast', { x: target ? target.x : unit.x, y: target ? target.y : unit.y, id: unit.id });
        },
      },
    },
    talents: [
      { install(battle, unit) { // skill apoptosis (per damaged target) + 失魂
        battle.on('damaged', (ctx) => {
          const t = ctx.target;
          if (ctx.source !== unit || !t || t.side !== 'enemy' || ctx.type === 'element' || !ctx.dmg?.isAttack) return;
          const skillHit = !!ctx.dmg.isSkill;
          if (t.alive) soul(battle, unit, t, skillHit ? num(bb.element_atk_scale, num(t0.element_atk_scale)) : num(t0.element_atk_scale));
          if (skillHit && t.alive) elementDmg(battle, unit, t, 'apoptosis', ctx.amount * num(bb.ep_damage_ratio));
        }, { owner: unit });
      } },
      { install(battle, unit) { // 窥心钥 (elite module: field-wide, +ASPD at max stacks)
        const atk = num(t1.atk), max = Math.max(1, Math.floor(num(t1.max_stack_cnt, 10)));
        const fieldWide = t1.stack_cnt_check != null, as = num(t1.attack_speed);
        battle.on('deploy', ({ unit: u }) => { if (u === unit) unit.mem.nymphKey = 0; }, { owner: unit });
        battle.on('elementBurst', ({ target, element }) => {
          if (element !== 'apoptosis' || !live(unit) || !target || target.side !== 'enemy') return;
          if (!fieldWide && !bodyInKeys(target, unit.rangeKeySet)) return;
          unit.mem.nymphKey = Math.min(max, (unit.mem.nymphKey || 0) + 1);
          const n = unit.mem.nymphKey;
          battle.addBuff(unit, { key: 'nymph:key', mods: { atkPct: atk * n, aspd: fieldWide && n >= max ? as : 0 } });
        }, { owner: unit });
      } },
      { install(battle, unit) { // elite module: ×1.1 vs targets in an element burst
        const ds = num(tb.damage_scale, 1);
        if (ds > 1) battle.on('hit', (ctx) => { if (ctx.source === unit && ctx.target.s.flags.burstLock) ctx.dmg.mul *= ds; }, { owner: unit });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 缪尔赛思 chess_char_6_11 (战术家) — S3 浅层非熵适应; 净水即生命 (流形); 开源节流; module 梳妆流形

/**
 * The operator a 流形 copies: the nearest (Chebyshev tiles) living operator of its player on the field, not the summoner;
 * ties → higher base ATK → lower id. Same pick as content/tokens.js (unmanaged 流形), so both paths agree.
 */
function pickCopyTarget(battle, owner, t) {
  let best = null, bs = null;
  for (const a of battle.allyUnits) {
    if (a.kind !== 'op' || !live(a) || a === owner || a.ownerId !== owner.ownerId) continue;
    const s = [Math.max(Math.abs(a.tileR - t.tileR), Math.abs(a.tileC - t.tileC)), -a.base.atk, a.id];
    let less = !bs;
    if (!less) for (let i = 0; i < 3; i++) { if (s[i] < bs[i]) { less = true; break; } if (s[i] > bs[i]) break; }
    if (less) { best = a; bs = s; }
  }
  return best;
}

/**
 * 流形 copy (token talent "复制目标90%的生命值、攻击力、防御力、法抗，以及阻挡数、攻击间隔、攻击范围、初始伤害类型（不攻击、
 * 治疗类型则不继承）"): scale × HP/ATK/DEF/RES, block count, BAT/ASPD, range and damage type. The attack itself stays the
 * token's single-target attack (melee or ranged after the copied position) — splash/chain/multi-hit shapes are not
 * listed and not copied. `ranged` (近/远程位) decides the special trait (steal / split).
 */
function copyInto(battle, t, src, scale, ranged) {
  const sb = src.base, b = t.base;
  b.maxHp = Math.max(1, num(sb.maxHp, b.maxHp) * scale);
  for (const k of ['atk', 'def', 'res']) if (Number.isFinite(sb[k])) b[k] = sb[k] * scale;
  for (const k of ['blockCnt', 'bat', 'aspd']) if (Number.isFinite(sb[k])) b[k] = sb[k];
  if (Array.isArray(src.rangeGrid) && src.rangeGrid.length) t.rangeGrid = src.rangeGrid;
  const sp = src.profile || {};
  const p = t.profile;
  if (p) {
    p.attack = ranged ? 'ranged' : 'melee';
    // (a 阵法术师 / 轰击术师's instant 'beam' is their every-enemy-in-range shape: the copy fires a plain bolt)
    p.projectile = ranged ? (sp.projectile && sp.projectile !== 'none' && sp.projectile !== 'orb' && sp.projectile !== 'beam' ? sp.projectile : 'bolt') : 'none';
    p.canHitFly = ranged ? true : !!sp.canHitFly;
    if (!(sp.dmgType === 'heal' || sp.dmgType === 'none' || sp.noAttack || sp.noAttackUnlessSkill)) p.dmgType = sp.dmgType;
    p.heal = null;
    p.noAttack = false;
    p.noAttackUnlessSkill = false;
  }
  battle.removeBuff(t, 'mlyss:stolen');
  t.mem.mlyss = { ranged, from: src.id, stolenAtk: 0, stolenDef: 0, attacks: 0 }; // "复制后重置"
  t.markDirty();
  t.hp = t.s.maxHp;
  battle.refreshRange(t); // the copied grid: current + initial range, trigger keys
}

function mlyss(bb, chess, def) {
  const tokId = def?.talents?.[0]?.tokenKey || (chess?.tokens || [])[0] || 'token_10030_mlyss_wtrman';
  const t1 = tbb(def, 1), mod = moduleBb(chess);
  const isDef = onDefaultSkill(chess), sid = selectedSkill(chess, def);
  const reinfCut = parseN(chess?.trait?.moduleDesc, /伤害降低(\d+(?:\.\d+)?)%/, 0) / 100;
  // S3 (default) only: melee pulse interval, ranged-copy bind
  const pulseIv = Math.max(0.2, bv(bb, 'interval', 2)), bindDur = isDef ? bv(bb, 'duration', 1.5) : 0;
  // "自身与流形攻击力+N%（攻击速度+N）" — every skill of hers buffs the 流形 too while it runs
  const manifoldMods = { atkPct: num(bb.atk), ...(num(bb.attack_speed) ? { aspd: num(bb.attack_speed) } : {}) };
  const buffManifold = (battle, t, dur) => battle.addBuff(t, { key: 'mlyss:s3', mods: manifoldMods, duration: dur });
  // module 落叶四季 (开源节流): copying a 莱茵生命 operator ⇒ she gains `sp`; deploying the copied one ⇒ it gains `sp_other`
  const rhineSp = num(mod.sp), rhineSpOther = num(mod.sp_other);
  const tokTal = (t, key) => { for (const x of t.def?.talents || []) if (x?.bb && typeof x.bb[key] === 'number') return x.bb; return {}; };
  // "其被击败后会在25秒后自动刷新" (token talent interval; the talent text as a fallback)
  const respawnOf = (t) => num(tokTal(t, 'scale').interval, parseN(tdesc(def, 0), /(\d+(?:\.\d+)?)秒后自动刷新/, 25));
  const isRanged = (src) => (src.def?.position ? src.def.position === 'RANGED' : src.profile?.attack === 'ranged');

  const copyNearest = (battle, unit, t) => {
    const src = pickCopyTarget(battle, unit, t);
    if (!src) { // nobody to copy: the copy skill is not spent — it ends and stays ready (no attack without a copy)
      if (t.skill?.active) { t.skill.end('noTarget'); t.skill.gainSp(t.skill.spCost, 'refund'); }
      return;
    }
    copyInto(battle, t, src, num(tokTal(t, 'scale').scale, 1), isRanged(src));
    battle.fx('copy', { x: t.x, y: t.y, id: t.id, src: src.id });
    if (rhineSp > 0 && RHINE.has(src.def?.charId) && unit.skill) unit.skill.gainSp(rhineSp, 'talent');
  };
  const mineLive = (battle, unit) => battle.allyUnits.filter((x) => isTok(x, tokId, unit) && live(x));

  const skills = {
    // S1 渐进性润化: fake_cost DP over the skill (1 every mlyss_s_1[cost].interval s, the rest at its end), she and her
    // 流形 ATK / ASPD +
    skchr_mlyss_1: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) },
      onStart({ battle, unit, skill }) {
        unit.mem.mlyDp = { acc: 0, got: 0 };
        for (const t of mineLive(battle, unit)) buffManifold(battle, t, skill.timeLeft);
      },
      onTick({ battle, unit, dt }) {
        const m = unit.mem.mlyDp;
        if (!m) return;
        const iv = Math.max(0.1, bv(bb, 'interval', 1.364)), total = Math.floor(num(bb.fake_cost, 11)), per = bv(bb, 'cost', 1);
        m.acc += dt;
        while (m.acc + 1e-9 >= iv && m.got < total) { m.acc -= iv; m.got++; battle.addDp(unit.ownerId, per); }
      },
      onEnd({ battle, unit, reason }) {
        const m = unit.mem.mlyDp;
        unit.mem.mlyDp = null;
        const total = Math.floor(num(bb.fake_cost, 11));
        if (m && reason === 'duration' && m.got < total) battle.addDp(unit.ownerId, (total - m.got) * bv(bb, 'cost', 1));
      },
    },
    // S2 生态耦合: +cost DP, she and her 流形 ATK +; melee copies regenerate hp ratio / s and take 庇护; ranged copies
    // attack twice at random targets of their range (install)
    skchr_mlyss_2: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      onStart({ battle, unit, skill }) {
        battle.addDp(unit.ownerId, num(bb.cost));
        battle.fx('dp', { x: unit.x, y: unit.y, id: unit.id, n: num(bb.cost) });
        for (const t of mineLive(battle, unit)) buffManifold(battle, t, skill.timeLeft);
      },
    },
  };

  return {
    skills,
    install(battle, unit) {
      if (sid === 'skchr_mlyss_2') {
        const regen = num(bb.hp_recovery_per_sec_by_max_hp_ratio), dr = num(bb.damage_resistance);
        battle.every(0.25, () => {
          const on = !!unit.skill?.active && live(unit);
          for (const t of battle.allyUnits) {
            if (!isTok(t, tokId, unit) || !t.profile) continue;
            const m = t.mem.mlyss;
            if (t.mem.mlyssHits == null) t.mem.mlyssHits = Math.max(1, Math.floor(num(t.profile.hits, 1)));
            const ranged = !!(m && m.ranged);
            t.profile.hits = on && ranged && live(t) ? t.mem.mlyssHits * 2 : t.mem.mlyssHits; // 二连击
            if (on && m && !ranged && live(t)) {
              battle.addBuff(t, { key: 'mlyss:eco', duration: 0.4, refresh: 'replace', visible: true, mods: { hpRegenRatio: regen, physTakenMul: 1 - dr, artsTakenMul: 1 - dr } });
            }
          }
        }, { owner: unit });
        battle.on('beforeAttack', (ctx) => { // ranged copies: 随机攻击范围内的目标
          const t = ctx.attacker;
          if (!isTok(t, tokId, unit) || !t.mem.mlyss?.ranged || !unit.skill?.active) return;
          const c = battle.enemiesInKeys(t.rangeKeys, t, ctx.profile);
          if (c.length) ctx.targets = [battle.rng.pick(c)];
        }, { owner: unit });
      }
      if (rhineSpOther > 0) battle.on('deploy', ({ unit: u, initial }) => { // the copied 莱茵生命 operator is deployed
        if (initial || !u || u.kind !== 'op' || u.ownerId !== unit.ownerId || !RHINE.has(u.def?.charId) || !u.skill) return;
        if (battle.allyUnits.some((t) => isTok(t, tokId, unit) && live(t) && t.mem.mlyss?.from === u.id)) u.skill.gainSp(rhineSpOther, 'talent');
      }, { owner: unit });
    },
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      onStart({ battle, unit, skill }) {
        battle.addDp(unit.ownerId, num(bb.cost));
        battle.fx('dp', { x: unit.x, y: unit.y, id: unit.id, n: num(bb.cost) });
        const S = unit.mem;
        let ranged = false;
        for (const t of battle.allyUnits.filter((x) => isTok(x, tokId, unit) && live(x))) {
          buffManifold(battle, t, skill.timeLeft);
          if (t.mem.mlyss?.ranged) ranged = true;
        }
        if (ranged) { // 刷新所有流形: heal the living ones, respawn the destroyed ones now
          for (const t of battle.allyUnits.filter((x) => isTok(x, tokId, unit) && live(x))) t.hp = t.s.maxHp;
          for (const p of (S.mlyssPending || []).splice(0)) { p.timer?.cancel?.(); p.spawn(); }
        }
        S.mlyssPulse = battle.every(pulseIv, () => { // melee copies: pull the 8 surrounding tiles + stun blocked units
          if (!unit.skill?.active) return;
          for (const t of battle.allyUnits) {
            if (!isTok(t, tokId, unit) || !live(t) || !t.mem.mlyss || t.mem.mlyss.ranged) continue;
            for (const e of battle.unitsInGrid(t, AROUND8, { side: 'enemy' })) pullToward(battle, t, e, num(t.def?.skill?.bb?.force));
            for (const e of t.blocking) if (e.alive) battle.applyStatus(e, 'stun', { duration: pulseIv + 0.1, source: unit });
            battle.fx('pulse', { x: t.x, y: t.y, id: t.id });
          }
        }, { owner: unit, immediate: true });
      },
      onEnd({ unit }) { if (unit.mem.mlyssPulse) unit.mem.mlyssPulse.cancel(); unit.mem.mlyssPulse = null; },
    },
    talents: [
      { install(battle, unit) { // 净水即生命: 流形 copy / respawn / melee steal / ranged split
        unit.mem.mlyssPending = [];
        const S = bstate(battle);
        S.robbed ??= new WeakMap(); // enemy → { atk, def } stolen by any 流形
        const mine = (t) => isTok(t, tokId, unit);
        // her 流形 on the field (split clones aside: deployLimit 1 counts the 流形 itself)
        const standing = () => battle.allyUnits.some((t) => mine(t) && live(t) && !t.mem.mlyssClone);
        const cancelPending = () => { for (const p of unit.mem.mlyssPending.splice(0)) p.timer?.cancel?.(); };
        battle.on('deploy', ({ unit: t }) => {
          if (!mine(t)) return;
          const clone = unit.mem.mlyssCloneOf;
          if (clone) { // a split copy: same stats as its origin, never copies/splits/respawns itself
            unit.mem.mlyssCloneOf = null;
            t.mem.mlyssClone = true;
            t.mem.isClone = true; // content/tokens.js skips clones too (her redeploy must bring a real 流形, not adopt a clone)
            copyInto(battle, t, clone, 1, true);
            return;
          }
          cancelPending(); // a 流形 stands again (tactical re-summon, S3 refresh): no second one later
          t.mem.mlyssHome = [t.tileR, t.tileC];
          const sp = num(tokTal(t, 'sp').sp);
          if (sp > 0 && !unit.mem.mlyssFirst && t.skill) t.skill.gainSp(sp, 'talent'); // elite: first deployment +5 SP
          unit.mem.mlyssFirst = true;
          if (unit.skill?.active && unit.skill.isTimed) buffManifold(battle, t, unit.skill.timeLeft);
        }, { owner: unit });
        battle.on('skillStart', ({ unit: t }) => { if (mine(t) && !t.mem.mlyssClone) copyNearest(battle, unit, t); }, { owner: unit });
        // trigger rule MLYSS_WTRMAN ("全部技能，受流形影响") [ASSUMED]: DEFAULT (engine), and an enemy inside the range of one
        // of her copied 流形 also satisfies it (her S3 acts through the 流形: pull/stun or bind around them)
        if (unit.skill) unit.skill.addTriggerRange(() => battle.allyUnits.filter((t) => mine(t) && live(t) && t.mem.mlyss));
        battle.on('tick', () => { // without a dedicated token kit the copy fires once ready and someone can be copied
          for (const t of battle.allyUnits) {
            if (!mine(t) || !live(t) || t.mem.mlyssClone || !t.kit?.generic || !t.skill || t.skill.active || !t.skill.ready || t.skill.opCooling) continue;
            if (pickCopyTarget(battle, unit, t)) t.skill.activate('MLYSS_WTRMAN');
          }
        }, { owner: unit });
        // "其被击败后会在25秒后自动刷新": one pending respawn at a time, on its tile, only while she is on the field and no
        // 流形 of hers stands (her redeploy summons it again as her 援军, tokens.js); expired / replaced ones do not return
        battle.on('death', ({ unit: t, reason }) => {
          if (t === unit) { cancelPending(); return; }
          if (!mine(t) || t.mem.mlyssClone || reason !== 'killed' || !t.mem.mlyssHome || standing()) return;
          cancelPending();
          const [r, c] = t.mem.mlyssHome;
          const entry = { spawn: null, timer: null };
          let tries = 0;
          entry.spawn = () => {
            const i = unit.mem.mlyssPending.indexOf(entry);
            if (i >= 0) unit.mem.mlyssPending.splice(i, 1);
            if (battle.finished || !live(unit) || standing() || tries++ > 120) return;
            if (battle.isReservedTile(r, c) || !battle.spawnToken(unit, tokId, r, c)) { // its tile is taken: retry in 1 s
              entry.timer = battle.after(1, entry.spawn, { owner: unit });
              unit.mem.mlyssPending.push(entry);
            }
          };
          entry.timer = battle.after(respawnOf(t), entry.spawn, { owner: unit });
          unit.mem.mlyssPending.push(entry);
        }, { owner: unit });
        battle.on('attack', ({ attacker: t, targets }) => {
          if (!mine(t) || !t.mem.mlyss || !live(t)) return;
          const tal = tokTal(t, 'steal_atk');
          const m = t.mem.mlyss;
          if (!m.ranged) { // melee copy: 每次攻击偷取敌方10点攻击力与防御力（最高250点）— a capped copy steals nothing more
            const sa = num(tal.steal_atk), sd = num(tal.steal_def, sa);
            const capA = num(tal.steal_atk_max, Infinity), capD = num(tal.steal_def_max, capA);
            let changed = false;
            for (const e of targets) {
              if (!e.alive || e.side !== 'enemy') continue;
              const ga = Math.max(0, Math.min(sa, capA - m.stolenAtk)), gd = Math.max(0, Math.min(sd, capD - m.stolenDef));
              if (!(ga > 0 || gd > 0)) break;
              m.stolenAtk += ga; m.stolenDef += gd;
              const rb = S.robbed.get(e) || { atk: 0, def: 0 };
              rb.atk += ga; rb.def += gd;
              S.robbed.set(e, rb);
              battle.addBuff(e, { key: 'mlyss:robbed', mods: { atkFlat: -rb.atk, defFlat: -rb.def }, source: t });
              changed = true;
            }
            if (changed) battle.addBuff(t, { key: 'mlyss:stolen', mods: { atkFlat: m.stolenAtk, defFlat: m.stolenDef } });
          } else if (!t.mem.mlyssClone) { // ranged copy: split every N attacks (the clone lasts `interval` s)
            const every = Math.max(1, Math.floor(bv(tal, 'max_stack_cnt', 10)));
            if (++m.attacks % every !== 0) return;
            const tiles = N4.slice(1).map(([dr, dc]) => [t.tileR + dr, t.tileC + dc])
              .filter(([r, c]) => battle.grid.inRect(r, c) && !battle.isReservedTile(r, c) && battle.grid.canStand(r, c, { ranged: true }));
            const tile = bestTile(battle, tiles);
            if (!tile) return;
            unit.mem.mlyssCloneOf = t;
            let cl = null;
            try { cl = battle.spawnToken(unit, tokId, tile[0], tile[1], { duration: num(tal.interval, 25), kit: { skill: null } }); } finally { unit.mem.mlyssCloneOf = null; }
            if (cl) battle.fx('split', { x: cl.x, y: cl.y, id: cl.id, src: t.id });
          }
        }, { owner: unit });
        battle.on('damaged', (ctx) => { // S3, ranged copies: attacks bind
          const t = ctx.source;
          if (!mine(t) || !t.mem.mlyss?.ranged || !unit.skill?.active || !ctx.dmg?.isAttack || !ctx.target.alive || !(bindDur > 0)) return;
          battle.applyStatus(ctx.target, 'bind', { duration: bindDur, source: unit });
        }, { owner: unit });
        battle.on('hit', (ctx) => { // module: 援军 / 流形 take less damage from the enemies they block
          const t = ctx.target, s = ctx.source;
          if (!t || !s || s.side !== 'enemy' || s.blockedBy !== t) return;
          if (mine(t)) { // 流形 (her 援军): token module part, unless its token kit (content/tokens.js) applies it
            if (!t.kit?.fromTokens) { const ds = num(tokTal(t, 'damage_scale').damage_scale, 1); if (ds > 0 && ds < 1) ctx.dmg.mul *= ds; }
          } else if (reinfCut > 0 && t === unit.trait?.reinforcement) ctx.dmg.mul *= 1 - reinfCut; // engine 援军
        }, { owner: unit });
        // module 落叶四季: "援军阻挡的敌人更容易受到我方的攻击" — the 流形's module part (token talent taunt_level: +1) on
        // the enemies it blocks: our operators pick higher-taunt enemies first (targeting.js sortEnemyTargets)
        battle.every(0.25, () => {
          for (const t of battle.allyUnits) {
            if (!mine(t) || !live(t) || !t.blocking.length) continue;
            const lv = num(tokTal(t, 'taunt_level').taunt_level);
            if (!(lv > 0)) continue;
            for (const e of t.blocking) if (e.alive) battle.addBuff(e, { key: 'mlyss:exposed', mods: { taunt: lv }, duration: 0.4, refresh: 'replace', source: t });
          }
        }, { owner: unit });
      } },
      { install(battle, unit) { // 开源节流: 莱茵生命 ops of the owner cost less DP to redeploy
        const S = bstate(battle);
        S.rhine ??= new Set();
        if (S.rhine.has(unit.ownerId)) return;
        S.rhine.add(unit.ownerId);
        const cut = num(t1.cost), first = num(t1.runtime_cost);
        battle.on('battleStart', () => {
          const rh = battle.allyUnits.filter((a) => a.kind === 'op' && a.ownerId === unit.ownerId && RHINE.has(a.def?.charId)).sort((a, b) => a.deploySeq - b.deploySeq);
          rh.forEach((a, i) => { a.base.cost = Math.max(0, a.base.cost + cut + (i === 0 ? first : 0)); });
        });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 迷迭香 chess_char_6_12 (投掷手) — S2 末梢阻断; 歼灭战装备; 感知稳定

/** S2 末梢阻断 "溅射范围扩大": radius 1.5 (PRTS 溅射半径一览, 技能: 迷迭香 末梢阻断 1.5; ×1.3 [ASSUMED] until 0.1.1). */
const ROSMON_S2_SPLASH = 1.5;

function rosmon(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1);
  const sid = selectedSkill(chess, def);
  const prob = num(bb['attack@prob']), stun = num(bb['attack@stun']);
  const gearId = (chess?.tokens || []).find((t) => /rosmon_shield/.test(String(t))) || 'token_10012_rosmon_shield';
  const skills = {
    // S1 思维膨大 (attack SP): the next attack also deals extra_atk_scale × ATK arts to every enemy it hits
    skchr_rosmon_1: {
      kind: 'instant',
      attack: {
        onEachHit({ battle, unit, target, kind }) {
          if (!target || !target.alive || (kind !== 'main' && kind !== 'splash')) return;
          battle.dealDamage(unit, target, { amount: unit.s.atk * num(bb.extra_atk_scale, 1), type: 'arts', isSkill: true, tags: ['skill'] });
        },
      },
    },
    // S3 “如你所愿”: base attack time ×0.5 (akdata: 乘算负数), ATK +atk, 2 targets but blocked enemies only (install);
    // two 战术装备 on melee tiles of her range (the token kit: appear stun, blocked enemies DEF −160, lifetime)
    skchr_rosmon_3: {
      kind: 'duration',
      mods: { batPct: batOf(bb.base_attack_time, def, true), atkPct: num(bb.atk) },
      targeting: { maxTargets: Math.max(1, Math.floor(num(bb['attack@max_target'], 2))) },
      onStart({ battle, unit }) {
        let n = 0;
        for (let i = 0; i < 2; i++) if (summonToken(battle, unit, gearId, 'melee')) n++;
        battle.fx('summon', { x: unit.x, y: unit.y, id: unit.id, n });
      },
    },
  };
  return {
    skills,
    install(battle, unit) {
      if (sid !== 'skchr_rosmon_3') return;
      battle.on('beforeAttack', (ctx) => { // "仅选择被阻挡的敌人作为目标"
        if (ctx.attacker !== unit || !unit.skill?.active) return;
        // her range, plus the enemies she blocks herself — always her targets (Battle.blockedTargets, DESIGN §20.3)
        const c = battle.enemiesInKeys(unit.rangeKeys, unit, ctx.profile);
        for (const e of battle.blockedTargets(unit, ctx.profile)) if (!c.includes(e)) c.push(e);
        for (let i = c.length - 1; i >= 0; i--) if (!c[i].blockedBy) c.splice(i, 1);
        sortEnemyTargets(battle, unit, c, ctx.profile?.priority ?? null);
        ctx.targets = c.slice(0, Math.max(1, Math.floor(num(ctx.profile?.maxTargets, 2))));
      }, { owner: unit });
    },
    skill: {
      kind: 'duration',
      mods: { batPct: batOf(bb.base_attack_time, def), atkPct: num(bb.atk) },
      onStart({ unit }) {
        const p = unit.profile;
        unit.mem.rosSaved = { r: p.splashRadius, n: p.shockTimes };
        p.splashRadius = Math.max(num(p.splashRadius, 0.9), ROSMON_S2_SPLASH);
        p.shockTimes = num(p.shockTimes, 2) + Math.floor(num(bb.add_times));
      },
      onEnd({ unit }) {
        const s = unit.mem.rosSaved;
        if (s) { unit.profile.splashRadius = s.r; unit.profile.shockTimes = s.n; }
        unit.mem.rosSaved = null;
      },
    },
    talents: [
      { install(battle, unit) { // S2: attack & aftershock stun chance
        battle.on('damaged', (ctx) => {
          if (ctx.source !== unit || !unit.skill?.active || !(stun > 0) || !ctx.target.alive || ctx.target.side !== 'enemy') return;
          if (!ctx.dmg?.isAttack && !ctx.dmg?.tags?.includes('aftershock')) return;
          if (battle.rng() < prob) battle.applyStatus(ctx.target, 'stun', { duration: stun, source: unit });
        }, { owner: unit });
      } },
      { install(battle, unit) { // 歼灭战装备
        const v = num(t0.def_penetrate_fixed);
        if (v) battle.addBuff(unit, { key: 'rosmon:pierce', mods: { defIgnoreFlat: v }, persist: true, allowDead: true });
      } },
      { install(battle, unit) { // 感知稳定
        const atk = num(t1.atk);
        battle.on('deploy', ({ unit: u }) => {
          if (u !== unit || !atk) return;
          battle.after(0, () => {
            if (!live(unit)) return;
            const casters = opsOf(battle, unit.ownerId).filter((a) => a.def?.profession === 'CASTER');
            const pick = battle.rng.pick(casters);
            if (!pick) return;
            battle.addBuff(unit, { key: 'rosmon:stable', mods: { atkPct: atk } });
            battle.addBuff(pick, { key: 'rosmon:stable', mods: { atkPct: atk } });
            battle.fx('link', { x: pick.x, y: pick.y, id: pick.id, src: unit.id });
          }, { owner: unit });
        }, { owner: unit });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 新约能天使 chess_char_6_13 (怪杰) — S2 开火成瘾症; 火力电台; 铳弹协约; module 新朋友圣城生活套组
// S2 (PRTS 备注): the ally is the friendly operator of her attack range with the highest 仇恨值 ("选择的友方干员为攻击范围内
// 仇恨值最高的我方干员": highest taunt level, then the latest deployed — targeting.js aggroCmp, the order enemies attack
// in; it used to be the highest ASPD, so the shield often went to a back-row shooter instead of the operator in front);
// both barriers are shield_max_hp_ratio × the holder's OWN max HP ("获得的屏障均以自身生命上限为标准计算"), losing
// initial/shield_max_duration per second ("屏障每秒衰减量为：初始屏障量/30"); a new one replaces the old one ("重复获得此
// 屏障时，重置屏障量与衰减速度").

const AIRSTRIKE_RADIUS = 1; // [ASSUMED] bombardment splash radius (not in data)

function angel2(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const sid = selectedSkill(chess, def);
  const steal = num(bb.steal), extra = Math.floor(num(bb.addtional_ammo_each));
  const shieldRatio = num(bb.shield_max_hp_ratio), shieldDur = num(bb.shield_max_duration);
  const coordId = (chess?.tokens || []).find((t) => /angel2_target/.test(String(t))) || TOKEN_IDS.deliveryTarget;
  const perAttack = 5; // S3 "每次攻击消耗5发" (the 5 连击)
  const coord = (battle, unit) => battle.allyUnits.find((t) => isTok(t, coordId, unit) && t.alive) ?? null;
  const placeCoord = (battle, unit) => {
    unit.mem.angelCoord = false;
    if (coord(battle, unit)) return;
    const t = summonToken(battle, unit, coordId, 'melee');
    if (t) battle.fx('anchor', { x: t.x, y: t.y, id: t.id, src: unit.id });
  };
  const skills = {
    // S1 天空大扫除: 8 bullets at attack@atk_scale × ATK, flyers first; stopped by hand ⇒ the remaining bullets are fired
    // at random enemies of her range
    skchr_angel2_1: {
      kind: 'ammo',
      ammo: Math.max(1, Math.floor(num(bb['attack@trigger_time'], 8))),
      attack: { atkScale: num(bb['attack@atk_scale'], 1) },
      targeting: { priority: 'fly' },
      onAttack({ unit, skill }) { unit.mem.angelLeft = skill.ammoLeft - 1; },
      onEnd({ battle, unit, skill, reason }) {
        const left = Math.max(0, Math.floor(num(unit.mem.angelLeft)));
        unit.mem.angelLeft = 0;
        if (reason !== 'stopped' || !unit.alive || !left) return;
        for (let i = 0; i < left; i++) {
          const c = battle.enemiesInKeys(unit.rangeKeys, unit, ANY);
          const e = battle.rng.pick(c);
          if (!e) break;
          battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb['attack@atk_scale'], 1), type: 'phys', isAttack: true, isSkill: true, tags: ['skill', 'volley'] });
          battle.emit('ammoUsed', { unit, left: left - i - 1, skill });
        }
      },
    },
    // S3 使命必达！: ATK +atk; attacks are 5 hits of attack@atk_scale × ATK spending 5 of the 50 bullets; at the start,
    // with a 投递坐标 (placed after each deployment, install): attack@cannon_atk_scale × ATK physical splash there and the
    // knocked-out ground operator with the longest remaining redeploy time lands on it with attack@sp SP
    skchr_angel2_3: {
      kind: 'ammo',
      ammo: Math.max(1, Math.floor(num(bb['attack@trigger_time'], 50))),
      mods: { atkPct: num(bb.atk) },
      attack: { atkScale: num(bb['attack@atk_scale'], 1), hits: perAttack },
      onStart({ battle, unit }) {
        if (unit.mem.angelCoord) placeCoord(battle, unit);
        const c = coord(battle, unit);
        if (!c) return;
        const r = c.tileR, col = c.tileC;
        battle.fx('airstrike', { x: col, y: r, id: unit.id, r: AIRSTRIKE_RADIUS });
        for (const e of battle.foesInRadius(col, r, AIRSTRIKE_RADIUS)) {
          if (e.alive && !e.s.flags.untargetable) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb['attack@cannon_atk_scale'], 1), type: 'phys', isSkill: true, isSplash: true, tags: ['skill', 'delivery'] });
        }
        const waiting = battle.allyUnits.filter((a) => a.kind === 'op' && a.ownerId === unit.ownerId && !a.alive && !a.removed && a !== unit
          && a.def?.position !== 'RANGED' && battle.grid.canStand(r, col, { ranged: false }));
        if (!waiting.length) return;
        waiting.sort((a, b) => (b.respawnAt ?? 0) - (a.respawnAt ?? 0) || b.base.respawnTime - a.base.respawnTime || a.id - b.id);
        const a = waiting[0];
        battle.retreat(c, { reason: 'expired', permanent: true });
        if (battle.redeploy(a, { free: true, tile: [r, col] })) {
          if (a.skill) a.skill.gainSp(num(bb['attack@sp']), 'skill');
          battle.fx('appear', { x: col, y: r, id: a.id, src: unit.id });
        }
      },
      onAttack({ battle, unit, skill }) { // bullets 2..5 of the 5 连击 (the engine spends the 1st)
        for (let i = 1; i < perAttack && skill.ammoLeft > 1; i++) {
          skill.ammoLeft--;
          battle.emit('ammoUsed', { unit, left: skill.ammoLeft, skill });
        }
      },
    },
  };
  return {
    skills,
    install(battle, unit) {
      if (sid === 'skchr_angel2_1') { // bullets loaded at the start (after every skillStart ammo bonus: 逃犯引渡手续 …)
        battle.on('skillStart', ({ unit: u, skill }) => { if (u === unit) unit.mem.angelLeft = skill.ammoLeft; }, { owner: unit, priority: -500 });
      }
      if (sid !== 'skchr_angel2_3') return;
      // "部署后获得投递坐标": one coordinate per deployment, placed (the player's choice in the original) on a ground tile
      // of her range on the enemy path next to the first enemy that enters her range (at the latest when S3 starts)
      battle.on('deploy', ({ unit: u }) => { if (u === unit) unit.mem.angelCoord = !coord(battle, unit); }, { owner: unit });
      battle.on('tick', () => {
        if (!unit.mem.angelCoord || !live(unit) || !battle.enemiesInKeys(unit.rangeKeys, unit, ANY).length) return;
        placeCoord(battle, unit);
      }, { owner: unit });
    },
    skill: {
      kind: 'ammo',
      ammo: Math.max(1, Math.floor(num(bb['attack@trigger_time'], 10))),
      mods: { batPct: batOf(bb.base_attack_time, def) },
      attack: { atkScale: num(bb['attack@atk_scale'], 1) },
      onStart({ battle, unit, skill }) {
        const cands = battle.alliesInGrid(unit).filter((a) => a !== unit && a.kind === 'op' && live(a));
        cands.sort(aggroCmp);
        const victim = steal > 0 ? cands[0] ?? null : null;
        unit.mem.angelVictim = victim;
        decayingShield(battle, unit, 'angel2:barrier', unit.s.maxHp * shieldRatio, shieldDur);
        if (victim) {
          battle.addBuff(victim, { key: 'angel2:stolen', mods: { aspd: -steal }, source: unit, visible: true });
          battle.addBuff(unit, { key: 'angel2:steal', mods: { aspd: steal } });
          decayingShield(battle, victim, 'angel2:barrier', victim.s.maxHp * shieldRatio, shieldDur);
          if (extra > 0) skill.addAmmo(extra);
          battle.fx('steal', { x: victim.x, y: victim.y, id: victim.id, src: unit.id });
        }
      },
      onEnd({ battle, unit }) {
        const v = unit.mem.angelVictim;
        unit.mem.angelVictim = null;
        if (v) battle.removeBuff(v, 'angel2:stolen');
        battle.removeBuff(unit, 'angel2:steal');
      },
    },
    talents: [
      { install(battle, unit) { // 火力电台
        const hr = num(t0.hp_ratio), prob = num(t0.prob), sc = num(t0.aoe_atk_scale, num(t0.damage_scale));
        battle.on('ammoUsed', ({ unit: u }) => {
          if (!live(unit) || !u || u.side !== 'ally') return;
          if (hr > 0) battle.heal(unit, unit, unit.s.maxHp * hr, { self: true, silent: true });
          if (!(prob > 0) || !(sc > 0) || battle.rng() >= prob) return;
          const cands = battle.enemiesInKeys(u.rangeKeys || [], u, ANY);
          if (!cands.length) return;
          sortEnemyTargets(battle, u, cands, null);
          const c = cands[0];
          battle.fx('airstrike', { x: c.x, y: c.y, id: unit.id, r: AIRSTRIKE_RADIUS });
          for (const e of battle.foesInRadius(c.x, c.y, AIRSTRIKE_RADIUS, true)) { // splash around the target: 中点判定
            if (e.alive && !e.s.flags.untargetable) battle.dealDamage(unit, e, { amount: unit.s.atk * sc, type: 'phys', isSkill: true, isSplash: true, tags: ['talent', 'airstrike'] });
          }
        }, { owner: unit });
      } },
      { install(battle, unit) { // 铳弹协约
        const atk = num(t1.atk), mult = num(t1.mult, 1);
        if (atk) aura(battle, unit, 0.5, () => {
          for (const a of battle.allyUnits) {
            if (!live(a) || a.kind !== 'op' || !a.skill || a.skill.kind !== 'ammo') continue;
            battle.addBuff(a, { key: 'angel2:covenant', mods: { atkPct: atk * (hasBond(a, 'lateranoShip') ? mult : 1) }, duration: 0.75, refresh: 'replace' });
          }
        });
      } },
      { install(battle, unit) { // elite module: HP > 80 % ⇒ SP +0.25/s
        const thr = bv(tb, 'hp_ratio', 0), spr = bv(tb, 'sp_recovery_per_sec', 0);
        if (spr > 0 && tb['angel2_tr[e].hp_ratio'] != null) aura(battle, unit, 0.25, () => {
          if (unit.hpRatio > num(tb['angel2_tr[e].hp_ratio'], thr)) battle.addBuff(unit, { key: 'angel2:calm', mods: { spRecoveryFlat: spr }, duration: 0.4, refresh: 'replace' });
        });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 流明 chess_char_6_14 (疗养师) — S3 灯火不灭; 凡人之愿; 应急处理; module 纯铜单筒望远镜

function lumen(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const isDef = onDefaultSkill(chess);
  const hs = num(bb.heal_scale, 1);
  const abnormalAllies = (battle, unit) => battle.alliesInGrid(unit).filter((a) => hasAbnormal(a)).sort((a, b) => a.hpRatio - b.hpRatio || a.deploySeq - b.deploySeq);
  const cleanse = (battle, t) => { cleanseAbnormal(battle, t); };
  const skills = {
    // S1 沐雨: the next heal also gives its target and the allies around it (8 tiles) aura.heal_scale × ATK healing
    // per second for aura.projectile_life_time s
    skchr_lumen_1: {
      kind: 'instant',
      heal: true,
      attack: { healScale: 1 },
      onHit({ battle, unit, target }) {
        if (!target) return;
        const sc = bv(bb, 'heal_scale'), life = bv(bb, 'projectile_life_time', 4), iv = Math.max(0.2, bv(bb, 'interval', 1));
        if (!(sc > 0) || !(life > 0)) return;
        battle.fx('healField', { x: target.x, y: target.y, id: unit.id });
        for (const a of battle.alliesInRadius(target.x, target.y, 1.5, target.ownerId)) {
          if (a.kind === 'device' || a.s.flags.noHeal || a.profile?.noHeal) continue; // a heal: never on 禁疗 / 孤立
          battle.addBuff(a, {
            key: `lumen:rain:${unit.id}`, duration: life, interval: iv, refresh: 'replace', visible: true, source: unit,
            onTick: ({ unit: x }) => { if (x.hp < x.s.maxHp) battle.heal(unit, x, unit.s.atk * sc, { hot: true }); },
          });
        }
      },
    },
    // S2 沛霖 (2 charges): heal up to max_target allies of her range for heal_scale × ATK; cast with full charges ⇒
    // also cleanse their 异常状态 (蓄力额外效果)
    skchr_lumen_2: {
      kind: instantKind(def),
      heal: true,
      onStart({ battle, unit, skill }) {
        const full = skill.maxCharges > 1 && skill.charges >= skill.maxCharges - 1; // (this cast already spent one)
        const inj = battle.injuredAlliesInKeys(unit.rangeKeys, unit);
        const abn = full ? abnormalAllies(battle, unit).filter((a) => !inj.includes(a)) : [];
        const tgts = inj.concat(abn).slice(0, Math.max(1, Math.floor(num(bb.max_target, 2))));
        for (const t of tgts) {
          battle.heal(unit, t, unit.s.atk * num(bb.heal_scale, 1), { skillHeal: true });
          if (full) cleanse(battle, t);
        }
        battle.fx('heal', { x: unit.x, y: unit.y, id: unit.id, n: tgts.length, charged: full });
      },
    },
  };
  return {
    skills,
    skill: {
      kind: 'ammo',
      heal: true,
      ammo: Math.max(1, Math.floor(num(bb['attack@trigger_time'], 4))),
      mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) },
      attack: { healScale: 1 },
      onHit({ battle, unit, target }) { if (unit.mem.lumenAbn && target) cleanse(battle, target); },
      onAttack(ctx) { // only heals on abnormal targets consume a bullet (engine: ctx.noAmmo — no bullet, no ammoUsed)
        if (!ctx.unit.mem.lumenAbn) ctx.noAmmo = true;
        ctx.unit.mem.lumenAbn = false;
      },
    },
    talents: [
      { install(battle, unit) { // S3 targeting / bullet bookkeeping
        if (!isDef) return;
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !unit.skill?.active) return;
          const abn = abnormalAllies(battle, unit);
          unit.mem.lumenAbn = abn.length > 0;
          if (abn.length) ctx.targets = [abn[0]];
          if (ctx.profile && ctx.profile !== unit.profile) ctx.profile.healScale = abn.length ? hs : 1;
        }, { owner: unit });
        battle.on('tick', () => { // abnormal allies at full HP are healed too
          const sk = unit.skill;
          if (!sk?.active || !unit.canAct || unit.atkCd > 0 || unit.s.flags.disarm) return;
          if (battle.injuredAlliesInKeys(unit.rangeKeys, unit).length) return;
          const abn = abnormalAllies(battle, unit);
          if (!abn.length) return;
          battle.forceAttack(unit, [abn[0]]);
          unit.atkCd = unit.s.interval;
        }, { owner: unit });
      } },
      { install(battle, unit) { // 凡人之愿: healed targets gain 抵抗
        const base = bv(t0, 'status_resistance[limit]', 0), special = num(t0['lumen_t_1[special].status_resistance[limit]'], base);
        const res = -num(t0.one_minus_status_resistance, -0.5), thr = num(t0.hp_ratio, 0.75);
        battle.on('heal', (ctx) => {
          const t = ctx.target;
          if (ctx.source !== unit || !t || !(res > 0) || !(base > 0)) return;
          const after = Math.min(t.s.maxHp, t.hp + ctx.amount);
          battle.applyStatus(t, 'resist', { duration: after / t.s.maxHp > thr ? special : base, value: Math.min(1, res), source: unit });
        }, { owner: unit, priority: -10 });
      } },
      { install(battle, unit) { // 应急处理
        const sc = num(t1.heal_scale), cd = num(t1.duration, 12);
        let ready = -Infinity;
        battle.on('statusApplied', (ctx) => {
          const t = ctx.target;
          if (!live(unit) || !t || t.side !== 'ally' || !ABNORMAL.has(ctx.status) || battle.time < ready || !(sc > 0)) return;
          if (!unit.rangeKeySet?.has(t.tileR * COLS + t.tileC)) return;
          ready = battle.time + cd;
          battle.heal(unit, t, unit.s.atk * sc);
          battle.fx('emergency', { x: t.x, y: t.y, id: t.id, src: unit.id });
        }, { owner: unit });
      } },
      { install(battle, unit) { // elite module: taunt −1 and 抵抗
        const taunt = num(tb.taunt_level), res = -num(tb.one_minus_status_resistance);
        if (taunt) battle.addBuff(unit, { key: 'lumen:scope', mods: { taunt }, persist: true, allowDead: true });
        // a permanent 抵抗 (survives death/redeploy): any buff with status 'resist' counts (engine resistOf — the
        // strongest one applies, never compounding with 凡人之愿 / 灵知)
        if (res > 0) battle.addBuff(unit, { key: 'lumen:scopeResist', status: 'resist', visible: true, persist: true, allowDead: true, data: { value: Math.min(1, res) } });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 仇白 chess_char_6_15 (领主) — S3 问雪; 入隙; 落英; module 雪浸过的斗笠

function qiubai(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const extraTargets = parseN(def?.skill?.description, /额外攻击(\d+)个目标/, 0);
  const skillGrid = def?.skill?.rangeGrid?.length ? def.skill.rangeGrid : null;
  const gapScale = t0.atk_scale_t != null ? num(t0.atk_scale_t) : num(t0.atk_scale), bothMul = t0.atk_scale_t != null ? num(t0.value, 1) : 1;
  const modArts = num(tb.atk_scale_m);
  // module 欲雪时: 落英 "首次命中敌人时提升至100%且束缚时间提升至3秒" (duration_advanced); trait "攻击范围内存在2名及以上敌人时
  // 攻击速度+12" (talent-0 part cnt / attack_speed)
  const firstBind = num(t1.duration_advanced), hitOnce = new WeakSet();
  const crowdCnt = num(t0.cnt), crowdAs = num(t0.attack_speed);
  const skillGridQ = skillGridOf(def);
  const groundIn = (battle, unit) => enemiesIn(battle, unit).filter((e) => !e.isFlying);
  const skills = {
    // S1 留羽 (attack SP): the next attack binds its target `duration` s; when that bind ends the target and the enemies
    // near it take aoe_scale × ATK arts
    skchr_qiubai_1: {
      kind: 'instant',
      attack: {
        onHit({ battle, unit, target }) {
          if (!target || !target.alive) return;
          const dur = num(bb.duration, 2);
          battle.applyStatus(target, 'bind', { duration: dur, source: unit });
          const seq = unit.deploySeq;
          battle.after(dur, () => {
            if (!unit.alive || unit.deploySeq !== seq) return;
            const x = target.x, y = target.y; // (a fallen target keeps its last position)
            battle.fx('aoe', { x, y, id: unit.id });
            for (const e of battle.foesInRadius(x, y, 1.2, true)) { // splash around the target: 中点判定
              if (e.alive && !e.s.flags.untargetable) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.aoe_scale, 1), type: 'arts', isSkill: true, isSplash: e !== target, tags: ['skill'] });
            }
          }, { owner: unit });
        },
      },
    },
    // S2 承影 (attack SP, 5 s): sword_begin_atk_scale × ATK arts on the ground enemies of the front range at the start,
    // skill range + ATK +atk, ground enemies in range 停顿, sword_end_atk_scale × ATK physical on them at the end
    skchr_qiubai_2: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      ...(skillGridQ ? { targeting: { rangeGrid: skillGridQ } } : {}),
      onStart({ battle, unit }) {
        battle.fx('sword', { x: unit.x, y: unit.y, id: unit.id });
        for (const e of groundIn(battle, unit)) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.sword_begin_atk_scale, 1), type: 'arts', isSkill: true, tags: ['skill'] });
      },
      onTick({ battle, unit }) { for (const e of groundIn(battle, unit)) battle.applyStatus(e, 'sluggish', { duration: 0.25, source: unit }); },
      onEnd({ battle, unit, reason }) {
        if (reason === 'death' || !unit.alive) return;
        for (const e of groundIn(battle, unit)) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.sword_end_atk_scale, 1), type: 'phys', isSkill: true, tags: ['skill'] });
      },
    },
  };
  return {
    skills,
    talents: crowdCnt > 0 && crowdAs ? [{ install(battle, unit) {
      aura(battle, unit, 0.25, () => {
        if (enemiesIn(battle, unit).length >= crowdCnt) battle.addBuff(unit, { key: 'qiubai:crowd', mods: { aspd: crowdAs }, duration: 0.4, refresh: 'replace' });
      });
    } }] : [],
    trait: {
      afterHit(battle, unit, target) {
        if (!target || !target.alive) return;
        if (modArts > 0) battle.dealDamage(unit, target, { amount: unit.s.atk * modArts, type: 'arts', tags: ['module'] });
        const slug = !!target.findBuff('sluggish'), bind = !!(target.findBuff('bind') || target.s.flags.bind);
        if ((slug || bind) && gapScale > 0 && target.alive) { // 入隙
          battle.dealDamage(unit, target, { amount: unit.s.atk * gapScale * (slug && bind ? bothMul : 1), type: 'arts', tags: ['talent'] });
        }
        if (!target.alive) return;
        if (firstBind > 0 && !hitOnce.has(target)) { // 落英 (module): first hit on an enemy
          hitOnce.add(target);
          battle.applyStatus(target, 'bind', { duration: firstBind, source: unit });
          return;
        }
        if (num(t1.prob) > 0 && battle.rng() < num(t1.prob)) battle.applyStatus(target, 'bind', { duration: num(t1.duration), source: unit }); // 落英
      },
    },
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      targeting: { maxTargets: 1 + extraTargets, ...(skillGrid ? { rangeGrid: skillGrid } : {}) },
      attack: { dmgType: 'arts', dmgMul: () => 1 },
      onStart({ unit }) { unit.mem.qbStack = 0; },
      onAttack({ battle, unit }) {
        const max = Math.floor(num(bb.max_stack_cnt));
        if (unit.mem.qbStack >= max) return;
        unit.mem.qbStack++;
        battle.addBuff(unit, { key: 'qiubai:snow', mods: { aspd: num(bb.attack_speed) * unit.mem.qbStack } });
      },
      onEnd({ battle, unit }) { battle.removeBuff(unit, 'qiubai:snow'); unit.mem.qbStack = 0; },
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 溯光星源 chess_char_6_16 (凝滞师) — S3 并流连锁; 数据建模; 能源解析

function halo2(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), mod = moduleBb(chess);
  const isDef = onDefaultSkill(chess), sid = selectedSkill(chess, def);
  const skillGrid = def?.skill?.rangeGrid?.length ? def.skill.rangeGrid : null;
  const n = Math.max(1, Math.floor(num(bb['attack@max_target'], 1))), share = num(bb['attack@atk_share']);
  const slug = (unit) => unit.profile?.onHitStatus?.key === 'sluggish' ? num(unit.profile.onHitStatus.duration) : 0;
  const skills = {
    // S1 星图闪烁: ATK +atk; every attack then bounces attack@chain.max_target times between enemies (back and forth
    // allowed, never twice in a row on one; attack@projectile_range tiles), each bounce a full hit with her 停顿
    skchr_halo2_1: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      attack: {
        onHit({ battle, unit, target }) {
          if (!target) return;
          const jumps = Math.max(0, Math.floor(num(bb['attack@chain.max_target'], 3))), R = num(bb['attack@projectile_range'], 1.7);
          let prev = target, px = target.x, py = target.y;
          for (let i = 0; i < jumps; i++) {
            let best = null, bd = Infinity;
            for (const e of battle.foesInRadius(px, py, R)) {
              if (e === prev || !canTargetEnemy(unit, e, ANY)) continue;
              const d = bodyDist(e, px, py);
              if (d < bd - 1e-9) { bd = d; best = e; }
            }
            if (!best) break;
            battle.dealDamage(unit, best, { amount: unit.s.atk, type: 'arts', isAttack: true, isSkill: true, tags: ['chain'] });
            const sd = slug(unit);
            if (sd > 0 && best.alive) battle.applyStatus(best, 'sluggish', { duration: sd, source: unit });
            prev = best; px = best.x; py = best.y;
          }
        },
      },
    },
    // S2 星束引力 (attack SP): the next attack targets the enemy of her range farthest from its goal (install), atk_scale
    // × ATK arts with a `sluggish` s 停顿, and links up to max_target enemies within ability_range_radius of it: pulled
    // toward it (force) and hit by atk_scale_link × ATK arts
    skchr_halo2_2: {
      kind: 'instant',
      attack: {
        atkScale: num(bb.atk_scale, 1),
        onHitStatus: { key: 'sluggish', duration: num(bb.sluggish, 3) },
        onHit({ battle, unit, target }) {
          if (!target) return;
          const R = num(bb.ability_range_radius, 2), k = Math.max(0, Math.floor(num(bb.max_target, 2)));
          const near = battle.foesInRadius(target.x, target.y, R).filter((e) => e !== target && canTargetEnemy(unit, e, ANY))
            .sort((a, b) => bodyDist(a, target.x, target.y) - bodyDist(b, target.x, target.y) || a.spawnSeq - b.spawnSeq)
            .slice(0, k);
          for (const e of near) {
            battle.fx('link', { x: e.x, y: e.y, id: unit.id, ids: [target.id, e.id] });
            pullToward(battle, { x: target.x, y: target.y }, e, num(bb.force), 0.3);
            if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale_link, num(bb.atk_scale, 1)), type: 'arts', isSkill: true, tags: ['skill', 'link'] });
          }
        },
      },
    },
  };
  return {
    skills,
    install(battle, unit) {
      if (sid !== 'skchr_halo2_2') return;
      battle.on('beforeAttack', (ctx) => { // "选择攻击范围内距离目标点最远的1个敌人为目标"
        if (ctx.attacker !== unit || !unit.skill?.active || !unit.skill.pending) return;
        const c = battle.enemiesInKeys(unit.rangeKeys, unit, ctx.profile);
        if (!c.length) return;
        let best = c[0];
        for (const e of c) if (battle.remainingDistance(e) > battle.remainingDistance(best) + 1e-9) best = e;
        ctx.targets = [best];
      }, { owner: unit });
    },
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), batPct: batOf(bb.base_attack_time, def) },
      targeting: { maxTargets: n, ...(skillGrid ? { rangeGrid: skillGrid } : {}) },
      onStart({ unit }) { unit.mem.haloLocks = []; },
      onEnd({ unit }) { unit.mem.haloLocks = []; },
    },
    talents: [
      { install(battle, unit) { // S3: persistent locks + damage transfer between linked targets
        if (!isDef) return;
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !unit.skill?.active) return;
          const valid = (e) => e && e.alive && canTargetEnemy(unit, e, ANY) && bodyInKeys(e, unit.rangeKeySet);
          const keep = (unit.mem.haloLocks || []).filter(valid);
          for (const e of ctx.targets) if (keep.length < n && !keep.includes(e)) keep.push(e);
          ctx.targets = keep.slice(0, n);
          const fresh = ctx.targets.some((e) => !(unit.mem.haloLocks || []).includes(e));
          unit.mem.haloLocks = ctx.targets.slice();
          if (fresh && ctx.targets.length > 1) battle.fx('link', { x: ctx.targets[0].x, y: ctx.targets[0].y, id: unit.id, ids: ctx.targets.map((e) => e.id) });
        }, { owner: unit });
        battle.on('hit', (ctx) => {
          const locks = unit.mem.haloLocks;
          if (!(share > 0) || !unit.skill?.active || !locks || locks.length < 2 || ctx.dmg.type !== 'arts' || ctx.dmg.tags.includes('link')) return;
          if (!locks.includes(ctx.target) || unit.mem.haloLinking) return;
          // re-entrancy guard: a transferred hit (or anything it causes, e.g. enemy damage sharing) never re-links
          unit.mem.haloLinking = true;
          try {
            for (const o of locks) if (o !== ctx.target && o.alive) {
              battle.dealDamage(ctx.source ?? unit, o, { amount: ctx.dmg.amount * share, type: 'arts', canDodge: false, isSkill: true, tags: ['skill', 'link'] });
            }
          } finally { unit.mem.haloLinking = false; }
        }, { owner: unit });
      } },
      { install(battle, unit) { // 数据建模 (+ module ATK at max stacks)
        const as = num(t0.attack_speed), max = Math.max(1, Math.floor(num(t0.max_stack_cnt, 18))), fullAtk = num(mod.atk);
        battle.on('deploy', ({ unit: u }) => { if (u === unit) unit.mem.haloStack = 0; }, { owner: unit });
        battle.on('statusApplied', (ctx) => {
          if (ctx.source !== unit || ctx.status !== 'sluggish' || !live(unit) || (unit.mem.haloStack || 0) >= max) return;
          unit.mem.haloStack = (unit.mem.haloStack || 0) + 1;
          const k = unit.mem.haloStack;
          battle.addBuff(unit, { key: 'halo2:model', mods: { aspd: as * k, atkPct: k >= max ? fullAtk : 0 } });
        }, { owner: unit });
      } },
      { install(battle, unit) { // 能源解析
        const base = bv(t1, 'damage_scale', 1), maxS = bv(t1, 'damage_scale_max', base), iv = bv(t1, 'interval', 7);
        const stay = new WeakMap();
        aura(battle, unit, 0.25, () => {
          const inR = enemiesIn(battle, unit);
          for (const e of battle.enemies) if (!inR.includes(e)) stay.delete(e);
          for (const e of inR) {
            const t = (stay.get(e) ?? 0) + 0.25;
            stay.set(e, t);
            const v = t > iv ? maxS : base;
            // 脆弱 (ba.fragile, 同名效果取最高): the catalogue status, refreshed while the enemy stays in range
            if (v > 1) battle.applyStatus(e, 'fragile', { duration: 0.4, value: v - 1, source: unit });
          }
        });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 耀骑士临光 chess_char_6_17 (无畏者) — S3 耀阳颔首; 不畏苦暗; 破晓; module 耀阳锋刃

function nearl2(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const t0Grid = def?.talents?.[0]?.rangeGrid?.length ? def.talents[0].rangeGrid : N4;
  const skillGrid = def?.skill?.rangeGrid?.length ? def.skill.rangeGrid : null;
  const tokId = (chess?.tokens || []).find((t) => /nearl2_sword/.test(String(t))) || 'token_10019_nearl2_sword';
  const sunBurst = (battle, unit, r, c, scale, stun) => {
    const keys = new Set(absoluteRangeKeys(N4, r, c, 1, 0));
    battle.fx('sunBurst', { x: c, y: r, id: unit.id });
    for (const e of battle.enemies) {
      if (!e.alive || e.hidden || !bodyInKeys(e, keys)) continue;
      battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'true', isSkill: true, tags: ['skill'] });
      if (stun > 0 && e.alive) battle.applyStatus(e, 'stun', { duration: stun, source: unit });
    }
  };
  const isDef = onDefaultSkill(chess), sid = selectedSkill(chess, def);
  const lastOps = { map: null };
  const skills = {
    // S1 灿焰长刃 (toggle, 持续时间无限): skill range, ATK / ASPD +
    skchr_nearl2_1: {
      kind: 'toggle',
      mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) },
      ...(skillGrid ? { targeting: { rangeGrid: skillGrid } } : {}),
    },
    // S2 逐夜烁光 (passive, ON_DEPLOY): for the skill duration after each deployment ATK +atk and `times` 护盾 layers
    // (whole hits negated); then she withdraws and this redeploy time is ×respawn_time (×1 when the operator deployed
    // right before her is 【卡西米尔】)
    skchr_nearl2_2: {
      kind: 'duration', activateOnDeploy: true, duration: num(def?.skill?.duration, 22), spCost: 0, spType: 'none', trigger: 'NEVER',
      mods: { atkPct: num(bb.atk) },
      onStart({ battle, unit, skill }) {
        const dur = num(skill.duration, num(def?.skill?.duration, 22));
        if (!(dur > 0)) return;
        const prev = lastOps.map?.get(unit.ownerId);
        unit.mem.nearl2Combo = !!prev && prev !== unit && hasBond(prev, 'kazimierzShip');
        const hits = Math.floor(num(bb.times));
        if (hits > 0) battle.addBuff(unit, { key: 'nearl2:shield', shieldHits: hits, duration: dur, visible: true });
      },
      onEnd({ battle, unit, reason }) {
        battle.removeBuff(unit, 'nearl2:shield');
        if (reason !== 'duration' || !live(unit)) return;
        const combo = unit.mem.nearl2Combo;
        battle.retreat(unit, { reason: 'retreat' });
        const mul = combo ? num(bb['nearl2_s_2[withdraw][combo].respawn_time'], 1) : num(bb.respawn_time, 1);
        if (Number.isFinite(unit.respawnAt) && mul !== 1) unit.respawnAt = battle.time + (unit.respawnAt - battle.time) * mul;
        battle.fx('disappear', { x: unit.x, y: unit.y, id: unit.id, combo });
      },
    },
  };
  // module “骑士家族”: "被击倒时不撤退且回复所有生命但生命上限-60%，攻击速度+30（单次部署只触发1次）" and 不畏苦暗
  // "部署时及首次被击倒时…" (the burst again)
  const standVal = num(tb.value), standAs = num(tb.attack_speed), standHp = num(tb.hp_ratio, 1);
  return {
    skills,
    install(battle, unit) {
      if (sid === 'skchr_nearl2_2') lastOps.map = ensureDeployTracker(battle);
      if (standVal > 0) {
        battle.on('deploy', ({ unit: u }) => { if (u === unit) unit.mem.nearlStood = false; }, { owner: unit });
        battle.on('fatal', (ctx) => {
          if (ctx.unit !== unit || ctx.prevented || unit.mem.nearlStood) return;
          ctx.prevented = true;
          unit.mem.nearlStood = true;
          battle.addBuff(unit, { key: 'nearl2:stand', mods: { hpMul: Math.max(0.05, 1 - standVal), aspd: standAs }, visible: true });
          unit.hp = Math.max(1, unit.s.maxHp * standHp);
          battle.fx('undying', { x: unit.x, y: unit.y, id: unit.id });
          battle.emit('nearl2:knockdown', { unit });
        }, { owner: unit, priority: -60 });
      }
    },
    trait: num(tb.atk_scale, 1) > 1 ? { dmgMul: (b, u, t) => (t.blockedBy ? num(tb.atk_scale, 1) : 1) } : null,
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), defPct: num(bb.def) },
      ...(skillGrid ? { targeting: { rangeGrid: skillGrid } } : {}),
      onStart({ battle, unit, skill }) {
        const tile = bestTile(battle, freeTiles(battle, unit, N4));
        const sword = tile ? battle.spawnToken(unit, tokId, tile[0], tile[1], { duration: skill.timeLeft }) : null;
        unit.mem.sun = sword;
        if (sword) battle.fx('summon', { x: sword.x, y: sword.y, id: sword.id, src: unit.id });
        // the token kit (content/tokens.js) performs the appear burst; without it (or without a free tile) do it here
        if (!sword || !sword.kit?.fromTokens) {
          sunBurst(battle, unit, sword ? sword.tileR : unit.tileR, sword ? sword.tileC : unit.tileC, num(bb.value), num(bb.value2));
        }
      },
      onEnd({ battle, unit }) {
        const s = unit.mem.sun;
        unit.mem.sun = null;
        if (s && s.alive) battle.retreat(s, { reason: 'expired', permanent: true });
      },
    },
    talents: [
      { install(battle, unit) { // S3: attacks on units blocked by her or 耀阳 deal true damage
        if (!isDef) return;
        battle.on('hit', (ctx) => {
          if (ctx.source !== unit || !unit.skill?.active || !ctx.dmg.isAttack) return;
          const b = ctx.target.blockedBy;
          if (b && (b === unit || b === unit.mem.sun)) ctx.dmg.type = 'true';
        }, { owner: unit });
      } },
      { install(battle, unit) { // 不畏苦暗 — the 4 tiles around her, air units too [ASSUMED: no 对空 note on PRTS, like “耀阳”]
        const last = ensureDeployTracker(battle);
        const sc = num(t0.atk_scale), stun = num(t0.stun);
        const dawn = (times) => {
          const foes = battle.unitsInGrid(unit, t0Grid, { side: 'enemy' });
          if (foes.length) battle.fx('sunBurst', { x: unit.x, y: unit.y, id: unit.id });
          for (const e of foes) {
            for (let i = 0; i < times && e.alive; i++) battle.dealDamage(unit, e, { amount: unit.s.atk * sc, type: 'true', tags: ['talent'] });
            if (stun > 0 && e.alive) battle.applyStatus(e, 'stun', { duration: stun, source: unit });
          }
        };
        const kazTimes = () => { const prev = last.get(unit.ownerId); return prev && prev !== unit && hasBond(prev, 'kazimierzShip') ? 2 : 1; };
        battle.on('deploy', ({ unit: u }) => {
          if (u !== unit || !(sc > 0)) return;
          unit.mem.nearlDawnTimes = kazTimes();
          dawn(unit.mem.nearlDawnTimes);
        }, { owner: unit });
        // module “骑士家族”: "…及首次被击倒时" — the burst again when the trait keeps her standing
        battle.on('nearl2:knockdown', ({ unit: u }) => { if (u === unit && sc > 0) dawn(unit.mem.nearlDawnTimes ?? 1); }, { owner: unit });
      } },
      { install(battle, unit) { // 破晓
        const p = num(t1.def_penetrate);
        if (p) battle.addBuff(unit, { key: 'nearl2:dawn', mods: { defIgnorePct: p }, persist: true, allowDead: true });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 荒芜拉普兰德 chess_char_6_18 (驭械术师) — S3 终幕·浩劫; 头狼; 叙拉古的荣幸

/**
 * S3 终幕·浩劫's drone flight — PRTS 荒芜拉普兰德 S3 备注 "技能流程": ① for `attack@times` (1.3) s after the cast, or after
 * a drone is added ("补充浮游单元"), the drones spread evenly outward from her, one along her facing ("散开的方向始终包括
 * 自身的朝向"): 初速度 0.1, 加速度 1.9, 最大速度 2.0 — [ASSUMED] after an addition (头狼 stage 3 mid-skill) only the added
 * drone spreads, along her facing, while the others carry on; ② then each picks the target nearest to itself, ties
 * nearest to her ("距离自身最近>距离本体最近"), anywhere on the field, and flies at it: 初速度 2.0, 加速度 1.0, 最大速度
 * 4.0, restarting at 2.0 whenever its target leaves or turns unselectable on the way; ③ once there it stays on the target
 * and attacks it like a normal drone ("此状态下的攻击行为同正常浮游单元"); when that target leaves / turns unselectable it
 * reappears at a random point of the 1.5-side square around it and picks again (②). With no selectable target it circles
 * (radius 0.9, 1.0 tiles/s, counter-clockwise) with its heading as the tangent, the circle on its left. Speeds in tiles/s.
 */
const WHITW2_SPREAD = Object.freeze({ v0: 0.1, acc: 1.9, max: 2 });
const WHITW2_CHASE = Object.freeze({ v0: 2, acc: 1, max: 4 });
const WHITW2_REAPPEAR_SIDE = 1.5;
const WHITW2_ORBIT = Object.freeze({ r: 0.9, v: 1 });

function whitw2(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1);
  const sid = selectedSkill(chess, def);
  const spreadTime = Math.max(0, num(bb['attack@times'], 1.3)), R = num(bb['attack@range_radius'], 0.9);
  const dmgScale = num(bb['attack@magic_atk_scale'], 1), fear = num(bb['attack@fear']), slow = num(bb['attack@move_speed']);
  // "非移动敌人": blocked, or not walking (stunned, bound, asleep, waiting, speed 0 …)
  const still = (e) => !!e.blockedBy || e.moving === false || !(e.s.moveSpeed > 0) || !!(e.s.flags.stun || e.s.flags.freeze || e.s.flags.bind || e.s.flags.sleep || e.s.flags.noMove);
  const skillGridW = skillGridOf(def);

  // ---- S3 drones (virtual: positions in unit.mem.drones, fx events for the client) --------------------------------
  const droneCount = (unit) => 1 + Math.floor(num(bb['attack@cnt'])) + ((unit.mem.wolfStage || 0) >= 3 ? 1 : 0);
  // ① `k` drones leave her evenly spread, the first along her facing (row 0 is the bottom row: angles in the (col, row)
  // plane, counter-clockwise)
  const releaseDrones = (unit, k) => {
    const a0 = Math.atan2(unit.fwd[0], unit.fwd[1]);
    for (let i = 0; i < k; i++) {
      const a = a0 + (2 * Math.PI * i) / k;
      unit.mem.drones.push({ x: unit.x, y: unit.y, hx: Math.cos(a), hy: Math.sin(a), v: WHITW2_SPREAD.v0, age: 0, phase: 'spread', t: null, cd: 0, rampId: null, ramp: 0, orbit: null });
    }
  };
  // speed v → v + acc·dt (capped); the distance covered at the mean of the two (exact under constant acceleration)
  const accelerate = (d, lim, dt) => { const v1 = Math.min(lim.max, d.v + lim.acc * dt), s = ((d.v + v1) / 2) * dt; d.v = v1; return s; };
  // ② the selectable enemy nearest to the drone, ties broken by the one nearest to her. [ASSUMED] distances are measured
  // to every enemy's position (a huge enemy's centre, its 判定中心) — the owner's decision of 2026-10-04: the centre, so
  // leader rounds stay close to 0.1.1; the sim's general convention for operator-side distance picks, the hit rectangle
  // (body.js bodyDist: targeting.js sortEnemyTargets 'nearest', tier3 enemiesAround, 异客 / 溯光星源's chains), was
  // considered — it made a huge leader (胄, 管) the nearest enemy of every drone around it (DESIGN §22.9)
  const pickTarget = (battle, unit, d, ok) => {
    let best = null, bd = Infinity, bh = Infinity;
    for (const e of battle.enemies) {
      if (!ok(e)) continue;
      const de = Math.hypot(e.x - d.x, e.y - d.y), dh = Math.hypot(e.x - unit.x, e.y - unit.y);
      if (de < bd - 1e-9 || (de <= bd + 1e-9 && dh < bh - 1e-9)) { best = e; bd = de; bh = dh; }
    }
    return best;
  };
  // nothing selectable: circle counter-clockwise on its left, its heading the tangent
  const circle = (d, dt) => {
    const { r, v } = WHITW2_ORBIT;
    if (!d.orbit) d.orbit = { cx: d.x - d.hy * r, cy: d.y + d.hx * r };
    const a = Math.atan2(d.y - d.orbit.cy, d.x - d.orbit.cx) + (v / r) * dt;
    d.x = d.orbit.cx + r * Math.cos(a); d.y = d.orbit.cy + r * Math.sin(a);
    d.hx = -Math.sin(a); d.hy = Math.cos(a);
  };
  // one tick of one drone: spread → (pick) → chase → on the target, attacking like a normal drone. [ASSUMED] its attack
  // clock runs all the time (one attack per interval of hers at most, whatever it chased in between) and its first hit
  // lands as it arrives when the clock is ready; [ASSUMED] a drone on a target sits at its position (a huge enemy's
  // centre, its 判定中心), and it reaches a huge enemy when it touches the hit rectangle. [ASSUMED] the turn rate (PRTS
  // 转向速度 1/6 per frame = attack@projectile_turn_speed × 1/30 s) is not modelled: a chasing drone heads straight at
  // its target. [ASSUMED] the fear's source is her (the enemy flees from her, not from the drone).
  const flyDrone = (battle, unit, d, dt, ok) => {
    d.cd = Math.max(0, d.cd - dt);
    if (d.phase === 'spread') {
      const s = accelerate(d, WHITW2_SPREAD, dt);
      d.x += d.hx * s; d.y += d.hy * s;
      d.age += dt;
      if (d.age + 1e-9 < spreadTime) return;
      d.phase = 'seek';
    }
    if (d.phase === 'lock' && !ok(d.t)) {
      // ③ its target left / is no longer selectable: it reappears at a random point of the square around that spot (the
      // draw taken in her facing-RIGHT frame, so a battle turned with her direction plays the same)
      const h = WHITW2_REAPPEAR_SIDE / 2;
      const [ar, ac] = rotateOffset(battle.rng.range(-h, h), battle.rng.range(-h, h), unit.dir);
      d.x = d.t.x + ac;
      d.y = d.t.y + ar;
      d.t = null; d.phase = 'seek';
    } else if (d.phase === 'chase' && !ok(d.t)) { d.t = null; d.phase = 'seek'; }
    if (d.phase === 'seek') {
      const t = pickTarget(battle, unit, d, ok);
      if (!t) { circle(d, dt); return; }
      d.t = t; d.phase = 'chase'; d.v = WHITW2_CHASE.v0; d.orbit = null;
      battle.fx('droneLock', { x: t.x, y: t.y, id: t.id, src: unit.id }); // PRTS: the red wolf-eye mark over the target
    }
    const t = d.t;
    if (d.phase === 'chase') {
      const s = accelerate(d, WHITW2_CHASE, dt);
      if (bodyDist(t, d.x, d.y) > s + 1e-9) {
        const dx = t.x - d.x, dy = t.y - d.y, L = Math.hypot(dx, dy);
        if (L > 1e-9) { d.hx = dx / L; d.hy = dy / L; }
        d.x += d.hx * s; d.y += d.hy * s;
        return;
      }
      d.phase = 'lock'; // reached: "追上时使目标恐惧…并锁定其攻击"
      if (fear > 0) battle.applyStatus(t, 'fear', { duration: fear, source: unit });
    }
    d.x = t.x; d.y = t.y;
    if (d.cd > 1e-9 || !ok(t) || !unit.alive) return; // (the fear's hooks could have knocked her out)
    d.cd = unit.s.interval;
    const f = unit.profile?.funnel || { init: 0.2, delta: 0.15, max: 1.1 };
    d.ramp = d.rampId === t.id ? Math.min(f.max, d.ramp + f.delta) : f.init;
    d.rampId = t.id;
    battle.fx('drone', { x: d.x, y: d.y, id: unit.id });
    battle.dealDamage(unit, t, { amount: unit.s.atk * unit.s.atkScaleMul * d.ramp, type: 'arts', tags: ['droneAttack'] });
  };

  const skills = {
    // S1 慵怠者悲鸣: passive 浮游单元+1 (trait: one more hit per attack); toggled on: ATK +atk and the drones lock a random
    // non-moving enemy anywhere on the field (re-locking when it moves or falls; install), else her range. The whole-field
    // grid only selects those targets — no rangeId, no 攻击范围 in the text — so the card keeps her 3-1 (showOwnRange)
    skchr_whitw2_1: {
      kind: 'toggle',
      mods: { atkPct: num(bb.atk) },
      targeting: { rangeGrid: WHOLE_FIELD, showOwnRange: true },
      onStart({ unit }) { unit.mem.lazyLock = null; },
    },
    // S2 逐猎狂飙: 浮游单元+attack@cnt, skill range, ATK +atk: every drone locks a random enemy of the range until it falls
    // (install); each drone hit ramps on its own target (trait init → max) and fears it attack@fear s with attack@prob
    skchr_whitw2_2: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      ...(skillGridW ? { targeting: { rangeGrid: skillGridW } } : {}),
      attack: {
        hits: 1,
        dmgMul(battle, unit, target) {
          const f = unit.profile?.funnel || { init: 0.2, delta: 0.15, max: 1.1 };
          const m = unit.mem.hunt;
          if (!m) return f.init;
          const v = m.ramp.has(target.id) ? Math.min(f.max, m.ramp.get(target.id) + f.delta) : f.init;
          m.ramp.set(target.id, v);
          return v;
        },
        onEachHit({ battle, unit, target, kind }) {
          if (kind !== 'main' || !target || !target.alive || !(num(bb['attack@fear']) > 0)) return;
          if (battle.rng() < num(bb['attack@prob'])) battle.applyStatus(target, 'fear', { duration: num(bb['attack@fear']), source: unit });
        },
      },
      onStart({ unit }) { unit.mem.hunt = { locks: [], ramp: new Map() }; },
      onEnd({ unit }) { unit.mem.hunt = null; },
    },
  };
  return {
    skills,
    // S1 "被动效果：浮游单元+1": one more drone hit with every normal attack
    trait: sid === 'skchr_whitw2_1' ? { hits: 2 } : null,
    install(battle, unit) {
      if (sid === 'skchr_whitw2_1') {
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !unit.skill?.active) return;
          const ok = (e) => e && e.alive && !e.hidden && canTargetEnemy(unit, e, ANY);
          let L = unit.mem.lazyLock;
          if (!ok(L) || !still(L)) {
            const c = battle.enemies.filter((e) => ok(e) && still(e));
            L = unit.mem.lazyLock = c.length ? battle.rng.pick(c) : null;
          }
          if (L) { ctx.targets = [L]; return; }
          // nothing stands still: her own (initial) range
          const own = battle.enemiesInKeys(unit.baseRangeKeys || [], unit, ctx.profile);
          sortEnemyTargets(battle, unit, own, ctx.profile?.priority ?? null);
          ctx.targets = own.slice(0, 1);
        }, { owner: unit });
      }
      if (sid === 'skchr_whitw2_2') {
        battle.on('beforeAttack', (ctx) => {
          const m = unit.mem.hunt;
          if (ctx.attacker !== unit || !unit.skill?.active || !m) return;
          // the skill range, plus the enemies she blocks (always her targets, Battle.blockedTargets — DESIGN §20.3)
          const c = battle.enemiesInKeys(unit.rangeKeys, unit, ctx.profile);
          for (const e of battle.blockedTargets(unit, ctx.profile)) if (!c.includes(e)) c.push(e);
          if (!c.length) { ctx.targets = []; return; }
          const n = 1 + Math.floor(num(bb['attack@cnt'])) + ((unit.mem.wolfStage || 0) >= 3 ? 1 : 0);
          m.locks = m.locks.filter((e) => e.alive && c.includes(e)).slice(0, n);
          while (m.locks.length < n) {
            const free = c.filter((e) => !m.locks.includes(e));
            m.locks.push(battle.rng.pick(free.length ? free : c));
          }
          ctx.targets = m.locks.slice();
        }, { owner: unit });
      }
    },
    // S3 终幕·浩劫: ATK +atk; 1 + attack@cnt drones (+1 from 头狼 stage 3) fly the PRTS 技能流程 (WHITW2_* above). Every
    // drone is out, so she makes no normal attack of her own (`noAttack`); a drone on its target attacks it every attack
    // interval of hers (her live ASPD; [ASSUMED] the first hit as it arrives) for ATK × its OWN funnel ramp — the trait's
    // init, +delta per hit on the same target, the cap (头狼 stage 1 raises it), back to init on a new target (PRTS 分支特性
    // 信息 驭械术师 "浮游单元攻击不同目标…时，上述的伤害立刻恢复至初始值"). That damage is arts and neither a normal attack
    // nor skill damage (PRTS S3 备注 "该技能释放的浮游单元造成的伤害不属于普通攻击/技能直接伤害", which for this skill
    // overrides the branch note "通过技能释放的浮游单元造成技能直接伤害": no 'attack' hook, isAttack / isSkill false — the
    // on-attack items skip it; it is still 普通伤害, so the 叙拉古 6 proc rolls on it, bonds/core.js siracusaRolls), and
    // 缴械 does not stop it (PRTS 驭械术师 "…不受缴械类效果
    // 制约"); [ASSUMED] nor do her stun, freeze or silence (PRTS names only 缴械) — the skill ticks on and so do the drones.
    // Around every drone (attack@range_radius): move speed attack@move_speed and, once per second, attack@magic_atk_scale
    // × ATK arts (不叠加: one hit per enemy whatever the number of drones); [ASSUMED] that area hit keeps `isSkill` (a skill
    // DoT — the 备注 speaks of 直接伤害) and is 持续伤害 (tag dot: PRTS 备注 "持续法术伤害" — no 叙拉古 6 roll, 锡人's
    // 凋敝魂灵 raises it). A knocked-out / withdrawn wolf (onEnd cleared the drones mid-tick, e.g. from a
    // kill hook) deals nothing more in that tick.
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      attack: { noAttack: true },
      onStart({ battle, unit }) {
        unit.mem.drones = [];
        unit.mem.droneAcc = 0;
        releaseDrones(unit, droneCount(unit));
        battle.fx('drones', { x: unit.x, y: unit.y, id: unit.id, n: unit.mem.drones.length });
      },
      onTick({ battle, unit, dt }) {
        const D = unit.mem.drones;
        if (!D) return;
        const gone = () => !unit.alive || unit.mem.drones !== D;
        // 头狼 stage 3 reached while the skill runs: the extra drone is released (PRTS ① "补充浮游单元"; [ASSUMED] only it spreads)
        const add = droneCount(unit) - D.length;
        if (add > 0) { releaseDrones(unit, add); battle.fx('drones', { x: unit.x, y: unit.y, id: unit.id, n: add }); }
        const ok = (e) => e && e.alive && !e.hidden && canTargetEnemy(unit, e, ANY);
        for (const d of D) {
          if (gone()) return;
          flyDrone(battle, unit, d, dt, ok);
        }
        if (gone()) return;
        const near = new Set();
        for (const d of D) for (const e of battle.foesInRadius(d.x, d.y, R)) if (ok(e)) near.add(e);
        if (slow) for (const e of near) battle.addBuff(e, { key: 'whitw2:slow', duration: 0.2, refresh: 'replace', mods: { moveMul: Math.max(0, 1 + slow) }, source: unit });
        unit.mem.droneAcc += dt;
        if (unit.mem.droneAcc + 1e-9 >= 1) {
          unit.mem.droneAcc -= 1;
          for (const e of near) {
            if (gone()) return;
            if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * dmgScale, type: 'arts', isSkill: true, tags: ['skill', 'drone', 'dot'] });
          }
          // (a drone on its target already pulses with each of its attacks)
          for (const d of D) if (d.phase !== 'lock') battle.fx('drone', { x: d.x, y: d.y, id: unit.id });
        }
      },
      onEnd({ unit }) { unit.mem.drones = null; },
    },
    talents: [
      { install(battle, unit) { // 头狼
        const iv = Math.max(1, num(t0.interval, 20)), cap = num(t0.scale, 1), sil = num(t0['attack@silence_duration']);
        const baseFunnel = unit.profile?.funnel ? { ...unit.profile.funnel } : null;
        const baseHits = Math.max(1, Math.floor(num(unit.profile?.hits, 1)));
        battle.on('deploy', ({ unit: u }) => {
          if (u !== unit) return;
          unit.mem.wolfStage = 0;
          if (unit.profile) { unit.profile.hits = baseHits; if (baseFunnel) unit.profile.funnel = { ...baseFunnel }; }
        }, { owner: unit });
        aura(battle, unit, 1, () => {
          const st = Math.min(3, Math.floor((battle.time - unit.deployedAt + 1e-6) / iv));
          if (st <= (unit.mem.wolfStage || 0)) return;
          unit.mem.wolfStage = st;
          // stage 1: 伤害上限提高10% (funnel cap × scale)
          if (st >= 1 && baseFunnel && unit.profile) unit.profile.funnel = { ...baseFunnel, max: baseFunnel.max * cap };
          // stage 3: 数量+1 — one more drone hits her target with every normal attack (and S3 releases one more)
          if (st >= 3 && unit.profile) unit.profile.hits = baseHits + 1;
          battle.fx('talent', { x: unit.x, y: unit.y, id: unit.id, name: 'alpha', stage: st });
        });
        // stage 2: 造成伤害时使目标特殊能力失效2秒 (= silence)
        if (sil > 0) battle.on('damaged', (ctx) => {
          if (ctx.source !== unit || (unit.mem.wolfStage || 0) < 2 || !ctx.target.alive || ctx.target.side !== 'enemy' || ctx.type === 'element') return;
          battle.applyStatus(ctx.target, 'silence', { duration: sil, source: unit });
        }, { owner: unit });
      } },
      { install(battle, unit) { // 叙拉古的荣幸: one team effect per player, the strongest copy's numbers
        const S = bstate(battle);
        S.siracusa ??= new Map();
        const cur = S.siracusa.get(unit.ownerId);
        const sp = num(t1.sp), as = num(t1.attack_speed);
        if (cur) { cur.sp = Math.max(cur.sp, sp); cur.as = Math.max(cur.as, as); return; }
        const cfg = { sp, as };
        S.siracusa.set(unit.ownerId, cfg);
        const sira = (u) => u && u.kind === 'op' && u.ownerId === unit.ownerId && hasBond(u, 'siracusaShip');
        // 初始技力+5: every (re)deployment starts with +5 SP (not on top of the SP a unite helper carries over)
        battle.on('deploy', ({ unit: u, initial }) => {
          if (!(cfg.sp > 0) || !sira(u) || !u.skill) return;
          if (initial && u.carry && Number.isFinite(u.carry.sp)) return;
          u.skill.gainSp(cfg.sp, 'talent');
        });
        // elite: 首次触发技能后攻击速度+10
        battle.on('skillStart', ({ unit: u }) => {
          if (!cfg.as || !sira(u) || u.mem.siracusaHonor === u.deploySeq) return;
          u.mem.siracusaHonor = u.deploySeq;
          battle.addBuff(u, { key: 'whitw2:honor', mods: { aspd: cfg.as } });
        });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 锏 chess_char_6_19 (剑豪) — S3 归于宁静; “天生的武者”; 活着的传奇; module “过往的注脚”

function blkkgt(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const slashes = Math.max(1, parseN(def?.skill?.description, /总计(\d+)次/, 10));
  const iv = Math.max(0.05, num(bb.d_hit_interval, 0.3)), pullIv = Math.max(0.1, num(bb.p_hit_interval, 1));
  const maxT = Math.max(1, Math.floor(num(bb.max_target, 1)));
  const skillGrid = def?.skill?.rangeGrid?.length ? def.skill.rangeGrid : null;
  // the skill range (x-1): her range while S3 runs — also for the finisher, since onEnd runs before the engine
  // removes the skill's range
  const skillKeys = (unit) => unit.rangeKeys || [];
  // S3 hits and pulls air units too — PRTS 锏 S3 备注 "※可对空。不会拖拽自身中心半径0.6708范围内的敌人" (her attacks and S1 /
  // S2 stay ground-only: "地面敌人"); the air units of the mode are 静态刚体, so the pull leaves them in place (Battle.pull)
  const victims = (battle, unit) => {
    const c = battle.enemiesInKeys(skillKeys(unit), unit, { ...unit.profile, canHitFly: true, groundOnly: false });
    sortEnemyTargets(battle, unit, c, null);
    return c.slice(0, maxT);
  };
  const slash = (battle, unit, scale) => {
    const v = victims(battle, unit);
    if (v.length) battle.fx('slash', { x: unit.x, y: unit.y, id: unit.id, n: v.length });
    for (const e of v) battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, tags: ['skill', 'slash'] });
  };
  // "持续将敌人中等力度地拖拽至自身中心，之后…较大力地拖拽至自身": the official 力度 − 重量 pulls (PRTS 推与拉: the last one
  // aims at her own tile centre, the others at the usual 拉力起点 half a tile ahead; 急停 0.6708 around her)
  const pull = (battle, unit, force, last = false) => {
    for (const e of enemiesIn(battle, unit, skillKeys(unit))) {
      if (last) pullToward(battle, unit, e, force); else battle.pullToFront(e, unit, force);
    }
  };
  const skills = {
    // S1 纯粹的武力 (attack SP): the next attack hits up to max_target ground enemies of the 3×3 around her, each twice
    // (her trait) at atk_scale_s1 × ATK
    skchr_blkkgt_1: {
      kind: 'instant',
      attack: { atkScale: num(bb.atk_scale_s1, 1) },
      targeting: { maxTargets: Math.max(1, Math.floor(num(bb.max_target, 5))), ...(skillGrid ? { rangeGrid: skillGrid } : {}) },
    },
    // S2 无声的嘲笑 (attack SP, 2 charges): up to max_target ground enemies of the front skill range take 2 slashes
    // (3 when blocked) of dot_scale × ATK; the talent procs at 100 % meanwhile (skill active + bb.prob)
    skchr_blkkgt_2: {
      kind: instantKind(def),
      onStart({ battle, unit }) {
        const grid = skillGrid || [[0, 0], [0, 1]];
        const c = battle.unitsInGrid(unit, grid, { side: 'enemy' }).filter((e) => !e.isFlying && canTargetEnemy(unit, e, unit.profile));
        sortEnemyTargets(battle, unit, c, null);
        const v = c.slice(0, Math.max(1, Math.floor(num(bb.max_target, 5))));
        const nFree = Math.floor(num(bb['blkkgt_s_2[not_blocked].trig_cnt'], 2)), nBlocked = Math.floor(num(bb['blkkgt_s_2[blocked].trig_cnt'], 3));
        if (v.length) battle.fx('slash', { x: unit.x, y: unit.y, id: unit.id, n: v.length });
        for (const e of v) {
          const n = e.blockedBy ? nBlocked : nFree;
          for (let i = 0; i < n && e.alive; i++) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.dot_scale, 1), type: 'phys', isSkill: true, tags: ['skill', 'slash'] });
        }
      },
    },
  };
  // module 新合同: trait "攻击时无视敌人70点的防御力"; talent 活着的传奇 "攻击力+8%…地面敌人首次进入自身攻击范围时，使其战栗6秒"
  const penFlat = num(tb.def_penetrate_fixed), legendAtk = num(t1.atk), legendTremble = num(t1.not_combat);
  return {
    skills,
    install(battle, unit) {
      if (penFlat > 0 || legendAtk) battle.addBuff(unit, { key: 'blkkgt:contract', mods: { defIgnoreFlat: penFlat, atkPct: legendAtk }, persist: true, allowDead: true });
      // S3 slashes: 晕眩免疫, 冻结免疫 (PRTS 备注)
      battle.on('beforeStatus', (c) => {
        if (c.target === unit && unit.mem.dgb && (c.status === 'stun' || c.status === 'freeze')) c.cancel = true;
      }, { owner: unit });
      if (legendTremble > 0) {
        const seen = new WeakSet();
        battle.on('tick', () => {
          if (!live(unit)) return;
          for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, ANY)) {
            if (e.isFlying || seen.has(e)) continue;
            seen.add(e);
            battle.applyStatus(e, 'tremble', { duration: legendTremble, source: unit });
          }
        }, { owner: unit });
      }
    },
    skill: {
      kind: 'duration',
      duration: slashes * iv,
      ...(skillGrid ? { targeting: { rangeGrid: skillGrid } } : {}),
      attack: { noAttack: true },
      // PRTS 备注 "※多段斩击期间，自身获得无敌，晕眩免疫，冻结免疫": invulnerable while the slashes run (removed in onEnd,
      // before the finisher); stun / freeze refused by her `beforeStatus` hook (install) while `mem.dgb` is set
      onStart({ battle, unit }) {
        unit.mem.dgb = { n: 1, acc: 0, pacc: 0 };
        battle.addBuff(unit, { key: 'blkkgt:slashes', duration: slashes * iv + 1, flags: { invulnerable: true }, visible: true, source: unit });
        slash(battle, unit, num(bb.d_atk_scale, 1));
      },
      onTick({ battle, unit, dt }) {
        const m = unit.mem.dgb;
        if (!m) return;
        m.acc += dt;
        m.pacc += dt;
        while (m.acc + 1e-9 >= iv && m.n < slashes) { m.acc -= iv; m.n++; slash(battle, unit, num(bb.d_atk_scale, 1)); }
        if (m.pacc + 1e-9 >= pullIv) { m.pacc -= pullIv; pull(battle, unit, num(bb.p_force)); }
      },
      onEnd({ battle, unit, reason }) {
        unit.mem.dgb = null;
        battle.removeBuff(unit, 'blkkgt:slashes');
        if (reason === 'death' || !unit.alive) return;
        battle.fx('finale', { x: unit.x, y: unit.y, id: unit.id });
        unit.mem.dgbFinale = true; // the finisher is part of the skill (talent at 100 %, module +10 %)
        try { slash(battle, unit, num(bb.e_atk_scale_end, 1)); } finally { unit.mem.dgbFinale = false; }
        pull(battle, unit, num(bb.e_force), true);
      },
    },
    talents: [
      { install(battle, unit) { // 活着的传奇 → “天生的武者” → module (skill damage +10 %)
        const prob = num(t0.prob), sc = num(t0.atk_scale, 1), tr = num(t0.not_combat), pen = num(t1.def_penetrate), skillMul = num(tb.damage_scale, 1);
        battle.on('hit', (ctx) => {
          const t = ctx.target, d = ctx.dmg;
          if (ctx.source !== unit || !t || t.side !== 'enemy' || d.type === 'element') return;
          if (pen > 0 && t.findBuff('tremble')) d.defIgnorePct += pen;
          const p = unit.skill?.active || unit.mem.dgbFinale ? num(bb.prob, prob) : prob;
          if (p > 0 && (p >= 1 || battle.rng() < p)) {
            d.amount *= sc;
            if (tr > 0 && t.alive) battle.applyStatus(t, 'tremble', { duration: tr, source: unit });
          }
          if (skillMul > 1 && d.isSkill) d.mul *= skillMul;
        }, { owner: unit });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------
// 纯烬艾雅法拉 chess_char_6_20 (行医) — S3 火山回响; 氤氲; 火山灰疗愈

function agoat2(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const hs = num(bb['attack@heal_scale'], 1);
  const shots = Math.max(1, parseN(def?.skill?.description, /(\d+)连发/, 1));
  const elemLoad = (a) => (a.elem ? a.elem.burn + a.elem.neural + a.elem.necrosis + a.elem.apoptosis + a.elem.erosion : 0);
  const skills = {
    // S1 无声润物 (toggle, heal): ATK +atk, one extra heal target, every ally of her range recovers ep_heal_ratio × ATK
    // 元素损伤 per second
    skchr_agoat2_1: {
      kind: 'toggle',
      heal: true,
      mods: { atkPct: num(bb.atk) },
      targeting: { maxTargets: 2 },
      onStart({ unit }) { unit.mem.agoatAcc = 0; },
      onTick({ battle, unit, dt }) {
        unit.mem.agoatAcc = (unit.mem.agoatAcc || 0) + dt;
        if (unit.mem.agoatAcc + 1e-9 < 1) return;
        unit.mem.agoatAcc -= 1;
        const v = unit.s.atk * bv(bb, 'ep_heal_ratio');
        if (v > 0) for (const a of battle.alliesInGrid(unit)) battle.reduceElement(a, v);
      },
    },
    // S2 云霭荫佑 (heal): one heal (her normal amount + element recovery) on every ally of her range, then a barrier
    // over that range for `duration` s absorbing agoat2_s_2[shield].atk_scale × ATK of 元素损伤 in all (install)
    skchr_agoat2_2: {
      kind: 'instant',
      heal: true,
      onStart({ battle, unit }) {
        const er = num(unit.profile?.heal?.elementHealRatio, num(tb.ep_heal_ratio, 0.5));
        const allies = battle.alliesInGrid(unit);
        for (const a of allies) {
          if (er > 0) battle.reduceElement(a, unit.s.atk * er);
          if (a.hp < a.s.maxHp) battle.heal(unit, a, unit.s.atk, { skillHeal: true });
        }
        const S = bstate(battle);
        S.agoatVeils ??= [];
        S.agoatVeils.push({ keys: new Set(unit.rangeKeys || []), pool: unit.s.atk * bv(bb, 'atk_scale', 5), until: battle.time + num(bb.duration, 12), src: unit });
        battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id, duration: num(bb.duration, 12) });
        if (!S.agoatVeilHook) {
          S.agoatVeilHook = true;
          battle.on('elementHit', (ctx) => { // the barrier absorbs 元素损伤 of the allies inside it
            const t = ctx.target, d = ctx.dmg;
            if (!t || t.side !== 'ally' || !d || d.type !== 'element' || d.cancel) return;
            S.agoatVeils = S.agoatVeils.filter((v) => v.pool > 1e-9 && battle.time < v.until);
            const k = t.tileR * COLS + t.tileC;
            for (const v of S.agoatVeils) {
              if (!v.keys.has(k)) continue;
              const eff = d.amount * d.mul;
              if (!(eff > 0)) return;
              const take = Math.min(v.pool, eff);
              v.pool -= take;
              if (take >= eff - 1e-9) { d.cancel = true; return; }
              d.mul *= (eff - take) / eff;
            }
          }, { priority: -50 });
        }
      },
    },
  };
  return {
    skills,
    install(battle, unit) {
      // module 想要留下的生命: "攻击范围内存在受到元素损伤的友方单位时，攻击速度+8"
      const as = num(tb.attack_speed);
      if (as) aura(battle, unit, 0.25, () => {
        if (battle.alliesInGrid(unit).some((a) => elemLoad(a) > 0)) battle.addBuff(unit, { key: 'agoat2:linger', mods: { aspd: as }, duration: 0.4, refresh: 'replace' });
      });
    },
    skill: {
      kind: 'duration',
      heal: true,
      targeting: { rangeGrid: WHOLE_FIELD, maxTargets: shots },
      attack: { healScale: hs },
      onStart({ skill, unit }) {
        const h = unit.profile?.heal || { mode: 'single' };
        skill.spec.attack.heal = { ...h, elementHealRatio: num(h.elementHealRatio) * hs };
      },
    },
    talents: [
      { install(battle, unit) { // S3: 5 shots, different targets first
        battle.on('beforeAttack', (ctx) => {
          if (ctx.attacker !== unit || !unit.skill?.active || !ctx.targets.length || ctx.targets.length >= shots) return;
          const base = ctx.targets.slice();
          const out = [];
          for (let i = 0; i < shots; i++) out.push(base[i % base.length]);
          ctx.targets = out;
        }, { owner: unit });
      } },
      { install(battle, unit) { // 氤氲
        // "普通治疗使目标每秒额外受到一次治疗量和元素损伤回复量为10%的增益治疗，持续6秒（最多叠加3层）" — PRTS 备注: "本天赋受
        // 特性治疗倍率影响，使用缓存攻击力；叠加时，重置持续时间并更新缓存攻击力": a 10 % heal shaped like her normal one —
        // HP heal_scale × ATK and 元素损伤 recovery heal_scale × the trait's ep_heal_ratio × ATK (0.5 / 0.6: 5 % / 6 %,
        // it used to be the full 10 %) — per stack, with the ATK of the last application; a new stack refreshes them all.
        const sc = num(t0.heal_scale), dur = num(t0.duration, 6), max = Math.max(1, Math.floor(num(t0.max_stack_cnt, 3)));
        if (!(sc > 0)) return;
        const epRatio = () => num(unit.profile?.heal?.elementHealRatio, num(tb.ep_heal_ratio, 0.5));
        battle.on('heal', (ctx) => {
          const t = ctx.target;
          if (ctx.source !== unit || ctx.opts?.hot || ctx.opts?.aura || ctx.opts?.regen || ctx.opts?.skillHeal || !t) return;
          // keyed per 纯烬: two of them (co-op) each keep their own stacks, ATK and heal source
          const b = battle.addBuff(t, {
            key: `agoat2:mist:${unit.id}`, duration: dur, refresh: 'stack', stacks: 1, maxStacks: max, interval: 1, source: unit, data: {},
            onTick: ({ unit: a, buff }) => {
              const amt = num(buff.data.atk, unit.s.atk) * sc * Math.max(1, buff.stacks);
              battle.reduceElement(a, amt * epRatio());
              if (a.hp < a.s.maxHp) battle.heal(unit, a, amt, { hot: true });
            },
          });
          if (b) b.data.atk = unit.s.atk;
        }, { owner: unit });
      } },
      { install(battle, unit) { // 火山灰疗愈 (×talent_scale during S3)
        // "受到的元素损伤降低" is a 元素损伤 multiplier applied on the element hit (PRTS 元素 "…后续可应用元素损伤倍率
        // 提升/降低等效果"), not `elemTakenMul` (元素伤害 / 元素脆弱): the aura buff carries the cut, `elementHit` applies it
        const hp = num(t1.max_hp), er = num(t1.ep_damage_resistance), mulS = num(bb.talent_scale, 1);
        aura(battle, unit, 0.5, () => {
          const f = unit.skill?.active ? mulS : 1;
          for (const a of battle.alliesInGrid(unit)) {
            battle.addBuff(a, { key: 'agoat2:ash', mods: { hpPct: hp * f }, data: { epCut: Math.min(1, er * f) }, source: unit, duration: 0.75, refresh: 'replace' });
          }
        });
        battle.on('elementHit', (ctx) => {
          const d = ctx.dmg, b = ctx.target?.findBuff?.('agoat2:ash');
          if (!b || b.source !== unit || !d || d.type !== 'element') return;
          const cut = num(b.data?.epCut);
          if (cut > 0) d.mul *= Math.max(0, 1 - cut);
        }, { owner: unit, priority: 20 });
      } },
    ],
  };
}

// ------------------------------------------------------------------------------------------------------------------

export default {
  chess_char_1_15_a: pithst,
  chess_char_6_01_a: lemuen,
  chess_char_6_02_a: sbell2,
  chess_char_6_03_a: yu,
  chess_char_6_04_a: skadi2,
  chess_char_6_05_a: pasngr,
  chess_char_6_06_a: pepe,
  chess_char_6_07_a: siege2,
  chess_char_6_08_a: reed2,
  chess_char_6_09_a: cello,
  chess_char_6_10_a: nymph,
  chess_char_6_11_a: mlyss,
  chess_char_6_12_a: rosmon,
  chess_char_6_13_a: angel2,
  chess_char_6_14_a: lumen,
  chess_char_6_15_a: qiubai,
  chess_char_6_16_a: halo2,
  chess_char_6_17_a: nearl2,
  chess_char_6_18_a: whitw2,
  chess_char_6_19_a: blkkgt,
  chess_char_6_20_a: agoat2,
};
