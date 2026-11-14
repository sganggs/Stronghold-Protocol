// 规程 in-match HUD: the family switch and the card face. 盟约 cards stay on the hexagon price.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  regulationFamily, regCardModel, regChromeUrls, regCssUrl, regChromeStyle, regulationCharacter, regChromeTheme, regUpgradeModel,
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
    cost: { kind: 'hex', price: 4, poor: true },
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
  // shop_level_N is the player detail level icon (player_detail_shop_level_hub), not part of the shop chrome
  assert.equal(Object.hasOwn(initial, 'level'), false);

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

// The upgrade parts each pack's group_upgrade names (any size: none of them goes through the plate size filter)
const UP_FILES = {
  ac_n_initial: ['repeat_line', 'deco_up', 'deco_down', 'stripe_line', 'frame_matte', 'icon', 'frame', 'level_2', 'frame_glow',
    'check_grad', 'check_frame', 'check_arrow', 'upgrade_disable', 'upgrade_max'],
  ac_n_iron: ['upgrade_normal', 'level_normal', 'frame1_normal', 'frame2_normal', 'glow_certain', 'level_certain', 'frame1_certain',
    'frame2_certain', 'upgrade_disable', 'upgrade_max', ...[1, 2, 3, 4, 5, 6].map((n) => `upgrade_lv_${n}`)],
  ac_s_closur: ['upgrade_deco_top', 'upgrade_bg_outline_glow', 'upgrade_bg_outline', 'upgrade_deco_bar', 'upgrade_bottom_glow',
    'upgrade_deco_bottom', 'upgrade_bottom_glow2', 'upgrade_deco_bottom2', 'doublecheck_arrow', 'inner_bg_glow', 'inner_bg', 'upgrade_level',
    'upgrade_arrow_left', 'inner_deco', 'img_fx_star_outline', 'upgrade_deco_front', 'upgrade_disable', 'upgrade_max',
    ...[1, 2, 3, 4, 5, 6].map((n) => `upgrade_lv_${n}`)],
};
const upGroups = (only = Object.keys(UP_FILES), drop = []) => Object.fromEntries(only.map((id) => [`themes/${id}`,
  group(id, UP_FILES[id].filter((n) => !drop.includes(n)).map((n) => `sprites/${n}.webp`))]));
const bg = (part) => part.style.backgroundImage || part.style.maskImage || part.style.borderImage || '';

test('升级 is each pack\'s group_upgrade: prefab rects, the numeral, the caption and the price on the top edge', () => {
  const groups = upGroups();
  // ac_n_initial: teal plate layers, the Roman numeral as text, 升级 under it, the price centred 15 units under the top
  const initial = regUpgradeModel(groups, null, { level: 2, state: 'normal' });
  assert.equal(initial.theme, 'ac_n_initial');
  assert.equal(initial.cost, '0.15rem');
  assert.deepEqual(initial.parts[0].style, { left: '0rem', top: '0.02rem', width: '1.12rem', height: '1.88rem', backgroundColor: '#107463' });
  const num = initial.parts.find((p) => p.kind === 'num');
  assert.equal(num.text, 'II');
  assert.equal(num.style.color, '#57e8cb');
  assert.deepEqual(initial.parts.filter((p) => p.kind === 'tip').map((p) => p.tip), ['tip']);
  const label = initial.parts.find((p) => /level_2\.webp/.test(bg(p)));
  assert.deepEqual([label.style.left, label.style.top, label.style.width, label.style.height], ['0.345rem', '0.5rem', '0.45rem', '0.1rem']);
  assert.match(initial.parts.find((p) => /frame_glow/.test(bg(p))).style.borderImage, /frame_glow\.webp"\) 20 fill \/ 0\.2rem stretch$/);
  assert.equal(initial.parts.find((p) => /icon\.webp/.test(bg(p))).style.backgroundColor, 'rgba(2, 5, 5, .3)');
  assert.equal(initial.parts.some((p) => /check_/.test(bg(p))), false, 'the double check waits for the first tap');
  // the first tap: root_double_check on, 确认升级 in place of 升级
  const armed = regUpgradeModel(groups, null, { level: 2, state: 'normal', armed: true });
  assert.deepEqual(armed.parts.filter((p) => /check_(grad|frame|arrow)/.test(bg(p))).length, 3);
  assert.deepEqual(armed.parts.filter((p) => p.kind === 'tip').map((p) => p.tip), ['confirm']);
  // funds short / max: the pack's own plates, grey or teal numeral; armed means nothing there
  const disable = regUpgradeModel(groups, null, { level: 3, state: 'disable', armed: true });
  assert.match(bg(disable.parts[0]), /ac_n_initial\/sprites\/upgrade_disable\.webp/);
  assert.equal(disable.parts.find((p) => p.kind === 'num').style.color, '#a0a0a0');
  assert.deepEqual(disable.parts.filter((p) => p.kind === 'tip').map((p) => p.tip), ['tip']);
  const max = regUpgradeModel(groups, 'ac_n_initial', { level: 6, state: 'max' });
  assert.match(bg(max.parts[0]), /upgrade_max\.webp/);
  assert.equal(max.parts.find((p) => p.kind === 'num').text, 'VI');
  assert.deepEqual(max.parts.filter((p) => p.kind === 'tip').map((p) => p.tip), ['max']);

  // 乌萨斯齐心团: the 136×205 plate 6.8 left of centre, the numeral its upgrade_lv_N image in the img_num colour
  const iron = regUpgradeModel(groups, 'ac_n_iron', { level: 4, state: 'normal' });
  assert.equal(iron.theme, 'ac_n_iron');
  assert.equal(iron.cost, '0.1rem');
  assert.deepEqual(iron.parts[0].style, { left: '-0.188rem', top: '-0.075rem', width: '1.36rem', height: '2.05rem', backgroundImage: 'url("/assets/local/themes/ac_n_iron/sprites/upgrade_normal.webp")' });
  const lv = iron.parts.find((p) => p.kind === 'num');
  assert.equal(lv.text, undefined);
  assert.equal(lv.style.maskImage, 'url("/assets/local/themes/ac_n_iron/sprites/upgrade_lv_4.webp")');
  assert.equal(lv.style.backgroundColor, '#b8e1d6');
  assert.equal(regUpgradeModel(groups, 'ac_n_iron', { level: 4, state: 'max' }).parts.find((p) => p.kind === 'num').style.backgroundColor, '#809e96');
  assert.equal(regUpgradeModel(groups, 'ac_n_iron', { level: 9 }).parts.find((p) => p.kind === 'num').style.maskImage, 'url("/assets/local/themes/ac_n_iron/sprites/upgrade_lv_6.webp")');
  assert.equal(regUpgradeModel(groups, 'ac_n_iron', { level: 2, armed: true }).parts.filter((p) => /_certain/.test(bg(p))).length, 4);

  // 可露希尔: the screen, the mirrored right arrow, the deco tab above the top edge; armed swaps the bottom deco
  const closur = regUpgradeModel(groups, 'ac_s_closur', { level: 1, state: 'normal' });
  assert.equal(closur.theme, 'ac_s_closur');
  const arrows = closur.parts.filter((p) => /upgrade_arrow_left/.test(bg(p)));
  assert.deepEqual(arrows.map((p) => [p.style.left, p.style.transform]), [['0.095rem', undefined], ['0.665rem', 'scaleX(-1)']]);
  assert.ok(Number.parseFloat(closur.parts.find((p) => /upgrade_deco_top/.test(bg(p))).style.top) < 0);
  assert.equal(closur.parts.find((p) => p.kind === 'num').style.backgroundColor, '#080808');
  assert.ok(closur.parts.some((p) => /upgrade_deco_bottom\.webp/.test(bg(p))));
  const closurArmed = regUpgradeModel(groups, 'ac_s_closur', { level: 1, armed: true });
  assert.equal(closurArmed.parts.some((p) => /upgrade_deco_bottom\.webp/.test(bg(p))), false);
  assert.ok(closurArmed.parts.some((p) => /upgrade_bottom_glow2/.test(bg(p))) && closurArmed.parts.some((p) => /doublecheck_arrow/.test(bg(p))));

  // no pack, or a pack without its upgrade sprites: ac_n_initial's layout in CSS colours, never another pack's parts
  for (const [g, id] of [[null, null], [{}, 'ac_n_iron'], [upGroups(['ac_n_initial', 'ac_n_iron'], ['upgrade_max']), 'ac_n_iron']]) {
    const css = regUpgradeModel(g, id, { level: 3 });
    assert.equal(css.theme, 'css');
    assert.equal(css.parts.some((p) => /url\(/.test(bg(p))), false);
    assert.equal(css.parts.find((p) => p.kind === 'num').text, 'III');
    assert.equal(css.parts.find((p) => p.kind === 'text').text, 'LEVEL');
  }
  // a selected non-official theme draws ac_n_initial's
  assert.equal(regUpgradeModel(groups, 'my-pack', { level: 1 }).theme, 'ac_n_initial');
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

const LAYOUT = (id) => path.join(ROOT, `public/assets/local/themes/${id}/layout.json`);
const LOCAL_LAYOUTS = LOCAL_THEMES && ['ac_n_initial', 'ac_n_iron', 'ac_s_closur'].every((id) => existsSync(LAYOUT(id)));

test('the installed packs draw their own 升级, every layer at a group_upgrade size of its sprite (local extraction)', { skip: !LOCAL_LAYOUTS && 'official theme layouts not extracted (public/assets is git-ignored)' }, () => {
  const manifest = JSON.parse(read('data/local-assets.json'));
  for (const id of ['ac_n_initial', 'ac_n_iron', 'ac_s_closur']) {
    // sprite → the prefab sizes it is drawn at under group_upgrade (root_star is scaled .8)
    const sizes = new Map();
    const visit = (node, inUpgrade, k) => {
      const here = inUpgrade || node.name === 'group_upgrade';
      const scale = node.name === 'root_star' ? 0.8 : k;
      const sprite = node.image?.sprite;
      const size = node.rect?.sizeDelta;
      if (here && sprite && size) {
        const list = sizes.get(sprite) || [];
        list.push([size[0] * scale, size[1] * scale]);
        sizes.set(sprite, list);
      }
      for (const child of node.children || []) visit(child, here, scale);
    };
    visit(JSON.parse(readFileSync(LAYOUT(id), 'utf8')).prefabs['shop/panel_shop_main'], false, 1);
    for (const state of ['normal', 'disable', 'max']) {
      for (const armed of [false, true]) {
        const model = regUpgradeModel(manifest.groups, id, { level: 2, state, armed });
        assert.equal(model.theme, id, `${id} ${state}`);
        for (const part of model.parts) {
          const m = /\/sprites\/([a-z0-9_]+)\.webp/.exec(bg(part));
          if (!m || part.style.borderImage || part.style.backgroundRepeat === 'repeat') continue;
          // the dump renames the 45×10 「LEVEL」 level_2; the numeral sprite is set at runtime into img_num
          const name = m[1] === 'level_2' ? 'level' : m[1];
          const want = /^upgrade_lv_/.test(name) ? [[id === 'ac_n_iron' ? 68 : 53, id === 'ac_n_iron' ? 44 : 56]] : sizes.get(name);
          assert.ok(want, `${id}: ${name} is not a group_upgrade sprite`);
          const got = [Number.parseFloat(part.style.width) * 100, Number.parseFloat(part.style.height) * 100];
          assert.ok(want.some(([w, h]) => Math.abs(w - got[0]) < 0.5 && Math.abs(h - got[1]) < 0.5), `${id} ${state}: ${name} ${got} not in ${JSON.stringify(want)}`);
        }
      }
    }
  }
});

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);

test('规程 cards use the tier box, the official cost hexagon at root_cost and the name bar; 盟约 cards keep their price hexagon', () => {
  const priv = { funds: 20, hand: [], board: [], temp: [], loadout: {} };
  const chess = { kind: 'chess', id: 'chess_x', price: 3, basePrice: 3 };
  const item = { kind: 'item', id: 'item_x', price: 2, basePrice: 2 };
  const reg = ChessCard({ slot: chess, idx: 1, priv, onBuy() {}, onDetail() {}, reg: true });
  const regNodes = [...walk(reg)];
  const regBtn = regNodes.find((n) => hasClass(n, 'scard'));
  assert.ok(hasClass(regBtn, 'scard--reg'));
  assert.ok(regNodes.some((n) => hasClass(n, 'scard__tierbox')));
  const cost = regNodes.find((n) => hasClass(n, 'scard__cost'));
  assert.equal(cost.type?.name, 'HexBadge');
  assert.deepEqual([cost.props.value, cost.props.tone, cost.props.size], [3, 'gold', 'sm']);
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
  const poorCost = [...walk(poor)].find((n) => hasClass(n, 'scard__cost') && hasClass(n, 'is-poor'));
  assert.equal(poorCost.props.tone, 'dark');
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
  // the 规程 layout follows the 规程 look: 规程, or 乌萨斯齐心团 / 可露希尔 in any version (regLook, §37.206)
  assert.match(game, /regView && 'gm--reg'/);
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
