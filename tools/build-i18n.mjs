#!/usr/bin/env node
// tools/build-i18n.mjs — LOCALIZED GAME DATA: data/i18n/en.json from the official EN client data (and, with --lang, the
// game texts of a language pack from another official client: ja, ko, zh-TW — docs/I18N.md "Adding a language").
//
// The game texts of data/*.json (operators, skills, talents, modules, traits, enemies, bonds, items, effects, bands,
// 特质, 机变 cards, modes, stages, tokens …) are the official zh_CN texts (tools/build-data.mjs). This tool writes their
// official English counterparts as an overlay keyed by the remake's own ids and field paths (format: shared/i18nData.js),
// which public/js/data.js applies when the player switches to English. tools/build-data.mjs is not touched.
//
// How a text is matched (no id table to keep up to date — the official tables are walked side by side):
//   1. the zh_CN and the EN tables are walked in parallel (same keys; arrays of keyed records by their key), giving
//      pairs  Chinese source → English source  with the ids on their path as "scope";
//   0. tools/i18n/corrections-<lang>.json first, when the language has one: an official translation that contradicts
//      the Chinese text and the engine (exact match on the data text, each entry with a `_why:` note) (correction);
//   2. a data text equal to a Chinese source takes its English source (exact);
//   3. a data text whose blackboard placeholders were resolved by build-data ({atk:0%} → 80%) is matched against the
//      Chinese templates of the same shape: the numbers are read back into a blackboard, the Chinese template must
//      reproduce the text exactly, and the English template is filled with the same values (template);
//   4. a few remake-made composites (stage names) are assembled from translated parts (composite);
//   5. what the official EN data lacks falls back to tools/i18n/fallback-remake.json (the remake's own strings),
//      tools/i18n/fallback-pr70.json (PR #70's translations by @YuriRestia, reused with credit) and the UI table
//      public/i18n/en.json (a data text that is also a UI msgid); anything else stays Chinese.
//   Ties between several English sources prefer the one whose path shares the record's ids, then the most frequent.
//   Rich-text tags and placeholders of the official EN texts are the same as in zh_CN, so the client's rich-text
//   formatting (ui/richText.js) works unchanged; `desc` / `text` (plain) are the stripped `descRaw` / `textRaw`.
//
// Usage:  node tools/build-i18n.mjs [--lang <code>] [--refresh | --offline] [--source assets|yostar] [--cache <dir>]
//                                   [--cache-en <dir>] [--data <dir>] [--out <file>] [--report <file>] [--check] [--quiet]
//   --lang      the target language (default en): one with an official client in LANG_SOURCES — en, ja (the JP
//               client), ko (KR), zh-TW (TW); all three carry both 盟约 seasons (verified 2026-10-07, data 51.x). The
//               output goes to data/i18n/<code>.json, the game texts of the language pack <code> (it needs the pack's
//               UI file public/i18n/<code>.json to show in the menu). Any other code needs --dict.
//   --dict      a community dictionary { "<Chinese data text>": "<translation>" } (a language without an official
//               client: the only source besides the pack's UI file; with a client: tried after it). Matching is exact
//               (a text with its numbers resolved needs its own entry); the rest falls back per text at run time.
//   --source    tables of the language: 'assets' (default) = ArknightsAssets/ArknightsGamedata (en / jp / kr / tw;
//               current, has the 盟约 seasons act1autochess / act2autochess); for en also 'yostar' =
//               Kengxxiao/ArknightsGameData_YoStar en_US (archived in 2025-11: no 盟约 season, only the 2025 test event
//               act1vautochess)
//   --refresh   re-download the target tables;  --offline  never download (fail when a table is missing)
//   --cache     zh_CN cache (default <repo>/.cache/gamedata, shared with build-data; missing tables are downloaded). A table
//               is read at the commit the default build pins its group to, from <cache>@<sha> (tools/versions/act2autochess.mjs,
//               as tools/build-data.mjs: the texts of data/*.json come from those tables, DESIGN §37.91)
//   --cache-en  target cache (default <repo>/.cache/gamedata-en for en 'assets', .cache/gamedata-en-yostar for 'yostar',
//               .cache/gamedata-<code> for the others)
//   --data      the data/*.json to localize (default <repo>/data);  --out  default <repo>/data/i18n/<code>.json
//   --report    default <repo>/.cache/build-i18n-report.json (en; build-i18n-report.<code>.json for the others): coverage
//               per kind, untranslated samples
//   --check     build in memory and exit 1 when the output differs from --out (nothing written)
// In the code below "en" names the target side of the walk, whatever the language (the matching is the same).
// Determinism: the output depends only on the inputs (stable key order, no timestamps).

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRecordOverlay, applyFileOverlay, OVERLAY_VERSION } from '../shared/i18nData.js';
import defaultProfile from './versions/act2autochess.mjs';
import { pinnedShaOf } from './versions/profiles.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node tools/build-i18n.mjs [--lang en|ja|ko|zh-TW | --lang <code> --dict <file.json>] [--dict <file.json>] [--refresh | --offline] [--source assets|yostar] [--cache <dir>] [--cache-en <dir>] [--data <dir>] [--out <file>] [--report <file>] [--check] [--quiet]';

const ASSETS_HOME = 'https://github.com/ArknightsAssets/ArknightsGamedata';
/** The official client tables of a language other than English (ArknightsAssets/ArknightsGamedata <server>/gamedata). */
const assetsSource = (server, code) => Object.freeze({
  label: `ArknightsAssets/ArknightsGamedata (${server})`,
  home: ASSETS_HOME,
  url: `https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/${server}/gamedata/`,
  cache: `.cache/gamedata-${code}`,
});

export const EN_SOURCES = Object.freeze({
  assets: {
    label: 'ArknightsAssets/ArknightsGamedata (en)',
    home: 'https://github.com/ArknightsAssets/ArknightsGamedata',
    url: 'https://raw.githubusercontent.com/ArknightsAssets/ArknightsGamedata/master/en/gamedata/',
    cache: '.cache/gamedata-en',
  },
  yostar: {
    label: 'Kengxxiao/ArknightsGameData_YoStar (en_US)',
    home: 'https://github.com/Kengxxiao/ArknightsGameData_YoStar',
    url: 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData_YoStar/main/en_US/gamedata/',
    cache: '.cache/gamedata-en-yostar',
  },
});
const ZH_URL = 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/';
/** Where the zh_CN side reads a table: the default build's pinned commit for its group (master's activity_table has no 盟约
 * season since CN 2.7.91), cached in <cache>@<sha> like tools/build-data.mjs sourceOf. */
function zhSourceOf(cache, rel) {
  const sha = pinnedShaOf(defaultProfile, rel);
  return sha ? { dir: `${cache}@${sha}`, url: `https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/${sha}/zh_CN/gamedata/` }
    : { dir: cache, url: ZH_URL };
}

/**
 * The official clients by target language, each with its table sources. `untranslated`: how a target text that is not
 * a translation shows — 'cjk' (it still has Chinese characters: en, ko), 'same' (it is the Chinese text itself: zh-TW,
 * whose fallback is the Chinese anyway) or 'native' (ja: the Chinese text itself, unless every Han character in it is one
 * the client writes in its own translated texts — 炎, 武者, 速射手 are Japanese as they stand, 甄选干员 is not; see
 * nativeCharset). `composite`: the remake-made stage names are assembled (English wording only).
 */
export const LANG_SOURCES = Object.freeze({
  en: Object.freeze({ sources: EN_SOURCES, untranslated: 'cjk', composite: true }),
  ja: Object.freeze({ sources: Object.freeze({ assets: assetsSource('jp', 'ja') }), untranslated: 'native', composite: false }),
  ko: Object.freeze({ sources: Object.freeze({ assets: assetsSource('kr', 'ko') }), untranslated: 'cjk', composite: false }),
  'zh-TW': Object.freeze({ sources: Object.freeze({ assets: assetsSource('tw', 'zh-TW') }), untranslated: 'same', composite: false }),
});

/**
 * The test "this target text is no translation of that Chinese one" of a language (LANG_SOURCES `untranslated`).
 * @param {string} lang
 * @param {Set<string> | null} [native] for 'native': the Han characters of the client's clearly translated texts
 */
export const untranslatedTest = (lang, native = null) => {
  const mode = LANG_SOURCES[lang]?.untranslated ?? 'same';
  if (mode === 'cjk') return (zh, t) => hasCjk(t);
  if (mode === 'native' && native) return (zh, t) => t === zh && [...t].some((ch) => CJK.test(ch) && !native.has(ch));
  return (zh, t) => t === zh;
};

/**
 * The Han characters a client writes in its own words: every character of the target texts that differ from their
 * Chinese pair (walked like the pair index). A text identical to the Chinese whose Han characters are all in this set is
 * the client's own (Japanese 炎, 不屈, 速射手); one with a character outside it is untranslated Chinese (甄选干员).
 * @param {object[]} zh @param {object[]} target the picked sub-trees of TABLES, in order
 * @returns {Set<string>}
 */
export function nativeCharset(zh, target) {
  const chars = new Set();
  const probe = new PairIndex((z, t) => {
    if (t !== z) for (const ch of t) if (CJK.test(ch)) chars.add(ch);
    return true; // collect only: nothing is indexed
  });
  for (let i = 0; i < zh.length; i++) probe.walk(zh[i], target[i], []);
  return chars;
}

/** Official tables walked side by side (zh_CN ↔ EN), with the sub-trees that hold texts the remake uses. */
const TABLES = [
  { rel: 'excel/activity_table.json', pick: (j) => ({ act2: j?.activity?.AUTOCHESS_SEASON?.act2autochess, act1: j?.activity?.AUTOCHESS_SEASON?.act1autochess, ac: j?.autoChessData, info: { act2autochess: j?.basicInfo?.act2autochess, act1autochess: j?.basicInfo?.act1autochess } }) },
  { rel: 'excel/character_table.json' },
  { rel: 'excel/skill_table.json' },
  { rel: 'excel/uniequip_table.json' },
  { rel: 'excel/battle_equip_table.json' },
  { rel: 'excel/enemy_handbook_table.json', pick: (j) => j?.enemyData },
  { rel: 'excel/item_table.json', pick: (j) => j?.items },
  { rel: 'excel/token_table.json' },
  { rel: 'levels/enemydata/enemy_database.json', pick: (j) => (Array.isArray(j?.enemies) ? kvMap(j.enemies) : j) },
];

/** A Unity-style list of { Key, Value } entries as a plain map (the two dumps serialize some tables either way). */
function kvMap(list) {
  const out = {};
  for (const e of list) if (e && (typeof e.Key === 'string' || typeof e.key === 'string')) out[e.Key ?? e.key] = e.Value ?? e.value;
  return out;
}
const isKvList = (v) => Array.isArray(v) && v.length > 0 && v.every((e) => e && typeof e === 'object' && typeof e.Key === 'string' && 'Value' in e && Object.keys(e).length === 2);

/** Scope segment of the act2autochess sub-tree (TABLES pick key): the season data/*.json is built from. */
const SEASON_SCOPE = 'act2';

/** data/*.json files localized, in output order. */
export const DATA_FILES = Object.freeze(['chess', 'backups', 'tokens', 'bonds', 'garrisons', 'items', 'bands', 'effects',
  'choices', 'enemies', 'factions', 'stages', 'bosses', 'config', 'emotes']);

/**
 * Research / developer notes of the data files (English with Chinese terms; no screen shows them): never translated,
 * counted apart. A leaf is a note when one of these keys is on its path, or its own key is in NOTE_LEAF_KEYS.
 */
const NOTE_KEYS = new Set(['spec', 'implFormula', 'assumed', 'notes', 'formula', 'helperOrder', '_why', '_doc', 'algorithm', 'titleRule']);
const NOTE_LEAF_KEYS = new Set(['cards', 'rule', 'note_dev']);

/** Fields whose translation also feeds the `names` map (server ticker / toast args are data names). */
const NAME_KEYS = new Set(['name', 'effectName']);
/** File priority when two records give the same Chinese name different English names. */
const NAME_PRIORITY = ['chess', 'backups', 'tokens', 'items', 'bonds', 'bands', 'effects', 'garrisons', 'enemies', 'bosses', 'stages', 'choices', 'config', 'factions', 'emotes'];

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
/** Official rich-text markup (a styled / term tag or its close). */
const RICH = /<[@$#][^<>]*>|<\/>/;
const hasCjk = (s) => typeof s === 'string' && CJK.test(s);

// ===== text helpers (kept identical to tools/build-data.mjs: the zh round trip in the report proves it) ============

export function unescapeNewlines(s) { return typeof s === 'string' ? s.replace(/\\n/g, '\n') : s; }
export function stripRich(s) {
  if (typeof s !== 'string') return s ?? null;
  return unescapeNewlines(s)
    .replace(/<[@$#][^<>]*>/g, '')
    .replace(/<\/>/g, '')
    .replace(/<\/?color[^<>]*>/gi, '')
    .replace(/<\/?[bi]>/gi, '');
}
function cleanNum(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return v;
  if (Number.isInteger(v) || Math.abs(v) >= 1e6) return v;
  return Math.round(v * 1e6) / 1e6;
}
export function formatValue(v, fmt) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
  if (!fmt) return String(cleanNum(v));
  const pct = fmt.endsWith('%');
  const core = pct ? fmt.slice(0, -1) : fmt;
  const decimals = core.includes('.') ? core.split('.')[1].length : 0;
  const x = pct ? v * 100 : v;
  const rounded = Math.sign(x) * Math.round(Math.abs(x) * 10 ** decimals + 1e-9) / 10 ** decimals;
  return rounded.toFixed(decimals) + (pct ? '%' : '');
}
const PH = /\{(-?)([^{}:]+)(?::([^{}]+))?\}/g;
/** Resolve {key}, {-key}, {key:0%} against a blackboard (case-insensitive); unknown keys stay verbatim. */
export function resolvePlaceholders(text, bb, bbStr = {}) {
  if (typeof text !== 'string') return text ?? null;
  const lower = new Map();
  for (const [k, v] of Object.entries(bb || {})) lower.set(k.toLowerCase(), v);
  const lowerStr = new Map();
  for (const [k, v] of Object.entries(bbStr || {})) lowerStr.set(k.toLowerCase(), v);
  return text.replace(PH, (m, neg, key, fmt) => {
    const k = key.trim().toLowerCase();
    if (lowerStr.has(k) && (!lower.has(k) || !fmt)) return lowerStr.get(k);
    if (lower.has(k)) return formatValue(neg ? -lower.get(k) : lower.get(k), fmt);
    return m;
  });
}
const hasPlaceholder = (s) => typeof s === 'string' && /\{-?[A-Za-z_@][^{}:]*(?::[^{}]+)?\}/.test(s);

// ===== CLI & IO ======================================================================================================

function parseArgs(argv) {
  const opts = {
    refresh: false, offline: false, quiet: false, check: false, source: 'assets', lang: 'en',
    cache: join(ROOT, '.cache', 'gamedata'), cacheEn: null, data: join(ROOT, 'data'), out: null, report: null,
  };
  const flags = { '--refresh': 'refresh', '--offline': 'offline', '--quiet': 'quiet', '--check': 'check' };
  const vals = { '--source': 'source', '--lang': 'lang', '--dict': 'dict', '--cache': 'cache', '--cache-en': 'cacheEn', '--data': 'data', '--out': 'out', '--report': 'report' };
  for (let i = 0; i < argv.length; i++) {
    const eq = argv[i].indexOf('=');
    const [name, inline] = eq > 0 ? [argv[i].slice(0, eq), argv[i].slice(eq + 1)] : [argv[i], null];
    if (name === '--help' || name === '-h') { console.log(USAGE); process.exit(0); }
    if (flags[name] && inline === null) { opts[flags[name]] = true; continue; }
    if (vals[name]) {
      const v = inline ?? argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${name} needs a value\n${USAGE}`);
      opts[vals[name]] = name === '--source' || name === '--lang' ? v : resolve(v);
      continue;
    }
    throw new Error(`unknown option ${argv[i]}\n${USAGE}`);
  }
  if (opts.refresh && opts.offline) throw new Error(`--refresh and --offline are mutually exclusive\n${USAGE}`);
  const lang = LANG_SOURCES[opts.lang];
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(opts.lang) || opts.lang === 'zh') throw new Error(`--lang ${opts.lang}: a language code (en, ja, zh-TW …; not zh, the source)`);
  if (!lang && !opts.dict) throw new Error(`--lang ${opts.lang} has no official client here (${Object.keys(LANG_SOURCES).join(', ')}): give its game texts with --dict <file.json> (docs/I18N.md §2)`);
  if (lang && !lang.sources[opts.source]) throw new Error(`--source for ${opts.lang} must be one of ${Object.keys(lang.sources).join(', ')}`);
  if (!opts.cacheEn && lang) opts.cacheEn = join(ROOT, lang.sources[opts.source].cache);
  if (!opts.out) opts.out = join(ROOT, 'data', 'i18n', `${opts.lang}.json`);
  if (!opts.report) opts.report = join(ROOT, '.cache', opts.lang === 'en' ? 'build-i18n-report.json' : `build-i18n-report.${opts.lang}.json`);
  return opts;
}

async function download(url, abs, log) {
  let lastErr;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      log(`  download ${url}${attempt > 1 ? ` (attempt ${attempt})` : ''}`);
      const res = await fetch(url, { signal: AbortSignal.timeout(240_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const text = await res.text();
      JSON.parse(text); // never cache a truncated file
      await mkdir(dirname(abs), { recursive: true });
      const tmp = `${abs}.tmp-${process.pid}`;
      await writeFile(tmp, text);
      await rename(tmp, abs);
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < 4) await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  throw new Error(`cannot download ${url}: ${lastErr && lastErr.message}`);
}

async function loadTable(dir, base, rel, { refresh, offline, log }) {
  const abs = join(dir, rel);
  if (refresh || !existsSync(abs)) {
    if (offline) throw new Error(`missing cached table ${abs} (offline mode)`);
    await download(base + rel, abs, log);
  }
  return JSON.parse(await readFile(abs, 'utf8'));
}

// ===== the parallel walk: Chinese source → English source pairs ======================================================

const KEY_FIELDS = ['Key', 'key', 'id', 'charId', 'skillId', 'uniEquipId', 'enemyId', 'itemId', 'effectId', 'bondId', 'bandId', 'stageId', 'modeId', 'bossId', 'talentIndex'];

/** The field an array of records is keyed by (every element an object with a distinct string/number value), or null. */
function arrayKeyField(arr) {
  if (!Array.isArray(arr) || arr.length < 2 || !arr.every((x) => x && typeof x === 'object' && !Array.isArray(x))) return null;
  for (const f of KEY_FIELDS) {
    const vals = arr.map((x) => x[f]);
    if (vals.every((v) => typeof v === 'string' || typeof v === 'number') && new Set(vals).size === vals.length) return f;
  }
  return null;
}

/** Path segments that identify game objects (they contain '_' or a digit): the scope of a pair. */
const isScopeSeg = (s) => typeof s === 'string' && /[_\d]/.test(s) && s.length <= 64;
/** A dictionary of records (≥ 6 keys, every value an object): its keys are ids even without '_' ('longrange'). */
const isDict = (o) => {
  const vals = Object.values(o);
  return vals.length >= 6 && vals.every((v) => v && typeof v === 'object');
};

/**
 * Pair index: Chinese source text (newlines unescaped) → English variants with counts and scopes; plus a template
 * index (shape key → [{ zh, en, scope }]) for texts with placeholders.
 */
class PairIndex {
  /** @param {(zh: string, target: string) => boolean} [untranslated] a target text that is no translation (skipped) */
  constructor(untranslated = (zh, t) => hasCjk(t)) {
    this.untranslated = untranslated;
    /** @type {Map<string, Map<string, { n: number, scopes: Set<string> }>>} */
    this.exact = new Map();
    /** @type {Map<string, Map<string, { n: number, scopes: Set<string> }>>} */
    this.plain = new Map();
    /** @type {Map<string, Map<string, { zh: string, en: string, n: number, scopes: Set<string> }>>} */
    this.templates = new Map();
    this.pairs = 0;
  }

  static add(map, zh, en, scope) {
    let m = map.get(zh);
    if (!m) { m = new Map(); map.set(zh, m); }
    let e = m.get(en);
    if (!e) { e = { n: 0, scopes: new Set() }; m.set(en, e); }
    e.n++;
    for (const s of scope) if (e.scopes.size < 48) e.scopes.add(s);
  }

  add(zhRaw, enRaw, scope) {
    const zh = unescapeNewlines(zhRaw);
    const en = unescapeNewlines(enRaw);
    if (!en.trim() || this.untranslated(zh, en)) return;
    this.pairs++;
    PairIndex.add(this.exact, zh, en, scope);
    // build-data trims some texts (a tip ends with '\\n' in the table, not in data/config.json)
    if (zh.trim() !== zh) PairIndex.add(this.exact, zh.trim(), en.trim(), scope);
    const zp = stripRich(zh);
    if (zp !== zh) PairIndex.add(this.plain, zp, stripRich(en), scope);
    if (hasPlaceholder(zh)) {
      const key = shapeKey(zh);
      let m = this.templates.get(key);
      if (!m) { m = new Map(); this.templates.set(key, m); }
      const id = `${zh}\u0000${en}`;
      let e = m.get(id);
      if (!e) { e = { zh, en, n: 0, scopes: new Set() }; m.set(id, e); }
      e.n++;
      for (const s of scope) if (e.scopes.size < 48) e.scopes.add(s);
    }
  }

  /** Walk a zh_CN tree and its EN counterpart together. */
  walk(zh, en, scope = []) {
    if (isKvList(zh)) zh = kvMap(zh);
    if (isKvList(en)) en = kvMap(en);
    if (typeof zh === 'string') {
      if (typeof en === 'string' && hasCjk(zh)) this.add(zh, en, scope);
      return;
    }
    if (Array.isArray(zh)) {
      if (!Array.isArray(en)) return;
      const kf = arrayKeyField(zh);
      if (kf && arrayKeyField(en) === kf) {
        const byKey = new Map(en.map((x) => [x[kf], x]));
        for (const x of zh) {
          const y = byKey.get(x[kf]);
          if (y !== undefined) this.walk(x, y, isScopeSeg(String(x[kf])) ? [...scope, String(x[kf])] : scope);
        }
        return;
      }
      if (zh.length !== en.length) return; // unkeyed arrays of different length cannot be aligned safely
      for (let i = 0; i < zh.length; i++) this.walk(zh[i], en[i], scope);
      return;
    }
    if (zh && typeof zh === 'object') {
      if (!en || typeof en !== 'object' || Array.isArray(en)) return;
      const dict = isDict(zh);
      for (const k of Object.keys(zh)) {
        if (!Object.prototype.hasOwnProperty.call(en, k)) continue;
        this.walk(zh[k], en[k], dict || isScopeSeg(k) ? [...scope, k] : scope);
      }
    }
  }
}

/** Shape of a text for template lookup: markup stripped, placeholders and numbers folded into one marker. */
export function shapeKey(s) {
  return stripRich(s)
    .replace(/\{-?[^{}:]+(?::[^{}]+)?\}/g, '\u0001')
    .replace(/[+\-]?\d+(?:\.\d+)?%?/g, '\u0001')
    .replace(/[+\-]?\u0001%?/g, '\u0001')
    .replace(/\u0001+/g, '\u0001');
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Read a resolved text back into the blackboard values of a template: { bb, bbStr } that make
 * resolvePlaceholders(template) reproduce `text` exactly, or null.
 * @param {string} template
 * @param {string} text
 */
export function inverseFormat(template, text) {
  const parts = [];
  let last = 0;
  let re = '^';
  for (const m of template.matchAll(PH)) {
    re += escapeRe(template.slice(last, m.index)) + '([\\s\\S]*?)';
    parts.push({ neg: m[1] === '-', key: m[2].trim(), fmt: m[3] || null });
    last = m.index + m[0].length;
  }
  if (!parts.length) return null;
  re += `${escapeRe(template.slice(last))}$`;
  let mm;
  try { mm = new RegExp(re).exec(text); } catch { return null; }
  if (!mm) return null;
  const bb = {};
  const bbStr = {};
  for (let i = 0; i < parts.length; i++) {
    const { neg, key, fmt } = parts[i];
    const cap = mm[i + 1];
    let v;
    if (fmt) {
      const pct = fmt.endsWith('%');
      const num = pct ? cap.match(/^(-?\d+(?:\.\d+)?)%$/) : cap.match(/^(-?\d+(?:\.\d+)?)$/);
      if (!num) return null;
      v = cleanNum(Number(num[1]) / (pct ? 100 : 1));
    } else if (/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(cap)) {
      v = Number(cap);
    } else {
      if (neg) return null;
      bbStr[key] = cap;
      continue;
    }
    if (neg) v = -v;
    v = cleanNum(v);
    if (Object.prototype.hasOwnProperty.call(bb, key) && bb[key] !== v) return null;
    bb[key] = v;
  }
  if (resolvePlaceholders(template, bb, bbStr) !== text) return null;
  return { bb, bbStr };
}

// ===== translation of one data text ==================================================================================

const scoreScopes = (scopes, ctx) => {
  let s = 0;
  for (const id of ctx.near) if (scopes.has(id)) s += 4;
  for (const id of ctx.record) if (scopes.has(id)) s += 1;
  return s;
};

/** Best English variant of a set: scope match first, then frequency, then text order (deterministic). */
function bestVariant(variants, ctx) {
  let best = null;
  for (const [en, e] of variants) {
    const cand = { en, score: scoreScopes(e.scopes, ctx), n: e.n };
    if (!best || cand.score > best.score || (cand.score === best.score && (cand.n > best.n || (cand.n === best.n && cand.en < best.en)))) best = cand;
  }
  return best;
}

/**
 * Translator over the pair index and the fallback dictionary.
 */
class Translator {
  /**
   * @param {PairIndex} index
   * @param {{ name: string, map: Map<string, string> }[]} fallbacks in order of preference
   * @param {{ composites?: boolean, corrections?: Map<string, string> }} [opts] corrections: tried before the official
   *   texts (an official translation that contradicts the Chinese and the engine, tools/i18n/corrections-<lang>.json)
   */
  constructor(index, fallbacks, { composites = true, corrections = new Map() } = {}) {
    this.index = index;
    this.fallbacks = fallbacks;
    this.composites = composites;
    this.corrections = corrections;
  }

  /**
   * @param {string} zh the data text
   * @param {{ near: Set<string>, record: Set<string>, bb?: object|null, bbStr?: object|null }} ctx
   * @returns {{ en: string, how: string } | null}
   */
  translate(zh, ctx) {
    const fix = this.corrections.get(zh);
    if (fix) return { en: fix, how: 'correction' };
    const ex = this.index.exact.get(zh);
    if (ex) return { en: bestVariant(ex, ctx).en, how: 'exact' };
    // a plain text (build-data strips the markup of `desc`, `text`, card / device descriptions) against stripped sources
    if (!RICH.test(zh)) {
      const pl = this.index.plain.get(zh);
      if (pl) return { en: bestVariant(pl, ctx).en, how: 'exact' };
    }
    const tpl = this.template(zh, ctx);
    if (tpl) return tpl;
    const comp = this.composites ? this.composite(zh, ctx) : null;
    if (comp) return comp;
    for (const { name, map } of this.fallbacks) {
      const fb = map.get(zh);
      if (fb) return { en: fb, how: name };
    }
    return null;
  }

  template(zh, ctx) {
    const cands = this.index.templates.get(shapeKey(zh));
    if (!cands) return null;
    let best = null;
    const plain = !RICH.test(zh);
    for (const c of cands.values()) {
      const zhT = plain ? stripRich(c.zh) : c.zh;
      const inv = inverseFormat(zhT, zh);
      if (!inv) continue;
      const enT = plain ? stripRich(c.en) : c.en;
      const bb = { ...(ctx.bb || {}), ...inv.bb };
      const bbStr = { ...(ctx.bbStr || {}), ...inv.bbStr };
      const en = resolvePlaceholders(enT, bb, bbStr);
      if (hasPlaceholder(en) && !hasPlaceholder(zh)) continue; // the English template needs a value the text lacks
      const cand = { en, score: scoreScopes(c.scopes, ctx), n: c.n };
      if (!best || cand.score > best.score || (cand.score === best.score && (cand.n > best.n || (cand.n === best.n && cand.en < best.en)))) best = cand;
    }
    return best ? { en: best.en, how: 'template' } : null;
  }

  /** Remake-made composites: stage names "战场#05(下半) 源石流发生装置". */
  composite(zh, ctx) {
    const m = zh.match(/^战场#(\d+)(?:\((上半|下半)\))?(?:\s+(.+))?$/);
    if (!m) return null;
    let en = `Battlefield #${m[1]}`;
    if (m[2]) en += m[2] === '上半' ? ' (First Half)' : ' (Second Half)';
    if (m[3]) {
      const parts = m[3].split('/').map((p) => this.translate(p.trim(), ctx));
      if (parts.some((p) => !p)) return null;
      en += ` ${parts.map((p) => p.en).join(' / ')}`;
    }
    return { en, how: 'composite' };
  }
}

// ===== walking the data files ========================================================================================

const ID_VALUE = /^[A-Za-z][A-Za-z0-9]*_[A-Za-z0-9_]+$/;

/** Id-like string values of an object (an `…Id` / `id` / `key` field, or a value shaped like an id), `depth` levels down. */
function idsOf(obj, depth, out = new Set()) {
  if (!obj || typeof obj !== 'object' || depth < 0) return out;
  for (const [k, v] of Array.isArray(obj) ? obj.entries() : Object.entries(obj)) {
    if (typeof v === 'string') {
      if (v.length <= 64 && (ID_VALUE.test(v) || (typeof k === 'string' && /(?:^id|Id|^key)$/.test(k) && /^[A-Za-z][\w-]*$/.test(v)))) out.add(v);
    } else if (v && typeof v === 'object') idsOf(v, depth - 1, out);
  }
  return out;
}

/** Kind of a leaf for the coverage report. */
function kindOf(file, path) {
  if (file === 'chess' || file === 'backups') {
    const keys = path.filter((k) => typeof k === 'string');
    if (keys.some((k) => k === 'talentChanges' || k === 'talents' || k === 'talentsBase')) return 'talents';
    if (keys.some((k) => k === 'modules' || k === 'module' || k === 'moduleNames')) return 'modules';
    if (keys.some((k) => k === 'skills' || k === 'skill')) return 'skills';
    if (keys.some((k) => k === 'trait' || k === 'traitBase')) return 'traits';
    return 'operators';
  }
  return file;
}

const isNotePath = (path) => path.some((k) => typeof k === 'string' && NOTE_KEYS.has(k))
  || (typeof path[path.length - 1] === 'string' && NOTE_LEAF_KEYS.has(path[path.length - 1]));

/**
 * Translate every Chinese text of one record. Raw/plain pairs (descRaw/desc, textRaw/text, moduleDescRaw/moduleDesc,
 * effectDescRaw/effectDesc): the raw text is translated, the plain one is its stripped translation when it is the
 * stripped Chinese raw text (as build-data writes it).
 */
function translateRecord(file, id, record, tr, stats, samples) {
  const leaves = [];
  const recordIds = idsOf(record, 3);
  recordIds.add(id);
  // data/*.json is the 下半 season (act2autochess): its wording wins a tie with the 上半 one (the `act2` sub-tree)
  recordIds.add(SEASON_SCOPE);
  const visit = (node, path, nearIds) => {
    if (!node || typeof node !== 'object') return;
    const arr = Array.isArray(node);
    const near = arr ? nearIds : new Set([...nearIds, ...idsOf(node, 0)]);
    const done = new Map();
    const keys = arr ? node.map((_, i) => i) : Object.keys(node);
    const ordered = arr ? keys : [...keys.filter((k) => k.endsWith('Raw')), ...keys.filter((k) => !k.endsWith('Raw'))];
    for (const k of ordered) {
      const v = node[k];
      const p = [...path, k];
      if (typeof v !== 'string') { if (v && typeof v === 'object') visit(v, p, near); continue; }
      if (!hasCjk(v)) continue;
      const kind = kindOf(file, p);
      if (isNotePath(p)) { stats.note(kind); continue; }
      let res = null;
      const rawKey = `${k}Raw`;
      if (!arr && !k.endsWith('Raw') && typeof node[rawKey] === 'string' && done.has(rawKey) && stripRich(node[rawKey]) === v) {
        const r = done.get(rawKey);
        res = { en: stripRich(r.en), how: r.how };
      }
      if (!res) {
        const bb = arr ? null : node.bb && typeof node.bb === 'object' ? { duration: node.duration, ...node.bb } : (Number.isFinite(node.duration) ? { duration: node.duration } : null);
        res = tr.translate(v, { near, record: recordIds, bb, bbStr: arr ? null : node.bbStr || null });
      }
      if (res) {
        done.set(k, res);
        leaves.push({ path: p, zh: v, en: res.en, kind, key: arr ? path[path.length - 1] : k });
        stats.hit(kind, res.how);
      } else {
        stats.miss(kind, v);
        const list = samples[kind] || (samples[kind] = []);
        if (list.length < 25) list.push(`${file}.${id}.${p.join('.')}: ${v.slice(0, 80).replace(/\n/g, '⏎')}`);
      }
    }
  };
  visit(record, [], new Set([id]));
  return leaves;
}

/** A record that is a plain string (config `seasonName`). */
function translateScalar(file, id, text, tr, stats, samples) {
  if (!hasCjk(text) || NOTE_KEYS.has(id)) return [];
  const kind = kindOf(file, [id]);
  const res = tr.translate(text, { near: new Set([id]), record: new Set([id, SEASON_SCOPE]), bb: null, bbStr: null });
  if (!res) {
    stats.miss(kind, text);
    (samples[kind] || (samples[kind] = [])).push(`${file}.${id}: ${text.slice(0, 80)}`);
    return [];
  }
  stats.hit(kind, res.how);
  return [{ path: [], zh: text, en: res.en, kind, key: id }];
}

class Stats {
  constructor() { this.kinds = {}; this.missing = new Map(); }
  row(kind) { return this.kinds[kind] || (this.kinds[kind] = { texts: 0, exact: 0, template: 0, composite: 0, correction: 0, remake: 0, pr70: 0, ui: 0, dict: 0, missing: 0, notes: 0 }); }
  hit(kind, how) { const r = this.row(kind); r.texts++; r[how]++; }
  miss(kind, text) {
    const r = this.row(kind);
    r.texts++;
    r.missing++;
    const m = this.missing.get(text) || { kind, n: 0 };
    m.n++;
    this.missing.set(text, m);
  }
  note(kind) { this.row(kind).notes++; }
}

// ===== main ==========================================================================================================

const dictMap = (d, untranslated = (zh, t) => hasCjk(t)) => new Map(Object.entries(d || {}).filter(([k, v]) => !k.startsWith('_') && typeof v === 'string' && v && !untranslated(k, v)));

/**
 * Build the overlay. Exported for tests (they pass in-memory tables).
 * @param {{ zh: object[], en: object[], data: Record<string, any>, fallback?: { remake?: object, pr70?: object, ui?: object }, corrections?: object, source?: object }} input
 *   zh / en: the picked sub-trees of TABLES, in order; corrections: { zh: en } tried before the official texts
 */
export function buildOverlay({ zh, en, data, fallback = {}, corrections = {}, source = null, lang = 'en' }) {
  const untranslated = untranslatedTest(lang, LANG_SOURCES[lang]?.untranslated === 'native' ? nativeCharset(zh, en) : null);
  const index = new PairIndex(untranslated);
  for (let i = 0; i < zh.length; i++) index.walk(zh[i], en[i], []);
  const tr = new Translator(index, [
    ...(fallback.dict ? [{ name: 'dict', map: dictMap(fallback.dict, untranslated) }] : []),
    { name: 'remake', map: dictMap(fallback.remake, untranslated) },
    { name: 'pr70', map: dictMap(fallback.pr70, untranslated) },
    { name: 'ui', map: dictMap(fallback.ui, untranslated) },
  ], { composites: LANG_SOURCES[lang]?.composite ?? false, corrections: dictMap(corrections, untranslated) });
  const stats = new Stats();
  const samples = {};
  const files = {};
  const nameVotes = new Map(); // zh → [{ en, prio }]
  for (const file of DATA_FILES) {
    const json = data[file];
    if (!json || typeof json !== 'object' || Array.isArray(json)) continue;
    const out = {};
    for (const [id, record] of Object.entries(json)) {
      if (!record || (typeof record !== 'object' && typeof record !== 'string')) continue;
      const leaves = typeof record === 'string' ? translateScalar(file, id, record, tr, stats, samples) : translateRecord(file, id, record, tr, stats, samples);
      const ov = buildRecordOverlay(leaves.map(({ path, zh: z, en: e }) => ({ path, zh: z, en: e })));
      if (ov) out[id] = ov;
      for (const l of leaves) {
        // record-level names (and the stand-ins' operator names): what server messages name
        const top = l.path.length === 1
          || (file === 'backups' && ((id === 'units' && l.path.length === 2) || (id === 'diy' && l.path[0] === 'operators' && l.path.length === 3)));
        if (!top || !NAME_KEYS.has(l.key) || untranslated(l.zh, l.en)) continue;
        const prio = NAME_PRIORITY.indexOf(file);
        const list = nameVotes.get(l.zh) || [];
        list.push({ en: l.en, prio: prio < 0 ? 99 : prio });
        nameVotes.set(l.zh, list);
      }
    }
    if (Object.keys(out).length) files[file] = out;
  }
  const names = {};
  const nameConflicts = [];
  for (const zhName of [...nameVotes.keys()].sort()) {
    const votes = nameVotes.get(zhName).sort((a, b) => a.prio - b.prio || (a.en < b.en ? -1 : a.en > b.en ? 1 : 0));
    names[zhName] = votes[0].en;
    const distinct = [...new Set(votes.map((v) => v.en))];
    if (distinct.length > 1) nameConflicts.push(`${zhName} → ${distinct.join(' | ')}`);
  }
  const coverage = {};
  let total = 0, translated = 0, official = 0;
  for (const [kind, r] of Object.entries(stats.kinds).sort()) {
    const ok = r.exact + r.template + r.composite + r.correction + r.remake + r.pr70 + r.ui + r.dict;
    coverage[kind] = { ...r, translated: ok, pct: r.texts ? Math.round((ok / r.texts) * 1000) / 10 : 100 };
    total += r.texts; translated += ok; official += r.exact + r.template + r.composite;
  }
  const overlay = {
    version: OVERLAY_VERSION,
    lang,
    meta: {
      generator: 'tools/build-i18n.mjs',
      source: source || null,
      fallback: lang === 'en'
        ? 'tools/i18n/corrections-en.json (before the official texts), tools/i18n/fallback-remake.json (the remake), tools/i18n/fallback-pr70.json (PR #70 by @YuriRestia), public/i18n/en.json'
        : `${Object.keys(corrections).some((k) => !k.startsWith('_')) ? `tools/i18n/corrections-${lang}.json (before the official texts), ` : ''}public/i18n/${lang}.json (the pack's UI strings)`,
      coverage: Object.fromEntries(Object.entries(coverage).map(([k, v]) => [k, { texts: v.texts, translated: v.translated, official: v.exact + v.template + v.composite, pct: v.pct }])),
      totals: { texts: total, translated, official, pct: total ? Math.round((translated / total) * 1000) / 10 : 100 },
    },
    names,
    files,
  };
  const missing = [...stats.missing].sort((a, b) => (a[1].kind < b[1].kind ? -1 : a[1].kind > b[1].kind ? 1 : a[0] < b[0] ? -1 : 1))
    .map(([text, m]) => ({ kind: m.kind, n: m.n, text }));
  return { overlay, report: { coverage, totals: overlay.meta.totals, pairs: index.pairs, nameConflicts, untranslated: samples, missing } };
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`build-i18n: ${e.message}`); process.exit(2); }
  const log = (...a) => { if (!opts.quiet) console.log(...a); };
  const client = LANG_SOURCES[opts.lang];
  // (the dictionary by its file name only: a path outside the repository must not end up in the output)
  const src = client ? client.sources[opts.source] : { label: `the dictionary ${basename(opts.dict)}`, home: null, url: null };
  log(`build-i18n: ${opts.lang} tables from ${src.label}`);
  const zh = [];
  const en = [];
  for (const t of client ? TABLES : []) {
    const zs = zhSourceOf(opts.cache, t.rel);
    const zj = await loadTable(zs.dir, zs.url, t.rel, { refresh: false, offline: opts.offline, log });
    const ej = await loadTable(opts.cacheEn, src.url, t.rel, { refresh: opts.refresh, offline: opts.offline, log });
    zh.push(t.pick ? t.pick(zj) : zj);
    en.push(t.pick ? t.pick(ej) : ej);
  }
  const seasonEn = en[0]?.act2 ? 'act2autochess' : en[0]?.act1 ? 'act1autochess' : 'none (no 盟约 season in this EN build)';
  let version = null;
  const versionFile = client ? join(opts.cacheEn, 'excel', 'data_version.txt') : '';
  if (client && !opts.offline && (opts.refresh || !existsSync(versionFile))) {
    try {
      const res = await fetch(`${src.url}excel/data_version.txt`, { signal: AbortSignal.timeout(30_000) });
      if (res.ok) { await mkdir(dirname(versionFile), { recursive: true }); await writeFile(versionFile, await res.text()); }
    } catch { /* optional */ }
  }
  try { version = versionFile ? (await readFile(versionFile, 'utf8')).trim() : null; } catch { /* optional */ }
  const data = {};
  for (const f of DATA_FILES) {
    const abs = join(opts.data, `${f}.json`);
    if (existsSync(abs)) data[f] = JSON.parse(await readFile(abs, 'utf8'));
  }
  const readDict = async (abs) => (existsSync(abs) ? JSON.parse(await readFile(abs, 'utf8')) : {});
  // the remake's own strings and PR #70's are English; another language falls back to its pack's UI strings only
  const fallback = opts.lang === 'en' ? {
    remake: await readDict(join(ROOT, 'tools', 'i18n', 'fallback-remake.json')),
    pr70: await readDict(join(ROOT, 'tools', 'i18n', 'fallback-pr70.json')),
    ui: await readDict(join(ROOT, 'public', 'i18n', 'en.json')),
  } : { ui: await readDict(join(ROOT, 'public', 'i18n', `${opts.lang}.json`)) };
  if (opts.dict) fallback.dict = JSON.parse(await readFile(opts.dict, 'utf8'));
  // corrections of the language's own official texts (none for a language without a file)
  const corrections = await readDict(join(ROOT, 'tools', 'i18n', `corrections-${opts.lang}.json`));
  const { overlay, report } = buildOverlay({ zh, en, data, fallback, corrections, lang: opts.lang, source: client ? { id: opts.source, label: src.label, home: src.home, season: seasonEn } : { id: 'dict', label: src.label } });

  // self-check: applying the overlay keeps every record's shape (strings replace strings only)
  let applied = 0;
  for (const [file, fov] of Object.entries(overlay.files)) {
    const r = applyFileOverlay(data[file], fov);
    applied += r.applied;
    if (r.stale) throw new Error(`overlay of ${file} does not apply cleanly (${r.stale} stale leaves)`);
  }
  const text = `${JSON.stringify(overlay)}\n`;
  const rep = { ...report, source: overlay.meta.source, enDataVersion: version, applied, bytes: Buffer.byteLength(text) };
  await mkdir(dirname(opts.report), { recursive: true });
  await writeFile(opts.report, `${JSON.stringify(rep, null, 1)}\n`);
  if (client) log(`  season in the ${opts.lang} build: ${seasonEn}${version ? ` · ${version.replace(/\s+/g, ' ')}` : ''}`);
  log(`  ${report.pairs} zh→${opts.lang} source pairs; coverage per kind (translated / texts):`);
  for (const [kind, c] of Object.entries(report.coverage)) {
    const fb = [c.correction && `corrections ${c.correction}`, c.remake && `remake ${c.remake}`, c.pr70 && `PR #70 ${c.pr70}`, c.ui && `UI ${c.ui}`, c.dict && `dictionary ${c.dict}`].filter(Boolean).join(' · ');
    log(`    ${kind.padEnd(10)} ${String(c.translated).padStart(5)} / ${String(c.texts).padEnd(5)} ${String(c.pct).padStart(5)} %   official ${c.exact + c.template + c.composite} (exact ${c.exact} · template ${c.template} · composite ${c.composite})${fb ? ` · ${fb}` : ''}${c.notes ? ` · notes skipped ${c.notes}` : ''}`);
  }
  log(`  total ${report.totals.translated} / ${report.totals.texts} (${report.totals.pct} %), official ${report.totals.official}; ${Object.keys(overlay.names).length} names (${report.nameConflicts.length} with several ${opts.lang} forms)`);
  if (opts.check) {
    const cur = existsSync(opts.out) ? await readFile(opts.out, 'utf8') : '';
    if (cur !== text) { console.error(`build-i18n --check: ${relative(ROOT, opts.out)} is out of date (run node tools/build-i18n.mjs)`); process.exit(1); }
    log(`  ${relative(ROOT, opts.out)} is up to date`);
    return;
  }
  await mkdir(dirname(opts.out), { recursive: true });
  const tmp = `${opts.out}.tmp-${process.pid}`;
  await writeFile(tmp, text);
  await rename(tmp, opts.out);
  log(`  wrote ${relative(ROOT, opts.out)} (${(rep.bytes / 1024).toFixed(0)} KB); report ${relative(ROOT, opts.report)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`build-i18n: ${e.stack || e.message}`); process.exit(1); });
}
