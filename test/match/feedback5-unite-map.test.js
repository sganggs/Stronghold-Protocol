// 联防's field (GitHub #41 item 3, reverted — see docs/history/0.2.0.md §25.22.11): the battle is fought on the ROUND'S
// own stage again, its left half one helper's field and its right half (+8 columns, where escaped_multi enters) the
// other's, so the stage's water, crates, devices and special tiles are all in the field. Only the ENEMY ROUTES come from
// the escaped template (act2autochess constData escapedBattleTemplateMapSinglePlayer / MultiPlayer = level_act1autochess_
// escaped_single / _multi, the wave templates of the same id in waves.json; waves.js buildUniteWave): one helper →
// escaped_single (enemies enter at col 10), two helpers → escaped_multi (enemies enter at col 18 and pass (9,10)); the
// helpers' pieces stand on their prep tiles ("按休整期位置部署在场"), the first of two shifted 8 columns onto the right half
// ("率先迎敌(即位于右侧阵地)"). 0.2.0 fielded the battle on the template's own road map too (data/stages.json
// kind 'unite', unite.js uniteStageId), which left 联防 with no terrain at all; the two records stay in data as that
// level's record, the field no longer reads them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GEO, PHASE } from '../../shared/constants.js';
import { Battle } from '../../server/sim/Battle.js';
import { createBattleFromSpec } from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { FakeBattle } from './fakeBattle.js';
import { DATA, makeMatch, give, chessOfTier, legalTileFor, checkInvariants } from './harness.js';

/** A real battle that only ends by its time limit (the check follows the enemies, whatever the helpers do). */
class NoFinish extends Battle {
  constructor(o) { super({ ...o, autoFinish: false }); }
}

/**
 * Co-op on 战场#01 (its row 9 is fenced off at cols 5–7: "##Err###rrSrr###rrS##", and it carries crates at (10,5),
 * (10,6) and (11,5)): p_0 leaks 3 enemies, the other players are perfect — 1 helper with 2 humans, 2 helpers with 3.
 * Each helper fields one ranged operator in its corner.
 */
function scenario({ humans, clientCombat }) {
  const h = makeMatch({
    mode: 'coop', humans, seed: 4101 + humans, fake: true, clientCombat,
    script: (b) => (b.kind === 'normal' ? { leaks: { p_0: 3 } } : {}),
  }).start();
  const m = h.m;
  h.toPrep(1);
  h.setStage('act1autochess_m01');
  const ranged = chessOfTier(1, (c) => c.position === 'RANGED').filter((x) => m.pool.has(x));
  const helpers = [];
  for (let i = 1; i < humans; i++) {
    const ps = h.ps(`p_${i}`);
    const id = ranged[i];
    helpers.push({ ps, piece: give(m, ps, id, 'board', legalTileFor(m, ps, id)) });
  }
  h.drive(() => m.phase === PHASE.UNITE);
  return { h, m, helpers };
}

/** The 联防 field's spec / options as the match built them, and a real battle over them. */
function uniteField(m, clientCombat) {
  if (clientCombat) {
    const f = m.fields[0];
    return { opts: f.spec, battle: createBattleFromSpec(f.spec, new DataSource(DATA, null), { BattleClass: NoFinish, recordEvents: false }) };
  }
  const u = FakeBattle.instances.find((b) => b.kind === 'unite');
  return { opts: u.opts, battle: new NoFinish({ ...u.opts, data: m.ds, logger: { warn() {}, error() {}, info() {}, debug() {} } }) };
}

for (const clientCombat of [true, false]) {
  test(`联防 with 1 helper (${clientCombat ? 'client-side combat' : 'server-run'}): the round's stage — its fences and crates are in the field — on the escaped_single routes`, () => {
    const { m, helpers } = scenario({ humans: 2, clientCombat });
    assert.deepEqual(m.unitePlan.helpers.map((p) => p.playerId), ['p_1']);
    const { opts, battle: b } = uniteField(m, clientCombat);
    assert.equal(opts.stageId, m.stageId, 'the round\'s own battlefield');
    assert.equal(opts.stageId, 'act1autochess_m01');
    assert.deepEqual(opts.rect, GEO.UNITE_RECT, 'both halves of the round\'s stage (cols 0–20)');
    assert.equal(b.stage.id, 'act1autochess_m01');
    // the terrain 0.2.0's template map had none of: 战场#01's crates and its fenced row 9 are in the field
    assert.ok(b.stage.devices.some((d) => d.role === 'crate'), `crates of 战场#01 (of ${b.stage.devices.length} devices)`);
    assert.equal(m.stage.rows[9].slice(5, 8), '###', '战场#01 itself is fenced off there');
    for (const c of [5, 6, 7]) assert.ok(!b.grid.groundPassable(9, c), `(9,${c}) is fenced off, not road`);
    assert.ok(b.grid.groundPassable(9, 10), '(9,10) is the gate the escaped_single routes start on');
    // the routes of escaped_single: every one starts at col 10
    assert.ok(opts.routes.every((r) => (r.start ?? [r.startPosition?.row, r.startPosition?.col])[1] === 10));
    // the helper's piece stands on its prep tile
    const { ps, piece } = helpers[0];
    const [r, c] = [...ps.board.entries()].find(([, p]) => p === piece)[0].split(',').map(Number);
    b.step();
    const u = b.allyUnits.find((x) => x.uid === piece.uid && x.ownerId === 'p_1');
    assert.deepEqual([u.tileR, u.tileC], [r, c]);
    // a walker keeps off the fenced tiles (the template map has road there) and still crosses the field
    const crossed = new Set();
    while (b.time < 60 && !b.finished) {
      b.step();
      for (const e of b.enemies) if (e.alive && e.motion !== 'FLY') crossed.add(`${Math.round(e.y)},${Math.round(e.x)}`);
    }
    assert.ok(crossed.size > 0, `a walker moved (${[...crossed].sort().join(' ')})`);
    assert.ok(!['9,5', '9,6', '9,7'].some((k) => crossed.has(k)), `no walker on the fenced tiles (${[...crossed].sort().join(' ')})`);
    assert.equal(b.errorCount || 0, 0);
    checkInvariants(m);
    m.dispose();
  });
}

test('联防 with 2 helpers: the round\'s stage — the first helper on the right half (col + 8), the escaped_multi routes — and the client draws the round\'s stage', () => {
  const { h, m, helpers } = scenario({ humans: 3, clientCombat: false });
  const order = m.unitePlan.helpers.map((p) => p.playerId);
  assert.equal(order.length, 2);
  const { opts, battle: b } = uniteField(m, false);
  assert.equal(opts.stageId, m.stageId);
  assert.equal(b.stage.id, m.stageId);
  assert.ok(b.stage.devices.length > 0, 'the round stage\'s devices');
  assert.deepEqual(opts.players.map((p) => [p.playerId, p.colOffset]), [[order[0], 8], [order[1], 0]]);
  assert.ok(opts.routes.every((r) => r.start[1] === 18), 'every route enters at col 18');
  assert.ok(opts.routes.filter((r) => r.motion === 'WALK').every((r) => r.checkpoints.some(([rr, cc]) => rr === 9 && cc === 10)), 'walkers pass (9,10)');
  b.step();
  for (const { ps, piece } of helpers) {
    const [r, c] = [...ps.board.entries()].find(([, p]) => p === piece)[0].split(',').map(Number);
    const u = b.allyUnits.find((x) => x.uid === piece.uid && x.ownerId === ps.playerId);
    const off = ps.playerId === order[0] ? 8 : 0;
    assert.deepEqual([u.tileR, u.tileC], [r, c + off], `${ps.playerId}: its prep tile${off ? ' on the right half' : ''}`);
  }
  // what a watching browser receives: the m.field of the 联防 carries the stage it is drawn on
  m.handle('p_0', { t: 'g.watch', fieldId: 'u' });
  const meta = h.lastTo('p_0', 'm.field');
  assert.equal(meta && meta.stageId, m.stageId);
  assert.equal(m.stageId, 'act1autochess_m01', 'the match stage (m.public stageId, the boards) is that same stage');
  checkInvariants(m);
  m.dispose();
});

test('the 联防 field does not read the kind: \'unite\' stage records — data without them still fields the round\'s stage, and the wave template still routes the enemies', () => {
  const stages = Object.fromEntries(Object.entries(DATA.stages).filter(([, s]) => s.kind !== 'unite'));
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 4199, fake: true, data: { ...DATA, stages }, script: (b) => (b.kind === 'normal' ? { leaks: { p_0: 2 } } : {}) }).start();
  const m = h.m;
  h.toPrep(1);
  const ps = h.ps('p_1');
  const id = chessOfTier(1, (c) => c.position === 'RANGED').find((x) => m.pool.has(x));
  give(m, ps, id, 'board', legalTileFor(m, ps, id));
  h.drive(() => m.phase === PHASE.UNITE);
  const u = FakeBattle.instances.find((b) => b.kind === 'unite');
  assert.equal(u.opts.stageId, m.stageId, 'the round\'s stage, with or without the 联防 stage records');
  assert.equal(u.opts.waveId, 'act1autochess_escaped_single', 'the wave template of the helper count still routes them');
  m.dispose();
});
