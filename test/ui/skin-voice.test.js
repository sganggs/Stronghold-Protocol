// test/ui/skin-voice.test.js — 时装语音 (#733; PR #734 by @xcdoge, ported to the maintainer's review of 2026-10-19 /
// 2026-10-23; DESIGN §37.330): an outfit a cosmetic plugin writes may carry its own lines
// (`chars[<charId>].skins[<skinKey>].voice` / `voiceJp` / `voiceEn` / `voiceKr` / `voiceNative`).
//   * voiceLine: per dub and per slot the outfit's lines when it has any, else the operator's — a missing slot and an
//     empty list fall back; the player's 语音语言 still picks the dub; no outfit (or one without lines) changes nothing.
//   * wornOutfit / wornSkinKey: which record, and which outfit a battle unit wears in this view — the rule render/app.js
//     skinOf draws the model by (checked against that very source), never the viewer's own choice for another seat.
//   * AudioManager: 开场 / 部署 / 技能 / 接敌 resolve the speaking unit's own seat — teammates fielding the same operator,
//     显示其他玩家的皮肤 off, a mid-match change, a reconnect's replay, a 补位 stand-in and a 自选 pick —, an outfit file that
//     fails plays the operator's line instead; installAudio and the settings feed the seats, the page's player and the switch.
//   * 选中 (ui/detailPanel.js selectVoiceOutfit) follows the card's own rule; 结算 names the speaking piece (resultSpeakerOf).
// The format (shared/plugins/visual.js, schemas/overlay.schema.json), the composition and the packaging:
// test/plugins/visual.test.js, test/plugins/schema.test.js, test/plugins/tool.test.js.
// Run: TMPDIR=/tmp node --test test/ui/skin-voice.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AudioManager, VoiceGate, installAudio, audio, voiceLine, wornOutfit, wornSkinKey, resultSpeaker, resultSpeakerOf } from '../../public/js/audio.js';
import { selectVoiceOutfit } from '../../public/js/ui/detailPanel.js';
import { voiceLangFor } from '../../public/js/voicePrefs.js';
import { mediaUrl } from '../../public/js/media.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OP = 'char_102_texas';
const A = `${OP}@epoque#7`;
const B = `${OP}@sightseer#2`;

describe('voiceLine with the worn outfit', () => {
  const audioM = {
    voice: { [OP]: { select: ['/op/cn/cn_021.mp3', '/op/cn/cn_022.mp3'], place: '/op/cn/cn_023.mp3', start: '/op/cn/cn_019.mp3', skill1: '/op/cn/cn_031.mp3' } },
    voiceJp: { [OP]: { select: ['/op/jp/cn_021.mp3', '/op/jp/cn_022.mp3'], place: '/op/jp/cn_023.mp3' } },
    voiceEn: { [OP]: { place: '/op/en/cn_023.mp3' } },
  };

  test('per slot: the outfit\'s lines win, a slot it lacks — no key or an empty list — is the operator\'s own', () => {
    const outfit = { voice: { select: ['/a/cn/sel1.mp3', '/a/cn/sel2.mp3'], place: '/a/cn/place.mp3', skill1: [], start: [null, ''] } };
    assert.deepEqual(voiceLine(audioM, OP, 'place', 'cn', () => 0, true, outfit), { url: '/a/cn/place.mp3', fallback: null });
    assert.equal(voiceLine(audioM, OP, 'select', 'cn', () => 0.99, true, outfit).url, '/a/cn/sel2.mp3', 'a slot of several lines draws one of the outfit\'s');
    assert.equal(voiceLine(audioM, OP, 'skill1', 'cn', () => 0, true, outfit).url, '/op/cn/cn_031.mp3', 'an empty list: the operator\'s line');
    assert.equal(voiceLine(audioM, OP, 'start', 'cn', () => 0, true, outfit).url, '/op/cn/cn_019.mp3', 'a list of nothing usable: the operator\'s line');
    assert.equal(voiceLine(audioM, OP, 'faceEnemy', 'cn', () => 0, true, outfit), null, 'neither has the slot: silent, as before');
    assert.equal(voiceLine(audioM, 'char_zz', 'place', 'cn', () => 0, true, outfit).url, '/a/cn/place.mp3', 'an outfit voices an operator the manifest has no line for');
  });

  test('no outfit, or one without lines (a picture-only outfit), changes nothing — every dub, both Chinese settings', () => {
    for (const lang of ['cn', 'jp', 'en', 'kr', 'native', 'xx']) for (const slot of ['select', 'place', 'start', 'skill1', 'faceEnemy']) {
      for (const allowChinese of [true, false]) for (const r of [0, 0.99]) {
        const before = voiceLine(audioM, OP, slot, lang, () => r, allowChinese);
        for (const outfit of [null, undefined, {}, { name: 'x', avatar: '/a.png' }, { voice: {} }, 'nope']) {
          assert.deepEqual(voiceLine(audioM, OP, slot, lang, () => r, allowChinese, outfit), before, `${lang} ${slot} ${allowChinese} ${JSON.stringify(outfit)}`);
        }
      }
    }
  });

  test('the dub stays the player\'s: the outfit\'s tree of that dub first, then the operator\'s, then the Chinese fallback (outfit first there too)', () => {
    const cnOnly = { voice: { place: '/a/cn/cn_023.mp3', start: '/a/cn/cn_019.mp3' } };
    // 日本語 and an outfit with Chinese lines only: the operator's Japanese line plays — the language preference is kept
    assert.deepEqual(voiceLine(audioM, OP, 'place', 'jp', () => 0, true, cnOnly), { url: '/op/jp/cn_023.mp3', fallback: '/a/cn/cn_023.mp3' },
      'the JP line; should it fail, the Chinese line of the slot is the outfit\'s');
    // …and a slot the Japanese tree lacks: the Chinese fallback, in the outfit's recording
    assert.deepEqual(voiceLine(audioM, OP, 'start', 'jp', () => 0, true, cnOnly), { url: '/a/cn/cn_019.mp3', fallback: null });
    // Chinese not selected for download: no Chinese at all, the outfit's neither (the existing rule, §37.109)
    assert.equal(voiceLine(audioM, OP, 'start', 'jp', () => 0, false, cnOnly), null);
    assert.deepEqual(voiceLine(audioM, OP, 'place', 'jp', () => 0, false, cnOnly), { url: '/op/jp/cn_023.mp3', fallback: null });
    // an outfit with its own Japanese lines: those, the Chinese twin of the same name as the fallback
    const both = { voice: { select: ['/a/cn/cn_021.mp3', '/a/cn/cn_022.mp3'] }, voiceJp: { select: ['/a/jp/cn_021.mp3', '/a/jp/cn_022.mp3'] } };
    assert.deepEqual(voiceLine(audioM, OP, 'select', 'jp', () => 0.99, true, both), { url: '/a/jp/cn_022.mp3', fallback: '/a/cn/cn_022.mp3' });
    assert.deepEqual(voiceLine(audioM, OP, 'select', 'cn', () => 0, true, both), { url: '/a/cn/cn_021.mp3', fallback: null }, '中文 never plays a Japanese line');
    // English, Korean, the own-language dub: the same per-tree rule
    assert.deepEqual(voiceLine(audioM, OP, 'place', 'en', () => 0, true, { voiceEn: { place: '/a/en/cn_023.mp3' } }), { url: '/a/en/cn_023.mp3', fallback: '/op/cn/cn_023.mp3' });
    assert.deepEqual(voiceLine(audioM, OP, 'place', 'kr', () => 0, true, { voiceKr: { place: '/a/kr/cn_023.mp3' } }), { url: '/a/kr/cn_023.mp3', fallback: '/op/cn/cn_023.mp3' });
    assert.deepEqual(voiceLine(audioM, OP, 'place', 'native', () => 0, true, { voiceNative: { place: [] } }), { url: '/op/cn/cn_023.mp3', fallback: null }, 'an empty list falls through to the operator\'s (here: no native line → Chinese)');
    // [ASSUMED] the dub comes from the operator's trees alone: a server without the operator's English tree plays 中文
    // to a player of English, so an outfit's own English lines are not heard there — its Chinese line is
    const noEn = { voice: audioM.voice, voiceJp: audioM.voiceJp };
    const enOutfit = { voice: { place: '/a/cn/cn_023.mp3' }, voiceEn: { place: '/a/en/cn_023.mp3' } };
    const lang = voiceLangFor(OP, 'en', {}, { audio: noEn });
    assert.equal(lang, 'cn', 'the outfit has no say in the dub');
    assert.deepEqual(voiceLine(noEn, OP, 'place', lang, () => 0, true, enOutfit), { url: '/a/cn/cn_023.mp3', fallback: null });
    assert.equal(voiceLangFor(OP, 'en', {}, { audio: audioM }), 'en', 'with the operator\'s English tree the player keeps English (and hears the outfit\'s line, above)');
  });

  test('wornOutfit: the composed manifest\'s record under the operator (or its base id), else null', () => {
    const m = { chars: { [OP]: { skins: { [A]: { name: 'A', voice: { place: '/a.mp3' } }, bad: 'x' } }, char_002_amiya: { skins: { s: { voice: {} } } } } };
    assert.equal(wornOutfit(m, OP, A), m.chars[OP].skins[A]);
    assert.equal(wornOutfit(m, 'char_002_amiya_2', 's'), m.chars.char_002_amiya.skins.s, 'an E2 asset id finds its operator\'s record, as spineEntry does');
    for (const [c, k] of [[OP, B], [OP, 'bad'], [OP, '__proto__'], [OP, 'constructor'], ['char_zz', A], [OP, null], [null, A], [OP, '']]) {
      assert.equal(wornOutfit(m, c, k), null, `${c} ${k}`);
    }
    assert.equal(wornOutfit(null, OP, A), null);
    assert.equal(wornOutfit({ chars: { [OP]: { skins: [] } } }, OP, '0'), null);
  });
});

describe('the outfit a battle unit speaks in', () => {
  test('wornSkinKey is render/app.js skinOf\'s rule for operator bodies (the very source, every case)', () => {
    const src = readFileSync(path.join(ROOT, 'public/js/render/app.js'), 'utf8');
    const start = src.indexOf('  const skinOf = ');
    const end = src.indexOf('\n  const playerSkins = new Map();', start);
    assert.ok(start > 0 && end > start, 'skinOf found');
    const makeSkinOf = new Function('playerSkins', `${src.slice(start, end)}\nreturn skinOf;`);
    const maps = [new Map(), new Map([['p1', { [OP]: A }], ['p2', { [OP]: B }]]), new Map([['p2', {}]]), new Map([['p1', { char_x: A }]])];
    let cases = 0;
    for (const playerSkins of maps) {
      const skinOf = makeSkinOf(playerSkins);
      for (const ownerId of ['p1', 'p2', null]) for (const skin of [A, B, undefined, null]) for (const myId of ['p1', 'p2', null]) for (const otherSkins of [true, false]) {
        for (const shape of [{ spine: OP }, { spine: 'char_other', diy: { charId: OP } }, { spine: 'char_x' }]) {
          const info = { kind: 'op', ownerId, skin, ...shape };
          const unit = { kind: 'op', ownerId, skin: skin ?? null, body: shape.diy?.charId || shape.spine };
          assert.equal(wornSkinKey(unit, { playerSkins, myId, otherSkins }), skinOf(info, myId, otherSkins), JSON.stringify({ info, myId, otherSkins, map: [...playerSkins] }));
          cases++;
        }
      }
    }
    assert.ok(cases > 800);
    assert.equal(wornSkinKey({ kind: 'token', ownerId: 'p1', skin: A, body: 'token_x' }, { playerSkins: new Map(), myId: 'p1' }), null, 'a summon has no lines of an outfit');
    assert.equal(wornSkinKey(null), null);
  });

  test('开场 / 部署 / 技能 / 接敌: each unit in its own seat\'s outfit — teammates of one operator, the switch, a mid-match change, a reconnect, a stand-in, a 自选 pick', async () => {
    const m = { audio: { sfx: { ui: {}, battle: {}, units: {} },
      voice: { [OP]: { start: '/op/start.mp3', place: '/op/place.mp3', skill1: '/op/s1.mp3', faceEnemy: '/op/face.mp3' }, char_standin: { place: '/standin/place.mp3' } },
      voiceJp: { [OP]: { place: '/op/jp/place.mp3' } } },
    chars: {
      [OP]: { skins: { [A]: { name: 'A', voice: { start: '/a/start.mp3', place: '/a/place.mp3', skill1: [], faceEnemy: '/a/face.mp3' } },
        [B]: { name: 'B', voice: { place: '/b/place.mp3' } } } },
      char_standin: { skins: { S: { name: 'S', voice: { place: '/s/place.mp3' } } } },
    } };
    const { a, said, restore } = await manager(() => m);
    try {
      a.setMe('p1');
      a.setSkinPlayers([{ playerId: 'p1', skins: { [OP]: A } }, { playerId: 'p2', skins: { [OP]: B } }]);
      const mine = { id: 1, kind: 'op', side: 'ally', ownerId: 'p1', spine: OP, defId: 'chess_char_1_01_a', skin: A, skillIndex: 0 };
      const mate = { id: 2, kind: 'op', side: 'ally', ownerId: 'p2', spine: OP, defId: 'chess_char_1_01_a', skin: B };
      a.setFieldUnits([mine, mate]);
      assert.equal(await said(['deploy', 1]), '/a/start.mp3', '开场: the first deployed says 行动出发 in its seat\'s outfit');
      assert.equal(await said(['deploy', 2]), '/b/place.mp3', '部署: a teammate fielding the same operator speaks in THEIR outfit, not the viewer\'s');
      assert.equal(await said(['engage', 1]), '/a/face.mp3', '接敌');
      assert.equal(await said(['skill', 1, 1]), '/op/s1.mp3', '技能: the outfit\'s empty list falls back to the operator');
      assert.equal(await said(['engage', 2]), '/op/face.mp3', 'a slot the teammate\'s outfit lacks: the operator\'s line');
      // 显示其他玩家的皮肤 off: another seat's operator speaks in the operator's own voice (as it is drawn); one's own keeps it
      a.setOtherSkins(false);
      assert.equal(await said(['deploy', 2]), '/op/place.mp3');
      assert.equal(await said(['deploy', 1]), '/a/place.mp3');
      a.setOtherSkins(true);
      // a mid-match change: the seat's latest public choice wins over what the unit arrived with; an omitted map clears it
      a.setSkinPlayers([{ playerId: 'p1', skins: { [OP]: A } }, { playerId: 'p2', skins: { [OP]: A } }]);
      assert.equal(await said(['deploy', 2]), '/a/place.mp3');
      a.setSkinPlayers([{ playerId: 'p1', skins: { [OP]: A } }, { playerId: 'p2' }]);
      assert.equal(await said(['deploy', 2]), '/op/place.mp3', 'p2 took the outfit off');
      // a reconnect: the field's units replayed (m.field) before the seats' choices arrive — each unit's own skin decides
      a.setSkinPlayers(null);
      a.setFieldUnits([mine, mate]);
      assert.equal(await said(['deploy', 2]), '/op/start.mp3', 'the first deploy after the replay says 行动出发: outfit B has none, the operator\'s');
      assert.equal(await said(['deploy', 2]), '/b/place.mp3', 'its 部署 is B\'s');
      assert.equal(await said(['deploy', 1]), '/a/place.mp3');
      // a viewer who is not this seat (spectating, a page without `me`): the seats' own outfits, never a choice of its own
      a.setMe(null);
      assert.equal(await said(['deploy', 2]), '/b/place.mp3');
      a.setMe('p1');
      // 补位: the stand-in speaks with its own voice in the outfit its seat chose for the stand-in's operator — the replaced
      // operator's outfit never dresses it (docs/SKINS.md)
      const standIn = { id: 3, kind: 'op', side: 'ally', ownerId: 'p2', spine: 'char_standin', voice: 'char_standin', defId: 'chess_char_1_01_a', standInFor: OP };
      a.setSkinPlayers([{ playerId: 'p2', skins: { [OP]: B } }]);
      a.setFieldUnits([standIn]);
      a.startVoiceDone = true;
      assert.equal(await said(['deploy', 3]), '/standin/place.mp3');
      a.setSkinPlayers([{ playerId: 'p2', skins: { [OP]: B, char_standin: 'S' } }]);
      assert.equal(await said(['deploy', 3]), '/s/place.mp3');
      // 自选: the pick's operator holds the outfit (UnitInfo.diy.charId), whatever the model id says
      a.setSkinPlayers([{ playerId: 'p1', skins: { [OP]: A } }]);
      a.setFieldUnits([{ id: 4, kind: 'op', side: 'ally', ownerId: 'p1', spine: 'char_other_model', voice: OP, defId: 'chess_diy_x', diy: { charId: OP } }]);
      a.startVoiceDone = true;
      assert.equal(await said(['deploy', 4]), '/a/place.mp3');
      // 语音语言 日本語: the operator's Japanese line — the outfit has Chinese lines only, the player's dub is kept
      a.setVoiceLang('jp');
      assert.equal(await said(['deploy', 4]), '/op/jp/place.mp3');
      a.setVoiceLang('cn');
      // a summon that talks (a char_ token) has no outfit lines: its own
      a.setFieldUnits([{ id: 5, kind: 'token', side: 'ally', ownerId: 'p1', spine: OP, defId: 'char_token_x', ownerCharId: OP, skin: A }]);
      a.startVoiceDone = true;
      assert.equal(await said(['deploy', 5]), '/op/place.mp3');
    } finally { restore(); }
  });

  test('an outfit line that fails to load: its entry falls back (the cosmetic layers) and the operator\'s line of the slot plays', async () => {
    const m = { audio: { sfx: { ui: {}, battle: {}, units: {} }, voice: { [OP]: { place: '/op/place.mp3' } } },
      chars: { [OP]: { skins: { [A]: { voice: { place: '/p/x/00000000/a/place.mp3' } } } } } };
    const broken = '/p/x/00000000/a/place.mp3';
    const { a, said, restore } = await manager(() => m, {
      missing: [broken, mediaUrl(broken)],
      onFailed: (url) => { if (url !== broken) return false; delete m.chars[OP].skins[A].voice.place; return true; },
    });
    try {
      a.setMe('p1');
      a.setFieldUnits([{ id: 1, kind: 'op', side: 'ally', ownerId: 'p1', spine: OP, skin: A }]);
      a.startVoiceDone = true;
      assert.equal(await said(['deploy', 1], 4), '/op/place.mp3');
    } finally { restore(); }
  });

  test('voice(): an explicit outfit (the detail panel, the settlement) — under `skinCharId` when the voice bank has another id', async () => {
    const m = { audio: { sfx: { ui: {}, battle: {}, units: {} }, voice: { voice_bank: { select: '/bank/sel.mp3' }, [OP]: { select: '/op/sel.mp3' } } },
      chars: { [OP]: { skins: { [A]: { voice: { select: '/a/sel.mp3' } } } } } };
    const { a, restore, tick } = await manager(() => m);
    try {
      assert.equal(a.voice(OP, 'select', { skinKey: A }), true);
      await tick();
      assert.equal(a.voiceNode?.url, '/a/sel.mp3');
      a._stopVoice(); a.voiceGate.reset();
      assert.equal(a.voice('voice_bank', 'select', { skinKey: A, skinCharId: OP }), true);
      await tick();
      assert.equal(a.voiceNode?.url, '/a/sel.mp3', 'the outfit is the body\'s, whatever bank the line falls back to');
      a._stopVoice(); a.voiceGate.reset();
      assert.equal(a.voice('voice_bank', 'select', { skinKey: A }), true);
      await tick();
      assert.equal(a.voiceNode?.url, '/bank/sel.mp3', 'no such outfit under the bank\'s id: the bank\'s own line');
      a._stopVoice(); a.voiceGate.reset();
      assert.equal(a.voice(OP, 'select', { skinKey: 'char_102_texas@nowhere#1' }), true);
      await tick();
      assert.equal(a.voiceNode?.url, '/op/sel.mp3', 'an outfit this page does not have (a teammate\'s plugin): the operator\'s own');
    } finally { restore(); }
  });

  test('installAudio and the settings hand over the seats, the page\'s player and 显示其他玩家的皮肤', () => {
    let state = { me: { playerId: 'p1' }, match: { public: { players: [{ playerId: 'p1', skins: { [OP]: A } }] } } };
    let listener = null;
    installAudio({ getManifest: () => null, subscribe: (fn) => { listener = fn; return () => {}; }, getState: () => state, selectRoute: () => 'lobby',
      settings: { bgm: 0, sfx: 0, voice: 0, muted: true, otherSkins: false } });
    assert.deepEqual([audio.myId, audio.otherSkins, audio.playerSkins.get('p1')], ['p1', false, { [OP]: A }]);
    const prev = state;
    state = { me: { playerId: 'p2' }, match: { public: { players: [{ playerId: 'p2', skins: { [OP]: B } }] } } };
    listener(state, prev);
    assert.deepEqual([audio.myId, audio.playerSkins.has('p1'), audio.playerSkins.get('p2')], ['p2', false, { [OP]: B }]);
    listener({ me: null, match: null }, state);
    assert.deepEqual([audio.myId, audio.playerSkins.size], [null, 0], 'leaving the match clears them');
    audio.setOtherSkins(true);
    const settings = readFileSync(path.join(ROOT, 'public/js/ui/settings.js'), 'utf8');
    assert.match(settings, /audio\.setOtherSkins\(s\.otherSkins\)/, 'a change of the switch reaches the audio');
    assert.match(settings, /audio\.setOtherSkins\(settingsStore\.get\(\)\.otherSkins\)/, 'and the stored value at start');
  });
});

describe('选中 and 结算', () => {
  const chess = (charId, extra = {}) => ({ chessId: `chess_${charId}`, charId, ...extra });
  const players = [{ playerId: 'p1', skins: { [OP]: A, char_standin: 'S1' } }, { playerId: 'p2', skins: { [OP]: B } }];
  const view = { myId: 'p1', players, localSkins: { [OP]: 'local#1' }, otherSkins: true };

  test('selectVoiceOutfit: the card\'s outfit — the owning seat, never the viewer\'s choice for another seat', () => {
    assert.deepEqual(selectVoiceOutfit({ type: 'chess', chess: chess(OP), ownerId: 'p1' }, view), { skinKey: A, skinCharId: OP }, 'an own piece / shop card');
    assert.deepEqual(selectVoiceOutfit({ type: 'chess', chess: chess(OP), ownerId: 'p2', skin: B }, view), { skinKey: B, skinCharId: OP }, 'a teammate\'s unit of the same operator');
    assert.deepEqual(selectVoiceOutfit({ type: 'chess', chess: chess(OP), ownerId: 'p2' }, { ...view, otherSkins: false }), {}, '显示其他玩家的皮肤 off');
    assert.deepEqual(selectVoiceOutfit({ type: 'chess', chess: chess(OP), ownerId: 'p3', skin: B }, view), { skinKey: B, skinCharId: OP }, 'a seat the match does not list: the unit\'s own skin');
    assert.deepEqual(selectVoiceOutfit({ type: 'chess', chess: chess(OP), ownerId: null }, view), {}, 'an unowned card (the banned list)');
    assert.deepEqual(selectVoiceOutfit({ type: 'chess', chess: chess(OP) }, view), { skinKey: 'local#1', skinCharId: OP }, 'no owner at all: the local picker, as OperatorImage');
    // 补位: the stand-in's operator holds the outfit, as the card's picture
    const si = { charId: 'char_standin', standInFor: OP, assets: { voice: 'char_standin' } };
    assert.deepEqual(selectVoiceOutfit({ type: 'chess', chess: chess(OP), standIn: si, ownerId: 'p1' }, view), { skinKey: 'S1', skinCharId: 'char_standin' });
    assert.deepEqual(selectVoiceOutfit({ type: 'chess', chess: chess(OP), standIn: si, ownerId: 'p2' }, view), {}, 'the replaced operator\'s outfit never dresses the stand-in');
    // 自选: the composed record is the pick's
    assert.deepEqual(selectVoiceOutfit({ type: 'chess', chess: chess(OP, { chessId: 'chess_diy_slot' }), diy: { charId: OP }, ownerId: 'p2' }, view), { skinKey: B, skinCharId: OP });
    assert.deepEqual(selectVoiceOutfit({ type: 'token', token: {} }, view), {});
    assert.deepEqual(selectVoiceOutfit(null, view), {});
    // the panel plays it with the line (the effect reads the stores when the line starts)
    const panel = readFileSync(path.join(ROOT, 'public/js/ui/detailPanel.js'), 'utf8');
    assert.match(panel, /audio\.voice\(selectChar, 'select', selectVoiceOutfit\(detail, \{ myId: s\?\.me\?\.playerId/);
  });

  test('resultSpeakerOf names the piece that speaks; resultSpeaker is its charId; the game screen says it in this seat\'s outfit', () => {
    const mine = { unitsEnd: [{ defId: 'chess_a', alive: true }, { defId: 'char_b', alive: true }, { defId: 'chess_dead', alive: false }] };
    const charOf = (id) => ({ chess_a: 'char_a', chess_dead: 'char_dead' })[id] ?? null;
    assert.deepEqual(resultSpeakerOf(mine, () => 0, charOf), { charId: 'char_a', defId: 'chess_a' });
    assert.deepEqual(resultSpeakerOf(mine, () => 0.99, charOf), { charId: 'char_b', defId: 'char_b' });
    for (const r of [0, 0.5, 0.99]) assert.equal(resultSpeaker(mine, () => r, charOf), resultSpeakerOf(mine, () => r, charOf).charId);
    assert.equal(resultSpeakerOf({ unitsEnd: [] }), null);
    const game = readFileSync(path.join(ROOT, 'public/js/screens/game.js'), 'utf8');
    assert.match(game, /const body = ownShown\(who\.defId\)\?\.charId \|\| charId;/, 'the operator the own record shows (a stand-in, a 自选 pick)');
    assert.match(game, /ownerSkin\(body, \{ ownerId: pid, myId: pid, players: st\.match\?\.public\?\.players \|\| \[\] \}\)/, 'this seat\'s public choice');
  });
});

// ---- a manager on a fake Web Audio ------------------------------------------------------------------------

async function manager(getManifest, { missing = [], onFailed = null } = {}) {
  const listeners = new Map();
  class Param { constructor() { this.value = 1; } setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} }
  class Node { connect() {} disconnect() {} }
  class Gain extends Node { constructor() { super(); this.gain = new Param(); } }
  class Src extends Node { constructor() { super(); this.playbackRate = new Param(); } start() {} stop() {} }
  class Ctx {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = new Node(); }
    createGain() { return new Gain(); }
    createBufferSource() { return new Src(); }
    decodeAudioData(ab, ok) { ok({ duration: 1.5 }); }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
  }
  const win = { AudioContext: Ctx, document: { hidden: false, addEventListener() {} }, addEventListener(t, fn) { listeners.set(t, fn); }, removeEventListener(t) { listeners.delete(t); } };
  const origFetch = globalThis.fetch;
  const gone = new Set(missing);
  globalThis.fetch = async (u) => (gone.has(u) ? { ok: false, status: 404 } : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) });
  const tick = () => new Promise((r) => setTimeout(r, 10));
  const a = new AudioManager({ win, getManifest, ...(onFailed ? { onFailed } : {}) });
  a.voiceGate = new VoiceGate({ gapMs: 0 });
  a.install();
  listeners.get('pointerdown')?.();
  await tick();
  /** The line a battle event makes the manager say (the channel cleared first). */
  const said = async (ev, ticks = 1) => {
    a._stopVoice(); a.voiceGate.reset();
    a.handleBattleEvents([ev]);
    for (let i = 0; i < ticks; i++) await tick();
    return a.voiceNode?.url ?? null;
  };
  return { a, said, tick, restore: () => { globalThis.fetch = origFetch; } };
}
