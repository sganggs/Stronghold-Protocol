// server/plugins/forgeImport.js — import a Forge workshop pack as one or more of our plugins (DESIGN §32.12,
// (i18n-ignore-file: the import report and its reasons are author-facing and bilingual by design, 中文 · English — as
// shared/plugins/errors.js; never player UI)
// docs/PLUGINS.md §16). Forge packs are untrusted: this module only reads bytes. It never import()s, eval()s or
// require()s a file from the pack. The one place a pack's code is written is the sandboxed script plugin of its
// `kits/<id>.js` files (forgeKits.js): parsed and rewritten there, never run here, and run later only where the server
// owner enabled SP_PLUGIN_SCRIPTS and a room selects that plugin.
//
// A pack is a directory or a zip with pack.json at the root (a single wrapping folder is stripped, the same layout
// Forge's own importer accepts). What can be said in our manifest 2 becomes a plugin; everything else is named in
// IMPORT-REPORT.md with a reason in Chinese and in English.
//
// [ASSUMED] choices the author must confirm, also listed in the report:
//   * voices (Forge's default dub, which Forge documents as Japanese) → audio.voiceJp; voiceLangs.cn → audio.voice (ja / en / ko →
//     audio.voiceJp / voiceEn / voiceKr, round 40);
//     en/kr have no table here.
//   * skins[]: an outfit whose id is a skin key becomes that operator's own `skins` variant (docs/PLUGINS.md §9). Once
//     the cosmetic plugin is composed onto the manifest, `public/js/ui/skins.js availableSkins` lists that id and the
//     player wears it with `room.skins` (干员调配 / the 自选 detail, docs/SKINS.md). One with no usable id is collapsed
//     onto that operator's one overlay and is not a picker row.
//   * art.chars takes avatar, avatarE2, portrait, portraitE2 and illust (the full illustration, chars[<charId>].illust);
//     any other field of that record is named and left out.
//   * DEFENDER / HEAVY / GUARDIAN → TANK, VANGUARD → PIONEER, GUARD → WARRIOR.
//   * A missing position is MELEE for tank/warrior/pioneer and RANGED otherwise.
//   * Forge form ranks are phase/level/skillLevel/equipLevel, compared as integers (a plain integer is a rank too).
//     The lowest becomes normal, the highest elite (one rank is copied into both). [ASSUMED]
//   * Skills are taken from the selected form (forms[rank].skills). A form with none uses the record's skills.
//     A skill keeps name, numbers, bb, desc / descRaw, bbStr, skillType, spType, durationType, trigger and its range
//     when their types match; the default is `default` or `isDefault`. Other fields are named and dropped. Talents
//     (named ones, numbers only) and the trait are copied the same way; module talents are named and dropped.
//   * A missing range grid becomes [[0, 0]].
//   * Shop tier follows rarity when it is 1–6.
//   * A 6★ operator declared in operators is 自选 only (as "diy"): records.js writes no shop chess. The compact
//     schema still requires chess.tier, so the file carries the rarity there. Below 6★ in that list is chess.
//     A unit that is not in operators is still emitted as chess, unless a chess.json pair of the pack is its shop
//     piece (then that pair is the record). [ASSUMED]
//   * chess.json: a new _a/_b pair (normal/elite) is one compact record: a shop piece, or 自选 when isDiy and 6★. Its
//     unit is its charId when that is an official operator or a unit of the pack, else an official operator its
//     `assets` name (used for art only). A pair with neither is not imported. One record alone is copied into both
//     forms. A pair with no bond at all gets the fallback bond (协防干员, economy.fallbackBondId), as the studio's
//     operator template does; a pair whose bonds are all unknown here is not imported. Status, merge count, the
//     PRESET chess type and the shop flags come from our economy; a different value in the pack is named. Price and
//     garrisons keep their normal/golden values; sellPrice is kept when both are equal. Modules, potentials,
//     statsBase / traitBase / talentsBase, immunities and summons are named and dropped. [ASSUMED]
//   * Official kits: when every skill id of a record is an official skill of one operator, the record keeps those
//     ids and names that operator's kit (kit.ref): its chess kit for a shop piece (the same default skill, the same
//     tier first), its 自选 kit for a 自选 record. A partial or ambiguous match keeps "generic" and is named. [ASSUMED]
//   * An override array replaces the official array in one set. A finite number inside that array (nested arrays and
//     objects included) that sits outside ±1e9 omits the whole array, and the path is named, the same as a scalar leaf.
//     talents and talentsBase are merged by index in Forge; this version names them and does not replace them.
//   * A chess override's `skill` and the `isDefault` entry of `skills[]` are one object (Forge DATA.md). When the pack
//     supplies skills[], both are written from that entry. A record whose two sides differ is not imported; the rest
//     of the pack is. When skills[] is absent, the skill object is merged onto the official skill (plain objects
//     merge, arrays and scalars replace) and that result is written as skill and as the default skills[] entry. [ASSUMED]
//   * A bond, garrison or bond-member id this installation does not have is named and left out of that list. A list
//     that is then empty is not written, so the official list stays. When a chess override's written bonds list drops
//     an official bond, that chess id is removed from the bond's members and visibleMembers, and the report names
//     those official ids. A bond that joins is added the same way. An empty filtered list does not strip membership.
//     New bonds and new chess ids are not invented. A chess override does not write backup, chessType or status.
//     A garrison override's bbStr.bond and bbStr.bond_id are split on commas. A token that is not a bond id is named
//     and that field is not written; the list is not shortened. A list of known bond ids is still written. [ASSUMED]
//   * Spine clip data is computed during the import by skeletonClipData, the same read `plugin.mjs pack` uses, on a
//     dry run and on a write. Bone, slot, skin and vertex counts above the cap in tools/assets/skel.mjs are refused
//     before the parser allocates. A skeleton that cannot be parsed is named and only that model is dropped. [ASSUMED]
//   * Forge JSON may hold a safe integer outside ±1e9 (a Unix timestamp). That does not reject the file. A number
//     written into game data stays within ±1e9: skill duration, spCost, initSp, maxChargeTime, increment, blackboard
//     numbers, stats, price, sellPrice, and patch leaves, including a number nested in an array leaf. A larger one is
//     named and not written. Written plugin JSON stays within ±1e9. [ASSUMED]
//   * Record ids use the content plugin id (--out's basename when that product is primary, otherwise the pack id).
//   * Two i18n entries that canonicalise to one language are refused (PLUGIN_FORGE_INPUT). They are not merged.
//   * JSON keys __proto__, constructor and prototype are refused before any mapping. Asset trees use Object.create(null).
//   * Every imported file is stored under one extra files/ prefix, so a.png and files/a.png stay distinct.
//   * A cross-device rename (EXDEV) is refused. The import does not copy across devices. [ASSUMED]
//   * A zip larger than pluginBytes + 64 KiB is refused before it is read. [ASSUMED] The 64 KiB is header room.
//   * A directory file with nlink > 1 is refused. The read uses O_NOFOLLOW and checks fstat against lstat. Empty
//     directories count toward the file cap. [ASSUMED] That does not see a file the process is not allowed to stat.
//   * A skill script (.js) is never run by the importer. A `kits/<id>.js` (or the file a record's `kit` names) whose
//     id is a record of the pack, or an official id the pack declares in overrides, is carried into one script
//     plugin `kits-<id>` (forgeKits.js: one self-contained sim entry, imports mapped to sp:sdk@1, the registry's own
//     script check). A `<id>-…` name would share the content plugin's record namespace, which a room refuses. It
//     requires the content plugin at its exact version, registers each kit for the record's new charId (an official
//     override for that official kit id, listed in `overrides`), and runs only with SP_PLUGIN_SCRIPTS and a room
//     that selects it. The record itself keeps "generic" (or its official kit) in the content plugin. --no-scripts
//     leaves the script plugin out. A JSON object that passes validateSkillSpec is kept as kit.spec. No DSL part is
//     written: declaring one makes this version skip the plugin (PLUGIN_DSL_UNAVAILABLE).
//   * A flat { msgid: string } translation becomes a lang plugin. A { version: 1, files } document is content i18n
//     only when every leaf replaces an existing string. zh is the source language and is not a lang plugin.
//   * art.audio is not a documented Forge table. Tracks whose shape matches are still written: bgm lobby|prep|combat|
//     unite|boss, bossBgm as { loop }, sfx.ui / sfx.battle as one file, sfx.units attack|hit|skill|die|born and
//     skills|attacks|hits by index. Any other audio key is named and left out.
//   * client.panels: screen.game.hud and screen.game.aside → hud.right, screen.result.footer → result.tab, and only
//     when the panel does not wrap a component. A panel whose module and its pack-relative .js / .css / .json imports
//     stay inside the caps, and whose static scan uses only the read-only surfaces the shim feeds, is copied. The
//     entry page inlines the shim and a classic bundle. The script is not executed here. Anything else stays a stub,
//     and the report names the unsupported surfaces (PLUGIN_FORGE_PANEL_SCRIPT). [ASSUMED] 256 KB a file, 1 MB a
//     panel, 64 files. A supported panel on root.guide that listens for room.state is shown in room.panel; other
//     supported panels on an unmapped mount use the suggestion slot. Those are not Forge's positions.
//   * client.theme.vars becomes a cosmetic plugin's theme.vars. Only design tokens this installation defines are kept.
//     Every other name is listed as dropped. [ASSUMED] At most 64 variables; later keys are dropped. A pack whose only
//     usable part is its theme is one personal-scope cosmetic. It does not inject a stylesheet.
//   * pack.json notices (announcement or announcements, and credits) become manifest notices: plain text, not HTML.
//     [ASSUMED] The announcement title is version, date and summary (80 characters); the body is each section's name
//     and its items as lines (2000 characters). Credits are their own notice. They are not gameplay. A pack whose only
//     usable part is notices is one personal-scope cosmetic. Notices also ride on a pack that has other products.
//   * Several products share the pack id. content keeps it; a cosmetic beside it is <id>-look; a ui plugin is
//     <id>-<slot>; a lang plugin is <id>-<lang>. --out names the primary folder and its id.
//   * dependencies / conflicts become requires / conflicts when the id becomes a plugin id. An omitted range is "*".
//   * The importer does not look for official art, same as the packer.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { crc32 } from './zip.js';
import { packPlugin, skeletonClipData } from './pack.js';
import { createPluginRegistry } from './registry.js';
import { buildContentSet } from './contentSet.js';
import { createVisualSets } from './visualSet.js';
import { PLUGIN_LIMITS, PLUGIN_MANIFEST, extOf, isPackPath, isPluginId, checkJsonLimits } from '../../shared/plugins/manifest.js';
import { ASSET_CONTAINERS, getPath, isAssetKey, isSkinKey, readAssetOverlay } from '../../shared/plugins/visual.js';
import { namespace, namespaceCollides } from '../../shared/plugins/dataUtils.js';
import { canonicalJson } from '../../shared/plugins/identity.js';
import { validateSkillSpec } from '../../shared/plugins/skillSpec.js';
import { canonicalLang, languageName, SOURCE_LANG } from '../../shared/i18nPacks.js';
import { THEME_VAR_LIMIT, readThemeDeclaration } from '../../shared/plugins/theme.js';
import { NOTICE_LIMITS, readNotices, isNoticeDate } from '../../shared/plugins/notices.js';
import { KITS, OPERATOR_KITS, TIER_KITS } from '../sim/content/kits/index.js';
import { bundleForgeKits } from './forgeKits.js';
import { planForgeRecords, rewriteForgeIds, rewriteForgeKit } from './forgeRecords.js';
import { localOfficialUnits } from './officialUnits.js';
import { ensureOfficialTables } from '../../tools/assets/official-tables.mjs';
import { BOUND_TABLES, rememberOfficialBounds, officialBbRange, officialBbMax } from '../../shared/plugins/officialBounds.js';
import { isStepKey } from '../../shared/plugins/limits.js';
import { FORGE_SHIM_TEXT, forgeDisplaySlot, forgePanelPage, planForgePanel } from './forgePanels.js';
import { readForgeBehaviour } from '../../shared/plugins/rules.js';

const APP_RANGE = '>=0.3.0 <0.4.0';
const DANGER_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** Raw zip bytes, headers included, before any entry is inflated. [ASSUMED] 64 KiB of central-directory room on top of the unpacked cap. */
const ZIP_RAW_MAX = PLUGIN_LIMITS.pluginBytes + 64 * 1024;
const OPEN_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;
const INDEX_MERGE_ARRAYS = new Set(['talents', 'talentsBase']);
const SKILL_KEEP = new Set(['name', 'duration', 'spCost', 'initSp', 'bb', 'desc', 'default', 'isDefault', 'skillId', 'id',
  'descRaw', 'bbStr', 'skillType', 'spType', 'durationType', 'maxChargeTime', 'increment', 'trigger', 'rangeGrid']);
/** The values our data and validate.js accept for these skill fields (data/chess.json, data/backups.json). */
const SKILL_TYPES = new Set(['MANUAL', 'AUTO', 'PASSIVE']);
const SP_TYPES = new Set(['INCREASE_WITH_TIME', 'INCREASE_WHEN_ATTACK', 'INCREASE_WHEN_TAKEN_DAMAGE', 'ON_DEPLOY']);
const DURATION_TYPES = new Set(['NONE', 'AMMO']);
/** Record fields the compact operator can say, with the values official records use. */
const RECORD_ENUMS = { dmgType: new Set(['phys', 'arts', 'heal']), attackKind: new Set(['ranged', 'melee', 'heal', 'none']),
  projectile: new Set(['arrow', 'none', 'bolt', 'orb']), targetPriority: new Set(['fly', 'lowestDef']) };
/** The chess.json fields a pair maps (the rest are named in the report). */
const CHESS_KEEP = new Set(['chessId', 'baseId', 'goldenId', 'isGolden', 'tier', 'identifier', 'isHidden', 'isDiy', 'visible', 'chessType',
  'shopSortId', 'charId', 'name', 'appellation', 'rarity', 'profession', 'subProfessionId', 'subProfessionName', 'position', 'nationId',
  'bonds', 'garrisonIds', 'price', 'sellPrice', 'upgradeNum', 'upgradeChessId', 'status', 'stats', 'rangeGrid', 'trait', 'skill', 'skills', 'tags', 'tokens',
  'talents', 'dmgType', 'attackKind', 'projectile', 'canHitFly', 'targetPriority', 'assets', 'base', 'backup', 'workshop']);
/** The chess kits (the tier groups, keyed by the chess `_a` id). The 自选 kits an import may name are OPERATOR_KITS (charId). */
const CHESS_KIT_KEYS = new Set(TIER_KITS.flatMap((group) => Object.keys(group)));
const SCRIPT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.webp']);
const AUDIO_EXT = new Set(['.mp3', '.ogg']);
const STAT_KEYS = ['maxHp', 'atk', 'def', 'res', 'cost', 'blockCnt', 'bat', 'aspd', 'respawnTime', 'spRecovery', 'hpRecoveryPerSec', 'moveSpeed', 'tauntLevel', 'massLevel', 'deployLimit', 'deckStack'];
const PROFESSIONS = new Set(['PIONEER', 'WARRIOR', 'TANK', 'SNIPER', 'CASTER', 'MEDIC', 'SUPPORT', 'SPECIAL']);
const PROFESSION_ALIAS = { DEFENDER: 'TANK', HEAVY: 'TANK', GUARDIAN: 'TANK', VANGUARD: 'PIONEER', GUARD: 'WARRIOR' };
const MELEE = new Set(['TANK', 'WARRIOR', 'PIONEER']);
const VOICE_SLOT = /^[A-Za-z][A-Za-z0-9]{0,31}$/;
// [ASSUMED] Suggestions describe a possible rewrite, not equivalent mount positions.
const PANEL_REWRITE = { 'root.overlays': 'hud.right', 'root.guide': 'stats.tab', 'screen.game.overlay': 'hud.right',
  'screen.game.shopCard': 'hud.right', 'screen.game.bondStrip': 'hud.right', 'screen.loadout.detail': 'room.panel' };
const CONTENT_NAMES = ['chess', 'units', 'items', 'enemies', 'stages', 'waves', 'tokens', 'bosses', 'factions', 'garrisons', 'bands', 'bonds', 'effects', 'choices', 'traits'];
const PATCH_TABLE = {
  bonds: 'bonds', enemies: 'enemies', chess: 'chess', items: 'items', stages: 'stages', waves: 'waves', bands: 'bands',
  effects: 'effects', tokens: 'tokens', garrisons: 'garrisons', bosses: 'bosses', factions: 'factions', choices: 'choices',
};
const CHAR_FIELDS = new Set(['avatar', 'avatarE2', 'portrait', 'portraitE2', 'illust']);
const SKIP_TOP = {
  server: ['这是服务端逻辑（会改协议或对局），不能导入。', 'This is server logic (it would change the protocol or the match) and cannot be imported.'],
  routes: ['没有只读的 HTTP 路由这类插件，不能导入。', 'There is no read-only HTTP-route plugin class, so this cannot be imported.'],
  assets: ['这是要替换的引擎资源容器（.spresources），不是一张能叠加的图，不能导入。', 'This replaces an engine resource container (.spresources), not a picture the overlay can carry, so it cannot be imported.'],
  forms: ['这是动画形态的行为声明，不是素材文件，不能导入。', 'This declares clip-set behaviour, not an asset file, so it cannot be imported.'],
  fx: ['这是特效相位的行为声明，不能导入。', 'This declares effect-phase behaviour and cannot be imported.'],
  variants: ['这是引擎里的口径开关，不是模式数据，不能导入。', 'This is an engine variant switch, not mode data, so it cannot be imported.'],
  behaviour: ['这是引擎里已经写死的行为开关，不能导入。', 'This selects an engine behaviour switch and cannot be imported.'],
  playtest: ['这是试玩名单，不是可以带进对局的数据，不能导入。', 'This is a playtest list, not data a match can load, so it cannot be imported.'],
  support: ['这是助战卡池规则，不是干员数据，不能导入。', 'This is the assist-pool rule, not operator data, so it cannot be imported.'],
  combat: ['这是战斗引擎的开关，不是数据，不能导入。', 'This is a combat-engine flag, not data, so it cannot be imported.'],
  layer: ['这是 Forge 的加载层声明，我们的清单没有这一格，不能导入。', 'This is Forge\'s loader-layer flag. Our manifest has no such field, so it cannot be imported.'],
};

/** @param {string} code @param {string} detail */
export class ForgeImportError extends Error {
  constructor(code, detail) {
    super(detail);
    this.code = code;
    this.detail = detail;
  }
}
const fail = (code, detail) => { throw new ForgeImportError(code, detail); };

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/** Recursively sort object keys so --json is byte-stable. Arrays keep their order. */
export function stableJson(value) {
  if (Array.isArray(value)) return value.map(stableJson);
  if (!isObj(value)) return value;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of Object.keys(value).sort()) out[k] = stableJson(value[k]);
  return out;
}

/**
 * A Forge pack id (or a --id) as a plugin id: lower case, "_" → "-", other runs → one "-".
 * @param {unknown} raw
 * @returns {string | null}
 */
export function forgeIdToPluginId(raw) {
  const s = String(raw ?? '').trim().toLowerCase().replace(/_/g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return isPluginId(s) ? s : null;
}

function rangeOk(v) {
  if (v === '*') return true;
  if (typeof v !== 'string' || !v.trim() || v.length > 60) return false;
  const token = /^(\*|x|(\^|~|>=|<=|>|<|=)?v?\d+(?:\.(?:\d+|[xX*]))?(?:\.(?:\d+|[xX*]))?)$/;
  return v.trim().split(/\s+/).every((t) => token.test(t));
}

function fit(base, suffix) {
  const room = 32 - suffix.length;
  if (room < 2) return null;
  const stem = base.slice(0, room).replace(/-+$/g, '');
  if (stem.length < 2) return null;
  const id = `${stem}${suffix}`;
  return isPluginId(id) ? id : null;
}

function fitPrefix(prefix, base) {
  const id = `${prefix}${base}`.slice(0, 32).replace(/-+$/g, '');
  return id.length > prefix.length && isPluginId(id) ? id : null;
}

/** @param {string} base @param {string[]} roles @param {string | null} primaryName */
function allocateIds(base, roles, primaryName) {
  const primary = roles.includes('content') ? 'content' : roles.includes('cosmetic') ? 'cosmetic' : roles[0];
  if (primaryName && !isPluginId(primaryName)) return { error: `"${primaryName}" is not a plugin id` };
  const used = new Set();
  const take = (want) => {
    let id = want;
    let n = 2;
    while (!id || !isPluginId(id) || used.has(id)) {
      const tail = `-${n++}`;
      const stem = String(want || base).slice(0, 32 - tail.length).replace(/-+$/g, '');
      id = `${stem}${tail}`;
      if (n > 80) return null;
    }
    used.add(id);
    return id;
  };
  /** @type {Record<string, string>} */
  const ids = {};
  ids[primary] = take(primaryName || base);
  for (const role of roles) {
    if (ids[role]) continue;
    if (role === 'script') {
      // [ASSUMED] kits-<id>: a room composes it with the content plugin, and a `<id>-…` name shares that plugin's record
      // namespace (data-utils namespaceCollides → PLUGIN_RECORD_ID). The prefix keeps the two apart.
      const stem = primaryName || base;
      const id = ['kits-', 'forge-kits-', 'kits2-'].map((prefix) => fitPrefix(prefix, stem) || fitPrefix(prefix, base))
        .find((want) => want && !used.has(want) && !Object.values(ids).some((other) => namespaceCollides(other, want)));
      if (!id) return { error: `no plugin id left for ${role}` };
      used.add(id);
      ids[role] = id;
      continue;
    }
    let suffix = '-x';
    if (role === 'cosmetic') suffix = '-look';
    else if (role.startsWith('ui:')) suffix = `-${role.slice(3).replace(/\./g, '-')}`;
    else if (role.startsWith('lang:')) suffix = `-${role.slice(5).toLowerCase()}`;
    const id = take(fit(primaryName || base, suffix) || fit(base, suffix));
    if (!id) return { error: `no plugin id left for ${role}` };
    ids[role] = id;
  }
  return { ids, primary };
}

function unsafeZipName(name) {
  if (typeof name !== 'string' || !name || name.includes('\0')) return 'empty name or NUL';
  if (name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/.test(name)) return 'absolute path';
  const parts = name.split(/[/\\]/);
  if (parts.some((p) => p === '..' || p === '.')) return 'path escapes the pack';
  if (name.includes('\\')) return 'backslash in the name';
  return null;
}

/** A file map the caller already read (the studio upload). Same name and size rules as a zip; nothing is executed. */
function assertSafeNames(files) {
  if (!(files instanceof Map)) fail('PLUGIN_FORGE_INPUT', 'files are not a map');
  if (files.size > PLUGIN_LIMITS.files) fail('PLUGIN_FORGE_ZIP', `more than ${PLUGIN_LIMITS.files} files`);
  let total = 0;
  /** @type {string[]} */
  const names = [];
  const seen = new Map();
  for (const [name, data] of files) {
    const why = unsafeZipName(name);
    if (why) fail('PLUGIN_FORGE_ZIP', `${String(name).slice(0, 80)}: ${why}`);
    if (!Buffer.isBuffer(data)) fail('PLUGIN_FORGE_INPUT', `${String(name).slice(0, 80)}: not bytes`);
    noteCase(seen, name);
    names.push(name);
    total += data.length;
    if (data.length > PLUGIN_LIMITS.pluginBytes || total > PLUGIN_LIMITS.pluginBytes) fail('PLUGIN_FORGE_ZIP', `${String(name).slice(0, 80)}: larger than ${PLUGIN_LIMITS.pluginBytes} bytes`);
  }
  assertNoPrefixClash(names);
}

/** Case-folded archive names. `art/` and `art/x.png` are different; `Art.png` and `art.png` are not. */
function noteCase(seen, name) {
  const bare = String(name).replace(/\/+$/, '');
  const key = bare.toLowerCase();
  if (!key) return;
  const prev = seen.get(key);
  if (prev != null && prev !== bare) fail('PLUGIN_FORGE_ZIP', `${String(name).slice(0, 80)}: another entry differs only by case`);
  seen.set(key, bare);
}

/** A file path must not be a directory prefix of another file path. Directory entries are not in `names`. */
function assertNoPrefixClash(names) {
  const list = [...names].map((n) => String(n).replace(/\/+$/, '')).filter(Boolean).sort();
  for (let i = 1; i < list.length; i++) {
    if (list[i].startsWith(`${list[i - 1]}/`)) fail('PLUGIN_FORGE_ZIP', `${list[i - 1]}: a file path is a prefix of ${list[i]}`);
  }
}

function assertNameSet(fileNames, dirNames = []) {
  const seen = new Map();
  for (const name of [...dirNames, ...fileNames]) noteCase(seen, name);
  assertNoPrefixClash(fileNames);
}

/**
 * Move every product, then the report is already inside the primary folder. On any failure, remove only the
 * destinations this attempt created. A folder that was already there is left in place. EXDEV is a failure: a copy
 * would not be one atomic commit. [ASSUMED]
 * @returns {{ code: string, detail: string } | null}
 */
function commitProducts(stage, parent, products, primaryId, markdown, repack = null) {
  /** @type {string[]} */
  const created = [];
  try {
    fs.writeFileSync(path.join(stage, primaryId, 'IMPORT-REPORT.md'), markdown);
    // A script plugin runs only with a lock that lists every file, the report included (registry readScripts).
    if (repack) repack(path.join(stage, primaryId));
    for (const p of products) {
      const dest = path.join(parent, p.id);
      if (fs.existsSync(dest)) {
        const err = new Error('exists');
        err.code = 'EEXIST';
        throw err;
      }
      fs.renameSync(path.join(stage, p.id), dest);
      created.push(dest);
    }
    return null;
  } catch (e) {
    for (const dest of [...created].reverse()) {
      try { fs.rmSync(dest, { recursive: true, force: true }); } catch { /* the caller reports the write error */ }
    }
    if (e instanceof ForgeImportError) return { code: e.code, detail: e.detail };
    const fsCode = typeof e?.code === 'string' && /^E[A-Z0-9]+$/.test(e.code) ? e.code : 'error';
    return { code: 'PLUGIN_FORGE_ZIP', detail: `the import could not be written (${fsCode})` };
  }
}

/** Installed plugins and the staged products, as a registry can see both. The source pack is not linked in. */
function openValidationView({ root, dataDir, pluginsDir, stage }) {
  const view = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-view-'));
  try {
    const take = (name, abs) => {
      if (!name || name.startsWith('.') || name.startsWith('_')) return;
      const dest = path.join(view, name);
      if (fs.existsSync(dest)) return;
      let st;
      try { st = fs.statSync(abs); } catch { return; }
      if (!st.isDirectory()) return;
      if (!fs.existsSync(path.join(abs, PLUGIN_MANIFEST))) return;
      fs.symlinkSync(abs, dest);
    };
    if (pluginsDir && fs.existsSync(pluginsDir)) {
      for (const name of fs.readdirSync(pluginsDir)) take(name, path.join(pluginsDir, name));
    }
    for (const name of fs.readdirSync(stage)) take(name, path.join(stage, name));
    const registry = createPluginRegistry({
      publicDir: path.join(root, 'public'), packsDir: path.join(root, 'packs'), pluginsDir: view, dataDir,
    }, { recheckMs: 0, log: { info() {}, warn() {} } });
    return { registry, view };
  } catch (e) {
    fs.rmSync(view, { recursive: true, force: true });
    throw e;
  }
}

function inflateCapped(raw, cap) {
  return new Promise((resolve, reject) => {
    const inf = zlib.createInflateRaw();
    const chunks = [];
    let total = 0;
    let failed = false;
    const stop = (e) => { if (failed) return; failed = true; try { inf.destroy(); } catch { /* already closed */ } reject(e); };
    inf.on('data', (c) => {
      if (failed) return;
      total += c.length;
      if (total > cap) { stop(new ForgeImportError('PLUGIN_FORGE_ZIP', `uncompressed size exceeds ${cap} bytes`)); return; }
      chunks.push(Buffer.from(c));
    });
    inf.on('error', (e) => stop(new ForgeImportError('PLUGIN_FORGE_ZIP', `deflate: ${e.message}`)));
    inf.on('end', () => { if (!failed) resolve(Buffer.concat(chunks, total)); });
    inf.end(raw);
  });
}

/**
 * Entries of an untrusted zip: central-directory names only, no symlink, no path escape, sizes capped at PLUGIN_LIMITS.
 * A single wrapping directory that itself holds pack.json is removed.
 * @param {Buffer} zip
 * @returns {Promise<Map<string, Buffer>>}
 */
/** EOCD whose comment length lands on the end of the buffer. A PK\\x05\\x06 inside an entry is not an EOCD. */
function findEocd(zip) {
  const maxBack = Math.min(zip.length, 22 + 0xffff);
  const start = zip.length - maxBack;
  for (let i = zip.length - 22; i >= start; i--) {
    if (zip.readUInt32LE(i) !== 0x06054b50) continue;
    const commentLen = zip.readUInt16LE(i + 20);
    if (i + 22 + commentLen === zip.length) return i;
  }
  return -1;
}

async function readZipEntries(zip) {
  if (!Buffer.isBuffer(zip) || zip.length < 22) fail('PLUGIN_FORGE_ZIP', 'not a zip archive');
  if (zip.length > ZIP_RAW_MAX) fail('PLUGIN_FORGE_ZIP', `larger than ${ZIP_RAW_MAX} bytes`);
  const endAt = findEocd(zip);
  if (endAt < 0) fail('PLUGIN_FORGE_ZIP', 'not a zip archive');
  // The ZIP64 locator is the 20 bytes immediately before a real EOCD, not a magic number somewhere in an entry.
  if (endAt >= 20 && zip.readUInt32LE(endAt - 20) === 0x07064b50) fail('PLUGIN_FORGE_ZIP', 'ZIP64 is not accepted');
  const count = zip.readUInt16LE(endAt + 10);
  const cdSize = zip.readUInt32LE(endAt + 12);
  const cdOff = zip.readUInt32LE(endAt + 16);
  if (count === 0xffff || cdOff === 0xffffffff || cdSize === 0xffffffff) fail('PLUGIN_FORGE_ZIP', 'ZIP64 is not accepted');
  if (count > PLUGIN_LIMITS.files) fail('PLUGIN_FORGE_ZIP', `more than ${PLUGIN_LIMITS.files} files`);
  if (cdOff > zip.length || cdSize > zip.length - cdOff) fail('PLUGIN_FORGE_ZIP', 'central directory is outside the file');
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  /** @type {string[]} */
  const dirNames = [];
  let p = cdOff;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cdOff + cdSize || zip.readUInt32LE(p) !== 0x02014b50) fail('PLUGIN_FORGE_ZIP', 'broken central directory');
    const flags = zip.readUInt16LE(p + 8);
    const method = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const compSize = zip.readUInt32LE(p + 20);
    const rawSize = zip.readUInt32LE(p + 24);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const external = zip.readUInt32LE(p + 38);
    const local = zip.readUInt32LE(p + 42);
    if (p + 46 + nameLen + extraLen + commentLen > cdOff + cdSize) fail('PLUGIN_FORGE_ZIP', 'broken central directory');
    const name = zip.toString('utf8', p + 46, p + 46 + nameLen);
    const extraAt = p + 46 + nameLen;
    p += 46 + nameLen + extraLen + commentLen;
    if (extraLen > 0) {
      const extra = zip.subarray(extraAt, extraAt + extraLen);
      for (let e = 0; e + 4 <= extra.length;) {
        const id = extra.readUInt16LE(e);
        const sz = extra.readUInt16LE(e + 2);
        if (e + 4 + sz > extra.length) fail('PLUGIN_FORGE_ZIP', `${name.slice(0, 80)}: broken extra field`);
        if (id === 0x0001) fail('PLUGIN_FORGE_ZIP', 'ZIP64 is not accepted');
        e += 4 + sz;
      }
    }
    const why = unsafeZipName(name);
    if (why) fail('PLUGIN_FORGE_ZIP', `${name.slice(0, 80)}: ${why}`);
    if (name.endsWith('/')) { dirNames.push(name); continue; }
    const mode = (external >>> 16) & 0o170000;
    if (mode === 0o120000) fail('PLUGIN_FORGE_ZIP', `${name.slice(0, 80)}: symbolic link`);
    if (flags & 0x1) fail('PLUGIN_FORGE_ZIP', `${name.slice(0, 80)}: encrypted`);
    if (flags & 0x8) fail('PLUGIN_FORGE_ZIP', `${name.slice(0, 80)}: data descriptor (size not in the header)`);
    if (rawSize > PLUGIN_LIMITS.pluginBytes || compSize > PLUGIN_LIMITS.pluginBytes) fail('PLUGIN_FORGE_ZIP', `${name.slice(0, 80)}: larger than ${PLUGIN_LIMITS.pluginBytes} bytes`);
    if (total + rawSize > PLUGIN_LIMITS.pluginBytes) fail('PLUGIN_FORGE_ZIP', `more than ${PLUGIN_LIMITS.pluginBytes} bytes uncompressed`);
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) fail('PLUGIN_FORGE_ZIP', `${name.slice(0, 80)}: broken local header`);
    const lMethod = zip.readUInt16LE(local + 8);
    const lCrc = zip.readUInt32LE(local + 14);
    const lComp = zip.readUInt32LE(local + 18);
    const lRaw = zip.readUInt32LE(local + 22);
    const lName = zip.readUInt16LE(local + 26);
    const lExtra = zip.readUInt16LE(local + 28);
    const start = local + 30 + lName + lExtra;
    if (start + compSize > zip.length) fail('PLUGIN_FORGE_ZIP', `${name.slice(0, 80)}: truncated`);
    if (local + 30 + lName > zip.length) fail('PLUGIN_FORGE_ZIP', `${name.slice(0, 80)}: broken local header`);
    const lNameStr = zip.toString('utf8', local + 30, local + 30 + lName);
    if (lNameStr !== name || lMethod !== method || lCrc !== crc || lComp !== compSize || lRaw !== rawSize) {
      fail('PLUGIN_FORGE_ZIP', `${name.slice(0, 80)}: local header does not match the central directory`);
    }
    const stored = zip.subarray(start, start + compSize);
    let data;
    if (method === 0) {
      if (stored.length !== rawSize) fail('PLUGIN_FORGE_ZIP', `${name.slice(0, 80)}: stored size does not match`);
      data = Buffer.from(stored);
    } else if (method === 8) {
      data = await inflateCapped(stored, rawSize);
      if (data.length !== rawSize) fail('PLUGIN_FORGE_ZIP', `${name.slice(0, 80)}: uncompressed size does not match`);
    } else fail('PLUGIN_FORGE_ZIP', `${name.slice(0, 80)}: compression method ${method} is not supported`);
    if (crc32(data) !== crc) fail('PLUGIN_FORGE_ZIP', `${name.slice(0, 80)}: CRC mismatch`);
    if (files.has(name)) fail('PLUGIN_FORGE_ZIP', `${name.slice(0, 80)}: duplicate name`);
    files.set(name, data);
    total += data.length;
  }
  if (p !== cdOff + cdSize) fail('PLUGIN_FORGE_ZIP', 'central directory size does not match');
  assertNameSet([...files.keys()], dirNames);
  return stripWrapper(files);
}

export async function readUntrustedZip(zip) {
  try {
    return await readZipEntries(zip);
  } catch (e) {
    if (e instanceof ForgeImportError) throw e;
    fail('PLUGIN_FORGE_ZIP', 'the pack could not be read');
  }
}

/** @param {Map<string, Buffer>} files */
function stripWrapper(files) {
  if (files.has('pack.json')) return files;
  const tops = new Set([...files.keys()].map((n) => n.split('/')[0]));
  if (tops.size !== 1) return files;
  const top = [...tops][0];
  if (!files.has(`${top}/pack.json`)) return files;
  const out = new Map();
  for (const [n, d] of files) if (n.length > top.length + 1) out.set(n.slice(top.length + 1), d);
  assertNoPrefixClash(out.keys());
  return out;
}

/**
 * A directory of untrusted files. Symbolic links are refused (not followed). Sizes use PLUGIN_LIMITS.
 * @param {string} dir
 * @returns {Map<string, Buffer>}
 */
export function readUntrustedDir(dir) {
  let root;
  try { root = fs.realpathSync(dir); } catch { fail('PLUGIN_FORGE_INPUT', 'not a directory'); }
  const st = fs.lstatSync(dir);
  if (st.isSymbolicLink()) fail('PLUGIN_FORGE_ZIP', 'the pack directory is a symbolic link');
  if (!st.isDirectory()) fail('PLUGIN_FORGE_INPUT', 'not a directory');
  /** @type {Map<string, Buffer>} */
  const files = new Map();
  const caseNames = new Map();
  let count = 0;
  let total = 0;
  const walk = (abs, rel) => {
    const cur = fs.lstatSync(abs);
    if (cur.isSymbolicLink()) fail('PLUGIN_FORGE_ZIP', `${rel || '.'}: symbolic link`);
    if (cur.isDirectory()) {
      if (rel) {
        noteCase(caseNames, rel);
        count += 1;
        if (count > PLUGIN_LIMITS.files) fail('PLUGIN_FORGE_ZIP', `more than ${PLUGIN_LIMITS.files} files`);
        if (rel.split('/').length > 32) fail('PLUGIN_FORGE_ZIP', `${rel}: nested too deep`);
      }
      for (const name of fs.readdirSync(abs)) {
        if (name === '.' || name === '..') continue;
        walk(path.join(abs, name), rel ? `${rel}/${name}` : name);
      }
      return;
    }
    if (!cur.isFile()) fail('PLUGIN_FORGE_ZIP', `${rel}: not a regular file`);
    if (cur.nlink > 1) fail('PLUGIN_FORGE_ZIP', `${rel}: hard link`);
    noteCase(caseNames, rel);
    count += 1;
    if (count > PLUGIN_LIMITS.files) fail('PLUGIN_FORGE_ZIP', `more than ${PLUGIN_LIMITS.files} files`);
    if (cur.size > PLUGIN_LIMITS.pluginBytes || total + cur.size > PLUGIN_LIMITS.pluginBytes) fail('PLUGIN_FORGE_ZIP', `${rel}: larger than ${PLUGIN_LIMITS.pluginBytes} bytes`);
    const why = unsafeZipName(rel);
    if (why) fail('PLUGIN_FORGE_ZIP', `${rel}: ${why}`);
    let fd;
    try { fd = fs.openSync(abs, fs.constants.O_RDONLY | OPEN_NOFOLLOW); }
    catch { fail('PLUGIN_FORGE_ZIP', `${rel}: not a regular file`); }
    try {
      const st = fs.fstatSync(fd);
      if (!st.isFile() || st.ino !== cur.ino || st.size !== cur.size || st.nlink !== cur.nlink || st.nlink > 1) {
        fail('PLUGIN_FORGE_ZIP', `${rel}: the file changed while it was read`);
      }
      const data = fs.readFileSync(fd);
      if (data.length !== st.size) fail('PLUGIN_FORGE_ZIP', `${rel}: the file changed while it was read`);
      files.set(rel, data);
      total += data.length;
    } finally { fs.closeSync(fd); }
  };
  walk(root, '');
  assertNoPrefixClash(files.keys());
  return stripWrapper(files);
}

function assertSafeKeys(value, label, depth = 0) {
  if (depth > PLUGIN_LIMITS.jsonDepth || !value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) if (item && typeof item === 'object') assertSafeKeys(item, label, depth + 1);
    return;
  }
  for (const k of Object.keys(value)) {
    if (DANGER_KEYS.has(k)) fail('PLUGIN_FORGE_JSON', `${label}: key "${k}" is not allowed`);
    const child = value[k];
    if (child && typeof child === 'object') assertSafeKeys(child, label, depth + 1);
  }
}

function readJsonBuf(buf, label) {
  if (buf.length > PLUGIN_LIMITS.jsonBytes) fail('PLUGIN_FORGE_JSON', `${label}: larger than ${PLUGIN_LIMITS.jsonBytes} bytes`);
  let value;
  try { value = JSON.parse(buf.toString('utf8')); } catch (e) { fail('PLUGIN_FORGE_JSON', `${label}: ${e instanceof SyntaxError ? e.message : e.code || 'unreadable'}`); }
  // Safe integers past ±1e9 stay readable (a Unix timestamp on a field that is not imported). Written plugin JSON
  // and every number copied into game data still use the ±1e9 window.
  const bad = checkJsonLimits(value, { numbers: 'safe' });
  if (bad) fail('PLUGIN_FORGE_JSON', `${label}: ${bad}`);
  assertSafeKeys(value, label);
  return value;
}

function lookup(files, rel) {
  const norm = String(rel || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!norm || unsafeZipName(norm)) return null;
  if (files.has(norm)) return norm;
  if (files.has(`assets/${norm}`)) return `assets/${norm}`;
  return null;
}

function destOf(rel) {
  const clean = String(rel).split('/').filter((s) => s && s !== '.' && s !== '..').join('/');
  if (!clean) return null;
  // Always one more files/ prefix, including when the source is already under files/, so a.png and files/a.png differ.
  const under = `files/${clean}`;
  return isPackPath(under) ? under : null;
}

/** @param {Map<string, Buffer>} files @param {Set<string>} used @param {unknown} rel */
function takeMedia(files, used, rel, kind) {
  if (typeof rel !== 'string') return null;
  const found = lookup(files, rel);
  if (!found) return null;
  const ext = extOf(found);
  const ok = kind === 'image' ? IMAGE_EXT.has(ext) : kind === 'audio' ? AUDIO_EXT.has(ext) : kind === 'spine' ? (ext === '.skel' || ext === '.atlas' || IMAGE_EXT.has(ext)) : false;
  if (!ok) return { error: ext || 'no extension' };
  const dest = destOf(found);
  if (!dest) return { error: 'path' };
  used.add(found);
  return { src: found, dest, data: files.get(found) };
}

function setAt(root, keys, value) {
  if (!keys.length || keys.some((k) => typeof k !== 'string' || DANGER_KEYS.has(k))) fail('PLUGIN_FORGE_INPUT', 'a key is not an own property name');
  let n = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const k = keys[i];
    if (!has(n, k) || !isObj(n[k])) n[k] = Object.create(null);
    n = n[k];
  }
  n[keys[keys.length - 1]] = value;
}

function textOf(v, depth = 0) {
  if (depth > 8) return '';
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map((x) => textOf(x, depth + 1)).filter(Boolean).join('\n');
  if (!isObj(v)) return '';
  const preferred = ['title', 'text', 'body', 'name', 'credit', 'credits', 'content'];
  const parts = [];
  for (const k of preferred) if (typeof v[k] === 'string') parts.push(v[k].trim());
  if (!parts.length) for (const x of Object.values(v)) { const t = textOf(x, depth + 1); if (t) parts.push(t); }
  return parts.join('\n');
}

/** Code points, so a sliced title still matches the notice grammar. */
function sliceChars(s, n) {
  const chars = [...String(s ?? '')];
  return chars.length <= n ? chars.join('') : chars.slice(0, n).join('');
}

/** Drop controls other than newline and tab. A title also loses newlines. */
function scrubNotice(s, title) {
  let t = String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (title) t = t.replace(/[\r\n]+/g, ' ').replace(/[ \t]+/g, ' ').trim();
  return t;
}

/**
 * The file a notice field names, or the inline value itself. Marks the file used. Missing paths are dropped.
 * @returns {{ json: any, text: string, missing?: boolean }}
 */
function noticeDoc(files, used, value) {
  if (typeof value === 'string') {
    const found = lookup(files, value);
    if (!found) return { json: null, text: value.trim(), missing: true };
    used.add(found);
    const buf = files.get(found);
    if (extOf(found) !== '.json') return { json: null, text: buf.toString('utf8') };
    const json = readJsonBuf(buf, found);
    return { json, text: textOf(json) };
  }
  return { json: value, text: textOf(value) };
}

function touchNotice(files, used, value) {
  if (typeof value !== 'string') return;
  const found = lookup(files, value);
  if (found) used.add(found);
}

/** One notice the grammar accepts, or null. */
function acceptNotice(item) {
  const read = readNotices([item]);
  return read.notices && read.notices.length === 1 ? read.notices[0] : null;
}

/**
 * Forge announcement.json → one notice. [ASSUMED] title is version · date · summary; body is section names and items.
 * @param {unknown} doc
 */
function announcementFrom(doc) {
  const src = Array.isArray(doc) ? doc.find((x) => isObj(x)) : doc;
  if (typeof doc === 'string' || typeof src === 'string') {
    const body = sliceChars(scrubNotice(typeof doc === 'string' ? doc : src).trim(), NOTICE_LIMITS.body);
    if (!body.trim()) return null;
    return acceptNotice({ id: 'announcement', title: '公告', body });
  }
  if (!isObj(src)) return null;
  const version = typeof src.version === 'string' ? scrubNotice(src.version, true) : '';
  const date = typeof src.date === 'string' && isNoticeDate(src.date.trim()) ? src.date.trim() : '';
  const summary = typeof src.summary === 'string' ? scrubNotice(src.summary, true) : '';
  const title = sliceChars([version, date, summary].filter(Boolean).join(' · '), NOTICE_LIMITS.title) || '公告';
  const lines = [];
  const sections = Array.isArray(src.sections) ? src.sections : [];
  for (const sec of sections) {
    if (!isObj(sec)) continue;
    const name = typeof sec.name === 'string' ? scrubNotice(sec.name, true) : '';
    if (name) lines.push(name);
    const items = Array.isArray(sec.items) ? sec.items : [];
    for (const item of items) {
      const line = scrubNotice(typeof item === 'string' ? item : textOf(item)).trim();
      if (line) lines.push(line);
    }
  }
  let body = lines.join('\n').trim();
  if (!body) body = summary;
  body = sliceChars(body, NOTICE_LIMITS.body).trim();
  if (!body) return null;
  /** @type {Record<string, unknown>} */
  const item = { id: 'announcement', title, body };
  if (date) item.date = date;
  return acceptNotice(item);
}

/**
 * Forge credits.json → one notice. [ASSUMED] Each line is `name — note`, and a url is text on the next line.
 * The title is translated; the body is the same in every language.
 * @param {unknown} doc
 */
function creditsFrom(doc) {
  const rows = Array.isArray(doc) ? doc : typeof doc === 'string' ? [doc] : isObj(doc) ? [doc] : [];
  const lines = [];
  for (const row of rows) {
    if (typeof row === 'string') {
      const t = scrubNotice(row).trim();
      if (t) lines.push(t);
      continue;
    }
    if (!isObj(row)) continue;
    const name = typeof row.name === 'string' ? scrubNotice(row.name, true) : '';
    const note = typeof row.note === 'string' ? scrubNotice(row.note, true) : '';
    const url = typeof row.url === 'string' ? scrubNotice(row.url, true) : '';
    let line = name;
    if (note) line = line ? `${line} — ${note}` : note;
    if (url) line = line ? `${line}\n${url}` : url;
    if (line.trim()) lines.push(line.trim());
  }
  const body = sliceChars(lines.join('\n').trim(), NOTICE_LIMITS.body);
  if (!body.trim()) return null;
  return acceptNotice({
    id: 'credits', title: '鸣谢', body,
    i18n: {
      en: { title: 'Credits', body },
      ja: { title: 'クレジット', body },
      ko: { title: '크레딧', body },
      'zh-TW': { title: '鳴謝', body },
    },
  });
}

/** Why one Forge theme variable was not kept. @param {string} code @param {string} name */
function themeDrop(code, name) {
  if (code === 'PLUGIN_THEME_URL') return ['主题变量写了网址，没有导入。', 'A theme variable names a URL, so it was not imported.'];
  if (code === 'PLUGIN_THEME_NAME') return [`主题变量「${name}」不是本安装的设计变量，没有导入。`, `Theme variable "${name}" is not a design token of this installation, so it was not imported.`];
  if (code === 'PLUGIN_THEME_VALUE') return [`主题变量「${name}」的值不符合这种变量，没有导入。`, `Theme variable "${name}" has a value this token does not allow, so it was not imported.`];
  if (code === 'PLUGIN_THEME_LIMIT') return [`主题变量「${name}」超过 64 个的上限，没有导入。`, `Theme variable "${name}" is past the limit of 64, so it was not imported.`];
  return ['主题变量写不进清单，没有导入。', 'A theme variable does not fit the manifest, so it was not imported.'];
}

function semverOf(v) {
  return typeof v === 'string' && /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(v.trim()) ? v.trim() : null;
}

function slug(s) {
  const t = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
  return t || 'x';
}

function namespaced(prefix, pluginId, hint, seen) {
  const base = `${prefix}_${namespace(pluginId)}_${slug(hint)}`;
  let id = base;
  let n = 2;
  while (seen.has(id)) id = `${base}_${n++}`;
  seen.add(id);
  return id.length <= 64 ? id : id.slice(0, 64).replace(/_+$/g, '');
}

function loadTableFile(files, used, name) {
  for (const rel of [`${name}.json`, `data/${name}.json`, `content/${name}.json`]) {
    if (!files.has(rel)) continue;
    used.add(rel);
    return readJsonBuf(files.get(rel), rel);
  }
  return null;
}

function asMap(doc, idField) {
  if (Array.isArray(doc)) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const r of doc) {
      if (!isObj(r)) continue;
      const id = r[idField] || r.id || r.key;
      if (typeof id === 'string' && id) out[id] = r;
    }
    return out;
  }
  return isObj(doc) ? doc : {};
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** A finite number outside ±1e9 anywhere under an array leaf. Non-finite values stay on the scalar path. */
function containsOversizedNumber(value) {
  const stack = [value];
  while (stack.length) {
    const cur = stack.pop();
    if (typeof cur === 'number') {
      if (Number.isFinite(cur) && Math.abs(cur) > PLUGIN_LIMITS.number) return true;
      continue;
    }
    if (!cur || typeof cur !== 'object') continue;
    if (Array.isArray(cur)) {
      for (let i = 0; i < cur.length; i++) stack.push(cur[i]);
    } else {
      for (const k of Object.keys(cur)) {
        if (DANGER_KEYS.has(k)) continue;
        stack.push(cur[k]);
      }
    }
  }
  return false;
}

function leafOps(vanilla, partial, path, out, notes, unsupported) {
  if (out.length > 2000) return;
  if (Array.isArray(partial)) {
    if (!Array.isArray(vanilla)) { notes.push(path.join('.') || '(root)'); return; }
    const key = path.length ? String(path[path.length - 1]) : '';
    if (INDEX_MERGE_ARRAYS.has(key)) { unsupported.push(path.join('.') || key); return; }
    // A matching array is one set. A finite number past ±1e9 inside it would be stored and then reject the pack
    // (checkJsonLimits). Omit the op and name the path, the same as a scalar leaf, so the rest of the record imports.
    if (containsOversizedNumber(partial)) { notes.push(path.join('.') || '(root)'); return; }
    if (path.length && !sameJson(partial, vanilla)) out.push({ path, value: partial });
    return;
  }
  if (isObj(partial)) {
    if (!isObj(vanilla)) { notes.push(path.join('.') || '(root)'); return; }
    for (const k of Object.keys(partial)) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
      if (!has(vanilla, k)) { notes.push([...path, k].join('.')); continue; }
      leafOps(vanilla[k], partial[k], [...path, k], out, notes, unsupported);
    }
    return;
  }
  const same = (typeof partial === 'number' && typeof vanilla === 'number') || (typeof partial === 'string' && typeof vanilla === 'string') || (typeof partial === 'boolean' && typeof vanilla === 'boolean');
  if (!same) { if (path.length) notes.push(path.join('.')); return; }
  if (typeof partial === 'number' && (!Number.isFinite(partial) || Math.abs(partial) > PLUGIN_LIMITS.number)) { notes.push(path.join('.')); return; }
  if (partial !== vanilla && path.length) out.push({ path, value: partial });
}

function finiteStats(src, baseStats) {
  if (!isObj(src)) return null;
  /** @type {Record<string, number>} */
  const out = {};
  for (const k of STAT_KEYS) {
    if (!has(src, k)) continue;
    const v = src[k];
    // A stat past ±1e9 must not enter the compact record (the written plugin JSON would be refused, and the
    // content set would fail the whole pack). Drop the form instead of copying a partial block.
    if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) > PLUGIN_LIMITS.number) return null;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    if (baseStats && has(baseStats, k) && typeof baseStats[k] !== 'number') continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Paths of finite numbers outside ±1e9. The file was allowed to parse; these values are not copied. */
function numbersPastBound(value, at = '$') {
  /** @type {string[]} */
  const out = [];
  const stack = [{ v: value, at }];
  while (stack.length && out.length < 32) {
    const cur = stack.pop();
    const v = cur.v;
    if (typeof v === 'number') {
      if (Number.isFinite(v) && Math.abs(v) > PLUGIN_LIMITS.number) out.push(`${cur.at}: ${v}`);
      continue;
    }
    if (!v || typeof v !== 'object') continue;
    if (Array.isArray(v)) {
      for (let i = v.length - 1; i >= 0; i--) stack.push({ v: v[i], at: `${cur.at}[${i}]` });
    } else {
      for (const k of Object.keys(v).reverse()) {
        if (DANGER_KEYS.has(k)) continue;
        stack.push({ v: v[k], at: `${cur.at}.${k}` });
      }
    }
  }
  return out;
}

/** `skill` without `isDefault`. Forge: the isDefault skills[] entry equals `skill`. */
function skillBody(entry) {
  if (!isObj(entry)) return null;
  const rest = { ...entry };
  delete rest.isDefault;
  return rest;
}

/** Overlay `over` onto `base`. Plain objects merge; arrays and scalars replace. Official keys stay first. */
function mergeOnto(base, over) {
  const out = isObj(base) ? { ...base } : {};
  if (!isObj(over)) return out;
  for (const k of Object.keys(over)) {
    if (k === 'isDefault' || DANGER_KEYS.has(k)) continue;
    const v = over[k];
    if (isObj(v) && isObj(out[k])) out[k] = mergeOnto(out[k], v);
    else out[k] = v;
  }
  return out;
}

function oneDefaultSkill(skills) {
  if (!Array.isArray(skills)) return null;
  const marked = skills.filter((s) => isObj(s) && s.isDefault === true);
  return marked.length === 1 ? marked[0] : null;
}

function skillDiffText(skill, body) {
  const ak = isObj(skill) ? Object.keys(skill) : [];
  const bk = isObj(body) ? Object.keys(body) : [];
  const onlySkill = ak.filter((k) => !bk.includes(k));
  const onlyEntry = bk.filter((k) => !ak.includes(k));
  const differ = ak.filter((k) => bk.includes(k) && canonicalJson(skill[k]) !== canonicalJson(body[k]));
  const parts = [];
  if (onlySkill.length) parts.push(`only on skill: ${onlySkill.slice(0, 6).join(', ')}`);
  if (onlyEntry.length) parts.push(`only on the default skills[] entry: ${onlyEntry.slice(0, 6).join(', ')}`);
  if (differ.length) parts.push(`differ: ${differ.slice(0, 6).join(', ')}`);
  return parts.join('; ') || 'values differ';
}

/**
 * Chess `skill` and the isDefault `skills[]` entry are one object. Derive both from that entry when the pack
 * supplies skills[] and the two sides agree. A record whose two sides differ is not imported. With no skills[],
 * merge the partial skill onto the official skill so a lone spCost does not replace the skill object.
 * @returns {{ rest: any, ops: { path: string[], value: any }[] } | { drop: true, zh: string, en: string }}
 */
function alignChessSkills(vanillaRec, partial) {
  const hasSkill = isObj(partial.skill);
  const hasSkills = Array.isArray(partial.skills);
  const rest = { ...partial };
  delete rest.skill;
  delete rest.skills;
  if (hasSkills) {
    const def = oneDefaultSkill(partial.skills);
    if (!def) {
      return {
        drop: true,
        zh: 'skills[] 没有恰好一条 isDefault，写不出和 skill 相同的默认技能，这条记录没有导入。',
        en: 'skills[] does not mark exactly one isDefault, so skill cannot equal the default entry and this record was not imported.',
      };
    }
    const body = skillBody(def);
    if (hasSkill && canonicalJson(body) !== canonicalJson(partial.skill)) {
      const diff = skillDiffText(partial.skill, body);
      return {
        drop: true,
        zh: `skill 和默认 skills[] 条目不一致（${diff}），这条记录没有导入。`,
        en: `skill differs from the default skills[] entry (${diff}), so this record was not imported.`,
      };
    }
    /** @type {{ path: string[], value: any }[]} */
    const ops = [];
    if (!sameJson(partial.skills, vanillaRec?.skills)) ops.push({ path: ['skills'], value: partial.skills });
    if (!sameJson(body, vanillaRec?.skill)) ops.push({ path: ['skill'], value: body });
    return { rest, ops };
  }
  const def = oneDefaultSkill(vanillaRec?.skills);
  if (!def || !isObj(vanillaRec?.skill)) {
    return {
      drop: true,
      zh: '官方记录没有恰好一条默认技能，包里的 skill 对不齐，这条记录没有导入。',
      en: 'The official record has no single default skill, so the pack skill cannot be aligned and this record was not imported.',
    };
  }
  const body = mergeOnto(skillBody(vanillaRec.skill), skillBody(partial.skill));
  const next = vanillaRec.skills.map((s) => (s && s.isDefault === true ? { ...body, isDefault: true } : s));
  /** @type {{ path: string[], value: any }[]} */
  const ops = [];
  if (!sameJson(next, vanillaRec.skills)) ops.push({ path: ['skills'], value: next });
  if (!sameJson(body, vanillaRec.skill)) ops.push({ path: ['skill'], value: body });
  return { rest, ops };
}

function gridOf(v) {
  if (!Array.isArray(v) || !v.length || v.length > 1024) return null;
  const out = [];
  for (const cell of v) {
    if (!Array.isArray(cell) || cell.length < 2 || !Number.isInteger(cell[0]) || !Number.isInteger(cell[1])) return null;
    if (Math.abs(cell[0]) > 64 || Math.abs(cell[1]) > 64) return null;
    out.push([cell[0], cell[1]]);
  }
  return out;
}

/** phase/level/skillLevel/equipLevel, or one integer. Null when the key is neither. */
function formRank(key) {
  const parts = String(key).split('/');
  if (parts.length === 4 && parts.every((p) => /^-?\d+$/.test(p))) return parts.map(Number);
  if (parts.length === 1 && /^-?\d+$/.test(parts[0])) return [Number(parts[0]), 0, 0, 0];
  return null;
}

function formOrder(keys) {
  const ranks = keys.map((k) => formRank(k));
  const cmp = (a, b) => {
    const ra = formRank(a);
    const rb = formRank(b);
    if (ra && rb) {
      for (let i = 0; i < 4; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
      return 0;
    }
    return a < b ? -1 : a > b ? 1 : 0;
  };
  if (ranks.every(Boolean)) return [...keys].sort(cmp);
  return [...keys].sort(cmp);
}

/**
 * Read a pack already in memory and describe the plugins it would become. Does not write.
 * @param {Map<string, Buffer>} files
 * @param {{ id?: string, contentId?: string, dataDir?: string, vanilla?: { manifest?: any } | null, scripts?: boolean, parse?: Function | null }} [opts]
 *   contentId: the primary content plugin id when it is already known (--out's basename). Record namespaces use it.
 *   scripts: false leaves the script plugin of kits/ out (--no-scripts). parse: acorn's parse, for kits/ (never runs a file).
 */
export function planForgeImport(files, { id: idOverride, contentId, dataDir, vanilla, scripts = true, parse = null } = {}) {
  if (!files.has('pack.json')) fail('PLUGIN_FORGE_INPUT', 'no pack.json');
  const pack = readJsonBuf(files.get('pack.json'), 'pack.json');
  if (!isObj(pack)) fail('PLUGIN_FORGE_INPUT', 'pack.json is not an object');
  const base = forgeIdToPluginId(idOverride || pack.id);
  if (!base) fail('PLUGIN_FORGE_ID', `pack id "${String(pack.id ?? '').slice(0, 40)}"`);
  const recordNs = contentId && isPluginId(contentId) ? contentId : base;
  /** @type {Set<string>} */
  const used = new Set(['pack.json']);
  /** @type {{ path: string, zh: string, en: string, code?: string }[]} */
  const skipped = [];
  // [ASSUMED] Dropping panel behavior or declared host capabilities is a partial import even when a stub or
  // another product validates. Keep the reasons separate from whole-record counts and field-level notes.
  const manualReasons = [];
  /** @type {{ what: string, zh: string, en: string }[]} */
  const assumed = [];
  // Whole gameplay records that never became a plugin record. A field note (#bonds, #kit, #skill-fields)
  // is not one of these: the record itself was still imported. [ASSUMED] garrisons and a traits table both
  // count as traits; chess and units both count as operators.
  const dropped = { operators: 0, bonds: 0, bands: 0, items: 0, tokens: 0, traits: 0, kits: 0, panels: 0 };
  // Table-qualified ids of dropped gameplay records. Resolve their art keys after all records have been mapped.
  // A panel title is not one of these: a panel named like a kept portrait must not make that cosmetic bare.
  const droppedIds = new Set();
  const DROP_ID_KINDS = new Set(['operators', 'bonds', 'bands', 'items', 'tokens', 'traits', 'kits']);
  const noteDrop = (kind, n = 1) => { if (Object.hasOwn(dropped, kind) && n > 0) dropped[kind] += n; };
  const skip = (p, zh, en, code, kind, extra) => {
    skipped.push({ path: p, zh, en, ...(code ? { code } : {}), ...(extra && typeof extra === 'object' ? extra : {}) });
    if (code === 'PLUGIN_FORGE_PANEL_SCRIPT' || code === 'PLUGIN_FORGE_MOUNT'
      || ['pack.json:server', 'pack.json:serverModules', 'pack.json:routes', 'pack.json:messages', 'pack.json:theme', 'pack.json:assets'].includes(p)
      || (p.startsWith('client.') && !p.startsWith('client.panels'))) {
      manualReasons.push({ path: p, zh, en, ...(extra && typeof extra === 'object' ? extra : {}) });
    }
    if (!kind) return;
    noteDrop(kind);
    if (!DROP_ID_KINDS.has(kind)) return;
    const id = String(p).split(':').slice(1).join(':').split('#')[0];
    if (id) droppedIds.add(`${String(p).split(':')[0]}:${id}`);
  };
  const assume = (what, zh, en) => { if (!assumed.some((a) => a.what === what)) assumed.push({ what, zh, en }); };

  const version = semverOf(pack.version) || '0.1.0';
  if (!semverOf(pack.version)) assume('version', `版本「${String(pack.version ?? '').slice(0, 40)}」不是语义化版本，写成 ${version}。`, `Version "${String(pack.version ?? '').slice(0, 40)}" is not semver, so it was written as ${version}.`);
  const packName = typeof pack.name === 'string' && pack.name.trim() ? pack.name.trim().slice(0, 60) : base;
  const description = typeof pack.description === 'string' ? pack.description.trim().slice(0, 500) : '';
  // Keep announcement text out of description / credits, which are hashed gameplay manifest metadata.
  const credits = '';
  /** @type {Record<string, string> | null} */
  let themeVars = null;
  /** @type {NonNullable<ReturnType<typeof readNotices>['notices']>} */
  const notices = [];
  if (isObj(pack.notices)) {
    try {
      const notes = pack.notices;
      const annKey = notes.announcement != null ? 'announcement' : notes.announcements != null ? 'announcements' : null;
      if (annKey === 'announcement' && notes.announcements != null) {
        touchNotice(files, used, notes.announcements);
        skip('notices.announcements', '同时有 announcement 和 announcements，只使用 announcement。', 'Both announcement and announcements are set; only announcement is used.');
      }
      if (annKey) {
        const loaded = noticeDoc(files, used, notes[annKey]);
        const built = loaded.missing ? null : announcementFrom(loaded.json != null ? loaded.json : (loaded.text || null));
        if (built) notices.push(built);
        else skip(`notices.${annKey}`, '公告写不成一条纯文本公告，没有写入。', 'The announcement does not become one plain-text notice, so it was not written.');
      }
      if (notes.credits != null) {
        const loaded = noticeDoc(files, used, notes.credits);
        const built = loaded.missing ? null : creditsFrom(loaded.json != null ? loaded.json : (loaded.text || null));
        if (built) notices.push(built);
        else skip('notices.credits', '鸣谢写不成一条纯文本公告，没有写入。', 'The credits do not become one plain-text notice, so they were not written.');
      }
      for (const k of Object.keys(notes)) {
        if (k === 'announcement' || k === 'announcements' || k === 'credits') continue;
        touchNotice(files, used, notes[k]);
        skip(`notices.${k}`, '我们的导入器不认识这种公告，没有导入。', 'The importer does not know this notice, so it was not imported.');
      }
    } catch (e) {
      if (e instanceof ForgeImportError) throw e;
      skip('notices', '公告或鸣谢读不了，没有写入清单。', 'Announcements or credits could not be read, so they were not written into the manifest.');
    }
  }
  if (notices.length) assume('notices-text', '公告按纯文本导入：标题合并版本、日期与摘要，正文按节换行，鸣谢单独一条；超过 80/2000 字的文字截短。', 'Notices import as plain text: title combines version, date and summary, sections become lines, and credits are separate; titles/bodies are truncated at 80/2000 characters.');
  const authors = typeof pack.author === 'string' && pack.author.trim() ? [pack.author.trim().slice(0, 80)] : [];
  const license = typeof pack.license === 'string' ? pack.license.trim().slice(0, 80) : '';

  /** @type {Record<string, string>} */
  const requires = {};
  /** @type {Record<string, string>} */
  const conflicts = {};
  for (const [field, dest] of [['dependencies', requires], ['conflicts', conflicts]]) {
    const list = pack[field];
    if (list == null) continue;
    if (!Array.isArray(list)) { skip(`pack.json:${field}`, '依赖声明不是列表，没有导入。', 'The dependency declaration is not a list, so it was not imported.'); continue; }
    for (const item of list) {
      const rawId = isObj(item) ? item.id : item;
      const pid = forgeIdToPluginId(rawId);
      const range = isObj(item) && rangeOk(item.range) ? String(item.range).trim() : '*';
      if (!pid) { skip(`${field}:${String(rawId ?? '').slice(0, 40)}`, '这个 id 变不成插件 id，没有写成依赖。', 'This id cannot become a plugin id, so it was not written as a dependency.'); continue; }
      if (isObj(item) && item.range != null && !rangeOk(item.range)) assume(`range-${pid}`, `「${pid}」的版本范围写不进我们的清单，改成 *。`, `The version range of "${pid}" does not fit our manifest, so it was written as *.`);
      dest[pid] = range;
    }
  }

  const behaviourRead = readForgeBehaviour(pack.behaviour);
  for (const row of behaviourRead.skipped) skip(row.path, row.zh, row.en);
  const importedRules = behaviourRead.rules;
  for (const key of Object.keys(SKIP_TOP)) {
    if (pack[key] == null) continue;
    if (key === 'fx' && isObj(pack.fx) && Array.isArray(pack.fx.silentPhases)) continue;
    // behaviour is reported entry by entry above, including an empty list (no second generic skip).
    if (key === 'behaviour') continue;
    if (key === 'combat' && pack.combat !== true) continue;
    // A behaviour import implies combat: true. combat alone, or a behaviour that imported nothing, still skips.
    if (key === 'combat' && importedRules) continue;
    const [zh, en] = SKIP_TOP[key];
    skip(`pack.json:${key}`, zh, en);
  }
  for (const key of Object.keys(pack)) {
    if (['id', 'name', 'version', 'author', 'license', 'description', 'gameVersion', 'game', 'api', 'content', 'overrides', 'voices', 'voiceLangs', 'bondIcons', 'itemIcons', 'art', 'skins', 'operators', 'i18n', 'notices', 'target', 'dependencies', 'conflicts', 'client', ...Object.keys(SKIP_TOP)].includes(key)) continue;
    skip(`pack.json:${key}`, '我们的导入器不认识这个字段，没有导入。', 'The importer does not know this field, so it was not imported.');
  }
  if (pack.target != null && pack.target !== 'forge') skip('pack.json:target', `目标引擎是「${String(pack.target).slice(0, 40)}」，不是我们这一份。能对上的数据仍会导入，对不上的留在报告里。`, `The pack targets "${String(pack.target).slice(0, 40)}", not this game. Pieces that map are still imported; the rest stay in the report.`);

  const manifestArt = vanilla?.manifest ?? null;
  /** @type {Record<string, any>} */
  const assets = Object.create(null);
  /** @type {Map<string, Buffer>} */
  const media = new Map();
  /** @type {string[]} */
  const importedAssets = [];
  /** @type {string[]} */
  const rewrittenAssets = [];
  const remember = (src, dest) => {
    const buf = files.get(src);
    if (media.has(dest)) {
      if (!media.get(dest).equals(buf)) fail('PLUGIN_FORGE_ZIP', `${dest}: two pack files map to one path`);
      return;
    }
    media.set(dest, buf);
  };

  const putFileAt = (at, rel) => {
    const got = takeMedia(files, used, rel, 'image');
    if (!got) { skip(String(rel), '声明了图片，但包里没有这个文件，没有导入。', 'An image was declared, but that file is not in the pack, so it was not imported.'); return; }
    if (got.error) { skip(String(rel), `图片扩展名 ${got.error} 不能放进外观插件，没有导入。`, `Image extension ${got.error} cannot go in a cosmetic plugin, so it was not imported.`); return; }
    setAt(assets, at, got.dest);
    remember(got.src, got.dest);
    importedAssets.push(`${at.join('.')} ← ${got.src}`);
  };
  const putImage = (container, key, field, rel) => {
    if (!isAssetKey(key)) { skip(`${container.join('.')}.${String(key).slice(0, 40)}`, '素材 id 不合规，没有导入。', 'The asset id is not a valid key, so it was not imported.'); return; }
    putFileAt(field ? [...container, key, ...field] : [...container, key], rel);
  };
  const putAudio = (container, key, slot, rels) => {
    if (!isAssetKey(key)) { skip(`${container.join('.')}.${String(key).slice(0, 40)}`, '素材 id 不合规，没有导入。', 'The asset id is not a valid key, so it was not imported.'); return; }
    const list = (Array.isArray(rels) ? rels : [rels]).filter((r) => typeof r === 'string');
    const dests = [];
    for (const rel of list.slice(0, 16)) {
      const got = takeMedia(files, used, rel, 'audio');
      if (!got || got.error) { skip(String(rel), '语音或音效文件不在包里，或扩展名不是 .mp3 / .ogg，没有导入。', 'The voice or sound file is missing, or it is not .mp3 / .ogg, so it was not imported.'); continue; }
      dests.push(got.dest);
      remember(got.src, got.dest);
    }
    if (!dests.length) return;
    setAt(assets, [...container, key, slot], dests.length === 1 ? dests[0] : dests);
    importedAssets.push(`${container.join('.')}.${key}.${slot} ← ${list.slice(0, dests.length).join(', ')}`);
  };
  const putSpine = (container, key, field, spec) => {
    if (!isObj(spec) || typeof spec.skel !== 'string') { skip(`${container.join('.')}.${key}`, '模型声明不完整（需要 skel），没有导入。', 'The model declaration is incomplete (skel is required), so it was not imported.'); return; }
    const skel = takeMedia(files, used, spec.skel, 'spine');
    const atlasRel = typeof spec.atlas === 'string' ? spec.atlas : spec.skel.replace(/\.skel$/i, '.atlas');
    const atlas = takeMedia(files, used, atlasRel, 'spine');
    if (!skel || skel.error || skel.dest && extOf(skel.dest) !== '.skel' || !atlas || atlas.error || extOf(atlas.dest) !== '.atlas') {
      skip(spec.skel, '模型的 skel 或 atlas 不在包里，没有导入。', 'The model\'s skel or atlas is not in the pack, so it was not imported.');
      return;
    }
    const dir = skel.dest.replace(/[^/]*$/, '');
    const name = skel.dest.slice(dir.length, -'.skel'.length);
    const atlasDest = `${dir}${name}.atlas`;
    if (atlas.dest !== atlasDest) {
      skip(spec.skel, 'atlas 必须和 skel 同目录同名，没有导入这个模型。', 'The atlas must sit next to the skel with the same name, so this model was not imported.');
      return;
    }
    const textures = [];
    const declared = Array.isArray(spec.textures) ? spec.textures : [`${spec.skel.replace(/\.skel$/i, '.png')}`];
    for (const rel of declared) {
      const page = takeMedia(files, used, rel, 'image');
      if (!page || page.error) { skip(String(rel), '模型的贴图页不在包里，没有导入这个模型。', 'A model page is not in the pack, so this model was not imported.'); return; }
      if (!page.dest.startsWith(dir)) { skip(String(rel), '模型的贴图页必须和 skel 在同一目录，没有导入。', 'A model page must sit in the skel\'s folder, so this model was not imported.'); return; }
      textures.push(page.dest);
      remember(page.src, page.dest);
    }
    remember(skel.src, skel.dest);
    remember(atlas.src, atlas.dest);
    const value = { skel: skel.dest, atlas: atlasDest, ...(textures.length ? { textures } : {}), ...(spec.pma === true ? { pma: true } : {}) };
    setAt(assets, [...container, key, ...field], value);
    if (spec.anims != null) assume('spine-anims', '模型上的 anims 没有照抄：剪辑由 plugin.lock.json 从骨架里读。', 'anims on a model were not copied: clip data is read from the skeleton into plugin.lock.json.');
    importedAssets.push(`${[...container, key, ...field].join('.')} ← ${skel.src}`);
  };

  const art = isObj(pack.art) ? pack.art : {};
  if (isObj(art.chars)) for (const [key, rec] of Object.entries(art.chars)) {
    if (!isObj(rec)) continue;
    for (const field of CHAR_FIELDS) if (typeof rec[field] === 'string') putImage(['chars'], key, [field], rec[field]);
    if (isObj(rec.spine)) {
      if (isObj(rec.spine.front)) putSpine(['chars'], key, ['spine', 'front'], rec.spine.front);
      if (isObj(rec.spine.back)) putSpine(['chars'], key, ['spine', 'back'], rec.spine.back);
    }
    for (const k of Object.keys(rec)) if (!CHAR_FIELDS.has(k) && k !== 'spine') skip(`art.chars.${key}.${k}`, '外观叠加没有这个立绘字段（可用的：avatar、avatarE2、portrait、portraitE2、illust、spine），没有导入。', 'The cosmetic overlay takes no such portrait field (it has avatar, avatarE2, portrait, portraitE2, illust and spine), so it was not imported.');
  }
  if (isObj(art.enemies)) for (const [key, rec] of Object.entries(art.enemies)) {
    if (!isObj(rec)) continue;
    if (typeof rec.icon === 'string') putImage(['enemies'], key, ['icon'], rec.icon);
    if (isObj(rec.spine)) putSpine(['enemies'], key, ['spine'], rec.spine);
  }
  if (isObj(art.tokens)) for (const [key, rec] of Object.entries(art.tokens)) {
    if (!isObj(rec)) continue;
    if (typeof rec.avatar === 'string') putImage(['tokens'], key, ['avatar'], rec.avatar);
    if (isObj(rec.spine)) putSpine(['tokens'], key, ['spine'], rec.spine);
    if (rec.owner != null) skip(`art.tokens.${key}.owner`, 'token 的 owner 不是素材，没有导入。', 'A token\'s owner is not an asset, so it was not imported.');
  }
  const flatArt = { skills: ['skills'], bonds: ['bonds'], bands: ['bands'], items: ['items'], modules: ['modules'], ui: ['ui'], profSub: ['prof', 'sub'] };
  for (const [table, container] of Object.entries(flatArt)) {
    if (!isObj(art[table])) continue;
    for (const [key, rel] of Object.entries(art[table])) if (typeof rel === 'string') putImage(container, key, null, rel);
  }
  if (isObj(pack.bondIcons)) {
    for (const [key, rel] of Object.entries(pack.bondIcons)) {
      if (isObj(art.bonds) && has(art.bonds, key)) { skip(`bondIcons.${key}`, '同一个盟约已经在 art.bonds 里，bondIcons 这一条没有再导入。', 'That bond is already in art.bonds, so this bondIcons entry was not imported again.'); continue; }
      if (typeof rel === 'string') putImage(['bonds'], key, null, rel);
    }
  }
  if (isObj(pack.itemIcons)) for (const [key, rel] of Object.entries(pack.itemIcons)) if (typeof rel === 'string') putImage(['items'], key, null, rel);

  const putVoices = (table, container, block) => {
    if (!isObj(block)) return;
    for (const [charId, lines] of Object.entries(block)) {
      if (!isObj(lines)) continue;
      for (const [slot, rel] of Object.entries(lines)) {
        if (!VOICE_SLOT.test(slot)) { skip(`${table}.${charId}.${slot}`, '语音槽位名字不符合规则，没有导入。', 'The voice-slot name does not match the rule, so it was not imported.'); continue; }
        putAudio(container, charId, slot, rel);
      }
    }
  };
  if (pack.voices != null) {
    assume('voices-jp', 'Forge 的 voices 是默认配音，文档写的是日文，所以写入 audio.voiceJp。', 'Forge voices are the default dub, documented as Japanese, so they were written to audio.voiceJp.');
    putVoices('voices', ['audio', 'voiceJp'], pack.voices);
    rewrittenAssets.push('voices → audio.voiceJp');
  }
  if (isObj(pack.voiceLangs)) {
    for (const [lang, block] of Object.entries(pack.voiceLangs)) {
      const code = canonicalLang(lang);
      // the dubs with a table here (round 40, DESIGN §32.14.11): 中文 audio.voice, 日本語 voiceJp, English voiceEn, 한국어 voiceKr
      const tree = code === 'zh' || code === 'cn' ? 'voice' : code === 'ja' || code === 'jp' ? 'voiceJp' : code === 'en' ? 'voiceEn'
        : code === 'ko' || code === 'kr' ? 'voiceKr' : null;
      if (tree === 'voice') {
        assume('voice-cn', 'voiceLangs.cn 写入 audio.voice（中文配音）。', 'voiceLangs.cn was written to audio.voice (the Chinese dub).');
        putVoices(`voiceLangs.${lang}`, ['audio', 'voice'], block);
        rewrittenAssets.push(`voiceLangs.${lang} → audio.voice`);
      } else if (tree) {
        putVoices(`voiceLangs.${lang}`, ['audio', tree], block);
        rewrittenAssets.push(`voiceLangs.${lang} → audio.${tree}`);
      } else skip(`voiceLangs.${lang}`, '这一档配音没有对应的语音表（只有中文、日文、英文、韩文），没有导入。', 'There is no voice table for this dub (only Chinese, Japanese, English and Korean), so it was not imported.');
    }
  }
  if (Array.isArray(pack.skins)) {
    for (const skin of pack.skins) {
      if (!isObj(skin) || typeof skin.charId !== 'string') { skip('skins', '一条时装没有 charId，没有导入。', 'A skin has no charId, so it was not imported.'); continue; }
      // an outfit whose id is a skin key (docs/PLUGINS.md §9) is kept apart from the operator's own overlay: several
      // outfits of one operator under their own keys. The 皮肤 picker lists that key (availableSkins) once the plugin
      // is composed. An outfit with no usable id is folded onto that operator's one overlay and is not a picker row.
      const key = typeof skin.id === 'string' && isSkinKey(skin.id) ? skin.id : null;
      if (key) {
        assume('skins-variants', 'Forge 的多套时装各自写进该干员的 skins 变体（键是时装 id）。外观插件叠到清单上之后，干员调配和自选详情的皮肤一栏会列出这个 id，玩家用 room.skins 穿上。', 'Each Forge outfit is written as that operator\'s own skins variant (keyed by the outfit\'s id). Once the cosmetic plugin is composed onto the manifest, the skin section in operator setup and the DIY detail lists that id, and the player wears it with room.skins.');
        const name = typeof skin.name === 'string' ? skin.name.trim() : '';
        if (name && [...name].length <= 64) setAt(assets, ['chars', skin.charId, 'skins', key, 'name'], name);
        else if (name) skip(`skins.${key}.name`, '时装的显示名不在 1–64 字以内，没有写入。', 'The outfit\'s display name is not within 1–64 characters, so it was not written.');
        if (isObj(skin.art)) {
          for (const field of CHAR_FIELDS) if (typeof skin.art[field] === 'string') putFileAt(['chars', skin.charId, 'skins', key, field], skin.art[field]);
          if (isObj(skin.art.spine?.front)) putSpine(['chars', skin.charId, 'skins'], key, ['spine', 'front'], skin.art.spine.front);
        }
      } else {
        assume('skins', 'Forge 的时装没有能当皮肤键的 id，收成该干员的一份外观叠加，不会成为皮肤栏里的一行。', 'A Forge outfit has no id a skin key can use, so it was collapsed into one overlay of that operator and is not a row in the skin picker.');
        if (isObj(skin.art)) {
          for (const field of CHAR_FIELDS) if (typeof skin.art[field] === 'string') putImage(['chars'], skin.charId, [field], skin.art[field]);
          if (isObj(skin.art.spine?.front)) putSpine(['chars'], skin.charId, ['spine', 'front'], skin.art.spine.front);
        }
      }
      if (isObj(skin.voices)) putVoices(`skins.${skin.id || skin.charId}`, ['audio', 'voiceJp'], { [skin.charId]: skin.voices });
    }
  }

  // BGM / sfx only when the path is clearly one of our track or sfx keys and the pack points at it.
  const bgmKeys = new Set(['lobby', 'prep', 'combat', 'unite', 'boss']);
  const maybeAudioTree = isObj(art.audio) ? art.audio : null;
  if (isObj(maybeAudioTree?.bgm)) {
    assume('art-audio', 'art.audio 不是 Forge 的正式表。形状对得上的音轨和音效仍然写入。', 'art.audio is not an official Forge table. Tracks and sounds whose shape matches were still written.');
    for (const [key, rel] of Object.entries(maybeAudioTree.bgm)) {
      if (!bgmKeys.has(key)) { skip(`art.audio.bgm.${key}`, '背景音乐只接受 lobby、prep、combat、unite、boss，没有导入。', 'Music only accepts lobby, prep, combat, unite and boss, so this was not imported.'); continue; }
      const file = typeof rel === 'string' ? rel : isObj(rel) ? rel.loop : null;
      const got = typeof file === 'string' ? takeMedia(files, used, file, 'audio') : null;
      if (!got || got.error) { skip(`art.audio.bgm.${key}`, '音乐文件不在包里，没有导入。', 'The music file is not in the pack, so it was not imported.'); continue; }
      setAt(assets, ['audio', 'bgm', key], { loop: got.dest });
      remember(got.src, got.dest);
      importedAssets.push(`audio.bgm.${key} ← ${got.src}`);
    }
  }
  const putTrack = (at, rel, label) => {
    const file = typeof rel === 'string' ? rel : isObj(rel) && typeof rel.loop === 'string' ? rel.loop : null;
    if (!file) { skip(label, '音乐要是文件路径，或 { loop }，没有导入。', 'Music must be a file path or { loop }, so it was not imported.'); return false; }
    const got = takeMedia(files, used, file, 'audio');
    if (!got || got.error) { skip(label, '音乐文件不在包里，或扩展名不是 .mp3 / .ogg，没有导入。', 'The music file is missing, or it is not .mp3 / .ogg, so it was not imported.'); return false; }
    const track = { loop: got.dest };
    remember(got.src, got.dest);
    if (isObj(rel) && typeof rel.intro === 'string') {
      const intro = takeMedia(files, used, rel.intro, 'audio');
      if (!intro || intro.error) skip(`${label}#intro`, 'intro 音轨不在包里，没有写入 intro。', 'The intro track is not in the pack, so intro was not written.');
      else { track.intro = intro.dest; remember(intro.src, intro.dest); }
    }
    setAt(assets, at, track);
    importedAssets.push(`${at.join('.')} ← ${got.src}`);
    return true;
  };
  if (isObj(maybeAudioTree?.bossBgm)) {
    assume('art-audio', 'art.audio 不是 Forge 的正式表。形状对得上的音轨和音效仍然写入。', 'art.audio is not an official Forge table. Tracks and sounds whose shape matches were still written.');
    for (const [key, rel] of Object.entries(maybeAudioTree.bossBgm)) {
      if (!isAssetKey(key)) { skip(`art.audio.bossBgm.${String(key).slice(0, 40)}`, 'boss 音乐的 id 不合规，没有导入。', 'The boss-music id is not a valid asset key, so it was not imported.'); continue; }
      putTrack(['audio', 'bossBgm', key], rel, `art.audio.bossBgm.${key}`);
    }
  }
  const sfxUnitAudio = new Set(['attack', 'hit', 'skill', 'die', 'born']);
  const sfxUnitMaps = new Set(['skills', 'attacks', 'hits']);
  if (isObj(maybeAudioTree?.sfx)) {
    assume('art-audio', 'art.audio 不是 Forge 的正式表。形状对得上的音轨和音效仍然写入。', 'art.audio is not an official Forge table. Tracks and sounds whose shape matches were still written.');
    for (const bucket of ['ui', 'battle']) {
      const block = maybeAudioTree.sfx[bucket];
      if (block == null) continue;
      if (!isObj(block)) { skip(`art.audio.sfx.${bucket}`, '音效表不是对象，没有导入。', 'The sound table is not an object, so it was not imported.'); continue; }
      for (const [key, rel] of Object.entries(block)) {
        if (!isAssetKey(key) || typeof rel !== 'string') { skip(`art.audio.sfx.${bucket}.${String(key).slice(0, 40)}`, '音效要是一个 .mp3 / .ogg 路径，没有导入。', 'A sound must be one .mp3 / .ogg path, so it was not imported.'); continue; }
        const got = takeMedia(files, used, rel, 'audio');
        if (!got || got.error) { skip(`art.audio.sfx.${bucket}.${key}`, '音效文件不在包里，或扩展名不是 .mp3 / .ogg，没有导入。', 'The sound file is missing, or it is not .mp3 / .ogg, so it was not imported.'); continue; }
        setAt(assets, ['audio', 'sfx', bucket, key], got.dest);
        remember(got.src, got.dest);
        importedAssets.push(`audio.sfx.${bucket}.${key} ← ${got.src}`);
      }
    }
    if (maybeAudioTree.sfx.units != null && !isObj(maybeAudioTree.sfx.units)) skip('art.audio.sfx.units', '干员音效不是对象，没有导入。', 'Unit sounds are not an object, so they were not imported.');
    if (isObj(maybeAudioTree.sfx.units)) {
      for (const [id, rec] of Object.entries(maybeAudioTree.sfx.units)) {
        if (!isAssetKey(id) || !isObj(rec)) { skip(`art.audio.sfx.units.${String(id).slice(0, 40)}`, '干员音效写得不对，没有导入。', 'This unit-sound entry is not usable, so it was not imported.'); continue; }
        const out = {};
        for (const [field, val] of Object.entries(rec)) {
          if (sfxUnitAudio.has(field) && typeof val === 'string') {
            const got = takeMedia(files, used, val, 'audio');
            if (!got || got.error) { skip(`art.audio.sfx.units.${id}.${field}`, '音效文件不在包里，或扩展名不是 .mp3 / .ogg，没有导入。', 'The sound file is missing, or it is not .mp3 / .ogg, so it was not imported.'); continue; }
            out[field] = got.dest;
            remember(got.src, got.dest);
          } else if (sfxUnitMaps.has(field) && isObj(val)) {
            const map = {};
            for (const [idx, rel] of Object.entries(val)) {
              if (!/^\d{1,2}$/.test(idx) || typeof rel !== 'string') { skip(`art.audio.sfx.units.${id}.${field}.${String(idx).slice(0, 8)}`, '分组音效的序号必须是 0–99，值是一个音频路径，没有导入。', 'A grouped sound index must be 0–99 and its value one audio path, so it was not imported.'); continue; }
              const got = takeMedia(files, used, rel, 'audio');
              if (!got || got.error) { skip(`art.audio.sfx.units.${id}.${field}.${idx}`, '音效文件不在包里，或扩展名不是 .mp3 / .ogg，没有导入。', 'The sound file is missing, or it is not .mp3 / .ogg, so it was not imported.'); continue; }
              map[idx] = got.dest;
              remember(got.src, got.dest);
            }
            if (Object.keys(map).length) out[field] = map;
          } else skip(`art.audio.sfx.units.${id}.${field}`, '这个音效字段对不上（只要 attack、hit、skill、die、born，或 skills / attacks / hits），没有导入。', 'This sound field does not match (attack, hit, skill, die, born, or skills / attacks / hits), so it was not imported.');
        }
        if (Object.keys(out).length) {
          setAt(assets, ['audio', 'sfx', 'units', id], out);
          importedAssets.push(`audio.sfx.units.${id}`);
        }
      }
    }
    for (const k of Object.keys(maybeAudioTree.sfx)) {
      if (k !== 'ui' && k !== 'battle' && k !== 'units') skip(`art.audio.sfx.${k}`, '音效只接受 ui、battle、units，没有导入。', 'Sounds only accept ui, battle and units, so this was not imported.');
    }
  }
  if (isObj(maybeAudioTree)) {
    for (const k of Object.keys(maybeAudioTree)) {
      if (k !== 'bgm' && k !== 'sfx' && k !== 'bossBgm') skip(`art.audio.${k}`, '这个音频字段对不上，没有导入。', 'This audio field does not match, so it was not imported.');
    }
  }

  const dataCache = new Map();
  const table = (name) => {
    if (dataCache.has(name)) return dataCache.get(name);
    let json = null;
    if (dataDir) {
      const file = name === 'units' ? 'backups.json' : name === 'modes' ? 'config.json' : `${name}.json`;
      try { json = JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')); } catch { json = null; }
      if (name === 'units') json = json?.units ?? null;
      if (name === 'modes') json = json?.modes ?? null;
    }
    dataCache.set(name, json);
    return json;
  };

  /** @type {any[]} */
  const patches = [];
  /** Chess ids to add or remove on a bond's members and visibleMembers after every bonds override is in `patches`. */
  /** @type {Map<string, { remove: Set<string>, add: Set<string> }>} */
  const bondEdits = new Map();
  const noteBond = (bondId, kind, chessId) => {
    let edit = bondEdits.get(bondId);
    if (!edit) {
      edit = { remove: new Set(), add: new Set() };
      bondEdits.set(bondId, edit);
    }
    edit[kind].add(chessId);
  };
  /** @type {any[]} */
  const operators = [];
  /** @type {any[]} */
  const enemyRecords = [];
  /** @type {string[]} */
  const importedData = [];
  if (importedRules) for (const [name, option] of Object.entries(importedRules)) importedData.push(`behaviour:${name} → rules.${name} = ${option}`);
  /** @type {string[]} */
  const rewrittenData = [];
  const seenIds = new Set();
  const overrideKeys = new Set();
  if (Array.isArray(pack.overrides)) for (const e of pack.overrides) {
    if (typeof e !== 'string' || !e.includes(':')) { skip(`overrides:${String(e).slice(0, 40)}`, '覆盖声明要写成「文件:id」，这一条没有导入。', 'An override must be "file:id", so this one was not imported.'); continue; }
    overrideKeys.add(e);
  } else if (pack.overrides != null) skip('overrides', 'overrides 不是列表，没有导入。', 'overrides is not a list, so it was not imported.');

  const declaredContent = Array.isArray(pack.content) ? pack.content.filter((n) => typeof n === 'string') : [];
  for (const name of declaredContent) {
    if (CONTENT_NAMES.includes(name)) continue;
    skip(`content:${name}`, '这不是 Forge 的数据文件名，也不能当成模式导入。', 'This is not a Forge data-file name, and it was not imported as a mode.');

  }

  rememberOfficialBounds(Object.fromEntries(BOUND_TABLES.map(name => [name, table(name)])));
  const gameplay = planForgeRecords({
    read: name => asMap(loadTableFile(files, used, name), name === 'tokens' ? 'tokenId' : 'id'),
    table, allocate: (prefix, id) => namespaced(prefix, recordNs, id, seenIds), skip, assume,
  });
  const gameplayRecords = gameplay.records;
  const recordIds = gameplay.ids;
  for (const [name, entries] of gameplay.additions) dataCache.set(name, { ...table(name), ...entries });
  for (const [old, id] of recordIds) { importedData.push(`${old} → ${id}`); rewrittenData.push(`${old} → ${id}`); }
  const deriveLocal = dataDir ? localOfficialUnits(dataDir) : null;
  const derivedChars = new Set();
  const officialNeeded = new Set();
  const installedChar = id => typeof id === 'string' && (!!table('units')?.[id] || Object.values(table('chess') ?? {}).some(c => c.charId === id));
  const deriveChar = (id, tier) => {
    if (!deriveLocal) throw new Error('Local official character/skill/range tables unavailable (no dataDir).');
    const econ = table('config')?.economy?.chessStatus?.[tier];
    if (!econ) throw new Error(`Missing economy training defaults for tier ${tier}.`);
    officialNeeded.add(id);
    const got = deriveLocal(id, [econ.normal, econ.golden]);
    derivedChars.add(id);
    importedData.push(`${id}: derived from local official tables (${got.version}); full potential, tier ${tier} economy training; pack overrides retained.`);
    return got.unit;
  };

  const patchRecord = (file, id, partial) => {
    const prefix = file === 'units' ? ['units', id] : [];
    const vanillaRec = file === 'units' ? table('units')?.[id] : table(file)?.[id];
    if (!vanillaRec) { skip(`${file}:${id}`, '覆盖声明指向的官方记录不存在，没有改。', 'The override names an official record that does not exist, so nothing was changed.'); return; }
    let source = partial;
    /** @type {{ path: string[], value: any }[]} */
    const forced = [];
    let skillHeld = false;
    if (file === 'chess' && (isObj(partial.skill) || Array.isArray(partial.skills))) {
      const aligned = alignChessSkills(vanillaRec, partial);
      if ('drop' in aligned) { skip(`${file}:${id}`, aligned.zh, aligned.en); return; }
      source = aligned.rest;
      const past = aligned.ops.flatMap((op) => numbersPastBound(op.value, op.path.join('.')));
      if (past.length) {
        skillHeld = true;
        skip(`${file}:${id}#skill`, `skill / skills 里的数超出 ±${PLUGIN_LIMITS.number}（${past.slice(0, 6).join('；')}），没有写进游戏数据。`, `A number in skill / skills is outside ±${PLUGIN_LIMITS.number} (${past.slice(0, 6).join('; ')}), so it was not written into game data.`);
      } else forced.push(...aligned.ops);
    }
    // [ASSUMED] An id this installation does not have is named and left out of the written list. A list that is then
    // empty is not written, so the official list stays. New bonds and new chess ids are not invented here.
    let listedHeld = false;
    const keepKnown = (field, tableName, labelZh, labelEn) => {
      if (!Array.isArray(source[field])) return;
      const knownTable = table(tableName) || {};
      const unknown = [];
      const known = [];
      for (const item of source[field]) {
        const key = typeof item === 'string' ? item : '';
        if (!key || !has(knownTable, key)) unknown.push(String(item ?? '').slice(0, 40));
        else if (!known.includes(key)) known.push(key);
      }
      if (!unknown.length) return;
      listedHeld = true;
      skip(`${file}:${id}#${field}`, `「${unknown.slice(0, 6).join('、')}」在本安装里没有这条${labelZh}，没有写进 ${field}。`, `"${unknown.slice(0, 6).join(', ')}" is not a ${labelEn} in this installation, so it was not written into ${field}.`);
      if (known.length) source[field] = known;
      else delete source[field];
    };
    if (file === 'chess') {
      if (Array.isArray(source.bonds)) {
        const bondTable = table('bonds') || {};
        const unknown = [];
        const known = [];
        for (const item of source.bonds) {
          const key = typeof item === 'string' ? item : '';
          if (!key || !has(bondTable, key)) unknown.push(String(item ?? '').slice(0, 40));
          else if (!known.includes(key)) known.push(key);
        }
        if (unknown.length) {
          listedHeld = true;
          skip(`${file}:${id}#bonds`, `「${unknown.slice(0, 6).join('、')}」在本安装里没有这条盟约，没有写进 bonds。`, `"${unknown.slice(0, 6).join(', ')}" is not a bond in this installation, so it was not written into bonds.`);
          if (known.length) source.bonds = known;
          else delete source.bonds;
        }
        // pieceBonds counts chess.bonds. A list that drops or joins an official bond has to move this chess id on
        // that bond's members and visibleMembers, or the catalogue still lists a piece the count no longer includes.
        // An empty filtered list leaves the official bonds in place, so membership stays too.
        if (known.length) {
          const official = Array.isArray(vanillaRec.bonds) ? vanillaRec.bonds.filter((x) => typeof x === 'string') : [];
          const dropped = official.filter((x) => !known.includes(x));
          const joined = known.filter((x) => !official.includes(x));
          if (dropped.length) {
            listedHeld = true;
            skip(`${file}:${id}#bonds-off`, `写入的 bonds 去掉了官方盟约「${dropped.slice(0, 6).join('、')}」，已把 ${id} 从这些盟约的 members 和 visibleMembers 里去掉。`, `The written bonds list drops the official bond "${dropped.slice(0, 6).join(', ')}", so ${id} was removed from those bonds' members and visibleMembers.`);
            for (const b of dropped) noteBond(b, 'remove', id);
          }
          if (joined.length) {
            listedHeld = true;
            skip(`${file}:${id}#bonds-on`, `写入的 bonds 加上了官方盟约「${joined.slice(0, 6).join('、')}」，已把 ${id} 加进这些盟约的 members 和 visibleMembers。`, `The written bonds list adds the official bond "${joined.slice(0, 6).join(', ')}", so ${id} was added to those bonds' members and visibleMembers.`);
            for (const b of joined) noteBond(b, 'add', id);
          }
        }
      }
      keepKnown('garrisonIds', 'garrisons', '驻守', 'garrison');
      // The stand-in, the PRESET/NORMAL type and the promotion status belong to this installation. A pack value
      // that differs is named. Writing it breaks the official stand-in (a partial backup, or a status with no module).
      for (const field of ['backup', 'chessType', 'status']) {
        if (source[field] == null || sameJson(source[field], vanillaRec[field])) continue;
        listedHeld = true;
        skip(`${file}:${id}#${field}`, `「${field}」沿用本安装的官方记录（替身、棋子类型和晋升由这里的数据决定），包里的值没有写入。`, `"${field}" stays on the official record (the stand-in, the chess type and the promotion belong to this installation), so the pack's value was not written.`);
        delete source[field];
      }
    }
    if (file === 'bonds') {
      keepKnown('members', 'chess', '棋子', 'chess piece');
      keepKnown('visibleMembers', 'chess', '棋子', 'chess piece');
    }
    // [ASSUMED] bbStr.bond and bond_id are comma-separated bond ids (the garrison effect splits them the same way).
    // A token this installation does not have is named, and that field is not written: a shortened list would still
    // be a different effect. A string of known bond ids is left for leafOps.
    if (file === 'garrisons' && isObj(source.bbStr)) {
      const bondTable = table('bonds') || {};
      let bb = null;
      for (const key of ['bond', 'bond_id']) {
        const raw = (bb || source.bbStr)[key];
        if (typeof raw !== 'string') continue;
        const unknown = [];
        const seenTok = new Set();
        for (const token of raw.split(',')) {
          const t = token.trim();
          if (!t || seenTok.has(t)) continue;
          seenTok.add(t);
          if (!has(bondTable, t)) unknown.push(t.slice(0, 40));
        }
        if (!unknown.length) continue;
        listedHeld = true;
        skip(`${file}:${id}#bbStr.${key}`, `「${unknown.slice(0, 6).join('、')}」不是盟约 id，bbStr.${key} 的记号列表会因此改变，这个字段没有写入。`, `"${unknown.slice(0, 6).join(', ')}" is not a bond id, so the bbStr.${key} token list would change and that field was not written.`);
        if (!bb) bb = { ...source.bbStr };
        delete bb[key];
      }
      if (bb) source = { ...source, bbStr: bb };
    }
    const notes = [];
    const unsupported = [];
    const leaves = [];
    leafOps(vanillaRec, source, prefix, leaves, notes, unsupported);
    for (const op of forced) leaves.push({ path: [...prefix, ...op.path], value: op.value });
    const dataFile = file === 'units' ? 'backups' : file;
    for (const leaf of leaves) {
      if (file === 'units') patches.push({ op: 'set', file: 'backups', path: leaf.path, value: leaf.value });
      else patches.push({ op: 'set', file: dataFile, id, path: leaf.path, value: leaf.value });
    }
    if (leaves.length) importedData.push(`${file}:${id} → ${leaves.length} set`);
    else if (!unsupported.length && !skillHeld && !listedHeld) skip(`${file}:${id}`, '没有类型对得上的字段，没有改这条官方记录。', 'No field kept its type, so this official record was not changed.');
    if (unsupported.length) skip(`${file}:${id}#${unsupported[0]}`, `数组「${unsupported[0]}」要按 index 合并（talents / talentsBase）。这一版不整块替换，也没有逐项改。`, `The array "${unsupported[0]}" is merged by index (talents / talentsBase). This version neither replaces it wholesale nor edits its items.`);
    if (notes.length) skip(`${file}:${id}#${notes.slice(0, 3).join(',')}`, '有些字段对不上官方记录的类型或路径，那些字段没有改。', 'Some fields did not match the official type or path, so those fields were not changed.');
  };

  /** @type {Map<string, string>} */
  const charIds = new Map();
  /** @type {Map<string, string>} */
  const enemyIds = new Map();
  /** @type {Map<string, string>} */
  const skillIds = new Map();
  /** A Forge record id (unit key, unit charId, chess id and its stem) → our new charId: the kits' targets. */
  /** @type {Map<string, { charId: string, label: string }>} */
  const recordTargets = new Map();
  /** A kit file a record's `kit` field names → that record. */
  /** @type {Map<string, { charId: string, label: string }>} */
  const explicitKits = new Map();
  /** A unit of the pack whose shop piece is a chess.json pair → that pair (the unit is not emitted again as chess). */
  /** @type {Map<string, string>} */
  const chessCovered = new Map();
  /** @type {Set<string>} */
  const packTokenIds = new Set();
  const officialUnits = () => table('units') || {};
  // The pack's own new units, read before chess.json so a pair can name one (the main loop reads the file again).
  /** @type {Map<string, string>} forge charId or key → unit key */
  const packUnitIds = new Map();
  {
    let doc = null;
    try { doc = loadTableFile(files, used, 'units'); } catch (e) { if (e instanceof ForgeImportError) throw e; }
    for (const [key, rec] of Object.entries(asMap(doc, 'charId'))) {
      if (DANGER_KEYS.has(key) || has(officialUnits(), key)) continue;
      packUnitIds.set(key, key);
      if (isObj(rec) && typeof rec.charId === 'string' && rec.charId) packUnitIds.set(rec.charId, key);
    }
  }

  /** @type {{ skills: Map<string, Set<string>>, chars: Map<string, { chess: { key: string, tier: number, def: string | null, skills: Set<string> }[], op: boolean }> } | null} */
  let officialSkills = null;
  /** Official skill id → the operators that have it, and each operator's kits (our data and our kit registry). */
  const officialIndex = () => {
    if (officialSkills) return officialSkills;
    const skills = new Map();
    const chars = new Map();
    const note = (skillId, charId) => { if (!skills.has(skillId)) skills.set(skillId, new Set()); skills.get(skillId).add(charId); };
    const entry = (charId) => {
      if (!chars.has(charId)) chars.set(charId, { chess: [], op: has(OPERATOR_KITS, charId) });
      return chars.get(charId);
    };
    const chess = table('chess') || {};
    for (const r of Object.values(chess)) {
      if (!isObj(r) || r.isDiy || r.isGolden || typeof r.charId !== 'string' || !r.charId) continue;
      const golden = isObj(chess[r.goldenId]) ? chess[r.goldenId] : null;
      const ids = new Set([...(Array.isArray(r.skills) ? r.skills : []), ...(Array.isArray(golden?.skills) ? golden.skills : [])]
        .map((s) => s?.skillId).filter((x) => typeof x === 'string' && x));
      const key = typeof r.baseId === 'string' ? r.baseId : r.chessId;
      const e = entry(r.charId);
      if (CHESS_KIT_KEYS.has(key)) e.chess.push({ key, tier: r.tier, def: r.skill?.skillId ?? null, skills: ids });
      for (const id of ids) note(id, r.charId);
    }
    for (const [charId, u] of Object.entries(officialUnits())) {
      if (!isObj(u) || !isObj(u.forms)) continue;
      entry(charId);
      for (const f of Object.values(u.forms)) for (const s of Array.isArray(f?.skills) ? f.skills : []) {
        if (typeof s?.skillId === 'string' && s.skillId) note(s.skillId, charId);
      }
    }
    officialSkills = { skills, chars };
    return officialSkills;
  };
  const officialChar = (id) => derivedChars.has(id) || typeof id === 'string' && !!id && (officialIndex().chars.has(id) || !!(manifestArt?.chars && has(manifestArt.chars, id)));

  /**
   * The official kit a record's skill ids name, or why not; null when none of them is official (a new operator).
   * @returns {{ ref: string, charId: string } | { ref: null, zh: string, en: string } | null}
   */
  const bindOfficial = (skillList, defaultId, as, tier) => {
    const ids = [...new Set(skillList.filter((x) => typeof x === 'string' && x))];
    if (!ids.length) return null;
    const { skills, chars } = officialIndex();
    const unmatched = ids.filter((id) => !skills.has(id));
    if (unmatched.length === ids.length) return null;
    if (unmatched.length) return { ref: null, zh: `技能 ${unmatched.slice(0, 6).join('、')} 不是官方技能 id。只对上一部分，保留通用 kit。`, en: `The skills ${unmatched.slice(0, 6).join(', ')} are not official skill ids. A partial match keeps the generic kit.` };
    /** @type {Set<string> | null} */
    let owners = null;
    for (const id of ids) owners = owners ? new Set([...owners].filter((c) => skills.get(id).has(c))) : new Set(skills.get(id));
    if (!owners || owners.size !== 1) {
      const list = [...(owners || [])].slice(0, 4);
      return list.length
        ? { ref: null, zh: `这些官方技能同属几名干员（${list.join('、')}），对不上唯一一名，保留通用 kit。`, en: `These official skills belong to several operators (${list.join(', ')}), not to one, so the kit stays generic.` }
        : { ref: null, zh: '这些官方技能分属不同干员，对不上唯一一名，保留通用 kit。', en: 'These official skills belong to different operators, not to one, so the kit stays generic.' };
    }
    const charId = [...owners][0];
    const info = chars.get(charId) || { chess: [], op: false };
    if (as === 'diy') {
      return info.op ? { ref: charId, charId }
        : { ref: null, zh: `官方干员 ${charId} 在本模拟器里没有自选 kit，保留通用 kit。`, en: `The official operator ${charId} has no 自选 kit in this simulator, so the kit stays generic.` };
    }
    const fits = info.chess.filter((c) => ids.every((id) => c.skills.has(id)));
    const same = fits.filter((c) => c.def === defaultId);
    const byTier = same.filter((c) => c.tier === tier);
    const pick = same.length > 1 && byTier.length === 1 ? byTier : same;
    if (pick.length === 1) return { ref: pick[0].key, charId };
    if (info.op) return { ref: charId, charId };
    if (pick.length > 1) return { ref: null, zh: `官方干员 ${charId} 有几份棋子 kit（${pick.map((c) => c.key).join('、')}），对不上唯一一份，保留通用 kit。`, en: `The official operator ${charId} has several chess kits (${pick.map((c) => c.key).join(', ')}), not one, so the kit stays generic.` };
    if (fits.length) return { ref: null, zh: `默认技能 ${defaultId} 和官方棋子 ${fits[0].key} 的默认技能 ${fits[0].def} 不同：那份 kit 的默认规格会落在别的技能上，保留通用 kit。`, en: `The default skill ${defaultId} differs from ${fits[0].def}, the default of the official piece ${fits[0].key}: that kit's default spec would land on another skill, so the kit stays generic.` };
    return { ref: null, zh: `官方干员 ${charId} 在本模拟器里没有自己的 kit，保留通用 kit。`, en: `The official operator ${charId} has no kit of its own in this simulator, so the kit stays generic.` };
  };

  const numericBb = (bb, dropped, label, skill = false) => {
    if (!isObj(bb)) return null;
    const out = {};
    for (const [k, v] of Object.entries(bb)) {
      if (DANGER_KEYS.has(k)) continue;
      if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= PLUGIN_LIMITS.number) {
        const bound = officialBbRange(k);
        // [ASSUMED] Custom non-step skill parameters have no official maximum to scale; retain the general game bound.
        const max = skill && officialBbMax(k) === null && !isStepKey(k) ? PLUGIN_LIMITS.number : bound.max;
        if (Math.abs(v) <= max && !(v > 0 && v < bound.positiveMin)) out[k] = v;
        else { dropped.add(`${label}bb.${k}=${v} (admission bound ${bound.max}, minimum ${bound.positiveMin})`); }
      }
      else dropped.add(`${label}bb.${k}`);
    }
    return Object.keys(out).length ? out : null;
  };
  const stringMap = (m) => {
    if (!isObj(m)) return null;
    const out = {};
    for (const [k, v] of Object.entries(m).slice(0, 32)) if (!DANGER_KEYS.has(k) && typeof v === 'string') out[k] = v.slice(0, 200);
    return Object.keys(out).length ? out : null;
  };
  const RULE = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
  const cleanTrigger = (t) => {
    if (!isObj(t) || typeof t.rule !== 'string' || !RULE.test(t.rule)) return null;
    const out = { rule: t.rule, rawRule: typeof t.rawRule === 'string' && RULE.test(t.rawRule) ? t.rawRule : t.rule, customRangeGrid: gridOf(t.customRangeGrid) };
    if (t.allies === true) out.allies = true;
    return out;
  };
  /** One compact skill: the fields the expander and the sim read, each only when its type matches. */
  const cleanSkill = (s, skillId, isDefault, dropped) => {
    const skill = { skillId, name: typeof s.name === 'string' ? s.name.slice(0, 40) : '技能', default: isDefault };
    for (const [k, v] of Object.entries(s)) {
      if (!SKILL_KEEP.has(k)) {
        // index and level are derived by the expander (order, chess status); an icon equal to the id is the default
        if (v != null && k !== 'index' && k !== 'level' && !(k === 'iconId' && v === (s.skillId ?? s.id))) dropped.add(k);
        continue;
      }
      if (['duration', 'spCost', 'initSp', 'maxChargeTime', 'increment'].includes(k)) {
        if (typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= PLUGIN_LIMITS.number) skill[k] = v;
        else if (v != null) dropped.add(k);
      } else if (k === 'desc' && typeof v === 'string') skill.desc = v.slice(0, 200);
      else if (k === 'descRaw' && typeof v === 'string') skill.descRaw = v.slice(0, 400);
      else if (k === 'skillType' || k === 'spType' || k === 'durationType') {
        const allowed = k === 'skillType' ? SKILL_TYPES : k === 'spType' ? SP_TYPES : DURATION_TYPES;
        if (allowed.has(v)) skill[k] = v;
        else if (v != null) dropped.add(k);
      } else if (k === 'bb') {
        const bb = numericBb(v, dropped, '', true);
        if (bb) skill.bb = bb;
      } else if (k === 'bbStr') {
        const m = stringMap(v);
        if (m) skill.bbStr = m;
      } else if (k === 'trigger') {
        const t = cleanTrigger(v);
        if (t) skill.trigger = t;
        else if (v != null) dropped.add(k);
      } else if (k === 'rangeGrid') {
        const g = gridOf(v);
        if (g) skill.rangeGrid = g;
        else if (v != null) dropped.add(k);
      }
    }
    return skill;
  };
  /**
   * The compact skills of one list. keepIds: the record names an official kit, so the official skill ids stay (the
   * expander allows them with kit.ref). defaultId: the record's default when its skills mark none (a chess `skill`).
   */
  const compileSkillList = (list, { owner, tag, label, keepIds, defaultId, dropped }) => {
    if (!list.length) return null;
    let defaultAt = list.findIndex((s) => s.default === true || s.isDefault === true);
    if (defaultAt < 0 && defaultId) defaultAt = list.findIndex((s) => (s.skillId ?? s.id) === defaultId);
    if (defaultAt < 0) { defaultAt = 0; assume('skill-default', `「${label}」没有标默认技能，把第一条当成默认。`, `"${label}" marks no default skill, so the first one was used.`); }
    return list.map((s, i) => {
      const explicit = (typeof s.skillId === 'string' && s.skillId) || (typeof s.id === 'string' && s.id) || '';
      let skillId = keepIds && explicit ? explicit : '';
      if (!skillId) {
        const old = explicit || (tag ? `${owner}_${tag}_${i + 1}` : `${owner}_${i + 1}`);
        skillId = skillIds.get(old) || '';
        if (!skillId) {
          skillId = namespaced('skx', recordNs, old, seenIds);
          skillIds.set(old, skillId);
        }
      }
      return cleanSkill(s, skillId, i === defaultAt, dropped);
    });
  };
  const defaultOf = (list, fallback = null) => {
    const s = list.find((x) => x.default === true || x.isDefault === true) || (fallback ? list.find((x) => (x.skillId ?? x.id) === fallback) : null) || list[0];
    return s ? (s.skillId ?? s.id ?? null) : null;
  };
  /** A trait object (or a string): its text, numbers and range. Other fields are named. */
  const cleanTrait = (t, dropped) => {
    if (typeof t === 'string') return t.trim() ? { desc: t.slice(0, 200) } : null;
    if (!isObj(t)) return null;
    const out = {};
    for (const [k, v] of Object.entries(t)) {
      if (k === 'desc' && typeof v === 'string') out.desc = v.slice(0, 200);
      else if (k === 'descRaw' && typeof v === 'string') out.descRaw = v.slice(0, 400);
      else if (k === 'bb') { const bb = numericBb(v, dropped, 'trait.'); if (bb) out.bb = bb; }
      else if (k === 'bbStr') { const m = stringMap(v); if (m) out.bbStr = m; }
      else if (k === 'rangeGrid') { const g = gridOf(v); if (g) out.rangeGrid = g; else if (v != null) dropped.add('trait.rangeGrid'); }
      else if (v != null && v !== '') dropped.add(`trait.${k}`);
    }
    return Object.keys(out).length ? out : null;
  };
  /** Named talents in order (the expander numbers them; kits read them by that order). Module talents are named. */
  const cleanTalents = (list, dropped) => {
    if (!Array.isArray(list)) return null;
    const out = [];
    for (const t of list) {
      if (!isObj(t)) continue;
      if (t.fromModule === true || (Number.isInteger(t.index) && t.index < 0)) { dropped.add('talents(module)'); continue; }
      const one = {};
      for (const [k, v] of Object.entries(t)) {
        if (k === 'name' && typeof v === 'string') one.name = v.slice(0, 40);
        else if (k === 'desc' && typeof v === 'string') one.desc = v.slice(0, 200);
        else if (k === 'descRaw' && typeof v === 'string') one.descRaw = v.slice(0, 400);
        else if (k === 'bb') { const bb = numericBb(v, dropped, 'talents.'); if (bb) one.bb = bb; }
        else if (k === 'bbStr') { const m = stringMap(v); if (m) one.bbStr = m; }
        else if (k === 'rangeGrid') { const g = gridOf(v); if (g) one.rangeGrid = g; else if (v != null) dropped.add('talents.rangeGrid'); }
        else if (k === 'hidden' && typeof v === 'boolean') one.hidden = v;
        else if (k === 'index' || k === 'fromModule') continue;
        else if (v != null && v !== '') dropped.add(`talents.${k}`);
      }
      out.push(one);
    }
    return out;
  };
  /** Identity and attack fields the compact operator can say, from the record or its first form. */
  const recordExtras = (rec, form, op) => {
    for (const k of ['appellation', 'subProfessionName']) if (typeof rec[k] === 'string' && rec[k].trim()) op[k] = rec[k].trim().slice(0, 60);
    if (typeof rec.nationId === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(rec.nationId)) op.nationId = rec.nationId;
    for (const k of ['dmgType', 'attackKind', 'projectile', 'targetPriority']) {
      const v = rec[k] ?? form?.[k];
      if (RECORD_ENUMS[k].has(v)) op[k] = v;
    }
    const fly = rec.canHitFly ?? form?.canHitFly;
    if (typeof fly === 'boolean') op.canHitFly = fly;
  };
  const emptyish = (v) => v == null || v === false || v === '' || (Array.isArray(v) && !v.length) || (isObj(v) && Object.values(v).every(emptyish));
  const professionOf = (raw) => {
    let profession = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
    if (PROFESSION_ALIAS[profession]) {
      assume(`prof-${profession}`, `职业 ${profession} 写成 ${PROFESSION_ALIAS[profession]}。`, `Profession ${profession} was written as ${PROFESSION_ALIAS[profession]}.`);
      profession = PROFESSION_ALIAS[profession];
    }
    return profession;
  };
  const positionOf = (raw, profession) => {
    if (raw === 'MELEE' || raw === 'RANGED') return raw;
    const position = MELEE.has(profession) ? 'MELEE' : 'RANGED';
    assume('position', `没有 position，按职业写成 ${position}。`, `No position was set, so it was written as ${position} from the profession.`);
    return position;
  };
  /** Records left on the generic kit; their report line waits for the kits section (a script plugin may take over). */
  /** @type {{ label: string, name: string, kitPath: string | null, reason: { zh: string, en: string } | null, charId: string }[]} */
  const genericKits = [];
  const kitLine = (label, name, kitPath, reason) => {
    const zh = kitPath || '没有 kit 文件';
    const en = kitPath || 'no kit file';
    assume(`generic-${label}`, `[ASSUMED] ${label}: 未导入 kit 时使用通用技能。`, `[ASSUMED] ${label}: skills without an imported kit use generic behavior; complex talents are not inferred.`);
    if (reason) skip(`${label}#kit`, `${reason.zh}「${name}」在数据插件里用通用 kit（${zh}）。`, `${reason.en} "${name}" uses the generic kit in the content plugin (${en}).`);
    else skip(`${label}#kit`, `技能逻辑映射不成 kitRef、JSON SkillSpec 或 DSL，「${name}」在数据插件里用通用 kit（${zh}）。脚本不在导入时运行。`, `The skill logic does not map to a kitRef, a JSON SkillSpec or DSL, so "${name}" uses the generic kit in the content plugin (${en}). No script runs during the import.`, 'PLUGIN_FORGE_SCRIPT');
  };

  const mapOperator = (rawId, rec) => {
    if (!isObj(rec)) { skip(`units:${rawId}`, '干员记录不是对象，没有导入。', 'The operator record is not an object, so it was not imported.', undefined, 'operators'); return; }
    if (/^char_\d+_/.test(rec.charId ?? rawId) && !installedChar(rec.charId ?? rawId)) {
      try {
        const u = deriveChar(rec.charId ?? rawId, rec.tier ?? rec.rarity ?? 6);
        rec = { ...u, ...rec, forms: { ...u.forms, ...rec.forms } };
      } catch (e) { skip(`units:${rawId}#official`, e.message, e.message, undefined, 'operators'); return; }
    }
    const name = typeof rec.name === 'string' ? rec.name.trim().slice(0, 60) : '';
    const profession = professionOf(rec.profession);
    if (!name || !PROFESSIONS.has(profession) || typeof rec.subProfessionId !== 'string' || !rec.subProfessionId.trim()) {
      skip(`units:${rawId}`, '干员缺名字、职业或分支，没有导入。', 'The operator lacks a name, profession or branch, so it was not imported.', undefined, 'operators');
      return;
    }
    if (!Number.isInteger(rec.rarity) || rec.rarity < 1 || rec.rarity > 6) { skip(`units:${rawId}`, '星级不在 1–6，没有导入。', 'Rarity is not from 1 to 6, so it was not imported.', undefined, 'operators'); return; }
    const formsIn = isObj(rec.forms) ? rec.forms : null;
    if (!formsIn) { skip(`units:${rawId}`, '没有形态（forms），没有导入。', 'There are no forms, so it was not imported.', undefined, 'operators'); return; }
    const keys = formOrder(Object.keys(formsIn));
    const picked = keys.map((k) => formsIn[k]).filter((f) => isObj(f) && finiteStats(f.stats || f));
    if (!picked.length) { skip(`units:${rawId}`, '形态里没有能用的数值，没有导入。', 'No form has usable stats, so it was not imported.', undefined, 'operators'); return; }
    assume('forms', 'Forge 的形态阶（phase/level/skillLevel/equipLevel，或一个整数）按数字比较：最低一阶是 normal，最高一阶是 elite。', 'Forge form ranks (phase/level/skillLevel/equipLevel, or one integer) are compared as numbers: the lowest is normal, the highest is elite.');
    const position = positionOf(rec.position, profession);
    const pool = isObj(pack.operators) ? pack.operators : {};
    const declared = has(pool, rawId) || (typeof rec.charId === 'string' && has(pool, rec.charId));
    const poolRec = (has(pool, rawId) ? pool[rawId] : null) || (typeof rec.charId === 'string' && has(pool, rec.charId) ? pool[rec.charId] : null) || {};
    let as = 'chess';
    if (declared && rec.rarity === 6) {
      as = 'diy';
      assume('diy-only', `「${name}」只在 operators 里声明为六星，写成自选（diy），不放进商店。`, `"${name}" is a 6★ declared only in operators, so it was written as a recruit-pool operator (diy), not as a shop piece.`);
    } else if (declared && rec.rarity !== 6) {
      as = 'chess';
      assume('diy-rarity', `「${name}」进了自选声明但不是六星。自选池只要六星，所以写成棋子（chess）。`, `"${name}" is declared for the recruit pool but is not 6★. The pool is 6★ only, so it was written as chess.`);
    }
    if (as === 'chess' && chessCovered.has(String(rawId))) {
      skip(`units:${rawId}`, `它的棋子来自 chess.json 的 ${chessCovered.get(String(rawId))}，没有再写一份棋子。`, `Its shop piece is the chess.json pair ${chessCovered.get(String(rawId))}, so it was not written a second time.`);
      return;
    }
    const bonds = [...new Set([...(Array.isArray(poolRec.bonds) ? poolRec.bonds : []), ...(Array.isArray(rec.bonds) ? rec.bonds : [])].filter((b) => typeof b === 'string'))];
    const bondTable = table('bonds');
    const knownBonds = bonds.filter((b) => bondTable && has(bondTable, b));
    if (bonds.length && knownBonds.length !== bonds.length) skip(`units:${rawId}#bonds`, '有的盟约在本安装里不存在，那些盟约没有写上。', 'Some bonds do not exist in this installation, so those bonds were not written.');
    if (!knownBonds.length) {
      skip(`units:${rawId}`, as === 'diy' ? '自选干员也要至少一个本安装里存在的盟约，没有导入这个干员。' : '棋子需要至少一个本安装里存在的盟约，没有导入这个干员。', as === 'diy' ? 'A recruit-pool operator still needs a bond that exists in this installation, so this operator was not imported.' : 'A chess operator needs a bond that exists in this installation, so this operator was not imported.', undefined, 'operators');
      return;
    }
    const charId = namespaced('char_x', recordNs, rawId, seenIds);
    charIds.set(String(rawId), charId);
    if (typeof rec.charId === 'string' && rec.charId !== rawId) charIds.set(rec.charId, charId);
    const target = { charId, label: name };
    recordTargets.set(String(rawId), target);
    if (typeof rec.charId === 'string' && rec.charId) recordTargets.set(rec.charId, target);
    const formSkills = picked.map((f) => (Array.isArray(f.skills) ? f.skills.filter(isObj) : []));
    const topSkills = Array.isArray(rec.skills) ? rec.skills.filter(isObj) : [];
    const spec = isObj(rec.skillSpec) ? rec.skillSpec : isObj(rec.kit?.spec) ? rec.kit.spec : isObj(rec.spec) ? rec.spec : null;
    const specOk = !!spec && !validateSkillSpec(spec).length;
    const baseList = topSkills.length ? topSkills : formSkills.find((l) => l.length) || [];
    const binding = specOk ? null : bindOfficial([...formSkills.flat(), ...topSkills].map((s) => s.skillId ?? s.id), defaultOf(baseList), as, rec.rarity);
    const keepIds = !!binding?.ref;
    /** @type {Set<string>} */
    const dropped = new Set();
    const compiledForms = formSkills.map((list, idx) => compileSkillList(list, { owner: rawId, tag: `f${idx}`, label: name, keepIds, defaultId: null, dropped }));
    const compiledTop = compileSkillList(topSkills, { owner: rawId, tag: '', label: name, keepIds, defaultId: null, dropped });
    const fallback = compiledForms.find(Boolean) || compiledTop;
    if (!fallback) { skip(`units:${rawId}`, '没有技能，不能做成干员，没有导入。', 'There is no skill, so this cannot become an operator and was not imported.', undefined, 'operators'); return; }
    /** @type {Set<string>} */
    const fieldsDropped = new Set();
    const oneForm = (f, idx) => {
      const stats = finiteStats(f.stats || f);
      const grid = gridOf(f.rangeGrid || rec.rangeGrid);
      if (!grid) assume('range', '缺攻击范围，写成 [[0, 0]]。请作者改成真实范围。', 'No attack range was found, so it was written as [[0, 0]]. The author should replace it.');
      const out = { stats, rangeGrid: grid || [[0, 0]], skills: compiledForms[idx] || compiledTop || fallback };
      if (Array.isArray(rec.tags)) out.tags = rec.tags;
      if (Array.isArray(f.tokens)) { out.tokens = f.tokens.filter(id => table('tokens')?.[id]); for (const id of f.tokens) if (!out.tokens.includes(id)) fieldsDropped.add(`tokens.${id}`); }
      const trait = isObj(f.trait) ? cleanTrait(f.trait, fieldsDropped) : null;
      if (trait) out.trait = trait;
      const talents = cleanTalents(f.talents, fieldsDropped);
      if (talents?.length) out.talents = talents;
      return out;
    };
    const skills = compiledTop || fallback;
    let kit = 'generic';
    if (specOk) kit = { spec };
    else if (spec) skip(`units:${rawId}#spec`, 'JSON 技能规格没通过校验，改成通用 kit。', 'The JSON skill spec did not validate, so the kit is generic.');
    const kitPath = typeof rec.kit === 'string' ? rec.kit : typeof rec.kit?.script === 'string' ? rec.kit.script : typeof rec.kitFile === 'string' ? rec.kitFile : null;
    if (kitPath) {
      const found = lookup(files, kitPath);
      if (found) used.add(found);
      // a Forge kit is a .js module; another file named here stays what it was (named in the #kit line)
      if (found && extOf(found) === '.js') explicitKits.set(found, target);
    }
    if (binding?.ref) {
      kit = { ref: binding.ref };
      importedData.push(`units:${rawId} kit → ${binding.ref}（官方 ${binding.charId} · official）`);
      rewrittenData.push(`${rawId} kit → ref ${binding.ref}`);
    } else if (kit === 'generic') {
      const namedKit = [rawId, rec.charId].map((k) => `kits/${k}.js`).find((f) => files.has(f)) || null;
      genericKits.push({ label: `units:${rawId}`, name, kitPath: kitPath || namedKit, reason: binding, charId });
      rewrittenData.push(`${rawId} kit → generic`);
    }
    const normalForm = oneForm(picked[0], 0);
    const op = {
      op: 1, charId, name, profession, subProfessionId: rec.subProfessionId.trim().slice(0, 40), position, rarity: rec.rarity, as,
      forms: { normal: normalForm, elite: oneForm(picked[picked.length - 1], picked.length - 1) }, skills, kit,
    };
    // The compact schema requires chess.tier whenever chess is present. as "diy" is what keeps the piece out of the
    // shop (records.js writes a shop chess only when as !== "diy"). The tier is the rarity and is not a shop listing.
    if (knownBonds.length) op.chess = { tier: rec.rarity, bonds: knownBonds };
    if (typeof rec.trait === 'string') op.trait = { desc: rec.trait.slice(0, 120) };
    else if (isObj(rec.trait) && typeof rec.trait.desc === 'string') op.trait = { desc: rec.trait.desc.slice(0, 120) };
    recordExtras(rec, picked[0], op);
    // [ASSUMED] Only an explicit installed base/character establishes provenance, never the skill binding.
    const source = typeof rec.base === 'string' ? table('chess')?.[rec.base] : null;
    if (source) op.origin = { chessId: rec.base, ...(source.charId ? { charId: source.charId } : {}) };
    else if (installedChar(rec.base)) op.origin = { charId: rec.base };
    else if (installedChar(rec.charId)) op.origin = { charId: rec.charId };
    else if (rec.base != null) skip(`units:${rawId}#base`, '官方来源不存在，没有保留来源引用。', 'The official source does not exist; its provenance reference was omitted.');
    if (dropped.size) skip(`units:${rawId}#skill-fields`, `技能字段 ${[...dropped].slice(0, 8).join('、')} 写不进紧凑记录，没有照抄。`, `Skill fields ${[...dropped].slice(0, 8).join(', ')} do not fit the compact record, so they were not copied.`);
    if (fieldsDropped.size) skip(`units:${rawId}#fields`, `字段 ${[...fieldsDropped].slice(0, 8).join('、')} 写不进紧凑记录，没有照抄。`, `Fields ${[...fieldsDropped].slice(0, 8).join(', ')} do not fit the compact record, so they were not copied.`);
    const artRef = typeof rec.artRef === 'string' ? rec.artRef : typeof rec.art === 'string' ? rec.art : null;
    if (artRef) op.art = { ref: artRef };
    if (isObj(rec.assets)) {
      const exact = Object.fromEntries(Object.entries(rec.assets).filter(([key, v]) => /^(avatar|portrait|spine|voice|skillIcon|subProfIcon)(Golden)?$/.test(key) && typeof v === 'string' && v));
      if (Object.keys(exact).length) op.art = { ...op.art, assets: exact };
    }
    if (Array.isArray(poolRec.powers) && poolRec.powers.every((p) => typeof p === 'string') && as !== 'chess') op.powers = poolRec.powers.slice(0, 8);
    operators.push(op);
    importedData.push(`units:${rawId} → ${charId}`);
    rewrittenData.push(`${rawId} → ${charId}`);
    return charId;
  };

  /** The character a chess pair is: an official operator, a unit of the pack, or (charId null) official art. */
  const chessUnit = (rec) => {
    if (typeof rec.charId === 'string' && rec.charId) {
      if (packUnitIds.has(rec.charId)) return { kind: 'pack', charId: rec.charId, key: packUnitIds.get(rec.charId) };
      return officialChar(rec.charId) ? { kind: 'official', charId: rec.charId } : null;
    }
    if (isObj(rec.assets) && Object.values(rec.assets).some(v => typeof v === 'string' && v)) return { kind: 'assets' };
    return null;
  };

  /** One chess.json _a/_b pair → one compact record (Addition 1, round 43). */
  const mapChessPair = (baseId, normal, elite) => {
    if (typeof normal.charId === 'string' && /^char_\d+_/.test(normal.charId) && !installedChar(normal.charId)) {
      try {
        const u = deriveChar(normal.charId, normal.tier);
        const fs = Object.values(u.forms);
        const fill = (r, f) => { const { forms, moduleNames, ...head } = u; return { ...head, ...f, ...r }; };
        normal = fill(normal, fs[0]); elite = fill(elite, fs.at(-1));
      } catch (e) {
        skip(`chess:${baseId}#official`, e.message, e.message, undefined, 'operators'); return;
      }
    }
    const label = `chess:${baseId}`;
    const name = typeof normal.name === 'string' ? normal.name.trim().slice(0, 60) : '';
    const profession = professionOf(normal.profession);
    const sub = typeof normal.subProfessionId === 'string' ? normal.subProfessionId.trim().slice(0, 40) : '';
    if (!name || !PROFESSIONS.has(profession) || !sub) { skip(label, '棋子缺名字、职业或分支，没有导入。', 'The chess record lacks a name, profession or branch, so it was not imported.', undefined, 'operators'); return; }
    const tier = Number.isInteger(normal.tier) && normal.tier >= 1 && normal.tier <= 6 ? normal.tier : 0;
    if (!tier) { skip(label, '阶级（tier）不在 1–6，没有导入。', 'The tier is not from 1 to 6, so it was not imported.', undefined, 'operators'); return; }
    let rarity = Number.isInteger(normal.rarity) && normal.rarity >= 1 && normal.rarity <= 6 ? normal.rarity : 0;
    if (!rarity) {
      rarity = tier;
      assume('chess-rarity', '棋子没有 1–6 的星级时，星级写成它的阶级。', 'A chess record without a rarity from 1 to 6 takes its tier as the rarity.');
    }
    const unit = chessUnit(normal);
    if (!unit) {
      skip(label, `棋子的 charId（${String(normal.charId ?? 'null').slice(0, 40)}）既不是官方干员，也不是本包 units.json 里的干员，assets 里也没有官方干员的美术，没有导入。`, `The chess record's charId (${String(normal.charId ?? 'null').slice(0, 40)}) is neither an official operator nor a unit of this pack's units.json, and its assets name no official art, so it was not imported.`, undefined, 'operators');
      return;
    }
    const position = positionOf(normal.position, profession);
    let as = 'chess';
    if (normal.isDiy === true && rarity === 6) {
      as = 'diy';
      assume('chess-diy', `「${name}」是 isDiy 的六星棋子，写成自选（diy），不放进商店。`, `"${name}" is a 6★ isDiy chess record, so it was written as a recruit-pool operator (diy), not as a shop piece.`);
    } else if (normal.isDiy === true) assume('diy-rarity', `「${name}」进了自选声明但不是六星。自选池只要六星，所以写成棋子（chess）。`, `"${name}" is declared for the recruit pool but is not 6★. The pool is 6★ only, so it was written as chess.`);
    const bondTable = table('bonds');
    const listed = [...new Set((Array.isArray(normal.bonds) ? normal.bonds : []).filter((b) => typeof b === 'string'))];
    let bonds = listed.filter((b) => bondTable && has(bondTable, b));
    if (listed.length && bonds.length !== listed.length) skip(`${label}#bonds`, '有的盟约在本安装里不存在，那些盟约没有写上。', 'Some bonds do not exist in this installation, so those bonds were not written.');
    if (!listed.length) {
      const fallbackBond = table('config')?.economy?.fallbackBondId;
      if (typeof fallbackBond === 'string' && bondTable && has(bondTable, fallbackBond)) {
        bonds = [fallbackBond];
        assume('chess-fallback-bond', `没有盟约的棋子写上兜底盟约 ${fallbackBond}（协防干员），和工作台的干员模板一样。`, `A chess record with no bond gets the fallback bond ${fallbackBond} (协防干员), as the studio's operator template does.`);
      }
    }
    if (!bonds.length) { skip(label, '棋子需要至少一个本安装里存在的盟约，没有导入这个棋子。', 'A chess piece needs a bond that exists in this installation, so this piece was not imported.', undefined, 'operators'); return; }
    const nList = Array.isArray(normal.skills) && normal.skills.some(isObj) ? normal.skills.filter(isObj) : isObj(normal.skill) ? [normal.skill] : [];
    const eList = Array.isArray(elite.skills) && elite.skills.some(isObj) ? elite.skills.filter(isObj) : isObj(elite.skill) ? [elite.skill] : [];
    const defN = typeof normal.skill?.skillId === 'string' ? normal.skill.skillId : null;
    const defE = typeof elite.skill?.skillId === 'string' ? elite.skill.skillId : defN;
    if (!nList.length && !eList.length) { skip(label, '没有技能，不能做成棋子，没有导入。', 'There is no skill, so this cannot become a piece and was not imported.', undefined, 'operators'); return; }
    if (!finiteStats(normal.stats) || !finiteStats(elite.stats)) { skip(label, '没有能用的数值（stats），没有导入。', 'There are no usable stats, so it was not imported.', undefined, 'operators'); return; }
    const declared6 = unit.kind === 'pack' && rarity === 6 && isObj(pack.operators) && (has(pack.operators, unit.key) || has(pack.operators, unit.charId));
    if (unit.kind === 'pack' && declared6) assume('chess-and-diy', `「${name}」既有 chess.json 的棋子，又在 operators 里声明为自选：写成两条记录，棋子一条，自选一条。`, `"${name}" has a chess.json piece and a recruit-pool declaration: two records were written, the piece and the 自选 operator.`);
    const stem = baseId.replace(/^chess_/, '').replace(/_a$/, '');
    const charId = namespaced('char_x', recordNs, stem, seenIds);
    const target = { charId, label: name };
    if (unit.kind === 'official') charIds.set(unit.charId, charId);
    for (const k of new Set([baseId, baseId.replace(/_a$/, '_b'), normal.chessId, elite.chessId, baseId.replace(/_a$/, '')])) {
      if (typeof k === 'string' && k) recordTargets.set(k, target);
    }
    if (unit.kind === 'pack' && !declared6) {
      chessCovered.set(unit.key, baseId);
      charIds.set(unit.charId, charId);
      if (unit.key !== unit.charId) charIds.set(unit.key, charId);
    }
    const binding = bindOfficial([...nList, ...eList].map((s) => s.skillId ?? s.id), defaultOf(nList, defN), as, tier);
    const keepIds = !!binding?.ref;
    /** @type {Set<string>} */
    const dropped = new Set();
    const nSkills = compileSkillList(nList.length ? nList : eList, { owner: stem, tag: '', label: name, keepIds, defaultId: defN, dropped });
    const eSkills = (eList.length ? compileSkillList(eList, { owner: stem, tag: '', label: name, keepIds, defaultId: defE, dropped }) : null) || nSkills;
    /** @type {Set<string>} */
    const fieldsDropped = new Set();
    const form = (r, skills) => {
      const grid = gridOf(r.rangeGrid);
      if (!grid) assume('range', '缺攻击范围，写成 [[0, 0]]。请作者改成真实范围。', 'No attack range was found, so it was written as [[0, 0]]. The author should replace it.');
      const out = { stats: finiteStats(r.stats), rangeGrid: grid || [[0, 0]], skills };
      if (Array.isArray(r.tags)) out.tags = r.tags;
      if (Array.isArray(r.tokens)) {
        out.tokens = r.tokens.filter(id => table('tokens')?.[id]);
        for (const id of r.tokens) if (!out.tokens.includes(id)) fieldsDropped.add(`tokens.${id}`);
      }
      const trait = cleanTrait(r.trait, fieldsDropped);
      if (trait) out.trait = trait;
      const talents = cleanTalents(r.talents, fieldsDropped);
      if (talents?.length) out.talents = talents;
      return out;
    };
    const chess = { tier, bonds };
    const money = (n) => (typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= PLUGIN_LIMITS.number ? n : null);
    if (typeof normal.price === 'number' && Number.isFinite(normal.price) && Math.abs(normal.price) > PLUGIN_LIMITS.number) skip(`${label}#price`, `price ${normal.price} 超出 ±${PLUGIN_LIMITS.number}，没有写进游戏数据。`, `price ${normal.price} is outside ±${PLUGIN_LIMITS.number}, so it was not written into game data.`);
    if (typeof elite.price === 'number' && Number.isFinite(elite.price) && Math.abs(elite.price) > PLUGIN_LIMITS.number) skip(`${label}#price`, `精锐 price ${elite.price} 超出 ±${PLUGIN_LIMITS.number}，没有写进游戏数据。`, `The elite price ${elite.price} is outside ±${PLUGIN_LIMITS.number}, so it was not written into game data.`);
    const priceN = money(normal.price);
    const priceE = money(elite.price) ?? priceN;
    if (priceN != null) chess.price = priceN === priceE ? priceN : { normal: priceN, golden: priceE };
    if (typeof normal.sellPrice === 'number' && Number.isFinite(normal.sellPrice) && Math.abs(normal.sellPrice) > PLUGIN_LIMITS.number) skip(`${label}#sellPrice`, `sellPrice ${normal.sellPrice} 超出 ±${PLUGIN_LIMITS.number}，没有写进游戏数据。`, `sellPrice ${normal.sellPrice} is outside ±${PLUGIN_LIMITS.number}, so it was not written into game data.`);
    const sellN = money(normal.sellPrice);
    const sellE = money(elite.sellPrice) ?? sellN;
    if (sellN != null && sellN === sellE) chess.sellPrice = sellN;
    else if (sellN != null) skip(`${label}#sellPrice`, '普通和精锐的卖价不同，紧凑记录只有一个卖价，用本安装的经济表。', 'The normal and elite sell prices differ, and the compact record has one sell price, so the economy table applies.');
    const garrisons = table('garrisons') || {};
    const garrisonList = (r) => (Array.isArray(r.garrisonIds) ? r.garrisonIds.filter((g) => typeof g === 'string') : []);
    const gN = garrisonList(normal);
    const gE = elite === normal ? gN : garrisonList(elite);
    const knownN = gN.filter((g) => has(garrisons, g));
    const knownE = gE.filter((g) => has(garrisons, g));
    if (knownN.length !== gN.length || knownE.length !== gE.length) skip(`${label}#garrisonIds`, '有的驻守效果在本安装里不存在，那些没有写上。', 'Some garrison effects do not exist in this installation, so those were not written.');
    if (knownN.length || knownE.length) chess.garrisonIds = sameJson(knownN, knownE) ? knownN : { normal: knownN, golden: knownE };
    for (const k of ['identifier', 'shopSortId']) if (Number.isInteger(normal[k]) && normal[k] >= 0 && normal[k] <= 1e6) chess[k] = normal[k];
    // what our economy decides, and the pack says otherwise
    const econ = table('config')?.economy;
    const statusKeys = ['phase', 'level', 'skillLevel', 'equipLevel'];
    const statusDiffers = (r, quality) => isObj(r.status) && isObj(econ?.chessStatus?.[tier]?.[quality]) && statusKeys.some((k) => r.status[k] !== econ.chessStatus[tier][quality][k]);
    if (statusDiffers(normal, 'normal') || statusDiffers(elite, 'golden')) skip(`${label}#status`, `练度（status）由本安装第 ${tier} 阶的经济表决定，包里写的不一样，没有照抄。`, `The level (status) comes from this installation's tier-${tier} economy; the pack's differs and was not copied.`);
    if (Number.isInteger(normal.upgradeNum) && Number.isInteger(econ?.mergeCount) && normal.upgradeNum !== econ.mergeCount) skip(`${label}#upgradeNum`, `合成数由经济表决定（${econ.mergeCount}），包里写的是 ${normal.upgradeNum}，没有照抄。`, `The merge count comes from the economy (${econ.mergeCount}); the pack says ${normal.upgradeNum}, which was not copied.`);
    if (typeof normal.chessType === 'string' && normal.chessType !== 'PRESET') assume('chess-preset', `Forge 的 ${normal.chessType} 棋子写成 PRESET：新棋子自己就是自己的补位，紧凑记录没有别的类型。`, `A Forge ${normal.chessType} piece was written as PRESET: a new piece is its own stand-in, and the compact record has no other type.`);
    // [ASSUMED] Invisible non-DIY pieces are effect-only. Forge DIY is invisible in the shop by definition.
    if (normal.isHidden === true || (normal.visible === false && normal.isDiy !== true)) chess.hidden = true;
    const rawNormalId = normal.chessId ?? baseId;
    const rawEliteId = elite !== normal ? elite.chessId : normal.upgradeChessId ?? rawNormalId.replace(/_a$/, '_b');
    if (typeof rawNormalId === 'string' && typeof rawEliteId === 'string' && rawNormalId !== rawEliteId) {
      chess.ids = { normal: namespaced('chess_x', recordNs, rawNormalId.replace(/^chess_/, ''), seenIds), elite: namespaced('chess_x', recordNs, rawEliteId.replace(/^chess_/, ''), seenIds) };
      recordIds.set(rawNormalId, chess.ids.normal); recordIds.set(rawEliteId, chess.ids.elite);
      if (normal.upgradeChessId && normal.upgradeChessId !== rawEliteId) skip(`${label}#upgradeChessId`, '升级目标和精锐棋子 id 不同，升级目标没有照抄。', 'The upgrade target differs from the elite chess id, so that target was not copied.');
    }
    const forms = { normal: form(normal, nSkills), elite: form(elite, eSkills) };
    const named = new Set();
    for (const r of normal === elite ? [normal] : [normal, elite]) {
      for (const [k, v] of Object.entries(r)) if (!CHESS_KEEP.has(k) && !emptyish(v)) named.add(k);
      if (!emptyish(r.backup) && r.backup?.charId && r.backup.charId !== r.charId) named.add('backup');
      if (!emptyish(r.workshop)) named.add('workshop');
    }
    for (const k of dropped) named.add(`skills.${k}`);
    for (const k of fieldsDropped) named.add(k);
    if (named.size) skip(`${label}#fields`, `字段 ${[...named].slice(0, 10).join('、')} 写不进紧凑记录，没有照抄。`, `Fields ${[...named].slice(0, 10).join(', ')} do not fit the compact record, so they were not copied.`);
    let kit = 'generic';
    if (binding?.ref) {
      kit = { ref: binding.ref };
      importedData.push(`${label} kit → ${binding.ref}（官方 ${binding.charId} · official）`);
      rewrittenData.push(`${baseId} kit → ref ${binding.ref}`);
    } else {
      genericKits.push({ label, name, kitPath: [baseId, baseId.replace(/_a$/, '_b')].map((k) => `kits/${k}.js`).find((f) => files.has(f)) || null, reason: binding, charId });
      rewrittenData.push(`${baseId} kit → generic`);
    }
    const op = {
      op: 1, charId, name, profession, subProfessionId: sub, position, rarity, as,
      forms, skills: nSkills, kit, chess,
    };
    recordExtras(normal, null, op);
    if (unit.kind === 'official') { if (installedChar(unit.charId)) op.origin = { charId: unit.charId }; op.art = { ref: unit.charId }; }
    // [ASSUMED] Forge base is provenance only. baseId describes the pair, never an official source or a kit.
    if (typeof normal.base === 'string') {
      const source = table('chess')?.[normal.base];
      if (source) op.origin = { chessId: normal.base, ...(source.charId ? { charId: source.charId } : {}) };
      else if (installedChar(normal.base)) op.origin = { charId: normal.base };
      else skip(`${label}#base`, '官方来源不存在，没有保留来源引用。', 'The official source does not exist; its provenance reference was omitted.');
    }
    // Forge's sidecars are asset ids. Keep each form's explicit ids so the E2 portrait does not depend on suffix guesses.
    const nArt = isObj(normal.assets) ? normal.assets : {}, eArt = isObj(elite.assets) ? elite.assets : nArt;
    const exact = {};
    for (const key of ['avatar', 'portrait', 'spine', 'voice', 'skillIcon', 'subProfIcon']) {
      if (typeof nArt[key] === 'string' && nArt[key]) exact[key] = nArt[key];
      if (typeof eArt[key] === 'string' && eArt[key]) exact[`${key}Golden`] = eArt[key];
    }
    if (Object.keys(exact).length) op.art = { ...(op.art ?? {}), assets: exact };
    operators.push(op);
    importedData.push(`${label} → ${charId}（${as === 'diy' ? '自选 · recruit pool' : `第 ${tier} 阶棋子 · tier-${tier} piece`}）`);
    rewrittenData.push(`${baseId} → ${charId}`);
  };

  /** New chess.json records grouped into _a/_b pairs (Forge's chessId must equal its key). */
  const mapChessRecords = (records) => {
    /** @type {Map<string, { normal: any[], elite: any[] }>} */
    const groups = new Map();
    const parents = new Map();
    for (const [id, rec] of records) for (const target of [rec?.upgradeChessId, rec?.goldenId]) if (target && target !== id) parents.set(target, id);
    for (const [id, rec] of records) {
      if (!isObj(rec)) { skip(`chess:${id}`, '棋子记录不是对象，没有导入。', 'The chess record is not an object, so it was not imported.', undefined, 'operators'); continue; }
      if (rec.chessId != null && rec.chessId !== id) { skip(`chess:${id}`, 'chessId 和键不一致（Forge 也拒这一条），没有导入。', 'chessId differs from its key (Forge refuses it too), so it was not imported.', undefined, 'operators'); continue; }
      const parent = parents.get(id);
      const base = typeof rec.baseId === 'string' && rec.baseId ? rec.baseId : parent ?? id.replace(/_b$/, '_a');
      const golden = rec.isGolden === true || (rec.isGolden == null && (parent != null || id.endsWith('_b')));
      if (!groups.has(base)) groups.set(base, { normal: [], elite: [] });
      groups.get(base)[golden ? 'elite' : 'normal'].push({ ...rec, chessId: id });
    }
    for (const [base, g] of groups) {
      if (g.normal.length > 1 || g.elite.length > 1) { skip(`chess:${base}`, '同一对棋子里有两条普通或两条精锐记录，没有导入。', 'The pair has two normal or two elite records, so it was not imported.', undefined, 'operators'); continue; }
      const normal = g.normal[0] || g.elite[0];
      const elite = g.elite[0] || g.normal[0];
      if (!g.normal.length || !g.elite.length) assume('chess-one', '一对棋子只有一条记录时，这一条写进普通和精锐两档。', 'A pair with one record uses it for both the normal and the elite form.');
      mapChessPair(base, normal, elite);
    }
  };

  // [ASSUMED] Only a whole new record that was not written counts. An official record left alone, a field note,
  // and a unit already imported as its chess pair do not. Effects are not one of these kinds.
  const DROP_TABLE = { chess: 'operators', units: 'operators', bonds: 'bonds', bands: 'bands', items: 'items', tokens: 'tokens', garrisons: 'traits' };
  for (const name of CONTENT_NAMES) {
    let doc;
    try { doc = loadTableFile(files, used, name); } catch (e) {
      if (e instanceof ForgeImportError) throw e;
      skip(`${name}.json`, '这个数据文件读不了，没有导入。', 'This data file could not be read, so it was not imported.', undefined, DROP_TABLE[name]);
      continue;
    }
    if (!doc) {
      if (declaredContent.includes(name)) skip(`content:${name}`, 'content 声明了这个文件，但包里没有对应的 JSON，没有导入。', 'content names this file, but the pack has no such JSON, so it was not imported.', undefined, DROP_TABLE[name]);
      continue;
    }
    const past = numbersPastBound(doc);
    if (past.length) {
      const shown = past.slice(0, 8);
      const tail = past.length > shown.length ? ` (+${past.length - shown.length})` : '';
      skip(`${name}.json#number`, `这些数超出 ±${PLUGIN_LIMITS.number}，没有写进游戏数据。写进游戏数据的仍限 ±${PLUGIN_LIMITS.number}：技能 duration、spCost、initSp、maxChargeTime、increment，黑板，属性，price、sellPrice，补丁叶子。${shown.join('；')}${tail}`, `These numbers are outside ±${PLUGIN_LIMITS.number} and were not written into game data. Values that are written stay within ±${PLUGIN_LIMITS.number}: skill duration, spCost, initSp, maxChargeTime, increment, blackboards, stats, price, sellPrice, and patch leaves. ${shown.join('; ')}${tail}`);
    }
    const idField = name === 'units' ? 'charId' : name === 'enemies' ? 'key' : name === 'chess' ? 'chessId' : 'id';
    const map = asMap(doc, idField);
    /** @type {Map<string, any>} */
    const newChess = new Map();
    for (const [id, rec] of Object.entries(map)) {
      if (id === '__proto__' || id === 'constructor' || id === 'prototype') continue;
      if (gameplay.handled.has(`${name}:${id}`)) continue;
      const exists = name === 'units' ? !!(table('units') && has(table('units'), id)) : !!(table(name) && has(table(name), id));
      const declared = overrideKeys.has(`${name}:${id}`);
      if (exists) {
        if (!declared) { skip(`${name}:${id}`, '这条官方记录没有写进 overrides，按 Forge 的规矩不能默默覆盖，没有导入。', 'This official record is not in overrides. Forge refuses a silent replace, so it was not imported.'); continue; }
        if (!PATCH_TABLE[name] && name !== 'units') { skip(`${name}:${id}`, '这张表对不上我们的补丁文件，没有导入。', 'This table does not match a patch file of ours, so it was not imported.'); continue; }
        patchRecord(name, id, rec);
        continue;
      }
      if (name === 'chess') { newChess.set(id, rec); continue; }
      if (name === 'units') { mapOperator(id, isObj(rec) ? { ...rec, charId: rec.charId || id } : rec); continue; }
      if (name === 'tokens') packTokenIds.add(id);
      if (name === 'enemies' && isObj(rec)) {
        const baseId = typeof rec.base === 'string' ? rec.base : typeof rec.special === 'string' ? rec.special : '';
        const enemies = table('enemies');
        if (!baseId || !enemies || !has(enemies, baseId)) {
          skip(`enemies:${id}`, '新敌人没有写一个本安装里存在的官方 base（或 special），不能凭空造一套技能，没有导入。', 'A new enemy has no official base (or special) that exists in this installation. A kit was not invented, so it was not imported.');
          continue;
        }
        const eid = namespaced('enemy_x', recordNs, id, seenIds);
        enemyIds.set(id, eid);
        const set = {};
        if (typeof rec.name === 'string' && rec.name.trim()) set.name = rec.name.trim().slice(0, 60);
        const stats = finiteStats(rec.stats || rec, enemies[baseId]?.stats);
        if (stats) set.stats = stats;
        enemyRecords.push({ id: eid, base: baseId, ...(rec.special && rec.special !== baseId ? { special: rec.special } : {}), ...(Object.keys(set).length ? { set } : {}) });
        importedData.push(`enemies:${id} → ${eid} (base ${baseId})`);
        rewrittenData.push(`${id} → ${eid}`);
        continue;
      }
      skip(`${name}:${id}`, '新记录没有安全的紧凑映射（模式不是 Forge 的表；其他表只自动导入带官方 base 的敌人、干员和成对的棋子，以及已有记录上类型不变的补丁）。', 'A new record has no safe compact mapping (Forge has no mode table; other tables only auto-import enemies with an official base, operators, chess pairs, and type-preserving patches of existing records).', undefined, DROP_TABLE[name]);
    }
    if (newChess.size) mapChessRecords(newChess);
  }

  // Chess overrides are planned before bond overrides. Compose membership onto the bond op when one exists, otherwise
  // onto the official array. A result that equals the official list drops a redundant op. visibleMembers is edited
  // only when that array already exists: an empty invented list would hide every other member in the catalogue.
  if (bondEdits.size) {
    const bondTable = table('bonds') || {};
    const sameList = (a, b) => Array.isArray(b) && a.length === b.length && a.every((v, i) => v === b[i]);
    for (const [bondId, edit] of bondEdits) {
      const official = bondTable[bondId];
      if (!isObj(official)) continue;
      for (const field of ['members', 'visibleMembers']) {
        const idx = patches.findIndex((op) => op && op.op === 'set' && op.file === 'bonds' && op.id === bondId && Array.isArray(op.path) && op.path.length === 1 && op.path[0] === field);
        const existing = idx >= 0 ? patches[idx] : null;
        const base = existing && Array.isArray(existing.value) ? existing.value.slice()
          : Array.isArray(official[field]) ? official[field].slice() : null;
        if (!base) continue;
        const next = base.filter((m) => typeof m !== 'string' || !edit.remove.has(m));
        for (const chessId of edit.add) {
          if (!edit.remove.has(chessId) && !next.includes(chessId)) next.push(chessId);
        }
        if (sameList(next, official[field])) {
          if (idx >= 0) patches.splice(idx, 1);
        } else if (existing) existing.value = next;
        else patches.push({ op: 'set', file: 'bonds', id: bondId, path: [field], value: next });
      }
    }
  }

  for (const [a, b] of skillIds) recordIds.set(a, b);
  for (let i = 0; i < gameplayRecords.length; i++) gameplayRecords[i] = rewriteForgeIds(gameplayRecords[i], recordIds);
  for (let i = 0; i < operators.length; i++) operators[i] = rewriteForgeIds(operators[i], recordIds);
  for (let i = 0; i < patches.length; i++) patches[i] = rewriteForgeIds(patches[i], recordIds);

  // ---- kits/<id>.js → one sandboxed script plugin (Addition 3, round 43; forgeKits.js) --------------------------------
  /** @type {{ source: string, registered: { file: string, register: string, carried: string[], kind: string, label: string }[], mapped: string[], overrides: string[] } | null} */
  let scriptPlan = null;
  {
    // file names go into the entry as comments, so only plain names are carried (helpers are checked by forgeKits.js)
    const SAFE_KIT = /^[A-Za-z0-9_][A-Za-z0-9_./-]*\.js$/;
    const named = [...files.keys()].filter((rel) => /^kits\/[^/]+\.js$/.test(rel) && !rel.slice(5).startsWith('_'));
    const officialTarget = (stem) => {
      const chessId = stem.replace(/_b$/, '_a');
      if ((overrideKeys.has(`chess:${stem}`) || overrideKeys.has(`chess:${chessId}`)) && has(table('chess') || {}, chessId)) {
        return { charId: chessId, label: chessId, kind: 'official', override: has(KITS, chessId) ? chessId : null };
      }
      if (overrideKeys.has(`units:${stem}`) && has(officialUnits(), stem)) return { charId: stem, label: stem, kind: 'official', override: has(KITS, stem) ? stem : null };
      return null;
    };
    /** @type {{ file: string, register: string, kind: string, label: string, override: string | null }[]} */
    const jobs = [];
    const taken = new Map();
    for (const file of [...new Set([...explicitKits.keys(), ...named])].sort()) {
      used.add(file);
      const stem = file.split('/').pop().replace(/\.js$/, '');
      if (!SAFE_KIT.test(file)) {
        skip(file, '文件名里有字母、数字和 . _ - 以外的字符，转不成脚本插件；导入时不执行它。', 'The file name has characters other than letters, digits and . _ -, so it was not converted; the importer does not run it.', 'PLUGIN_FORGE_SCRIPT', 'kits');
        continue;
      }
      const owner = explicitKits.get(file);
      const target = owner ? { ...owner, kind: 'record', override: null } : recordTargets.has(stem) ? { ...recordTargets.get(stem), kind: 'record', override: null } : officialTarget(stem);
      if (!target) {
        const why = packTokenIds.has(stem)
          ? ['这是召唤物（tokens）的 kit，当前脚本注册接口只支持干员；召唤物数据可导入，但这份 kit 没有转换，导入时不执行它。', 'This is a summon (tokens) kit. Token data can import, but the script registration surface supports operators only, so this kit was not converted; the importer does not run it.']
          : [`文件名「${stem}」不是本包导入的棋子或干员，也不是 overrides 里声明的官方 id，转不成脚本插件；导入时不执行它。`, `The file name "${stem}" is not an imported chess or operator record of this pack, nor an official id the pack declares in overrides, so it was not converted; the importer does not run it.`];
        skip(file, why[0], why[1], 'PLUGIN_FORGE_SCRIPT', 'kits');
        continue;
      }
      if (taken.has(target.charId)) {
        skip(file, `「${target.label}」已经有 ${taken.get(target.charId)} 这份 kit，这一份没有转换；导入时不执行它。`, `"${target.label}" already has the kit ${taken.get(target.charId)}, so this one was not converted; the importer does not run it.`, 'PLUGIN_FORGE_SCRIPT', 'kits');
        continue;
      }
      if (!scripts) {
        skip(file, `--no-scripts：没有生成脚本插件，「${target.label}」在数据插件里用它自己的 kit；导入时不执行这个文件。`, `--no-scripts: no script plugin was written, so "${target.label}" keeps its own kit in the content plugin; the importer does not run this file.`, 'PLUGIN_FORGE_SCRIPT');
        continue;
      }
      taken.set(target.charId, file);
      jobs.push({ file, register: target.charId, kind: target.kind, label: target.label, override: target.override });
    }
    if (jobs.length) {
      const got = bundleForgeKits({
        files: parse ? new Map([...files].map(([rel, bytes]) => {
          if (!rel.startsWith('kits/') || !rel.endsWith('.js')) return [rel, bytes];
          try { return [rel, Buffer.from(rewriteForgeKit(bytes.toString('utf8'), new Map([...recordIds, ...charIds]), parse))]; }
          catch { return [rel, bytes]; }
        })) : files, parse, kits: jobs.map(({ file, register }) => ({ file, register })),
        header: [
          `sim/index.js — written by \`node tools/plugin.mjs import-forge\` from the Forge pack ${base} ${version}.`,
          'Nothing in this file ran during the import. Each Forge file below keeps a scope of its own; only its import and',
          'export lines were rewritten: @kit/tier1.js → kit, @sim/constants.js → constants, @sim/detmath.js → math, @sim/dir.js → dir, @sim/targeting.js → targeting of sp:sdk@1.',
          'It runs only where the server owner set SP_PLUGIN_SCRIPTS=sandbox (or a trusted mode) and a room selects this plugin.',
        ],
      });
      for (const r of got.refused) skip(r.path, `${r.zh} 没有写进脚本插件；导入时不执行它。`, `${r.en} It was not written into the script plugin; the importer does not run it.`, 'PLUGIN_FORGE_SCRIPT', 'kits');
      if (got.source) {
        const registered = got.registered.map((r) => {
          const job = jobs.find((j) => j.file === r.file);
          for (const p of r.carried) used.add(p);
          return { ...r, kind: job.kind, label: job.label, override: job.override };
        });
        scriptPlan = {
          source: got.source, registered, mapped: got.mapped,
          overrides: [...new Set(registered.map((r) => r.override).filter(Boolean))].sort(),
        };
        assume('kits-script', '包的 kits/ 合成一个脚本插件 kits-<id>：一个自包含的 sim 入口，每个 Forge 文件一个作用域，import 改成 sp:sdk@1；它要求数据插件的同一版本，为新记录的 charId 注册 kit。', 'The pack\'s kits/ became one script plugin kits-<id>: one self-contained sim entry, a scope per Forge file, imports rewritten to sp:sdk@1; it requires the content plugin at the same version and registers each kit for the new record\'s charId.');
        for (const n of got.notes) assume(`kits-alive:${n.path}`, n.zh, n.en);
        assume('kits-sdk', 'sp:sdk@1 的 kit 里同名的 helper 当成 Forge tier1 的同一个；SDK 的记录类 helper 返回冻结的副本，往里写的 kit 运行时才会出错。', 'A helper of the SDK\'s kit with a Forge tier1 name is taken as the same helper; the SDK\'s record helpers return frozen copies, so a kit that writes into one fails when it runs.');
      }
    }
  }
  {
    const scripted = new Map((scriptPlan?.registered || []).map((r) => [r.register, r.file]));
    for (const k of genericKits) {
      const file = scripted.get(k.charId);
      if (!file) { kitLine(k.label, k.name, k.kitPath, k.reason); continue; }
      skip(`${k.label}#kit`, `${k.reason ? k.reason.zh : ''}「${k.name}」在数据插件里用通用 kit；${file} 写进了脚本插件，在选中脚本插件的房间里由它接管。`,
        `${k.reason ? `${k.reason.en} ` : ''}"${k.name}" uses the generic kit in the content plugin; ${file} was written into the script plugin, which takes over in rooms that select it.`);
    }
  }

  /** @type {{ lang: string, strings: Record<string, string>, kind: 'ui' | 'content', doc?: any }[]} */
  const translations = [];
  /** @type {Map<string, string>} */
  const seenLang = new Map();
  if (isObj(pack.i18n)) {
    for (const [lang, rel] of Object.entries(pack.i18n)) {
      if (typeof rel !== 'string') { skip(`i18n.${lang}`, '翻译不是一个文件路径，没有导入。', 'The translation is not a file path, so it was not imported.'); continue; }
      const code = canonicalLang(lang);
      if (!code) { skip(`i18n.${lang}`, '不是语言代码，没有导入。', 'Not a language code, so it was not imported.'); continue; }
      if (seenLang.has(code)) fail('PLUGIN_FORGE_INPUT', `i18n "${seenLang.get(code)}" and "${lang}" are the same language`);
      seenLang.set(code, lang);
      const found = lookup(files, rel);
      if (!found) { skip(`i18n.${lang}`, '翻译文件不在包里，没有导入。', 'The translation file is not in the pack, so it was not imported.'); continue; }
      used.add(found);
      let doc;
      try { doc = readJsonBuf(files.get(found), found); } catch (e) {
        if (e instanceof ForgeImportError) throw e;
        skip(found, '翻译文件读不了，没有导入。', 'The translation file could not be read, so it was not imported.');
        continue;
      }
      if (isObj(doc) && doc.version === 1 && canonicalLang(doc.lang) === code && isObj(doc.files)) {
        const badLeaf = contentLeavesBad(doc.files, table);
        if (badLeaf) { skip(found, `翻译要改的词「${badLeaf}」在本安装里不是现成的字符串，整份没有导入（放进内容翻译会让整套数据被拒）。`, `The translation touches "${badLeaf}", which is not an existing string in this installation, so the file was not imported (a bad content translation refuses the whole set).`); continue; }
        translations.push({ lang: code, strings: {}, kind: 'content', doc });
        importedData.push(`i18n:${code} → content`);
        continue;
      }
      if (code === SOURCE_LANG) { skip(found, '中文是原文，不是语言包，没有导入。', 'Chinese is the source language, not a language pack, so it was not imported.'); continue; }
      if (!isObj(doc) || !Object.values(doc).length || Object.values(doc).some((v) => typeof v !== 'string')) {
        skip(found, '翻译既不是界面词条表，也不是内容翻译（version 1），没有导入。', 'The translation is neither a UI string map nor a content translation (version 1), so it was not imported.');
        continue;
      }
      assume('i18n-ui', '扁平界面词条写成 lang 插件；已有内置语言时覆盖同名词条，缺失词条回退。', 'A flat UI string map becomes a lang plugin; for a built-in language it overrides supplied keys and falls back for missing keys.');
      /** @type {Record<string, string>} */
      const strings = {};
      for (const [k, v] of Object.entries(doc)) if (typeof v === 'string' && k && !k.startsWith('_')) strings[k] = v;
      translations.push({ lang: code, strings, kind: 'ui' });
      importedData.push(`i18n:${code} → lang`);
    }
  }

  /** @type {{ slot: string, module: string, title: string, role?: string, copied?: boolean, bundle?: string, css?: string, marker?: string | null, copies?: { src: string, dest: string, text: string }[], strings?: Record<string, Record<string, string>>, declared?: string[], packId?: string }[]} */
  const panels = [];
  const manualPanels = [];
  const panelList = Array.isArray(pack.client?.panels) ? pack.client.panels : isObj(pack.client?.panels) ? Object.values(pack.client.panels) : pack.client?.panels != null ? [pack.client.panels] : [];
  /** slot → how many panels already took it. A second skeleton stays manual; a second copied panel gets its own ui plugin. */
  const slotUses = new Map();
  if (pack.client != null && !isObj(pack.client)) skip('client', 'client 不是对象，没有导入。', 'client is not an object, so it was not imported.');
  else if (isObj(pack.client)) {
    for (const k of Object.keys(pack.client)) {
      if (k === 'panels' || k === 'theme') continue;
      skip(`client.${k}`, '除了只读面板和主题变量，client 里的其他声明不能导入。', 'Apart from a read-only panel and theme variables, other client declarations cannot be imported.');
    }
    const theme = pack.client.theme;
    if (theme != null && !isObj(theme)) skip('client.theme', '主题不是对象，没有导入。', 'The theme is not an object, so it was not imported.');
    else if (isObj(theme)) {
      for (const k of Object.keys(theme)) if (k !== 'vars') skip(`client.theme.${k}`, '主题里除了变量，其他声明不能导入。', 'Apart from variables, other theme declarations cannot be imported.');
      const rawVars = theme.vars;
      if (rawVars != null && !isObj(rawVars)) skip('client.theme.vars', '主题变量不是对象，没有导入。', 'Theme variables are not an object, so they were not imported.');
      else if (isObj(rawVars)) {
        const read = readThemeDeclaration({ vars: rawVars }, { drop: true });
        themeVars = read.vars && Object.keys(read.vars).length ? read.vars : null;
        Object.keys(rawVars).forEach((name, i) => {
          if (themeVars && Object.prototype.hasOwnProperty.call(themeVars, name)) return;
          const code = i >= THEME_VAR_LIMIT ? 'PLUGIN_THEME_LIMIT' : (readThemeDeclaration({ vars: { [name]: rawVars[name] } }).problems[0]?.code || 'PLUGIN_THEME_VALUE');
          const [zh, en] = themeDrop(code, name);
          skip(`client.theme.vars.${name}`, zh, en, code);
        });
      }
    }
  }
  const uiStrings = () => {
    /** @type {Record<string, Record<string, string>>} */
    const strings = {};
    for (const row of translations) if (row.kind === 'ui' && row.strings) strings[row.lang] = row.strings;
    return strings;
  };
  for (const panel of panelList) {
    if (!isObj(panel)) { skip('client.panels', '面板不是对象，没有导入。', 'A panel is not an object, so it was not imported.', undefined, 'panels'); continue; }
    const forgeSlot = typeof panel.slot === 'string' ? panel.slot : '';
    const module = typeof panel.module === 'string' ? panel.module : typeof panel.entry === 'string' ? panel.entry : '';
    const title = String(panel.name || panel.id || forgeSlot || '?').slice(0, 80);
    const shortTitle = typeof panel.name === 'string' ? panel.name.slice(0, 40) : typeof panel.id === 'string' ? panel.id.slice(0, 40) : title.slice(0, 40);
    const blocked = panel.wraps != null || panel.readonly === false || panel.readOnly === false;
    let found = '';
    /** @type {{ ok?: boolean, surfaces?: string[], listensRoom?: boolean, bundle?: string, css?: string, copies?: { src: string, dest: string, text: string }[], declared?: string[] } | null} */
    let planned = null;
    if (module) {
      const hit = lookup(files, module);
      if (hit) { found = hit; used.add(hit); }
    }
    if (found && !blocked) {
      planned = typeof parse === 'function'
        ? planForgePanel({ files, entry: found, panel, parse, requires: isObj(pack.client) ? pack.client.requires : null })
        : { ok: false, surfaces: ['parse'], listensRoom: false };
    } else if (blocked) {
      const surfaces = [];
      if (panel.wraps != null) surfaces.push('wraps');
      if (panel.readonly === false || panel.readOnly === false) surfaces.push('readonly');
      planned = { ok: false, surfaces, listensRoom: false };
    }
    const compatible = !!(planned && planned.ok);
    const display = forgeDisplaySlot(forgeSlot, { compatible, listensRoom: !!(planned && planned.listensRoom) });
    const surfaces = planned && Array.isArray(planned.surfaces) ? planned.surfaces : ['missing'];
    if (!compatible) {
      const listed = surfaces.length ? ` 用到了这里没有的接口：${surfaces.join('、')}。` : '';
      const listedEn = surfaces.length ? ` Unsupported surfaces: ${surfaces.join(', ')}.` : '';
      const capacity = surfaces.includes('room.capacity');
      skip(`client.panels:${title}#module`, `面板「${title}」的脚本 ${module || '(none)'} 没有复制；需要改写成 postMessage API v1。${listed}${capacity ? ' 本服固定 4 个席位，没有扩容或房间容量设置。' : ''}`, `Panel "${title}" script ${module || '(none)'} was not copied; rewrite it to postMessage API v1.${listedEn}${capacity ? ' This server has four fixed seats and no room-capacity setting.' : ''}`, 'PLUGIN_FORGE_PANEL_SCRIPT', undefined, surfaces.length ? { surfaces } : undefined);
    }
    if (blocked) {
      const where = display.slot || display.suggested || 'room.panel';
      manualPanels.push({ panel: title, mount: forgeSlot, suggestedSlot: where });
      skip(`client.panels:${title}#mount`, `面板「${title}」在 ${forgeSlot} 改写页面组件，需要人工适配为 ${where} 的只读面板。`, `Panel "${title}" at ${forgeSlot} rewrites a component; it needs manual adaptation as a read-only ${where} panel.`, 'PLUGIN_FORGE_MOUNT', 'panels');
      continue;
    }
    // a stub panel's stylesheet is not copied (a copied panel carries its styles in its own bundle)
    if (!compatible) {
      const styles = Array.isArray(panel.styles) ? panel.styles : typeof panel.styles === 'string' ? [panel.styles] : [];
      for (const rel of styles) {
        if (typeof rel !== 'string' || !rel) continue;
        const found = lookup(files, rel);
        if (found) used.add(found);
        skip(`client.panels:${title}#styles`, `面板「${title}」的样式表 ${rel} 没有复制；关掉动画之类的效果需要人工适配。`, `Panel "${title}" stylesheet ${rel} was not copied; effects such as turning animations off need manual adaptation.`, 'PLUGIN_FORGE_PANEL_SCRIPT');
      }
    }
    if (!display.slot) {
      const suggestedSlot = display.suggested || PANEL_REWRITE[forgeSlot] || 'room.panel';
      manualPanels.push({ panel: title, mount: forgeSlot, suggestedSlot });
      skip(`client.panels:${title}#mount`, `面板「${title}」挂载点 ${forgeSlot || '(none)'} 需要人工适配，可改写到 ${suggestedSlot}（位置与原版不同）。`, `Panel "${title}" at Forge mount ${forgeSlot || '(none)'} needs manual adaptation; consider rewriting for ${suggestedSlot} (a different location).`, 'PLUGIN_FORGE_MOUNT', 'panels');
      continue;
    }
    if (!compatible) {
      if ((slotUses.get(display.slot) || 0) > 0) {
        manualPanels.push({ panel: title, mount: forgeSlot, suggestedSlot: display.slot });
        skip(`client.panels:${title}#mount`, `面板「${title}」在 ${forgeSlot} 对应的 ${display.slot} 插槽已有面板，需要人工合并。`, `Panel "${title}" at ${forgeSlot} maps to occupied slot ${display.slot}; it needs manual adaptation into the existing panel.`, 'PLUGIN_FORGE_MOUNT', 'panels');
        continue;
      }
      slotUses.set(display.slot, 1);
      manualPanels.push({ panel: title, mount: forgeSlot, suggestedSlot: display.slot });
      noteDrop('panels');
      panels.push({ slot: display.slot, module, title: shortTitle, role: `ui:${display.slot}`, copied: false });
      rewrittenAssets.push(`${forgeSlot} → ${display.slot}`);
      continue;
    }
    const n = (slotUses.get(display.slot) || 0) + 1;
    slotUses.set(display.slot, n);
    const role = n === 1 ? `ui:${display.slot}` : `ui:${display.slot}-${n}`;
    assume('forge-panel', '只读面板在浏览器的沙箱 iframe 里运行；导入时没有执行它的脚本。', 'A read-only panel runs in the browser sandbox iframe; its script was not executed at import.');
    if (display.assumed) assume('panel-slot', `面板「${title}」的挂载点 ${forgeSlot} 按建议显示在 ${display.slot}（不是原位置）。`, `Panel "${title}" at ${forgeSlot} is shown in ${display.slot} (not Forge's position).`);
    for (const copy of planned.copies || []) used.add(copy.src);
    panels.push({
      slot: display.slot, module, title: shortTitle, role, copied: true,
      bundle: planned.bundle || '', css: planned.css || '', marker: display.marker, copies: planned.copies || [],
      strings: uiStrings(), declared: planned.declared || [], packId: typeof pack.id === 'string' ? pack.id : base,
    });
    rewrittenAssets.push(`${forgeSlot} → ${display.slot}`);
  }

  for (const [rel] of files) {
    if (used.has(rel)) continue;
    const ext = extOf(rel);
    if (SCRIPT_EXT.has(ext) || ext === '.spresources') {
      skip(rel, '这是脚本或引擎资源，导入时不执行、也不复制。', 'This is a script or an engine resource. The importer does not run it and does not copy it.', 'PLUGIN_FORGE_SCRIPT');
      continue;
    }
    // an unreferenced audio file whose name is exactly a bgm track
    const baseName = rel.split('/').pop()?.replace(/\.[^.]+$/, '') || '';
    if (AUDIO_EXT.has(ext) && ['lobby', 'prep', 'combat', 'unite', 'boss'].includes(baseName) && !getPath(assets, ['audio', 'bgm', baseName])) {
      const dest = destOf(rel);
      if (dest) {
        assume('loose-bgm', `没有被 pack.json 引用、但文件名是音轨的 ${rel} 写入了 audio.bgm.${baseName}。`, `${rel} is not referenced by pack.json, but its name is a music track, so it was written to audio.bgm.${baseName}.`);
        setAt(assets, ['audio', 'bgm', baseName], { loop: dest });
        remember(rel, dest);
        used.add(rel);
        importedAssets.push(`audio.bgm.${baseName} ← ${rel}`);
        continue;
      }
    }
    skip(rel, '文件在包里，但 pack.json 没有引用它，没有导入。', 'The file is in the pack, but pack.json does not reference it, so it was not imported.');
  }

  assertNoPrefixClash(media.keys());
  const destCase = new Map();
  for (const dest of media.keys()) noteCase(destCase, dest);
  const rewriteKey = (table, map, label, renamed = new Map()) => {
    if (!table || typeof table !== 'object' || Array.isArray(table)) return;
    for (const [from, to] of map) {
      if (typeof from !== 'string' || typeof to !== 'string' || !from || from === to || DANGER_KEYS.has(from) || DANGER_KEYS.has(to)) continue;
      if (!has(table, from)) continue;
      if (!isAssetKey(to)) continue;
      if (has(table, to)) {
        skip(`${label}:${from}`, `改名后的键 ${to} 已经有素材，${from} 没有并进去。`, `The renamed key ${to} already has assets, so ${from} was not merged into it.`);
        continue;
      }
      table[to] = table[from];
      delete table[from];
      renamed.set(from, to);
      rewrittenAssets.push(`${label}.${from} → ${to}`);
    }
  };
  const artRenames = new Map(), voiceRenames = new Map(), iconRenames = new Map();
  rewriteKey(assets.chars, charIds, 'art.chars', artRenames);
  rewriteKey(assets.enemies, enemyIds, 'art.enemies');
  rewriteKey(assets.skills, skillIds, 'art.skills', iconRenames);
  rewriteKey(assets.bonds, gameplay.ids, 'art.bonds');
  rewriteKey(assets.bands, gameplay.ids, 'art.bands');
  if (assets.audio && typeof assets.audio === 'object') {
    for (const tree of ['voiceJp', 'voiceEn', 'voiceKr']) rewriteKey(assets.audio[tree], charIds, `audio.${tree}`, voiceRenames);
    rewriteKey(assets.audio.voice, charIds, 'audio.voice', voiceRenames);
    if (assets.audio.sfx && typeof assets.audio.sfx === 'object') rewriteKey(assets.audio.sfx.units, charIds, 'audio.sfx.units');
  }

  // Asset tables and compact sidecars must use the same rewritten keys.
  const artKey = (id, ids) => ids.get(id) ?? (/_([12])$/.test(id) && ids.has(id.slice(0, -2)) ? ids.get(id.slice(0, -2)) + id.slice(-2) : id);
  for (const op of operators) {
    if (op.art?.ref) {
      const before = op.art.ref;
      op.art.ref = artKey(before, artRenames);
      if (op.art.ref !== before || voiceRenames.has(before)) {
        op.art.assets ??= {};
        op.art.assets.voice ??= before;
      }
    }
    for (const [key, id] of Object.entries(op.art?.assets ?? {})) op.art.assets[key] = artKey(id, key.startsWith('skillIcon') ? iconRenames : key.startsWith('voice') ? voiceRenames : artRenames);
  }

  let assetNeed = [];
  if (Object.keys(assets).length) {
    const trial = readAssetOverlay(assets, { vanilla: manifestArt, permissions: ['assets.override', 'assets.add'], has: () => true });
    if (trial.problems.length) {
      skip('art', `外观叠加没有通过校验（${trial.problems[0]}），整份外观没有导入。`, `The asset overlay did not pass (${trial.problems[0]}), so none of the art was imported.`);
      for (const k of Object.keys(assets)) delete assets[k];
      media.clear();
    } else if (trial.warnings.length) {
      skip('art', `外观叠加有警告（${trial.warnings[0]}），严格检查通不过，整份外观没有导入。`, `The asset overlay has a warning (${trial.warnings[0]}). Strict check would fail, so none of the art was imported.`);
      for (const k of Object.keys(assets)) delete assets[k];
      media.clear();
    } else if (manifestArt) {
      const need = new Set();
      for (const op of trial.ops) {
        if (op.implied) continue;
        const depth = ASSET_CONTAINERS.find((c) => c.path.every((k, i) => op.at[i] === k))?.path.length ?? 1;
        need.add(getPath(manifestArt, op.at.slice(0, depth + 1)) !== undefined ? 'assets.override' : 'assets.add');
      }
      assetNeed = [...need];
    } else assetNeed = ['assets.add'];
  }

  // Forge WORKSHOP §1.19: union with the renderer's built-in silent phases; no script is read or run.
  if (isObj(pack.fx) && Array.isArray(pack.fx.silentPhases)) {
    const names = pack.fx.silentPhases;
    if (names.length <= 128 && names.every(v => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v))) {
      if (names.length) { assets.fx = { silentPhases: [...new Set(names)] }; importedAssets.push('fx.silentPhases'); }
    } else skip('fx.silentPhases', '静态相位名称无效或超过 128 项，没有导入。', 'Invalid phase names or more than 128 entries; not imported.');
    for (const key of Object.keys(pack.fx)) if (key !== 'silentPhases') skip(`fx.${key}`, '这个特效字段没有 Forge 对应项，没有导入。', 'This effect field has no Forge equivalent; not imported.');
  }

  /** @type {string[]} */
  const roles = [];
  const contentI18n = translations.filter((t) => t.kind === 'content');
  const hasContent = gameplayRecords.length || patches.length || operators.length || enemyRecords.length || contentI18n.length || !!importedRules;
  if (hasContent) roles.push('content');
  if (Object.keys(assets).length && (media.size || assets.fx)) roles.push('cosmetic');
  if (!roles.includes('cosmetic') && themeVars && Object.keys(themeVars).length) roles.push('cosmetic');
  if (scriptPlan) roles.push('script');
  for (const panel of panels) roles.push(panel.role || `ui:${panel.slot}`);
  for (const t of translations.filter((x) => x.kind === 'ui')) roles.push(`lang:${t.lang}`);
  if (!roles.length && notices.length) roles.push('cosmetic');

  // Art keys differ from record ids: chess → charId, items → trap/icon, bonds → bond id (WORKSHOP §1.4).
  // [ASSUMED] Shared art still has a target if another retained record uses it. Whole-record drops only;
  // a kit or panel being skipped cannot make an imported operator's art bare. Audio alone is never bare.
  const droppedArt = new Set(), liveArt = new Set();
  const visualKeys = (name, id, rec) => {
    const bucket = name === 'chess' || name === 'units' ? 'chars' : name;
    const keys = bucket === 'chars' ? [rec?.charId || (name === 'units' ? id : null)]
      : name === 'items' ? [id, rec?.trapId, rec?.iconId, rec?.icon] : [id];
    return keys.filter(k => typeof k === 'string' && k).map(k => `${bucket}:${k}`);
  };
  for (const name of ['chess', 'units', 'items', 'bonds', 'bands', 'tokens']) {
    // A dropped duplicate may still point at art used by the installation's existing records.
    for (const [id, rec] of Object.entries(table(name) || {})) for (const key of visualKeys(name, id, rec)) liveArt.add(key);
    let records = {};
    try { records = asMap(loadTableFile(files, used, name), name === 'chess' ? 'chessId' : name === 'units' ? 'charId' : 'id'); } catch { /* already reported */ }
    const parents = new Map();
    if (name === 'chess') for (const [id, rec] of Object.entries(records)) {
      for (const target of [rec?.upgradeChessId, rec?.goldenId]) if (target && target !== id) parents.set(target, id);
    }
    for (const [id, rec] of Object.entries(records)) {
      const base = typeof rec?.baseId === 'string' ? rec.baseId : parents.get(id) ?? id.replace(/_b$/, '_a');
      const target = droppedIds.has(`${name}:${id}`) || droppedIds.has(`${name}:${base}`) ? droppedArt : liveArt;
      for (const key of visualKeys(name, id, rec)) target.add(key);
    }
  }
  const bareKey = key => droppedArt.has(key) && !liveArt.has(key);
  const asked = [];
  if (isObj(pack.art)) for (const t of ['chars', 'enemies', 'tokens', 'bonds', 'bands', 'items']) if (isObj(pack.art[t])) asked.push(...Object.keys(pack.art[t]).map(k => `${t}:${k}`));
  if (isObj(pack.bondIcons)) asked.push(...Object.keys(pack.bondIcons).map(k => `bonds:${k}`));
  if (isObj(pack.itemIcons)) asked.push(...Object.keys(pack.itemIcons).map(k => `items:${k}`));
  const kept = [];
  for (const bucket of ['chars', 'enemies', 'tokens', 'bonds', 'bands', 'items', 'skills', 'modules']) if (isObj(assets[bucket])) kept.push(...Object.keys(assets[bucket]).map(k => `${bucket}:${k}`));
  const cosmeticBare = asked.length > 0 && asked.every(bareKey) && kept.every(bareKey);

  const meta = { base, packName, version, description, credits, authors, license, requires, conflicts, assets, media, assetNeed, patches, operators, enemyRecords, gameplayRecords, contentI18n, panels, manualPanels, manualReasons, translations: translations.filter((t) => t.kind === 'ui'), importedAssets, rewrittenAssets, importedData, rewrittenData, skipped, assumed, script: scriptPlan, packId: typeof pack.id === 'string' ? pack.id : base, dropped, cosmeticBare, themeVars, notices, rules: importedRules, officialNeeded: [...officialNeeded], officialTables: [] };
  return { meta, roles };
}

function contentLeavesBad(files, table) {
  const walk = (base, overlay, path) => {
    if (typeof overlay === 'string') return typeof getBy(base, path) === 'string' ? null : path.join('.') || '(root)';
    if (!isObj(overlay)) return path.join('.') || '(root)';
    for (const [k, v] of Object.entries(overlay)) {
      const bad = walk(base, v, [...path, k]);
      if (bad) return bad;
    }
    return null;
  };
  const getBy = (node, p) => {
    let n = node;
    for (const k of p) { if (!isObj(n) || !has(n, k)) return undefined; n = n[k]; }
    return n;
  };
  for (const [file, records] of Object.entries(files)) {
    if (!isObj(records)) return file;
    const data = table(file);
    for (const [id, overlay] of Object.entries(records)) {
      if (!data || !has(data, id)) return `${file}.${id}`;
      const bad = walk(data[id], overlay, []);
      if (bad) return `${file}.${id}.${bad}`;
    }
  }
  return null;
}

function manifestCommon(id, meta, extra) {
  /** @type {Record<string, unknown>} */
  const out = {
    $schema: '../../schemas/plugin.schema.json',
    manifest: 2, id,
    name: { zh: meta.packName, en: meta.packName },
    version: meta.version, app: APP_RANGE, api: 1,
    sourceLang: 'zh',
    ...extra,
  };
  if (meta.description) out.description = { zh: meta.description, en: meta.description };
  if (meta.credits) out.credits = meta.credits;
  if (meta.authors.length) out.authors = meta.authors;
  if (meta.license) out.license = meta.license;
  if (Object.keys(meta.requires).length && !Object.keys(meta.requires).includes(id)) out.requires = Object.fromEntries(Object.entries(meta.requires).filter(([k]) => k !== id));
  if (Object.keys(meta.conflicts).length) out.conflicts = Object.fromEntries(Object.entries(meta.conflicts).filter(([k]) => k !== id));
  return out;
}

function uiHtml(slot, title, modulePath) {
  const safeTitle = title.replace(/[<>&]/g, '');
  const note = modulePath ? `Forge module was not copied: ${modulePath.replace(/[<>&]/g, '')}. ` : '';
  return `<!DOCTYPE html>
<html lang="zh">
<head>
<meta charset="utf-8">
<title>${safeTitle}</title>
<style>html{color-scheme:dark}html,body{margin:0;background:transparent;color:#e8e0d0;font:12px/1.4 sans-serif}body{padding:6px}</style>
</head>
<body>
<p>${safeTitle}</p>
<p>这是从 Forge 面板生成的骨架。${note}请手改成 postMessage API v1（welcome → ready，再发 slot / resize）。不要把原来的脚本贴回来。</p>
<script>
window.addEventListener('message', function (ev) {
  var m = ev.data;
  if (!m || m.v !== 1 || m.t !== 'welcome') return;
  parent.postMessage({ v: 1, t: 'ready' }, '*');
});
parent.postMessage({ v: 1, t: 'ready' }, '*');
parent.postMessage({ v: 1, t: 'slot', slot: '${slot}' }, '*');
parent.postMessage({ v: 1, t: 'resize', height: 72 }, '*');
</script>
</body>
</html>
`;
}

function readme(id, cls, lines, tail) {
  const foot = tail === 'sandbox'
    ? '详细对照见同一次导入的 IMPORT-REPORT.md。这份界面在玩家浏览器的沙箱 iframe 里运行，导入时没有执行包里的脚本。'
    : '详细对照见同一次导入的 IMPORT-REPORT.md。界面骨架要手改成 postMessage API v1。';
  return `# ${id}\n\n从 Forge 工坊包导入的 ${cls} 插件。导入器不执行包里的脚本，也不检查官方素材。\n\n${lines.join('\n')}\n\n${foot}\n`;
}

/**
 * @param {ReturnType<typeof planForgeImport>['meta']} meta
 * @param {Record<string, string>} ids
 * @param {string} primaryRole
 */
function buildProducts(meta, ids, primaryRole) {
  /** @type {{ id: string, class: string, role: string, files: Map<string, Buffer | string>, imported: string[], rewritten: string[] }[]} */
  const products = [];
  if (ids.content) {
    const perms = [];
    /** @type {Record<string, unknown>} */
    const man = manifestCommon(ids.content, meta, { class: 'content', scope: ['room'] });
    // [ASSUMED] A same-import cosmetic is an optional companion, never a required/auto-enabled personal choice.
    if (ids.cosmetic) man.optional = { [ids.cosmetic]: meta.version };
    const files = new Map();
    if (meta.patches.length) {
      perms.push('data.patch');
      man.data = ['data/patch.json'];
      files.set('data/patch.json', `${JSON.stringify({ patch: 1, ops: meta.patches }, null, 2)}\n`);
    }
    if (meta.gameplayRecords.length) {
      perms.push('data.add');
      man.data = ['data/records.json', ...(man.data ?? [])];
      files.set('data/records.json', `${JSON.stringify({ records: 1, entries: meta.gameplayRecords }, null, 2)}\n`);
    }
    if (meta.operators.length) {
      perms.push('data.add');
      man.operators = ['operators/imported.json'];
      files.set('operators/imported.json', `${JSON.stringify(meta.operators.length === 1 ? meta.operators[0] : meta.operators, null, 2)}\n`);
    }
    if (meta.enemyRecords.length) {
      if (!perms.includes('data.add')) perms.push('data.add');
      man.enemies = ['enemies/imported.json'];
      files.set('enemies/imported.json', `${JSON.stringify(meta.enemyRecords.length === 1 ? meta.enemyRecords[0] : meta.enemyRecords, null, 2)}\n`);
    }
    if (meta.contentI18n.length) {
      man.i18n = {};
      for (const t of meta.contentI18n) {
        const rel = `i18n/${t.lang}.json`;
        man.i18n[t.lang] = rel;
        files.set(rel, `${JSON.stringify(t.doc, null, 2)}\n`);
      }
    }
    if (meta.rules) man.rules = meta.rules;
    // A rules-only plugin declares no permission and no dummy data.patch (an unused permission fails strict check).
    if (!perms.length && !meta.contentI18n.length && !meta.rules) perms.push('data.patch');
    if (perms.length) man.permissions = [...new Set(perms)];
    files.set('README.md', readme(ids.content, 'content', ['- 数值补丁、干员和敌人见 data/、operators/、enemies/。', '- 技能脚本没有执行，映射不上的用通用 kit。', ...(meta.rules ? ['- 规则开关写在 plugin.json 的 rules 里。公告没有导入。'] : [])]));
    products.push({ id: ids.content, class: 'content', role: 'content', files, imported: meta.importedData, rewritten: meta.rewrittenData, manifest: man });
  }
  if (ids.cosmetic) {
    // an assets.json part: media, or a media-free assets.fx (Forge silentPhases) — the same test as the cosmetic role
    const art = (meta.media.size || meta.assets.fx) && Object.keys(meta.assets).length;
    const theme = meta.themeVars && Object.keys(meta.themeVars).length;
    /** @type {Record<string, unknown>} */
    const manExtra = { class: 'cosmetic', scope: art ? ['room', 'personal'] : ['personal'] };
    if (art) {
      manExtra.permissions = meta.assetNeed.length ? [...meta.assetNeed] : ['assets.add'];
      manExtra.assets = 'assets.json';
    }
    if (theme) {
      manExtra.theme = { vars: meta.themeVars };
      manExtra.permissions = [...(manExtra.permissions || []), 'theme'];
    }
    const man = manifestCommon(ids.cosmetic, meta, manExtra);
    const files = new Map();
    if (art) {
      files.set('assets.json', `${JSON.stringify(meta.assets, null, 2)}\n`);
      for (const [rel, buf] of meta.media) files.set(rel, buf);
    }
    const lines = [];
    if (art) lines.push('- 素材在 assets.json 指向的文件里。', '- Spine 的剪辑由 pack 写入 plugin.lock.json，不要手写 anims。');
    if (theme) lines.push('- 主题变量在 plugin.json 的 theme.vars。只改这名玩家自己的界面，不注入样式表。');
    if (!art && !theme) lines.push('- 这份外观只有公告，不改画面。');
    files.set('README.md', readme(ids.cosmetic, 'cosmetic', lines));
    const imported = art
      ? (meta.cosmeticBare
        ? ['没有可应用的目标：要套的干员、棋子或道具都没有导入。 (This cosmetic has nothing to apply to.)']
        : [...meta.importedAssets])
      : [];
    if (theme) imported.push(`client.theme.vars → theme.vars（${Object.keys(meta.themeVars).join(', ')}）`);
    products.push({ id: ids.cosmetic, class: 'cosmetic', role: 'cosmetic', files, imported, rewritten: art ? meta.rewrittenAssets : [], manifest: man });
  }
  if (ids.script && meta.script) {
    const man = manifestCommon(ids.script, meta, { class: 'script', scope: ['room'], permissions: ['sim.code'], entry: { sim: 'sim/index.js' } });
    // [ASSUMED] The kits register record ids of that exact content plugin, so the requirement is its version.
    if (ids.content && meta.script.registered.some((r) => r.kind === 'record')) man.requires = { ...(man.requires || {}), [ids.content]: meta.version };
    if (meta.script.overrides.length) man.overrides = [...meta.script.overrides];
    const files = new Map();
    files.set('sim/index.js', meta.script.source);
    files.set('README.md', readme(ids.script, 'script', [
      '- sim/index.js 是包里 kits/ 的行为脚本合成的一个入口：每个 Forge 文件一个作用域，import 改成 sp:sdk@1。导入时没有执行它。',
      '- 它只在服主设置 SP_PLUGIN_SCRIPTS=sandbox（或 trusted / trusted-force，并在 plugins/config.json 写锁文件哈希、每位玩家同意）并且房间选中它时运行。',
      '- 改了任何文件都要重新 pack：沙箱只运行锁文件和文件一致的脚本插件。',
    ]));
    const imported = meta.script.registered.map((r) => `${r.file} → sim/index.js · sp.kits.register("${r.register}")（${r.label}）${r.carried.length ? ` + ${r.carried.join(', ')}` : ''}`);
    products.push({ id: ids.script, class: 'script', role: 'script', files, imported, rewritten: [...meta.script.mapped], manifest: man });
  }
  for (const panel of meta.panels) {
    const role = panel.role || `ui:${panel.slot}`;
    const id = ids[role];
    if (!id) continue;
    const man = manifestCommon(id, meta, {
      class: 'ui', scope: ['personal'], permissions: ['ui.frame'], entry: { client: 'ui/index.html' }, slots: [panel.slot],
    });
    if (panel.title) man.name = { zh: panel.title, en: panel.title };
    const files = new Map();
    if (panel.copied) {
      files.set('ui/index.html', forgePanelPage({
        slot: panel.slot, title: panel.title, bundle: panel.bundle || '', css: panel.css || '',
        strings: panel.strings || {}, marker: panel.marker || null, declared: panel.declared || [],
        packId: panel.packId || meta.packId, panelId: id, order: 0,
      }));
      files.set('ui/forge-shim.js', FORGE_SHIM_TEXT);
      for (const copy of panel.copies || []) files.set(copy.dest, copy.text);
      files.set('README.md', readme(id, 'ui', [
        `- 插槽 ${panel.slot}。`,
        '- 面板在玩家浏览器的沙箱 iframe 里运行，导入时没有执行它的脚本。',
        '- 原文件在 ui/mod/。入口页内联了兼容层，不从 script src 再加载一次。',
      ], 'sandbox'));
      products.push({
        id, class: 'ui', role, files,
        imported: [`client.panels → ${panel.slot}（沙箱，导入时未执行）`],
        rewritten: panel.module ? [`${panel.module} → ui/index.html（兼容层）`] : [],
        manifest: man,
      });
      continue;
    }
    files.set('ui/index.html', uiHtml(panel.slot, panel.title, panel.module));
    files.set('README.md', readme(id, 'ui', [`- 插槽 ${panel.slot}。`, `- 原面板脚本没有复制${panel.module ? `（${panel.module}）` : ''}。`, '- 请把页面改成 postMessage API v1，不要贴回 Forge 的模块。']));
    products.push({ id, class: 'ui', role, files, imported: [`client.panels → ${panel.slot}`], rewritten: panel.module ? [`${panel.module} → ui/index.html（骨架，未复制脚本）`] : [], manifest: man });
  }
  for (const t of meta.translations) {
    const role = `lang:${t.lang}`;
    const id = ids[role];
    if (!id) continue;
    const man = {
      manifest: 2, id, class: 'lang', lang: t.lang, name: languageName(t.lang), version: meta.version, files: { ui: 'ui.json' },
    };
    const files = new Map();
    files.set('ui.json', `${JSON.stringify(t.strings, null, 2)}\n`);
    files.set('README.md', readme(id, 'lang', [`- 语言 ${t.lang}。`, '- 这是界面词条，不是内容翻译。']));
    products.push({ id, class: 'lang', role, files, imported: [`i18n/${t.lang} → files.ui`], rewritten: [], manifest: man });
  }
  const seen = new Set();
  for (const p of products) {
    if (seen.has(p.id)) fail('PLUGIN_FORGE_ID', `two products share the id ${p.id}`);
    seen.add(p.id);
  }
  if (meta.notices?.length && products.length) {
    const host = products.find((p) => p.role === primaryRole) || products[0];
    host.manifest.notices = meta.notices;
    for (const n of meta.notices) host.imported.push(`notices → ${n.id}`);
  }
  return { products, primaryRole };
}

/** The script plugin's run condition, in the report header (empty without one). */
function scriptNote(products) {
  const ids = products.filter((p) => p.class === 'script').map((p) => `\`${p.id}\``);
  if (!ids.length) return '';
  return `\n脚本插件 ${ids.join('、')} 只在服主设置 SP_PLUGIN_SCRIPTS=sandbox（或 trusted / trusted-force，见 PLUGINS.md §13）并且房间选中它时运行；导入时没有执行它。沙箱模式下它的锁文件有效，写入后房间就能选它。 (The script plugin ${ids.join(', ')} runs only where the server owner set SP_PLUGIN_SCRIPTS=sandbox (or trusted / trusted-force, PLUGINS.md §13) and a room selects it; it was not run during the import. In sandbox mode its lock is valid, so rooms can select it once it is written.)\n`;
}

/** Counts of whole gameplay records that were not written. Empty when nothing was dropped. */
function droppedBlock(report) {
  const d = report.dropped;
  if (!report.partial || !d) return '';
  const rows = [
    ['operators', '干员 / 棋子', 'operators / chess'],
    ['bonds', '盟约', 'bonds'],
    ['bands', '乐队', 'bands'],
    ['items', '道具', 'items'],
    ['tokens', '召唤物', 'tokens'],
    ['traits', '特性', 'traits'],
    ['kits', '技能脚本', 'kits'],
    ['panels', '面板', 'panels'],
  ].filter(([k]) => d[k] > 0).map(([k, zh, en]) => `- ${d[k]} ${zh} (${en})`);
  const bare = report.cosmeticBare
    ? '\n外观要套的目标都没有导入，这份外观没有可应用的对象。 (This cosmetic has nothing to apply to.)\n'
    : '';
  return `
## 没有导入的玩法

这些玩法记录整条没有写进插件。检查通过只说明没有硬错误，不说明玩法都在。 (These gameplay records were not written into a plugin. A passing check means there is no hard error; it does not mean the gameplay is all here.)

${rows.join('\n')}
${bare}`;
}

function reportMarkdown(report) {
  const line = (s) => s || '（无）';
  const bullets = (rows, fmt) => (rows.length ? rows.map(fmt).join('\n') : '- （无）');
  return `# 导入报告 IMPORT-REPORT

来源：${report.pack.id} ${report.pack.name} ${report.pack.version}
写入：${report.wrote ? '是' : '否'}${report.dryRun ? '（dry-run，没有写文件）' : ''}
${report.partial ? '\n状态：部分导入 / Partial import\n' : ''}${report.needsManualAdaptation ? `\n需要人工适配 / Needs manual adaptation\n\n${bullets(report.manualReasons || [], (s) => `- \`${s.path}\`：${s.zh} (${s.en})`)}\n` : ''}

导入器只读文件，不执行包里的任何脚本，也不拦截官方素材（和打包工具一样，作者自己对素材负责）。
${scriptNote(report.products)}
${report.officialTables?.length ? report.officialTables.join('\n\n') + '\n' : ''}
${droppedBlock(report)}
## 导入了什么

${bullets(report.products, (p) => `### ${p.class} \`${p.id}\`\n\n${p.imported.length ? p.imported.map((x) => `- ${x}`).join('\n') : '- （这一类没有条目）'}`)}

## 改成了什么

${bullets(report.products.flatMap((p) => p.rewritten.map((x) => `- \`${p.id}\` ${x}`)), (x) => x)}

## 没有导入

${bullets(report.skipped, (s) => `- \`${s.path}\`：${s.zh} (${s.en})`)}

## 需要作者确认的 [ASSUMED]

${bullets(report.assumed, (a) => `- ${a.zh} (${a.en})`)}

## 检查

${line(report.check)}
`;
}

function publicReport({ meta, products, primaryId, wrote, dryRun, check, issues }) {
  const report = {
    assumed: [...meta.assumed].sort((a, b) => (a.what < b.what ? -1 : a.what > b.what ? 1 : 0)),
    check, dryRun, issues, ok: issues.length === 0, pack: { id: meta.packId, name: meta.packName, version: meta.version },
    primary: primaryId,
    needsManualAdaptation: !!meta.manualPanels?.length || !!meta.manualReasons?.length,
    manualPanels: meta.manualPanels || [],
    products: products.map((p) => ({
      class: p.class, dir: `plugins/${p.id}`, id: p.id, imported: [...p.imported], permissions: p.manifest.permissions || [], rewritten: [...p.rewritten],
      ...(p.manifest.rules ? { rules: p.manifest.rules } : {}),
    })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    skipped: [...meta.skipped].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    wrote,
  };
  if (meta.manualReasons?.length) {
    report.partial = true;
    report.manualReasons = [...meta.manualReasons].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  }
  // A copied panel is never counted as dropped. A skeleton counts once, just like an entirely manual panel.
  if (meta.dropped && Object.values(meta.dropped).some((n) => n > 0)) {
    report.partial = true;
    report.dropped = { ...meta.dropped };
  }
  if (meta.cosmeticBare) report.cosmeticBare = true;
  if (meta.officialTables?.length) report.officialTables = meta.officialTables;
  report.markdown = reportMarkdown(report);
  return report;
}

function removeSpineValue(node, skel) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const item of node) removeSpineValue(item, skel); return; }
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (isObj(v) && v.skel === skel) delete node[k];
    else removeSpineValue(v, skel);
  }
}

function pruneEmptyObjects(node) {
  if (!isObj(node)) return;
  for (const k of Object.keys(node)) {
    pruneEmptyObjects(node[k]);
    if (isObj(node[k]) && !Object.keys(node[k]).length) delete node[k];
  }
}

/**
 * Parse each Spine model the way `plugin.mjs pack` does. A skeleton that yields no clip entry is removed from the
 * overlay and named; the other models stay. The lock is written afterwards by packPlugin.
 * @param {string} dir the staged plugin folder
 * @returns {{ path: string, zh: string, en: string }[]}
 */
function dropUnreadableModels(dir) {
  const assetsPath = path.join(dir, 'assets.json');
  if (!fs.existsSync(assetsPath)) return [];
  let assets;
  try { assets = JSON.parse(fs.readFileSync(assetsPath, 'utf8')); } catch { return []; }
  const has = (rel) => { try { return fs.statSync(path.join(dir, ...String(rel).split('/'))).isFile(); } catch { return false; } };
  const ov = readAssetOverlay(assets, { has, permissions: ['assets.add', 'assets.override'] });
  /** @type {Map<string, { spine: { skel: string, atlas: string, textures: string[] }, containers: Set<string> }>} */
  const models = new Map();
  for (const op of ov.ops || []) {
    if (!op.spine) continue;
    if (!models.has(op.spine.skel)) models.set(op.spine.skel, { spine: op.spine, containers: new Set() });
    models.get(op.spine.skel).containers.add(op.at[0]);
  }
  /** @type {{ path: string, zh: string, en: string }[]} */
  const dropped = [];
  for (const { spine, containers } of models.values()) {
    const clip = skeletonClipData(dir, spine, containers);
    if (clip.entry) continue;
    const why = clip.problems[0] || `${spine.skel}: unreadable`;
    removeSpineValue(assets, spine.skel);
    dropped.push({
      path: spine.skel,
      zh: `读不了骨架 ${spine.skel}（${why}），只丢掉这个模型，其余照常导入。`,
      en: `Could not read skeleton ${spine.skel} (${why}); only this model was dropped.`,
    });
  }
  if (dropped.length) {
    pruneEmptyObjects(assets);
    fs.writeFileSync(assetsPath, `${JSON.stringify(assets, null, 2)}\n`);
  }
  return dropped;
}

function writeTree(dir, files, manifest) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, PLUGIN_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const [rel, body] of files) {
    if (rel.split('/').some((s) => !s || s === '.' || s === '..')) fail('PLUGIN_FORGE_ZIP', rel);
    const abs = path.join(dir, ...rel.split('/'));
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, body);
  }
}

/**
 * Import a Forge pack.
 * @param {string | { zip?: Buffer, files?: Map<string, Buffer> }} source a directory, a .zip path, or bytes already read
 * @param {{ out?: string, id?: string, dryRun?: boolean, pluginsDir?: string, dataDir?: string, root?: string, vanilla?: { manifest?: any } | null, scripts?: boolean, officialTables?: import('../../tools/assets/official-tables.mjs').TableOptions }} [opts]
 *   out: the primary plugin folder. Other products are siblings. dryRun writes nothing there.
 *   scripts: false writes no script plugin for the pack's kits/ (--no-scripts, the studio's box).
 */
export async function importForge(source, opts = {}) {
  const root = opts.root || process.cwd();
  const dataDir = opts.dataDir || path.join(root, 'data');
  const pluginsDir = opts.pluginsDir || path.join(root, 'plugins');
  const dryRun = !!opts.dryRun;
  /** @type {{ code: string, detail: string }[]} */
  const issues = [];
  const empty = (extra) => {
    const report = stableJson({ assumed: [], check: extra.check || '', dryRun, issues, markdown: '', ok: false, pack: { id: '', name: '', version: '' }, primary: null, products: [], skipped: [], wrote: false, ...extra.report });
    report.markdown = extra.markdown || reportMarkdown({ ...report, products: [], skipped: [], assumed: [] });
    return { ok: false, wrote: false, dryRun, issues, report, markdown: report.markdown };
  };
  try {
    let files;
    if (isObj(source) && source.zip) files = await readUntrustedZip(source.zip);
    else if (isObj(source) && source.files) { assertSafeNames(source.files); files = stripWrapper(source.files); }
    else if (typeof source === 'string') {
      const abs = path.resolve(source);
      let st;
      try { st = fs.lstatSync(abs); } catch { fail('PLUGIN_FORGE_INPUT', 'path does not exist'); }
      if (st.isSymbolicLink()) fail('PLUGIN_FORGE_ZIP', 'the pack path is a symbolic link');
      if (st.isDirectory()) files = readUntrustedDir(abs);
      else if (st.isFile()) {
        if (st.size > ZIP_RAW_MAX) fail('PLUGIN_FORGE_ZIP', `larger than ${ZIP_RAW_MAX} bytes`);
        files = await readUntrustedZip(fs.readFileSync(abs));
      }
      else fail('PLUGIN_FORGE_INPUT', 'not a directory or a zip');
    } else fail('PLUGIN_FORGE_INPUT', 'no pack');
    const vanilla = opts.vanilla || null;
    const primaryName = opts.out ? path.basename(path.resolve(opts.out)) : null;
    if (primaryName && !isPluginId(primaryName)) fail('PLUGIN_FORGE_ID', `"${primaryName}" is not a plugin id`);
    const scripts = opts.scripts !== false;
    // acorn parses kits/ and panel modules. It never evaluates them. Panel scans still need it when --no-scripts.
    let parse = null;
    if ([...files.keys()].some((rel) => SCRIPT_EXT.has(extOf(rel)))) {
      try { ({ parse } = await import('acorn')); } catch { parse = null; }
    }
    const planOpts = { id: opts.id, contentId: primaryName || undefined, dataDir, vanilla, scripts, parse };
    let planned = planForgeImport(files, planOpts);
    // Maintainer decision 2026-10-17 (§34.33): only explicit imports may download. The synchronous
    // planner/loader remains local-only; use its actual derivation requests, not a scan of arbitrary pack strings.
    if (planned.meta.officialNeeded.length) {
      const prepared = await ensureOfficialTables(path.resolve(dataDir, '..'),
        `Forge import needs official operators outside the roster (${planned.meta.officialNeeded.join(', ')})`, opts.officialTables, planned.meta.officialNeeded);
      planned = planForgeImport(files, planOpts);
      planned.meta.officialTables = prepared.lines;
      if (prepared.failures.length) for (const row of planned.meta.skipped) {
        if (row.en.includes('tables unavailable')) row.en += ` Download unavailable: ${prepared.failures.join('; ')}`;
      }
    }
    if (!planned.roles.length) {
      const report = publicReport({ meta: planned.meta, products: [], primaryId: null, wrote: false, dryRun, check: planned.meta.manualPanels.length || planned.meta.manualReasons.length ? '需要人工适配 · needs manual adaptation（见原因、面板及建议插槽）。' : '没有可导入的内容。', issues: [] });
      return { ok: true, wrote: false, dryRun, issues: [], report: stableJson(report), markdown: report.markdown };
    }
    const alloc = allocateIds(planned.meta.base, planned.roles, primaryName);
    if (alloc.error || !alloc.ids) fail('PLUGIN_FORGE_ID', alloc.error || 'no id');
    const built = buildProducts(planned.meta, alloc.ids, alloc.primary);
    const parent = opts.out ? path.dirname(path.resolve(opts.out)) : pluginsDir;
    for (const p of built.products) {
      const dest = path.join(parent, p.id);
      if (fs.existsSync(dest)) fail('PLUGIN_FORGE_EXISTS', p.id);
    }
    // A dry-run stays in the system temp dir, so plugins/ is not touched. A real write stages in a dot folder of the
    // destination's parent (the registry skips dot folders; rename stays on the same filesystem).
    if (!dryRun) fs.mkdirSync(parent, { recursive: true });
    const stage = fs.mkdtempSync(dryRun ? path.join(os.tmpdir(), 'forge-import-') : path.join(parent, '.forge-import-'));
    /** @type {string | null} */
    let view = null;
    /** @type {string[]} */
    const checkLines = [];
    try {
      for (const p of built.products) {
        const dir = path.join(stage, p.id);
        writeTree(dir, p.files, p.manifest);
        // Clip data has to exist before the strict check. packPlugin reads each skeleton the same way
        // `node tools/plugin.mjs pack` does and writes plugin.lock.json. An unreadable skeleton is removed first.
        if (p.class === 'cosmetic') for (const row of dropUnreadableModels(dir)) planned.meta.skipped.push(row);
        const packed = packPlugin(dir, { vanilla: vanilla || undefined, where: `plugins/${p.id}/` });
        if (!packed.wrote || packed.build.problems.length) {
          for (const text of packed.build.problems) issues.push({ code: 'PLUGIN_INVALID', detail: `${p.id}: ${text}` });
          if (!packed.wrote && !packed.build.problems.length) issues.push({ code: 'PLUGIN_INVALID', detail: `${p.id}: pack wrote nothing` });
        }
        if (packed.check) {
          for (const text of [...packed.check.problems, ...packed.check.warnings]) {
            const detail = `${p.id}: ${text}`;
            if (!issues.some((i) => i.detail === detail)) issues.push({ code: 'PLUGIN_INVALID', detail });
          }
        }
      }
      if (!issues.length) {
        const opened = openValidationView({ root, dataDir, pluginsDir, stage });
        view = opened.view;
        const registry = opened.registry;
        const visual = createVisualSets({ registry });
        for (const p of built.products) {
          if (p.class === 'cosmetic') {
            const scope = Array.isArray(p.manifest.scope) && p.manifest.scope.includes('room') ? 'room' : 'personal';
            const got = visual.resolve([p.id], { scope });
            if (!got.ok) issues.push({ code: 'PLUGIN_INVALID', detail: `${p.id}: visual set ${got.error || ''} ${got.detail || ''}`.trim() });
            else if (got.set?.problems?.length || got.set?.warnings?.length) issues.push({ code: 'PLUGIN_INVALID', detail: `${p.id}: visual set ${got.set.problems?.length || 0} problems, ${got.set.warnings?.length || 0} warnings` });
          }
          if (p.class === 'content') {
            const set = buildContentSet({ registry, ids: [p.id] });
            if (!set || set.problems?.length) issues.push({ code: set?.problems?.[0]?.code || 'PLUGIN_INVALID', detail: `${p.id}: ${set?.problems?.[0]?.message || set?.problems?.[0]?.code || 'content set failed'}` });
            else if (set.warnings?.length) issues.push({ code: 'PLUGIN_INVALID', detail: `${p.id}: content set ${set.warnings.length} warnings` });
          }
        }
      }
      if (issues.length) {
        checkLines.push(issues.map((i) => `${i.code}: ${i.detail}`).join('\n'));
        const report = publicReport({ meta: planned.meta, products: built.products, primaryId: alloc.ids[alloc.primary], wrote: false, dryRun, check: checkLines.join('\n'), issues });
        return { ok: false, wrote: false, dryRun, issues, report: stableJson(report), markdown: report.markdown };
      }
      const primary = built.products.find((p) => p.role === alloc.primary) || built.products[0];
      const report = publicReport({ meta: planned.meta, products: built.products, primaryId: primary.id, wrote: !dryRun, dryRun, check: 'check --strict 与 pack 通过；外观走 visual set，数据走 content set。', issues: [] });
      const md = report.markdown;
      if (!dryRun) {
        const repack = primary.class === 'script' ? (dir) => {
          const again = packPlugin(dir, { vanilla: vanilla || undefined, where: `plugins/${primary.id}/` });
          if (!again.wrote) throw new ForgeImportError('PLUGIN_FORGE_ZIP', `${primary.id}: the lock could not be written again`);
        } : null;
        const committed = commitProducts(stage, parent, built.products, primary.id, md, repack);
        if (committed) {
          issues.push(committed);
          const failed = publicReport({
            meta: planned.meta, products: built.products, primaryId: primary.id, wrote: false, dryRun,
            check: `${committed.code}: ${committed.detail}`, issues,
          });
          return { ok: false, wrote: false, dryRun, issues, report: stableJson(failed), markdown: failed.markdown };
        }
      }
      return { ok: true, wrote: !dryRun, dryRun, issues: [], report: stableJson(report), markdown: md };
    } finally {
      fs.rmSync(stage, { recursive: true, force: true });
      if (view) fs.rmSync(view, { recursive: true, force: true });
    }
  } catch (e) {
    if (e instanceof ForgeImportError) {
      issues.push({ code: e.code, detail: e.detail });
      return empty({ check: `${e.code}: ${e.detail}`, markdown: `# 导入报告 IMPORT-REPORT\n\n没有写入。\n\n- ${e.code}：${e.detail}\n` });
    }
    if (typeof e?.code === 'string' && /^E[A-Z0-9]+$/.test(e.code)) {
      const detail = `the import could not be written (${e.code})`;
      issues.push({ code: 'PLUGIN_FORGE_ZIP', detail });
      return empty({ check: `PLUGIN_FORGE_ZIP: ${detail}`, markdown: `# 导入报告 IMPORT-REPORT\n\n没有写入。\n\n- PLUGIN_FORGE_ZIP：${detail}\n` });
    }
    throw e;
  }
}
