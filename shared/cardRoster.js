// shared/cardRoster.js — the cross-period 名片干员 roster (DESIGN §37.325, #877): every operator a seat card may show in
// any official period (shared/versions.js), whatever version the room plays. Pure ESM, no Node APIs: the server
// (server/lobby.js cardAllowed / skins), the build (tools/build-card-roster.mjs) and the browser read the same code.
//
// The roster is a generated file, data/card-roster.json (`npm run build:roster`; tools/build-data.mjs rebuilds it after
// writing a version's default output directory), the union of each period's card candidates (cardEntries): its visible,
// non-自选 chess records plus its 自选编队 pool (`backups.diy.ownedPool`). It carries what a picker needs without that
// period's data: the name, the appellation, the rarity, whether any period has a visible elite chess record (`golden`:
// the card draws the E2 art, as that operator looks in its own period's room; a 自选-only operator stays at E1), and the
// periods that list it, oldest first. server/data.js loads it with the rest of data/*.json (getData()['card-roster']);
// it is a presentation file (server/plugins/identity.js PRESENTATION_DATA): never part of a content hash, a version
// directory or a plugin content set.
//
// File format (CARD_ROSTER_FORMAT 1): one JSON object, one operator per line (a stable, readable diff):
//   {"format":1,"periods":[<version ids, oldest first>],"operators":[
//   {"charId":"char_002_amiya","name":"阿米娅","appellation":"Amiya","rarity":5,"golden":true,"periods":[…]},
//   …
//   ]}
// operators sorted by charId. A reader (parseCardRoster) drops a malformed row and refuses another format.

/**
 * An official operator charId (`char_<digits>_<token>`): the official half of shared/protocol.js CHAR_ID, at most its 64
 * characters. The roster lists official periods only, so never a plugin's `char_x_…`. Not imported from protocol.js:
 * that file stays outside the typecheck slice (jsconfig.json), and a shared/ module importing it would pull it in.
 * @param {unknown} v
 */
const isOfficialCharId = (v) => typeof v === 'string' && v.length <= 64 && /^char_[0-9]+_[A-Za-z0-9_]+$/.test(v);

/** The data file's basename (data/card-roster.json, getData() key). */
export const CARD_ROSTER = 'card-roster';
/** The roster file format parseCardRoster reads. */
export const CARD_ROSTER_FORMAT = 1;
/**
 * The official periods in time order, oldest first (shared/versions.js VERSIONS lists them by another order: the
 * default first). A row's `periods` follow it; the picker groups the other periods newest first.
 */
export const CARD_PERIOD_ORDER = Object.freeze(['act1autochess@V1_1', 'act1autochess', 'act2autochess@V2_1', 'act2autochess', 'act3autochess@V3_1']);

/**
 * Is a chess record a card candidate: a visible operator record of the shop pool (no 自选 slot, no hidden preset)?
 * @param {any} c
 */
export const isCardChess = (c) => !!c && !c.isDiy && c.visible !== false && typeof c.charId === 'string';

/**
 * The 自选编队 pool of a data set's backups (`backups.diy.ownedPool`): operators outside the chess pool with no chess
 * record of their own; their portrait shows on a seat card like any other.
 * @param {any} backups
 * @returns {string[]}
 */
export function cardPoolIds(backups) {
  const diy = backups && typeof backups === 'object' && backups.diy && typeof backups.diy === 'object' ? backups.diy : null;
  return Array.isArray(diy?.ownedPool) ? diy.ownedPool.filter((id) => typeof id === 'string' && id) : [];
}

/**
 * @typedef {{ name: string, appellation: string, rarity: number, golden: boolean }} CardEntry
 */

/**
 * The card candidates of one data set, by charId: every isCardChess record (the elite record's fields when there is one,
 * `golden` true) and then every pool id without one (name and rarity from `backups.diy.operators`, else
 * `backups.units`; the appellation from `backups.units`; `golden` false). The keys are the room's card whitelist
 * (server/lobby.js cardCharIds).
 * @param {any} chess the data set's chess.json
 * @param {any} backups the data set's backups.json
 * @returns {Map<string, CardEntry>}
 */
export function cardEntries(chess, backups) {
  /** @type {Map<string, CardEntry>} */
  const out = new Map();
  if (chess && typeof chess === 'object') {
    for (const c of Object.values(chess)) {
      if (!isCardChess(c)) continue;
      const had = out.get(c.charId);
      if (had && (had.golden || !c.isGolden)) continue;
      out.set(c.charId, { name: c.name, appellation: c.appellation ?? '', rarity: c.rarity, golden: !!c.isGolden });
    }
  }
  const own = (map, id) => (map && typeof map === 'object' && Object.hasOwn(map, id) ? map[id] : null);
  const diyOps = backups?.diy?.operators;
  const units = backups?.units;
  for (const id of cardPoolIds(backups)) {
    if (out.has(id)) continue;
    const op = own(diyOps, id);
    const unit = own(units, id);
    out.set(id, { name: op?.name ?? unit?.name, appellation: unit?.appellation ?? '', rarity: op?.rarity ?? unit?.rarity, golden: false });
  }
  return out;
}

/**
 * @typedef {{ charId: string, name: string, appellation: string, rarity: number, golden: boolean, periods: string[] }} CardRow
 * @typedef {{ format: number, periods: string[], operators: CardRow[] }} CardRoster
 */

const isName = (v) => typeof v === 'string' && v.length > 0;
const isRarity = (v) => Number.isInteger(v) && v >= 1 && v <= 6;

/**
 * The roster of several periods' data (tools/build-card-roster.mjs): each period's cardEntries merged in
 * CARD_PERIOD_ORDER. An operator's name, rarity and appellation must agree across periods (a mismatch throws: the
 * picker shows one record per charId); `golden` is true when any period has the elite record; `periods` in time order.
 * Throws on an unknown or repeated period id and on a candidate without a name or a 1–6 rarity, so the written file
 * always parses whole.
 * @param {{ id: string, chess: any, backups: any }[]} sources
 * @returns {CardRoster}
 */
export function buildCardRoster(sources) {
  const list = [...sources];
  for (const s of list) if (!CARD_PERIOD_ORDER.includes(s.id)) throw new Error(`card roster: unknown period ${s.id}`);
  if (new Set(list.map((s) => s.id)).size !== list.length) throw new Error('card roster: a period is given twice');
  list.sort((a, b) => CARD_PERIOD_ORDER.indexOf(a.id) - CARD_PERIOD_ORDER.indexOf(b.id));
  /** @type {Map<string, CardRow>} */
  const rows = new Map();
  for (const src of list) {
    for (const [charId, e] of cardEntries(src.chess, src.backups)) {
      if (!isOfficialCharId(charId) || !isName(e.name) || !isRarity(e.rarity) || typeof e.appellation !== 'string') {
        throw new Error(`card roster: ${src.id} ${charId}: no charId, name or 1–6 rarity (${JSON.stringify(e)})`);
      }
      const had = rows.get(charId);
      if (!had) {
        rows.set(charId, { charId, name: e.name, appellation: e.appellation, rarity: e.rarity, golden: e.golden, periods: [src.id] });
        continue;
      }
      for (const k of /** @type {const} */ (['name', 'rarity', 'appellation'])) {
        if (had[k] !== e[k]) throw new Error(`card roster: ${charId} ${k} differs: ${JSON.stringify(had[k])} (${had.periods.join(', ')}) vs ${JSON.stringify(e[k])} (${src.id})`);
      }
      had.golden ||= e.golden;
      had.periods.push(src.id);
    }
  }
  const operators = [...rows.values()].sort((a, b) => (a.charId < b.charId ? -1 : a.charId > b.charId ? 1 : 0));
  return { format: CARD_ROSTER_FORMAT, periods: list.map((s) => s.id), operators };
}

/**
 * The file text of a roster: deterministic, one operator per line, a newline at the end (see the header).
 * @param {CardRoster} r
 * @returns {string}
 */
export function serializeCardRoster(r) {
  const row = (o) => JSON.stringify({ charId: o.charId, name: o.name, appellation: o.appellation, rarity: o.rarity, golden: o.golden, periods: o.periods });
  return `{"format":${JSON.stringify(r.format)},"periods":${JSON.stringify(r.periods)},"operators":[\n${r.operators.map(row).join(',\n')}\n]}\n`;
}

/**
 * @typedef {Readonly<{ charId: string, name: string, appellation: string, rarity: number, golden: boolean, periods: readonly string[] }>} CardRosterRow
 * @typedef {{ ids: Set<string>, byChar: Map<string, CardRosterRow>, periods: readonly string[] }} ParsedCardRoster
 */

/** @type {WeakMap<object, ParsedCardRoster | null>} */
const PARSED = new WeakMap();

/**
 * Read a loaded roster (the parsed data/card-roster.json): its ids, its rows by charId and its periods — null when it is
 * not an object or not CARD_ROSTER_FORMAT. A row without a charId, a name, a 1–6 integer rarity, a boolean `golden` or a
 * non-empty `periods` of known period ids (no repeats) is dropped, as is a second row of a charId; a missing appellation
 * reads ''. Cached per object (the server's data is deep-frozen and loaded once): the same object gives the same result.
 * The returned sets and maps are shared — read them, never change them.
 * @param {unknown} json
 * @returns {ParsedCardRoster | null}
 */
export function parseCardRoster(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const cached = PARSED.get(json);
  if (cached !== undefined) return cached;
  /** @type {ParsedCardRoster | null} */
  let out = null;
  const j = /** @type {any} */ (json);
  if (j.format === CARD_ROSTER_FORMAT && Array.isArray(j.operators)) {
    /** @type {Map<string, CardRosterRow>} */
    const byChar = new Map();
    for (const o of j.operators) {
      if (!o || typeof o !== 'object' || !isOfficialCharId(o.charId) || byChar.has(o.charId)) continue;
      if (!isName(o.name) || !isRarity(o.rarity) || typeof o.golden !== 'boolean') continue;
      const periods = o.periods;
      if (!Array.isArray(periods) || !periods.length || !periods.every((p) => CARD_PERIOD_ORDER.includes(p)) || new Set(periods).size !== periods.length) continue;
      byChar.set(o.charId, Object.freeze({ charId: o.charId, name: o.name, appellation: typeof o.appellation === 'string' ? o.appellation : '',
        rarity: o.rarity, golden: o.golden, periods: Object.freeze([...periods]) }));
    }
    const periods = Array.isArray(j.periods) ? j.periods.filter((p) => CARD_PERIOD_ORDER.includes(p)) : [];
    out = Object.freeze({ ids: new Set(byChar.keys()), byChar, periods: Object.freeze(periods) });
  }
  PARSED.set(json, out);
  return out;
}
