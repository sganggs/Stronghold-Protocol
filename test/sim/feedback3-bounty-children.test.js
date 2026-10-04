// GitHub #67 / #89-2: a split or summoned child must not carry the kill bounty. The main body does.
// Owner 2026-10-04: the bounty stays on the body only.
//
// spawnChildren used to copy parent.mods, bountyId and bountyCoins included, so a leaked child paid the
// card again in 联防 (planUnite reads those fields). planUnite also paid any leak whose bountyId matched a
// card, even when the enemy was not the card's enemy.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { spawnChildren } from '../../server/sim/content/enemies.js';
import { planUnite } from '../../server/match/unite.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';

const REAL = { skip: !hasGeneratedData() };

function parentBattle() {
  return makeBattle({
    content: 'none', autoFinish: false, timeLimit: 30,
    defs: {
      enemies: {
        enemy_parent: enemyRec({ key: 'enemy_parent', hp: 100, speed: 0 }),
        enemy_child: enemyRec({ key: 'enemy_child', hp: 100, speed: 0 }),
      },
    },
    enemies: [{
      key: 'enemy_parent', pos: [10, 6],
      mods: { hpMul: 2, atkMul: 1.5, bountyId: 'b1', bountyCoins: 8 },
      bounty: { coins: 8, ownerPlayerId: 'p1' },
    }],
  });
}

const coinsOf = (h) => h.eventsOf('bounty').reduce((s, e) => s + e[2], 0);

test('spawnChildren keeps the stat mods and drops bountyId and bountyCoins', () => {
  const h = parentBattle();
  h.step();
  const parent = h.enemy('enemy_parent');
  const kids = spawnChildren(h.b, parent, 'enemy_child', 2);
  assert.equal(kids.length, 2);
  assert.equal(parent.mods.bountyId, 'b1', 'the body keeps its card id');
  assert.equal(parent.mods.bountyCoins, 8);
  for (const c of kids) {
    assert.equal(c.mods.hpMul, 2);
    assert.equal(c.mods.atkMul, 1.5);
    assert.equal(c.mods.bountyId, undefined);
    assert.equal(c.mods.bountyCoins, undefined);
    assert.equal(c.bounty, null, 'kill payout reads unit.bounty, which a child does not get');
    assert.notEqual(c.mods, parent.mods);
  }
  const explicit = spawnChildren(h.b, parent, 'enemy_child', 1, { mods: { bountyId: 'b9', bountyCoins: 3, defMul: 4 } });
  assert.equal(explicit[0].mods.defMul, 4);
  assert.equal(explicit[0].mods.bountyId, undefined);
  assert.equal(explicit[0].mods.bountyCoins, undefined);
  assert.equal(parent.mods.bountyId, 'b1', 'an explicit child mods object is not the parent\'s');
  // opts.mods null falls through to the parent, then the bounty fields are stripped
  const fallen = spawnChildren(h.b, parent, 'enemy_child', 1, { mods: null });
  assert.equal(fallen[0].mods.hpMul, 2);
  assert.equal(fallen[0].mods.bountyId, undefined);
});

test('killing the body pays its bounty once; killing the children pays nothing', () => {
  const h = parentBattle();
  h.step();
  const parent = h.enemy('enemy_parent');
  const kids = spawnChildren(h.b, parent, 'enemy_child', 2);
  h.b.kill(parent, null);
  for (const c of kids) h.b.kill(c, null);
  assert.equal(coinsOf(h), 8);
});

test('磨砻 on death spawns children that do not inherit the bounty; the body still pays', REAL, () => {
  const h = makeBattle({
    autoFinish: false, timeLimit: 30,
    enemies: [{
      key: 'enemy_1195_sfyin', pos: [10, 6],
      mods: { hpMul: 1, bountyId: 'card-yin', bountyCoins: 5 },
      bounty: { coins: 5, ownerPlayerId: 'p1' },
    }],
  });
  h.step();
  const parent = h.enemy('enemy_1195_sfyin');
  assert.ok(parent, '磨砻 spawned');
  h.b.kill(parent, null);
  const kids = h.b.enemies.filter((e) => e !== parent && e.defId !== 'enemy_1195_sfyin');
  assert.ok(kids.length >= 1, `death children spawned (${kids.length})`);
  for (const c of kids) {
    assert.ok(!c.mods || (c.mods.bountyId == null && c.mods.bountyCoins == null), `${c.defId} still carries a bounty field`);
    assert.equal(c.bounty, null);
  }
  assert.equal(coinsOf(h), 5);
});

function seat(id, seatNo, o = {}) {
  return {
    playerId: id, seat: seatNo, deployCount: o.deployCount ?? 1, bonds: {}, layers: {},
    board: new Map(), bounties: o.bounties ?? [],
  };
}

function uniteOf(leaks, bounties) {
  const leaker = seat('L', 1, { bounties });
  const helper = seat('H', 0, { deployCount: 3 });
  const m = {
    isSolo: false,
    alivePlayers: () => [leaker, helper],
    gd: {
      unite: { maxHelpers: 2 },
      enemy: (k) => (k === 'enemy_parent' || k === 'enemy_child' ? { key: k } : null),
    },
  };
  const results = new Map([
    ['L', { perfect: false, leaked: leaks }],
    ['H', { perfect: true, leaked: [], unitsEnd: [] }],
  ]);
  return planUnite(m, results);
}

const CARD = { id: 'b1', card: { payout: 'kill', coin: 8, enemyKey: 'enemy_parent' } };

test('planUnite pays the card only when the leaked enemy is the card\'s enemy', () => {
  const plan = uniteOf([
    { enemyKey: 'enemy_parent', mods: { bountyId: 'b1', hpMul: 2 }, counted: true, lpr: 1 },
    { enemyKey: 'enemy_child', mods: { bountyId: 'b1', bountyCoins: 8, hpMul: 2 }, counted: true, lpr: 1 },
    { enemyKey: 'enemy_child', mods: { bountyCoins: 4 }, counted: true, lpr: 1 },
    { enemyKey: 'enemy_parent', mods: { bountyId: 'missing' }, counted: true, lpr: 1 },
  ], [CARD]);
  assert.ok(plan);
  assert.deepEqual(plan.leaked.map((l) => [l.enemyKey, l.bounty ? l.bounty.coins : null]), [
    ['enemy_parent', 8],
    ['enemy_child', null],
    ['enemy_child', 4],
    ['enemy_parent', null],
  ]);
});

test('planUnite does not pay a perfect-clear card or a card with no coin', () => {
  const leaks = [{ enemyKey: 'enemy_parent', mods: { bountyId: 'b1' }, counted: true, lpr: 1 }];
  const perfect = uniteOf(leaks, [{ id: 'b1', card: { payout: 'perfect', coin: 8, enemyKey: 'enemy_parent' } }]);
  assert.equal(perfect.leaked[0].bounty, null);
  const zero = uniteOf(leaks, [{ id: 'b1', card: { payout: 'kill', coin: 0, enemyKey: 'enemy_parent' } }]);
  assert.equal(zero.leaked[0].bounty, null);
});
