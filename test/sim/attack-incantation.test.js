// Native vendla_tr / reed2_tr / titi_tr: ON_AFTER_OUTPUT_DAMAGE, assignRealDelta=false.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

function field(real = false) {
  const h = makeBattle({ autoFinish: false, content: real ? 'full' : 'none',
    defs: { chess: {
      medic: chessRec({ id: 'medic', profession: 'MEDIC', subProfessionId: 'incantationmedic', dmgType: 'arts',
        rangeGrid: [[0, 0], [0, 1], [1, 0]], stats: { maxHp: 10000, atk: 100 }, skill: null }),
      tank: chessRec({ id: 'tank', stats: { maxHp: 100000, atk: 0 }, skill: null }),
    }, enemies: { probe: enemyRec({ key: 'probe', hp: 1000000, def: 0, res: 0, atk: 0, speed: 0 }) } },
    units: [{ uid: 'medic', chessId: real ? 'chess_char_1_06_a' : 'medic', row: 10, col: 5 },
      { uid: 'tank', chessId: 'tank', row: 10, col: 6 }] });
  h.step();
  const b = h.b, u = h.unit('medic'), ally = h.unit('tank'), e = h.spawn('probe', { pos: [10, 7] });
  u.atkCd = ally.atkCd = 999;
  ally.hp = 1000;
  const heals = [];
  b.on('heal', c => { if (c.source === u && c.opts?.tags?.includes('incantation')) heals.push(c); });
  return { h, b, u, ally, e, heals };
}
const output = (f, opts = {}) => f.b.dealDamage({ source: f.u, target: f.e, amount: 100, type: 'true', ...opts });
const done = f => { checkInvariants(f.b); assert.deepEqual(f.b.errors, []); };

for (const real of [false, true]) {
  const label = real ? 'real Vendla' : 'shared incantation';
  test(`${label} excludes typed HP loss, gauges and source-less credit`, () => {
    const f = field(real), { b, u, e, heals } = f;
    for (const type of ['phys', 'arts', 'true']) b.dealHPLose({ source: u, target: e, amount: 100, type });
    b.dealElementDamage({ source: u, target: e, element: 'burn', amount: 10 });
    b.dealDamage({ source: null, credit: u, target: e, amount: 100, type: 'true' });
    assert.equal(heals.length, 0);
    done(f);
  });
  for (const type of ['phys', 'arts', 'true', 'elemental']) test(`${label} heals from successful ${type} HP damage`, () => {
    const f = field(real);
    output(f, { type, attackType: 'BUFF', isAttack: false });
    assert.equal(f.heals.length, 1, 'one shared trait, including Vendla');
    // Vendla's talent increases healing received by the highest-max-HP ally by 11%.
    assert.ok(Math.abs(f.heals[0].amount - (real ? 55.5 : 50)) < 1e-9);
    assert.equal(f.heals[0].target, f.ally);
    done(f);
  });
}

for (const defense of ['dodge', 'countShield', 'flatZero']) test(`incantation does not heal from ${defense}`, () => {
  const f = field();
  f.b.addBuff(f.e, { key: 'defense', ...(defense === 'dodge' ? { injury(c) { c.dodge(); } }
    : defense === 'countShield' ? { shieldHits: 1 } : { injury(c) { c.amount = 0; } }) });
  output(f);
  assert.equal(f.heals.length, 0);
  done(f);
});

test('incantation uses post-barrier damage, not real HP delta, and honors a named ally', () => {
  const f = field();
  f.e.hp = 10;
  f.b.addBuff(f.e, { key: 'pool', shield: 40 });
  const removed = output(f, { traitAlly: f.u });
  assert.equal(removed, 10);
  assert.equal(f.heals.length, 1);
  assert.equal(f.heals[0].amount, 30, 'remaining 60 damage heals 30 despite 10 HP overkill delta');
  assert.equal(f.heals[0].target, f.u);
  done(f);
});

test('incantation special-HP target retains the full damage basis for healing', () => {
  const f = field();
  f.b.addBuff(f.e, { key: 'hitCount', flags: { hitCount: true } });
  assert.equal(output(f), 1);
  assert.equal(f.heals[0].amount, 50);
  done(f);
});
