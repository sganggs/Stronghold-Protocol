// 规程 in-match HUD: the family switch and the card face. 盟约 cards stay on the hexagon price.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  regulationFamily, regCardModel, regChromeUrls, regCssUrl, regChromeStyle, regulationCharacter, regChromeTheme,
} from '../../public/js/ui/regHud.js';

globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
const { ChessCard, ItemCard } = await import('../../public/js/ui/shopBar.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

function group(id, names) {
  const entries = {};
  for (const name of names) entries[name] = { path: `/assets/local/themes/${id}/${name}` };
  return entries;
}

const INITIAL_FILES = [
  'sprites/refresh_bg_normal.webp', 'sprites/bg_lock.webp', 'sprites/frozen_bg_normal.webp',
  'sprites/frozen_bg_unselect.webp', 'sprites/bg_close.webp', 'sprites/bg_money.webp',
  'sprites/cost_free.webp', 'sprites/shop_level_1.webp', 'sprites/refresh_icon.webp', 'sprites/frozen_icon.webp',
  'sprites/frozen_icon2.webp',
  'spine/trap_1096_acshopup.json', 'spine/trap_1096_acshopup.atlas', 'spine/trap_1096_acshopup.png',
];

test('regulationFamily is only the regulation config', () => {
  assert.equal(regulationFamily({ version: { family: 'regulation' } }), true);
  assert.equal(regulationFamily({ version: { family: 'covenant' } }), false);
  assert.equal(regulationFamily({ version: { id: 'act2autochess@V2_1' } }), false);
  assert.equal(regulationFamily({}), false);
  assert.equal(regulationFamily(null), false);
  assert.equal(regulationFamily(undefined), false);
});

test('regCardModel is null outside 规程 and describes the official face inside it', () => {
  assert.equal(regCardModel('covenant', { tier: 3, price: 2, name: '能天使' }), null);
  assert.equal(regCardModel(undefined, { tier: 3, price: 2 }), null);
  const card = regCardModel('regulation', {
    tier: 5, price: 4, poor: true, name: '银灰', bonds: ['yanShip', 'miraShip', 'soloShip', 'extra'],
  });
  assert.deepEqual(card, {
    tier: 5,
    numeral: 'V',
    cost: { kind: 'pill', price: 4, poor: true },
    name: '银灰',
    bonds: ['yanShip', 'miraShip', 'soloShip'],
  });
  assert.deepEqual(regCardModel('regulation', { tier: 9, price: 0, name: '免费' }).cost, { kind: 'free' });
  assert.equal(regCardModel('regulation', { free: true, price: 3, tier: 1 }).cost.kind, 'free');
  assert.equal(regCardModel('regulation', { tier: 0 }).tier, 1);
  assert.equal(regCardModel('regulation', {}).numeral, 'I');
  assert.deepEqual(regCardModel('regulation', { bonds: [1, 'yanShip'] }).bonds, ['yanShip']);
});

test('chrome sprites prefer the active official pack, then ac_n_initial, and skip the iron tip placeholder; the freeze states follow the prefab', () => {
  const groups = {
    'themes/ac_n_initial': group('ac_n_initial', INITIAL_FILES),
    'themes/ac_n_iron': group('ac_n_iron', [
      'sprites/bg_close.webp', 'sprites/btn_big_close.webp', 'sprites/refresh_bg_normal.webp',
      'sprites/frozen_bg_normal.webp', 'sprites/frozen_bg_unlock.webp', 'sprites/shop_level_3.webp',
    ]),
    'themes/ac_s_closur': group('ac_s_closur', [
      'sprites/closure_back_active.webp', 'sprites/refresh_bg_normal.webp', 'sprites/frozen_bg_unlock.webp',
      'sprites/frozen_bg_disable.webp', 'sprites/refresh_icon.webp', 'sprites/refresh_icon_bg.webp',
    ]),
  };
  const initial = regChromeUrls(groups, {});
  assert.equal(initial.refresh, '/assets/local/themes/ac_n_initial/sprites/refresh_bg_normal.webp');
  assert.equal(initial.char, '/assets/local/themes/ac_n_initial/sprites/bg_close.webp');
  // not frozen (reads 冻结) = frozen_bg_normal; frozen (解冻) = frozen_bg_unselect; unavailable = bg_lock
  assert.equal(initial.frozen, '/assets/local/themes/ac_n_initial/sprites/frozen_bg_normal.webp');
  assert.equal(initial.frozenOn, '/assets/local/themes/ac_n_initial/sprites/frozen_bg_unselect.webp');
  assert.equal(initial.frozenLock, '/assets/local/themes/ac_n_initial/sprites/bg_lock.webp');
  assert.equal(initial.refreshIcon, '/assets/local/themes/ac_n_initial/sprites/refresh_icon.webp');
  assert.equal(initial.frozenIconOn, '/assets/local/themes/ac_n_initial/sprites/frozen_icon2.webp');
  assert.equal(initial.money, '/assets/local/themes/ac_n_initial/sprites/bg_money.webp');
  assert.equal(initial.level[1], '/assets/local/themes/ac_n_initial/sprites/shop_level_1.webp');
  assert.equal(initial.level[2], '');

  const iron = regChromeUrls(groups, { themeId: 'ac_n_iron' });
  assert.equal(iron.char, '/assets/local/themes/ac_n_iron/sprites/btn_big_close.webp');
  assert.equal(iron.refresh, '/assets/local/themes/ac_n_iron/sprites/refresh_bg_normal.webp');
  assert.equal(iron.frozen, '/assets/local/themes/ac_n_iron/sprites/frozen_bg_normal.webp');
  assert.equal(iron.frozenOn, '/assets/local/themes/ac_n_iron/sprites/frozen_bg_unlock.webp');
  // the iron plates carry their icons: no ac_n_initial icon is borrowed
  assert.equal(iron.refreshIcon, '');
  assert.equal(iron.frozenIcon, '');
  assert.equal(iron.money, '/assets/local/themes/ac_n_initial/sprites/bg_money.webp');
  assert.equal(iron.refreshLock, '/assets/local/themes/ac_n_initial/sprites/bg_lock.webp');

  const closur = regChromeUrls(groups, { themeId: 'ac_s_closur' });
  assert.equal(closur.char, '/assets/local/themes/ac_s_closur/sprites/closure_back_active.webp');
  assert.equal(closur.frozenLock, '/assets/local/themes/ac_s_closur/sprites/frozen_bg_disable.webp');
  assert.equal(closur.refreshIcon, '/assets/local/themes/ac_s_closur/sprites/refresh_icon.webp');
  assert.equal(closur.refreshIconBg, '/assets/local/themes/ac_s_closur/sprites/refresh_icon_bg.webp');
  assert.equal(closur.frozenIcon, '');

  // the pack whose prefab places the words: the selected official one when installed, else ac_n_initial, else none
  assert.equal(regChromeTheme(groups, null), 'ac_n_initial');
  assert.equal(regChromeTheme(groups, 'ac_s_closur'), 'ac_s_closur');
  assert.equal(regChromeTheme(groups, 'my-pack'), 'ac_n_initial');
  assert.equal(regChromeTheme({ 'themes/ac_n_initial': {} }, 'ac_n_iron'), '');
  assert.equal(regChromeTheme(null, 'ac_n_iron'), '');

  assert.equal(regChromeUrls(null, {}).refresh, '');
  assert.equal(regChromeUrls({}, { themeId: 'not-official' }).char, '');
});

test('a css url rejects a breakout and the style object never sets background-image', () => {
  assert.equal(regCssUrl('/assets/local/themes/ac_n_initial/sprites/bg_close.webp'), 'url("/assets/local/themes/ac_n_initial/sprites/bg_close.webp")');
  assert.equal(regCssUrl('"), red; background: url("http://evil'), '');
  assert.equal(regCssUrl(''), '');
  const style = regChromeStyle({ refresh: '/a.webp', char: '");' });
  assert.equal(style['--reg-refresh'], 'url("/a.webp")');
  assert.equal(style['--reg-char'], undefined);
  assert.equal(style.backgroundImage, undefined);
  assert.deepEqual(regChromeStyle(null), {});
});

test('the default shop-up spine is used only when the three files exist and no theme character is set', () => {
  const groups = { 'themes/ac_n_initial': group('ac_n_initial', INITIAL_FILES) };
  const theme = { imageUrl: '/assets/local/themes/ac_n_iron/sprites/char_2.webp' };
  assert.equal(regulationCharacter(groups, theme), theme);
  const spine = regulationCharacter(groups, null);
  assert.equal(spine.spine.skel, '/assets/local/themes/ac_n_initial/spine/trap_1096_acshopup.json');
  assert.equal(spine.anims.idle, 'Idle');
  assert.equal(spine.spine.textures.length, 1);
  const missing = { 'themes/ac_n_initial': group('ac_n_initial', ['spine/trap_1096_acshopup.json', 'spine/trap_1096_acshopup.atlas']) };
  assert.equal(regulationCharacter(missing, null), null);
  assert.equal(regulationCharacter(null, { spine: { skel: '/x.skel' } }).spine.skel, '/x.skel');
});

// The official theme packs come from the local client (data/local-assets.json, git-ignored): CI has none.
const LOCAL_THEMES = existsSync(path.join(ROOT, 'data/local-assets.json'))
  && ['ac_n_initial', 'ac_n_iron'].every((id) => Object.hasOwn(JSON.parse(read('data/local-assets.json')).groups || {}, `themes/${id}`));

test('the installed ac_n_initial manifest resolves the default plate and the shop-up spine', { skip: !LOCAL_THEMES && 'official themes not extracted (data/local-assets.json is git-ignored)' }, () => {
  const manifest = JSON.parse(read('data/local-assets.json'));
  const urls = regChromeUrls(manifest.groups, { themeId: 'ac_n_initial' });
  assert.match(urls.refresh, /\/themes\/ac_n_initial\/sprites\/refresh_bg_normal\.webp$/);
  assert.match(urls.char, /\/themes\/ac_n_initial\/sprites\/bg_close\.webp$/);
  const iron = regChromeUrls(manifest.groups, { themeId: 'ac_n_iron' });
  assert.match(iron.char, /\/themes\/ac_n_iron\/sprites\/btn_big_close\.webp$/);
  assert.doesNotMatch(iron.char, /bg_close/);
  const character = regulationCharacter(manifest.groups, null);
  assert.match(character.spine.skel, /trap_1096_acshopup\.json$/);
  assert.match(character.spine.atlas, /trap_1096_acshopup\.atlas$/);
  assert.match(character.spine.textures[0], /trap_1096_acshopup\.png$/);
});

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);

test('规程 cards use the tier box, the cost pill and the name bar; 盟约 cards keep the price hexagon', () => {
  const priv = { funds: 20, hand: [], board: [], temp: [], loadout: {} };
  const chess = { kind: 'chess', id: 'chess_x', price: 3, basePrice: 3 };
  const item = { kind: 'item', id: 'item_x', price: 2, basePrice: 2 };
  const reg = ChessCard({ slot: chess, idx: 1, priv, onBuy() {}, onDetail() {}, reg: true });
  const regNodes = [...walk(reg)];
  const regBtn = regNodes.find((n) => hasClass(n, 'scard'));
  assert.ok(hasClass(regBtn, 'scard--reg'));
  assert.ok(regNodes.some((n) => hasClass(n, 'scard__tierbox')));
  assert.ok(regNodes.some((n) => hasClass(n, 'scard__cost')));
  assert.ok(regNodes.some((n) => hasClass(n, 'scard__namebar')));
  assert.equal(regNodes.some((n) => n.type?.name === 'PriceHex'), false);
  assert.equal(regNodes.some((n) => hasClass(n, 'scard__price')), false);

  const old = ChessCard({ slot: chess, idx: 1, priv, onBuy() {}, onDetail() {} });
  const oldNodes = [...walk(old)];
  const oldBtn = oldNodes.find((n) => hasClass(n, 'scard'));
  assert.equal(hasClass(oldBtn, 'scard--reg'), false);
  assert.ok(oldNodes.some((n) => n.type?.name === 'PriceHex'));
  assert.equal(oldNodes.some((n) => hasClass(n, 'scard__cost')), false);

  const regItem = ItemCard({ slot: item, idx: 0, onBuy() {}, onDetail() {}, reg: true });
  const itemNodes = [...walk(regItem)];
  const itemBtn = itemNodes.find((n) => hasClass(n, 'scard'));
  assert.ok(hasClass(itemBtn, 'scard--reg') && hasClass(itemBtn, 'scard--item') && hasClass(itemBtn, 'scard--t1'));
  assert.equal(itemNodes.some((n) => n.type?.name === 'PriceHex'), false);
  const oldItem = ItemCard({ slot: item, idx: 0, onBuy() {}, onDetail() {} });
  const oldItemBtn = [...walk(oldItem)].find((n) => hasClass(n, 'scard'));
  assert.equal(hasClass(oldItemBtn, 'scard--reg'), false);
  assert.equal(hasClass(oldItemBtn, 'scard--t1'), false);

  const poor = ChessCard({ slot: chess, idx: 2, priv, reason: '资金不足', onBuy() {}, onDetail() {}, reg: true });
  assert.ok([...walk(poor)].some((n) => hasClass(n, 'scard__cost') && hasClass(n, 'is-poor')));
  const free = ChessCard({ slot: { ...chess, price: 0 }, idx: 3, priv, free: true, onBuy() {}, onDetail() {}, reg: true });
  assert.ok([...walk(free)].some((n) => hasClass(n, 'scard__cost--free')));
});

test('盟约 shop markup stays, and 规程 adds the new face without replacing the pinned strings', () => {
  const bar = read('public/js/ui/shopBar.js');
  const game = read('public/js/screens/game.js');
  assert.match(bar, /\$\{showReward \? null : html`<div class="shopbar__item">/);
  assert.match(bar, /cx\('shopbar', frozen && 'is-frozen'/);
  assert.match(bar, /<span class="funds__label">\$\{t\('目前资金'\)\}<\/span>/);
  assert.match(bar, /cx\('shopbar', 'shopbar--reg', frozen && 'is-frozen'/);
  assert.match(bar, /funds funds--reg/);
  assert.match(bar, /scard__cost/);
  assert.match(game, /regulationFamily\(gd\.config\) && 'gm--reg'/);
  for (const page of ['public/index.html', 'public/dev/game-mock.html']) {
    const html = read(page);
    const shop = html.indexOf('/css/screens/game-shop.css');
    const reg = html.indexOf('/css/screens/game-reghud.css');
    const devices = html.indexOf('/css/devices.css');
    const theme = html.indexOf('/css/ui-theme.css');
    assert.ok(shop >= 0 && reg > shop && devices > reg && theme > devices, page);
  }
  const css = read('public/css/screens/game-reghud.css');
  assert.match(css, /\.shopbar\.shopbar--reg/);
  assert.match(css, /\.gm\.gm--reg \.gm__bonds/);
  assert.match(css, /min-height: var\(--tap-min\)/);
  const themeCss = read('public/css/ui-theme.css');
  assert.match(themeCss, /html\[data-sp-color~="chessName"\]\[data-sp-slot~="chess_frame_normal"\] \.gm \.scard\.scard--reg\.scard--t1 \.scard__name/);
  assert.match(themeCss, /html\[data-sp-slot~="chess_frame_normal"\] \.scard\.scard--reg\.scard--t1/);
  assert.doesNotMatch(themeCss, /html\[data-sp-color~="chessName"\] \.gm \.scard:not\(\.scard--reg\)/);
});
