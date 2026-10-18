// Personal themes and notice views use synthetic catalogue data, without a browser or listening port.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createStore } from '../../public/js/store.js';
import { createDataStore } from '../../public/js/data.js';
import { createCosmeticLayers } from '../../public/js/assets.js';
import { installContent, catalog, personal, setPersonalPlugin, cosmeticPlugins, isPersonalCosmetic, personalSet, loadPluginOrder, pluginName, installedCount } from '../../public/js/content.js';
import { noticeView, markSeen } from '../../shared/plugins/notices.js';
import { resolveThemeVars, themeVarsOf } from '../../shared/plugins/theme.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('personal theme switches apply by id, restore the previous winner and defaults, and send nothing', async () => {
  const previousDoc = globalThis.document;
  const values = new Map();
  globalThis.document = { documentElement: { style: {
    setProperty: (name, value) => values.set(name, value), removeProperty: (name) => values.delete(name),
  } } };
  const entries = [
    { id: 'z-night', class: 'cosmetic', status: 'loaded', scope: ['personal'], loadBefore: ['a-day'], theme: { vars: { '--text-hi': '#abc', '--line': '#123' } } },
    { id: 'a-day', class: 'cosmetic', status: 'loaded', scope: ['personal'], theme: { vars: { '--text-hi': '#fff' } } },
    { id: 'room-only', class: 'cosmetic', status: 'loaded', scope: ['room'], theme: { vars: { '--bg-0': '#fff' } } },
  ];
  const asked = [];
  const fetch = async (url) => { asked.push(url); return { ok: true, json: async () => ({ plugins: entries }) }; };
  catalog.set({ status: 'idle', plugins: [], at: 0 });
  personal.set({ ids: [] });
  const app = createStore({ installedPlugins: 3, room: null });
  let off;
  try {
    off = installContent({ store: app, data: createDataStore({ fetch }), layers: createCosmeticLayers(), fetch });
    assert.deepEqual(asked, []);
    personal.set({ ids: ['a-day', 'z-night', 'room-only'] });
    await settle();
    assert.equal(values.get('--text-hi'), '#abc', 'id order wins even against loadBefore');
    assert.equal(values.get('--line'), '#123');
    assert.equal(values.has('--bg-0'), false, 'a room theme is never applied');
    setPersonalPlugin('z-night', false);
    await settle();
    assert.equal(values.get('--text-hi'), '#fff');
    assert.equal(values.has('--line'), false);
    personal.set({ ids: [] });
    assert.equal(values.size, 0, 'the last switch off restores root defaults synchronously');
    assert.deepEqual(asked, ['/plugins/index.json'], 'theme-only plugins fetch no overlay and send no intent');
  } finally {
    off?.(); personal.set({ ids: [] }); catalog.set({ status: 'idle', plugins: [], at: 0 });
    if (previousDoc === undefined) delete globalThis.document; else globalThis.document = previousDoc;
  }
});

test('notice popup data: absent on vanilla, newest first, translated, plain text and unread persisted', () => {
  assert.deepEqual(noticeView([], 'en', new Set()), { notices: [], unread: false });
  const plugins = [
    { id: 'one', name: 'One', status: 'loaded', notices: [
      { id: 'old', title: 'Old', body: 'Older', date: '2025-01-01' },
      { id: 'new', title: 'New', body: 'First\n<b>literal</b> https://example.test', date: '2026-10-17', i18n: { ja: { title: 'Translated', body: 'Line one\nLine two' } } },
    ] },
    { id: 'off', status: 'disabled', notices: [{ id: 'off', title: 'Hidden', body: 'Hidden' }] },
  ];
  const view = noticeView(plugins, 'ja', new Set());
  assert.deepEqual(view.notices.map((n) => n.id), ['new', 'old']);
  assert.equal(view.notices[0].title, 'Translated');
  assert.equal(view.notices[0].pluginName, 'One');
  assert.equal(noticeView(plugins, 'zh', new Set()).notices[0].body, 'First\n<b>literal</b> https://example.test');
  let saved;
  const storage = { getItem: () => saved ?? null, setItem: (_key, value) => { saved = value; } };
  const seen = markSeen(view.notices.map((n) => n.key), storage);
  assert.equal(noticeView(plugins, 'ja', seen).unread, false);
  assert.deepEqual(JSON.parse(saved), ['one/new', 'one/old']);
});

test('notice-only personal dependencies activate themes and still participate in conflict checks', async () => {
  const previousDoc = globalThis.document;
  const values = new Map();
  globalThis.document = { documentElement: { style: {
    setProperty: (name, value) => values.set(name, value), removeProperty: (name) => values.delete(name),
  } } };
  const entries = [
    { id: 'notice-base', version: '1.0.0', class: 'cosmetic', status: 'loaded', scope: ['personal'], conflicts: { rival: '*' }, notices: [{ id: 'n', title: 'T', body: 'B' }] },
    { id: 'dependent', class: 'cosmetic', status: 'loaded', scope: ['personal'], requires: { 'notice-base': '*' }, theme: { vars: { '--text-hi': '#abc' } } },
    { id: 'rival', version: '1.0.0', class: 'cosmetic', status: 'loaded', scope: ['personal'], theme: { vars: { '--line': '#123' } } },
  ];
  const asked = [];
  const fetch = async (url) => { asked.push(url); return { ok: true, json: async () => ({ plugins: entries }) }; };
  catalog.set({ status: 'idle', plugins: [], at: 0 });
  personal.set({ ids: [] });
  let off;
  try {
    off = installContent({ store: createStore({ installedPlugins: 3, room: null }), data: createDataStore({ fetch }), layers: createCosmeticLayers(), fetch });
    personal.set({ ids: ['dependent'] });
    await settle();
    assert.equal(values.get('--text-hi'), '#abc', 'a hidden dependency must remain in the lookup');
    assert.deepEqual(cosmeticPlugins(catalog.get().plugins, 'personal').filter(isPersonalCosmetic).map((p) => p.id), ['dependent', 'rival']);
    personal.set({ ids: ['rival'] });
    await settle();
    assert.ok('error' in setPersonalPlugin('dependent', true), 'dependency conflicts are checked before saving');
    assert.deepEqual(personal.get().ids, ['rival']);
    assert.deepEqual(asked, ['/plugins/index.json'], 'hidden and theme-only dependencies fetch no overlays');
  } finally {
    off?.(); personal.set({ ids: [] }); catalog.set({ status: 'idle', plugins: [], at: 0 });
    if (previousDoc === undefined) delete globalThis.document; else globalThis.document = previousDoc;
  }
});

test('the client independently bounds catalogue themes and notices', async () => {
  const previousDoc = globalThis.document;
  const values = new Map();
  globalThis.document = { documentElement: { style: {
    setProperty: (name, value) => values.set(name, value), removeProperty: (name) => values.delete(name),
  } } };
  const entries = [{ id: 'untrusted', class: 'cosmetic', status: 'loaded', scope: ['personal'], theme: { vars: { '--t-fast': '0'.repeat(400) + 's', '--text-hi': '#abc' } } }];
  const fetch = async () => ({ ok: true, json: async () => ({ plugins: entries }) });
  catalog.set({ status: 'idle', plugins: [], at: 0 });
  personal.set({ ids: [] });
  let off;
  try {
    off = installContent({ store: createStore({ installedPlugins: 1, room: null }), data: createDataStore({ fetch }), layers: createCosmeticLayers(), fetch });
    personal.set({ ids: ['untrusted'] });
    await settle();
    assert.equal(values.get('--text-hi'), '#abc');
    assert.equal(values.has('--t-fast'), false);
    const view = noticeView([
      { id: 'hostile', notices: [{ id: 'fat', title: 'T', body: 'x'.repeat(50 * 1024), date: '9999-12-31' }] },
      { id: 'normal', notices: [{ id: 'normal', title: 'T', body: 'B' }] },
    ], 'en', new Set());
    assert.deepEqual(view.notices.map((n) => n.key), ['normal/normal']);
  } finally {
    off?.(); personal.set({ ids: [] }); catalog.set({ status: 'idle', plugins: [], at: 0 });
    if (previousDoc === undefined) delete globalThis.document; else globalThis.document = previousDoc;
  }
});

test('settings renders a dependent theme as active while keeping its notice-only dependency hidden', async () => {
  await loadPluginOrder();
  const plugins = [
    { id: 'notice-base', class: 'cosmetic', status: 'loaded', scope: ['personal'], notices: [{ id: 'n', title: 'T', body: 'B' }] },
    { id: 'dependent', class: 'cosmetic', status: 'loaded', scope: ['personal'], requires: { 'notice-base': '*' }, theme: { vars: { '--text-hi': '#abc' } } },
  ];
  // Evaluate our component with inert hooks and a text renderer, so its real dependency and warning paths run
  // without loading the complete browser UI or opening a port.
  const source = fs.readFileSync(new URL('../../public/js/ui/settings.js', import.meta.url), 'utf8');
  const start = source.indexOf('function CosmeticSection() {');
  const component = source.slice(start, source.indexOf('\n/**', start));
  const rendered = vm.runInNewContext(`(${component})()`, {
    catalog: { get: () => ({ plugins }) }, personal: { get: () => ({ ids: ['dependent'] }) },
    useStore: (select, _equal, store) => select(store ? store.get() : { installedPlugins: 2 }), useEffect() {},
    loadCatalog() {}, cosmeticPlugins, isPersonalCosmetic, personalSet, resolveThemeVars, themeVarsOf, installedCount, pluginName,
    pluginMicro: (p) => p.id, MicroLabel: 'span',
    // the 显示其他玩家的皮肤 row (PR #686) sits in the same section: inert here
    useSettings: () => ({ otherSkins: true }), updateSettings() {}, OtherSkinsRow: 'span', hasAnySkinChoices: () => false,
    html: (strings, ...values) => strings.reduce((out, text, i) => out + text + (values[i] ?? ''), ''),
    t: (text, params = {}) => text.replace(/\{(\w+)\}/g, (_all, key) => params[key] ?? ''), tc: (_context, text) => text,
  });
  assert.match(rendered, /--text-hi/, 'the effective winner is shown');
  assert.match(rendered, /aria-checked=true/);
  assert.doesNotMatch(rendered, /data-plugin=notice-base/);
  assert.doesNotMatch(rendered, /is-warn/, 'the hidden dependency must not produce a missing-requirement warning');
});
