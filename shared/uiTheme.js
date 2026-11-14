// shared/uiTheme.js — a local interface theme pack (spTheme 1). Plain ESM: no Node APIs, no DOM, no Math.random.
// The browser (public/js/uiTheme.js) reads the zip, decodes images and stores the pack. This file checks the
// manifest, picks a voice line and names the CSS variables. Nothing here fetches a URL.
//
// Official rows: activity_table.json autoChessData (规程 act3autochess, season-independent):
// skinColorDataDict, skinEffectPreviewDict, skinVoiceTriggerDataDict, skinConsts.defaultAutoChessSkinId
// ac_n_initial 「卫戍协议终端」. The cd unit and "lower priority wins" are not in that table — see VOICE_TRIGGERS.

import { acceptColour, acceptThemeValue, THEME_VAR_LIMIT } from './plugins/theme.js';
import { N_ } from './i18n.js';
import { splitHashedPath } from './assetPaths.js';
import { utf8 } from './sha256.js';

/** [ASSUMED] Pack limits. A change belongs in docs/THEMES.md as well. */
export const THEME_LIMITS = Object.freeze({
  json: 64 * 1024,
  name: 40,
  author: 40,
  description: 300,
  version: 32,
  files: 400,
  image: 8 * 1024 * 1024,
  imageEdge: 4096,
  audio: 4 * 1024 * 1024,
  pack: 64 * 1024 * 1024,
  packs: 8,
  voiceLines: 8,
  slice: 4096,
});

/** Built-in look. A pack may not use this id. */
export const BUILTIN_ID = 'terminal';
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Official colour names (skinColorDataDict). Garrison 2 and 3 have no second chip in our UI. */
export const COLOR_KEYS = Object.freeze([
  'skinLightColor', 'skinDarkColor', 'bondColor', 'bondIconColor', 'chessNameColor',
  'saleColor1', 'saleColor2', 'destroyColor1', 'destroyColor2', 'countdownHintColor',
  'obIconColor', 'garrisonIconColor1', 'garrisonIconColor2', 'garrisonIconColor3',
]);

/** ac_n_initial, the official default skin. The starter pack lists these; the built-in look does not paint them. */
export const DEFAULT_SKIN_COLORS = Object.freeze({
  garrisonIconColor1: '#FFFFFF33',
  garrisonIconColor2: '#FFFFFF33',
  garrisonIconColor3: '#FFFFFF33',
  bondColor: '#B7B7B7',
  bondIconColor: '#031712',
  chessNameColor: '#FFFFFF',
  saleColor1: '#FFBA00',
  saleColor2: '#3A2D0A',
  destroyColor1: '#DC3B3B',
  destroyColor2: '#290808',
  countdownHintColor: '#FF0000',
  obIconColor: '#00FFC4',
  skinDarkColor: '#00FFC4',
  skinLightColor: '#00FFC4',
});

/** Colour key → custom property. Absent: accepted, reported unused, not painted. */
// bondColor and chessNameColor paint only the regulation card (.scard--reg) while that card's
// chess-frame slot is present. The frame sprite carries the face, so the official words
// (可露希尔 writes them in black) sit on that face. Covenant cards stay dark and do not use these.
const COLOR_VAR = Object.freeze({
  skinLightColor: '--sp-c-skin-light',
  skinDarkColor: '--sp-c-skin-dark',
  bondColor: '--sp-c-bond',
  bondIconColor: '--sp-c-bond-icon',
  chessNameColor: '--sp-c-chess-name',
  saleColor1: '--sp-c-sale-1',
  saleColor2: '--sp-c-sale-2',
  destroyColor1: '--sp-c-destroy-1',
  destroyColor2: '--sp-c-destroy-2',
  countdownHintColor: '--sp-c-countdown-hint',
  obIconColor: '--sp-c-ob',
  garrisonIconColor1: '--sp-c-garrison-1',
});

/** data-sp-color token (no "Color" suffix). */
const COLOR_ATTR = Object.freeze({
  skinLightColor: 'skinLight',
  skinDarkColor: 'skinDark',
  bondColor: 'bond',
  bondIconColor: 'bondIcon',
  chessNameColor: 'chessName',
  saleColor1: 'sale1',
  saleColor2: 'sale2',
  destroyColor1: 'destroy1',
  destroyColor2: 'destroy2',
  countdownHintColor: 'countdownHint',
  obIconColor: 'ob',
  garrisonIconColor1: 'garrison1',
});

/** Slots our screens actually draw. Order is the official skin_config order, then our two panels. */
export const WIRED_IMAGE_SLOTS = Object.freeze([
  'hud_player_info', 'game_start', 'help_battle', 'round_start', 'round_result',
  'effect_choose_self_select', 'img_check_enemy', 'img_check_player',
  'countdown', 'countdown_effectchoose', 'countdown_outer', 'prep_ready', 'shop_main',
  'boss_damage', 'img_shop_sell_chess_normal', 'img_shop_sell_chess_hover',
  'chess_frame_normal', 'chess_frame_level_five', 'chess_frame_level_six',
  'chess_level_icon_1', 'chess_level_icon_2', 'chess_level_icon_3',
  'chess_level_icon_4', 'chess_level_icon_5', 'chess_level_icon_6',
  'shop_level_1', 'shop_level_2', 'shop_level_3', 'shop_level_4', 'shop_level_5', 'shop_level_6',
  'char_spine_outer',
  // Regulation shop chrome. Official theme.json files do not name these; a custom pack can.
  // The client also paints the same spots from the installed pack's sprites (ui/regHud.js).
  'shop_refresh', 'shop_refresh_lock', 'shop_frozen', 'shop_frozen_on', 'shop_frozen_lock',
  'shop_money', 'shop_char_card', 'shop_cost_free',
  'bond_strip', 'detail_panel',
]);

/** Official names with no element here. Accepted and reported unused. */
export const UNWIRED_IMAGE_SLOTS = Object.freeze([
  'img_check_buff_back', 'img_check_buff_normal', 'img_check_buff_count',
  'win_streak', 'effect_choose_group_tip',
  'img_shop_sell_equip_normal', 'img_shop_sell_equip_hover',
]);

const WIRED_SLOT = new Set(WIRED_IMAGE_SLOTS);

/** Chess frames are 9-slice. [ASSUMED] A frame with no slice uses 8px so the centre stays empty.
 * char_spine_outer is not here: the official sprites are character plates with no Unity border. */
const FRAME_SLOTS = new Set([
  'chess_frame_normal', 'chess_frame_level_five', 'chess_frame_level_six',
]);
const DEFAULT_FRAME_SLICE = Object.freeze([8, 8, 8, 8]);

/** One official prefab unit in our rem: the client draws its ~1334-unit canvas 1.44× at 16:9 (public/js/ui/prefab/hud.js
 * OFFICIAL_SCALE; not imported, shared code). */
const OFFICIAL_UNIT_REM = 1.44 / 100;

/**
 * A 9-slice's widths at the official size, `--sp-slice-rem-<slot>`: ui-theme.css draws a sliced picture as a frame with
 * them where stretching the whole picture bent it (可露希尔's window frame over the 本局信息 drawer, history §37.204).
 * @param {readonly number[]} slice
 */
function sliceRem(slice) {
  return slice.map((n) => `${Number((n * OFFICIAL_UNIT_REM).toFixed(4))}rem`).join(' ');
}

/** skinEffectPreviewDict icon order: 9 模拟开始, 4 休整, 5 完美作战, 1 联防, 2 机变, 3 作战结束, 7 完美连胜, 6 最终攻势, 8 领袖伤害. */
export const BANNER_KEYS = Object.freeze([
  'gameStart', 'rest', 'perfect', 'coop', 'effectChoose', 'battleEnd', 'perfectStreak', 'finalAssault', 'bossDamage',
]);
/** perfectStreak has no plate. The others paint behind the plate's own text. */
export const WIRED_BANNERS = Object.freeze([
  'gameStart', 'rest', 'perfect', 'coop', 'effectChoose', 'battleEnd', 'finalAssault', 'bossDamage',
]);
const WIRED_BANNER = new Set(WIRED_BANNERS);

/**
 * skinVoiceTriggerDataDict. probability / cd / priority copied as stored.
 * [ASSUMED] cd is seconds. [ASSUMED] a smaller priority number wins, and one line plays at a time.
 * @type {Readonly<Record<string, { probability: number, cd: number, priority: number }>>}
 */
export const VOICE_TRIGGERS = Object.freeze({
  AUTOCHESS_GAME_START: Object.freeze({ probability: 1, cd: 0, priority: 1 }),
  AUTOCHESS_REST_NO_HP_LOSS: Object.freeze({ probability: 0.8, cd: 200, priority: 5 }),
  AUTOCHESS_REST_HP_LOSS: Object.freeze({ probability: 0.8, cd: 200, priority: 8 }),
  AUTOCHESS_REST_BOSS: Object.freeze({ probability: 1, cd: 0, priority: 2 }),
  AUTOCHESS_REST_HIDDEN_BOSS: Object.freeze({ probability: 1, cd: 0, priority: 6 }),
  AUTOCHESS_SAME_OPERATOR: Object.freeze({ probability: 0.3, cd: 10, priority: 10 }),
  AUTOCHESS_BUY_OPERATOR_LOW: Object.freeze({ probability: 0.2, cd: 10, priority: 12 }),
  AUTOCHESS_BUY_OPERATOR_HIGH: Object.freeze({ probability: 0.3, cd: 10, priority: 11 }),
  AUTOCHESS_SHOP_UPGRADE: Object.freeze({ probability: 1, cd: 10, priority: 4 }),
  AUTOCHESS_COUNTDOWN: Object.freeze({ probability: 0.5, cd: 0, priority: 7 }),
  AUTOCHESS_MERGE_TRIPLE: Object.freeze({ probability: 0.4, cd: 5, priority: 9 }),
  AUTOCHESS_ALLIANCE_LEVEL: Object.freeze({ probability: 1, cd: 0, priority: 3 }),
  AUTOCHESS_FREEZE: Object.freeze({ probability: 0.5, cd: 15, priority: 13 }),
});

/** [ASSUMED] Shop tiers 1–3 are the low buy line; 4–6 are the high line. */
export const HIGH_TIER_MIN = 4;

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp']);
const AUDIO_EXT = new Set(['ogg', 'mp3']);
const TOP_KEYS = new Set([
  'spTheme', 'id', 'name', 'author', 'version', 'description', 'thumbnail', 'preview',
  'colors', 'tokens', 'images', 'banners', 'voice', 'character',
]);
const SPINE_EXT = new Set(['skel', 'atlas', 'json']);

/**
 * The three official packs. The card title is a `t()` key, not the skin's own name: ac_n_initial's
 * skin is also 「卫戍协议终端」, and that card already means today's look.
 * [ASSUMED] The suffix 「（官方贴图）」 is ours, so the two cards can sit side by side.
 */
export const OFFICIAL_THEMES = Object.freeze([
  Object.freeze({
    id: 'ac_n_initial',
    group: 'themes/ac_n_initial',
    name: N_('卫戍协议终端（官方贴图）'),
    description: N_('一切模拟都从此开始。'),
  }),
  Object.freeze({
    id: 'ac_n_iron',
    group: 'themes/ac_n_iron',
    name: N_('乌萨斯齐心团'),
    description: N_('卫戍协议模拟中的乌萨斯工人团体，每个人都是大嗓门。'),
  }),
  Object.freeze({
    id: 'ac_s_closur',
    group: 'themes/ac_s_closur',
    name: N_('“全能的”可露希尔'),
    description: N_('管理着整个卫戍协议模拟系统的罗德岛大开发者。'),
  }),
]);

export function officialThemeById(id) {
  return OFFICIAL_THEMES.find((row) => row.id === id) || null;
}

const COMBAT_PHASES = new Set(['COMBAT', 'UNITE', 'FINAL_ASSAULT', 'HIDDEN_CORE']);
const GAME_START_FROM = new Set(['INFO_CHECK', 'BAND_DRAFT', 'CUSTOM_CHECK', 'BATTLE_CHECK']);

/** @type {(v: unknown) => v is Record<string, any>} */
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (obj) => Object.keys(obj).filter((k) => Object.hasOwn(obj, k) && k !== '__proto__' && k !== 'constructor' && k !== 'prototype');

// sha256.js utf8(): the TextEncoder bytes, without the browser / Node global (jsconfig lib ES2022)
function utf8Size(text) {
  return utf8(text).length;
}

function extOf(path) {
  const dot = path.lastIndexOf('.');
  return dot < 0 ? '' : path.slice(dot + 1).toLowerCase();
}

/**
 * A pack-relative path. Stricter than assetPack.normalizePackPath, which keeps `:`.
 * Rejects `..`, NUL, a scheme, `:`, `?`, `#`, `%`. A leading slash is only a zip prefix
 * (`/etc/passwd` → `etc/passwd`); the browser never reads it from disk.
 * @param {string} name
 * @returns {string | null}
 */
export function themeRelPath(name) {
  if (typeof name !== 'string' || !name || name.includes('\0')) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(name) || name.includes('://')) return null;
  let path = name.replace(/\\/g, '/');
  if (path.endsWith('/')) return null;
  while (path.startsWith('./')) path = path.slice(2);
  while (path.startsWith('/')) path = path.slice(1);
  if (!path || /[:?#%]/.test(path)) return null;
  const segs = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') return null;
    segs.push(seg);
  }
  return segs.length ? segs.join('/') : null;
}

/**
 * Where theme.json sits. Prefer the archive root; otherwise exactly one `folder/theme.json`.
 * @param {string[]} paths already pack-relative
 * @returns {{ ok: true, prefix: string } | { ok: false, code: string }}
 */
export function themeRootOf(paths) {
  /** @type {string[]} */
  const norm = [];
  for (const raw of paths) {
    const rel = themeRelPath(raw);
    if (!rel) return { ok: false, code: 'bad-path' };
    norm.push(rel);
  }
  if (norm.includes('theme.json')) return { ok: true, prefix: '' };
  const nested = norm.filter((p) => p.endsWith('/theme.json'));
  if (nested.length !== 1) return { ok: false, code: 'bad-json' };
  return { ok: true, prefix: nested[0].slice(0, -'theme.json'.length) };
}

/** Drop `prefix` (with its trailing slash). A file outside the folder is null. */
export function stripThemePrefix(path, prefix) {
  if (!prefix) return path;
  if (path === prefix.slice(0, -1)) return null;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/**
 * A same-origin URL for one file of an installed official pack. Null unless it stays under
 * `/assets/local/<group>/` with no query, hash, or `..`.
 * @param {string} group
 * @param {string | { path?: string } | null | undefined} entry
 */
export function officialAssetUrl(group, entry) {
  if (typeof group !== 'string' || !group || group.includes('..') || /[\\?#\s]/.test(group)) return null;
  const path = entry && typeof entry === 'object' ? entry.path : entry;
  if (typeof path !== 'string') return null;
  if (path.includes('..') || path.includes('\\') || /[?#\s\u0000]/.test(path)) return null;
  // The server serves the manifest with content-hash segments ('/assets/~<hash>/local/…', shared/assetPaths.js):
  // check the plain path, return the served one.
  const plain = splitHashedPath(path).path;
  if (!plain.startsWith('/assets/local/')) return null;
  const prefix = `/assets/local/${group}/`;
  return plain.startsWith(prefix) ? path : null;
}

/**
 * Official packs whose group lists `theme.json` at a safe URL. A lite zip with no group adds nothing.
 * @param {{ groups?: Record<string, Record<string, { path?: string }>> } | null | undefined} manifest
 */
export function installedOfficialThemes(manifest) {
  const groups = manifest?.groups;
  if (!isObj(groups)) return [];
  const out = [];
  for (const row of OFFICIAL_THEMES) {
    const group = groups[row.group];
    if (!isObj(group)) continue;
    const themeUrl = officialAssetUrl(row.group, group['theme.json']);
    if (!themeUrl) continue;
    out.push({
      id: row.id,
      group: row.group,
      name: row.name,
      description: row.description,
      themeUrl,
      thumbnailUrl: officialAssetUrl(row.group, group['thumb.webp']),
    });
  }
  return out;
}

/**
 * Pack-relative paths a manifest names, before the strict check. The official loader fetches these
 * and nothing else. Invalid paths are left out.
 * @param {Record<string, unknown> | null | undefined} doc
 * @returns {string[]}
 */
export function themePathsOf(doc) {
  if (!isObj(doc)) return [];
  /** @type {string[]} */
  const paths = [];
  const add = (raw) => {
    if (typeof raw === 'string' && raw) {
      const rel = themeRelPath(raw);
      if (rel && rel !== 'theme.json') paths.push(rel);
      return;
    }
    if (isObj(raw) && typeof raw.src === 'string') add(raw.src);
  };
  add(doc.thumbnail);
  add(doc.preview);
  if (isObj(doc.images)) for (const key of own(doc.images)) add(doc.images[key]);
  if (isObj(doc.banners)) for (const key of own(doc.banners)) add(doc.banners[key]);
  if (isObj(doc.voice)) {
    for (const key of own(doc.voice)) {
      const raw = doc.voice[key];
      const list = Array.isArray(raw) ? raw : [raw];
      for (const item of list) add(item);
    }
  }
  if (isObj(doc.character)) {
    add(doc.character.image);
    const spine = doc.character.spine;
    if (isObj(spine)) {
      add(spine.skel);
      add(spine.atlas);
      if (Array.isArray(spine.textures)) for (const tex of spine.textures) add(tex);
    }
  }
  return [...new Set(paths)];
}

/**
 * The voice line's animation, or null when this clip has no mapping (the caller keeps idle).
 * @param {{ anims?: { voice?: Record<string, string> } } | null | undefined} character
 * @param {string | null | undefined} stem clip name without the extension
 */
export function characterAnimName(character, stem) {
  const voice = character?.anims?.voice;
  if (!isObj(voice) || typeof stem !== 'string' || !stem) return null;
  const name = voice[stem.toLowerCase()];
  return typeof name === 'string' && name ? name : null;
}

/** Idle clip. [ASSUMED] `Idle`, then whatever the pack named, when the skeleton has no Idle. */
export function characterIdleName(character) {
  const idle = character?.anims?.idle;
  return typeof idle === 'string' && idle ? idle : 'Idle';
}

function cleanText(value, max, { required = false } = {}) {
  if (value == null || value === '') return required ? null : '';
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text) return required ? null : '';
  if (text.length > max || /[\u0000-\u001f\u007f]/.test(text)) return null;
  return text;
}

function sliceOf(raw) {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const nums = [];
  for (const n of raw) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > THEME_LIMITS.slice) return null;
    nums.push(n);
  }
  return nums;
}

/**
 * @param {string} jsonText
 * @returns {{ ok: true, doc: Record<string, unknown> } | { ok: false, code: string }}
 */
function parseThemeJson(jsonText) {
  if (typeof jsonText !== 'string') return { ok: false, code: 'bad-json' };
  if (utf8Size(jsonText) > THEME_LIMITS.json) return { ok: false, code: 'too-big' };
  let doc;
  try { doc = JSON.parse(jsonText); } catch { return { ok: false, code: 'bad-json' }; }
  if (!isObj(doc)) return { ok: false, code: 'bad-json' };
  if (doc.spTheme !== 1) return { ok: false, code: 'bad-version' };
  if (typeof doc.id !== 'string' || !ID_RE.test(doc.id)) return { ok: false, code: 'bad-id' };
  if (doc.id === BUILTIN_ID) return { ok: false, code: 'reserved-id' };
  if (cleanText(doc.name, THEME_LIMITS.name, { required: true }) == null) return { ok: false, code: 'name' };
  if (doc.author != null && doc.author !== '' && cleanText(doc.author, THEME_LIMITS.author) == null) return { ok: false, code: 'name' };
  if (doc.description != null && doc.description !== '' && cleanText(doc.description, THEME_LIMITS.description) == null) return { ok: false, code: 'name' };
  if (doc.version != null && doc.version !== '' && cleanText(doc.version, THEME_LIMITS.version) == null) return { ok: false, code: 'name' };
  return { ok: true, doc };
}

/**
 * Check a pack that has already been unpacked.
 * `files` are paths relative to theme.json. `measured: false` is a decoded image that failed.
 * A missing width is accepted (the caller did not decode). The browser always passes a width.
 * @param {{ jsonText: string, files?: { path: string, size: number, width?: number, height?: number, measured?: boolean }[], packBytes?: number, storedCount?: number, replace?: boolean }} input
 */
export function assessTheme(input) {
  const jsonText = input?.jsonText;
  const parsed = parseThemeJson(jsonText);
  if (!parsed.ok) return parsed;
  const doc = parsed.doc;
  const list = Array.isArray(input.files) ? input.files : [];
  if (list.length + 1 > THEME_LIMITS.files) return { ok: false, code: 'too-many-files' };
  let sum = utf8Size(jsonText);
  /** @type {Map<string, { path: string, size: number, width?: number, height?: number, measured?: boolean }>} */
  const fileMap = new Map();
  for (const file of list) {
    const rel = themeRelPath(file?.path);
    if (!rel || rel === 'theme.json') return { ok: false, code: 'bad-path' };
    const size = Number(file.size);
    if (!Number.isFinite(size) || size < 0) return { ok: false, code: 'bad-path' };
    sum += size;
    if (!fileMap.has(rel)) fileMap.set(rel, { path: rel, size, width: file.width, height: file.height, measured: file.measured });
  }
  const packBytes = Number(input.packBytes);
  if (sum > THEME_LIMITS.pack || (Number.isFinite(packBytes) && packBytes > THEME_LIMITS.pack)) return { ok: false, code: 'too-big' };
  const replace = input.replace === true;
  if (!replace && Number(input.storedCount) >= THEME_LIMITS.packs) return { ok: false, code: 'too-many-packs' };

  const used = { colors: [], tokens: [], images: [], banners: [], voice: [] };
  const unused = { colors: [], images: [], banners: [], voice: [], keys: [] };
  /** @type {{ path: string, code: string }[]} */
  const refused = [];
  const referenced = new Set();

  for (const key of own(doc)) if (!TOP_KEYS.has(key)) unused.keys.push(key);

  const colors = {};
  if (doc.colors != null && !isObj(doc.colors)) refused.push({ path: 'colors', code: 'bad-color' });
  else if (isObj(doc.colors)) {
    for (const key of own(doc.colors)) {
      const value = doc.colors[key];
      if (!COLOR_KEYS.includes(key)) { unused.colors.push(key); continue; }
      const colour = acceptColour(value);
      if (!colour) { refused.push({ path: `colors.${key}`, code: 'bad-color' }); continue; }
      if (!COLOR_VAR[key]) { unused.colors.push(key); continue; }
      colors[key] = colour;
      used.colors.push(key);
    }
  }

  const tokens = {};
  if (doc.tokens != null && !isObj(doc.tokens)) refused.push({ path: 'tokens', code: 'bad-token' });
  else if (isObj(doc.tokens)) {
    let n = 0;
    for (const key of own(doc.tokens)) {
      n += 1;
      if (n > THEME_VAR_LIMIT) { refused.push({ path: `tokens.${key}`, code: 'bad-token' }); continue; }
      const value = acceptThemeValue(key, doc.tokens[key]);
      if (!value) { refused.push({ path: `tokens.${key}`, code: 'bad-token' }); continue; }
      tokens[key] = value;
      used.tokens.push(key);
    }
  }

  /**
   * @param {string} path
   * @param {'image' | 'audio'} kind
   * @returns {{ ok: boolean, code?: string }} `code` when not ok
   */
  function takeFile(path, kind) {
    const rel = themeRelPath(path);
    if (!rel) return { ok: false, code: 'bad-path' };
    referenced.add(rel);
    const file = fileMap.get(rel);
    if (!file) return { ok: false, code: 'missing' };
    if (!(file.size > 0)) return { ok: false, code: 'missing' };
    const ext = extOf(rel);
    if (kind === 'image') {
      if (!IMAGE_EXT.has(ext)) return { ok: false, code: 'bad-type' };
      if (file.size > THEME_LIMITS.image) return { ok: false, code: 'image-too-big' };
      if (file.measured === false) return { ok: false, code: 'not-image' };
      if (file.width != null || file.height != null || file.measured === true) {
        const w = Number(file.width);
        const h = Number(file.height);
        if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1 || w > THEME_LIMITS.imageEdge || h > THEME_LIMITS.imageEdge) {
          return { ok: false, code: 'image-dim' };
        }
      }
      return { ok: true };
    }
    if (!AUDIO_EXT.has(ext)) return { ok: false, code: 'bad-type' };
    if (file.size > THEME_LIMITS.audio) return { ok: false, code: 'audio-too-big' };
    return { ok: true };
  }

  /** @type {Record<string, { path: string, slice: number[] | null }>} */
  const images = {};
  if (doc.images != null && !isObj(doc.images)) refused.push({ path: 'images', code: 'bad-type' });
  else if (isObj(doc.images)) {
    for (const key of own(doc.images)) {
      const raw = doc.images[key];
      if (raw === '') continue;
      let src = raw;
      /** @type {number[] | null} */
      let slice = null;
      if (isObj(raw)) {
        src = raw.src;
        if (raw.slice != null) {
          slice = sliceOf(raw.slice);
          if (!slice) { refused.push({ path: `images.${key}`, code: 'bad-slice' }); continue; }
        }
      }
      if (typeof src !== 'string' || src === '') { refused.push({ path: `images.${key}`, code: 'bad-type' }); continue; }
      const file = takeFile(src, 'image');
      if (!file.ok) { refused.push({ path: `images.${key}`, code: file.code }); continue; }
      if (!WIRED_SLOT.has(key)) { unused.images.push(key); continue; }
      images[key] = { path: themeRelPath(src), slice };
      used.images.push(key);
    }
  }

  let thumbnail = null;
  let preview = null;
  for (const field of ['thumbnail', 'preview']) {
    const raw = doc[field];
    if (raw == null || raw === '') continue;
    if (typeof raw !== 'string') { refused.push({ path: field, code: 'bad-type' }); continue; }
    const file = takeFile(raw, 'image');
    if (!file.ok) { refused.push({ path: field, code: file.code }); continue; }
    const rel = themeRelPath(raw);
    if (field === 'thumbnail') thumbnail = rel;
    else preview = rel;
    used.images.push(field);
  }

  /** @type {Record<string, { path: string, slice: number[] | null }>} */
  const banners = {};
  if (doc.banners != null && !isObj(doc.banners)) refused.push({ path: 'banners', code: 'bad-type' });
  else if (isObj(doc.banners)) {
    for (const key of own(doc.banners)) {
      const raw = doc.banners[key];
      if (raw === '') continue;
      let src = raw;
      /** @type {number[] | null} */
      let slice = null;
      if (isObj(raw)) {
        src = raw.src;
        if (raw.slice != null) {
          slice = sliceOf(raw.slice);
          if (!slice) { refused.push({ path: `banners.${key}`, code: 'bad-slice' }); continue; }
        }
      }
      if (typeof src !== 'string' || src === '') { refused.push({ path: `banners.${key}`, code: 'bad-type' }); continue; }
      const file = takeFile(src, 'image');
      if (!file.ok) { refused.push({ path: `banners.${key}`, code: file.code }); continue; }
      if (!WIRED_BANNER.has(key)) { unused.banners.push(key); continue; }
      banners[key] = { path: themeRelPath(src), slice };
      used.banners.push(key);
    }
  }

  /**
   * A skeleton sidecar. Not an image: pixi-spine loads the atlas beside the skel URL, so these
   * paths are checked here and played from a same-origin URL, never from a blob.
   * @param {string} path
   * @returns {{ ok: boolean, path?: string, code?: string }} `path` when ok, `code` when not
   */
  function takeSidecar(path) {
    const rel = themeRelPath(path);
    if (!rel) return { ok: false, code: 'bad-path' };
    referenced.add(rel);
    const file = fileMap.get(rel);
    if (!file || !(file.size > 0)) return { ok: false, code: 'missing' };
    if (!SPINE_EXT.has(extOf(rel))) return { ok: false, code: 'bad-type' };
    if (file.size > THEME_LIMITS.image) return { ok: false, code: 'image-too-big' };
    return { ok: true, path: rel };
  }

  /** @type {{ image?: { path: string, slice: number[] | null }, spine?: { skel: string, atlas: string, textures: string[] }, anims?: { idle?: string, voice?: Record<string, string> } } | null} */
  let character = null;
  if (doc.character != null) {
    const got = acceptCharacter(doc.character, takeFile, takeSidecar);
    if (!got.ok) refused.push({ path: 'character', code: got.code });
    else character = got.character;
  }

  /** @type {Record<string, string[]>} */
  const voice = {};
  if (doc.voice != null && !isObj(doc.voice)) refused.push({ path: 'voice', code: 'bad-voice' });
  else if (isObj(doc.voice)) {
    for (const key of own(doc.voice)) {
      const raw = doc.voice[key];
      if (raw === '') continue;
      const listRaw = Array.isArray(raw) ? raw : [raw];
      if (!Object.hasOwn(VOICE_TRIGGERS, key)) {
        unused.voice.push(key);
        for (const item of listRaw) if (typeof item === 'string' && item) takeFile(item, 'audio');
        continue;
      }
      /** @type {string[]} */
      const lines = [];
      let i = 0;
      for (const item of listRaw) {
        if (item === '') continue;
        if (typeof item !== 'string') {
          refused.push({ path: `voice.${key}[${i}]`, code: 'bad-voice' });
          i += 1;
          continue;
        }
        if (lines.length >= THEME_LIMITS.voiceLines) { refused.push({ path: `voice.${key}[${i}]`, code: 'bad-voice' }); i += 1; continue; }
        const file = takeFile(item, 'audio');
        if (!file.ok) { refused.push({ path: `voice.${key}`, code: file.code }); i += 1; continue; }
        lines.push(themeRelPath(item));
        i += 1;
      }
      if (lines.length) { voice[key] = lines; used.voice.push(key); }
    }
  }

  const ignored = [];
  for (const path of fileMap.keys()) if (!referenced.has(path)) ignored.push(path);
  ignored.sort();

  return {
    ok: true,
    id: doc.id,
    name: cleanText(doc.name, THEME_LIMITS.name, { required: true }),
    author: cleanText(doc.author, THEME_LIMITS.author) || '',
    version: cleanText(doc.version, THEME_LIMITS.version) || '',
    description: cleanText(doc.description, THEME_LIMITS.description) || '',
    colors, tokens, images, banners, voice, thumbnail, preview, character,
    used, unused, refused, ignored,
  };
}

/**
 * Optional `character`. Exactly one of `image` or `spine`. A bad object refuses that key and
 * keeps the pack. A bad `anims` value drops only `anims`.
 * @param {unknown} raw
 * @param {(path: string, kind: 'image' | 'audio') => { ok: boolean, code?: string }} takeFile
 * @param {(path: string) => { ok: boolean, path?: string, code?: string }} takeSidecar
 */
function acceptCharacter(raw, takeFile, takeSidecar) {
  if (!isObj(raw)) return { ok: false, code: 'bad-type' };
  const hasImage = raw.image != null && raw.image !== '';
  const hasSpine = raw.spine != null;
  if (hasImage === hasSpine) return { ok: false, code: 'bad-type' };
  const anims = animsOf(raw.anims);
  if (hasImage) {
    let src = raw.image;
    /** @type {number[] | null} */
    let slice = null;
    if (isObj(raw.image)) {
      src = raw.image.src;
      if (raw.image.slice != null) {
        slice = sliceOf(raw.image.slice);
        if (!slice) return { ok: false, code: 'bad-slice' };
      }
    }
    if (typeof src !== 'string' || !src) return { ok: false, code: 'bad-type' };
    const file = takeFile(src, 'image');
    if (!file.ok) return { ok: false, code: file.code };
    const character = { image: { path: themeRelPath(src), slice } };
    if (anims) character.anims = anims;
    return { ok: true, character };
  }
  const spine = raw.spine;
  if (!isObj(spine)) return { ok: false, code: 'bad-type' };
  const skel = takeSidecar(spine.skel);
  if (!skel.ok) return { ok: false, code: skel.code };
  const atlas = takeSidecar(spine.atlas);
  if (!atlas.ok) return { ok: false, code: atlas.code };
  if (!Array.isArray(spine.textures) || !spine.textures.length) return { ok: false, code: 'bad-type' };
  /** @type {string[]} */
  const textures = [];
  for (const tex of spine.textures) {
    if (typeof tex !== 'string' || !tex) return { ok: false, code: 'bad-type' };
    const file = takeFile(tex, 'image');
    if (!file.ok) return { ok: false, code: file.code };
    textures.push(themeRelPath(tex));
  }
  const character = { spine: { skel: skel.path, atlas: atlas.path, textures } };
  if (anims) character.anims = anims;
  return { ok: true, character };
}

/** @param {unknown} raw @returns {{ idle?: string, voice?: Record<string, string> } | undefined} */
function animsOf(raw) {
  if (raw == null || !isObj(raw)) return undefined;
  /** @type {{ idle?: string, voice?: Record<string, string> }} */
  const anims = {};
  if (typeof raw.idle === 'string' && raw.idle && raw.idle.length <= 64 && !/[\u0000-\u001f]/.test(raw.idle)) {
    anims.idle = raw.idle;
  }
  if (isObj(raw.voice)) {
    /** @type {Record<string, string>} */
    const voice = {};
    for (const key of own(raw.voice)) {
      const stem = key.toLowerCase();
      const name = raw.voice[key];
      if (!/^[a-z0-9][a-z0-9_-]{0,39}$/.test(stem)) continue;
      if (typeof name !== 'string' || !name || name.length > 64 || /[\u0000-\u001f]/.test(name)) continue;
      voice[stem] = name;
    }
    if (Object.keys(voice).length) anims.voice = voice;
  }
  return Object.keys(anims).length ? anims : undefined;
}

/** A blob URL safe to put inside `url("…")`. Anything else is dropped. */
export function cssUrl(url) {
  if (typeof url !== 'string' || !url.startsWith('blob:')) return null;
  if (/["\\()]/.test(url) || /[\u0000-\u001f]/.test(url)) return null;
  return `url("${url}")`;
}

/**
 * CSS custom properties for one resolved pack. `null` and the built-in pack paint nothing.
 * Image values are `url("blob:…")` only. A slot with no url is omitted, so the built-in rule stays.
 * @param {{ id?: string, builtin?: boolean, colors?: Record<string, string>, tokens?: Record<string, string>, images?: Record<string, { url?: string, slice?: number[] | null }>, banners?: Record<string, string | { url?: string, slice?: number[] | null }> } | null} pack
 */
export function themeDeclarations(pack) {
  const empty = { id: '', props: {}, slots: [], slices: [], banners: [], colors: [] };
  if (!pack || pack.builtin || typeof pack.id !== 'string' || !pack.id || pack.id === BUILTIN_ID) return empty;
  /** @type {Record<string, string>} */
  const props = {};
  const slots = [];
  const slices = [];
  const banners = [];
  const colors = [];
  for (const key of COLOR_KEYS) {
    const cssName = COLOR_VAR[key];
    const value = pack.colors?.[key];
    if (!cssName || typeof value !== 'string' || !value) continue;
    props[cssName] = value;
    colors.push(COLOR_ATTR[key]);
  }
  if (isObj(pack.tokens)) {
    for (const key of own(pack.tokens)) {
      const value = acceptThemeValue(key, pack.tokens[key]);
      if (value) props[key] = value;
    }
  }
  if (isObj(pack.images)) {
    for (const slot of WIRED_IMAGE_SLOTS) {
      const img = pack.images[slot];
      if (!img) continue;
      const url = cssUrl(img.url);
      if (!url) continue;
      props[`--sp-img-${slot}`] = url;
      slots.push(slot);
      const slice = Array.isArray(img.slice) && img.slice.length === 4 ? img.slice : (FRAME_SLOTS.has(slot) ? DEFAULT_FRAME_SLICE : null);
      if (slice) {
        props[`--sp-slice-${slot}`] = slice.join(' ');
        props[`--sp-slice-px-${slot}`] = slice.map((n) => `${n}px`).join(' ');
        props[`--sp-slice-rem-${slot}`] = sliceRem(slice);
        slices.push(slot);
      }
    }
  }
  if (isObj(pack.banners)) {
    for (const key of WIRED_BANNERS) {
      const banner = pack.banners[key];
      const url = cssUrl(typeof banner === 'string' ? banner : banner?.url);
      if (!url) continue;
      props[`--sp-banner-${key}`] = url;
      banners.push(key);
      const slice = banner && typeof banner === 'object' && Array.isArray(banner.slice) && banner.slice.length === 4 ? banner.slice : null;
      if (slice) {
        props[`--sp-slice-${key}`] = slice.join(' ');
        props[`--sp-slice-px-${key}`] = slice.map((n) => `${n}px`).join(' ');
        props[`--sp-slice-rem-${key}`] = sliceRem(slice);
        slices.push(key);
      }
    }
  }
  if (!Object.keys(props).length) return empty;
  return { id: pack.id, props, slots, slices, banners, colors };
}

/** Serialized custom properties. Empty when nothing is themed — the default look adds no text. */
export function themeStyleText(pack) {
  const decl = themeDeclarations(pack);
  const names = Object.keys(decl.props);
  if (!names.length) return '';
  return names.map((name) => `${name}:${decl.props[name]}`).join(';');
}

const appliedProps = new WeakMap();

function setList(dataset, key, list) {
  if (list.length) dataset[key] = list.join(' ');
  else delete dataset[key];
}

/**
 * Write or clear the theme on a root (`documentElement`, or a fake `{ style, dataset }` in tests).
 * @param {{ style: { setProperty: Function, removeProperty: Function }, dataset: Record<string, string> }} root
 * @param {Parameters<typeof themeDeclarations>[0]} pack
 */
export function applyThemeTo(root, pack) {
  if (!root?.style?.setProperty || !root.dataset) return;
  const prev = appliedProps.get(root) || [];
  for (const name of prev) root.style.removeProperty(name);
  const decl = themeDeclarations(pack);
  const names = Object.keys(decl.props);
  for (const name of names) root.style.setProperty(name, decl.props[name]);
  appliedProps.set(root, names);
  if (!decl.id) {
    delete root.dataset.spTheme;
    delete root.dataset.spSlot;
    delete root.dataset.spSlice;
    delete root.dataset.spBanner;
    delete root.dataset.spColor;
    return;
  }
  root.dataset.spTheme = decl.id;
  setList(root.dataset, 'spSlot', decl.slots);
  setList(root.dataset, 'spSlice', decl.slices);
  setList(root.dataset, 'spBanner', decl.banners);
  setList(root.dataset, 'spColor', decl.colors);
}

/**
 * One voice gate. `random()` is injected (the browser passes Math.random). `now` is seconds.
 * cd is checked before the roll, so a line still on cooldown does not burn a roll or move `last`.
 * A line already playing blocks an equal or worse priority (a larger number). A better line replaces it.
 * @param {{ random?: () => number, now?: () => number }} [opts]
 */
export function createVoiceGate({ random = () => 0, now = () => 0 } = {}) {
  /** @type {Map<string, number>} */
  const last = new Map();
  /** @type {{ trigger: string, priority: number } | null} */
  let playing = null;
  return {
    /**
     * @param {string} trigger
     * @param {string[]} lines
     * @returns {string | null}
     */
    request(trigger, lines) {
      const row = VOICE_TRIGGERS[trigger];
      if (!row || !Array.isArray(lines) || !lines.length) return null;
      const t = now();
      if (row.cd > 0 && last.has(trigger) && t - last.get(trigger) < row.cd) return null;
      if (playing && row.priority >= playing.priority) return null;
      const roll = random();
      if (!(roll < row.probability)) return null;
      let pick = 0;
      if (lines.length > 1) {
        const index = random();
        pick = Math.min(lines.length - 1, Math.max(0, Math.floor(index * lines.length)));
      }
      last.set(trigger, t);
      playing = { trigger, priority: row.priority };
      return lines[pick];
    },
    finish() { playing = null; },
    get playing() { return playing; },
  };
}

/**
 * Which buy line. [ASSUMED] A copy already owned speaks SAME_OPERATOR and not the tier line.
 * `ownedCopies` is the count before this purchase.
 * @param {{ tier?: number, ownedCopies?: number }} buy
 */
export function buyVoiceTrigger(buy) {
  if (Number(buy?.ownedCopies) > 0) return 'AUTOCHESS_SAME_OPERATOR';
  const tier = Number(buy?.tier);
  if (Number.isFinite(tier) && tier >= HIGH_TIER_MIN) return 'AUTOCHESS_BUY_OPERATOR_HIGH';
  return 'AUTOCHESS_BUY_OPERATOR_LOW';
}

/**
 * The rest line for a prep. Boss wins over the hidden round, which wins over LP.
 * [ASSUMED] No mark and no boss means the no-loss line (the caller decides whether a prep speaks at all).
 * @param {{ round?: number, bossRound?: number | null, hiddenRound?: number | null, lp?: number | null }} snap
 * @param {number | null} lpMark LP when the fight phase opened, before settlement deducted it
 */
export function restTrigger(snap, lpMark) {
  if (snap?.bossRound != null && snap.round === snap.bossRound) return 'AUTOCHESS_REST_BOSS';
  if (snap?.hiddenRound != null && snap.round === snap.hiddenRound) return 'AUTOCHESS_REST_HIDDEN_BOSS';
  if (lpMark != null && snap?.lp != null && snap.lp < lpMark) return 'AUTOCHESS_REST_HP_LOSS';
  return 'AUTOCHESS_REST_NO_HP_LOSS';
}

/** @param {any[] | null | undefined} bonds */
export function bondKeyOf(bonds) {
  if (!Array.isArray(bonds)) return '';
  const parts = [];
  for (const bond of bonds) {
    if (!bond || typeof bond.bondId !== 'string') continue;
    const layers = Number.isFinite(bond.layers) ? bond.layers : 0;
    parts.push(`${bond.bondId}:${layers}`);
  }
  parts.sort();
  return parts.join(',');
}

function bondMap(key) {
  const map = new Map();
  if (!key) return map;
  for (const part of key.split(',')) {
    const at = part.lastIndexOf(':');
    if (at < 0) continue;
    map.set(part.slice(0, at), Number(part.slice(at + 1)));
  }
  return map;
}

/** [ASSUMED] A bond level-up is an increase of `layers`, not of the member count. */
export function bondRaised(prevKey, nextKey) {
  const prev = bondMap(prevKey);
  const next = bondMap(nextKey);
  for (const [id, layers] of next) if (layers > (prev.get(id) ?? 0)) return true;
  return false;
}

/** @param {{ source?: string, tier?: number, slots?: { id?: string }[] } | null} offer */
export function mergeKeyOf(offer) {
  if (!offer || offer.source !== 'merge') return '';
  const slots = Array.isArray(offer.slots) ? offer.slots.map((s) => s?.id || '').join('+') : '';
  return `merge:${offer.tier ?? ''}:${slots}`;
}

/**
 * A snapshot the cue stepper can compare. Fields the caller lacks stay at a quiet default.
 * @param {Record<string, any>} view
 */
export function themeViewSnap(view) {
  return {
    phase: typeof view?.phase === 'string' ? view.phase : '',
    round: Number.isFinite(view?.round) ? view.round : 0,
    bossRound: Number.isFinite(view?.bossRound) ? view.bossRound : null,
    hiddenRound: Number.isFinite(view?.hiddenRound) ? view.hiddenRound : null,
    lp: Number.isFinite(view?.lp) ? view.lp : null,
    shopLevel: Number.isFinite(view?.shopLevel) ? view.shopLevel : null,
    frozen: view?.frozen === true,
    countdownWarn: view?.countdownWarn === true,
    bondKey: bondKeyOf(view?.bonds),
    mergeKey: mergeKeyOf(view?.rewardOffer),
  };
}

export function emptyCueState() {
  return { snap: null, lpMark: null, fought: false, started: false };
}

/**
 * Cues for one view change, best priority first (a smaller number).
 * The first snapshot speaks only when the page is already on 协议启动 (BATTLE_CHECK). Opening on 休整期 does not.
 * [ASSUMED] The rest line is the PREP of a boss or hidden round, or the first PREP after a fight. The fight's
 * LP mark is taken when COMBAT / UNITE / FINAL_ASSAULT / HIDDEN_CORE opens; settlement sits between that and
 * the next prep, so the mark is the LP from before the loss. A prep with no fight yet (round 1) is silent.
 * @param {{ snap: ReturnType<typeof themeViewSnap> | null, lpMark: number | null, fought: boolean, started: boolean } | null} state
 * @param {ReturnType<typeof themeViewSnap>} snap
 */
export function stepThemeCues(state, snap) {
  const prev = state?.snap || null;
  const next = {
    snap,
    lpMark: state?.lpMark ?? null,
    fought: state?.fought === true,
    started: state?.started === true,
  };
  /** @type {string[]} */
  const cues = [];
  if (!prev) {
    if (snap.phase === 'BATTLE_CHECK') {
      cues.push('AUTOCHESS_GAME_START');
      next.started = true;
    }
    if (COMBAT_PHASES.has(snap.phase) && snap.lp != null) {
      next.lpMark = snap.lp;
      next.fought = true;
    }
    return { state: next, cues };
  }
  if (COMBAT_PHASES.has(snap.phase) && snap.phase !== prev.phase && snap.lp != null) {
    next.lpMark = snap.lp;
    next.fought = true;
  }
  if (!next.started) {
    if (snap.phase === 'BATTLE_CHECK' && prev.phase !== 'BATTLE_CHECK') {
      cues.push('AUTOCHESS_GAME_START');
      next.started = true;
    } else if (snap.phase === 'ROUND_START' && snap.round === 1 && GAME_START_FROM.has(prev.phase)) {
      cues.push('AUTOCHESS_GAME_START');
      next.started = true;
    }
  }
  if (snap.phase === 'PREP' && prev.phase !== 'PREP') {
    const boss = snap.bossRound != null && snap.round === snap.bossRound;
    const hidden = snap.hiddenRound != null && snap.round === snap.hiddenRound;
    if (boss || hidden || next.fought) cues.push(restTrigger(snap, next.lpMark));
    next.fought = false;
  }
  if (snap.shopLevel != null && prev.shopLevel != null && snap.shopLevel > prev.shopLevel) cues.push('AUTOCHESS_SHOP_UPGRADE');
  if (snap.frozen && !prev.frozen) cues.push('AUTOCHESS_FREEZE');
  if (snap.countdownWarn && !prev.countdownWarn) cues.push('AUTOCHESS_COUNTDOWN');
  if (snap.mergeKey && snap.mergeKey !== prev.mergeKey) cues.push('AUTOCHESS_MERGE_TRIPLE');
  if (bondRaised(prev.bondKey, snap.bondKey)) cues.push('AUTOCHESS_ALLIANCE_LEVEL');
  cues.sort((a, b) => VOICE_TRIGGERS[a].priority - VOICE_TRIGGERS[b].priority);
  return { state: next, cues };
}

/** Ask the gate in priority order. A missed roll leaves the gate idle so the next cue can play. */
export function takeVoiceCues(gate, cues, linesOf) {
  /** @type {string[]} */
  const played = [];
  for (const id of cues) {
    const line = gate.request(id, linesOf(id) || []);
    if (line) played.push(line);
  }
  return played;
}
