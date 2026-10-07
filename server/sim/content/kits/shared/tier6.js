// server/sim/content/kits/shared/tier6.js — helpers and notes of the hand-authored kits (formerly tier6.js; the kits
// live one per file in ../ops/) for every tier-6 chess (阶 VI, DIY slots excluded) plus the
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
//  6_05 异客     storm zone is PRTS range x-1 (13-cell diamond), centred on the target's containing tile;
//                strikes chain like her trait (4 targets, trait falloff), with a separate bounce radius;
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

import { absoluteRangeKeys } from '../../../targeting.js';
import { COLS, ROWS, PULL_STOP_RADIUS } from '../../../constants.js';
import { hasHp } from '../../../damage.js';

// ------------------------------------------------------------------------------------------------------------------
// helpers

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

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
 * 2.3 s ⇒ 1.8 s, the shared/tier1.js `batMod` convention), a lengthening (v > 0) scales it (迷迭香 S2 +0.5 ⇒ ×1.5, 佩佩 S3 +0.2 ⇒
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

export {
  num, bv, tbb, tdesc, moduleBb, parseN, live, isElite, hasBond, keyOf, opsOf, ANY, enemiesIn, isTok, onDefaultSkill,
  selectedSkill, batOf, instantKind, skillGridOf, ABNORMAL, hasAbnormal, cleanseAbnormal, AROUND8, N4, WHOLE_FIELD,
  bstate, freeTiles, bestTile, onElementHit, elementDmg, pullToward, aura,
};
