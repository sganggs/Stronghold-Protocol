// Official red damage numbers (PRTS 作战机制 「伤害红字（暴击）」, https://prts.wiki/w/作战机制).
// The mark is display-only: HP, return values and event counts stay the same. A qualifying hit appends 'r' on the
// dmg tuple that already fires; a dodge of such a hit sets num:'m' on the dodge fx that already fires. No new event.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { officialDamageMark } from '../../server/sim/attack/hit.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const approx = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

function field() {
  const h = makeBattle({
    defs: {
      chess: { t_a: chessRec({ id: 't_a', stats: { atk: 1000 } }) },
      enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 100000, def: 400, res: 0, speed: 0 }) },
    },
    units: [{ chessId: 't_a', row: 9, col: 3 }],
    enemies: [{ key: 'enemy_dummy', pos: [11, 8] }],
    content: 'none',
  });
  h.step();
  return h;
}

function added(h, kind, fn) {
  const before = h.eventsOf(kind).length;
  const result = fn();
  return { result, ev: h.eventsOf(kind).slice(before) };
}

test('officialDamageMark is the PRTS 1.5× test, including a 0-damage invulnerable hit', () => {
  assert.equal(officialDamageMark(150, 100), 'r');
  assert.equal(officialDamageMark(149.9, 100), null);
  assert.equal(officialDamageMark(0, 0), 'r', '0 ≥ 0 × 1.5 (PRTS 无敌: 弑君者 flash still shows red 0)');
  assert.equal(officialDamageMark(Number.NaN, 10), null);
});

test('a landed hit is marked only when the final damage reaches 1.5× the penetration-free expected damage', () => {
  const h = field();
  const e = h.enemy('enemy_dummy');
  const op = h.unit('t_a');

  const plain = added(h, 'dmg', () => h.b.dealDamage(null, e, { amount: 100, type: 'true' }));
  assert.equal(plain.result, 100);
  assert.deepEqual(plain.ev[0], ['dmg', e.id, 100, 'true'], 'below 1.5×: the tuple stays four elements');

  h.b.addBuff(e, { key: 'fr12', mods: { dmgTakenMul: 1.2 } });
  const mild = added(h, 'dmg', () => h.b.dealDamage(null, e, { amount: 100, type: 'true' }));
  assert.equal(mild.result, 120);
  assert.equal(mild.ev[0].length, 4, '脆弱 ×1.2 is below 1.5× the penetration-free expected damage');
  h.b.removeBuff(e, e.findBuff('fr12'));

  h.b.addBuff(e, { key: 'fr15', mods: { dmgTakenMul: 1.5 } });
  const edge = added(h, 'dmg', () => h.b.dealDamage(null, e, { amount: 100, type: 'true' }));
  assert.equal(edge.result, 150);
  assert.deepEqual(edge.ev[0], ['dmg', e.id, 150, 'true', 'r'], 'exactly 1.5× is red');
  h.b.removeBuff(e, e.findBuff('fr15'));

  h.b.addBuff(op, { key: 'dealt', mods: { dmgDealtMul: 2 } });
  const dealt = added(h, 'dmg', () => h.b.dealDamage(op, e, { amount: 100, type: 'true' }));
  assert.equal(dealt.result, 200);
  assert.equal(e.hp, 100000 - 100 - 120 - 150 - 200);
  assert.equal(dealt.ev[0][4], 'r', 'source damage-dealt multipliers are excluded from expected damage');
  h.b.removeBuff(op, op.findBuff('dealt'));

  const mul = added(h, 'dmg', () => h.b.dealDamage(null, e, { amount: 100, type: 'true', mul: 2 }));
  assert.equal(mul.result, 200);
  assert.equal(mul.ev[0].length, 4, 'dmg.mul is the instance scale and stays on both sides of the comparison');

  const pen = added(h, 'dmg', () => h.b.dealDamage(null, e, { amount: 1000, type: 'phys', defIgnorePct: 1 }));
  assert.equal(pen.result, 1000);
  assert.equal(pen.ev[0][4], 'r', 'DEF penetration is excluded from expected damage (600) but counted in the final (1000)');
  const blocked = added(h, 'dmg', () => h.b.dealDamage(null, e, { amount: 1000, type: 'phys' }));
  assert.equal(blocked.result, 600);
  assert.equal(blocked.ev[0].length, 4, 'the same hit without penetration is not red');
});

test('shields, hit-count husks, sub-threshold reds and element fills do not invent events', () => {
  const h = field();
  const e = h.enemy('enemy_dummy');

  h.b.addBuff(e, { key: 'fr', mods: { dmgTakenMul: 2 } });
  h.b.addBuff(e, { key: 'sh', shield: 100000 });
  const soaked = added(h, 'dmg', () => h.b.dealDamage(null, e, { amount: 100, type: 'true' }));
  assert.equal(soaked.result, 0);
  assert.equal(soaked.ev.length, 0, 'a barrier that removes the hit emits nothing');
  h.b.removeBuff(e, 'sh');
  h.b.removeBuff(e, 'fr');

  h.b.addBuff(e, { key: 'hc', flags: { hitCount: true } });
  const husk = added(h, 'dmg', () => h.b.dealDamage(null, e, { amount: 1000, type: 'true' }));
  assert.equal(husk.result, 1);
  assert.deepEqual(husk.ev[0], ['dmg', e.id, 1000, 'true'], 'special HP changes the HP delta without replacing the damage number');
  h.b.removeBuff(e, 'hc');

  h.b.addBuff(e, { key: 'tiny', mods: { dmgTakenMul: 4 } });
  const tiny = added(h, 'dmg', () => h.b.dealDamage(null, e, { amount: 0.1, type: 'true' }));
  approx(tiny.result, 0.4);
  assert.equal(tiny.ev.length, 0, 'a red total under 0.5 still emits no dmg event');
  h.b.removeBuff(e, 'tiny');

  const gauge = added(h, 'dmg', () => h.b.dealDamage(null, e, { amount: 80, type: 'element', element: 'burn' }));
  assert.equal(gauge.ev.length, 1);
  assert.equal(gauge.ev[0].length, 4, 'an element gauge fill is not an HP crit');
  assert.equal(gauge.ev[0][3], 'burn');

  const rewritten = field();
  const t = rewritten.enemy('enemy_dummy');
  rewritten.b.addBuff(t, { key: 'fr', mods: { dmgTakenMul: 2 } });
  rewritten.b.on('hpDamage', (c) => { c.amount = 1; });
  const cut = added(rewritten, 'dmg', () => rewritten.b.dealDamage(null, t, { amount: 100, type: 'true' }));
  assert.equal(cut.result, 1);
  assert.deepEqual(cut.ev[0], ['dmg', t.id, 1, 'true'], 'the final rewrite can lower damage below the red threshold');
});

test('invulnerable and sleeping hits stay event-free; a dodge marks MISS only for a would-be red hit', () => {
  const h = field();
  const e = h.enemy('enemy_dummy');
  const hp = e.hp;
  h.b.addBuff(e, { key: 'inv', duration: 5, flags: { invulnerable: true } });
  const inv = added(h, 'dmg', () => h.b.dealDamage(null, e, { amount: 500, type: 'true' }));
  assert.equal(inv.result, 0);
  assert.equal(inv.ev.length, 0);
  assert.equal(e.hp, hp);
  h.b.removeBuff(e, e.findBuff('inv'));

  h.b.addBuff(e, { key: 'sleep', duration: 5, flags: { sleep: true } });
  const sleep = added(h, 'dmg', () => h.b.dealDamage(null, e, { amount: 500, type: 'true' }));
  assert.equal(sleep.result, 0);
  assert.equal(sleep.ev.length, 0);
  h.b.removeBuff(e, e.findBuff('sleep'));

  let rolls = 0;
  h.b.rng = () => { rolls++; return 0; };
  h.b.addBuff(e, { key: 'dodge', mods: { dodgePhys: 1 } });
  const miss = added(h, 'fx', () => h.b.dealDamage(null, e, { amount: 1000, type: 'phys', defIgnorePct: 1 }));
  assert.equal(miss.result, 0);
  assert.equal(rolls, 1, 'the hypothetical red test does not roll again');
  assert.equal(e.hp, hp);
  const redFx = miss.ev.filter((ev) => ev[1] === 'dodge');
  assert.equal(redFx.length, 1);
  assert.equal(redFx[0][4].id, e.id);
  assert.equal(redFx[0][4].num, 'm');

  rolls = 0;
  const plain = added(h, 'fx', () => h.b.dealDamage(null, e, { amount: 100, type: 'phys' }));
  assert.equal(plain.result, 0);
  assert.equal(rolls, 1);
  const quiet = plain.ev.filter((ev) => ev[1] === 'dodge');
  assert.equal(quiet.length, 1);
  assert.equal(Object.hasOwn(quiet[0][4], 'num'), false);
});


test('red threshold uses actual barrier overflow rather than a multiplier-only estimate', () => {
  const h = field(), e = h.enemy('enemy_dummy'), u = h.unit('t_a');
  h.b.addBuff(u, { key: 'source', mods: { dmgDealtMul: 2 } });
  h.b.addBuff(e, { key: 'fragile', mods: { dmgTakenMul: 2 } });
  h.b.addBuff(e, { key: 'pool', shield: 300 });
  const hit = added(h, 'dmg', () => h.b.dealDamage({ source: u, target: e, amount: 100, type: 'true' }));
  assert.equal(hit.result, 100);
  assert.deepEqual(hit.ev[0], ['dmg', e.id, 100, 'true']);
});

for (const first of ['dodge', 'fragile']) test(`MISS uses injury amount at ${first}-first ordered position`, () => {
  const h = field(), e = h.enemy('enemy_dummy');
  for (const key of [first, first === 'dodge' ? 'fragile' : 'dodge']) h.b.addBuff(e,
    key === 'dodge' ? { key, mods: { dodgePhys: 1 } } : { key, mods: { dmgTakenMul: 2 } });
  let rolls = 0;
  h.b.rng = () => { rolls++; return 0; };
  const hit = added(h, 'fx', () => h.b.dealDamage({ target: e, amount: 1000, type: 'phys' }));
  assert.equal(hit.result, 0);
  assert.equal(rolls, 1);
  const fx = hit.ev.find(ev => ev[1] === 'dodge');
  assert.equal(fx[4].num, first === 'fragile' ? 'm' : undefined);
});

test('an uncancellable dodge attempt does not display a MISS for damage that lands', () => {
  const h = field(), e = h.enemy('enemy_dummy');
  h.b.addBuff(e, { key: 'dodge', mods: { dodgePhys: 1 } });
  const hit = added(h, 'fx', () => h.b.dealDamage({ target: e, amount: 1000, type: 'phys', defIgnorePct: 1, dodgeMode: 'uncancellable' }));
  assert.equal(hit.result, 1000);
  assert.equal(hit.ev.find(ev => ev[1] === 'dodge')[4].num, undefined);
});
