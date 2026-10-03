// 4-direction facing on the match side (research 09 §1.2 / §6.1 items 1–4, DESIGN §3): g.move / g.art `dir` (protocol
// validation, default RIGHT), piece.dir stored and kept across rounds, in-place re-orientation, swaps keep each dir,
// effect-placed pieces keep the tile's dir, m.private / battle input / BattleSpec carry dir, 画卷 front by dir, the Final
// Assault mirror, and the bot's direction choice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, PHASE } from '../../shared/constants.js';
import { validateC2S, DIRS } from '../../shared/protocol.js';
import { pieceDir, parseDir, tileKey } from '../../server/match/board.js';
import { bossFieldPlacement } from '../../server/match/finalAssault.js';
import { planLayout, rangeTiles, LAYOUT_PARAMS, fieldModel, airflowAtkMul } from '../../server/match/bot.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import { DATA, makeMatch, give, giveItem, chessOfTier, checkInvariants, legalTileFor } from './harness.js';

const OK = { ok: true };
const MELEE = (c) => c.position === 'MELEE';

function prepMatch(o = {}) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: o.seed ?? 11, ...o }).start();
  h.toPrep(1);
  h.setStage('act2autochess_m01');
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  return { h, m: h.m, ps };
}
const meleeIds = (m, n) => chessOfTier(1, MELEE).filter((id) => m.pool.has(id) && !DATA.chess[id].tokens?.length).slice(0, n);

test('protocol: g.move / g.art accept an optional dir ∈ UP|RIGHT|DOWN|LEFT and reject anything else', () => {
  assert.deepEqual([...DIRS], ['UP', 'RIGHT', 'DOWN', 'LEFT']);
  const to = { area: 'board', row: 10, col: 4 };
  assert.equal(validateC2S({ t: 'g.move', uid: 5, to }), null, 'dir optional');
  for (const d of DIRS) assert.equal(validateC2S({ t: 'g.move', uid: 5, to, dir: d }), null, d);
  for (const bad of ['up', 'NORTH', 1, null, {}]) assert.notEqual(validateC2S({ t: 'g.move', uid: 5, to, dir: bad }), null, String(bad));
  assert.equal(validateC2S({ t: 'g.art', itemUid: 5, row: 10, col: 4 }), null);
  assert.equal(validateC2S({ t: 'g.art', itemUid: 5, row: 10, col: 4, dir: 'DOWN' }), null);
  assert.notEqual(validateC2S({ t: 'g.art', itemUid: 5, row: 10, col: 4, dir: 'SIDEWAYS' }), null);
  assert.equal(parseDir(undefined), 'RIGHT');
  assert.equal(parseDir('LEFT'), 'LEFT');
  assert.equal(parseDir('left'), null);
  assert.equal(pieceDir({}), 'RIGHT');
});

test('g.move stores the dir (default RIGHT); the view, the battle input and the BattleSpec carry it', () => {
  const { m, ps } = prepMatch();
  const [a, b] = meleeIds(m, 2).map((id) => give(m, ps, id, 'hand'));
  assert.deepEqual(ps.move(a.uid, { area: 'board', row: 9, col: 3 }, 'UP'), OK);
  assert.deepEqual(ps.move(b.uid, { area: 'board', row: 9, col: 4 }), OK);
  assert.equal(a.dir, 'UP');
  assert.equal(pieceDir(b), 'RIGHT', 'absent ⇒ RIGHT');
  const view = ps.privateView();
  assert.equal(view.board.find((p) => p.uid === a.uid).dir, 'UP');
  assert.equal(view.board.find((p) => p.uid === b.uid).dir, 'RIGHT');
  assert.equal(view.hand.filter(Boolean).every((p) => p.dir === undefined), true, 'hand pieces have no direction');
  const input = ps.battleInput();
  assert.equal(input.units.find((u) => u.uid === a.uid).dir, 'UP');
  const spec = buildBattleSpec({ kind: 'normal', seed: 3, stageId: m.stageId, players: [input], spawns: [], routes: [], timeLimit: 30 });
  assert.equal(spec.players[0].units.find((u) => u.uid === a.uid).dir, 'UP', 'the spec (JSON) keeps dir');
  const battle = createBattleFromSpec(spec, DATA);
  const unit = battle.allyUnits.find((u) => u.uid === a.uid);
  assert.equal(unit.dir, 'UP', 'the spec-built battle deploys it facing UP');
  assert.deepEqual(ps.move(b.uid, { area: 'board', row: 9, col: 5 }, 'NORTH'), { error: ERR.BAD_TARGET, detail: 'bad dir' });
  assert.ok(ps.board.get(tileKey(9, 4)) === b, 'a rejected move changes nothing');
  assert.deepEqual(ps.move(b.uid, { area: 'board', row: 9, col: 4, dir: 'DOWN' }), OK, '`to.dir` is read when the top-level dir is absent');
  assert.equal(b.dir, 'DOWN');
  checkInvariants(m);
  m.dispose();
});

test('g.move onto the own tile re-orients in place; board↔board swaps keep each piece\'s dir; tokens too', () => {
  const { m, ps } = prepMatch();
  const [a, b] = meleeIds(m, 2).map((id) => give(m, ps, id, 'hand'));
  ps.move(a.uid, { area: 'board', row: 9, col: 3 }, 'UP');
  ps.move(b.uid, { area: 'board', row: 9, col: 4 }, 'LEFT');
  const bonds0 = JSON.stringify(ps.bonds);
  assert.deepEqual(ps.move(a.uid, { area: 'board', row: 9, col: 3 }, 'DOWN'), OK, 'same tile, new dir');
  assert.equal(a.dir, 'DOWN');
  assert.equal(ps.board.get(tileKey(9, 3)), a);
  assert.equal(JSON.stringify(ps.bonds), bonds0);
  assert.deepEqual(ps.move(a.uid, { area: 'board', row: 9, col: 4 }, 'RIGHT'), OK, 'swap');
  assert.equal(ps.board.get(tileKey(9, 4)), a);
  assert.equal(a.dir, 'RIGHT', 'the moved piece takes the new dir');
  assert.equal(ps.board.get(tileKey(9, 3)), b);
  assert.equal(b.dir, 'LEFT', 'the occupant keeps its own dir');
  // withdraw-swap: a bench card takes the withdrawn piece's tile with that tile's facing
  const c = give(m, ps, meleeIds(m, 3)[2], 'hand');
  const idx = ps.hand.indexOf(c);
  assert.deepEqual(ps.move(b.uid, { area: 'hand', idx }), OK);
  assert.equal(ps.board.get(tileKey(9, 3)), c);
  assert.equal(c.dir, 'LEFT');
  // placeable summons: a token piece gets its dir, and re-orients in place
  const summoner = [1, 2, 3, 4, 5, 6].flatMap((t) => chessOfTier(t)).find((id) => m.gd.placeableTokens(id).length && m.pool.has(id));
  assert.ok(summoner, 'a chess with placeable summons exists');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  const [sr, sc] = legalTileFor(m, ps, summoner);
  const s = give(m, ps, summoner, 'hand');
  assert.deepEqual(ps.move(s.uid, { area: 'board', row: sr, col: sc }, 'UP'), OK);
  const stack = [...ps.hand, ...ps.temp].find((p) => p && p.kind === 'token');
  assert.ok(stack, 'its summons joined the hand');
  const tokRec = m.gd.token(stack.id);
  const free = [...ps.deployMap()].map(([k]) => k.split(',').map(Number)).find(([r, c]) => !ps.board.has(tileKey(r, c)) && ps._legal(stack, r, c));
  assert.ok(free, `a legal tile for ${tokRec?.name ?? stack.id}`);
  assert.deepEqual(ps.move(stack.uid, { area: 'board', row: free[0], col: free[1] }, 'DOWN'), OK);
  const placed = ps.board.get(tileKey(free[0], free[1]));
  assert.equal(placed.kind, 'token');
  assert.equal(placed.dir, 'DOWN');
  assert.deepEqual(ps.move(placed.uid, { area: 'board', row: free[0], col: free[1] }, 'LEFT'), OK, 'token re-oriented in place');
  assert.equal(placed.dir, 'LEFT');
  assert.equal(ps.battleInput().units.find((u) => u.uid === placed.uid).dir, 'LEFT');
  checkInvariants(m);
  m.dispose();
});

test('the dir persists across rounds and reaches the round\'s battle', () => {
  const { h, m, ps } = prepMatch({ seed: 12 });
  const [a] = meleeIds(m, 1).map((id) => give(m, ps, id, 'hand'));
  ps.move(a.uid, { area: 'board', row: 9, col: 3 }, 'UP');
  const inputs = [];
  const newBattle = m.newBattle.bind(m);
  m.newBattle = (opts) => { for (const p of opts.players || []) if (p.playerId === 'p_0') inputs.push(p); return newBattle(opts); };
  h.toPrep(2);
  const now = ps.find(a.uid);
  assert.ok(now && now.area === 'board', 'still deployed');
  assert.equal(now.piece.dir, 'UP', 'facing kept into the next prep');
  const u = inputs.flatMap((p) => p.units).find((x) => x.uid === a.uid);
  assert.ok(u, 'the round-1 battle got the piece');
  assert.equal(u.dir, 'UP');
  m.dispose();
});

test('effect-placed pieces: a transformation sends the new operator back to the 备战区; a merge elite taking a consumed copy\'s tile keeps that tile\'s dir', () => {
  const { m, ps } = prepMatch({ seed: 13 });
  const [id, other] = meleeIds(m, 2);
  const a = give(m, ps, id, 'board', [9, 3]);
  a.dir = 'DOWN';
  const np = ps.transformChess(a, other);
  // 突变细胞 (user playtest): a transformed operator is NOT deployed — the tile is freed and it waits in the hand
  assert.ok(np && !ps.board.has(tileKey(9, 3)), 'the board tile is freed');
  assert.ok(ps.hand.includes(np), 'the transformed operator waits in the hand');
  assert.equal(ps.deployCount, 0, 'and no longer counts as deployed');
  // merge of deployed copies (PRTS: the elite goes to the consumed copy's board position), with its dir
  ps.board.clear();
  ps.hand.fill(null);
  ps.temp.fill(null);
  ps.recompute();
  const c1 = give(m, ps, id, 'board', [9, 3]);
  const c2 = give(m, ps, id, 'board', [9, 4]);
  c1.dir = 'UP';
  c2.dir = 'LEFT';
  for (let i = 0; i < ps.hand.length; i++) ps.hand[i] = ps.newPiece('item', 'chess_item_3_01_e_a');
  for (let i = 0; i < ps.temp.length; i++) ps.temp[i] = ps.newPiece('item', 'chess_item_3_03_e_a');
  ps.recompute();
  assert.equal(m.gd.mergeCount(id), 3);
  const elite = ps.acquireChess(id, { source: 'test' });
  assert.ok(elite && m.gd.isGolden(elite.id), 'merged');
  const loc = ps.find(elite.uid);
  assert.equal(loc.area, 'board');
  const was = loc.key === tileKey(9, 3) ? 'UP' : 'LEFT';
  assert.equal(elite.dir, was, 'the elite keeps the dir of the tile it took');
  m.dispose();
});

test('画卷 (g.art dir): range 1-1 is the drop tile + the tile in front along the chosen direction', () => {
  const { m, ps } = prepMatch({ seed: 14 });
  const [id] = meleeIds(m, 1);
  give(m, ps, id, 'board', [10, 3]);
  const art = giveItem(m, ps, 'chess_item_6_02_m');
  assert.equal(ps.useArt(art.uid, 9, 3, 'RIGHT').error, ERR.BAD_TARGET, 'RIGHT: (9,3)+(9,4) hold nobody');
  assert.deepEqual(ps.useArt(art.uid, 9, 3, 'UP'), OK, 'UP: the tile above (10,3) is copied');
  assert.equal(ps.hand.filter((p) => p && p.kind === 'chess' && p.id === id).length, 1, 'a copy in the hand');
  const art2 = giveItem(m, ps, 'chess_item_6_02_m');
  assert.deepEqual(ps.useArt(art2.uid, 9, 3, 'EAST'), { error: ERR.BAD_TARGET, detail: 'bad dir' });
  m.dispose();
});

test('Final Assault mirror: bossFieldPlacement = the sim mapping (col c → 20 − c, RIGHT ↔ LEFT, UP / DOWN kept)', () => {
  assert.deepEqual(bossFieldPlacement('R', 10, 4, 'RIGHT'), { row: 3, col: 16, dir: 'LEFT' });
  assert.deepEqual(bossFieldPlacement('R', 12, 9, 'UP'), { row: 5, col: 11, dir: 'UP' });
  assert.deepEqual(bossFieldPlacement('R', 9, 2, 'LEFT'), { row: 2, col: 18, dir: 'RIGHT' });
  assert.deepEqual(bossFieldPlacement('L', 11, 6, 'DOWN'), { row: 4, col: 6, dir: 'DOWN' });
  const rec = chessRec({ id: 't_x', rangeGrid: [[0, 0], [0, 1]], skill: null });
  const units = [['RIGHT', 10, 4], ['UP', 11, 5], ['LEFT', 12, 6], ['DOWN', 9, 7]].map(([dir, row, col], i) => ({ uid: i + 1, kind: 'chess', chessId: 't_x', row, col, dir }));
  const h = makeBattle({ kind: 'boss', defs: { chess: { t_x: rec } }, players: [{ playerId: 'R', seat: 1, side: 'R', colOffset: 8, units }] });
  h.step();
  for (const u of units) {
    const f = bossFieldPlacement('R', u.row, u.col, u.dir);
    const unit = h.b.allyUnits.find((x) => x.uid === u.uid);
    assert.deepEqual([unit.tileR, unit.tileC, unit.dir], [f.row, f.col, f.dir], `uid ${u.uid}`);
  }
});

test('bot: the planner turns a ranged unit toward the enemy path (and keeps RIGHT when every direction is equal)', () => {
  const { m, ps } = prepMatch({ seed: 15 });
  // a synthetic round: one ground route along row 10 (right → left); the only legal tile is (11,6) off the road
  m._botPath = null;
  const key = `${m.round}|${m.stageId}|${m.wave ? m.wave.templateId : 'boss'}|`;
  const tiles = ['10,10', '10,9', '10,8', '10,7', '10,6', '10,5', '10,4', '10,3'];
  const index = new Map(tiles.map((k, i) => [k, [[0, i]]]));
  const ground = new Map(tiles.map((k, i) => [k, { flow: 5, prog: i / (tiles.length - 1) }]));
  m._botPath = { key, routes: [{ n: 5, fly: false, tiles, tileTime: 2, hp: 3000, dwell: 0 }], index, ground, flyTotal: 0 };
  ps._deployMap = new Map([['11,6', 'ranged']]);
  const line = { chessId: 't_line', position: 'RANGED', stats: { atk: 500, bat: 1, aspd: 100, blockCnt: 0 }, rangeGrid: [[0, 0], [0, 1], [0, 2], [0, 3]], attackKind: 'ranged', canHitFly: true };
  const dot = { ...line, chessId: 't_dot', rangeGrid: [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] };
  const recs = { 1: line, 2: dot };
  const plan = planLayout(m, ps, [{ uid: 1, kind: 'chess', id: 't_line' }], LAYOUT_PARAMS, { recOf: (p) => recs[p.uid] });
  assert.equal(plan.get(1), '11,6');
  assert.equal(plan.dirs.get(1), 'DOWN', 'facing DOWN covers the road tile (10,6); RIGHT / UP / LEFT cover nothing');
  assert.ok(rangeTiles(line, 11, 6, 'DOWN').includes('10,6') && !rangeTiles(line, 11, 6, 'RIGHT').includes('10,6'));
  const sym = planLayout(m, ps, [{ uid: 2, kind: 'chess', id: 't_dot' }], LAYOUT_PARAMS, { recOf: (p) => recs[p.uid] });
  assert.equal(sym.dirs.get(2), 'RIGHT', 'a symmetric range keeps RIGHT');
  ps.invalidateDeployMap();
  m._botPath = null;
  m.dispose();
});

test('bot: full preps place every board piece with a valid dir, sent to the battles', () => {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }], seed: 21 }).start();
  const m = h.m;
  const inputs = [];
  const newBattle = m.newBattle.bind(m);
  m.newBattle = (opts) => { for (const p of opts.players || []) inputs.push(p); return newBattle(opts); };
  h.run(() => h.ended != null || (m.phase === PHASE.PREP && m.round === 4));
  const ps = m.order[0];
  for (const p of ps.board.values()) assert.ok(['UP', 'RIGHT', 'DOWN', 'LEFT'].includes(pieceDir(p)));
  const units = inputs.flatMap((p) => p.units || []);
  assert.ok(units.length > 0);
  for (const u of units) assert.ok(['UP', 'RIGHT', 'DOWN', 'LEFT'].includes(u.dir), `unit ${u.uid} dir ${u.dir}`);
  assert.equal(m.errorCount, 0);
  checkInvariants(m);
  m.dispose();
});

test('bot: 气流 tiles (act2 m01 DOWN blowers) scale the planned DPS by the blower relation — a symmetric range turns WITH the flow', () => {
  const { m, ps } = prepMatch({ seed: 15 });
  m._botPath = null;
  const model = fieldModel(m, ps);
  const bb = m.stage.devices.find((d) => d.role === 'blower').skill.bb;
  // blower #001 (13,5) blows DOWN over (12,5) (11,5) (10,5) of the own board; #002 over col 9
  for (const k of ['12,5', '11,5', '10,5']) assert.equal(model.airflow.get(k)?.dir, 'DOWN', k);
  assert.ok(!model.airflow.has('11,4'));
  assert.equal(airflowAtkMul(model, '11,5', 'DOWN'), 1 + bb['blower_s_character[equal].atk']);
  assert.equal(airflowAtkMul(model, '11,5', 'UP'), 1 + bb['blower_s_character[opposite].atk']);
  assert.equal(airflowAtkMul(model, '11,5', 'RIGHT'), 1 + bb['blower_s_character[vertical].atk']);
  assert.equal(airflowAtkMul(model, '11,4', 'UP'), 1);
  // one route along row 10; the only legal tile is (11,5) under the flow: every direction covers the same tiles
  const key = model.key;
  const tiles = ['10,10', '10,9', '10,8', '10,7', '10,6', '10,5', '10,4', '10,3'];
  m._botPath = {
    key, routes: [{ n: 5, fly: false, tiles, tileTime: 2, hp: 3000, dwell: 0 }], index: new Map(tiles.map((k, i) => [k, [[0, i]]])),
    ground: new Map(tiles.map((k, i) => [k, { flow: 5, prog: i / (tiles.length - 1) }])), flyTotal: 0, airflow: model.airflow,
  };
  ps._deployMap = new Map([['11,5', 'ranged']]);
  const dot = { chessId: 't_dot', position: 'RANGED', stats: { atk: 500, bat: 1, aspd: 100, blockCnt: 0 }, rangeGrid: [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]], attackKind: 'ranged', canHitFly: true };
  const plan = planLayout(m, ps, [{ uid: 2, kind: 'chess', id: 't_dot' }], LAYOUT_PARAMS, { recOf: () => dot });
  assert.equal(plan.get(2), '11,5');
  assert.equal(plan.dirs.get(2), 'DOWN', 'same cover, ATK +30 % with the flow');
  // off the flow the same unit keeps RIGHT
  m._botPath = { ...m._botPath, airflow: new Map() };
  assert.equal(planLayout(m, ps, [{ uid: 2, kind: 'chess', id: 't_dot' }], LAYOUT_PARAMS, { recOf: () => dot }).dirs.get(2), 'RIGHT');
  ps.invalidateDeployMap();
  m._botPath = null;
  m.dispose();
});

test('a refused move never changes the facing (illegal tile, bad dir on the own tile, full board)', () => {
  const { m, ps } = prepMatch({ seed: 13 });
  const [a, b] = meleeIds(m, 2).map((id) => give(m, ps, id, 'hand'));
  assert.deepEqual(ps.move(a.uid, { area: 'board', row: 9, col: 3 }, 'UP'), OK);
  // not deployable (col 9 is the lane) → BAD_TILE, the piece stays where it was, still facing UP
  const bad = [...Array(4)].map((_, i) => [9 + i, 9]).find(([r, c]) => !ps._legal(a, r, c));
  assert.ok(bad, 'an illegal tile exists');
  assert.equal(ps.move(a.uid, { area: 'board', row: bad[0], col: bad[1] }, 'DOWN').error, ERR.BAD_TILE);
  assert.equal(a.dir, 'UP');
  assert.equal(ps.board.get(tileKey(9, 3)), a);
  // a bad direction on the own tile is refused too (no silent reset)
  assert.equal(ps.move(a.uid, { area: 'board', row: 9, col: 3 }, 'up').error, ERR.BAD_TARGET);
  assert.equal(a.dir, 'UP');
  // full board: a hand piece dropped on a free tile is refused, the board piece keeps its facing
  ps.deployCapBonus = -99;
  assert.equal(ps.move(b.uid, { area: 'board', row: 9, col: 4 }, 'LEFT').error, ERR.BOARD_FULL);
  assert.equal(b.dir, undefined, 'the refused piece got no facing');
  ps.deployCapBonus = 0;
  checkInvariants(m);
  m.dispose();
});

// Integration (was a todo tripwire): Match._handle forwards the intent's top-level `dir` to PlayerState.move / useArt,
// so the deploy wheel's direction reaches the server (the browser E2E checks the same end to end).
test('g.move / g.art through Match.handle apply the top-level dir (and to.dir as a fallback)', () => {
  const { m, ps } = prepMatch({ seed: 14 });
  const [a, b, c] = meleeIds(m, 3).map((id) => give(m, ps, id, 'hand'));
  // three melee-legal tiles: T1, T2, and a vertical pair (lo, hi = the tile above lo) for 画卷
  const legal = [];
  for (let r = 9; r <= 12; r++) for (let col = 2; col <= 10; col++) if (ps._legal(a, r, col)) legal.push([r, col]);
  const lo = legal.find(([r, col]) => legal.some(([r2, c2]) => r2 === r + 1 && c2 === col));
  assert.ok(lo, 'a vertical pair of melee tiles exists');
  const hi = [lo[0] + 1, lo[1]];
  const [t1, t2] = legal.filter(([r, col]) => !(col === lo[1] && (r === lo[0] || r === hi[0])));
  const at = ([row, col]) => ({ area: 'board', row, col });
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: a.uid, to: at(t1), dir: 'UP' }), OK);
  assert.equal(a.dir, 'UP', 'the wheel direction reaches the board piece');
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: a.uid, to: at(t1), dir: 'LEFT' }), OK);
  assert.equal(a.dir, 'LEFT', 're-orientation in place through the match');
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: b.uid, to: { ...at(t2), dir: 'DOWN' } }), OK);
  assert.equal(b.dir, 'DOWN', 'to.dir is read when the top-level dir is absent');
  assert.equal(m.handle('p_0', { t: 'g.move', uid: b.uid, to: at(t2), dir: 'down' }).error, ERR.BAD_TARGET, 'a bad spelling is refused (the protocol layer refuses it earlier)');
  assert.equal(b.dir, 'DOWN');
  // 画卷 through the match: UP copies the unit above the drop tile (RIGHT finds nobody)
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: c.uid, to: at(hi) }), OK);
  const art = giveItem(m, ps, 'chess_item_6_02_m');
  const right = ps.board.get(tileKey(lo[0], lo[1] + 1));
  if (!right) assert.equal(m.handle('p_0', { t: 'g.art', itemUid: art.uid, row: lo[0], col: lo[1], dir: 'RIGHT' }).error, ERR.BAD_TARGET);
  const before = ps.hand.filter((p) => p && p.kind === 'chess' && p.id === c.id).length;
  assert.deepEqual(m.handle('p_0', { t: 'g.art', itemUid: art.uid, row: lo[0], col: lo[1], dir: 'UP' }), OK);
  assert.equal(ps.hand.filter((p) => p && p.kind === 'chess' && p.id === c.id).length, before + 1, 'the copy is in the hand');
  // scouting a teammate's prep board (m.field prep: true) carries each piece's dir (ground wedge, Back model for UP)
  const meta = m.prepFieldMeta(ps);
  const byUid = new Map(meta.units.map((u) => [u.uid, u]));
  assert.equal(byUid.get(a.uid).dir, 'LEFT');
  assert.equal(byUid.get(a.uid).facing, -1);
  assert.equal(byUid.get(b.uid).dir, 'DOWN');
  assert.equal(byUid.get(b.uid).facing, 1);
  assert.equal(byUid.get(c.uid).dir, 'RIGHT', 'absent ⇒ RIGHT');
  m.dispose();
});
