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
//             (pinGroupOf), cached in .cache/gamedata@<sha>/ (@aa-<sha>/ for the ArknightsAssets mirror)
//   adapters  names in tools/versions/adapters.mjs, applied in this order to the loaded activity_table
//   research  the version's research directory (falls back to docs/research/, with a warning) or null = docs/research/
//   tables    'default' (the 下半-measured tables of tools/build-data.mjs) or { stock, shopDraft, tacticDraft,
//             bountyDrafts }. Each key is null (left out), 'default' (that one 下半 table), a module id (the named
//             export of tools/versions/tables/<id>.mjs) or the table object itself. All four null = left out.
//   pools     { <pool id>: [charId…] } replaces the operators tools/build-data.mjs writes for a hand-written chess pool,
//             where the version's trait text names others (omitted = the default's)
//   config    hiddenCore thresholds; `bans` { core, addon } for every difficulty, or { [difficulty]: { core, addon } }
//             (omitted = 盟约's per-difficulty counts); `rules` the rule switches a non-default build writes into config.version =
//             { id, family, rules } ({} = the default's rules); equipHand: true separates the 5-slot equipment row
//             from the 10-slot character hand, with hidden overflow (规程 only)
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
 * The commit a profile reads a gamedata file from, or null for master.
 * @param {{ pins: Record<string, string> | null }} profile
 * @param {string} rel
 * @returns {string | null}
 */
export function pinnedShaOf(profile, rel) {
  if (!profile.pins) return null;
  const group = pinGroupOf(rel);
  return (group && profile.pins[group]) || profile.pins.default || null;
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
