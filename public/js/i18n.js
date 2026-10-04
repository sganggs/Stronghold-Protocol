// Browser side of the display language (shared/i18n.js): 中文 (the source language of the game data and the UI
// texts) or English (the { zh: en } dictionary /i18n/en.json).
//
// The language is chosen once per page load: the saved preference (`sp.pref.lang`, set by the title screen switch),
// else the browser's language list (first zh / en entry), else 中文. Switching reloads the page (setLang), so the
// dictionary is loaded by this module's top-level await before any module importing it runs: module-level label
// tables may call T() directly. (Named T, not t: `t` is a common local name — event, time, tile… — in this code.)
//
// `T(zh, ...args)` is a UI text (Chinese source, `{0}` slots filled with args), `tr(s)` translates one known data
// string (names, descriptions, ticker templates…), `trDeep(v)` a whole JSON value. data.js passes every display data
// file through trDeep; main.js does the same for the server's m.* pushes. The battle simulation (battle/runner.js
// loadBrowserSim) fetches its own untranslated copy of the data: its rules read the official Chinese texts. In 中文
// mode, under Node (tests) or when the dictionary is missing, all three return their (formatted) input.

import { createTranslator, translateDeep, formatText } from '../../shared/i18n.js';

/** Supported display languages; the first one is the fallback. */
export const LANGS = Object.freeze(['zh', 'en']);
const PREF_KEY = 'sp.pref.lang';

/**
 * The display language: a saved choice wins, else the first zh / en entry of the browser's language list, else 中文.
 * @param {{ saved?: any, languages?: readonly string[] }} [env]
 * @returns {'zh'|'en'}
 */
export function resolveLang({ saved = readSaved(), languages = browserLanguages() } = {}) {
  if (LANGS.includes(saved)) return saved;
  for (const l of languages || []) {
    const code = String(l || '').toLowerCase();
    if (code === 'zh' || code.startsWith('zh-')) return 'zh';
    if (code === 'en' || code.startsWith('en-')) return 'en';
  }
  return 'zh';
}

function readSaved() {
  try {
    const raw = globalThis.localStorage?.getItem(PREF_KEY);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

function browserLanguages() {
  const nav = globalThis.navigator;
  if (!nav) return [];
  return Array.isArray(nav.languages) && nav.languages.length ? nav.languages : [nav.language].filter(Boolean);
}

let current = createTranslator(null);

/** @param {any} s */
export const tr = (s) => current(s);
/**
 * @template T @param {T} v
 * @param {{ skip?: (path: (string|number)[], parent: any) => boolean }} [opts] subtrees kept as is (shared/i18n.js)
 * @returns {T}
 */
export const trDeep = (v, opts) => (current.size ? translateDeep(v, current, opts) : v);
/**
 * A UI text: the Chinese source `zh` in the display language, `{0}`, `{1}`… replaced by `args`.
 * @param {string} zh
 * @param {...any} args
 */
export const T = (zh, ...args) => formatText(current(zh), args);

/**
 * T with a disambiguating context, for a Chinese text that needs two English renderings (关闭 = Close / Off): the
 * dictionary key is `ctx` + U+0004 + `zh`; without such an entry the plain text is used.
 * @param {string} ctx
 * @param {string} zh
 * @param {...any} args
 */
export const TC = (ctx, zh, ...args) => {
  const key = `${ctx}\u0004${zh}`;
  const v = current(key);
  return formatText(v === key ? current(zh) : v, args);
};

/**
 * T for an htm text node whose slots hold markup: the parts as an array (strings and the args untouched), which
 * Preact renders as consecutive children.
 * @param {string} zh
 * @param {...any} args
 * @returns {any[]}
 */
export const TH = (zh, ...args) => {
  const out = [];
  String(current(zh)).split(/\{(\d)\}/).forEach((part, i) => {
    if (i % 2) { const a = args[Number(part)]; if (a != null && a !== false) out.push(a); } else if (part) out.push(part);
  });
  return out;
};

/**
 * Load the dictionary (never throws; a missing file leaves the texts in 中文).
 * @param {{ url?: string, fetchFn?: typeof fetch }} [opts]
 */
export async function loadI18n({ url = '/i18n/en.json', fetchFn = (...a) => globalThis.fetch(...a) } = {}) {
  try {
    const res = await fetchFn(url, { cache: 'no-cache' });
    if (res && res.ok) current = createTranslator(await res.json());
  } catch (err) {
    console.warn('[i18n] dictionary unavailable, texts stay in 中文', err?.message || err);
  }
  return current.size;
}

const IN_BROWSER = typeof window !== 'undefined' && typeof document !== 'undefined';

/** This page's display language ('zh' under Node). */
export const lang = IN_BROWSER ? resolveLang() : 'zh';

if (IN_BROWSER) {
  document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
  if (lang === 'en') await loadI18n();
}

/** Resolves to the dictionary's entry count once it is loaded (kept for callers that awaited the old lazy load). */
export const ensureI18n = () => Promise.resolve(current.size);

/**
 * Switch the display language: saves the choice and reloads the page (no-op for the current language).
 * @param {'zh'|'en'} next
 */
export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  try { globalThis.localStorage?.setItem(PREF_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  globalThis.location?.reload();
}

/** Install a dictionary directly (tests). */
export function setI18n(dict) { current = createTranslator(dict); }
