// tools/i18n/official-en.mjs — pair the Chinese display texts of data/*.json with the official English game text
// (ArknightsGamedata/en/gamedata, the EN client export) → tools/i18n/official-overrides.json ({ zh: en }), the last and
// strongest layer of build.mjs (agent translations < SPA DB 2.1 < official EN game data).
//
// How: tools/build-data.mjs itself is run, unmodified, on a temp cache holding the EN tables, so every text gets the
// very same selection and transforms (best candidate at the chess status, {placeholder} resolution against the
// blackboards, rich-text stripping for `desc`, \n unescaping). The EN build is then walked in parallel with data/*.json
// by record id (arrays of records by their id field), and every Chinese string pairs with the EN string at the same
// place. Two quirks of the EN export are normalized in the temp cache: empty arrays dumped as `{}` (→ `[]`, which every
// read in build-data treats the same) and enemy_database as a { key: levels } dict (→ the zh `{ enemies: [{Key, Value}] }`).
//
// Guards (tools/i18n/official-report.json): number guard (the multisets of numbers of zh and en differ ⇒ the servers
// may differ in balance ⇒ skipped), zh text without an EN record, EN empty or still CJK, one zh with several EN.
//   node tools/i18n/official-en.mjs [--keep]   (--keep leaves the temp EN cache/build in the OS temp dir)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { ROOT, DIR } from './base.mjs';
import { richTextPlain } from '../../public/js/ui/richText.js';

const SRC = path.join(ROOT, 'ArknightsGamedata', 'en', 'gamedata');
const TMP = path.join(os.tmpdir(), 'sp-official-en');
const CACHE = path.join(TMP, 'cache'), OUT = path.join(TMP, 'data'), REPORT_TMP = path.join(TMP, 'build-report.json');
const DATA = path.join(ROOT, 'data');
const FILES = ['config', 'chess', 'bonds', 'garrisons', 'items', 'bands', 'effects', 'choices', 'enemies', 'factions', 'waves', 'stages', 'bosses', 'tokens'];
/** Top-level files keyed by record id. */
const RECORD_FILES = new Set(FILES.filter((f) => !['config', 'choices', 'factions'].includes(f)));
/** Dicts keyed by ids below the top level (their keys collapse to * in the field label). */
const ID_DICTS = new Set(['modes', 'events', 'entries', 'types', 'variants', 'bySkill', 'byModule', 'pools', 'schedule', 'rounds', 'bountyDrafts', 'overrides', 'branches', 'tiles']);
/** Id fields that align two arrays of records (first one present and unique on both sides wins). */
const ARRAY_IDS = ['skillId', 'uniEquipId', 'effectId', 'id', 'modeId', 'key', 'alias', 'tokenId', 'talentIndex', 'index', 'round', 'type'];
const CJK = /[぀-ヿ㐀-鿿豈-﫿＀-￯　-〿]/;
const HAN = /[㐀-鿿豈-﫿]/;

// ===== 1. EN cache (normalized copy of the files build-data reads) ==============================================

function buildCache() {
  fs.rmSync(TMP, { recursive: true, force: true });
  const rel = ['excel/activity_table.json', 'excel/character_table.json', 'excel/skill_table.json', 'excel/range_table.json',
    'excel/uniequip_table.json', 'excel/battle_equip_table.json', 'excel/enemy_handbook_table.json', 'levels/enemydata/enemy_database.json'];
  for (const d of ['levels/activities/act1autochess', 'levels/activities/act2autochess']) {
    for (const f of fs.readdirSync(path.join(SRC, d)).filter((x) => x.endsWith('.json'))) rel.push(`${d}/${f}`);
  }
  let emptied = 0;
  const reviver = (k, v) => (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0 ? (emptied++, []) : v);
  for (const r of rel) {
    let obj = JSON.parse(fs.readFileSync(path.join(SRC, r), 'utf8'), reviver);
    if (r.endsWith('enemy_database.json') && !Array.isArray(obj.enemies)) obj = { enemies: Object.entries(obj).map(([Key, Value]) => ({ Key, Value })) };
    fs.mkdirSync(path.dirname(path.join(CACHE, r)), { recursive: true });
    fs.writeFileSync(path.join(CACHE, r), JSON.stringify(obj));
  }
  return { files: rel.length, emptied };
}

// ===== 2. EN build with the unmodified build-data.mjs ==========================================================

function buildEn() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'build-data.mjs'), '--offline', '--force', '--quiet',
    '--cache', CACHE, '--out', OUT, '--report', REPORT_TMP], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (!fs.existsSync(path.join(OUT, 'chess.json'))) throw new Error(`EN build failed:\n${r.stderr || r.stdout}`);
  const rep = JSON.parse(fs.readFileSync(REPORT_TMP, 'utf8'));
  return { errors: rep.errors.length, warnings: rep.warnings.length, counts: rep.counts };
}

// ===== 3. parallel walk ========================================================================================

const pairs = [];       // { zh, en, file, field, id }
const noRecord = [];    // zh text whose record / field is missing in the EN build
const misaligned = [];  // arrays that could not be aligned (no id, different lengths)
const sameText = {};    // field → count of zh strings the EN build carries unchanged (research / literal text, not localized)

const idLike = (k) => /[_\d]/.test(k) || /^[A-Z]+$/.test(k);

function alignKey(a, b) {
  const objs = (l) => l.length && l.every((x) => x && typeof x === 'object' && !Array.isArray(x));
  if (!objs(a) || !objs(b)) return null;
  for (const k of ARRAY_IDS) {
    const ok = (l) => l.every((x) => x[k] != null && typeof x[k] !== 'object') && new Set(l.map((x) => x[k])).size === l.length;
    if (ok(a) && ok(b)) return k;
  }
  return null;
}

function walk(zh, en, file, labelParts, id) {
  if (typeof zh === 'string') {
    if (!HAN.test(zh)) return;
    const field = `${file}.${labelParts.join('.')}`;
    if (typeof en !== 'string') { noRecord.push({ file, field, id, zh }); return; }
    if (en === zh) { sameText[field] = (sameText[field] || 0) + 1; return; }
    pairs.push({ zh, en, file, field, id });
    return;
  }
  if (!zh || typeof zh !== 'object') return;
  if (Array.isArray(zh)) {
    const enArr = Array.isArray(en) ? en : [];
    const k = alignKey(zh, enArr);
    if (k) {
      const byId = new Map(enArr.map((x) => [x[k], x]));
      zh.forEach((x) => walk(x, byId.get(x[k]), file, [...labelParts, `[${k}]`], `${id}[${k}=${x[k]}]`));
      return;
    }
    if (zh.length !== enArr.length && JSON.stringify(zh).match(HAN)) {
      misaligned.push({ file, field: `${file}.${labelParts.join('.')}`, id, zhLength: zh.length, enLength: enArr.length });
    }
    zh.forEach((x, i) => walk(x, zh.length === enArr.length ? enArr[i] : undefined, file, [...labelParts, '[]'], `${id}[${i}]`));
    return;
  }
  const parentKey = labelParts[labelParts.length - 1];
  for (const [k, v] of Object.entries(zh)) {
    const top = labelParts.length === 0 && RECORD_FILES.has(file);
    const collapse = top || ID_DICTS.has(parentKey) || idLike(k);
    const nextId = top ? k : collapse ? `${id}.${k}` : id;
    walk(v, en && typeof en === 'object' ? en[k] : undefined, file, [...labelParts, collapse ? '*' : k], nextId);
  }
}

// ===== 4. guards ===============================================================================================

const CN_DIGIT = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
/** 三 → 3, 十二 → 12, 二十五 → 25, 一百 → 100 (null when not a plain numeral). */
function cnNumber(s) {
  let total = 0, cur = 0;
  for (const ch of s) {
    if (ch in CN_DIGIT) cur = CN_DIGIT[ch];
    else if (ch === '十' || ch === '百' || ch === '千') { total += (cur || 1) * { 十: 10, 百: 100, 千: 1000 }[ch]; cur = 0; } else return null;
  }
  return total + cur;
}
const EN_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twice: 2, thrice: 3, double: 2, doubled: 2, triple: 3, tripled: 3 };
/** Spell-out numbers become digits before the guard compares: zh numerals before a measure word, EN number words. */
function normalizeNumerals(s, zh) {
  let t = s.replace(/％/g, '%').replace(/一半|\bhalf\b/gi, '50%');
  // zh: every numeral run (一 → 1 is dropped below anyway, so 一定 / 统一 cost nothing); the 【117】 label some zh
  // garrison texts open with has no EN counterpart
  if (zh) t = t.replace(/^【\d+】/, '').replace(/[零一二两三四五六七八九十百千]+/g, (m) => String(cnNumber(m) ?? m));
  else t = t.replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twice|thrice|doubled|double|tripled|triple)\b/gi, (m) => String(EN_WORDS[m.toLowerCase()]));
  return t;
}
/**
 * Numbers of a text (spelled-out numerals normalized, thousands separators dropped, decimals kept, % attached), as a
 * sorted multiset. Plain 0 and 1 are left out: they mostly stand for an article / 一定 / once on one side only.
 */
function numbers(s, zh, spelled = true) {
  return ((spelled ? normalizeNumerals(s, zh) : s.replace(/％/g, '%')).match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?%?|\d+(?:\.\d+)?%?/g) || [])
    .map((x) => x.replace(/,/g, '')).filter((x) => x !== '0' && x !== '1').sort();
}
/**
 * Number guard. Balance values always reach the zh data as ASCII digits (resolved blackboards, official texts), so a
 * zh text without any ASCII digit (names, 能够阻挡三个敌人) carries no balance number and passes; otherwise the
 * normalized multisets must be equal.
 */
const sameNumbers = (zh, en) => {
  if (!/\d/.test(zh.replace(/^【\d+】/, ''))) return true;
  // every number written in digits on one side must be among the numbers (digits or spelled out) of the other: a
  // changed value fails both ways, a paraphrased numeral (周围四格 → adjacent, 两场 → 2 battles) does not
  const hard = (s, z) => new Set(numbers(s.replace(/^【\d+】/, ''), z, false));
  const all = (s, z) => new Set(numbers(s, z));
  const [hz, hy, az, ay] = [hard(zh, true), hard(en, false), all(zh, true), all(en, false)];
  return [...hz].every((v) => ay.has(v)) && [...hy].every((v) => az.has(v));
};
// ===== 5. main =================================================================================================

const cache = buildCache();
const build = buildEn();
for (const f of FILES) {
  const zh = JSON.parse(fs.readFileSync(path.join(DATA, `${f}.json`), 'utf8'));
  const en = JSON.parse(fs.readFileSync(path.join(OUT, `${f}.json`), 'utf8'));
  walk(zh, en, f, [], f);
}

// emote set names (shared/constants.js EMOTE_THEMES, from the official item_table): the EN item of the same themeId
{
  const items = JSON.parse(fs.readFileSync(path.join(SRC, 'excel', 'item_table.json'), 'utf8')).items || {};
  const { EMOTE_THEMES } = await import(pathToFileURL(path.join(ROOT, 'shared', 'constants.js')).href);
  for (const t of EMOTE_THEMES) {
    const en = items[t.themeId]?.name;
    if (typeof en === 'string' && en.trim()) pairs.push({ zh: t.name, en, file: 'constants', field: 'EMOTE_THEMES name (item_table)', id: t.themeId });
    else noRecord.push({ file: 'constants', field: 'EMOTE_THEMES name', id: t.themeId, zh: t.name });
  }
}

// item flavor: build-data takes it from research 04 (the official zh character_table itemDesc of the item's trap), so
// the EN build repeats the Chinese; pair it with the EN character_table itemDesc of the same trap instead
{
  const ct = JSON.parse(fs.readFileSync(path.join(SRC, 'excel', 'character_table.json'), 'utf8'));
  const items = JSON.parse(fs.readFileSync(path.join(DATA, 'items.json'), 'utf8'));
  for (const it of Array.isArray(items) ? items : Object.values(items.items || items)) {
    if (!it || typeof it.flavor !== 'string' || !it.flavor || !it.trapId) continue;
    const en = ct[it.trapId]?.itemDesc;
    if (typeof en === 'string' && en.trim()) pairs.push({ zh: it.flavor, en, file: 'items', field: 'flavor (character_table itemDesc)', id: it.id });
    else noRecord.push({ file: 'items', field: 'flavor', id: it.id, zh: it.flavor });
  }
}

// plain twins: the markup-free text of every rich pair (as base.mjs does for the agents' dictionary)
const zhSeen = new Set(pairs.map((p) => p.zh));
for (const p of [...pairs]) {
  if (!/<[@$][A-Za-z0-9_.\-]+>/.test(p.zh)) continue;
  const z = richTextPlain(p.zh);
  if (z !== p.zh && !zhSeen.has(z)) pairs.push({ ...p, zh: z, en: richTextPlain(p.en), field: `${p.field} (plain)` });
}

const numberGuard = [], enEmpty = [], enCjk = [];
const groups = new Map(); // zh → Map(en → [pair])
for (const p of pairs) {
  const rec = { id: p.id, field: p.field, zh: p.zh, en: p.en };
  if (!p.en.trim()) { enEmpty.push(rec); continue; }
  if (CJK.test(p.en)) { enCjk.push(rec); continue; }
  if (!sameNumbers(p.zh, p.en)) { numberGuard.push({ ...rec, zhNumbers: numbers(p.zh, true), enNumbers: numbers(p.en, false) }); continue; }
  if (!groups.has(p.zh)) groups.set(p.zh, new Map());
  const g = groups.get(p.zh);
  if (!g.has(p.en)) g.set(p.en, []);
  g.get(p.en).push(p);
}

const overrides = {}, conflicts = [], byField = {}, byFile = {};
for (const [zh, g] of groups) {
  const ranked = [...g.entries()].sort((a, b) => b[1].length - a[1].length); // stable: first seen wins a tie
  const [en, uses] = ranked[0];
  overrides[zh] = en;
  const field = uses[0].field;
  byField[field] = (byField[field] || 0) + 1;
  byFile[uses[0].file] = (byFile[uses[0].file] || 0) + 1;
  if (ranked.length > 1) {
    conflicts.push({ zh, kept: { en, count: uses.length, ids: uses.slice(0, 5).map((u) => u.id) },
      dropped: ranked.slice(1).map(([e, u]) => ({ en: e, count: u.length, ids: u.slice(0, 5).map((x) => x.id) })) });
  }
}

// compare with the current dictionary
let current = {};
try { current = JSON.parse(fs.readFileSync(path.join(ROOT, 'public', 'i18n', 'en.json'), 'utf8')); } catch { /* not built */ }
const changed = Object.keys(overrides).filter((z) => z in current && current[z] !== overrides[z]);
const added = Object.keys(overrides).filter((z) => !(z in current));

const sorted = Object.fromEntries(Object.keys(overrides).sort().map((z) => [z, overrides[z]]));
fs.writeFileSync(path.join(DIR, 'official-overrides.json'), `${JSON.stringify(sorted, null, 1)}\n`);
const report = {
  summary: {
    written: Object.keys(overrides).length, changedVsEnJson: changed.length, newVsEnJson: added.length,
    numberGuard: numberGuard.length, noEnRecord: noRecord.length, enEmpty: enEmpty.length, enCjk: enCjk.length,
    conflicts: conflicts.length, misalignedArrays: misaligned.length, enBuild: build, cache,
  },
  byFile, byField, sameTextInBothBuilds: sameText,
  changedVsEnJson: changed.map((z) => ({ zh: z, was: current[z], now: overrides[z] })),
  numberGuard, noEnRecord: noRecord, enEmpty, enCjk, conflicts, misalignedArrays: misaligned,
};
fs.writeFileSync(path.join(DIR, 'official-report.json'), `${JSON.stringify(report, null, 1)}\n`);
if (!process.argv.includes('--keep')) fs.rmSync(TMP, { recursive: true, force: true });

console.log(`official-overrides.json: ${report.summary.written} pairs (${changed.length} differ from en.json, ${added.length} new)`);
console.log(`skipped: number guard ${numberGuard.length}, EN empty ${enEmpty.length}, EN still CJK ${enCjk.length}; no EN record ${noRecord.length}; conflicts ${conflicts.length}; misaligned arrays ${misaligned.length}`);
console.log(`EN build: ${build.errors} integrity errors, ${build.warnings} warnings (forced; see --keep)`);
for (const [f, n] of Object.entries(byFile)) console.log(`  ${f}: ${n}`);
