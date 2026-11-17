// test/ui/shop-gate.test.js — the Stage B WebGL shop gate (ui/shop/gate.js).
// The gate is the product's capability test: the installed official group carries the WebGL shop documents
// and the runtime preloaded. No theme id list, rollout/config flag, version registry or pointer class is
// consulted; selecting a theme whose pack carries the documents mounts the WebGL shop.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { shopCapability, shopWebglGate } from '../../public/js/ui/shop/gate.js';

const GROUP = 'themes/ac_s_closur';
const FILES = ['prefabs.json', 'card.json', 'shop.json'];

function groupsFor(names = FILES) {
  const entries = {};
  for (const name of names) entries[name] = { path: `/assets/local/${GROUP}/${name}` };
  return { [GROUP]: entries };
}

const PRIV = { funds: 30, shop: { level: 1, slots: [], rewardOffer: null }, standIns: [], diy: {} };

/** every condition passing; each case overrides one. */
const ok = {
  themeId: 'ac_s_closur',
  groups: groupsFor(),
  priv: PRIV,
  spectator: false,
  runtime: 'ready',
};

test('capability is the release: ac_s_closur mounts with no config rollout flag', () => {
  assert.deepEqual(shopWebglGate(ok), { on: true, reason: null });
  // The gate reads no config at all: no rollout switch, version registry or pointer. Any config value — a false
  // legacy shopWebgl flag, junk, a missing object — leaves the decision exactly as it is (this is the contract;
  // asserting fields the gate never reads would only assert the fixture).
  const configs = [{ ui: { shopWebgl: false } }, { ui: { shopWebgl: true, shopWebglThemes: [] } }, {}, null, 'no config'];
  for (const config of configs) {
    const label = `config ${JSON.stringify(config)}`;
    assert.deepEqual(shopWebglGate({ ...ok, config }), { on: true, reason: null }, label);
    // …and a config cannot release a theme the documents do not either
    assert.deepEqual(shopWebglGate({ ...ok, config, themeId: 'terminal' }), { on: false, reason: 'theme' }, label);
  }
});

test('capability: the official theme group must carry prefabs.json + card.json + shop.json', () => {
  assert.deepEqual(shopCapability(groupsFor(), 'ac_s_closur'), { ok: true, group: GROUP, missing: [] });
  assert.deepEqual(shopCapability(groupsFor(['prefabs.json', 'card.json']), 'ac_s_closur').missing, ['shop.json']);
  assert.deepEqual(shopCapability(groupsFor(['card.json', 'shop.json']), 'ac_s_closur').missing, ['prefabs.json']);
  assert.equal(shopCapability(null, 'ac_s_closur').ok, false);
  assert.equal(shopCapability(groupsFor(), 'terminal').group, null);
  // ac_n_initial / ac_n_iron ship prefabs.json + card.json but no shop.json, so the old UI stays.
  assert.equal(shopCapability({ 'themes/ac_n_iron': { 'prefabs.json': {}, 'card.json': {} } }, 'ac_n_iron').ok, false);
});

test('theme: only an installed official theme can mount', () => {
  assert.deepEqual(shopWebglGate({ ...ok, themeId: 'terminal' }), { on: false, reason: 'theme' });
  assert.deepEqual(shopWebglGate({ ...ok, themeId: '' }), { on: false, reason: 'theme' });
  assert.deepEqual(shopWebglGate({ ...ok, groups: {} }), { on: false, reason: 'pack' });
});

test('other themes without shop.json keep the old bar', () => {
  assert.deepEqual(shopWebglGate({ ...ok, groups: groupsFor(['prefabs.json', 'card.json']) }), { on: false, reason: 'capability' });
  assert.deepEqual(shopWebglGate({ ...ok, groups: groupsFor(['shop.json']) }), { on: false, reason: 'capability' });
  assert.deepEqual(shopWebglGate({ ...ok, themeId: 'ac_n_iron', groups: { 'themes/ac_n_iron': { 'prefabs.json': {}, 'card.json': {} } } }), { on: false, reason: 'capability' });
});

test('version/pointer are not gates: documents + runtime decide', () => {
  assert.deepEqual(shopWebglGate({ ...ok, config: { version: { id: 'act2autochess@V2_1', family: 'covenant' } } }), { on: true, reason: null });
  assert.deepEqual(shopWebglGate({ ...ok, desktop: false }), { on: true, reason: null });
  assert.deepEqual(shopWebglGate({ ...ok, desktop: undefined }), { on: true, reason: null });
});

test('runtime: idle/loading/failed keep the old bar', () => {
  assert.deepEqual(shopWebglGate({ ...ok, runtime: 'idle' }), { on: false, reason: 'loading' });
  assert.deepEqual(shopWebglGate({ ...ok, runtime: 'failed' }), { on: false, reason: 'failed' });
  assert.deepEqual(shopWebglGate({ ...ok, runtime: undefined }), { on: false, reason: 'loading' });
});

test('spectator / stand-in / DIY keep the old bar; a rewardOffer stays in the shop', () => {
  assert.deepEqual(shopWebglGate({ ...ok, spectator: true }), { on: false, reason: 'spectator' });
  const reward = { ...PRIV, shop: { ...PRIV.shop, rewardOffer: { source: 'merge', slots: [{ kind: 'chess', id: 'x', price: 0 }] } } };
  assert.deepEqual(shopWebglGate({ ...ok, priv: reward }), { on: true, reason: null });
  assert.deepEqual(shopWebglGate({ ...ok, priv: { ...PRIV, standIns: ['chess_char_1_01_a'] } }), { on: false, reason: 'standin' });
  assert.deepEqual(shopWebglGate({ ...ok, priv: { ...PRIV, diy: { chess_char_1_01_a: { charId: 'char_1' } } } }), { on: false, reason: 'diy' });
  assert.deepEqual(shopWebglGate({ ...ok, priv: { ...PRIV, diy: {} } }), { on: true, reason: null });
});

test('reason order is fixed: theme, pack, capability, runtime, spectator, standin, diy', () => {
  assert.equal(shopWebglGate({ themeId: 'terminal', groups: {} }).reason, 'theme');
  assert.equal(shopWebglGate({ ...ok, groups: {} }).reason, 'pack');
  assert.equal(shopWebglGate({ ...ok, groups: groupsFor(['prefabs.json']) }).reason, 'capability');
  assert.equal(shopWebglGate({ ...ok, runtime: 'failed', spectator: true }).reason, 'failed');
  assert.equal(shopWebglGate({ ...ok, spectator: true, priv: { ...PRIV, standIns: ['x'] } }).reason, 'spectator');
});
