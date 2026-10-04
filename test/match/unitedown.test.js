// test/match/unitedown.test.js — user playtest #5 item 2: an operator knocked out (濒死) in a 联防 helper's own combat
// vanished in the 联防 phase instead of keeping its redeploy countdown and redeploying (unite.js left it out of the
// battle input). Official (PRTS 卫戍协议/帮助 §联防阶段): "部署完成后，将对应单位的生命比例、技力修改至与上一阶段结束时相同
// （召唤物仅修改技力，上一阶段为退场状态的干员强制退场）" — it is deployed with everyone and forced out at once: down on its
// own tile with the redeploy ring, its timer running, and back like after any knock-out (tile free, DP ≥ cost).
// The match builds the input (both combat modes); the real sim runs it the way the authority, the display replicas
// (partner, observers) and the server fallback do.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { Battle } from '../../server/sim/Battle.js';
import { createBattleFromSpec } from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { DOWN_STATE, FORCED_EXIT } from '../../server/sim/constants.js';
import { FakeBattle } from './fakeBattle.js';
import { DATA, makeMatch, give, chessOfTier, legalTileFor, checkInvariants } from './harness.js';

/** A Battle that never ends by itself (the check needs the whole redeploy timer, whatever the enemies do). */
class NoFinish extends Battle {
  constructor(o) { super({ ...o, autoFinish: false, timeLimit: 1e6 }); }
}

const downOf = (b, id) => (b.snapshot().down || []).find((d) => d[0] === id) || null;

/**
 * p_0 leaks; p_1 and p_2 are perfect. p_1 (more units: the right-hand field) and p_2 each have an operator knocked out
 * at the end of their own combat next to one that stands.
 */
function scenario(clientCombat) {
  const dead = new Set();
  const h = makeMatch({
    mode: 'coop', humans: 3, seed: 3702, fake: true, clientCombat,
    script: (b) => (b.kind === 'normal' ? { leaks: { p_0: 3 }, deadUids: [...dead] } : {}),
  }).start();
  const m = h.m;
  h.toPrep(1);
  const melee = chessOfTier(1, (c) => c.position === 'MELEE').filter((x) => m.pool.has(x));
  const ranged = chessOfTier(1, (c) => c.position === 'RANGED').filter((x) => m.pool.has(x));
  const place = (ps, id) => give(m, ps, id, 'board', legalTileFor(m, ps, id));
  const p1 = h.ps('p_1'), p2 = h.ps('p_2');
  const down1 = place(p1, melee[0]);
  const up1 = place(p1, ranged[0]);
  place(p1, ranged[1]);                 // p_1 fields more units: the first helper, on the right-hand half
  const down2 = place(p2, melee[1]);
  const up2 = place(p2, ranged[2]);
  dead.add(down1.uid);
  dead.add(down2.uid);
  h.drive(() => m.phase === PHASE.UNITE);
  assert.deepEqual(m.unitePlan.helpers.map((p) => p.playerId), ['p_1', 'p_2']);
  return { h, m, down1, up1, down2, up2 };
}

/** The 联防 field's battle input and a real battle built from it, as each combat mode builds it. */
function uniteBattle(m, clientCombat) {
  if (clientCombat) {
    const f = m.fields[0];
    assert.equal(f.fieldId, 'u');
    // a browser (authority or display replica) builds the battle from the spec over its own copy of the data
    return { players: f.spec.players, battle: createBattleFromSpec(f.spec, new DataSource(DATA, null), { BattleClass: NoFinish, recordEvents: true }) };
  }
  const u = FakeBattle.instances.find((b) => b.kind === 'unite');
  return { players: u.opts.players, battle: new NoFinish({ ...u.opts, data: m.ds, logger: { warn() {}, error() {}, info() {}, debug() {} } }) };
}

for (const clientCombat of [true, false]) {
  test(`联防 (${clientCombat ? 'client-side combat' : 'server-run fallback'}): a helper's operator knocked out in its own combat enters down on its tile, counts down and redeploys`, () => {
    const { h, m, down1, up1, down2, up2 } = scenario(clientCombat);
    const { players, battle: b } = uniteBattle(m, clientCombat);
    // the input: the knocked-out operators are fielded, flagged `down`; the standing ones carry HP% / SP
    const inp = (pid, uid) => players.find((p) => p.playerId === pid).units.find((x) => x.uid === uid);
    assert.deepEqual(inp('p_1', down1.uid)?.carryState, { down: true }, 'the right-hand helper\'s knocked-out operator is in the 联防 battle');
    assert.deepEqual(inp('p_2', down2.uid)?.carryState, { down: true }, 'the left-hand helper\'s too');
    assert.deepEqual(inp('p_1', up1.uid).carryState, { hpPct: 0.5, sp: 3 });
    assert.deepEqual(inp('p_2', up2.uid).carryState, { hpPct: 0.5, sp: 3 });

    b.step();
    const unitOf = (uid, pid) => b.allyUnits.find((u) => u.uid === uid && u.ownerId === pid);
    for (const [piece, pid] of [[down1, 'p_1'], [down2, 'p_2']]) {
      const u = unitOf(piece.uid, pid);
      assert.ok(u, `${pid}: its unit exists`);
      assert.ok(!u.alive && b.isDown(u), `${pid}: knocked out on the field from the start`);
      const d = downOf(b, u.id);
      assert.ok(d, `${pid}: in b.snap down (the redeploy ring)`);
      assert.ok(Math.abs(d[2] - u.base.respawnTime) < 0.011, `${pid}: its full redeploy timer (${d[2]} s)`);
      assert.equal(d[3], DOWN_STATE.COUNTING);
      assert.ok(b.fieldMeta().units.some((x) => x.id === u.id), `${pid}: a client joining the field shows it down`);
      assert.equal(u.removeReason, FORCED_EXIT);
    }
    const board1 = [...h.ps('p_1').board.entries()].find(([, p]) => p.uid === down1.uid)[0].split(',').map(Number);
    const u1 = unitOf(down1.uid, 'p_1');
    assert.deepEqual([u1.tileR, u1.tileC], [board1[0], board1[1] + 8], 'the first helper holds the right-hand half (colOffset +8), on its board tile');
    assert.ok([unitOf(up1.uid, 'p_1'), unitOf(up2.uid, 'p_2')].every((u) => u.alive && u.deployed), 'the standing operators fight');

    // redeploy: after the timer, on its own tile, at full HP (DP init 10 + 1/s ≥ cost by then)
    for (const [piece, pid] of [[down1, 'p_1'], [down2, 'p_2']]) {
      const u = unitOf(piece.uid, pid);
      const home = [u.homeR, u.homeC];
      while (b.time < u.respawnAt + 0.2 && !u.alive) b.step();
      assert.ok(u.alive && u.deployed, `${pid}: redeployed at ${b.time.toFixed(2)} s (respawnAt ${u.respawnAt.toFixed(2)})`);
      assert.deepEqual([u.tileR, u.tileC], home, `${pid}: on its own tile`);
      assert.ok(Math.abs(u.hp - u.s.maxHp) < 1e-6, `${pid}: full HP on redeploy (${u.hp} / ${u.s.maxHp})`);
      assert.equal(downOf(b, u.id), null);
    }
    checkInvariants(m);
    m.dispose();
  });
}

test('the docs describe the rule (docs/META.md §4, docs/SIM.md §1.1 / §9, docs/PLAYING.md §5)', async () => {
  const { readFileSync } = await import('node:fs');
  const read = (f) => readFileSync(new URL(`../../docs/${f}`, import.meta.url), 'utf8');
  const META = read('META.md'), SIM = read('SIM.md'), PLAYING = read('PLAYING.md');
  assert.match(META, /knocked out at the end of the helper's own\s+combat carries `\{ down: true \}`/);
  assert.ok(!/stays out of the 联防 battle/.test(META), 'META: the old "stays out" rule is gone');
  assert.ok(!/do not take part in the 联防 battle/.test(META), 'META §7: the old assumption is gone');
  assert.match(META, /knocked out at the end of its own combat is deployed and forced out at once/);
  assert.match(SIM, /`carryState: \{ down: true \}`/);
  assert.match(SIM, /reason `'killed'` or `FORCED_EXIT`/);
  assert.match(PLAYING, /作战结束时已被击倒的干员在原位倒地/);
  assert.ok(!/已倒下的干员不参加/.test(PLAYING));
});
