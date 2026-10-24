import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';

for (const id of ['chess_char_4_06_a', 'chess_char_4_06_b']) {
  test(`${id}: 无痕 sends two-arrow visuals without using 封喉's hit counter`, () => {
    const h = makeBattle({
      defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, speed: 0 }) } },
      units: [{ chessId: id, row: 10, col: 3, skillIndex: 0 }],
      timeLimit: 30, hooks: [],
    });
    h.step();
    const u = h.unit(id);
    h.spawn('dummy', { pos: [10, 5] });
    assert.ok(u.skill.activate('test', { free: true }));
    h.run(3);
    const events = h.eventsOf('atk').filter(e => e[1] === u.id);
    assert.ok(events.length >= 2);
    assert.ok(events.every(e => e[4] === 2));
    assert.equal(u.mem.kroosHits ?? 0, 0);
  });

  test(`${id}: 封喉 sends 2/4-arrow visuals while preserving one attack and projectile per volley`, () => {
    const h = makeBattle({
      defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, speed: 0 }) } },
      units: [{ chessId: id, row: 10, col: 3 }], enemies: [{ key: 'dummy', pos: [10, 5] }],
      timeLimit: 100, hooks: ['damaged'], captureNoisy: true, seed: 3,
    });
    const u = h.unit(id);
    assert.ok(h.runUntil(() => u.skill.active, 60));
    const before = h.eventsOf('atk').filter(e => e[1] === u.id);
    assert.ok(before.some(e => e[4] === undefined), 'normal attack keeps the legacy event');
    h.runUntil(() => (u.mem.kroosHits ?? 0) >= 40, 30);
    assert.equal(u.mem.kroosHits, 40);
    u.atkCd = 5; h.run(1); // let the previous volley land before forcing the next one
    const count = h.eventsOf('atk').length, damaged = h.hooksOf('damaged').length;
    u.atkCd = 0; h.step();
    const quad = h.eventsOf('atk').slice(count).filter(e => e[1] === u.id);
    assert.equal(quad.length, 1, 'one attack animation/event');
    assert.equal(quad[0][4], 4, 'four-arrow visual payload');
    assert.equal(h.b.projectiles.list.filter(p => p.source === u).length, 1, 'cosmetic arrows do not multiply sim projectiles');
    h.run(0.3);
    const hits = h.hooksOf('damaged').slice(damaged).filter(c => c.source === u && c.dmg?.isAttack);
    assert.equal(hits.length, 4, 'still exactly four damage instances');
    assert.ok(h.eventsOf('atk').some(e => e[1] === u.id && e[4] === 2), 'initial double-arrow visual');
    h.runUntil(() => !u.skill.active, 30);
    u.atkCd = 5; h.run(1);
    assert.ok(u.skill.activate('test', { free: true }));
    const resetAt = h.eventsOf('atk').length;
    u.atkCd = 0; h.step();
    assert.equal(h.eventsOf('atk')[resetAt][4], 2, 'new cast starts with two arrows again');
    assert.equal(h.b.errorCount, 0);
  });
}
