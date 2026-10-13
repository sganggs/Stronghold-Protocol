// test/render/deploy-replay.test.js — PR #416 by @Cromemadnd, ported in 0.2.6 (DESIGN §31.8): a prep piece that lands —
// the round start's replay of the own board, a purchase, a move onto or across the board — plays its Start clip again
// with its landing sound (render/units.js UnitView.land → ctx.audio.deployCue), once per landing. Headless fake PIXI
// (test/render/fakepixi.js). The schedule itself (render/app.js replayDeploys, screens/game.js) runs in the browser check
// test/ui/deploy-replay.e2e.test.js; the order and the due rule are test/ui/deploy-replay.test.js.
// Run: node --test test/render/deploy-replay.test.js

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { installFakePixi, fakeViewCtx } from './fakepixi.js';
import { presetCamera } from '../../public/js/render/projection.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

let fake, UnitView, START_CLIP_FALLBACK;
before(async () => {
  fake = installFakePixi();
  ({ UnitView, START_CLIP_FALLBACK } = await import('../../public/js/render/units.js'));
});
after(() => fake.restore());

const cam = presetCamera('prep', { width: 1280, height: 720 });
const ANIMS = ['Idle', 'Start', 'Die', 'Attack'];

/**
 * A prep (or battle) view of an operator whose model loads when `ready()` is called (`instant`: at once). `start` = the
 * Start clip's length in the manifest entry (null: the model has no Start clip). Every deployCue is recorded.
 */
function rig({ prep = true, side = 'ally', kind = 'op', start = 1, instant = true, info = {} } = {}) {
  let resolve = null;
  const anims = { idle: 'Idle', deploy: start == null ? 'Idle' : 'Start', die: 'Die', attack: { begin: null, loop: 'Attack', end: null } };
  const animations = { Idle: 1, Die: 1, Attack: 1, ...(start == null ? {} : { Start: start }) };
  const entry = { skel: '/op.skel', atlas: '/op.atlas', textures: ['/op.png'], anims, animations };
  const data = { animations: ANIMS.filter((n) => start != null || n !== 'Start').map((name) => ({ name })) };
  const assets = {
    spineEntry: () => entry, hasBack: () => false,
    spine: { acquire: () => (instant ? Promise.resolve(data) : new Promise((r) => { resolve = () => r(data); })), release() {} },
  };
  const cues = [];
  const audio = { deployCue: (u, key) => { cues.push({ ...u, key }); return true; } };
  const ctx = fakeViewCtx(fake.P, { assets, cam: () => cam, audio });
  const v = new UnitView(ctx, { id: 'p:7', uid: 7, side, kind, defId: 'chess_char_x', spine: 'char_x', tier: 3, x: 5, y: 10, maxHp: 1, dir: 'RIGHT', ...info }, { prep });
  const tick = async () => { await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); };
  return { v, cues, advance: (dt) => v.update(dt, cam, dt), ready: async () => { resolve?.(); await tick(); }, tick };
}

/** Run `fn` with performance.now() reading `t` ms (the landing window is real time). */
function at(t, fn) {
  const perf = globalThis.performance;
  const now = perf.now;
  perf.now = () => t;
  try { return fn(); } finally { perf.now = now; }
}

describe('UnitView.land — the Start clip again and the landing sound, once (PR #416)', () => {
  test('an idle prep piece lands: Start plays and its landing sound is asked for once, with the piece as the key', async () => {
    const h = rig();
    await h.tick();
    assert.ok(h.v.actor, 'the model is up');
    h.advance(0.5);
    assert.equal(h.v.actor.mode, 'base');
    assert.equal(h.v.land(), true);
    assert.equal(h.v.actor.mode, 'deploy', 'the Start clip plays');
    assert.equal(h.v.fadeIn, 0, 'and the piece fades in with it, like a deploy');
    assert.deepEqual(h.cues, [{ def: 'char_x', defId: 'chess_char_x', kind: 'op', key: 'p:7' }], 'the model id picks the sound, the kind its class');
    h.v.destroy();
  });

  test('a second trigger of the same landing changes nothing and sounds nothing; after the clip a new landing plays again', async () => {
    const h = rig();
    await h.tick();
    assert.equal(h.v.land(), true);                 // e.g. bought …
    h.advance(0.4);
    assert.equal(h.v.land(), false, '… then moved onto the board while its Start still plays');
    assert.equal(h.v.actor.mode, 'deploy');
    assert.ok(Math.abs(h.v.actor.deployElapsed() - 0.4) < 1e-9, 'the clip is not restarted');
    assert.equal(h.cues.length, 1, 'one landing, one sound');
    // the round start's replay reaching a piece put down a moment before: the same
    assert.equal(h.v.deploying(), true);
    h.advance(0.7);                                   // the 1 s clip is over
    assert.equal(h.v.actor.mode, 'base');
    at(globalThis.performance.now() + 5000, () => {
      assert.equal(h.v.deploying(), false);
      assert.equal(h.v.land(), true, 'a later landing (another move) plays again');
    });
    assert.equal(h.cues.length, 2);
    h.v.destroy();
  });

  test('a landing asked before the model has loaded sounds at once and continues by the time gone (0.2.3); no second sound at load', async () => {
    const h = rig({ instant: false });
    assert.equal(h.v.actor, null);
    assert.equal(h.v.land(), true);
    assert.equal(h.cues.length, 1, 'the sound belongs to the landing, not to the model');
    h.advance(0.3);
    assert.equal(h.v.land(), false, 'still landing (owed to the model)');
    await h.ready();
    assert.equal(h.v.actor.mode, 'deploy');
    assert.ok(Math.abs(h.v.actor.deployElapsed() - 0.3) < 1e-9, 'Start continues where the time says');
    assert.equal(h.cues.length, 1);
    h.v.destroy();
  });

  test('a model without a Start clip and a view without a model still land once per clip length', async () => {
    const h = rig({ start: null });
    await h.tick();
    const t0 = 1000;
    at(t0, () => assert.equal(h.v.land(), true));
    assert.equal(h.v.actor.mode, 'base', 'nothing to play');
    at(t0 + 500, () => assert.equal(h.v.land(), false, 'the landing still owns the clip length'));
    at(t0 + START_CLIP_FALLBACK * 1000 + 1, () => assert.equal(h.v.land(), true));
    assert.equal(h.cues.length, 2);
    h.v.destroy();
    // no manifest entry at all: the fallback length
    const ctx = fakeViewCtx(fake.P, { assets: null, cam: () => cam, audio: { deployCue: () => true } });
    const bare = new UnitView(ctx, { id: 'p:8', uid: 8, side: 'ally', kind: 'op', defId: 'chess_char_y', x: 5, y: 10, maxHp: 1 }, { prep: true });
    assert.equal(bare._startDur(), START_CLIP_FALLBACK);
    at(t0, () => assert.equal(bare.land(), true));
    at(t0 + 200, () => assert.equal(bare.land(), false));
    bare.destroy();
  });

  test('never pulls a unit out of a battle, an attack, a death or a drag into the Start clip', async () => {
    // a battle unit (the sim's own 'deploy' events go through onDeploy, which stays silent here)
    const b = rig({ prep: false });
    await b.tick();
    b.advance(0.5);
    assert.equal(b.v.land(), false);
    assert.equal(b.v.actor.mode, 'base');
    b.v.onDeploy();
    assert.equal(b.v.actor.mode, 'deploy', 'a battle deploy still plays Start');
    assert.equal(b.cues.length, 0, 'and asks for no sound: audio.handleBattleEvents sounds battle deploys');
    b.v.destroy();
    // attacking, dying, dead, lifted, an enemy
    const a = rig();
    await a.tick();
    a.advance(0.5);
    a.v.onAttack(null, 1, 'none');
    assert.equal(a.v.actor.mode, 'attack');
    assert.equal(a.v.land(), false, 'attacking');
    a.v.die();
    assert.equal(a.v.land(), false, 'dying');
    a.v.destroy();
    assert.equal(a.v.land(), false, 'destroyed');
    const l = rig();
    await l.tick();
    l.v.lift = 0.3;
    assert.equal(l.v.land(), false, 'lifted by a drag');
    l.v.lift = 0;
    assert.equal(l.v.land(), true);
    l.v.destroy();
    const e = rig({ side: 'enemy', kind: 'enemy' });
    await e.tick();
    assert.equal(e.v.land(), false, 'an enemy (the pen) never lands');
    e.v.destroy();
    assert.equal(a.cues.length + e.cues.length, 0);
    // a hidden tab: nothing would show it, and the clip and the suspended audio would play it stale on return
    const hid = rig();
    await hid.tick();
    globalThis.document.hidden = true;
    try { assert.equal(hid.v.land(), false, 'hidden'); } finally { delete globalThis.document.hidden; }
    assert.equal(hid.v.actor.mode, 'base');
    assert.equal(hid.cues.length, 0);
    assert.equal(hid.v.land(), true, 'shown again');
    hid.v.destroy();
  });

  test('a summon piece lands with its own class; a landing sound that throws never stops the clip', async () => {
    const t = rig({ kind: 'token', info: { defId: 'token_10000_silent_healrb', spine: 'token_10000_silent_healrb' } });
    await t.tick();
    assert.equal(t.v.land(), true);
    assert.deepEqual(t.cues[0], { def: 'token_10000_silent_healrb', defId: 'token_10000_silent_healrb', kind: 'token', key: 'p:7' });
    t.v.destroy();
    const h = rig();
    await h.tick();
    h.v.ctx.audio = { deployCue: () => { throw new Error('no audio'); } };
    assert.equal(h.v.land(), true);
    assert.equal(h.v.actor.mode, 'deploy');
    h.v.ctx.audio = null;
    h.v.destroy();
  });
});

test('render/app.js wiring: landings in setPrep, the replay schedule, its timers cleared when prep mode ends and on destroy', () => {
  const src = readFileSync(path.join(ROOT, 'public/js/render/app.js'), 'utf8');
  // a purchase (an operator new on the bench), a merge's elite, a piece put on a board tile it was not on
  assert.match(src, /if \(e\.piece\.kind === 'chess'\) landPiece\(v, 'buy'\);/);
  assert.match(src, /landPiece\(v, 'merge'\);/);
  assert.match(src, /if \(was && e\.area === 'board' && \(was\.area !== 'board' \|\| was\.row !== e\.row \|\| was\.col !== e\.col\)[^\n]*landPiece\(v, 'board'\);/);
  assert.match(src, /const prevAt = new Map\(prepPieces\.map\(\(p\) => \[p\.uid, p\]\)\);/, 'compared with the last state of this prep, not a rebuild');
  // the replay: prep mode only, the same view, the tab shown, one turn after the other; cancelled by enterBattle,
  // enterPrepMode and destroy
  assert.match(src, /function replayDeploys\(uids, gap = DEPLOY_REPLAY_MS\) \{\s*if \(destroyed \|\| mode !== 'prep'/);
  assert.match(src, /if \(destroyed \|\| mode !== 'prep'\) return;\s*const \{ uid, v \} = queue\[i\+\+\];\s*if \(!globalThis\.document\?\.hidden && views\.get\('p:' \+ uid\) === v\) landPiece\(v, 'round'\);\s*if \(i < queue\.length\) replayTimer = setTimeout\(turn, step\);/);
  const body = (name) => src.slice(src.indexOf(name), src.indexOf(name) + 900);
  assert.match(body('function enterBattle(meta)'), /cancelReplay\(\);/);
  assert.match(body('function enterPrepMode()'), /cancelReplay\(\);/);
  assert.match(body('    destroy() {\n      if (destroyed) return;'), /cancelReplay\(\);/);
  assert.match(src, /audio: opts\.audio \|\| null,/, 'the views reach the audio manager');
});
