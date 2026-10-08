// 模拟端：位移后的失衡状态（0.1 s 硬直为下限，实际持续整段飞行）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';
import { UNBALANCE_STAGGER, UNBALANCE_TRAVEL } from '../../server/sim/constants.js';

const walker = (o = {}) => enemyRec({ key: 'enemy_walker', hp: 1e6, speed: 0.5, ...o });
const TICK = 1 / 30;
// the state lasts max(0.1 s, UNBALANCE_TRAVEL·√tiles): PRTS's 0.1 s is only the hard stagger
const hold = (tiles) => Math.max(UNBALANCE_STAGGER, UNBALANCE_TRAVEL * Math.sqrt(tiles));

test('a displaced enemy is held for the whole flight, then walks again (推完停一下不动)', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_walker: walker() } },
    enemies: [{ key: 'enemy_walker', pos: [10, 6] }],
    content: 'none', autoFinish: false,
  });
  h.step();
  const e = h.enemy('enemy_walker');
  const moved = h.b.displace(e, { x: 1, y: 0 }, 2, { force: 1 });
  assert.ok(moved > 1.8, 'displaced: ' + moved);
  const at = { x: e.x, y: e.y };
  const ticks = Math.max(1, Math.round(hold(moved) / TICK) - 1);   // just short of the hold
  assert.ok(ticks > Math.round(UNBALANCE_STAGGER / TICK), 'the hold outlasts the 0.1 s hard stagger');
  for (let i = 0; i < ticks; i++) h.step();
  assert.equal(e.x, at.x, 'still standing during the hold (x)');
  assert.equal(e.y, at.y, 'still standing during the hold (y)');
  for (let i = 0; i < 6; i++) h.step();
  assert.ok(e.x !== at.x || e.y !== at.y, 'walking again once it has landed');
});

test('the state is what blocks it: clearing it makes the same push resume at once', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_walker: walker() } },
    enemies: [{ key: 'enemy_walker', pos: [10, 6] }],
    content: 'none', autoFinish: false,
  });
  h.step();
  const e = h.enemy('enemy_walker');
  h.b.displace(e, { x: 1, y: 0 }, 2, { force: 1 });
  const at = { x: e.x, y: e.y };
  e.unbalanceUntil = -Infinity;                   // what the code did before this PR
  for (let i = 0; i < 2; i++) h.step();
  assert.ok(e.x !== at.x || e.y !== at.y, 'without the state it starts walking immediately');
});

test('a held enemy does not attack for the whole flight (nothing turns its model around)', () => {
  // The official's state machine is exclusive (UNBALANCE, then DEFAULT → MOVE) and lasts until the displacement has
  // been flown out — the 0.1 s is only the hard stagger. Acting earlier made the client face the enemy at whatever
  // pushed it, in mid-air (player reports: 模型反向 / 有些敌人会反过来有些不会).
  const h = makeBattle({
    defs: { enemies: { enemy_walker: walker({ atk: 300, range: 1.5, aspd: 100 }) } },
    units: [{ chessId: 't_guard', row: 10, col: 4 }],
    enemies: [{ key: 'enemy_walker', pos: [10, 6] }],
    content: 'none', autoFinish: false,
  });
  h.step();
  const e = h.enemy('enemy_walker');
  const moved = h.b.displace(e, { x: 1, y: 0 }, 2, { force: 1 });
  h.b.drainEvents();
  const ticks = Math.max(1, Math.round(hold(moved) / TICK) - 1);
  let atks = 0;
  for (let i = 0; i < ticks; i++) {
    h.step();
    for (const t of h.b.drainEvents() || []) if (Array.isArray(t) && t[0] === 'atk' && t[1] === e.id) atks++;
  }
  assert.equal(atks, 0, `no attack across the whole hold (${ticks} ticks)`);
});

test('a longer displacement holds longer (the flight, not a flat 0.1 s)', () => {
  const short = makeBattle({
    defs: { enemies: { enemy_walker: walker({ speed: 0.01 }) } },
    enemies: [{ key: 'enemy_walker', pos: [10, 6] }],
    content: 'none', autoFinish: false,
  });
  short.step();
  const es = short.enemy('enemy_walker');
  const dShort = short.b.displace(es, { x: 1, y: 0 }, 1, { force: 1 });     // 中力 vs 重量1 → 1.7 tiles
  const holdShort = es.unbalanceUntil - short.b.time;
  const far = makeBattle({
    defs: { enemies: { enemy_walker: walker({ speed: 0.01 }) } },
    enemies: [{ key: 'enemy_walker', pos: [10, 6] }],
    content: 'none', autoFinish: false,
  });
  far.step();
  const ef = far.enemy('enemy_walker');
  const dFar = far.b.displace(ef, { x: 1, y: 0 }, 3, { force: 1 });          // 大力 → 3.53 tiles
  const holdFar = ef.unbalanceUntil - far.b.time;
  assert.ok(dFar > dShort, `farther: ${dFar} > ${dShort}`);
  assert.ok(holdFar > holdShort, `held longer: ${holdFar} > ${holdShort}`);
  assert.ok(Math.abs(holdFar - hold(dFar)) < 1e-6, 'and by the documented model');
});
