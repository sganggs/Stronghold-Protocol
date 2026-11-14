import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, checkInvariants } from '../helpers/battleHarness.js';
import { getVersionData } from '../../server/data.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';

const raw = getVersionData('act3autochess@V3_1');
const wait = { motion: 'WALK', start: [10, 7], end: [9, 2], steps: [{ t: 'wait', s: 999 }] };
const cases = [
  ['enemy_1222_dpvt', 'enemy_1220_dzoms', 1],
  ['enemy_1222_dpvt_2', 'enemy_1220_dzoms_2', 1],
  ['enemy_1223_dmech', 'enemy_1220_dzoms', 1],
  ['enemy_1223_dmech_2', 'enemy_1220_dzoms_2', 1],
  ['enemy_1225_dkmage', 'enemy_1221_dzomg', 1],
  ['enemy_1225_dkmage_2', 'enemy_1221_dzomg_2', 1],
  ['enemy_1226_dklord', 'enemy_1221_dzomg', 1],
  ['enemy_1226_dklord_2', 'enemy_1221_dzomg_2', 1],
  ['enemy_1361_dthrow', 'enemy_1220_dzoms', 1],
  ['enemy_1361_dthrow_2', 'enemy_1220_dzoms_2', 1],
  ['enemy_1362_dfat', 'enemy_1221_dzomg', 0],
  ['enemy_1362_dfat_2', 'enemy_1221_dzomg_2', 0],
];
function field(autoFinish = true) {
  return makeBattle({ content: 'generic', extraContent: [enemiesMod], defs: { enemies: raw.enemies },
    autoFinish, timeLimit: 30 });
}
function spawn(h, key, opts = {}) {
  return h.spawn(key, { pos: [10, 7], route: wait, ...opts });
}

for (const [key, childKey, delay] of cases) {
  test(`${raw.enemies[key].name}: death replacement works even for the last, silenced enemy`, () => {
    const h = field();
    const parent = spawn(h, key, { mods: { hpMul: 2, bountyId: 'no-copy', bountyCoins: 50 }, sourcePlayerId: 'source-player' });
    h.step();
    const owner = parent.ownerId;
    h.b.applyStatus(parent, 'silence', { duration: 5, force: true });
    h.b.kill(parent, null);
    if (delay > 0) {
      h.run(delay - 0.1);
      assert.equal(h.b.finished, false, 'pending enemy replacement must hold the battle open');
      assert.equal(h.enemies().filter(e => e.defId === childKey).length, 0, 'respect the data delay');
      h.run(0.2);
    } else h.step();
    const children = h.enemies().filter(e => e.defId === childKey);
    assert.equal(children.length, 1);
    const child = children[0];
    assert.equal(h.b.finished, false, 'the replacement itself must still be defeated');
    assert.equal(child.ownerId, owner);
    assert.equal(child.sourcePlayerId, 'source-player');
    assert.equal(child.mods.bountyId, undefined, 'never inherit bounty rewards');
    assert.equal(child.mods.bountyCoins, undefined);
    assert.equal(child.s.maxHp, raw.enemies[childKey].stats.maxHp * 2);
    assert.equal(h.b.total, 0, 'runtime summons do not extend the wave denominator');
    h.b.kill(child, null);
    h.step();
    assert.equal(h.b.finished, true, 'the hold must end after spawning and defeating the replacement');
    assert.equal(h.b.result().reason, 'cleared');
    assert.equal(h.b.errorCount, 0);
    checkInvariants(h.b);
  });
}

test('Sarkaz death summons do not fire when the parent leaks', () => {
  for (const [key, childKey] of cases) {
    const h = field(false), parent = spawn(h, key);
    h.step();
    h.b.leak(parent);
    h.run(1.2);
    assert.equal(h.enemies().filter(e => e.defId === childKey).length, 0, key);
    assert.equal(h.b.errorCount, 0);
  }
});

test('Sarkaz bone defender leaves both stationary, uncounted Blood Ambers', () => {
  const h = field(), parent = spawn(h, 'enemy_1363_spnshd_2');
  h.step();
  h.b.kill(parent, null);
  h.step();
  const kids = h.enemies().filter(e => e.defId === 'enemy_1367_dseed');
  assert.equal(kids.length, 2);
  assert.equal(h.b.finished, false);
  const positions = kids.map(e => [e.y, e.x]);
  h.run(0.4);
  assert.deepEqual(kids.map(e => [e.y, e.x]), positions);
  assert.ok(kids.every(e => e.counted === false));
  for (const e of kids) h.b.kill(e, null);
  h.step();
  assert.equal(h.b.finished, true);
  assert.equal(h.b.errorCount, 0);
});

test('death replacement continues the remaining route instead of restarting at the entrance', () => {
  const h = field(false);
  const parent = spawn(h, 'enemy_1222_dpvt', { route: {
    motion: 'WALK', start: [10, 7], end: [10, 2], steps: [{ t: 'move', p: [10, 5] }],
  } });
  h.run(0.5);
  const x = parent.x;
  assert.ok(x < 7);
  h.b.kill(parent, null);
  h.run(1.1);
  const child = h.enemies().find(e => e.defId === 'enemy_1220_dzoms');
  assert.ok(child);
  assert.equal(child.spawnX, x);
  assert.deepEqual(child.route.legs.filter(l => l.t === 'move').map(l => [l.r, l.c]), [[10, 5], [10, 2]]);
  assert.ok(child.x <= x, 'the child follows the original goal');
  assert.equal(h.b.errorCount, 0);
});

test('shared delayed replacement also holds the last rock spider until all four children spawn', () => {
  for (const key of ['enemy_1133_harchn', 'enemy_1133_harchn_2']) {
    const h = field(), parent = spawn(h, key);
    h.step();
    h.b.kill(parent, null);
    h.run(0.1);
    assert.equal(h.b.finished, false, key);
    h.run(0.2);
    const childKey = raw.enemies[key].talents.bbStr['deathrattle.enemy_key'];
    const kids = h.enemies().filter(e => e.defId === childKey);
    assert.equal(kids.length, 4, key);
    for (const e of kids) h.b.kill(e, null);
    h.step();
    assert.equal(h.b.finished, true);
    assert.equal(h.b.errorCount, 0);
  }
});
