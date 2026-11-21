// test/ui/shop-reward-button.test.js — the canvas reward control: a clone of the refresh button
// (background + text + root_cost) shown left of freeze, with no icon, no lock and a ctrl-only repaint.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { shopModelFromPrivate } from '../../public/js/ui/shop/adapter/model.js';
import { CtrlViewData } from '../../public/js/ui/shop/viewData.js';

const read = (path) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');

test('the reward view reaches the model and the ctrl data', () => {
  const reward = { count: 2, visible: false, label: '选择奖励' };
  const model = shopModelFromPrivate({ funds: 9, shop: { level: 1, slots: [] } }, { reward });
  assert.deepEqual(model.reward, reward);
  assert.deepEqual(new CtrlViewData({ reward }).reward, reward);
  const blocked = shopModelFromPrivate({ funds: 9, shop: { level: 1, slots: [] } }, { controls: { freeze: '请先选择奖励' } });
  assert.equal(blocked.freezeBlocked, true);
});

test('the canvas clones the refresh button and registers the reward hotspot', () => {
  const ctrl = read('public/js/ui/shop/ctrl.js');
  assert.match(ctrl, /buildRewardButton\(\)/);
  assert.match(ctrl, /repath\(node, this\.root\.path, 'btn_reward'\)/);
  assert.match(ctrl, /child\.name === 'bg' \|\| child\.name === 'text'/, 'the icon nodes are removed');
  assert.match(ctrl, /anchoredPosition: \[0, 2\]/, 'the reward text is centred');
  assert.match(ctrl, /cost_bg_1\.webp/, 'the root_cost badge is reused for xN');
  const host = read('public/js/ui/shop/host.js');
  assert.match(host, /paths: \['btn_reward\/hotspot'\], event: 'reward'/);
  const canvas = read('public/js/ui/shop/ShopCanvas.js');
  assert.match(canvas, /const chooseFirst = rewardVisible \? t\('请先选择奖励'\) : null/);
  assert.match(canvas, /refresh: chooseFirst \|\|/);
  assert.match(canvas, /freeze: chooseFirst \|\|/);
  assert.match(canvas, /onReward: \(\) => \{/);
  assert.match(canvas, /onRewardToggle\?\.\(\)/);
  assert.match(canvas, /onRefuse: \(reason\) => propsRef\.current\.onRefuse\?\.\(reason\)/);
  assert.match(ctrl, /data\.freezeBlocked \? 0/);
  assert.doesNotMatch(ctrl, /data\.isSpecialRecruit \? 0/, 'the queued offer must not freeze the button after 稍后');
  assert.match(host, /entry\.el\.disabled = false/);
  assert.match(host, /if \(callbacks\.onRefuse\) callbacks\.onRefuse\(reason\)/);
});
