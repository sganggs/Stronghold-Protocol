// test/feedback7-voices.test.js — the Japanese voice dub beside the Chinese one (0.2.2; the owner's request of 2026-10-08
// 「全套的日配语音」): tools/assets/plan.mjs plans `audio.voiceJp` — the same slots and file names from the
// ArknightsAssets2 `voice/` folder (the JP dub), under audio/voice/jp/ — the committed data/assets.json lists it for every
// operator the Chinese tree has (checked against public/assets when present), the settings carry 语音语言 (中文 by
// default, the four language packs translate the row), and tools/package.mjs FULL_ZIP_JP_VOICE decides whether the full
// zip ships the JP files (default: yes) — held back, they are neither missing nor deleted by an update.
// The client's choice of line and its fallback: test/ui/audio.test.js (voiceLine).
// Run: node --test test/feedback7-voices.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPlan, VOICE_JP_LANG } from '../tools/assets/plan.mjs';
import { indexAudio, VOICE_DIRS } from '../tools/assets/audio.mjs';
import { RAW } from '../tools/assets/sources.mjs';
import { artPlan, FULL_ZIP_JP_VOICE, JP_VOICE_DIR } from '../tools/package.mjs';
import { DEFAULT_SETTINGS, VOICE_LANGS, sanitizeSettings } from '../public/js/ui/gameLogic.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

/** A charword_table.json with two operators: one the game fields (planned), one it does not (a 预备干员: no voice). */
const CHARWORD = {
  charWords: {
    a: { charId: 'char_263_skadi', wordKey: 'char_263_skadi', placeType: 'BATTLE_SELECT', voiceId: 'CN_021', voiceIndex: 21, voiceAsset: 'char_263_skadi/CN_021' },
    b: { charId: 'char_263_skadi', wordKey: 'char_263_skadi', placeType: 'BATTLE_SELECT', voiceId: 'CN_022', voiceIndex: 22, voiceAsset: 'char_263_skadi/CN_022' },
    c: { charId: 'char_263_skadi', wordKey: 'char_263_skadi', placeType: 'BATTLE_START', voiceId: 'CN_019', voiceIndex: 19, voiceAsset: 'char_263_skadi/CN_019' },
    d: { charId: 'char_263_skadi', wordKey: 'char_263_skadi', placeType: 'GACHA', voiceId: 'CN_011', voiceIndex: 11, voiceAsset: 'char_263_skadi/CN_011' },
    e: { charId: 'char_602_cdfend', wordKey: 'char_602_cdfend', placeType: 'BATTLE_SELECT', voiceId: 'CN_021', voiceIndex: 21, voiceAsset: 'char_602_cdfend/CN_021' },
  },
};
const OPS = { char_263_skadi: { name: '斯卡蒂', skills: [] } };
const plan = (extra = {}) => buildPlan({ assets07: {}, ops03: {}, enemies05: {}, maps05: {}, audio: indexAudio({}), modelsData: {},
  charword: CHARWORD, extraOperators: OPS, ...extra }).template;

test('plan: audio.voiceJp is the JP dub (ArknightsAssets2 voice/) of the very slots and file names of audio.voice, under audio/voice/jp/', () => {
  assert.equal(VOICE_JP_LANG, 'jp');
  assert.equal(VOICE_DIRS.jp, 'voice', 'the dump folder of the JP dub');
  const t = plan();
  const cn = t.audio.voice.char_263_skadi;
  const jp = t.audio.voiceJp.char_263_skadi;
  assert.deepEqual(Object.keys(jp).sort(), ['select', 'start'], 'the battle slots only, like the Chinese tree (干员报到 not planned)');
  assert.deepEqual(Object.keys(jp).sort(), Object.keys(cn).sort());
  assert.equal(jp.select.length, 2, 'one leaf per line: 选中干员1 / 2');
  assert.deepEqual(jp.select.map((l) => l.alts[0].rel), ['audio/voice/jp/char_263_skadi/cn_021.mp3', 'audio/voice/jp/char_263_skadi/cn_022.mp3']);
  assert.deepEqual(jp.select[0].alts[0].urls, [`${RAW.aa2voice}voice/char_263_skadi/cn_021.mp3`]);
  assert.deepEqual(cn.select.map((l) => l.alts[0].rel), ['audio/voice/cn/char_263_skadi/cn_021.mp3', 'audio/voice/cn/char_263_skadi/cn_022.mp3']);
  assert.deepEqual(cn.select[0].alts[0].urls, [`${RAW.aa2voice}voice_cn/char_263_skadi/cn_021.mp3`]);
  assert.equal(jp.start.alts[0].rel, 'audio/voice/jp/char_263_skadi/cn_019.mp3');
  assert.equal(t.audio.voiceJp.char_602_cdfend, undefined, 'an operator the game does not field (a stand-in) gets neither tree');
  assert.equal(t.audio.voice.char_602_cdfend, undefined);
  assert.deepEqual(Object.keys(t.audio), ['bgm', 'bossBgm', 'voice', 'voiceJp', 'sfx'], 'voiceJp right after voice');
  // --voice-lang puts another dub in audio.voice; voiceJp stays the JP one; voiceJp: false plans no JP tree
  const en = plan({ voiceLang: 'en' });
  assert.equal(en.audio.voice.char_263_skadi.start.alts[0].rel, 'audio/voice/en/char_263_skadi/cn_019.mp3');
  assert.equal(en.audio.voiceJp.char_263_skadi.start.alts[0].rel, 'audio/voice/jp/char_263_skadi/cn_019.mp3');
  assert.equal(plan({ voiceJp: false }).audio.voiceJp, undefined);
  // --voice-all widens both trees alike
  assert.ok(plan({ voiceSlots: null }).audio.voiceJp.char_263_skadi.gacha);
});

test('data/assets.json: voiceJp gives every voiced operator the JP twin of each Chinese line (192 operators, 2688 files); stand-ins, 盟约·辅助干员 and summons have neither', () => {
  const m = readJson('data/assets.json');
  const cn = m.audio.voice;
  const jp = m.audio.voiceJp;
  assert.ok(jp && typeof jp === 'object', 'the manifest carries the JP tree');
  assert.deepEqual(Object.keys(jp), Object.keys(cn), 'the same operators');
  assert.equal(m.stats.voiceJpChars, Object.keys(jp).length);
  assert.equal(m.stats.voiceChars, Object.keys(cn).length);
  assert.equal(Object.keys(jp).length, 192);
  // the JP tree is the Chinese one with the folder swapped: same slots, same lines in the same order, same file names
  assert.deepEqual(JSON.parse(JSON.stringify(cn).replaceAll('/assets/audio/voice/cn/', '/assets/audio/voice/jp/')), jp);
  const lines = [];
  const walk = (x) => { if (typeof x === 'string') lines.push(x); else if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === 'object') Object.values(x).forEach(walk); };
  walk(jp);
  assert.equal(lines.length, 2688);
  for (const u of lines) assert.match(u, /^\/assets\/audio\/voice\/jp\/char_[^/]+\/cn_\d+\.mp3$/);
  // no voice: the 17 stand-ins of data/backups.json (预备干员 / 原型干员), the mode's 盟约·辅助干员, every summon
  const backups = readJson('data/backups.json');
  const standIns = Object.entries(backups.units).filter(([, u]) => Array.isArray(u.standsIn) ? u.standsIn.length : u.standsIn).map(([id]) => id);
  assert.equal(standIns.length, 17);
  for (const id of [...standIns, 'char_616_pithst', ...Object.keys(readJson('data/tokens.json'))]) {
    assert.equal(jp[id], undefined, `${id}: no JP line`);
    assert.equal(cn[id], undefined, `${id}: no line`);
  }
  // the files themselves, where this checkout has downloaded the art
  const dir = path.join(ROOT, 'public', 'assets', 'audio', 'voice', 'jp');
  if (fs.existsSync(dir)) for (const u of lines) assert.ok(fs.statSync(path.join(ROOT, 'public', u)).size > 0, u);
});

test('settings 语音语言: 中文 by default, 日本語 kept, nothing else; the row is translated in every language pack', () => {
  assert.deepEqual([...VOICE_LANGS], ['cn', 'jp']);
  assert.equal(DEFAULT_SETTINGS.voiceLang, 'cn', 'not tied to the interface language: 中文 until the player picks 日本語');
  assert.equal(sanitizeSettings({}).voiceLang, 'cn');
  assert.equal(sanitizeSettings({ voiceLang: 'jp' }).voiceLang, 'jp');
  assert.equal(sanitizeSettings({ voiceLang: 'en' }).voiceLang, 'cn', 'no English / Korean dub');
  const ui = fs.readFileSync(path.join(ROOT, 'public/js/ui/settings.js'), 'utf8');
  assert.match(ui, /updateSettings\(\{ voiceLang: id \}\)/);
  assert.match(ui, /const VOICE_LANG_NAMES = \{ cn: '中文', jp: '日本語' \};/, 'each dub named in its own language');
  for (const code of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = readJson(`public/i18n/${code}.json`);
    assert.ok(typeof pack['语音语言'] === 'string' && pack['语音语言'] && pack['语音语言'] !== '语音语言', `${code}: 语音语言`);
  }
});

test('package: the full zip ships the JP dub by default; FULL_ZIP_JP_VOICE off holds it back (not missing, not an orphan, never removed by an update); the lite zip has no art', () => {
  assert.equal(FULL_ZIP_JP_VOICE, true, '0.2.2 ships both dubs in the full zip');
  assert.equal(JP_VOICE_DIR, 'public/assets/audio/voice/jp/');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-voicejp-'));
  try {
    const cnRel = 'public/assets/audio/voice/cn/char_263_skadi/cn_021.mp3';
    const jpRel = 'public/assets/audio/voice/jp/char_263_skadi/cn_021.mp3';
    const jpRel2 = 'public/assets/audio/voice/jp/char_263_skadi/cn_022.mp3';
    for (const rel of [cnRel, jpRel]) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), 'ID3'); }
    fs.mkdirSync(path.join(dir, 'data'));
    const url = (rel) => `/${rel.slice('public/'.length)}`;
    fs.writeFileSync(path.join(dir, 'data', 'assets.json'), JSON.stringify({ audio: {
      voice: { char_263_skadi: { select: url(cnRel) } }, voiceJp: { char_263_skadi: { select: [url(jpRel), url(jpRel2)] } } } }));
    const on = artPlan(dir);
    assert.ok(on.files.includes(cnRel) && on.files.includes(jpRel), 'both dubs ship');
    assert.deepEqual(on.missing, [jpRel2], 'a listed JP file not on disk is missing, like any art');
    assert.deepEqual(on.held, []);
    const off = artPlan(dir, { jpVoice: false });
    assert.ok(off.files.includes(cnRel), 'the Chinese dub ships');
    assert.ok(!off.files.includes(jpRel), 'the JP files stay out of the full zip');
    assert.deepEqual(off.held, [jpRel, jpRel2], 'held back on purpose (setup downloads them; an update never deletes them)');
    assert.deepEqual(off.missing, [], 'not missing');
    assert.deepEqual(off.orphans, [], 'not orphans either');
    assert.deepEqual(artPlan(dir, { lite: true }).files, [], 'the lite zip carries no art');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // the update zip keeps a held file out of `removed` (tools/package.mjs buildUpdate)
  const src = fs.readFileSync(path.join(ROOT, 'tools/package.mjs'), 'utf8');
  assert.match(src, /removable: \(rel\) => !removalProblem\(rel\) && !heldBack\.has\(rel\)/);
});

test('选中干员 on every card tap (review of fb7-voices): two shop / reward cards of one operator are two taps, a re-render is none', async () => {
  // shop / reward cards hand only the chess id to the detail target (no piece, no unit): game.js numbers every card it opens
  // (`tap`), resolveDetail keeps it, and the panel's 选中 key (selectVoiceKey) includes it — the second 斯卡蒂 card spoke
  // nothing before, nor replaced the first card's line (the pool deals duplicates)
  const origFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const name = String(url).split('/').pop();
    let body;
    try { body = readJson(`data/${name}`); } catch { return { ok: false, status: 404, json: async () => ({}) }; }
    return { ok: true, status: 200, json: async () => body };
  };
  try {
    const { resolveDetail, selectVoiceKey } = await import('../public/js/ui/detailPanel.js');
    const { data } = await import('../public/js/data.js');
    await data.loadAll('chess', 'backups');
    const id = Object.values(readJson('data/chess.json')).find((c) => c.charId === 'char_263_skadi' && !c.isGolden).chessId;
    const card = (tap) => resolveDetail({ kind: 'chess', id, hint: null, tap }, new Map(), { priv: null });
    const a = card(1), b = card(2);
    assert.equal(a.chess.charId, 'char_263_skadi');
    assert.deepEqual([a.tap, b.tap], [1, 2], 'the tap rides along');
    assert.notEqual(selectVoiceKey(a), selectVoiceKey(b), 'the second card of the same operator is a new opening');
    assert.equal(selectVoiceKey(card(1)), selectVoiceKey(a), 'the same tap resolved again (a re-render) says nothing more');
    assert.equal(resolveDetail({ kind: 'chess', id }, new Map(), { priv: null }).tap, undefined, 'no tap, no field');
    // pieces and battle units keep their own identity; a non-operator card has no key
    assert.equal(selectVoiceKey({ type: 'chess', chess: { chessId: 'x' }, piece: { uid: 4 } }), 'x:4:');
    assert.equal(selectVoiceKey({ type: 'chess', chess: { chessId: 'x' }, unitId: 9 }), 'x:9:');
    assert.equal(selectVoiceKey({ type: 'item' }), null);
    assert.equal(selectVoiceKey(null), null);
    // the panel keys its 选中 effect on it, and the game screen numbers every operator card it opens
    assert.match(fs.readFileSync(path.join(ROOT, 'public/js/ui/detailPanel.js'), 'utf8'), /const selectKey = voice && detail\?\.type === 'chess' \? selectVoiceKey\(detail\) : null;/);
    const game = fs.readFileSync(path.join(ROOT, 'public/js/screens/game.js'), 'utf8');
    assert.match(game, /onDetail=\$\{\(id, kind, hint\) => setDetail\(\{ kind: kind === 'item' \? 'item' : 'chess', id, hint: hint \|\| null, tap: \+\+cardTap\.current \}\)\}/);
  } finally {
    globalThis.fetch = origFetch;
  }
});
