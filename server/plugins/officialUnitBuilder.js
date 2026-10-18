// Shared official unit builders for build-data and Forge import. No filesystem, CLI or workshop execution.
// i18n-ignore-file: official text processing and builder diagnostics, never interface strings
import { statusKey } from '../../shared/standIn.js';
import { extendedGrid } from '../../shared/loadoutRecord.js';
import { FULL_RANK } from '../../shared/potential.js';
import { PLACE_ON_RANGED } from '../../shared/highGround.js';

export function createOfficialUnitBuilders(warn = () => {}) {
// ===== text & blackboard helpers ================================================================

/** Replace literal "\n" escape sequences used by skill texts with real newlines. */
function unescapeNewlines(s) { return typeof s === 'string' ? s.replace(/\\n/g, '\n') : s; }

/**
 * Strip official rich-text markup (<@ba.vup>…</>, <$ba.sluggish>…</>, <color=…>) but keep literal
 * trigger labels such as <获得时> / <在场6名…>.
 */
function stripRich(s) {
  if (typeof s !== 'string') return s ?? null;
  return unescapeNewlines(s)
    .replace(/<[@$#][^<>]*>/g, '')
    .replace(/<\/>/g, '')
    .replace(/<\/?color[^<>]*>/gi, '')
    .replace(/<\/?[bi]>/gi, '');
}
/** Raw rich text with newlines normalized (markup kept). */
function richRaw(s) { return typeof s === 'string' ? unescapeNewlines(s) : s ?? null; }

/** Round away float noise; keep integers and huge values untouched. */
function cleanNum(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return v;
  if (Number.isInteger(v) || Math.abs(v) >= 1e6) return v;
  return Math.round(v * 1e6) / 1e6;
}

/**
 * Flatten an official blackboard list [{key,value,valueStr}] into { bb, bbStr }.
 * bb[key] = numeric value; bbStr[key] = valueStr when present. Duplicate keys get a _1, _2… suffix.
 */
function flattenBB(list, ctxLabel = '') {
  const bb = {};
  const bbStr = {};
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e.key !== 'string') continue;
    let k = e.key;
    const taken = (x) => Object.prototype.hasOwnProperty.call(bb, x) || Object.prototype.hasOwnProperty.call(bbStr, x);
    if (taken(k)) {
      let i = 1;
      while (taken(`${e.key}_${i}`)) i++; // loop-cap: at most list.length prior keys
      k = `${e.key}_${i}`;
      if (ctxLabel) warn(`duplicate blackboard key ${e.key} in ${ctxLabel} (stored as ${k})`);
    }
    const num = cleanNum(typeof e.value === 'number' ? e.value : Number(e.value) || 0);
    const hasStr = e.valueStr != null && e.valueStr !== '';
    // A string-valued entry carries a meaningless 0 in "value": keep it only in bbStr.
    if (!hasStr || num !== 0) bb[k] = num;
    if (hasStr) bbStr[k] = String(e.valueStr);
  }
  return { bb, bbStr };
}
/** Format a number like the client's C#-style format strings ('0%', '0.0%', '0', '0.0'). */
function formatValue(v, fmt) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
  if (!fmt) return String(cleanNum(v));
  const pct = fmt.endsWith('%');
  const core = pct ? fmt.slice(0, -1) : fmt;
  const decimals = core.includes('.') ? core.split('.')[1].length : 0;
  const x = pct ? v * 100 : v;
  const rounded = Math.sign(x) * Math.round(Math.abs(x) * 10 ** decimals + 1e-9) / 10 ** decimals;
  return rounded.toFixed(decimals) + (pct ? '%' : '');
}

/**
 * Resolve {key}, {-key}, {key:0%} placeholders against a flattened blackboard (case-insensitive).
 * Unknown keys are kept verbatim and reported.
 */
function resolvePlaceholders(text, bb, bbStr = {}, label = '') {
  if (typeof text !== 'string') return text ?? null;
  const lower = new Map();
  for (const [k, v] of Object.entries(bb || {})) lower.set(k.toLowerCase(), v);
  const lowerStr = new Map();
  for (const [k, v] of Object.entries(bbStr || {})) lowerStr.set(k.toLowerCase(), v);
  return text.replace(/\{(-?)([^{}:]+)(?::([^{}]+))?\}/g, (m, neg, key, fmt) => {
    const k = key.trim().toLowerCase();
    if (lowerStr.has(k) && (!lower.has(k) || !fmt)) return lowerStr.get(k);
    if (lower.has(k)) {
      const v = lower.get(k);
      return formatValue(neg ? -v : v, fmt);
    }
    if (label) warn(`unresolved placeholder ${m} in ${label}`);
    return m;
  });
}

/** Build the {desc, descRaw} pair for an official rich text (placeholders resolved when bb given). */
function textPair(raw, bb, bbStr, label) {
  const resolved = bb ? resolvePlaceholders(richRaw(raw), bb, bbStr, label) : richRaw(raw);
  return { desc: stripRich(resolved), descRaw: resolved };
}

/** Natural sort for ids like chess_char_1_10_a (numbers compared numerically). */
function naturalCmp(a, b) { return String(a).localeCompare(String(b), 'en', { numeric: true }); }

const PHASE_INDEX = { PHASE_0: 0, PHASE_1: 1, PHASE_2: 2 };
const phaseIdx = (p) => (typeof p === 'number' ? p : PHASE_INDEX[p] ?? 0);

/** Does an unlock condition hold for a given phase/level at a potential rank (a candidate's `requiredPotentialRank`)? */
function unlocked(cond, phase, level, potRank = 0, reqPot = 0) {
  if ((reqPot || 0) > potRank) return false;
  if (!cond) return true;
  const p = phaseIdx(cond.phase);
  if (p < phase) return true;
  if (p > phase) return false;
  return (cond.level || 1) <= level;
}
/** Pick the best candidate (the last unlocked one) from an official candidate list, at potential rank `potRank`. */
function bestCandidate(cands, phase, level, potRank = 0) {
  let best = null;
  for (const c of cands || []) if (c && unlocked(c.unlockCondition, phase, level, potRank, c.requiredPotentialRank)) best = c;
  return best;
}

/**
 * Potential (潜能) is a per-player runtime input (0.2.2, the owner's decision of 2026-10-08: 「调配干员里自己设置吧，默认满潜
 * 满加成」; 0.2.1 baked full potential in, DESIGN §26.14). Official: 调度手册 「卫戍协议中干员潜能由自身已持有干员潜能决定」 —
 * the season's chess records (activity_table charChessDataDict `status`: evolvePhase, charLevel, skillLevel, favorPoint 0,
 * equipLevel) carry no potential field; a tournament video shows 刺玫 (chess_char_1_06_a) at ATK 435 and cost 15 (her
 * E1 Lv55 413 / 17 plus 攻击力+22 and two 部署费用-1: an account at full potential). Ranks count like character_table
 * `potentialRanks` (ranks 1–5 = the 潜能 2–6 steps) and a candidate's `requiredPotentialRank`.
 * The builders take the rank from `ctx.potRank`: main() runs the chess / backups / tokens builders once per rank (0–5)
 * and keeps the FULL-potential build (潜能 6 = rank 5, FULL_RANK: the default and what the data's own fields
 * hold) annotated with what every lower rank changes (attachPotential: `potDown` leaves, chained talent entries —
 * shared/potential.js, docs/DATA.md §2.3); a self-check proves shared/potential.js atRank rebuilds every rank exactly.
 * At a rank, every chess (normal and elite), 补位 / 自选 unit form adds the `potentialRanks` attribute modifiers up to it
 * (withPotential) and picks its talent / trait / module candidates at it (the 「天赋效果增强」 steps). The 原型干员
 * stand-ins have no potential ranks. A summon picks its own talent / trait candidates at its owner's rank — their
 * `requiredPotentialRank` mirrors the owner's 「天赋效果增强」 (夕's “小自在” 化境 15 → 18 层, 凯尔希's Mon3tr 不毁重构, 望's
 * 棋子 +1 持有 / 部署) — and takes none of the owner's attribute modifiers (a token has no potential ranks; the owner's
 * ATK / cost / redeploy steps are the owner's own). Stage devices and the band's map characters are no player's
 * operators: rank 0.
 */

/** character_table potential attribute types → interpolateAttrs keys (every potential modifier of the season is an ADDITION). */
const POTENTIAL_ATTRS = Object.freeze({
  MAX_HP: 'maxHp', ATK: 'atk', DEF: 'def', MAGIC_RESISTANCE: 'magicResistance', COST: 'cost', RESPAWN_TIME: 'respawnTime',
  ATTACK_SPEED: 'attackSpeed', BLOCK_CNT: 'blockCnt', BASE_ATTACK_TIME: 'baseAttackTime',
});

/**
 * Interpolated attributes (interpolateAttrs) with the character's potential attribute modifiers up to rank `potRank`
 * added (`potentialRanks[0 … potRank-1]`, each 「攻击力+22」 / 「部署费用-1」 / 「再部署时间-4秒」 … an ADDITION to the raw
 * value, before statsFrom rounds it). A modifier of another kind is reported, not applied.
 * @returns {object|null} a new attribute object (null when `attrs` is)
 */
function withPotential(char, attrs, potRank, label) {
  if (!attrs) return attrs;
  const out = { ...attrs };
  for (const rank of (char?.potentialRanks || []).slice(0, potRank)) {
    for (const m of rank?.buff?.attributes?.attributeModifiers || []) {
      const key = POTENTIAL_ATTRS[m.attributeType];
      if (!key || m.formulaItem !== 'ADDITION' || typeof m.value !== 'number' || m.loadFromBlackboard || m.fetchBaseValueFromSourceEntity) {
        warn(`${label}: potential modifier ${m.attributeType} ${m.formulaItem} not applied`);
        continue;
      }
      out[key] = (typeof out[key] === 'number' ? out[key] : 0) + m.value;
    }
  }
  return out;
}


// ===== shared game-object helpers ===============================================================

/** Range grid [[dRow,dCol]…] of a range_table id (facing right), or null. */
function rangeGrid(ctx, rangeId) {
  if (!rangeId) return null;
  const r = ctx.rangeTable[rangeId];
  if (!r) { warn(`unknown rangeId ${rangeId}`); return null; }
  return (r.grids || []).map((g) => [g.row, g.col]);
}

/** Interpolate character attribute keyframes at (phase, level); returns the raw float data object. */
function interpolateAttrs(char, phase, level) {
  const ph = char.phases?.[phase];
  if (!ph) return null;
  const kfs = ph.attributesKeyFrames || [];
  if (!kfs.length) return null;
  const lv = Math.max(1, Math.min(level, ph.maxLevel || level));
  let a = kfs[0], b = kfs[kfs.length - 1];
  for (let i = 0; i < kfs.length - 1; i++) {
    if (lv >= kfs[i].level && lv <= kfs[i + 1].level) { a = kfs[i]; b = kfs[i + 1]; break; }
  }
  const t = b.level === a.level ? 0 : (lv - a.level) / (b.level - a.level);
  const out = {};
  for (const [k, v0] of Object.entries(a.data)) {
    const v1 = b.data[k];
    out[k] = typeof v0 === 'number' && typeof v1 === 'number' ? v0 + (v1 - v0) * t : v0;
  }
  return out;
}

/** Map of module attribute blackboard keys → stat fields. */
const MODULE_ATTR_MAP = {
  max_hp: 'maxHp', atk: 'atk', def: 'def', magic_resistance: 'res', attack_speed: 'aspd',
  cost: 'cost', respawn_time: 'respawnTime', block_cnt: 'blockCnt', base_attack_time: 'bat',
  max_deploy_count: 'deployLimit', max_deck_stack_cnt: 'deckStack',
};

/** Convert interpolated attributes (+ optional additive module bonus) into the compact stats object. */
function statsFrom(attrs, bonus = {}) {
  if (!attrs) return null;
  const r = (v) => Math.round(v);
  const s = {
    maxHp: r(attrs.maxHp),
    atk: r(attrs.atk),
    def: r(attrs.def),
    res: cleanNum(attrs.magicResistance),
    cost: r(attrs.cost),
    blockCnt: r(attrs.blockCnt),
    bat: cleanNum(attrs.baseAttackTime),
    aspd: cleanNum(attrs.attackSpeed),
    respawnTime: r(attrs.respawnTime),
    spRecovery: cleanNum(attrs.spRecoveryPerSec),
    hpRecoveryPerSec: cleanNum(attrs.hpRecoveryPerSec),
    moveSpeed: cleanNum(attrs.moveSpeed),
    tauntLevel: attrs.tauntLevel | 0,
    massLevel: attrs.massLevel | 0,
    deployLimit: attrs.maxDeployCount | 0,
    deckStack: attrs.maxDeckStackCnt | 0,
  };
  for (const [k, v] of Object.entries(bonus)) {
    const f = MODULE_ATTR_MAP[k];
    if (!f) { warn(`unmapped module attribute key ${k}`); continue; }
    s[f] = cleanNum((s[f] || 0) + v);
  }
  return s;
}

/** Immunity flags of a character/enemy attribute object. */
function immunitiesOf(attrs) {
  return {
    stun: !!attrs?.stunImmune, silence: !!attrs?.silenceImmune, sleep: !!attrs?.sleepImmune,
    frozen: !!attrs?.frozenImmune, levitate: !!attrs?.levitateImmune,
  };
}

/** Official trigger rule names → DESIGN §5.6 names. */
const TRIGGER_RENAME = { ALWAYS: 'SP_FULL', CUSTOM_RANGE_SEARCH_ENEMY: 'CUSTOM_RANGE' };

/**
 * Official rows the engine plays as one of its own rules on an ally condition (`allies: true` — server/sim/skills.js: a
 * healable, injured ally on the trigger grid instead of an enemy): 黍 S3 离离枯荣's TRY_SEARCH_ALLY_SKILL, PRTS 卫戍协议/帮助
 * 特殊策略 "技能范围内存在可治疗的我方单位时释放技能" — SKILL_RANGE on the skill's own range (x-2), checked every tick.
 */
const TRIGGER_ALLY_RULES = Object.freeze({ TRY_SEARCH_ALLY_SKILL: 'SKILL_RANGE' });

/**
 * A skill whose rangeId is its new ATTACK range — "攻击范围扩大 / 改变 / 缩小 / 缩短", "攻击距离+1 / 加长 / 缩短", "攻击范围与
 * 溅射范围扩大" — and not a 技能范围 of its own (PRTS 卫戍协议/帮助 技能操作: "拥有技能范围的技能（非攻击距离增加）").
 * "攻击范围内…" (an effect on the attack range) does not match.
 */
const ATTACK_RANGE_CHANGE = /攻击(?:范围|距离)(?:与溅射范围)?(?:扩大|增大|改变|改为|缩小|缩短|加长|增加|\+|(?:向前|往前)?延伸|朝[^，。；]{1,8}扩大)/;

/**
 * A deliberate deviation from the official 技能策略 (DESIGN §21.29): the owner's decision of 2026-10-03 after community
 * feedback ("反馈的人太多了"; GitHub issue #4, PR #12). The 下半 data's TANK class row (`TANK | | | 0 | TAKE_DAMAGE`,
 * added with 下半 — 上半 had no TANK row) makes every MANUAL 重装 skill wait for a hit; these six offensive skills cast
 * with an enemy in range instead — the basic strategy, DEFAULT. Keyed by the NORMAL chess id (the elite follows through
 * its baseId) and the skill id, never by the skill id alone: 灰毫 S1 skcom_atk_up[3] is a generic skill other chess
 * carry too (惊蛰, 幽灵鲨, 耶拉, 莫斯提马, 莱恩哈特). The record keeps the official row in `rawRule` (TAKE_DAMAGE) for
 * traceability; validateAll fails the build when an entry no longer meets a TAKE_DAMAGE row or its skill. 深巡 S1
 * 侵袭破坏应对 keeps TAKE_DAMAGE.
 * 余 S2 厚礼上宾 joined on 2026-10-04 (the owner's decision after GitHub issue #32 item 1, DESIGN §22.10: players saw it fire
 * from a ranged hit with nobody to pull). His attack range is his own tile (0-1), so the basic strategy would not see an
 * enemy he could pull: his S2 takes SKILL_RANGE on its own 技能范围 (x-1) — the official strategy of a MANUAL skill with a
 * 技能范围 when no class row applies, "仅在技能范围内存在敌人（无视其不可选中）时释放技能" — `customRangeGrid` = that range.
 * A DEFAULT entry is the basic strategy, so the owner's ACTIVE_RANGE rule applies on top of it (resolveTrigger; the
 * owner's decision of 2026-10-05): 深巡 S2, whose running range 3-2 strictly contains her 2-2, casts with an enemy in the
 * 3-2 (`rule` ACTIVE_RANGE, `rawRule` still TAKE_DAMAGE).
 */
const TRIGGER_DEVIATIONS = Object.freeze({
  chess_char_1_04_a: { skchr_udflow_2: 'DEFAULT' },                                // 深巡 S2 行动能力剥夺
  chess_char_1_20_a: { skchr_liskam_2: 'DEFAULT' },                                // 雷蛇 S2 反击电弧
  chess_char_2_18_a: { 'skcom_atk_up[3]': 'DEFAULT', skchr_ashlok_2: 'DEFAULT' },  // 灰毫 S1 攻击力强化·γ型, S2 专注轰击
  chess_char_5_08_a: { skchr_horn_2: 'DEFAULT', skchr_horn_3: 'DEFAULT' },         // 号角 S2 暴风号令, S3 终极防线
  chess_char_6_03_a: { skchr_yu_2: 'SKILL_RANGE' },                                // 余 S2 厚礼上宾 (its x-1)
});

/**
 * The same deviation for the 重装 stand-ins (补位 / 自选 prototypes, data/backups.json forms): the owner's decision of
 * 2026-10-05 (the approved 补位 plan, handoff 0.2.0-补位方案 §一.5): 预备干员-重装 and Mechanist cast with an enemy in
 * range — DEFAULT — instead of the TANK class row's TAKE_DAMAGE. Keyed by the stand-in's charId (a form belongs to no
 * chess) and the skill id, every skill of both: a stand-in fields the skill its chess names and a prototype in a 自选
 * slot follows the same rule. `rawRule` keeps TAKE_DAMAGE; validateAll fails the build when an entry no longer meets a
 * TAKE_DAMAGE row on every form of its unit.
 */
const STANDIN_TRIGGER_DEVIATIONS = Object.freeze({
  char_602_cdfend: { 'skcom_def_up[1]': 'DEFAULT', 'skcom_def_up[2]': 'DEFAULT', 'skcom_def_up[3]': 'DEFAULT' }, // 预备干员-重装 防御力强化 α/β/γ
  char_610_acfend: { skchr_acfend_1: 'DEFAULT', skchr_acfend_2: 'DEFAULT', skchr_acfend_3: 'DEFAULT' },          // Mechanist S1 结构稳定 / S2 不变性原理 / S3 应力倒置
});

/**
 * Corrections for 自选 units whose skill text no longer matches the live client (keyed by charId and skill id): 菲亚梅塔
 * S1 — PRTS 备注 for the 2026-08-01 client: it no longer targets flyers and its "攻击距离+1" no longer grows the range
 * (the client's selector agrees), so the basic strategy (DEFAULT), not ACTIVE_RANGE on a +1 grid she cannot reach (O12).
 */
const UNIT_TRIGGER_CORRECTIONS = Object.freeze({
  char_300_phenxi: { skchr_phenxi_1: 'DEFAULT' },
});

/**
 * The attack range a MANUAL skill gives while it runs, when its text changes the attack range (ATTACK_RANGE_CHANGE): its
 * own rangeId grid, else the operator's range grown by `ability_range_forward_extend` ("攻击距离+N": 空弦 S3, 史尔特尔
 * S2 / S3, 异客 S2 — the kits' targeting.rangeExtend, extendedGrid as Battle._refreshRange); null for any other skill and
 * for "被动效果：攻击范围扩大" (引星棘刺 S3: her own range while she carries it — shared/loadoutRecord.js attackRangeGrid).
 */
function activeAttackGrid(skill, baseGrid) {
  const desc = skill.desc || '';
  if (!ATTACK_RANGE_CHANGE.test(desc) || /被动效果：攻击范围扩大/.test(desc)) return null;
  if (skill.rangeGrid?.length) return skill.rangeGrid.map((p) => p.slice());
  const n = Math.round(Number(skill.bb?.ability_range_forward_extend) || 0);
  return n > 0 && baseGrid?.length ? extendedGrid(baseGrid, n) : null;
}

/** True when grid `a` holds every tile of grid `b` and at least one more (`[dRow, dCol]` pairs, facing RIGHT). */
function strictlyContains(a, b) {
  const sa = new Set(a.map(([r, c]) => `${r},${c}`)), sb = new Set(b.map(([r, c]) => `${r},${c}`));
  return sa.size > sb.size && [...sb].every((k) => sa.has(k));
}

/**
 * The rules the owner's ACTIVE_RANGE replaces (resolveTrigger), both of which wait for an enemy in the INITIAL range:
 * DEFAULT, the basic strategy (no row, or a DEFAULT deviation of the tables — 深巡 S2, the owner's decision of
 * 2026-10-05), and SEARCH, the 解放者 / 阵法术师 / 安洁莉娜 S2·S3 row "不受基础策略影响，在初始攻击范围内存在敌人时释放技能"
 * (the owner's decision of 2026-10-05 too).
 */
const ACTIVE_RANGE_OVER = new Set(['DEFAULT', 'SEARCH']);

/**
 * Resolve the auto-cast rule of a skill record (PRTS 卫戍协议/帮助 §作战阶段 技能操作 — the official skill strategies;
 * DESIGN §5.6):
 * - charId rows first (exact skillIndex, or −1 = every skill of the operator);
 * - then the class rows, subProfession before profession. They name whole classes — PRTS "重装干员", "先锋-战术家、
 *   先锋-执旗手、辅助-吟游者分支干员", "近卫-解放者、术师-阵法术师分支干员" — so they apply to EVERY skill index: the rows'
 *   skillIndex 0 is not "skill 1 only" (the 阵法术师 row has to cover 薄绿's default S2 — a phalanx never attacks while
 *   its skill is off, so the basic strategy could never cast it; "不受技能范围影响" of the 重装 row speaks of their skills
 *   with a 技能范围, which only S2/S3 have). They apply to MANUAL skills only: the strategies automate the manual 开启,
 *   an AUTO skill fires by its own rule (PRTS 古米 S1 备注: "此技能在存在生命值不满的可治疗角色时可触发");
 * - else, for an operator's MANUAL skill with a 技能范围 (a rangeId that is not an attack-range change): SKILL_RANGE,
 *   "不通过普通攻击/治疗触发技能，仅在技能范围内存在敌人（无视其不可选中）时释放技能", customRangeGrid = the skill range;
 * - else DEFAULT (the basic strategy: ready + about to attack / heal);
 * - an ally row the engine plays as one of its rules (TRIGGER_ALLY_RULES: 黍 S3's TRY_SEARCH_ALLY_SKILL → SKILL_RANGE on
 *   the skill range with `allies: true` — an injured, healable ally there);
 * - last, the deliberate deviations (TRIGGER_DEVIATIONS, per chess and skill; STANDIN_TRIGGER_DEVIATIONS, per stand-in
 *   unit and skill): `rule` from the table, `rawRule` the official row (a SKILL_RANGE deviation takes the skill's own
 *   range as `customRangeGrid`);
 * - and the owner's rule of 2026-10-05, a deliberate deviation like §21.29 (community report 「有的干员开技能后的攻击范围比
 *   平时攻击范围大，但是怪走到平时的攻击范围内才会开技能」): an operator's MANUAL skill on the basic strategy (DEFAULT — by
 *   no row, or by a DEFAULT deviation of the tables: 深巡 S2's 3-2 over her 2-2) or on the SEARCH row (解放者 / 阵法术师 /
 *   安洁莉娜: 薄绿 S1, 蜜蜡 S1, 卡涅利安 S3, 玛恩纳 S2, 安洁莉娜 S3) — ACTIVE_RANGE_OVER, both by the owner's decisions
 *   of 2026-10-05 — whose attack range while it runs (activeAttackGrid) strictly contains the operator's own range casts as
 *   soon as an enemy — a heal skill: an injured ally — is inside that larger range: ACTIVE_RANGE, `customRangeGrid` = the
 *   running range, `rawRule` the official row. Other rows keep their rule (TAKE_DAMAGE waits for a hit, CUSTOM_RANGE /
 *   SKILL_RANGE / SP_FULL / … have their own range or none).
 * @param {object} skill record from buildSkill (skillId, skillType, desc, rangeGrid, bb)
 * @param {{operator?: boolean, chessId?: string, unitCharId?: string, baseGrid?: number[][]|null}} opts operator = a
 *   chess (the 技能范围 strategy is written for 干员; summons keep DEFAULT); chessId = the chess's NORMAL id
 *   (TRIGGER_DEVIATIONS key); unitCharId = the character of a backups.json unit form (STANDIN_TRIGGER_DEVIATIONS key);
 *   baseGrid = the operator's own range at that status (ACTIVE_RANGE)
 */
function resolveTrigger(ctx, char, charId, skillIdx, skill, { operator = false, chessId = null, unitCharId = null, baseGrid = null } = {}) {
  const rows = Object.values(ctx.ac.skillTriggerDataList || {});
  const manual = skill.skillType === 'MANUAL';
  const pick =
    rows.find((r) => r.charId === charId && (r.skillIndex === skillIdx || r.skillIndex === -1)) ||
    (manual && rows.find((r) => !r.charId && r.subProfessionId && r.subProfessionId === char.subProfessionId)) ||
    (manual && rows.find((r) => !r.charId && !r.subProfessionId && r.profession === char.profession)) ||
    null;
  if (!pick && operator && manual && skill.rangeGrid && !ATTACK_RANGE_CHANGE.test(skill.desc || '')) {
    return { rule: 'SKILL_RANGE', rawRule: 'DEFAULT', customRangeGrid: skill.rangeGrid.map((p) => p.slice()) };
  }
  const rawRule = pick ? pick.skillTriggerType : 'DEFAULT';
  // a live-client correction is final (no ACTIVE_RANGE upgrade: the text's larger range is gone in the client)
  const correction = unitCharId ? UNIT_TRIGGER_CORRECTIONS[unitCharId]?.[skill.skillId] : null;
  if (correction) return { rule: correction, rawRule, customRangeGrid: null };
  // the 重装 exception also covers every 自选 重装 (a backups.json unit of the TANK class whose MANUAL skill meets the
  // class row's TAKE_DAMAGE casts with an enemy in range — the owner's decision of 2026-10-05, as for the stand-ins)
  const deviation = chessId ? TRIGGER_DEVIATIONS[chessId]?.[skill.skillId]
    : unitCharId ? STANDIN_TRIGGER_DEVIATIONS[unitCharId]?.[skill.skillId]
      ?? (char.profession === 'TANK' && manual && rawRule === 'TAKE_DAMAGE' ? 'DEFAULT' : null) : null;
  if (deviation === 'SKILL_RANGE') {
    if (!skill.rangeGrid) warn(`trigger deviation ${chessId} ${skill.skillId}: SKILL_RANGE without a 技能范围`);
    return { rule: deviation, rawRule, customRangeGrid: skill.rangeGrid ? skill.rangeGrid.map((p) => p.slice()) : null };
  }
  if (!deviation && TRIGGER_ALLY_RULES[rawRule]) {
    if (!skill.rangeGrid) warn(`skill ${skill.skillId}: ${rawRule} without a 技能范围`);
    return { rule: TRIGGER_ALLY_RULES[rawRule], rawRule, customRangeGrid: skill.rangeGrid ? skill.rangeGrid.map((p) => p.slice()) : null, allies: true };
  }
  const rule = deviation || TRIGGER_RENAME[rawRule] || rawRule;
  if (ACTIVE_RANGE_OVER.has(rule) && operator && manual && baseGrid?.length) {
    const active = activeAttackGrid(skill, baseGrid);
    if (active && strictlyContains(active, baseGrid)) return { rule: 'ACTIVE_RANGE', rawRule, customRangeGrid: active };
  }
  if (deviation) return { rule: deviation, rawRule, customRangeGrid: null };
  let customRangeGrid = null;
  if (rawRule === 'CUSTOM_RANGE_SEARCH_ENEMY') {
    const rid = ctx.ac.skillRangeDict?.[skill.skillId];
    customRangeGrid = rangeGrid(ctx, rid);
    if (!customRangeGrid) warn(`skill ${skill.skillId}: CUSTOM_RANGE trigger without skillRangeDict entry`);
  }
  return { rule, rawRule, customRangeGrid };
}

/** Numeric SpType enum values found in skill_table (passive skills use 8 = ON_DEPLOY, no SP). */
const SP_TYPE_NAMES = { 1: 'INCREASE_WITH_TIME', 2: 'INCREASE_WHEN_ATTACK', 4: 'INCREASE_WHEN_TAKEN_DAMAGE', 8: 'ON_DEPLOY' };

/**
 * Build a skill record (default skill of a chess or a token) at a given level.
 * @returns {object|null}
 */
function buildSkill(ctx, skillId, level, trigger, label) {
  if (!skillId) return null;
  const s = ctx.skillTable[skillId];
  if (!s) { warn(`${label}: skill ${skillId} missing from skill_table`); return null; }
  const levels = Array.isArray(s.levels) ? s.levels : [];
  const lv = levels[Math.max(0, Math.min(level, levels.length) - 1)];
  if (!lv) { warn(`${label}: skill ${skillId} has no level ${level}`); return null; }
  const { bb, bbStr } = flattenBB(lv.blackboard, `skill ${skillId}`);
  // Some descriptions reference 'duration' implicitly; expose it for placeholder resolution.
  const phBB = { duration: lv.duration, ...bb };
  const { desc, descRaw } = textPair(lv.description, phBB, bbStr, `skill ${skillId}`);
  const sp = lv.spData || {};
  if (typeof sp.spType === 'number' && !SP_TYPE_NAMES[sp.spType]) warn(`skill ${skillId}: unknown numeric spType ${sp.spType}`);
  const skill = {
    skillId,
    iconId: s.iconId || skillId,
    name: lv.name,
    level: Math.max(1, Math.min(level, levels.length)),
    desc, descRaw,
    skillType: lv.skillType,
    durationType: lv.durationType,
    duration: cleanNum(lv.duration),
    spType: typeof sp.spType === 'number' ? SP_TYPE_NAMES[sp.spType] || String(sp.spType) : sp.spType,
    spCost: sp.spCost,
    initSp: sp.initSp,
    maxChargeTime: sp.maxChargeTime,
    increment: cleanNum(sp.increment),
    bb, bbStr,
    rangeId: lv.rangeId || null,
    rangeGrid: rangeGrid(ctx, lv.rangeId),
    prefabId: lv.prefabId || skillId,
    trigger: trigger || { rule: 'DEFAULT', rawRule: 'DEFAULT', customRangeGrid: null },
  };
  // GitHub #700: the client preview reads the localized skill text, which no longer has this Simplified line
  // (引星棘刺 S3 「被动效果：攻击范围扩大」). The boolean is that line plus a non-empty grid. Absent otherwise.
  // A record without it still matches the line (shared/loadoutRecord.js), which is how a plugin's Chinese skill
  // keeps the preview. The battle kits are not this flag; resolveTrigger still reads the Chinese description.
  if (/被动效果：攻击范围扩大/.test(desc) && Array.isArray(skill.rangeGrid) && skill.rangeGrid.length) skill.passiveRange = true;
  return skill;
}

/**
 * Split the parts of a module phase into the parts that apply to the operator itself and the parts
 * flagged `isToken` (they upgrade the operator's summons, e.g. 伺夜's wolves, 缪尔赛思's 流形,
 * 浊心斯卡蒂's 海嗣, 耀骑士临光's “耀阳”) and must never be applied to the operator.
 * @param {object|null} modulePhase battle_equip_table phase (or null)
 * @returns {{ op: object[], token: object[] }}
 */
function splitModuleParts(modulePhase) {
  const op = [], token = [];
  for (const part of modulePhase?.parts || []) (part && part.isToken ? token : op).push(part);
  return { op, token };
}

/**
 * Apply module trait-override parts to a trait blackboard/text (golden chess or their tokens).
 * Mutates `traitBB`; returns the (possibly overridden) trait template, module text and trait range id, and `descBB` —
 * the blackboard the trait's own line is written with: a part whose target is `DISPLAY` (display only) and that adds a
 * line without rewriting the trait's feeds its blackboard to that added line only. 圣约送葬人 REA-Y (uniequip_003_excu2):
 * its DISPLAY part's `value` 12 is the 「攻击速度+{value}」 of its own line, not the trait's 「回复自身{value}生命」 (50 —
 * GitHub #400; the battle heals 50, its kit reads traitBase). `traitBB` (the battle's trait blackboard) still takes
 * every part, as before (the kits that read it are written against it).
 * @returns {{ template: string, moduleText: string|null, rangeId: string|null, descBB: { bb: object, bbStr: object } }}
 */
function applyModuleTraitParts(parts, phase, level, traitBB, template, rangeId, label, potRank = 0) {
  let moduleText = null;
  const descBB = { bb: { ...traitBB.bb }, bbStr: { ...traitBB.bbStr } };
  for (const part of parts || []) {
    const mc = bestCandidate(part.overrideTraitDataBundle?.candidates, phase, level, potRank);
    if (!mc) continue;
    const mb = flattenBB(mc.blackboard, `${label} module trait`);
    Object.assign(traitBB.bb, mb.bb);
    Object.assign(traitBB.bbStr, mb.bbStr);
    if (part.target !== 'DISPLAY' || mc.overrideDescripton) {
      Object.assign(descBB.bb, mb.bb);
      Object.assign(descBB.bbStr, mb.bbStr);
    }
    if (mc.overrideDescripton) template = mc.overrideDescripton;
    if (mc.additionalDescription) moduleText = mc.additionalDescription;
    if (mc.rangeId) rangeId = mc.rangeId;
  }
  return { template, moduleText, rangeId, descBB };
}

/**
 * Trait record of a character at (phase, level, potential rank) with the given (operator) module parts, plus the
 * combat classification derived from its text.
 * @returns {{ trait: object, classify: object }}
 */
function traitRecord(ctx, char, phase, level, opParts, chessId, potRank = 0) {
  const tc = bestCandidate(char.trait?.candidates, phase, level, potRank);
  const traitBB = flattenBB(tc?.blackboard, `${chessId} trait`);
  const traitMod = applyModuleTraitParts(opParts, phase, level, traitBB,
    tc?.overrideDescripton || char.description || '', tc?.rangeId || null, chessId, potRank);
  const tp = textPair(traitMod.template, traitMod.descBB.bb, traitMod.descBB.bbStr, `${chessId} trait`);
  const trait = { desc: tp.desc, descRaw: tp.descRaw, bb: traitBB.bb, bbStr: traitBB.bbStr, rangeGrid: rangeGrid(ctx, traitMod.rangeId) };
  if (traitMod.moduleText) {
    const mp = textPair(traitMod.moduleText, traitBB.bb, traitBB.bbStr, `${chessId} module trait`);
    trait.moduleDesc = mp.desc;
    trait.moduleDescRaw = mp.descRaw;
    // GitHub #700: the client preview reads the localized module line. These booleans are the Chinese reading.
    // `rangeExpand` — 「攻击范围扩大」 (莱恩哈特 SPC-X): the preview uses the module's talentIndex −1 grid.
    // `modeOnly` — 「集成战略」 (空弦 ISW-A): traitRangeExtend stays 0. Absent otherwise. A record without the
    // flag still matches the line (shared/loadoutRecord.js). The battle kits still read the Chinese moduleDesc.
    if (/攻击范围扩大/.test(mp.desc)) trait.rangeExpand = true;
    if (/集成战略/.test(mp.desc)) trait.modeOnly = true;
  }
  return { trait, classify: classifyAttack(char, tp.desc) };
}

/**
 * Flat stat additions of a module phase in stat-field names (ModuleRecord.attr): exactly what
 * statsFrom() adds to the no-module stats (`stats[f] = cleanNum(statsBase[f] + attr[f])`).
 */
function moduleAttr(modulePhase) {
  const sum = {};
  for (const b of modulePhase?.attributeBlackboard || []) sum[b.key] = (sum[b.key] || 0) + b.value;
  const out = {};
  for (const [k, v] of Object.entries(sum)) {
    const f = MODULE_ATTR_MAP[k];
    if (!f) { warn(`unmapped module attribute key ${k}`); continue; }
    out[f] = cleanNum(v);
  }
  return out;
}

/**
 * Talents of a character at (phase, level), plus module talent upgrades from `moduleParts`
 * (golden chess: the operator's non-token parts; tokens: the owner's `isToken` parts).
 * An override of an existing talent keeps the base values that the module candidate does not
 * restate (blackboard keys merged, module values win; name/text/range/token kept when absent).
 * `modPhase`/`modLevel` select module candidates (tokens: the owner's phase/level); `potRank` every candidate (tokens:
 * the owner's potential rank, ctx.potRank).
 * @returns {Array<{index:number,name:string|null,desc:string|null,descRaw:string|null,bb:object,bbStr:object,rangeGrid:any,tokenKey:string|null,hidden:boolean,fromModule:boolean}>}
 */
function buildTalents(ctx, char, phase, level, moduleParts, label, modPhase = phase, modLevel = level, potRank = 0) {
  return mergeTalentChanges(baseTalentList(ctx, char, phase, level, label, potRank),
    moduleTalentChanges(ctx, moduleParts, modPhase, modLevel, label, potRank));
}

/** The character's own talents at (phase, level, potential rank), unfiltered (no module). */
function baseTalentList(ctx, char, phase, level, label, potRank = 0) {
  const talents = [];
  (char.talents || []).forEach((t, index) => {
    const c = bestCandidate(t.candidates, phase, level, potRank);
    if (!c) return;
    const { bb, bbStr } = flattenBB(c.blackboard, `${label} talent ${index}`);
    const { desc, descRaw } = textPair(c.description, bb, bbStr);
    talents.push({
      index, name: c.name || null, desc, descRaw, bb, bbStr,
      rangeGrid: rangeGrid(ctx, c.rangeId), tokenKey: c.tokenKey || null,
      hidden: !!c.isHideTalent, fromModule: false,
    });
  });
  return talents;
}

/**
 * Talent additions/overrides of module parts at (modPhase, modLevel, potential rank), in part order, as ModuleRecord
 * `talentChanges` entries: { talentIndex, name, desc, descRaw, bb, bbStr, rangeGrid, tokenKey, hidden }.
 * `talentIndex` −1 = a new (usually hidden, data-only) talent.
 */
function moduleTalentChanges(ctx, moduleParts, modPhase, modLevel, label, potRank = 0) {
  const out = [];
  for (const part of moduleParts || []) {
    const cands = part.addOrOverrideTalentDataBundle?.candidates;
    if (!cands) continue;
    const c = bestCandidate(cands, modPhase, modLevel, potRank);
    if (!c) continue;
    const { bb, bbStr } = flattenBB(c.blackboard, `${label} module talent`);
    const text = c.upgradeDescription || c.description;
    const { desc, descRaw } = textPair(text, bb, bbStr);
    out.push({
      talentIndex: c.talentIndex, name: c.name || null, desc, descRaw, bb, bbStr,
      rangeGrid: rangeGrid(ctx, c.rangeId), tokenKey: c.tokenKey || null, hidden: !!c.isHideTalent,
    });
  }
  return out;
}

/**
 * Apply module talent changes to a talent list — the ONE merge rule, mirrored exactly by
 * server/sim/simdata.js composeTalents (a data test checks both agree on every golden chess).
 * Override of an existing talent index: module values win; keep what the candidate does not restate
 * (e.g. 浊心斯卡蒂's data-only upgrade has an empty blackboard but the talent still sends 1 海嗣: cnt
 * stays). Otherwise the change is appended. Fully empty placeholder talents (no name, no text, no
 * blackboard, no token) are dropped at the end.
 */
function mergeTalentChanges(base, changes) {
  const talents = base.map((t) => ({ ...t }));
  for (const ch of changes || []) {
    const { talentIndex, ...rest } = ch;
    const rec = { index: talentIndex, ...rest, fromModule: true };
    const at = talentIndex >= 0 ? talents.findIndex((x) => x.index === talentIndex) : -1;
    if (at >= 0) {
      const old = talents[at];
      talents[at] = {
        ...rec,
        name: rec.name || old.name, desc: rec.desc ?? old.desc, descRaw: rec.descRaw ?? old.descRaw,
        bb: { ...old.bb, ...rec.bb }, bbStr: { ...old.bbStr, ...rec.bbStr },
        rangeGrid: rec.rangeGrid || old.rangeGrid, tokenKey: rec.tokenKey || old.tokenKey,
        hidden: old.hidden && rec.hidden,
      };
    } else {
      talents.push(rec);
    }
  }
  return talents.filter((t) => t.name || t.desc || Object.keys(t.bb).length || t.tokenKey);
}

// ===== chess ====================================================================================

/** Melee sub-professions whose normal attack is a ranged attack (can hit FLY). */
const MELEE_RANGED_SUBPROFS = new Set(['lord', 'fortress', 'shotprotector', 'agent', 'hookmaster']);
/** Sub-professions whose normal state is "no attack" (buff aura / skill-only attackers). */
const NO_ATTACK_SUBPROFS = new Set(['bard', 'phalanx', 'librator']);

/**
 * Derive combat classification of an operator from profession / sub-profession / trait text.
 * Heuristic (documented in DATA.md); the sim may override per kit.
 */
function classifyAttack(char, traitText) {
  const prof = char.profession;
  const sub = char.subProfessionId;
  const trait = traitText || '';
  // 驭法铁卫 (斩业星熊) "技能开启时普通攻击会造成法术伤害": arts is the skill-on type; the normal attack — the record's
  // dmgType, what a card and the bot read — is physical (display only: her kit attacks physically off-skill and in arts
  // while a skill runs, op-hsgma2.js)
  const skillOnArts = /技能开启时[^，。；]*法术伤害/.test(trait);
  let dmgType;
  if ((prof === 'MEDIC' && sub !== 'incantationmedic') || sub === 'bard') dmgType = 'heal';
  else if ((/法术伤害/.test(trait) && !skillOnArts) || prof === 'CASTER') dmgType = 'arts';
  else dmgType = 'phys';

  let attackKind;
  if (NO_ATTACK_SUBPROFS.has(sub)) attackKind = 'none';
  else if (dmgType === 'heal') attackKind = 'heal';
  else if (char.position === 'RANGED' || MELEE_RANGED_SUBPROFS.has(sub)) attackKind = 'ranged';
  else attackKind = 'melee';

  let projectile = 'none';
  if (attackKind === 'heal') projectile = 'orb';
  else if (attackKind === 'ranged') projectile = dmgType === 'arts' ? 'bolt' : 'arrow';

  // Ranged attackers hit FLY unless the trait restricts them to ground targets (投掷手 "地面敌人", 要塞).
  const canHitFly = (attackKind === 'ranged' && !/地面敌人/.test(trait) && sub !== 'fortress') || sub === 'skywalker';
  let targetPriority = null;
  if (/优先攻击空中单位/.test(trait)) targetPriority = 'fly';
  else if (/防御力最低/.test(trait)) targetPriority = 'lowestDef';
  return { dmgType, attackKind, projectile, canHitFly, targetPriority };
}

/** E2 art exists for this char? (research 07 knows; else assume when the char has an E2 phase) */
function hasE2Art(ctx, charId, kind) {
  const a = ctx.research.assets?.operators?.[charId]?.[kind];
  if (a) return !!a.e2;
  return (ctx.charTable[charId]?.phases?.length || 0) >= 3;
}


const rarityOf = (char) => Number(String(char?.rarity).replace('TIER_', '')) || null;
const statusCmp = (a, b) => a.phase - b.phase || a.level - b.level || a.skillLevel - b.skillLevel || a.equipLevel - b.equipLevel;

/**
 * The character part of a data/backups.json unit (DATA.md §18): who it is, its art ids (the elite form uses the E2 art
 * when it exists, as a chess does) and its module names (a composed record's `module` names the module on the normal
 * form too, where no module phase is built).
 */
function buildUnitHead(ctx, charId) {
  const { charTable, uniequip } = ctx;
  const char = charTable[charId];
  const moduleNames = {};
  for (const id of uniequip.charEquip?.[charId] || []) {
    const meta = uniequip.equipDict?.[id];
    if (meta) moduleNames[id] = { name: meta.uniEquipName || null, typeName: `${meta.typeName1 || ''}${meta.typeName2 ? '-' + meta.typeName2 : ''}` };
  }
  return {
    charId, name: char.name, appellation: char.appellation, rarity: rarityOf(char), profession: char.profession,
    subProfessionId: char.subProfessionId, subProfessionName: uniequip.subProfDict?.[char.subProfessionId]?.subProfessionName || null,
    position: char.position, nationId: char.nationId || null, isNotObtainable: !!char.isNotObtainable,
    assets: {
      avatar: charId, avatarGolden: hasE2Art(ctx, charId, 'avatar') ? `${charId}_2` : charId,
      portrait: `${charId}_1`, portraitGolden: `${charId}_${hasE2Art(ctx, charId, 'portrait') ? 2 : 1}`,
      spine: charId, subProfIcon: `sub_${char.subProfessionId}_icon`,
    },
    moduleNames,
  };
}

/**
 * A unit form (DATA.md §18): the character at one training status with nothing selected — the operator fields of a
 * chess record: stats / trait / talents without a module, every skill unlocked at the status at its skill level (the
 * trigger resolved per skill as for a chess), its summons, and at `equipLevel > 0` every ADVANCED module of that level.
 * The helpers and rules of buildChess; checkUnitFormParity proves the two agree on every PRESET chess.
 * @param {{ chessId?: string|null, skillIndex?: number|null }} [opts] `chessId`: the NORMAL chess id of a
 *   TRIGGER_DEVIATIONS entry (parity check only — a stand-in's form belongs to no chess: its deviations are the
 *   unit's, STANDIN_TRIGGER_DEVIATIONS by charId); `skillIndex`: a skill listed even when locked (buildChess always
 *   lists the default)
 */
function buildUnitForm(ctx, charId, status, { chessId = null, skillIndex = null } = {}) {
  const { charTable, uniequip, battleEquip } = ctx;
  const char = charTable[charId];
  const { phase, level, skillLevel, equipLevel } = status;
  const label = chessId ? `chess ${chessId}` : `unit ${charId}@${statusKey(status)}`;
  const attrs = withPotential(char, interpolateAttrs(char, phase, level), ctx.potRank, label);
  if (!attrs) warn(`${label}: cannot interpolate attributes`);
  const stats = statsFrom(attrs, {});
  const rangeId = char.phases?.[phase]?.rangeId || null;
  const base = traitRecord(ctx, char, phase, level, [], chessId || charId, ctx.potRank);
  const skills = [];
  (char.skills || []).forEach((se, i) => {
    if (!se?.skillId || (i !== skillIndex && !unlocked(se.unlockCond, phase, level))) return;
    const s = buildSkill(ctx, se.skillId, skillLevel, null, label);
    if (!s) return;
    s.trigger = resolveTrigger(ctx, char, charId, i, s, { operator: true, chessId, unitCharId: chessId ? null : charId, baseGrid: rangeGrid(ctx, rangeId) });
    s.index = i;
    s.overrideTokenKey = se.overrideTokenKey || null;
    skills.push(s);
  });
  const talents = mergeTalentChanges(baseTalentList(ctx, char, phase, level, label, ctx.potRank), []);
  const modules = [];
  if (equipLevel > 0) {
    for (const id of uniequip.charEquip?.[charId] || []) {
      const meta = uniequip.equipDict?.[id];
      if (!meta || meta.type === 'INITIAL') continue;
      const ph = battleEquip[id]?.phases?.find((p) => p.equipLevel === equipLevel) || null;
      if (!ph) { warn(`${label}: module ${id} has no level ${equipLevel} (not selectable)`); continue; }
      const parts = splitModuleParts(ph);
      const hasTraitPart = parts.op.some((pt) => bestCandidate(pt.overrideTraitDataBundle?.candidates, phase, level, ctx.potRank));
      const tr = hasTraitPart ? traitRecord(ctx, char, phase, level, parts.op, chessId || charId, ctx.potRank) : null;
      if (tr && JSON.stringify(tr.classify) !== JSON.stringify(base.classify)) warn(`${label}: module ${id} changes the combat classification (not applied by loadouts)`);
      modules.push({
        uniEquipId: id, name: meta.uniEquipName || null,
        typeName: `${meta.typeName1 || ''}${meta.typeName2 ? '-' + meta.typeName2 : ''}`,
        typeIcon: meta.typeIcon || null, icon: meta.uniEquipIcon || id, level: equipLevel,
        attr: moduleAttr(ph),
        traitOverride: tr ? tr.trait : null,
        talentChanges: moduleTalentChanges(ctx, parts.op, phase, level, label, ctx.potRank),
      });
    }
  }
  // summons: every id the character lists or a skill / talent / module talent names that character_table has — the
  // composed record keeps the ones its selection produces (shared/standIn.js composeUnitRecord)
  const displayTokens = Object.keys(char.displayTokenDict || {});
  const tokenIds = [...displayTokens, ...skills.map((s) => s.overrideTokenKey), ...talents.map((t) => t.tokenKey),
    ...modules.flatMap((m) => m.talentChanges.map((t) => t.tokenKey))];
  const form = {
    status: { phase, level, skillLevel, equipLevel },
    stats, immunities: stats ? immunitiesOf(attrs) : null,
    rangeId, rangeGrid: rangeGrid(ctx, rangeId),
    ...base.classify,
    trait: base.trait,
    skills, talents,
    displayTokens,
    tokens: [...new Set(tokenIds.filter((id) => id && charTable[id]))].sort(naturalCmp),
  };
  if (equipLevel > 0) form.modules = modules;
  // Same boolean as a chess record (GitHub #676): a 自选 / 补位 body is composed from this form, then localized.
  if (placeOnRangedOf(char.position, form.trait)) form.placeOnRanged = true;
  return form;
}

/**
 * Whether a MELEE record's Chinese trait without a module lets it stand on a 高台. The line is the official branch
 * trait; the boolean is only so a translated copy of that record still places (shared/highGround.js).
 * @param {string|null} position
 * @param {{ desc?: string }|null} trait
 * @returns {boolean}
 */
function placeOnRangedOf(position, trait) {
  const desc = trait && typeof trait.desc === 'string' ? trait.desc : '';
  return position === 'MELEE' && desc.includes(PLACE_ON_RANGED);
}


/** Derive an import-only unit with the exact builder paths; no downloads or writes on import.
 * Full potential and the caller's economy training statuses, no selected module. [ASSUMED]
 * Official data is supplied by the caller, never by a workshop pack.
 */
function deriveOfficialUnit(tables, charId, statuses) {
  const ctx = { ac: {}, research: {}, uniequip: {}, battleEquip: {}, ...tables, potRank: FULL_RANK };
  const char = ctx.charTable?.[charId];
  if (!char) throw new Error(`official character ${charId} missing`);
  const unit = { ...buildUnitHead(ctx, charId), forms: {}, tags: char.tagList ?? [] };
  for (const status of statuses) {
    if (!char.phases?.[status.phase]?.attributesKeyFrames?.length) throw new Error(`official attributes missing for ${charId} phase ${status.phase}`);
    for (const s of char.skills ?? []) if (s?.skillId && unlocked(s.unlockCond, status.phase, status.level) && !ctx.skillTable?.[s.skillId]?.levels?.length) throw new Error(`official skill ${s.skillId} missing for ${charId}`);
    const f = buildUnitForm(ctx, charId, status);
    if (!f.stats || !f.rangeGrid || !f.skills.length) throw new Error(`official stats, range or skills missing for ${charId}`);
    unit.forms[statusKey(status)] = f;
  }
  return unit;
}

return { unescapeNewlines, stripRich, richRaw, cleanNum, flattenBB, formatValue, resolvePlaceholders, textPair, naturalCmp, PHASE_INDEX, phaseIdx, unlocked, bestCandidate, POTENTIAL_ATTRS, withPotential, rangeGrid, interpolateAttrs, MODULE_ATTR_MAP, statsFrom, immunitiesOf, TRIGGER_RENAME, TRIGGER_ALLY_RULES, ATTACK_RANGE_CHANGE, TRIGGER_DEVIATIONS, STANDIN_TRIGGER_DEVIATIONS, UNIT_TRIGGER_CORRECTIONS, activeAttackGrid, strictlyContains, ACTIVE_RANGE_OVER, resolveTrigger, SP_TYPE_NAMES, buildSkill, splitModuleParts, applyModuleTraitParts, traitRecord, moduleAttr, buildTalents, baseTalentList, moduleTalentChanges, mergeTalentChanges, MELEE_RANGED_SUBPROFS, NO_ATTACK_SUBPROFS, classifyAttack, hasE2Art, rarityOf, statusCmp, buildUnitHead, buildUnitForm, placeOnRangedOf, deriveOfficialUnit };
}

export const { deriveOfficialUnit } = createOfficialUnitBuilders();
