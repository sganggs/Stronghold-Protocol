// Multi-device support and UI-polish units (no browser): ui/device.js (feature detection, <html> classes, zoom-gesture
// blocking, long-press = detail, fullscreen), ui/compat.js polyfills, the HUD 🔍 buttons (hud.js checkButtons), the
// enemy preview pen helpers (gameLogic penPlacement / previewEnemyKey), the connection-banner class, the audio unlock on
// iOS-like contexts, and the title's lone-surrogate scan (no regex lookbehind: a SyntaxError in Safari < 16.4).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { installCompat } from '../../public/js/ui/compat.js';
import { detectFeatures, featureClasses, fullscreen, installDeviceSupport, LONG_PRESS_MS, screenLandscape } from '../../public/js/ui/device.js';
import { checkButtons } from '../../public/js/ui/hud.js';
import { penPlacement, penZoneTiles, previewEnemyKey, PEN } from '../../public/js/ui/gameLogic.js';
import { bannerVisible } from '../../public/js/ui/connBanner.js';
import { layoutPen } from '../../public/js/render/pen.js';
import { stripLoneSurrogates, sanitizeName } from '../../public/js/screens/title.js';
import { AudioManager } from '../../public/js/audio.js';

// ---- fakes -----------------------------------------------------------------------------------------------------------

class FakeEvent {
  constructor(type, init = {}) { Object.assign(this, { cancelable: true, isTrusted: true, ...init }); this.type = type; this.defaultPrevented = false; this.stopped = false; }
  preventDefault() { if (this.cancelable) this.defaultPrevented = true; }
  stopPropagation() { this.stopped = true; }
}
function emitter() {
  const map = new Map();
  return {
    addEventListener(t, fn) { if (!map.has(t)) map.set(t, new Set()); map.get(t).add(fn); },
    removeEventListener(t, fn) { map.get(t)?.delete(fn); },
    dispatch(ev) { for (const fn of [...(map.get(ev.type) || [])]) fn(ev); return ev; },
    count(t) { return map.get(t)?.size || 0; },
  };
}
class FakeElement {
  /** `handles`: a contextmenu handler on the element (or an ancestor) takes the event (preventDefault). */
  constructor(tag = 'div', { closest = () => null, handles = false } = {}) { this.tagName = tag.toUpperCase(); this.isConnected = true; this._closest = closest; this._handles = handles; this.dispatched = []; }
  closest(sel) { return this._closest(sel); }
  dispatchEvent(ev) { this.dispatched.push(ev); if (this._handles && ev.type === 'contextmenu') ev.preventDefault(); return !ev.defaultPrevented; }
}
function fakeWindow({ media = {}, touchPoints = 0, fs = true } = {}) {
  const classes = new Set();
  const props = new Map();
  const doc = emitter();
  const el = { classList: { toggle: (k, on) => (on ? classes.add(k) : classes.delete(k)), add: (k) => classes.add(k), remove: (k) => classes.delete(k), contains: (k) => classes.has(k) },
    style: { setProperty: (k, v) => props.set(k, v) }, requestFullscreen: fs ? async () => { doc.fullscreenElement = el; } : undefined };
  Object.assign(doc, { documentElement: el, fullscreenEnabled: fs, fullscreenElement: null, exitFullscreen: async () => { doc.fullscreenElement = null; } });
  const win = emitter();
  Object.assign(win, {
    document: doc, navigator: { maxTouchPoints: touchPoints }, innerHeight: 390,
    matchMedia: (q) => ({ matches: !!media[q], addEventListener() {}, removeEventListener() {} }),
    Element: FakeElement, MouseEvent: FakeEvent, Event: FakeEvent, screen: {},
  });
  return { win, doc, classes, props };
}

// ---- compat ------------------------------------------------------------------------------------------------------------

describe('ui/compat.js polyfills (Safari 15.0–15.3 / Firefox ESR)', () => {
  test('installs only what is missing, with standard behaviour', () => {
    // a global whose builtins lack the newer methods (bare prototypes; the polyfills are generic, called with real values)
    const g = { Object: { ...Object, hasOwn: undefined }, Array: function FakeArray() {}, String: function FakeString() {} };
    g.Array.prototype = {};
    g.String.prototype = {};
    const added = installCompat(g);
    for (const k of ['hasOwn', 'at', 'findLast', 'findLastIndex', 'structuredClone']) assert.ok(added.includes(k), `${k} installed`);
    assert.equal(g.Object.hasOwn({ a: 1 }, 'a'), true);
    assert.equal(g.Object.hasOwn(Object.create({ a: 1 }), 'a'), false, 'own properties only');
    assert.throws(() => g.Object.hasOwn(null, 'a'), TypeError);
    const at = g.Array.prototype.at;
    assert.equal(at.call([1, 2, 3], -1), 3);
    assert.equal(at.call([1, 2, 3], 5), undefined);
    assert.equal(g.String.prototype.at.call('abc', -1), 'c');
    assert.equal(g.Array.prototype.findLast.call([1, 2, 3, 4], (x) => x % 2), 3);
    assert.equal(g.Array.prototype.findLastIndex.call([1, 2, 3], (x) => x > 5), -1);
    const src = { a: [1, { b: 2 }], m: new Map([['k', new Set([1])]]), d: new Date(5) };
    src.self = src;
    const c = g.structuredClone(src);
    assert.notEqual(c, src);
    assert.deepEqual(c.a, [1, { b: 2 }]);
    assert.ok(c.m.get('k').has(1) && c.m !== src.m);
    assert.equal(c.d.getTime(), 5);
    assert.equal(c.self, c, 'cycles preserved');
    assert.throws(() => g.structuredClone({ f() {} }), TypeError);
  });
  test('a modern runtime keeps its own implementations', () => {
    assert.deepEqual(installCompat({ Object, Array, String, Int8Array, structuredClone, queueMicrotask }), []);
  });
});

// ---- device.js ---------------------------------------------------------------------------------------------------------

describe('ui/device.js feature detection', () => {
  test('touch / coarse / hover / fullscreen / reduced motion from media queries and APIs (no UA sniffing)', () => {
    const phone = detectFeatures(fakeWindow({ media: { '(any-pointer: coarse)': true, '(prefers-reduced-motion: reduce)': true }, touchPoints: 5 }).win);
    assert.equal(phone.touch, true);
    assert.equal(phone.coarse, true);
    assert.equal(phone.hover, false);
    assert.equal(phone.reducedMotion, true);
    assert.equal(phone.fullscreen, true);
    const desk = detectFeatures(fakeWindow({ media: { '(any-hover: hover)': true, '(any-pointer: fine)': true }, fs: false }).win);
    assert.deepEqual({ touch: desk.touch, coarse: desk.coarse, hover: desk.hover, fullscreen: desk.fullscreen }, { touch: false, coarse: false, hover: true, fullscreen: false });
    assert.deepEqual(featureClasses(phone), {
      'sp-touch': true, 'sp-coarse': true, 'sp-hover': false, 'sp-no-hover': true, 'sp-fs': true, 'sp-standalone': false, 'sp-reduced-motion': true,
      'sp-rotatable': true,
    });
  });
  test('review regression: the rotate hint is for devices that can turn — not a narrow desktop window, not split view', () => {
    const w = (media, screen, orientation) => { const f = fakeWindow({ media, touchPoints: media['(any-pointer: coarse)'] ? 5 : 0 }).win; f.screen = screen; if (orientation !== undefined) f.orientation = orientation; return f; };
    const coarse = { '(any-pointer: coarse)': true };
    const fine = { '(any-pointer: fine)': true, '(any-hover: hover)': true };
    assert.equal(screenLandscape(w(coarse, { orientation: { type: 'landscape-primary' } })), true);
    assert.equal(screenLandscape(w(coarse, {}, 0)), false, 'old iOS: window.orientation');
    assert.equal(screenLandscape(w(coarse, {}, -90)), true);
    assert.equal(screenLandscape(w(coarse, { width: 390, height: 844 })), null, 'no size guess (iOS reports portrait sizes)');
    const cls = (win) => featureClasses(detectFeatures(win))['sp-rotatable'];
    assert.equal(cls(w(coarse, { orientation: { type: 'portrait-primary' } })), true, 'a phone held upright');
    assert.equal(cls(w(coarse, {}, undefined)), true, 'unknown screen orientation on a touch device: the hint may show');
    assert.equal(cls(w(coarse, { orientation: { type: 'landscape-primary' } })), false, 'split-view iPad: the screen is landscape');
    assert.equal(cls(w(fine, { orientation: { type: 'portrait-primary' } })), false, 'a desktop window (even on a portrait monitor)');
  });
  test('fullscreen: standard API, and unsupported (iPhone Safari) → false', async () => {
    const f = fakeWindow();
    assert.equal(fullscreen.active(f.win), false);
    assert.equal(await fullscreen.enter(f.win), true);
    assert.equal(fullscreen.active(f.win), true);
    await fullscreen.toggle(f.win);
    assert.equal(fullscreen.active(f.win), false);
    const none = fakeWindow({ fs: false });
    assert.equal(fullscreen.supported(none.win), false);
    assert.equal(await fullscreen.enter(none.win), false);
  });
});

describe('ui/device.js installDeviceSupport', () => {
  test('classes, --sp-vh, zoom gestures cancelled, long press → contextmenu (once), click after it swallowed', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const f = fakeWindow({ media: { '(any-pointer: coarse)': true }, touchPoints: 5 });
    const dispose = installDeviceSupport(f.win);
    try {
      assert.ok(f.classes.has('sp-touch') && f.classes.has('sp-coarse'));
      assert.equal(f.props.get('--sp-vh'), '3.9px');
      // iOS pinch zoom and ctrl+wheel (trackpad pinch) are cancelled
      assert.equal(f.doc.dispatch(new FakeEvent('gesturestart')).defaultPrevented, true);
      assert.equal(f.doc.dispatch(new FakeEvent('wheel', { ctrlKey: true })).defaultPrevented, true);
      assert.equal(f.doc.dispatch(new FakeEvent('wheel', { ctrlKey: false })).defaultPrevented, false, 'plain scrolling untouched');
      // long press on a DOM control (iOS never sends contextmenu): a synthetic one after LONG_PRESS_MS
      const card = new FakeElement('button', { handles: true });
      f.doc.dispatch(new FakeEvent('pointerdown', { pointerType: 'touch', target: card, clientX: 10, clientY: 10 }));
      t.mock.timers.tick(LONG_PRESS_MS - 1);
      assert.equal(card.dispatched.length, 0);
      t.mock.timers.tick(2);
      assert.equal(card.dispatched.length, 1);
      assert.equal(card.dispatched[0].type, 'contextmenu');
      f.doc.dispatch(new FakeEvent('pointerup', { pointerType: 'touch' }));
      const click = f.doc.dispatch(new FakeEvent('click'));
      assert.equal(click.defaultPrevented && click.stopped, true, 'the release after a handled long press is not a tap');
      assert.equal(f.doc.dispatch(new FakeEvent('click')).stopped, false, 'only that one click');
      // review regression: a slow tap (held ≥ LONG_PRESS_MS) on a control nobody long-presses (准备就绪, 撤退, 出售 …)
      // is still a tap — iOS sends its click and it must not be swallowed
      const ready = new FakeElement('button');
      f.doc.dispatch(new FakeEvent('pointerdown', { pointerType: 'touch', target: ready, clientX: 5, clientY: 5 }));
      t.mock.timers.tick(LONG_PRESS_MS + 200);
      assert.equal(ready.dispatched.length, 1, 'the synthetic contextmenu is still offered');
      f.doc.dispatch(new FakeEvent('pointerup', { pointerType: 'touch' }));
      const slow = f.doc.dispatch(new FakeEvent('click'));
      assert.equal(slow.defaultPrevented || slow.stopped, false, 'an unhandled long press keeps its click');
      // Android sends its own contextmenu: no synthetic duplicate
      const c2 = new FakeElement('button');
      f.doc.dispatch(new FakeEvent('pointerdown', { pointerType: 'touch', target: c2, clientX: 0, clientY: 0 }));
      f.doc.dispatch(new FakeEvent('contextmenu', { isTrusted: true }));
      t.mock.timers.tick(LONG_PRESS_MS + 10);
      assert.equal(c2.dispatched.length, 0);
      // moving cancels; a mouse press never counts; the field canvas has its own long press
      const c3 = new FakeElement('button');
      f.doc.dispatch(new FakeEvent('pointerdown', { pointerType: 'touch', target: c3, clientX: 0, clientY: 0 }));
      f.doc.dispatch(new FakeEvent('pointermove', { clientX: 30, clientY: 0 }));
      t.mock.timers.tick(LONG_PRESS_MS + 10);
      assert.equal(c3.dispatched.length, 0, 'a drag is not a long press');
      f.doc.dispatch(new FakeEvent('pointerdown', { pointerType: 'mouse', target: c3, clientX: 0, clientY: 0 }));
      t.mock.timers.tick(LONG_PRESS_MS + 10);
      assert.equal(c3.dispatched.length, 0);
      const canvas = new FakeElement('canvas', { closest: (sel) => (sel.includes('canvas') ? {} : null) });
      f.doc.dispatch(new FakeEvent('pointerdown', { pointerType: 'touch', target: canvas, clientX: 0, clientY: 0 }));
      t.mock.timers.tick(LONG_PRESS_MS + 10);
      assert.equal(canvas.dispatched.length, 0);
    } finally {
      dispose();
    }
    assert.equal(f.doc.count('gesturestart'), 0, 'dispose removes the listeners');
  });
});

// ---- HUD 🔍 buttons (research 09 §2.1 / §6.2 item 3) ------------------------------------------------------------------

describe('hud.js checkButtons', () => {
  test('prep: mint 🔍 (本局信息) + amber 🔍▶▶; pen: 🔍◀◀ + grey 🔍; outside prep: grey 🔍', () => {
    assert.deepEqual(checkButtons({ pen: false, penAvail: true, infoOpen: false }), {
      left: { sprite: 'btn_check_player_normal', back: false, label: '本局信息', tip: '本局信息（策略 / 禁用盟约 / 干员）' },
      right: { sprite: 'btn_check_enemy', grey: false, label: '敌方情报', tip: '查看即将迎击的敌方单位' },
    });
    const pen = checkButtons({ pen: true, penAvail: true, infoOpen: false });
    assert.equal(pen.left.sprite, 'btn_check_player_back');
    assert.equal(pen.left.back, true);
    assert.equal(pen.right.sprite, 'btn_check_enemy_unfold');
    assert.equal(pen.right.grey, true);
    assert.equal(checkButtons({ pen: false, penAvail: false, infoOpen: false }).right.grey, true);
    assert.equal(checkButtons({ pen: false, penAvail: true, infoOpen: true }).left.sprite, 'btn_check_player_unfold');
  });
});

// ---- enemy preview pen -------------------------------------------------------------------------------------------------

describe('gameLogic pen helpers (research 08 §4.2 / 09 §2.2)', () => {
  test('zones: 13 tiles each, rows 14–15 (lower gate) / 17–18 (upper), never row 16, anchors excluded', () => {
    const lo = penZoneTiles('lower');
    const up = penZoneTiles('upper');
    assert.equal(lo.length, 13);
    assert.equal(up.length, 13);
    assert.ok(lo.every(([r]) => r === 14 || r === 15));
    assert.ok(up.every(([r]) => r === 17 || r === 18));
    assert.ok(![...lo, ...up].some(([r, c]) => (r === 15 && c === 7) || (r === 18 && c === 7)), 'the pen gates are not stands');
    assert.deepEqual(lo[0], [14, 7], 'row-major, low row first, from the gate column');
  });
  test('one model per enemy in spawn order, by gate; > 50 thinned (elites always kept), ≤ 50 in all', () => {
    const few = penPlacement([
      { enemyKey: 'b', count: 2, gate: 'upper', t: 8 }, { enemyKey: 'a', count: 3, gate: 'lower', t: 2 }, { enemyKey: 'e', count: 1, gate: 'lower', t: 9, elite: true },
    ]);
    assert.equal(few.length, 6);
    assert.deepEqual(few.map((m) => m.enemyKey), ['a', 'a', 'a', 'b', 'b', 'e'], 'spawn-time order');
    assert.ok(few.filter((m) => m.enemyKey === 'b').every((m) => m.row >= 17), 'upper-gate enemies in rows 17–18');
    assert.ok(few.filter((m) => m.enemyKey !== 'b').every((m) => m.row <= 15), 'lower-gate enemies in rows 14–15');
    assert.ok(few.every((m) => m.col >= PEN.c0 && m.col <= PEN.c1 && m.row !== PEN.emptyRow));
    const many = penPlacement([{ enemyKey: 'x', count: 90, gate: 'lower', t: 0 }, { enemyKey: 'y', count: 30, gate: 'upper', t: 1 }, { enemyKey: 'z', count: 3, gate: 'upper', t: 5, elite: true }]);
    assert.ok(many.length <= 50, `capped (${many.length})`);
    assert.equal(many.filter((m) => m.enemyKey === 'z').length, 3, 'elites never thinned');
    assert.ok(many.filter((m) => m.enemyKey === 'x').length > many.filter((m) => m.enemyKey === 'y').length, 'proportional');
    const slots = new Map();
    for (const m of many) { const k = `${m.row},${m.col}`; assert.equal(m.slot, slots.get(k) || 0); slots.set(k, (slots.get(k) || 0) + 1); }
    assert.deepEqual(penPlacement(null), []);
    assert.deepEqual(penPlacement([{ nope: 1 }]), []);
    assert.deepEqual(penPlacement(few.map(() => null)), []);
    assert.deepEqual(penPlacement([{ enemyKey: 'a', count: 3, gate: 'lower', t: 2 }]), penPlacement([{ enemyKey: 'a', count: 3, gate: 'lower', t: 2 }]), 'deterministic');
  });
  test('review regression: the DOM fallback lays the pen out exactly like the render engine (render/pen.js)', () => {
    const list = [
      { enemyKey: 'x', count: 40, gate: 'lower', t: 0 }, { enemyKey: 'y', count: 25, gate: 'upper', t: 3 },
      { enemyKey: 'e', count: 2, gate: 'upper', t: 9, elite: true }, { enemyKey: 'f', count: 6, gate: 'lower', t: 12, fly: true },
    ];
    const dom = penPlacement(list);
    const eng = layoutPen(list).figures;
    assert.deepEqual(dom.map((m) => [m.enemyKey, m.row, m.col]), eng.map((f) => [f.enemyKey, f.row, f.col]));
    const load = new Map();
    for (const m of dom) load.set(`${m.row},${m.col}`, (load.get(`${m.row},${m.col}`) || 0) + 1);
    assert.ok([...load.values()].every((n) => n <= 3), 'at most 3 per tile while the zone has room');
    // a small zone stays by its gate: the k-th model of a zone, not of the whole preview
    const small = penPlacement([{ enemyKey: 'a', count: 20, gate: 'lower', t: 0 }, { enemyKey: 'b', count: 2, gate: 'upper', t: 30 }]);
    assert.ok(small.filter((m) => m.enemyKey === 'b').every((m) => m.row === 17 && m.col <= 8), JSON.stringify(small.filter((m) => m.enemyKey === 'b')));
  });
  test('previewEnemyKey: the engine / fallback pen tap payloads, never a live battle unit', () => {
    assert.equal(previewEnemyKey({ enemyKey: 'enemy_1007_slime', preview: true }), 'enemy_1007_slime');
    assert.equal(previewEnemyKey({ preview: true, unit: { side: 'enemy', defId: 'enemy_x' } }), 'enemy_x');
    assert.equal(previewEnemyKey({ unit: { side: 'enemy', defId: 'enemy_x', preview: true, enemyKey: 'enemy_y' } }), 'enemy_y');
    assert.equal(previewEnemyKey({ unitId: 3, unit: { side: 'enemy', defId: 'enemy_x' } }), null, 'battle enemies are units');
    assert.equal(previewEnemyKey({ preview: true, unit: { side: 'ally', defId: 'char_x' } }), null);
    assert.equal(previewEnemyKey(null), null);
    assert.equal(previewEnemyKey({ uid: 5 }), null);
  });
});

// ---- misc --------------------------------------------------------------------------------------------------------------

describe('connection banner class (replaces CSS :has())', () => {
  test('bannerVisible mirrors the banner', () => {
    assert.equal(bannerVisible({ status: 'online' }, true, false), false);
    assert.equal(bannerVisible({ status: 'online' }, true, true), true, 'syncing after a resume');
    assert.equal(bannerVisible({ status: 'online' }, true, false, true), true, 'a stale build during a match');
    assert.equal(bannerVisible({ status: 'reconnecting', everOnline: true }, true, false, true), true);
    assert.equal(bannerVisible({ status: 'connecting', everOnline: false }, true, false), false, 'first connect is silent');
    assert.equal(bannerVisible({ status: 'closed' }, false, false), false, 'not before the title');
  });
});

describe('title: lone surrogates without a lookbehind regex', () => {
  test('pairs kept, lone halves dropped', () => {
    assert.equal(stripLoneSurrogates('a\ud800b\udc00c😀d\ud83d'), 'abc😀d');
    assert.equal(sanitizeName(' 凯\udc00尔希 '), '凯尔希');
  });
});

describe('audio unlock on iOS-like contexts', () => {
  test('a context that starts suspended keeps the gesture listeners until it runs; a silent buffer primes the output', async () => {
    const listeners = new Map();
    const made = { primed: 0, resumed: 0 };
    class Node { connect() {} disconnect() {} }
    class Param { setTargetAtTime() {} setValueAtTime() {} linearRampToValueAtTime() {} cancelScheduledValues() {} }
    class Ctx {
      constructor() { this.state = 'suspended'; this.currentTime = 0; this.destination = new Node(); this.sampleRate = 44100; }
      createGain() { const n = new Node(); n.gain = new Param(); return n; }
      createBuffer() { return {}; }
      createBufferSource() { const n = new Node(); n.start = () => { made.primed++; }; return n; }
      resume() { made.resumed++; if (made.resumed >= 2) this.state = 'running'; return Promise.resolve(); }
      suspend() { return Promise.resolve(); }
    }
    const win = {
      AudioContext: Ctx, document: { hidden: false, addEventListener() {} },
      addEventListener(t, fn) { listeners.set(t, fn); }, removeEventListener(t) { listeners.delete(t); },
    };
    const a = new AudioManager({ win, getManifest: () => null });
    a.install();
    listeners.get('pointerdown')();          // iOS: not an activation — the context stays suspended
    await Promise.resolve();
    assert.equal(a.unlocked, true);
    assert.ok(listeners.has('touchend'), 'still listening while suspended');
    listeners.get('touchend')();             // the finger lifts: resume() succeeds
    await Promise.resolve(); await Promise.resolve();
    assert.equal(a.ctx.state, 'running');
    assert.ok(!listeners.has('touchend') && !listeners.has('pointerdown'), 'listeners dropped once running');
    assert.ok(made.primed >= 1, 'a silent buffer was started inside a gesture');
  });

  test('review regression: an interruption (iOS call / Siri) re-arms the gesture unlock; back on the page resumes', async () => {
    const listeners = new Map();
    const docListeners = new Map();
    let refuse = false;
    class Node { connect() {} disconnect() {} }
    class Param { setTargetAtTime() {} setValueAtTime() {} linearRampToValueAtTime() {} cancelScheduledValues() {} }
    class Ctx {
      constructor() { this.state = 'running'; this.currentTime = 0; this.destination = new Node(); this.sampleRate = 44100; this.ls = new Map(); }
      addEventListener(t, fn) { this.ls.set(t, fn); }
      set(state) { this.state = state; this.ls.get('statechange')?.(); }
      createGain() { const n = new Node(); n.gain = new Param(); return n; }
      createBuffer() { return {}; }
      createBufferSource() { const n = new Node(); n.start = () => {}; return n; }
      resume() { if (!refuse) this.state = 'running'; return Promise.resolve(); }
      suspend() { this.set('suspended'); return Promise.resolve(); }
    }
    const doc = { hidden: false, addEventListener(t, fn) { docListeners.set(t, fn); } };
    const win = {
      AudioContext: Ctx, document: doc,
      addEventListener(t, fn) { listeners.set(t, fn); }, removeEventListener(t) { listeners.delete(t); },
    };
    const a = new AudioManager({ win, getManifest: () => null });
    a.install();
    listeners.get('touchend')();
    await Promise.resolve();
    assert.equal(a.ctx.state, 'running');
    assert.ok(!listeners.has('touchend'), 'dropped once running');
    // a phone call: the system interrupts the running context while the page stays visible
    refuse = true;
    a.ctx.set('interrupted');
    assert.ok(listeners.has('touchend') && listeners.has('click'), 'the next gesture may resume it');
    refuse = false;
    listeners.get('touchend')();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(a.ctx.state, 'running');
    assert.ok(!listeners.has('touchend'), 'dropped again once running');
    // tab hidden → suspended by us (no re-arm while hidden); visible again → resumed without a gesture where allowed
    doc.hidden = true;
    docListeners.get('visibilitychange')();
    await Promise.resolve();
    assert.equal(a.ctx.state, 'suspended');
    assert.ok(!listeners.has('touchend'), 'nothing armed while hidden');
    doc.hidden = false;
    refuse = true;
    docListeners.get('visibilitychange')();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(a.ctx.state, 'suspended', 'the browser wants a gesture first');
    assert.ok(listeners.has('touchend'), 'so a gesture is armed');
    refuse = false;
    listeners.get('click')();
    await Promise.resolve(); await Promise.resolve();
    assert.equal(a.ctx.state, 'running');
    assert.ok(!listeners.has('click'));
  });
});

describe('room: copy the invite without navigator.clipboard (LAN over http, iOS)', () => {
  test('review regression: the textarea fallback sets an explicit selection range (iOS ignores select())', async () => {
    const { copyText } = await import('../../public/js/screens/room.js');
    const calls = [];
    const ta = {
      style: {}, value: '',
      setAttribute(k) { calls.push(['attr', k]); },
      focus() { document.activeElement = ta; },
      select() { calls.push(['select']); },
      setSelectionRange(a, b) { this.selectionStart = a; this.selectionEnd = b; calls.push(['range', a, b]); },
      remove() { calls.push(['remove']); },
    };
    const saved = { document: globalThis.document, secure: globalThis.isSecureContext, nav: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
    globalThis.document = { createElement: () => ta, body: { appendChild: () => calls.push(['append']) }, execCommand: (c) => { calls.push(['exec', c]); return true; } };
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
    globalThis.isSecureContext = false;
    try {
      assert.equal(await copyText('http://192.168.1.5:8080/?room=ABCD'), true);
      assert.deepEqual(calls.find((c) => c[0] === 'range'), ['range', 0, 'http://192.168.1.5:8080/?room=ABCD'.length]);
      assert.ok(calls.findIndex((c) => c[0] === 'range') < calls.findIndex((c) => c[0] === 'exec'), 'selected before copying');
      assert.ok(calls.some((c) => c[0] === 'remove'));
    } finally {
      if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
      if (saved.nav) Object.defineProperty(globalThis, 'navigator', saved.nav);
      if (saved.secure === undefined) delete globalThis.isSecureContext; else globalThis.isSecureContext = saved.secure;
    }
  });
});
