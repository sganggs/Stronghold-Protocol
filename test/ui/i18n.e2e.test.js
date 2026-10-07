// Browser check of the language switch (puppeteer-core + system Chrome; opt-in: SP_E2E=1, ~20 s):
//
//   SP_E2E=1 node --test test/ui/i18n.e2e.test.js
//
// The title screen opens in Chinese; 中文 | English → English in place (no reload): the title, the start button, the
// connection line, <html lang>, the tab title; the choice is kept across a reload (localStorage sp.pref.lang) and the
// game-data overlay (data/i18n/en.json) is applied; `?lang=zh` switches back and leaves the address bar. Language packs
// (docs/I18N.md "Adding a language", docs/PACKS.md): a pack file dropped into public/i18n/ and a pack folder dropped
// into packs/ while the server runs show in the menu and switch, with English filling what they lack; a removed pack
// sends a stored choice back to Chinese. The shipped Japanese, Korean and Traditional Chinese packs (the owner's decisions of
// 2026-10-07) switch to their official game texts and their own UI strings (what a pack lacks shows its fallback: English
// for ja / ko, the Simplified Chinese for zh-TW); a pack marked `machineTranslated` says so in 设置 (none in Chinese).
// With more than four languages the menu is a list (ui/lang.js SEGMENTED_MAX): the helpers read and pick either form.
// No console / page / request errors. docs/I18N.md.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHROME, hasChrome, sleep } from '../e2e/client.mjs';
import { NAME_MAX_LEN } from '../../shared/constants.js';

const ENABLED = process.env.SP_E2E === '1' && hasChrome();
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// example packs, only for this test ('qaa' … 'qtz' are the ISO 639 codes reserved for local use); removed afterwards
const PACK_FILE = path.join(ROOT, 'public/i18n/qaa.json');
const PACK_DIR = path.join(ROOT, 'packs/qab');
const removePacks = () => { fs.rmSync(PACK_FILE, { force: true }); fs.rmSync(PACK_DIR, { recursive: true, force: true }); };

describe('language switch on the title screen', { skip: !ENABLED && 'set SP_E2E=1 (Chrome)' }, () => {
  let srv;
  let browser;
  let base;
  before(async () => {
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    base = `http://127.0.0.1:${srv.port}`;
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox', '--force-device-scale-factor=1'] });
  });
  after(async () => { removePacks(); await browser?.close(); await srv?.close(); });

  const text = (page, sel) => page.$eval(sel, (el) => el.textContent.replace(/\s+/g, ' ').trim());
  /** The menu's languages, [code, label] — its buttons, or the options of its list. */
  const menu = (page) => page.$$eval('[data-testid="lang-toggle"] button, [data-testid="lang-toggle"] option',
    (els) => els.map((e) => [e.dataset.lang ?? e.value, e.textContent.trim()]));
  /** Pick a language: its button, or its option in the list. */
  const pick = async (page, code) => {
    if (await page.$('[data-testid="lang-toggle"] select')) await page.select('[data-testid="lang-toggle"] select', code);
    else await page.click(`[data-testid="lang-toggle"] button[data-lang="${code}"]`);
  };
  const SHIPPED = [['zh', '中文'], ['en', 'English'], ['ja', '日本語'], ['ko', '한국어'], ['zh-TW', '繁體中文']];
  const pack = (code) => JSON.parse(fs.readFileSync(path.join(ROOT, `public/i18n/${code}.json`), 'utf8'));
  /** What a shipped pack shows for a msgid: its own string, else its fallbacks' (English for ja / ko), else the Chinese msgid. */
  const uiText = (code, msgid) => {
    const own = pack(code);
    for (const p of [own, ...(own._meta?.fallback || []).map(pack)]) if (typeof p[msgid] === 'string' && p[msgid]) return p[msgid];
    return msgid;
  };
  const MT_NOTE = '当前语言的界面文字为机器翻译，可能不够准确，欢迎在 GitHub 上指正。';
  /** The note under the language switch in 设置 (null when there is none); the dialog opens from the title screen and closes. */
  const settingsNote = async (page) => {
    await page.click('.title-settings');
    await page.waitForSelector('.modal .set-list');
    const note = await page.$eval('.modal [data-testid="lang-mt-note"]', (el) => el.textContent.trim()).catch(() => null);
    await page.click('.modal__actions .btn--primary'); // 完成 (an Esc right after the dialog shows may beat its key listener)
    await page.waitForSelector('.modal', { hidden: true });
    return note;
  };
  /** A game text of a shipped pack's overlay (data/i18n/<code>.json; a leaf is a string or { _s }). */
  const gameText = (code) => { const v = JSON.parse(fs.readFileSync(path.join(ROOT, `data/i18n/${code}.json`), 'utf8')).files.config.modes.mode_multi_abyss.name; return typeof v === 'string' ? v : v._s; };

  test('中文 by default; English in place, kept across a reload; ?lang=zh back to Chinese', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900 });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400 && !/fonts\.(googleapis|gstatic)/.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
    await page.goto(`${base}/`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.title-screen [data-testid="lang-toggle"]');
    assert.equal(await text(page, '.title-cn'), '卫戍协议：盟约');
    assert.equal(await text(page, '.title-login .btn--primary'), '开始');
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'zh-CN');

    assert.deepEqual(await menu(page), SHIPPED, 'the shipped languages');
    await pick(page, 'en');
    await page.waitForFunction(() => document.querySelector('.title-cn')?.textContent.includes('Stronghold Protocol'), { timeout: 8000 });
    assert.equal(await text(page, '.title-cn'), 'Stronghold Protocol: Alliance');
    assert.equal(await text(page, '.title-login .btn--primary'), 'Start');
    assert.match(await text(page, '.title-tag'), /^Allocate Funds and Operators/);
    assert.match(await text(page, '.title-conn'), /Connect|Ready to connect/);
    assert.equal(await page.$eval('.title-login input', (el) => el.placeholder), `Callsign (max ${NAME_MAX_LEN} chars)`);
    assert.deepEqual(await page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, pref: localStorage.getItem('sp.pref.lang') })),
      { lang: 'en', title: 'Stronghold Protocol: Alliance · Web Simulation', pref: '"en"' });
    // the game texts follow (data/i18n/en.json applied by data.js)
    await page.waitForFunction(() => globalThis.__SP__?.data?.locale() === 'en', { timeout: 8000 });
    assert.equal(await page.evaluate(() => globalThis.__SP__.data.get('config').modes.mode_multi_abyss.name), 'Ultimate Simulation');

    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForSelector('.title-screen .title-cn');
    assert.equal(await text(page, '.title-cn'), 'Stronghold Protocol: Alliance', 'the choice survives a reload');
    assert.equal(await text(page, '.title-login .btn--primary'), 'Start');

    await page.goto(`${base}/?lang=zh`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.title-screen .title-cn');
    await sleep(200);
    assert.equal(await text(page, '.title-cn'), '卫戍协议：盟约');
    assert.equal(await page.evaluate(() => location.search), '', '?lang is removed from the address bar');
    assert.equal(await page.evaluate(() => localStorage.getItem('sp.pref.lang')), '"zh"');
    assert.deepEqual(problems, []);
    await page.close();
  });
  test('a pack dropped into the language folder or into packs/ shows in the menu and switches; English fills its gaps', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900 });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400 && !/fonts\.(googleapis|gstatic)/.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
    try {
      fs.writeFileSync(PACK_FILE, JSON.stringify({ _meta: { name: 'Testisch', englishName: 'Test language', fallback: ['en'] }, 卫戍协议: 'Testprotokoll', 盟约: 'Bund', 开始: 'Los' }));
      fs.mkdirSync(PACK_DIR, { recursive: true });
      fs.writeFileSync(path.join(PACK_DIR, 'pack.json'), JSON.stringify({ type: 'lang', lang: 'qab', name: 'Qabisch', files: { ui: 'ui.json' } }));
      fs.writeFileSync(path.join(PACK_DIR, 'ui.json'), JSON.stringify({ 开始: 'Qab-Start' }));
      await sleep(1100); // the server's registry looks at the folders again after a second
      await page.goto(`${base}/?lang=zh`, { waitUntil: 'networkidle0' });
      await page.waitForFunction(() => [...document.querySelectorAll('.title-screen [data-testid="lang-toggle"] :is(button, option)')].some((e) => (e.dataset.lang ?? e.value) === 'qaa'), { timeout: 8000 });
      assert.deepEqual(await menu(page), [...SHIPPED.slice(0, 4), ['qaa', 'Testisch'], ['qab', 'Qabisch'], SHIPPED[4]]);

      await pick(page, 'qaa');
      await page.waitForFunction(() => document.querySelector('.title-login .btn--primary')?.textContent.includes('Los'), { timeout: 8000 });
      assert.equal(await text(page, '.title-cn'), 'Testprotokoll: Bund', 'an alphabetic title: the display face, an ASCII colon');
      assert.match(await text(page, '.title-tag'), /^Allocate Funds and Operators/, 'untranslated: English, the pack\'s fallback');
      assert.deepEqual(await page.evaluate(() => ({ lang: document.documentElement.lang, script: document.documentElement.dataset.script, pref: localStorage.getItem('sp.pref.lang') })),
        { lang: 'qaa', script: 'alphabetic', pref: '"qaa"' });
      // no game texts of its own: English's through the chain
      await page.waitForFunction(() => globalThis.__SP__?.data?.locale() === 'qaa', { timeout: 8000 });
      assert.equal(await page.evaluate(() => globalThis.__SP__.data.get('config').modes.mode_multi_abyss.name), 'Ultimate Simulation');

      await pick(page, 'qab');
      await page.waitForFunction(() => document.querySelector('.title-login .btn--primary')?.textContent.includes('Qab-Start'), { timeout: 8000 });
      assert.equal(await text(page, '.title-cn'), '卫戍协议：盟约', 'no fallback declared: the Chinese msgid');

      await pick(page, 'qaa');
      await page.waitForFunction(() => document.querySelector('.title-login .btn--primary')?.textContent.includes('Los'), { timeout: 8000 });
      removePacks();
      await sleep(1100);
      await page.reload({ waitUntil: 'networkidle0' });
      await page.waitForSelector('.title-screen .title-cn');
      assert.equal(await text(page, '.title-cn'), '卫戍协议：盟约', 'the stored pack is gone: Chinese');
      assert.deepEqual(await menu(page), SHIPPED);
      assert.deepEqual(problems, []);
    } finally {
      removePacks();
      await page.close();
    }
  });
  test('the shipped 日本語 / 한국어 / 繁體中文 packs: the official game texts, their UI strings, the 设置 note of a machine-translated pack', async () => {
    const page = await browser.newPage();
    await page.setViewport({ width: 1600, height: 900 });
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400 && !/fonts\.(googleapis|gstatic)/.test(r.url())) problems.push(`http ${r.status()}: ${r.url()}`); });
    await page.goto(`${base}/?lang=zh`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.title-screen [data-testid="lang-toggle"]');
    assert.equal(await settingsNote(page), null, 'Chinese: no machine-translation note');
    for (const code of ['ja', 'ko', 'zh-TW']) {
      await pick(page, code);
      await page.waitForFunction((c) => globalThis.__SP__?.data?.locale() === c, { timeout: 8000 }, code);
      assert.equal(await page.evaluate(() => globalThis.__SP__.data.get('config').modes.mode_multi_abyss.name), gameText(code), `${code}: the official game text`);
      assert.equal(await text(page, '.title-login .btn--primary'), uiText(code, '开始'), `${code}: the UI`);
      assert.equal(await page.evaluate(() => document.documentElement.lang), code);
      assert.equal(await settingsNote(page), pack(code)._meta.machineTranslated === true ? uiText(code, MT_NOTE) : null, `${code}: the 设置 note`);
    }
    assert.equal(uiText('zh-TW', '开始'), '開始', 'zh-TW: its own Traditional Chinese UI');
    assert.deepEqual(problems, []);
    await page.close();
  });

  // Hold only UI pack fetches; the real loader, cache, Preact menu and document updates still run.
  const holdPacks = (page, codes) => page.evaluate((held) => {
    const fetch = globalThis.fetch.bind(globalThis);
    globalThis.languageRequests = {};
    const gates = Object.fromEntries(held.map((code) => {
      let release;
      const ready = new Promise((resolve) => { release = resolve; });
      return [code, { ready, release }];
    }));
    globalThis.releaseLanguage = async (code, ok) => {
      const { loadLangChain } = await import('/js/ui/lang.js');
      const settled = loadLangChain(code);
      gates[code].release(ok);
      await settled;
      await new Promise(requestAnimationFrame);
    };
    globalThis.fetch = (url, ...args) => {
      const code = held.find((c) => url === `/i18n/${c}.json`);
      if (!code) return fetch(url, ...args);
      globalThis.languageRequests[code] = (globalThis.languageRequests[code] || 0) + 1;
      return gates[code].ready.then((ok) => ok ? fetch(url, ...args) : new Response('', { status: 503 }));
    };
  }, codes);
  const waitForPack = (page, code) => page.waitForFunction((c) => globalThis.languageRequests[c] > 0, {}, code);
  const releasePack = (page, code, ok = true) => page.evaluate((c, success) => globalThis.releaseLanguage(c, success), code, ok);
  const languageState = (page) => page.evaluate(async () => ({
    current: (await import('/shared/i18n.js')).getLang(),
    document: document.documentElement.lang,
    dataLang: document.documentElement.dataset.lang,
    script: document.documentElement.dataset.script,
    title: document.title,
    start: document.querySelector('.title-login .btn--primary').textContent.trim(),
    selected: document.querySelector('[data-testid="lang-toggle"] select').value,
    saved: JSON.parse(localStorage.getItem('sp.pref.lang')),
  }));
  const expectedLanguage = {
    zh: { current: 'zh', document: 'zh-CN', dataLang: 'zh', script: 'cjk', title: '卫戍协议：盟约 · STRONGHOLD PROTOCOL', start: '开始', selected: 'zh', saved: 'zh' },
    en: { current: 'en', document: 'en', dataLang: 'en', script: 'alphabetic', title: 'Stronghold Protocol: Alliance · Web Simulation', start: 'Start', selected: 'en', saved: 'en' },
    'zh-TW': { current: 'zh-TW', document: 'zh-TW', dataLang: 'zh-TW', script: 'cjk', title: '衛戍協議：盟約 · STRONGHOLD PROTOCOL', start: '開始', selected: 'zh-TW', saved: 'zh-TW' },
  };

  test('a late English pack cannot overwrite a newer Traditional Chinese selection; its cache remains reusable', async (t) => {
    const page = await browser.newPage();
    t.after(() => page.close());
    await page.goto(`${base}/?lang=zh`, { waitUntil: 'networkidle0' });
    await holdPacks(page, ['en']);
    await pick(page, 'en');
    await waitForPack(page, 'en');
    await pick(page, 'zh-TW');
    await page.waitForFunction(() => document.documentElement.lang === 'zh-TW');
    await releasePack(page, 'en');
    assert.deepEqual(await languageState(page), expectedLanguage['zh-TW']);
    await pick(page, 'en');
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    assert.deepEqual(await languageState(page), expectedLanguage.en);
    assert.equal(await page.evaluate(() => globalThis.languageRequests.en), 1, 'the stale pack was cached');
  });

  test('selecting the displayed default language cancels a pending pack', async (t) => {
    const page = await browser.newPage();
    t.after(() => page.close());
    await page.goto(`${base}/?lang=zh`, { waitUntil: 'networkidle0' });
    await holdPacks(page, ['en']);
    await pick(page, 'en');
    await waitForPack(page, 'en');
    assert.equal(await page.$eval('[data-testid="lang-toggle"] select', (el) => el.value), 'en', 'the native menu can still change back to Chinese');
    assert.equal(await page.$eval('[data-testid="lang-toggle"] select', (el) => el.disabled), false);
    await pick(page, 'zh');
    await releasePack(page, 'en');
    assert.deepEqual(await languageState(page), expectedLanguage.zh);
  });

  test('repeated selections reuse a pending pack and still supersede an intervening selection', async (t) => {
    const page = await browser.newPage();
    t.after(() => page.close());
    await page.goto(`${base}/?lang=zh`, { waitUntil: 'networkidle0' });
    await holdPacks(page, ['en', 'zh-TW']);
    await pick(page, 'en');
    await waitForPack(page, 'en');
    await pick(page, 'en');
    await pick(page, 'zh-TW');
    await waitForPack(page, 'zh-TW');
    await pick(page, 'en');
    await releasePack(page, 'en');
    assert.deepEqual(await languageState(page), expectedLanguage.en);
    await releasePack(page, 'zh-TW');
    assert.deepEqual(await languageState(page), expectedLanguage.en);
    assert.equal(await page.evaluate(() => globalThis.languageRequests.en), 1);
  });

  test('a failed latest selection keeps the last successful UI and menu; an older pack stays stale', async (t) => {
    const page = await browser.newPage();
    t.after(() => page.close());
    await page.goto(`${base}/?lang=zh`, { waitUntil: 'networkidle0' });
    await holdPacks(page, ['en', 'zh-TW']);
    await pick(page, 'en');
    await waitForPack(page, 'en');
    await pick(page, 'zh-TW');
    await waitForPack(page, 'zh-TW');
    await releasePack(page, 'zh-TW', false);
    const unchanged = { ...expectedLanguage.zh, saved: 'zh-TW' };
    assert.deepEqual(await languageState(page), unchanged, 'failed preference stays saved, as before');
    await releasePack(page, 'en');
    assert.deepEqual(await languageState(page), unchanged);
  });

  test('a stale failure leaves a newer pending dropdown selection intact', async (t) => {
    const page = await browser.newPage();
    t.after(() => page.close());
    await page.goto(`${base}/?lang=zh`, { waitUntil: 'networkidle0' });
    await holdPacks(page, ['en', 'zh-TW']);
    await pick(page, 'en');
    await waitForPack(page, 'en');
    await pick(page, 'zh-TW');
    await waitForPack(page, 'zh-TW');
    await releasePack(page, 'en', false);
    assert.deepEqual(await languageState(page), { ...expectedLanguage.zh, saved: 'zh-TW', selected: 'zh-TW' });
    await releasePack(page, 'zh-TW');
    assert.deepEqual(await languageState(page), expectedLanguage['zh-TW']);
  });
});
