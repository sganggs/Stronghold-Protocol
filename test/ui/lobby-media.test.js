// test/ui/lobby-media.test.js — 自定义大厅背景与音乐 (PR #643 split 8): which files a slot takes (type, extension, size
// limits, empty), the saved switches sanitised, the audio manager playing the player's own lobby track from its bytes
// (never fetched, only for the 'lobby' key, through the BGM gain; off → the manifest's track; a file that will not decode
// → the official track and onLobbyTrackFailed), the site CSP allowing blob: media and no remote media origin, and the
// lobby css following 文字大小 without !important. (The browser side: test/ui/lobby-media.e2e.test.js.)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { classifyFile, loadMediaPrefs, MEDIA_LIMITS } = await import('../../public/js/ui/lobbyMedia.js');
const { AudioManager, LOCAL_BGM } = await import('../../public/js/audio.js');
const { mediaUrl } = await import('../../public/js/media.js');
const { siteCsp } = await import('../../server/http/csp.js');
const manifest = JSON.parse(readFileSync(path.join(ROOT, 'data', 'assets.json'), 'utf8'));
const MB = 1024 * 1024;
const file = (name, type, size = 1000) => ({ name, type, size });

describe('which files a slot takes', () => {
  test('the backdrop: a picture or an MP4 / WebM video, by type, else by extension', () => {
    for (const [f, kind] of [
      [file('a.png', 'image/png'), 'image'], [file('a.jpg', 'image/jpeg'), 'image'], [file('a.webp', 'image/webp'), 'image'],
      [file('a.gif', 'image/gif'), 'image'], [file('a.avif', 'image/avif'), 'image'], [file('b.mp4', 'video/mp4'), 'video'],
      [file('b.webm', 'video/webm'), 'video'], [file('noType.JPEG', ''), 'image'], [file('noType.m4v', ''), 'video'],
    ]) assert.deepEqual(classifyFile(f, 'backdrop'), { ok: true, kind }, f.name);
    for (const f of [file('a.svg', 'image/svg+xml'), file('a.mov', 'video/quicktime'), file('a.mp3', 'audio/mpeg'), file('a.png', 'text/plain'), file('x', '')]) {
      const r = classifyFile(f, 'backdrop');
      assert.equal(r.ok, false, f.name);
      assert.match(r.reason, /PNG/);
    }
  });
  test('the music: an audio type, or a known audio extension without a usable type', () => {
    for (const f of [file('a.mp3', 'audio/mpeg'), file('a.m4a', 'audio/mp4'), file('a.ogg', 'audio/ogg'), file('a.wav', 'audio/wav'),
      file('a.flac', 'audio/flac'), file('a.opus', ''), file('a.webm', 'video/webm'), file('a.ogg', 'application/ogg')]) {
      assert.deepEqual(classifyFile(f, 'music'), { ok: true, kind: 'music' }, `${f.name} ${f.type}`);
    }
    for (const f of [file('a.png', 'image/png'), file('a.mp4', 'video/mp4'), file('a.txt', ''), file('a.mid', 'text/plain')]) {
      assert.equal(classifyFile(f, 'music').ok, false, f.name);
    }
  });
  test('the size limits (20 / 60 / 20 MB) and an empty file', () => {
    assert.deepEqual(MEDIA_LIMITS, { image: 20 * MB, video: 60 * MB, music: 20 * MB });
    assert.equal(classifyFile(file('a.png', 'image/png', 20 * MB), 'backdrop').ok, true);
    assert.match(classifyFile(file('a.png', 'image/png', 20 * MB + 1), 'backdrop').reason, /20 MB/);
    assert.equal(classifyFile(file('a.mp4', 'video/mp4', 60 * MB), 'backdrop').ok, true);
    assert.match(classifyFile(file('a.mp4', 'video/mp4', 60 * MB + 1), 'backdrop').reason, /60 MB/);
    assert.match(classifyFile(file('a.mp3', 'audio/mpeg', 20 * MB + 1), 'music').reason, /20 MB/);
    for (const f of [null, file('a.png', 'image/png', 0)]) assert.equal(classifyFile(f, 'backdrop').ok, false);
  });
  test('the saved switches are sanitised (off by default, 暗度 0–0.8)', () => {
    assert.deepEqual(loadMediaPrefs(null), { backdrop: false, music: false, dim: 0.35, scene: 'official' });
    assert.deepEqual(loadMediaPrefs({ backdrop: true, music: 'yes', dim: 3, scene: 'frost' }), { backdrop: true, music: false, dim: 0.8, scene: 'frost' });
    assert.deepEqual(loadMediaPrefs({ dim: -1, scene: 'sunny' }), { backdrop: false, music: false, dim: 0, scene: 'official' }, 'an unknown scene is the official backdrop');
    assert.deepEqual(loadMediaPrefs({ dim: 'x' }).dim, 0.35);
  });
});

// ---- the audio manager with a fake Web Audio ---------------------------------------------------------------------------
function fakeWindow({ decodeFails = () => false } = {}) {
  const made = { started: 0, decoded: [] };
  class Param { constructor() { this.value = 1; } setValueAtTime(v) { this.value = v; } linearRampToValueAtTime(v) { this.value = v; } setTargetAtTime(v) { this.value = v; } cancelScheduledValues() {} }
  class Node { connect() {} disconnect() {} }
  class Gain extends Node { constructor() { super(); this.gain = new Param(); } }
  class Src extends Node { constructor() { super(); this.playbackRate = new Param(); } start() { made.started++; } stop() {} }
  class Ctx {
    constructor() { this.currentTime = 0; this.state = 'running'; this.destination = new Node(); }
    createGain() { return new Gain(); }
    createBufferSource() { return new Src(); }
    decodeAudioData(ab, ok, bad) { made.decoded.push(ab.byteLength); if (decodeFails(ab)) bad(new Error('codec')); else ok({ duration: 2, length: 10, numberOfChannels: 2 }); }
    resume() { return Promise.resolve(); }
    suspend() { return Promise.resolve(); }
  }
  const listeners = new Map();
  return {
    made,
    win: { AudioContext: Ctx, document: { hidden: false, addEventListener() {} }, addEventListener(t, fn) { listeners.set(t, fn); }, removeEventListener(t) { listeners.delete(t); } },
    fire(t) { listeners.get(t)?.(); },
  };
}
const tick = () => new Promise((r) => setTimeout(r, 15));

describe('the player\'s own lobby music (audio.js setLobbyTrack)', () => {
  test('plays from its bytes for the lobby key only; off → the manifest\'s track', async () => {
    const fw = fakeWindow();
    const origFetch = globalThis.fetch;
    const urls = [];
    globalThis.fetch = async (u) => { urls.push(u); return { ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => new ArrayBuffer(8) }; };
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
      a.install();
      fw.fire('pointerdown');
      let reads = 0;
      a.setLobbyTrack({ id: '42', read: async () => { reads++; return new ArrayBuffer(1234); } });
      a.playBgm('lobby');
      await tick();
      assert.equal(a.bgm?.loopUrl, `${LOCAL_BGM}42`);
      assert.equal(reads, 1);
      assert.ok(fw.made.decoded.includes(1234), 'decoded from the bytes');
      const lobby = manifest.audio.bgm.lobby;
      assert.ok(!urls.some((u) => u === mediaUrl(lobby.loop) || u === lobby.loop), 'the official lobby track is not fetched');
      assert.ok(!urls.some((u) => String(u).startsWith(LOCAL_BGM)), 'the own track is never a request');
      // another screen's music is the manifest's
      a.playBgm('prep');
      await tick();
      assert.equal(a.bgm?.loopUrl, manifest.audio.bgm.prep.loop);
      // back in the lobby: the cached own track, not read again
      a.playBgm('lobby');
      await tick();
      assert.equal(a.bgm?.loopUrl, `${LOCAL_BGM}42`);
      assert.equal(reads, 1);
      // switched off: the screen's track changes at once to the official one
      a.setLobbyTrack(null);
      await tick();
      assert.equal(a.bgm?.loopUrl, lobby.loop);
      // a new file: a new id, read again
      a.setLobbyTrack({ id: '43', read: async () => { reads++; return new ArrayBuffer(99); } });
      await tick();
      assert.equal(a.bgm?.loopUrl, `${LOCAL_BGM}43`);
      assert.equal(reads, 2);
      assert.ok(!a.buffers.has(`${LOCAL_BGM}42`), 'the old file\'s buffer is dropped');
    } finally { globalThis.fetch = origFetch; }
  });
  test('silent while muted (nothing read); a file that will not decode → the official track and onLobbyTrackFailed', async () => {
    const fw = fakeWindow({ decodeFails: (ab) => ab.byteLength === 7 });
    const origFetch = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, headers: { get: () => 'audio/mpeg' }, arrayBuffer: async () => new ArrayBuffer(8) });
    try {
      const a = new AudioManager({ win: fw.win, getManifest: () => manifest });
      a.install();
      fw.fire('pointerdown');
      let reads = 0;
      a.setVolumes({ muted: true });
      a.setLobbyTrack({ id: 'm', read: async () => { reads++; return new ArrayBuffer(5); } });
      a.playBgm('lobby');
      await tick();
      assert.equal(reads, 0, 'muted: the file is not even read');
      a.setVolumes({ muted: false });
      await tick();
      assert.equal(a.bgm?.loopUrl, `${LOCAL_BGM}m`);
      let failed = 0;
      a.onLobbyTrackFailed = () => { failed++; };
      a.setLobbyTrack({ id: 'bad', read: async () => new ArrayBuffer(7) });
      await tick();
      assert.equal(failed, 1);
      assert.equal(a.lobbyTrack, null);
      assert.equal(a.bgm?.loopUrl, manifest.audio.bgm.lobby.loop, 'the official track plays instead');
    } finally { globalThis.fetch = origFetch; }
  });
});

test('the site CSP: blob: media for the own video, no remote media origin', () => {
  const csp = siteCsp(path.join(ROOT, 'public'));
  const media = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('media-src'));
  assert.equal(media, "media-src 'self' blob:");
  assert.ok(!/script-src[^;]*blob:/.test(csp));
});

test('lobby.css: the own backdrop and its dialog follow 文字大小, no !important / :has()', () => {
  const css = readFileSync(path.join(ROOT, 'public/css/screens/lobby.css'), 'utf8');
  const start = css.indexOf('/* ---- 大厅背景与音乐');
  assert.ok(start > 0);
  const block = css.slice(start, css.indexOf('/* ----', start + 10));
  const sizes = [...block.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim());
  assert.ok(sizes.length >= 5);
  for (const v of sizes) assert.match(v, /^calc\(\.\d+ \* var\(--t\)\)$/, v);
  assert.ok(!/!important|:has\(/.test(block));
  assert.match(block, /\.hub-bg__own::after[^}]*var\(--own-dim/);
  assert.match(css.slice(css.lastIndexOf('prefers-reduced-motion')), /\.hub-bg__own/);
});
