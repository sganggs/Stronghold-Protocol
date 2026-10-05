import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, checkInvariants } from '../helpers/battleHarness.js';
import { bondLayers } from '../../server/sim/content/support/index.js';
import { bondsWithGains } from '../../server/match/bondsMeta.js';

const on = (layers = 0, active = true) => ({ count: active ? 3 : 0, active, tier: active ? 1 : 0, layers });
const op = (id, garrisonIds = [], extra = {}) => ({ ...chessRec({ id, ...extra }), garrisonIds });
const gains = (h) => h.result().perPlayer.p1.layerGains;
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);
const instant = () => ({ skill: { kind: 'instant', spCost: 1, initSp: 1, trigger: 'NEVER' } });

function casts(h, u, n) {
  for (let i = 0; i < n; i++) {
    u.skill.gainSp(u.skill.spCost, 'init');
    assert.equal(u.skill.activate('manual'), true);
  }
}

function skillBattle(gid, { extra = false, kind = 'normal', bonds, second = false } = {}) {
  const chess = { caster: op('caster', [gid]), mate: op('mate') };
  const units = [{ chessId: 'caster', row: 10, col: 5 }, { chessId: 'mate', row: 10, col: 7 }];
  if (extra) { chess.demon = op('demon', ['garrison_59_a']); units.push({ chessId: 'demon', row: 10, col: 4 }); }
  if (second) { chess.second = op('second', [gid]); units.push({ chessId: 'second', row: 11, col: 5 }); }
  const h = makeBattle({ kind, defs: { chess }, units, bonds, kits: { caster: instant, second: instant }, autoFinish: false });
  h.step();
  return h;
}

test('highest-bond skill gains keep one per-battle source cap when the highest bond changes', () => {
  for (const [gid, per, cap] of [['garrison_90_a', 2, 10], ['garrison_90_b', 4, 20]]) {
    const h = skillBattle(gid, { bonds: { yanShip: on(10), sargonShip: on() } });
    const u = h.unit('caster');
    casts(h, u, 2);
    assert.equal(gains(h).yanShip, 2 * per);
    h.b.addLayers('p1', 'sargonShip', 50, 'bond');
    casts(h, u, 10);
    assert.equal(gains(h).sargonShip, 50 + cap - 2 * per, 'changing target does not reset the source cap');
    assert.equal(gains(h).yanShip + gains(h).sargonShip - 50, cap);
    checkInvariants(h.b);
  }
});

test('highest-bond source cap excludes demon bonuses and stays per operator instance', () => {
  const h = skillBattle('garrison_90_a', { extra: true, second: true, bonds: { yanShip: on(10), sargonShip: on() } });
  const u = h.unit('caster');
  // The demon is also in the row: each source trigger adds 3, plus its separate +1 bonus.
  casts(h, u, 2);
  assert.equal(gains(h).yanShip, 8);
  h.b.addLayers('p1', 'sargonShip', 50, 'bond');
  casts(h, u, 10);
  assert.equal(gains(h).sargonShip, 56, '4 remaining source layers + 2 demon triggers');
  casts(h, h.unit('second'), 12);
  assert.equal(gains(h).sargonShip, 66, 'the second operator retains its own ten-layer allowance');
  checkInvariants(h.b);
});

function dollBattle({ kind = 'normal', revive = false, extra = false } = {}) {
  const chess = { ghost: op('ghost', ['garrison_40_b'], { profession: 'SPECIAL', subProfessionId: 'dollkeeper' }) };
  const units = [{ chessId: 'ghost', row: 10, col: 5 }];
  if (extra) { chess.demon = op('demon', ['garrison_59_a']); units.push({ chessId: 'demon', row: 10, col: 4 }); }
  const h = makeBattle({ seed: 2, kind, defs: { chess }, units, bonds: { egirShip: on(), indomShip: on(revive ? 205 : 0) }, autoFinish: false, timeLimit: 100 });
  // seed 2: the 0-layer 不屈 (18 %) misses its roll on the retreat/redeploy segment of the direct-switch
  // test — the unit must stay withdrawn for the redeploy assertion (the other draws are behaviour-neutral)

  h.step();
  return h;
}

test('doll transitions grant layers synchronously; substitute death plus immediate revival is not a second swap', () => {
  const h = dollBattle({ revive: true, extra: true });
  const u = h.unit('ghost');
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.equal(u.trait.doll, true);
  assert.deepEqual(gains(h), { egirShip: 11, indomShip: 11 }, 'the actual transition is recorded without waiting for a tick');
  h.run(1.1);
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.ok(u.alive && u.deployed && !u.trait.doll, 'indom revives the knocked-out substitute as its body');
  assert.deepEqual(gains(h), { egirShip: 22, indomShip: 22 }, 'one transition and one knock-out');
  h.step();
  assert.deepEqual(gains(h), { egirShip: 22, indomShip: 22 }, 'death cleanup must not manufacture another transition');
  h.b.dealDamage(null, u, { amount: 1e9, type: 'true' });
  assert.deepEqual(gains(h), { egirShip: 33, indomShip: 33 }, 'a new real substitution remains eligible');
  checkInvariants(h.b);
});

test('direct doll switches and natural returns grant once; retreat and redeploy do not grant swap layers', () => {
  const h = dollBattle();
  const u = h.unit('ghost');
  const c = { unit: u, reason: 'skillEnd', done: false };
  h.b.emit('dollSwitch', c);
  assert.equal(c.done, true);
  assert.deepEqual(gains(h), { egirShip: 10, indomShip: 10 });
  h.run(21.1);
  assert.equal(u.trait.doll, false);
  assert.deepEqual(gains(h), { egirShip: 20, indomShip: 20 }, 'the natural return is one real transition');
  h.b.emit('dollSwitch', { unit: u, reason: 'skillEnd', done: false });
  h.b.retreat(u);
  // 不屈 (18 % at 0 layers) may have redeployed her the instant she left — either way this is no form switch
  if (!u.alive) assert.equal(h.b.redeploy(u, { free: true }), true);
  h.step();
  assert.deepEqual(gains(h), { egirShip: 30, indomShip: 30 }, 'retreat cleanup and redeploy are not form switches');
  checkInvariants(h.b);
});

test('real skill activations refresh core and garrison layer attributes and retain inactive counts', () => {
  const h = makeBattle({
    defs: { chess: { caster: op('caster', ['garrison_43_a']), reader: op('reader', ['garrison_09_a'], { bonds: ['yanShip'] }) } },
    units: [{ chessId: 'caster', row: 10, col: 5 }, { chessId: 'reader', row: 11, col: 5 }],
    bonds: { sargonShip: on(), yanShip: on(7), lateranoShip: on(80, false) },
    kits: { caster: instant }, autoFinish: false,
  });
  h.step();
  const reader = h.unit('reader');
  const before = reader.s.atk;
  casts(h, h.unit('caster'), 1);
  assert.equal(bondLayers(h.b, 'p1', 'sargonShip'), 6);
  h.step();
  close(reader.s.atk - before, reader.base.atk * 0.02);
  const mid = reader.s.atk;
  h.b.addLayers('p1', 'yanShip', 3, 'bond');
  h.step();
  close(reader.s.atk - mid, reader.base.atk * (0.009 * 3 + 0.01));
  assert.equal(bondLayers(h.b, 'p1', 'lateranoShip'), 80, 'inactive layers retained but not included in the reader');
  checkInvariants(h.b);
});

test('skill and doll layer events respect disabled battle kinds, inactive bonds and the global cap', () => {
  for (const kind of ['unite', 'boss', 'hidden']) {
    const h = skillBattle('garrison_43_a', { kind, bonds: { sargonShip: on(40) } });
    casts(h, h.unit('caster'), 2);
    assert.equal(bondLayers(h.b, 'p1', 'sargonShip'), 40);
    assert.deepEqual(gains(h), {});
    const d = dollBattle({ kind });
    d.b.dealDamage(null, d.unit('ghost'), { amount: 1e9, type: 'true' });
    d.run(21.1);
    assert.deepEqual(gains(d), {});
  }
  const inactive = skillBattle('garrison_43_a', { bonds: { sargonShip: on(40, false) } });
  casts(inactive, inactive.unit('caster'), 2);
  assert.equal(bondLayers(inactive.b, 'p1', 'sargonShip'), 40);
  assert.deepEqual(gains(inactive), {});
  const capped = skillBattle('garrison_43_a', { extra: true, bonds: { sargonShip: on(997) } });
  casts(capped, capped.unit('caster'), 2);
  assert.equal(bondLayers(capped.b, 'p1', 'sargonShip'), 999);
  assert.deepEqual(gains(capped), { sargonShip: 2 });
  const start = { sargonShip: on(997) };
  const view = bondsWithGains(start, gains(capped));
  assert.equal(view.sargonShip.layers, 999, 'the pending match view uses the actual battle delta');
  assert.equal(start.sargonShip.layers, 997, 'pending gains never mutate the persistent input');
});
