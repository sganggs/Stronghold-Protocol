// Normative message catalogue (DESIGN §8). Used by server (validation) and client (building requests).
// Every client→server message is `{ t, rid?, ...fields }`. Unknown `t` or invalid fields ⇒ ERR.BAD_MSG.

import { DIFFICULTIES, NAME_MAX_LEN, ROOM_CODE_LEN, MAX_SEATS, EMOTES, GEO } from './constants.js';
import { isDroppableChess } from './standIn.js';
import { diySlotIds, validateDiyPicks } from './diy.js';
import { cultivatedStats, isPotential, isCultivate, POTENTIAL_DEFAULT, CULTIVATE_DEFAULT } from './potential.js';

// ---- tiny validators -------------------------------------------------------
const isInt = (v, lo = -Infinity, hi = Infinity) => Number.isInteger(v) && v >= lo && v <= hi;
const isStr = (v, max = 64) => typeof v === 'string' && v.length <= max;
const isBool = (v) => typeof v === 'boolean';
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64 && /^[A-Za-z0-9_\-.:]+$/.test(v);
const isUid = (v) => isInt(v, 1, 2 ** 31);
const isNum = (v, lo = -Infinity, hi = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const optional = (check) => (v) => v === undefined || check(v);
const nullable = (check) => (v) => v === null || v === undefined || check(v);
/** A plain object with at most `max` own keys, every key passing `key` and every value passing `val`. */
const isMap = (v, max, key, val) => {
  if (!isPlain(v)) return false;
  const keys = Object.keys(v);
  if (keys.length > max) return false;
  for (const k of keys) if (!key(k) || !val(v[k])) return false;
  return true;
};
const isList = (v, max, item) => Array.isArray(v) && v.length <= max && v.every(item);

// ---- client-side combat (DESIGN §14): b.progress / b.result payloads -------------------------------------------

/** Size limits of a b.result payload (the whole frame also obeys the 64 KB inbound limit). */
export const RESULT_LIMITS = Object.freeze({ players: 4, leaked: 400, unitsEnd: 64, unitStats: 160, layerGains: 40, mods: 16, unspawned: 400 });
const BIG = 1e13;
const isStat = (v) => v === undefined || isNum(v, 0, BIG);
const isModVal = (v) => v === null || isNum(v, -BIG, BIG) || isStr(v, 64) || isBool(v);
const isLeak = (l) => isPlain(l) && isId(l.enemyKey)
  && (l.mods === undefined || l.mods === null || isMap(l.mods, RESULT_LIMITS.mods, (k) => isStr(k, 32), isModVal))
  && optional((v) => isNum(v, 0, 1000))(l.lpr) && nullable(isId)(l.sourcePlayerId) && nullable((v) => isStr(v, 16))(l.tag)
  && optional(isBool)(l.counted) && optional(isBool)(l.boss) && optional(isBool)(l.spawned);
const isUnitEnd = (u) => isPlain(u) && nullable(isUid)(u.uid) && isNum(u.hpPct, 0, 1) && isNum(u.sp, 0, 1e5) && isBool(u.alive)
  && optional(isBool)(u.skillActive) && nullable(isId)(u.defId);
const isUnitStat = (u) => isPlain(u) && nullable(isUid)(u.uid) && nullable(isId)(u.defId) && optional((v) => isStr(v, 16))(u.kind)
  && isStat(u.dmg) && isStat(u.kills) && isStat(u.heal) && isStat(u.taken) && isStat(u.attacks);
const isPerPlayer = (p) => isPlain(p) && isInt(p.killed, 0, 1e5) && isInt(p.total, 0, 1e5)
  // `resolved` = the HUD capsule's numerator of this player's own field (the round's own scheduled enemies knocked out
  // or leaked: server/sim/battle/deploy.js killedInTotal / leakedInTotal, Battle.resolved). `killed` counts every counted
  // knock-out — a runtime split child / summon too — and may therefore exceed `total`, which counts only the round's own
  // scheduled enemies (server/match/fields.js validateClientResult bounds it against maxTotal instead).
  && optional((x) => isInt(x, 0, 1e5))(p.resolved)
  && isList(p.leaked, RESULT_LIMITS.leaked, isLeak) && isBool(p.perfect)
  && isMap(p.layerGains, RESULT_LIMITS.layerGains, isId, (v) => isNum(v, 0, 1e4))
  && isStat(p.coins) && isStat(p.damageDealt) && isStat(p.bossDamage) && isStat(p.healingDone) && isStat(p.deaths)
  && isList(p.unitsEnd, RESULT_LIMITS.unitsEnd, isUnitEnd)
  && (p.unitStats === undefined || isList(p.unitStats, RESULT_LIMITS.unitStats, isUnitStat));
const isUnspawned = (u) => isPlain(u) && isId(u.enemyKey) && nullable(isId)(u.sourcePlayerId) && nullable((v) => isStr(v, 16))(u.tag)
  && optional((v) => isNum(v, 0, 1e6))(u.time);

/**
 * Structural check of a client BattleResult (DESIGN §5.1 / §14 `b.result`): types, ranges and size limits only —
 * the semantic checks against the battle's spec are the server's (server/match/fields.js validateClientResult).
 */
export function isBattleResult(v) {
  return isPlain(v) && ['cleared', 'timeout', 'forced'].includes(v.reason) && isNum(v.time, 0, 1e5)
    && optional((x) => isInt(x, 0, 1e5))(v.killed) && optional((x) => isInt(x, 0, 1e5))(v.total)
    && optional((x) => isInt(x, 0, 1e5))(v.resolved)
    && isMap(v.perPlayer, RESULT_LIMITS.players, isId, isPerPlayer) && Object.keys(v.perPlayer).length > 0
    && (v.unspawned === undefined || isList(v.unspawned, RESULT_LIMITS.unspawned, isUnspawned))
    && optional((x) => isInt(x, 0, 1e9))(v.errors) && optional((x) => isNum(x, 0, BIG))(v.bossHpLeft);
}

// ---- operator loadout (DESIGN §16): room.loadout { entries } -------------------------------------------------

/**
 * `room.loadout { entries, ops? }`: `entries` = `{ [baseChessId]: { skill?: skillIndex, module?: uniEquipId | 'none' } }`
 * (the per-browser loadout of the 干员调配 screen); `ops` (0.2.2) = `{ [charId]: { potential?: 1–6, cultivate?: 0–3 } }`,
 * the player's per-operator 潜能 and 练度 (shared/potential.js; absent / missing = 潜能 6, 精英2 Lv.60 — the owner's
 * decision of 2026-10-08). Structural limits below; the semantic checks against the game data — known visible chess,
 * legal skill index for the normal AND the elite status, legal module of the elite (`checkLoadout`); an operator of the
 * 干员调配 roster or the 自选 owned pool (`checkLoadoutOps`) — are used by the server (lobby, match) and by the client to
 * sanitise a stored loadout before sending.
 */
export const LOADOUT_LIMITS = Object.freeze({ entries: 160, skillIndex: 9, ops: 256 });
/** The "no module" choice of an elite (模组: 不装备). */
export const MODULE_NONE = 'none';
const isLoadoutEntry = (e) => isPlain(e) && Object.keys(e).length > 0 && Object.keys(e).every((k) => k === 'skill' || k === 'module')
  && optional((v) => isInt(v, 0, LOADOUT_LIMITS.skillIndex))(e.skill) && optional(isId)(e.module);
/** Structural check of `room.loadout.entries`. */
export const isLoadoutEntries = (v) => isMap(v, LOADOUT_LIMITS.entries, isId, isLoadoutEntry);

/** Skill indexes a chess record offers (data `skills[]`, DESIGN §16; the default skill alone while data lacks it). */
function skillIndexesOf(c) {
  if (!c || typeof c !== 'object') return [];
  if (Array.isArray(c.skills) && c.skills.length) {
    return [...new Set(c.skills.map((s) => s && s.index).filter((i) => isInt(i, 0, LOADOUT_LIMITS.skillIndex)))].sort((a, b) => a - b);
  }
  return isInt(c.skill?.index, 0, LOADOUT_LIMITS.skillIndex) ? [c.skill.index] : [];
}

/**
 * What the 干员调配 screen may choose for one chess (DESIGN §16).
 *   skills: skill indexes unlocked at BOTH the normal and the elite status (identical sets in the official data)
 *   defaultSkill: `defaultSkillIndex` (data: the skills[] entry flagged isDefault, else `skill.index`)
 *   modules: the elite's modules (uniEquipId…) + 'none'; [] when the chess has no elite record
 *   defaultModule: the elite's default module (`defaultUniEquipId`), 'none' for module-less elites, null without elite
 * @param {any} base normal chess record
 * @param {any} [golden] its elite record (null when absent)
 * @returns {{ skills: number[], defaultSkill: number|null, modules: string[], defaultModule: string|null }}
 */
export function loadoutOptions(base, golden = null) {
  const n = skillIndexesOf(base);
  const g = golden ? skillIndexesOf(golden) : null;
  const skills = g && g.length ? n.filter((i) => g.includes(i)) : n;
  const flagged = Array.isArray(base?.skills) ? base.skills.find((s) => s && s.isDefault && isInt(s.index, 0, LOADOUT_LIMITS.skillIndex)) : null;
  let defaultSkill = flagged ? flagged.index : isInt(base?.skill?.index, 0, LOADOUT_LIMITS.skillIndex) ? base.skill.index : null;
  if (defaultSkill == null || !skills.includes(defaultSkill)) defaultSkill = skills.length ? skills[0] : defaultSkill;
  let modules = [];
  let defaultModule = null;
  if (golden) {
    let def = null;
    if (Array.isArray(golden.modules)) {
      modules = [...new Set(golden.modules.map((m) => m && m.uniEquipId).filter((id) => isId(id) && id !== MODULE_NONE))];
      const d = golden.modules.find((m) => m && m.isDefault && isId(m.uniEquipId));
      def = d ? d.uniEquipId : null;
    } else if (golden.module && golden.module.active && isId(golden.module.id)) {
      modules = [golden.module.id];
    }
    if (def == null && golden.module && golden.module.active && modules.includes(golden.module.id)) def = golden.module.id;
    modules.push(MODULE_NONE);
    defaultModule = def || MODULE_NONE;
  }
  return { skills, defaultSkill, modules, defaultModule };
}

/**
 * Semantic check + normalisation of a loadout against the game data (DESIGN §16). Strict: any unknown / hidden / elite
 * chess id, illegal skill index or module rejects the whole loadout. Entries equal to the defaults are dropped, the
 * rest are stored complete: `{ skill, module }` (module null for a chess without an elite record).
 * @param {any} entries `room.loadout.entries`
 * @param {(id: string) => any} getChess chess record lookup (normal and golden ids)
 * @returns {{ ok: true, loadout: Record<string, { skill: number, module: string|null }> } | { error: 'BAD_MSG'|'BAD_TARGET', detail: string }}
 */
export function checkLoadout(entries, getChess) {
  if (!isLoadoutEntries(entries)) return { error: 'BAD_MSG', detail: 'bad loadout entries' };
  const out = {};
  for (const id of Object.keys(entries)) {
    const e = entries[id];
    const base = typeof getChess === 'function' ? getChess(id) : null;
    if (!base || base.isGolden || base.visible === false || base.isHidden || base.isDiy || (base.baseId && base.baseId !== id)) {
      return { error: 'BAD_TARGET', detail: `unknown chess ${id}` };
    }
    const golden = base.goldenId ? getChess(base.goldenId) || null : null;
    const opt = loadoutOptions(base, golden);
    const skill = e.skill ?? opt.defaultSkill;
    if (!opt.skills.includes(skill)) return { error: 'BAD_TARGET', detail: `skill ${e.skill} not available for ${id}` };
    if (e.module !== undefined && !golden) return { error: 'BAD_TARGET', detail: `${id} has no elite module` };
    const module = golden ? (e.module ?? opt.defaultModule) : null;
    if (golden && !opt.modules.includes(module)) return { error: 'BAD_TARGET', detail: `module ${e.module} not available for ${id}` };
    if (skill === opt.defaultSkill && module === opt.defaultModule) continue;
    out[id] = { skill, module };
  }
  return { ok: true, loadout: out };
}

/**
 * The skill index / module a board chess fights with under a (checked) loadout (DESIGN §16 PlayerBattleInput units):
 * normal chess → `{ skillIndex, moduleId: null }` (normal chess have no module); elite → `moduleId` = uniEquipId or
 * 'none'. Chess the loadout does not mention use their defaults.
 * @param {Record<string, { skill: number, module: string|null }> | null | undefined} loadout
 * @param {any} chess the piece's chess record (normal or golden)
 * @param {(id: string) => any} getChess
 * @returns {{ skillIndex: number|null, moduleId: string|null }}
 */
export function resolveLoadout(loadout, chess, getChess) {
  if (!chess || typeof chess !== 'object') return { skillIndex: null, moduleId: null };
  const baseId = chess.baseId || chess.chessId;
  const base = chess.isGolden ? (getChess(baseId) || chess) : chess;
  const golden = chess.isGolden ? chess : null;
  const opt = loadoutOptions(base, chess.isGolden ? chess : (base.goldenId ? getChess(base.goldenId) || null : null));
  const e = loadout && Object.hasOwn(loadout, baseId) ? loadout[baseId] : null;
  const skillIndex = e && opt.skills.includes(e.skill) ? e.skill : opt.defaultSkill;
  let moduleId = null;
  if (golden) moduleId = e && opt.modules.includes(e.module) ? e.module : opt.defaultModule;
  return { skillIndex, moduleId };
}

/** One `room.loadout.ops` entry: `{ potential?: 1–6, cultivate?: 0–3 }`, at least one of them. */
const isOpsEntry = (e) => isPlain(e) && Object.keys(e).length > 0 && Object.keys(e).every((k) => k === 'potential' || k === 'cultivate')
  && optional(isPotential)(e.potential) && optional(isCultivate)(e.cultivate);
/** Structural check of `room.loadout.ops` (0.2.2): a map of ≤ 256 charIds → `{ potential?, cultivate? }`. */
export const isLoadoutOps = (v) => isMap(v, LOADOUT_LIMITS.ops, isId, isOpsEntry);

/**
 * The operators a player sets a potential / 练度 for (0.2.2): the charIds of the 干员调配 roster — the visible normal chess
 * (checkLoadout's targets; a hidden chess shares its visible twin's charId: 锡人, 耶拉 …) — and the owned 6★ 自选 picks
 * (data/backups.json `diy.ownedPool`). A PRESET (特许) operator the player does not own is set by hand (潜能 1, 未精英化:
 * the official 「未持有的特许按1潜」 and +0 %); a 补位 stand-in or a prototype pick takes neither.
 * @param {Record<string, any>|null|undefined} chess data/chess.json
 * @param {any} [backups] data/backups.json
 * @returns {Set<string>}
 */
export function cultivationCharIds(chess, backups = null) {
  const out = new Set();
  for (const c of Object.values(chess && typeof chess === 'object' ? chess : {})) {
    if (c && !c.isGolden && !c.isDiy && c.visible !== false && !c.isHidden && (!c.baseId || c.baseId === c.chessId) && isId(c.charId)) out.add(c.charId);
  }
  for (const id of Array.isArray(backups?.diy?.ownedPool) ? backups.diy.ownedPool : []) if (isId(id)) out.add(id);
  return out;
}

/**
 * Semantic check + normalisation of `room.loadout.ops` (0.2.2) — strict like checkLoadout: an operator `isOperator` does
 * not know (cultivationCharIds) rejects the whole message. Entries equal to the defaults (潜能 6, 练度 3) are dropped, the
 * rest stored complete `{ potential, cultivate }`. `undefined` / `null` = no settings (`{}`).
 * @param {any} ops
 * @param {(charId: string) => boolean} isOperator
 * @returns {{ ok: true, ops: Record<string, { potential: number, cultivate: number }> } | { error: 'BAD_MSG'|'BAD_TARGET', detail: string }}
 */
export function checkLoadoutOps(ops, isOperator) {
  if (ops == null) return { ok: true, ops: {} };
  if (!isLoadoutOps(ops)) return { error: 'BAD_MSG', detail: 'bad operator settings' };
  const out = {};
  for (const id of Object.keys(ops)) {
    if (typeof isOperator !== 'function' || !isOperator(id)) return { error: 'BAD_TARGET', detail: `unknown operator ${id}` };
    const potential = ops[id].potential ?? POTENTIAL_DEFAULT;
    const cultivate = ops[id].cultivate ?? CULTIVATE_DEFAULT;
    if (potential === POTENTIAL_DEFAULT && cultivate === CULTIVATE_DEFAULT) continue;
    out[id] = { potential, cultivate };
  }
  return { ok: true, ops: out };
}

// ---- operator ownership (干员持有, 0.2.0 补位): room.ownership { notOwned } -------------------------------------------

/**
 * `room.ownership { notOwned }`: the base chess ids the player marked as not owned on the 干员持有 screen (the
 * per-browser setting next to 干员调配; default: every operator owned ⇒ []). Such a chess keeps its identity (name,
 * bonds, 特质, tier, price, merge) and fights as its official stand-in (shared/standIn.js standInRecord). Structural
 * limit below; the semantic check (`checkNotOwned`) is LENIENT, unlike checkLoadout: an id that is not a droppable chess
 * (unknown, elite, PRESET / 自选, a stale id of another build) is dropped, never the whole list.
 */
export const OWNERSHIP_LIMITS = Object.freeze({ notOwned: 160 });
/** Structural check of `room.ownership.notOwned`: an array of ≤ 160 ids. */
export const isNotOwnedList = (v) => isList(v, OWNERSHIP_LIMITS.notOwned, isId);

/**
 * Semantic check + normalisation of a not-owned list against the game data: keeps the ids of droppable chess
 * (shared/standIn.js isDroppableChess — NORMAL base chess with a stand-in), deduplicated and sorted; drops the rest.
 * Used by the server (lobby, match) and by the client before it sends or imports a list.
 * @param {any} list `room.ownership.notOwned`
 * @param {(id: string) => any} getChess chess record lookup
 * @returns {{ ok: true, notOwned: string[], dropped: number } | { error: 'BAD_MSG', detail: string }}
 */
export function checkNotOwned(list, getChess) {
  if (!isNotOwnedList(list)) return { error: 'BAD_MSG', detail: 'bad notOwned list' };
  const keep = new Set();
  for (const id of list) {
    const c = typeof getChess === 'function' ? getChess(id) : null;
    if (c && c.chessId === id && isDroppableChess(c)) keep.add(id);
  }
  const notOwned = [...keep].sort();
  return { ok: true, notOwned, dropped: list.length - notOwned.length };
}

// ---- 自选编队 (0.2.0 DIY): room.diy { picks } ------------------------------------------------------------------------

/**
 * `room.diy { picks }`: the player's 自选编队 — `{ [slotBaseId]: { charId, skillIndex?, uniEquipId? } | null }` for the
 * four DIY slots (data/backups.json `diy.slots`: two at tier 5, two at tier 6; shared/diy.js). An out-of-match setting
 * like 干员持有: stored per session / seat, a match takes the picks its seat had at its start. Structural limit below
 * (room for more slots in a later season); the semantic check (`checkDiyPicks`) is LENIENT, like checkNotOwned: an
 * illegal pick — not a pick of the slot's tier, an operator without a kit, a prototype off its locked skill, an unknown
 * skill / module, the same operator twice in a tier, an owned operator in a second slot, an unknown slot — is dropped,
 * never the whole roster; only malformed input is BAD_MSG.
 */
export const DIY_LIMITS = Object.freeze({ slots: 8 });
const isDiyPickWire = (p) => p === null || (isPlain(p) && isId(p.charId)
  && nullable((v) => isInt(v, 0, 9))(p.skillIndex) && nullable(isId)(p.uniEquipId));
/** Structural check of `room.diy.picks`: a map of ≤ 8 slot ids → a pick `{ charId, skillIndex?, uniEquipId? }` or null. */
export const isDiyPicks = (v) => isMap(v, DIY_LIMITS.slots, isId, isDiyPickWire);

/**
 * Semantic check + normalisation of a 自选 roster against the game data (`{ chess, backups }` or a sim DataSource) and
 * the kit registry (`kitted`: server/sim/content/kits/index.js KITTED_CHARS — an operator without a kit is never fielded):
 * the slots are taken in data order (tier 5, then tier 6), and each pick is kept when the roster so far plus it still
 * passes shared/diy.js validateDiyPicks — so the result always passes it, and of two picks that clash (one owned operator
 * in two slots, one operator twice in a tier) the first slot keeps it. Kept picks are complete
 * (`{ charId, skillIndex, uniEquipId }`: a prototype's locked selection, uniEquipId null = no module).
 * @param {any} picks `room.diy.picks`
 * @param {{ data: any, kitted?: Iterable<string>|((id: string) => boolean)|null }} opts
 * @returns {{ ok: true, picks: Record<string, { charId: string, skillIndex: number, uniEquipId: string|null }>, dropped: number }
 *   | { error: 'BAD_MSG', detail: string }}
 */
export function checkDiyPicks(picks, { data, kitted = null } = { data: null }) {
  if (!isDiyPicks(picks)) return { error: 'BAD_MSG', detail: 'bad 自选 picks' };
  const slots = diySlotIds(data);
  /** @type {Record<string, { charId: string, skillIndex: number, uniEquipId: string|null }>} */
  const kept = {};
  let dropped = 0;
  for (const id of Object.keys(picks)) if (picks[id] != null && !slots.includes(id)) dropped++;
  for (const slotId of slots) {
    const pick = Object.hasOwn(picks, slotId) ? picks[slotId] : null;
    if (pick == null) continue;
    const res = validateDiyPicks({ ...kept, [slotId]: pick }, { data, kitted });
    if ('ok' in res) kept[slotId] = res.picks[slotId];
    else dropped++;
  }
  return { ok: true, picks: kept, dropped };
}

// ---- unit stats (user playtest #4 item 7): m.unitStats units and the browser battle's live stats ---------------------

const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
/** Attack interval (s) of a stats object: its own `interval`, else bat × 100 / aspd (null without an attack time). */
const intervalOf = (x) => {
  if (Number.isFinite(x.interval) && x.interval > 0) return round2(x.interval);
  const bat = fin(x.bat, 0);
  const aspd = fin(x.aspd, 100) > 0 ? fin(x.aspd, 100) : 100;
  return bat > 0 ? round2((bat * 100) / aspd) : null;
};
const statView = (x) => ({
  maxHp: Math.round(fin(x.maxHp)), atk: Math.round(fin(x.atk)), def: Math.round(fin(x.def)), res: round1(fin(x.res)),
  interval: intervalOf(x), blockCnt: Math.max(0, Math.round(fin(x.blockCnt))), moveSpeed: round2(fin(x.moveSpeed)),
});

/**
 * The detail card's stats of a sim unit (server/sim/units.js Unit): its effective stats `s` (the aggregated `unit.s`,
 * or the last ones the sim computed) next to its own numbers — `unit.base` with its 练度 multiplier (`unit.cultMul`,
 * 0.2.2: part of the operator's own numbers, as on the record cards; no buffs) — max HP, ATK, DEF, RES, attack interval
 * (s), block, move speed — rounded for display (the sim keeps floats), plus the current HP. The shape of the
 * `m.unitStats` units (Match.unitStats: what the board's units start their next battle with) and of the browser
 * runner's live battle stats (public/js/battle/runner.js unitStats). An ally with a range also carries `range`: the grid
 * (`[dRow, dCol]`, facing RIGHT) it attacks with now — a running skill's range, rangeExtend included, not a kit's
 * target-selection grid (the sim's `unit.liveRangeGrid`, Battle._refreshRange; community report E1 after 0.1.0: 烛煌
 * S3's 4-11 never reached the card). `dir`: the unit's facing now (UP / RIGHT / DOWN / LEFT; UnitInfo.dir is the facing
 * at send time and the snapshot tuples carry none) — the detail card's range overlay rotates by it (GitHub PR #281).
 * @param {{ id?: number, uid?: number|null, defId?: string, hp?: number, alive?: boolean, base?: any, liveRangeGrid?: any, dir?: string } | null} u
 * @param {any} [s] aggregated stats (missing ⇒ the base)
 * @returns {{ id: number|null, uid: number|null, defId: string|null, hp: number, alive: boolean, maxHp: number, atk: number,
 *   def: number, res: number, interval: number|null, blockCnt: number, moveSpeed: number,
 *   base: { maxHp: number, atk: number, def: number, res: number, interval: number|null, blockCnt: number, moveSpeed: number },
 *   range?: Array<[number, number]>, dir?: string }}
 */
export function unitStatsEntry(u, s = null) {
  const own = u && u.base && typeof u.base === 'object' ? u.base : {};
  const base = u && u.cultMul ? cultivatedStats(own, u.cultMul) : own;
  const cur = s && typeof s === 'object' ? s : base;
  const range = u?.side !== 'enemy' && Array.isArray(u?.liveRangeGrid)
    ? u.liveRangeGrid.filter((p) => Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1])).map((p) => [p[0], p[1]])
    : null;
  return {
    id: Number.isInteger(u?.id) ? u.id : null,
    uid: Number.isInteger(u?.uid) ? u.uid : null,
    defId: typeof u?.defId === 'string' ? u.defId : null,
    hp: Math.max(0, Math.round(fin(u?.hp))),
    alive: u?.alive !== false,
    ...statView(cur),
    base: statView(base),
    ...(range ? { range } : {}),
    ...(isDir(u?.dir) ? { dir: u.dir } : {}),
    // the enemy card greys a SILENCE-format line (折射) from this; absent flags ⇒ not silenced
    silenced: !!(cur.flags && cur.flags.silence),
  };
}

/** Deploy directions (DESIGN §3, research 09 §1.2; the same list as server/sim/dir.js DIRS). */
export const DIRS = Object.freeze(['UP', 'RIGHT', 'DOWN', 'LEFT']);
const isDir = (v) => DIRS.includes(v);

const target = (v) => {
  if (!v || typeof v !== 'object') return false;
  if (v.area === 'board') return isInt(v.row, 0, GEO.ROWS - 1) && isInt(v.col, 0, GEO.COLS - 1);
  if (v.area === 'hand') return isInt(v.idx, 0, GEO.HAND_SIZE - 1);
  return false;
};

/** @type {Record<string, Record<string, (v:any)=>boolean> & { $optional?: string[] }>} */
export const C2S = {
  // session & lobby
  hello: { name: (v) => isStr(v, NAME_MAX_LEN) && v.trim().length > 0, token: (v) => v == null || isStr(v, 64), version: (v) => v == null || isInt(v, 0, 1e6),
    noReplace: isBool, claimAt: (v) => isNum(v, 0, Number.MAX_SAFE_INTEGER), $optional: ['token', 'version', 'noReplace', 'claimAt'] },
  ping: { c: (v) => typeof v === 'number' && Number.isFinite(v) },
  'room.create': { mode: (v) => v === 'solo' || v === 'coop', difficulty: (v) => DIFFICULTIES.includes(v) },
  'room.join': { code: (v) => isStr(v, ROOM_CODE_LEN + 2) && /^[A-Za-z0-9]+$/.test(v) },
  'room.leave': {},
  'room.ready': { ready: isBool },
  'room.setDifficulty': { difficulty: (v) => DIFFICULTIES.includes(v) },
  // the co-op room option 「AI 队友最后选择」 (GitHub #338; host, before the match): the strategy and 机变 drafts order every
  // human seat before every AI seat (server/match/match/phases.js humansFirst); room.state.aiPicksLast
  'room.setAiPicksLast': { on: isBool },
  'room.addBot': {},
  'room.removeBot': { seat: (v) => isInt(v, 0, MAX_SEATS - 1) },
  // the host removes another human before the match (server/lobby.js kick; community report #17); playerId = the one the
  // host confirmed — a seat that changed hands meanwhile is refused
  'room.kick': { seat: (v) => isInt(v, 0, MAX_SEATS - 1), playerId: isId },
  'room.start': {},
  'room.rerollSetup': { setupRevision: (v) => isInt(v, 0, 2 ** 31) },
  'room.cancelReroll': { voteId: (v) => isInt(v, 1, 2 ** 31) },
  // operator loadout (DESIGN §16): stored per session/seat; accepted until the match leaves INFO_CHECK — `ops` (0.2.2):
  // the per-operator 潜能 / 练度 (absent = none set: every operator at 潜能 6, 精英2 Lv.60)
  'room.loadout': { entries: isLoadoutEntries, ops: isLoadoutOps, $optional: ['ops'] },
  // operator ownership (干员持有, 0.2.0 补位): stored per session / seat; a match takes the list its seat had when it
  // started (an out-of-match setting — during a match it is stored for the next one: ROOM_STARTED)
  'room.ownership': { notOwned: isNotOwnedList },
  // 自选编队 (0.2.0 DIY): the player's DIY slot picks; stored per session / seat like room.ownership (a match takes the
  // picks its seat had when it started; during a match they are stored for the next one: ROOM_STARTED)
  'room.diy': { picks: isDiyPicks },
  // spectator seats (remake feature, community report #26; MAX_SPECTATORS): take one of a co-op room's spectator seats —
  // in its lobby or while its match runs — never a player seat; the host frees one by playerId (the spectator gets
  // room.closed { reason: 'kicked' }). room.leave / g.leave leave a spectator seat like a player seat.
  'room.spectate': { code: (v) => isStr(v, ROOM_CODE_LEN + 2) && /^[A-Za-z0-9]+$/.test(v) },
  'room.removeSpectator': { playerId: isId },

  // match
  'g.infoReady': { setupRevision: (v) => isInt(v, 0, 2 ** 31), $optional: ['setupRevision'] },
  'g.rerollVote': { voteId: (v) => isInt(v, 1, 2 ** 31), agree: isBool },
  'g.band': { bandId: isId },
  'g.bandSkip': {},
  // the strategy highlighted in the draft screen (user playtest #4 item 4): a turn that runs out takes it while it is
  // free (Match.timeoutBand); absent / null clears it
  'g.bandFocus': { bandId: nullable(isId), $optional: ['bandId'] },
  'g.buy': { slot: (v) => isInt(v, 0, 15) },
  'g.refresh': {},
  'g.freeze': {},
  'g.levelUp': {},
  'g.sell': { uid: isUid },
  // dir: the facing chosen on the deploy wheel for a board target (absent ⇒ RIGHT; the piece's own tile ⇒ re-orient)
  'g.move': { uid: isUid, to: target, dir: isDir, $optional: ['dir'] },
  // replaceUid: with both of the target's slots used, the equipped item the replace dialog picked (research 09 §1.2
  // UseEquipUp.unloadInstId; absent ⇒ the oldest; not one of the target's items ⇒ BAD_TARGET)
  'g.equip': { itemUid: isUid, targetUid: isUid, replaceUid: nullable(isUid), $optional: ['replaceUid'] },
  'g.art': { itemUid: isUid, row: (v) => isInt(v, 0, GEO.ROWS - 1), col: (v) => isInt(v, 0, GEO.COLS - 1), dir: isDir, $optional: ['dir'] },
  'g.destroy': { uid: isUid },
  'g.reward': { idx: (v) => isInt(v, 0, 5) },
  'g.choice': { idx: (v) => isInt(v, 0, 5), choiceId: isId, $optional: ['choiceId'] },
  'g.ready': { ready: isBool },
  'g.emote': { id: (v) => EMOTES.includes(v) },
  // playerId: the player tapped in the team panel (a 联防 / boss pair field shows two) — what an eliminated viewer or a
  // spectator seat follows from then on (Match.watchPref; community report of 2026-10-06, item 56)
  'g.watch': { fieldId: (v) => isStr(v, 32), playerId: isId, $optional: ['playerId'] },
  'g.autoplay': { on: isBool },
  // solo pause (official PauseUp / ResumeUp, DESIGN §14): freezes the running battle (field clock, deadlines, the
  // browser's local runner) — solo matches only (co-op ⇒ WRONG_PHASE), only while a battle runs; m.public.paused
  'g.pause': { on: isBool },
  // the stats the own board's units start their next battle with (user playtest #4 item 7; prep phases): answered by
  // the push m.unitStats { seq, round, units: [unitStatsEntry] }; `seq` is echoed so the client keeps the newest answer
  'g.unitStats': { seq: (v) => isInt(v, 0, 2 ** 31), $optional: ['seq'] },
  'g.leave': {},

  // client-side combat (DESIGN §14): the authoritative client of a field reports its battle; a 联防 field adds
  // `left` = { [leakerId]: its enemies still standing (unspawned, alive, or through again) } (server/sim/spec.js
  // uniteLeft; user playtest #6 item 7 — the leakers' live counter). `resolved` = the HUD capsule's numerator: the
  // field's own scheduled enemies that were knocked out **or leaked** (official: 漏一个 1/3, 打死一个 2/3,
  // 打死会分裂的 3/3 — Battle.leakedInTotal; runtime splits / summons stay out of both parts of the capsule). A boss / hidden field adds
  // `leaksBy` = { [playerId]: the cumulative LP the enemies that reached that player's goal cost } — `leaks` minus its
  // sum is the leader's own "扣除目标生命" effects; the server holds the b.result's leaked lists to it (Match._bossLeaksAgree)
  'b.progress': {
    battleId: isId, gt: (v) => isNum(v, 0, 1e5), killed: (v) => isInt(v, 0, 1e5), total: (v) => isInt(v, 0, 1e5),
    resolved: (v) => isInt(v, 0, 1e5),
    leaks: (v) => isNum(v, 0, 1e6), bossDmg: (v) => isNum(v, 0, BIG),
    by: (v) => isMap(v, RESULT_LIMITS.players, isId, (x) => isNum(x, 0, BIG)), done: isBool,
    left: (v) => isMap(v, RESULT_LIMITS.players, isId, (x) => isInt(x, 0, 1e5)),
    leaksBy: (v) => isMap(v, RESULT_LIMITS.players, isId, (x) => isNum(x, 0, 1e6)),
    $optional: ['resolved', 'leaks', 'bossDmg', 'by', 'done', 'left', 'leaksBy'],
  },
  'b.result': { battleId: isId, result: isBattleResult },
};

// Server → client message types (documentation + client dispatch table keys).
export const S2C = [
  'welcome', 'ok', 'error', 'pong',
  'room.state', 'room.closed',
  'm.public', 'm.private', 'm.field', 'm.toast', 'm.ticker', 'm.emote', 'm.result',
  // m.unitStats { seq, round, units: [unitStatsEntry] } — the answer to g.unitStats (the requester only)
  'm.unitStats',
  // client-side combat (DESIGN §14): b.start { battleId, fieldId, kind, spec, authoritative, startAt, serverNow, elapsed,
  // speed, watch? } · b.pool { hp, max, teamLp, acked: { [fieldId]: cumulative boss damage counted } } ·
  // b.end { battleId, fieldId, reason }
  'b.start', 'b.pool', 'b.end',
  // server-run combat streaming (legacy / SP_COMBAT=server only)
  'b.snap', 'b.ev',
];

/**
 * Validate a decoded client message. Returns `null` when valid, otherwise a short reason string.
 * Extra unknown fields are ignored (not copied by handlers).
 */
export function validateC2S(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return 'not an object';
  const spec = typeof msg.t === 'string' && Object.hasOwn(C2S, msg.t) ? C2S[msg.t] : null;
  if (!spec) return `unknown type ${String(msg.t).slice(0, 32)}`;
  if (msg.rid != null && !isInt(msg.rid, 0, 2 ** 31)) return 'bad rid';
  const optional = spec.$optional || [];
  for (const [k, check] of Object.entries(spec)) {
    if (k === '$optional') continue;
    const v = msg[k];
    if (v === undefined && optional.includes(k)) continue;
    if (!check(v)) return `bad field ${k}`;
  }
  return null;
}

// Event tuple kinds inside `b.ev` (DESIGN §8.2).
export const EV = Object.freeze({
  SPAWN: 'spawn', ATK: 'atk', DMG: 'dmg', HEAL: 'heal', SKILL: 'skill', ENGAGE: 'engage', DIE: 'die', LEAK: 'leak',
  STATUS: 'status', FX: 'fx', LAYER: 'layer', BOUNTY: 'bounty', DEPLOY: 'deploy',
});

/**
 * The model form a `b.ev` 'fx' tuple ['fx', kind, x, y, extra] puts its unit in: `extra.form` (sim content/enemies/helpers.js
 * setForm — 转译基底·α's forms, a 逐火 余烬 and its revival, a leader's 重生, 守墓石像's modes, 掠海漂移体's crawl; a 傀儡师's 替身,
 * sim professions.js; a string is that clip set, null the base one), undefined for any other tuple. A form is state, not decoration: a view that misses
 * the fx keeps drawing the old model (player report #5 after 0.1.0), so the client's catch-up frames, its hidden-tab
 * backlog (battle/runner.js) and the events buffered before a field is entered (screens/game.js) keep these tuples.
 */
export function fxForm(ev) {
  if (!Array.isArray(ev) || ev[0] !== EV.FX) return undefined;
  const x = ev[4];
  if (!x || typeof x !== 'object' || x.id == null || !Object.hasOwn(x, 'form')) return undefined;
  return typeof x.form === 'string' ? x.form : null;
}
