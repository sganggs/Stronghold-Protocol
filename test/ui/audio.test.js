// Audio manager (public/js/audio.js): BGM selection, manifest resolution, SFX limiter, and the manager's
// never-throw behaviour with a fake Web Audio implementation.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bgmKeyFor, resolveBgm, SfxLimiter, AudioManager, normalAttackSfx, installAudio, audio, combatTrackFor, COMBAT_TRACK_SWITCH_ROUND, VoiceGate, resultSpeaker, resultVoiceSlot, VOICE_PRIORITY, VOICE_COOLDOWN_MS } from '../../public/js/audio.js';
import { mediaUrl } from '../../public/js/media.js';
import { PHASE } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'data', 'assets.json'), 'utf8'));

// audio.js 取音频时**先请求无扩展名的 /media/…**（正是为了躲开下载管理器对 .mp3 后缀的嗅探），
// 只有那样 404 了才回退到 manifest 里的原始地址。所以「某个音效响了没有」不能拿原始地址去比对——
// 那样断言的是一个客户端永远不会请求的 URL。下面两个助手把比对放到同一条换算上。
/** 这个 manifest 地址被请求过吗（/media/ 形式或 404 后的原始形式）。 */
const asked = (urls, raw) => urls.includes(mediaUrl(raw)) || urls.includes(raw);
/** 这个 manifest 地址被请求了几次。 */
const askedCount = (urls, raw) => urls.filter((u) => u === mediaUrl(raw) || u === raw).length;

describe('bgm selection', () => {
  test('route and phase → key', () => {
    assert.equal(bgmKeyFor('title', null), 'lobby');
    assert.equal(bgmKeyFor('room', null), 'lobby');
    assert.equal(bgmKeyFor('game', null), 'lobby');
    assert.equal(bgmKeyFor('game', { phase: PHASE.INFO_CHECK }), 'lobby');
    assert.equal(bgmKeyFor('game', { phase: PHASE.PREP }), 'prep');
    assert.equal(bgmKeyFor('game', { phase: PHASE.SP_DRAFT }), 'prep');
    assert.equal(bgmKeyFor('game', { phase: PHASE.COMBAT }), 'combat');
    // 联防 has its own track: the official escaped_single / escaped_multi levels declare bgmEvent = corrosion
    assert.equal(bgmKeyFor('game', { phase: PHASE.UNITE }), 'unite');
    // 开战 BGM: the round's own track (combatTrackFor) indexes the manifest's `bgm.combatAlts`
    assert.equal(bgmKeyFor('game', { phase: PHASE.COMBAT }, 0), 'combat:0');
    assert.equal(bgmKeyFor('game', { phase: PHASE.COMBAT }, 1), 'combat:1');
    assert.equal(bgmKeyFor('game', { phase: PHASE.UNITE }, 1), 'unite', '联防 keeps its own track, not the round index');
    assert.equal(bgmKeyFor('game', { phase: PHASE.PREP }, 1), 'prep');
    assert.equal(bgmKeyFor('game', { phase: PHASE.FINAL_ASSAULT, bossId: 'boss_4' }, 1), 'boss:boss_4');
    assert.equal(bgmKeyFor('game', { phase: PHASE.FINAL_ASSAULT, bossId: 'boss_4' }), 'boss:boss_4');
    assert.equal(bgmKeyFor('game', { phase: PHASE.FINAL_ASSAULT }), 'boss');
    assert.equal(bgmKeyFor('game', { phase: PHASE.HIDDEN_CORE, bossId: 'boss_1', hiddenBossId: 'boss_9' }, 1), 'boss:boss_9');
    assert.equal(bgmKeyFor('game', { phase: PHASE.RESULT }), 'lobby');
    assert.equal(bgmKeyFor('weird', null), null);
  });
  test('开战 BGM: the track is fixed per round, not drawn (无畏者 1–7, 骑士之日 8–13)', () => {
    // The mode does not draw its battle theme: the official schedule plays 无畏者 through the early rounds and
    // 骑士之日 from round 8 on (reviewer note — review had this as a per-match 0.5 draw before).
    for (const r of [1, 2, 3, 4, 5, 6, 7]) assert.equal(combatTrackFor(r), 1, `round ${r} plays 无畏者`);
    for (const r of [8, 9, 10, 11, 12, 13]) assert.equal(combatTrackFor(r), 0, `round ${r} plays 骑士之日`);
    assert.equal(COMBAT_TRACK_SWITCH_ROUND, 7, 'the switch sits between round 7 and 8');
    // the boss rounds (14 最终攻势 / 15 隐秘核心) have their own tracks and never ask for combat:<i>
    assert.equal(bgmKeyFor('game', { phase: PHASE.FINAL_ASSAULT, round: 14 }, combatTrackFor(14)), 'boss');
    // an unknown round falls back to the manifest's plain combat track (older manifest / no round yet)
    for (const bad of [null, undefined, 0, -1, NaN, 'x']) assert.equal(combatTrackFor(bad), null, `${bad} ⇒ no index`);
    assert.equal(bgmKeyFor('game', { phase: PHASE.COMBAT, round: 3 }, combatTrackFor(null)), 'combat');
    // both ends of a real run: a solo 标准 match is 9 rounds, so it hears 无畏者 and then 骑士之日
    assert.equal(bgmKeyFor('game', { phase: PHASE.COMBAT, round: 7 }, combatTrackFor(7)), 'combat:1');
    assert.equal(bgmKeyFor('game', { phase: PHASE.COMBAT, round: 8 }, combatTrackFor(8)), 'combat:0');
    // the index↔track mapping this table assumes, from docs/ASSETS.md: combatAlts[0] = m_bat_kazimierz2_1 骑士之日,
    // combatAlts[1] = m_bat_kazimierz2_2 无畏者 (a reordering upstream breaks this test, not the players' ears)
    const alt = manifest.audio.bgm.combatAlts;
    assert.ok(alt[0].loop.includes('m_bat_kazimierz2_1'), `combatAlts[0] is 骑士之日: ${alt[0].loop}`);
    assert.ok(alt[1].loop.includes('m_bat_kazimierz2_2'), `combatAlts[1] is 无畏者: ${alt[1].loop}`);
  });
  test('resolveBgm uses the manifest (boss fallback, intro optional)', () => {
    const lobby = resolveBgm(manifest, 'lobby');
    assert.ok(lobby && typeof lobby.loop === 'string');
    const b4 = resolveBgm(manifest, 'boss:boss_4');
    assert.equal(b4.loop, manifest.audio.bossBgm.boss_4.loop);
    assert.equal(resolveBgm(manifest, 'boss:nope').loop, manifest.audio.bgm.boss.loop);
    // 开战 BGM: combat:<i> → bgm.combatAlts[i], and back to the default combat track when the index (or the whole
    // array, e.g. an older manifest) is missing
    const alts = manifest.audio.bgm.combatAlts;
    assert.ok(Array.isArray(alts) && alts.length >= 2, 'manifest carries the mode’s own battle tracks');
    assert.equal(resolveBgm(manifest, 'combat:0').loop, alts[0].loop);
    assert.equal(resolveBgm(manifest, 'combat:1').loop, alts[1].loop);
    assert.notEqual(alts[0].loop, manifest.audio.bgm.combat.loop, 'a real battle track, not the shop loop');
    assert.equal(resolveBgm(manifest, 'combat:9').loop, manifest.audio.bgm.combat.loop);
    assert.equal(resolveBgm({ audio: { bgm: { combat: { loop: '/shop.mp3' } } } }, 'combat:0').loop, '/shop.mp3');
    assert.equal(resolveBgm(manifest, 'prep').intro, manifest.audio.bgm.prep.intro ?? null);
    // 联防's own track (bgm.unite = corrosion, the official escaped levels' bgmEvent), and the fallback for an older
    // manifest that has no `unite` entry (the music must not go silent)
    const unite = manifest.audio.bgm.unite;
    assert.ok(unite && typeof unite.loop === 'string', 'the manifest carries 联防’s own track');
    assert.equal(resolveBgm(manifest, 'unite').loop, unite.loop);
    assert.equal(resolveBgm(manifest, 'unite').intro, unite.intro ?? null);
    assert.notEqual(unite.loop, manifest.audio.bgm.combat.loop, 'not the shop / default combat loop');
    assert.equal(resolveBgm({ audio: { bgm: { combat: { loop: '/shop.mp3' } } } }, 'unite').loop, '/shop.mp3');
    assert.equal(resolveBgm(null, 'lobby'), null);
    assert.equal(resolveBgm(manifest, null), null);
    assert.equal(resolveBgm(manifest, 'nope'), null);
  });
  test('installAudio: the round\'s own 开战 track, fixed per round and the same on every client', () => {
    const calls = [];
    const origPlay = audio.playBgm;
    audio.playBgm = (k) => { calls.push(k); };
    try {
      const pub = (o) => ({ phase: PHASE.PREP, round: 1, stageId: 'st1', players: [{ playerId: 'p1' }], ...o });
      const state = { route: 'game', match: { public: pub({}) } };
      let fire = null;
      /** One client: its own store subscription (the expected keys below are what its own round yields — the point of
       * the test is that the track follows the round, never moves inside a battle and never differs between clients). */
      const wire = () => installAudio({
        getManifest: () => manifest, getState: () => state, selectRoute: (s) => s.route,
        subscribe: (fn) => { fire = fn; return () => {}; },
      });
      wire();
      assert.equal(calls.at(-1), 'prep', 'the prep keeps the shop track');
      // round 1 ⇒ 无畏者 (combatAlts[1])
      state.match.public = pub({ phase: PHASE.COMBAT });
      fire(state, {}); assert.equal(calls.at(-1), 'combat:1');
      // a re-render / teammate view inside the same battle never moves
      fire(state, {}); assert.equal(calls.at(-1), 'combat:1');
      // 联防 has its OWN track (#110, the official escaped levels' `bgmEvent = corrosion`) — it does not inherit the
      // round's 开战 track
      state.match.public = pub({ phase: PHASE.UNITE });
      fire(state, {}); assert.equal(calls.at(-1), 'unite');
      // …and back to the round's own track in the 作战
      state.match.public = pub({ phase: PHASE.COMBAT });
      fire(state, {}); assert.equal(calls.at(-1), 'combat:1', "back to the round's own track");
      // a second client of the same room hears the same track (its own installAudio, same round)
      calls.length = 0; wire();
      assert.deepEqual(calls, ['combat:1'], 'every client of the match hears the same track');
      // round 7 is the last on 无畏者, round 8 switches to 骑士之日 (combatAlts[0]) — whoever sits in seat 1
      state.match.public = pub({ round: 7, phase: PHASE.COMBAT });
      fire(state, {}); assert.equal(calls.at(-1), 'combat:1');
      state.match.public = pub({ round: 8, phase: PHASE.COMBAT });
      fire(state, {}); assert.equal(calls.at(-1), 'combat:0');
      state.match.public = pub({ round: 8, phase: PHASE.COMBAT, players: [{ playerId: 'p2' }] });
      fire(state, {}); assert.equal(calls.at(-1), 'combat:0', 'the track does not depend on the seats');
      // the boss rounds keep their own tracks
      state.match.public = pub({ phase: PHASE.FINAL_ASSAULT, bossId: 'boss_4' });
      fire(state, {}); assert.equal(calls.at(-1), 'boss:boss_4');
    } finally { audio.playBgm = origPlay; }
  });
});

describe('SfxLimiter', () => {
  test('caps concurrent voices', () => {
    const l = new SfxLimiter({ maxVoices: 3, unitCooldownMs: 0, urlGapMs: 0 });
    assert.ok(l.tryAcquire(0, 1, 'a'));
    assert.ok(l.tryAcquire(0, 2, 'b'));
    assert.ok(l.tryAcquire(0, 3, 'c'));
    assert.equal(l.tryAcquire(0, 4, 'd'), false);
    l.release();
    assert.ok(l.tryAcquire(0, 4, 'd'));
    l.release(); l.release(); l.release(); l.release(); l.release();
    assert.equal(l.active, 0, 'never negative');
  });
  test('per-unit cooldown and per-url gap', () => {
    const l = new SfxLimiter({ maxVoices: 99, unitCooldownMs: 100, urlGapMs: 30 });
    assert.ok(l.tryAcquire(0, 'u1', 'x'));
    assert.equal(l.tryAcquire(50, 'u1', 'y'), false, 'same unit too soon');
    assert.equal(l.tryAcquire(10, 'u2', 'x'), false, 'same url too soon');
    assert.ok(l.tryAcquire(40, 'u2', 'x'));
    assert.ok(l.tryAcquire(120, 'u1', 'z'));
    assert.ok(l.tryAcquire(121, null, 'w'), 'no unit key ⇒ only url gap');
  });
  test('at most 2 overlapping copies of one sound (official banks: maxSoundAllowed 2)', () => {
    const l = new SfxLimiter({ maxVoices: 99, unitCooldownMs: 0, urlGapMs: 0 });
    assert.equal(l.maxPerUrl, 2);
    assert.ok(l.tryAcquire(0, 'a', 'heal'));
    assert.ok(l.tryAcquire(1, 'b', 'heal'));
    assert.equal(l.tryAcquire(2, 'c', 'heal'), false, 'a third copy waits');
    assert.ok(l.tryAcquire(2, 'c', 'other'), 'other sounds are not affected');
    l.release('heal');
    assert.ok(l.tryAcquire(3, 'c', 'heal'), 'one ended: room again');
  });
});

// ---- operator battle voice (manifest audio.voice; official priorities, audio_data.json battleVoice) ---------

describe('operator battle voice', () => {
  test('resultVoiceSlot: 完美作战 / 高难 / 漏怪 / 全灭', () => {
    assert.equal(resultVoiceSlot({ perfect: true }), 'resultThree');
    assert.equal(resultVoiceSlot({ perfect: true, hard: true }), 'resultFour', '绝境 / 终极 报 完成高难行动');
    assert.equal(resultVoiceSlot({ perfect: false, leaked: 2, killed: 10, total: 12 }), 'resultTwo');
    assert.equal(resultVoiceSlot({ perfect: false, leaked: 0, killed: 0, total: 12 }), 'resultLose');
    assert.equal(resultVoiceSlot({ perfect: false, leaked: 0, killed: 5, total: 5 }), 'resultThree', 'no leak ⇒ the 完美 line');
    assert.equal(resultVoiceSlot(), 'resultThree');
  });

  test('resultSpeaker: the operators of THAT battle (survivors first), never the field on screen', () => {
    // `mine.unitsEnd` of the finished own battle: operators (char_*) and the board's summon pieces (token_*, no voice)
    const mine = { unitsEnd: [
      { defId: 'char_fallen', alive: false },
      { defId: 'token_1001', alive: true },
      { defId: 'char_a', alive: true },
      { defId: 'char_b', alive: true },
    ] };
    assert.equal(resultSpeaker(mine, () => 0), 'char_a');
    assert.equal(resultSpeaker(mine, () => 0.999), 'char_b', 'a drawn operator, still only the ones standing');
    assert.equal(resultSpeaker(mine, () => 0.4), 'char_a');
    const drawn = new Set([0, 0.2, 0.4, 0.6, 0.8, 1].map((r) => resultSpeaker(mine, () => r)));
    assert.deepEqual([...drawn].sort(), ['char_a', 'char_b'], 'a fallen operator or a summon never speaks');
    // the whole squad fell: only then does a fallen operator report the result
    const wiped = { unitsEnd: [{ defId: 'char_fallen', alive: false }, { defId: 'char_also', alive: false }] };
    assert.equal(resultSpeaker(wiped, () => 0), 'char_fallen');
    assert.equal(resultSpeaker(wiped, () => 0.999), 'char_also');
    // no operator on that field at all — summons only, an empty list, or a payload without `unitsEnd` (an older
    // server): no line. There is deliberately NO fallback to the operators currently tracked for the field on screen —
    // that fallback is what made a watched team-mate's operator say the viewer's line (review on #73).
    assert.equal(resultSpeaker({ unitsEnd: [{ defId: 'token_1', alive: true }] }, () => 0), null);
    assert.equal(resultSpeaker({ unitsEnd: [] }), null);
    assert.equal(resultSpeaker({}), null);
    assert.equal(resultSpeaker(null), null);
    assert.equal(resultSpeaker(undefined), null);
    assert.equal(resultSpeaker({ unitsEnd: [{ alive: true }] }, () => 0), null, 'a unit without a defId');
    assert.equal(resultSpeaker({ unitsEnd: [{ defId: 'enemy_1007_slime', alive: true }] }, () => 0), null, 'an enemy');
  });

  test('VoiceGate: one line at a time, a global gap, per-unit cooldowns, higher priority takes over', () => {
    assert.ok(VOICE_PRIORITY.start > VOICE_PRIORITY.skill1 && VOICE_PRIORITY.skill1 > VOICE_PRIORITY.place, 'the official order');
    assert.ok(VOICE_PRIORITY.resultThree > VOICE_PRIORITY.skill1 && VOICE_PRIORITY.resultThree < VOICE_PRIORITY.faceEnemy);
    assert.equal(VOICE_COOLDOWN_MS.skill1, 10000, 'official SKILL_ACTIVE 10 s');
    const g = new VoiceGate({ gapMs: 1000 });
    assert.equal(g.request('start', 1, 0), 'play');
    g.start('start', 1, 0);
    assert.equal(g.request('skill1', 2, 500), 'drop', 'one voice at a time (a lower priority waits)');
    assert.equal(g.request('start', 3, 500), 'drop', 'the same priority does not interrupt');
    assert.equal(g.request('faceEnemy', 3, 500), 'drop', '90 < 100 + margin');
    g.release();
    assert.equal(g.request('place', 1, 900), 'drop', 'the global gap is not over');
    assert.equal(g.request('place', 1, 1000), 'play');
    g.release();
    const g2 = new VoiceGate({ gapMs: 0 });
    assert.equal(g2.request('skill1', 'u1', 0), 'play');
    g2.start('skill1', 'u1', 0);
    g2.release();
    assert.equal(g2.request('skill1', 'u1', 5000), 'drop', 'the unit cooldown');
    assert.equal(g2.request('skill1', 'u2', 5000), 'play', 'another unit is unaffected');
    g2.release();
    assert.equal(g2.request('skill1', 'u1', 10000), 'play', 'cooldown over');
    g2.release();
    g2.reset();
    assert.equal(g2.request('skill1', 'u1', 10001), 'play', 'a new battle inherits no cooldown');
  });

  test('AudioManager.voice: manifest slots (a drawn array), the gate, and the battle events that drive them', async () => {
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (u) => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
    try {
      const vm = { audio: { sfx: { ui: {}, battle: {}, units: {} }, voice: {
        char_a: { start: '/v/a_start.mp3', place: ['/v/a_p1.mp3', '/v/a_p2.mp3'], skill3: '/v/a_s3.mp3', faceEnemy: '/v/a_face.mp3' },
        char_b: { place: '/v/b_p1.mp3', skill1: '/v/b_s1.mp3' },
      } } };
      const a = new AudioManager({ win: fw.win, getManifest: () => vm });
      a.voiceGate = new VoiceGate({ gapMs: 0 });   // the gap itself is covered above
      a.install();
      assert.equal(a.voice('char_a', 'place'), false, 'locked: nothing is requested');
      assert.equal(urls.length, 0);
      fw.fire('pointerdown');
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(a.voice('char_a', 'start', { unitKey: 1 }), true);
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(asked(urls, '/v/a_start.mp3'));
      assert.equal(a.voice('char_b', 'place', { unitKey: 2 }), false, '部署 cannot interrupt 行动出发');
      assert.equal(a.voice('char_a', 'faceEnemy', { unitKey: 3 }), false, '接敌 cannot either');
      a._stopVoice();
      assert.equal(a.voice('char_a', 'place', { unitKey: 1 }), true, 'the channel is free again');
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(asked(urls, '/v/a_p1.mp3') || asked(urls, '/v/a_p2.mp3'), 'a drawn 部署 line');
      assert.equal(a.voice('char_a', 'nope', { unitKey: 1 }), false, 'unknown slot');
      assert.equal(a.voice('char_zz', 'place', { unitKey: 1 }), false, 'unknown operator');
      a._stopVoice(); a.voiceGate.reset();
      // the battle events drive the lines: 行动出发 (the first deploy), 部署 (the rest), 行动开始, 作战中N
      a.setFieldUnits([{ id: 11, side: 'ally', spine: 'char_a', kind: 'op', skillIndex: 2 }, { id: 12, side: 'ally', spine: 'char_b', kind: 'op' }]);
      a.handleBattleEvents([['deploy', 11]]);
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(a.voiceNode?.url, '/v/a_start.mp3', 'the first operator deployed says 行动出发');
      a.handleBattleEvents([['deploy', 12]]);
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(a.voiceNode?.url, '/v/a_start.mp3', 'a 部署 line never interrupts it (lower priority)');
      a._stopVoice(); a.voiceGate.reset();
      a.handleBattleEvents([['engage', 11], ['skill', 12, 1]]);
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(a.voiceNode?.url, '/v/a_face.mp3', '首次接敌 ⇒ 行动开始 (a 作战中 line never interrupts it)');
      a._stopVoice(); a.voiceGate.reset();
      a.handleBattleEvents([['skill', 11, 1]]);
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(a.voiceNode?.url, '/v/a_s3.mp3', '作战中N follows the unit skillIndex (2 ⇒ 作战中3)');
      a._stopVoice(); a.voiceGate.reset();
      a.handleBattleEvents([['skill', 12, 1]]);
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(a.voiceNode?.url, '/v/b_s1.mp3', 'a unit without skillIndex falls back to 作战中1');
      a._stopVoice(); a.voiceGate.reset();
      a.setFieldUnits([{ id: 21, side: 'ally', spine: 'char_a', kind: 'op' }]);
      a.handleBattleEvents([['deploy', 21]]);
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(a.voiceNode?.url, '/v/a_start.mp3', 'a new battle starts with 行动出发 again');
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test('voice: a stale callback never frees the channel the newest line holds (review on #73)', async () => {
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    // holds named URLs open: the first request for one waits on the promise in `held`, later ones (the manager caches a
    // decoded URL) do not. `fail` answers 404, i.e. `_buffer` resolves null.
    const held = new Map();
    const fail = new Set();
    globalThis.fetch = async (u) => {
      if (fail.has(u)) return { ok: false, status: 404 };
      const h = held.get(u);
      if (h) { held.delete(u); await h; }   // the manager caches per URL, so only the first call waits
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
    };
    const tick = () => new Promise((r) => setTimeout(r, 10));
    try {
      const vm = { audio: { sfx: { ui: {}, battle: {}, units: {} }, voice: {
        char_a: { place: '/v/a_p1.mp3', start: '/v/a_start.mp3', faceEnemy: '/v/a_face.mp3', select: '/v/a_sel.mp3' },
      } } };
      const a = new AudioManager({ win: fw.win, getManifest: () => vm });
      a.voiceGate = new VoiceGate({ gapMs: 0 });   // the gap itself is covered above
      a.install();
      fw.fire('pointerdown');
      await tick();
      // 部署 (20) starts with its LOAD HELD OPEN, so 行动出发 (100) takes the channel over while it is still loading
      let openA;
      held.set('/v/a_p1.mp3', new Promise((r) => { openA = r; }));
      assert.equal(a.voice('char_a', 'place', { unitKey: 1 }), true);
      assert.equal(a.voice('char_a', 'start', { unitKey: 2 }), true, 'a higher priority line takes the channel over');
      await tick();
      assert.equal(a.voiceNode?.url, '/v/a_start.mp3', 'the replacement is on air');
      openA();                                     // the preempted line's load finally finishes
      await tick();
      assert.equal(a.voiceNode?.url, '/v/a_start.mp3', 'a stale callback never starts its own line');
      assert.equal(a.voice('char_a', 'place', { unitKey: 3 }), false, 'and never freed the channel it lost');

      // the safety timer / onended of a line that was STOPPED must not free the line that replaced it either
      const ringing = a.voiceNode;                 // 行动出发 on air
      a._stopVoice();                              // the stop path releases the gate itself and moves the token on
      assert.equal(a.voice('char_a', 'place', { unitKey: 4 }), true, 'the channel is free again');
      await tick();
      const now = a.voiceNode;
      assert.equal(now?.url, '/v/a_p1.mp3');
      ringing.src.onended?.();                     // the stopped line's own end lands late (or its safety timer fires)
      ringing.src.onended?.();                     // …and a second time, like timer + onended both firing
      await tick();
      assert.equal(a.voiceNode, now, 'the line on air is untouched');
      assert.equal(a.voice('char_a', 'place', { unitKey: 5 }), false, 'and its channel is still held');

      // a load that FAILS after the takeover (404 ⇒ null buffer): same rule
      fail.add('/v/a_sel.mp3');
      a._stopVoice();
      assert.equal(a.voice('char_a', 'select', { unitKey: 6 }), true);
      assert.equal(a.voice('char_a', 'place', { unitKey: 7 }), true, 'a higher priority line takes over while it loads');
      await tick();
      assert.equal(a.voiceNode?.url, '/v/a_p1.mp3');
      await tick();
      assert.equal(a.voice('char_a', 'place', { unitKey: 8 }), false, 'the failed load kept out of the newest line\'s way');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});

// ---- fake Web Audio -------------------------------------------------------------------------------------

function fakeWindow() {
  const listeners = new Map();
  const made = { sources: 0, started: 0 };
  class Param { constructor() { this.value = 1; } setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} }
  class Node { connect() {} disconnect() {} }
  class Gain extends Node { constructor() { super(); this.gain = new Param(); } }
  class Src extends Node { constructor() { super(); this.playbackRate = new Param(); made.sources++; } start() { made.started++; } stop() {} }
  class Ctx {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = new Node(); }
    createGain() { return new Gain(); }
    createBufferSource() { return new Src(); }
    decodeAudioData(ab, ok) { ok({ duration: 1.5 }); }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
  }
  return {
    made,
    win: {
      AudioContext: Ctx,
      document: { hidden: false, addEventListener() {} },
      addEventListener(t, fn) { listeners.set(t, fn); },
      removeEventListener(t) { listeners.delete(t); },
    },
    fire(t) { listeners.get(t)?.(); },
  };
}

describe('AudioManager', () => {
  test('no AudioContext / no manifest: every call is a silent no-op', () => {
    const a = new AudioManager({ win: null, getManifest: () => null });
    a.install();
    a.playBgm('prep');
    a.sfx('buy');
    a.battle('enemyDie');
    assert.equal(a.unit('char_x', 'attack', 1), false);
    a.handleBattleEvents([['atk', 1, 2, 'arrow'], 'junk', null]);
    a.setVolumes({ bgm: 5, sfx: -1, muted: true });
    assert.deepEqual(a.volumes, { bgm: 1, sfx: 0, voice: 0.8, muted: true });
    assert.equal(a.unlocked, false);
  });
  test('unlocks on the first gesture, then plays BGM and SFX from the manifest', async () => {
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (u) => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
      a.install();
      a.playBgm('prep'); // remembered while locked
      assert.equal(urls.length, 0);
      fw.fire('pointerdown');
      assert.equal(a.unlocked, true);
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(asked(urls, manifest.audio.bgm.prep.loop), 'BGM fetched after unlock');
      a.sfx('buy');
      a.sfx('nonexistent');
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(asked(urls, manifest.audio.sfx.ui.buy));
      // same loop URL ⇒ no restart
      const before = fw.made.started;
      a.playBgm('combat');
      await new Promise((r) => setTimeout(r, 10));
      assert.equal(fw.made.started, before, 'prep → combat shares the loop');
      // battle events map to unit sounds (UnitInfo.spine = char id)
      const charId = Object.keys(manifest.audio.sfx.units).find((k) => k.startsWith('char_') && normalAttackSfx(k, manifest.audio.sfx.units[k].attack));
      a.setFieldUnits([{ id: 1, side: 'ally', spine: charId }, { id: 2, side: 'enemy', spine: 'enemy_nope' }]);
      a.handleBattleEvents([['atk', 1, 2, 'arrow'], ['dmg', 2, 100, 'phys'], ['die', 2], ['spawn', { id: 3, side: 'enemy', spine: 'x' }], ['bounty', 'p', 1]]);
      await new Promise((r) => setTimeout(r, 10));
      assert.ok(asked(urls, manifest.audio.sfx.units[charId].attack));
      assert.ok(asked(urls, manifest.audio.sfx.battle.enemyDie), 'fallback death sound');
      assert.ok(a.limiter.active <= a.limiter.maxVoices);
      a.setVolumes({ muted: true });
      const n = urls.length;
      a.sfx('refresh');
      assert.equal(urls.length, n, 'muted ⇒ nothing requested');
    } finally {
      globalThis.fetch = origFetch;
    }
  });
  test('fetch failures are swallowed', async () => {
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error('offline'); };
    const origWarn = console.warn;
    let warns = 0;
    console.warn = () => { warns++; };
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
      a.install();
      fw.fire('keydown');
      a.playBgm('lobby');
      a.sfx('buy');
      a.sfx('buy');
      await new Promise((r) => setTimeout(r, 20));
      assert.ok(warns >= 1);
    } finally {
      globalThis.fetch = origFetch;
      console.warn = origWarn;
    }
  });
  test('音频先走无扩展名的 /media/ 路由；只有它 404 才回退到带扩展名的原地址', async () => {
    const raw = manifest.audio.bgm.prep.loop;
    const media = mediaUrl(raw);
    assert.notEqual(media, raw, '前提：manifest 地址确实会被换算成 /media/ 路径');

    // 第一发 404：必须看到 /media/ 在前、原地址在后，两者都请求过
    {
      const fw = fakeWindow();
      const urls = [];
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (u) => {
        urls.push(u);
        return u === media ? { ok: false, status: 404 } : { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
      };
      try {
        const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
        a.install();
        fw.fire('pointerdown');
        a.playBgm('prep');
        await new Promise((r) => setTimeout(r, 25));
        const first = urls.indexOf(media);
        const fallback = urls.indexOf(raw);
        assert.ok(first !== -1, '先试无扩展名路径');
        assert.ok(fallback !== -1, '404 后回退到原地址');
        assert.ok(first < fallback, '顺序必须是先 /media/ 再原地址');
      } finally { globalThis.fetch = origFetch; }
    }

    // 第一发 200：不该再去碰带扩展名的地址（否则白白多一次请求，也正是 IDM 会拦的那个 URL）
    {
      const fw = fakeWindow();
      const urls = [];
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (u) => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
      try {
        const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
        a.install();
        fw.fire('pointerdown');
        a.playBgm('prep');
        await new Promise((r) => setTimeout(r, 25));
        assert.ok(urls.includes(media), '走了 /media/');
        assert.ok(!urls.includes(raw), '/media/ 成功就不该再请求 .mp3 地址');
      } finally { globalThis.fetch = origFetch; }
    }

    // 第一发 200 但内容不是音频：有些静态托管对不存在的路径回 200 + index.html，解码会静默失败，也要回退。
    {
      const fw = fakeWindow();
      const urls = [];
      let cancelled = 0;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (u) => {
        urls.push(u);
        if (u !== media) return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
        return {
          ok: true,
          status: 200,
          headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'text/html; charset=utf-8' : null) },
          body: { cancel: async () => { cancelled += 1; } },
          arrayBuffer: async () => new ArrayBuffer(8),
        };
      };
      try {
        const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
        a.install();
        fw.fire('pointerdown');
        a.playBgm('prep');
        await new Promise((r) => setTimeout(r, 25));
        assert.ok(urls.includes(raw), '内容不是音频时回退到原地址');
        assert.equal(cancelled, 1, '丢掉那个用不上的响应，别把连接挂着');
      } finally { globalThis.fetch = origFetch; }
    }

    // /media/ 直接给出 audio/*（服务端真实行为）：不回退，也不去 cancel 一个能用的响应
    {
      const fw = fakeWindow();
      const urls = [];
      let cancelled = 0;
      const origFetch = globalThis.fetch;
      globalThis.fetch = async (u) => {
        urls.push(u);
        return {
          ok: true,
          status: 200,
          headers: { get: (n) => (n.toLowerCase() === 'content-type' ? 'audio/mpeg' : null) },
          body: { cancel: async () => { cancelled += 1; } },
          arrayBuffer: async () => new ArrayBuffer(8),
        };
      };
      try {
        const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
        a.install();
        fw.fire('pointerdown');
        a.playBgm('prep');
        await new Promise((r) => setTimeout(r, 25));
        assert.ok(urls.includes(media));
        assert.ok(!urls.includes(raw), 'audio/* 就是成功，不该再回退');
        assert.equal(cancelled, 0);
      } finally { globalThis.fetch = origFetch; }
    }
  });
});

// user playtest #4 item 6: 纯烬艾雅法拉's skill sound rang outside her skill — her manifest `hit` is her S3 impact
// (p_imp_gtshpbrnch_s, the audio bank ON_ABILITY_HIT.attack.2) and every damage on an ally she had just healed was
// attributed to her ('atk' healer → ally), so ordinary enemy hits on healed allies played it.
describe('impact sounds (user playtest #4 item 6)', () => {
  const AGOAT2 = 'char_1016_agoat2';
  async function rig(units) {
    const fw = fakeWindow();
    const urls = [];
    const origFetch = globalThis.fetch;
    globalThis.fetch = async (u) => { urls.push(u); return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) }; };
    const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
    a.install();
    fw.fire('pointerdown');
    a.setFieldUnits(units);
    const settle = () => new Promise((r) => setTimeout(r, 5));
    return { a, urls, settle, restore: () => { globalThis.fetch = origFetch; } };
  }

  test('an operator never plays a skill-mode file (_d / _h / _s) as its normal attack or impact; enemies keep their _h', () => {
    const u = manifest.audio.sfx.units;
    // her impact: the S3 file (built before tools/assets/audio.mjs preferred normal-mode banks) is refused, the normal
    // one (projectile_chr_agoat2: p_imp_gtshpbrnch_n) plays
    assert.equal(normalAttackSfx(AGOAT2, '/assets/audio/sfx/player/p_imp/p_imp_gtshpbrnch_s.mp3'), false);
    assert.equal(normalAttackSfx(AGOAT2, '/assets/audio/sfx/player/p_imp/p_imp_gtshpbrnch_n.mp3'), true);
    if (u[AGOAT2].hit) assert.equal(normalAttackSfx(AGOAT2, u[AGOAT2].hit), !/_s\.mp3$/.test(u[AGOAT2].hit));
    assert.equal(normalAttackSfx(AGOAT2, u[AGOAT2].attack), true, 'p_atk_gtshpbrnch_n');
    assert.equal(normalAttackSfx('char_1014_nearl2', '/x/p_atk_goldspear_s.mp3'), false);
    assert.equal(normalAttackSfx('char_1028_texas2', '/x/p_imp_reticentsword_h.mp3'), false);
    assert.equal(normalAttackSfx('char_1045_svash2', '/x/p_atk_snwlprdg_n1.mp3'), true);
    assert.equal(normalAttackSfx('enemy_1045_hammer', '/x/e_atk_bigaxe_h.mp3'), true, 'enemy _h = heavy weapon');
    assert.equal(normalAttackSfx('char_x', null), false);
  });

  test('a heal never makes the healer the author of the next damage on the healed ally', async () => {
    const enemyId = Object.keys(manifest.audio.sfx.units).find((k) => k.startsWith('enemy_') && manifest.audio.sfx.units[k].hit);
    const { a, urls, settle, restore } = await rig([
      { id: 1, side: 'ally', kind: 'chess', spine: AGOAT2 }, { id: 2, side: 'ally', kind: 'chess', spine: 'char_x' },
      { id: 3, side: 'enemy', kind: 'enemy', spine: enemyId },
    ]);
    try {
      // 她的技能形态（_s）文件：这条断言要盯住它们一个都没响，所以先确认音效表里真的有 _s ——
      // 否则集合为空，断言会永远成立、形同虚设。
      const ownSkill = Object.values(manifest.audio.sfx.units[AGOAT2]).filter((x) => typeof x === 'string' && /_s\.mp3$/.test(x));
      assert.ok(ownSkill.length > 0, '前提：她的音效表里确实有 _s（技能形态）文件');
      a.handleBattleEvents([['atk', 1, 2, 'orb'], ['heal', 2, 300], ['dmg', 2, 120, 'phys'], ['dmg', 2, 80, 'arts']]);
      await settle();
      assert.ok(asked(urls, manifest.audio.sfx.units[AGOAT2].attack), 'her cast sound');
      assert.ok(!asked(urls, manifest.audio.sfx.units[AGOAT2].hit), 'no impact sound of hers on the ally');
      assert.ok(!ownSkill.some((p) => asked(urls, p)), 'nothing of her S3');
      // a hostile attack still authors its impact — once, and only for a real hit (not an element gauge fill)
      a.handleBattleEvents([['atk', 3, 2, 'none'], ['dmg', 2, 900, 'burn']]);
      await settle();
      assert.ok(!asked(urls, manifest.audio.sfx.units[enemyId].hit), 'a gauge fill is no impact');
      a.handleBattleEvents([['dmg', 2, 200, 'phys']]);
      await settle();
      assert.equal(askedCount(urls, manifest.audio.sfx.units[enemyId].hit), 1, 'the impact');
      a.limiter.lastByUnit.clear(); a.limiter.lastByUrl.clear();
      a.handleBattleEvents([['dmg', 2, 50, 'phys']]);
      await settle();
      assert.equal(askedCount(urls, manifest.audio.sfx.units[enemyId].hit), 1, 'a later tick is not the same attack\'s impact');
    } finally { restore(); }
  });

  test('a chain bounce plays no attack sound of the previous target; a stale attack is no impact', async () => {
    const enemyId = Object.keys(manifest.audio.sfx.units).find((k) => k.startsWith('enemy_') && manifest.audio.sfx.units[k].attack && manifest.audio.sfx.units[k].hit);
    const charId = Object.keys(manifest.audio.sfx.units).find((k) => k.startsWith('char_') && normalAttackSfx(k, manifest.audio.sfx.units[k].hit) && manifest.audio.sfx.units[k].hit);
    const { a, urls, settle, restore } = await rig([
      { id: 1, side: 'ally', kind: 'chess', spine: charId }, { id: 5, side: 'enemy', kind: 'enemy', spine: enemyId },
      { id: 6, side: 'enemy', kind: 'enemy', spine: enemyId },
    ]);
    const perf = globalThis.performance;
    let fakeNow = 1000;
    globalThis.performance = { now: () => fakeNow };
    try {
      a.handleBattleEvents([['atk', 5, 6, 'chain']]);
      await settle();
      assert.ok(!asked(urls, manifest.audio.sfx.units[enemyId].attack), 'the bounce is not an enemy attack');
      a.handleBattleEvents([['atk', 1, 5, 'arrow']]);
      fakeNow += 4000;
      a.handleBattleEvents([['dmg', 5, 100, 'phys']]);
      await settle();
      assert.ok(!asked(urls, manifest.audio.sfx.units[charId].hit), '4 s later: not that attack\'s impact');
    } finally { globalThis.performance = perf; restore(); }
  });
});
