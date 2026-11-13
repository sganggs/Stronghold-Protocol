// Regulation in-match shop chrome (卫戍协议终端). Covenant screens never call these.
// Sprites: ac_n_initial layout.json shop/panel_shop_main and shop/autochess_shop_card_item.
// [ASSUMED] Positions are the prefab sizes on the rem grid, not Unity anchors.
// [ASSUMED] The shop group is packed (level, cards, character card) and centred on the
// bottom edge. It is not a plate stretched across the screen.
// [ASSUMED] ac_n_iron sprites/bg_close.webp is a 32×25 dump (240 bytes) on the 收起 tip,
// not the character plate. That plate is sprites/btn_big_close.webp. 可露希尔's plate is
// sprites/closure_back_active.webp. A missing plate stays a CSS shape.

import { officialAssetUrl, officialThemeById } from '../../../shared/uiTheme.js';

const INITIAL_GROUP = 'themes/ac_n_initial';

/** Shop-up robot of the default theme (theme.json character, idle Idle). */
const SHOP_SPINE = Object.freeze({
  skel: 'spine/trap_1096_acshopup.json',
  atlas: 'spine/trap_1096_acshopup.atlas',
  png: 'spine/trap_1096_acshopup.png',
  idle: 'Idle',
});

const ROMAN = Object.freeze(['', 'I', 'II', 'III', 'IV', 'V', 'VI']);

/** [ASSUMED] Stretching these hides the CSS plate. See the file header. */
const PLACEHOLDER_SPRITES = Object.freeze({
  'themes/ac_n_iron': Object.freeze(['sprites/bg_close.webp']),
});

const PLATE_SPRITES = Object.freeze([
  'sprites/bg_close.webp',
  'sprites/btn_big_close.webp',
  'sprites/closure_back_active.webp',
]);

// The freeze button's states as the panel_shop_main prefabs switch them: group_lock (the shop is not frozen, it reads
// 冻结) is frozen_bg_normal; group_unlock (frozen, it reads 解冻) is frozen_bg_unselect (ac_n_initial) or
// frozen_bg_unlock (乌萨斯齐心团, 可露希尔); group_disable is bg_lock or frozen_bg_disable.
const CHROME_SPRITES = Object.freeze({
  refresh: Object.freeze(['sprites/refresh_bg_normal.webp']),
  refreshLock: Object.freeze(['sprites/bg_lock.webp', 'sprites/refresh_bg_lock.webp', 'sprites/refresh_bg_disable.webp']),
  frozen: Object.freeze(['sprites/frozen_bg_normal.webp']),
  frozenOn: Object.freeze(['sprites/frozen_bg_unselect.webp', 'sprites/frozen_bg_unlock.webp']),
  frozenLock: Object.freeze(['sprites/bg_lock.webp', 'sprites/frozen_bg_disable.webp']),
  money: Object.freeze(['sprites/bg_money.webp']),
  costFree: Object.freeze(['sprites/cost_free.webp']),
});
// Button icons that are their own prefab images. A pack without them has the icon in the plate (乌萨斯齐心团 both
// buttons, 可露希尔 freeze), so these never fall back to another pack.
const ICON_SPRITES = Object.freeze({
  refreshIcon: 'sprites/refresh_icon.webp',
  refreshIconBg: 'sprites/refresh_icon_bg.webp',
  frozenIcon: 'sprites/frozen_icon.webp',
  frozenIconOn: 'sprites/frozen_icon2.webp',
});

/** @param {any} config */
export function regulationFamily(config) {
  return config?.version?.family === 'regulation';
}

/**
 * The regulation card face, or null for every other family (盟约 keeps today's card).
 * @param {string|null|undefined} family
 * @param {{ tier?: number, price?: number, free?: boolean, poor?: boolean, name?: string, bonds?: string[] }} card
 */
export function regCardModel(family, card) {
  if (family !== 'regulation') return null;
  const tier = Math.min(6, Math.max(1, Number(card?.tier) || 1));
  const price = Number(card?.price) || 0;
  const free = !!card?.free || price === 0;
  const bonds = Array.isArray(card?.bonds) ? card.bonds.filter((id) => typeof id === 'string' && id).slice(0, 3) : [];
  return {
    tier,
    numeral: ROMAN[tier],
    cost: free ? { kind: 'free' } : { kind: 'pill', price, poor: !!card?.poor },
    name: typeof card?.name === 'string' ? card.name : '',
    bonds,
  };
}

function placeholder(group, name) {
  const list = PLACEHOLDER_SPRITES[group];
  return !!list && list.includes(name);
}

/** [ASSUMED] A recorded width or height under 48px is a dump tip, not a plate (iron bg_close is 32×25). */
function tooSmall(entry) {
  const w = Number(entry?.w);
  const h = Number(entry?.h);
  return Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 && (w < 48 || h < 48);
}

function groupUrl(groups, group, name) {
  if (!group || !name || placeholder(group, name)) return '';
  const entry = groups && groups[group] ? groups[group][name] : null;
  if (!entry || tooSmall(entry)) return '';
  return officialAssetUrl(group, entry) || '';
}

function chainOf(themeId) {
  const theme = officialThemeById(themeId);
  const primary = theme?.group || INITIAL_GROUP;
  return primary === INITIAL_GROUP ? [INITIAL_GROUP] : [primary, INITIAL_GROUP];
}

/** Only the active pack (no ac_n_initial fallback). */
function pickOwn(groups, themeId, name) {
  return groupUrl(groups, chainOf(themeId)[0], name);
}

/**
 * The official pack whose shop chrome is drawn: the selected official theme when installed, else ac_n_initial when
 * installed, else '' (the CSS shapes). Its prefab decides where the button words and icons sit (css data-reg-theme).
 * @param {Record<string, Record<string, { path?: string }>>|null|undefined} groups
 * @param {string|null|undefined} themeId
 */
export function regChromeTheme(groups, themeId) {
  const has = (group) => !!(groups && groups[group] && Object.keys(groups[group]).length);
  const theme = officialThemeById(themeId);
  if (theme?.group && has(theme.group)) return theme.group.replace(/^themes\//, '');
  return has(INITIAL_GROUP) ? INITIAL_GROUP.replace(/^themes\//, '') : '';
}

function pickSprite(groups, themeId, names) {
  for (const group of chainOf(themeId)) {
    for (const name of names) {
      const url = groupUrl(groups, group, name);
      if (url) return url;
    }
  }
  return '';
}

/**
 * Served chrome URLs for the regulation shop. Empty string: the CSS shape.
 * The active official pack wins, then ac_n_initial, then nothing (lite zip).
 * @param {Record<string, Record<string, { path?: string }>>|null|undefined} groups
 * @param {{ themeId?: string|null }} [opts]
 */
export function regChromeUrls(groups, opts = {}) {
  const themeId = opts?.themeId;
  return {
    refresh: pickSprite(groups, themeId, CHROME_SPRITES.refresh),
    refreshLock: pickSprite(groups, themeId, CHROME_SPRITES.refreshLock),
    frozen: pickSprite(groups, themeId, CHROME_SPRITES.frozen),
    frozenOn: pickSprite(groups, themeId, CHROME_SPRITES.frozenOn),
    frozenLock: pickSprite(groups, themeId, CHROME_SPRITES.frozenLock),
    refreshIcon: pickOwn(groups, themeId, ICON_SPRITES.refreshIcon),
    refreshIconBg: pickOwn(groups, themeId, ICON_SPRITES.refreshIconBg),
    frozenIcon: pickOwn(groups, themeId, ICON_SPRITES.frozenIcon),
    frozenIconOn: pickOwn(groups, themeId, ICON_SPRITES.frozenIconOn),
    char: pickSprite(groups, themeId, PLATE_SPRITES),
    money: pickSprite(groups, themeId, CHROME_SPRITES.money),
    costFree: pickSprite(groups, themeId, CHROME_SPRITES.costFree),
  };
}

// ---- 升级 (the upgrade button) -----------------------------------------------------------------------------------------
// Each pack's panel_shop_main group_upgrade, drawn layer by layer. A rect [x, y, w, h] is the prefab's, x right / y up
// from the centre of the 112×190 group, in prefab units (1rem = 100); in ac_n_initial group_normal sits 1 unit lower and
// its layers carry that offset. The states are the prefab's groups: `normal` (the upgrade can be bought; `on: 'armed'`
// layers are its root_double_check, shown after the first tap, `on: 'idle'` the ones they replace), `disable` (funds
// short, or not the shop phase) and `max` (level 6). The level is ac_n_initial's text_num (a Roman numeral, as the theme
// previews draw it) or 乌萨斯齐心团's / 可露希尔's upgrade_lv_N image in the prefab's img_num colour. A white sprite under a
// colour (the prefab's image colour) is that colour through the sprite's mask. The price is the prefab's root_cost.
// The shop_level_N sprites are not part of it: they are player_detail_shop_level_hub (the player detail panel).
// [ASSUMED] The prefab's clips (double-check in / out, loop line, level-up fx) are drawn at their end state: the
// root_double_check layers at full alpha, nothing looping. 可露希尔's inner_flow texture is not in the dump: a gradient
// stands in for the cloud at the bottom of its screen. 乌萨斯齐心团's double-check arrows (animated inside a 66×68 mask)
// and 可露希尔's star fill (no sprite) are left out. With no pack installed the same layout is drawn in CSS colours.
// [ASSUMED] ac_n_initial's numeral font is not ours: Novecento Wide, thickened and spaced (css), at 45 with the rect 1.5
// units under text_num's matches the theme preview's glyph (34 units tall, bars about 8 wide and 8 apart, centre at y 11.5).
const UP_INITIAL = Object.freeze({
  need: ['frame_matte', 'upgrade_disable', 'upgrade_max'],
  cost: 80,
  normal: Object.freeze([
    { fill: '#107463', r: [0, -1, 112, 188] },
    { s: 'repeat_line', r: [0, -1, 112, 188], tile: 18, a: 0.6 },
    { s: 'deco_up', r: [0, 64, 49, 6], a: 0.5 },
    { s: 'deco_down', r: [-1, -84, 95, 10], a: 0.5 },
    { s: 'stripe_line', r: [0, -1, 112, 188], a: 0.23 },
    { s: 'frame_matte', r: [0, 9, 101, 85] },
    { s: 'icon', r: [1, 15.3, 60, 61], tint: 'rgba(2, 5, 5, .3)' },
    { s: 'frame', r: [0, 14.8, 97, 85.4] },
    // the 45×10 「LEVEL」 (the dump names it level_2: level.webp is the folded shop's 91×85 plate)
    { s: 'level_2', r: [1, 40, 45, 10] },
    { s: 'frame_glow', r: [0, 15, 104, 88], slice: 20 },
    { s: 'check_grad', r: [0, -27, 111, 136], on: 'armed' },
    { s: 'check_frame', r: [0, -1, 111, 188], on: 'armed' },
    { s: 'check_arrow', r: [0, -40, 20, 11], tint: '#4cd4b3', on: 'armed' },
    { num: 'text', r: [-1, 15.5, 84, 52], size: 45, color: '#57e8cb' },
    { tip: 'tip', r: [0, -45, 100, 30], size: 20, color: '#6eecd2', on: 'idle' },
    { tip: 'confirm', r: [0, -58, 100, 30], size: 20, color: '#d6fff6', on: 'armed' },
  ]),
  disable: Object.freeze([
    { s: 'upgrade_disable', r: [0, 0, 112, 189] },
    { num: 'text', r: [-1, 15.5, 84, 52], size: 45, color: '#a0a0a0' },
    { tip: 'tip', r: [0, -44, 100, 30], size: 20, color: '#a0a0a0' },
  ]),
  max: Object.freeze([
    { s: 'upgrade_max', r: [0, 0, 111, 189] },
    { num: 'text', r: [-1, 15.5, 84, 52], size: 45, color: '#679a90' },
    { tip: 'max', r: [0, -44, 100, 30], size: 20, color: '#679a90' },
  ]),
});
const UP_IRON = Object.freeze({
  need: ['upgrade_normal', 'upgrade_disable', 'upgrade_max', 'upgrade_lv_1'],
  cost: 85,
  normal: Object.freeze([
    { s: 'upgrade_normal', r: [-6.8, 0, 136, 205] },
    { s: 'level_normal', r: [0, 68, 85, 25] },
    { s: 'frame1_normal', r: [0, 19.5, 73, 80] },
    { s: 'frame2_normal', r: [0, -40.1, 89, 41] },
    { s: 'glow_certain', r: [0, 9.7, 87, 149], on: 'armed' },
    { s: 'level_certain', r: [0, 68, 85, 25], on: 'armed' },
    { s: 'frame1_certain', r: [0, 19.5, 73, 80], on: 'armed' },
    { s: 'frame2_certain', r: [0, -40.1, 89, 41], on: 'armed' },
    { num: 'img', s: 'upgrade_lv_', r: [0, 20, 68, 44], color: '#b8e1d6' },
    { tip: 'tip', r: [0, -40.33, 62, 30], size: 16, color: '#caf7eb', on: 'idle' },
    { tip: 'confirm', r: [0, -40.33, 62, 30], size: 15, color: '#ffffff', on: 'armed' },
  ]),
  disable: Object.freeze([
    { s: 'upgrade_disable', r: [-6.8, 0, 136, 205] },
    { num: 'img', s: 'upgrade_lv_', r: [0, 20, 68, 44], color: '#e3e3e3' },
    { tip: 'tip', r: [0, -40.33, 62, 30], size: 16, color: '#8a8a8a' },
  ]),
  max: Object.freeze([
    { s: 'upgrade_max', r: [-6.8, 0, 136, 205] },
    { num: 'img', s: 'upgrade_lv_', r: [0, 20, 68, 44], color: '#809e96' },
    { tip: 'max', r: [0, -40.33, 62, 30], size: 16, color: '#caf7eb' },
  ]),
});
const UP_CLOSURE = Object.freeze({
  need: ['inner_bg', 'upgrade_disable', 'upgrade_max', 'upgrade_lv_1'],
  cost: 80,
  normal: Object.freeze([
    { s: 'upgrade_deco_top', r: [-36.5, 97.7, 14, 14] },
    { s: 'upgrade_bg_outline_glow', r: [0.8, -2.96, 128.5, 200.6] },
    // upgrade_bg is a white 16×16 rounded square sliced 8 px (corner radius 4) under #BFBFBF
    { fill: '#bfbfbf', radius: 4, r: [-1, -2, 112, 188] },
    { s: 'upgrade_bg_outline', r: [-1, -2, 112, 188], tint: '#4346b9' },
    { s: 'upgrade_deco_bar', r: [-2, -42, 91, 27], tint: 'rgba(17, 22, 115, .2)' },
    { s: 'upgrade_bottom_glow', r: [-1, -63.5, 112, 65] },
    { s: 'upgrade_deco_bottom', r: [0, -79, 99, 27], on: 'idle' },
    { s: 'upgrade_bottom_glow2', r: [-1, -35, 112, 122], on: 'armed' },
    { s: 'upgrade_deco_bottom2', r: [0, -74, 57, 21], on: 'armed' },
    { s: 'doublecheck_arrow', r: [-1, -27, 14, 7], on: 'armed' },
    { s: 'inner_bg_glow', r: [-0.3, 27.7, 124, 116], a: 0.25 },
    { s: 'inner_bg', r: [-0.3, 27.7, 96, 92] },
    { grad: 'linear-gradient(180deg, transparent 46%, rgba(125, 172, 255, .5) 64%, rgba(247, 247, 247, .92) 84%)', r: [0, 28.85, 93, 89.7] },
    { num: 'img', s: 'upgrade_lv_', r: [0, 19, 53, 56], color: '#080808' },
    { s: 'upgrade_level', r: [5.7, 47.7, 64, 32] },
    { s: 'upgrade_arrow_left', r: [-28.5, 28, 36, 32] },
    { s: 'upgrade_arrow_left', r: [28.5, 28, 36, 32], flip: 'x' },
    { s: 'inner_deco', r: [0, -12, 31, 4] },
    { s: 'img_fx_star_outline', r: [33.8, 61.3, 39.2, 39.2], tint: '#f8b0d1' },
    { tip: 'tip', r: [-2, -42, 76, 30], size: 19, color: '#ffffff', on: 'idle' },
    { tip: 'confirm', r: [-2, -42, 76, 27], size: 16, color: '#ffffff', on: 'armed' },
    { s: 'upgrade_deco_front', r: [-44.3, -76.3, 32, 36] },
  ]),
  disable: Object.freeze([
    { s: 'upgrade_disable', r: [0, 0, 129, 209] },
    { num: 'img', s: 'upgrade_lv_', r: [0, 19, 53, 56], color: '#080808' },
    { tip: 'tip', r: [-2, -41, 76, 30], size: 19, color: '#a0a0a0' },
  ]),
  max: Object.freeze([
    { s: 'upgrade_max', r: [0, 0, 129, 209] },
    { num: 'img', s: 'upgrade_lv_', r: [0, 19, 53, 56], color: '#080808' },
    { tip: 'max', r: [0, -41, 76, 30], size: 19, color: '#ffffff' },
  ]),
});
/** No pack installed (lite zip): ac_n_initial's layout in CSS colours. */
const UP_CSS = Object.freeze({
  need: [],
  cost: 80,
  normal: Object.freeze([
    { fill: '#107463', r: [0, -1, 112, 188] },
    { grad: 'repeating-linear-gradient(135deg, rgba(255, 255, 255, .06) 0 .02rem, transparent .02rem .06rem)', r: [0, -1, 112, 188] },
    { fill: '#0d1f1c', r: [0, 9, 101, 85] },
    { line: 'rgba(87, 232, 203, .9)', r: [0, 15, 100, 84] },
    { text: 'LEVEL', r: [1, 40, 70, 14], size: 12, color: '#57e8cb' },
    { line: '#ffffff', r: [0, -1, 111, 188], on: 'armed' },
    { num: 'text', r: [-1, 15.5, 84, 52], size: 45, color: '#57e8cb' },
    { tip: 'tip', r: [0, -45, 100, 30], size: 20, color: '#6eecd2', on: 'idle' },
    { tip: 'confirm', r: [0, -58, 100, 30], size: 20, color: '#d6fff6', on: 'armed' },
  ]),
  disable: Object.freeze([
    { fill: '#4a4f4e', r: [0, 0, 112, 189] },
    { fill: '#2b2f2e', r: [0, 9, 101, 85] },
    { line: 'rgba(160, 160, 160, .6)', r: [0, 15, 100, 84] },
    { text: 'LEVEL', r: [1, 40, 70, 14], size: 12, color: '#a0a0a0' },
    { num: 'text', r: [-1, 15.5, 84, 52], size: 45, color: '#a0a0a0' },
    { tip: 'tip', r: [0, -44, 100, 30], size: 20, color: '#a0a0a0' },
  ]),
  max: Object.freeze([
    { fill: '#0f3b35', r: [0, 0, 112, 189] },
    { fill: '#0b1d1a', r: [0, 9, 101, 85] },
    { line: 'rgba(103, 154, 144, .8)', r: [0, 15, 100, 84] },
    { text: 'LEVEL', r: [1, 40, 70, 14], size: 12, color: '#679a90' },
    { num: 'text', r: [-1, 15.5, 84, 52], size: 45, color: '#679a90' },
    { tip: 'max', r: [0, -44, 100, 30], size: 20, color: '#679a90' },
  ]),
});
const UPGRADE = Object.freeze({ ac_n_initial: UP_INITIAL, ac_n_iron: UP_IRON, ac_s_closur: UP_CLOSURE });

/** Prefab units → rem (100 units = 1rem). */
const upRem = (n) => `${Number((n / 100).toFixed(4))}rem`;

/** A prefab rect → its box in the 112×190 group (top-left origin). */
function upBox([x, y, w, h]) {
  return { left: upRem(56 + x - w / 2), top: upRem(95 - y - h / 2), width: upRem(w), height: upRem(h) };
}

/** A white sprite under a colour: the colour through the sprite's mask. */
function upTint(url, color) {
  return {
    backgroundColor: color,
    WebkitMaskImage: url, maskImage: url,
    WebkitMaskSize: '100% 100%', maskSize: '100% 100%',
    WebkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
  };
}

/** A sprite of one pack, any size (the upgrade parts are small: no tooSmall filter). */
function packSprite(groups, packId, name) {
  if (!packId || !name) return '';
  const group = `themes/${packId}`;
  const entry = groups && groups[group] ? groups[group][`sprites/${name}.webp`] : null;
  return entry ? officialAssetUrl(group, entry) || '' : '';
}

/**
 * The 升级 button's parts: ordered layers (sprite, colour or gradient boxes), the level numeral and the caption, each
 * with its inline style (left / top / width / height in rem inside the 1.12×1.9rem group). Sprites come from the drawn
 * pack only (regChromeTheme); a pack without its upgrade sprites is drawn in CSS colours like no pack at all.
 * @param {Record<string, Record<string, { path?: string }>>|null|undefined} groups
 * @param {string|null|undefined} themeId the selected UI theme (settings.uiTheme)
 * @param {{ level?: number, state?: string, armed?: boolean }} [opts] state: 'normal' | 'disable' | 'max'
 * @returns {{ theme: string, cost: string, parts: Array<{ kind: string, style: Record<string, string>, text?: string, tip?: string }> }}
 */
export function regUpgradeModel(groups, themeId, opts = {}) {
  const lv = Math.min(6, Math.max(1, Math.round(Number(opts?.level) || 1)));
  const state = opts?.state === 'disable' || opts?.state === 'max' ? opts.state : 'normal';
  const armed = state === 'normal' && !!opts?.armed;
  const packId = regChromeTheme(groups, themeId);
  const pack = UPGRADE[packId];
  const theme = pack && pack.need.every((name) => packSprite(groups, packId, name)) ? packId : 'css';
  const spec = theme === 'css' ? UP_CSS : pack;
  const url = (name) => (theme === 'css' ? '' : regCssUrl(packSprite(groups, packId, name)));
  const parts = [];
  for (const e of spec[state]) {
    if ((e.on === 'armed' && !armed) || (e.on === 'idle' && armed)) continue;
    const box = upBox(e.r);
    if (e.tip || e.text || e.num === 'text') {
      const text = e.num ? ROMAN[lv] : e.text;
      parts.push({ kind: e.tip ? 'tip' : e.num ? 'num' : 'text', ...(e.tip ? { tip: e.tip } : { text }), style: { ...box, color: e.color, fontSize: upRem(e.size) } });
      continue;
    }
    if (e.num === 'img') {
      const src = url(`${e.s}${lv}`);
      if (src) parts.push({ kind: 'num', style: { ...box, ...upTint(src, e.color) } });
      continue;
    }
    if (e.fill) { parts.push({ kind: 'layer', style: { ...box, backgroundColor: e.fill, ...(e.radius ? { borderRadius: upRem(e.radius) } : {}) } }); continue; }
    if (e.grad) { parts.push({ kind: 'layer', style: { ...box, backgroundImage: e.grad } }); continue; }
    if (e.line) { parts.push({ kind: 'layer', style: { ...box, border: `${upRem(2)} solid ${e.line}` } }); continue; }
    const src = url(e.s);
    if (!src) continue;
    /** @type {Record<string, string>} */
    const look = e.tint ? upTint(src, e.tint)
      : e.slice ? { borderStyle: 'solid', borderWidth: upRem(e.slice), borderImage: `${src} ${e.slice} fill / ${upRem(e.slice)} stretch` }
        : e.tile ? { backgroundImage: src, backgroundRepeat: 'repeat', backgroundSize: `${upRem(e.tile)} ${upRem(e.tile)}` }
          : { backgroundImage: src };
    if (e.a != null) look.opacity = String(e.a);
    if (e.flip === 'x') look.transform = 'scaleX(-1)';
    parts.push({ kind: 'layer', style: { ...box, ...look } });
  }
  return { theme, cost: upRem(95 - spec.cost), parts };
}

/** A CSS url() value, or '' when the string could break out of the declaration. */
export function regCssUrl(url) {
  if (typeof url !== 'string' || !url) return '';
  if (/["'\\()\s\u0000-\u001f]/.test(url)) return '';
  return `url("${url}")`;
}

/** Custom properties for the regulation shop. Never an inline background-image (a theme slot must be able to win). */
export function regChromeStyle(urls) {
  const style = {};
  const put = (name, url) => {
    const value = regCssUrl(url);
    if (value) style[name] = value;
  };
  if (!urls) return style;
  put('--reg-refresh', urls.refresh);
  put('--reg-refresh-lock', urls.refreshLock);
  put('--reg-frozen', urls.frozen);
  put('--reg-frozen-on', urls.frozenOn);
  put('--reg-frozen-lock', urls.frozenLock);
  put('--reg-refresh-icon', urls.refreshIcon);
  put('--reg-refresh-icon-bg', urls.refreshIconBg);
  put('--reg-frozen-icon', urls.frozenIcon);
  put('--reg-frozen-icon-on', urls.frozenIconOn);
  // A plate drawn from a sprite has no colour box behind it (pill and shadow edges stay transparent).
  if (style['--reg-refresh']) style['--reg-refresh-bg'] = 'transparent';
  if (style['--reg-frozen']) style['--reg-frozen-bg'] = 'transparent';
  put('--reg-char', urls.char);
  put('--reg-money', urls.money);
  put('--reg-cost-free', urls.costFree);
  return style;
}

/**
 * Character drawn in the regulation funds card.
 * A selected theme's character wins. Otherwise the default shop-up spine when that
 * pack is installed. Null keeps the plate without a portrait (lite zip).
 * @param {Record<string, Record<string, { path?: string }>>|null|undefined} groups
 * @param {{ imageUrl?: string, spine?: { skel?: string } }|null|undefined} themeCharacter
 */
export function regulationCharacter(groups, themeCharacter) {
  if (themeCharacter?.imageUrl || themeCharacter?.spine?.skel) return themeCharacter;
  const skel = groupUrl(groups, INITIAL_GROUP, SHOP_SPINE.skel);
  const atlas = groupUrl(groups, INITIAL_GROUP, SHOP_SPINE.atlas);
  const png = groupUrl(groups, INITIAL_GROUP, SHOP_SPINE.png);
  if (!skel || !atlas || !png) return null;
  return {
    spine: { skel, atlas, textures: [png] },
    anims: { idle: SHOP_SPINE.idle },
  };
}
