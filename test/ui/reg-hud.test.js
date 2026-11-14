// 规程 in-match HUD: the family switch and the card face. 盟约 cards stay on the hexagon price.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  regulationFamily, regCardModel, regChromeUrls, regCssUrl, regChromeStyle, regulationCharacter, regChromeTheme, regUpgradeModel,
  prefabCssRotation, regShopCardFaceModel, regTierViImageStyle, regMaterialStyle,
} from '../../public/js/ui/regHud.js';
import { makePack } from '../../public/js/ui/prefab/view.js';

globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });
const { ChessCard, ItemCard } = await import('../../public/js/ui/shopBar.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const rect = (size, pos = [0, 0], anchors = [0.5, 0.5], pivot = [0.5, 0.5]) => ({
  anchors: { min: anchors, max: anchors }, pivot, sizeDelta: size, anchoredPosition: pos,
});
const pnode = (name, size, { pos = [0, 0], anchors, pivot, image, text, active, rot = 0, children = [] } = {}) => ({
  name, rect: rect(size, pos, anchors || [0.5, 0.5], pivot || [0.5, 0.5]),
  ...(image ? { image } : {}), ...(text ? { text } : {}), ...(active === undefined ? {} : { active }), ...(rot ? { rot } : {}), children,
});
const image = (sprite, color = '#FFFFFF', material = undefined) => ({ sprite, color, ...(material ? { material } : {}) });

function facePack(theme, { width, height, titleY, titleColor, rootTier, withHighTiers = false } = {}) {
  const initial = theme === 'ac_n_initial';
  const childName = pnode('char_name', [initial ? 120 : theme === 'ac_s_closur' ? 110 : 100, 22], {
    pos: [initial ? -49 : -39, titleY === 42.5 || initial ? 0 : 2], text: { color: titleColor, fontSize: 16 },
  });
  const prof = pnode('prof_icon', [initial ? 24 : theme === 'ac_n_iron' ? 22 : 20, initial ? 24 : theme === 'ac_n_iron' ? 22 : 20], {
    pos: [initial ? -62 : theme === 'ac_n_iron' ? -60 : -57, titleY === 42.5 ? 0 : 2], image: image(null, '#EFEFEF'),
  });
  const name = pnode('root_name', [154, 24], {
    pos: [78, titleY], anchors: [0, 0], children: [prof, childName],
  });
  const bonds = pnode('bond_list', [154, 58], { pos: [-77, -44], pivot: [0, 0] });
  const groupChar = pnode('group_char', [width, theme === 'ac_s_closur' ? 205 : height], { children: [name, bonds] });
  const groupFrame = pnode('group_frame', [width, height], { children: [pnode('frame_obj_container', [100, 100])] });
  const equipName = pnode('root_name', [154, 24], {
    pos: [78, titleY], anchors: [0, 0], children: [pnode('icon', [20, 20], { pos: [-57, 0], image: image(null) }),
      pnode('eqiup_name', [110, 22], { pos: [-39, 0], text: { color: titleColor, fontSize: 16 } })],
  });
  const groupEquip = pnode('group_equip', [width, theme === 'ac_s_closur' ? 205 : height], { active: false, children: [
    pnode('bg_deco', [theme === 'ac_n_iron' ? 99 : 153, theme === 'ac_n_iron' ? 99 : 155], { pos: [1, 0], image: image('deco_item') }),
    pnode('root_equip', [156, 188], { children: [pnode('equip', [93, 93], { pos: [0, 17], image: image(null) })] }), equipName,
  ] });
  const tierRect = rootTier?.name === 'iron'
    ? rect([40, 40], [32.3, -9.9], [0, 1])
    : rootTier?.name === 'closure'
      ? rect([66, 66], [0, 0], [0, 1], [0, 1])
      : rect([40, 40], [18, -19], [0, 1]);
  const badgeRect = rootTier?.name === 'iron' ? rect([59, 34])
    : rootTier?.name === 'closure' ? rect([64, 64], [-3, 3]) : rect([26, 26]);
  const rootTierNode = {
    name: 'root_tier', rect: tierRect,
    children: [
      { ...pnode('img_chess_level', badgeRect.sizeDelta, { pos: badgeRect.anchoredPosition, anchors: badgeRect.anchors.min, pivot: badgeRect.pivot, image: image(null) }), rect: badgeRect },
      pnode('chess_level_obj_container', [100, 100]),
    ],
  };
  const btnCard = pnode('btn_card', [width, height], { children: [groupFrame, groupChar, groupEquip, rootTierNode] });
  const cardRoot = pnode('root', [width, height], { children: [pnode('panel_main', [width, height], { children: [
    btnCard, pnode('root_cost', [120, 40], { pos: [theme === 'ac_s_closur' ? 38 : initial ? -1 : 35, theme === 'ac_s_closur' ? 85 : initial ? 81 : 86] }),
  ] })] });
  const base = { name: 'autochess_shop_card_item', element: { pref: [width, height] }, children: [cardRoot] };
  const prefabs = { 'shop/autochess_shop_card_item': base };
  const groups = { [`themes/${theme}`]: {} };
  for (const key of ['sprites/deco_item.webp', 'sprites/frame_outline.webp', 'sprites/frame_star.webp', 'sprites/bottom_grad.webp',
    'sprites/star_5_1.webp', 'sprites/star_5_2.webp', 'sprites/star_6_1.webp', 'sprites/star_6_2.webp',
    'sprites/tv_front.webp', 'sprites/footer.webp']) {
    groups[`themes/${theme}`][key] = { path: `/assets/local/themes/${theme}/${key}` };
  }
  const frameOne = pnode('frame_lv1_obj', [100, 100], { children: [
    pnode('outline', [49, 49], { image: image('frame_outline') }), pnode('star', [49, 49], { image: image('frame_star') }),
  ] });
  if (theme === 'ac_s_closur') prefabs['shop/frame_lv1_obj'] = frameOne;
  if (withHighTiers) {
    for (const tier of [5, 6]) {
      const color = tier === 5 ? '#FF9B0D' : '#00F6FF';
      const stars = [
        pnode('1', [14, 14], { pos: [-16.29, -11.86], image: image(`star_${tier}_1`, color), rot: -22 }),
        pnode('2', [16.67, 16.67], { pos: [14, 13], image: image(`star_${tier}_2`, color), rot: -9.79 }),
      ];
      prefabs[`shop/chess_level_${tier}_obj`] = pnode(`chess_level_${tier}_obj`, [50, 50], { pos: [-3, 3], children: [
        ...(tier === 6 ? [pnode('img_lv', [19.277, 14.687], { pos: [-1.8, 3.2], image: image(null, '#FFFFFF', {
          base: 'fx_gradcolor_1', mask: 'mask_text_vi', tile: [1, 0.3], speed: [0, -0.13], tint: '#FFFFFF',
        }), rot: 12 }), pnode('img_lv_sweep', [19.277, 14.687], { image: image(null, '#FFFFFF') }),
        pnode('root_star', [0, 0], { children: stars })] : stars),
      ] });
    }
    for (const tier of [5, 6]) {
      prefabs[`shop/frame_lv${tier === 5 ? 2 : 3}_obj`] = pnode(`frame_lv${tier === 5 ? 2 : 3}_obj`, [100, 100], { children: [
        pnode('bottom_grad', [tier === 5 ? 116 : 104, 17], { image: image('bottom_grad') }),
        pnode('tv', [42, 40], { image: image('tv_front') }), pnode('deco_txt', [128, 6], { image: image('footer') }),
      ] });
    }
  }
  const doc = { spPrefabs: 1, prefabs, textures: { fx_gradcolor_1: { file: 'sprites/fx_gradcolor_1.webp' }, mask_text_vi: { file: 'sprites/mask_text_vi.webp' } } };
  groups[`themes/${theme}`]['sprites/fx_gradcolor_1.webp'] = { path: `/assets/local/themes/${theme}/sprites/fx_gradcolor_1.webp` };
  groups[`themes/${theme}`]['sprites/mask_text_vi.webp'] = { path: `/assets/local/themes/${theme}/sprites/mask_text_vi.webp` };
  return makePack(groups, `themes/${theme}`, doc);
}

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

test('regulation card faces follow each theme prefab, including star angles and the masked tier-VI scroll', () => {
  const initial = regShopCardFaceModel(facePack('ac_n_initial', {
    width: 155, height: 187, titleY: 25, titleColor: '#FFFFFF', rootTier: { name: 'initial' },
  }), { tier: 6 });
  assert.deepEqual(initial.card, { w: 155, h: 187 });
  assert.equal(initial.name.color, '#FFFFFF');
  assert.deepEqual(initial.tierBox.style, { left: '-1.2903%', top: '-0.5348%', width: '25.8065%', height: '21.3904%' });
  assert.deepEqual(initial.cost.style, { left: '49.3548%', top: '6.6845%' });
  assert.equal(initial.layers.length, 0, 'the starter theme draws its hollow frame without level-frame prefabs');

  const iron = regShopCardFaceModel(facePack('ac_n_iron', {
    width: 155, height: 187, titleY: 32, titleColor: '#EFEBDF', rootTier: { name: 'iron' },
  }), { tier: 5 });
  assert.deepEqual(iron.card, { w: 155, h: 187 });
  assert.equal(iron.name.color, '#EFEBDF');
  assert.deepEqual(iron.namebar, { left: '0.6452%', top: '76.4706%', width: '99.3548%', height: '12.8342%' });
  assert.deepEqual(iron.cost.style, { left: '72.5806%', top: '4.0107%' });
  assert.deepEqual(iron.layers, [], 'iron has no frame_lv or chess_level prefabs');

  const pack = facePack('ac_s_closur', {
    width: 157, height: 207, titleY: 42.5, titleColor: '#000000', rootTier: { name: 'closure' }, withHighTiers: true,
  });
  assert.equal(pack.sprite('frame_outline'), '/assets/local/themes/ac_s_closur/sprites/frame_outline.webp');
  assert.ok(pack.doc.prefabs['shop/frame_lv1_obj']);
  const closure1 = regShopCardFaceModel(pack, { tier: 1 });
  assert.deepEqual(closure1.card, { w: 157, h: 207 });
  assert.deepEqual(closure1.namebar, { left: '0.6369%', top: '73.1884%', width: '98.0892%', height: '11.5942%' });
  assert.equal(closure1.name.color, '#000000');
  assert.equal(closure1.layers.length, 2, JSON.stringify(closure1.layers));

  const closure5 = regShopCardFaceModel(pack, { tier: 5 });
  const stars5 = closure5.layers.filter((layer) => layer.node.name === '1' || layer.node.name === '2');
  assert.deepEqual(stars5.map((layer) => [layer.box.w, layer.box.h, layer.node.image.color, prefabCssRotation(layer.node.rot)]), [
    [14, 14, '#FF9B0D', 22], [16.67, 16.67, '#FF9B0D', 9.79],
  ]);
  assert.equal(closure5.layers.find((layer) => layer.node.name === 'bottom_grad').box.w, 116);
  // frame_lv2_obj's own layers in prefab order (the static frame image has no TV or footer: the official card draws them)
  assert.deepEqual(closure5.layers.map((layer) => layer.node.name).filter((n) => ['bottom_grad', 'tv', 'deco_txt'].includes(n)),
    ['bottom_grad', 'tv', 'deco_txt']);

  const closure6 = regShopCardFaceModel(pack, { tier: 6 });
  const stars6 = closure6.layers.filter((layer) => layer.node.name === '1' || layer.node.name === '2');
  assert.deepEqual(stars6.map((layer) => [layer.box.w, layer.box.h, layer.node.image.color, prefabCssRotation(layer.node.rot)]), [
    [14, 14, '#00F6FF', 22], [16.67, 16.67, '#00F6FF', 9.79],
  ]);
  assert.equal(prefabCssRotation(closure6.vi.node.rot), -12);
  assert.equal(closure6.vi.node.image.material.mask, 'mask_text_vi');
  assert.deepEqual(closure6.vi.node.image.material.speed, [0, -0.13]);
  const viStyle = regTierViImageStyle(closure6, pack);
  // the VI glyph is the material's colour ramp (the base texture's own colours) cut by mask_text_vi, scrolled at its speed
  assert.match(viStyle.WebkitMaskImage, /mask_text_vi\.webp/);
  assert.match(viStyle.backgroundImage, /url\(/);
  assert.equal(viStyle.mixBlendMode, undefined, 'drawn in its colours, not screened white');
  assert.equal(Number.parseFloat(/reg-prefab-bg-scroll ([\d.]+)s/.exec(viStyle.animation)[1]), 7.692);

  const item = regShopCardFaceModel(pack, { tier: 3, kind: 'item' });
  assert.ok(item.item.watermark);
  assert.deepEqual(item.item.iconSize, { width: 93, height: 93 });
  assert.equal(item.item.nameColor, '#000000');
  assert.equal(item.item.nameFontSize, 0.16);

  const priv = { funds: 20, hand: [], board: [], temp: [], loadout: {} };
  const chessCard = ChessCard({ slot: { kind: 'chess', id: 'chess_x', price: 3 }, idx: 0, priv, reg: true,
    faceModel: closure6, facePack: pack, onBuy() {}, onDetail() {} });
  const chessNodes = [...walk(chessCard)];
  const chessButton = chessNodes.find((node) => hasClass(node, 'scard'));
  assert.deepEqual(chessButton.props.style, { width: '1.57rem', height: '2.07rem' });
  // frame_lv3_obj's bottom_grad, tv and deco_txt, then the two tier stars
  assert.equal(chessNodes.filter((node) => hasClass(node, 'scard__prefab-layer')).length, 5);
  const tierChip = chessNodes.find((node) => node.type?.name === 'TierChip');
  assert.equal(tierChip?.props.overlay?.type, 'i');
  assert.equal(hasClass(tierChip?.props.overlay, 'tier__prefab-vi'), true);
  assert.equal(chessNodes.some((node) => hasClass(node, 'scard__class')), false, 'the face shows profession mark and name only');
  const itemCard = ItemCard({ slot: { kind: 'item', id: 'item_x', price: 2 }, idx: 0, reg: true,
    faceModel: item, facePack: pack, onBuy() {}, onDetail() {} });
  const itemNodes = [...walk(itemCard)];
  assert.ok(itemNodes.some((node) => hasClass(node, 'scard__prefab-layer--deco_item')));
  assert.ok(itemNodes.some((node) => hasClass(node, 'scard__itemart')));
  assert.equal(itemNodes.some((node) => hasClass(node, 'scard__idesc')), false, 'the shop face leaves effect text to detail');
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

test('a card material draws its base texture in its own colours, tinted, masked and scrolled (§37.228)', () => {
  const pack = { texture: (n) => `/t/${n}.webp` };
  const box = { w: 116, h: 17 };
  // frame_lv2_obj bottom_grad: an opaque orange ramp (fx_gradcolor_4), white Image, tile 0.5 × 1, scrolling left
  const grad = regMaterialStyle({ color: '#FFFFFF', material: { base: 'fx_gradcolor_4', tile: [0.5, 1], speed: [-0.25, 0] } }, box, pack);
  assert.equal(grad.backgroundImage, 'url("/t/fx_gradcolor_4.webp")');
  assert.equal(grad.backgroundSize, '200% 100%');
  assert.equal(grad.backgroundColor, undefined, 'a white Image keeps the ramp colours');
  assert.equal(grad.maskImage, undefined);
  assert.equal(grad.mixBlendMode, undefined);
  assert.match(grad.animation, /^reg-prefab-bg-scroll 4s linear infinite$/);
  assert.equal(grad['--reg-prefab-bg-to'], '2.32rem 0rem', 'one period: box / tile prefab units at .01rem');
  // a tinted, translucent layer with a mask
  const tinted = regMaterialStyle({ color: '#F8507F33', material: { base: 'fx_gradcolor_1', mask: 'mask_tv2', tile: [1, 1] } }, box, pack, { still: true });
  assert.equal(tinted.backgroundColor, 'rgb(248 80 127)');
  assert.equal(tinted.backgroundBlendMode, 'multiply');
  assert.equal(tinted.maskImage, 'url("/t/mask_tv2.webp")');
  assert.equal(tinted.opacity, '0.2');
  assert.equal(tinted.animation, undefined, 'still: no scroll');
  assert.equal(regMaterialStyle({ color: '#FFFFFF', material: { fx: 1 } }, box, pack), null, 'no base texture → no layer');
});
