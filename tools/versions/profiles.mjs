// tools/versions/profiles.mjs — load the build profile of an official version (shared/versions.js; docs/DATA.md "Official
// versions (M0)"). A profile is tools/versions/<slug>.mjs:
//   { id, season, section?, source?, pins, adapters, research, tables, pools?, config: { hiddenCore: { single, multi },
//     bans?, rules? }, expect: { bonds, bands, visibleNonDiy, triggerDeviations } }
//   section   the path of the season's tables under activity_table `activity` (omitted = AUTOCHESS_SEASON.<season>, every
//             盟约 build; 规程 keeps one entry per sub-version: ['AUTOCHESS', 'act3autochess', 'V3_1'])
//   source    where the pinned files come from (tools/versions/sources.mjs; omitted = 'kengxxiao')
//   layout    'regulation' (规程: stage atlases of three pieces, road-only templates → the 盟约 19×21 levels,
//             tools/versions/layouts.mjs); omitted = the levels are 盟约's already
//   pins      null (master, .cache/gamedata/) or { default: <sha>, <group>: <sha> … } — the commit of each file group
//             (pinGroupOf), cached in .cache/gamedata@<sha>/ (@aa-<sha>/ for the ArknightsAssets mirror); a run of
//             tools/build-data.mjs --gamedata-commit <sha> reads every file at that one Kengxxiao commit instead (originOf)
//   adapters  names in tools/versions/adapters.mjs, applied in this order to the loaded activity_table
//   research  the version's research directory (falls back to docs/research/, with a warning) or null = docs/research/
//   tables    'default' (the 下半-measured tables of tools/build-data.mjs) or { stock, shopDraft, tacticDraft,
//             bountyDrafts }. Each key is null (left out), 'default' (that one 下半 table), a module id (the named
//             export of tools/versions/tables/<id>.mjs) or the table object itself. All four null = left out.
//   pools     { <pool id>: [charId…] } replaces the operators tools/build-data.mjs writes for a hand-written chess pool,
//             where the version's trait text names others (omitted = the default's)
//   recruitTierExempt  base chess ids whose first-bond communicator can recruit their own normal form above shop level;
//             an opt-in flag, never ordinary shop stock
//   config    hiddenCore thresholds; `bans` { core, addon } for every difficulty, or { [difficulty]: { core, addon } }
//             (omitted = 盟约's per-difficulty counts); `rules` the rule switches a non-default build writes into config.version =
//             { id, family, rules } ({} = the default's rules); equipHand: true separates the 5-slot equipment row
//             from the 10-slot character hand, with hidden overflow (规程 only); optional `finalAssault:
//             { layerGainsEnabled }` is copied into config.finalAssault (omitted = false). 规程 sets it true so boss
//             and hidden fields keep IN_BATTLE layer gains. 联防 is not part of this switch.
//             Optional `economy: { incomeBase, incomeCap, modeIncome?: { [modeId]: { base, cap } } }` — a measured income
//             curve min(base + round, cap) (omitted = 下半's [ASSUMED] min(3 + round, 12)); a mode entry writes
//             modes[modeId].economy.income, merged over the season's by match/gamedata.js (规程 极速模拟).
//   expect    the counts validateAll checks, and maxMB, the size limit of the 15 built files (omitted = 6); triggerDeviations
//             'default' (every deliberate deviation meets its official
//             TAKE_DAMAGE row), 'present' (those of the operators the version has) or 'none' (no TAKE_DAMAGE row at all)

import { VERSIONS, versionById, versionSlug } from '../../shared/versions.js';

/** The four measured tables a profile can turn on one by one (tools/build-data.mjs). */
export const TABLE_NAMES = Object.freeze(['stock', 'shopDraft', 'tacticDraft', 'bountyDrafts']);

/**
 * Why `tables` is not a legal profile value, or null when it is.
 * 'default', or an object whose keys are exactly TABLE_NAMES and whose values are null, 'default', a module id
 * (`tools/versions/tables/<id>.mjs`) or a plain object.
 * @param {unknown} tables
 * @returns {string | null}
 */
export function tableSpecError(tables) {
  if (tables === 'default') return null;
  if (!tables || typeof tables !== 'object' || Array.isArray(tables)) {
    return 'tables must be \'default\' or { stock, shopDraft, tacticDraft, bountyDrafts }';
  }
  for (const k of Object.keys(tables)) {
    if (!TABLE_NAMES.includes(k)) return `tables.${k} is not one of ${TABLE_NAMES.join(', ')}`;
  }
  for (const k of TABLE_NAMES) {
    if (!Object.hasOwn(tables, k)) return `tables.${k} is missing`;
    const v = tables[k];
    if (v === null || v === 'default') continue;
    if (typeof v === 'string') {
      if (!/^[A-Za-z0-9._-]+$/.test(v)) return `tables.${k} module id ${JSON.stringify(v)} is not a safe name`;
      continue;
    }
    if (typeof v === 'object' && !Array.isArray(v)) continue;
    return `tables.${k} must be null, 'default', a module id or an object`;
  }
  return null;
}

/** The official commit a file is read from groups files that change together (pins[group] ?? pins.default). */
const PIN_GROUPS = Object.freeze({
  'excel/activity_table.json': 'activity',
  'excel/character_table.json': 'character',
  'excel/char_patch_table.json': 'character',
  'excel/skill_table.json': 'character',
  'excel/uniequip_table.json': 'character',
  'excel/battle_equip_table.json': 'character',
  'excel/range_table.json': 'range',
  'excel/enemy_handbook_table.json': 'enemy',
  'levels/enemydata/enemy_database.json': 'enemy',
});

/**
 * The pin group of a gamedata path (relative to zh_CN/gamedata/), or null for a file no group names.
 * @param {string} rel
 * @returns {string | null}
 */
export function pinGroupOf(rel) {
  if (Object.hasOwn(PIN_GROUPS, rel)) return PIN_GROUPS[rel];
  if (rel.startsWith('levels/activities/')) return 'levels';
  return null;
}

/**
 * The key of a profile's `pins` that gives a gamedata file its commit (the file's group, else 'default'), or null for
 * master.
 * @param {{ pins: Record<string, string> | null }} profile
 * @param {string} rel
 * @returns {string | null}
 */
export function pinKeyOf(profile, rel) {
  if (!profile.pins) return null;
  const group = pinGroupOf(rel);
  if (group && profile.pins[group]) return group;
  return profile.pins.default ? 'default' : null;
}

/**
 * The commit a profile reads a gamedata file from, or null for master.
 * @param {{ pins: Record<string, string> | null }} profile
 * @param {string} rel
 * @returns {string | null}
 */
export function pinnedShaOf(profile, rel) {
  const key = pinKeyOf(profile, rel);
  return key ? profile.pins[key] : null;
}

/**
 * Why `value` cannot be tools/build-data.mjs --gamedata-commit, or null when it can: a full commit SHA, 40 hex digits
 * (DESIGN §37.323, #567). A branch, a tag or a short SHA is refused: the cache directory <cache>@<sha>/ is keyed by the
 * commit, and a name that moves (or a prefix that may grow ambiguous) would mix files of different commits there.
 * @param {string} value
 * @returns {string | null}
 */
export function commitShaError(value) {
  if (/^[0-9a-f]{40}$/i.test(value)) return null;
  if (/^[0-9a-f]+$/i.test(value)) {
    if (value.length > 40) return `${value.length} hex characters: a full commit SHA has 40`;
    return `a short SHA (${value.length} characters) is refused: give the full 40-character commit, the cache directory <cache>@<sha>/ is keyed by it`;
  }
  return 'not a full commit SHA (40 hex characters): a branch or tag name is refused, it moves, and the cache directory <cache>@<sha>/ is keyed by the commit';
}

/**
 * Where a build reads a gamedata file from, as the build report records it (DESIGN §37.323, #567).
 *   commit  the 40-hex commit, or null for master (the branch head at download time: no SHA is known)
 *   from    'option' (tools/build-data.mjs --gamedata-commit: every file of the run at that Kengxxiao commit, over the
 *           profile's pins and source), 'pin' (the profile's pins) or 'master'
 *   pin     the pins key that gave the commit (pinKeyOf: 'default', 'character' …), null unless from 'pin'
 *   source  a tools/versions/sources.mjs SOURCES key: 'kengxxiao', or the profile's mirror for a pinned file
 * @param {{ pins: Record<string, string> | null, source?: string }} profile
 * @param {string} rel
 * @param {string | null} [commit] the --gamedata-commit SHA, or null
 * @returns {{ commit: string | null, from: 'option' | 'pin' | 'master', pin: string | null, source: string }}
 */
export function originOf(profile, rel, commit = null) {
  if (commit) return { commit, from: 'option', pin: null, source: 'kengxxiao' };
  const pin = pinKeyOf(profile, rel);
  if (!pin) return { commit: null, from: 'master', pin: null, source: 'kengxxiao' };
  return { commit: profile.pins[pin], from: 'pin', pin, source: profile.source ?? 'kengxxiao' };
}

/** The mirror `source` a profile names, or null when it reads Kengxxiao (the default). */
const mirrorSourceOf = (profile) => (profile.source && profile.source !== 'kengxxiao' ? profile.source : null);

/**
 * The note tools/build-data.mjs prints when --gamedata-commit replaces a profile's pins and mirror `source` (DESIGN
 * §37.323: the option wins for every file [ASSUMED]), or null without the option or when the profile has neither.
 * @param {{ pins: Record<string, string> | null, source?: string }} profile
 * @param {string} slug the profile's file name, tools/versions/<slug>.mjs
 * @param {string | null} commit the --gamedata-commit SHA, or null
 * @returns {string | null}
 */
export function commitNote(profile, slug, commit) {
  if (!commit) return null;
  const pins = profile.pins ? Object.entries(profile.pins).map(([k, sha]) => `${k} ${sha.slice(0, 8)}`) : [];
  const source = mirrorSourceOf(profile);
  if (!pins.length && !source) return null;
  const what = [pins.length ? `the pins of tools/versions/${slug}.mjs (${pins.join(', ')})` : '', source ? `its source ${source}` : ''].filter(Boolean).join(' and ');
  return `note: --gamedata-commit ${commit} replaces ${what}: every official file of this run comes from that commit of Kengxxiao/ArknightsGameData`;
}

/**
 * The build report's `gamedata` (DESIGN §37.323, docs/DATA.md "Report"):
 *   commit          the --gamedata-commit SHA, or null
 *   replacedPins    a copy of the profile's pins the option replaced, null without the option or without pins
 *   replacedSource  the profile's mirror `source` the option replaced, null without the option or for Kengxxiao
 *   files           every official file read → its origin (originOf), sorted by path
 *   groups          the same files counted per commit and origin, most files first, then by commit (master first
 *                   among equals): what the printed summary shows (gamedataSummary)
 *   references      only for a mirror profile: the Kengxxiao files its empty {} were checked against, sorted by path
 * @param {{ files: Map<string, ReturnType<typeof originOf>>, references: Map<string, ReturnType<typeof originOf>> }} origins
 *   the files the run read with its own profile, and the reference files read for a mirror
 * @param {{ pins: Record<string, string> | null, source?: string }} profile
 * @param {string | null} commit the --gamedata-commit SHA, or null
 */
export function gamedataReport(origins, profile, commit) {
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const sorted = (map) => Object.fromEntries([...map].sort(([a], [b]) => cmp(a, b)));
  const groups = new Map();
  for (const o of origins.files.values()) {
    const k = JSON.stringify([o.commit, o.from, o.pin, o.source]);
    if (!groups.has(k)) groups.set(k, { ...o, files: 0 });
    groups.get(k).files++;
  }
  const report = {
    commit,
    replacedPins: commit && profile.pins ? { ...profile.pins } : null,
    replacedSource: commit ? mirrorSourceOf(profile) : null,
    files: sorted(origins.files),
    groups: [...groups.values()].sort((a, b) => b.files - a.files || cmp(a.commit ?? '', b.commit ?? '')),
  };
  if (origins.references.size) report.references = sorted(origins.references);
  return report;
}

/**
 * The line tools/build-data.mjs prints after the counts: the official files per commit and origin (the report's
 * gamedata.groups), e.g. `official data: <sha> (pin default): 54 file(s); <sha> (pin character): 4 file(s)`.
 * @param {Array<ReturnType<typeof originOf> & { files: number }>} groups
 * @returns {string}
 */
export function gamedataSummary(groups) {
  const one = (g) => {
    if (g.from === 'master') return `master: ${g.files} file(s)`;
    const why = g.from === 'option' ? '--gamedata-commit' : `pin ${g.pin}${g.source !== 'kengxxiao' ? `, ${g.source}` : ''}`;
    return `${g.commit} (${why}): ${g.files} file(s)`;
  };
  return `official data: ${groups.map(one).join('; ')}`;
}

/**
 * The registry entry and the build profile of a version id. Throws on an unknown id or a profile that does not match
 * its entry.
 * @param {string} id
 */
export async function loadProfile(id) {
  const entry = versionById(id);
  if (!entry) throw new Error(`unknown version ${JSON.stringify(id)} (valid: ${VERSIONS.map((v) => v.id).join(', ')})`);
  const slug = versionSlug(entry);
  const profile = (await import(`./${slug}.mjs`)).default;
  if (!profile || profile.id !== entry.id || profile.season !== entry.season) {
    throw new Error(`tools/versions/${slug}.mjs: id / season ${profile?.id} / ${profile?.season} do not match ${entry.id} / ${entry.season}`);
  }
  return { entry, profile, slug };
}
