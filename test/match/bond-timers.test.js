// #746: actual runner/Worker packets, manual pacing clock (never used to calculate HUD remaining time).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { InPageSimHost, WorkerSimHost } from '../../public/js/battle/simHost.js';
import { loadBrowserSim } from '../../public/js/battle/simLoader.js';
import { createBattleRunner } from '../../public/js/battle/runner.js';
import { createStore, initialState } from '../../public/js/store.js';
import { selectedBondTimers } from '../../public/js/ui/bondTimers.js';
import { snapFrame } from '../../server/match/fields.js';
import { fixtureSet, fixtureSpec } from '../helpers/simHostFixture.js';

function remote() {
  return new WorkerSimHost({ workerFactory: () => {
    const w = new Worker(new URL('../helpers/simWorkerNode.mjs', import.meta.url));
    const port = { postMessage: m => w.postMessage(m), terminate: () => w.terminate() };
    w.on('message', data => port.onmessage?.({ data })); w.on('error', e => port.onerror?.(e));
    return port;
  } });
}
const local = () => new InPageSimHost({ loadSim: c => loadBrowserSim({ ...c, base: new URL('../../server/sim/', import.meta.url).href }) });
const specOf = () => ({ ...fixtureSpec(), timeLimit: 80, spawns: [{ time: 75, enemyKey: 'enemy_1001_bigbo', count: 1, routeIndex: 0 }],
  players: [{ playerId: 'p1', units: [{ uid: 1, chessId: 'chess_char_1_07_a', row: 10, col: 4 }],
    bonds: { siracusaShip: { active: true, count: 6, tier: 2, layers: 0 } } }] });

test('server-equivalent in-page and actual Worker snapshots carry identical timers through expiry and fresh starts', async t => {
  const a = local(), b = remote(), set = fixtureSet(), spec = specOf();
  t.after(() => { a.stop(); b.stop(); });
  await a.load(set.cs, set); await b.load(set.cs, set); a.start(spec); await b.start(spec);
  for (const n of [1, 30, 600, 330, 300]) {
    const x = a.step(n), y = await b.step(n);
    assert.deepEqual(y.snap, x.snap);
    const wire = JSON.parse(JSON.stringify(snapFrame(spec.fieldId, x.snap)));
    assert.equal(wire.gt, x.snap.t);
    assert.deepEqual(wire.bondTimers, y.snap.bondTimers, 'server snapshot transport preserves the same metadata');
    assert.deepEqual(JSON.parse(JSON.stringify(x.snap)).bondTimers, x.snap.bondTimers);
  }
  assert.equal(a.battle.snapshot().bondTimers, undefined, 'both windows expired');
  a.start(spec); await b.start(spec); a.step(1); await b.step(1);
  assert.deepEqual(b.battle.snapshot(), a.battle.snapshot());
  assert.deepEqual(a.battle.snapshot().bondTimers[0][1].map(r => r.id), ['siracusaAspd', 'siracusaStealth']);
});

for (const worker of [false, true]) test(`runner ${worker ? 'Worker' : 'in-page'}: pause, 1×/2×, watched field and reconnect use simulation snapshots`, async t => {
  const set = fixtureSet(), snapshots = [], store = createStore(initialState);
  store.patch('match', { public: { phase: 'COMBAT', paused: false } });
  let now = 1000;
  const doc = { hidden: false };
  const runner = createBattleRunner({ net: { on: () => () => {}, send: () => true, request: async () => ({}) }, store,
    contentFor: async () => set, simContent: () => set, vanillaCs: () => worker ? 'b'.repeat(64) : set.cs,
    ...(worker ? {} : { loadSim: () => loadBrowserSim({ ...set, base: new URL('../../server/sim/', import.meta.url).href }) }),
    createHost: () => worker ? remote() : local(), raf: () => 1, caf: () => {}, setInterval: () => 1,
    clearInterval: () => {}, now: () => now, doc });
  t.after(() => runner.dispose());
  runner.on('snap', s => snapshots.push(s));
  async function frame(ms) {
    now += ms; runner._frame();
    for (let i = 0; i < 1000 && [...runner._entries.values()].some(e => e.stepping); i++) await new Promise(r => setTimeout(r, 2));
    assert.ok([...runner._entries.values()].every(e => !e.stepping), 'worker step completed');
  }
  for (const speed of [1, 2]) {
    runner.clear(); snapshots.length = 0;
    const spec = { ...specOf(), cs: set.cs, battleId: `speed-${speed}` };
    await runner.onStart({ battleId: spec.battleId, fieldId: spec.fieldId, authoritative: true, speed, spec });
    for (let i = 0; i < 10; i++) await frame(100);
    const e = runner._entries.get(spec.battleId), before = e.battle.snapshot();
    const left = before.bondTimers[0][1][0].remaining;
    assert.ok(Math.abs(left - (32 - speed)) < 0.2, `${speed}×: ${left}`);
    store.patch('match', { public: { phase: 'COMBAT', paused: true } }); await frame(5000);
    assert.deepEqual(e.battle.snapshot(), before);
    store.patch('match', { public: { phase: 'COMBAT', paused: false } }); for (let i = 0; i < 10; i++) await frame(100);
    assert.ok(Math.abs(e.battle.snapshot().bondTimers[0][1][0].remaining - (left - speed)) < 0.2);
    assert.ok(snapshots.some(s => s.bondTimers?.length), 'production feed carries timer metadata');
  }
  runner.clear(); doc.hidden = true; // Catch-up yields via a timer; ordinary frames above stay manually driven.
  const spec = { ...specOf(), cs: set.cs, battleId: 'watch', fieldId: 'n:p2' };
  await runner.onStart({ battleId: 'watch', fieldId: 'n:p2', authoritative: false, watch: true, elapsed: 7, speed: 2, spec });
  const snap = runner._entries.get('watch').battle.snapshot();
  const id = snap.bondTimers[0][0];
  assert.equal(selectedBondTimers(snap, 'n:p1', id).length, 0);
  assert.ok(Math.abs(selectedBondTimers(snap, 'n:p2', id)[0].remaining - 25) < 0.2, 'late join starts at caught-up sim time');
  runner.clear();
  await runner.onStart({ battleId: 'watch', fieldId: 'n:p2', authoritative: false, watch: true, elapsed: 7, speed: 2, spec });
  assert.equal(snapshots.at(-1).fieldId, 'n:p2');
  assert.deepEqual(snapshots.at(-1).bondTimers, snap.bondTimers);
});
