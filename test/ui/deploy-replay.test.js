// test/ui/deploy-replay.test.js — PR #416 by @Cromemadnd, ported in 0.2.6 (DESIGN §31.8): the round start replays the own
// board's Start clips in deployment order (ui/gameLogic deployOrder / roundStartReplay — the maintainer's confirmation from
// official play, 2026-10-13), and a landing sounds like the piece's battle deployment through the SFX channel
// (public/js/audio.js deployCue) in its own voices: at most LAND_VOICES at once, a new landing taking the oldest one's
// voice instead of being dropped (Grok's review of r37: the battle limiter left 6 of 8 b_char_set landings silent) —
// checked with the real AudioManager, SfxLimiter and buffer cache on a fake Web Audio context. The view side is
// test/render/deploy-replay.test.js, the browser check test/ui/deploy-replay.e2e.test.js.
// Run: node --test test/ui/deploy-replay.test.js

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deployOrder, roundStartReplay } from '../../public/js/ui/gameLogic.js';
import { AudioManager, SfxLimiter, LAND_VOICES, deploySfxUrl } from '../../public/js/audio.js';
import { mediaUrl } from '../../public/js/media.js';
import { PHASE } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'data', 'assets.json'), 'utf8'));
const chess = (uid, row, col, extra = {}) => ({ uid, kind: 'chess', id: `chess_${uid}`, row, col, ...extra });

describe('deployOrder — the order the battle deploys the board (Battle.start)', () => {
  test('operators by column from the left, top to bottom within a column, then the summons the same way; no items', () => {
    // board rows 9 (bottom) … 12 (top), cols 2 … 10; given in reading order, as m.private sends it (server board.js boardOrder)
    const board = [
      chess(1, 12, 5), chess(2, 12, 2), { uid: 3, kind: 'token', id: 'token_a', row: 12, col: 3 }, chess(4, 11, 2),
      { uid: 5, kind: 'item', id: 'chess_item_6_03_m', row: 10, col: 4 }, chess(6, 10, 5), chess(7, 9, 3),
      { uid: 8, kind: 'token', id: 'token_b', row: 9, col: 2 },
    ];
    assert.deepEqual(deployOrder(board), [2, 4, 7, 1, 6, 8, 3]);
    // the same rule the client's merge target uses (gameLogic mergeTarget: col asc, then row desc)
    assert.deepEqual(deployOrder([chess(1, 9, 4), chess(2, 12, 4), chess(3, 10, 3)]), [3, 2, 1]);
  });

  test('junk and missing fields are left out; an empty or absent board is no order', () => {
    assert.deepEqual(deployOrder(null), []);
    assert.deepEqual(deployOrder([]), []);
    assert.deepEqual(deployOrder([null, 'x', { uid: 1, kind: 'chess', row: 10 }, { kind: 'chess', row: 10, col: 3 }, chess(9, 10, 3)]), [9]);
  });
});

describe('roundStartReplay — once per round, in 回合开始, on the own board', () => {
  const board = [chess(11, 12, 6), chess(12, 9, 2)];
  const base = { phase: PHASE.ROUND_START, round: 7, replayed: 6, ownBoard: true, board };

  test('due in 回合开始 of a round not replayed yet: its pieces in deployment order', () => {
    assert.deepEqual(roundStartReplay(base), { round: 7, uids: [12, 11] });
  });

  test('not again for the same round (a reconnect, a re-render); not in another phase', () => {
    assert.equal(roundStartReplay({ ...base, replayed: 7 }), null);
    for (const phase of [PHASE.PREP, PHASE.SP_DRAFT, PHASE.SETTLE, PHASE.COMBAT, PHASE.BATTLE_CHECK, null]) {
      assert.equal(roundStartReplay({ ...base, phase }), null, String(phase));
    }
    assert.equal(roundStartReplay({ ...base, round: null }), null);
  });

  test('only the viewer\'s own board: a scouted teammate, a spectator seat or an eliminated player gets none', () => {
    assert.equal(roundStartReplay({ ...base, ownBoard: false }), null);
  });

  test('an empty board (or a private state not here yet) schedules nothing — and marks nothing, so a board that arrives later in 回合开始 still plays', () => {
    assert.equal(roundStartReplay({ ...base, board: [] }), null);
    assert.equal(roundStartReplay({ ...base, board: undefined }), null);
    assert.deepEqual(roundStartReplay({ ...base, replayed: null }), { round: 7, uids: [12, 11] });
  });

  test('screens/game.js asks after the wiring effect and marks the round only once the view took the sequence', () => {
    const src = readFileSync(path.join(ROOT, 'public/js/screens/game.js'), 'utf8');
    const wiring = src.indexOf('}, [view, showPrep, priv, editable, field, combat, mode, watchingOther, watching, holdSeq]);');
    const replay = src.indexOf('const plan = roundStartReplay(');
    assert.ok(wiring > 0 && replay > wiring, 'the replay effect runs after setPrep in the same commit');
    assert.match(src, /roundStartReplay\(\{ phase, round: pub\?\.round, replayed: replayedRef\.current, ownBoard: showPrep && alive && !spectator, board: priv\?\.board \}\)/);
    assert.match(src, /if \(plan && view && view\.replayDeploys\?\.\(plan\.uids\) > 0\) replayedRef\.current = plan\.round;/);
    assert.doesNotMatch(src, /deployPiece|deploySequence/, 'no landing at the wheel\'s confirm: the state that shows the move lands the piece once');
    const host = readFileSync(path.join(ROOT, 'public/js/ui/fieldHost.js'), 'utf8');
    assert.match(host, /'stripesUnder', 'replayDeploys'\]/, 'an optional view method (the simplified board has none)');
  });
});

// ---- the landing voices: the real AudioManager (SfxLimiter, _buffer, the nodes) on a fake Web Audio context --------------

const SET = manifest.audio.sfx.battle.deploy;         // b_char_set: 192 of the 210 operators land with it
const TOKEN_SET = manifest.audio.sfx.battle.tokenDeploy;
const OWN = Object.keys(manifest.audio.sfx.units).find((k) => k.startsWith('char_') && typeof manifest.audio.sfx.units[k].born === 'string');
const PLAIN = Object.keys(manifest.chars).filter((k) => !manifest.audio.sfx.units[k]?.born);
/** Seconds of the files as served (b_char_set 1.41 s, b_char_tokenset 0.50 s — afinfo); 1 s for any other. */
const durationOf = (url) => (/b_char_set/.test(url) ? 1.41 : /b_char_tokenset/.test(url) ? 0.5 : 1);

/**
 * A fake Web Audio window: every buffer source records when it started and stopped on a clock the test moves (`at(ms)`:
 * performance.now() and ctx.currentTime follow it, a source that reaches its end fires `onended`); fetch serves every
 * sound with its real length. `hold(url)` keeps one download open until the returned function is called.
 */
function landingRig({ settings = { sfx: 0.8, muted: false } } = {}) {
  const clock = { ms: 0 };
  const sources = [];
  const fetched = [];
  const held = new Map();
  class Param {
    constructor() { this.value = 1; this.ramps = []; }
    setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v, t) { this.ramps.push([v, t]); } setTargetAtTime(v) { this.value = v; }
    cancelScheduledValues() {}
  }
  class Node { connect() {} disconnect() {} }
  class Gain extends Node { constructor() { super(); this.gain = new Param(); } }
  class Src extends Node {
    constructor() { super(); this.playbackRate = new Param(); this.buffer = null; this.startedAt = null; this.stoppedAt = null; this.stopWhen = null; this.ended = false; sources.push(this); }
    start() { this.startedAt = clock.ms; }
    stop(when) { this.stoppedAt = clock.ms; this.stopWhen = when; }
    get playing() { return this.startedAt != null && this.stoppedAt == null && !this.ended; }
  }
  class Ctx {
    constructor() { this.state = 'running'; this.destination = new Node(); this.sampleRate = 44100; }
    get currentTime() { return clock.ms / 1000; }
    createGain() { return new Gain(); }
    createBufferSource() { return new Src(); }
    createBuffer() { return { duration: 0 }; }
    decodeAudioData(ab, ok) { ok({ duration: ab.duration, length: 1, numberOfChannels: 1, url: ab.url }); }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
  }
  const listeners = new Map();
  const win = { AudioContext: Ctx, document: { hidden: false, addEventListener() {} }, addEventListener(t, fn) { listeners.set(t, fn); }, removeEventListener(t) { listeners.delete(t); } };
  const realFetch = globalThis.fetch;
  const perf = globalThis.performance;
  const realNow = perf.now;
  globalThis.fetch = async (u) => {
    fetched.push(u);
    const wait = held.get(u);
    if (wait) await wait;
    return { ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => ({ duration: durationOf(u), url: u }) };
  };
  perf.now = () => clock.ms;
  const a = new AudioManager({ win, getManifest: () => manifest, random: () => 0 });
  a.setVolumes(settings);
  a.install();
  a.warmLandings();   // the field view's wish when the match screen comes up, before any gesture (render/app.js)
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
  return {
    a, sources, fetched,
    unlock: async () => { listeners.get('pointerdown')?.(); await flush(); },
    /** Move the clock to `ms`: a playing source whose file ran out ends (onended), as Web Audio does. */
    at: async (ms) => {
      clock.ms = ms;
      for (const s of sources) if (s.playing && s.buffer && ms >= s.startedAt + s.buffer.duration * 1000) { s.ended = true; s.onended?.(); }
      await flush();
    },
    flush,
    hold: (url) => { let open; held.set(mediaUrl(url), new Promise((r) => { open = r; })); return () => open(); },
    playing: () => sources.filter((s) => s.playing && s.buffer?.duration > 0),
    started: () => sources.filter((s) => s.startedAt != null && s.buffer?.duration > 0),
    restore: () => { globalThis.fetch = realFetch; perf.now = realNow; },
  };
}

describe('AudioManager.deployCue — the landing sound in its own voices, taken over instead of dropped', () => {
  test(`8 operators on b_char_set, 50 ms apart: 8 starts, never more than ${LAND_VOICES} at once, the oldest taken over each time`, async () => {
    assert.equal(LAND_VOICES, 3);
    // the battle rule this replaces: ≤ 2 copies of a file at once and the rest dropped — 2 of the 8 would have sounded
    const battle = new SfxLimiter();
    assert.equal([...Array(8).keys()].filter((i) => battle.tryAcquire(i * 50, `land:p:${i}`, SET)).length, 2);
    const r = landingRig();
    try {
      await r.unlock();
      const most = [];
      for (let i = 0; i < 8; i++) {
        await r.at(i * 50);
        assert.equal(r.a.deployCue({ def: PLAIN[i], defId: `chess_${i}`, kind: 'op' }, `p:${i}`), true);
        await r.flush();
        most.push(r.playing().length);
        const started = r.started();
        assert.equal(started.length, i + 1, `landing #${i} started at once`);
        assert.equal(started[i].startedAt, i * 50);
        assert.equal(started[i].buffer.url, mediaUrl(SET), 'b_char_set');
        if (i >= LAND_VOICES) {
          const old = started[i - LAND_VOICES];
          assert.equal(old.stoppedAt, i * 50, `#${i} took the voice of #${i - LAND_VOICES}, the oldest still ringing`);
          assert.ok(Math.abs(old.stopWhen - (i * 50) / 1000 - 0.035) < 1e-9, 'which fades out over 30 ms instead of clicking');
          assert.deepEqual(r.a.landVoices.length, LAND_VOICES);
        }
      }
      assert.ok(Math.max(...most) <= LAND_VOICES, `at most ${LAND_VOICES} at once (${most.join(',')})`);
      assert.deepEqual(most, [1, 2, 3, 3, 3, 3, 3, 3]);
      assert.deepEqual(r.a.landStats, { started: 8, stolen: 5 });
      // the newest three ring out; the other battle sounds' limiter was never touched
      await r.at(350 + 1500);
      assert.equal(r.playing().length, 0);
      assert.equal(r.a.landVoices.length, 0, 'every voice returned');
      assert.equal(r.a.landLimiter.active, 0);
      assert.equal(r.a.limiter.active, 0);
      assert.equal(r.a.limiter.lastByUrl.size, 0, 'the battle limiter knows nothing of landings');
    } finally { r.restore(); }
  });

  test('a full board of 36 pieces — b_char_set, own deploy sounds and summons — lands every one within the cap', async () => {
    const r = landingRig();
    try {
      await r.unlock();
      let most = 0;
      for (let i = 0; i < 36; i++) {
        await r.at(i * 50);
        const info = i % 6 === 5 ? { def: 'token_10000_silent_healrb', defId: 'token_10000_silent_healrb', kind: 'token' }
          : i % 9 === 4 ? { def: OWN, defId: `chess_${i}`, kind: 'op' } : { def: PLAIN[i], defId: `chess_${i}`, kind: 'op' };
        r.a.deployCue(info, `p:${i}`);
        await r.flush();
        most = Math.max(most, r.playing().length, r.a.landVoices.length);
      }
      assert.equal(r.started().length, 36, 'every landing started');
      assert.ok(most <= LAND_VOICES, `never more than ${LAND_VOICES} at once (${most})`);
      assert.equal(r.a.landStats.started, 36);
      const files = new Set(r.started().map((s) => s.buffer.url));
      assert.ok(files.has(mediaUrl(SET)) && files.has(mediaUrl(manifest.audio.sfx.units[OWN].born)) && files.size >= 3, 'the generic, an own and a summon sound');
      await r.at(36 * 50 + 1500);
      assert.equal(r.a.landVoices.length, 0);
      assert.equal(r.a.landLimiter.active, 0);
    } finally { r.restore(); }
  });

  test('one landing never sounds twice: the same piece within the cooldown takes no voice and stops nothing', async () => {
    const r = landingRig();
    try {
      await r.unlock();
      for (let i = 0; i < LAND_VOICES; i++) { await r.at(i * 50); r.a.deployCue({ def: PLAIN[i], kind: 'op' }, `p:${i}`); await r.flush(); }
      await r.at(LAND_VOICES * 50);
      r.a.deployCue({ def: PLAIN[LAND_VOICES - 1], kind: 'op' }, `p:${LAND_VOICES - 1}`);   // 50 ms after its own landing
      await r.flush();
      assert.equal(r.started().length, LAND_VOICES, 'no second start');
      assert.equal(r.started().filter((s) => s.stoppedAt != null).length, 0, 'and nothing taken over for it');
      await r.at(LAND_VOICES * 50 + 200);
      r.a.deployCue({ def: PLAIN[0], kind: 'op' }, 'p:0');                                    // a later landing of the same piece
      await r.flush();
      assert.equal(r.started().length, LAND_VOICES + 1);
    } finally { r.restore(); }
  });

  test('the sound of the piece\'s battle deployment at its gain: own ON_UNIT_BORN file, else b_char_set / b_char_tokenset', async () => {
    const r = landingRig();
    try {
      await r.unlock();
      assert.equal(r.a.deployCue({ def: OWN, defId: 'chess_x', kind: 'op' }, 'p:3'), true);
      assert.equal(r.a.deployCue({ def: PLAIN[0], defId: 'chess_y', kind: 'op' }, 'p:4'), true);
      assert.equal(r.a.deployCue({ def: 'token_10000_silent_healrb', defId: 'token_10000_silent_healrb', kind: 'token' }, 'p:5'), true);
      await r.flush();
      const token = deploySfxUrl(manifest, { def: 'token_10000_silent_healrb', defId: 'token_10000_silent_healrb', kind: 'token', side: 'ally' });
      assert.deepEqual(r.a.landVoices.map((v) => v.url), [manifest.audio.sfx.units[OWN].born, SET, token]);
      assert.equal(token, manifest.audio.sfx.units.token_10000_silent_healrb?.born ?? TOKEN_SET, 'a summon: the token sound');
      assert.equal(r.a.landVoices[1].gain.gain.value, 0.5, 'the generic file at the battle deploy\'s gain');
      assert.ok(r.a.landVoices[0].gain.gain.value > 0 && r.a.landVoices[0].gain.gain.value <= 0.8, 'an own file at its bank gain');
    } finally { r.restore(); }
  });

  test('a landing taken over while its file still downloads never starts; the generic files are fetched ahead', async () => {
    const r = landingRig();
    try {
      assert.equal(r.fetched.length, 0, 'the field view\'s wish waits for the first gesture');
      await r.unlock();
      assert.deepEqual(r.fetched, [mediaUrl(SET), mediaUrl(TOKEN_SET)], 'fetched at unlock: a round start never waits for them');
      const born = manifest.audio.sfx.units[OWN].born;
      const open = r.hold(born);
      r.a.deployCue({ def: OWN, kind: 'op' }, 'p:1');                     // still downloading …
      for (let i = 0; i < LAND_VOICES; i++) { await r.at(50 + i * 50); r.a.deployCue({ def: PLAIN[i], kind: 'op' }, `p:${10 + i}`); await r.flush(); }
      assert.equal(r.a.landStats.stolen, 1, '… when the pool filled up it gave its voice');
      open();
      await r.flush();
      assert.equal(r.started().filter((s) => s.buffer.url === mediaUrl(born)).length, 0, 'and it never starts');
      assert.equal(r.started().length, LAND_VOICES);
    } finally { r.restore(); }
  });

  test('the SFX volume and mute apply: muted or at 0 nothing is fetched, started or taken over; a manifest without the sound: nothing', async () => {
    const r = landingRig({ settings: { sfx: 0.8, muted: true } });
    try {
      await r.unlock();
      assert.equal(r.fetched.length, 0, 'no warm-up while muted');
      r.a.deployCue({ def: PLAIN[0], kind: 'op' }, 'p:1');
      r.a.setVolumes({ sfx: 0, muted: false });
      r.a.deployCue({ def: PLAIN[1], kind: 'op' }, 'p:2');
      await r.flush();
      assert.deepEqual([r.fetched.length, r.started().length, r.a.landVoices.length], [0, 0, 0]);
      r.a.setVolumes({ sfx: 0.8, muted: false });
      await r.flush();
      assert.deepEqual(r.fetched, [mediaUrl(SET), mediaUrl(TOKEN_SET)], 'audible again: the kept wish fetches them now');
      r.a.deployCue({ def: PLAIN[2], kind: 'op' }, 'p:3');
      await r.flush();
      assert.equal(r.started().length, 1);
    } finally { r.restore(); }
    const bare = new AudioManager({ win: null, getManifest: () => ({ audio: { sfx: { battle: {}, units: {} } } }) });
    assert.equal(bare.deployCue({ def: 'char_x', kind: 'op' }, 1), false);
    const none = new AudioManager({ win: null, getManifest: () => null });
    assert.equal(none.deployCue({ def: 'char_x', kind: 'op' }, 1), false);
    assert.equal(none.deployCue(null, 1), false);
  });
});
