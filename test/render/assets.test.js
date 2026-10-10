// test/render/assets.test.js — public/js/assets.js: URL helpers (synthetic + real manifest), RefLru spine cache
// (refcount, LRU eviction, failures, timeout, concurrency), store (fetch, preload, fallbacks). No PIXI, no DOM.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  avatarUrl, portraitUrl, enemyIconUrl, tokenAvatarUrl, bondIconUrl, bandIconUrl, itemIconUrl, skillIconUrl, uiUrl,
  profIconUrl, subProfIconUrl, spineEntry, hasBackSpine, unitPictureUrl, bgmEntry, sfxUrl, unitSfxUrl, baseCharId,
  validSpine, RefLru, createAssets, unloadSpineData, spinePages, spineDataWeight, SPINE_WEIGHT_MIN, SPINE_IDLE_BYTES,
  SPINE_IDLE_GRACE_MS, SPINE_EVICT_DELAY_MS, SPINE_QUIET_DELAY_MS,
} from '../../public/js/assets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Fake clock + timers for the spine LRU memory budget (RefLru `now` / `timers`). */
const clock = () => {
  const c = { t: 0, pending: [] };
  c.now = () => c.t;
  c.timers = { set: (fn, ms) => { const h = { fn, at: c.t + ms }; c.pending.push(h); return h; }, clear: (h) => { c.pending = c.pending.filter((x) => x !== h); } };
  c.advance = (ms) => { c.t += ms; for (const h of c.pending.filter((x) => x.at <= c.t)) { c.pending = c.pending.filter((x) => x !== h); h.fn(); } };
  return c;
};

const SP = (id, extra = {}) => ({ skel: `/assets/spine/${id}.skel`, atlas: `/assets/spine/${id}.atlas`, textures: [`/assets/spine/${id}.png`], pma: false, anims: { idle: 'Idle', attack: { loop: 'Attack' } }, animations: { Idle: 1 }, events: [], hits: {}, bounds: null, ...extra });
const M = {
  chars: {
    char_002_amiya: { avatar: '/a/amiya.png', avatarE2: '/a/amiya_2.png', portrait: '/p/amiya_1.png', portraitE2: '/p/amiya_2.png', spine: { front: SP('amiya_f'), back: SP('amiya_b') } },
    char_010_chen: { avatar: '/a/chen.png', portrait: '/p/chen_1.png', spine: { front: SP('chen_f') } },
  },
  enemies: {
    enemy_1007_slime: { icon: '/e/slime.png', spine: SP('slime', { pma: true }) },
    enemy_1305_mhslim: { icon: '/e/mh.png', spineAliasOf: 'enemy_1007_slime' },
    enemy_9016_acstmr: { icon: '/e/acstmr.png' },
  },
  tokens: {
    token_a: { owner: 'char_010_chen', avatar: '/t/a.png', spine: SP('tok_a') },
    token_b: { owner: 'char_010_chen' },
    token_c: { owner: null },
  },
  bonds: { yanShip: '/b/yan.png' },
  bands: { band_bldsk: '/band/bldsk.png' },
  items: { trap_1041_acarm041: '/i/1041.png' },
  skills: { skchr_x: '/s/x.png' },
  skillsById: { skill_y: 'skchr_x' },
  ui: { 'skillIcon/empty': '/ui/empty.png', 'battle/sprite_shadow': '/ui/shadow.png' },
  prof: { icon: { sniper: '/prof/sniper.png' }, battlecard: { token: '/prof/token.png' }, sub: { fastshot: '/prof/sub/fastshot.png' } },
  audio: {
    bgm: { prep: { loop: '/bgm/prep.mp3' }, lobby: { intro: '/bgm/i.mp3', loop: '/bgm/l.mp3' } },
    bossBgm: { boss_1: { loop: '/bgm/b1.mp3' } },
    sfx: { ui: { buy: '/sfx/buy.mp3' }, battle: { deploy: '/sfx/dep.mp3' }, units: { char_010_chen: { attack: '/sfx/c_atk.mp3', hit: '/sfx/c_hit.mp3', skills: { 2: '/sfx/c_s3.mp3' }, skill: '/sfx/c_s.mp3', attacks: { 2: '/sfx/c_atk_s3.mp3' }, hits: { 2: '/sfx/c_hit_s3.mp3' } } } },
  },
};

describe('URL helpers (synthetic manifest)', () => {
  test('avatars & portraits with E2 handling', () => {
    assert.equal(avatarUrl(M, 'char_002_amiya'), '/a/amiya.png');
    assert.equal(avatarUrl(M, 'char_002_amiya', { e2: true }), '/a/amiya_2.png');
    assert.equal(avatarUrl(M, 'char_002_amiya_2'), '/a/amiya_2.png', 'chess.json asset id with _2');
    assert.equal(avatarUrl(M, 'char_010_chen', { e2: true }), '/a/chen.png', 'no E2 ⇒ base');
    assert.equal(avatarUrl(M, 'char_010_chen_2'), '/a/chen.png');
    assert.equal(avatarUrl(M, 'char_999_none'), null);
    assert.equal(avatarUrl(M, ''), null);
    assert.equal(avatarUrl(M, 42), null);
    assert.equal(avatarUrl(null, 'char_002_amiya'), null);
    assert.equal(portraitUrl(M, 'char_002_amiya_1'), '/p/amiya_1.png');
    assert.equal(portraitUrl(M, 'char_002_amiya_2'), '/p/amiya_2.png');
    assert.equal(portraitUrl(M, 'char_010_chen', { e2: true }), '/p/chen_1.png');
    assert.equal(baseCharId('char_002_amiya_2'), 'char_002_amiya');
    assert.equal(baseCharId(null), null);
  });

  test('prototype keys never resolve', () => {
    assert.equal(avatarUrl(M, '__proto__'), null);
    assert.equal(avatarUrl(M, 'constructor'), null);
    assert.equal(uiUrl(M, 'toString'), null);
    assert.equal(spineEntry(M, 'hasOwnProperty'), null);
  });

  test('enemy, token, bond, band, item, skill, ui, prof icons', () => {
    assert.equal(enemyIconUrl(M, 'enemy_1007_slime'), '/e/slime.png');
    assert.equal(enemyIconUrl(M, 'enemy_x'), null);
    assert.equal(tokenAvatarUrl(M, 'token_a'), '/t/a.png');
    assert.equal(tokenAvatarUrl(M, 'token_b'), '/a/chen.png', 'owner avatar fallback');
    assert.equal(tokenAvatarUrl(M, 'token_c'), '/prof/token.png', 'battlecard fallback');
    assert.equal(tokenAvatarUrl(M, 'token_none'), null);
    assert.equal(bondIconUrl(M, 'yanShip'), '/b/yan.png');
    assert.equal(bandIconUrl(M, 'band_bldsk'), '/band/bldsk.png');
    assert.equal(itemIconUrl(M, 'trap_1041_acarm041'), '/i/1041.png');
    assert.equal(itemIconUrl(M, { trapId: 'trap_1041_acarm041' }), '/i/1041.png');
    assert.equal(itemIconUrl(M, { iconId: 'nope', trapId: 'trap_1041_acarm041' }), null);
    assert.equal(skillIconUrl(M, 'skchr_x'), '/s/x.png');
    assert.equal(skillIconUrl(M, 'skill_y'), '/s/x.png', 'via skillsById');
    assert.equal(skillIconUrl(M, 'nope'), '/ui/empty.png');
    assert.equal(skillIconUrl(M, 'nope', { fallback: false }), null);
    assert.equal(skillIconUrl(M, 'nope', null), '/ui/empty.png', 'null options tolerated');
    assert.equal(avatarUrl(M, 'char_002_amiya', null), '/a/amiya.png');
    assert.equal(spineEntry(M, 'char_002_amiya', null).skel, '/assets/spine/amiya_f.skel');
    assert.equal(uiUrl(M, 'battle/sprite_shadow'), '/ui/shadow.png');
    assert.equal(profIconUrl(M, 'SNIPER'), '/prof/sniper.png');
    assert.equal(profIconUrl(M, 'SNIPER', 'large'), null);
    assert.equal(subProfIconUrl(M, 'sub_fastshot_icon'), '/prof/sub/fastshot.png');
    assert.equal(subProfIconUrl(M, 'fastshot'), '/prof/sub/fastshot.png');
  });

  test('spine entries: front/back, tokens, enemies, aliases, missing', () => {
    assert.equal(spineEntry(M, 'char_002_amiya').skel, '/assets/spine/amiya_f.skel');
    assert.equal(spineEntry(M, 'char_002_amiya', { back: true }).skel, '/assets/spine/amiya_b.skel');
    assert.equal(spineEntry(M, 'char_010_chen', { back: true }).skel, '/assets/spine/chen_f.skel', 'no Back ⇒ Front');
    assert.equal(spineEntry(M, 'char_002_amiya_2').skel, '/assets/spine/amiya_f.skel');
    assert.ok(hasBackSpine(M, 'char_002_amiya') && !hasBackSpine(M, 'char_010_chen'));
    assert.equal(spineEntry(M, 'token_a').skel, '/assets/spine/tok_a.skel');
    assert.equal(spineEntry(M, 'token_b'), null);
    assert.equal(spineEntry(M, 'enemy_1007_slime').pma, true);
    assert.equal(spineEntry(M, 'enemy_1305_mhslim').skel, '/assets/spine/slime.skel', 'alias');
    assert.equal(spineEntry(M, 'enemy_9016_acstmr'), null);
    assert.equal(spineEntry(M, 'enemy_5601_entlec'), null, 'no manifest entry at all');
    assert.equal(validSpine({ skel: 'javascript:alert(1).skel', atlas: 'x', anims: {} }), false);
    assert.equal(validSpine({ skel: '/x.skel', atlas: '/x.atlas', anims: {} }), true);
    assert.equal(unitPictureUrl(M, 'enemy_9016_acstmr'), '/e/acstmr.png');
    assert.equal(unitPictureUrl(M, 'trap_1041_acarm041'), '/i/1041.png');
    assert.equal(unitPictureUrl(M, 'trap_x'), null);
  });

  test('audio', () => {
    assert.equal(bgmEntry(M, 'prep').loop, '/bgm/prep.mp3');
    assert.equal(bgmEntry(M, 'boss_1').loop, '/bgm/b1.mp3');
    assert.equal(bgmEntry(M, 'x'), null);
    assert.equal(sfxUrl(M, 'ui', 'buy'), '/sfx/buy.mp3');
    assert.equal(sfxUrl(M, 'ui', 'nope'), null);
    assert.equal(unitSfxUrl(M, 'char_010_chen', 'attack'), '/sfx/c_atk.mp3');
    assert.equal(unitSfxUrl(M, 'char_010_chen', 'skill', 2), '/sfx/c_s3.mp3');
    assert.equal(unitSfxUrl(M, 'char_010_chen', 'skill', 0), '/sfx/c_s.mp3');
    assert.equal(unitSfxUrl(M, 'char_010_chen_2', 'attack'), '/sfx/c_atk.mp3');
    // the running skill's own attack sound (sfx.units[id].attacks, tools/assets/audio.mjs pickModeAttacks)
    assert.equal(unitSfxUrl(M, 'char_010_chen', 'attack', 2), '/sfx/c_atk_s3.mp3');
    assert.equal(unitSfxUrl(M, 'char_010_chen', 'attack', 0), '/sfx/c_atk.mp3', 'no attacks[0] ⇒ the normal bank');
    assert.equal(unitSfxUrl(M, 'char_010_chen', 'hit', 2), '/sfx/c_hit_s3.mp3', 'the running skill\'s own impact');
    assert.equal(unitSfxUrl(M, 'char_010_chen', 'hit', 1), '/sfx/c_hit.mp3', 'no hits[1] ⇒ the normal impact');
    assert.equal(unitSfxUrl(M, 'char_010_chen', 'die', 2), null, 'only an attack / an impact has a per-skill file');
    assert.equal(unitSfxUrl(M, 'nobody', 'attack'), null);
  });
});

describe('URL helpers (real data/assets.json)', () => {
  const file = path.join(ROOT, 'data/assets.json');
  const hasManifest = existsSync(file);
  test('every pool chess resolves avatar + front spine; enemies resolve icon; paths are site-absolute', { skip: !hasManifest }, () => {
    const m = JSON.parse(readFileSync(file, 'utf8'));
    const chess = JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));
    let n = 0;
    for (const c of Object.values(chess)) {
      if (!c.visible || !c.assets?.spine) continue;
      n++;
      const av = avatarUrl(m, c.assets.avatar);
      assert.ok(av && av.startsWith('/assets/'), `avatar ${c.chessId} ${c.assets.avatar}`);
      const sp = spineEntry(m, c.assets.spine);
      assert.ok(sp && sp.skel.endsWith('.skel') && sp.anims && sp.anims.idle, `spine ${c.chessId}`);
      if (c.skill?.iconId) assert.ok(skillIconUrl(m, c.skill.iconId, { fallback: false }), `skill icon ${c.chessId}`);
    }
    assert.ok(n >= 200, `checked ${n}`);
    const enemies = JSON.parse(readFileSync(path.join(ROOT, 'data/enemies.json'), 'utf8'));
    let withSpine = 0, total = 0;
    for (const e of Object.values(enemies)) {
      total++;
      if (spineEntry(m, e.spine || e.key)) withSpine++;
    }
    assert.ok(withSpine / total > 0.9, `enemy spines ${withSpine}/${total}`);
    assert.equal(spineEntry(m, 'enemy_5601_entlec'), null);
    assert.ok(uiUrl(m, 'battle/sprite_shadow'));
    for (const b of Object.keys(JSON.parse(readFileSync(path.join(ROOT, 'data/bonds.json'), 'utf8')))) assert.ok(bondIconUrl(m, b), b);
  });
});

describe('RefLru', () => {
  const tick = () => new Promise((r) => setImmediate(r));

  test('dedupes concurrent loads, refcounts, evicts LRU idle entries above max', async () => {
    const loads = [], unloads = [];
    const lru = new RefLru({ max: 2, load: async (k) => { loads.push(k); return `v:${k}`; }, unload: (k, v) => unloads.push([k, v]) });
    const [a1, a2] = await Promise.all([lru.acquire('a'), lru.acquire('a')]);
    assert.equal(a1, 'v:a'); assert.equal(a2, 'v:a');
    assert.deepEqual(loads, ['a']);
    await lru.acquire('b');
    await lru.acquire('c');
    assert.equal(lru.size, 3, 'all referenced ⇒ nothing evicted');
    lru.release('a'); lru.release('a');
    assert.deepEqual(unloads, [['a', 'v:a']], 'a evicted once idle');
    assert.equal(lru.peek('a'), null);
    lru.release('b');
    lru.release('c');
    assert.equal(lru.size, 2);
    await lru.acquire('d');
    assert.equal(lru.size, 2);
    assert.deepEqual(unloads.map((u) => u[0]), ['a', 'b'], 'least recently used idle entry goes first');
    lru.release('zzz'); lru.release('d'); lru.release('d');
    assert.equal(lru.stats().refs, 0);
    lru.clear();
    assert.equal(lru.size, 0);
  });

  test('failures reject, are remembered for failTtl, then retried', async () => {
    let now = 0, calls = 0;
    const lru = new RefLru({ failTtl: 1000, now: () => now, load: async () => { calls++; throw new Error('404'); } });
    await assert.rejects(lru.acquire('x'), /404/);
    await assert.rejects(lru.acquire('x'), /404/);
    assert.equal(calls, 1);
    now = 5000;
    await assert.rejects(lru.acquire('x'), /404/);
    assert.equal(calls, 2);
    assert.equal(lru.stats().failed, 1);
  });

  test('timeout rejects slow loads', async () => {
    const lru = new RefLru({ timeout: 20, load: () => new Promise(() => {}) });
    await assert.rejects(lru.acquire('slow'), /timeout/);
  });

  test('concurrency cap queues loads', async () => {
    let active = 0, peak = 0;
    const lru = new RefLru({ concurrency: 2, max: 100, load: async (k) => { active++; peak = Math.max(peak, active); await tick(); await tick(); active--; return k; } });
    const all = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((k) => lru.acquire(k)));
    assert.deepEqual(all, ['a', 'b', 'c', 'd', 'e']);
    assert.equal(peak, 2);
  });

  test('an entry evicted while loading unloads the late value', async () => {
    let resolve;
    const unloads = [];
    const lru = new RefLru({ max: 1, load: () => new Promise((r) => { resolve = r; }), unload: (k) => unloads.push(k) });
    const p = lru.acquire('a');
    lru.clear();
    resolve('late');
    assert.equal(await p, 'late');
    assert.deepEqual(unloads, ['a']);
  });

  test('requires a loader', () => {
    assert.throws(() => new RefLru({}), TypeError);
  });

  // perf hunt: the count cap alone (60) kept ~115–150 MB of idle parsed skeletons pinned, also in the lobby / room
  const W = { a: 30, b: 30, c: 30, d: 5 };

  test('memory budget: idle weight above maxIdleWeight goes LRU-first once past the grace; referenced never', async () => {
    const c = clock(), unloads = [];
    const lru = new RefLru({ max: 100, load: async (k) => k, unload: (k) => unloads.push(k), weigh: (k) => W[k],
      maxIdleWeight: 50, idleGrace: 1000, now: c.now, timers: c.timers });
    for (const k of ['a', 'b', 'c', 'd']) await lru.acquire(k);
    lru.release('a'); lru.release('b');           // idle 60 > 50, but both inside the grace (a prep ⇄ battle switch)
    assert.deepEqual(unloads, []);
    assert.equal(lru.stats().idleWeight, 60);
    assert.equal(c.pending.length, 1, 'a sweep is scheduled for the end of the grace');
    await lru.acquire('b');                        // re-acquired inside the grace: kept, never reloaded
    c.advance(1000);
    assert.deepEqual(unloads, [], 'idle 30 ≤ 50 after b came back');
    lru.release('b');                              // idle a+b = 60: a (idle for the whole grace) goes, b is fresh
    assert.deepEqual(unloads, ['a']);
    lru.release('c');                              // idle b+c = 60, both inside their grace
    c.advance(400);
    assert.deepEqual(unloads, ['a']);
    c.advance(700);
    assert.deepEqual(unloads, ['a', 'b'], 'the sweep drops b (least recently used); c alone (30) fits the budget');
    assert.ok(lru.peek('c') && lru.peek('d'));
    assert.equal(lru.stats().weight, 35);
    lru.clear();
    assert.equal(c.pending.length, 0, 'clear cancels the sweep');
  });

  test('memory budget: nothing referenced (no scene) ⇒ quietWeight after the grace; unweighted caches unchanged', async () => {
    const c = clock(), unloads = [];
    const lru = new RefLru({ max: 100, load: async (k) => k, unload: (k) => unloads.push(k), weigh: (k) => W[k],
      maxIdleWeight: 1000, quietWeight: 0, idleGrace: 1000, now: c.now, timers: c.timers });
    for (const k of ['a', 'd']) await lru.acquire(k);
    lru.release('a');
    c.advance(5000);
    assert.deepEqual(unloads, [], 'd still referenced: the 1000 budget holds a');
    lru.release('d');                              // the view is gone (lobby / room)
    assert.deepEqual(unloads, ['a'], 'quiet budget 0: a (idle past its grace) goes at once, d is inside its grace');
    c.advance(1100);
    assert.deepEqual(unloads, ['a', 'd'], 'the quiet sweep empties the cache');
    assert.equal(lru.size, 0);
    // without `weigh` the cache behaves as before (count cap only, no timers)
    const plain = new RefLru({ max: 100, load: async (k) => k, unload: (k) => unloads.push(k), maxIdleWeight: 0, quietWeight: 0, now: c.now, timers: c.timers });
    await plain.acquire('x'); plain.release('x');
    assert.equal(plain.size, 1);
    assert.equal(c.pending.length, 0);
  });

  test('a released-while-loading entry past its grace is dropped as soon as it is ready when over budget', async () => {
    const c = clock(), unloads = [];
    let resolve;
    const lru = new RefLru({ load: () => new Promise((r) => { resolve = r; }), unload: (k) => unloads.push(k), weigh: () => 10,
      maxIdleWeight: 0, idleGrace: 100, now: c.now, timers: c.timers });
    const p = lru.acquire('a');
    lru.release('a');
    c.advance(200);
    resolve('v');
    await p;
    assert.deepEqual(unloads, ['a']);
  });

  // user playtest #3 item 1 (invisible operator models): an unload is asynchronous; a new load of the same key while
  // it is in flight must not get the doomed value
  test('a load of a key whose unload is still in flight waits for that unload (never the doomed value)', async () => {
    const order = [];
    let finishUnload;
    let n = 0;
    const lru = new RefLru({ max: 1,
      load: async (k) => { order.push(`load ${k}`); return `${k}#${++n}`; },
      unload: (k, v) => { order.push(`unload ${v}`); return new Promise((r) => { finishUnload = () => { order.push(`unloaded ${v}`); r(); }; }); } });
    assert.equal(await lru.acquire('a'), 'a#1');
    await lru.acquire('b');
    lru.release('a');                        // over max: a goes, its unload is in flight
    assert.ok(lru.unloading('a') && lru.stats().unloading === 1);
    const again = lru.acquire('a');          // same task: taken again
    await tick();
    assert.deepEqual(order, ['load a', 'load b', 'unload a#1'], 'the new load waits');
    finishUnload();
    assert.equal(await again, 'a#3', 'a fresh value once the old one is gone (b was #2)');
    assert.deepEqual(order.slice(3), ['unloaded a#1', 'load a']);
    await tick();
    assert.equal(lru.unloading('a'), false);
    // an unloader that throws or returns nothing never blocks a later load
    const lru2 = new RefLru({ max: 1, load: async (k) => k, unload: () => { throw new Error('x'); } });
    await lru2.acquire('a'); await lru2.acquire('b'); lru2.release('a');
    assert.equal(await lru2.acquire('a'), 'a');
  });

  test('evictDelay: releases schedule one eviction pass; a scene rebuilt in one go keeps what it takes back', async () => {
    const c = clock(), unloads = [];
    let loads = 0;
    const lru = new RefLru({ max: 2, load: async (k) => { loads++; return k; }, unload: (k) => unloads.push(k), evictDelay: 500, now: c.now, timers: c.timers });
    for (const k of ['a', 'b', 'c']) await lru.acquire(k);
    // every view destroyed, then the next scene's views built (same task): nothing is dropped meanwhile
    for (const k of ['a', 'b', 'c']) lru.release(k);
    for (const k of ['a', 'b']) await lru.acquire(k);
    assert.deepEqual(unloads, []);
    assert.equal(c.pending.length, 1, 'one pass pending');
    c.advance(510);
    assert.deepEqual(unloads, ['c'], 'the pass drops only what nobody took back');
    assert.equal(loads, 3, 'a and b were never reloaded');
  });

  test('quietDelay: the instant zero of a scene switch is not "no scene"; a lasting one is', async () => {
    const c = clock(), unloads = [];
    const lru = new RefLru({ max: 100, load: async (k) => k, unload: (k) => unloads.push(k), weigh: () => 10,
      maxIdleWeight: 100, quietWeight: 0, idleGrace: 5000, quietDelay: 3000, now: c.now, timers: c.timers });
    await lru.acquire('bench'); await lru.acquire('op');
    lru.release('bench');                    // prep → battle: the bench model idles for the whole battle
    c.advance(20000);
    lru.release('op');                       // battle → prep: nothing referenced for an instant …
    assert.deepEqual(unloads, [], 'the budget of a shown scene applies (10 + 10 ≤ 100)');
    await lru.acquire('bench'); await lru.acquire('op'); // … the prep views take their models back
    c.advance(5000);
    assert.deepEqual(unloads, []);
    lru.release('bench'); lru.release('op'); // the view is gone for good (lobby)
    c.advance(1000);
    assert.deepEqual(unloads, [], 'not quiet long enough yet');
    c.advance(2100);
    assert.deepEqual(unloads, [], 'quiet, but both are still inside their grace');
    c.advance(2000);
    assert.deepEqual(unloads.sort(), ['bench', 'op'], 'the quiet budget empties the cache');
  });
});

describe('Spine store: unload / reload of the same skeleton (user playtest #3 item 1)', () => {
  const tick = () => new Promise((r) => setImmediate(r));
  /**
   * PIXI.Assets semantics that caused the invisible models: `unload` frees an asset a microtask after the call
   * (Loader.unload awaits the cached promise, then deletes the cache entry and destroys the asset), and `load` of that
   * URL meanwhile returns the cached — doomed — asset.
   */
  function pixiAssets() {
    const cache = new Map();
    let seq = 0;
    const loader = {
      async unload(url) {
        const hit = cache.get(url);
        if (!hit) return;
        const asset = await hit;
        cache.delete(url);
        asset.destroyed = true;
      },
    };
    const Assets = {
      loader,
      load(url) {
        if (!cache.has(url)) cache.set(url, Promise.resolve({ url, id: ++seq, destroyed: false, animations: [] }));
        return cache.get(url);
      },
      unload(url) { return loader.unload(url); },
    };
    const prev = globalThis.PIXI;
    globalThis.PIXI = { Assets, spine: {} };
    return { Assets, restore: () => { if (prev === undefined) delete globalThis.PIXI; else globalThis.PIXI = prev; } };
  }

  test('the hazard: PIXI.Assets hands out an asset whose unload is in flight', async () => {
    const f = pixiAssets();
    try {
      await f.Assets.load('/x.skel');
      f.Assets.unload('/x.skel');
      const again = await f.Assets.load('/x.skel');
      await tick();
      assert.equal(again.destroyed, true, 'the model a view would build from it has no textures');
    } finally { f.restore(); }
  });

  test('battle → prep after a long battle: the bench models come back alive (defaults), with or without an eviction', async () => {
    for (const eager of [false, true]) {
      const f = pixiAssets();
      try {
        const c = clock();
        // eager = the old timing (evict at once, no quiet delay): the bench model IS dropped at the instant zero —
        // the re-acquire must then wait for its unload and load a fresh skeleton
        const a = createAssets({ manifest: M, spineNow: c.now, spineTimers: c.timers, ...(eager ? { spineEvictDelay: 0, spineQuietDelay: 0 } : {}) });
        const bench = a.spineEntry('char_010_chen'), op = a.spineEntry('char_002_amiya'), foe = a.spineEntry('enemy_1007_slime');
        const bench0 = await a.spine.acquire(bench);
        await a.spine.acquire(op);
        // prep → battle: the prep views go (the bench model idles), the battle views take the board model and the foe
        a.spine.release(bench); a.spine.release(op);
        await a.spine.acquire(op); await a.spine.acquire(foe);
        c.advance(SPINE_IDLE_GRACE_MS + 20000);           // a long battle: the bench model idles past its grace
        // battle → prep in one go (render/app.js enterPrepMode + setPrep): every battle view destroyed, prep views built
        a.spine.release(op); a.spine.release(foe);
        const [b1, o1] = await Promise.all([a.spine.acquire(bench), a.spine.acquire(op)]);
        await tick(); await tick();
        c.advance(SPINE_EVICT_DELAY_MS + SPINE_QUIET_DELAY_MS + 10);
        await tick(); await tick();
        assert.equal(b1.destroyed, false, `${eager ? 'eager' : 'default'}: the bench model is alive`);
        assert.equal(o1.destroyed, false, `${eager ? 'eager' : 'default'}: the board model is alive`);
        if (eager) assert.notEqual(b1, bench0, 'eager: dropped, then loaded afresh');
        else assert.equal(b1, bench0, 'default: never dropped, never reloaded');
        assert.equal(a.spine.stats().unloading, 0);
      } finally { f.restore(); }
    }
  });
});

describe('spineDataWeight', () => {
  test('counts timelines, deform frames, draw orders and mesh arrays; never throws', () => {
    const f32 = (n) => new Float32Array(n);
    const data = {
      bones: [{}, {}], slots: [{}],
      skins: [{ attachments: [{ body: { vertices: f32(100), regionUVs: f32(50), triangles: [1, 2, 3] }, head: { offset: f32(8) } }, null] }],
      animations: [{ timelines: [{ frames: f32(10000), curves: f32(19 * 3333) }, { frames: f32(10), frameVertices: [f32(2000), f32(2000)] }, { frames: f32(4), drawOrders: [[0, 1], null] }] }],
    };
    const w = spineDataWeight(data);
    const arrays = 4 * (100 + 50 + 8 + 10000 + 19 * 3333 + 10 + 2000 + 2000 + 4) + 8 * (3 + 2);
    assert.ok(w > arrays && w < arrays * 2, `${w} vs ${arrays}`);
    const bigger = { ...data, animations: [...data.animations, { timelines: [{ frames: f32(100000) }] }] };
    assert.ok(spineDataWeight(bigger) - w >= 400000, 'grows with the animation data');
    for (const junk of [null, undefined, 3, 'x', {}, { animations: 5, skins: [{ attachments: 'x' }] }, { animations: [null, { timelines: [7] }] }]) {
      assert.equal(spineDataWeight(junk), SPINE_WEIGHT_MIN);
    }
  });

  test('the store budgets idle skeletons by weight (defaults: SPINE_IDLE_BYTES, drain when no scene, 15 s grace)', async () => {
    const d = createAssets({ manifest: M, loadSpine: async () => ({ animations: [] }), unloadSpine: () => {} });
    assert.equal(d.spine.cache.maxIdleWeight, SPINE_IDLE_BYTES);
    assert.equal(d.spine.cache.quietWeight, 0);
    assert.equal(d.spine.cache.idleGrace, SPINE_IDLE_GRACE_MS);
    assert.ok(SPINE_IDLE_BYTES <= 64 * 1024 * 1024 && SPINE_IDLE_GRACE_MS >= 5000);
    const c = clock(), unloads = [];
    const big = { animations: [{ timelines: [{ frames: new Float32Array(5 * 1024 * 1024) }] }] }; // ~20 MB parsed
    const a = createAssets({ manifest: M, loadSpine: async () => big, unloadSpine: (e) => unloads.push(e.skel), spineNow: c.now, spineTimers: c.timers });
    const e1 = a.spineEntry('char_002_amiya'), e2 = a.spineEntry('char_010_chen'), e3 = a.spineEntry('enemy_1007_slime'), keep = a.spineEntry('token_a');
    for (const e of [e1, e2, e3, keep]) await a.spine.acquire(e);
    for (const e of [e1, e2, e3]) a.spine.release(e);
    c.advance(SPINE_IDLE_GRACE_MS + 10);
    assert.deepEqual(unloads, [e1.skel], '3 × 20 MB idle > 48 MB: the oldest goes although the count cap (60) is far');
    assert.ok(a.spine.stats().idleWeight <= SPINE_IDLE_BYTES);
    a.spine.release(keep);
    c.advance(SPINE_IDLE_GRACE_MS + 10);
    assert.equal(a.spine.stats().size, 0, 'no scene references any skeleton (lobby / room): all of them go');
  });
});

describe('createAssets store', () => {
  test('fetches the manifest once; helpers bind to it; missing manifest ⇒ nulls', async () => {
    let fetches = 0;
    const a = createAssets({ fetch: async () => { fetches++; return { ok: true, json: async () => M }; } });
    assert.equal(a.avatar('char_002_amiya'), null, 'before ready');
    await Promise.all([a.ready(), a.ready()]);
    assert.equal(fetches, 1);
    assert.equal(a.avatar('char_002_amiya'), '/a/amiya.png');
    assert.equal(a.spineEntry('enemy_1305_mhslim').skel, '/assets/spine/slime.skel');
    assert.equal(a.audio.sfx('battle', 'deploy'), '/sfx/dep.mp3');
    const warn = console.warn; console.warn = () => {};
    try {
      // a failure resolves ready() (fallbacks meanwhile) but is not kept as the manifest (public issue #8 item 5;
      // test/render/issue8-placeholders.test.js covers the retries)
      const b = createAssets({ fetch: async () => ({ ok: false, status: 404 }) });
      assert.deepEqual(await b.ready(), {});
      assert.equal(b.avatar('char_002_amiya'), null);
      assert.equal(b.manifest, null);
      assert.equal(b.loaded, false);
    } finally { console.warn = warn; }
  });

  test('image cache + preload progress (failures resolve to null)', async () => {
    const loaded = [];
    const a = createAssets({ manifest: M, loadImage: async (u) => { loaded.push(u); if (u.includes('bad')) throw new Error('x'); return { src: u }; } });
    const progress = [];
    const r = await a.preload(['/a.png', '/bad.png', '/a.png', null, ''], (d, t) => progress.push([d, t]));
    assert.deepEqual(r, { ok: 1, failed: 1, total: 2 });
    assert.deepEqual(progress.map((p) => p[1]), [2, 2]);
    assert.deepEqual((await a.image('/a.png')).src, '/a.png');
    assert.equal(await a.image('/bad.png'), null);
    assert.equal(loaded.filter((u) => u === '/a.png').length, 1, 'cached');
    assert.equal(a.imageNow('/a.png').src, '/a.png');
    assert.equal(await a.image(null), null);
  });

  test('spine acquire/release through the store with an injected loader', async () => {
    const a = createAssets({ manifest: M, loadSpine: async (e) => ({ animations: [], from: e.skel }), unloadSpine: () => {}, spineMax: 1 });
    const e = a.spineEntry('char_002_amiya');
    const d = await a.spine.acquire(e);
    assert.equal(d.from, e.skel);
    assert.equal(a.spine.peek(e), d);
    a.spine.release(e);
    await assert.rejects(a.spine.acquire(null), /no spine/);
    assert.equal(a.spine.stats().refs, 0);
  });
});

describe('spine unload frees the atlas page images too', () => {
  // pixi-spine's atlas parser loads every page with loader.load({ src }): the decoded ImageBitmap stays in
  // PIXI.Assets.loader.promiseCache unless the page URL itself is unloaded (evicted models leaked ~0.8 MB each)
  function fakePixi() {
    const calls = { assets: [], loader: [] };
    const prev = globalThis.PIXI;
    globalThis.PIXI = {
      spine: {},
      Assets: { unload: async (u) => { calls.assets.push(u); }, loader: { unload: async (u) => { calls.loader.push(u); } } },
    };
    return { calls, restore: () => { if (prev === undefined) delete globalThis.PIXI; else globalThis.PIXI = prev; } };
  }

  test('spinePages: manifest textures, else <skel>.png', () => {
    assert.deepEqual(spinePages(SP('x')), ['/assets/spine/x.png']);
    assert.deepEqual(spinePages({ skel: '/s/a.skel', textures: ['/s/a.png', '/s/a2.png'] }), ['/s/a.png', '/s/a2.png']);
    assert.deepEqual(spinePages({ skel: '/s/b.skel' }), ['/s/b.png']);
    for (const junk of [null, 1, {}, { textures: [null, 3] }]) assert.deepEqual(spinePages(junk), []);
  });

  test('unloadSpineData unloads skeleton, atlas and every page (pages straight from the loader), minus kept ones', () => {
    const f = fakePixi();
    try {
      unloadSpineData({ skel: '/s/a.skel', atlas: '/s/a.atlas', textures: ['/s/a.png', '/s/a2.png'] });
      assert.deepEqual(f.calls.assets, ['/s/a.skel', '/s/a.atlas']);
      assert.deepEqual(f.calls.loader, ['/s/a.png', '/s/a2.png']);
      f.calls.loader.length = 0;
      unloadSpineData({ skel: '/s/b.skel', textures: ['/s/b.png', '/s/shared.png'] }, null, new Set(['/s/shared.png']));
      assert.deepEqual(f.calls.loader, ['/s/b.png']);
      assert.doesNotThrow(() => unloadSpineData(null));
    } finally { f.restore(); }
  });

  test('LRU eviction through the store unloads the evicted pages, never pages another cached skeleton uses', async () => {
    const f = fakePixi();
    try {
      const E = (id, pages) => ({ ...SP(id), textures: pages });
      const c = clock();
      const a = createAssets({ manifest: M, loadSpine: async (e) => ({ animations: [], from: e.skel }), spineMax: 1, spineNow: c.now, spineTimers: c.timers });
      const ea = E('a', ['/assets/spine/a.png', '/assets/spine/common.png']);
      const eb = E('b', ['/assets/spine/b.png', '/assets/spine/common.png']);
      await a.spine.acquire(ea);
      await a.spine.acquire(eb);
      a.spine.release(ea);                   // a evicted (max 1) while b still uses common.png …
      assert.deepEqual(f.calls.assets, [], '… in the eviction pass a moment later (SPINE_EVICT_DELAY_MS)');
      c.advance(SPINE_EVICT_DELAY_MS + 10);
      assert.deepEqual(f.calls.assets, ['/assets/spine/a.skel', '/assets/spine/a.atlas']);
      assert.deepEqual(f.calls.loader, ['/assets/spine/a.png']);
      a.spine.release(eb);
      a.spine.clear();
      assert.deepEqual(f.calls.loader, ['/assets/spine/a.png', '/assets/spine/b.png', '/assets/spine/common.png']);
    } finally { f.restore(); }
  });

  test('a late value of a dropped load does not unload the URLs a newer load of the same skeleton uses', async () => {
    const f = fakePixi();
    try {
      const pending = [];
      const a = createAssets({ manifest: M, loadSpine: (e) => new Promise((r) => pending.push(() => r({ animations: [], from: e.skel }))), spineMax: 5 });
      const e = SP('late');
      const p1 = a.spine.acquire(e);
      a.spine.clear();                       // dropped while loading
      const p2 = a.spine.acquire(e);         // loading again
      pending.shift()();
      await p1;
      assert.deepEqual(f.calls.loader, [], 'the newer entry keeps its pages');
      assert.deepEqual(f.calls.assets, []);
      pending.shift()();
      assert.equal((await p2).from, e.skel);
    } finally { f.restore(); }
  });
});
