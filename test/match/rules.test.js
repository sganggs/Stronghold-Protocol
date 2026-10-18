// Match-level rule switches (DESIGN §34.15). Synthetic rooms only: no pack files.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ERR, GEO, PHASE } from '../../shared/constants.js';
import { checkLoadout, loadoutOptions } from '../../shared/protocol.js';
import { createRng } from '../../server/sim/rng.js';
import { pieceBonds } from '../../server/match/bondsMeta.js';
import { unitBonds } from '../../server/sim/content/support/index.js';
import { DATA, makeMatch, give, giveItem, legalTileFor } from './harness.js';
import { fixture } from '../helpers/contentFixtures.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { metaBonds } from '../../server/sim/content/support/meta.js';
import { makeCtx } from '../../server/match/effectsMeta.js';
import { Lobby } from '../../server/lobby.js';
import { SessionRegistry } from '../../server/net.js';

function modMatch(t, rules, opts = {}) {
  const f = fixture(t);
  f.put('room-rules', { rules, permissions: [] });
  const set = buildContentSet({ registry: f.registry, ids: ['room-rules'] });
  assert.deepEqual(set.problems, []);
  assert.equal(set.vanilla, false);
  return makeMatch({ mode: 'solo', seed: 21, fake: true, data: set.data, cs: set.cs, requireCs: true, rules: set.rules, ...opts });
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ISO = 'chess_item_6_09_e_a';
const HAMMER = 'chess_item_1_01_e_a';
const KNIFE = 'chess_item_2_03_e_a';
const INSIDE = 'chess_char_1_01_a';
const SWIRE = 'chess_char_3_04_a';
const chess = (id) => DATA.chess[id];
const ok = (r) => assert.deepEqual(r, { ok: true });

function prep(rules, t) {
  const h = (rules ? modMatch(t, rules) : makeMatch({ mode: 'solo', seed: 21, fake: true })).start().toPrep(1);
  const ps = h.ps('p_0');
  ps.funds = 50;
  return h;
}

function wearer(h, itemIds) {
  const { m } = h;
  const ps = h.ps('p_0');
  const id = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier <= 2 && !c.bonds.includes('victoriaShip') && !c.bonds.includes('yanShip') && !c.bonds.includes('maniShip')).chessId;
  const p = give(m, ps, id, 'hand');
  for (const itemId of itemIds) ok(m.handle('p_0', { t: 'g.equip', itemUid: giveItem(m, ps, itemId).uid, targetUid: p.uid }));
  return p;
}

test('a room without rules stays the official match', () => {
  const h = prep();
  assert.equal(h.m.rules, undefined);
  assert.equal(h.m.phase, PHASE.PREP);
  const r = h.m.setLoadout('p_0', {});
  assert.equal(r.error, ERR.WRONG_PHASE);
  const p = wearer(h, [HAMMER]);
  const item = p.items[0];
  const locked = h.m.handle('p_0', { t: 'g.unequip', itemUid: item.uid });
  assert.equal(locked.error, ERR.BAD_TARGET);
  assert.equal(locked.detail, 'equipped items are locked');
  assert.equal(p.items[0].uid, item.uid);
  h.m.dispose();
});

test('shopBias bondBias draws the active bond when that tier has one, and matches official when none is active', (t) => {
  const plain = prep();
  const biased = prep({ shopBias: 'bondBias' }, t);
  const plainItems = plain.ps('p_0').shop.slots.filter((s) => s && s.kind === 'item').map((s) => s.id);
  const biasedItems = biased.ps('p_0').shop.slots.filter((s) => s && s.kind === 'item').map((s) => s.id);
  assert.deepEqual(biasedItems, plainItems, 'no active bond: the shop rng stays today\'s');
  const bond = 'victoriaShip';
  const ps = biased.ps('p_0');
  const members = Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.tier <= 2 && c.bonds.includes(bond) && !c.bonds.includes('maniShip')).map((c) => c.chessId);
  let placed = 0;
  for (const id of members) {
    if (ps.bonds[bond]?.active || placed >= 8) break;
    placed += 1;
    const p = give(biased.m, ps, id, 'hand');
    const at = legalTileFor(biased.m, ps, id);
    ok(biased.m.handle('p_0', { t: 'g.move', uid: p.uid, to: { area: 'board', row: at[0], col: at[1] } }));
  }
  ps.recompute();
  assert.equal(ps.bonds[bond].active, true);
  const seen = [];
  const orig = biased.m.pool.rollItem.bind(biased.m.pool);
  biased.m.pool.rollItem = (rng, maxTier, stock, biasArg) => {
    seen.push(biasArg);
    return orig(rng, maxTier, stock, biasArg);
  };
  const slot = ps._rollItemSlot();
  assert.ok(slot && slot.kind === 'item');
  assert.ok(seen[0] instanceof Set && seen[0].has(bond), 'the room passes the active bond into the shop roll');
  const bias = new Set([bond]);
  const tiers = biased.m.gd.shopItemsByTier;
  for (let seed = 1; seed <= 30; seed++) {
    const rng = createRng(seed);
    const draws = [];
    const wrapped = () => { const v = rng(); draws.push(v); return v; };
    const id = orig(wrapped, 3, null, bias);
    assert.equal(draws.length, 2, `seed ${seed}`);
    const shares = biased.m.pool.tierShares(3);
    const order = Object.keys(shares).map(Number).sort((a, b) => a - b);
    let r = draws[0];
    let tier = order[order.length - 1];
    for (const t of order) { r -= shares[t]; if (r < 0) { tier = t; break; } }
    const nonempty = (t) => (tiers[t] || []).length > 0;
    let used = null;
    for (let t = tier; t >= 1; t--) if (nonempty(t)) { used = t; break; }
    if (used == null) for (let t = tier + 1; t <= 6; t++) if (nonempty(t)) { used = t; break; }
    const list = tiers[used];
    const filtered = list.filter((itemId) => biased.m.gd.item(itemId)?.giveBondId === bond);
    const from = filtered.length ? filtered : list;
    assert.equal(id, from[Math.floor(draws[1] * from.length)], `seed ${seed}`);
  }
  const rngA = createRng(5);
  const rngB = createRng(5);
  const pool = plain.m.pool;
  const a = [];
  const b = [];
  for (let i = 0; i < 20; i++) a.push(pool.rollItem(rngA, 3, null, null));
  for (let i = 0; i < 20; i++) b.push(pool.rollItem(rngB, 3, null, new Set()));
  assert.deepEqual(a, b, 'null and an empty Set draw the same ids');
  plain.m.dispose();
  biased.m.dispose();
});

test('prepLoadout merges one submission in 休整期 and locks it after 准备', (t) => {
  const h = prep({ prepLoadout: 'prep' }, t);
  const m = h.m;
  const ps = h.ps('p_0');
  const first = checkLoadout({ [INSIDE]: { skill: 0 } }, chess).loadout;
  const swire = chess(SWIRE);
  const opt = loadoutOptions(swire, chess(swire.goldenId));
  const skill = opt.skills.find((s) => s !== opt.defaultSkill);
  const second = checkLoadout({ [SWIRE]: { skill } }, chess).loadout;
  assert.equal(second[SWIRE].skill, skill, 'a non-default skill is stored');
  ok(m.setLoadout('p_0', first));
  ok(m.setLoadout('p_0', second));
  assert.equal(ps.loadout[INSIDE].skill, 0, 'the operator the second submission does not name keeps its choice');
  assert.equal(ps.loadout[SWIRE].skill, skill);
  ok(m.setLoadout('p_0', { [SWIRE]: { skill: opt.defaultSkill } }));
  assert.equal(ps.loadout[SWIRE], undefined, 'a named default resets that operator');
  assert.equal(ps.loadout[INSIDE].skill, 0, 'a named default preserves the other operator');
  ok(m.setLoadout('p_0', second));
  const lobby = new Lobby({ registry: new SessionRegistry() });
  t.after(() => lobby.shutdown());
  const session = { playerId: 'p_0', name: 'Test', connected: true, ws: null };
  ok(lobby.create(session, { mode: 'solo', difficulty: 'NORMAL' }));
  const room = lobby.roomOf(session);
  room.content = { cs: m.cs, vanilla: false, rules: m.rules, plugins: [] };
  room.match = m;
  ok(lobby.loadout(session, { entries: { [SWIRE]: { skill: opt.defaultSkill } } }));
  assert.equal(ps.loadout[SWIRE], undefined, 'lobby forwarding preserves named defaults through validation');
  assert.equal(ps.loadout[INSIDE].skill, 0);
  ps.ready = true;
  assert.equal(m.setLoadout('p_0', first).error, ERR.WRONG_PHASE);
  assert.equal(ps.loadout[INSIDE].skill, 0);
  h.m.dispose();
  const info = modMatch(t, { prepLoadout: 'prep' }, { seed: 4 }).start();
  assert.equal(info.m.phase, PHASE.INFO_CHECK);
  info.ps('p_0').ready = true;
  ok(info.m.setLoadout('p_0', first));
  ok(info.m.setLoadout('p_0', {}));
  assert.deepEqual(info.ps('p_0').loadout, {}, 'INFO_CHECK still replaces the whole loadout');
  info.m.dispose();
});

const SILENCE = 'chess_char_2_02_a';
const DRONE = 'token_10000_silent_healrb';
const tokensOf = (ps, owner) => [...ps.board.values(), ...ps.hand, ...ps.temp]
  .filter((p) => p?.kind === 'token' && p.ownerUid === owner.uid);

function placeToken(h, ps, token) {
  for (let row = 9; row <= 12; row++) for (let col = 2; col <= 10; col++) {
    if (ps.board.has(`${row},${col}`) || !ps._legal(token, row, col)) continue;
    ok(h.m.handle('p_0', { t: 'g.move', uid: token.uid, to: { area: 'board', row, col } }));
    return ps.board.get(`${row},${col}`).uid;
  }
  assert.fail('no legal summon tile');
}

test('prep loadout reconciles summons in both skill directions and the next real battle', (t) => {
  const h = prep({ prepLoadout: 'prep' }, t);
  t.after(() => h.m.dispose());
  const ps = h.ps('p_0');
  ok(h.m.setLoadout('p_0', { [SILENCE]: { skill: 0 } }));
  const owner = give(h.m, ps, SILENCE, 'board', legalTileFor(h.m, ps, SILENCE));
  assert.deepEqual(tokensOf(ps, owner), []);
  ok(h.m.setLoadout('p_0', { [SILENCE]: { skill: 1 } }));
  const drone = tokensOf(ps, owner)[0];
  assert.equal(drone?.id, DRONE, 'S1 to S2 immediately grants the drone card');
  placeToken(h, ps, drone);
  const opts = h.m._normalOpts(ps);
  opts.spawns = opts.spawns.map((s) => ({ ...s, time: 100 }));
  opts.timeLimit = 45;
  opts.flags = { ...opts.flags, dpInit: 99, dpMax: 99 };
  const field = () => h.m._ccField({ fieldId: 'loadout', kind: 'normal', players: ['p_0'], opts: { ...opts, players: [ps.battleInput()] } }).spec;
  const b = createBattleFromSpec(field(), h.m.ds);
  let deployed = false;
  for (let tick = 0; tick < 1200 && !b.finished; tick++) {
    b.step();
    if (b.units.some((u) => u.defId === DRONE && u.deployed)) deployed = true;
  }
  assert.ok(b.units.find((u) => u.uid === owner.uid).skill.activations > 0);
  assert.ok(deployed, 'the newly selected skill uses its deployed card');
  h.invariants();
  ok(h.m.setLoadout('p_0', { [SILENCE]: { skill: 0 } }));
  assert.deepEqual(tokensOf(ps, owner), [], 'S2 to S1 removes the deployed drone');
  assert.equal(ps.battleInput().units.some((u) => u.kind === 'token'), false);
  const next = createBattleFromSpec(field(), h.m.ds);
  next.step();
  assert.equal(next.units.some((u) => u.defId === DRONE), false);
  // Exercise inventory stacks and their temp deadlines as well as the deployed card above.
  ok(h.m.setLoadout('p_0', { [SILENCE]: { skill: 1 } }));
  const stack = tokensOf(ps, owner)[0];
  ps._detach(ps.find(stack.uid));
  ps.stow(stack, { toTemp: true });
  const spare = ps.newPiece('token', DRONE, { ownerUid: owner.uid });
  ps.stow(spare);
  assert.equal(ps._tempDue.has(stack.uid), true);
  ok(h.m.setLoadout('p_0', { [SILENCE]: { skill: 0 } }));
  assert.deepEqual(tokensOf(ps, owner), [], 'obsolete hand and temp cards are removed');
  assert.equal(ps._tempDue.has(stack.uid), false);
  h.invariants();
});

test('prep module changes trim excess summons, preserve valid placements, and leave other owners alone', (t) => {
  const h = prep({ prepLoadout: 'prep' }, t);
  t.after(() => h.m.dispose());
  const ps = h.ps('p_0');
  const id = chess(SILENCE).goldenId;
  // Synthetic stock fixture: this module supplies three cards; removing it leaves one.
  const original = ps.gd.placeableTokens.bind(ps.gd);
  ps.gd.placeableTokens = (chessId, lo) => original(chessId, lo)
    .map((s) => ({ ...s, count: chessId === id && lo.moduleId !== 'none' ? 3 : s.count }));
  const owner = give(h.m, ps, id, 'board', legalTileFor(h.m, ps, id));
  const other = give(h.m, ps, SILENCE, 'board', legalTileFor(h.m, ps, SILENCE));
  ps.removeTokensOf(other.uid); // A removed stack must not be replenished by editing another owner.
  const stack = tokensOf(ps, owner)[0];
  const placed = placeToken(h, ps, stack);
  assert.equal(tokensOf(ps, owner).reduce((n, p) => n + p.count, 0), 3);
  const before = JSON.stringify([ps.loadout, ...tokensOf(ps, owner)]);
  assert.equal(h.m.setLoadout('p_0', { [SILENCE]: { skill: 99 } }).error, ERR.BAD_TARGET);
  assert.equal(JSON.stringify([ps.loadout, ...tokensOf(ps, owner)]), before, 'validation fails atomically');
  ok(h.m.setLoadout('p_0', { [SILENCE]: { module: 'none' } }));
  assert.deepEqual(tokensOf(ps, owner).map((p) => p.uid), [placed], 'keep the valid placed card before inventory excess');
  assert.deepEqual(tokensOf(ps, other), [], 'an unaffected owner is not topped up');
  ok(h.m.setLoadout('p_0', { [SILENCE]: { module: loadoutOptions(chess(SILENCE), chess(id)).defaultModule } }));
  assert.equal(tokensOf(ps, owner).reduce((n, p) => n + p.count, 0), 3, 'restoring the module grants only the missing two');
  ps.removeTokensOf(owner.uid);
  ok(h.m.setLoadout('p_0', {}));
  assert.deepEqual(tokensOf(ps, owner), [], 'an unchanged submission does not refresh spent stock');
  h.invariants();
});

test('morphPairing plus grants only the leftmost bond and does not spend a slot on the morph', (t) => {
  const knife = Object.values(DATA.items).find((it) => it.itemType === 'EQUIP' && !it.canGiveBond && !it.isGolden && it.giveBondId && it.giveBondId !== 'victoriaShip' && it.id !== HAMMER);
  assert.ok(knife, 'a second bond item');
  const plus = prep({ morphPairing: 'plus' }, t);
  const both = wearer(plus, [HAMMER, knife.id, ISO]);
  const wornIds = both.items.map((it) => it.id);
  const granted = pieceBonds(plus.m.gd, both, plus.m.rules).filter((b) => b === 'victoriaShip' || b === knife.giveBondId);
  assert.deepEqual(granted, ['victoriaShip']);
  assert.equal(both.items.some((it) => it.id === ISO), true);
  assert.equal(both.items.filter((it) => !plus.m.gd.item(it.id)?.canGiveBond).length, 2);
  plus.invariants();
  const ctx = makeCtx(plus.m, plus.ps('p_0'), { piece: both }, 'onEquip');
  assert.deepEqual(metaBonds(ctx, plus.ps('p_0').pieceView(both)), pieceBonds(plus.m.gd, both, plus.m.rules), 'prep effect helpers use the same policy');
  const snapshot = { ...plus.ps('p_0').pieceView(both), uid: 999999 };
  assert.deepEqual(metaBonds(ctx, snapshot), pieceBonds(plus.m.gd, both, plus.m.rules), 'detached effect snapshots use the same policy');
  const at = legalTileFor(plus.m, plus.ps('p_0'), both.id);
  ok(plus.m.handle('p_0', { t: 'g.move', uid: both.uid, to: { area: 'board', row: at[0], col: at[1] } }));
  const opts = plus.m._normalOpts(plus.ps('p_0'));
  const field = plus.m._ccField({ fieldId: 'test', kind: 'normal', players: ['p_0'], opts });
  assert.equal(field.spec.morphPairing, 'plus', 'the server writes the room rule into the battle input');
  const battle = createBattleFromSpec(field.spec, plus.m.ds);
  battle.step();
  const u = battle.units.find((u) => u.kind === 'op' && u.uid === both.uid);
  assert.ok(u);
  assert.equal(unitBonds(u).includes(knife.giveBondId), false, 'the actual battle receives the plus rule');
  assert.equal(unitBonds(u).includes('victoriaShip'), true);
  assert.equal(Object.hasOwn(buildBattleSpec(opts), 'morphPairing'), false, 'official specs do not gain a key');
  const third = Object.values(DATA.items).find((it) => it.itemType === 'EQUIP' && !it.canGiveBond && it.id !== HAMMER && it.id !== knife.id && !it.isGolden);
  ok(plus.m.handle('p_0', { t: 'g.equip', itemUid: giveItem(plus.m, plus.ps('p_0'), third.id).uid, targetUid: both.uid }));
  assert.equal(both.items.some((it) => it.id === ISO), true, 'the morph is not the replaced item');
  assert.equal(both.items.some((it) => it.id === HAMMER), false, 'the leftmost occupying item was replaced');
  const again = plus.m.handle('p_0', { t: 'g.equip', itemUid: giveItem(plus.m, plus.ps('p_0'), ISO).uid, targetUid: both.uid });
  assert.equal(again.error, ERR.BAD_TARGET);
  assert.equal(again.detail, 'morph already equipped');
  plus.invariants();
  const official = prep();
  const worn = wearer(official, [HAMMER, knife.id, ISO]);
  assert.equal(worn.items.length, 2, 'official morph occupies a slot and the third item replaced the hammer');
  const bothBonds = pieceBonds(official.m.gd, { ...worn, items: wornIds.map((id) => ({ id })) }).filter((b) => b === 'victoriaShip' || b === knife.giveBondId);
  assert.deepEqual(bothBonds, ['victoriaShip', knife.giveBondId]);
  const lone = { kind: 'op', items: wornIds, def: { bonds: [] }, player: { morphPairing: 'plus' } };
  const bonds = unitBonds(lone);
  assert.equal(bonds.includes('victoriaShip'), true);
  assert.equal(bonds.includes(knife.giveBondId), false);
  plus.m.dispose();
  official.m.dispose();
});

test('unequip allow returns the item to the hand, then the visible temp row, and refuses when both are full', (t) => {
  const h = prep({ unequip: 'allow' }, t);
  const { m } = h;
  const ps = h.ps('p_0');
  const p = wearer(h, [KNIFE, HAMMER]);
  const item = p.items[1];
  const stock = () => [m.itemPool.held(HAMMER), m.itemPool.cap(HAMMER), m.itemPool.left(HAMMER), m.itemPool.debtOf(HAMMER)];
  const held = stock();
  const handAt = ps.hand.findLastIndex((p) => p == null);
  ok(m.handle('p_0', { t: 'g.unequip', itemUid: item.uid }));
  assert.equal(p.items.length, 1);
  assert.equal(ps.hand.some((x) => x && x.uid === item.uid), true);
  assert.equal(ps.hand[handAt], item, 'same object in the rightmost free hand slot');
  assert.deepEqual(stock(), held, 'stock is unchanged');
  ok(m.handle('p_0', { t: 'g.equip', itemUid: item.uid, targetUid: p.uid }));
  for (let i = 0; i < GEO.HAND_SIZE; i++) if (ps.hand[i] == null) ps.hand[i] = ps.newPiece('chess', INSIDE);
  for (let i = 0; i < GEO.TEMP_SIZE; i++) if (ps.temp[i] == null) ps.temp[i] = ps.newPiece('item', KNIFE);
  const snapshot = JSON.stringify([ps.hand, ps.temp, p.items]);
  const full = m.handle('p_0', { t: 'g.unequip', itemUid: item.uid });
  assert.equal(full.error, ERR.HAND_FULL);
  assert.equal(JSON.stringify([ps.hand, ps.temp, p.items]), snapshot, 'no container or equipment index moved');
  ps.temp[GEO.TEMP_SIZE - 1] = null;
  ok(m.handle('p_0', { t: 'g.unequip', itemUid: item.uid }));
  assert.equal(ps.temp[GEO.TEMP_SIZE - 1].uid, item.uid, 'a hole in the visible five is free');
  assert.equal(p.items.length, 1);
  ps.ready = true;
  assert.equal(m.handle('p_0', { t: 'g.unequip', itemUid: item.uid }).error, ERR.WRONG_PHASE);
  const bot = readFileSync(path.join(ROOT, 'server/match/bot.js'), 'utf8');
  assert.equal(bot.includes('g.unequip'), false);
  h.m.dispose();
});
