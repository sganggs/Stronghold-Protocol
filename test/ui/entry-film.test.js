// test/ui/entry-film.test.js — the entry film (ui/entryFilm.js) never sits over a room or a match, and leaves the
// player's own lobby music alone. playEntryFilm runs for real on a small stand-in DOM (the overlay is a <dialog>, the
// card and the skip label plain elements; the scene itself is a stand-in, its pictures are ui/allianceScene.js's own,
// unit-tested in test/ui/alliance-scene.test.js): a session restored into a room while the 点击进入 card waits takes the
// overlay down and a later tap plays nothing; one restored into a match while the film runs takes it down at once, stops
// the entry cue and hands the music back to the screen. holdBgm: with audio.lobbyTrack set nothing fades and playBgm
// is left alone; without it the screen's music is held and released from its top.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the stand-in browser -------------------------------------------------------------------------------------------
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.parent = null; this.style = {}; this.attrs = {}; this.listeners = {}; this.className = ''; this.textContent = ''; this.id = ''; }
  get firstChild() { return this.children[0] || null; }
  get lastChild() { return this.children[this.children.length - 1] || null; }
  get isConnected() { let n = this; while (n.parent) n = n.parent; return n === document.body || n === document.head; }
  append(...cs) { for (const c of cs) { c.remove(); c.parent = this; this.children.push(c); } }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((x) => x !== this); this.parent = null; } }
  set innerHTML(h) {
    this.children = [];
    for (const m of h.matchAll(/<(\w+)(?:\s+class="([^"]*)")?>([^<]*)<\/\1>/g)) { const c = new El(m[1]); c.className = m[2] || ''; c.textContent = m[3]; this.append(c); }
  }
  querySelector(sel) {
    const cls = sel.slice(1);
    const walk = (n) => { for (const c of n.children) { if (c.className.split(/\s+/).includes(cls)) return c; const r = walk(c); if (r) return r; } return null; };
    return walk(this);
  }
  setAttribute(k, v) { this.attrs[k] = v; }
  addEventListener(type, fn, opts) { (this.listeners[type] ||= []).push({ fn, once: !!opts?.once }); }
  removeEventListener(type, fn) { this.listeners[type] = (this.listeners[type] || []).filter((l) => l.fn !== fn); }
  dispatch(type) {
    for (const l of [...(this.listeners[type] || [])]) { if (l.once) this.removeEventListener(type, l.fn); l.fn({ type, preventDefault() {} }); }
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
}
const winListeners = new Map(); // type → Set of handlers (the page's capture listeners)
globalThis.addEventListener = (type, fn) => { if (!winListeners.has(type)) winListeners.set(type, new Set()); winListeners.get(type).add(fn); };
globalThis.removeEventListener = (type, fn) => { winListeners.get(type)?.delete(fn); };
const keyListeners = () => winListeners.get('keydown')?.size || 0;
const pressKey = () => { for (const fn of [...(winListeners.get('keydown') || [])]) fn({ type: 'keydown' }); };
globalThis.document = {
  head: new El('head'), body: new El('body'),
  createElement: (tag) => new El(tag),
  getElementById: (id) => document.head.children.find((c) => c.id === id) || null,
};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
globalThis.innerWidth = 1600; globalThis.innerHeight = 900;
globalThis.requestAnimationFrame = (fn) => setTimeout(() => fn(), 16);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.Image = class { set src(u) { this._src = u; setTimeout(() => this.onload?.(), 0); } get src() { return this._src; } };
globalThis.fetch = async (url) => {
  const name = String(url).split('?')[0].split('/').pop();
  try { const body = readFileSync(path.join(ROOT, 'data', name), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(body) }; } catch { return { ok: false, status: 404, json: async () => ({}) }; }
};
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const { playEntryFilm, holdBgm } = await import('../../public/js/ui/entryFilm.js');
const { store, selectRoute } = await import('../../public/js/store.js');
const { audio } = await import('../../public/js/audio.js');

const overlay = () => document.body.children.find((c) => c.className === 'spa-entry') || null;
/** A stand-in scene: counts its frames, knows whether it was taken down. */
function sceneSpy() {
  const spy = { mounted: 0, frames: 0, destroyed: 0 };
  spy.mount = () => { spy.mounted++; return { render: () => { spy.frames++; }, grain() {}, destroy: () => { spy.destroyed++; } }; };
  return spy;
}
/** A running Web Audio stand-in: every buffer source it makes, and what became of it. */
function runningContext() {
  const sources = [];
  const ctx = {
    state: 'running', currentTime: 0,
    createBufferSource: () => { const s = { started: null, stopped: null, connect() {}, start(t) { s.started = t; }, stop(t) { s.stopped = t; } }; sources.push(s); return s; },
    createGain: () => { const g = { gain: { value: 1, setTargetAtTime() {} }, connected: true, connect() {}, disconnect() { g.connected = false; } }; return g; },
  };
  return { ctx, sources };
}
const enterRoom = () => store.set((s) => ({ session: { ...s.session, entered: true }, room: { id: 'r1', players: [] } }));
const enterMatch = () => store.set((s) => ({ session: { ...s.session, entered: true }, room: { id: 'r1', inMatch: true, players: [] } }));
const PROTO = Object.getPrototypeOf(audio);
const realPlayBgm = PROTO.playBgm;

beforeEach(() => {
  store.reset();
  document.body.children = [];
  delete audio.playBgm;
  PROTO.playBgm = realPlayBgm;
  Object.assign(audio, { ctx: null, lobbyTrack: null, lastBgmKey: 'lobby', volumes: { ...(audio.volumes || {}), muted: false } });
});

test('a session restored into a room while the 点击进入 card waits takes the overlay down; a later tap plays nothing', async () => {
  const keysBefore = keyListeners();
  const spy = sceneSpy();
  await playEntryFilm({ mount: spy.mount });
  const el = overlay();
  assert.ok(el && el.open, 'the card is up on the title screen');
  assert.ok(el.querySelector('.spa-entry__gate'), 'with the 点击进入 card (sound is still locked)');
  assert.equal(keyListeners(), keysBefore + 1, 'the card listens for a key');

  enterRoom();
  assert.equal(selectRoute(store.get()), 'room');
  assert.equal(overlay(), null, 'the overlay is gone at once');
  assert.equal(el.open, false);
  assert.equal(keyListeners(), keysBefore, 'and nothing listens for keys any more');

  // the tap (or key) meant for the card now reaches nothing: no film over the room
  el.dispatch('pointerdown');
  pressKey();
  await sleep(800);
  assert.equal(spy.mounted, 0, 'the film never starts');
  assert.equal(overlay(), null);
});

test('a session restored into a match while the film runs takes it down at once, stops the cue, hands the music back', async () => {
  const { ctx, sources } = runningContext();
  Object.assign(audio, { ctx, sfxGain: {}, _buffer: async () => ({ duration: 1 }), _fadeOutBgm() {} });
  const played = [];
  PROTO.playBgm = function (key) { played.push(key); };
  const spy = sceneSpy();
  const keysBefore = keyListeners();
  await playEntryFilm({ mount: spy.mount });
  const el = overlay();
  assert.ok(el, 'sound is unlocked: the film starts without the card');
  assert.equal(el.querySelector('.spa-entry__gate'), null);
  for (let i = 0; i < 100 && !spy.frames; i++) await sleep(20);
  assert.equal(spy.mounted, 1, 'the film runs');
  assert.ok(spy.frames > 0);
  const cue = sources[0];
  assert.ok(cue && cue.started != null, 'the entry cue is scheduled');
  assert.ok(Object.prototype.hasOwnProperty.call(audio, 'playBgm'), 'the screen\'s music is held');
  audio.playBgm('battle'); // the match screen asks for its music (audio.js follows the route)
  assert.deepEqual(played, [], 'held while the film runs');

  enterMatch();
  assert.equal(selectRoute(store.get()), 'game');
  assert.equal(overlay(), null, 'the overlay is gone at once (no fade over the match)');
  assert.equal(spy.destroyed, 1, 'the scene is taken down');
  assert.equal(cue.stopped, 0, 'the entry cue stops now');
  assert.equal(keyListeners(), keysBefore, 'no key skips anything any more');
  assert.equal(Object.prototype.hasOwnProperty.call(audio, 'playBgm'), false, 'playBgm is audio.js\'s own again');
  assert.deepEqual(played, ['battle'], 'the match\'s music plays');
  const frames = spy.frames;
  await sleep(2600); // past the film's lobby-music moment and its end
  assert.equal(spy.frames, frames, 'no frame after the leave');
  assert.deepEqual(played, ['battle'], 'and no lobby music restarted by the film');
});

test('holdBgm leaves the player\'s own lobby music alone: no fade, playBgm untouched', () => {
  let fades = 0;
  const a = { ctx: {}, bgmSilent: false, bgmToken: 0, lastBgmKey: 'lobby', lobbyTrack: { id: 'mine', read: async () => new ArrayBuffer(0) }, _fadeOutBgm() { fades++; }, playBgm() {} };
  const own = a.playBgm;
  assert.equal(holdBgm(a), null);
  assert.equal(fades, 0, 'nothing fades');
  assert.equal(a.bgmToken, 0, 'no start is cancelled');
  assert.equal(a.playBgm, own, 'playBgm is not replaced');
});

test('holdBgm without the player\'s own music holds the screen\'s and releases it from its top', () => {
  let fades = 0;
  const played = [];
  const proto = { playBgm(key) { played.push(key); } };
  const a = Object.assign(Object.create(proto), { ctx: {}, bgmSilent: false, bgmToken: 0, lastBgmKey: 'lobby', lobbyTrack: null, _fadeOutBgm() { fades++; } });
  const release = holdBgm(a);
  assert.equal(typeof release, 'function');
  assert.equal(fades, 1, 'the playing track fades out');
  a.playBgm('lobby');
  assert.deepEqual(played, [], 'a request meanwhile is only remembered');
  release();
  assert.deepEqual(played, ['lobby'], 'the release starts it');
  assert.equal(Object.prototype.hasOwnProperty.call(a, 'playBgm'), false);
  release();
  assert.deepEqual(played, ['lobby'], 'once');
  // silent music: nothing to hold
  assert.equal(holdBgm(Object.assign(Object.create(proto), { ctx: {}, bgmSilent: true, lobbyTrack: null })), null);
});
