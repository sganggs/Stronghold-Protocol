// The settlement kernel against the outcomes of the v0.3.1 one for the behaviour the new kernel does not change on
// purpose. Those outcomes were recorded once from server/sim/damage.js (the v0.3.1 settlement PR #802 kept as an
// independent oracle) into test/fixtures/attack-differential.json before that second kernel was removed (DESIGN §35.32).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';

const BASELINE = JSON.parse(fs.readFileSync(new URL('../fixtures/attack-differential.json', import.meta.url), 'utf8'));
/** The recorded form: what JSON keeps (undefined fields drop out, as in the fixture). */
const recorded = (v) => JSON.parse(JSON.stringify(v));

function fixture() {
  const h = makeBattle({
    defs: {
      chess: { t: chessRec({ id: 't', stats: { atk: 100, maxHp: 10000 }, skill: null }) },
      enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 10000, speed: 0, mass: 0 }) },
    },
    units: [{ uid: 1, chessId: 't', row: 10, col: 5 }], content: 'none', autoFinish: false, hooks: [],
  });
  h.step();
  return { h, b: h.b, u: h.unit(1), e: h.spawn('enemy_dummy', { pos: [10, 8] }) };
}

function runDamage({ type, attribution, shield, amount }) {
  const { b, u, e } = fixture();
  b.addBuff(u, { key: 'source', mods: { dmgDealtMul: 1.2, defIgnoreFlat: 10, resIgnorePct: 0.2 } });
  b.addBuff(e, { key: 'target', shield, mods: { defFlat: 200 - e.s.def, resFlat: 30 - e.s.res, dmgTakenMul: 1.3 } });
  const trace = [];
  for (const name of ['hit', 'hpDamage', 'fatal', 'damaged', 'kill']) b.on(name, c => trace.push({ name,
    source: c.source?.id ?? null, credit: c.credit?.id ?? null, killer: c.killer?.id ?? null, amount: c.amount }));
  const source = attribution === 'ownerless' ? null : u;
  const dmg = { type, amount, sourceless: attribution === 'sourceless' };
  const result = b.dealDamage(source, e, dmg);
  return { result, hp: e.hp, alive: e.alive, dealt: u.stats.dmg, taken: e.stats.taken,
    shield: e.findBuff('target')?.shield ?? 0, trace, events: b.drainEvents() };
}

test('legacy-compatible damage keeps the v0.3.1 HP, barriers, event order, attribution and wire payloads across 72 cases (the red mark follows PRTS 最终伤害)', () => {
  let cases = 0;
  for (const type of ['phys', 'arts', 'true', 'elemental']) {
    for (const attribution of ['source', 'sourceless', 'ownerless']) {
      for (const shield of [0, 100, 20000]) {
        for (const amount of [100, 20000]) {
          const spec = { type, attribution, shield, amount };
          const current = runDamage(spec);
          // The red mark is tested on the final damage after the barrier (PRTS 作战机制 「伤害红字」: 期望伤害 leaves out
          // 屏障吸收, the shown 最终伤害 does not — DESIGN §35.32); v0.3.1 tested it on the amount before the barrier.
          const expected = type === 'phys' ? Math.max(amount - 200, amount * 0.05) : type === 'arts' ? amount * 0.7 : amount;
          const final = current.trace.find(c => c.name === 'damaged')?.amount ?? 0;
          for (const event of current.events) if (event[0] === 'dmg') assert.equal(event[4], final + 1e-9 >= expected * 1.5 ? 'r' : undefined);
          const payload = { ...current, events: current.events.map(event => event[0] === 'dmg' ? event.slice(0, 4) : event) };
          assert.deepEqual(recorded(payload), BASELINE.damage[`${type}/${attribution}/${shield}/${amount}`], JSON.stringify(spec));
          cases++;
        }
      }
    }
  }
  assert.equal(cases, Object.keys(BASELINE.damage).length);
});

function runElement() {
  const { b, u, e } = fixture();
  b.addBuff(u, { key: 'source', mods: { dmgDealtMul: 7 } });
  const trace = [];
  for (const name of ['elementHit', 'elementBurst', 'hit', 'fatal', 'damaged']) b.on(name, c => trace.push({ name,
    source: c.source?.id ?? null, amount: c.amount, type: c.dmg?.type }));
  const results = [];
  for (const element of ['burn', 'neural']) {
    results.push(b.dealDamage(u, e, { amount: 400, type: 'element', element }));
    results.push(b.dealDamage(u, e, { amount: 600, type: 'element', element }));
  }
  return { results, hp: e.hp, elem: e.elem, dealt: u.stats.dmg, taken: e.stats.taken, trace, events: b.drainEvents() };
}

test('sourced gauge fill, burst, source-less burst damage and cross-element cooldown keep the v0.3.1 outcome', () => {
  assert.deepEqual(recorded(runElement()), BASELINE.element);
});

function runHeal(regen) {
  const { b, u } = fixture();
  u.hp = u.s.maxHp - 100;
  b.addBuff(u, { key: 'heal', mods: { healingDealtMul: 1.2, healingTakenMul: 1.5 } });
  const trace = [];
  b.on('heal', c => { trace.push(c.amount); c.amount *= 2; });
  const result = b.heal(u, u, 75, { regen, overheal: true });
  return { result, hp: u.hp, heal: u.stats.heal, shield: u.findBuff('overheal')?.shield ?? 0, trace, events: b.drainEvents() };
}

test('ordinary healing, overheal, regeneration and heal hook edits keep the v0.3.1 outcome', () => {
  assert.deepEqual(recorded(runHeal(false)), BASELINE.heal.heal);
  assert.deepEqual(recorded(runHeal(true)), BASELINE.heal.regen);
});
