// test/match/feedback3-unitecarry.test.js — community report #34 / GitHub #82: 联防 carried a skill that was running at
// the end of a helper's own combat and restarted it for free (圣聆初雪's S2 on at the 联防 start with SP 0, an empty bar).
// Official (PRTS 卫戍协议/帮助 §联防阶段): "部署完成后，将对应单位的生命比例、技力修改至与上一阶段结束时相同（召唤物仅修改技力，
// 上一阶段为退场状态的干员强制退场）"; the official setup message carries `charBattleStatusList: [{ instId, hp, tech }]` only
// (research 09 §3 HelpBattleInfo). So: an operator's HP ratio and 技力, a summon's 技力, nothing of the skill state.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { uniteBattleOpts } from '../../server/match/unite.js';
import { makeBattle, chessRec, enemyRec } from '../helpers/battleHarness.js';
import { makeMatch } from './harness.js';

const close = (a, b, eps = 1e-6, msg = '') => assert.ok(Math.abs(a - b) <= eps, `${msg} expected ${b}, got ${a}`);

let gdCache = null;
/** A real GameData (unite templates for buildUniteWave). */
function gd() {
  if (!gdCache) gdCache = makeMatch({ mode: 'coop', humans: 3, seed: 1, fake: true }).start().m.gd;
  return gdCache;
}

/**
 * unite.js's carry for one helper, from the given end-of-combat report: board = [[uid, 'chess'|'token', chessId?]],
 * the helper's battle input lists those pieces (board row 10, from col 3) with the carry unite.js attached.
 */
function uniteInput(board, unitsEnd) {
  const ps = {
    playerId: 'p1', seat: 0,
    board: new Map(board.map(([uid, kind], i) => [`10,${3 + i}`, { uid, kind }])),
    battleInput: ({ side, colOffset, carry }) => ({
      playerId: 'p1', seat: 0, side, colOffset, bonds: {}, bandId: null, playerEffects: [],
      units: board.map(([uid, kind, id, extra], i) => ({
        uid, kind, ...(kind === 'token' ? { tokenId: id } : { chessId: id }), row: 10, col: 3 + i, dir: 'RIGHT', items: [],
        ...(extra || {}), ...(carry.has(uid) ? { carryState: carry.get(uid) } : {}),
      })),
    }),
  };
  const m = { gd: gd(), round: 3, lastResults: new Map([['p1', { unitsEnd }]]), dispatch() {} };
  const { players } = uniteBattleOpts(m, { helpers: [ps], leaked: [] }, 60);
  return players[0];
}

test('unite.js carry: HP ratio + SP for an operator (never skillActive), SP only for a summon on the field, down for a knocked-out operator', () => {
  const input = uniteInput(
    [[1, 'chess', 't_run'], [2, 'token', 'tok'], [3, 'chess', 't_down'], [4, 'token', 'tok2']],
    [
      { uid: 1, hpPct: 0.4, sp: 0, skillActive: true, alive: true },
      { uid: 2, hpPct: 0.3, sp: 40, skillActive: false, alive: true },
      { uid: 3, hpPct: 0, sp: 7, skillActive: false, alive: false },
      { uid: 4, hpPct: 0, sp: 12, skillActive: false, alive: false },
    ],
  );
  const cs = (uid) => input.units.find((u) => u.uid === uid).carryState;
  assert.deepEqual(cs(1), { hpPct: 0.4, sp: 0 }, 'the running skill is not carried');
  assert.deepEqual(cs(2), { sp: 40 }, '召唤物仅修改技力');
  assert.deepEqual(cs(3), { down: true });
  assert.equal(cs(4), undefined, 'a summon off the field at the end enters fresh [ASSUMED]');
});

test('PlayerState.battleInput hands a summon piece its carryState', () => {
  const h = makeMatch({ mode: 'coop', humans: 3, seed: 5, fake: true }).start();
  h.toPrep(1);
  const ps = h.ps('p_1');
  const tok = ps.newPiece('token', 'token_10030_mlyss_wtrman', { ownerUid: 999 });
  ps.board.set('10,4', tok);
  const input = ps.battleInput({ carry: new Map([[tok.uid, { sp: 40 }]]) });
  assert.deepEqual(input.units.find((u) => u.uid === tok.uid).carryState, { sp: 40 });
});

test('an operator whose skill runs at the end of its own combat enters 联防 with the skill off and the carried SP; stored charges come back', () => {
  const defs = {
    chess: {
      // a 30 s skill (cost 10, ready at once) cast on the dummy in range: running when the own combat ends
      t_run: chessRec({ id: 't_run', profession: 'SNIPER', rangeGrid: [[0, 0], [0, 1], [0, 2]], stats: { atk: 100 },
        skill: { duration: 30, spCost: 10, initSp: 10, bb: { atk: 1 } } }),
      // 2 charges of a cost-5 skill, nothing in range: both charges stored at the end (技力 10 = 2 × 5)
      t_chg: chessRec({ id: 't_chg', profession: 'SNIPER', rangeGrid: [[0, 0]], stats: { atk: 100 },
        skill: { duration: 5, spCost: 5, initSp: 0, maxChargeTime: 2, bb: { atk: 1 } } }),
    },
    enemies: { e_dummy: enemyRec({ key: 'e_dummy', hp: 1e9, speed: 0 }) },
  };
  const own = makeBattle({
    defs, content: 'generic', autoFinish: false, timeLimit: 60,
    units: [{ uid: 1, chessId: 't_run', row: 10, col: 3 }, { uid: 2, chessId: 't_chg', row: 12, col: 3 }],
    enemies: [{ key: 'e_dummy', pos: [10, 5] }],
  });
  own.runUntil(() => own.unit('t_run').skill.active, 10);
  own.run(12);
  assert.ok(own.unit('t_run').skill.active, 'still running at the end');
  const unitsEnd = own.result().perPlayer.p1.unitsEnd;
  const end = (uid) => unitsEnd.find((u) => u.uid === uid);
  assert.equal(end(1).skillActive, true);
  assert.equal(end(1).sp, 0, 'spent at the activation (PRTS 技能 "触发技能后…消耗相应的技力")');
  assert.equal(own.unit('t_chg').skill.charges, 2);
  assert.equal(end(2).sp, 10, 'the official 技力: both charges (PRTS 技能 "当前技力上限等于该技能技力需求的X倍")');

  const input = uniteInput([[1, 'chess', 't_run'], [2, 'chess', 't_chg']], unitsEnd);
  input.units[1].row = 12; // as on the own field
  const u = makeBattle({ kind: 'unite', defs, content: 'generic', autoFinish: false, players: [input] });
  u.step();
  const run = u.unit('t_run'), chg = u.unit('t_chg');
  close(run.hpRatio, end(1).hpPct, 1e-6, 'HP ratio');
  assert.equal(run.skill.active, false, 'the skill enters 联防 switched off (it used to restart for free)');
  assert.equal(run.skill.activations, 0);
  assert.ok(run.skill.sp < 0.1, `SP from 0, got ${run.skill.sp}`);
  close(run.s.atk, 100, 1e-6, 'no skill ATK');
  assert.equal(chg.skill.charges, 2, 'the stored charges are back');
});

test('a summon piece enters 联防 with its carried SP only (流形: SP set, HP full)', () => {
  // 缪尔赛思 (chess_char_6_11_a) and her board 流形 (token_10030_mlyss_wtrman: cost 100, initial SP 95)
  const players = [{
    playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, bandId: null, playerEffects: [],
    units: [
      { uid: 1, kind: 'chess', chessId: 'chess_char_6_11_a', row: 10, col: 3, dir: 'RIGHT', items: [], carryState: { hpPct: 0.5, sp: 3 } },
      { uid: 2, kind: 'token', tokenId: 'token_10030_mlyss_wtrman', ownerUid: 1, row: 10, col: 4, dir: 'RIGHT', carryState: { sp: 40, hpPct: 0.3 } },
    ],
  }];
  const h = makeBattle({ kind: 'unite', players, autoFinish: false });
  h.step();
  const tok = h.b.allyUnits.find((x) => x.uid === 2);
  assert.ok(tok && tok.alive && tok.deployed, 'the 流形 is on the field');
  assert.ok(tok.skill.sp >= 40 && tok.skill.sp < 41, `its SP is the carried 40 (fresh it would be 95), got ${tok.skill.sp}`);
  close(tok.hp, tok.s.maxHp, 1e-6, 'a summon keeps no HP ratio (召唤物仅修改技力)');
});

test('联防: the carried SP is set after the deployment ("部署完成后…技力修改") — 独行 / 黄沙罗盘 deploy-time SP does not come on top; a later redeploy keeps it', () => {
  const caster = (id, bonds = []) => chessRec({ id, bonds, profession: 'CASTER', stats: { maxHp: 1000, atk: 100 }, skill: { spCost: 40, initSp: 10, duration: 10 } });
  const cases = [
    // 独行 (bonds.json soloShip bb.sp 15: "初始技力+15") on its lone member
    { name: '独行', unit: { chessId: 't_solo' }, defs: { t_solo: caster('t_solo', ['soloShip']) }, bonds: { soloShip: { count: 1, active: true, tier: 1, layers: 0 } }, gift: 15 },
    // 黄沙罗盘 (chess_item_6_07_e "初始技力+30")
    { name: '黄沙罗盘', unit: { chessId: 't_comp', items: ['chess_item_6_07_e_a'] }, defs: { t_comp: caster('t_comp') }, bonds: {}, gift: 30 },
  ];
  for (const c of cases) {
    for (const sp of [0, 30]) {
      const h = makeBattle({
        kind: 'unite', defs: { chess: c.defs }, bonds: c.bonds, autoFinish: false, timeLimit: 60,
        units: [{ ...c.unit, row: 10, col: 4, carryState: { hpPct: 0.5, sp } }],
      });
      h.b.start();
      const u = h.unit(c.unit.chessId);
      close(u.skill.sp, sp, 1e-9, `${c.name}, carried ${sp}: the bar comes back as it ended`);
      assert.equal(u.skill.ready, false, `${c.name}, carried ${sp}: not ready`);
      // a later redeploy in the same 联防 battle: initial SP 10 + the gift, as usual
      h.step();
      h.b.retreat(u, { reason: 'retreat' });
      assert.ok(h.b.redeploy(u, { free: true }));
      close(u.skill.sp, 10 + c.gift, 1e-9, `${c.name}: a later redeploy keeps the deploy-time SP`);
    }
  }
});
