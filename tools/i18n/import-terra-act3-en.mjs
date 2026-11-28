#!/usr/bin/env node
// Import Terra Archive EN for act3autochess into (under .cache/, never committed — Terra's README terms):
//   .cache/terra-tl-en/terra-act3-en.json        — flat zh→en (for reuse-misses)
//   .cache/terra-tl-en/terra-act3-en-paths.json  — {file,id,path,en} leaves keyed by act3 ids
// tools/build-version-i18n.mjs reads both and writes the committed data/versions/<slug>/i18n/en.json.
//
// Source: https://files.terra-archive.net/assets/tl/en/manifest.json → autochess.json + autochess-kits.json
// (exact Chinese keys from the game tables, including rich tags / {i:fmt}). Keys often store a
// literal "\n" escape; normalize to real newlines before lookup. Kit keys that still have
// blackboard placeholders are matched to filled skill/talent/trait descRaw via resolvePlaceholders
// + the row's own bb (tools/build-i18n.mjs).
//
// Terms: https://files.terra-archive.net/assets/tl/en/README.md (read 2026-11-21): entries without "x":1 are
// official Global EN; the rest is Terra's unofficial (partly machine-translated) text. Kits use the same
// terms (Terra listed autochess-kits.json in the manifest / README from 2026-11-22).
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VERSION_TEXT_FILES } from '../build-version-i18n.mjs';
import { resolvePlaceholders, shapeKey } from '../build-i18n.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const CACHE_DIR = join(ROOT, '.cache/terra-tl-en');
const DICT_OUT = join(CACHE_DIR, 'terra-act3-en.json');
const PATHS_OUT = join(CACHE_DIR, 'terra-act3-en-paths.json');
const TERRA_README = 'https://files.terra-archive.net/assets/tl/en/README.md';
const TERRA_README_READ = '2026-11-21';
const TERRA_CREDIT = 'English text: Terra Archive (terra-archive.net), unofficial (partly machine-translated) translation';
const MANIFEST_URL = 'https://files.terra-archive.net/assets/tl/en/manifest.json';
const UA = { headers: { 'user-agent': 'stronghold-protocol-i18n' } };
/** Files the importer requires from the TL manifest (kits listed since 2026-11-22). */
const REQUIRED_TL_FILES = Object.freeze(['autochess.json', 'autochess-kits.json']);
const KITS_NOTE = 'operator kits from autochess-kits.json in the TL manifest (same README terms; skill descs rendered from templates via blackboard)';

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('usage: node tools/i18n/import-terra-act3-en.mjs');
  process.exit(0);
}

/** Terra TL keys/values often use a literal backslash-n instead of a real newline. */
const normNl = (s) => String(s ?? '').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\r\n/g, '\n');
const unmd = (s) => normNl(s).replace(/\*\*/g, '').trim();
const stripTags = (s) => normNl(s).replace(/<[@$#][^<>]*>/g, '').replace(/<\/>/g, '').replace(/<\/?color[^<>]*>/gi, '');
const hasCjk = (s) => /[\u4e00-\u9fff]/.test(s);
const hasPlaceholder = (s) => typeof s === 'string' && /\{-?[A-Za-z_@][^{}:]*(?::[^{}]+)?\}/.test(s);

/**
 * Download (or reuse hash-cached) one Terra TL JSON file.
 * @param {{ file: string, url: string, hash: string }} entry
 * @param {string | null} updated
 */
async function loadTlFile(entry, updated) {
  const cached = join(CACHE_DIR, entry.file);
  const metaPath = join(CACHE_DIR, `${entry.file.replace(/\.json$/i, '')}.meta.json`);
  let raw;
  try {
    const prev = JSON.parse(readFileSync(metaPath, 'utf8'));
    if (prev.hash === entry.hash && existsSync(cached)) raw = readFileSync(cached, 'utf8');
  } catch { /* fetch */ }
  if (!raw) {
    const dictRes = await fetch(entry.url, UA);
    if (!dictRes.ok) throw new Error(`Terra TL ${entry.file} ${entry.url}: HTTP ${dictRes.status}`);
    raw = await dictRes.text();
    writeFileSync(cached, raw);
    writeFileSync(metaPath, `${JSON.stringify({ hash: entry.hash, url: entry.url, updated }, null, 2)}\n`);
  }
  return JSON.parse(raw);
}

async function loadTlDict() {
  mkdirSync(CACHE_DIR, { recursive: true });
  const manRes = await fetch(MANIFEST_URL, UA);
  if (!manRes.ok) throw new Error(`Terra TL manifest ${MANIFEST_URL}: HTTP ${manRes.status}`);
  const manifest = await manRes.json();
  writeFileSync(join(CACHE_DIR, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  const byName = new Map((manifest.files || []).map((f) => [f.file, f]));
  for (const name of REQUIRED_TL_FILES) {
    const entry = byName.get(name);
    if (!entry?.url || !entry?.hash) throw new Error(`${name} missing from Terra TL manifest`);
  }

  /** @type {Map<string, { en: string, unofficial: boolean }>} */
  const byZh = new Map();
  /** @type {Map<string, { zh: string, en: string }[]>} */
  const templatesByShape = new Map();
  let official = 0;
  let unofficial = 0;
  /** @type {{ file: string, hash: string, url: string, entries: number }[]} */
  const fileMeta = [];

  for (const name of REQUIRED_TL_FILES) {
    const entry = byName.get(name);
    const parsed = await loadTlFile(entry, manifest.updated || null);
    let n = 0;
    for (const [zh0, row] of Object.entries(parsed)) {
      if (!row || typeof row.en !== 'string' || !row.en) continue;
      const zh = normNl(zh0);
      const en = normNl(row.en);
      if (!zh || !en) continue;
      n++;
      const unofficialFlag = row.x === 1;
      if (!byZh.has(zh)) {
        byZh.set(zh, { en, unofficial: unofficialFlag });
        if (unofficialFlag) unofficial++;
        else official++;
      }
      if (hasPlaceholder(zh)) {
        const k = shapeKey(zh);
        if (!templatesByShape.has(k)) templatesByShape.set(k, []);
        templatesByShape.get(k).push({ zh, en });
      }
    }
    fileMeta.push({ file: entry.file, hash: entry.hash, url: entry.url, entries: n });
  }

  const primary = fileMeta.find((f) => f.file === 'autochess.json');
  const kits = fileMeta.find((f) => f.file === 'autochess-kits.json');
  return {
    byZh,
    templatesByShape,
    meta: {
      source: TERRA_README,
      sourceRead: TERRA_README_READ,
      manifest: MANIFEST_URL,
      file: primary.file,
      hash: primary.hash,
      url: primary.url,
      kitsFile: kits.file,
      kitsHash: kits.hash,
      kitsUrl: kits.url,
      files: fileMeta,
      updated: manifest.updated || null,
      official,
      unofficial,
      officialGlobalWithoutX: true,
      credit: TERRA_CREDIT,
    },
  };
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

/**
 * Render a filled Chinese descRaw from a kit template + blackboard, or null.
 * @param {string} descRaw
 * @param {object|null|undefined} bb
 * @param {object|null|undefined} bbStr
 * @param {Map<string, { zh: string, en: string }[]>} templatesByShape
 */
function renderKitDesc(descRaw, bb, bbStr, templatesByShape) {
  if (typeof descRaw !== 'string' || !descRaw || !hasCjk(descRaw)) return null;
  if (!bb && !bbStr) return null;
  const cands = templatesByShape.get(shapeKey(descRaw));
  if (!cands?.length) return null;
  for (const t of cands) {
    if (resolvePlaceholders(t.zh, bb || {}, bbStr || {}) !== descRaw) continue;
    const en = resolvePlaceholders(t.en, bb || {}, bbStr || {});
    if (!en || (hasPlaceholder(en) && !hasPlaceholder(descRaw))) continue;
    return en;
  }
  return null;
}

const { byZh, templatesByShape, meta: tlMeta } = await loadTlDict();
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

// Primary: walk every act3 player-facing table against the TL dictionary (exact zh→en)
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

// Secondary: kit skill/talent/trait descs whose Chinese keys are still templates ({atk:0%}, …)
let kitTemplateHits = 0;
const fillKitNode = (id, node, pathPrefix) => {
  if (!node || typeof node !== 'object') return;
  const raw = node.descRaw;
  if (typeof raw !== 'string' || !hasCjk(raw)) return;
  if (tlEn(raw)) return; // exact already covered
  const pathKey = ['chess', id, ...pathPrefix, 'descRaw'].map(String).join('\0');
  if (seenPath.has(pathKey)) return;
  const en = renderKitDesc(raw, node.bb, node.bbStr, templatesByShape);
  if (!en) return;
  addPath('chess', id, [...pathPrefix, 'descRaw'], en, raw, { keepRich: true });
  kitTemplateHits++;
  if (typeof node.desc === 'string' && stripTags(raw) === node.desc && !tlEn(node.desc)) {
    addPath('chess', id, [...pathPrefix, 'desc'], stripTags(en), node.desc);
  }
};

for (const [id, rec] of Object.entries(chessRows)) {
  if (!rec || typeof rec !== 'object') continue;
  if (rec.skill) fillKitNode(id, rec.skill, ['skill']);
  if (Array.isArray(rec.skills)) {
    for (let i = 0; i < rec.skills.length; i++) fillKitNode(id, rec.skills[i], ['skills', i]);
  }
  if (rec.trait && typeof rec.trait === 'object') fillKitNode(id, rec.trait, ['trait']);
  if (Array.isArray(rec.talents)) {
    for (let i = 0; i < rec.talents.length; i++) fillKitNode(id, rec.talents[i], ['talents', i]);
  }
  if (rec.module && typeof rec.module === 'object') fillKitNode(id, rec.module, ['module']);
}

const meta = {
  ...tlMeta,
  generated: new Date().toISOString().slice(0, 10),
  entries: Object.keys(dict).length,
  paths: paths.length,
  tlPathHits,
  plainFromRaw,
  kitTemplateHits,
  kitsBundle: null,
  kitsNote: KITS_NOTE,
};
dict._meta = meta;
writeFileSync(DICT_OUT, `${JSON.stringify(dict, null, 2)}\n`);
writeFileSync(PATHS_OUT, `${JSON.stringify({ _meta: meta, leaves: paths }, null, 2)}\n`);
console.log('wrote', DICT_OUT, PATHS_OUT, {
  entries: meta.entries,
  paths: meta.paths,
  tlPathHits,
  plainFromRaw,
  kitTemplateHits,
  kitsFile: meta.kitsFile,
  kitsHash: meta.kitsHash,
});
