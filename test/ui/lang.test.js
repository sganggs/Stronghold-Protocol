// Controlled UI-pack completions exercise real language switching without network timing or a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getLang, onLangChange, registerLangs, setLang, setMessages, setI18nWarn, t } from '../../shared/i18n.js';

const TITLE = '卫戍协议：盟约 · STRONGHOLD PROTOCOL';
const PACKS = {
  en: { 开始: 'Start', 卫戍协议: 'Stronghold Protocol', [TITLE]: 'Stronghold Protocol: Alliance' },
  'zh-TW': { 开始: '開始', 卫戍协议: '衛戍協議', [TITLE]: '衛戍協議：盟約' },
};
const STATES = {
  zh: { lang: 'zh', text: '开始', htmlLang: 'zh-CN', dataLang: 'zh', script: 'cjk', title: TITLE },
  en: { lang: 'en', text: 'Start', htmlLang: 'en', dataLang: 'en', script: 'alphabetic', title: 'Stronghold Protocol: Alliance' },
  'zh-TW': { lang: 'zh-TW', text: '開始', htmlLang: 'zh-TW', dataLang: 'zh-TW', script: 'cjk', title: '衛戍協議：盟約' },
};
const INDEX = { version: 1, packs: Object.keys(PACKS).map((code) => ({
  id: code, type: 'lang', lang: code, name: code, files: { ui: `/i18n/${code}.json` },
})) };
const turn = () => new Promise((resolve) => setImmediate(resolve));
let imports = 0;

async function setup(ctx, preference = null, address = 'https://example.test/') {
  const previous = new Map(['document', 'localStorage', 'fetch', 'location', 'history'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const stored = new Map(preference ? [['sp.pref.lang', JSON.stringify(preference)]] : []);
  const doc = { documentElement: { lang: 'zh-CN', dataset: { lang: 'zh', script: 'cjk' } }, title: TITLE };
  const pending = new Map();
  const calls = [];
  globalThis.document = doc;
  globalThis.localStorage = { getItem: (key) => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
  globalThis.location = new URL(address);
  globalThis.history = {
    state: null,
    replaceState(state, _title, relative) {
      this.state = state;
      globalThis.location.href = new URL(relative, globalThis.location.href).href;
    },
  };
  globalThis.fetch = (url) => {
    calls.push(url);
    const request = Promise.withResolvers();
    if (!pending.has(url)) pending.set(url, []);
    pending.get(url).push(request);
    return request.promise;
  };
  const warnings = [];
  ctx.mock.method(console, 'warn', (message) => warnings.push(message));
  registerLangs(Object.keys(PACKS).map((code) => ({ code, fallback: [], base: null, data: false, ui: `/i18n/${code}.json` })));
  setLang('zh');
  for (const code of Object.keys(PACKS)) setMessages(code, {});
  const url = new URL('../../public/js/ui/lang.js', import.meta.url);
  url.searchParams.set('test', String(++imports));
  const lang = await import(url.href);
  ctx.after(() => {
    setLang('zh');
    setI18nWarn(null);
    for (const code of Object.keys(PACKS)) setMessages(code, {});
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const finish = (path, body, status = 200) => {
    const request = pending.get(path)?.shift();
    assert.ok(request, `a request is pending for ${path}`);
    request.resolve({ ok: status === 200, status, json: async () => body });
  };
  const state = (code, saved = code) => assert.deepEqual({
    lang: getLang(), text: t('开始'), htmlLang: doc.documentElement.lang, dataLang: doc.documentElement.dataset.lang,
    script: doc.documentElement.dataset.script, title: doc.title, saved: stored.get('sp.pref.lang') ?? null,
  }, { ...STATES[code], saved: saved == null ? null : JSON.stringify(saved) });
  return {
    ...lang, calls, warnings, state,
    finish: (code, status = 200) => finish(`/i18n/${code}.json`, PACKS[code], status),
    finishIndex: () => finish('/packs/index.json', INDEX),
  };
}

test('a delayed language cannot overwrite the later successful selection', async (ctx) => {
  const h = await setup(ctx);
  const first = h.switchLang('en');
  const latest = h.switchLang('zh-TW');
  h.finish('zh-TW');
  assert.equal(await latest, 'zh-TW');
  h.state('zh-TW');
  h.finish('en');
  assert.equal(await first, 'zh-TW');
  h.state('zh-TW');
});

test('selecting the default language invalidates a pending pack', async (ctx) => {
  const h = await setup(ctx);
  const first = h.switchLang('en');
  assert.equal(await h.switchLang('zh'), 'zh');
  h.state('zh');
  h.finish('en');
  assert.equal(await first, 'zh');
  h.state('zh');
});

test('reselecting the current language cancels a different pending selection and uses its cached pack', async (ctx) => {
  const h = await setup(ctx);
  const initial = h.switchLang('zh-TW');
  h.finish('zh-TW');
  await initial;
  const pending = h.switchLang('en');
  await h.switchLang('zh-TW');
  h.finish('en');
  await pending;
  h.state('zh-TW');
  assert.deepEqual(h.calls, ['/i18n/zh-TW.json', '/i18n/en.json']);
});

test('A, B, A shares the in-flight A pack and applies only the latest selection', async (ctx) => {
  const h = await setup(ctx);
  const changes = [];
  ctx.after(onLangChange((code) => changes.push(code)));
  const first = h.switchLang('en');
  const middle = h.switchLang('zh-TW');
  const latest = h.switchLang('en');
  h.finish('zh-TW');
  await middle;
  h.state('zh', 'en');
  h.finish('en');
  await Promise.all([first, latest]);
  h.state('en');
  assert.deepEqual(changes, ['en']);
  await h.switchLang('en');
  assert.deepEqual(h.calls, ['/i18n/en.json', '/i18n/zh-TW.json']);
  assert.deepEqual(changes, ['en'], 'repeated successful selections do not notify a language change');
});

test('a failed latest request retains the successful interface, rejects stale success, and can retry', async (ctx) => {
  const h = await setup(ctx);
  const first = h.switchLang('en');
  const latest = h.switchLang('zh-TW');
  h.finish('zh-TW', 503);
  assert.equal(await latest, 'zh');
  h.state('zh', 'zh-TW');
  assert.equal(h.warnings.length, 1);
  assert.match(h.warnings[0], /HTTP 503.*interface stays as it is/);
  h.finish('en');
  await first;
  h.state('zh', 'zh-TW');
  const retry = h.switchLang('zh-TW');
  h.finish('zh-TW');
  await retry;
  h.state('zh-TW');
  await h.switchLang('en');
  h.state('en');
  assert.deepEqual(h.calls, ['/i18n/en.json', '/i18n/zh-TW.json', '/i18n/zh-TW.json'], 'failed loads retry; stale successful packs remain cached');
});

test('startup applies the stored language after its pack is ready', async (ctx) => {
  const h = await setup(ctx, 'en');
  ctx.mock.method(globalThis, 'setTimeout', () => 0);
  const boot = h.initLang();
  h.finishIndex();
  await turn();
  h.finish('en');
  assert.equal(await boot, 'en');
  h.state('en');
});

test('startup cannot overwrite a newer switch before the boot timeout', async (ctx) => {
  const h = await setup(ctx, 'en');
  ctx.mock.method(globalThis, 'setTimeout', () => 0);
  const boot = h.initLang();
  h.finishIndex();
  await turn();
  const latest = h.switchLang('zh-TW');
  h.finish('zh-TW');
  await latest;
  h.finish('en');
  await boot;
  h.state('zh-TW');
});

test('a delayed startup index cannot restore the URL choice after a newer selection', async (ctx) => {
  const h = await setup(ctx, null, 'https://example.test/play?room=alliance&lang=en#settings');
  ctx.mock.method(globalThis, 'setTimeout', () => 0);
  const boot = h.initLang();
  const latest = h.switchLang('zh-TW');
  h.finish('zh-TW');
  await latest;
  h.finishIndex();
  await turn();
  h.state('zh-TW');
  assert.equal(await boot, 'zh-TW');
  assert.deepEqual(h.calls, ['/packs/index.json', '/i18n/zh-TW.json']);
  assert.equal(globalThis.location.href, 'https://example.test/play?room=alliance#settings');
  assert.deepEqual(h.initialLang(), { lang: 'zh-TW', fromUrl: false }, 'reload uses the newer saved choice');
});

test('timed-out startup applies its pack later when the selection has not changed', async (ctx) => {
  const h = await setup(ctx, 'en');
  let timeout;
  ctx.mock.method(globalThis, 'setTimeout', (fn) => { timeout = fn; return 0; });
  const boot = h.initLang();
  h.finishIndex();
  await turn();
  timeout();
  assert.equal(await boot, 'zh');
  h.state('zh', 'en');
  h.finish('en');
  await turn();
  h.state('en');
});

test('timed-out startup cannot overwrite a newer default selection', async (ctx) => {
  const h = await setup(ctx, 'en');
  let timeout;
  ctx.mock.method(globalThis, 'setTimeout', (fn) => { timeout = fn; return 0; });
  const boot = h.initLang();
  h.finishIndex();
  await turn();
  timeout();
  await boot;
  await h.switchLang('zh');
  h.finish('en');
  await turn();
  h.state('zh');
});
