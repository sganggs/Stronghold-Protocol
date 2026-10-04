// Official emotes (research 09 §4 / §6.6): the 36 in-match emotes of 盟约 (6 themes × 6), their generated reference
// data/emotes.json (tools/build-emotes.mjs), the local-client extraction (tools/local-extract/extract.py), the protocol
// whitelist and the pure helpers of public/js/ui/emotes.js. Browser behaviour (picture-only bubbles, pager, cooldown)
// is covered by test/ui/emotes.e2e.test.js (SP_E2E=1).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EMOTES, EMOTE_THEMES, EMOTE_CATALOG, EMOTE_THEME, EMOTE_LABEL, EMOTE_COOLDOWN_MS, EMOTE_BUBBLE_MS,
  emoteInfo, emoteArtPath, emoteArtGroup,
} from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';
import { buildEmotes, formatEmotes, THEME_DIRS } from '../../tools/build-emotes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const tryJson = (rel) => { try { return readJson(rel); } catch { return null; } };
const EMOTES_JSON = readJson('data/emotes.json');

const ENABLED = ['emoticon_autochess_basic', 'emoticon_originium_slug', 'emoticon_autochess_basic_2',
  'emoticon_foolsday_doctor', 'emoticon_foolsday_amiya', 'emoticon_foolsday_wisdel'];

describe('emote catalog (shared/constants.js)', () => {
  test('6 themes × 6 battle emotes = 36 unique official ids, in wheel order', () => {
    assert.deepEqual(EMOTE_THEMES.map((t) => t.themeId), ENABLED, 'pages follow autoChessData.enabledEmoticonThemeIdList');
    for (const t of EMOTE_THEMES) {
      assert.equal(t.emotes.length, 6, t.themeId);
      const sorts = t.emotes.map((e) => e.sortId);
      assert.deepEqual(sorts, [...sorts].sort((a, b) => a - b), `${t.themeId} by sortId`);
    }
    assert.equal(EMOTES.length, 36);
    assert.equal(new Set(EMOTES).size, 36);
    assert.deepEqual([...EMOTES], EMOTE_CATALOG.map((e) => e.id));
    for (const id of EMOTES) assert.match(id, /^(slug_)?autochess_battle_[a-z0-9_]+$/, id);
    assert.ok(Object.isFrozen(EMOTES) && Object.isFrozen(EMOTE_THEMES) && Object.isFrozen(EMOTE_THEMES[0].emotes));
  });

  test('picId comes from the table, not from the id (fooldoctor 03–06 → pics 04/05/06/08)', () => {
    const doc = EMOTE_THEMES.find((t) => t.themeId === 'emoticon_foolsday_doctor');
    assert.deepEqual(doc.emotes.map((e) => e.picId),
      ['pic_fooldoctor_01_battle', 'pic_fooldoctor_02_battle', 'pic_fooldoctor_04_battle', 'pic_fooldoctor_05_battle', 'pic_fooldoctor_06_battle', 'pic_fooldoctor_08_battle']);
    assert.equal(emoteArtPath('autochess_battle_fooldoctor_06'), '/assets/local/emoticon/fooldoctor/pic_fooldoctor_08_battle.png');
    assert.equal(emoteArtPath('autochess_battle_nice_cooperate'), '/assets/local/emoticon/basic/pic_cooperate_battle.png');
    assert.equal(emoteArtPath('slug_autochess_battle_thanks'), '/assets/local/emoticon/slug/pic_thanks_battle.png');
    assert.equal(emoteArtGroup('autochess_battle_dying'), 'emoticon/basic_2');
    for (const e of EMOTE_CATALOG) assert.match(e.picId, /^pic_.+_battle$/, e.id);
  });

  test('lookups are safe for any input', () => {
    for (const bad of ['happy', 'autochess_room_hello', '__proto__', 'constructor', 'toString', '', null, undefined, 42, {}]) {
      assert.equal(emoteInfo(bad), null, String(bad));
      assert.equal(emoteArtPath(bad), null, String(bad));
      assert.equal(emoteArtGroup(bad), null, String(bad));
    }
    assert.equal(emoteInfo('autochess_battle_call').themeId, 'emoticon_autochess_basic_2');
    assert.equal(EMOTE_THEME.slug_autochess_battle_bye, 'emoticon_originium_slug');
    assert.equal(typeof EMOTE_LABEL.autochess_battle_happy, 'string');
    for (const bad of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      assert.equal(EMOTE_THEME[bad], undefined, `EMOTE_THEME[${bad}]`);
      assert.equal(EMOTE_LABEL[bad], undefined, `EMOTE_LABEL[${bad}]`);
    }
    assert.equal(Object.keys(EMOTE_THEME).length, 36);
    assert.ok(Object.isFrozen(EMOTE_THEME) && Object.isFrozen(EMOTE_LABEL));
  });

  test('protocol accepts exactly the 36 official battle ids (g.emote { id })', () => {
    for (const id of EMOTES) assert.equal(validateC2S({ t: 'g.emote', id }), null, id);
    for (const id of ['happy', 'thanks', 'autochess_room_hello', 'multiv3_battle_thanks', 'duel_battle_happy', '__proto__', '', 7, null]) {
      assert.notEqual(validateC2S({ t: 'g.emote', id }), null, String(id));
    }
  });

  test('cooldown and bubble time are the official chatCD / chatTime', () => {
    assert.equal(EMOTE_COOLDOWN_MS, EMOTES_JSON.chatCD * 1000);
    assert.equal(EMOTE_BUBBLE_MS, EMOTES_JSON.chatTime * 1000);
    assert.equal(EMOTE_COOLDOWN_MS, 1000);
    assert.equal(EMOTE_BUBBLE_MS, 3000);
    // the client reads the bubble time from config.timers (game.js) and the server rate-limits with the constant
    const timers = tryJson('data/config.json')?.timers;
    if (timers) assert.deepEqual([timers.chatCd * 1000, timers.chatBubble * 1000], [EMOTE_COOLDOWN_MS, EMOTE_BUBBLE_MS]);
  });
});

describe('data/emotes.json (tools/build-emotes.mjs)', () => {
  test('is identical to the shared/constants.js table', () => {
    assert.deepEqual(EMOTES_JSON.themes.map(({ themeId, dir, sortId, isBasic, name, emotes }) => ({ themeId, dir, sortId, isBasic, name, emotes })),
      EMOTE_THEMES.map((t) => ({ themeId: t.themeId, dir: t.dir, sortId: t.sortId, isBasic: t.isBasic, name: t.name, emotes: t.emotes.map((e) => e.id) })));
    assert.deepEqual(EMOTES_JSON.emotes, EMOTE_CATALOG.map((e) => ({
      id: e.id, themeId: e.themeId, sortId: e.sortId, picId: e.picId, art: emoteArtPath(e.id), label: e.label,
    })));
  });

  test('regenerating from the cached official tables reproduces it byte for byte', {
    skip: !existsSync(path.join(ROOT, '.cache/gamedata/excel/display_meta_table.json')) && 'no cached display_meta_table.json',
  }, () => {
    const { doc, warnings } = buildEmotes({
      display: readJson('.cache/gamedata/excel/display_meta_table.json'),
      activity: readJson('.cache/gamedata/excel/activity_table.json'),
      items: tryJson('.cache/gamedata/excel/item_table.json'),
    });
    assert.deepEqual(warnings, []);
    assert.equal(formatEmotes(doc), readFileSync(path.join(ROOT, 'data/emotes.json'), 'utf8'));
  });

  test('builder: scene filter, enabled-list page order, sortId order, picId from the table, fallbacks', () => {
    const e = (id, type, sortId, picId) => ({ id, type, sortId, picId, desc: null });
    const display = { emoticonData: {
      emojiDataDict: {
        a_room: e('a_room', 'AUTOCHESS_ROOM', 1, 'pic_a'),
        a_2: e('a_2', 'AUTOCHESS_BATTLE', 20, 'pic_a2_battle'),
        a_1: e('a_1', 'AUTOCHESS_BATTLE', 10, 'pic_a9_battle'),
        b_1: e('b_1', 'AUTOCHESS_BATTLE', 5, 'pic_b_battle'),
        b_multi: e('b_multi', 'ACTMULTIV3_BATTLE', 1, 'pic_m_battle'),
        autochess_battle_happy: e('autochess_battle_happy', 'AUTOCHESS_BATTLE', 1, 'pic_happy_battle'),
      },
      emoticonThemeDataDict: { emoticon_x: ['a_room', 'a_2', 'a_1'], emoticon_originium_slug: ['b_multi', 'b_1'], emoticon_empty: ['a_room'] },
      emoticonThemeTypeDict: { emoticon_x: { sortId: 7, isBasic: true }, emoticon_originium_slug: { sortId: 1001, isBasic: false } },
    } };
    const activity = { autoChessData: {
      enabledEmoticonThemeIdList: ['emoticon_originium_slug', 'emoticon_missing', 'emoticon_x', 'emoticon_empty'],
      constData: { chatCD: 1, chatTime: 3 },
    } };
    const items = { items: { emoticon_originium_slug: { name: '表情套组：虫动' } } };
    const { doc, warnings } = buildEmotes({ display, activity, items });
    assert.deepEqual(doc.themes.map((t) => [t.themeId, t.dir, t.emotes]), [
      ['emoticon_originium_slug', 'slug', ['b_1']],
      ['emoticon_x', 'x', ['a_1', 'a_2']],
    ]);
    assert.equal(doc.emotes.find((x) => x.id === 'a_1').art, '/assets/local/emoticon/x/pic_a9_battle.png');
    assert.equal(doc.emotes.find((x) => x.id === 'a_1').label, 'emoticon_x 1', 'no official text: generic aria label');
    assert.equal(doc.emotes.find((x) => x.id === 'b_1').label, '虫动 1');
    assert.equal(doc.themes[0].name, '表情套组：虫动');
    assert.deepEqual([doc.chatCD, doc.chatTime], [1, 3]);
    assert.equal(warnings.length, 2, warnings.join('; '));
    assert.throws(() => buildEmotes({ display: {}, activity }), /emoticonData/);
    assert.throws(() => buildEmotes({ display, activity: {} }), /enabledEmoticonThemeIdList/);
    const text = formatEmotes(doc);
    assert.deepEqual(JSON.parse(text), doc);
    assert.equal(formatEmotes(buildEmotes({ display, activity, items }).doc), text, 'deterministic');
  });

  test('builder: an emoji listed by two themes / a theme listed twice is kept once; art dirs must be unique', () => {
    const e = (id, sortId, picId = `pic_${id}_battle`) => ({ id, type: 'AUTOCHESS_BATTLE', sortId, picId, desc: null });
    const display = { emoticonData: {
      emojiDataDict: { a: e('a', 1), b: e('b', 2), c: e('c', 3), nopic: { id: 'nopic', type: 'AUTOCHESS_BATTLE', sortId: 4, picId: null } },
      emoticonThemeDataDict: { emoticon_one: ['a', 'b', 'nopic', 'toString'], emoticon_two: ['b', 'c', '__proto__'] },
      emoticonThemeTypeDict: {},
    } };
    const activity = { autoChessData: { enabledEmoticonThemeIdList: ['emoticon_one', 'emoticon_two', 'emoticon_one', 'constructor'] } };
    const { doc, warnings } = buildEmotes({ display, activity });
    assert.deepEqual(doc.themes.map((t) => [t.themeId, t.emotes]), [['emoticon_one', ['a', 'b']], ['emoticon_two', ['c']]]);
    assert.deepEqual(doc.emotes.map((x) => x.id), ['a', 'b', 'c'], 'every protocol id once');
    assert.equal(new Set(doc.emotes.map((x) => x.art)).size, 3);
    assert.ok(warnings.some((w) => /^b: already on an earlier page/.test(w)), warnings.join('; '));
    assert.ok(warnings.some((w) => /emoticon_one: listed twice/.test(w)));
    assert.ok(warnings.some((w) => /constructor: not in emoticonThemeDataDict/.test(w)), 'prototype keys are not themes');
    assert.throws(() => buildEmotes({ display: { emoticonData: { ...display.emoticonData, emoticonThemeDataDict: { emoticon_x: ['a'], emticon_x: ['c'] } } },
      activity: { autoChessData: { enabledEmoticonThemeIdList: ['emoticon_x', 'emticon_x'] } } }), /already used/);
  });

  test('theme dirs agree between the builder, the constants and data/emotes.json', () => {
    for (const t of EMOTE_THEMES) assert.equal(THEME_DIRS[t.themeId], t.dir, t.themeId);
    assert.equal(Object.keys(THEME_DIRS).length, EMOTE_THEMES.length);
  });
});

const PY = ['python3', 'python'].find((bin) => spawnSync(bin, ['--version']).status === 0);
const PY_ENV = { ...process.env, PYTHONDONTWRITEBYTECODE: '1' };

describe('local-client extraction (tools/local-extract/extract.py)', () => {
  test('extracts every emote theme (battle sprites only) into emoticon/<dir>', { skip: !PY && 'no python3' }, () => {
    const r = spawnSync(PY, [path.join(ROOT, 'tools/local-extract/extract.py'), '--print-jobs'], { encoding: 'utf8', env: PY_ENV });
    assert.equal(r.status, 0, r.stderr);
    const { emoteThemes, jobs } = JSON.parse(r.stdout);
    assert.deepEqual(emoteThemes, EMOTE_THEMES.map((t) => ({ themeId: t.themeId, dir: t.dir })));
    for (const t of EMOTE_THEMES) {
      const job = jobs.find((j) => j.sub === `emoticon/${t.dir}`);
      assert.ok(job, t.themeId);
      assert.equal(job.bundle, `ui/emoticon/theme/[uc]${t.themeId}.ab`);
      assert.deepEqual(job.kinds, ['Sprite'], 'the Sprite (true aspect), not the padded Texture2D');
      const keep = new RegExp(job.keep);
      for (const e of t.emotes) assert.ok(keep.test(e.picId), e.picId);
      for (const other of ['pic_hello', 'pic_thanks', 'pic_bg', 'pic_nice_work', 'pic_very_soon']) assert.ok(!keep.test(other), other);
    }
    // the other jobs are untouched
    for (const sub of ['map/autochess', 'ui/battle', 'ui/outer', 'guide']) assert.ok(jobs.some((j) => j.sub === sub && j.keep === null), sub);
  });

  test('--only re-extracts a subset and merges it into the existing manifest', { skip: !PY && 'no python3' }, () => {
    const code = `import sys, json; sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools/local-extract'))}); import extract as e
print(json.dumps({
  'emo': [j[1] for j in e.select_jobs(['emoticon'])], 'slug': [j[1] for j in e.select_jobs(['emoticon/slug/'])],
  'all': len(e.select_jobs([])) == len(e.JOBS), 'none': e.select_jobs(['emo']),
  'merged': e.merge_manifest({'ui/battle': {'b': 1, 'a': 2}, 'emoticon/slug': {'old': 1}, 'emoticon/basic': {'keep': 1}},
                             {'emoticon/slug': {'pic_z_battle': 1, 'pic_a_battle': 2}}, {'emoticon/slug'}),
}))`;
    const r = spawnSync(PY, ['-c', code], { encoding: 'utf8', env: PY_ENV });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.emo, EMOTE_THEMES.map((t) => `emoticon/${t.dir}`));
    assert.deepEqual(out.slug, ['emoticon/slug']);
    assert.equal(out.all, true);
    assert.deepEqual(out.none, [], 'prefixes match whole path segments');
    assert.deepEqual(out.merged, { 'emoticon/basic': { keep: 1 }, 'emoticon/slug': { pic_a_battle: 2, pic_z_battle: 1 }, 'ui/battle': { a: 2, b: 1 } });
    assert.deepEqual(Object.keys(out.merged), ['emoticon/basic', 'emoticon/slug', 'ui/battle'], 'sorted, deterministic');
  });

  const manifest = tryJson('data/local-assets.json');
  test('the extracted manifest lists all 36 pictures under their picId', { skip: !manifest && 'no data/local-assets.json' }, () => {
    for (const e of EMOTE_CATALOG) {
      const entry = manifest.groups[emoteArtGroup(e.id)]?.[e.picId];
      assert.ok(entry, `${e.id} → ${e.picId}`);
      assert.equal(entry.path, emoteArtPath(e.id));
      assert.ok(entry.w >= 64 && entry.h >= 64 && entry.w <= 160 && entry.h <= 160, `${e.picId} ${entry.w}×${entry.h}`);
      assert.equal(entry.kind, 'Sprite');
    }
    for (const t of EMOTE_THEMES) {
      const names = Object.keys(manifest.groups[`emoticon/${t.dir}`]);
      assert.deepEqual(names.sort(), t.emotes.map((e) => e.picId).sort(), `${t.dir}: only the battle sprites`);
    }
    for (const n of ['emoji_bubble_bkg', 'emoji_bkg', 'emoji_cell_bkg', 'emoji_btn', 'emoji_btn_disable']) assert.ok(manifest.groups['ui/battle']?.[n], n);
  });

  test('the listed pictures exist on disk', { skip: (!manifest || !existsSync(path.join(ROOT, 'public/assets/local/emoticon'))) && 'no extracted art' }, () => {
    for (const e of EMOTE_CATALOG) {
      const file = path.join(ROOT, 'public', emoteArtPath(e.id));
      assert.ok(existsSync(file), file);
      const png = readFileSync(file);
      assert.equal(png.subarray(1, 4).toString(), 'PNG', file);
    }
  });
});

describe('public/js/ui/emotes.js helpers', () => {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  };
  const manifest = { version: 1, groups: {
    'emoticon/fooldoctor': { pic_fooldoctor_08_battle: { path: '/assets/local/emoticon/fooldoctor/pic_fooldoctor_08_battle.png', w: 115, h: 115 } },
    'ui/battle': { emoji_bubble_bkg: { path: '/assets/local/ui/battle/emoji_bubble_bkg.png', w: 108, h: 97 } },
  } };
  const realFetch = globalThis.fetch;

  test('art URLs come only from what the manifests list (here the local one, keyed by picId; data/assets.json absent); unknown / unlisted → null', async () => {
    globalThis.fetch = async (url) => (String(url).endsWith('/local-assets.json')
      ? { ok: true, status: 200, json: async () => manifest } : { ok: false, status: 404, json: async () => ({}) });
    try {
      const { data } = await import('../../public/js/data.js');
      await data.invalidate('local');
      await data.load('local');
      const { emoteArtUrl, emoteUiSprite } = await import('../../public/js/ui/emotes.js');
      assert.equal(emoteArtUrl('autochess_battle_fooldoctor_06'), '/assets/local/emoticon/fooldoctor/pic_fooldoctor_08_battle.png');
      assert.equal(emoteArtUrl('autochess_battle_fooldoctor_05'), null, 'unlisted');
      assert.equal(emoteArtUrl('happy'), null, 'v1 id');
      assert.equal(emoteArtUrl('__proto__'), null);
      assert.equal(emoteUiSprite('emoji_bubble_bkg'), '/assets/local/ui/battle/emoji_bubble_bkg.png');
      assert.equal(emoteUiSprite('emoji_bkg'), null);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test('pager helpers: clamp, swipe threshold, remembered theme', async () => {
    const { clampPage, swipeStep, themeIndex, lastThemeIndex, rememberTheme } = await import('../../public/js/ui/emotes.js');
    assert.deepEqual([clampPage(-3), clampPage(2), clampPage(99), clampPage('x'), clampPage(2.7)], [0, 2, 5, 0, 2]);
    assert.deepEqual([swipeStep(-60), swipeStep(60), swipeStep(-10), swipeStep(0), swipeStep(-40)], [1, -1, 0, 0, 1]);
    assert.equal(themeIndex('emoticon_foolsday_amiya'), 4);
    assert.equal(themeIndex('nope'), 0);
    store.clear();
    assert.equal(lastThemeIndex(), 0, 'first page by default');
    rememberTheme('emoticon_foolsday_wisdel');
    assert.equal(lastThemeIndex(), 5);
    rememberTheme('bogus');
    assert.equal(lastThemeIndex(), 5, 'unknown themes are not stored');
    store.set('sp.pref.emoteTheme', '"emoticon_gone"');
    assert.equal(lastThemeIndex(), 0, 'a stale theme falls back to the first page');
    store.set('sp.pref.emoteTheme', '{bad json');
    assert.equal(lastThemeIndex(), 0);
  });

  test('wheel paging: one page per gesture — a trackpad swipe\'s momentum tail never skips themes', async () => {
    const { wheelStep, wheelDelta, WHEEL_GAP_MS, WHEEL_STEP_PX } = await import('../../public/js/ui/emotes.js');
    // one macOS trackpad swipe: 60 events 16 ms apart, decaying deltaX (≈ 750 px in total)
    const acc = { x: 0, t: -Infinity, spent: false };
    let t = 1000;
    const swipe = (sign) => {
      const steps = [];
      for (let i = 0; i < 60; i++, t += 16) steps.push(wheelStep(acc, sign * Math.max(2, 40 * 0.95 ** i), t));
      return steps.filter(Boolean);
    };
    assert.deepEqual(swipe(1), [1], 'the whole swipe turns exactly one page');
    t += WHEEL_GAP_MS - 20;
    assert.deepEqual(swipe(1), [], 'a tail that continues without a pause is still the same gesture');
    t += WHEEL_GAP_MS + 1;
    assert.deepEqual(swipe(-1), [-1], 'a new gesture after a pause turns the page again (backwards)');
    // mouse wheel notches (100 px) with pauses: one page per notch; small deltas accumulate
    t += 1000;
    assert.equal(wheelStep(acc, 100, t), 1);
    t += 400;
    assert.equal(wheelStep(acc, 100, t), 1);
    t += 400;
    assert.equal(wheelStep(acc, WHEEL_STEP_PX / 2, t), 0);
    assert.equal(wheelStep(acc, WHEEL_STEP_PX / 2, t + 16), 1);
    assert.equal(wheelStep(acc, 0, t + 1000), 0);
    assert.equal(wheelStep({ x: 0, t: 5000, spent: true }, 100, 10), 1, 'a clock that went backwards starts a new gesture');
    // Unity ScrollRect rule: a mostly vertical wheel drives the horizontal pager (down = next); lines / pages → px
    assert.equal(wheelDelta({ deltaX: 0, deltaY: 100 }), 100);
    assert.equal(wheelDelta({ deltaX: 0, deltaY: -100 }), -100);
    assert.equal(wheelDelta({ deltaX: 30, deltaY: 10 }), 30);
    assert.equal(wheelDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 }), 48);
    assert.equal(wheelDelta({ deltaX: 1, deltaY: 0, deltaMode: 2 }, 271), 271);
    assert.equal(wheelDelta({}), 0);
    assert.equal(wheelDelta(null), 0);
  });

  test('cooldown and bubble timelines are computed from timestamps (robust to remounts and clock jumps)', async () => {
    const { cooldownLeft, bubbleAge } = await import('../../public/js/ui/emotes.js');
    assert.equal(cooldownLeft(-Infinity, 5000), 0, 'never sent');
    assert.equal(cooldownLeft(5000, 5000), EMOTE_COOLDOWN_MS);
    assert.equal(cooldownLeft(5000, 5400), 600);
    assert.equal(cooldownLeft(5000, 6000), 0);
    assert.equal(cooldownLeft(5000, 1000), 0, 'a clock that went backwards never locks the button');
    assert.equal(cooldownLeft(5000, 5100, 500), 400);
    assert.equal(bubbleAge(undefined, 9000), 0);
    assert.equal(bubbleAge(8000, 9000), 1000);
    assert.equal(bubbleAge(8000, 7000), 0, 'future timestamps start fresh');
    assert.equal(bubbleAge(1000, 9000), EMOTE_BUBBLE_MS, 'capped at the display time');
    assert.equal(bubbleAge(NaN, 9000), 0);
  });

  test('ensureEmoteCss links public/css/emotes.css once, and is a no-op without a document', async () => {
    const { ensureEmoteCss, EMOTE_CSS_HREF } = await import('../../public/js/ui/emotes.js');
    const links = [];
    const doc = {
      head: { appendChild: (n) => links.push(n) },
      createElement: () => ({}),
      querySelector: () => (links.length ? links[0] : null),
    };
    assert.equal(ensureEmoteCss(doc), true);
    assert.equal(ensureEmoteCss(doc), false);
    assert.deepEqual(links, [{ rel: 'stylesheet', href: EMOTE_CSS_HREF }]);
    assert.equal(ensureEmoteCss(undefined), false);
    assert.ok(existsSync(path.join(ROOT, 'public', EMOTE_CSS_HREF)));
    assert.match(readFileSync(path.join(ROOT, 'public/index.html'), 'utf8'), /href="\/css\/emotes\.css"/);
  });

  test('a hung emote manifest is missing when the clock fires (glyph), and a later retry replaces it', async () => {
    const { createDataStore } = await import('../../public/js/data.js');
    const timers = [];
    let calls = 0;
    let releaseWait;
    const store = createDataStore({
      timeoutMs: 1000,
      retryDelays: [0],
      wait: () => new Promise((r) => { releaseWait = r; }),
      setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
      clearTimeout: () => {},
      fetch: () => {
        calls++;
        if (calls === 1) return new Promise(() => {});
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, groups: { a: { pic: { path: '/p.png' } } } }) });
      },
    });
    const states = [];
    store.subscribe(() => states.push(store.status('local')));
    const p = store.load('local');
    assert.equal(store.status('local'), 'loading');
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, 1000);
    timers[0].fn();
    await new Promise((r) => setImmediate(r));
    assert.equal(store.status('local'), 'missing', 'glyph as soon as the attempt times out, before the retry');
    assert.equal(calls, 1, 'still on the first attempt while the retry waits');
    releaseWait();
    const value = await p;
    assert.equal(calls, 2);
    assert.equal(store.status('local'), 'ready');
    assert.equal(value.ok, true);
    assert.equal(store.get('local').groups.a.pic.path, '/p.png');
    assert.deepEqual(states, ['missing', 'ready']);
    for (const t of timers) t.fn();
    assert.equal(store.status('local'), 'ready', 'a timer that fires after success does not demote the file');
  });

  test('a failed emote manifest (no clock) is missing before the retry, then ready; a 404 stays missing', async () => {
    const { createDataStore } = await import('../../public/js/data.js');
    let calls = 0;
    const store = createDataStore({
      timeoutMs: 1000,
      retryDelays: [0],
      wait: async () => {},
      setTimeout: () => 1,
      clearTimeout: () => {},
      fetch: async () => {
        calls++;
        if (calls === 1) throw new TypeError('Failed to fetch');
        return { ok: true, status: 200, json: async () => ({ groups: { emoticon: {} } }) };
      },
    });
    const states = [];
    store.subscribe(() => states.push(store.status('assets')));
    const value = await store.load('assets');
    assert.equal(value.groups.emoticon !== undefined, true);
    assert.deepEqual(states, ['missing', 'ready']);
    const warn = console.warn;
    console.warn = () => {};
    try {
      const timers = [];
      const gone = createDataStore({
        timeoutMs: 5,
        retryDelays: [],
        setTimeout: (fn) => { timers.push(fn); return timers.length; },
        clearTimeout: () => {},
        fetch: () => new Promise(() => {}),
      });
      const p = gone.load('local');
      assert.equal(timers.length, 1);
      timers[0]();
      assert.equal(await p, null);
      assert.equal(gone.status('local'), 'missing');
      let n = 0;
      const missing = createDataStore({
        timeoutMs: 5,
        retryDelays: [0],
        wait: async () => {},
        setTimeout: () => 1,
        clearTimeout: () => {},
        fetch: async () => { n++; return { ok: false, status: 404, json: async () => ({}) }; },
      });
      assert.equal(await missing.load('assets'), null);
      assert.equal(missing.status('assets'), 'missing');
      assert.equal(n, 1, 'a 404 is not retried');
    } finally { console.warn = warn; }
  });

  test('the art-manifest clock is not armed for other files; the default wait is ART_MANIFEST_TIMEOUT_MS', async () => {
    const { createDataStore, ART_MANIFEST_TIMEOUT_MS } = await import('../../public/js/data.js');
    assert.equal(ART_MANIFEST_TIMEOUT_MS, 8000);
    const arms = [];
    let release;
    const store = createDataStore({
      setTimeout: (fn, ms) => { arms.push(ms); return arms.length; },
      clearTimeout: () => {},
      fetch: (url) => new Promise((resolve) => { release = () => resolve(String(url).includes('chess')
        ? { ok: false, status: 404, json: async () => ({}) }
        : { ok: true, status: 200, json: async () => ({ ok: 1 }) }); }),
    });
    const local = store.load('local');
    assert.deepEqual(arms, [8000]);
    release();
    assert.equal((await local).ok, 1);
    arms.length = 0;
    const warn = console.warn;
    console.warn = () => {};
    try {
      const chess = store.load('chess');
      await new Promise((r) => setImmediate(r));
      assert.deepEqual(arms, [], 'chess is not on the emote clock');
      assert.equal(store.status('chess'), 'loading');
      release();
      await chess;
      assert.equal(store.status('chess'), 'missing');
    } finally { console.warn = warn; }
  });

  test('emote UI never renders an emote label as text (aria-label only)', () => {
    const src = readFileSync(path.join(ROOT, 'public/js/ui/emotes.js'), 'utf8');
    assert.doesNotMatch(src, /EMOTE_TEXT|EMOTE_LABEL/, 'no text table in the UI');
    // every use of a label is an attribute value
    for (const m of src.matchAll(/\.label\b/g)) {
      const before = src.slice(Math.max(0, m.index - 40), m.index);
      assert.match(before, /aria-label=\$\{[^}]*$/, `label used outside aria-label: …${before}`);
    }
  });
});
