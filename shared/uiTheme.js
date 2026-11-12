// shared/uiTheme.js — a local interface theme pack (spTheme 1). Plain ESM: no Node APIs, no DOM, no Math.random.
// The browser (public/js/uiTheme.js) reads the zip, decodes images and stores the pack. This file checks the
// manifest, picks a voice line and names the CSS variables. Nothing here fetches a URL.
//
// Official rows: activity_table.json autoChessData (规程 act3autochess, season-independent):
// skinColorDataDict, skinEffectPreviewDict, skinVoiceTriggerDataDict, skinConsts.defaultAutoChessSkinId
// ac_n_initial 「卫戍协议终端」. The cd unit and "lower priority wins" are not in that table — see VOICE_TRIGGERS.

import { acceptColour, acceptThemeValue, THEME_VAR_LIMIT } from './plugins/theme.js';

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
  'bond_strip', 'detail_panel',
]);

/** Official names with no element here. Accepted and reported unused. */
export const UNWIRED_IMAGE_SLOTS = Object.freeze([
  'img_check_buff_back', 'img_check_buff_normal', 'img_check_buff_count',
  'char_spine_outer', 'win_streak', 'effect_choose_group_tip',
  'img_shop_sell_equip_normal', 'img_shop_sell_equip_hover',
]);

const WIRED_SLOT = new Set(WIRED_IMAGE_SLOTS);

/** Chess frames are 9-slice. [ASSUMED] A frame with no slice uses 8px so the card centre stays empty. */
const FRAME_SLOTS = new Set(['chess_frame_normal', 'chess_frame_level_five', 'chess_frame_level_six']);
const DEFAULT_FRAME_SLICE = Object.freeze([8, 8, 8, 8]);

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
  'colors', 'tokens', 'images', 'banners', 'voice',
]);

const COMBAT_PHASES = new Set(['COMBAT', 'UNITE', 'FINAL_ASSAULT', 'HIDDEN_CORE']);
const GAME_START_FROM = new Set(['INFO_CHECK', 'BAND_DRAFT', 'CUSTOM_CHECK', 'BATTLE_CHECK']);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const own = (obj) => Object.keys(obj).filter((k) => Object.hasOwn(obj, k) && k !== '__proto__' && k !== 'constructor' && k !== 'prototype');

function utf8Size(text) {
  return new TextEncoder().encode(text).length;
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
   * @returns {{ ok: true } | { ok: false, code: string }}
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

  /** @type {Record<string, string>} */
  const banners = {};
  if (doc.banners != null && !isObj(doc.banners)) refused.push({ path: 'banners', code: 'bad-type' });
  else if (isObj(doc.banners)) {
    for (const key of own(doc.banners)) {
      const raw = doc.banners[key];
      if (raw === '') continue;
      if (typeof raw !== 'string') { refused.push({ path: `banners.${key}`, code: 'bad-type' }); continue; }
      const file = takeFile(raw, 'image');
      if (!file.ok) { refused.push({ path: `banners.${key}`, code: file.code }); continue; }
      if (!WIRED_BANNER.has(key)) { unused.banners.push(key); continue; }
      banners[key] = themeRelPath(raw);
      used.banners.push(key);
    }
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
    colors, tokens, images, banners, voice, thumbnail, preview,
    used, unused, refused, ignored,
  };
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
 * @param {{ id?: string, builtin?: boolean, colors?: Record<string, string>, tokens?: Record<string, string>, images?: Record<string, { url?: string, slice?: number[] | null }>, banners?: Record<string, string> } | null} pack
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
        slices.push(slot);
      }
    }
  }
  if (isObj(pack.banners)) {
    for (const key of WIRED_BANNERS) {
      const url = cssUrl(pack.banners[key]);
      if (!url) continue;
      props[`--sp-banner-${key}`] = url;
      banners.push(key);
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
