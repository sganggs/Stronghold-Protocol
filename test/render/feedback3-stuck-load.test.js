// test/render/feedback3-stuck-load.test.js — GitHub #68 (0.1.3): placeholder models stayed after switching back to a
// tab that had been hidden. A Spine load begun while the tab was hidden can stay pending (a request the background tab
// left hanging); UnitView.retryAssets — called when the tab is shown — only reloaded views with no load in flight, and
// every retry joined PIXI's same pending request. Now such a load gets SPINE_STUCK_MS after the tab is visible, then it
// is started again in place (RefLru.restart: refs and the waiting promise kept, the first success wins, the abandoned
// attempt's slot freed), and a fresh load forgets PIXI's pending requests of that skeleton (forgetPendingSpine).
// Headless fake PIXI (test/render/fakepixi.js).

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';
import { createAssets, RefLru, forgetPendingSpine } from '../../public/js/assets.js';

const tick = () => new Promise((r) => setImmediate(r));
const never = () => new Promise(() => {});
const SP = (id) => ({ skel: `/assets/spine/${id}.skel`, atlas: `/assets/spine/${id}.atlas`, textures: [`/assets/spine/${id}.png`], anims: { idle: 'Idle' }, animations: { Idle: 1 } });
const M = { chars: { char_002_amiya: { avatar: '/a/amiya.png', spine: { front: SP('amiya_f') } } }, ui: {} };

describe('RefLru.restart', () => {
  test('a load in flight starts again in place: the holders\' promise settles with the new attempt, refs kept, fresh', async () => {
    const calls = [];
    let resolveOld;
    const lru = new RefLru({ timeout: 0, load: (k, arg, o) => { calls.push(o?.fresh ? 'fresh' : 'plain'); return calls.length === 1 ? new Promise((r) => { resolveOld = r; }) : Promise.resolve(`${k}#2`); }, unload: () => { throw new Error('nothing to unload'); } });
    const p = lru.acquire('k');
    assert.equal(lru.restart('k'), true);
    assert.equal(await p, 'k#2', 'the waiting holder gets the restarted load');
    assert.deepEqual(calls, ['plain', 'fresh']);
    assert.equal(lru.map.get('k').refs, 1);
    resolveOld('k#1');                       // the abandoned request settles late: ignored, nothing unloaded
    await tick();
    assert.equal(lru.peek('k'), 'k#2');
    assert.equal(lru.restart('k'), false, 'ready: nothing to restart');
    assert.equal(lru.restart('nope'), false);
  });

  test('the abandoned attempt frees its concurrency slot; only the newest attempt\'s failure fails the entry', async () => {
    const started = [];
    const lru = new RefLru({ timeout: 0, concurrency: 1, load: (k) => { started.push(k); return k === 'a' && started.filter((x) => x === 'a').length === 1 ? never() : Promise.resolve(k); } });
    const pa = lru.acquire('a');
    const pb = lru.acquire('b');
    await tick();
    assert.deepEqual(started, ['a'], 'b waits behind the hung load of a');
    lru.restart('a');
    assert.equal(await pb, 'b', 'the hung attempt\'s slot is freed at once');
    assert.equal(await pa, 'a');
    // failures: an abandoned attempt failing changes nothing, the newest one failing fails the entry
    let n = 0, rejectOld;
    const f = new RefLru({ timeout: 0, load: () => (++n === 1 ? new Promise((_, rej) => { rejectOld = rej; }) : Promise.reject(new Error('second'))) });
    const pf = f.acquire('x');
    f.restart('x');
    await assert.rejects(pf, /second/);
    rejectOld(new Error('first'));
    await tick();
    assert.equal(f.map.get('x').error.message, 'second');
  });
});

test('forgetPendingSpine: PIXI\'s pending requests of an unfinished skeleton go, finished ones and kept pages stay', () => {
  const prev = globalThis.PIXI;
  const e = SP('x');
  const page = e.textures[0];
  const setup = (done) => {
    const promiseCache = { [e.skel]: {}, [e.atlas]: {}, [page]: {}, other: {} };
    globalThis.PIXI = { Assets: { loader: { promiseCache }, cache: new Map(done.map((u) => [u, {}])) } };
    return promiseCache;
  };
  try {
    let c = setup([]);
    assert.equal(forgetPendingSpine(e), 3);
    assert.deepEqual(Object.keys(c), ['other']);
    c = setup([e.atlas]);
    assert.equal(forgetPendingSpine(e), 1, 'the atlas (and so its pages) finished: only the .skel');
    assert.ok(c[e.atlas] && c[page]);
    c = setup([e.skel]);
    assert.equal(forgetPendingSpine(e), 0, 'loaded: nothing pending');
    c = setup([]);
    forgetPendingSpine(e, new Set([page]));
    assert.ok(c[page], 'a page another cached skeleton uses stays');
    c = setup([]);
    c[`http://127.0.0.1:8080${e.atlas}`] = {};
    assert.equal(forgetPendingSpine(e), 4, 'an absolute key of the same path too');
    globalThis.PIXI = {};
    assert.equal(forgetPendingSpine(e), 0, 'no loader cache: nothing');
  } finally { globalThis.PIXI = prev; }
});

describe('views restart a load begun in a hidden tab (render/units.js)', () => {
  let fake, UnitView, SPINE_STUCK_MS;
  before(async () => {
    fake = installFakePixi();
    ({ UnitView, SPINE_STUCK_MS } = await import('../../public/js/render/units.js'));
  });
  after(() => fake.restore());
  const cam = () => presetCamera('prep', { width: 1280, height: 720 });
  const unit = (assets) => new UnitView(fakeViewCtx(fake.P, { assets, cam }), { id: 1, side: 'ally', kind: 'chess', defId: 'char_002_amiya', spine: 'char_002_amiya', avatar: 'char_002_amiya', tier: 3, x: 5, y: 12, maxHp: 1000 }, { prep: true });
  const hidden = (on) => { globalThis.document.hidden = on; globalThis.document.visibilityState = on ? 'hidden' : 'visible'; };

  test('pending when the tab is shown: SPINE_STUCK_MS later it is loaded again (fresh) and the model shows', async () => {
    assert.equal(SPINE_STUCK_MS, 5000);
    const calls = [];
    const a = createAssets({ manifest: M, spineTimeout: 0, loadImage: async () => null, unloadSpine: () => {},
      loadSpine: (e, o) => { calls.push(o?.fresh ? 'fresh' : 'plain'); return calls.length === 1 ? never() : Promise.resolve({ animations: [{ name: 'Idle' }] }); } });
    hidden(true);
    const v = unit(a);
    await tick();
    assert.equal(v._spineBusy, true);
    v.retryAssets();                         // the manifest arriving while still hidden arms nothing
    assert.equal(v._stuckAt, 0);
    hidden(false);
    v.retryAssets();                         // render/app.js visibilitychange
    assert.ok(v._stuckAt > 0, 'armed: SPINE_STUCK_MS to finish');
    v.update(1 / 60, cam(), 0);
    await tick();
    assert.deepEqual(calls, ['plain'], 'not before its time: a load about to succeed is not doubled');
    v._stuckAt = 1;                          // due
    v.update(1 / 60, cam(), 0);
    await tick(); await tick();
    assert.deepEqual(calls, ['plain', 'fresh'], 'started again, not joined to the pending request');
    assert.ok(v.actor && v.spineReady, 'the model is shown');
    assert.equal(a.spine.stats().refs, 1, 'one acquire, one reference');
    v.destroy();
    assert.equal(a.spine.stats().refs, 0);
  });

  test('a load that finishes within the grace is never doubled; one begun while visible is left to its timeout', async () => {
    let resolve;
    const calls = [];
    const a = createAssets({ manifest: M, spineTimeout: 0, loadImage: async () => null, unloadSpine: () => {},
      loadSpine: () => { calls.push(1); return new Promise((r) => { resolve = r; }); } });
    hidden(true);
    const v = unit(a);
    hidden(false);
    v.retryAssets();
    assert.ok(v._stuckAt > 0);
    resolve({ animations: [{ name: 'Idle' }] });
    await tick(); await tick();
    assert.ok(v.actor);
    assert.equal(v._stuckAt, 0, 'settled: disarmed');
    v.update(1 / 60, cam(), 0);
    assert.equal(calls.length, 1);
    v.destroy();
    const w = unit(createAssets({ manifest: M, spineTimeout: 0, loadImage: async () => null, loadSpine: () => never() }));
    w.retryAssets();
    assert.equal(w._stuckAt, 0, 'begun while visible: the 20 s timeout and the bounded retries handle it');
    w.destroy();
  });
});
