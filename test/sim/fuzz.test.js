// Fuzz: 200 random battles — random real chess lineups on real stages vs real wave templates — run to completion
// with invariants checked along the way (DESIGN §11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Battle } from '../../server/sim/Battle.js';
import { createRng } from '../../server/sim/rng.js';
import { getDefaultSource, spawnsFromTemplate } from '../../server/sim/simdata.js';
import { checkInvariants } from '../helpers/battleHarness.js';

const ds = getDefaultSource();
const quiet = { error() {}, warn() {}, info() {} };

function pools() {
  const chess = ds.chessIds().filter((id) => {
    const r = ds.rawChess(id);
    return r && r.stats && !r.isDiy && r.chessType !== 'DIY' && r.visible !== false && !r.isHidden;
  });
  const stages = ds.stageIds().filter((id) => { const s = ds.getStage(id); return s && s.raw && s.raw.active !== false && s.rows && s.rows.length === 19; });
  const waves = ds.waveIds().filter((id) => { const w = ds.getWave(id); return w && (w.kind === 'normal' || (!w.kind && /_0\d$|_h0[1-6]$/.test(id))); });
  const bossWaves = ds.waveIds().filter((id) => { const w = ds.getWave(id); return w && (w.kind === 'boss' || w.kind === 'hidden'); });
  const escaped = ds.waveIds().filter((id) => { const w = ds.getWave(id); return w && w.kind === 'escaped'; });
  return { chess, stages, waves, bossWaves, escaped };
}

function deployTiles(stage, where = 'normal') {
  const dt = stage.raw.deployTiles?.[where] ?? (where === 'normal' ? { melee: stage.raw.normalDeployTiles?.melee_or_any, rangedOnly: stage.raw.normalDeployTiles?.rangedOnly } : null);
  return { melee: dt?.melee ?? [], ranged: dt?.rangedOnly ?? [] };
}

function lineup(rng, P, stage, n, where = 'normal') {
  const { melee, ranged } = deployTiles(stage, where);
  const used = new Set();
  const units = [];
  let uid = 1;
  for (let i = 0; i < n * 3 && units.length < n; i++) {
    const id = rng.pick(P.chess);
    const c = ds.getChess(id);
    const isRanged = c.position === 'RANGED';
    const tiles = isRanged ? ranged.concat(melee) : melee;
    const free = tiles.filter(([r, cc]) => !used.has(r + ',' + cc));
    if (!free.length) continue;
    const [r, cc] = rng.pick(free);
    used.add(r + ',' + cc);
    units.push({ uid: uid++, kind: 'chess', chessId: id, row: r, col: cc, abs: true, items: [] });
  }
  return units;
}

test('fuzz: 200 random battles on real data run to completion with invariants', () => {
  const P = pools();
  assert.ok(P.chess.length > 100, `chess pool ${P.chess.length}`);
  assert.ok(P.stages.length >= 8, `stages ${P.stages.length}`);
  assert.ok(P.waves.length >= 10, `waves ${P.waves.length}`);
  const N = Number(process.env.SIM_FUZZ_N) || 200;          // SIM_FUZZ_N=2000 for a long soak
  const CHECK_EVERY = Number(process.env.SIM_FUZZ_CHECK_EVERY) || 97;
  const rng = createRng(Number(process.env.SIM_FUZZ_SEED) || 20260927);
  const stats = { cleared: 0, timeout: 0, forced: 0, ticks: 0, ms: 0, kinds: {} };
  for (let i = 0; i < N; i++) {
    const seed = (rng() * 2 ** 32) >>> 0;
    const stageId = rng.pick(P.stages);
    const stage = ds.getStage(stageId);
    const roll = rng();
    let kind = 'normal';
    let waveId = rng.pick(P.waves);
    if (roll < 0.1 && P.bossWaves.length) { waveId = rng.pick(P.bossWaves); kind = ds.getWave(waveId).kind; }
    else if (roll < 0.18 && P.escaped.length) { kind = 'unite'; waveId = rng.pick(P.escaped); }
    const tpl = ds.getWave(waveId);
    const { routes, spawns, maxPlayTime } = spawnsFromTemplate(tpl, { mods: rng() < 0.5 ? { hpMul: 0.8, atkMul: 0.8 } : null });
    let players;
    let sharedBoss = null;
    if (kind === 'boss' || kind === 'hidden') {
      players = [{ playerId: 'A', seat: 0, side: 'L', units: lineup(rng, P, stage, 1 + rng.int(8), 'bossLeft') }];
      if (!tpl.solo) players.push({ playerId: 'B', seat: 1, side: 'R', units: lineup(rng, P, stage, 1 + rng.int(8), 'bossRight') });
      sharedBoss = { hp: 3e5, maxHp: 3e5, damage(pid, a) { this.hp = Math.max(0, this.hp - a); } };
    } else if (kind === 'unite') {
      const a = lineup(rng, P, stage, 1 + rng.int(8));
      const b = lineup(rng, P, stage, 1 + rng.int(8)).map((u) => ({ ...u, col: u.col + 8 }));
      players = [{ playerId: 'A', seat: 0, side: 'L', units: a.map((u) => ({ ...u, carryState: { hpPct: 0.2 + rng() * 0.8, sp: rng.int(20), skillActive: rng() < 0.2 } })) }, { playerId: 'B', seat: 1, side: 'L', colOffset: 8, units: b }];
    } else {
      players = [{ playerId: 'P', seat: 0, side: 'L', units: lineup(rng, P, stage, 1 + rng.int(9)), bonds: {} }];
    }
    stats.kinds[kind] = (stats.kinds[kind] ?? 0) + 1;
    const bossLike = kind === 'boss' || kind === 'hidden';
    const timeLimit = bossLike ? Infinity : (maxPlayTime ?? 60);
    const b = new Battle({
      seed, kind, stageId, routes, spawns, timeLimit, players, sharedBoss, logger: quiet, quiet: true,
      recordEvents: i % 4 === 0, modeId: 'mode_multi_normal', round: 1 + rng.int(13),
    });
    const t0 = performance.now();
    let n = 0;
    const hardCap = bossLike ? 180 : timeLimit + 1;
    while (!b.finished) {
      b.step();
      n++;
      if (n % CHECK_EVERY === 0) checkInvariants(b);
      if (i % 4 === 0 && n % 3 === 0) { b.snapshot(); b.drainEvents(); }
      if (b.time > hardCap) { if (bossLike) b.forceEnd('forced'); else break; }
    }
    stats.ms += performance.now() - t0;
    stats.ticks += n;
    assert.ok(b.finished, `battle ${i} (${kind} ${stageId} ${waveId} seed ${seed}) terminated`);
    if (!bossLike) assert.ok(b.time <= timeLimit + 1, `battle ${i} ended in time (${b.time})`);
    checkInvariants(b);
    assert.equal(b.internalErrorCount ?? 0, 0, `battle ${i} internal errors: ${JSON.stringify(b.errors.slice(0, 2))}`);
    assert.equal(b.errors.length, 0, `battle ${i} errors: ${JSON.stringify(b.errors.slice(0, 2))}`);
    const r = b.result();
    stats[r.reason]++;
    for (const [pid, pp] of Object.entries(r.perPlayer)) {
      // the capsule's own pair: `total` counts only the enemies this field scheduled (`inTotal`), and its numerator
      // never exceeds it. `killed` deliberately keeps the `counted` reading — a runtime split child / summon knocked
      // down counts there — so `killed > total` is legal since PR #157's capsule semantics (a 4-磨砻 round killed 4
      // plus a child reads 5/4 on nothing but `killed/total`; the capsule reads resolved/total = 4/4)
      assert.ok(pp.killedInTotal <= pp.total, `${pid} killedInTotal ≤ total`);
      assert.ok(pp.resolved <= pp.total, `${pid} resolved ≤ total`);
      for (const k of ['damageDealt', 'healingDone', 'bossDamage']) assert.ok(Number.isFinite(pp[k]) && pp[k] >= 0, `${k} finite`);
      // the capsule identity: every one of the field's own enemies is 已解决 — knocked down (killedInTotal) or leaked
      // (leakedInTotal). It replaces the old `killed + counted leaks = total`, which mixed the counted reading with the
      // scheduled denominator and no longer holds (killed counts runtime children, total does not)
      if (r.reason === 'cleared' && kind === 'normal') {
        assert.ok(pp.killed + pp.leaked.filter((l) => l.counted).length >= pp.total, 'every counted enemy killed or leaked');
        assert.equal(pp.killedInTotal + pp.leakedInTotal, pp.total, 'the capsule is full: killedInTotal + leakedInTotal = total');
        assert.equal(pp.resolved, pp.total, 'a cleared normal field resolves its own list');
      }
    }
    JSON.stringify(r);
  }
  // eslint-disable-next-line no-console
  console.log(`fuzz: ${JSON.stringify(stats.kinds)} cleared=${stats.cleared} timeout=${stats.timeout} forced=${stats.forced} avg ${(stats.ms / stats.ticks * 1000).toFixed(1)} µs/tick`);
});
