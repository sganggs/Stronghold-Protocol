// shared/i18nPacks.js — the language pack type ("lang") of the content packs (shared/packs.js, docs/PACKS.md;
// translating: docs/I18N.md "Adding a language"): language codes, the language fields of a pack manifest, the fallback
// chain t() walks, and the script family the title screen lays out by. No Node builtin: the browser, the server and the
// tools share it.
//
// A language pack is files in the language folders, nothing else (the owner's decision of 2026-10-07):
//
//   public/i18n/<code>.json   the UI strings: { "_meta": { …manifest… }, "<Chinese msgid>": "<translation>", … }
//   data/i18n/<code>.json     optional: the game texts (the overlay of shared/i18nData.js, tools/build-i18n.mjs)
//
// — or the same two files in a pack folder, packs/<id>/ with a pack.json manifest (shared/packs.js), the layout every
// pack type shares. <code> is a BCP 47 tag in its usual case: a 2–3 letter language, then an optional script (4
// letters), region (2 letters or 3 digits) and variants — en, ja, ko, zh-TW, pt-BR, sr-Latn. Chinese ('zh') is the
// built-in source language (the msgids themselves) and never a pack. English is a pack like any other; it is only the
// complete one.
//
// The language fields of a manifest (`_meta` of a single-file pack, pack.json of a folder pack; all optional):
//   lang          the language code (a single file: its file name decides; a different value is reported)
//   base          a pack whose strings fill the gaps first (default: the language of a regional code when there is a
//                 pack for it — pt-BR → pt; never the Chinese source, so zh-TW has none); null switches it off
//   fallback      packs tried after the base, before the Chinese msgid (["en"]: untranslated strings show English)
//   complete      true: `node tools/i18n.mjs check` requires every msgid (English declares it)
//   machineTranslated  true: the UI strings are machine translations (or a machine conversion, zh-TW); the 设置 dialog
//                 says so under the language switch while the language is in use (ui/lang.js machineTranslationNote)
//   numberUnits   two units for numbers counted in 10⁴ / 10⁸ steps (Chinese 万 / 亿; e.g. a Japanese pack ["万", "億"]);
//                 without them large numbers use K / M / B (ui/gameLogic/format.js fmtNum)
// The common fields (id, version, app, name, englishName, authors, credits, license) are shared/packs.js's.

/** The source language: msgids are its text, it has no pack. */
export const SOURCE_LANG = 'zh';

/**
 * A language code in its canonical case ('EN' → 'en', 'pt_br' → 'pt-BR', 'zh-hant-tw' → 'zh-Hant-TW'), or null when
 * the input is not one.
 * @param {unknown} v
 * @returns {string|null}
 */
export function canonicalLang(v) {
  if (typeof v !== 'string') return null;
  const parts = v.trim().replace(/_/g, '-').split('-');
  if (!/^[A-Za-z]{2,3}$/.test(parts[0] || '')) return null;
  const out = [parts[0].toLowerCase()];
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    if (!/^[A-Za-z0-9]{2,8}$/.test(p)) return null;
    if (i === 1 && /^[A-Za-z]{4}$/.test(p)) out.push(p[0].toUpperCase() + p.slice(1).toLowerCase()); // script
    else if (/^[A-Za-z]{2}$/.test(p) || /^\d{3}$/.test(p)) out.push(p.toUpperCase()); // region
    else out.push(p.toLowerCase()); // variant
  }
  return out.join('-');
}

/** Whether a string is a language code in its canonical case (a pack's file name must be one). @param {unknown} v */
export const isLangCode = (v) => typeof v === 'string' && canonicalLang(v) === v;

/** The language part of a code ('pt-BR' → 'pt'). @param {string} code */
export const primaryLang = (code) => String(code).split('-')[0];

/**
 * A language's name through Intl.DisplayNames (`code` in the language `inLang`), or the code when unknown.
 * @param {string} code
 * @param {string} [inLang] default: the language itself (日本語 for ja)
 */
export function languageName(code, inLang = code) {
  try {
    const DN = /** @type {any} */ (globalThis).Intl?.DisplayNames;
    if (DN) {
      const n = new DN([inLang], { type: 'language', fallback: 'none' }).of(code);
      if (typeof n === 'string' && n && n !== code) return n;
    }
  } catch { /* an unknown code or no ICU data */ }
  return code;
}

const str = (v, max = 200) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : '');

/** Canonical language codes of a string or a list, the source and repeats left out. @param {unknown} v */
export function langList(v) {
  const list = Array.isArray(v) ? v : typeof v === 'string' ? [v] : [];
  const out = [];
  for (const x of list) {
    const c = canonicalLang(x);
    if (c && c !== SOURCE_LANG && !out.includes(c)) out.push(c);
  }
  return out;
}

/**
 * @typedef {{ lang: string, base: string|null|undefined, fallback: string[], complete: boolean, machineTranslated: boolean,
 *   numberUnits: string[]|null }} LangFields
 */

/**
 * The language fields of a manifest (see the header), normalized. `base` stays undefined unless the manifest sets it
 * (a code or null): computeChain() then takes the language of a regional code.
 * @param {string} code the pack's language
 * @param {any} m the manifest (`_meta` / pack.json), may be empty
 * @returns {LangFields}
 */
export function langFields(code, m) {
  const o = m && typeof m === 'object' ? m : {};
  let base;
  if (o.base === null) base = null;
  else if (typeof o.base === 'string') base = canonicalLang(o.base);
  if (base === SOURCE_LANG || base === code) base = null;
  const units = Array.isArray(o.numberUnits) && o.numberUnits.length === 2 && o.numberUnits.every((u) => str(u, 8)) ? o.numberUnits.map((u) => str(u, 8)) : null;
  return {
    lang: code, base, fallback: langList(o.fallback).filter((c) => c !== code), complete: o.complete === true,
    machineTranslated: o.machineTranslated === true, numberUnits: units,
  };
}

/**
 * @typedef {LangFields & { code: string, name: string, englishName: string, authors: string[], credits?: string,
 *   version?: string, app?: string, compatible?: boolean, data?: boolean, strings?: number, ui?: string,
 *   dataUrl?: string, uiOverlay?: string, dataOverlayUrl?: string, packId?: string, builtin?: boolean }} LangMeta
 */

/**
 * What the client knows of a language (shared/i18n.js registry) from a pack's UI file alone — its `_meta`, every field
 * optional: the names default to Intl.DisplayNames, no authors, no fallback.
 * @param {string} code
 * @param {any} json the parsed UI file (or null)
 * @returns {LangMeta}
 */
export function packMeta(code, json) {
  const m = json && typeof json === 'object' && json._meta && typeof json._meta === 'object' ? json._meta : {};
  const authors = (Array.isArray(m.authors) ? m.authors : typeof m.authors === 'string' ? [m.authors] : []).map((a) => str(a)).filter(Boolean).slice(0, 32);
  return {
    ...langFields(code, m),
    code,
    name: str(m.name, 60) || languageName(code),
    englishName: str(m.englishName, 60) || languageName(code, 'en'),
    authors,
  };
}

/** How many translations a UI file holds (non-empty string values, metadata keys left out). @param {any} json */
export function countStrings(json) {
  let n = 0;
  if (json && typeof json === 'object') for (const [k, v] of Object.entries(json)) if (!k.startsWith('_') && typeof v === 'string' && v) n++;
  return n;
}

/**
 * The languages t() tries for `code`, best first (the Chinese msgid comes after all of them): the pack itself, its base
 * — `base`, else the language of a regional code (pt-BR → pt) — with the base's own chain, then each `fallback` with its
 * chain. Only languages `known` accepts; never the source; no repeats (cycles end).
 * @param {string} code
 * @param {(code: string) => Partial<LangFields> | null | undefined} metaOf
 * @param {(code: string) => boolean} known
 * @returns {string[]}
 */
export function computeChain(code, metaOf, known) {
  const out = [];
  const visit = (c, depth) => {
    if (!c || c === SOURCE_LANG || out.includes(c) || depth > 8 || !known(c)) return;
    out.push(c);
    const m = metaOf(c) || {};
    const base = m.base !== undefined ? m.base : (c.includes('-') ? primaryLang(c) : null);
    if (base) visit(base, depth + 1);
    for (const f of m.fallback || []) visit(f, depth + 1);
  };
  visit(code, 0);
  return out;
}

/** Characters of the wide scripts: CJK ideographs and punctuation, kana, Hangul, full-width forms. */
const WIDE_SCRIPT = /[ᄀ-ᇿ⺀-鿿가-힯豈-﫿＀-￯]/;

/**
 * The script family of a text: 'cjk' (ideographs, kana, Hangul) or 'alphabetic' (Latin, Cyrillic, Greek …). The title
 * screen and the start button lay out by it (screens/title.js, ui/lang.js applyDocument), so a pack needs no flag.
 * @param {unknown} text
 * @returns {'cjk' | 'alphabetic'}
 */
export const scriptOf = (text) => (WIDE_SCRIPT.test(String(text ?? '')) ? 'cjk' : 'alphabetic');
