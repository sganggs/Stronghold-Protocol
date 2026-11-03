// GitHub #839 鸭爵 「神秘顾客」 「每回合将有0~2名敌人被替换」 (PRTS 卫戍协议：盟约 下半/PRTS盟约记录; effect key
// round_start_all_player_change_enemy_2): one draw per round for every player — the same count, the same units — from the
// round's own wave, whatever bounties each player carries (they are inserted per player and re-time their host action's
// own units: waves.js withBounties); only lower-lane units; the swapped-in kind one per player and round (the reporter's
// recordings of 2026-10-23: 2鼠 / 2狗 / 2鼠 / 2鸭, all on the lower lane). server/sim/content/bands/meta.js duckPicks /
// applyDuckPicks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, DATA } from './harness.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { applyDuckPicks } from '../../server/sim/content/bands/meta.js';
import { gateOf } from '../../shared/constants.js';

const REG = createRegistry({ log: { warn() {}, error() {}, info() {} } });
const BOUNTY = DATA.choices.cards.bounty.filter((c) => c.payout === 'kill' && c.enemyKey && DATA.enemies[c.enemyKey]?.stats?.motion !== 'FLY');

const swapsOf = (spawns) => spawns.filter((s) => s.tag === 'duck').map((s) => `${s.actionIndex}:${s.routeIndex}`).sort();
const kindsOf = (spawns) => [...new Set(spawns.filter((s) => s.tag === 'duck').map((s) => s.enemyKey))];
const ownCount = (spawns) => spawns.filter((s) => s.tag !== 'bounty').reduce((n, s) => n + (s.count || 1), 0);

test('#839 同盟: the four players get the same 鸭爵 swaps each round (count, units) on the lower lane, one kind each, with different bounties', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 3, seed: 839, registry: REG, fake: true }).start();
  h.toPrep(6);
  const m = h.m;
  const ps = m.alivePlayers();
  assert.equal(ps.length, 4);
  ps[0].bandId = 'band_ducklord'; // one holder: the swap reaches every teammate
  // different bounties per player: none, one, two, three walker cards
  ps.forEach((p, i) => { p.bounties = BOUNTY.slice(i, 2 * i).map((card, j) => ({ id: `t${i}${j}`, card, roundsLeft: 1, chooser: p.playerId })); });
  assert.deepEqual(ps.map((p) => p.bounties.length), [0, 1, 2, 3]);
  const seed0 = m.seed;
  let swapped = 0, retimed = 0, mixed = 0;
  const hist = [0, 0, 0];
  const routes = m.wave.routes;
  for (let k = 0; k < 60; k++) {
    m.seed = seed0 + k; // another match seed: another round draw
    const lists = ps.map((p) => m._normalOpts(p).spawns);
    const want = swapsOf(lists[0]);
    hist[want.length]++;
    swapped += want.length;
    for (let i = 1; i < 4; i++) assert.deepEqual(swapsOf(lists[i]), want, `player ${i} draw ${k}`);
    // one kind per player (two swaps are the same enemy); the players' kinds are drawn apart
    const kinds = lists.map(kindsOf);
    for (const ks of kinds) assert.ok(ks.length <= 1, `one kind per player: ${ks}`);
    if (want.length && new Set(kinds.map((ks) => ks[0])).size > 1) mixed++;
    for (const l of lists) for (const d of l.filter((s) => s.tag === 'duck')) assert.equal(gateOf(routes[d.routeIndex].start, false), 'lower', 'lower lane');
    for (const l of lists) assert.equal(ownCount(l), ownCount(lists[0]), 'same own enemy count');
    for (const l of lists) for (const d of l.filter((s) => s.tag === 'duck')) assert.deepEqual(d.bounty, { coins: 1, ownerPlayerId: l[0].ownerPlayerId });
    // the preview (stats preview / bot rehearsal path) sees the same swaps and consumes no match stream
    const meta = m.rngMeta.state();
    const pv = m._normalOpts(ps[2], { preview: true }).spawns;
    assert.deepEqual(swapsOf(pv), want, 'preview');
    assert.deepEqual(kindsOf(pv), kinds[2], 'preview: the same kind');
    assert.equal(m.rngMeta.state(), meta);
    const times = lists.map((l) => l.filter((s) => s.tag === 'duck').map((s) => s.time).sort().join());
    if (new Set(times).size > 1) retimed++;
  }
  m.seed = seed0;
  assert.ok(hist.every((n) => n > 0), `0, 1 and 2 swaps all occur: ${hist}`);
  assert.ok(swapped > 0);
  assert.ok(mixed > 0, 'players draw different kinds in some rounds');
  assert.ok(retimed > 0, 'some swapped unit sits in an action the bounties re-time (each player keeps its own time)');
  m.dispose();
});

test('#839 applyDuckPicks finds the k-th own unit of an action across the runs a bounty split it into', () => {
  const key = Object.values(DATA.enemies).find((e) => e.rank === 'NORMAL' && e.stats.motion === 'WALK').key;
  const duck = 'enemy_2001_duckmi_2';
  // action 3: five own units, re-timed around a bounty unit into runs of 2 and 3
  const list = [
    { time: 0, enemyKey: key, routeIndex: 1, count: 2, interval: 2, actionIndex: 3 },
    { time: 5, enemyKey: 'b', routeIndex: 1, count: 1, interval: 0, actionIndex: 3, tag: 'bounty' },
    { time: 6, enemyKey: key, routeIndex: 1, count: 3, interval: 2, actionIndex: 3 },
  ];
  const out = applyDuckPicks(list, [{ action: 3, k: 3, enemyKey: duck }], 'p_1');
  assert.equal(out.length, 1);
  assert.deepEqual({ t: out[0].time, r: out[0].routeIndex, key: out[0].enemyKey, tag: out[0].tag }, { t: 8, r: 1, key: duck, tag: 'duck' });
  assert.equal(list.filter((s) => s.tag !== 'bounty').reduce((n, s) => n + (s.count || 1), 0), 5);
  const units = list.filter((s) => s.tag !== 'bounty' && s.tag !== 'duck').flatMap((s) => Array.from({ length: s.count || 1 }, (_, j) => s.time + j * (s.interval || 0)));
  assert.deepEqual(units.sort((a, b) => a - b), [0, 2, 6, 10], 'the other own units keep their times');
});
