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

const CHROME_SPRITES = Object.freeze({
  refresh: Object.freeze(['sprites/refresh_bg_normal.webp']),
  refreshLock: Object.freeze(['sprites/bg_lock.webp', 'sprites/refresh_bg_lock.webp', 'sprites/refresh_bg_disable.webp']),
  frozen: Object.freeze(['sprites/frozen_bg_normal.webp']),
  frozenOff: Object.freeze(['sprites/frozen_bg_unselect.webp', 'sprites/frozen_bg_unlock.webp', 'sprites/frozen_bg_disable.webp']),
  money: Object.freeze(['sprites/bg_money.webp']),
  costFree: Object.freeze(['sprites/cost_free.webp']),
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
  const level = {};
  for (let n = 1; n <= 6; n += 1) level[n] = pickSprite(groups, themeId, [`sprites/shop_level_${n}.webp`]);
  return {
    refresh: pickSprite(groups, themeId, CHROME_SPRITES.refresh),
    refreshLock: pickSprite(groups, themeId, CHROME_SPRITES.refreshLock),
    frozen: pickSprite(groups, themeId, CHROME_SPRITES.frozen),
    frozenOff: pickSprite(groups, themeId, CHROME_SPRITES.frozenOff),
    char: pickSprite(groups, themeId, PLATE_SPRITES),
    money: pickSprite(groups, themeId, CHROME_SPRITES.money),
    costFree: pickSprite(groups, themeId, CHROME_SPRITES.costFree),
    level,
  };
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
  put('--reg-frozen-off', urls.frozenOff);
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
