// #680: official bank limits, takeover, pitch and delay; no real audio, network or clocks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioManager } from '../../public/js/audio.js';

const PATH = 'player/p_atk/test_n.mp3';
const URL = `/assets/audio/sfx/${PATH}`;
const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
const pool = (id = 'bank', overrides = {}) => ({
  id, maxSoundAllowed: 2, popOldest: true,
  sounds: { [PATH]: { minPitch: 0.8, maxPitch: 1.2, delay: 0 } }, ...overrides,
});

function fixture(t) {
  const sources = [];
  let now = 0;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.mock.method(performance, 'now', () => now);
  const a = new AudioManager({ win: null, random: () => 0.5 });
  a.ctx = {
    currentTime: 10,
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    createBufferSource() {
      const src = {
        playbackRate: { value: 1 }, stopped: 0, disconnected: 0,
        connect() {}, disconnect() { this.disconnected++; },
        start(at) { this.at = at; }, stop() { this.stopped++; this.onended?.(); },
      };
      sources.push(src);
      return src;
    },
  };
  a.sfxGain = {};
  a._buffer = async () => ({ duration: 2 });
  a.limiter.unitCooldownMs = 0;
  a.limiter.urlGapMs = 0;
  t.after(() => { a.stopPoolSounds?.(); for (const src of sources) src.onended?.(); });
  return {
    a, sources, now: (ms) => { now = ms; },
    advance(ms) { a.ctx.currentTime += ms / 1000; now += ms; t.mock.timers.tick(ms); },
    async play(p = pool(), url = URL, unitKey = 'u') {
      a._play(url, { volume: 0.55, limited: true, unitKey, pool: p });
      await flush();
    },
  };
}

test('popOldest stops the oldest instance, admits the newest and releases exactly once', async (t) => {
  const f = fixture(t);
  await f.play(); await f.play(); await f.play();
  assert.deepEqual(f.sources.map(s => s.stopped), [1, 0, 0]);
  assert.equal(f.a.limiter.active, 2);
  f.sources[0].onended(); // a late browser callback after takeover
  assert.equal(f.a.limiter.active, 2);
  await f.play();
  assert.deepEqual(f.sources.map(s => s.stopped), [1, 1, 0, 0]);
  f.sources[2].onended(); f.sources[3].onended();
  assert.equal(f.a.limiter.active, 0);
  assert.equal(f.a.poolVoices.size, 0);
});

test('popOldest false drops new instances across files in the same bank until one ends', async (t) => {
  const f = fixture(t), p = pool('bank', { maxSoundAllowed: 1, popOldest: false });
  await f.play(p); await f.play(p, '/assets/audio/sfx/other.mp3');
  assert.equal(f.sources.length, 1);
  assert.equal(f.sources[0].stopped, 0);
  f.sources[0].onended();
  await f.play(p, '/assets/audio/sfx/other.mp3');
  assert.equal(f.sources.length, 2);
  assert.equal(f.a.limiter.active, 1);
});

test('distinct banks sharing a file have independent caps; an official cap above two is honored', async (t) => {
  const f = fixture(t);
  const a = pool('a', { maxSoundAllowed: 3, popOldest: false });
  for (let i = 0; i < 4; i++) await f.play(a);
  await f.play(pool('b', { maxSoundAllowed: 1 }));
  assert.equal(f.sources.length, 4);
  assert.equal(f.a.poolVoices.get('a').length, 3);
  assert.equal(f.a.poolVoices.get('b').length, 1);
  assert.ok(f.sources.every(s => s.stopped === 0));
});

test('a full global budget still permits takeover inside a full pool and never steals another bank', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 8; i++) await f.play(pool(`bank${i}`, { maxSoundAllowed: 1 }));
  await f.play(pool('unrelated'));
  assert.equal(f.sources.length, 8);
  await f.play(pool('bank3', { maxSoundAllowed: 1 }));
  assert.equal(f.sources.length, 9);
  assert.equal(f.sources[3].stopped, 1);
  assert.equal(f.sources.filter(s => s.stopped).length, 1);
  assert.equal(f.a.limiter.active, 8);
});

test('pitch uses each file range, including fixed pitches and both ends of a variable range', async (t) => {
  const f = fixture(t);
  for (const [i, lo, hi, roll, expected] of [
    [0, 0.8, 1.2, 0, 0.8], [1, 0.8, 1.2, 1, 1.2], [2, 0.9, 1.1, 0.25, 0.95],
    [3, 1, 1, 0.7, 1], [4, 0.8, 0.8, 0.1, 0.8],
  ]) {
    f.a.random = () => roll;
    await f.play(pool(`pitch${i}`, { sounds: { [PATH]: { minPitch: lo, maxPitch: hi, delay: 0 } } }));
    assert.ok(Math.abs(f.sources[i].playbackRate.value - expected) < 1e-12);
  }
});

test('the selected fallback file and hashed URL choose their own pitch and delay in AudioContext seconds', async (t) => {
  const f = fixture(t);
  const p = pool('bank', { sounds: {
    [PATH]: { minPitch: 1, maxPitch: 1, delay: 0 },
    'player/fallback.mp3': { minPitch: 0.5, maxPitch: 0.5, delay: 0.1 },
  } });
  await f.play(p, '/assets/~0123456789abcdef/audio/sfx/player/fallback.mp3');
  assert.equal(f.sources.length, 0);
  f.advance(100);
  assert.equal(f.sources[0].at, 10.1);
  assert.equal(f.sources[0].playbackRate.value, 0.5);
});

test('delayed requests use no playing slots and only take over when playback is due', async (t) => {
  const f = fixture(t), p = pool('bank', { maxSoundAllowed: 1, sounds: { [PATH]: { minPitch: 1, maxPitch: 1, delay: 1 } } });
  await f.play(p); f.advance(500); await f.play(p);
  assert.equal(f.sources.length, 0);
  assert.equal(f.a.limiter.active, 0);
  f.advance(500);
  assert.equal(f.sources[0].at, 11);
  assert.equal(f.sources[0].stopped, 0);
  assert.equal(f.a.limiter.active, 1);
  f.advance(500);
  assert.equal(f.sources[0].stopped, 1);
  assert.equal(f.a.limiter.active, 1);
});

test('the retained 160 ms unit / 45 ms URL gaps reject a request without stealing a voice', async (t) => {
  const f = fixture(t), p = pool('bank', { maxSoundAllowed: 1 });
  f.a.limiter.unitCooldownMs = 160; f.a.limiter.urlGapMs = 45;
  await f.play(p, URL, 'one');
  f.now(44); await f.play(p, URL, 'two');
  f.now(45); await f.play(p, URL, 'two');
  assert.equal(f.sources.length, 2);
  f.now(159); await f.play(p, URL, 'one');
  assert.equal(f.sources.length, 2);
  assert.equal(f.sources[1].stopped, 0);
  f.now(160); await f.play(p, URL, 'one');
  assert.equal(f.sources.length, 3);
});

test('pending downloads never steal; the oldest started instance is replaced after out-of-order decode', async (t) => {
  const f = fixture(t), p = pool('bank', { maxSoundAllowed: 1 });
  await f.play(p);
  let resolve;
  f.a._buffer = () => new Promise(r => { resolve = r; });
  await f.play(p, '/assets/audio/sfx/slow.mp3');
  assert.equal(f.sources[0].stopped, 0);
  f.a._buffer = async () => ({ duration: 2 });
  await f.play(p);
  assert.equal(f.sources[0].stopped, 1);
  resolve({ duration: 2 }); await flush();
  assert.deepEqual(f.sources.map(s => s.stopped), [1, 1, 0]);
  assert.equal(f.a.limiter.active, 1);
});

test('decode failures and node/start failures leave no pool or limiter slots occupied', async (t) => {
  const f = fixture(t);
  f.a._buffer = async () => null;
  await f.play();
  f.a._buffer = async () => { throw Error('decode'); };
  await f.play();
  assert.equal(f.sources.length, 0);
  f.a._buffer = async () => ({ duration: 2 });
  const create = f.a.ctx.createBufferSource;
  f.a.ctx.createBufferSource = () => { throw Error('source'); };
  await f.play();
  f.a.ctx.createBufferSource = () => ({ ...create(), start() { throw Error('start'); } });
  await f.play();
  assert.equal(f.a.limiter.active, 0);
  assert.equal(f.a.poolVoices.size, 0);
});

test('mute or a changed context during decode cancels a pending source', async (t) => {
  const f = fixture(t);
  let resolve;
  f.a._buffer = () => new Promise(r => { resolve = r; });
  await f.play(); f.a.volumes.muted = true;
  resolve({ duration: 2 }); await flush();
  assert.equal(f.sources.length, 0);
  f.a.volumes.muted = false;
  await f.play(); f.a.ctx = null;
  resolve({ duration: 2 }); await flush();
  assert.equal(f.sources.length, 0);
});

test('safety cleanup accounts for both pitch-adjusted duration and delay', async (t) => {
  const f = fixture(t);
  await f.play(pool('bank', { sounds: { [PATH]: { minPitch: 0.5, maxPitch: 0.5, delay: 1 } } }));
  assert.equal(f.a.limiter.active, 0);
  f.advance(1000);
  f.advance(4249);
  assert.equal(f.a.limiter.active, 1);
  t.mock.timers.tick(1);
  assert.equal(f.a.limiter.active, 0);
  f.sources[0].onended();
  assert.equal(f.a.limiter.active, 0);
});

test('unit playback picks the normal/mode pool and preserves the official pool on cosmetic fallback', async (t) => {
  const f = fixture(t);
  const normal = pool('normal'), mode = pool('mode', { sounds: { [PATH]: { minPitch: 1, maxPitch: 1, delay: 0.1 } } });
  const manifest = { audio: { sfx: { units: { char_test: {
    attack: URL, attacks: { 2: URL }, pools: { attack: 'normal' }, attackPools: { 2: 'mode' },
  } }, pools: { normal, mode } } } };
  f.a.getManifest = () => manifest;
  f.a.unit('char_test', 'attack', 1, 2, false); await flush();
  f.a.unit('char_test', 'attack', 2, 2, true); await flush();
  assert.equal(f.sources[0].at, 10);
  f.advance(100);
  assert.equal(f.sources[1].at, 10.1);
  manifest.audio.sfx.units.char_test.attacks[2] = '/p/plugin/bad.mp3';
  f.a.fellBack.add('/p/plugin/bad.mp3');
  f.a._buffer = async url => {
    if (url === '/p/plugin/bad.mp3') { manifest.audio.sfx.units.char_test.attacks[2] = URL; return null; }
    return { duration: 2 };
  };
  f.a.unit('char_test', 'attack', 3, 2, true); await flush(); await flush();
  f.advance(100);
  assert.ok(Math.abs(f.sources[2].at - 10.2) < 1e-12);
  assert.equal(f.a.poolVoices.get('mode').length, 2);
});

test('a zero bank cap remains bounded by the remake global voice budget', async (t) => {
  const f = fixture(t), p = pool('bank', { maxSoundAllowed: 0 });
  for (let i = 0; i < 9; i++) await f.play(p);
  assert.equal(f.sources.length, 8);
  assert.ok(f.sources.every(s => !s.stopped));
});

// Separate wall/audio clocks: timers can fire while Web Audio is suspended. No real timers or game files.
function streamFixture(t, delay = 0.6) {
  let wall = 0, audio = 0, serial = 0;
  const timers = new Map(), sources = [];
  t.mock.method(performance, 'now', () => wall);
  t.mock.method(globalThis, 'setTimeout', (fn, ms) => {
    const id = ++serial;
    timers.set(id, { at: wall + ms, fn });
    return id;
  });
  t.mock.method(globalThis, 'clearTimeout', id => timers.delete(id));
  const p = pool('bank', { sounds: { [PATH]: { minPitch: 1, maxPitch: 1, delay } } });
  const manifest = { audio: { sfx: { units: { char_test: { attack: URL, pools: { attack: 'bank' } } }, pools: { bank: p } } } };
  const a = new AudioManager({ win: null, random: () => 0.5, getManifest: () => manifest });
  a.ctx = {
    state: 'running', get currentTime() { return audio; },
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    createBufferSource() {
      const src = {
        playbackRate: { value: 1 }, stopped: 0, heard: false, ended: false, connected: false,
        connect() { this.connected = true; }, disconnect() { this.connected = false; },
        start(at = audio) { this.at = at; this.endAt = at + this.buffer.duration / this.playbackRate.value; },
        stop() { this.stopped++; this.ended = true; this.onended?.(); },
      };
      sources.push(src);
      return src;
    },
  };
  a.sfxGain = {};
  a._buffer = async () => ({ duration: 0.8 });
  const step = ms => {
    if (a.ctx.state !== 'running') return;
    audio += ms / 1000;
    for (const s of sources) {
      if (s.ended) continue;
      if (s.at <= audio + 1e-10 && s.connected) s.heard = true;
      if (s.endAt <= audio + 1e-10) { s.ended = true; s.onended?.(); }
    }
  };
  const advance = ms => {
    const target = wall + ms;
    for (let n = 0; n < 10000; n++) {
      let next = null;
      for (const [id, timer] of timers) if (timer.at <= target && (!next || timer.at < next.timer.at)) next = { id, timer };
      if (!next) { step(target - wall); wall = target; return; }
      step(next.timer.at - wall); wall = next.timer.at;
      timers.delete(next.id); next.timer.fn();
    }
    assert.fail('timer loop exceeded 10000 callbacks');
  };
  const enter = (count = 2) => a.setFieldUnits(Array.from({ length: count }, (_, i) => ({ id: i + 1, spine: 'char_test', side: 'ally', kind: 'chess' })));
  enter();
  t.after(() => { for (const src of sources) if (!src.ended) src.stop(); });
  return { a, sources, timers, advance, enter, attack: id => a.handleBattleEvents([['atk', id, 99, 'none']]) };
}

test('a sustained two-unit 4x stream sounds throughout a delay longer than the attack spacing (#680 review)', async (t) => {
  // Cached audio_data.json: Chen's attack bank has delay 0.6 s, cap 2 and popOldest=true.
  const f = streamFixture(t);
  for (let i = 0; i < 120; i++) {
    f.attack(i % 2 + 1); await flush(); f.advance(162.5);
    if (i > 6) assert.ok(f.sources.some(s => s.heard), `silent stream at attack ${i}`);
    assert.ok(f.a.limiter.active <= 2);
  }
  assert.ok(f.sources.filter(s => s.heard).length >= 100);
  assert.ok(f.sources.filter(s => s.stopped).every(s => s.heard), 'takeover only stops sounds that have started');
  f.advance(2000);
  assert.equal(f.a.limiter.active, 0);
  assert.equal(f.a.poolVoices.size, 0);
  assert.equal(f.timers.size, 0);
});

test('field replacement cancels delayed, decoding and playing pool sounds even when unit ids repeat (#680 review)', async (t) => {
  const f = streamFixture(t);
  f.attack(1); await flush(); f.advance(100);
  f.enter(); f.advance(1500);
  assert.equal(f.sources.filter(s => s.heard).length, 0, 'old delayed attack stays silent');
  let resolve;
  f.a._buffer = () => new Promise(r => { resolve = r; });
  f.attack(1); await flush(); f.enter();
  resolve({ duration: 0.8 }); await flush(); f.advance(1500);
  assert.equal(f.sources.filter(s => s.heard).length, 0, 'old decode stays silent');
  f.a._buffer = async () => ({ duration: 0.8 });
  f.attack(1); await flush(); f.advance(601);
  assert.equal(f.a.limiter.active, 1);
  f.enter(0);
  assert.equal(f.a.limiter.active, 0);
  assert.equal(f.a.poolVoices.size, 0);
  assert.ok(f.sources.every(s => !s.connected));
});

test('10000 requests for a stalled buffer share bounded decode work and cannot replay after exit (#680 review)', async (t) => {
  const f = streamFixture(t, 0);
  let resolve, callbacks = 0;
  const pending = new Promise(r => { resolve = r; }), then = pending.then.bind(pending);
  pending.then = (...args) => { callbacks++; return then(...args); };
  f.a._buffer = () => pending;
  for (let field = 0; field < 4; field++) {
    f.enter(60);
    for (let i = 0; i < 2500; i++) { f.attack(i % 60 + 1); f.advance(10); }
  }
  assert.ok(callbacks <= 64, `unbounded decode handlers: ${callbacks}`);
  assert.equal(f.a.limiter.active, 0, 'decoding uses no playing slots');
  f.enter(0); resolve({ duration: 0.8 }); await flush(); f.advance(1000);
  assert.equal(f.sources.length, 0);
  assert.equal(f.a.limiter.active, 0);
});

test('distinct stalled URLs have a bounded subscriber count across repeated field changes', async (t) => {
  const f = fixture(t), resolves = [];
  await f.play();
  f.a._buffer = () => new Promise(resolve => resolves.push(resolve));
  for (let field = 0; field < 4; field++) {
    if (field) f.a.setFieldUnits([]);
    for (let i = 0; i < 1000; i++) await f.play(pool(), `/assets/audio/sfx/stall-${field}-${i}.mp3`, `unit-${i}`);
    assert.ok(resolves.length <= 64, `unbounded stalled downloads: ${resolves.length}`);
    assert.ok(f.a.poolRequests.size <= 64);
    if (!field) assert.equal(f.sources[0].stopped, 0, 'waiting requests never steal a playing voice');
  }
  f.a.setFieldUnits([]);
  for (const resolve of resolves) resolve({ duration: 2 });
  await flush();
  assert.equal(f.sources.length, 1);
  assert.equal(f.a.poolRequests.size, 0);
  assert.equal(f.a.poolLoads.size, 0);
  assert.equal(f.a.limiter.active, 0);
});

test('delayed requests have a separate bound and release their queue entries when due', async (t) => {
  const f = fixture(t), p = pool('bank', { sounds: { [PATH]: { minPitch: 1, maxPitch: 1, delay: 1 } } });
  for (let i = 0; i < 1000; i++) await f.play(p, URL, `unit-${i}`);
  assert.equal(f.sources.length, 0);
  assert.equal(f.a.limiter.active, 0);
  assert.equal(f.a.poolRequests.size, 64);
  f.advance(1000);
  assert.equal(f.a.poolRequests.size, 0);
  assert.equal(f.a.limiter.active, 2);
  f.advance(2250);
  assert.equal(f.a.limiter.active, 0);
});

test('a stalled decode discards old attacks and coalesces the latest bank/unit request', async (t) => {
  const f = fixture(t);
  let resolve, calls = 0;
  f.a._buffer = () => { calls++; return new Promise(r => { resolve = r; }); };
  await f.play(pool(), URL, 'stale');
  await f.play(pool(), URL, 'fresh');
  f.now(5000);
  await f.play(pool(), URL, 'fresh');
  resolve({ duration: 2 }); await flush();
  assert.equal(calls, 1);
  assert.equal(f.sources.length, 1);
  assert.equal(f.a.poolRequests.size, 0);
});

test('a suspended audio clock does not consume the delay or admit playing voices', async (t) => {
  const f = streamFixture(t);
  f.attack(1); await flush(); f.advance(100);
  f.a.ctx.state = 'suspended';
  f.advance(5000);
  assert.equal(f.sources.length, 0);
  assert.equal(f.a.limiter.active, 0);
  f.a.ctx.state = 'running';
  f.advance(499);
  assert.equal(f.sources.length, 0);
  f.advance(101); // the next wall timer observes that the audio clock has reached the due time
  assert.equal(f.sources.length, 1);
  assert.equal(f.sources[0].heard, true);
});

test('battle/screen cleanup stops playing pools and invalidates delays and decodes without replacing the field', async (t) => {
  const f = fixture(t);
  await f.play();
  await f.play(pool('delayed', { sounds: { [PATH]: { minPitch: 1, maxPitch: 1, delay: 1 } } }));
  let resolve;
  f.a._buffer = () => new Promise(r => { resolve = r; });
  await f.play(pool('decoding'));
  f.a.stopPoolSounds(); f.a.stopPoolSounds();
  assert.equal(f.sources[0].stopped, 1);
  assert.equal(f.a.limiter.active, 0);
  assert.equal(f.a.poolVoices.size, 0);
  assert.equal(f.a.poolRequests.size, 0);
  resolve({ duration: 2 }); await flush(); f.advance(2000);
  assert.equal(f.sources.length, 1);
  assert.equal(f.a.poolLoads.size, 0);
});
