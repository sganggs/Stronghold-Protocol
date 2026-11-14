// Read-only audit of every id-keyed picture the client resolves through
// public/js/ui/assetUrls.js and public/js/assets.js (docs/ASSETS.md, docs/research/07-assets.json).
//
// A picture is missing when the resolver returns null — the UI then draws its own fallback (an empty
// circle, a letter, a glyph) — or when the URL is present but the file is not under public/. The
// official path is the ArknightsAssets2 `dyn/…` path (percent-decoded `[uc]`, the form tools/assets/plan.mjs
// builds) or the yuanyan path from 07-assets.json `meta.patterns`. A path no catalogued URL names, only
// the sibling folder, is marked [ASSUMED].
//
// This is not tools/assets/coverage.mjs: that inventory includes Spine, FX and scenes, skips faction
// icons, and exits 1. This tool only checks pictures the client asks for, and exits 0.
//
// Not client lookups, so not rows (see `NOTES`):
//   * rarity stars — a numeral / a procedural diamond (public/js/screens/room.js, public/js/render/textures.js)
//   * bond-board pips and disc-ring chrome — not per-bond (the glyph is assets.bonds[bondId], used on the
//     board strip, the detail dialog and the HUD disc)
//   * band command art — BandCommand draws BandIcon of the band (public/js/ui/bandCommand.js); no command icon id
//   * battle status icons — procedural atlas glyphs (public/js/render/textures.js statusTexture)
//   * mode_training_icon — stored on config modes; DifficultyIcon only asks for
//     modeIcon/mode_<difficulty>_icon of FUNNY / NORMAL / HARD / ABYSS (public/js/ui/components.js)
//   * skillIcon/empty — the official blank skill. A skill with no icon of its own is still listed.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EFFECT_TOKENS, versionAssetData } from './assets/versions.mjs';
import { safeName } from './assets/sources.mjs';
import {
  bandIconUrl, bondIconUrl, chessAvatarUrl, chessPortraitUrl, enemyIconUrl, factionIconUrl,
  itemIconUrl, moduleTypeIconUrl, profGlyphUrl, profIconUrl, skillRecordIconUrl, subProfIconUrl,
  titleIconUrl, tokenAvatarUrl, uiUrl,
} from '../public/js/ui/assetUrls.js';
import { tokenAvatarUrl as boardTokenAvatarUrl } from '../public/js/assets.js';

/** @param {string} rel path under ArknightsAssets2 cn `assets/` (literal `[uc]`, not percent-encoded) */
const aa2 = (rel) => `dyn/${rel}`;
/** @param {string} rel path in yuanyan3060/ArknightsGameResource (07-assets.json meta.patterns) */
const yuanyan = (rel) => `yuanyan3060/ArknightsGameResource/main/${rel}`;

const str = (v) => (typeof v === 'string' && v ? v : null);

// public/js/ui/assetUrls.js PROF_KEY. TOKEN is not a key: profIconUrl returns null for it on purpose
// (the detail panel's summon class chip). Those are not missing files.
const PROF_KEY = {
  PIONEER: 'pioneer', WARRIOR: 'warrior', TANK: 'tank', SNIPER: 'sniper', CASTER: 'caster', MEDIC: 'medic',
  SUPPORT: 'support', SPECIAL: 'special',
};

// public/js/ui/detailPanel.js garrisonTypeIconKey + EVENT_ICON. icon_battle → the small sprite s_icon_battle.
const EVENT_ICON = {
  IN_BATTLE: 's_icon_battle', SERVER_GAIN: 's_icon_bond', SERVER_PREP_START: 's_icon_bond', SERVER_PREP_FIN: 's_icon_bond',
  SERVER_CHESS_SOLD: 's_icon_gold', SERVER_PRICE: 's_icon_gold', SERVER_REFRESH_SHOP: 's_icon_gold',
};

// Exact keys docs/research/07-assets.json autochessUi lists. A key outside the set uses the same folder
// (the sibling convention) and is [ASSUMED]: the research file does not name that png.
const CATALOGUED = {
  enemyTypeIcon: ['dot_icon', 'element_icon', 'fly_icon', 'invisible_icon', 'reflection_icon', 'special_icon', 'times_icon'],
  garrisonTypeIcon: ['icon_battle', 'icon_bond', 'icon_gold', 'icon_support', 's_icon_battle', 's_icon_bond', 's_icon_gold', 's_icon_support'],
  buffIcon: ['icon_boss_debuff', 'icon_enemy_debuff', 'icon_player_buff', 'icon_stage_buff', 'icon_team_buff'],
  modeIcon: ['mode_abyss_icon', 'mode_funny_icon', 'mode_hard_icon', 'mode_normal_icon', 'mode_training_icon'],
  titleIcon: ['comment_icon_1', 'comment_icon_2', 'comment_icon_3', 'comment_icon_4', 'comment_icon_5', 'comment_icon_6'],
  medalIcon: ['trophy_level1_icon', 'trophy_level2_icon', 'trophy_level3_icon', 'trophy_level4_icon', 'trophy_level5_icon'],
  elite: ['elite_0', 'elite_1', 'elite_2', 'elite_3'],
  shopLevelSprite: ['shop_level_tag_1', 'shop_level_tag_2', 'shop_level_tag_3', 'shop_level_tag_4', 'shop_level_tag_5', 'shop_level_tag_6'],
  shopCard: ['img_chess_level_1', 'img_chess_level_2', 'img_chess_level_3', 'img_chess_level_4', 'img_chess_level_5', 'img_chess_level_6'],
};

const CATALOGUE = Object.fromEntries(Object.entries(CATALOGUED).map(([k, list]) => [k, new Set(list)]));

/** Difficulties DifficultyIcon actually requests (shared/constants.js DIFFICULTIES). */
const MODE_DIFFICULTIES = ['FUNNY', 'NORMAL', 'HARD', 'ABYSS'];

/**
 * Buff keys choiceOverlay.js and effectIconUrl actually select. icon_boss_debuff is catalogued but no
 * caller passes it (choiceOverlay only special-cases icon_team_buff as a boolean).
 */
const BUFF_KEYS = [
  ['icon_stage_buff', 'terrain choice'],
  ['icon_enemy_debuff', 'enemy-debuff choice'],
  ['icon_team_buff', 'team buff / effectIconUrl kind team'],
  ['icon_player_buff', 'player buff / effectIconUrl kind choice'],
];

export const NOTES = Object.freeze([
  'Rarity is a numeral and a procedural diamond (public/js/screens/room.js, public/js/render/textures.js), not charRaritySprite / rarity_hub.',
  'Bond-board pips (bondBoardIcon) and disc-ring chrome are not per-bond. The bond glyph (assets.bonds[bondId]) is the board strip, the detail dialog and the HUD disc.',
  'Band commands draw BandIcon of the band (public/js/ui/bandCommand.js). There is no separate command-icon id.',
  'Battle status icons are procedural atlas glyphs (public/js/render/textures.js statusTexture), not files.',
  'mode_training_icon is stored on config modes. DifficultyIcon only requests mode_<funny|normal|hard|abyss>_icon.',
  'skillIcon/empty is the official blank skill, not a missing record. A skill with no icon of its own is listed.',
  'Summon cards print the skill as text and hide skcom_withdraw (detailPanel.js TokenDetail). Only a map-char card asks for a skill icon.',
  'Shop, detail and diy module icons come only from data/local-assets.json groups.module (moduleTypeIconUrl). Loadout also tries assets.modules.',
]);

const read = (path) => JSON.parse(readFileSync(path, 'utf8'));

function garrisonTypeIconKey(garrison) {
  const k = garrison && typeof garrison.eventTypeIcon === 'string' ? garrison.eventTypeIcon : '';
  if (/^icon_[a-z]+$/.test(k)) return `s_${k}`;
  return EVENT_ICON[garrison?.eventType] || 's_icon_bond';
}

/** data/local-assets.json entry, the same read as public/js/data.js localAsset (no data store). */
function localAssetPath(local, group, name) {
  const e = local?.groups?.[group]?.[name];
  return e && typeof e.path === 'string' && e.path ? e.path : null;
}

function publicFile(root, url) {
  const rel = url.startsWith('/') ? url.slice(1) : url;
  return join(root, 'public', rel);
}

function localPathOf(url) {
  const rel = url.startsWith('/') ? url.slice(1) : url;
  return `public/${rel}`;
}

function assumedUi(group, key) {
  const set = CATALOGUE[group];
  return !!(set && !set.has(key));
}

/**
 * @param {string} root
 * @param {boolean} files when false, any non-empty manifest URL counts as present (no disk read)
 */
function diskCache(root, files) {
  const seen = new Map();
  return (url) => {
    if (typeof url !== 'string' || !url) return false;
    if (!files) return true;
    if (seen.has(url)) return seen.get(url);
    const ok = existsSync(publicFile(root, url));
    seen.set(url, ok);
    return ok;
  };
}

function siblingIndex(assets, local, onDisk) {
  /** @type {Map<string, { example: string, count: number }>} */
  const groups = new Map();
  const note = (group, key, url) => {
    if (!onDisk(url)) return;
    const g = groups.get(group);
    if (g) g.count += 1;
    else groups.set(group, { example: key, count: 1 });
  };
  for (const [k, url] of Object.entries(assets?.ui || {})) {
    if (typeof url !== 'string' || !url) continue;
    const slash = k.lastIndexOf('/');
    note(slash >= 0 ? `ui:${k.slice(0, slash)}` : `ui:${k}`, k, url);
  }
  for (const bucket of ['bonds', 'bands', 'items', 'skills', 'modules', 'uniequip', 'equip']) {
    for (const [k, url] of Object.entries(assets?.[bucket] || {})) {
      if (typeof url === 'string' && url) note(bucket, `${bucket}/${k}`, url);
    }
  }
  for (const [k, rec] of Object.entries(assets?.enemies || {})) if (str(rec?.icon)) note('enemies', `enemies/${k}.icon`, rec.icon);
  for (const [k, rec] of Object.entries(assets?.chars || {})) {
    if (str(rec?.avatar)) note('char-avatar', `chars/${k}.avatar`, rec.avatar);
    if (str(rec?.avatarE2)) note('char-avatar', `chars/${k}.avatarE2`, rec.avatarE2);
    if (str(rec?.portrait)) note('char-portrait', `chars/${k}.portrait`, rec.portrait);
    if (str(rec?.portraitE2)) note('char-portrait', `chars/${k}.portraitE2`, rec.portraitE2);
  }
  for (const [k, rec] of Object.entries(assets?.tokens || {})) if (str(rec?.avatar)) note('tokens', `tokens/${k}.avatar`, rec.avatar);
  for (const kind of ['icon', 'large', 'sub', 'battlecard']) {
    for (const [k, url] of Object.entries(assets?.prof?.[kind] || {})) {
      if (typeof url === 'string' && url) note(`prof.${kind}`, `prof.${kind}/${k}`, url);
    }
  }
  for (const [k, rec] of Object.entries(local?.groups?.module || {})) {
    if (str(rec?.path)) note('local-module', `local.groups.module/${k}`, rec.path);
  }
  for (const [group, entries] of Object.entries(local?.groups || {})) {
    if (group === 'module' || !entries || typeof entries !== 'object') continue;
    for (const [k, rec] of Object.entries(entries)) {
      if (str(rec?.path)) note(`local:${group}`, `local:${group}/${k}`, rec.path);
    }
  }
  return groups;
}

function siblingOf(index, groups) {
  for (const g of groups) {
    const hit = index.get(g);
    if (hit?.count) return { siblingExtracted: true, siblingExample: hit.example };
  }
  return { siblingExtracted: false, siblingExample: null };
}

function moduleManifest(assets, type) {
  const keys = [...new Set([type, String(type).toLowerCase()])];
  for (const group of ['modules', 'uniequip', 'equip']) {
    const g = assets?.[group];
    if (!g || typeof g !== 'object') continue;
    for (const k of keys) {
      if (typeof g[k] === 'string' && g[k]) return { url: g[k], key: `${group}/${k}` };
    }
  }
  return null;
}

function push(ctx, row) {
  ctx.checked += 1;
  const url = str(row.url);
  if (url && ctx.onDisk(url)) return;
  const sig = `${row.category}\0${row.id}\0${row.key}`;
  if (ctx.seen.has(sig)) return;
  ctx.seen.add(sig);
  const sib = siblingOf(ctx.siblings, row.groups || []);
  ctx.missing.push({
    version: ctx.version.id,
    label: ctx.version.label,
    category: row.category,
    id: String(row.id),
    name: row.name || '',
    key: row.key,
    reason: url ? 'file' : 'absent',
    url: url || null,
    officialPath: row.officialPath,
    localPath: url ? localPathOf(url) : row.localPath,
    assumed: !!row.assumed,
    siblingExtracted: sib.siblingExtracted,
    siblingExample: sib.siblingExample,
    note: row.note || '',
  });
}

/** The kinds public/js/ui/assetUrls.js also resolves in the local extraction's ui/outer (factionIconUrl, titleIconUrl,
 *  medalIconUrl — 规程's critic / reborn, comment_icon_N_M and trophy_level6–8 live only there; history §37.201). */
const OUTER_FALLBACK = new Set(['enemyTypeIcon', 'titleIcon', 'medalIcon']);
const outerUrl = (ctx, group, sprite) => (OUTER_FALLBACK.has(group) ? localAssetPath(ctx.local, 'ui/outer', sprite) : null);

function uiRow(ctx, spec) {
  const key = `${spec.group}/${spec.sprite}`;
  push(ctx, {
    ...spec,
    key,
    url: uiUrl(ctx.assets, key) || outerUrl(ctx, spec.group, spec.sprite),
    officialPath: spec.officialPath,
    localPath: spec.localPath || `public/assets/ui/${spec.group}/${spec.sprite}.png`,
    assumed: spec.assumed ?? assumedUi(spec.group, spec.sprite),
    groups: [`ui:${spec.group}`],
  });
}

function checkFaction(ctx, typeId, rec) {
  const icon = str(rec?.icon);
  if (!icon) return;
  const catalogued = CATALOGUE.enemyTypeIcon.has(icon);
  push(ctx, {
    category: 'faction',
    id: rec.type || typeId,
    name: rec.name || '',
    key: `enemyTypeIcon/${icon}`,
    url: factionIconUrl(ctx.assets, icon) || outerUrl(ctx, 'enemyTypeIcon', icon),
    officialPath: aa2(`ui/autochess/[uc]autochessouter/arts/enemytypeicon/${icon}.png`),
    localPath: `public/assets/ui/enemyTypeIcon/${icon}.png`,
    assumed: !catalogued,
    groups: ['ui:enemyTypeIcon'],
    note: catalogued ? '' : '[ASSUMED] same folder as the catalogued enemyTypeIcon sprites; docs/research/07-assets.json autochessUi.enemyTypeIcon does not list this file',
  });
}

function checkBond(ctx, id, rec) {
  const iconId = str(rec?.iconId);
  push(ctx, {
    category: 'bond',
    id,
    name: rec?.name || '',
    key: `bonds/${id}`,
    url: bondIconUrl(ctx.assets, id),
    officialPath: aa2(`ui/autochess/[uc]autochesscommon/arts/bondicon/${(iconId || id).toLowerCase()}.png`),
    localPath: `public/assets/bond/${id}.png`,
    assumed: !iconId,
    groups: ['bonds'],
    note: iconId ? 'board strip, detail dialog and HUD disc share this glyph' : '[ASSUMED] no iconId; path uses the bond id lowercased (plan.mjs bondicon/<iconId lowercased>)',
  });
}

function checkBand(ctx, id, rec) {
  const iconId = str(rec?.iconId) || `icon_${String(id).replace(/^band_/, '')}`;
  push(ctx, {
    category: 'band',
    id,
    name: rec?.name || '',
    key: `bands/${id}`,
    url: bandIconUrl(ctx.assets, id),
    officialPath: aa2(`ui/autochess/[uc]autochesscommon/arts/bandicon/${iconId}.png`),
    localPath: `public/assets/band/${id}.png`,
    assumed: !str(rec?.iconId),
    groups: ['bands'],
    note: 'strategy icon; the command button uses this same picture (no separate command icon)',
  });
}

function checkItem(ctx, id, rec) {
  const trap = str(rec?.trapId) || str(rec?.iconId) || id;
  const looked = str(rec?.iconId) || trap;
  push(ctx, {
    category: 'item',
    id,
    name: rec?.name || '',
    key: `items/${looked}`,
    url: itemIconUrl(ctx.assets, rec),
    officialPath: aa2(`ui/autochess/[uc]autochesscommon/arts/shopitemicon/${trap}.png`),
    localPath: `public/assets/item/${trap}.png`,
    assumed: false,
    groups: ['items'],
    note: 'equipment icon (itemIconUrl: iconId, then trapId)',
  });
}

function checkEnemy(ctx, id, rec) {
  const direct = str(ctx.assets?.enemies?.[id]?.icon);
  const base = id.replace(/_\d+$/, '');
  const url = enemyIconUrl(ctx.assets, id);
  const viaBase = !direct && url && base !== id;
  push(ctx, {
    category: 'enemy',
    id,
    name: rec?.name || '',
    key: viaBase ? `enemies/${base}.icon` : `enemies/${id}.icon`,
    url,
    officialPath: yuanyan(`enemy/${viaBase ? base : id}.png`),
    localPath: `public/assets/enemy/icon/${viaBase ? base : id}.png`,
    assumed: false,
    groups: ['enemies'],
    note: viaBase ? `assetUrls enemyIconUrl fell back from ${id} to ${base}`
      : (!url && base !== id ? `no icon; the _digits fallback ${base} is also absent` : ''),
  });
}

function avatarProbe(chess) {
  const id = str(chess?.assets?.avatar) || str(chess?.charId);
  if (!id) return null;
  if (id.endsWith('_2')) {
    const base = id.slice(0, -2);
    return { key: `chars/${base}.avatarE2`, file: `${base}_2`, which: 'avatarE2' };
  }
  if (chess?.isGolden) return { key: `chars/${id}.avatarE2`, file: `${id}_2`, which: 'avatarE2' };
  return { key: `chars/${id}.avatar`, file: id, which: 'avatar' };
}

function portraitProbe(chess) {
  const raw = str(chess?.assets?.portrait);
  const id = raw || (str(chess?.charId) ? `${chess.charId}_1` : null);
  if (!id) return null;
  const base = /_(1|2)$/.test(id) ? id.slice(0, -2) : id;
  if (chess?.isGolden || id.endsWith('_2')) return { key: `chars/${base}.portraitE2`, file: `${base}_2`, which: 'portraitE2' };
  return { key: `chars/${base}.portrait`, file: `${base}_1`, which: 'portrait' };
}

function checkChessArt(ctx, id, chess) {
  if (!str(chess?.charId) && !str(chess?.assets?.avatar) && !str(chess?.assets?.portrait)) return;
  const avatar = avatarProbe(chess);
  if (avatar) {
    push(ctx, {
      category: 'chess-avatar',
      id,
      name: chess?.name || '',
      key: avatar.key,
      url: chessAvatarUrl(ctx.assets, chess),
      officialPath: yuanyan(`avatar/${avatar.file}.png`),
      localPath: `public/assets/char/avatar/${avatar.file}.png`,
      assumed: false,
      groups: ['char-avatar'],
      note: '',
    });
  }
  const portrait = portraitProbe(chess);
  if (portrait) {
    push(ctx, {
      category: 'chess-portrait',
      id,
      name: chess?.name || '',
      key: portrait.key,
      url: chessPortraitUrl(ctx.assets, chess),
      officialPath: yuanyan(`portrait/${portrait.file}.png`),
      localPath: `public/assets/char/portrait/${portrait.file}.png`,
      assumed: false,
      groups: ['char-portrait'],
      note: '',
    });
  }
}

function checkToken(ctx, id, rec) {
  const url = tokenAvatarUrl(ctx.assets, id);
  const board = boardTokenAvatarUrl(ctx.assets, id);
  const generic = str(ctx.assets?.prof?.battlecard?.token);
  const onlyGeneric = !url && board && generic && board === generic;
  // The detail card and UnitThumb ask tokenAvatarUrl only (assetUrls.js). The board's unitPictureUrl
  // (assets.js) tries the operator avatar and the enemy icon first, so a map character or 炎佑 can
  // already have a picture on the board while the card stays empty.
  const charAvatar = str(ctx.assets?.chars?.[id]?.avatar);
  const enemyIcon = str(ctx.assets?.enemies?.[id]?.icon);
  let note = '';
  if (!url && charAvatar && ctx.onDisk(charAvatar)) {
    note = `tokenAvatarUrl does not read chars/${id}.avatar; that file is already on disk (${localPathOf(charAvatar)}). The board uses it; the detail card and UnitThumb do not.`;
  } else if (!url && enemyIcon && ctx.onDisk(enemyIcon)) {
    note = `tokenAvatarUrl does not read enemies/${id}.icon; that file is already on disk (${localPathOf(enemyIcon)}). The board uses it; the detail card and UnitThumb do not.`;
  } else if (!url && EFFECT_TOKENS.has(id)) {
    note = onlyGeneric
      ? 'effect/marker token (tools/assets/versions.mjs EFFECT_TOKENS). The detail card and UnitThumb get no picture; assets.js then draws prof.battlecard.token. The manifest entry has no avatar, and the official client may ship none.'
      : 'effect/marker token (tools/assets/versions.mjs EFFECT_TOKENS); the manifest entry has no avatar. The official client may ship no portrait.';
  } else if (onlyGeneric) note = 'no own avatar or owner avatar; assets.js falls back to prof.battlecard.token (a class chip, not this summon)';
  else if (!url) note = 'tokenAvatarUrl: skin, then the token avatar, then the owner avatar';
  push(ctx, {
    category: 'token',
    id,
    name: rec?.name || '',
    key: `tokens/${id}.avatar`,
    url,
    officialPath: yuanyan(`avatar/${id}.png`),
    localPath: `public/assets/token/avatar/${id}.png`,
    assumed: false,
    groups: ['tokens', 'char-avatar'],
    note,
  });
  // Map-char cards draw a skill icon (detailPanel.js MapCharDetail, only when skill.desc is set).
  // A summon card prints the skill as text and hides skcom_withdraw (TokenDetail), so those ids are
  // not pictures the client asks for.
  if (rec?.kind === 'mapChar' && rec.skill?.desc) checkSkill(ctx, rec.skill, rec?.name);
}

function checkSkill(ctx, skill, ownerName) {
  const iconId = str(skill?.iconId) || str(skill?.skillId);
  if (!iconId) return;
  const url = skillRecordIconUrl(ctx.assets, skill, { empty: false });
  push(ctx, {
    category: 'skill',
    id: str(skill?.skillId) || iconId,
    name: skill?.name || ownerName || '',
    key: `skills/${iconId}`,
    url,
    officialPath: yuanyan(`skill/skill_icon_${encodeURIComponent(iconId)}.png`),
    localPath: `public/assets/skill/${safeName(iconId)}.png`,
    assumed: false,
    groups: ['skills'],
    note: url ? '' : 'no skills[iconId] or skillsById hit; the client draws skillIcon/empty or a lettered tile',
  });
}

function checkProfession(ctx, profession) {
  const k = PROF_KEY[String(profession || '').toUpperCase()];
  if (!k) return;
  push(ctx, {
    category: 'profession',
    id: k,
    name: String(profession),
    key: `prof.icon/${k}`,
    url: profIconUrl(ctx.assets, profession),
    officialPath: aa2(`arts/profession_hub/icon_${k}.png`),
    localPath: `public/assets/prof/icon_${k}.png`,
    assumed: false,
    groups: ['prof.icon'],
    note: '',
  });
  push(ctx, {
    category: 'profession-glyph',
    id: k,
    name: String(profession),
    key: `prof.large/${k}`,
    url: profGlyphUrl(ctx.assets, profession),
    officialPath: aa2(`arts/profession_large_hub/icon_profession_${k}_large_white.png`),
    localPath: `public/assets/prof/large_${k}.png`,
    assumed: false,
    groups: ['prof.large'],
    note: 'loadout / diy square glyph (profGlyphUrl)',
  });
}

function checkSubProf(ctx, rec) {
  const raw = str(rec?.assets?.subProfIcon);
  const sub = raw ? raw.replace(/^sub_/, '').replace(/_icon$/, '') : str(rec?.subProfessionId);
  if (!sub) return;
  push(ctx, {
    category: 'sub-profession',
    id: sub,
    name: rec?.subProfessionName || sub,
    key: `prof.sub/${sub}`,
    url: subProfIconUrl(ctx.assets, rec),
    officialPath: aa2(`arts/ui/subprofessionicon/sub_${sub}_icon.png`),
    localPath: `public/assets/prof/sub/${safeName(sub)}.png`,
    assumed: false,
    groups: ['prof.sub'],
    note: '',
  });
}

function checkOperator(ctx, id, rec) {
  checkChessArt(ctx, id, rec);
  checkProfession(ctx, rec?.profession);
  checkSubProf(ctx, rec);
  if (rec?.skill) checkSkill(ctx, rec.skill, rec?.name);
  for (const sk of rec?.skills || []) checkSkill(ctx, sk, rec?.name);
}

function moduleTypesOf(pack) {
  const types = new Set();
  const add = (rec) => {
    const t = str(rec?.typeName) || str(rec?.type) || str(rec?.typeIcon);
    if (t) types.add(t);
  };
  for (const c of Object.values(pack.chess || {})) add(c.module);
  for (const u of Object.values(pack.backups?.units || {})) {
    add(u.module);
    if (u.moduleNames && typeof u.moduleNames === 'object') {
      for (const v of Object.values(u.moduleNames)) if (typeof v === 'string' && v) types.add(v);
    }
    for (const form of Object.values(u.forms || {})) {
      add(form.module);
      for (const m of form.modules || []) add(m);
    }
  }
  return [...types].sort();
}

function checkModule(ctx, type) {
  const localUrl = moduleTypeIconUrl(ctx.local, type);
  const manifest = moduleManifest(ctx.assets, type);
  const localOk = !!(localUrl && ctx.onDisk(localUrl));
  if (localOk) {
    ctx.checked += 1;
    return;
  }
  const manifestOk = !!(manifest && ctx.onDisk(manifest.url));
  const folder = `arts/ui/uniequiptype/${type}.png`;
  const alt = type.toLowerCase() === type ? '' : ` (also ${type.toLowerCase()}.png)`;
  push(ctx, {
    category: 'module',
    id: type,
    name: type,
    key: `local.groups.module/${type}`,
    url: localUrl || null,
    officialPath: aa2(`arts/ui/uniequiptype/${type}.png`),
    localPath: localUrl ? localPathOf(localUrl) : `public/assets/module/${safeName(type).toLowerCase()}.png`,
    assumed: false,
    groups: ['local-module', 'modules'],
    note: manifestOk
      ? `shop, detail and diy ask only for groups.module; loadout falls back to ${manifest.key}, which is on disk. Official file ${folder}${alt}`
      : `shop, detail, diy and loadout. Official file ${folder}${alt} (plan.mjs uniequiptype)`,
  });
}

function checkGarrison(ctx, id, rec) {
  const sprite = garrisonTypeIconKey(rec);
  uiRow(ctx, {
    category: 'garrison',
    id,
    name: rec?.eventTypeDesc || rec?.name || '',
    group: 'garrisonTypeIcon',
    sprite,
    officialPath: aa2(`ui/autochess/[uc]autochesscommon/arts/garrisontypeicon/${sprite}.png`),
    note: `eventTypeIcon ${rec?.eventTypeIcon || '∅'} → ${sprite}`,
  });
}

function phasesOf(pack) {
  const phases = new Set();
  const add = (rec) => {
    const p = rec?.status?.phase;
    if (Number.isInteger(p) && p >= 0 && p <= 2) phases.add(p);
  };
  for (const c of Object.values(pack.chess || {})) add(c);
  for (const u of Object.values(pack.backups?.units || {})) {
    add(u);
    for (const form of Object.values(u.forms || {})) add(form);
  }
  return [...phases].sort((a, b) => a - b);
}

function tiersOf(pack) {
  const tiers = new Set();
  for (const c of Object.values(pack.chess || {})) {
    const t = c?.tier;
    if (Number.isInteger(t) && t >= 1 && t <= 6) tiers.add(t);
  }
  return [...tiers].sort((a, b) => a - b);
}

function checkShared(ctx, pack) {
  for (const phase of phasesOf(pack)) {
    uiRow(ctx, {
      category: 'elite',
      id: `elite_${phase}`,
      name: `E${phase}`,
      group: 'elite',
      sprite: `elite_${phase}`,
      officialPath: aa2(`arts/elite_hub/elite_${phase}.png`),
      localPath: `public/assets/ui/elite/elite_${phase}.png`,
      note: 'PromotionIcon (public/js/ui/gameComponents.js) asks for elite/elite_<phase>',
    });
  }
  for (const tier of tiersOf(pack)) {
    uiRow(ctx, {
      category: 'shop-level',
      id: `shop_level_tag_${tier}`,
      name: `tier ${tier}`,
      group: 'shopLevelSprite',
      sprite: `shop_level_tag_${tier}`,
      officialPath: aa2(`ui/autochess/[uc]autochessouter/arts/shoplevelsprite/shop_level_tag_${tier}.png`),
      note: 'loadout tier marker',
    });
    const sprite = `img_chess_level_${tier}`;
    const web = uiUrl(ctx.assets, `shopCard/${sprite}`);
    const local = localAssetPath(ctx.local, 'ui/battle', sprite);
    const url = web || local;
    push(ctx, {
      category: 'chess-level',
      id: sprite,
      name: `tier ${tier}`,
      key: web ? `shopCard/${sprite}` : `local:ui/battle/${sprite}`,
      url,
      officialPath: aa2(`ui/autochess/[uc]autochessbattle/shop/autochess_shop_card_item/${sprite}.png`),
      localPath: local ? localPathOf(local) : `public/assets/ui/shopCard/${sprite}.png`,
      assumed: assumedUi('shopCard', sprite),
      groups: ['ui:shopCard', 'local:ui/battle'],
      note: 'tier chip: shopCard/img_chess_level_N, else local ui/battle (public/js/ui/components.js tierChipUrl)',
    });
  }
  for (const [sprite, name] of BUFF_KEYS) {
    uiRow(ctx, {
      category: 'buff',
      id: sprite,
      name,
      group: 'buffIcon',
      sprite,
      officialPath: aa2(`ui/autochess/[uc]autochessbattle/arts/bufficon/${sprite}.png`),
      note: name,
    });
  }
  for (const difficulty of MODE_DIFFICULTIES) {
    const sprite = `mode_${difficulty.toLowerCase()}_icon`;
    uiRow(ctx, {
      category: 'mode',
      id: sprite,
      name: difficulty,
      group: 'modeIcon',
      sprite,
      officialPath: aa2(`ui/autochess/[uc]autochesscommon/arts/modeicon/${sprite}.png`),
      note: 'DifficultyIcon',
    });
  }
  for (const title of pack.config?.titles || []) {
    // result.js / settle.js: picId wins; the comment_ → comment_icon_ rewrite runs only when picId is absent.
    const pic = str(title?.picId) || String(title?.id || '').replace('comment_', 'comment_icon_');
    if (!pic) continue;
    push(ctx, {
      category: 'title',
      id: title.id || pic,
      name: title.name || '',
      key: `titleIcon/${pic}`,
      url: titleIconUrl(ctx.assets, pic) || outerUrl(ctx, 'titleIcon', pic),
      officialPath: aa2(`ui/autochess/[uc]autochessouter/arts/titleicon/${pic}.png`),
      localPath: `public/assets/ui/titleIcon/${pic}.png`,
      assumed: assumedUi('titleIcon', pic),
      groups: ['ui:titleIcon'],
      note: assumedUi('titleIcon', pic) ? '[ASSUMED] titleIcon folder of the catalogued comment_icon_* sprites; this picId is not in 07-assets.json' : '',
    });
  }
  for (const medal of pack.config?.trophies?.medals || []) {
    const icon = str(medal?.iconId);
    if (!icon) continue;
    uiRow(ctx, {
      category: 'medal',
      id: icon,
      name: icon,
      group: 'medalIcon',
      sprite: icon,
      officialPath: aa2(`ui/autochess/[uc]autochessouter/arts/medalicon/${icon}.png`),
      note: `trophy count ${medal.count}`,
    });
  }
}

function auditPack(pack, assets, local, onDisk, siblings) {
  const ctx = {
    version: pack.version,
    assets,
    local,
    onDisk,
    siblings,
    checked: 0,
    seen: new Set(),
    missing: [],
  };
  for (const [id, rec] of Object.entries(pack.factions?.types || {})) checkFaction(ctx, id, rec);
  for (const [id, rec] of Object.entries(pack.bonds || {})) checkBond(ctx, id, rec);
  for (const [id, rec] of Object.entries(pack.bands || {})) checkBand(ctx, id, rec);
  for (const [id, rec] of Object.entries(pack.items || {})) checkItem(ctx, id, rec);
  for (const [id, rec] of Object.entries(pack.enemies || {})) checkEnemy(ctx, id, rec);
  for (const [id, rec] of Object.entries(pack.chess || {})) checkOperator(ctx, id, rec);
  for (const [id, rec] of Object.entries(pack.backups?.units || {})) {
    checkOperator(ctx, id, { ...rec, charId: rec.charId || id });
    for (const form of Object.values(rec.forms || {})) {
      for (const sk of form.skills || []) checkSkill(ctx, sk, rec.name);
    }
  }
  for (const [id, rec] of Object.entries(pack.tokens || {})) checkToken(ctx, id, rec);
  for (const [id, rec] of Object.entries(pack.backups?.tokens || {})) checkToken(ctx, id, rec);
  for (const type of moduleTypesOf(pack)) checkModule(ctx, type);
  for (const [id, rec] of Object.entries(pack.garrisons || {})) checkGarrison(ctx, id, rec);
  checkShared(ctx, pack);
  ctx.missing.sort((a, b) => a.category.localeCompare(b.category) || a.id.localeCompare(b.id) || a.key.localeCompare(b.key));
  return {
    id: pack.version.id,
    label: pack.version.label,
    checked: ctx.checked,
    missing: ctx.missing.length,
    rows: ctx.missing,
  };
}

/**
 * @param {{ root: string, packs?: any[], assets?: any, local?: any, files?: boolean }} opts
 * `files` defaults to true: a manifest URL whose file is absent is missing. Pass packs to audit a
 * fixture instead of data/ and data/versions/.
 */
export function uiAssetRefs({ root, packs = null, assets = null, local = null, files = true }) {
  const loaded = packs || loadUiAssetPacks(root);
  const manifest = assets || read(join(root, 'data/assets.json'));
  const localArt = local || (existsSync(join(root, 'data/local-assets.json')) ? read(join(root, 'data/local-assets.json')) : { groups: {} });
  const onDisk = diskCache(root, files);
  const siblings = siblingIndex(manifest, localArt, onDisk);
  const versions = loaded.map((pack) => auditPack(pack, manifest, localArt, onDisk, siblings));
  const missing = versions.flatMap((v) => v.rows);
  return {
    versions: versions.map(({ id, label, checked, missing: n }) => ({ id, label, checked, missing: n })),
    missing,
    notes: NOTES,
  };
}

/** Human report. Shared-key piles (every garrison that uses one icon) collapse past three records. */
export function formatUiAssetRefs(result) {
  const lines = [];
  const total = result.missing.length;
  lines.push(`ui asset refs: ${result.versions.length} version(s), ${total} missing picture(s)`);
  for (const v of result.versions) lines.push(`${v.id} (${v.label}): checked ${v.checked}, missing ${v.missing}`);
  const rows = result.missing;
  const groups = [];
  for (const row of rows) {
    const last = groups[groups.length - 1];
    if (last && last.version === row.version && last.category === row.category && last.key === row.key) last.rows.push(row);
    else groups.push({ version: row.version, category: row.category, key: row.key, rows: [row] });
  }
  for (const g of groups) {
    const row = g.rows[0];
    const extra = g.rows.length > 1 ? ` (+${g.rows.length - 1} more records)` : '';
    lines.push(`${row.version}  ${row.category}  ${row.id}  ${row.name}${extra}`.trimEnd());
    lines.push(`  key: ${row.key}  (${row.reason})`);
    lines.push(`  official: ${row.officialPath}${row.assumed ? '  [ASSUMED]' : ''}`);
    lines.push(`  local: ${row.localPath}`);
    lines.push(`  sibling: ${row.siblingExtracted ? row.siblingExample : 'none extracted'}`);
    if (row.note) lines.push(`  note: ${row.note}`);
  }
  lines.push('skipped (not a client lookup):');
  for (const note of result.notes) lines.push(`- ${note}`);
  return lines.join('\n') + '\n';
}

export function loadUiAssetPacks(root) {
  return versionAssetData(root).map((d) => {
    const extra = (name) => {
      const path = join(root, 'data', d.version.dir, name);
      return existsSync(path) ? read(path) : null;
    };
    return { ...d, factions: extra('factions.json'), garrisons: extra('garrisons.json'), config: extra('config.json') };
  });
}

function argValue(args, key) {
  const hit = args.find((a) => a === `--${key}` || a.startsWith(`--${key}=`));
  if (!hit) return null;
  if (hit === `--${key}`) return true;
  return hit.slice(key.length + 3);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const rootOpt = argValue(args, 'root');
  const root = resolve(typeof rootOpt === 'string' ? rootOpt : fileURLToPath(new URL('..', import.meta.url)));
  const json = argValue(args, 'json');
  const result = uiAssetRefs({ root, files: !args.includes('--no-files') });
  if (json === true) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else {
    process.stdout.write(formatUiAssetRefs(result));
    if (typeof json === 'string') writeFileSync(json, JSON.stringify(result, null, 2) + '\n');
  }
  process.exitCode = 0;
}
