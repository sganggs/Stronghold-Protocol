// Regression tests for the adversarial review of the match engine: every defect fixed there and every registry
// addition content needs (DESIGN §6.4/§7, docs/META.md). FakeBattle unless noted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE, GEO } from '../../shared/constants.js';
import { MetaRegistry, makeCtx } from '../../server/match/effectsMeta.js';
import { registerBuiltins } from '../../server/match/builtinMeta.js';
import { collectViolations } from '../../server/match/invariants.js';
import { attachAudit } from '../../server/match/audit.js';
import { DeadBattle, FieldRunner, maxTicksPerInterval } from '../../server/match/fields.js';
import { FakeBattle } from './fakeBattle.js';
import { DATA, makeMatch, give, giveItem, checkInvariants, chessOfTier, legalTileFor } from './harness.js';

const builtins = () => registerBuiltins(new MetaRegistry(), DATA);
const bossFields = () => FakeBattle.instances.filter((b) => b.kind === 'boss' || b.kind === 'hidden');

/** Solo match in PREP R1 with an empty board/hand and funds. */
function prepSolo({ seed = 900, registry = undefined, funds = 30 } = {}) {
  const h = makeMatch({ mode: 'solo', seed, fake: true, registry }).start();
  h.toPrep(1);
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.temp.fill(null);
  ps.funds = funds;
  ps.recompute();
  return { h, m: h.m, ps };
}

// ---------------------------------------------------------------------------------------------------------------
// defects

test('Final Assault: a harmless leak (lpr 0) costs no team LP; a leak without lpr costs 1; lpr N costs N', () => {
  const h = makeMatch({
    mode: 'coop', difficulty: 'FUNNY', humans: 2, seed: 901, fake: true,
    script: (b) => (b.kind === 'boss' ? { bossDps: 0, duration: Infinity, leakEvents: [{ at: 0.5, lpr: 0 }, { at: 1 }, { at: 1.5, lpr: 3 }, { at: 3, lpr: 0 }] } : {}),
  }).start();
  const m = h.m;
  h.drive(() => m.phase === PHASE.PREP && m.round === 14);
  h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
  const start = m.teamLp;
  // the boss never dies here: stop right after the scripted leaks
  const f = bossFields()[0];
  for (let i = 0; i < 200 && f.time < 4; i++) f.step();
  m._bossLeak({ lpr: undefined });
  assert.equal(m.teamLp, start - 1 - 3 - 1, 'lpr 0 → 0, missing → 1, 3 → 3');
  m.dispose();
});

test('PREP: a player who un-readies right after everybody was ready keeps the prep open (deadline stays armed)', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 902, fake: true }).start();
  const m = h.m;
  h.toPrep(1);
  const deadline = m.deadline;
  assert.ok(deadline > 0);
  assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { ok: true });
  assert.deepEqual(m.handle('p_1', { t: 'g.ready', ready: true }), { ok: true });
  // the phase ends on the next scheduler turn — p_1 changes their mind before that
  assert.deepEqual(m.handle('p_1', { t: 'g.ready', ready: false }), { ok: true });
  h.sched.runNext();
  assert.equal(m.phase, PHASE.PREP, 'prep still open');
  assert.equal(m.deadline, deadline, 'the prep deadline is still armed');
  // at the deadline everyone is auto-readied and combat starts
  h.run(() => m.phase === PHASE.COMBAT || m.phase === PHASE.SETTLE);
  assert.ok(h.sched.now() >= deadline);
  m.dispose();
});

test('merge with a full hand and a full temp: the elite takes its deployed copy\'s tile (PRTS) and keeps the returned items', () => {
  const { m, ps } = prepSolo({ seed: 903 });
  const id = chessOfTier(1, (c) => c.position === 'MELEE').find((c) => m.pool.has(c) && m.gd.mergeCount(c) === 3);
  const t1 = legalTileFor(m, ps, id);
  const a = give(m, ps, id, 'board', t1);
  const t2 = legalTileFor(m, ps, id);
  const b = give(m, ps, id, 'board', t2);
  const itA = giveItem(m, ps, 'chess_item_1_01_e_a');
  const itB = giveItem(m, ps, 'chess_item_2_04_e_a');
  ps.hand.fill(null);
  a.items.push(itA);
  b.items.push(itB);
  const fillers = [2, 3, 4].flatMap((t) => chessOfTier(t)).filter((c) => m.pool.has(c) && c !== id);
  assert.ok(fillers.length >= 15);
  for (let i = 0; i < 10; i++) give(m, ps, fillers[i], 'hand', i);
  for (let i = 0; i < 5; i++) give(m, ps, fillers[10 + i], 'temp', i);
  ps.shop.slots[0] = { kind: 'chess', id, basePrice: m.gd.chessPrice(id), frozen: false, sold: false };
  checkInvariants(m);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true }, 'a purchase that completes a merge is allowed with a full hand');
  const elite = [...ps.board.values()].find((p) => p.id === m.gd.goldenIdOf(id));
  assert.ok(elite, 'the elite stands on a consumed copy\'s tile');
  assert.equal(ps.find(elite.uid).key, `${t1[0]},${t1[1]}`, 'the copy that deploys first (legalTileFor walks the top row left to right: on one row, the deploy order)');
  assert.equal(elite.poolCopies, 3, 'it holds all three copies');
  assert.deepEqual(elite.items.map((x) => x.id).sort(), ['chess_item_1_01_e_a', 'chess_item_2_04_e_a'], 'returned items are kept on it');
  checkInvariants(m);
  m.dispose();
});

test('联防 that cannot run (synthetic result) charges the leakers their own leaks instead of nothing', () => {
  const h = makeMatch({
    mode: 'coop', humans: 2, seed: 904, fake: true,
    script: (b) => (b.kind === 'unite' ? { throwInCtor: true } : { leaks: Object.fromEntries(b.players.map((p) => [p, p === 'p_0' ? 4 : 0])) }),
  }).start();
  const m = h.m;
  h.toPrep(1);
  const a = h.ps('p_0');
  const lp = a.lp;
  h.drive(() => m.phase === PHASE.SETTLE);
  assert.ok(m.unitePlan, '联防 was planned');
  assert.equal(a.lp, lp - 4, 'the leaker pays its 4 leaks');
  assert.equal(h.ps('p_1').lp, h.ps('p_1').lp, 'the helper pays nothing');
  assert.ok(m.errorCount >= 1, 'the construction failure was reported');
  m.dispose();
});

test('stand-in results are marked synthetic (DeadBattle, unreadable results)', () => {
  const dead = new DeadBattle({ fieldId: 'u', kind: 'unite', players: [{ playerId: 'a' }] });
  assert.equal(dead.result().synthetic, true);
  const runner = new FieldRunner({ reportError() {}, markPublic() {}, sched: { instant: true } }, [], { onDone() {} });
  const r = runner.resultOf({ fieldId: 'x', players: ['a'], battle: { result() { throw new Error('boom'); } } });
  assert.equal(r.synthetic, true);
  assert.equal(r.perPlayer.a.perfect, true);
});

test('the 联防 battle reuses the round template stat overrides (leaked enemies keep their stats)', () => {
  const h = makeMatch({
    mode: 'coop', humans: 2, seed: 905, fake: true,
    script: (b) => (b.kind === 'normal' ? { leaks: Object.fromEntries(b.players.map((p) => [p, p === 'p_0' ? 2 : 0])) } : {}),
  }).start();
  const m = h.m;
  h.toPrep(1);
  m.wave.overrides = { enemy_1007_slime: { stats: { maxHp: 1234 } } };
  h.drive(() => m.phase === PHASE.UNITE);
  const u = FakeBattle.instances.find((b) => b.kind === 'unite');
  assert.deepEqual(u.opts.enemyOverrides, { enemy_1007_slime: { stats: { maxHp: 1234 } } });
  m.dispose();
});

test('per-slot frozen flag in m.private follows the freeze toggle', () => {
  const { m, ps } = prepSolo({ seed: 906 });
  assert.ok(ps.privateView().shop.slots.every((s) => !s || s.frozen === false));
  assert.deepEqual(m.handle('p_0', { t: 'g.freeze' }), { ok: true });
  assert.ok(ps.privateView().shop.slots.every((s) => !s || s.frozen === true));
  m.dispose();
});

test('b.ev and b.snap always carry the game time gt (also on m.field resync); combatSpeed paces faster', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 907, fake: true, instant: false, script: () => ({ duration: 3 }) }).start();
  const m = h.m;
  h.toPrep(1);
  m.handle('p_0', { t: 'g.ready', ready: true });
  m.handle('p_1', { t: 'g.ready', ready: true });
  h.run(() => m.phase === PHASE.COMBAT);
  h.sched.advance(600);
  m.onReconnect('p_0');
  h.sched.advance(600);
  const frames = h.sent.filter(([pid, msg]) => pid === 'p_0' && (msg.t === 'b.snap' || msg.t === 'b.ev')).map(([, msg]) => msg);
  assert.ok(frames.some((f) => f.t === 'b.ev') && frames.some((f) => f.t === 'b.snap'));
  for (const f of frames) {
    assert.equal(typeof f.gt, 'number', `${f.t} carries gt`);
    assert.ok(Number.isFinite(f.gt) && f.gt >= 0);
    assert.notEqual(f.t, f.gt);
  }
  // an event frame always precedes its snapshot with the same gt
  for (let i = 0; i < frames.length - 1; i++) if (frames[i].t === 'b.ev') assert.equal(frames[i + 1].gt, frames[i].gt);
  m.dispose();

  assert.equal(maxTicksPerInterval(2), 8);
  assert.ok(maxTicksPerInterval(20) >= 80);
  const fast = makeMatch({ mode: 'solo', seed: 908, fake: true, instant: false, script: () => ({ duration: 6 }) });
  fast.m.gameSpeed = 30;
  fast.start();
  fast.toPrep(1);
  fast.m.handle('p_0', { t: 'g.ready', ready: true });
  fast.run(() => fast.m.phase === PHASE.COMBAT);
  const t0 = fast.sched.now();
  fast.run(() => fast.m.fields.length > 0 && fast.m.fields.every((f) => !f.live));
  assert.ok(fast.sched.now() - t0 < 400, `6 game s at 30× take ${fast.sched.now() - t0} ms`);
  fast.m.dispose();
});

// ---------------------------------------------------------------------------------------------------------------
// registry additions (docs/META.md §2)

test('onIncome rewrites the round income (老鲤-style withholding); onSpend reports every completed payment', () => {
  const reg = builtins();
  const spent = [];
  reg.global('lmlee', {
    onIncome(ctx, ev) {
      if (ev.round <= 2) { ctx.incCounter('held', ev.income); ev.income = 0; }
      if (ev.round === 3) { ev.income += ctx.counter('held'); ctx.setCounter('held', 0); }
    },
    onSpend(ctx, ev) { spent.push([ev.reason, ev.amount, ev.total]); },
  });
  const h = makeMatch({ mode: 'solo', seed: 910, fake: true, registry: reg }).start();
  const m = h.m;
  h.toPrep(1);
  const ps = h.ps('p_0');
  assert.equal(ps.funds, 0, 'R1 income withheld');
  ps.funds = 20;
  const slot = ps.shop.slots.findIndex((s) => s && s.kind === 'chess');
  const price = ps.priceOf(ps.shop.slots[slot]);
  assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot }), { ok: true });
  assert.deepEqual(m.handle('p_0', { t: 'g.refresh' }), { ok: true });
  const up = ps.shop.upgradePrice;
  assert.deepEqual(m.handle('p_0', { t: 'g.levelUp' }), { ok: true });
  assert.deepEqual(spent, [['buy', price, price], ['refresh', 1, price + 1], ['levelUp', up, price + 1 + up]]);
  ps.shop.freeRefreshes = 1;
  m.handle('p_0', { t: 'g.refresh' });
  assert.equal(spent.length, 3, 'a free refresh pays nothing');
  h.drive(() => m.phase === PHASE.PREP && m.round === 3);
  assert.equal(ps.funds, m.gd.income(1) + m.gd.income(2) + m.gd.income(3), 'R1+R2 income paid out at R3');
  m.dispose();
});

test('ctx.triggerGarrisons re-runs another piece\'s 特质 (asUid copies, 投资人 repeat, depth cap); garrisonsOf lists them', () => {
  const reg = builtins();
  const runs = [];
  reg.garrison('SERVER_ONCE_GOLD', { run(ctx, ev) { runs.push([ctx.hook, ctx.source.piece.uid, ctx.source.trigger === true, ev.source]); } });
  const { m, ps } = prepSolo({ seed: 911, registry: reg });
  const id = 'chess_char_3_01_a'; // <获得时>使下个休整期额外获得1资金
  const gainer = give(m, ps, id);
  const other = give(m, ps, chessOfTier(1).find((c) => m.pool.has(c)));
  const ctx = makeCtx(m, ps, { kind: 'global', key: 'global:test' }, 'onRoundStart');
  const gs = ctx.garrisonsOf(gainer.uid);
  assert.ok(gs.some((g) => g.effectKey === 'SERVER_ONCE_GOLD' && g.eventType === 'SERVER_GAIN'));
  assert.equal(ctx.triggerGarrisons(gainer.uid, 'SERVER_GAIN'), 1);
  assert.deepEqual(runs, [['onGain', gainer.uid, true, 'trigger']]);
  runs.length = 0;
  assert.equal(ctx.triggerGarrisons(gainer.uid, 'SERVER_GAIN', { asUid: other.uid }), 1);
  assert.equal(runs[0][1], other.uid, 'asUid: the copy runs as the other piece');
  assert.equal(ctx.triggerGarrisons(gainer.uid, 'SERVER_PRICE'), 0, 'SERVER_PRICE cannot be triggered');
  assert.equal(ctx.triggerGarrisons(999999, 'SERVER_GAIN'), 0);
  assert.equal(ctx.triggerGarrisons(gainer.uid, 'NOPE'), 0);
  // 投资人 active ⇒ ×2
  runs.length = 0;
  ps.bonds.investShip = { count: 3, active: true, tier: 1, layers: 0 };
  ctx.triggerGarrisons(gainer.uid, 'SERVER_GAIN');
  assert.equal(runs.length, 2);
  ps.recompute();
  // a garrison that triggers itself stops at the dispatcher depth cap
  let depth = 0;
  reg.garrison('SERVER_ONCE_GOLD', { run(c) { depth++; c.triggerGarrisons(c.source.piece.uid, 'SERVER_GAIN'); } });
  ctx.triggerGarrisons(gainer.uid, 'SERVER_GAIN');
  assert.ok(depth > 1 && depth <= 7, `bounded recursion (${depth})`);
  m.dispose();
});

test('garrisonHooks widens a garrison to extra hooks ("<进入休整期时><休整期结束时>")', () => {
  const reg = builtins();
  const hooks = [];
  const id = 'chess_char_2_02_a';
  const g = DATA.garrisons[DATA.chess[id].garrisonIds.find((x) => DATA.garrisons[x].eventType === 'SERVER_PREP_START')];
  reg.garrison(g.effectKey, { garrisonHooks: (gar) => (gar.garrisonId === g.garrisonId ? ['onRoundStart', 'onPrepEnd'] : null), run(ctx) { hooks.push(ctx.hook); } });
  const { m, ps } = prepSolo({ seed: 912, registry: reg });
  give(m, ps, id, 'board', legalTileFor(m, ps, id));
  m.dispatch(ps, 'onRoundStart', { round: 1 });
  m.dispatch(ps, 'onPrepEnd', { round: 1 });
  m.dispatch(ps, 'onRefresh', {});
  assert.deepEqual(hooks, ['onRoundStart', 'onPrepEnd']);
  m.dispose();
});

test('ctx.offerItems queues an item offer; g.reward takes the item (full hand refused unless it merges)', () => {
  const reg = builtins();
  const { m, ps } = prepSolo({ seed: 913, registry: reg });
  const ctx = makeCtx(m, ps, { kind: 'band', key: 'band:test' }, 'onLevelUp');
  assert.equal(ctx.offerItems(['chess_item_1_01_e_a', 'nope', 'chess_item_2_03_e_a']), true);
  assert.equal(ctx.offerItems(['nope']), false);
  const view = ps.privateView().shop.rewardOffer;
  assert.deepEqual(view.slots.map((s) => [s.kind, s.id, s.price]), [['item', 'chess_item_1_01_e_a', 0], ['item', 'chess_item_2_03_e_a', 0]]);
  const fillers = chessOfTier(1).filter((c) => m.pool.has(c));
  for (let i = 0; i < 10; i++) give(m, ps, fillers[i], 'hand', i);
  assert.equal(m.handle('p_0', { t: 'g.reward', idx: 0 }).error, 'HAND_FULL');
  ps.hand[0] && ps.returnCopies(ps.hand[0]);
  ps.hand[0] = null;
  ps.recompute();
  assert.deepEqual(m.handle('p_0', { t: 'g.reward', idx: 1 }), { ok: true });
  assert.ok(ps.hand.some((p) => p && p.id === 'chess_item_2_03_e_a'));
  assert.equal(ps.offers.length, 0);
  assert.equal(m.handle('p_0', { t: 'g.reward', idx: 0 }).error, 'BAD_TARGET', 'the offer is gone');
  checkInvariants(m);
  m.dispose();
});

test('ctx.piece / pieceAt expose board row/col and hand idx; pieceBonds includes 变形同构体 bonds', () => {
  const { m, ps } = prepSolo({ seed: 914 });
  const id = chessOfTier(2, (c) => c.position === 'RANGED').find((c) => m.pool.has(c) && !c.startsWith('chess_char_2_03'));
  const [r, c] = legalTileFor(m, ps, id);
  const onBoard = give(m, ps, id, 'board', [r, c]);
  const inHand = give(m, ps, chessOfTier(1).find((x) => m.pool.has(x)), 'hand', 3);
  const ctx = makeCtx(m, ps, { kind: 'global', key: 'global:t' }, 'onRoundStart');
  const v = ctx.piece(onBoard.uid);
  assert.equal(v.area, 'board');
  assert.equal(v.row, r);
  assert.equal(v.col, c);
  assert.equal(ctx.piece(inHand.uid).idx, 3);
  assert.equal(ctx.pieceAt(r, c).uid, onBoard.uid);
  assert.equal(ctx.pieceAt(r, c).row, r);
  assert.equal(ctx.pieceAt(0, 0), null);
  assert.equal(ctx.pieceAt('x', 1), null);
  const own = DATA.chess[id].bonds;
  onBoard.items.push(ps.newPiece('item', 'chess_item_6_09_e_a'), ps.newPiece('item', 'chess_item_1_01_e_a'));
  ps.recompute();
  const bonds = ctx.pieceBonds(onBoard.uid);
  for (const b of own) assert.ok(bonds.includes(b));
  assert.ok(bonds.includes('victoriaShip'), '变形同构体 + 维式 item grants 维多利亚');
  m.dispose();
});

test('ctx.rollPool: equip pools, weighted / listed chess pools, shopEligible filters (tier, minTier, bond, golden)', () => {
  const { m, ps } = prepSolo({ seed: 915 });
  const ctx = makeCtx(m, ps, { kind: 'global', key: 'global:t' }, 'onRoundStart');
  for (let i = 0; i < 30; i++) {
    const eq = ctx.rollPool('pool_equip_pepe');
    assert.equal(eq.kind, 'item');
    assert.ok(['chess_item_1_03_e_a', 'chess_item_2_04_e_a', 'chess_item_6_07_e_a'].includes(eq.id));
    const pin = ctx.rollPool('pool_char_pinus');
    assert.ok(['chess_char_1_19_a', 'chess_char_2_18_a', 'chess_char_4_20_a'].includes(pin.id));
    const gl = ctx.rollPool('pool_chess_glady');
    assert.ok(['chess_char_3_05_a', 'chess_char_2_07_a', 'chess_char_1_04_a'].includes(gl.id));
    const t1 = ctx.rollPool('pool_chess_shop_1_reward');
    assert.equal(m.gd.tierOf(t1.id), 1);
    const later = ctx.rollPool('pool_char_later');
    if (later) {
      assert.equal(later.golden, true);
      assert.ok(m.gd.isGolden(later.id));
      assert.ok(m.gd.tierOf(later.id) >= 4);
      assert.ok(DATA.chess[later.id].bonds.includes('lateranoShip'));
    }
  }
  assert.equal(ctx.rollPool('nope'), null);
  assert.equal(ctx.rollPool('constructor'), null);
  // a listed chess with no copy left is never rolled
  const taken = m.pool.take('chess_char_1_04_a', 99);
  for (let i = 0; i < 20; i++) assert.notEqual(ctx.rollPool('pool_chess_glady')?.id, 'chess_char_1_04_a');
  m.pool.give('chess_char_1_04_a', taken);
  m.dispose();
});

test('onBattleStart ev.spawns: content edits a field\'s spawns; a kill bounty set there keeps paying in 联防', () => {
  const reg = builtins();
  reg.global('ducklord', {
    onBattleStart(ctx, ev) {
      if (ev.kind !== 'normal' || ctx.playerId !== 'p_0') return;
      ev.spawns[0].enemyKey = 'enemy_1007_slime';
      ev.spawns[0].bounty = { coins: 3, ownerPlayerId: 'p_0' };
      ev.spawns.push({ enemyKey: 'no_such_enemy', time: 1 });
    },
  });
  const h = makeMatch({
    mode: 'coop', humans: 2, seed: 916, fake: true, registry: reg,
    script: (b) => (b.kind === 'normal' ? { leaks: Object.fromEntries(b.players.map((p) => [p, p === 'p_0' ? 1 : 0])) } : {}),
  }).start();
  const m = h.m;
  h.toPrep(1);
  h.drive(() => m.phase === PHASE.UNITE);
  const nf = FakeBattle.instances.find((b) => b.fieldId === 'n:p_0');
  assert.equal(nf.opts.spawns[0].enemyKey, 'enemy_1007_slime');
  assert.equal(nf.opts.spawns[0].mods.bountyCoins, 3, 'the bounty rides along in mods');
  assert.ok(!nf.opts.spawns.some((s) => s.enemyKey === 'no_such_enemy'), 'malformed spawns are dropped');
  assert.ok(nf.opts.spawns.every((s) => s.ownerPlayerId === 'p_0'));
  assert.deepEqual(m.unitePlan.leaked[0].bounty, { coins: 3, ownerPlayerId: 'p_0' });
  const u = FakeBattle.instances.find((b) => b.kind === 'unite');
  assert.deepEqual(u.opts.spawns[0].bounty, { coins: 3, ownerPlayerId: 'p_0' });
  const other = FakeBattle.instances.find((b) => b.fieldId === 'n:p_1');
  assert.notEqual(other.opts.spawns[0].bounty?.coins, 3, 'only p_0\'s field was edited');
  m.dispose();
});

test('registry warns about handler methods that are not hooks (typos never run silently)', () => {
  const reg = new MetaRegistry();
  reg.band('band_x', { onBuyy() {}, onBuy() {}, run() {}, garrisonHooks() { return []; }, note: 'data is fine' });
  assert.equal(reg.warnings.length, 1);
  assert.match(reg.warnings[0], /band:band_x: 'onBuyy'/);
});

// ---------------------------------------------------------------------------------------------------------------
// invariants & audit tooling

test('collectViolations reports corrupted state (funds, pool accounting, duplicate uid, stale bonds, illegal tile)', () => {
  const { m, ps } = prepSolo({ seed: 920 });
  assert.deepEqual(collectViolations(m), []);
  const id = chessOfTier(1).find((c) => m.pool.has(c));
  const p = give(m, ps, id);
  ps.funds = -1;
  m.pool.entries.get(id).left += 1;
  ps.hand[ps.hand.indexOf(p) === 5 ? 6 : 5] = { ...p };
  ps.layers.yanShip = 50;
  ps.board.set('12,9', ps.newPiece('chess', id, { poolCopies: 0 }));
  const v = collectViolations(m, { limit: 50 }).join('\n');
  for (const re of [/funds -1/, /pool .*left .* held/, /duplicate uid/, /stale bonds/, /illegal tile|outside/]) assert.match(v, re);
  m.dispose();
});

test('the rule auditor flags an LP loss that does not match the leaks (engine regression guard)', () => {
  const h = makeMatch({ mode: 'coop', humans: 2, seed: 921, fake: true, script: (b) => (b.kind === 'normal' ? { leaks: Object.fromEntries(b.players.map((p) => [p, 2])) } : {}) }).start();
  const m = h.m;
  // simulate an engine bug inside settle: one extra LP lost
  const orig = m.settle.bind(m);
  m.settle = (plan, res) => { const r = orig(plan, res); h.ps('p_0').lp -= 1; return r; };
  const audit = attachAudit(m);
  h.toPrep(1);
  h.drive(() => m.phase === PHASE.PREP && m.round === 2);
  assert.ok(audit.violations.some((x) => /p_0: lost 3 LP, expected min\(10, 2\)/.test(x)), audit.violations.join('\n'));
  assert.ok(!audit.violations.some((x) => x.includes('p_1')), 'p_1 is fine');
  assert.ok(audit.checks > 10);
  m.dispose();
});

test('audited FakeBattle matches (all phases incl. 联防, 机变, Final Assault) report no violations', () => {
  for (const [n, seed] of [[1, 930], [2, 931], [3, 932], [4, 933]]) {
    const h = makeMatch({
      mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: n - 1, seed, fake: true,
      script: (b) => (b.kind === 'boss' ? { bossDps: 5000 } : { leaks: Object.fromEntries(b.players.map((p, i) => [p, (b.round + i + seed) % 3])) }),
    });
    // AI-played before the start: a single human's briefing is untimed (Match.soloUntimed, user playtest #4 item 3) and
    // waits for 准备就绪, which only an autoplaying seat gives by itself
    h.autoHumans().start();
    const audit = attachAudit(h.m);
    for (const ps of h.m.players.values()) ps.lp = 200;
    h.runToEnd({ maxSteps: 3e6 });
    assert.deepEqual(audit.violations, [], `${n} players:\n${audit.violations.join('\n')}`);
    assert.ok(h.m.phase === PHASE.RESULT);
    h.m.dispose();
  }
});

test('GEO sanity used by the fixes (boss rect, normal rect)', () => {
  assert.deepEqual(GEO.BOSS_RECT, { r0: 0, r1: 5, c0: 0, c1: 20 });
});

test('the rule auditor follows the engine: PRTS 联防 helper order (not LP), silent solo presentation steps, a frozen item slot moved right by a level-up', () => {
  // co-op: the human (seat 0) plays nothing, the bots field full boards; only the last bot leaks → the helpers are the
  // two perfect bots with the most units (unite.js helperOrder), whatever the LP / seat order says
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 3, seed: 934, fake: true,
    script: (b) => (b.kind === 'boss' ? { bossDps: 5000 } : b.kind === 'normal' ? { leaks: Object.fromEntries(b.players.filter((p) => p === 'ai_2').map((p) => [p, 2])) } : {}) }).start();
  const m = h.m;
  const audit = attachAudit(m);
  for (const ps of m.players.values()) ps.lp = 200;
  h.drive(() => m.phase === PHASE.UNITE && m.round >= 4, { ready: true });
  assert.ok(!m.unitePlan.helpers.some((p) => p.playerId === 'p_0'), `helpers ${m.unitePlan.helpers.map((p) => p.playerId)}: the empty board is never picked first`);
  h.autoHumans();
  h.runToEnd({ maxSteps: 3e6 });
  assert.deepEqual(audit.violations, [], audit.violations.join('\n'));
  m.dispose();
  // solo: BATTLE_CHECK / ROUND_START / SETTLE run silently; a frozen item slot follows the chess slots after a level-up
  const s = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed: 935, fake: true }).start();
  const sa = attachAudit(s.m);
  s.toPrep(1);
  const ps = s.ps('p_0');
  ps.funds = 50;
  const itemAt = ps.shop.slots.findIndex((x) => x && x.kind === 'item');
  assert.ok(itemAt >= 0);
  const itemId = ps.shop.slots[itemAt].id;
  assert.deepEqual(s.m.handle('p_0', { t: 'g.freeze' }), { ok: true });
  assert.deepEqual(s.m.handle('p_0', { t: 'g.levelUp' }), { ok: true });
  s.drive(() => s.m.phase === PHASE.PREP && s.m.round === 2, { ready: true });
  const now = ps.shop.slots.findIndex((x) => x && x.kind === 'item');
  assert.ok(now > itemAt, `the item slot moved right (${itemAt} → ${now})`);
  assert.equal(ps.shop.slots[now].id, itemId, 'the frozen item was kept');
  s.drive(() => s.ended != null, { ready: true, maxSteps: 3e6 });
  assert.ok(s.ended, 'the solo match ended');
  assert.deepEqual(sa.violations, [], sa.violations.join('\n'));
  s.m.dispose();
});
