// versions.js — which official version this page shows (DESIGN §35.23, M1; the maintainer's decisions of 2026-10-22).
//
//   * The lobby: each player's own choice (a browser preference, `sp.pref.lobby.version`), among the versions the server
//     enables (welcome.versions: registry order, the server's default marked) — a preference the server does not list
//     falls back to its default, else to 第二期下半 (shared/versions.js DEFAULT_VERSION, a code constant). Without
//     welcome.versions the switch is off and the page shows the default data, as before M1.
//   * A room: the room's version (room.state.version; absent = 第二期下半), whatever the preference — joining a room of
//     another version loads that version, leaving restores the preference.
//   * A result shown after the room is gone (a kick, a grace timeout: the lobby replays the result after room.closed,
//     also to a freshly loaded page; a settlement screen left open) keeps the version of the match it came from: the
//     frames say it (m.public / m.result `version`, a non-default match only), so its operators are read from the data
//     they played.
//   * 统计数据's replay of a stored match: the store's `replayVersion` while it is open (screens/stats.js) — another
//     version outside a room; in a room it is the room's version (which comes first anyway), kept if the room goes away
//     under the replay. The lobby preference is not touched.
// The difficulties a version offers (its config's modes) and the fallback for one it does not offer follow the server's
// rule (the highest offered one below it, else the lowest offered: ABYSS → HARD), re-implemented here because the page
// imports no server code. content.js loads and checks the version's data (loadVersionSet); every screen reads it through
// data.js as it reads a gameplay plugin's content set.
// Texts go through t() (docs/I18N.md).

import { DEFAULT_VERSION, VERSIONS, versionById, versionSlug } from '../../shared/versions.js';
import { DIFFICULTIES, modeIdFor } from '../../shared/constants.js';
import { t, N_ } from '../../shared/i18n.js';
import { loadPref, savePref, selectRoute, store as appStore } from './store.js';

export { DEFAULT_VERSION, versionById, versionSlug };

/** The lobby preference (`sp.pref.lobby.version`): a registry id. */
export const LOBBY_VERSION_PREF = 'lobby.version';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isHex64 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);

/** The stored lobby preference, or null (junk, or an id the registry does not know). */
export function storedLobbyVersion() {
  const v = loadPref(LOBBY_VERSION_PREF, null);
  return typeof v === 'string' && versionById(v) ? v : null;
}

/**
 * welcome.versions as the page keeps it (protocol §2): entries of registry ids only, each `{ id, cs, family, label,
 * roomModes, default? }`, in the order the server sent (registry order); null without the key or when nothing is left.
 * @param {unknown} list
 * @returns {Array<{ id: string, cs: string, family: string, label: string, roomModes: string[], default?: true }> | null}
 */
export function sanitizeVersions(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const e of list.slice(0, VERSIONS.length + 4)) {
    if (!isObj(e) || typeof e.id !== 'string' || seen.has(e.id) || !versionById(e.id) || !isHex64(e.cs)) continue;
    seen.add(e.id);
    const reg = versionById(e.id);
    const roomModes = Array.isArray(e.roomModes) ? e.roomModes.filter((m) => m === 'solo' || m === 'coop') : [...reg.roomModes];
    out.push({ id: e.id, cs: e.cs, family: reg.family, label: reg.label, roomModes, ...(e.default === true ? { default: true } : {}) });
  }
  return out.length ? out : null;
}

/** The server's default version (welcome.versions' `default` entry), else 第二期下半. @param {any} s the app store's state */
export function serverDefaultVersion(s) {
  const list = Array.isArray(s?.versions) ? s.versions : null;
  return list?.find((e) => e.default)?.id ?? DEFAULT_VERSION;
}

/**
 * The lobby's version: the preference when welcome lists it, else the server's default, else 第二期下半.
 * @param {any} s the app store's state
 */
export function lobbyVersion(s) {
  const list = Array.isArray(s?.versions) ? s.versions : null;
  if (!list) return DEFAULT_VERSION;
  const pref = s.lobbyVersion;
  if (typeof pref === 'string' && list.some((e) => e.id === pref)) return pref;
  return serverDefaultVersion(s);
}

/** A room's version (room.state.version; absent = 第二期下半). @param {any} room */
export const roomVersion = (room) => (typeof room?.version === 'string' && room.version ? room.version : DEFAULT_VERSION);

/** The solo time rule, as the lobby card and the solo briefing say it (DESIGN §35.23.10). N_ so extract sees them. */
export const SOLO_TIME_UNLIMITED = N_('休整期与机变阶段不限时');
export const SOLO_TIME_TIMED = N_('休整每轮 300 秒，机变 150 秒');
export const SOLO_TIME_SHORT = N_('每轮 300 秒');
export const SOLO_TIME_ON = N_('不限时');
export const SOLO_BRIEF_UNLIMITED = N_('独立模拟中休整期与机变阶段不限时');
export const SOLO_BRIEF_TIMED = N_('独立模拟中每轮休整限时 300 秒，机变 150 秒');

/**
 * Whether `versionId`'s solo is timed (`config.version.rules.soloTimed`). false for 第二期下半 and for a version whose
 * rules do not say so. null while this page is not showing that version's data — do not claim a time rule from another
 * version's config.
 * @param {any} config getConfig()
 * @param {string | null | undefined} versionId
 * @returns {boolean | null}
 */
export function soloTimedOf(config, versionId) {
  if (!versionId || versionId === DEFAULT_VERSION) return false;
  const v = config?.version;
  if (!v || v.id !== versionId) return null;
  return v.rules?.soloTimed === true;
}

/**
 * The solo time msgid, or '' while the page does not yet know (`timed == null`).
 * `unlimited`: the room's 「不限时」 is on (a timed solo plays untimed).
 * `short` is the phone line: empty for a version whose solo is already untimed (the card keeps 「1 名博士」), else
 * 「每轮 300 秒」 or 「不限时」.
 * @param {'card' | 'short' | 'brief'} kind
 * @param {{ timed?: boolean | null, unlimited?: boolean }} [o]
 * @returns {string}
 */
export function soloTimeMsgid(kind, { timed = null, unlimited = false } = {}) {
  if (timed == null) return '';
  const free = timed !== true || unlimited === true;
  if (kind === 'brief') return free ? SOLO_BRIEF_UNLIMITED : SOLO_BRIEF_TIMED;
  if (kind === 'short') return timed === true ? (free ? SOLO_TIME_ON : SOLO_TIME_SHORT) : '';
  return free ? SOLO_TIME_UNLIMITED : SOLO_TIME_TIMED;
}

/**
 * The version a match's frames say they played (m.result / m.public `version`; absent = 第二期下半, the server writes it
 * for a non-default match only). @param {any} match the store's `match`
 */
export function matchFrameVersion(match) {
  const v = match?.result?.version ?? match?.public?.version;
  return typeof v === 'string' && versionById(v) ? v : DEFAULT_VERSION;
}

/**
 * The version the page shows: the room's in a room; a stored match's while 统计数据 replays it (`replayVersion`); a
 * result's after its room is gone (its frames' version while m.public / m.result are on screen); else the lobby's.
 * @param {any} s the app store's state
 */
export function shownVersion(s) {
  if (s?.room) return roomVersion(s.room);
  if (typeof s?.replayVersion === 'string' && versionById(s.replayVersion)) return s.replayVersion;
  if (s?.match?.public || s?.match?.result) return matchFrameVersion(s.match);
  return lobbyVersion(s);
}

/**
 * Save the lobby preference and show it (the store's `lobbyVersion`; content.js follows the store).
 * @param {string} id a registry id
 * @param {{ store?: typeof appStore }} [opts]
 */
export function setLobbyVersion(id, { store = appStore } = {}) {
  if (!versionById(id)) return;
  savePref(LOBBY_VERSION_PREF, id);
  if (store.get().lobbyVersion !== id) store.set({ lobbyVersion: id });
}

/** A version's name in the interface language (its registry msgid), or the id itself for an unknown one. */
export function versionLabel(id) {
  const v = versionById(id);
  return v ? t(v.label) : String(id ?? '');
}

/** The welcome entry of a version (its cs), or null. @param {any} s @param {string} id */
export const welcomeVersion = (s, id) => (Array.isArray(s?.versions) ? s.versions.find((e) => e.id === id) || null : null);

/**
 * The official period of each version (docs/DATA.md "Official versions (M0)"): the official half it is, its
 * versionInfoDict sub-version and its dates (Beijing time). Shown in the version picker.
 */
export const VERSION_PERIODS = Object.freeze({
  act2autochess: { half: 'second', sub: 'V2_2', from: '2026-03-27', to: '2026-04-25' },
  'act2autochess@V2_1': { half: 'second', sub: 'V2_1', from: '2026-03-14', to: '2026-03-27' },
  act1autochess: { half: 'first', sub: 'V1_2', from: '2025-11-25', to: '2025-12-12' },
  'act1autochess@V1_1': { half: 'first', sub: 'V1_1', from: '2025-11-14', to: '2025-11-25' },
  // 序列Ⅰ: open from 2026-11-08 16:00; its 修订期 starts 2026-11-30 04:00 (PRTS 卫戍协议·规程)
  'act3autochess@V3_1': { half: 'regulation', sub: 'V3_1', from: '2026-11-08', to: '2026-11-30' },
});

const PERIOD_TEXT = { first: N_('官方「盟约·上半」{sub}（{from} – {to}）'), second: N_('官方「盟约·下半」{sub}（{from} – {to}）'),
  regulation: N_('官方「卫戍协议·规程」{sub}（{from} – {to}）') };

/** The official period line of a version (VERSION_PERIODS), or '' for one the table lacks. @param {string} id */
export function periodLine(id) {
  const p = VERSION_PERIODS[id];
  return p ? t(PERIOD_TEXT[p.half], { sub: p.sub, from: p.from, to: p.to }) : '';
}

/**
 * The difficulties a version offers in a room mode: DIFFICULTIES whose mode its config lists (config.modes[modeIdFor()]);
 * all four without a config (the page has not loaded it yet).
 * @param {any} config the shown data's config.json
 * @param {'solo'|'coop'} roomMode
 * @returns {string[]}
 */
export function offeredDifficulties(config, roomMode) {
  const modes = isObj(config?.modes) ? config.modes : null;
  if (!modes) return [...DIFFICULTIES];
  // a laddered room mode (规程's solo): the difficulties its modes have — its mode_single_funny is 极速模拟, not 标准
  const ladder = ladderModes(config, roomMode);
  const list = ladder ? DIFFICULTIES.filter((d) => ladder.some((m) => m.difficulty === d)) : DIFFICULTIES.filter((d) => isObj(modes[modeIdFor(roomMode, d)]));
  return list.length ? list : [...DIFFICULTIES];
}

/**
 * The official modes of a laddered room mode — more than one per difficulty: 规程's solo plays 极速模拟 and 规程等级 1–20
 * (the server's rule: server/versions.js laddered, server/lobby.js ladderMode) — in sortId order, each the config's mode
 * with its `id`; null when the room mode has one mode per difficulty (every 盟约 version, 规程's co-op) or no config.
 * @param {any} config @param {'solo' | 'coop'} roomMode
 * @returns {any[] | null}
 */
export function ladderModes(config, roomMode) {
  const modes = isObj(config?.modes) ? config.modes : null;
  if (!modes) return null;
  const type = roomMode === 'solo' ? 'SINGLE' : 'MULTI';
  const list = Object.entries(modes).filter(([, m]) => isObj(m) && m.type === type).map(([id, m]) => ({ ...m, id }))
    .sort((a, b) => (a.sortId ?? 0) - (b.sortId ?? 0) || (a.id < b.id ? -1 : 1));
  return list.some((m) => m.id !== modeIdFor(roomMode, String(m.difficulty))) ? list : null;
}

/**
 * A laddered room mode's mode to show: `pick` when the ladder has it, else the first of `difficulty`, else the first.
 * @param {any[]} ladder @param {string | null} pick @param {string} difficulty
 */
export function ladderPick(ladder, pick, difficulty) {
  return (ladder.find((m) => m.id === pick) ?? ladder.find((m) => m.difficulty === difficulty) ?? ladder[0])?.id ?? null;
}

/**
 * The difficulty to use when `d` is not offered — the server's rule (protocol §4): the highest offered one below it, else
 * the lowest offered. `d` itself when it is offered.
 * @param {string[]} offered @param {string} d
 */
export function fallbackDifficulty(offered, d) {
  const list = DIFFICULTIES.filter((x) => offered.includes(x));
  if (!list.length || list.includes(d)) return d;
  const i = DIFFICULTIES.indexOf(d);
  const below = list.filter((x) => DIFFICULTIES.indexOf(x) < i);
  return below.length ? below[below.length - 1] : list[0];
}

/**
 * Whether the page has to load a room's content before it may ready (protocol §5 `room.needsContent`): gameplay plugins,
 * or another official version (ui/pluginTag.js isModdedRoom, inlined: this module loads before the interface). @param {any} room
 */
export const needsContent = (room) => !!room && ((!!room.content && room.content.vanilla === false) || typeof room.version === 'string');

/** The activity a version belongs to (its season: 第一期 / 第二期 / 规程), the default's for an unknown id. @param {unknown} id */
export const seasonOf = (id) => versionById(id)?.season ?? DEFAULT_VERSION;

/**
 * The season whose music the screen plays (public/js/audio.js). The title always uses the default season: the entry
 * film is 盟约's and timed to that lobby track (ui/entryFilm.js). The lobby uses the lobby version, or the stored
 * match's while 统计数据 replays it (`replayVersion`). A room — players and spectators — uses the room's version,
 * including a game whose room is another version than the lobby. A game whose room is gone (settlement, `?replay`)
 * uses the match frames' version.
 * @param {any} s the app store's state
 * @returns {string}
 */
export function musicSeason(s) {
  const route = selectRoute(s);
  if (route === 'title') return seasonOf(DEFAULT_VERSION);
  if (route === 'lobby') {
    if (typeof s?.replayVersion === 'string' && versionById(s.replayVersion)) return seasonOf(s.replayVersion);
    return seasonOf(lobbyVersion(s));
  }
  if (s?.room) return seasonOf(roomVersion(s.room));
  if (typeof s?.replayVersion === 'string' && versionById(s.replayVersion)) return seasonOf(s.replayVersion);
  if (s?.match?.public || s?.match?.result) return seasonOf(matchFrameVersion(s.match));
  return seasonOf(DEFAULT_VERSION);
}

/**
 * Whether a version is the default's data (第二期下半) or another's — what `version` the records and logs carry (only a
 * non-default one is written).
 * @param {unknown} id
 */
export const isDefaultVersion = (id) => id == null || id === DEFAULT_VERSION;
