import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch, give, legalTileFor } from './harness.js';
import { advisorPlan, planMain, planUnitWeight } from '../../server/match/aiPlan.js';
import { planProtected } from '../../server/match/aiEconomy.js';
import { computeBonds } from '../../server/match/bondsMeta.js';
import { botIntent, botPrepBeginSteps } from '../../server/match/bot.js';

function seat(t, mode = 'coop') {
  const h = makeMatch(mode === 'solo' ? { mode, difficulty: 'ABYSS', fake: true } : { mode, humans: 0, bots: 2, difficulty: 'ABYSS', fake: true });
  t.after(() => { h.m.externalAI = null; h.m.dispose(); }); h.start().toPrep();
  const m = h.m, ps = m.order[0], gd = m.gd;
  ps.isBot = true; ps.bandId = 'band_amiya';
  // four distinct members of the live core bond with the most visible members: a focus even under a teammate's claim
  const bases = id => [...new Set(gd.visibleChess.filter(c => !gd.isGolden(c) && gd.chess(c).bonds?.includes(id)).map(c => gd.baseIdOf(c)))];
  const bond = gd.bondIds.filter(id => gd.bond(id)?.isCore && !gd.modeInactiveBonds.has(id)).sort((a, b) => bases(b).length - bases(a).length)[0];
  for (const c of bases(bond).slice(0, 4)) give(m, ps, c);
  return { m, ps, gd, spare: bases(bond)[4] };
}

test('§37.75: a bot seat starts its prep naming the botIntent focus as its plan main, priority 5, for the round', t => {
  const { m, ps, gd, spare } = seat(t);
  const focus = botIntent(m, ps, 'prep').focus;
  assert.ok(focus);
  assert.equal(advisorPlan(m, ps), null);
  botPrepBeginSteps(m, ps).next();
  assert.deepEqual(advisorPlan(m, ps), { bonds: [{ id: focus, priority: 5 }] });
  assert.equal(planMain(m, ps), focus);
  if (gd.chess(spare).bonds.includes(focus)) assert.equal(planUnitWeight(m, ps, spare, true), 30);
  m.round++;
  assert.equal(advisorPlan(m, ps), null, 'the next round has none until its own prep starts');
});

test('§37.75: a solo bot seat names its focus too; a human seat under 托管 names none', t => {
  const solo = seat(t, 'solo');
  const focus = botIntent(solo.m, solo.ps, 'prep').focus;
  botPrepBeginSteps(solo.m, solo.ps).next();
  assert.deepEqual(advisorPlan(solo.m, solo.ps), focus ? { bonds: [{ id: focus, priority: 5 }] } : null);
  const coop = seat(t);
  coop.ps.isBot = false; coop.ps.autoplay = true;
  botPrepBeginSteps(coop.m, coop.ps).next();
  assert.equal(advisorPlan(coop.m, coop.ps), null);
});

test('§37.75: an external plan\'s own bonds replace the seat\'s; a plan naming none keeps its fields and takes them', t => {
  const { m, ps } = seat(t);
  botPrepBeginSteps(m, ps).next();
  const own = advisorPlan(m, ps).bonds;
  let ext = {};
  m.externalAI = { planFor: () => ext };
  assert.deepEqual(advisorPlan(m, ps), { bonds: own });
  ext = { buy: ['chess_char_1_06_a'], bonds: [] };
  const merged = advisorPlan(m, ps);
  assert.deepEqual(merged, { buy: ['chess_char_1_06_a'], bonds: own });
  assert.equal(advisorPlan(m, ps), merged, 'cached while the external plan is the same object');
  ext = { bonds: [{ id: 'yanShip', priority: 2 }] };
  assert.equal(advisorPlan(m, ps), ext);
});

test('§37.75: a plan bond protects its members only: 缪尔赛思\'s harmony +1 holds a tier without being a member (§37.42 still sells her)', t => {
  const h = makeMatch({ mode: 'solo', difficulty: 'ABYSS', fake: true });
  t.after(() => { h.m.externalAI = null; h.m.dispose(); }); h.start().toPrep();
  const m = h.m, ps = m.order[0], gd = m.gd;
  ps.isBot = true; ps.bandId = 'band_amiya';
  const members = gd.visibleChess.filter(c => !gd.isGolden(c) && gd.chess(c).bonds?.includes('sargonShip'));
  const bases = [...new Set(members.map(c => gd.baseIdOf(c)))].slice(0, 2);
  const onBoard = c => give(m, ps, c, 'board', legalTileFor(m, ps, c));
  const placed = bases.map(onBoard);
  const muelsyse = onBoard('chess_char_6_11_a');
  m.externalAI = { planFor: () => ({ bonds: [{ id: 'sargonShip', priority: 5 }] }) };
  const b = computeBonds(gd, ps).sargonShip;
  assert.equal(b?.active, true, 'two members and her harmony hold the first tier');
  assert.equal(planProtected(m, ps, muelsyse), false, 'she is no member of 萨尔贡');
  assert.equal(planProtected(m, ps, placed[0]), true, 'a member that holds the tier stays');
});
