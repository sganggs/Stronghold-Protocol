// 4-direction facing in the content (research 09 §6.1 item 3): every "身前 / 身后 / 左右 / 对着" effect follows the unit's
// direction `dir` (UP|RIGHT|DOWN|LEFT, server/sim/dir.js) — bonds (阿戈尔 front tile, devour order), items (叙拉古正装
// perpendicular pair, 歌利亚头盔 front tile), devices (blower relation by direction equality / opposition: the m01 DOWN
// blowers), garrisons (身前 on the prep board and in battle), bands (最右边 = a board position), kits (push / pull /
// anchor / device placement directions).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';
import { getDefaultSource } from '../../server/sim/simdata.js';
import { hasGeneratedData } from '../../server/sim/simdata.js';
import { airflowRelationOf } from '../../server/sim/content/devices.js';
import { frontPiece, behindPiece } from '../../server/sim/content/support/meta.js';

const REAL = { skip: !hasGeneratedData() };
const ds = getDefaultSource();
const close = (a, b, msg = '', eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps * Math.max(1, Math.abs(b)), `${msg} ${a} ≈ ${b}`);
const dummy = (key = 'e_d', o = {}) => enemyRec({ key, hp: 1e8, speed: 0, def: 0, res: 0, ...o });
const fill = (u) => u.skill.gainSp(u.skill.spCost * u.skill.maxCharges + 1, 'test');
const op = (id, o = {}) => chessRec({
  id, profession: o.profession ?? 'WARRIOR', bonds: o.bonds ?? [], tier: o.tier ?? 1, skill: null,
  rangeGrid: o.range ?? [[0, 0], [0, 1]],
  stats: { maxHp: 10000, atk: 1000, def: 0, res: 0, aspd: 100, bat: 1, blockCnt: 2, respawnTime: 20, ...(o.stats || {}) },
});
const bondOn = (count, thresholds = [3, 5]) => ({ count, active: count >= thresholds[0], tier: thresholds.filter((t) => count >= t).length, layers: 0 });
const tagged = (h, tag) => h.hooksOf('damaged').filter((c) => c.dmg && c.dmg.tags && c.dmg.tags.includes(tag));

// ---------------------------------------------------------------------------------------------------------------------
// bonds

test('阿戈尔 devour: "身前一格" is one step along each member\'s direction (UP devours the operator above)', () => {
  const chess = { g1_a: op('g1_a', { bonds: ['egirShip'] }), g2_a: op('g2_a', { bonds: ['egirShip'] }), g3_a: op('g3_a', { bonds: ['egirShip'] }), up_a: op('up_a', { tier: 3 }), right_a: op('right_a', { tier: 2 }) };
  const units = [
    { chessId: 'g1_a', row: 10, col: 4, dir: 'UP' }, { chessId: 'up_a', row: 11, col: 4 }, { chessId: 'right_a', row: 10, col: 5 },
    { chessId: 'g2_a', row: 9, col: 8 }, { chessId: 'g3_a', row: 12, col: 8 },
  ];
  const h = makeBattle({ defs: { chess }, units, bonds: { egirShip: bondOn(3) }, hooks: ['damaged'], captureNoisy: true });
  h.step(1);
  const dv = tagged(h, 'bond:egir:devour').map((c) => [c.source.defId, c.target.defId]);
  assert.deepEqual(dv, [['g1_a', 'up_a']], 'the operator above, not the one to the right');
  close(h.unit('g1_a').s.atk, 1000 + 1000, 'base ATK of the devoured');
  assert.equal(h.b.getPlayer('p1').bonds.egirShip.layers, 3, 'layers = the devoured tier');
  checkInvariants(h.b);
});

test('阿戈尔 devour order is a board position (left first) whatever the members face; the mirrored FA side counts from its own board', () => {
  const chess = { g1_a: op('g1_a', { bonds: ['egirShip'] }), g2_a: op('g2_a', { bonds: ['egirShip'] }), g3_a: op('g3_a', { bonds: ['egirShip'] }), fod_a: op('fod_a') };
  // g1 at board col 3 facing LEFT (its front: col 2), g2 at col 5 facing RIGHT — g1 is further left, so it goes first
  const units = [
    { uid: 1, kind: 'chess', chessId: 'g1_a', row: 10, col: 3, dir: 'LEFT' }, { uid: 2, kind: 'chess', chessId: 'fod_a', row: 10, col: 2 },
    { uid: 3, kind: 'chess', chessId: 'g2_a', row: 10, col: 5, dir: 'RIGHT' }, { uid: 4, kind: 'chess', chessId: 'fod_a', row: 10, col: 6 },
    { uid: 5, kind: 'chess', chessId: 'g3_a', row: 12, col: 9 },
  ];
  for (const side of ['L', 'R']) {
    const h = makeBattle({
      kind: side === 'L' ? 'normal' : 'boss', defs: { chess }, hooks: ['damaged'], captureNoisy: true,
      players: [{ playerId: 'p1', seat: 0, side, colOffset: side === 'L' ? 0 : 8, units: units.map((u) => ({ ...u })), bonds: { egirShip: bondOn(3) } }],
    });
    h.step(1);
    assert.deepEqual(tagged(h, 'bond:egir:devour').map((c) => c.source.uid), [1, 3], `side ${side}: board col 3 before col 5`);
    checkInvariants(h.b);
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// items

test('叙拉古正装: the two tiles beside the carrier are perpendicular to ITS direction (an UP carrier: left / right columns)', () => {
  const id = 'chess_item_3_01_e_a';
  const chess = { t_op: op('t_op'), t_l: op('t_l'), t_r: op('t_r'), t_f: op('t_f'), t_b: op('t_b') };
  const h = makeBattle({ defs: { chess }, units: [
    { chessId: 't_op', row: 10, col: 5, items: [id], dir: 'UP' }, { chessId: 't_l', row: 10, col: 4 }, { chessId: 't_r', row: 10, col: 6 },
    { chessId: 't_f', row: 11, col: 5 }, { chessId: 't_b', row: 9, col: 5 },
  ] });
  h.run(1);
  const side = h.unit('t_l').s.aspd;
  assert.ok(side > 100, 'left column');
  assert.equal(h.unit('t_r').s.aspd, side, 'right column');
  assert.equal(h.unit('t_f').s.aspd, 100, 'in front (above): no');
  assert.equal(h.unit('t_b').s.aspd, 100, 'behind (below): no');
});

test('歌利亚头盔: the tile in front follows the carrier direction (DOWN: the tile below)', () => {
  const id = 'chess_item_3_06_e_a';
  const chess = { t_op: op('t_op', { stats: { maxHp: 2000 } }), t_f: op('t_f') };
  const hp = (units) => { const h = makeBattle({ defs: { chess }, units }); h.step(1); return h.unit('t_op').s.maxHp; };
  const free = hp([{ chessId: 't_op', row: 11, col: 4, items: [id], dir: 'DOWN' }]);
  const below = hp([{ chessId: 't_op', row: 11, col: 4, items: [id], dir: 'DOWN' }, { chessId: 't_f', row: 10, col: 4 }]);
  const right = hp([{ chessId: 't_op', row: 11, col: 4, items: [id], dir: 'DOWN' }, { chessId: 't_f', row: 11, col: 5 }]);
  assert.ok(below < free, 'an operator below a DOWN carrier occupies its front tile');
  close(right, free, 'the tile to its right is not in front');
});

// ---------------------------------------------------------------------------------------------------------------------
// devices

test('气流 relation by direction: equal / opposite / perpendicular (vertical)', () => {
  assert.equal(airflowRelationOf('DOWN', 'DOWN'), 'equal');
  assert.equal(airflowRelationOf('UP', 'DOWN'), 'opposite');
  assert.equal(airflowRelationOf('RIGHT', 'DOWN'), 'vertical');
  assert.equal(airflowRelationOf('LEFT', 'RIGHT'), 'opposite');
});

test('气流 (act2 m01 DOWN blowers): an operator facing DOWN gets ATK +equal, UP +opposite, RIGHT nothing', REAL, () => {
  const stage = ds.getStage('act2autochess_m01');
  const bb = stage.devices.find((d) => d.role === 'blower').raw.skill.bb;
  const atkOf = (dir) => {
    const h = makeBattle({ stageId: 'act2autochess_m01', defs: { chess: { t_g: op('t_g') } }, units: [{ chessId: 't_g', row: 11, col: 5, dir }], autoFinish: false, timeLimit: 10 });
    h.run(0.5);
    return h.unit('t_g').s.atk;
  };
  close(atkOf('DOWN'), 1000 * (1 + bb['blower_s_character[equal].atk']), 'with the flow');
  close(atkOf('UP'), 1000 * (1 + bb['blower_s_character[opposite].atk']), 'against the flow');
  close(atkOf('RIGHT'), 1000, 'across the flow');
});

// ---------------------------------------------------------------------------------------------------------------------
// garrisons (prep and battle)

test('prep "身前一格" (support/meta frontPiece / behindPiece) follows the board piece dir', () => {
  const board = [
    { uid: 1, kind: 'chess', row: 10, col: 5, dir: 'UP' }, { uid: 2, kind: 'chess', row: 11, col: 5 }, { uid: 3, kind: 'chess', row: 10, col: 6 },
    { uid: 4, kind: 'chess', row: 9, col: 5 }, { uid: 5, kind: 'chess', row: 12, col: 5 },
  ];
  const ctx = { board: () => board };
  assert.equal(frontPiece(ctx, board[0]).uid, 2, 'UP: the piece above');
  assert.equal(frontPiece(ctx, board[0], 2).uid, 5, 'two tiles in front');
  assert.equal(behindPiece(ctx, board[0]).uid, 4, 'behind: below');
  assert.equal(frontPiece(ctx, { ...board[0], dir: undefined }).uid, 3, 'no dir ⇒ RIGHT');
  assert.equal(frontPiece(ctx, { ...board[0], dir: 'LEFT' }), null);
});

test('魔王 (garrison_59): the operator "in front" is along its direction', () => {
  const rec = (id, g) => ({ ...chessRec({ id }), garrisonIds: g });
  const run = (mwDir, frontAt) => {
    const h = makeBattle({
      defs: { chess: { mw: rec('mw', ['garrison_59_a']), fr: rec('fr', ['garrison_42_a']) }, enemies: { e_d: dummy() } },
      units: [{ chessId: 'mw', row: 10, col: 4, dir: mwDir }, { chessId: 'fr', row: frontAt[0], col: frontAt[1] }],
      bonds: { sargonShip: { count: 3, active: true, tier: 1, layers: 0 } }, autoFinish: false, timeLimit: 30,
    });
    h.step(1);
    const u = h.unit('fr');
    h.b.emit('skillStart', { unit: u, skill: u.skill, reason: 'test' });
    return h.result().perPlayer.p1.layerGains.sargonShip;
  };
  const up = run('UP', [11, 4]);
  const side = run('UP', [10, 5]);
  assert.equal(up, side + 1, 'the operator above an UP-facing 魔王 gets the +1; the one to its right does not');
});

// ---------------------------------------------------------------------------------------------------------------------
// bands

test('桑葚 药枚实验 "最右边" is the right-most board column whatever the units face', () => {
  const chess = { t_a: op('t_a', { range: [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]] }), t_b: op('t_b', { range: [[0, 0], [0, 1], [0, -1], [1, 0], [-1, 0]] }) };
  const h = makeBattle({
    defs: { chess, enemies: { e_d: dummy() } }, bandId: 'band_mberry', autoFinish: false, timeLimit: 30,
    units: [{ chessId: 't_a', row: 10, col: 7, dir: 'LEFT' }, { chessId: 't_b', row: 11, col: 5, dir: 'RIGHT' }],
    enemies: [{ key: 'e_d', pos: [10, 6] }, { key: 'e_d', pos: [11, 6] }],
  });
  const orig = h.b.rng;
  h.b.rng = Object.assign(() => 0, orig);
  h.run(3.1);
  const sh = (u) => { const b = u.findBuff('band:band_mberry:shield'); return b ? b.shieldHits : 0; };
  assert.equal(sh(h.unit('t_a')), 1, 'col 7 (facing LEFT) is the right-most column');
  assert.equal(sh(h.unit('t_b')), 0, 'col 5 facing RIGHT is not');
});

// ---------------------------------------------------------------------------------------------------------------------
// kits

test('见行者 (3_07) 惊爆射击 pushes along her direction (DOWN: the enemy below is pushed further down)', () => {
  const id = 'chess_char_3_07_a';
  const h = makeBattle({
    defs: { enemies: { enemy_a: dummy('enemy_a', { mass: 1 }) } }, timeLimit: 60,
    units: [{ chessId: id, row: 12, col: 4, dir: 'DOWN' }], enemies: [{ key: 'enemy_a', pos: [11, 4] }],
  });
  const u = h.unit(id);
  h.step();
  const e = h.enemy('enemy_a');
  fill(u);
  assert.ok(h.runUntil(() => u.skill.activations === 1, 5), 'skill cast');
  assert.ok(e.y < 10.6, `pushed down (${e.y})`);
  close(e.x, 4, 'no sideways push', 1e-3);
  checkInvariants(h.b);
});

test('薄绿 (3_08) 聚能涡旋 pushes the target towards her centre whatever her direction (PRTS 备注: a reversed radial push)', () => {
  // PRTS 薄绿 S2 备注 "此技能的“拖拽”机制实际为反方向（指向薄绿方向）的推开" / 推与拉 (radial force): towards her centre,
  // the official push distance (小力 vs weight 0: 1.7 tiles), stopping at the 急停 radius in front of her [ASSUMED]
  const id = 'chess_char_3_08_a';
  const run = (dir) => {
    const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d', { mass: 0 }) } }, timeLimit: 60, units: [{ chessId: id, row: 9, col: 4, dir }], enemies: [{ key: 'enemy_d', pos: [11, 4] }] });
    const u = h.unit(id);
    h.step();
    fill(u);
    assert.ok(h.runUntil(() => u.skill.active, 5));
    h.run(3);
    assert.ok(h.eventsOf('fx').some((f) => f[1] === 'displace' && f[4]?.keepFacing === true),
      `${dir}: Mint S2's inward push inherits the common facing metadata`);
    return h.enemy('enemy_d');
  };
  for (const dir of ['UP', 'RIGHT']) {
    const e = run(dir);
    assert.ok(e.y < 11 - 0.2 && Math.abs(e.x - 4) < 0.05, `${dir}: pushed straight down towards her (${e.x}, ${e.y})`);
    assert.ok(Math.hypot(e.x - 4, e.y - 9) >= 0.6708 - 1e-6, `${dir}: stops in front of her, not on her tile (${e.y})`);
  }
});

test('乌尔比安 (5_05) S3 throws the anchor straight ahead along his direction (and triggers on the rotated grid)', () => {
  const id = 'chess_char_5_05_a';
  const run = (dir) => {
    const h = makeBattle({ defs: { enemies: { enemy_d: dummy('enemy_d') } }, timeLimit: 60, hooks: ['statusApplied', 'skillStart'],
      units: [{ chessId: id, row: 9, col: 4, dir }], enemies: [{ key: 'enemy_d', pos: [11, 4] }] });
    const u = h.unit(id);
    h.step();
    fill(u);
    h.run(2);
    return { h, u };
  };
  const { h, u } = run('UP');
  assert.ok(h.hooksOf('skillStart').some((c) => c.unit === u), 'an enemy two tiles above is in the rotated trigger range');
  const anchor = h.eventsOf('fx').find((e) => e[1] === 'anchor');
  assert.ok(anchor, 'anchor fx');
  assert.deepEqual([anchor[2], anchor[3]], [4, 11], 'the anchor stops on the enemy above');
  assert.ok(h.hooksOf('statusApplied').some((c) => c.status === 'stun' && c.target.defId === 'enemy_d'));
  assert.deepEqual([u.tileR, u.tileC], [11, 4], 'he lands on the anchor tile');
  const r = run('RIGHT');
  assert.ok(!r.h.hooksOf('skillStart').some((c) => c.unit === r.u), 'facing RIGHT: nothing ahead, no cast');
});

test('凯瑟琳 (4_11): a placed device shields the operator on the tile IT faces (range 1-1 rotated by its direction)', REAL, () => {
  const id = 'chess_char_4_11_a', ally = 'chess_char_1_02_a';
  // the device at (10,5); operators on its four neighbours; its direction picks the one it serves (user playtest #6)
  const serve = (dir) => {
    const h = makeBattle({
      units: [
        { chessId: id, row: 12, col: 2, uid: 1 },
        { chessId: ally, row: 10, col: 6, uid: 2 }, { chessId: ally, row: 11, col: 5, uid: 3 },
        { chessId: ally, row: 9, col: 5, uid: 4 }, { chessId: ally, row: 10, col: 4, uid: 5 },
        { kind: 'token', tokenId: 'token_10041_cathy_catsld', ownerUid: 1, row: 10, col: 5, uid: 6, dir },
      ],
      timeLimit: 30, hooks: [],
    });
    h.run(0.2);
    const shielded = h.b.allyUnits.filter((x) => x.kind === 'op' && x.findBuff('cathy:shield')).map((x) => `${x.tileR},${x.tileC}`);
    return shielded;
  };
  assert.deepEqual(serve('RIGHT'), ['10,6']);
  assert.deepEqual(serve('UP'), ['11,5'], 'row 0 is the bottom: UP faces the row above');
  assert.deepEqual(serve('DOWN'), ['9,5']);
  assert.deepEqual(serve('LEFT'), ['10,4']);
});

test('余 (6_03) S3 fire wall runs through his tile perpendicular to his direction (UP / DOWN: his row; RIGHT / LEFT: his column)', REAL, () => {
  const run = (dir, casterAt, enemyAt) => {
    const h = makeBattle({
      defs: { chess: { t_cst: op('t_cst', { profession: 'CASTER', range: [[0, 0]] }) }, enemies: { e_d: dummy() } },
      units: [{ chessId: 'chess_char_6_03_a', row: 10, col: 5, dir }, { chessId: 't_cst', row: casterAt[0], col: casterAt[1] }],
      enemies: [{ key: 'e_d', pos: enemyAt }], autoFinish: false, timeLimit: 30, hooks: ['damaged'], captureNoisy: true,
    });
    h.run(0.2);
    const yu = h.unit('chess_char_6_03_a'), c = h.unit('t_cst'), e = h.b.enemies[0];
    assert.ok(e && e.alive && c.deployed && yu.deployed);
    yu.skill.activate('test', { free: true });
    assert.ok(yu.skill.active, 'S3 on');
    const wall = h.eventsOf('fx').find((f) => f[1] === 'firewall');
    const n = tagged(h, 'firewall').length;
    h.b.dealDamage(c, e, { amount: 1000, type: 'arts' });
    return { burned: tagged(h, 'firewall').length > n, axis: wall && wall[4] && wall[4].axis };
  };
  // caster at (12, 3), enemy at (9, 3): same column side, opposite sides of row 10
  assert.equal(run('UP', [12, 3], [9, 3]).burned, true, 'UP: arts damage crossing his row burns');
  assert.equal(run('DOWN', [12, 3], [9, 3]).axis, 'row');
  assert.equal(run('RIGHT', [12, 3], [9, 3]).burned, false, 'RIGHT: the wall is his column — nothing crossed');
  // caster at (12, 3), enemy at (12, 8): opposite sides of column 5, same side of row 10
  assert.equal(run('RIGHT', [12, 3], [12, 8]).burned, true, 'RIGHT: crossing his column burns (as before)');
  assert.equal(run('LEFT', [12, 3], [12, 8]).axis, 'col');
  assert.equal(run('UP', [12, 3], [12, 8]).burned, false, 'UP: not crossing his row');
});
