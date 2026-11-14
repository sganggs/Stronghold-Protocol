import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getVersionData } from '../../server/data.js';
import { DataSource } from '../../server/sim/simdata.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import * as bonds from '../../server/sim/content/bonds.js';
import * as enemies from '../../server/sim/content/enemies.js';
import * as bosses from '../../server/sim/content/bosses.js';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';

const RAW = getVersionData('act3autochess@V3_1');
const ids = Array.from({ length: 6 }, (_, i) => `test_siracusa_${i}`);
const chess = Object.fromEntries([...ids, 'test_visible'].map(id => [id, chessRec({ id, profession: 'SNIPER',
  bonds: ids.includes(id) ? ['siracusaShip'] : [], rangeGrid: [[0, 0]], skill: null,
  stats: { maxHp: ids.includes(id) ? 1e7 : 1e6, atk: 0, def: 0, res: 0, blockCnt: 0 } })]));
const data = new DataSource({ ...RAW, chess });
const replacement = Object.assign({}, ...RAW.bands.band_siracusa.buffs
  .filter(b => b.key === 'auto_chess_effect_replace').map(b => b.bbStr));
const at = (row, col) => ({ motion: 'WALK', start: [row, col], end: [row, col], steps: [{ t: 'wait', s: 99999 }] });

function fight(t, { stealth = false, count = 5 } = {}) {
  setGameData(RAW); t.after(() => setGameData(null));
  const units = stealth ? ids.map((chessId, i) => ({ uid: i + 1, kind: 'chess', chessId, row: 10, col: i + 3 }))
    : Array.from({ length: count }, (_, i) => ({ uid: i + 1, kind: 'chess', chessId: 'test_visible', row: 10, col: i + 3 }));
  if (stealth) units.push({ uid: 7, kind: 'chess', chessId: 'test_visible', row: 10, col: 10 });
  const h = makeBattle({ data, content: 'generic', extraContent: [bonds, enemies, bosses], autoFinish: false, timeLimit: 40,
    players: [{ playerId: 'p1', seat: 0, side: 'L', bandId: stealth ? 'band_siracusa' : null,
      bonds: stealth ? { siracusaShip: { active: true, count: 6, tier: 2, layers: 0 } } : {},
      bondEffectOverrides: stealth ? replacement : {}, units }] });
  h.step();
  t.after(() => assert.equal(h.b.errorCount, 0));
  return h;
}
const spawn = (h, key) => h.spawn(key, { pos: [8, 13], route: at(8, 13) });

for (const key of ['enemy_9035_acspider', 'enemy_9035_acspider_2']) {
  test(`${key}: 裁度's six 叙拉古 members are stealthed and excluded from the HP-ranked volley`, t => {
    const h = fight(t, { stealth: true }), hidden = h.allies().filter(u => ids.includes(u.defId));
    assert.equal(hidden.length, 6);
    for (const u of hidden) assert.ok(u.findBuff('bond:siracusa:stealth') && u.s.flags.stealth);
    const before = hidden.map(u => u.hp), visible = h.unit(7), hp = visible.hp;
    spawn(h, key); h.run(0.2);
    assert.deepEqual(hidden.map(u => u.hp), before, 'highest HP does not bypass stealth');
    assert.equal(hp - visible.hp, 500, 'the lower-HP visible operator is still attacked');
  });

  test(`${key}: 淤困捕食 does not spawn a cocoon on stealthed members`, t => {
    const h = fight(t, { stealth: true });
    spawn(h, key); h.run(15.2);
    const webs = h.enemies().filter(e => e.defId === 'enemy_9036_acweb');
    assert.equal(webs.length, 1);
    assert.equal(webs[0].x, h.unit(7).x);
    assert.equal(webs[0].y, h.unit(7).y);
    for (const u of h.allies().filter(u => ids.includes(u.defId))) {
      assert.ok(u.s.flags.stealth);
      assert.equal(!!u.s.flags.disarm, false);
    }
  });

  for (const flag of ['stealth', 'camou', 'untargetable', 'sleep', 'liftoff']) {
    test(`${key}: ${flag} does not consume a volley target slot`, t => {
      const h = fight(t), ops = h.allies().sort((a, b) => a.uid - b.uid);
      ops.forEach((u, i) => { u.hp = 10000 - i * 1000; });
      h.b.addBuff(ops[0], { key: 'test:selection', persist: true, flags: { [flag]: true } });
      const hp = ops.map(u => u.hp), n = RAW.enemies[key].talents.bb['Passive.attack@max_target'];
      spawn(h, key); h.run(0.2);
      assert.equal(ops[0].hp, hp[0]);
      for (let i = 1; i <= n; i++) assert.equal(hp[i] - ops[i].hp, 500);
    });
  }
}

test('no selectable target means no volley; removing stealth permits the next attack', t => {
  const h = fight(t, { count: 1 }), u = h.unit(1), hp = u.hp;
  h.b.addBuff(u, { key: 'test:stealth', persist: true, flags: { stealth: true } });
  const e = spawn(h, 'enemy_9035_acspider');
  h.run(3);
  assert.equal(u.hp, hp);
  assert.equal(e.stats.attacks, 0);
  h.b.removeBuff(u, 'test:stealth'); h.step();
  assert.equal(hp - u.hp, 500);
  assert.equal(e.stats.attacks, 1);
});

test('already-applied hidden-core poison keeps ticking after stealth starts', t => {
  const h = fight(t, { count: 1 }), u = h.unit(1);
  spawn(h, 'enemy_9035_acspider_2'); h.run(0.2);
  assert.ok(u.findBuff('reg:poison'));
  const hp = u.hp;
  h.b.addBuff(u, { key: 'test:stealth', persist: true, flags: { stealth: true } });
  h.run(1.1);
  assert.equal(hp - u.hp, 50, 'an existing DoT is not a fresh target selection');
});

test('hidden-core acid rain retains its separate ignore-targetability area effect', t => {
  const h = fight(t, { count: 1 }), u = h.unit(1);
  h.b.addBuff(u, { key: 'test:stealth', persist: true, flags: { stealth: true } });
  const hp = u.hp;
  spawn(h, 'enemy_9035_acspider_2'); h.run(25.6);
  assert.ok(u.s.flags.stealth);
  assert.ok(u.findBuff('reg:acid'));
  assert.equal(hp - u.hp, 75, 'do not replace damage resolution with a blanket stealth immunity');
});
