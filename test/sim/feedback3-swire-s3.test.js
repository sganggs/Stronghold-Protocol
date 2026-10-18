// 琳琅诗怀雅 S3: skill_table skchr_swire2_3 spends only on 主动关闭; PRTS 卫戍协议/帮助 技能操作
// https://prts.wiki/w/卫戍协议/帮助 says 通常不会自动关闭技能. Maintainer 2026-10-17 withdrew the cap close.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

const ds = getDefaultSource();
const foe = enemyRec({ key: 'enemy_sw', hp: 1e9, atk: 0, speed: 0, def: 0, res: 0, mass: 1 });
const cash = (h) => h.hooksOf('damaged').filter((c) => c.dmg?.tags.includes('swire2Cash'));

for (const id of ['chess_char_3_04_a', 'chess_char_3_04_b']) {
  for (const pos of [[10, 5.65], [10, 6], [10, 7], null]) {
    test(`琳琅诗怀雅 S3 ${id} at ${pos}: full coins stay, no automatic close or burst`, () => {
      const h = makeBattle({
        seed: 48, units: [{ chessId: id, row: 10, col: 5, skillIndex: 2 }],
        defs: { enemies: { enemy_sw: foe } }, enemies: pos ? [{ key: 'enemy_sw', pos }] : [],
        hooks: ['attack', 'damaged', 'skillEnd', 'merchantPay'], captureNoisy: true,
        flags: { dpInit: 90, dpMax: 99, dpPerSec: 0 }, autoFinish: false, timeLimit: 60,
      });
      h.step();
      const u = h.unit(id), e = h.enemy('enemy_sw');
      assert.equal(u.skill.id, 'skchr_swire2_3');
      assert.ok(u.skill.activate('test', { free: true }));
      const t0 = ds.getChess(id, { skillIndex: 2 }).talents[0].bb;
      const cap = u.skill.bb.sp;
      assert.equal(cap, 10);
      assert.equal(u.mem.coins, t0.sp, 'opening coin');
      // Reach the cap through real 大买家 trait payments, with enemies in/out of range and with none.
      const start = u.skill.lastStart;
      assert.ok(h.runUntil(() => u.mem.coins === cap, 35), 'payments fill the purse');
      const attacks0 = h.hooksOf('attack').length, damage0 = h.hooksOf('damaged').length;
      const x = e?.x, y = e?.y;
      h.run(6);
      assert.equal(u.skill.active, true);
      assert.equal(u.skill.lastStart, start);
      assert.equal(u.skill.activations, 1, 'no close/recast cycle');
      assert.equal(u.mem.coins, cap, 'further payments cannot exceed the cap');
      assert.equal(h.hooksOf('skillEnd').filter((c) => c.unit === u).length, 0);
      assert.equal(cash(h).length, 0);
      if (pos && pos[1] < 7) {
        const attacks = h.hooksOf('attack').slice(attacks0).filter((c) => c.attacker === u);
        const hits = h.hooksOf('damaged').slice(damage0).filter((c) => c.source === u && c.dmg.isAttack);
        assert.ok(attacks.length >= 2, 'double attacks continue at the cap');
        assert.equal(hits.length, attacks.length * 2);
      }
      if (e) assert.deepEqual([e.x, e.y], [x, y], 'no coin push');
      const coins0 = u.mem.coins;
      h.b.retreat(u, { reason: 'test', permanent: true });
      assert.equal(u.mem.coins, coins0, 'retreat does not run a cash-out');
      assert.equal(cash(h).length, 0);
      assert.equal(h.b.errors.length, 0);
      checkInvariants(h.b);
    });
  }
}
