// 最终攻势 leader HP: the pool is sized from the LIVING players at the moment that boss fight starts and LOCKED there
// (user rule, 2026-10-05: 「根据存活人数动态缩放，但是在 boss 开战后就锁定血量不再变更。普通 boss 和隐藏 boss 开战后
// 分别计算当时存活的玩家数。」 — DESIGN §20.10). This supersedes the seat-count reading of upstream issue #113.
//   * `bossHpScale.aliveScaling` (default ON) = scale by the living players at the fight's start; `false` = the seats the
//     match runs with, i.e. the pre-change behaviour (`bossHpScale.playerScaling` stays the master switch: `false` ⇒ the
//     data value whatever the count).
//   * "locked at the fight start": the pool is created once in `Match.startFinalAssault` from `alivePlayers()`, and an
//     elimination in the middle of the fight (a death or a 中途退出) never recomputes it — the pool and the leader unit
//     keep the max of that moment.
//   * the normal leader and the hidden one are two fights: each captures the living count of its own start.
// Real bot matches (real sim, server-run fields) plus unit-level checks of `bossPoolShare`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch, DATA } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { bossPoolHp } from '../../server/match/finalAssault.js';

/**
 * A co-op bot match driven to the Final Assault. `drop` seats get LP 0 in the prep of the last round before the boss
 * round, so the settle of that round eliminates them — an elimination BEFORE the fight (the pool must be smaller).
 */
function toFinalAssault({ difficulty = 'HARD', seed = 3, bossId = 'boss_5', seats: seatCount = 4, drop = 0, data = DATA } = {}) {
  const seats = Array.from({ length: seatCount }, (_, i) => ({ seat: i, playerId: `ai_${i}`, name: `AI${i}`, isBot: true, connected: true }));
  const h = makeMatch({ mode: 'coop', difficulty, seats, seed, data, captureFrames: false, instant: false });
  const m = h.m;
  m.bossId = bossId;
  m.start();
  let last = '';
  let dropped = false;
  h.run(() => {
    const k = `${m.phase}:${m.round}`;
    if (k !== last) {
      last = k;
      if (m.phase === PHASE.PREP && m.round === 1) for (const ps of m.players.values()) ps.lp = 400;
      if (drop && !dropped && m.phase === PHASE.PREP && m.round === m.gd.bossRound - 1) {
        dropped = true;
        for (const ps of [...m.players.values()].slice(seatCount - drop)) ps.lp = 0;
      }
    }
    return h.ended != null || m.phase === PHASE.FINAL_ASSAULT;
  }, { maxSteps: 8e6 });
  assert.equal(m.phase, PHASE.FINAL_ASSAULT, `reached the Final Assault (${m.phase} R${m.round}${h.ended ? ', ended' : ''})`);
  return h;
}

test('leader pool: the LIVING players at the fight start are the factor (default); the seats are the off switch', () => {
  // user rule 2026-10-05 (DESIGN §20.10); upstream issue #113 read the same report as the room's seats — superseded.
  const raw = new GameData(DATA, 'mode_multi_hard');
  assert.equal(bossPoolHp(raw, 'boss_1', 4, 4), 1800000, 'four living ⇒ the data value');
  assert.equal(bossPoolHp(raw, 'boss_1', 4, 2), 900000, 'two living of a four-seat room ⇒ half');
  assert.equal(bossPoolHp(raw, 'boss_1', 4, 1), 450000, 'one living ⇒ a quarter');
  assert.equal(bossPoolHp(raw, 'boss_1', 2, 2), 900000, 'a two-seat room with both alive ⇒ half');
  assert.equal(bossPoolHp(raw, 'boss_1', 2, 1), 450000, 'a two-seat room with one alive ⇒ a quarter');
  assert.equal(bossPoolHp(raw, 'boss_1', 4), 1800000, 'no living count given ⇒ a full team');
  assert.equal(bossPoolHp(raw, 'boss_1', 4, 9), 1800000, 'never above the data value');
  // `aliveScaling: false` = the seats (the behaviour the seat-count version shipped)
  const { tuning, ...RAW } = DATA; // eslint-disable-line no-unused-vars
  const seatScale = (extra) => new GameData({ ...RAW, config: { ...RAW.config, bossHpScale: { ...RAW.config.bossHpScale, ...extra },
    modes: { ...RAW.config.modes, mode_multi_hard: { ...RAW.config.modes.mode_multi_hard, bossHpScale: { ...RAW.config.modes.mode_multi_hard.bossHpScale, ...extra } } } } }, 'mode_multi_hard');
  const off = seatScale({ aliveScaling: false });
  assert.equal(bossPoolHp(off, 'boss_1', 4, 2), 1800000, 'aliveScaling false: four seats ⇒ the data value, whatever the living count');
  assert.equal(bossPoolHp(off, 'boss_1', 2, 2), 900000, 'aliveScaling false: two seats ⇒ half');
  // playerScaling stays the master switch: no factor at all
  const none = seatScale({ playerScaling: false });
  for (const n of [4, 2, 1]) assert.equal(bossPoolHp(none, 'boss_1', n, n), 1800000, `playerScaling false, ${n} players: the data value`);
  assert.equal(bossPoolHp(none, 'boss_1', 4, 1), 1800000, 'playerScaling false: the living count is not read either');
  // solo is untouched (× bossHpScale.solo)
  const solo = new GameData(DATA, 'mode_single_hard');
  assert.equal(bossPoolHp(solo, 'boss_5', 4, 1), Math.round(DATA.bosses.boss_5.bloodPoint.HARD * 0.25), 'solo: × 0.25 whatever the counts');
  assert.equal(bossPoolHp(solo, 'boss_5'), Math.round(DATA.bosses.boss_5.bloodPoint.HARD * 0.25));
});

test('co-op: an elimination BEFORE the fight shrinks the pool; an elimination DURING the fight does not (locked)', () => {
  const bp = DATA.bosses.boss_5.bloodPoint.HARD;
  const h = toFinalAssault({ drop: 2 });
  const m = h.m;
  assert.equal(m.players.size, 4, 'a four-seat co-op room');
  assert.equal(m.alivePlayers().length, 2, 'two seats were eliminated before the boss round');
  assert.equal(m.bossPool.maxHp, Math.round(bp / 2), 'two living at the fight start ⇒ half the bloodPoint pool');
  // the leader UNIT shows exactly that pool (Battle._syncBossHp)
  const field = m.fields.find((f) => f.battle);
  for (let i = 0; i < 3000 && !field.battle.enemies.some((e) => e.alive && e.isBoss); i++) field.battle.step();
  const leader = field.battle.enemies.find((e) => e.alive && e.isBoss);
  assert.ok(leader, 'the leader spawned');
  assert.equal(leader.s.maxHp, m.bossPool.maxHp, 'the leader unit max HP = the locked pool');
  assert.equal(leader.hp, m.bossPool.hp, 'and its HP = the pool');
  // a THIRD player is eliminated in the middle of the fight: the pool is locked at the fight start, it neither shrinks
  // to one quarter nor changes at all (DESIGN §20.10 "开战后就锁定血量不再变更")
  const max = m.bossPool.maxHp;
  const hp = m.bossPool.hp;
  const third = m.alivePlayers()[0];
  third.lp = 0;
  third.eliminate(m.round);
  assert.equal(m.alivePlayers().length, 1, 'one living player left mid-fight');
  assert.equal(m.bossPoolAlive, 2, 'the stored count stays at the fight start');
  assert.equal(m.bossPool.maxHp, max, 'the pool stays locked at the fight start (2 living), not 1');
  assert.equal(m.bossPool.hp, hp, 'and its current HP is untouched');
  assert.equal(leader.s.maxHp, max, 'the leader unit keeps the locked max');
  assert.equal(leader.hp, m.bossPool.hp, 'and its HP is still the pool');
  assert.equal(m.publicView().bossHp.max, max, 'the protocol frame (b.snap / poolMax) reports the locked pool');
  m.dispose();
});

test('co-op with every seat alive: the full pool (regression guard for the 4-living case)', () => {
  const bp = DATA.bosses.boss_5.bloodPoint.HARD;
  const h = toFinalAssault({});
  assert.equal(h.m.alivePlayers().length, 4);
  assert.equal(h.m.bossPool.maxHp, bp, 'four living at the fight start ⇒ the data value');
  h.m.dispose();
});

test('co-op: one of four seats eliminated before the boss round ⇒ three quarters of the pool', () => {
  const bp = DATA.bosses.boss_5.bloodPoint.HARD;
  const h = toFinalAssault({ drop: 1 });
  assert.equal(h.m.alivePlayers().length, 3, 'three living when the boss fight starts');
  assert.equal(h.m.bossPoolAlive, 3, 'the fight start count is the one stored');
  assert.equal(h.m.bossPool.maxHp, Math.round((bp * 3) / 4), 'three living ⇒ three quarters');
  h.m.dispose();
});

test('hidden boss: its own living count at its own fight start (normal 4, hidden 3 after a loss between the fights)', () => {
  const seats = [0, 1, 2, 3].map((i) => ({ seat: i, playerId: `ai_${i}`, name: `AI${i}`, isBot: true, connected: true }));
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', seats, seed: 7, captureFrames: false, instant: false, clientCombat: true });
  const m = h.m;
  m.bossId = 'boss_5';
  m.hiddenBossId = 'boss_9';
  m.start();
  let last = '';
  const step = () => {
    const k = `${m.phase}:${m.round}`;
    if (k === last) return;
    last = k;
    if (m.phase === PHASE.PREP && m.round === 1) for (const ps of m.players.values()) ps.lp = 400;
    if (m.phase === PHASE.PREP && m.round === m.gd.bossRound) {
      for (const ps of m.alivePlayers()) {
        for (const id of m.gd.bondIds) if (ps.bonds[id] && ps.bonds[id].active) ps.layers[id] = (ps.layers[id] || 0) + 100;
        ps.recompute();
      }
    }
  };
  const runTo = (pred, why) => {
    const ok = h.run(() => { step(); return h.ended != null || pred(); }, { maxSteps: 8e6 });
    assert.ok(ok && pred(), `${why} (${m.phase} R${m.round}${h.ended ? ', ended' : ''})`);
  };
  runTo(() => m.phase === PHASE.FINAL_ASSAULT, 'reached the Final Assault');
  assert.equal(m.alivePlayers().length, 4, 'four living when the normal boss fight starts');
  const normalMax = m.bossPool.maxHp;
  assert.equal(normalMax, DATA.bosses.boss_5.bloodPoint.HARD, 'the normal leader locked the four living players');
  // a player is lost WHILE the normal leader is fought: its pool must not move (the lock) …
  const lost = m.alivePlayers()[3];
  lost.lp = 0;
  lost.eliminate(m.round);
  assert.equal(m.bossPool.maxHp, normalMax, 'the normal pool is locked: the mid-fight elimination does not change it');
  runTo(() => m.phase === PHASE.HIDDEN_CORE, 'reached the Hidden Core');
  assert.equal(m.alivePlayers().length, 3, 'three living when the hidden boss fight starts');
  assert.equal(m.bossPoolAlive, 3, 'the hidden fight stored its own living count');
  const hiddenMax = m.bossPool.maxHp;
  assert.equal(hiddenMax, Math.round((DATA.bosses.boss_9.bloodPoint.HARD * 3) / 4), 'the hidden leader computed its OWN three living players');
  assert.notEqual(hiddenMax, normalMax, 'the two fights are sized apart');
  assert.equal(m.hiddenReached, true, 'the R14 win unlocked the Hidden Core');
  m.dispose();
});

test('bossHpScale.aliveScaling: false reproduces the seat-count behaviour (the reverted switch)', () => {
  const bp = DATA.bosses.boss_5.bloodPoint.HARD;
  const data = { ...DATA, config: { ...DATA.config, bossHpScale: { ...DATA.config.bossHpScale, aliveScaling: false },
    modes: { ...DATA.config.modes, mode_multi_hard: { ...DATA.config.modes.mode_multi_hard, bossHpScale: { ...DATA.config.modes.mode_multi_hard.bossHpScale, aliveScaling: false } } } } };
  const gd = new GameData(data, 'mode_multi_hard');
  assert.equal(gd.bossPoolHp('boss_5', 4, 2), bp, 'four seats, two living: the data value (the pre-change behaviour)');
  assert.equal(gd.bossPoolHp('boss_5', 2, 1), Math.round(bp / 2), 'two seats, one living: half');
  const h = toFinalAssault({ drop: 2, data });
  assert.equal(h.m.alivePlayers().length, 2, 'two of four seats eliminated before the fight');
  assert.equal(h.m.bossPool.maxHp, bp, 'switch off: the room seats are the factor, the two living players are not');
  h.m.dispose();
});
