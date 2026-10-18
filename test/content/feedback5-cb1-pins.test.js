// Community reports of 2026-10-06 that are the official behaviour (items 45, 49, 50) — pinned so the answer stays true.
//   49 「炎祐能吃到掉血道具的效果」: PRTS 卫戍协议：盟约 下半/PRTS盟约记录, 源石溶剂 备注 「携带后，全场范围内的所有敌人类我方单位也会
//      获得此装备的“每秒受到60真实伤害”效果（该效果的付与为我方阵营索敌，可对空，无视目标可选性）」 — the 炎佑 is one (no ATK bonus).
//   50 「两个空弦转职阿戈尔然后连一起…最后面的空弦不能吃前面的空弦」: two operators made 阿戈尔 by 变形同构体 + 阿戈尔重刃 devour like any
//      other (same name or not); two NORMAL copies of one item merge (the official merge rule), so the pair needs a normal
//      and an 进阶 set.
//   45 「寻呼模块和电话对干员缪尔赛思用不会给缪尔赛思，会直接道具被吞」: 寻呼模块 「（不高于当前调度中心等级）」 and 简易通讯机 (the
//      phone icon; 备注 「获得的干员等阶不高于当前调度中心等级」) look for an operator sharing her only bond, 调和: 缪尔赛思 herself, tier
//      VI — below shop level 6 there is none and the item is used up with nothing, as 拟态物质 at the copy cap (§25.13.1).
//      The owner kept the official cap, no fallback to any tier (the owner's decision of 2026-10-07; DESIGN §25.21.10).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';
import { makeMatch } from '../match/harness.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';

const REAL = { skip: !hasGeneratedData() };

test('49: a 源石溶剂 carrier on the field drains the 炎佑 60 HP a second, with no ATK bonus', REAL, () => {
  const ids = ['chess_char_1_03', 'chess_char_2_04', 'chess_char_3_03', 'chess_char_3_04', 'chess_char_4_15', 'chess_char_4_17'];
  const tiles = [[11, 3], [11, 4], [12, 3], [12, 4], [11, 5], [12, 5]];
  const h = makeBattle({
    units: ids.map((id, i) => ({ chessId: `${id}_a`, row: tiles[i][0], col: tiles[i][1], items: i === 0 ? ['chess_item_1_05_e_a'] : [] })),
    bonds: { yanShip: { count: 6, layers: 1, active: true, tier: 2 } }, timeLimit: 30, seed: 1, autoFinish: false,
  });
  h.step(2);
  const y = h.b.allyUnits.find((u) => u.defId === 'enemy_9012_acloon');
  const hp0 = y.hp, atk0 = y.s.atk;
  h.run(10);
  assert.ok(Math.abs(hp0 - y.hp - 600) < 1e-6, `600 HP in 10 s, got ${hp0 - y.hp}`);
  assert.equal(y.s.atk, atk0, 'no ATK from the item');
});

test('50: two 空弦 made 阿戈尔 (变形同构体 + 阿戈尔重刃) in a row — the back one devours the front one; any pair does', REAL, () => {
  const morph = (chessId, col, golden = false) => ({ chessId, row: 10, col, items: golden ? ['chess_item_6_09_e_b', 'chess_item_3_07_e_b'] : ['chess_item_6_09_e_a', 'chess_item_3_07_e_a'] });
  for (const [label, pair] of [
    ['two 空弦', [morph('chess_char_3_21_a', 3), morph('chess_char_3_21_a', 4, true)]],
    ['空弦 + 哈洛德', [morph('chess_char_3_21_a', 3), morph('chess_char_2_05_a', 4, true)]],
  ]) {
    const h = makeBattle({
      units: [...pair, { chessId: 'chess_char_2_07_a', row: 12, col: 8 }, { chessId: 'chess_char_3_09_a', row: 9, col: 9 }],
      bonds: { egirShip: { count: 3, active: true, tier: 1, layers: 0 } }, timeLimit: 10, seed: 1, autoFinish: false,
    });
    const marks = [];
    h.b.on('damaged', (c) => { if (c.dmg?.tags?.includes('bond:egir:devour')) marks.push([c.credit.tileC, c.target.tileC]); }, { priority: -1000 });
    h.step(2);
    assert.deepEqual(marks, [[3, 4]], `${label}: the back one (col 3) devours the front one (col 4)`);
  }
});

test('45: 寻呼模块 / 简易通讯机 on 缪尔赛思 below shop level 6 — nothing qualifies (调和, tier ≤ shop level), the item is used up with a toast saying why', () => {
  for (const itemId of ['chess_item_4_01_e_a', 'chess_item_2_06_e_a']) {
    for (const level of [5, 6]) {
      const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', humans: 1, seed: 7, fake: true }).start();
      h.toPrep(1);
      const ps = h.ps('p_0');
      ps.shop.level = level;
      const mly = ps.acquireChess('chess_char_6_11_a', { source: 'test' });
      const item = ps.acquireItem(itemId, { source: 'test' });
      const owned = () => [...ps.board.values(), ...ps.hand, ...ps.temp].filter((p) => p && p.id === 'chess_char_6_11_a').length;
      const n0 = owned(), offers0 = ps.offers.length;
      const warns = [];
      const toast0 = h.m.toast.bind(h.m);
      h.m.toast = (who, kind, text) => { if (kind === 'warn') warns.push(text?.msgid ?? text); return toast0(who, kind, text); };
      assert.deepEqual(h.m.handle('p_0', { t: 'g.equip', itemUid: item.uid, targetUid: mly.uid }), { ok: true });
      assert.equal(ps.find(item.uid), null, `${itemId} @${level}: consumed`);
      const got = owned() - n0 + (ps.offers.length - offers0);
      // used up with nothing: a toast says why (GitHub #401, the owner's OK of 2026-10-09)
      if (level < 6) {
        assert.equal(got, 0, `${itemId} @${level}: nothing (no 调和 operator of tier ≤ ${level})`);
        assert.deepEqual(warns, ['{who}：没有可获得的同盟约干员'], `${itemId} @${level}: the toast`);
      } else {
        assert.equal(got, 1, `${itemId} @6: 缪尔赛思 (granted, or offered by 寻呼模块)`);
        assert.deepEqual(warns, [], `${itemId} @6: no toast`);
      }
    }
  }
});
