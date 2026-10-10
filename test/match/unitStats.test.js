// Live operator stats (user playtest #4 item 7 — the detail card showed the fixed record numbers): g.unitStats answers
// m.unitStats { seq, round, units } with the stats every unit of the player's board starts its next battle with — the
// real battle input (equipment, bonds / layers, 特质, band and 机变 effects, the onBattleStart meta) built into a Battle
// that is started and read, never stepped (server/match/match/intents.js unitStats); the shape is shared/protocol.js
// unitStatsEntry (also the browser runner's live battle stats, test/match/runner.test.js). The preview changes nothing
// of the match.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, PHASE } from '../../shared/constants.js';
import { validateC2S, unitStatsEntry, S2C } from '../../shared/protocol.js';
import { makeMatch, give, giveItem, chessOfTier, legalTileFor } from './harness.js';

/** 阿戈尔重刃: ATK +40 % (its own multiplier), attack speed −10 (data/items.json). */
const BLADE = 'chess_item_3_07_e_a';
/** 双模机械臂: ATK +30 % (a second, different item: both apply — two equal ones would merge into the hand). */
const ARM = 'chess_item_5_03_e_a';

/** Solo PREP R1 with one chess on an empty board carrying 阿戈尔重刃 (equipped through g.equip). */
function setup(seed = 21, opts = {}) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed, ...opts }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  const id = chessOfTier(1, (c) => c.position === 'MELEE' && !m.gd.placeableTokens(c.chessId).length).find((x) => m.pool.has(x));
  const carrier = give(m, ps, id, 'board', legalTileFor(m, ps, id));
  const item = giveItem(m, ps, BLADE);
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: item.uid, targetUid: carrier.uid }), { ok: true });
  return { h, m, ps, carrier };
}

test('protocol: g.unitStats { seq? } and g.bandFocus { bandId? } validate; m.unitStats is a known push', () => {
  assert.equal(validateC2S({ t: 'g.unitStats' }), null);
  assert.equal(validateC2S({ t: 'g.unitStats', seq: 12 }), null);
  assert.notEqual(validateC2S({ t: 'g.unitStats', seq: -1 }), null);
  assert.notEqual(validateC2S({ t: 'g.unitStats', seq: 1.5 }), null);
  assert.equal(validateC2S({ t: 'g.bandFocus' }), null, 'no band = clear the highlight');
  assert.equal(validateC2S({ t: 'g.bandFocus', bandId: null }), null);
  assert.equal(validateC2S({ t: 'g.bandFocus', bandId: 'band_bldsk' }), null);
  assert.notEqual(validateC2S({ t: 'g.bandFocus', bandId: 'a b' }), null);
  assert.ok(S2C.includes('m.unitStats'));
  assert.equal(validateC2S({ t: 'g.choice', idx: 0 }), null);
  assert.equal(validateC2S({ t: 'g.choice', idx: 2, choiceId: 'seed-2.choice.12' }), null);
  for (const choiceId of [null, '', 'a b', 12, 'a'.repeat(65)]) {
    assert.notEqual(validateC2S({ t: 'g.choice', idx: 0, choiceId }), null);
  }
});

test('unitStatsEntry: effective stats next to the base, rounded for display; the interval from bat / aspd when absent', () => {
  const u = { id: 3, uid: 44, defId: 'chess_x', hp: 812.6, alive: true, base: { maxHp: 1000, atk: 300, def: 100, res: 10, aspd: 100, bat: 1.2, blockCnt: 2, moveSpeed: 0 } };
  const e = unitStatsEntry(u, { maxHp: 1250.4, atk: 420.49, def: 90, res: 12.34, interval: 1.0833333, blockCnt: 3, moveSpeed: 0 });
  assert.deepEqual(e, {
    id: 3, uid: 44, defId: 'chess_x', hp: 813, alive: true,
    maxHp: 1250, atk: 420, def: 90, res: 12.3, interval: 1.08, blockCnt: 3, moveSpeed: 0,
    base: { maxHp: 1000, atk: 300, def: 100, res: 10, interval: 1.2, blockCnt: 2, moveSpeed: 0 },
    silenced: false,
  });
  const plain = unitStatsEntry(u);
  assert.equal(plain.atk, 300, 'no aggregated stats: the base');
  assert.equal(plain.interval, 1.2);
  assert.equal(unitStatsEntry(null).maxHp, 0, 'never throws');
  assert.equal(unitStatsEntry({ base: { bat: 0 } }).interval, null, 'no attack');
});

test('g.unitStats: the board\'s start-of-battle stats (equipment in: ATK ×1.4, a slower attack), the same numbers the battle starts with; seq echoed', () => {
  const { h, m, ps, carrier } = setup();
  assert.deepEqual(m.handle('p_0', { t: 'g.unitStats', seq: 7 }), { ok: true });
  const msg = h.lastTo('p_0', 'm.unitStats');
  assert.ok(msg, 'answered with a push');
  assert.equal(msg.seq, 7);
  assert.equal(msg.round, 1);
  const boardUids = [...ps.board.values()].map((p) => p.uid).sort((a, b) => a - b);
  assert.deepEqual(msg.units.map((u) => u.uid).sort((a, b) => a - b), boardUids, 'every board unit, by uid');
  const u = msg.units.find((x) => x.uid === carrier.uid);
  assert.ok(u.atk > u.base.atk, `ATK up (${u.base.atk} → ${u.atk})`);
  assert.ok(Math.abs(u.atk - Math.round(u.base.atk * 1.4)) <= 1, `阿戈尔重刃 multiplies ATK by 1.4 (${u.atk})`);
  assert.ok(u.interval > u.base.interval, `attack speed −10: a longer interval (${u.base.interval} → ${u.interval})`);
  assert.equal(u.hp, u.maxHp, 'full HP at the start');
  assert.equal(u.alive, true);
  // exactly what the real battle of this board starts with (the same input, onBattleStart meta included)
  const b = m.newBattle(m._normalOpts(ps));
  b.start();
  const bu = b.allyUnits.find((x) => x.uid === carrier.uid);
  const { id: _a, ...want } = unitStatsEntry(bu, bu.s);
  const { id: _b, ...have } = u;
  assert.deepEqual(have, want);
  // no seq: null; a second request with the same state answers the cached numbers
  assert.deepEqual(m.handle('p_0', { t: 'g.unitStats' }), { ok: true });
  assert.equal(h.lastTo('p_0', 'm.unitStats').seq, null);
  assert.deepEqual(h.lastTo('p_0', 'm.unitStats').units, msg.units);
  m.dispose();
});

test('g.unitStats follows the prep state: another item changes the numbers; prep phases only', () => {
  const { h, m, ps, carrier } = setup(22);
  m.handle('p_0', { t: 'g.unitStats', seq: 1 });
  const before = h.lastTo('p_0', 'm.unitStats').units.find((x) => x.uid === carrier.uid);
  const item = giveItem(m, ps, ARM);
  assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: item.uid, targetUid: carrier.uid }), { ok: true });
  assert.deepEqual(carrier.items.map((x) => x.id).sort(), [ARM, BLADE].sort());
  m.handle('p_0', { t: 'g.unitStats', seq: 2 });
  const after = h.lastTo('p_0', 'm.unitStats').units.find((x) => x.uid === carrier.uid);
  // equipment percentages are 直接乘算 — they add up (PRTS 盟约记录 / 游戏数据基础; DESIGN §20.10): +40 % and +30 % = +70 %
  assert.ok(Math.abs(after.atk - Math.round(after.base.atk * (1 + 0.4 + 0.3))) <= 1, `the items' percentages add up: ATK ${before.atk} → ${after.atk}`);
  // outside the prep phases: WRONG_PHASE, nothing pushed
  const n = h.allTo('p_0', 'm.unitStats').length;
  assert.ok(h.drive(() => m.phase === PHASE.COMBAT));
  assert.equal(m.handle('p_0', { t: 'g.unitStats', seq: 3 }).error, ERR.WRONG_PHASE);
  assert.equal(h.allTo('p_0', 'm.unitStats').length, n);
  m.dispose();
});

test('prep stat previews do not spend a deployment skill duration in the next real battle', () => {
  const { h, m, ps } = setup(27);
  const id = 'chess_char_4_16_a'; // 缄默德克萨斯: a real timed deployment skill
  const piece = give(m, ps, id, 'board', legalTileFor(m, ps, id));
  const previews = [];
  const create = m.newBattle.bind(m);
  m.newBattle = (opts) => { const b = create(opts); previews.push(b); return b; };
  for (let i = 0; i < 3; i++) {
    m._unitStatsCache = null; // test fresh previews as well as the cached request
    assert.deepEqual(m.handle('p_0', { t: 'g.unitStats', seq: i }), { ok: true });
    const entry = h.lastTo('p_0', 'm.unitStats').units.find(u => u.uid === piece.uid);
    assert.ok(entry); assert.equal('sp' in entry, false); assert.equal('timeLeft' in entry, false);
  }
  assert.equal(m.phase, PHASE.PREP);
  for (const b of previews) {
    const u = b.allyUnits.find(u => u.uid === piece.uid);
    assert.equal(b.time, 0); assert.equal(b.tickCount, 0);
    assert.ok(u.skill.active); assert.equal(u.skill.timeLeft, u.skill.duration);
  }
  const b = create(m._normalOpts(ps)); const u = b.allyUnits.find(u => u.uid === piece.uid);
  assert.equal(b.started, false); assert.equal(u.deployed, false);
  b.start(); assert.equal(u.skill.timeLeft, u.skill.duration);
  b.step(); assert.ok(Math.abs(u.skill.timeLeft - (u.skill.duration - b.dt)) < 1e-8);
  assert.deepEqual(b.errors, []); m.dispose();
});

test('the preview changes nothing of the match: two identical matches, one asking for the stats all along, stay identical', () => {
  const run = (ask) => {
    const { h, m, ps } = setup(23);
    const snaps = [];
    for (let r = 1; r <= 3; r++) {
      if (ask) for (let k = 0; k < 3; k++) assert.deepEqual(m.handle('p_0', { t: 'g.unitStats', seq: k }), { ok: true });
      snaps.push(JSON.stringify(ps.privateView()));
      assert.ok(h.drive(() => m.phase === PHASE.PREP && m.round === r + 1), `PREP R${r + 1}`);
    }
    snaps.push(JSON.stringify(ps.privateView()), JSON.stringify({ ...m.publicView(), serverNow: 0, deadline: 0 }));
    m.dispose();
    return snaps;
  };
  assert.deepEqual(run(true), run(false));
});
