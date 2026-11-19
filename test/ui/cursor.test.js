import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data } from '../../public/js/data.js';
import { applyCursor } from '../../public/js/ui/cursor.js';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../public/js/ui/gameLogic/settings.js';

const META = { path: 'https://assets.example/assets/local/ui/cursor/prts_hand.png', hash: 'a'.repeat(12),
  extractVersion: 2, frameWidth: 151, frameHeight: 172, frames: 11, hotspot: [20, 21],
  referenceWidth: 1280, defaultScale: 0.44, pressMs: 1000 / 15, releaseMs: 1000 / 6 };
const manifest = meta => ({ groups: { 'ui/cursor': { prts_hand: meta } } });

// A deterministic DOM/Canvas boundary: tests observe rendered poses, actual hit targets,
// native cursor ownership, listener cleanup and asynchronous image publication.
function fixture(t) {
  const keys = ['document', 'Image', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame'];
  const descriptors = Object.fromEntries(keys.map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const oldData = { get: data.get, load: data.load };
  const state = { now: 0, manifest: null, reduced: false, failContext: false,
    blockedDecode: false, decodes: [], images: [], canvases: [], writes: [], callbacks: new Map(), loads: 0 };
  const props = new Map(); let serial = 0;
  function style(root = false) {
    return { setProperty(k, v) { if (root) { props.set(k, v); state.writes.push([k, v]); } },
      removeProperty(k) { if (root) { props.delete(k); state.writes.push([k, null]); } } };
  }
  class Element extends EventTarget {
    constructor(tagName = 'DIV') {
      super(); this.tagName = tagName; this.nodeType = 1; this.style = style();
      this.children = []; this.parentNode = null; this.isConnected = true;
      this.attributes = {}; this.dataset = {}; this.hidden = true; this.popoverOpen = false;
    }
    setAttribute(k, v) { this.attributes[k] = v; }
    appendChild(child) {
      child.remove(); this.children.push(child); child.parentNode = this; child.isConnected = true;
      return child;
    }
    remove() {
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(e => e !== this);
      this.parentNode = null; this.isConnected = false;
    }
    matches(selector) { return selector === ':popover-open' && this.popoverOpen; }
    showPopover() { this.popoverOpen = true; }
    hidePopover() { this.popoverOpen = false; }
    getContext() { return state.failContext ? null : this.context; }
  }
  const doc = new EventTarget(), win = new EventTarget();
  const root = new Element('HTML'); root.style = style(true);
  const normal = new Element(); root.appendChild(normal); state.target = normal;
  const media = [];
  Object.assign(win, { innerWidth: 1920, innerHeight: 1080, devicePixelRatio: 1,
    getComputedStyle: target => ({ cursor: target.cursor || props.get('--sp-cursor-default') || 'auto' }),
    matchMedia(query) {
      const m = new EventTarget(); m.matches = query.includes('prefers-reduced-motion') && state.reduced;
      m.query = query; media.push(m); return m;
    } });
  Object.assign(doc, { defaultView: win, documentElement: root, hidden: false,
    elementFromPoint: () => state.target,
    createElement(tag) {
      assert.equal(tag, 'canvas');
      const canvas = new Element('CANVAS'); canvas.draws = [];
      canvas.context = { clearRect() {}, drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh) {
        canvas.draws.push({ image, sx, sy, sw, sh, dx, dy, dw, dh });
      } };
      state.canvases.push(canvas); return canvas;
    } });
  class Image {
    naturalWidth = 151 * 11;
    naturalHeight = 172;
    constructor() { state.images.push(this); }
    decode() {
      if (!state.blockedDecode) return Promise.resolve();
      return new Promise((resolve, reject) => state.decodes.push({ resolve, reject }));
    }
  }
  for (const [key, value] of Object.entries({ document: doc, Image, performance: { now: () => state.now },
    requestAnimationFrame: cb => { state.callbacks.set(++serial, cb); return serial; },
    cancelAnimationFrame: id => state.callbacks.delete(id) })) {
    Object.defineProperty(globalThis, key, { value, writable: true, configurable: true });
  }
  data.get = name => name === 'local' ? state.manifest : null;
  data.load = () => { state.loads++; return Promise.resolve(state.manifest); };
  t.after(() => {
    applyCursor(false); data.get = oldData.get; data.load = oldData.load;
    for (const key of keys) {
      if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]);
      else delete globalThis[key];
    }
  });
  return Object.assign(state, { doc, win, root, normal, props, media, Element,
    notify() { data.setView('local', null); },
    load() { return state.images.at(-1).onload(); },
    step(time = state.now) {
      state.now = time;
      const queued = [...state.callbacks.values()]; state.callbacks.clear();
      for (const cb of queued) cb(time);
    },
    pointer(name, fields = {}) {
      const event = new Event(name, { cancelable: true });
      const target = fields.target || state.target;
      Object.assign(event, { pointerType: 'mouse', button: 0, buttons: name === 'pointerdown' ? 1 : 0,
        clientX: 100, clientY: 200, relatedTarget: state.normal, composedPath: () => [target, root, doc] });
      for (const [key, value] of Object.entries(fields)) Object.defineProperty(event, key, { value, configurable: true });
      doc.dispatchEvent(event); return event;
    },
  });
}

test('PRTS cursor requires an explicit persisted opt-in', () => {
  assert.equal(DEFAULT_SETTINGS.arknightsCursor, false);
  for (const v of [undefined, null, 'true', 1, {}, false]) {
    assert.equal(sanitizeSettings({ arknightsCursor: v }).arknightsCursor, false);
  }
  const saved = JSON.parse(JSON.stringify(sanitizeSettings({ arknightsCursor: true })));
  assert.equal(sanitizeSettings(saved).arknightsCursor, true);
});

test('late manifests, CDN assets and decode failures retain native fallback', async t => {
  const f = fixture(t);
  applyCursor(false); assert.equal(f.loads, 0);
  applyCursor(true); assert.equal(f.images.length, 0);
  applyCursor(false);
  f.manifest = manifest(META); f.notify();
  assert.equal(f.images.length, 0, 'a late manifest never re-enables an opted-out cursor');
  applyCursor(true);
  assert.equal(f.images[0].src, META.path);
  assert.equal(f.images[0].crossOrigin, 'anonymous');
  f.blockedDecode = true;
  const pending = f.load();
  f.pointer('pointermove'); f.step();
  assert.equal(f.props.size, 0); assert.equal(f.canvases.length, 0, 'loading never hides the native cursor');
  applyCursor(false);
  f.decodes[0].resolve(); await pending;
  assert.equal(f.root.children.length, 1, 'late decoding never mounts a canvas');
  assert.equal(f.props.size, 0);
  applyCursor(true);
  const broken = f.load(); f.decodes.at(-1).reject(new Error('bad PNG')); await broken;
  f.pointer('pointermove'); f.step(); assert.equal(f.props.size, 0);
  f.manifest = null; f.notify();
  data.load = () => Promise.reject(new Error('offline'));
  applyCursor(true); await Promise.resolve(); assert.equal(f.props.size, 0);
});

test('rapid clicks draw one canvas without native image replacement; DPR changes reuse the source', async t => {
  const f = fixture(t); f.manifest = manifest(META);
  applyCursor(true); await f.load(); f.pointer('pointermove'); f.step(0);
  const canvas = f.canvases[0];
  assert.equal(canvas.hidden, false);
  assert.deepEqual([canvas.width, canvas.height, canvas.style.width, canvas.style.height], [90, 102, '90px', '102px']);
  assert.match(canvas.style.cssText, /pointer-events:none/);
  assert.equal(canvas.attributes['aria-hidden'], 'true');
  assert.equal(canvas.attributes.inert, '');
  assert.equal(f.props.get('--sp-cursor-default'), f.props.get('--sp-cursor-pointer'));
  const writes = f.writes.length;
  f.pointer('pointerdown'); f.pointer('pointerup'); f.pointer('pointerdown');
  assert.equal(f.callbacks.size, 1);
  f.step(34); const halfway = canvas.dataset.pose;
  assert.notEqual(halfway, '0');
  const draws = canvas.draws.length;
  f.pointer('pointermove', { clientX: 120, clientY: 220, buttons: 1 }); f.step(34);
  assert.equal(canvas.draws.length, draws, 'movement of an unchanged pose only moves the canvas');
  assert.match(canvas.style.transform, /translate3d\(108px, 208px, 0\)/);
  f.step(67); assert.equal(canvas.dataset.pose, '10'); assert.equal(f.callbacks.size, 0);
  f.pointer('pointerup'); f.step(151); f.pointer('pointerover'); f.step(235);
  assert.equal(canvas.dataset.pose, '0', 'crossing descendants does not restart release');
  assert.equal(f.writes.length, writes, 'animation never changes native cursor CSS');
  assert.equal(f.images.length, 1, 'all poses draw directly from one decoded atlas');
  assert.equal(f.canvases.length, 1);
  f.normal.isConnected = false; f.target = new f.Element();
  f.pointer('pointerout', { target: f.normal, relatedTarget: null }); f.step(240);
  assert.equal(canvas.hidden, false, 'removing a clicked element is not a window exit');
  assert.equal(f.writes.length, writes);
  f.win.devicePixelRatio = 2;
  f.media.find(m => m.query.includes('resolution')).dispatchEvent(new Event('change')); f.step(241);
  assert.deepEqual([canvas.width, canvas.height, canvas.style.width, canvas.style.height], [180, 204, '90px', '102px']);
  assert.equal(f.images.length, 1); assert.equal(f.canvases.length, 1);
  assert.deepEqual([canvas.draws.at(-1).dw, canvas.draws.at(-1).dh], [180, 204]);
  f.pointer('pointerdown'); f.step(260); const interrupted = canvas.dataset.pose;
  f.pointer('pointerup'); assert.equal(canvas.dataset.pose, interrupted);
  f.step(430); assert.equal(canvas.dataset.pose, '0');
  f.reduced = true; f.pointer('pointerdown'); f.step(431);
  assert.equal(canvas.dataset.pose, '10'); assert.equal(f.callbacks.size, 0);
  f.pointer('pointerup'); f.step(432); assert.equal(canvas.dataset.pose, '0');
  applyCursor(false);
  assert.equal(f.props.size, 0); assert.equal(canvas.parentNode, null); assert.equal(f.callbacks.size, 0);
  f.pointer('pointermove'); assert.equal(f.callbacks.size, 0, 'opt-out removes the listeners');
});

test('semantic cursors, touch, focus, fullscreen and rendering failures restore native input', async t => {
  const f = fixture(t); f.manifest = manifest(META);
  applyCursor(true); await f.load(); f.pointer('pointermove'); f.step(0);
  const canvas = f.canvases[0];
  let time = 0;
  for (const cursor of ['text', 'vertical-text', 'grab', 'grabbing', 'ew-resize', 'zoom-in', 'not-allowed', 'none', 'crosshair', 'url("other.cur"), pointer', 'pointer']) {
    f.target = new f.Element(); f.target.cursor = cursor;
    const event = f.pointer('pointerover'); f.step(++time);
    assert.equal(event.defaultPrevented, false);
    assert.equal(canvas.hidden, true, cursor);
    assert.equal(f.props.size, 0, `native ${cursor} is not overridden`);
  }
  f.target = f.normal; f.pointer('pointermove'); f.step(++time);
  assert.equal(canvas.hidden, false);
  f.pointer('pointermove', { pointerType: 'touch' });
  assert.equal(canvas.hidden, true); assert.equal(f.props.size, 0);
  f.pointer('pointermove'); f.step(++time);
  f.win.dispatchEvent(new Event('blur'));
  assert.equal(canvas.hidden, true); assert.equal(f.props.size, 0); assert.equal(f.callbacks.size, 0);
  f.pointer('pointermove'); f.step(++time);
  f.doc.hidden = true; f.doc.dispatchEvent(new Event('visibilitychange'));
  assert.equal(canvas.hidden, true); assert.equal(f.props.size, 0);
  f.doc.hidden = false;
  f.doc.dispatchEvent(new Event('dragstart')); f.pointer('pointermove'); f.step(++time);
  assert.equal(canvas.hidden, true);
  f.doc.dispatchEvent(new Event('dragend')); f.pointer('pointermove'); f.step(++time);
  assert.equal(canvas.hidden, false);
  f.doc.fullscreenElement = new f.Element('CANVAS');
  f.doc.dispatchEvent(new Event('fullscreenchange')); f.step(++time);
  assert.equal(canvas.hidden, true); assert.equal(f.props.size, 0);
  const fullscreen = new f.Element(); f.root.appendChild(fullscreen); f.doc.fullscreenElement = fullscreen;
  f.doc.dispatchEvent(new Event('fullscreenchange')); f.step(++time);
  assert.equal(canvas.parentNode, fullscreen); assert.equal(canvas.hidden, false);
  canvas.dispatchEvent(new Event('contextlost')); f.pointer('pointermove'); f.step(++time);
  assert.equal(canvas.hidden, true); assert.equal(f.props.size, 0);
  canvas.dispatchEvent(new Event('contextrestored')); f.step(++time);
  assert.equal(canvas.hidden, false);
  applyCursor(false);
  f.failContext = true;
  applyCursor(true); await f.load(); f.pointer('pointermove'); f.step(++time);
  assert.equal(f.props.size, 0, 'a missing 2D context cannot leave an invisible native cursor');
});

test('an older static hand remains usable without treating it as an animation atlas', async t => {
  const f = fixture(t);
  f.manifest = manifest({ path: META.path, extractVersion: 1, hotspot: [3, 2] });
  applyCursor(true);
  f.images[0].naturalWidth = 56; f.images[0].naturalHeight = 45;
  await f.load(); f.pointer('pointermove'); f.step(0);
  const canvas = f.canvases[0];
  assert.deepEqual([canvas.width, canvas.height], [56, 45]);
  assert.equal(canvas.dataset.pose, '0');
  f.pointer('pointerdown'); f.step(100);
  assert.equal(canvas.dataset.pose, '0');
  assert.match(canvas.style.transform, /translate3d\(97px, 198px, 0\)/);
});
