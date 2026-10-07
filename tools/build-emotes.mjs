#!/usr/bin/env node
// tools/build-emotes.mjs — data/emotes.json: the 36 official in-match emotes of 卫戍协议：盟约 (research 09 §4).
//
// Sources (official gamedata, cached under .cache/gamedata/ like tools/build-data.mjs and downloaded from the same
// Kengxxiao zh_CN mirror when missing):
//   excel/display_meta_table.json  emoticonData: emojiDataDict (id, type, sortId, picId, desc), emoticonThemeDataDict
//                                  (theme → emoji ids), emoticonThemeTypeDict (theme sortId, isBasic)
//   excel/activity_table.json      autoChessData.enabledEmoticonThemeIdList (the 6 themes of the mode = page order),
//                                  autoChessData.constData.chatCD / chatTime (cooldown / bubble seconds)
//   excel/item_table.json          theme item names ("表情套组：虫动", …; optional)
//
// Output (deterministic, no timestamps):
//   { version, source, chatCD, chatTime,
//     themes: [{ themeId, dir, sortId, isBasic, name, emotes: [id…] }],             pages, enabled-list order
//     emotes: [{ id, themeId, sortId, picId, art, label }] }                          36, page order then sortId
// `art` = /assets/local/emoticon/<dir>/<picId>.png (tools/local-extract; key by picId — fooldoctor_03…06 use pics
// 04/05/06/08); the mirror copy that tools/fetch-assets.mjs downloads is data/assets.json ui['emoticon/<dir>/<picId>'].
// Official emotes carry no text (desc is null); `label` is ours and only ever an aria-label.
// shared/constants.js EMOTE_THEMES mirrors this file (test/ui/emotes.test.js keeps them identical).
//
// Usage: node tools/build-emotes.mjs [--offline] [--check] [--out data/emotes.json] [--cache .cache/gamedata]
//   --check    compare with the existing output file instead of writing it (exit 1 when it would change)

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const GAMEDATA_URL = 'https://raw.githubusercontent.com/Kengxxiao/ArknightsGameData/master/zh_CN/gamedata/';
const SCENE = 'AUTOCHESS_BATTLE';

/** Output dir per theme (tools/local-extract/extract.py EMOTE_THEMES). */
export const THEME_DIRS = Object.freeze({
  emoticon_autochess_basic: 'basic',
  emoticon_originium_slug: 'slug',
  emoticon_autochess_basic_2: 'basic_2',
  emoticon_foolsday_doctor: 'fooldoctor',
  emoticon_foolsday_amiya: 'foolamiya',
  emoticon_foolsday_wisdel: 'foolwisdel',
});

/** Our aria-labels (research 09 §4.2: BWIKI wording where it exists, else ours). Never displayed. */
export const LABELS = Object.freeze({
  autochess_battle_happy: '开心', autochess_battle_scared: '害怕', autochess_battle_sorry: '对不起',
  autochess_battle_thanks: '谢谢', autochess_battle_thinking: '思考', autochess_battle_nice_cooperate: '合作愉快',
  autochess_battle_noproblem: '没问题！', autochess_battle_respect: '敬礼！', autochess_battle_call: '欢呼！',
  autochess_battle_playingcool: '酷！', autochess_battle_sad: '伤心', autochess_battle_dying: '快死了',
  slug_autochess_battle_nice_work: '合作愉快！', slug_autochess_battle_thanks: '谢谢！', slug_autochess_battle_sorry: '对不起！',
  slug_autochess_battle_bye: '再见！', slug_autochess_battle_distrust: '？？？', slug_autochess_battle_very_soon: '很快就好！',
});

const themeDir = (themeId) => THEME_DIRS[themeId] || themeId.replace(/^emo?ticon_(autochess_)?/, '');
const shortName = (name, themeId) => String(name || themeId).replace(/^表情套组[：:]/, '');

/**
 * Build the emote catalog from the official tables (pure; exported for tests).
 * @param {{ display: any, activity: any, items?: any }} src parsed display_meta_table / activity_table / item_table
 * @returns {{ doc: object, warnings: string[] }}
 */
export function buildEmotes({ display, activity, items }) {
  const warnings = [];
  const emo = display?.emoticonData;
  const ac = activity?.autoChessData;
  if (!emo?.emojiDataDict || !emo?.emoticonThemeDataDict) throw new Error('display_meta_table: emoticonData missing');
  if (!Array.isArray(ac?.enabledEmoticonThemeIdList)) throw new Error('activity_table: autoChessData.enabledEmoticonThemeIdList missing');
  const themes = [];
  const emotes = [];
  const seenIds = new Set();
  const seenDirs = new Set();
  const own = (o, k) => o != null && Object.prototype.hasOwnProperty.call(o, k);
  for (const themeId of ac.enabledEmoticonThemeIdList) {
    if (themes.some((t) => t.themeId === themeId)) { warnings.push(`theme ${themeId}: listed twice, kept once`); continue; }
    const ids = own(emo.emoticonThemeDataDict, themeId) ? emo.emoticonThemeDataDict[themeId] : null;
    if (!Array.isArray(ids)) { warnings.push(`theme ${themeId}: not in emoticonThemeDataDict`); continue; }
    const type = (own(emo.emoticonThemeTypeDict, themeId) && emo.emoticonThemeTypeDict[themeId]) || {};
    const recs = ids.map((id) => (own(emo.emojiDataDict, id) ? emo.emojiDataDict[id] : null))
      .filter((e) => e && e.type === SCENE && typeof e.id === 'string' && typeof e.picId === 'string' && e.picId)
      .filter((e) => {
        // one wheel cell and one protocol id per emoji: an emoji listed by two themes stays on the first page only
        if (seenIds.has(e.id)) { warnings.push(`${e.id}: already on an earlier page, not repeated in ${themeId}`); return false; }
        seenIds.add(e.id);
        return true;
      })
      .sort((a, b) => a.sortId - b.sortId || (a.id < b.id ? -1 : 1));
    if (!recs.length) { warnings.push(`theme ${themeId}: no ${SCENE} emoji`); continue; }
    const dir = themeDir(themeId);
    if (seenDirs.has(dir)) throw new Error(`theme ${themeId}: art dir emoticon/${dir} is already used by another theme`);
    seenDirs.add(dir);
    const name = items?.items?.[themeId]?.name || themeId;
    themes.push({ themeId, dir, sortId: type.sortId ?? null, isBasic: !!type.isBasic, name, emotes: recs.map((e) => e.id) });
    recs.forEach((e, i) => {
      if (e.desc) warnings.push(`${e.id}: has a desc (${e.desc}); the UI still shows the picture only`);
      emotes.push({
        id: e.id, themeId, sortId: e.sortId, picId: e.picId, art: `/assets/local/emoticon/${dir}/${e.picId}.png`,
        label: LABELS[e.id] || `${shortName(name, themeId)} ${i + 1}`,
      });
    });
  }
  const cd = ac.constData || {};
  const doc = {
    version: 1,
    source: 'display_meta_table.emoticonData (type AUTOCHESS_BATTLE) × activity_table autoChessData.enabledEmoticonThemeIdList',
    chatCD: Number.isFinite(cd.chatCD) ? cd.chatCD : null,
    chatTime: Number.isFinite(cd.chatTime) ? cd.chatTime : null,
    themes,
    emotes,
  };
  return { doc, warnings };
}

/** Two-space-indented JSON, preserving record and key order for readable diffs. */
export function formatEmotes(doc) {
  return JSON.stringify(doc, null, 2) + '\n';
}

async function ensureGamedata(cache, rel, { offline, optional = false }) {
  const abs = join(cache, rel);
  if (existsSync(abs)) return abs;
  if (offline) { if (optional) return null; throw new Error(`missing cached file ${rel} (offline mode)`); }
  await mkdir(dirname(abs), { recursive: true });
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(GAMEDATA_URL + rel, { signal: AbortSignal.timeout(180_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      JSON.parse(text); // never cache a truncated file
      const tmp = `${abs}.tmp-${process.pid}`;
      await writeFile(tmp, text);
      await rename(tmp, abs);
      return abs;
    } catch (e) {
      lastErr = e;
      await new Promise((r) => setTimeout(r, 500 * attempt));
    }
  }
  if (optional) return null;
  throw new Error(`download failed for ${rel}: ${lastErr?.message}`);
}

async function main(argv) {
  const opts = { offline: false, check: false, out: join(ROOT, 'data', 'emotes.json'), cache: join(ROOT, '.cache', 'gamedata') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--offline') opts.offline = true;
    else if (a === '--check') opts.check = true;
    else if (a === '--out' || a === '--cache') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} needs a path`);
      opts[a.slice(2)] = resolve(v);
    } else throw new Error(`unknown option ${a}\nusage: node tools/build-emotes.mjs [--offline] [--check] [--out <file>] [--cache <dir>]`);
  }
  const read = async (p) => (p ? JSON.parse(await readFile(p, 'utf8')) : null);
  const display = await read(await ensureGamedata(opts.cache, 'excel/display_meta_table.json', opts));
  const activity = await read(await ensureGamedata(opts.cache, 'excel/activity_table.json', opts));
  const items = await read(await ensureGamedata(opts.cache, 'excel/item_table.json', { ...opts, optional: true }));
  if (!items) console.warn('build-emotes: item_table unavailable, theme names fall back to theme ids');
  const { doc, warnings } = buildEmotes({ display, activity, items });
  for (const w of warnings) console.warn(`build-emotes: ${w}`);
  const text = formatEmotes(doc);
  if (opts.check) {
    const old = existsSync(opts.out) ? await readFile(opts.out, 'utf8') : null;
    if (old !== text) { console.error(`build-emotes: ${opts.out} is out of date (run node tools/build-emotes.mjs)`); return 1; }
    console.log(`build-emotes: ${opts.out} is up to date (${doc.themes.length} themes, ${doc.emotes.length} emotes)`);
    return 0;
  }
  await writeFile(opts.out, text);
  console.log(`build-emotes: wrote ${opts.out} (${doc.themes.length} themes, ${doc.emotes.length} emotes)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(`build-emotes: ${e.message}`); process.exitCode = 2; });
}
