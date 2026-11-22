#!/usr/bin/env node
// Import Terra Archive EN for act3autochess into (under .cache/, never committed — Terra's README terms):
//   .cache/terra-tl-en/terra-act3-en.json        — flat zh→en (for reuse-misses)
//   .cache/terra-tl-en/terra-act3-en-paths.json  — {file,id,path,en} leaves keyed by act3 ids
// tools/build-version-i18n.mjs reads both and writes the committed data/versions/<slug>/i18n/en.json.
//
// Primary source: https://files.terra-archive.net/assets/tl/en/manifest.json → autochess.json
// (exact Chinese keys from the game tables, including rich tags / {i:fmt}). Keys often store a
// literal "\n" escape; normalize to real newlines before lookup.
//
// Secondary (opt-in `--kits`): the Terra autochess EN JS season block for operator kits (chess names /
// skills / traits) that the TL dictionary does not cover yet. Chess ids are reused across seasons — only
// the act3autochess block is read (a missing block is an error). When Terra leaves `n:null`, fall back to
// the Latin appellation (never the backup unit name). Default is `--no-kits` until Terra confirms the
// same README terms cover the bundle (contact@terra-archive.net).
//
// Terms: https://files.terra-archive.net/assets/tl/en/README.md (read 2026-11-21): entries without "x":1 are
// official Global EN; the rest is Terra's unofficial (partly machine-translated) text. The kits JS bundle is
// [ASSUMED] to fall under the same terms until Terra lists it in the README.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION_TEXT_FILES } from '../build-version-i18n.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE_DIR = join(ROOT, '.cache/terra-tl-en');
const DICT_OUT = join(CACHE_DIR, 'terra-act3-en.json');
const PATHS_OUT = join(CACHE_DIR, 'terra-act3-en-paths.json');
const TERRA_README = 'https://files.terra-archive.net/assets/tl/en/README.md';
const TERRA_README_READ = '2026-11-21';
const TERRA_CREDIT = 'English text: Terra Archive (terra-archive.net), unofficial (partly machine-translated) translation';
const MANIFEST_URL = 'https://files.terra-archive.net/assets/tl/en/manifest.json';
/** JS module for operator kits (hash in the filename changes; a failed download is an error). */
const JS_SRC = 'https://terra-archive.net/assets/autochess-en-DxX1_XUQ.js';
const JS_CACHE = join(CACHE_DIR, `autochess-en-${createHash('sha256').update(JS_SRC).digest('hex').slice(0, 12)}.js`);
const UA = { headers: { 'user-agent': 'stronghold-protocol-i18n' } };
const KITS_NOTE_ASSUMED = '[ASSUMED] same README terms as the TL dictionary until Terra lists kits there (contact@terra-archive.net)';
const KITS_NOTE_OMITTED = 'kits JS bundle omitted (--no-kits) pending Terra confirmation (contact@terra-archive.net); re-run with --kits once confirmed';

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('usage: node tools/i18n/import-terra-act3-en.mjs [--kits|--no-kits]');
  process.exit(0);
}
/** Kits off until Terra confirms the bundle is under the README terms (PR merge default). */
const wantKits = argv.includes('--kits');

/** Cyrillic appellations → Latin for the English UI. */
const CYR_APP = Object.freeze({ Ольга: 'Olga', Тоска: 'Toska' });

/** Terra TL keys/values often use a literal backslash-n instead of a real newline. */
const normNl = (s) => String(s ?? '').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\r\n/g, '\n');
const unmd = (s) => normNl(s).replace(/\*\*/g, '').trim();
const stripTags = (s) => normNl(s).replace(/<[@$#][^<>]*>/g, '').replace(/<\/>/g, '').replace(/<\/?color[^<>]*>/gi, '');
const hasCjk = (s) => /[\u4e00-\u9fff]/.test(s);

async function loadTlDict() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const manRes = await fetch(MANIFEST_URL, UA);
  if (!manRes.ok) throw new Error(`Terra TL manifest ${MANIFEST_URL}: HTTP ${manRes.status}`);
  const manifest = await manRes.json();
  writeFileSync(join(CACHE_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const entry = (manifest.files || []).find((f) => f.file === 'autochess.json');
  if (!entry?.url || !entry?.hash) throw new Error('autochess.json missing from Terra TL manifest');
  const cached = join(CACHE_DIR, 'autochess.json');
  const metaPath = join(CACHE_DIR, 'autochess.meta.json');
  let raw;
  try {
    const prev = JSON.parse(readFileSync(metaPath, 'utf8'));
    if (prev.hash === entry.hash && existsSync(cached)) raw = readFileSync(cached, 'utf8');
  } catch { /* fetch */ }
  if (!raw) {
    const dictRes = await fetch(entry.url, UA);
    if (!dictRes.ok) throw new Error(`Terra TL autochess.json ${entry.url}: HTTP ${dictRes.status}`);
    raw = await dictRes.text();
    writeFileSync(cached, raw);
    writeFileSync(metaPath, `${JSON.stringify({ hash: entry.hash, url: entry.url, updated: manifest.updated }, null, 2)}\n`);
  }
  const parsed = JSON.parse(raw);
  /** @type {Map<string, { en: string, unofficial: boolean }>} */
  const byZh = new Map();
  let official = 0, unofficial = 0;
  for (const [zh0, row] of Object.entries(parsed)) {
    if (!row || typeof row.en !== 'string' || !row.en) continue;
    const zh = normNl(zh0);
    const en = normNl(row.en);
    if (!zh || !en) continue;
    const unofficialFlag = row.x === 1;
    if (!byZh.has(zh)) {
      byZh.set(zh, { en, unofficial: unofficialFlag });
      if (unofficialFlag) unofficial++;
      else official++;
    }
  }
  return {
    byZh,
    meta: {
      source: TERRA_README,
      sourceRead: TERRA_README_READ,
      manifest: MANIFEST_URL,
      file: entry.file,
      hash: entry.hash,
      url: entry.url,
      updated: manifest.updated || null,
      official,
      unofficial,
      officialGlobalWithoutX: true,
      credit: TERRA_CREDIT,
    },
  };
}

async function loadJsModule() {
  try {
    const t = readFileSync(JS_CACHE, 'utf8');
    if (t.includes('act3autochess')) return t;
  } catch { /* fetch */ }
  const res = await fetch(JS_SRC, UA);
  if (!res.ok) throw new Error(`Terra kits bundle ${JS_SRC}: HTTP ${res.status} (the hash in the file name changes — update JS_SRC)`);
  const t = await res.text();
  if (!t.includes('act3autochess')) throw new Error(`Terra kits bundle ${JS_SRC} has no act3autochess block`);
  mkdirSync(dirname(JS_CACHE), { recursive: true });
  writeFileSync(JS_CACHE, t);
  return t;
}

function act3Block(src) {
  const start = src.indexOf('id:`act3autochess`');
  if (start < 0) return null;
  const next = src.indexOf('id:`act', start + 10);
  return src.slice(start, next > 0 ? next : src.length);
}

function extractObjects(src, idPrefix) {
  const out = [];
  const re = new RegExp(`\\{id:\`${idPrefix}[^\`]*\``, 'g');
  let m;
  while ((m = re.exec(src))) {
    let i = m.index, depth = 0, inTick = false, end = -1;
    for (; i < src.length; i++) {
      const ch = src[i];
      if (ch === '`') { inTick = !inTick; continue; }
      if (inTick) continue;
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end > 0) out.push(src.slice(m.index, end));
  }
  return out;
}

const field = (obj, key) => (obj.match(new RegExp(`(?:^|[,{])${key}:\`([^\`]*)\``)) || [])[1] || null;

function chessName(obj) {
  const m = obj.match(/,op:`[^`]+`,n:(null|`([^`]*)`)/);
  if (!m) return null;
  if (m[1] === 'null') return null;
  return m[2] || null;
}

function nameFallback(rec) {
  const app = typeof rec?.appellation === 'string' ? rec.appellation.trim() : '';
  if (!app) return null;
  if (CYR_APP[app]) return CYR_APP[app];
  if (/^[\x20-\x7E]+$/.test(app)) return app;
  return null;
}

function loadDataFile(name) {
  const p = join(ROOT, 'data/versions/act3autochess-v3_1', `${name}.json`);
  if (!existsSync(p)) return null;
  const json = JSON.parse(readFileSync(p, 'utf8'));
  return json[name] && typeof json[name] === 'object' && !Array.isArray(json[name]) ? json[name] : json;
}

function walkStrings(node, path, visit) {
  if (typeof node === 'string') {
    visit(path, node, path.length ? String(path[path.length - 1]) : '');
    return;
  }
  if (Array.isArray(node)) {
    for (let i = 0; i < node.length; i++) walkStrings(node[i], [...path, i], visit);
    return;
  }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) walkStrings(node[k], [...path, k], visit);
  }
}

const { byZh, meta: tlMeta } = await loadTlDict();
const chessRows = loadDataFile('chess') || {};

/** @type {Record<string, string>} */
const dict = Object.create(null);
/** @type {{ file: string, id: string, path: (string|number)[], en: string }[]} */
const paths = [];
const seenPath = new Set();

const addDict = (zh, en) => {
  const e = unmd(en);
  if (!zh || !e || zh === e || !hasCjk(zh)) return;
  if (!dict[zh]) dict[zh] = e;
};

const addPath = (file, id, path, en, zh, { keepRich = false } = {}) => {
  const e = keepRich ? normNl(en).trim() : unmd(en);
  if (!e) return;
  const key = `${file}\0${id}\0${path.map(String).join('\0')}`;
  if (seenPath.has(key)) return;
  seenPath.add(key);
  paths.push({ file, id, path, en: e });
  if (zh) addDict(zh, keepRich ? stripTags(e) || e : e);
};

/** Lookup Terra TL EN for a Chinese leaf (exact, after newline normalize). */
const tlEn = (zh) => {
  if (typeof zh !== 'string' || !zh || !hasCjk(zh)) return null;
  const hit = byZh.get(zh) || byZh.get(normNl(zh));
  return hit?.en || null;
};

// Primary: walk every act3 player-facing table against the TL dictionary
let tlPathHits = 0;
let plainFromRaw = 0;
for (const file of VERSION_TEXT_FILES) {
  const json = loadDataFile(file);
  if (!json || typeof json !== 'object' || Array.isArray(json)) continue;
  for (const [id, record] of Object.entries(json)) {
    if (record == null || (typeof record !== 'object' && typeof record !== 'string')) continue;
    /** @type {Map<string, string>} */
    const rawEnByPath = new Map();
    walkStrings(typeof record === 'string' ? record : record, typeof record === 'string' ? [] : [], (path, zh, key) => {
      const en = tlEn(zh);
      if (!en) return;
      const keepRich = /Raw$/.test(key) || /<[@$]/.test(en);
      addPath(file, id, path, en, zh, { keepRich });
      tlPathHits++;
      if (/Raw$/.test(key)) rawEnByPath.set(path.slice(0, -1).concat([key.replace(/Raw$/, '')]).map(String).join('\0'), en);
    });
    // Plain sibling of a translated *Raw* leaf: strip tags when the plain Chinese is the stripped Raw
    walkStrings(typeof record === 'string' ? record : record, typeof record === 'string' ? [] : [], (path, zh, key) => {
      if (key.endsWith('Raw') || !hasCjk(zh)) return;
      const rawKey = `${key}Raw`;
      const parent = path.slice(0, -1);
      let cur = record;
      for (const p of parent) cur = cur?.[p];
      const rawZh = cur && typeof cur === 'object' ? cur[rawKey] : null;
      if (typeof rawZh !== 'string' || stripTags(rawZh) !== zh) return;
      if (tlEn(zh)) return; // already mapped
      const rawEn = rawEnByPath.get([...parent, key].map(String).join('\0'));
      if (!rawEn) return;
      addPath(file, id, path, stripTags(rawEn), zh);
      plainFromRaw++;
    });
  }
}

// Secondary: operator kits from the Terra JS season block (TL file has almost no chess skills)
let chessHits = 0;
let nameFromApp = 0;
if (wantKits) {
  const jsSrc = await loadJsModule();
  const block = act3Block(jsSrc);
  if (!block) throw new Error('Terra kits bundle has no act3autochess season block');
  const kitObjs = extractObjects(block, 'chess_char_');
  if (!kitObjs.length) throw new Error('Terra kits bundle act3autochess block has no chess_char_ objects');
  for (const obj of kitObjs) {
    const id = field(obj, 'id');
    if (!id || !chessRows[id]) continue;
    chessHits++;
    const rec = chessRows[id];
    let n = chessName(obj);
    if (!n) {
      n = nameFallback(rec);
      if (n) nameFromApp++;
    }
    // Prefer TL name when present; otherwise JS / appellation
    if (rec.name && tlEn(rec.name)) {
      addPath('chess', id, ['name'], tlEn(rec.name), rec.name);
    } else if (n) {
      addPath('chess', id, ['name'], n, rec.name);
    }

    const skillObjs = [...obj.matchAll(/\{n:`([^`]*)`,i:(\d+),ic:`([^`]*)`,d:`([^`]*)`,lv:(\d+)(?:,dG:`([^`]*)`,lvG:(\d+))?(,df:1)?\}/g)];
    let chosen = skillObjs.find((s) => s[8]) || skillObjs.find((s) => s[6]) || skillObjs[0];
    if (rec.skill?.name) {
      const byName = skillObjs.find((s) => s[1] === rec.skill.name) || skillObjs.find((s) => unmd(s[1]) === rec.skill.name);
      if (byName) chosen = byName;
    }
    const fillSkill = (targetId, skillRec, sk, pathPrefix) => {
      if (!skillRec || !sk) return;
      if (skillRec.name && !tlEn(skillRec.name)) addPath('chess', targetId, [...pathPrefix, 'name'], sk[1], skillRec.name);
      if (skillRec.descRaw && !tlEn(skillRec.descRaw)) {
        addPath('chess', targetId, [...pathPrefix, 'descRaw'], sk[4], skillRec.descRaw, { keepRich: true });
        if (skillRec.desc && stripTags(skillRec.descRaw) === skillRec.desc) {
          addPath('chess', targetId, [...pathPrefix, 'desc'], stripTags(sk[4]), skillRec.desc);
        } else if (skillRec.desc && !tlEn(skillRec.desc)) {
          addPath('chess', targetId, [...pathPrefix, 'desc'], sk[4], skillRec.desc);
        }
      }
    };
    if (chosen && rec.skill) fillSkill(id, rec.skill, chosen, ['skill']);
    if (Array.isArray(rec.skills) && skillObjs.length) {
      for (let i = 0; i < Math.min(rec.skills.length, skillObjs.length); i++) {
        fillSkill(id, rec.skills[i], skillObjs[i], ['skills', i]);
      }
    }
    if (rec.goldenId && chessRows[rec.goldenId]) {
      const g = chessRows[rec.goldenId];
      if (n && g.name && !tlEn(g.name)) addPath('chess', rec.goldenId, ['name'], n, g.name);
      if (chosen?.[6] && g.skill) {
        fillSkill(rec.goldenId, g.skill, [null, chosen[1], null, null, chosen[6]], ['skill']);
      }
    }
    const trait = (obj.match(/trait:`([^`]*)`/) || [])[1];
    if (trait && rec.trait) {
      if (typeof rec.trait === 'string' && !tlEn(rec.trait)) addPath('chess', id, ['trait'], trait, rec.trait);
      if (rec.trait.descRaw && !tlEn(rec.trait.descRaw)) {
        addPath('chess', id, ['trait', 'descRaw'], trait, rec.trait.descRaw, { keepRich: true });
        if (rec.trait.desc && stripTags(rec.trait.descRaw) === rec.trait.desc) {
          addPath('chess', id, ['trait', 'desc'], stripTags(trait), rec.trait.desc);
        }
      }
    }
  }
} else {
  console.log('import-terra-act3-en: skipping kits JS bundle (--no-kits; pass --kits once Terra confirms)');
}

const meta = {
  ...tlMeta,
  generated: new Date().toISOString().slice(0, 10),
  entries: Object.keys(dict).length,
  paths: paths.length,
  tlPathHits,
  plainFromRaw,
  chessHits,
  nameFromAppellation: nameFromApp,
  jsFallback: wantKits,
  kitsBundle: wantKits ? JS_SRC : null,
  kitsNote: wantKits ? KITS_NOTE_ASSUMED : KITS_NOTE_OMITTED,
};
dict._meta = meta;
writeFileSync(DICT_OUT, `${JSON.stringify(dict, null, 2)}\n`);
writeFileSync(PATHS_OUT, `${JSON.stringify({ _meta: meta, leaves: paths }, null, 2)}\n`);
console.log('wrote', DICT_OUT, PATHS_OUT, meta);
