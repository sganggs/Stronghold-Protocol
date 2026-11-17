// Local match statistics: every match the local player took part in is appended as one record to localStorage
// (`sp.pref.stats`). Per-browser only — the server keeps matches in memory and has no identity, so there is nowhere
// else for cross-match numbers to live; nothing here is ever sent anywhere. The stats page labels itself 本机数据 and
// offers JSON export / import for moving between devices. (Ported from PR #323 by @2321Robin, reworked for 0.2.2.)
//
// Two kinds of record (`end`):
//   'settled'  the match reached its settlement: m.result arrived (server/match/results.js buildResult). The record
//              keeps what the settlement offers — the match frame (difficulty, mode, boss, seed, duration, hidden-core
//              outcome, reason) and one row per player (band, title, lineup, bonds, the stat block) — so the page can
//              re-view the settlement screen (recordToResult).
//   'quit'     the player gave up (放弃模拟) before the settlement; the server sends a leaver nothing, so the record is
//              built from what the client knew at that moment (buildQuitRecord): the frame, the player's own row, the
//              rounds cleared. It is listed in the history, marked 中途退出, and cannot be re-viewed.
//
// What counts (countsTowardStats, the owner's decision of 2026-10-08: a match entered and left right away must not
// count): every aggregate — games, wins, win rate, hidden core, best round, time played, the strategy table, titles
// and the combat totals — is taken over the records that count. A settled record always counts. A quit record counts
// once at least one of the player's own battles had finished — a round cleared (the server's rule: leaving while
// round k runs has passed k − 1 rounds, leaving in its settlement k) or already eliminated. A match left earlier is
// history only.
//
// Bounded storage: at most MAX_RECORDS matches and MAX_CHARS characters of JSON. The newest FULL_KEEP records and
// the highest settlement bond-layer record
// keep their full rows (lineups, bonds, teammates' names — what the settlement replay needs); older ones are compacted
// to the player's own summary row, which is all the aggregates read. The oldest records go first when a budget is hit,
// and a write the browser refuses shrinks the list further instead of failing. Teammates' display names are part of
// the newest records and of an export file: they stay on this device unless the player exports them.
//
// The art (DESIGN §32 P1a): every record names the room's visual set `vs` — the cosmetic plugins its host switched on
// (room.state.content.vs; null without any). The overview does not filter on it: a match with only cosmetic plugins
// counts as the original game (the owner's decision of 2026-10-13: its gameplay and numbers are unchanged). A player's
// personal plugins never matter and are not recorded.
// Gameplay plugins (DESIGN §32.6, P1c): every record names the room's content set when it played one — `content`
// `{ cs, plugins: ['<id>@<version>' …] }` (room.state.content with `vanilla: false`), null for the original game
// (cosmetic plugins only included; a record from before 0.3.0: null — format v2, MIGRATIONS[1]). Such a match is
// unofficial: the aggregates leave it out unless asked to take it in (aggregateStats `modded` — the overview's
// 「含插件对局」 switch); the history lists it with its mark.
// Official versions (DESIGN §35.23, M1): every record of another version names it — `version` (a registry id, only when
// it is not 第二期下半; format v3, MIGRATIONS[2]: a record without one played 第二期下半) — and its id does not include
// it (a record's id stays what it was). 统计数据 filters by version (recordsOfVersion: the version shown by default,
// 全部版本 on request) and the levels count the records of one season (recordsOfSeason: 第一期 / 第二期 each have their own
// 卫戍认证 table).
// Test matches (DESIGN §34.8) never create local records, including quits. Server awards are
// zero; a live marker latches until the next match. Legacy marked imports are dropped on load
// and merge, and pure aggregates/badge helpers exclude them even if handed a raw record.
//
// Format evolution: the envelope carries a version (`STATS_VERSION`); `migrateStats` walks records through a chain of
// per-version steps and every loaded / imported record passes `normalizeRecord`, a strict schema: missing fields get
// defaults, unknown fields and oversized values are dropped, a row it cannot salvage is dropped. An envelope from a
// NEWER version than this build is refused (never downgraded and written back); an unreadable one is set aside
// (`sp.pref.stats.damaged`) and the history starts again.
//
// Pure logic, no Preact / DOM: Node-testable (test/ui/stats.test.js); localStorage is touched only by loadStats /
// saveStats / their helpers.

import { PHASE } from '../../../shared/constants.js';
import { sanitizeName } from './playerName.js';
import { DEFAULT_VERSION, versionById } from '../../../shared/versions.js';

/** Current record-envelope version (bump + add a MIGRATIONS step when the record shape changes). */
export const STATS_VERSION = 3;
/** localStorage key under the app's `sp.pref.` prefix (store.js loadPref). */
export const STATS_PREF_KEY = 'stats';
/** Oldest records are dropped beyond this many matches. */
export const MAX_RECORDS = 1000;
/** The newest records that keep their full rows (lineups, bonds, teammates) — what the settlement replay reads. */
export const FULL_KEEP = 30;
/** Budget of the stored JSON in characters (a character costs up to 2 bytes of the browser's ~5 MB quota): the oldest records go first. */
export const MAX_CHARS = 800_000;
/** Largest export file the page reads. */
export const IMPORT_MAX_CHARS = 8_000_000;

const FULL_KEY = `sp.pref.${STATS_PREF_KEY}`;
const DAMAGED_KEY = `${FULL_KEY}.damaged`;

/** @returns {{ v: number, records: Array }} a fresh empty envelope */
export const emptyStats = () => ({ v: STATS_VERSION, records: [] });

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** A visual hash (64 lowercase hex digits: shared/plugins/visual.js), else null. */
const vsOf = (v) => (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) ? v : null);
/**
 * The content set a record names (see the header): `{ cs, plugins: ['<id>@<version>' …] }` of a room with gameplay
 * plugins — room.state.content with `vanilla: false`, or a record's own — else null (the original game).
 * @param {any} c
 */
export function contentOf(c) {
  if (!isObj(c) || c.vanilla === true || !vsOf(c.cs)) return null;
  const list = (Array.isArray(c.plugins) ? c.plugins : [])
    .map((p) => (typeof p === 'string' ? p : isObj(p) && typeof p.id === 'string' ? `${p.id}@${typeof p.version === 'string' ? p.version : '?'}` : null))
    .filter((x) => typeof x === 'string' && x.length <= 80).slice(0, 32);
  return { cs: c.cs, plugins: list };
}
/** Did the record's match play gameplay plugins (unofficial)? @param {any} rec */
export const isModdedRecord = (rec) => !!(isObj(rec) && rec.content);

/** A record's official version field (see the header): a registry id other than 第二期下半, else null. @param {unknown} v */
export const versionOf = (v) => (typeof v === 'string' && v !== DEFAULT_VERSION && versionById(v) ? v : null);

/** The official version a record played (第二期下半 without `version`). @param {any} rec */
export const recordVersion = (rec) => versionOf(rec?.version) ?? DEFAULT_VERSION;

/**
 * The records of one official version (see the header): `version` a registry id, or 'all' / null — every record.
 * @param {any[]} records @param {string|null} version
 */
export function recordsOfVersion(records, version) {
  const list = Array.isArray(records) ? records : [];
  return !version || version === 'all' ? list : list.filter((r) => recordVersion(r) === version);
}

/**
 * The records of one season (see the header: 第一期 / 第二期 — the activity a version belongs to), every record when
 * `season` is null.
 * @param {any[]} records @param {string|null} season
 */
export function recordsOfSeason(records, season) {
  const list = Array.isArray(records) ? records : [];
  return season ? list.filter((r) => (versionById(recordVersion(r))?.season ?? DEFAULT_VERSION) === season) : list;
}
/**
 * The records the achievement blocks read — 卫戍成就's peak alliance (highestBondRecord) and 策略记录's special marks
 * (strategyBadgeIds), on 统计数据 and in the lobby's 成就统计 window: a match with gameplay plugins is unofficial and stays
 * out (#643 checklist §二.6 「不计插件对局」, DESIGN §32.6) unless `withModded` (统计数据's 「含插件对局」) takes it in.
 * A filter for the callers, not inside the two helpers: the storage budget (fitToBudget) keeps the peak of every record.
 * @param {any[]} records
 * @param {boolean} [withModded]
 */
export function achievementRecords(records, withModded = false) {
  const all = Array.isArray(records) ? records : [];
  return withModded ? all : all.filter((r) => !isModdedRecord(r));
}
const int = (v, d) => (Number.isFinite(v) ? Math.round(v) : d);
const num = (v) => (Number.isFinite(v) ? v : null);
const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);
/** A non-empty string, cut to `max` characters. */
const str = (v, max = 64) => (typeof v === 'string' && v.length ? v.slice(0, max) : null);

// per-record bounds (an imported file is foreign data: nothing a row holds may grow without limit)
const MAX_PLAYERS = 6; // the game seats 4
const MAX_LINEUP = 12;
const MAX_ITEMS = 4;
const MAX_BONDS = 24;
const MAX_STAT_KEYS = 24;
const MAX_NAME = 24;

/**
 * Copy only the finite numeric keys of a stats block (the settlement's numbers; a numeric field this build does not
 * know is kept too, up to MAX_STAT_KEYS — display can lag, data should not).
 * @param {any} raw
 * @returns {Record<string, number>}
 */
function normalizeStatBlock(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (!Number.isFinite(v) || k.length > 32) continue;
    out[k] = v;
    if (++n >= MAX_STAT_KEYS) break;
  }
  return out;
}

/**
 * FNV-1a 32-bit, hex — a content hash needs no crypto, only stability across sessions.
 * @param {string} s
 * @returns {string}
 */
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The record's dedupe id, from match facts the server replays byte-identically on reconnect / reload
 * (server/lobby.js result replay): seed + duration + mode + rounds + outcome + who I was. Two distinct
 * matches colliding on all of these is not a real scenario; a replayed m.result hits the same id and is
 * dropped, which is the point (recording happens on every m.result arrival, replays included).
 * @param {any} res raw m.result payload
 * @param {string|null|undefined} myId the local player's id at that moment
 * @returns {string}
 */
export function recordId(res, myId) {
  const r = isObj(res) ? res : {};
  const parts = [r.seed ?? '-', r.durationMs ?? '-', r.modeId ?? '-', r.roundsPassed ?? '-', r.victory ? 1 : 0, myId ?? '-'];
  // A test result must not collide with a real match of the same seed. The suffix is absent otherwise, so a
  // normal id stays byte-identical.
  if (r.test === true) parts.push('test');
  return `r1.${fnv1a(parts.join('|'))}`;
}

/**
 * Normalize ONE player row: known fields defaulted and bounded, unknown fields dropped. `quit`: the record is a quit
 * record, whose row may not know its rounds (`roundsPassed: null`).
 * @param {any} raw
 * @param {boolean} [quit]
 * @returns {any}
 */
function normalizePlayerRow(raw, quit = false) {
  const p = isObj(raw) ? raw : {};
  // the page and the replay read the title record from the game data by id: the sent texts are not kept
  const title = isObj(p.title) && str(p.title.id) ? { id: str(p.title.id) } : null;
  const lineup = (Array.isArray(p.lineup) ? p.lineup : []).filter(isObj).slice(0, MAX_LINEUP).map((u) => {
    // ids only — the tile position (row/col) is replay detail, not a statistic; items kept (配发装备统计); a 自选
    // pick and a 补位 stand-in kept too, or the replayed card would draw the plain operator
    const e = {
      id: str(u.id) || '', golden: bool(u.golden), tier: int(u.tier, 0),
      items: (Array.isArray(u.items) ? u.items : []).filter((i) => typeof i === 'string' && i.length).slice(0, MAX_ITEMS).map((i) => i.slice(0, 64)),
    };
    if (u.kind === 'token') e.kind = 'token';
    if (isObj(u.diy) && str(u.diy.charId)) {
      e.diy = { charId: str(u.diy.charId), skillIndex: Number.isInteger(u.diy.skillIndex) ? u.diy.skillIndex : 0, uniEquipId: str(u.diy.uniEquipId) };
    }
    if (str(u.standInFor)) e.standInFor = str(u.standInFor);
    return e;
  }).filter((u) => u.id);
  const bonds = (Array.isArray(p.bonds) ? p.bonds : []).filter(isObj).slice(0, MAX_BONDS).map((b) => ({
    bondId: str(b.bondId) || str(b.id) || '', layers: int(b.layers, 0), active: bool(b.active),
  })).filter((b) => b.bondId);
  return {
    playerId: str(p.playerId) || '',
    seat: int(p.seat, 0),
    name: str(p.name, MAX_NAME) || '',
    isBot: bool(p.isBot),
    ...(Number.isInteger(p.aiTakeoverRound) && p.aiTakeoverRound >= 1 ? { aiTakeoverRound: p.aiTakeoverRound } : {}),
    left: bool(p.left),
    alive: bool(p.alive, true),
    victory: bool(p.victory), // server semantics: team won AND this player was still in at the end
    roundsPassed: quit ? num(p.roundsPassed) : int(p.roundsPassed, 0),
    ...(Number.isInteger(p.creditedKills) && p.creditedKills >= 0 && p.creditedKills <= 1e9 ? { creditedKills: p.creditedKills } : {}),
    eliminatedRound: num(p.eliminatedRound),
    lp: num(p.lp),
    bandId: str(p.bandId),
    title,
    trophies: int(p.trophies, 0),
    reward: int(p.reward, 0),
    lineup,
    bonds,
    ...(Array.isArray(p.usedBondIds) ? { usedBondIds: usedBondIdsOf(p) } : {}),
    stats: normalizeStatBlock(p.stats),
  };
}

/**
 * Normalize ONE match record to the current shape (a strict schema: missing fields get defaults, unknown ones are
 * dropped, every string / list is bounded). A record without an `end` is a settled one — the PR #323 build, which
 * never recorded anything else, wrote none.
 * @param {any} raw
 * @returns {any|null} null when the row is not salvageable (no usable player row at all)
 */
export function normalizeRecord(raw) {
  const r = isObj(raw) ? raw : {};
  // a record IS a played match — no usable players array, no record
  if (!Array.isArray(r.players)) return null;
  const quit = r.end === 'quit';
  const players = r.players.filter(isObj).slice(0, MAX_PLAYERS).map((p) => normalizePlayerRow(p, quit));
  if (!players.length) return null;
  const rec = {
    id: str(r.id),
    v: STATS_VERSION,
    t: int(r.t, 0),
    end: quit ? 'quit' : 'settled',
    victory: bool(r.victory),
    roundsPassed: quit ? num(r.roundsPassed) : int(r.roundsPassed, 0),
    lastRound: num(r.lastRound),
    hiddenReached: bool(r.hiddenReached),
    hiddenCleared: bool(r.hiddenCleared),
    reason: str(r.reason, 32),
    modeId: str(r.modeId),
    difficulty: str(r.difficulty, 24),
    stageId: str(r.stageId),
    bossId: str(r.bossId),
    hiddenBossId: str(r.hiddenBossId),
    seed: num(r.seed),
    durationMs: num(r.durationMs),
    teamLp: num(r.teamLp),
    roomMode: r.roomMode === 'solo' || r.roomMode === 'coop' ? r.roomMode : null,
    selfId: str(r.selfId),
    // the room's cosmetic plugins (see the header): its visual set, null without any (or a record from before 0.3.0)
    vs: vsOf(r.vs),
    // the room's gameplay plugins (see the header): its content set, null for the original game
    content: contentOf(r.content),
    // the official version it played (see the header): a registry id other than 第二期下半, else left out
    ...(versionOf(r.version) ? { version: versionOf(r.version) } : {}),
    players,
  };
  // Only the literal true. A hand-edited string cannot mark a real match as a test, and a missing key leaves
  // the content id of a normal record unchanged.
  if (r.test === true) rec.test = true;
  if (rec.test === true && Number.isInteger(r.testActions) && r.testActions >= 0 && r.testActions <= 1e6) rec.testActions = r.testActions;
  if (r.compact === true) rec.compact = true;
  // an id-less (hand-made) record gets a content id, so both copies of it land on the same key (`vs` and `content` left
  // out: the id of a record from before 0.3.0 stays the same)
  if (!rec.id) rec.id = `c.${fnv1a(JSON.stringify({ ...rec, vs: undefined, content: undefined, version: undefined }))}`;
  return rec;
}

/**
 * The MIGRATIONS chain: `MIGRATIONS[v]` upgrades a v-envelope to v+1, for v = STATS_VERSION and down — every stored /
 * imported envelope walks the whole chain.
 *   1 → 2 (0.3.0, DESIGN §32.6): records name the room's content set (`content`); a record from before played the
 *         original game (null). The same step covers PR #509's fields (§32.14.16): a v1 row has no `creditedKills`
 *         (the actual player kills stay unknown rather than guessed) and a compacted v1 row lost its bonds
 *         (`usedBondIds` stays absent) — nothing to rewrite, the version keeps an older build from stripping them.
 * @type {Record<number, (stats: any) => any>}
 */
export const MIGRATIONS = {
  1: (stats) => ({ v: 2, records: (Array.isArray(stats.records) ? stats.records : []).map((r) => (isObj(r) ? { ...r, content: null } : r)) }),
  // 2 → 3 (0.3.2, DESIGN §35.23): records name another official version (`version`); one without played 第二期下半 —
  // nothing to rewrite, the version keeps an older build from stripping the field
  2: (stats) => ({ v: 3, records: Array.isArray(stats.records) ? stats.records : [] }),
};

/** Newest first (the stored order): by time, then id. */
const newestFirst = (a, b) => (b.t - a.t) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Bring any stored / imported envelope to the current version.
 * @param {any} raw
 * @returns {{ stats: { v: number, records: any[] }, changed: boolean, newer: boolean, dropped: number }}
 *   `newer` = the data was written by a NEWER build: returned untouched, callers must not save over it.
 *   `dropped` = rows that were not salvageable, repeated a record or went beyond MAX_RECORDS: gone from `stats`.
 */
export function migrateStats(raw) {
  if (!isObj(raw) || !Array.isArray(raw.records)) return { stats: emptyStats(), changed: false, newer: false, dropped: 0 };
  if ((raw.v ?? 0) > STATS_VERSION) {
    return { stats: { v: raw.v, records: raw.records }, changed: false, newer: true, dropped: 0 };
  }
  let v = Number.isFinite(raw.v) ? raw.v : 0;
  let records = raw.records;
  let changed = v !== STATS_VERSION;
  while (v < STATS_VERSION) {
    const step = MIGRATIONS[v];
    if (typeof step === 'function') records = step({ v, records }).records;
    v++;
  }
  // a hand-edited / merged list can be oversized, unsorted or repeat a record: only the newest MAX_RECORDS survive, newest first
  const normalized = [];
  const seen = new Set(); // a record listed twice (hand-merged data) counts once: the first copy
  for (const r of records) {
    const rec = normalizeRecord(r);
    if (rec && rec.test !== true && !seen.has(rec.id)) { seen.add(rec.id); normalized.push(rec); }
  }
  normalized.sort(newestFirst);
  const kept = normalized.slice(0, MAX_RECORDS);
  const dropped = records.length - kept.length;
  // storage is rewritten (self-healed) when a row went, the order changed or an id-less row got its content id
  changed ||= dropped > 0 || kept.some((rec, i) => !isObj(records[i]) || rec.id !== records[i].id);
  return { stats: { v: STATS_VERSION, records: kept }, changed, newer: false, dropped };
}

/** Read the raw stored string (null when absent or unreadable). */
function readRaw() {
  try { return globalThis.localStorage?.getItem(FULL_KEY) ?? null; } catch { return null; }
}

/**
 * Read + migrate the persisted envelope; self-heals older shapes back to storage. An unreadable value (not JSON, or
 * not an envelope) is moved to `sp.pref.stats.damaged` — kept for a manual recovery — and the history starts again.
 * @returns {{ v: number, records: any[], newer: boolean, dropped: number, damaged: boolean }}
 */
export function loadStats() {
  const raw = readRaw();
  if (raw == null) return { ...emptyStats(), newer: false, dropped: 0, damaged: false };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { parsed = undefined; }
  if (!isObj(parsed) || !Array.isArray(parsed.records)) {
    // keep the bad value where a person can find it; if even that write fails the next save simply replaces it
    try { globalThis.localStorage?.setItem(DAMAGED_KEY, raw); globalThis.localStorage?.removeItem(FULL_KEY); } catch { /* keep it in place */ }
    return { ...emptyStats(), newer: false, dropped: 0, damaged: true };
  }
  const { stats, changed, newer, dropped } = migrateStats(parsed);
  if (!newer && changed) saveStats(stats);
  return { ...stats, newer, dropped, damaged: false };
}

/**
 * The stored records for a glance (the lobby's 成就统计 card): read and migrated in memory only — nothing is written back
 * and an unreadable or newer value reads as no records, so the 统计数据 page still finds it and says so.
 * @returns {any[]}
 */
export function peekStatsRecords() {
  const raw = readRaw();
  if (raw == null) return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!isObj(parsed) || !Array.isArray(parsed.records)) return [];
  const { stats, newer } = migrateStats(parsed);
  return newer ? [] : stats.records;
}

// ---- compaction + the storage budget ---------------------------------------------------------------------------

const COMPACT_FRAME = ['id', 'v', 't', 'end', 'victory', 'roundsPassed', 'lastRound', 'hiddenReached', 'hiddenCleared', 'reason', 'modeId',
  'difficulty', 'roomMode', 'durationMs', 'selfId', 'vs', 'content', 'version', 'test', 'testActions'];

/**
 * The compact form of a record: the frame and the player's OWN row without lineup, bonds and name — everything the
 * aggregates and the history list read, nothing a replay needs. Teammates are gone. Idempotent.
 * @param {any} rec a normalized record
 * @returns {any}
 */
export function compactRecord(rec) {
  const self = selfRowOf(rec);
  const usedBondIds = usedBondIdsOf(self);
  const out = {};
  for (const k of COMPACT_FRAME) if (rec[k] != null) out[k] = rec[k];
  out.compact = true;
  out.players = self ? [{
    playerId: self.playerId, seat: self.seat, alive: self.alive, victory: self.victory, roundsPassed: self.roundsPassed,
    eliminatedRound: self.eliminatedRound, bandId: self.bandId, title: self.title, left: self.left, stats: self.stats,
    ...(Number.isInteger(self.aiTakeoverRound) ? { aiTakeoverRound: self.aiTakeoverRound } : {}),
    trophies: self.trophies,
    reward: self.reward,
    ...(usedBondIds.length ? { usedBondIds } : {}),
    ...(self.creditedKills != null ? { creditedKills: self.creditedKills } : {}),
  }] : [];
  return out;
}

/**
 * What goes to storage: the newest FULL_KEEP and highest bond-layer record as they are, other older ones compacted, then dropped until
 * the JSON fits `maxChars` (the newest record is always kept).
 * @param {any[]} records newest first
 * @param {number} [maxChars]
 * @returns {any[]}
 */
export function fitToBudget(records, maxChars = MAX_CHARS) {
  const kept = [];
  let used = 40; // the envelope itself
  const peakId = highestBondRecord(records.slice(0, MAX_RECORDS))?.record.id;
  records.slice(0, MAX_RECORDS).forEach((r, i) => {
    const rec = i < FULL_KEEP || r.id === peakId ? r : compactRecord(r);
    const n = JSON.stringify(rec).length + 1;
    if (kept.length && used + n > maxChars) return;
    used += n;
    kept.push(rec);
  });
  return kept;
}

/** [ASSUMED] Official peak layers are approximated by the self player's active bonds at settlement. */
export function highestBondRecord(records) {
  let best = null;
  for (const record of records) {
    if (record.end === 'quit' || record.compact || record.test === true) continue;
    const player = selfRowOf(record);
    if (Number.isInteger(player?.aiTakeoverRound)) continue;
    for (const bond of player?.bonds || []) {
      if (!bond.active || !Number.isFinite(bond.layers) || bond.layers <= 0) continue;
      if (!best || bond.layers > best.bond.layers) best = { record, player, bond };
    }
  }
  return best;
}

/**
 * Persist the envelope. Never overwrites an envelope of a newer build. Compacts and trims to the budget first; a write
 * the browser refuses (quota — other keys share it) is retried with half the history, down to a handful of records.
 * @param {{ v: number, records: any[], newer?: boolean }} stats
 * @returns {boolean} whether a write stuck
 */
export function saveStats(stats) {
  if (stats.newer) return false;
  let recs = fitToBudget(stats.records.filter(r => r.test !== true));
  for (;;) {
    try {
      const ls = globalThis.localStorage;
      if (!ls) return false; // no storage at all (disabled by the browser)
      ls.setItem(FULL_KEY, JSON.stringify({ v: STATS_VERSION, records: recs }));
      return true;
    } catch { /* quota or storage disabled — fall through to shrinking */ }
    if (recs.length <= 8) return false; // a small history that still does not fit is foreign quota pressure
    recs = recs.slice(0, Math.max(8, Math.ceil(recs.length / 2)));
  }
}

/**
 * Derive the room shape ('solo' | 'coop') the way constants.js modeIdFor builds modeIds.
 * @param {string|null|undefined} modeId
 * @param {string|null|undefined} roomMode room.state `mode` when known
 * @returns {'solo'|'coop'|null}
 */
export function roomModeOf(modeId, roomMode) {
  if (roomMode === 'solo' || roomMode === 'coop') return roomMode;
  if (typeof modeId !== 'string') return null;
  if (modeId.includes('_single_')) return 'solo';
  if (modeId.includes('_multi_')) return 'coop';
  return null;
}

/**
 * Build one settled record from a raw m.result payload (+ context). Null when there is nothing to store: payloads
 * without players (the error-path settlement) or matches the local player did not take part in (spectator
 * seats get every result pushed too — eliminated players, who ARE in players[], keep recording).
 * @param {any} res raw m.result payload
 * @param {{ myId?: string|null, roomMode?: string|null, vs?: string|null, content?: any, version?: string|null, now?: number }} ctx
 *   vs: the room's visual set (room.state.content.vs); content: room.state.content (its content set when it played
 *   gameplay plugins); version: the official version it played (null / 第二期下半: left out) — see the header
 * @returns {any|null}
 */
export function buildRecord(res, ctx = {}) {
  const r = isObj(res) ? res : {};
  if (r.test === true || !Array.isArray(r.players) || !r.players.length) return null;
  const myId = str(ctx.myId);
  const selfRow = r.players.find((p) => isObj(p) && p.playerId === myId);
  if (!selfRow) return null; // spectator / observer: not my match
  return normalizeRecord({
    v: STATS_VERSION,
    t: int(ctx.now, 0),
    id: recordId(r, myId),
    end: 'settled',
    victory: bool(r.victory),
    roundsPassed: int(r.roundsPassed, 0),
    lastRound: num(r.lastRound),
    hiddenReached: bool(r.hiddenReached),
    hiddenCleared: bool(r.hiddenCleared),
    reason: str(r.reason),
    modeId: str(r.modeId),
    difficulty: str(r.difficulty),
    stageId: str(r.stageId),
    bossId: str(r.bossId),
    hiddenBossId: str(r.hiddenBossId),
    seed: num(r.seed),
    durationMs: num(r.durationMs),
    teamLp: num(r.teamLp),
    roomMode: roomModeOf(str(r.modeId), ctx.roomMode),
    selfId: myId,
    vs: vsOf(ctx.vs),
    content: contentOf(ctx.content),
    version: ctx.version ?? null,
    players: r.players,
  });
}

// ---- the match left early ----------------------------------------------------------------------------------------

/**
 * What the page remembers of the match on screen, so that giving it up can still be recorded: when the page first saw
 * it, whether that was at the start (a duration is only kept then), and the last round the player was seen alive in
 * (the server tells the others at the settlement, a leaver nothing).
 * @returns {{ active: boolean, test: boolean, startedAt: number, sawStart: boolean, aliveRound: number|null }}
 */
export const createLiveMatch = () => ({ active: false, test: false, startedAt: 0, sawStart: false, aliveRound: null });

/** The module's own tracker (fed by installStatsRecorder, read by recordQuit). */
export const liveMatch = createLiveMatch();

/**
 * Feed the tracker one app state (cheap: called on every store change).
 * @param {ReturnType<typeof createLiveMatch>} live
 * @param {any} state the app store state
 * @param {number} [now]
 */
export function observeMatch(live, state, now = Date.now()) {
  const pub = state?.match?.public;
  const inMatch = !!pub && !!pub.phase && pub.phase !== PHASE.LOBBY && pub.phase !== PHASE.RESULT && !state.match.result;
  if (!inMatch) {
    live.active = false;
    if (!pub && state?.room?.test !== true) live.test = false;
    return live;
  }
  const round = Number(pub.round) || 0;
  if (!live.active) {
    live.active = true;
    live.startedAt = now;
    live.sawStart = round <= 1;
    live.aliveRound = null;
    live.test = false;
  }
  live.test ||= pub.test === true || state.room?.test === true;
  const me = Array.isArray(pub.players) ? pub.players.find((p) => isObj(p) && p.playerId === state.me?.playerId) : null;
  if (me && me.alive !== false) live.aliveRound = Math.max(live.aliveRound ?? 0, round);
  return live;
}

/** Start following the store (main.js). Returns the unsubscribe function. */
export function installStatsRecorder(store) {
  observeMatch(liveMatch, store.get());
  return store.subscribe((s) => observeMatch(liveMatch, s));
}

/**
 * The rounds a player who leaves in `phase` of `round` has cleared — the server's rule for a quit (platform.js _quit:
 * eliminated in round k ⇒ k − 1 passed; leaving in the settlement of round k counts k).
 * @param {string} phase @param {number} round
 */
export function clearedRounds(phase, round) {
  const r = Number.isFinite(round) ? round : 0;
  return Math.max(0, phase === PHASE.SETTLE ? r : r - 1);
}

/**
 * Build the quit record of a match the local player is leaving (放弃模拟), from the app state and the tracker. Null when
 * there is nothing of mine to record: no match on screen, its settlement already here (that one is recorded by
 * recordResult), a spectator seat, or a match the page never saw.
 * @param {any} state the app store state BEFORE the match is cleared
 * @param {{ live?: ReturnType<typeof createLiveMatch>, now?: number }} [ctx]
 * @returns {any|null}
 */
export function buildQuitRecord(state, ctx = {}) {
  const live = ctx.live ?? liveMatch;
  const now = int(ctx.now, Date.now());
  const pub = state?.match?.public;
  const myId = str(state?.me?.playerId);
  if (pub?.test === true || state.room?.test === true || live.test === true || !pub || !myId || state.match.result || !live.active) return null;
  const row = Array.isArray(pub.players) ? pub.players.find((p) => isObj(p) && p.playerId === myId) : null;
  if (!row) return null; // a spectator seat is no player of the match
  const alive = row.alive !== false;
  const round = Number(pub.round) || 0;
  // alive: the rounds cleared so far; already eliminated: the round it was seen alive in, less one (unknown when the
  // page never saw it alive — a reload after the elimination)
  const roundsPassed = alive ? clearedRounds(pub.phase, round) : (live.aliveRound != null ? Math.max(0, live.aliveRound - 1) : null);
  return normalizeRecord({
    v: STATS_VERSION,
    t: now,
    id: `q.${fnv1a([myId, live.startedAt, pub.modeId ?? '-', state.room?.code ?? '-', ...(pub.test === true ? ['test'] : [])].join('|'))}`,
    end: 'quit',
    victory: false,
    roundsPassed,
    lastRound: num(pub.lastRound),
    hiddenReached: pub.phase === PHASE.HIDDEN_CORE,
    hiddenCleared: false,
    reason: 'quit',
    modeId: str(pub.modeId),
    difficulty: str(pub.difficulty),
    stageId: str(pub.stageId),
    bossId: str(pub.bossId),
    hiddenBossId: str(pub.hiddenBossId),
    seed: null,
    durationMs: live.sawStart ? Math.max(0, now - live.startedAt) : null,
    teamLp: num(pub.teamLp),
    roomMode: roomModeOf(str(pub.modeId), state.room?.mode),
    selfId: myId,
    vs: vsOf(state.room?.content?.vs),
    content: contentOf(state.room?.content),
    // the room's version, else the frames' (m.public `version`; absent = 第二期下半, as versions.js matchFrameVersion)
    version: state.room ? state.room.version ?? null : str(pub.version) ?? null,
    players: [{
      playerId: myId, seat: row.seat, name: row.name, isBot: false, left: true, alive, victory: false, roundsPassed,
      ...(Number.isInteger(row.aiTakeoverRound) ? { aiTakeoverRound: row.aiTakeoverRound } : {}),
      eliminatedRound: alive ? null : live.aliveRound, lp: row.lp, bandId: row.bandId,
    }],
  });
}

/**
 * The m.result-shaped payload behind a settled record — the inverse of buildRecord. The stats page's history
 * rows hand this to the settlement view (screens/result.js reads it through normalizeResult): a finished match can be
 * RE-VIEWED because the record kept every field the payload had. Whatever a record never stored is simply absent and
 * normalizeResult defaults it, exactly like a tolerant live payload. A quit record (nothing was settled) and a
 * compacted one (its rows are gone) have no settlement to show.
 * @param {any} rec
 * @returns {any|null} null when the row is not a usable, full, settled record
 */
export function recordToResult(rec) {
  const r = normalizeRecord(rec);
  if (!r || r.end === 'quit' || r.compact) return null;
  const res = {
    victory: r.victory,
    roundsPassed: r.roundsPassed,
    hiddenReached: r.hiddenReached,
    hiddenCleared: r.hiddenCleared,
    reason: r.reason,
    modeId: r.modeId,
    difficulty: r.difficulty,
    bossId: r.bossId,
    hiddenBossId: r.hiddenBossId,
    seed: r.seed,
    durationMs: r.durationMs,
    teamLp: r.teamLp,
    players: r.players,
  };
  if (Number.isFinite(r.lastRound)) res.lastRound = r.lastRound;
  if (r.test === true) res.test = true;
  if (Number.isInteger(r.testActions)) res.testActions = r.testActions;
  return res;
}

/**
 * Append one record: replays (same content id) are dropped, newest first, capped at MAX_RECORDS.
 * @param {{ v: number, records: any[] }} stats
 * @param {any} record
 * @returns {{ stats: { v: number, records: any[] }, added: boolean }}
 */
export function appendRecord(stats, record) {
  if (!record || record.test === true || !record.id) return { stats, added: false };
  if (stats.records.some((r) => r.id === record.id)) return { stats, added: false };
  const records = [record, ...stats.records].slice(0, MAX_RECORDS);
  return { stats: { v: STATS_VERSION, records }, added: true };
}

/** load → append → save of one built record (never over an envelope of a newer build). @returns {any|null} the record when stored */
function storeRecord(rec) {
  if (!rec) return null;
  const stats = loadStats();
  if (stats.newer) return null;
  const { stats: next, added } = appendRecord(stats, rec);
  if (added && !saveStats(next)) console.warn('[stats] localStorage write failed (quota?), record not persisted');
  return added ? rec : null;
}

/**
 * Record a finished match end-to-end (load → append → save). Returns the built record, or null when
 * nothing was stored (no players / not my match / replay).
 * @param {any} res raw m.result payload
 * @param {{ myId?: string|null, roomMode?: string|null, vs?: string|null, now?: number }} [ctx]
 * @returns {any|null}
 */
export function recordResult(res, ctx = {}) {
  if (liveMatch.test === true) return null;
  return storeRecord(buildRecord(res, ctx));
}

/**
 * Record the match the player is giving up (放弃模拟), before the app clears its state. Returns the record, or null.
 * @param {any} state the app store state before the match is cleared
 * @param {{ live?: ReturnType<typeof createLiveMatch>, now?: number }} [ctx]
 * @returns {any|null}
 */
export function recordQuit(state, ctx = {}) {
  const live = ctx.live ?? liveMatch;
  const rec = storeRecord(buildQuitRecord(state, ctx));
  live.active = false; // one record per match
  return rec;
}

/**
 * Merge two envelopes (import into existing): union by record id, newest first, capped.
 * @param {{ records: any[] }} a current (wins ties)
 * @param {{ records: any[] }} b incoming
 * @returns {{ v: number, records: any[] }}
 */
export function mergeStats(a, b) {
  const byId = new Map();
  for (const r of [...(Array.isArray(b?.records) ? b.records : []), ...(Array.isArray(a?.records) ? a.records : [])]) {
    const rec = normalizeRecord(r);
    if (rec && rec.test !== true) byId.set(rec.id, rec);
  }
  const records = [...byId.values()].sort(newestFirst).slice(0, MAX_RECORDS);
  return { v: STATS_VERSION, records };
}

/**
 * Parse + migrate + merge an exported / pasted payload into the current data.
 * @param {any} raw parsed JSON of the imported file
 * @param {{ records: any[] }} current current envelope
 * @returns {{ stats: { v: number, records: any[] }, added: number, skipped: number, dropped: number, name: string }}
 *   added = records new to this device; skipped = duplicates of records it has; dropped = rows of the file that could
 *   not be read; name = newest usable imported self nickname (the caller only adopts it when its current name is empty)
 */
export function importStats(raw, current) {
  if (isObj(raw) && raw.kind != null && raw.kind !== 'local-stats') {
    const err = new Error('not a stats export'); // the page shows its own text
    err.code = 'stats-bad-file';
    throw err;
  }
  if (!isObj(raw) || !Array.isArray(raw.records)) {
    const err = new Error('not a stats export');
    err.code = 'stats-bad-file';
    throw err;
  }
  const { stats: incoming, newer, dropped } = migrateStats(raw);
  if (newer) {
    const err = new Error('exported by a newer client'); // the page shows its own text
    err.code = 'stats-newer-version';
    throw err;
  }
  const have = new Set((Array.isArray(current?.records) ? current.records : []).map((r) => r.id));
  const merged = mergeStats(current, incoming);
  const added = incoming.records.filter((r) => !have.has(r.id)).length;
  // Incoming rows are newest first; compacted or unnamed rows cannot restore a nickname.
  const name = incoming.records.map((rec) => sanitizeName(selfRowOf(rec)?.name)).find(Boolean) || '';
  return { stats: merged, added, skipped: incoming.records.length - added, dropped, name };
}

/**
 * The payload the export button downloads (envelope + a little provenance).
 * @param {{ records: any[] }} stats
 * @returns {{ app: string, kind: string, v: number, exportedAt: string, records: any[] }}
 */
export function exportStats(stats) {
  return {
    app: 'stronghold-protocol',
    kind: 'local-stats',
    v: STATS_VERSION,
    exportedAt: new Date().toISOString(),
    records: fitToBudget(Array.isArray(stats?.records) ? stats.records : []),
  };
}

// ---- aggregation (what the page shows; records may hold more than any view uses) ------------------------------------

const SELF_STATS = ['dmgDealt', 'kills', 'bossDamage', 'activatedLayers', 'merges', 'itemsEquipped', 'gold', 'perfectRounds', 'refreshes', 'leaks', 'lpLost'];

/**
 * The row that "is me" in a record: selfId, else the only human, else seat 0 — records written by
 * recordResult always have selfId; the fallbacks only serve imported / hand-made data.
 * @param {any} rec
 * @returns {any|null}
 */
export function selfRowOf(rec) {
  const ps = Array.isArray(rec?.players) ? rec.players : [];
  return ps.find((p) => p.playerId && p.playerId === rec.selfId)
    || ps.find((p) => !p.isBot)
    || ps[0]
    || null;
}

/** Whether this record counts as a win for its self player (per-row victory = team won AND still in). */
const selfWon = (rec, self) => (self ? !!self.victory : !!rec.victory);

/**
 * The rounds the player passed in a record: its own row's (the table the settlement prints per player), else the
 * team's; 0 when the record does not know.
 * @param {any} rec
 */
export function roundsOf(rec) {
  const self = selfRowOf(rec);
  const v = self && Number.isFinite(self.roundsPassed) ? self.roundsPassed : rec?.roundsPassed;
  return Number.isFinite(v) ? v : 0;
}

/**
 * Whether a record enters the aggregates (see the header). A settled record always does. A quit record does once the
 * player had finished at least one battle: cleared a round, or was already eliminated; a match given up before that —
 * entered and left right away — is history only.
 * @param {any} rec a normalized record
 * @returns {boolean}
 */
export function countsTowardStats(rec) {
  if (!isObj(rec)) return false;
  // Legacy test records never count. There is no switch that counts it (DESIGN §34.8).
  if (rec.test === true || Number.isInteger(selfRowOf(rec)?.aiTakeoverRound)) return false;
  if (rec.end !== 'quit') return true;
  const self = selfRowOf(rec);
  if (!self) return false;
  return self.alive === false || (Number.isFinite(self.roundsPassed) && self.roundsPassed >= 1);
}

/** Active settlement bonds, deduplicated per player and bounded like imported bond rows. */
function usedBondIdsOf(player) {
  const ids = Array.isArray(player?.usedBondIds) ? player.usedBondIds
    : (Array.isArray(player?.bonds) ? player.bonds : []).filter((b) => b?.active === true).map((b) => b.bondId);
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.length).map((id) => id.slice(0, 64)))].slice(0, MAX_BONDS);
}

/** Strategy corner badges use official band victorCount thresholds; training awards no progress. */
export function strategyBadgeIds(records, bands) {
  const clears = new Map();
  for (const rec of Array.isArray(records) ? records : []) {
    if (!rec || rec.end === 'quit' || rec.test === true || rec.difficulty === 'TRAINING' || rec.modeId === 'mode_training_1') continue;
    const self = selfRowOf(rec);
    if (!self?.bandId || Number.isInteger(self.aiTakeoverRound) || !selfWon(rec, self)) continue;
    clears.set(self.bandId, (clears.get(self.bandId) || 0) + 1);
  }
  return Object.values(bands || {}).filter((band) => Number.isInteger(band.victorCount) && band.victorCount > 0
    && (clears.get(band.bandId) || 0) >= band.victorCount)
    .sort((a, b) => (a.sortId || 0) - (b.sortId || 0) || a.bandId.localeCompare(b.bandId))
    .map((band) => band.bandId);
}

/**
 * Aggregate records for the stats page — over the records that count; `total` / `excluded` say how many did not.
 * Everything is keyed by ids (bandId / titleId / difficulty); the page maps them to names and icons through the game
 * data. The combat totals read the settled records' stat blocks (a quit record has none). A match with gameplay plugins
 * is left out (`modded`: how many) unless `opts.modded` takes it in (see the header).
 * @param {any[]} records
 * @param {{ modded?: boolean }} [opts]
 * @returns {any}
 */
export function aggregateStats(records, { modded: withModded = false } = {}) {
  const all = Array.isArray(records) ? records : [];
  // Test matches stay out of every tally, including the 「含插件对局」 set. `total` still counts the history row.
  const testN = all.filter((r) => isObj(r) && r.test === true).length;
  const countable = all.filter((r) => !(isObj(r) && r.test === true));
  const official = withModded ? countable : countable.filter((r) => !isModdedRecord(r));
  const rs = official.filter(countsTowardStats);
  const out = {
    total: all.length, count: rs.length, excluded: official.length - rs.length, modded: countable.length - official.length, test: testN, wins: 0,
    rounds: { total: 0, max: 0 },
    duration: { totalMs: 0 },
    hidden: { reached: 0, cleared: 0 },
    trophies: 0,
    byDifficulty: {},
    byMode: { solo: { games: 0, wins: 0, hiddenCleared: 0 }, coop: { games: 0, wins: 0, hiddenCleared: 0 } },
    titles: {}, bands: {}, sums: {},
    bonds: Object.create(null),
    maxima: { gold: null, merges: null, kills: null },
  };
  for (const rec of rs) {
    const self = selfRowOf(rec);
    // Single-match records only use settled totals, never a partial quit or a teammate's row.
    if (rec.end !== 'quit' && self) {
      const values = { gold: self.stats?.gold, merges: self.stats?.merges, kills: self.creditedKills };
      for (const [key, value] of Object.entries(values)) {
        if (Number.isFinite(value) && value >= 0) out.maxima[key] = Math.max(out.maxima[key] ?? 0, value);
      }
    }
    const won = selfWon(rec, self);
    if (won) out.wins++;
    const rounds = roundsOf(rec);
    out.rounds.total += rounds;
    out.rounds.max = Math.max(out.rounds.max, rounds);
    out.duration.totalMs += num(rec.durationMs) || 0;
    if (rec.hiddenReached) out.hidden.reached++;
    if (rec.hiddenCleared) out.hidden.cleared++;
    // Sum the actual settlement award, including defeats, rather than teammates' or solo-mode trophies.
    if (rec.end !== 'quit' && rec.roomMode === 'coop' && Number.isFinite(self?.trophies)) out.trophies += Math.max(0, self.trophies);

    const d = rec.difficulty || 'UNKNOWN';
    const bd = (out.byDifficulty[d] ||= { games: 0, wins: 0, hiddenCleared: 0 });
    bd.games++;
    if (won) bd.wins++;
    if (rec.hiddenCleared) bd.hiddenCleared++;

    if (rec.roomMode === 'solo' || rec.roomMode === 'coop') {
      const mode = out.byMode[rec.roomMode];
      mode.games++;
      if (won) mode.wins++;
      if (won && rec.hiddenCleared) mode.hiddenCleared++;
    }

    const titleId = self?.title?.id;
    if (titleId) {
      const t = (out.titles[titleId] ||= { count: 0 });
      t.count++;
    }

    const bandId = self?.bandId;
    if (bandId) {
      const b = (out.bands[bandId] ||= { games: 0, wins: 0 });
      b.games++;
      if (won) b.wins++;
    }

    // [ASSUMED] Usage means active in the self player's settlement; once per match, irrespective of layers.
    if (rec.end !== 'quit') {
      for (const id of usedBondIdsOf(self)) {
        const bond = (out.bonds[id] ||= { games: 0 });
        bond.games++;
      }
    }

    if (rec.end !== 'quit' && self && isObj(self.stats)) {
      for (const k of SELF_STATS) {
        const v = self.stats[k];
        if (Number.isFinite(v)) out.sums[k] = (out.sums[k] || 0) + v;
      }
    }
  }
  return out;
}

/** Highest earned trophy tier from the official config, independent of the order of its medal rows. */
export function trophyMedalOf(total, medals) {
  const count = Number.isFinite(total) ? Math.max(0, total) : 0;
  return (Array.isArray(medals) ? medals : []).reduce((best, medal) =>
    Number.isFinite(medal?.count) && medal.count >= 0 && medal.count <= count && (!best || medal.count > best.count) ? medal : best, null);
}

/** All season members of TOP1, independent of the player's recruitment history. */
export function bondMemberChess(chess, bondId) {
  if (!bondId) return [];
  const seen = new Set();
  return (Array.isArray(chess) ? chess : []).filter((c) => {
    if (!c || c.isGolden || c.isHidden || c.isDiy || c.visible === false || !c.bonds?.includes(bondId)) return false;
    const key = `${c.charId}#${c.tier}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.tier - b.tier || (a.shopSortId || 0) - (b.shopSortId || 0) || a.chessId.localeCompare(b.chessId));
}
