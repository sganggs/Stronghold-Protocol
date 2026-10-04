// 芬's 信标 gift (server/match/builtinMeta.js use_equip_recruit_new_char_and_give_char_to_player_most_bond →
// effect:builtin_gift): act2autochess eff_acarm109 "下个休整期向相应盟约人数最多的队友发送1个原干员"; band_fang
// "原干员在下回合传递给对应盟约人数最多的队友".
//   * community report #6 after 0.1.2: an ELITE carrier arrived at the teammate as the normal card — the gift is the
//     original operator, an elite with its 3 pool copies;
//   * GitHub #86: a sender eliminated before the next round start got no onRoundStart, so the gift was lost — it is
//     delivered anyway (afterElimination); a failed grant keeps the gift for the next round start; a receiver
//     eliminated meanwhile is replaced by the living teammate with the most members of the bonds [ASSUMED].
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, giveItem, DATA, legalTileFor } from './harness.js';
import { FakeBattle } from './fakeBattle.js';
import { createRegistry } from '../../server/match/effectsMeta.js';

const QUIET = { warn() {}, error() {}, info() {} };
const REG = createRegistry({ log: QUIET });
const OK = { ok: true };
const BEACON = 'chess_item_5_04_e_a';

/** Co-op match of `humans` humans at PREP R1, every board / hand emptied (pool copies returned), no strategies. */
function setup({ humans = 2, seed = 31 } = {}) {
  const h = makeMatch({ mode: 'coop', humans, seed, registry: REG, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  for (const ps of m.players.values()) {
    for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean), ...ps.temp.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
    ps.board.clear(); ps.hand.fill(null); ps.temp.fill(null); ps.offers.length = 0;
    ps.funds = 50; ps.layers = {}; ps.pendingFunds = 0; ps.shop.freeRefreshes = 0;
    ps.bandId = null;
    ps.recompute();
  }
  const equip = (item, target, pid = 'p_0') => m.handle(pid, { t: 'g.equip', itemUid: item.uid, targetUid: target.uid });
  return { h, m, equip };
}
/** Visible normal chess (with an elite) whose 特质 are all IN_BATTLE, sorted. */
const plain = (pred = () => true) => Object.values(DATA.chess)
  .filter((c) => c.visible && !c.isGolden && c.goldenId && (c.garrisonIds || []).every((g) => DATA.garrisons[g].eventType === 'IN_BATTLE') && pred(c))
  .map((c) => c.chessId).sort();
const owned = (ps) => [...ps.board.values(), ...ps.hand, ...ps.temp].filter((p) => p && p.kind === 'chess');
const ofBase = (m, ps, base) => owned(ps).filter((p) => m.gd.baseIdOf(p.id) === base);
const gifts = (ps) => ps.effects.filter((e) => e.key === 'effect:builtin_gift');
/** `ps` drops to 1 LP and every field leaks one enemy (nobody perfect: no 联防), so `ps` is eliminated at the settle. */
const knockOut = (ps) => { ps.lp = 1; FakeBattle.script = (b) => ({ leaks: Object.fromEntries(b.players.map((id) => [id, 1])) }); };
const deploy = (m, ps, id) => give(m, ps, id, 'board', legalTileFor(m, ps, id));

test('信标 on an elite: the teammate receives that elite with its 3 pool copies, not the normal card (community report #6)', () => {
  const { h, m, equip } = setup({ seed: 31 });
  const p0 = h.ps('p_0'), p1 = h.ps('p_1');
  const cid = plain((c) => c.tier === 3 && c.bonds.length)[0];
  const gid = DATA.chess[cid].goldenId;
  const t = give(m, p0, gid, 'hand');
  assert.equal(t.poolCopies, m.gd.goldenCopies);
  const left = m.pool.left(cid);
  assert.deepEqual(equip(giveItem(m, p0, BEACON), t), OK);
  assert.equal(p0.find(t.uid), null, 'carrier destroyed');
  assert.equal(m.pool.left(cid), left + 3, 'its 3 copies are back in the pool');
  for (const s of p0.offers[0].slots) assert.equal(DATA.chess[s.id].tier, 3, 'the pick of two stays at the carrier\'s tier');
  assert.equal(gifts(p0)[0].params.chessId, gid, 'the gift carries the elite id');
  h.toPrep(2);
  const got = ofBase(m, p1, cid);
  assert.equal(got.length, 1, 'gift arrived');
  assert.equal(got[0].id, gid, 'as the elite');
  assert.equal(got[0].poolCopies, 3, 'holding the 3 copies');
  assert.equal(m.pool.left(cid), left, 'taken from the pool again');
  assert.equal(gifts(p0).length, 0, 'removed once granted');
  h.invariants();
});

test('信标 on a normal operator still sends the normal card', () => {
  const { h, m, equip } = setup({ seed: 35 });
  const p0 = h.ps('p_0'), p1 = h.ps('p_1');
  const cid = plain((c) => c.tier === 2 && c.bonds.length)[0];
  assert.deepEqual(equip(giveItem(m, p0, BEACON), give(m, p0, cid, 'hand')), OK);
  h.toPrep(2);
  assert.deepEqual(ofBase(m, p1, cid).map((p) => [p.id, p.poolCopies]), [[cid, 1]]);
  h.invariants();
});

test('信标: the gift still arrives when its sender is eliminated before the next round start (GitHub #86)', () => {
  const { h, m, equip } = setup({ seed: 33 });
  const p0 = h.ps('p_0'), p1 = h.ps('p_1');
  const cid = plain((c) => c.tier === 3 && c.bonds.length)[1];
  const gid = DATA.chess[cid].goldenId;
  assert.deepEqual(equip(giveItem(m, p0, BEACON), give(m, p0, gid, 'hand')), OK);
  knockOut(p0);
  h.toPrep(2);
  assert.equal(p0.alive, false, 'the sender was eliminated at the R1 settle');
  assert.equal(p0.eliminatedRound, 1);
  assert.deepEqual(ofBase(m, p1, cid).map((p) => p.id), [gid], 'the teammate got the elite anyway');
  assert.equal(gifts(p0).length, 0, 'delivered, then removed');
  const line = h.allTo('p_1', 'm.ticker').find((t) => t.type === 'CHAR_GIFT');
  assert.ok(line && line.text.includes('P0') && line.text.includes(DATA.chess[gid].name), `CHAR_GIFT names the sender: ${line && line.text}`);
  h.invariants();
});

test('信标: a grant that fails (no copy left in the pool) keeps the gift for the next round start', () => {
  const { h, m, equip } = setup({ seed: 37 });
  const p0 = h.ps('p_0'), p1 = h.ps('p_1');
  const cid = plain((c) => c.tier === 2 && c.bonds.length)[1];
  assert.deepEqual(equip(giveItem(m, p0, BEACON), give(m, p0, cid, 'hand')), OK);
  // every copy taken by "other players" before the round start
  const held = m.pool.take(cid, 99);
  assert.ok(held > 0);
  h.drive(() => m.phase === 'PREP' && m.round === 2);
  assert.equal(ofBase(m, p1, cid).length, 0, 'nothing granted');
  assert.equal(gifts(p0).length, 1, 'the gift is kept');
  m.pool.give(cid, held); // the copies come back (sold)
  h.toPrep(3);
  assert.deepEqual(ofBase(m, p1, cid).map((p) => p.id), [cid], 'delivered at the next round start');
  assert.equal(gifts(p0).length, 0);
  h.invariants();
});

test('信标: a receiver eliminated before the round start is replaced by the living teammate with the most bond members [ASSUMED]', () => {
  const { h, m, equip } = setup({ humans: 3, seed: 39 });
  const p0 = h.ps('p_0'), p1 = h.ps('p_1'), p2 = h.ps('p_2');
  const cid = plain((c) => c.tier === 3 && c.bonds.length === 1)[0];
  const bond = DATA.chess[cid].bonds[0];
  const mates = plain((c) => c.bonds.includes(bond) && c.chessId !== cid);
  deploy(m, p1, mates[0]);
  deploy(m, p1, mates[1]); // p1 fields the most members → picked at equip time
  deploy(m, p2, mates[2]);
  assert.deepEqual(equip(giveItem(m, p0, BEACON), give(m, p0, cid, 'hand')), OK);
  assert.equal(gifts(p0)[0].params.toPlayerId, 'p_1');
  knockOut(p1);
  h.toPrep(2);
  assert.equal(p1.alive, false);
  assert.deepEqual(ofBase(m, p2, cid).map((p) => p.id), [cid], 'the next teammate got it');
  assert.equal(gifts(p0).length, 0);
  h.invariants();
});
