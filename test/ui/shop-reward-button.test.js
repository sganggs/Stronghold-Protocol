// test/ui/shop-reward-button.test.js — the canvas reward control: a clone of the refresh button
// (background + text + root_cost) shown left of freeze, with no icon, no lock and a ctrl-only repaint.
// The ctrl reads its label/count by PATH (group_normal/text, root_cost/group_free/text_num), so the fixture
// mirrors the prefab and the assertions follow those same paths. The blocked-click path is pinned through
// runControlClick()/applyControlState() (fake element/button), not through source text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { shopModelFromPrivate } from '../../public/js/ui/shop/adapter/model.js';
import { CtrlViewData } from '../../public/js/ui/shop/viewData.js';
import { AutoChessStylizedShopCtrlPanel, buildRewardButtonNode, freezeState } from '../../public/js/ui/shop/ctrl.js';
import { applyControlState, CONTROL_HOTSPOTS, runControlClick, rewardAriaLabel } from '../../public/js/ui/shop/host.js';
import { shopControlReasons, shopRewardView, rewardPickLabel, shopFoldReward } from '../../public/js/ui/shop/ShopCanvas.js';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../public/js/ui/gameLogic/settings.js';
import { findPath } from '../../public/js/ui/shop/prefab.js';
import { PHASE } from '../../shared/constants.js';
import { t, setLang, setMessages, setNameResolver } from '../../shared/i18n.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PACKS = {};
const NAMES = {};
function packOf(lang) {
  PACKS[lang] = PACKS[lang] || JSON.parse(readFileSync(path.join(ROOT, `public/i18n/${lang}.json`), 'utf8'));
  return PACKS[lang];
}
function namesOf(lang) {
  NAMES[lang] = NAMES[lang] || JSON.parse(readFileSync(path.join(ROOT, `data/i18n/${lang}.json`), 'utf8')).names || {};
  return NAMES[lang];
}

function find(node, name) {
  if (!node) return null;
  if (node.name === name) return node;
  for (const child of node.children || []) {
    const hit = find(child, name);
    if (hit) return hit;
  }
  return null;
}

/** The real prefab's btn_refresh shape: group_free holds bg + text_num (no coin icon). */
function refreshTemplate() {
  return {
    name: 'btn_refresh',
    path: 'root/btn_refresh',
    children: [
      {
        name: 'group_normal',
        path: 'root/btn_refresh/group_normal',
        children: [
          { name: 'bg', path: 'root/btn_refresh/group_normal/bg', image: {} },
          { name: 'text', path: 'root/btn_refresh/group_normal/text', rect: {}, text: {} },
          { name: 'icon', path: 'root/btn_refresh/group_normal/icon', image: {} },
        ],
      },
      { name: 'group_lock', path: 'root/btn_refresh/group_lock' },
      {
        name: 'root_cost',
        path: 'root/btn_refresh/root_cost',
        children: [{
          name: 'group_free',
          path: 'root/btn_refresh/root_cost/group_free',
          children: [
            { name: 'bg', path: 'root/btn_refresh/root_cost/group_free/bg', image: {} },
            { name: 'text_num', path: 'root/btn_refresh/root_cost/group_free/text_num', rect: {}, text: {} },
          ],
        }],
      },
    ],
  };
}

const editablePriv = (funds = 9) => ({
  funds,
  ready: false,
  shop: { level: 1, maxLevel: 6, refreshPrice: 3, upgradePrice: 0, slots: [] },
});

/** ShopCanvas-shaped props for the pure control-reason helper. */
const reasonsFor = ({ offer = null, rewardMin = false, phase = PHASE.PREP, priv = editablePriv(2), editable = true }) =>
  shopControlReasons({
    priv: offer ? { ...priv, shop: { ...priv.shop, rewardOffer: offer } } : priv,
    editable,
    phase,
    rewardMin,
    config: null,
  });

test('the reward view reaches the model and the ctrl data', () => {
  const reward = { count: 2, visible: false, label: '选择奖励' };
  const model = shopModelFromPrivate({ funds: 9, shop: { level: 1, slots: [] } }, { reward });
  assert.deepEqual(model.reward, reward);
  assert.deepEqual(new CtrlViewData({ reward }).reward, reward);
  const blocked = shopModelFromPrivate({ funds: 9, shop: { level: 1, slots: [] } }, { controls: { freeze: '请先选择奖励' } });
  assert.equal(blocked.freezeBlocked, true);
});

test('the reward button clones the refresh pill, drops its icon/lock, and reuses the cost badge', () => {
  const template = refreshTemplate();
  const before = structuredClone(template);
  const node = buildRewardButtonNode(template, 'root');
  assert.deepEqual(template, before, 'the refresh template is never mutated');

  assert.equal(node.name, 'btn_reward');
  assert.equal(node.path, 'root/btn_reward');
  assert.deepEqual(node.rect.sizeDelta, [168, 76]);
  assert.deepEqual(node.rect.anchoredPosition, [-391, 0]);
  assert.equal(node.active, true);

  assert.equal(find(node, 'group_lock'), null, 'the frozen/locked group is removed');
  assert.equal(find(node, 'icon'), null, 'the refresh icon is removed');
  assert.deepEqual((find(node, 'root_cost')?.children || []).map((child) => child.name), ['group_free'],
    'the cost holder keeps group_free');

  // The ctrl reads these two nodes by the production paths, not by a bare name lookup.
  const label = findPath(node, 'group_normal/text');
  assert.equal(label, find(node, 'text'));
  assert.equal(label.path, 'root/btn_reward/group_normal/text');
  assert.equal(label.rect.anchoredPosition[0], 0, 'the reward label is centred horizontally');
  assert.equal(label.text.fontSize, 19);
  assert.equal(label.text.color, '#1F1F1F');

  const count = findPath(node, 'root_cost/group_free/text_num');
  assert.equal(count, find(node, 'text_num'));
  assert.equal(count.path, 'root/btn_reward/root_cost/group_free/text_num');
  assert.equal(count.text.font, 'Novecentowide-Medium');
  assert.equal(count.text.fontSize, 20);
  assert.equal(count.text.color, '#FFC600');
  assert.deepEqual(count.rect.anchoredPosition, [0, 4]);

  // group_free in the real prefab is the badge + its number; it has no coin icon to keep or prune.
  assert.deepEqual((find(node, 'group_free')?.children || []).map((child) => child.name), ['bg', 'text_num']);
  assert.equal(find(node, 'icon_cost'), null, 'the reward pill shows no coin icon');
  assert.deepEqual(find(find(node, 'group_free'), 'bg').image.sprite, 'cost_bg_1');
  assert.equal(findPath(node, 'root_cost/group_free/bg').image.file, 'sprites/cost_bg_1.webp');
  assert.deepEqual(findPath(node, 'root_cost/group_free/bg').rect.sizeDelta, [44, 36]);
});

test('buildRewardButton appends the reward pill to the ctrl root exactly once', () => {
  const root = { name: 'root', path: 'root', children: [refreshTemplate()] };
  const fakeCtrl = { root, buildRewardButton: AutoChessStylizedShopCtrlPanel.prototype.buildRewardButton };
  const before = root.children.length;
  // The constructor assigns the result, so the fake does the same before the second call.
  const first = fakeCtrl.rewardButton = fakeCtrl.buildRewardButton();
  assert.equal(root.children.length, before + 1, 'one append');
  assert.equal(root.children.filter((child) => child.name === 'btn_reward').length, 1);
  assert.equal(root.children[root.children.length - 1], first);
  const second = fakeCtrl.buildRewardButton();
  assert.equal(second, first, 'a repeated build returns the existing node');
  assert.equal(root.children.filter((child) => child.name === 'btn_reward').length, 1, 'never a second pill');
});

test('the freeze face keeps the frozen/unfreeze state above the ready lock', () => {
  assert.equal(freezeState({ isFrozen: true, freezeBlocked: true }), 2, 'frozen wins over the lock');
  assert.equal(freezeState({ isFrozen: false, freezeBlocked: true }), 0);
  assert.equal(freezeState({ isFrozen: false, freezeBlocked: false }), 1);
  // A queued offer special recruit must not hide the unfreeze face of a frozen shop.
  assert.equal(freezeState({ isSpecialRecruit: true, isFrozen: false, freezeBlocked: false }), 1);
});

test('shopControlReasons gates refresh/freeze on the reward row and leaves level-up usable', () => {
  const offer = { slots: [{ id: 'a' }] };
  const prep = reasonsFor({ offer, rewardMin: false, phase: PHASE.PREP, priv: editablePriv(2) });
  assert.equal(prep.refresh, t('请先选择奖励'));
  assert.equal(prep.freeze, t('请先选择奖励'));
  assert.equal(prep.levelUp, null, 'the level-up card is never gated by the offer');

  const later = reasonsFor({ offer, rewardMin: true, phase: PHASE.PREP, priv: editablePriv(2) });
  assert.equal(later.refresh, t('资金不足'), '稍后 brings the ordinary refresh rule back');
  assert.equal(later.freeze, null, 'editable freeze is not blocked');
  assert.equal(later.levelUp, null);

  const draft = reasonsFor({ offer, rewardMin: false, phase: PHASE.SP_DRAFT, priv: editablePriv(2) });
  assert.equal(draft.refresh, t('资金不足'), 'a reward offer does not gate the normal row in 机变阶段');
  assert.equal(draft.freeze, null);
  assert.equal(draft.levelUp, null);

  const locked = reasonsFor({ offer: null, phase: PHASE.PREP, priv: editablePriv(9), editable: false });
  assert.equal(locked.refresh, t('当前阶段无法进行该操作'));
  assert.equal(locked.freeze, t('当前阶段无法进行该操作'));
  assert.equal(locked.levelUp, t('当前阶段无法进行该操作'));

  const noOffer = reasonsFor({ offer: null, phase: PHASE.PREP, priv: editablePriv(2) });
  assert.equal(noOffer.refresh, t('资金不足'));
  assert.equal(noOffer.freeze, null);
  assert.equal(noOffer.levelUp, null);
});

function fakeControlEl() {
  const attrs = new Map();
  return {
    disabled: true,
    hidden: false,
    title: '',
    setAttribute(name, value) {
      attrs.set(name, String(value));
      if (name === 'title') this.title = String(value);
    },
    getAttribute(name) {
      return attrs.has(name) ? attrs.get(name) : null;
    },
    removeAttribute(name) {
      attrs.delete(name);
      if (name === 'title') this.title = '';
    },
    hasAttribute(name) {
      return attrs.has(name);
    },
  };
}

test('applyControlState keeps a blocked hotspot clickable and explains it', () => {
  const el = fakeControlEl();
  const button = { interactable: true };

  applyControlState(el, button, null);
  assert.equal(el.disabled, false);
  assert.equal(el.hasAttribute('aria-disabled'), false);
  assert.equal(el.title, '');
  assert.equal(button.interactable, true);

  applyControlState(el, button, '请先选择奖励');
  assert.equal(el.disabled, false, 'a blocked tool button stays clickable so its title is reachable');
  assert.equal(el.getAttribute('aria-disabled'), 'true');
  assert.equal(el.title, '请先选择奖励');
  assert.equal(button.interactable, false, 'the scene button must not press while blocked');
});

test('runControlClick: a blocked tool refuses, a blocked panel still runs, cooldown blocks', () => {
  const calls = [];
  const run = () => calls.push('run');
  const press = (value) => () => { calls.push('press'); return value; };

  assert.equal(runControlClick({
    reason: '请先选择奖励', panel: false, press: press(true),
    onRefuse: (reason) => calls.push(`refuse:${reason}`), run,
  }), 'refuse');
  assert.deepEqual(calls, ['refuse:请先选择奖励'], 'no press and no action for a blocked tool button');

  calls.length = 0;
  assert.equal(runControlClick({
    reason: '请先选择奖励', panel: true, press: press(true),
    onRefuse: (reason) => calls.push(`refuse:${reason}`), run,
  }), 'run');
  assert.deepEqual(calls, ['run'], 'a blocked panel control still reports the tap');

  calls.length = 0;
  assert.equal(runControlClick({ press: press(false), run }), 'blocked');
  assert.deepEqual(calls, ['press'], 'a click cooldown stops before the action');

  calls.length = 0;
  assert.equal(runControlClick({ press: press(true), run }), 'run');
  assert.deepEqual(calls, ['press', 'run']);
});

test('the host registers the reward hotspots', () => {
  const reward = CONTROL_HOTSPOTS.find((spec) => spec.key === 'reward');
  assert.equal(reward.event, 'reward');
  assert.equal(reward.paths.length, 1);
  assert.equal(reward.paths[0], 'btn_reward/hotspot');
  const fold = CONTROL_HOTSPOTS.find((spec) => spec.key === 'rewardFold');
  assert.equal(fold.event, 'reward', 'the folded copy reports the same event');
  assert.equal(fold.paths[0], 'state_able/btn_reward/hotspot');
  assert.equal(Object.isFrozen(reward), true, 'a caller cannot rewire the host hotspots');
  assert.equal(Object.isFrozen(reward.paths), true);
  assert.equal(Object.isFrozen(CONTROL_HOTSPOTS), true);
});

test('shopFoldReward: the folded pill only with the setting, a pending offer and PREP', () => {
  const offer = rewardOffer();
  assert.equal(shopFoldReward({ collapsed: true, offer, enabled: true, phase: PHASE.PREP }), true);
  assert.equal(shopFoldReward({ collapsed: false, offer, enabled: true }), false, 'unfolded shows the normal control');
  assert.equal(shopFoldReward({ collapsed: true, offer, enabled: false }), false, 'off by default');
  assert.equal(shopFoldReward({ collapsed: true, offer: null, enabled: true }), false, 'no pending offer, nothing to show');
  assert.equal(shopFoldReward({ collapsed: true, offer: { slots: [] }, enabled: true }), false);
  assert.equal(shopFoldReward({ collapsed: true, offer, enabled: true, phase: PHASE.SP_DRAFT }), false, 'PREP only');
});

test('the folded-reward setting defaults off and only an explicit true enables it', () => {
  assert.equal(DEFAULT_SETTINGS.shopFoldRewardHint, false);
  assert.equal(sanitizeSettings({}).shopFoldRewardHint, false, 'a profile saved before the switch stays folded');
  assert.equal(sanitizeSettings({ shopFoldRewardHint: true }).shopFoldRewardHint, true);
  for (const junk of ['true', 1, null, {}]) assert.equal(sanitizeSettings({ shopFoldRewardHint: junk }).shopFoldRewardHint, false, String(junk));
});

// ---- the minimized label names the offer, in every language ----------------------------------------------

test('rewardPickLabel: 选择{title} for every offer kind, six glyphs at most in zh', () => {
  const cases = [
    ['晋升奖励', rewardOffer()],
    ['定向投放', rewardOffer({ source: 'special', label: '定向投放', slots: [{ kind: 'item', id: 'y' }] })],
    ['见者有份', rewardOffer({ source: 'special', label: '见者有份', slots: [{ kind: 'item', id: 'z' }] })],
    ['寻呼模块', rewardOffer({ source: 'special', label: '寻呼模块' })],
    ['松果', rewardOffer({ source: 'special', label: '松果' })],
    ['特殊招募', rewardOffer({ source: 'special', slots: [{ kind: 'chess', id: 'w' }] })],
    ['装备补给', rewardOffer({ source: 'special', slots: [{ kind: 'item', id: 'v' }] })],
  ];
  for (const [title, offer] of cases) {
    const view = shopRewardView(offer, { rewardMin: true, phase: PHASE.PREP });
    assert.equal(view.label, `选择${title}`, `${title}: the button names the offer`);
    assert.ok(view.label.length <= 6, `${title}: ${view.label} must fit the 120-unit text node at 19 px`);
  }
  assert.equal(rewardPickLabel(null), t('选择奖励'));
  assert.equal(rewardPickLabel({ title: '' }), t('选择奖励'));
  assert.equal(rewardPickLabel({ title: '一个很长的策略名称' }), '选择一个很长的策略名称',
    'a long name still names the offer; the prefab bestFit shrinks the face');
});

test('the minimized label names the offer in every language, not just zh', () => {
  // named offers (strategy effect / item / operator trait) and offers without a name (promotion, generic)
  const named = [
    ['定向投放', rewardOffer({ source: 'special', label: '定向投放', slots: [{ kind: 'item', id: 'y' }] })],
    ['寻呼模块', rewardOffer({ source: 'special', label: '寻呼模块' })],
    ['松果', rewardOffer({ source: 'special', label: '松果' })],
  ];
  const generic = [
    ['晋升奖励', rewardOffer()],
    ['特殊招募', rewardOffer({ source: 'special', slots: [{ kind: 'chess', id: 'w' }] })],
    ['装备补给', rewardOffer({ source: 'special', slots: [{ kind: 'item', id: 'v' }] })],
  ];
  const restore = () => { setLang('zh'); setNameResolver(null); };
  try {
    for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
      setMessages(lang, packOf(lang));
      setNameResolver((name) => namesOf(lang)[name] || name);
      setLang(lang);
      const titleOf = (zhName) => namesOf(lang)[zhName] || zhName;
      const pack = packOf(lang);
      for (const [zhName, offer] of named) {
        const view = shopRewardView(offer, { rewardMin: true, phase: PHASE.PREP });
        assert.ok(view.label.includes(titleOf(zhName)), `${lang}: ${view.label} should name ${titleOf(zhName)}`);
        assert.equal(rewardAriaLabel(view), view.label, `${lang}: the minimized aria label is the painted one`);
      }
      for (const [msgid, offer] of generic) {
        const view = shopRewardView(offer, { rewardMin: true, phase: PHASE.PREP });
        assert.ok(view.label.includes(pack[msgid]), `${lang}: ${view.label} should name ${pack[msgid]}`);
      }
      if (lang === 'en' || lang === 'ko') {
        for (const [, offer] of [...named, ...generic]) {
          assert.doesNotMatch(shopRewardView(offer, { rewardMin: true, phase: PHASE.PREP }).label, /[\u4e00-\u9fff]/,
            `${lang}: no Chinese fallback`);
        }
      }
      assert.notEqual(shopRewardView(rewardOffer(), { rewardMin: true, phase: PHASE.PREP }).label, t('选择奖励'),
        `${lang}: the generic label would make offers look alike`);
    }
  } finally {
    restore();
  }
});

// ---- the reward view: 稍后 names the action, minimized names the offer ------------------------------------

const rewardOffer = (over = {}) => ({ source: 'merge', slots: [{ kind: 'chess', id: 'x' }], ...over });

test('shopRewardView: the row shown reads 稍后, minimized reads 选择{title} and the title comes from offerHeader', () => {
  const shown = shopRewardView(rewardOffer(), { phase: PHASE.PREP });
  assert.equal(shown.label, t('稍后'));
  assert.equal(shown.visible, true);
  assert.equal(shown.title, t('晋升奖励'));
  assert.equal(shown.micro, 'PROMOTION');
  assert.equal(shown.sub, t('免费选择 1 名'));
  assert.equal(shown.count, 1);

  const minimized = shopRewardView(rewardOffer(), { rewardMin: true, phase: PHASE.PREP });
  assert.equal(minimized.label, t('选择{title}', { title: t('晋升奖励') }));
  assert.equal(minimized.visible, false);

  const cathy = shopRewardView(rewardOffer({ source: 'special', label: '定向投放', slots: [{ kind: 'item', id: 'y' }] }), { rewardMin: true });
  assert.equal(cathy.title, '定向投放');
  assert.equal(cathy.label, t('选择{title}', { title: '定向投放' }));
  assert.equal(cathy.sub, t('免费选择 1 件'), 'an item offer says 1 件');
});

test('shopRewardView: queued offers raise the count and say 之后还有 N 项', () => {
  const view = shopRewardView(rewardOffer({ queued: 2 }), { phase: PHASE.PREP });
  assert.equal(view.count, 3);
  assert.equal(view.more, t('之后还有 {queued} 项', { queued: 2 }));
  assert.equal(shopRewardView(rewardOffer({ queued: 0 }), {}).more, null);
});

test('shopRewardView follows the offer the server makes current after a pick', () => {
  const first = shopRewardView(rewardOffer({ queued: 1 }), { rewardMin: true });
  assert.equal(first.label, t('选择{title}', { title: t('晋升奖励') }));
  assert.equal(first.count, 2, 'two offers were waiting');
  // the server drops the picked offer and pushes the next one as rewardOffer
  const next = shopRewardView(rewardOffer({ source: 'special', label: '定向投放', slots: [{ kind: 'item', id: 'y' }], queued: 0 }), { rewardMin: true });
  assert.equal(next.label, t('选择{title}', { title: '定向投放' }), 'the button names the offer that is now current');
  assert.equal(next.count, 1);
  assert.equal(next.more, null);
});

test('shopRewardView is empty outside PREP and without a pending offer', () => {
  assert.equal(shopRewardView(null), null);
  assert.equal(shopRewardView({ slots: [] }), null);
  assert.equal(shopRewardView(rewardOffer(), { phase: PHASE.SP_DRAFT }), null);
  assert.equal(shopRewardView(rewardOffer(), { phase: PHASE.ROUND_START }), null);
  assert.ok(shopRewardView(rewardOffer(), { phase: PHASE.PREP }));
});

test('rewardAriaLabel names the offer once, not twice', () => {
  const title = t('晋升奖励');
  const minimized = { title, label: t('选择{title}', { title }), visible: false };
  assert.equal(rewardAriaLabel(minimized), minimized.label, 'the minimized label already names the offer');
  assert.equal(rewardAriaLabel({ title, label: t('稍后'), visible: true }),
    t('{title}：{label}', { title, label: t('稍后') }), '稍后 carries the title');
  assert.equal(rewardAriaLabel({ label: t('稍后'), visible: true }), t('稍后'), 'no title: the action alone');
  assert.equal(rewardAriaLabel(null), t('选择奖励'));
});
