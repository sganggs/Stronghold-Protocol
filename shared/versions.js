// shared/versions.js — the official versions this remake can play (DESIGN §35.22, docs/DATA.md "Official versions
// (M0)"). Pure ESM, no Node APIs: the server, the browser and the tools read the same table.
//
//   id         the official activity id (activity_table AUTOCHESS_SEASON key), plus `@<versionInfoDict id>` for a
//              sub-version (autoChessData.versionInfoDict: V1_1 from 2025-11-14 16:00, V1_2 from 2025-11-25 16:00,
//              V2_1 from 2026-03-14 16:00, V2_2 from 2026-03-27 16:00); the id without a suffix is the season's final
//              sub-version
//   season     the activity id the build reads (`config.season` of the built data)
//   family     'covenant' (盟约, AUTOCHESS_SEASON) or 'regulation' (规程, activity.AUTOCHESS: one entry per sub-version,
//              序列Ⅰ = V3_1 from 2026-11-08 16:00): the build adapters and the rule switches of one engine
//   label      a msgid (public/i18n/*.json): the maintainer's names by period (2026-10-22) — 第一期 is act1autochess, the
//              official 「卫戍协议：盟约」 上半期活动, 第二期 act2autochess, its 下半期活动; each period's 上半 / 下半 are its
//              sub-versions V1_1 / V1_2 and V2_1 / V2_2. Not the official activity names [ASSUMED translations]. 规程·序列Ⅰ
//              is the official name of 「卫戍协议·规程」's first sequence (act3autochess V3_1); its id keeps the sub-version
//              suffix, the season still running
//   roomModes  the room modes the version offers
//   dir        where the built data lives under data/: '' for the default (data/*.json, unchanged), otherwise
//              versions/<slug>/ — lowercase and safe on every OS (no '@'); a path or a file name uses versionSlug()
//
// The default is a code constant, never a server setting: data, rooms and logs without a version mean act2autochess.
// The lobby's preselected version is another constant (LOBBY_DEFAULT_VERSION, 规程·序列Ⅰ since 2026-11-09) that a server
// setting may override.
// tools/versions/<slug>.mjs holds each version's build profile (pins, adapters, expected counts). M0 built the data;
// M2 tools bootstrap a selected version per process/worker (DESIGN §35.22.7–§35.22.9). Since M1 (DESIGN §35.23) a
// server serves the versions it enables, plays their rooms in version match hosts, and the page loads their data
// (server/versions.js, public/js/versions.js). Nothing set enables every id here; SP_VERSIONS or the `versions`
// option narrows the list.

import { N_ } from './i18n.js';
import { modeIdFor } from './constants.js';

/** The version every record without one means (today's 第二期下半: act2autochess V2_2). */
export const DEFAULT_VERSION = 'act2autochess';

/**
 * The version a server preselects in the lobby when its configuration names none (server/http/config.js versionsFrom;
 * SP_VERSION_DEFAULT / the `versions.default` option override it): the running official season, 规程·序列Ⅰ (owner
 * 2026-11-09: 「规程做完整后就改成默认」). It is not DEFAULT_VERSION: data, rooms, replays and logs without a version still
 * mean act2autochess, and a server that does not enable it falls back to DEFAULT_VERSION.
 */
export const LOBBY_DEFAULT_VERSION = 'act3autochess@V3_1';

/**
 * @typedef {{ id: string, season: string, family: 'covenant' | 'regulation', label: string, roomModes: readonly string[], dir: string }} OfficialVersion
 */

/** @type {readonly OfficialVersion[]} */
export const VERSIONS = Object.freeze([
  { id: 'act2autochess', season: 'act2autochess', family: 'covenant', label: N_('第二期下半'), roomModes: ['solo', 'coop'], dir: '' },
  { id: 'act2autochess@V2_1', season: 'act2autochess', family: 'covenant', label: N_('第二期上半'), roomModes: ['solo', 'coop'], dir: 'versions/act2autochess-v2_1/' },
  { id: 'act1autochess', season: 'act1autochess', family: 'covenant', label: N_('第一期下半'), roomModes: ['solo', 'coop'], dir: 'versions/act1autochess/' },
  { id: 'act1autochess@V1_1', season: 'act1autochess', family: 'covenant', label: N_('第一期上半'), roomModes: ['solo', 'coop'], dir: 'versions/act1autochess-v1_1/' },
  { id: 'act3autochess@V3_1', season: 'act3autochess', family: 'regulation', label: N_('规程·序列Ⅰ'), roomModes: ['solo', 'coop'], dir: 'versions/act3autochess-v3_1/' },
].map((v) => /** @type {OfficialVersion} */ (Object.freeze({ ...v, roomModes: Object.freeze(v.roomModes) }))));

/**
 * The registry entry of a version id.
 * @param {unknown} id
 * @returns {OfficialVersion | null}
 */
export function versionById(id) {
  return VERSIONS.find((v) => v.id === id) || null;
}

/**
 * The file-system name of a version: the last segment of its dir, or its id for the default ('act2autochess').
 * @param {OfficialVersion} entry
 * @returns {string}
 */
export function versionSlug(entry) {
  if (!entry.dir) return entry.id;
  const parts = entry.dir.split('/').filter(Boolean);
  return parts[parts.length - 1];
}

/**
 * The version a loaded data set belongs to: config.version.id of a non-default build, else the default.
 * @param {{ config?: { version?: { id?: unknown } } } | null | undefined} data
 * @returns {string}
 */
export function versionOfData(data) {
  const id = data?.config?.version?.id;
  return typeof id === 'string' ? id : DEFAULT_VERSION;
}

/**
 * The official mode a room mode plays at a difficulty on a data set (config.modes): its `mode_<type>_<difficulty>` when
 * the config has it with the room mode's type, else the first mode of that type and difficulty in sortId order — 规程's
 * solo ladder (险境 → 规程等级5); a config mode id passes through. null when the config has none. The lobby keeps such a
 * room's mode itself (server/lobby.js ladderMode); tools and benches name a difficulty or a mode id.
 * @param {{ modes?: Record<string, { type?: string, difficulty?: string, sortId?: number }> } | null | undefined} config
 * @param {'solo' | 'coop'} roomMode
 * @param {string} difficultyOrId
 * @returns {string | null}
 */
export function officialModeId(config, roomMode, difficultyOrId) {
  const modes = config?.modes && typeof config.modes === 'object' ? config.modes : {};
  const type = roomMode === 'solo' ? 'SINGLE' : 'MULTI';
  if (modes[difficultyOrId]?.type === type) return difficultyOrId;
  const plain = modeIdFor(roomMode, String(difficultyOrId));
  const list = Object.entries(modes).filter(([, m]) => m?.type === type).sort(([a, x], [b, y]) => (x.sortId ?? 0) - (y.sortId ?? 0) || (a < b ? -1 : 1));
  const laddered = list.some(([id, m]) => id !== modeIdFor(roomMode, String(m.difficulty)));
  if (!laddered && modes[plain]?.type === type) return plain;
  return list.find(([, m]) => m.difficulty === String(difficultyOrId).toUpperCase())?.[0] ?? null;
}
