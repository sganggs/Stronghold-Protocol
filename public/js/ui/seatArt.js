// 名片干员 (PR #643 split 6): the portrait on a doctor's seat card in the waiting room (screens/room.js) and on the
// strategy draft's name cards (screens/bandDraft.js) — the operator the player picked (room.card; everybody sees it as
// room.state seats[].card), else one of the 5★/6★ operators chosen by the player id, the same on every client — worn in
// the player's outfit (seatCardSkin, the maintainer's decision 4 of 2026-10-21). The rules are pure: the screen passes
// the chess records (ui/assetUrls.js chessPortraitUrl turns the operator into its portrait; without the art pack the
// card keeps its avatar frame). The pick itself lives in `cardStore` (a pref; ui/loadoutSync.js installCardSync sends it).
// Other periods (#877, DESIGN §37.325): the pick may be any official period's card candidate — the room's own list
// (cardOperators) plus the cross-period roster data/card-roster.json (shared/cardRoster.js; rosterOperators), grouped in
// the picker by period (cardGroups); a pick only shows on the cards, the room's pool never changes. The default pool stays
// the room's own list, so a seat without a pick draws the same operator whether the roster has loaded or not.
// [ASSUMED] The event's card shows the account's assistant (名片形象, display_meta_table avatarTypeData ASSISTANT): this
// remake has no accounts, so the pick is made on one's own seat card and kept in this browser (CARD_PREF 'room.card').
// [ASSUMED] With no pick, a 5★/6★ operator is chosen by hash32(playerId) — a remake rule, so that every card has art as in
// the event's room and every client draws the same one.

import { createStore, loadPref, savePref } from '../store.js';
import { ownerSkin } from './skins.js';
import { CARD_PERIOD_ORDER, cardPoolIds, isCardChess, parseCardRoster } from '../../../shared/cardRoster.js';

/** 名片干员: the player's own pick (a localStorage pref, sent as room.card). */
export const CARD_PREF = 'room.card';

/** The store field of the pick (ui/loadoutSync.js installCardSync `key`) and its sync state field. */
export const CARD_KEY = 'card';
export const CARD_SYNC_KEY = 'cardSync';

/** A stored pick as the store holds it: a charId string, '' for none (默认). */
export function parseStoredCard(v) {
  return typeof v === 'string' ? v : '';
}

/** This browser's pick and its sync state (survives room / match resets like ui/skins.js' store). */
export const cardStore = createStore({ [CARD_KEY]: parseStoredCard(loadPref(CARD_PREF, '')), [CARD_SYNC_KEY]: 'idle' });

/**
 * Pick the 名片干员 ('' = 默认): persisted at once, the sync engine sends it.
 * @param {string} charId
 */
export function setCard(charId) {
  const next = parseStoredCard(charId);
  try { savePref(CARD_PREF, next); } catch { /* private mode: the session keeps it */ }
  cardStore.set({ [CARD_KEY]: next });
}

/** FNV-1a of a string (the default portrait: the same operator for a player on every client). */
function hash32(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/**
 * The operators a seat card can show from the room's own data — the room's part of the server's room.card whitelist
 * (server/lobby.js cardAllowed: the roster, then cardCharIds of the room's data): one record per charId of the visible,
 * non-自选 chess records (shared/cardRoster.js isCardChess; the elite form, for its E2 art), then the 自选编队 pool
 * (`backups.diy.ownedPool`, cardPoolIds; named and rated by `backups.diy.operators`, its appellation from
 * `backups.units` so the picker's search finds it by its code name too — those operators have no chess record of their
 * own), 6★ first, then by name.
 * @param {any[]} chessList chess.json records
 * @param {any} [backups] backups.json (its 自选编队 pool joins the list)
 * @returns {any[]}
 */
export function cardOperators(chessList, backups = null) {
  const by = new Map();
  for (const c of Array.isArray(chessList) ? chessList : []) {
    if (!isCardChess(c)) continue;
    const prev = by.get(c.charId);
    if (!prev || (c.isGolden && !prev.isGolden)) by.set(c.charId, c);
  }
  const diy = backups && typeof backups === 'object' ? backups.diy : null;
  const ops = diy && diy.operators && typeof diy.operators === 'object' ? diy.operators : {};
  const units = backups && typeof backups === 'object' && backups.units && typeof backups.units === 'object' ? backups.units : {};
  for (const id of cardPoolIds(backups)) {
    if (by.has(id)) continue;
    const rec = Object.hasOwn(ops, id) ? ops[id] : null;
    const unit = Object.hasOwn(units, id) ? units[id] : null;
    by.set(id, {
      charId: id,
      name: rec && typeof rec.name === 'string' ? rec.name : id,
      rarity: rec && Number.isFinite(rec.rarity) ? rec.rarity : 0,
      appellation: unit && typeof unit.appellation === 'string' ? unit.appellation : '',
    });
  }
  return [...by.values()].sort((a, b) => ((b.rarity ?? 0) - (a.rarity ?? 0)) || String(a.name).localeCompare(String(b.name), 'zh'));
}

/**
 * A cross-period operator's name as the interface shows it (#877, DESIGN §37.325): Chinese as it is; another language
 * takes the game texts' name (`localeName`: data.js localeName, the names of data/i18n/<lang>.json — tools/build-i18n.mjs
 * adds the roster's names to them), and without one a Chinese-script language (zh-TW) keeps the Chinese name, any other
 * the operator's appellation (its official code name: Latin script, a few Cyrillic, e.g. Ольга). [ASSUMED] the fallbacks
 * @param {{ name?: string, appellation?: string } | null | undefined} row a roster row
 * @param {{ lang?: string, localeName?: (zh: string) => string }} [opts]
 * @returns {string}
 */
export function cardName(row, { lang = 'zh', localeName = (s) => s } = {}) {
  const zh = typeof row?.name === 'string' ? row.name : '';
  if (!lang || lang === 'zh' || !zh) return zh;
  const got = localeName(zh);
  if (typeof got === 'string' && got && got !== zh) return got;
  if (/^zh(-|$)/.test(lang)) return zh;
  return typeof row.appellation === 'string' && row.appellation ? row.appellation : zh;
}

/**
 * The roster's operators the room's own list lacks (#877, DESIGN §37.325), as picker and seat-card records:
 * `{ charId, name, zh, appellation, rarity, isGolden, periods, other: true }` — `name` in the interface language
 * (cardName), `zh` the Chinese one (the picker's search matches both and the appellation), `isGolden` the roster's
 * `golden` (ui/assetUrls.js draws the E2 art: any period's visible elite record; a 自选-only operator stays at E1),
 * `periods` the official periods that list it, oldest first. 6★ first, then by the Chinese name. [] without a roster.
 * @param {unknown} roster data/card-roster.json as loaded (shared/cardRoster.js parseCardRoster reads it)
 * @param {{ exclude?: Set<string> | null, lang?: string, localeName?: (zh: string) => string }} [opts] `exclude`: the
 *   room's own list (its records win)
 * @returns {any[]}
 */
export function rosterOperators(roster, { exclude = null, lang = 'zh', localeName = (s) => s } = {}) {
  const parsed = parseCardRoster(roster);
  if (!parsed) return [];
  const out = [];
  for (const r of parsed.byChar.values()) {
    if (exclude && exclude.has(r.charId)) continue;
    out.push({ charId: r.charId, name: cardName(r, { lang, localeName }), zh: r.name, appellation: r.appellation, rarity: r.rarity,
      isGolden: r.golden, periods: r.periods, other: true });
  }
  return out.sort((a, b) => (b.rarity - a.rarity) || a.zh.localeCompare(b.zh, 'zh'));
}

/**
 * The room's list with each record's Chinese name beside the shown one (#877 review, DESIGN §37.325): in another
 * language data.js gives the default data's chess and backups records their localized names, and the picker's search
 * matches the Chinese name in every group (cardMatches) — a cross-period record carries it (rosterOperators `zh`), the
 * room's take it here, from the same list built from the files as downloaded (data.js listRaw / getRaw). A record whose
 * name is already the Chinese one (Chinese, a version room's own texts) or that the raw list lacks stays as it is.
 * @param {any[]} list cardOperators() of the files in the interface language
 * @param {any[]} rawList cardOperators() of the same files as downloaded
 * @returns {any[]}
 */
export function withCardZh(list, rawList) {
  const zh = new Map((Array.isArray(rawList) ? rawList : []).map((c) => [c.charId, c.name]));
  return (Array.isArray(list) ? list : []).map((c) => {
    const name = zh.get(c.charId);
    return typeof name === 'string' && name && name !== c.name && c.zh !== name ? { ...c, zh: name } : c;
  });
}

/**
 * Whether a picker record answers the search `needle` (lower case, trimmed; '' answers every record): its shown name, its
 * Chinese one (`zh`: withCardZh, rosterOperators) or its appellation contains it, in every group alike (#877, DESIGN
 * §37.325).
 * @param {any} c a picker record
 * @param {string} needle
 * @returns {boolean}
 */
export function cardMatches(c, needle) {
  if (!needle) return true;
  return [c?.name, c?.zh, c?.appellation].some((v) => String(v || '').toLowerCase().includes(needle));
}

/**
 * What the seat cards draw from: the pickable operators by charId and the default pool (5★/6★, by charId so every
 * client orders it the same). `extra` (#877): the cross-period records (rosterOperators) — they resolve a pick, never
 * the default pool, and a charId of the room's list keeps the room's record (a plugin's redefinition included).
 * @param {any[]} list cardOperators()
 * @param {{ pending?: boolean, extra?: any[] }} [opts]
 */
export function cardContext(list, { pending = false, extra = [] } = {}) {
  const byChar = new Map(list.map((c) => [c.charId, c]));
  for (const c of Array.isArray(extra) ? extra : []) if (c && !byChar.has(c.charId)) byChar.set(c.charId, c);
  return {
    // PR #894 follow-up: true while the room version's 自选 pool (backups) — and, #877, the cross-period roster — is
    // still loading: a pick that is not in the list yet waits for it instead of drawing a default pool operator for a moment
    pending,
    byChar,
    pool: list.filter((c) => (c.rarity ?? 0) >= 5).sort((a, b) => (a.charId < b.charId ? -1 : a.charId > b.charId ? 1 : 0)),
  };
}

/**
 * The picker's groups (#877, DESIGN §37.325): first the room's version (`key` 'room': the room's own list, then any
 * roster record whose periods include the room's version — an official operator the room's plugins hide, [ASSUMED] 6:
 * it stays a card, in this group, whichever other periods list it too), then the other periods newest first
 * (shared/cardRoster.js CARD_PERIOD_ORDER reversed). Any other cross-period operator shows once, in the newest period
 * that lists it. Empty groups are left out.
 * @param {any[]} list cardOperators() of the room
 * @param {any[]} others rosterOperators()
 * @param {string} roomVersion the room's version id (versions.js roomVersion)
 * @returns {{ key: string, version: string, ops: any[] }[]}
 */
export function cardGroups(list, others, roomVersion) {
  const room = Array.isArray(list) ? [...list] : [];
  /** @type {Map<string, any[]>} */
  const by = new Map();
  for (const c of Array.isArray(others) ? others : []) {
    if (!c) continue;
    const periods = Array.isArray(c.periods) ? c.periods : [];
    const rest = periods.filter((p) => p !== roomVersion && CARD_PERIOD_ORDER.includes(p));
    if (!rest.length || periods.includes(roomVersion)) { room.push(c); continue; }
    const key = rest.reduce((a, b) => (CARD_PERIOD_ORDER.indexOf(b) > CARD_PERIOD_ORDER.indexOf(a) ? b : a));
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(c);
  }
  const groups = [{ key: 'room', version: roomVersion, ops: room }];
  for (const v of [...CARD_PERIOD_ORDER].reverse()) if (by.has(v)) groups.push({ key: v, version: v, ops: by.get(v) });
  return groups.filter((g) => g.ops.length);
}

/**
 * The players whose outfits the strategy draft's name cards read (#877, DESIGN §37.325): the match's public players
 * (m.public.players[].skins), plus — only for the operators the match's data lacks (`matchOps`) — the room's seats'
 * (room.state seats[].skins). The match keeps only the operators of the data it plays (server/match/player/basics.js
 * setSkins), so a cross-period card's outfit comes from the room; for an operator of the match's data the match's map
 * alone decides (#877 review): `room.skins` during a match re-broadcasts no room.state (server/lobby.js skins), so the
 * room's seats keep the map from before the start, and an outfit a teammate took off in the match's 干员调配 would show
 * again. A player without a room seat keeps its own map.
 * @param {any[]} players m.public players
 * @param {any[] | null | undefined} roomSeats room.state seats
 * @param {Set<string> | null} [matchOps] the operators of the match's data (shared/protocol.js operatorCharIds of the
 *   room's files, the set setSkins keeps); null: none known yet, the room's map fills every gap
 * @returns {any[]}
 */
export function cardSkinPlayers(players, roomSeats, matchOps = null) {
  const list = Array.isArray(players) ? players : [];
  const seats = new Map();
  for (const s of Array.isArray(roomSeats) ? roomSeats : []) if (s && s.playerId != null) seats.set(s.playerId, s);
  return list.map((p) => {
    if (!p || typeof p !== 'object') return p;
    const fromRoom = seats.get(p.playerId)?.skins;
    if (!fromRoom || typeof fromRoom !== 'object') return p;
    const extra = {};
    for (const [charId, skinId] of Object.entries(fromRoom)) if (!(matchOps instanceof Set && matchOps.has(charId))) extra[charId] = skinId;
    if (!Object.keys(extra).length) return p;
    return { ...p, skins: { ...extra, ...(p.skins && typeof p.skins === 'object' ? p.skins : {}) } };
  });
}

/**
 * The operator on a seat card: the player's pick (one's own seat shows the local pick at once, the others the server's
 * seats[].card), else one of the pool chosen by the player id [ASSUMED, see the header]. null for an empty seat, a bot,
 * or before the data loads.
 * @param {any} seat room.state seat
 * @param {{ byChar: Map<string, any>, pool: any[], pending?: boolean }} ctx cardContext()
 * @param {{ myId?: any, myCard?: string }} [own]
 * @returns {{ chess: any, picked: boolean } | null}
 */
export function seatOperator(seat, { byChar, pool, pending = false }, { myId, myCard } = {}) {
  if (!seat || seat.playerId == null || seat.isBot) return null;
  const pick = (seat.playerId === myId ? myCard : seat.card) || '';
  const rec = pick && byChar ? byChar.get(pick) : null;
  if (rec) return { chess: rec, picked: true };
  if (pick && pending) return null;
  if (!Array.isArray(pool) || !pool.length) return null;
  return { chess: pool[hash32(seat.playerId) % pool.length], picked: false };
}

/**
 * The outfit a seat card's operator wears (docs/SKINS.md; the maintainer's decision 4 of 2026-10-21), by the rule of
 * every owner-aware card (ui/skins.js ownerSkin): one's own card wears this browser's choice at once (`localSkins`),
 * another doctor's the choice that seat published — `players` holds `{ playerId, skins }`: the room's seats
 * (room.state seats[].skins) or a match's public players — unless 「显示其他玩家的皮肤」 is off. null = the default art;
 * a skinId the local manifest does not hold (an appearance plugin this page lacks) also draws the default
 * (ui/assetUrls.js chessPortraitUrl falls back).
 * @param {any} seat a seat or player record (`playerId`, `isBot`)
 * @param {string | null | undefined} charId the operator the card shows (seatOperator)
 * @param {{ myId?: any, localSkins?: Record<string, string>, players?: any[], otherSkins?: boolean }} ctx
 * @returns {string | null}
 */
export function seatCardSkin(seat, charId, { myId = null, localSkins = {}, players = [], otherSkins = true } = {}) {
  if (!seat || seat.isBot || seat.playerId == null || !charId) return null;
  if (seat.playerId === myId) return ownerSkin(charId, { localSkins });
  return ownerSkin(charId, { ownerId: seat.playerId, myId, players: Array.isArray(players) ? players.filter(Boolean) : [], otherSkins });
}

/**
 * The picture a seat card draws: the first of `srcs` — the outfit's portrait, then the operator's default portrait — that
 * has not failed to load in this card (`failed`); null when none is left, and the card shows its avatar frame (§35.18's
 * leftover: an outfit file that failed went straight to the frame).
 * @param {(string | null | undefined)[]} srcs in order of preference
 * @param {readonly string[]} [failed]
 * @returns {string | null}
 */
export function seatArtSrc(srcs, failed = []) {
  for (const src of Array.isArray(srcs) ? srcs : []) if (src && !failed.includes(src)) return src;
  return null;
}
