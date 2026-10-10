// Language switch of the client (docs/I18N.md): lists the language packs — the "lang" entries of the pack index
// /packs/index.json (shared/packs.js; the server's registry, server/packs.js, scans the language folders and the pack
// folders; a static host serves the file `node tools/packs.mjs index` writes) — picks the language at boot, loads the UI
// strings of the chosen pack and of its fallback chain (shared/i18n.js; the URLs the index gives: /i18n/<code>.json or
// /packs/<id>/<file>) and its game texts (data.js), keeps the choice, and translates what the server sends (m.toast /
// m.ticker / error codes). No language is known by name here: a pack is a file in a folder (the owner's decision of
// 2026-10-07).
//
// Chinese is the default (the owner's decision of 2026-10-05) — the browser's language is not consulted. Order at boot:
// `?lang=<code>` in the URL (then removed from the address bar and kept as the choice), the stored choice (localStorage
// `sp.pref.lang`), else Chinese; a code no pack has falls back to Chinese (`en-US` takes the `en` pack). A switch
// re-renders the app in place (main.js App subscribes with useLang) — no reload; the game texts follow as soon as their
// overlays have downloaded (data.js notifies its subscribers). Without an index (a static host that lacks the file) the
// stored or requested pack still loads by its code, and the menu offers it beside Chinese.

import { useEffect, useState } from '../../vendor/hooks.module.js';
import {
  DEFAULT_LANG, normalizeLang, getLang, setLang, onLangChange, addMessages, setNameResolver, tName, format, translateWire, t, N_,
  registerLangs, getLangs, langInfo, langChain, onLangsChange, setI18nWarn,
} from '../../../shared/i18n.js';
import { canonicalLang, computeChain, scriptOf } from '../../../shared/i18nPacks.js';
import { PACKS_URL, PACK_INDEX_FILE, readPackIndex, langMetaOf } from '../../../shared/packs.js';
import { DEV_BUILD } from '../../../shared/constants.js';
import { loadPref, savePref } from '../store.js';
import { data } from '../data.js';
import { updateRotateHintPwaI18n } from './device.js';
import { html } from './components.js';

/** The switch's own label, in both languages (whoever opens it may not read the current one). */
const SWITCH_LABEL = 'Language / 语言'; // i18n-ignore
const PREF_KEY = 'lang';
/** How long boot waits for the index and the UI strings before rendering in Chinese anyway (they apply when they arrive). */
const BOOT_WAIT_MS = 2500;
/** Up to this many languages the switch is a row of buttons (中文 | English …); more make it a list. */
export const SEGMENTED_MAX = 4;

/** @type {Map<string, Promise<boolean>>} */
const uiLoads = new Map();
/** @type {Promise<boolean> | null} */
let indexLoad = null;
/** Whether the pack index arrived (without it the chain of a pack is taken from its own `_meta` as it loads). */
let indexOk = false;
/** Only the latest boot or explicit selection may apply its loaded language. */
let langRequest = 0;
const INDEX_URL = `${PACKS_URL}${PACK_INDEX_FILE}`;

const defaultFetch = (...a) => globalThis.fetch(...a);

/**
 * Download (once) the pack index and register its language packs (shared/i18n.js registerLangs), so the menu lists
 * them.
 * @param {typeof fetch} [doFetch]
 * @returns {Promise<boolean>} false when unavailable (the menu then offers Chinese and the stored language)
 */
export function loadLangIndex(doFetch = defaultFetch) {
  if (indexLoad) return indexLoad;
  indexLoad = (async () => {
    try {
      const res = await doFetch(INDEX_URL, { cache: 'no-cache' });
      if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : '???'}`);
      registerLangs(readPackIndex(await res.json(), 'lang').map(langMetaOf));
      indexOk = true;
      return true;
    } catch (err) {
      console.warn(`[i18n] ${INDEX_URL} unavailable (${err?.message || err}); the menu offers Chinese and the stored language`);
      return false;
    }
  })();
  return indexLoad;
}

/**
 * Download (once) the UI strings of one language pack: the URL its index entry gives, else the language folder's file
 * /i18n/<code>.json (whose `_meta` then registers it).
 * @param {string} lang
 * @param {typeof fetch} [doFetch]
 * @returns {Promise<boolean>} false when unavailable (the interface stays as it is)
 */
export function loadUiMessages(lang, doFetch = defaultFetch) {
  if (lang === DEFAULT_LANG) return Promise.resolve(true);
  if (uiLoads.has(lang)) return uiLoads.get(lang);
  const url = langInfo(lang)?.ui || `/i18n/${lang}.json`;
  const p = (async () => {
    try {
      const res = await doFetch(url, { cache: 'no-cache' });
      if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : '???'}`);
      addMessages(lang, await res.json());
      return true;
    } catch (err) {
      console.warn(`[i18n] ${url} unavailable (${err?.message || err}); the interface stays as it is`);
      uiLoads.delete(lang);
      return false;
    }
  })();
  uiLoads.set(lang, p);
  return p;
}

/**
 * Load a pack and the packs of its chain (its base, its fallbacks — shared/i18n.js langChain). A fallback that fails
 * only leaves its strings to the next language of the chain.
 * @param {string} lang
 * @param {typeof fetch} [doFetch]
 * @returns {Promise<boolean>} whether the pack itself loaded
 */
export async function loadLangChain(lang, doFetch = defaultFetch) {
  if (lang === DEFAULT_LANG) return true;
  if (!(await loadUiMessages(lang, doFetch))) return false;
  // without the index, the chain's codes are not registered yet: try them by the pack's own `_meta`
  const chain = indexOk ? langChain(lang) : computeChain(lang, (c) => langInfo(c), () => true);
  await Promise.all(chain.filter((c) => c !== lang).map((c) => loadUiMessages(c, doFetch)));
  return true;
}

/**
 * The game-text overlays that apply for `lang`, best first: the chain's packs that have one (the index's `files.data`;
 * unknown without the index → the language folder's data/i18n/<code>.json is tried), with their URLs (data.js).
 * @param {string} lang
 * @returns {{ code: string, url?: string }[]}
 */
export const dataChain = (lang) => langChain(lang).filter((c) => langInfo(c)?.data !== false).map((c) => ({ code: c, url: langInfo(c)?.dataUrl }));

/**
 * The language to start in: the URL's `?lang=`, then the stored choice, then Chinese. `tentative`: also a well-formed
 * code no pack is known for (boot without an index tries to load it).
 * @param {string} [search] location.search
 * @param {(key: string, fallback: any) => any} [load]
 * @param {{ tentative?: boolean }} [opts]
 * @returns {{ lang: string, fromUrl: boolean }}
 */
export function initialLang(search = globalThis.location?.search || '', load = loadPref, { tentative = false } = {}) {
  const pick = (v) => normalizeLang(v) || (tentative ? canonicalLang(v) : null);
  let fromUrl = null;
  try { fromUrl = pick(new URLSearchParams(search).get('lang')); } catch { /* ignore */ }
  if (fromUrl) return { lang: fromUrl, fromUrl: true };
  let stored = null;
  try { stored = pick(load(PREF_KEY, null)); } catch { /* ignore */ }
  return { lang: stored || DEFAULT_LANG, fromUrl: false };
}

function stripLangParam() {
  try {
    const url = new URL(globalThis.location.href);
    if (!url.searchParams.has('lang')) return;
    url.searchParams.delete('lang');
    globalThis.history?.replaceState(globalThis.history.state, '', url.pathname + (url.search || '') + url.hash);
  } catch { /* ignore */ }
}

/** The `lang` attribute of a language: its code ('zh-CN' for the Chinese source). @param {string} code */
export const htmlLang = (code) => (code === DEFAULT_LANG ? 'zh-CN' : code);

/**
 * <html lang>, data-lang, data-script (the title screen's layout: CJK or alphabetic, from the pack's title) and the tab
 * title follow the language.
 */
function applyDocument(lang) {
  const doc = globalThis.document;
  if (!doc) return;
  doc.documentElement.lang = htmlLang(lang);
  doc.documentElement.dataset.lang = lang;
  doc.documentElement.dataset.script = scriptOf(t('卫戍协议'));
  doc.title = t('卫戍协议：盟约 · STRONGHOLD PROTOCOL');
  updateRotateHintPwaI18n(doc);
}

// `{ dn }` params and tName(): Chinese game-data names → the current language (data/i18n/<lang>.json names)
setNameResolver((name) => data.localeName(name));

/** A development page (a dev build, or served from this machine): report translations t() skips (shared/i18n.js). */
function isDevPage() {
  if (DEV_BUILD) return true;
  try {
    const h = String(globalThis.location?.hostname || '');
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1' || h.endsWith('.localhost');
  } catch { return false; }
}

let wired = false;
function wire() {
  if (wired) return;
  wired = true;
  onLangChange((lang) => { applyDocument(lang); });
  if (isDevPage()) {
    setI18nWarn(({ lang, key, problems }) => console.warn(`[i18n] ${lang}: the translation of "${key}" is skipped (${problems.join('; ')}); the next language of the chain shows`));
  }
}

/** Make a loaded language current: the interface now, the game texts once their overlays are in. */
function applyLang(lang) {
  setLang(lang);
  data.setLocale(getLang(), dataChain(getLang())).catch(() => {});
}

/**
 * Boot: list the packs, choose the language and load its UI strings (waits at most BOOT_WAIT_MS) before the first
 * render; the game-text overlays download in the background.
 * @returns {Promise<string>} the language in effect
 */
export async function initLang() {
  const request = ++langRequest;
  wire();
  applyDocument(getLang());
  const TIMEOUT = Symbol('timeout');
  const boot = (async () => {
    const listed = await loadLangIndex();
    const { lang, fromUrl } = initialLang(undefined, undefined, { tentative: !listed });
    if (fromUrl) stripLangParam();
    if (request !== langRequest) return null;
    if (fromUrl) savePref(PREF_KEY, lang);
    if (lang === DEFAULT_LANG) return null;
    return (await loadLangChain(lang)) ? lang : null;
  })();
  const got = await Promise.race([boot, new Promise((r) => setTimeout(() => r(TIMEOUT), BOOT_WAIT_MS))]);
  if (got === TIMEOUT) {
    boot.then((lang) => { if (request === langRequest && lang && normalizeLang(loadPref(PREF_KEY, null)) === lang) applyLang(lang); });
  } else if (request === langRequest && got) applyLang(got);
  return getLang();
}

/**
 * Switch the language (the menu on the title screen and in 设置): keeps the choice, loads the pack and its chain, then
 * re-renders; the game texts follow when their overlays have downloaded.
 * @param {string} lang
 * @returns {Promise<string>} the language in effect
 */
export async function switchLang(lang) {
  const request = ++langRequest;
  wire();
  const want = normalizeLang(lang) || DEFAULT_LANG;
  savePref(PREF_KEY, want);
  if (want !== DEFAULT_LANG && !(await loadLangChain(want))) return getLang();
  if (request !== langRequest) return getLang();
  applyLang(want);
  return getLang();
}

/**
 * Preact hook: the current language; the component re-renders when it changes.
 * @returns {string}
 */
export function useLang() {
  const [lang, setState] = useState(getLang);
  useEffect(() => {
    setState(getLang());
    return onLangChange((l) => setState(l));
  }, []);
  return lang;
}

/**
 * Preact hook: the known languages (shared/i18n.js getLangs); re-renders when the index or a pack arrives.
 * @returns {ReturnType<typeof getLangs>}
 */
export function useLangs() {
  const [list, setList] = useState(getLangs);
  useEffect(() => {
    setList(getLangs());
    return onLangsChange(() => setList(getLangs()));
  }, []);
  return list;
}

/**
 * What the language menu shows: every known language under its own name (the English name as a tooltip when it reads
 * differently), current one marked — a row of buttons up to SEGMENTED_MAX languages, a list beyond.
 * @param {ReturnType<typeof getLangs>} langs
 * @param {string} current
 * @returns {{ kind: 'buttons' | 'select', items: { code: string, label: string, title: string, htmlLang: string, on: boolean }[] }}
 */
export function langMenuModel(langs, current) {
  const items = (Array.isArray(langs) ? langs : []).filter(Boolean).map((m) => ({
    code: m.code,
    label: m.name || m.code,
    title: m.englishName && m.englishName !== m.name ? m.englishName : '',
    htmlLang: htmlLang(m.code),
    on: m.code === current,
  }));
  return { kind: items.length > SEGMENTED_MAX ? 'select' : 'buttons', items };
}

/** The note itself (a msgid: each pack words it in its own language). */
const MACHINE_TRANSLATION_NOTE = N_('当前语言的界面文字为机器翻译，可能不够准确，欢迎在 GitHub 上指正。');

/**
 * The note under the language switch in 设置 (ui/settings.js): while the current language's pack is marked as a machine
 * translation (`_meta.machineTranslated`, docs/PACKS.md) it says so, in that language; null otherwise (Chinese, English,
 * a pack translated by hand). Only the current pack counts, not its base or fallbacks.
 * @returns {string | null}
 */
export function machineTranslationNote() {
  return langInfo(getLang())?.machineTranslated === true ? t(MACHINE_TRANSLATION_NOTE) : null;
}

/**
 * The language menu: 中文 | English | … as buttons, or a list when there are many packs.
 * @param {{ class?: string }} props
 */
export function LangToggle({ class: cls }) {
  const lang = useLang();
  const menu = langMenuModel(useLangs(), lang);
  const pick = async (code, select = null) => {
    if (!code) return;
    const switched = switchLang(code);
    const request = langRequest;
    await switched;
    // A failed current request keeps the displayed language; stale requests must not reset a newer pending pick.
    if (select && request === langRequest) select.value = getLang();
  };
  if (menu.kind === 'select') {
    return html`<label class=${`set-seg lang-toggle lang-select${cls ? ` ${cls}` : ''}`} data-testid="lang-toggle">
      <select aria-label=${SWITCH_LABEL} value=${lang} onChange=${(e) => pick(e.currentTarget.value, e.currentTarget)}>
        ${menu.items.map((it) => html`<option key=${it.code} value=${it.code} lang=${it.htmlLang} title=${it.title || undefined} selected=${it.on}>${it.label}</option>`)}
      </select>
    </label>`;
  }
  return html`<div class=${`set-seg lang-toggle${cls ? ` ${cls}` : ''}`} role="radiogroup" aria-label=${SWITCH_LABEL} data-testid="lang-toggle">
    ${menu.items.map((it) => html`<button key=${it.code} type="button" role="radio" lang=${it.htmlLang} aria-checked=${it.on ? 'true' : 'false'}
      class=${it.on ? 'is-on' : ''} data-lang=${it.code} title=${it.title || undefined} onClick=${() => pick(it.code)}>${it.label}</button>`)}
  </div>`;
}

/**
 * A game text the server sent in Chinese — a 机变 card's or an effect's description, a draft's name, a result title —
 * in the current language: the localized record's text when the sent text is that record's own Chinese text
 * (data.lookupRaw / getRaw), else the sent text as it is (a line the server reworded stays Chinese). In Chinese this is
 * always the sent text. Names have a shorter way: tName() (every record name of the data is in the overlay's names).
 * @param {unknown} sent the server's text
 * @param {unknown} raw the record's Chinese text
 * @param {unknown} local the record's text in the current language
 */
export function sentText(sent, raw, local) {
  if (typeof sent !== 'string' || !sent) return sent;
  return typeof raw === 'string' && raw === sent && typeof local === 'string' && local ? local : sent;
}

/**
 * The text of an m.ticker frame in the current language. A config.broadcasts line (`id` + `args`, server ≥ 0.2.0) is
 * rebuilt from the localized broadcast template — `{0}` is the player's name (never translated), other args are
 * game-data names or numbers; any other line goes through translateWire (msgid + params, or its text as a msgid).
 * @param {{ text?: string, id?: string|null, args?: unknown[], msgid?: string, params?: any }} msg
 * @returns {string}
 */
export function tickerText(msg) {
  if (getLang() !== DEFAULT_LANG && typeof msg?.id === 'string' && Array.isArray(msg.args)) {
    const list = data.get('config')?.broadcasts;
    const b = Array.isArray(list) ? list.find((x) => x && x.id === msg.id) : null;
    if (b && typeof b.text === 'string') {
      const args = msg.args.map((a, i) => (i === 0 ? String(a ?? '') : tName(String(a ?? ''))));
      return format(b.text, args);
    }
  }
  return translateWire(msg);
}
