import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, chessRec } from '../helpers/battleHarness.js';

const cases = [
  ['chess_char_2_01', 1, 'arrow', 2], // 送葬人 S2
  ['chess_char_3_01', 0, 'arrow', 3], // 能天使 S1
  ['chess_char_3_01', 1, 'arrow', 4], // 能天使 S2
  ['chess_char_3_01', 2, 'arrow', 5], // 能天使 S3
  ['chess_char_3_21', 2, 'arrow', 3], // 空弦 S3
  ['chess_char_4_01', 0, 'arrow', 3], // 信仰搅拌机 S1
  ['chess_char_6_13', 2, 'arrow', 5], // 新约能天使 S3
  ['chess_char_4_13', 0, 'bolt', 2],  // 灵知 S1
];

for (const [base, skillIndex, projectile, hits] of cases) for (const form of ['a', 'b']) {
  const id = `${base}_${form}`;
  test(`${id} skill ${skillIndex + 1}: one attack reports ${hits} hits with unchanged impact damage`, () => {
    const h = makeBattle({
      defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, speed: 0, def: 0, res: 0 }) } },
      units: [{ chessId: id, row: 10, col: 3, skillIndex }],
      enemies: [{ key: 'dummy', pos: [10, 5] }], timeLimit: 10,
      hooks: ['damaged'], captureNoisy: true,
    });
    const u = h.unit(id);
    h.step();
    assert.equal(h.eventsOf('atk').filter(e => e[1] === u.id)[0]?.[4], base === 'chess_char_2_01' ? 1 : undefined,
      'the normal scattershot has a style field; other normal attacks retain the legacy event');
    u.atkCd = 5;
    h.run(1); // wait for the normal shot to land
    const beforeEvents = h.eventsOf('atk').length, beforeDamage = h.hooksOf('damaged').length;
    assert.ok(u.skill.activate('test', { free: true }));
    u.atkCd = 0;
    h.step();
    const volley = h.eventsOf('atk').slice(beforeEvents).filter(e => e[1] === u.id);
    assert.equal(volley.length, 1, 'the volley is still one simulation attack');
    assert.equal(volley[0][3], projectile);
    assert.equal(volley[0][4], hits, 'renderer receives the fixed hit count');
    assert.equal(volley[0][5], base === 'chess_char_3_21' ? 'archetStorm' : base === 'chess_char_2_01' ? 'shotgunWave' : undefined,
      '空弦 uses the golden storm, while 送葬人 uses one scattershot wave');
    assert.equal(h.b.projectiles.list.filter(p => p.source === u).length, 1, 'no extra simulation projectiles');
    h.run(0.5);
    const dealt = h.hooksOf('damaged').slice(beforeDamage).filter(c => c.source === u && c.dmg?.isAttack);
    assert.equal(dealt.length, hits, 'damage count stays unchanged');
    assert.equal(h.b.errorCount, 0);
  });
}

for (const id of ['chess_char_2_01_a', 'chess_char_3_10_a']) {
  test(`${id}: one blast draws one wave even when it hits multiple enemies`, () => {
    const h = makeBattle({
      defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, speed: 0, def: 0, res: 0 }) } },
      units: [{ chessId: id, row: 10, col: 3 }],
      enemies: [{ key: 'dummy', pos: [10, 5] }, { key: 'dummy', pos: [9, 5] }], timeLimit: 10,
      captureNoisy: true,
    });
    const u = h.unit(id);
    h.step();
    const attacks = h.eventsOf('atk').filter(e => e[1] === u.id);
    assert.ok(attacks.length >= 2, 'scattershot attacks both targets');
    assert.equal(attacks[0][5], 'shotgunWave');
    assert.equal(attacks[0][6], 2.5, 'wave reaches the outer edge of the two-tile normal range');
    assert.ok(attacks.slice(1).every(e => e[5] === 'shotgunWaveSkip'), 'no extra arrow or wave per victim');
    assert.equal(h.b.projectiles.list.filter(p => p.source === u).length, attacks.length, 'simulation still fires at each target');
  });
}

test('松果 S2 shortened attack range also shortens the visual wave', () => {
  const id = 'chess_char_3_10_a';
  const h = makeBattle({
    defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, speed: 0, def: 0, res: 0 }) } },
    units: [{ chessId: id, row: 10, col: 3 }], enemies: [{ key: 'dummy', pos: [10, 4] }], timeLimit: 10,
    captureNoisy: true,
  });
  const u = h.unit(id);
  h.step();
  const before = h.eventsOf('atk').length;
  assert.ok(u.skill.activate('test', { free: true }));
  u.atkCd = 0;
  h.step();
  const skillShot = h.eventsOf('atk').slice(before).find(e => e[1] === u.id);
  assert.equal(skillShot?.[5], 'shotgunWave');
  assert.equal(skillShot?.[6], 1.5, 'the active one-tile range replaces the normal two-tile reach');
});

test('a generic scattershooter hits multiple targets without inheriting the referenced operators\' wave', () => {
  const id = 't_scatter';
  const h = makeBattle({
    defs: { chess: { [id]: chessRec({ id, profession: 'SNIPER', subProfessionId: 'reaperrange',
      rangeGrid: [[0, 0], [0, 1], [0, 2], [1, 2]], skill: null }) },
    enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, speed: 0 }) } },
    units: [{ chessId: id, row: 10, col: 3 }],
    enemies: [{ key: 'dummy', pos: [10, 5] }, { key: 'dummy', pos: [11, 5] }], timeLimit: 10,
  });
  h.step();
  const attacks = h.eventsOf('atk').filter((e) => e[1] === h.unit(id).id);
  assert.equal(attacks.length, 2);
  assert.ok(attacks.every((e) => e[5] === undefined), 'the shared profession retains ordinary per-target visuals');
});

test('Ch\'en the Holungday keeps her existing effects in normal attacks and all three skills', () => {
  for (const skillIndex of [0, 1, 2]) for (const elite of [false, true]) {
    const h = makeBattle({
      defs: { enemies: { dummy: enemyRec({ key: 'dummy', hp: 1e8, speed: 0 }) } },
      units: [{ uid: 1, diy: { slot: 'chess_char_6_diy1_a', charId: 'char_1013_chen2', skillIndex }, elite, row: 10, col: 3 }],
      enemies: [{ key: 'dummy', pos: [10, 5] }, { key: 'dummy', pos: [9, 5] }], timeLimit: 10,
    });
    const u = h.unit(1);
    h.step();
    assert.ok(u.skill.activate('test', { free: true }));
    u.atkCd = 0;
    h.step();
    const attacks = h.eventsOf('atk').filter((e) => e[1] === u.id);
    assert.ok(attacks.length >= 4, 'the normal and skill attacks hit both targets');
    assert.ok(attacks.every((e) => e[5] !== 'shotgunWave' && e[5] !== 'shotgunWaveSkip'));
    assert.equal(h.b.errors.length, 0);
  }
});
