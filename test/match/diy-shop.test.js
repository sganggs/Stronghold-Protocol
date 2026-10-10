// test/match/diy-shop.test.js — 0.2.0 自选编队 on the server (research 0.2.0 §2; the owner's decisions of 2026-10-05):
// the picks (room.diy → seats[].diy) are checked leniently, fixed for the match and applied to that player only — the
// player's data view makes a slotted slot the operator (name, class, bonds from its factions, no 特质, the pick's skill
// and module; the slot's tier, price and merge), each slotted piece has its own stock (8 at tier 5, 5 at tier 6), never
// enters the shared pool, joins only its player's shop once the 调度中心 reaches the slot's level, leaves the shop when
// every bond of it is banned, merges 3 → elite, and fields its operator in battle (PlayerBattleInput `diy`), client-run
// and server-run identical; prep scouting and the result name the operator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { C2S, validateC2S, checkDiyPicks, DIY_LIMITS } from '../../shared/protocol.js';
import { diyRecord } from '../../shared/diy.js';
import { KITTED_CHARS } from '../../server/sim/content/kits/index.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { DataSource, hasGeneratedData } from '../../server/sim/simdata.js';
import { placeClass } from '../../server/match/board.js';
import { buildResult } from '../../server/match/results.js';
import { GEO } from '../../shared/constants.js';
import { DATA, makeMatch, legalTileFor } from './harness.js';

const REAL = { skip: !hasGeneratedData() };
const wire = (msg) => JSON.parse(JSON.stringify(msg));

const T5A = 'chess_char_5_diy1_a';
const T5B = 'chess_char_5_diy2_a';
const T6A = 'chess_char_6_diy1_a';
const T6B = 'chess_char_6_diy2_a';
const SIEGE = 'char_112_siege'; // 推进之王 (owned 6★, the first operator kit; 维多利亚)
const SHARP = 'char_609_acguad'; // Sharp (6★ prototype: S3 + SOL-X at both tiers, 协防)
const CGUARD = 'char_601_cguard'; // 预备干员-近卫 (4★ reserve: tier 5 only)
const SIEGE_PICK = { charId: SIEGE, skillIndex: 2, uniEquipId: 'uniequip_002_siege' };
const PICKS = { [T5A]: SIEGE_PICK, [T5B]: { charId: SHARP }, [T6A]: { charId: SHARP } };
/** An owned 6★ without a kit (not offered while it has none). */
const UNKITTED = (DATA.backups?.diy?.ownedPool || []).find((id) => !KITTED_CHARS.includes(id));

test('room.diy: structural wire check; checkDiyPicks keeps the legal picks, drops the rest (lenient), BAD_MSG only for malformed input', () => {
  assert.ok(C2S['room.diy']);
  assert.equal(validateC2S({ t: 'room.diy', picks: {} }), null);
  assert.equal(validateC2S({ t: 'room.diy', picks: { [T5A]: SIEGE_PICK, [T6A]: null } }), null);
  for (const bad of [[], 'x', { [T5A]: { skillIndex: 1 } }, { [T5A]: { charId: 'a b' } }, { [T5A]: { charId: SIEGE, skillIndex: 12 } }, { [T5A]: 3 }]) {
    assert.match(validateC2S({ t: 'room.diy', picks: bad }) || '', /bad field picks/, JSON.stringify(bad));
    assert.equal(checkDiyPicks(bad, { data: DATA, kitted: KITTED_CHARS }).error, 'BAD_MSG');
  }
  const many = Object.fromEntries(Array.from({ length: DIY_LIMITS.slots + 1 }, (_, i) => [`slot_${i}`, null]));
  assert.match(validateC2S({ t: 'room.diy', picks: many }) || '', /bad field picks/);

  const res = checkDiyPicks({
    [T5A]: SIEGE_PICK,
    [T5B]: { charId: SHARP, skillIndex: 0 }, // a prototype off its locked skill: dropped
    [T6A]: { charId: SHARP }, // the same prototype at the other tier: fine
    [T6B]: { charId: SIEGE, skillIndex: 0 }, // an owned operator in a second slot: dropped
    chess_char_4_99_a: { charId: SIEGE, skillIndex: 0 }, // not a slot: dropped
  }, { data: DATA, kitted: KITTED_CHARS });
  assert.deepEqual(res, {
    ok: true, dropped: 3,
    picks: { [T5A]: SIEGE_PICK, [T6A]: { charId: SHARP, skillIndex: 2, uniEquipId: 'uniequip_002_acguad' } },
  });
  // a 4★ reserve is a tier-5 pick only; an operator without a kit is never offered
  const r2 = checkDiyPicks({ [T5A]: { charId: CGUARD }, [T6A]: { charId: CGUARD }, [T6B]: UNKITTED ? { charId: UNKITTED, skillIndex: 0 } : null }, { data: DATA, kitted: KITTED_CHARS });
  assert.deepEqual(Object.keys(r2.picks), [T5A]);
  assert.equal(r2.picks[T5A].skillIndex, 2, 'the reserve\'s locked S3');
  // one operator twice in a tier: the first slot keeps it
  const r3 = checkDiyPicks({ [T5B]: { charId: SHARP }, [T5A]: { charId: SHARP } }, { data: DATA, kitted: KITTED_CHARS });
  assert.deepEqual(Object.keys(r3.picks), [T5A]);
  assert.equal(r3.dropped, 1);
});

/** A co-op match: p_0 slots 推进之王 + Sharp (×2 tiers) + junk, p_1 slots 推进之王 in the same slot, the bot nothing. */
function diyMatch(extra = {}) {
  const seats = [
    { seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, diy: { ...PICKS, [T6B]: { charId: SIEGE, skillIndex: 1 }, junk: null } },
    { seat: 1, playerId: 'p_1', name: 'P1', isBot: false, connected: true, diy: { [T5A]: { charId: SIEGE, skillIndex: 0, uniEquipId: null } } },
    { seat: 2, playerId: 'ai_0', name: 'AI0', isBot: true, connected: true, diy: PICKS },
  ];
  return makeMatch({ mode: 'coop', seats, seed: 11, ...extra });
}
/** Gain a chess the way the shop does (acquireChess: the player's copy accounting, merges). */
const gain = (ps, id) => ps.acquireChess(id, { source: 'buy' });
function clear(ps) {
  for (const p of [...ps.board.values()]) ps.returnCopies(p);
  ps.board.clear();
  for (let i = 0; i < ps.hand.length; i++) if (ps.hand[i]) { ps.returnCopies(ps.hand[i]); ps.hand[i] = null; }
  ps.recompute();
}

test('seats[].diy → PlayerState.diy (re-checked, frozen; bots none); the player\'s data view is the operator, everyone else sees the slot', REAL, () => {
  const h = diyMatch().start();
  const p0 = h.ps('p_0');
  const p1 = h.ps('p_1');
  const bot = h.ps('ai_0');
  assert.deepEqual(Object.keys(p0.diy), [T5A, T5B, T6A], 'the owned operator\'s second slot dropped');
  assert.ok(Object.isFrozen(p0.diy) && Object.isFrozen(p0.diy[T5A]));
  assert.deepEqual(bot.diy, {}, 'bots field no 自选 piece');
  assert.equal(bot.gd, h.m.gd, 'a player without picks keeps the match\'s data');
  for (const [id, elite] of [[T5A, false], ['chess_char_5_diy1_b', true]]) {
    const rec = p0.gd.chess(id);
    const want = diyRecord(T5A, SIEGE_PICK, { elite, data: DATA });
    assert.deepEqual([rec.name, rec.charId, rec.diyFor, rec.bonds, rec.garrisonIds, rec.tier, rec.price, rec.sellPrice], [want.name, SIEGE, T5A, ['victoriaShip'], [], 5, 4, 1]);
    assert.equal(rec.skill.skillId, 'skchr_siege_3');
    // (0.2.2: an owned pick at the player's 潜能 / 练度 — none set: 6 / 3)
    assert.deepEqual(p0.loadoutFor(h.m.gd.chess(id)), { skillIndex: 2, moduleId: elite ? 'uniequip_002_siege' : null, potential: 6, cultivate: 3 }, 'the pick, never the loadout');
    assert.equal(h.m.gd.chess(id).name, DATA.chess[id].name, 'the match\'s own record is the slot');
  }
  const s1 = DATA.backups.units[SIEGE].forms['2/1/4/0'].skills.find((x) => x.index === 0).skillId;
  assert.equal(p1.gd.chess(T5A).skill.skillId, s1, 'p_1\'s own pick of the same slot (S1)');
  assert.equal(placeClass(p0, h.m.gd.chess(T5A)), 'melee');
  assert.equal(p0.gd.chess(T5B).charId, SHARP);
  h.m.flush(true);
  const priv = h.lastTo('p_0', 'm.private');
  assert.deepEqual(priv.diy, wire(p0.diy));
  assert.deepEqual(priv.diyBanned, []);
  assert.deepEqual(h.lastTo('p_1', 'm.private').diy, { [T5A]: { charId: SIEGE, skillIndex: 0, uniEquipId: null } });
  // a malformed list (stale client) changes nothing
  assert.equal(p0.setDiy([]), false);
  assert.equal(Object.keys(p0.diy).length, 3);
  h.m.dispose();
});

test('per-player stock: the tier\'s pool copies (8/5 solo, ×2 in this co-op match), never in the shared pool; only its player\'s shop, from the slot\'s 调度中心 level', REAL, () => {
  const h = diyMatch().start();
  const m = h.m;
  h.toPrep(1);
  const p0 = h.ps('p_0');
  const p1 = h.ps('p_1');
  // the caps are this co-op match's pool copies of the tier: 独立模拟 8/5 × poolCopiesCoopScale 2 (GitHub #430)
  assert.deepEqual(p0.diyStock.snapshot(), { [T5A]: 16, [T5B]: 16, [T6A]: 10 });
  assert.deepEqual(p1.diyStock.snapshot(), { [T5A]: 16 }, 'a stock of its own for the same slot');
  for (const id of [T5A, T5B, T6A, T6B]) assert.ok(!m.pool.has(id), 'never in the shared pool');
  const seen = (ps, level, n = 300) => {
    ps.shop.level = level;
    const ids = new Set();
    for (let i = 0; i < n; i++) { ps.rollShop(); for (const s of ps.shop.slots) if (s && s.kind === 'chess' && /_diy/.test(s.id)) ids.add(s.id); }
    return [...ids].sort();
  };
  assert.deepEqual(seen(p0, 4), [], 'level 4: no tier-5 slot yet');
  assert.deepEqual(seen(p0, 5), [T5A, T5B], 'level 5: the tier-5 slots');
  assert.deepEqual(seen(p0, 6, 600), [T5A, T5B, T6A], 'level 6: both tiers');
  assert.deepEqual(seen(h.ps('ai_0'), 6), [], 'the bot\'s shop never sells another player\'s 自选 piece');
  // the price of any chess of the tier
  const slot = p0.shop.slots.find((s) => s && s.id === T6A) || { kind: 'chess', id: T6A, basePrice: m.gd.chessPrice(T6A), frozen: false, sold: false };
  assert.equal(slot.basePrice, 4);
  h.invariants();
  m.dispose();
});

test('buy → 3 copies merge into the elite (the stock pays the copies); sell / elimination give them back; a reward offer may hold it', REAL, () => {
  const h = diyMatch().start();
  const m = h.m;
  h.toPrep(1);
  const p0 = h.ps('p_0');
  clear(p0);
  p0.shop.level = 5;
  p0.funds = 40;
  // three purchases through g.buy (a shop slot stocked with the DIY slot)
  for (let i = 0; i < 3; i++) {
    p0.shop.slots[0] = { kind: 'chess', id: T5A, basePrice: m.gd.chessPrice(T5A), frozen: false, sold: false };
    assert.deepEqual(m.handle('p_0', { t: 'g.buy', slot: 0 }), { ok: true });
  }
  const elite = p0.allChess().find((p) => p.id === 'chess_char_5_diy1_b');
  assert.ok(elite, 'the elite');
  assert.equal(p0.allChess().filter((p) => p.id === T5A).length, 0);
  assert.equal(elite.poolCopies, 3);
  assert.equal(p0.diyStock.left(T5A), 13);
  assert.ok(p0.offers.length >= 1, 'the merge queued a reward offer');
  assert.equal(p0.gd.chess(elite.id).module.id, 'uniequip_002_siege');
  // a slot the player has not filled is no piece: another player's slot cannot be bought or granted
  p0.shop.slots[1] = { kind: 'chess', id: T6B, basePrice: 4, frozen: false, sold: false };
  assert.equal(m.handle('p_0', { t: 'g.buy', slot: 1 }).error, 'BAD_TARGET');
  assert.equal(p0.acquireChess(T6B), null);
  p0.shop.slots[1] = null;
  // sell returns the copies to the player's stock
  assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: elite.uid }), { ok: true });
  assert.equal(p0.diyStock.left(T5A), 16);
  // the stock runs out like a pool entry
  for (let i = 0; i < 16; i++) gain(p0, T5A);
  assert.equal(p0.diyStock.left(T5A), 0);
  p0.shop.slots[0] = { kind: 'chess', id: T5A, basePrice: 4, frozen: false, sold: false };
  assert.equal(m.handle('p_0', { t: 'g.buy', slot: 0 }).error, 'SOLD_OUT');
  h.invariants();
  // reward offers (the temporary refresh) draw it once the 调度中心 is at the slot's level
  clear(p0);
  p0.offers = [];
  let hit = 0;
  p0.shop.level = 4;
  for (let i = 0; i < 200; i++) { const o = p0.pushRewardOffer('merge'); if (o && o.slots.some((s) => /_diy/.test(s.id))) hit++; p0.offers = []; }
  assert.equal(hit, 0, 'a level-4 promotion reward (tier 5) never holds a tier-5 自选 piece');
  p0.shop.level = 6;
  for (let i = 0; i < 300; i++) { const o = p0.pushRewardOffer('merge'); if (o && o.slots.some((s) => s.id === T6A)) hit++; p0.offers = []; }
  assert.ok(hit > 0, 'a level-6 reward can hold the tier-6 piece');
  // elimination returns everything
  gain(p0, T6A);
  p0.eliminate(m.round);
  assert.deepEqual(p0.diyStock.snapshot(), { [T5A]: 16, [T5B]: 16, [T6A]: 10 });
  m.dispose();
});

test('bans: a 自选 piece whose every bond is off this match has no stock (out of the shop); 协防 is never banned', REAL, () => {
  // a seed whose drawn bans include 维多利亚 (推进之王's only bond)
  let h = null;
  for (let seed = 1; seed < 400 && !h; seed++) {
    const t = diyMatch({ seed });
    if (t.m.disabledBonds.includes('victoriaShip')) h = t; else t.m.dispose();
  }
  assert.ok(h, 'a seed banning 维多利亚');
  h.start();
  const p0 = h.ps('p_0');
  assert.deepEqual([...p0.diyBanned], [T5A]);
  assert.ok(!p0.diyStock.has(T5A));
  assert.deepEqual(Object.keys(p0.diyStock.snapshot()).sort(), [T5B, T6A], 'the prototypes (协防) stay');
  assert.ok(!h.m.disabledBonds.includes('emptyShip'));
  h.toPrep(1);
  p0.shop.level = 5;
  for (let i = 0; i < 300; i++) { p0.rollShop(); assert.ok(!p0.shop.slots.some((s) => s && s.id === T5A)); }
  h.m.flush(true);
  assert.deepEqual(h.lastTo('p_0', 'm.private').diyBanned, [T5A]);
  h.invariants();
  h.m.dispose();
});

test('bonds, placement and summons read the operator; the record\'s identity (tier, price, merge) is the slot\'s', REAL, () => {
  const h = diyMatch().start();
  const m = h.m;
  h.toPrep(1);
  const p0 = h.ps('p_0');
  clear(p0);
  const a = gain(p0, T5A);
  const tile = legalTileFor(m, p0, T5A);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: a.uid, to: { area: 'board', row: tile[0], col: tile[1] } }), { ok: true });
  assert.ok(p0.bonds.victoriaShip && p0.bonds.victoriaShip.count >= 1, '推进之王 counts for 维多利亚');
  const b = gain(p0, T5B);
  const t2 = legalTileFor(m, p0, T5B);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: b.uid, to: { area: 'board', row: t2[0], col: t2[1] } }), { ok: true });
  assert.ok(p0.bonds.emptyShip && p0.bonds.emptyShip.count >= 1, 'a prototype counts for 协防');
  assert.equal(m.gd.mergeCount(T5A), 3);
  assert.deepEqual(p0.gd.placeableTokens(T5A, p0.loadoutFor(p0.gd.chess(T5A))), [], '推进之王 makes no summon');
  h.invariants();
  m.dispose();
});

/** The browser's DataSource (battle/runner.js loadBrowserSim): own JSON copies of the data files, backups included. */
function browserSource() {
  const copy = (v) => JSON.parse(JSON.stringify(v));
  return new DataSource({ chess: copy(DATA.chess), enemies: copy(DATA.enemies), tokens: copy(DATA.tokens), stages: copy(DATA.stages), waves: copy(DATA.waves), backups: copy(DATA.backups) }, null);
}

test('battleInput: a 自选 piece carries its pick (`diy`, no loadout fields); the sim fields the operator, client-run and server-run alike', REAL, () => {
  const h = diyMatch().start();
  const m = h.m;
  h.toPrep(1);
  const p0 = h.ps('p_0');
  clear(p0);
  const a = gain(p0, T5A);
  for (let i = 0; i < 2; i++) gain(p0, T5A); // → the elite
  const elite = p0.allChess().find((p) => p.id === 'chess_char_5_diy1_b');
  const tile = legalTileFor(m, p0, elite.id);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: elite.uid, to: { area: 'board', row: tile[0], col: tile[1] } }), { ok: true });
  const s = gain(p0, T6A);
  const t2 = legalTileFor(m, p0, T6A);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: s.uid, to: { area: 'board', row: t2[0], col: t2[1] } }), { ok: true });
  assert.ok(a);
  const input = p0.battleInput();
  const by = new Map(input.units.map((u) => [u.uid, u]));
  assert.deepEqual(by.get(elite.uid).diy, SIEGE_PICK);
  assert.ok(!('skillIndex' in by.get(elite.uid)) && !('moduleId' in by.get(elite.uid)) && !('standIn' in by.get(elite.uid)));
  assert.deepEqual(by.get(s.uid).diy, { charId: SHARP, skillIndex: 2, uniEquipId: 'uniequip_002_acguad' });
  const wave = m.wave;
  const spec = wire(buildBattleSpec({
    battleId: 't.1', fieldId: 'n:p_0', kind: 'normal', seed: 77, modeId: m.modeId, round: 1, stageId: m.stageId,
    rect: { ...GEO.NORMAL_RECT }, timeLimit: 40, players: [input], spawns: wave.spawns.map((x) => ({ ...x, ownerPlayerId: 'p_0' })),
    routes: wave.routes, flags: { layerGainsEnabled: true, ...m.gd.dp }, enemyOverrides: wave.overrides ?? {}, content: 'full',
  }));
  assert.deepEqual(spec.players[0].units.find((u) => u.uid === elite.uid).diy, SIEGE_PICK);
  const run = (ds) => {
    const bt = createBattleFromSpec(wire(spec), ds, { quiet: true, recordEvents: false });
    const u = bt.allyUnits.find((x) => x.uid === elite.uid);
    const def = { charId: u.def.charId, diyFor: u.def.diyFor, skill: u.def.skill?.id, bonds: u.def.bonds, name: u.name, generic: !!u.kit?.generic };
    let n = 0;
    while (!bt.finished && n++ < 30 * 45) bt.step();
    const res = bt.result();
    return { def, time: res.time, killed: res.killed, units: bt.allyUnits.map((x) => [x.uid, x.defId, Math.round(x.hp * 100), x.stats?.dmg | 0, x.skill?.activations ?? null]), rng: bt.rng.state() };
  };
  const server = run(m.ds);
  const client = run(browserSource());
  assert.deepEqual(server.def, { charId: SIEGE, diyFor: T5A, skill: 'skchr_siege_3', bonds: ['victoriaShip'], name: DATA.backups.units[SIEGE].name, generic: false });
  assert.deepEqual(client, server, 'the browser\'s battle equals the server\'s');
  m.dispose();
});

test('prep scouting (m.field) and the result name the operator: a teammate\'s 自选 piece carries its pick and the operator\'s art', REAL, () => {
  const h = diyMatch().start();
  const m = h.m;
  h.toPrep(1);
  const p0 = h.ps('p_0');
  clear(p0);
  const a = gain(p0, T5A);
  const tile = legalTileFor(m, p0, T5A);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: a.uid, to: { area: 'board', row: tile[0], col: tile[1] } }), { ok: true });
  const held = gain(p0, T6A);
  assert.deepEqual(m.handle('p_1', { t: 'g.watch', fieldId: 'n:p_0' }), { ok: true });
  const meta = wire(h.lastTo('p_1', 'm.field'));
  const by = new Map(meta.units.map((u) => [u.uid, u]));
  const u = by.get(a.uid);
  // (the pick as slotted: its module applies on the elite only — the normal piece fights without one)
  assert.deepEqual([u.defId, u.name, u.spine, u.skillIndex, u.moduleId, u.diy], [T5A, DATA.backups.units[SIEGE].name, SIEGE, 2, undefined, SIEGE_PICK]);
  const hu = by.get(held.uid);
  assert.deepEqual([hu.defId, hu.name, hu.diy?.charId], [T6A, DATA.backups.units[SHARP].name, SHARP]);
  const res = buildResult(m, { victory: false, hiddenReached: false, hiddenCleared: false, reason: 'test' });
  const row = res.players.find((p) => p.playerId === 'p_0');
  assert.deepEqual(row.lineup.find((x) => x.id === T5A).diy, SIEGE_PICK);
  m.dispose();
});

test('a match keeps the picks its seat had at its start (the next match takes a change: test/lobby-diy.test.js)', REAL, () => {
  const h = diyMatch().start();
  const p1 = h.ps('p_1');
  const before = p1.diy;
  h.toPrep(1);
  assert.equal(p1.diy, before);
  assert.equal(typeof h.m.setDiy, 'undefined', 'the match has no way to change them');
  h.m.dispose();
  // the next match: new seats, new picks
  const seats = [{ seat: 0, playerId: 'p_1', name: 'P1', isBot: false, connected: true, diy: { [T6A]: { charId: SIEGE, skillIndex: 1 } } }];
  const h2 = makeMatch({ mode: 'solo', seats, seed: 12 }).start();
  assert.deepEqual(h2.ps('p_1').diy, { [T6A]: { charId: SIEGE, skillIndex: 1, uniEquipId: null } });
  h2.m.dispose();
});

test('a placeable 自选 summon comes to the hand like any operator\'s, places, and fights as its owner\'s variant', REAL, () => {
  const h = diyMatch().start();
  const m = h.m;
  h.toPrep(1);
  const p0 = h.ps('p_0');
  // 凯尔希 has no kit yet: the kit list is widened for this test (her Mon3tr is a placeable talent summon)
  assert.equal(p0.setDiy({ [T6B]: { charId: 'char_003_kalts', skillIndex: 0, uniEquipId: null } }, { kitted: [...KITTED_CHARS, 'char_003_kalts'] }), true);
  p0.initDiyStock(new Set());
  clear(p0);
  const k = gain(p0, T6B);
  const tile = legalTileFor(m, p0, T6B);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: k.uid, to: { area: 'board', row: tile[0], col: tile[1] } }), { ok: true });
  const stack = p0.hand.find((p) => p && p.kind === 'token');
  assert.ok(stack, 'the Mon3tr stack is in the hand');
  assert.equal(stack.id, 'token_10002_kalts_mon3tr');
  assert.equal(stack.ownerUid, k.uid);
  assert.equal(p0.gd.token(stack.id).name, 'Mon3tr', 'the player\'s data view finds the 自选 summon');
  const t2 = legalTileFor(m, p0, T6B, new Set([`${tile[0]},${tile[1]}`]));
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: stack.uid, to: { area: 'board', row: t2[0], col: t2[1] } }), { ok: true });
  const input = p0.battleInput();
  const tok = input.units.find((u) => u.kind === 'token');
  assert.deepEqual([tok.tokenId, tok.ownerUid], ['token_10002_kalts_mon3tr', k.uid]);
  const spec = wire(buildBattleSpec({
    battleId: 't.2', fieldId: 'n:p_0', kind: 'normal', seed: 5, modeId: m.modeId, round: 1, stageId: m.stageId,
    rect: { ...GEO.NORMAL_RECT }, timeLimit: 20, players: [input], spawns: [], routes: m.wave.routes,
    flags: { layerGainsEnabled: true, ...m.gd.dp }, enemyOverrides: {}, content: 'full',
  }));
  const bt = createBattleFromSpec(spec, m.ds, { quiet: true, recordEvents: false });
  bt.step();
  const mon = bt.allyUnits.find((u) => u.kind === 'token');
  assert.ok(mon && mon.def.name === 'Mon3tr', 'the summon is fielded');
  assert.equal(mon.ownerUnit?.def?.charId, 'char_003_kalts');
  h.invariants();
  m.dispose();
});

test('a DIY 鸿雪 (her operator kit): her 打字机 piece comes to the hand in prep, places, fields with its kit; it leaves with her', REAL, () => {
  const SNOW = 'char_4055_bgsnow';
  const TYPEWRITER = 'token_10026_bgsnow_subbow';
  if (!KITTED_CHARS.includes(SNOW)) return; // (her kit is on feedback5 since O6)
  const h = diyMatch().start();
  const m = h.m;
  h.toPrep(1);
  const p0 = h.ps('p_0');
  assert.equal(p0.setDiy({ [T5B]: { charId: SNOW, skillIndex: 0, uniEquipId: null } }), true, 'a kitted pick: no widened list');
  p0.initDiyStock(new Set());
  clear(p0);
  const snow = gain(p0, T5B);
  assert.ok(!p0.hand.some((p) => p && p.kind === 'token'), 'in the hand she brings no summon yet');
  const tile = legalTileFor(m, p0, T5B);
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: snow.uid, to: { area: 'board', row: tile[0], col: tile[1] } }), { ok: true });
  const stack = p0.hand.find((p) => p && p.kind === 'token');
  assert.ok(stack, 'deployed, her 打字机 comes to the hand (PRTS 卫戍协议/帮助 §战斗部署)');
  assert.deepEqual([stack.id, stack.ownerUid, stack.count], [TYPEWRITER, snow.uid, DATA.backups.tokens[TYPEWRITER].variants[`${SNOW}@2/1/4/0`].stats.deployLimit]);
  const t2 = legalTileFor(m, p0, T5B, new Set([`${tile[0]},${tile[1]}`]));
  assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: stack.uid, to: { area: 'board', row: t2[0], col: t2[1] } }), { ok: true });
  h.invariants();
  const input = p0.battleInput();
  const tok = input.units.find((u) => u.kind === 'token');
  assert.deepEqual([tok.tokenId, tok.ownerUid], [TYPEWRITER, snow.uid], 'the battle input carries the piece with its owner');
  const spec = wire(buildBattleSpec({
    battleId: 't.3', fieldId: 'n:p_0', kind: 'normal', seed: 9, modeId: m.modeId, round: 1, stageId: m.stageId,
    rect: { ...GEO.NORMAL_RECT }, timeLimit: 20, players: [input], spawns: [], routes: m.wave.routes,
    flags: { layerGainsEnabled: true, ...m.gd.dp }, enemyOverrides: {}, content: 'full',
  }));
  for (const ds of [m.ds, browserSource()]) {
    const bt = createBattleFromSpec(wire(spec), ds, { quiet: true, recordEvents: false });
    bt.step();
    const u = bt.allyUnits.find((x) => x.uid === snow.uid);
    const t = bt.allyUnits.find((x) => x.kind === 'token' && x.defId === TYPEWRITER);
    assert.ok(u && !u.kit.generic, 'her operator kit');
    assert.ok(t, 'the 打字机 is fielded');
    assert.equal(t.ownerUnit, u, 'owned by her (the kit finds its piece by owner)');
    assert.equal(t.def.stats.maxHp, DATA.backups.tokens[TYPEWRITER].variants[`${SNOW}@2/1/4/0`].stats.maxHp, 'the token record of her form');
    assert.ok(t.kit && !t.kit.generic, 'the typewriter runs the kit her install gave it');
    assert.equal(bt.errors.length, 0);
  }
  // sold, the piece leaves with her
  assert.deepEqual(m.handle('p_0', { t: 'g.sell', uid: snow.uid }), { ok: true });
  assert.ok(![...p0.board.values(), ...p0.hand, ...p0.temp].some((p) => p && p.kind === 'token'), 'her summon leaves with her');
  h.invariants();
  m.dispose();
});
