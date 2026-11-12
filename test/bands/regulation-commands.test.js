import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadData } from '../../server/data.js';
import { setGameData } from '../../server/sim/content/support/index.js';
import { SharedPool } from '../../server/match/pool.js';
import { createRegistry } from '../../server/match/effectsMeta.js';
import { fieldTile } from '../../server/match/board.js';
import { makeMatch } from '../match/harness.js';
import { syncCommand, beginCommandPrep, commandView, openSkillChangeDraft, commandSkill, commandBattleInput, commandBondOverrides, reconcileCommandChests, keepsFunds } from '../../server/match/bandCommands.js';
import { botUseCommand, fieldModel } from '../../server/match/bot.js';
import { validateC2S } from '../../shared/protocol.js';
import { fileURLToPath } from 'node:url';
import { commandCandidatePool, commandHasFutureEffects, commandSkillAtPlayerLevel } from '../../server/match/commandLevels.js';

const data = loadData(fileURLToPath(new URL('../../data/versions/act3autochess-v3_1', import.meta.url)), { log: { warn() {} } });
before(() => setGameData(data));
after(() => setGameData(null));
const setup = (t, band, round = 1) => {
  const h = makeMatch({ data, mode: 'coop', humans: 2, bots: 0, fake: true, seed: 137, registry: createRegistry() }).start();
  t.after(() => { assert.equal(h.m.errorCount, 0); h.m.dispose(); });
  // Command unit fixtures need named operators from every bond; the real draw is covered in bond-groups.test.js.
  h.m.disabledBonds = []; h.m.bannedChess = []; h.m.pool = new SharedPool(h.m.gd);
  h.toPrep(1);
  const ps = h.ps('p_0');
  h.m.round = round; ps.bandId = band; ps.funds = 100; ps.offers = []; ps.commandDrafts = [];
  ps.recompute(); beginCommandPrep(ps);
  return { h, ps, view: () => commandView(ps), use: (target = {}) => ps.useCommand(ps.command.currentEffectId, target) };
};
const own = ps => [...ps.board.values(), ...ps.hand, ...ps.temp].filter(p => p?.kind === 'chess');
const normal = tier => Object.values(data.chess).find(c => !c.isGolden && !c.isDiy && c.tier === tier)?.chessId;
const grant = (ps, tier = 2) => ps.acquireChess(normal(tier), { silent: true });
const next = (ps, round) => { ps.m.round = round; ps.round = { refreshes: 0, buys: 0, sells: 0, spent: 0, gainedChess: 0, arts: 0 }; beginCommandPrep(ps); };
const commandRows = ps => Object.values(ps.gd.raw.bands || {}).flatMap(b => b.skills || []);
const hasEffectReplacement = s => (s.buffs || []).some(b => b.key === 'auto_chess_effect_replace');
const opensPrepSkillDraft = s => (s.buffs || []).some(b => b.key === 'gain_band_skill_from_pool_in_prep');
const bandPoolEffects = (ps, pool, bandId) => {
  const ids = new Set(ps.gd.band(bandId).skills.map(s => s.effectId));
  return pool.filter(s => ids.has(s.effectId)).map(s => s.effectId);
};

test('command protocol accepts only one bounded target shape and an explicit live effect id', () => {
  for (const target of [{}, { uid: 1 }, { slot: 0 }, { row: 9, col: 2 }]) assert.equal(validateC2S({ t: 'g.command', effectId: 'aceffect_band_80', target }), null);
  for (const target of [null, [], { uid: -1 }, { slot: 16 }, { row: 8, col: 2 }, { uid: 1, slot: 0 }, { row: 9, col: 2, x: 1 }]) assert.ok(validateC2S({ t: 'g.command', effectId: 'aceffect_band_80', target }));
});

test('locked row upgrades by round; fixed cooldown counts rounds and views are read-only', t => {
  const { ps, view, use } = setup(t, 'band_jenga');
  const p = grant(ps); ps.bonds = { [data.chess[p.id].bonds[0]]: { active: true, count: 3 } };
  assert.equal(view().reason, 'locked'); assert.ok(use({ uid: p.uid }).error);
  next(ps, 4); assert.equal(view().effectId, 'aceffect_band_89');
  ps.bonds = { [data.chess[p.id].bonds[0]]: { active: true, count: 3 } };
  assert.ok(use({ uid: p.uid }).ok); assert.equal(view().cooldown, 3);
  const snapshot = JSON.stringify(ps.command); view(); view(); assert.equal(JSON.stringify(ps.command), snapshot);
  next(ps, 6); assert.equal(view().cooldown, 1); next(ps, 7); assert.equal(view().cooldown, 0);
});

test('automatic next-row upgrades keep the same command instance records and quotas', t => {
  const { ps } = setup(t, 'band_takecare');
  const current = commandSkill(ps), nextId = current.next;
  assert.equal(current.effectId, 'aceffect_band_31');
  const nextState = ps.command.records[nextId];
  Object.assign(nextState, { currentCost: 7, used: 0, round: ps.m.round, readyRound: 4, totalUsed: 2, gainedRound: 1 });
  Object.assign(ps.command.records[current.effectId], { used: 1, round: ps.m.round });
  ps.round['command:promote'] = 1;

  ps.shop.level = 3;
  syncCommand(ps);
  assert.equal(commandSkill(ps).effectId, nextId);
  assert.equal(ps.command.records[nextId], nextState, 'automatic upgrades retain the pre-existing chain row record');
  assert.deepEqual(
    { currentCost: nextState.currentCost, used: nextState.used, readyRound: nextState.readyRound, totalUsed: nextState.totalUsed, gainedRound: nextState.gainedRound },
    { currentCost: 7, used: 1, readyRound: 4, totalUsed: 2, gainedRound: 1 },
  );
  assert.equal(ps.round['command:promote'], 1, 'the upgrade does not create a new command instance');
});

test('round uses refill once and tile-command upgrades do not refund uses', t => {
  const { ps, use, view } = setup(t, 'band_dance', 3);
  assert.ok(view().targets.length);
  assert.ok(use(view().targets[0]).ok); assert.equal(view().usesLeft, 0);
  beginCommandPrep(ps); assert.equal(view().usesLeft, 0);
  next(ps, 4); assert.equal(view().usesLeft, 2);
  assert.ok(use(view().targets[0]).ok); assert.equal(view().usesLeft, 1);
  next(ps, 8); assert.equal(view().usesLeft, 3); next(ps, 12); assert.equal(view().usesLeft, 4);
});

test('shop, cumulative spending and bond-count unlocks are monotonic', t => {
  const { ps } = setup(t, 'band_takecare');
  ps.shop.level = 3; syncCommand(ps); assert.equal(commandView(ps).effectId, 'aceffect_band_32');
  ps.shop.level = 5; syncCommand(ps); assert.equal(commandView(ps).effectId, 'aceffect_band_33');
  ps.bandId = 'band_rich'; ps.stats.gold = 59; syncCommand(ps); assert.equal(commandView(ps).type, 'NONE');
  ps.stats.gold = 60; syncCommand(ps); assert.equal(commandView(ps).effectId, 'aceffect_band_54');
  ps.stats.gold = 120; syncCommand(ps); assert.equal(commandView(ps).effectId, 'aceffect_band_55');
  ps.bandId = 'band_iberia'; ps.bonds.iberiaShip = { count: 4 }; syncCommand(ps); assert.equal(commandView(ps).type, 'ACTIVE');
  ps.bonds.iberiaShip.count = 0; syncCommand(ps); assert.equal(commandView(ps).type, 'ACTIVE');
});

test('gold cooldown uses the seeded integer and refuses extra uses without spending or RNG draws', t => {
  const { ps, view, use } = setup(t, 'band_fund');
  const funds = ps.funds; assert.ok(use().ok);
  const gain = ps.funds - funds; assert.ok(gain >= 1 && gain <= 6); assert.equal(view().cooldown, gain);
  const state = JSON.stringify(ps.command), rng = ps.m.rngMeta.state();
  assert.ok(use().error); assert.equal(ps.funds, funds + gain); assert.equal(JSON.stringify(ps.command), state); assert.deepEqual(ps.m.rngMeta.state(), rng);
});

test('target ownership, ready, stale ids, funds and special recruit refuse without consuming uses', t => {
  const { ps, view } = setup(t, 'band_evolve');
  const p = grant(ps); ps.funds = 0;
  assert.equal(ps.useCommand(view().effectId, { uid: p.uid }).error, 'NO_FUNDS');
  ps.funds = 5; assert.ok(ps.useCommand(view().effectId, { uid: 99999 }).error);
  assert.ok(ps.useCommand('stale', { uid: p.uid }).error);
  ps.ready = true; assert.ok(ps.useCommand(view().effectId, { uid: p.uid }).error); ps.ready = false;
  assert.equal(view().usesLeft, 1);
  ps.bandId = 'band_transfer'; syncCommand(ps); ps.offers.push({ slots: [] });
  assert.equal(commandView(ps).reason, 'specialRecruit');
  assert.ok(ps.useCommand(commandView(ps).effectId, { slot: 0 }).error);
});

test('ALL_LIMIT persists across rounds but a newly picked command instance replenishes it', t => {
  const { ps, use, view } = setup(t, 'band_upgrade');
  const p = grant(ps); assert.ok(use({ uid: p.uid }).ok); assert.equal(ps.gd.isGolden(p.id), true);
  next(ps, 2); assert.equal(view().usesLeft, 0);
  assert.ok(openSkillChangeDraft(ps, 'skill_change_1')); assert.ok(openSkillChangeDraft(ps, 'skill_change_2'));
  assert.equal(ps.commandDrafts[0].cards.length, 3); assert.equal(ps.commandDrafts[1].cards.length, 2);
  assert.equal(ps.privateView().commandDraft.cards.length, 3); assert.equal(ps.privateView().canReady, false);
  const draft = ps.commandDrafts[0]; assert.ok(ps.pickCommand('stale', 0).error); assert.ok(ps.pickCommand(draft.id, 0).ok);
  ps.commandDrafts[0].cards[0] = 'aceffect_band_99'; assert.ok(ps.pickCommand(ps.commandDrafts[0].id, 0).ok);
  assert.equal(view().usesLeft, 1); assert.equal(ps.command.records.aceffect_band_99.totalUsed, 0);
  assert.equal(openSkillChangeDraft(ps, 'bad'), false);
});

test('command drafts offer current active and passive rows but exclude replacement effects, and keep bond overrides on the strategy', t => {
  const { ps } = setup(t, 'band_support');
  const rows = commandRows(ps), rowById = new Map(rows.map(s => [s.effectId, s]));
  const excluded = rows.filter(s => hasEffectReplacement(s) || opensPrepSkillDraft(s));
  const locked = ps.gd.band('band_iberia').skills[0];
  const upgraded = ps.gd.band('band_iberia').skills[1];
  const follower = ps.gd.band('band_random').skills[0];
  assert.equal(locked.type, 'NONE');
  assert.equal(upgraded.type, 'ACTIVE');
  assert.equal(follower.type, 'PASSIVE');
  assert.equal(opensPrepSkillDraft(follower), true);
  assert.ok(excluded.length >= 7);
  assert.deepEqual(commandBondOverrides(ps), {});
  assert.deepEqual(commandBattleInput(ps, []).bondEffectOverrides, {});

  const assertSharedPool = pool => {
    assert.ok(pool.some(s => s.type === 'ACTIVE'));
    assert.ok(pool.some(s => s.type === 'PASSIVE'));
    assert.ok(pool.every(s => ['ACTIVE', 'PASSIVE'].includes(s.type)));
    assert.ok(pool.every(s => s.effectId !== ps.command.currentEffectId));
    assert.ok(pool.every(s => !hasEffectReplacement(s)));
    assert.ok(pool.every(s => !opensPrepSkillDraft(s)));
    assert.ok(excluded.every(s => !pool.some(candidate => candidate.effectId === s.effectId)));
    assert.ok(!pool.some(s => s.effectId === follower.effectId), 'strategy-only prep drafts stay out of the swap pool');
    assert.ok(!pool.some(s => s.effectId === upgraded.effectId), 'a later row stays out until the player meets its bond unlock');
    assert.ok(!pool.some(s => s.effectId === locked.effectId), 'NONE rows stay unavailable');
  };
  const prioritize = effectId => ({ shuffle(pool) {
    assertSharedPool(pool);
    const first = pool.find(s => s.effectId === effectId);
    assert.ok(first, `${effectId} is in the shared candidate pool`);
    return [first, ...pool.filter(s => s !== first)];
  } });

  const passive = ps.gd.band('band_amiya').skills[0];
  assert.equal(passive.type, 'PASSIVE');
  assert.ok(openSkillChangeDraft(ps, 'skill_change_1', { rng: prioritize(passive.effectId) }));
  const itemDraft = ps.commandDrafts[0];
  assert.equal(itemDraft.choiceId, 'skill_change_1');
  assert.equal(itemDraft.cards.length, 3);
  assert.equal(rowById.get(itemDraft.cards[0]).type, 'PASSIVE');
  assert.ok(ps.pickCommand(itemDraft.id, 0).ok);
  assert.equal(commandSkill(ps).effectId, passive.effectId);
  assert.deepEqual(commandBattleInput(ps, []).bondEffectOverrides, {});

  const active = ps.gd.band('band_price').skills[0];
  assert.equal(active.type, 'ACTIVE');
  assert.ok(openSkillChangeDraft(ps, 'skill_change_2', { rng: prioritize(active.effectId) }));
  const prepDraft = ps.commandDrafts[0];
  assert.equal(prepDraft.choiceId, 'skill_change_2');
  assert.equal(prepDraft.cards.length, 2);
  assert.equal(rowById.get(prepDraft.cards[0]).type, 'ACTIVE');
  assert.ok(ps.pickCommand(prepDraft.id, 0).ok);
  assert.equal(commandSkill(ps).effectId, active.effectId);
  assert.deepEqual(commandBattleInput(ps, []).bondEffectOverrides, {});
});

test('the command pool resolves one current row per strategy from round, shop, funds and bond state', t => {
  const { ps } = setup(t, 'band_support');
  const pool = () => commandCandidatePool(ps, null);
  const expectBand = (bandId, effectId) => assert.deepEqual(bandPoolEffects(ps, pool(), bandId), effectId ? [effectId] : [], bandId);

  ps.m.round = 3;
  expectBand('band_jenga', null); // its fixed-unlock row is NONE until R4
  expectBand('band_mess', null);
  expectBand('band_protect', null);
  ps.m.round = 4;
  expectBand('band_jenga', 'aceffect_band_89');
  expectBand('band_mess', 'aceffect_band_112');
  expectBand('band_protect', 'aceffect_band_94');
  for (const [round, effectId] of [[1, 'aceffect_band_107'], [5, 'aceffect_band_108'], [9, 'aceffect_band_109'], [13, 'aceffect_band_110']]) {
    ps.m.round = round;
    expectBand('band_dance', effectId);
  }

  for (const [level, effectId] of [[1, 'aceffect_band_31'], [3, 'aceffect_band_32'], [5, 'aceffect_band_33']]) {
    ps.shop.level = level;
    expectBand('band_takecare', effectId);
  }
  for (const [gold, effectId] of [[59, null], [60, 'aceffect_band_54'], [120, 'aceffect_band_55']]) {
    ps.stats.gold = gold;
    expectBand('band_rich', effectId);
  }
  ps.bonds = { iberiaShip: { count: 3 } };
  expectBand('band_iberia', null);
  ps.bonds.iberiaShip.count = 4;
  expectBand('band_iberia', 'aceffect_band_85');

  ps.shop.level = 3;
  expectBand('band_egir', null);
  ps.shop.level = 4;
  const egir = ps.gd.band('band_egir');
  const byId = new Map(commandRows(ps).map(s => [s.effectId, s]));
  assert.equal(commandSkillAtPlayerLevel(ps, egir, byId).effectId, 'aceffect_band_68', 'the shop-level threshold resolves Gladia’s active row');
  assert.ok(hasEffectReplacement(commandSkillAtPlayerLevel(ps, egir, byId)));
  expectBand('band_egir', null); // its replacement buff excludes it before and after unlock

  const before = JSON.stringify({ round: ps.m.round, level: ps.shop.level, gold: ps.stats.gold, bonds: ps.bonds, command: ps.command });
  commandCandidatePool(ps, null);
  assert.equal(JSON.stringify({ round: ps.m.round, level: ps.shop.level, gold: ps.stats.gold, bonds: ps.bonds, command: ps.command }), before,
    'candidate resolution reads player state without mutating it');
});

test('expired fixed-round passives leave the replacement pool while periodic and mixed effects remain', t => {
  const { ps } = setup(t, 'band_support');
  const available = bandId => bandPoolEffects(ps, commandCandidatePool(ps, null), bandId).length > 0;
  const at = (round, bandId, expected) => {
    ps.m.round = round;
    assert.equal(available(bandId), expected, `${bandId} at R${round}`);
  };

  at(1, 'band_mech', false);
  at(1, 'band_pith', false);
  at(2, 'band_lmlee', true);
  at(3, 'band_lmlee', false);
  at(3, 'band_jesica', true);
  at(13, 'band_jesica', false);
  at(13, 'band_smith', true);
  at(14, 'band_smith', false);
  at(13, 'band_fang', true);
  at(14, 'band_fang', false);

  at(14, 'band_harold', true);
  at(11, 'band_damaztic', true);
  at(12, 'band_damaztic', false);
  const yela = ps.gd.band('band_kjerag2');
  assert.equal(commandHasFutureEffects(ps, yela, yela.skills[0]), true, 'the bond replacement is not discarded with its expired gifts');
  assert.equal(available('band_kjerag2'), false, 'the separate replacement-effect exclusion still applies');
  const sarkaz = ps.gd.band('band_sarkazb');
  assert.equal(sarkaz.totalHp, 40);
  assert.equal(commandHasFutureEffects(ps, sarkaz, sarkaz.skills[0]), false, 'Golia has no future passive buff after its starting HP is set');
  assert.equal(available('band_sarkazb'), false);
});

test('Duck Lord is excluded only while a living teammate holds its live command', t => {
  const { ps, h } = setup(t, 'band_support');
  const teammate = h.ps('p_1');
  teammate.bandId = 'band_ducklord';
  syncCommand(teammate);
  const hasDuck = player => commandCandidatePool(player, null).some(s => s.effectId === 'aceffect_band_16');
  const pick = (player, effectId) => {
    assert.ok(openSkillChangeDraft(player, 'skill_change_1', { rng: { shuffle(pool) {
      const first = pool.find(s => s.effectId === effectId);
      assert.ok(first, `${effectId} is in the current player pool`);
      return [first, ...pool.filter(s => s !== first)];
    } } }));
    const draft = player.commandDrafts[0];
    assert.equal(draft.cards[0], effectId);
    assert.ok(player.pickCommand(draft.id, 0).ok);
  };

  assert.equal(teammate.command.currentEffectId, 'aceffect_band_16');
  assert.equal(hasDuck(ps), false, 'a live teammate currently owns the team-unique effect');
  assert.ok(commandCandidatePool(ps, null).some(s => s.effectId === 'aceffect_band_22'), 'personal passive commands remain available');

  pick(teammate, 'aceffect_band_22');
  assert.equal(teammate.bandId, 'band_ducklord', 'the original strategy identity remains unchanged');
  assert.equal(hasDuck(ps), true, 'swapping out restores the candidate despite the old strategy id');
  pick(teammate, 'aceffect_band_16');
  assert.equal(hasDuck(ps), false, 'reacquiring the team-unique effect excludes the other player again');
});

test('damaztic grants use acquisition-relative five-round cycles from R3 through R12', t => {
  const { ps } = setup(t, 'band_support');
  const gainedItems = [];
  const acquireItem = ps.acquireItem.bind(ps);
  ps.acquireItem = (id, ...args) => { gainedItems.push(id); return acquireItem(id, ...args); };
  const itemId = ps.gd.band('band_damaztic').skills[0].buffs[0].bbStr.chess;
  const pick = effectId => {
    assert.ok(openSkillChangeDraft(ps, 'skill_change_1', { rng: { shuffle(pool) {
      const first = pool.find(s => s.effectId === effectId);
      assert.ok(first, `${effectId} is available for selection`);
      return [first, ...pool.filter(s => s !== first)];
    } } }));
    const draft = ps.commandDrafts[0];
    assert.equal(draft.cards[0], effectId);
    assert.ok(ps.pickCommand(draft.id, 0).ok);
  };

  next(ps, 3);
  pick('aceffect_band_13');
  assert.equal(ps.command.records.aceffect_band_13.gainedRound, 3);
  next(ps, 4); ps.m.dispatch(ps, 'onPrepStart', { round: 4 });
  assert.deepEqual(gainedItems, []);
  next(ps, 7); ps.m.dispatch(ps, 'onPrepStart', { round: 7 });
  assert.deepEqual(gainedItems, [itemId], 'R3 acquisition counts as cycle round 1, so the first gift is at R7');
  next(ps, 12); ps.m.dispatch(ps, 'onPrepStart', { round: 12 });
  assert.deepEqual(gainedItems, [itemId, itemId], 'the next gift is five rounds later at R12');
});

test('damaztic stops while swapped out and reacquisition creates a fresh R11 cycle', t => {
  const { ps } = setup(t, 'band_support', 3);
  const gainedItems = [];
  const acquireItem = ps.acquireItem.bind(ps);
  ps.acquireItem = (id, ...args) => { gainedItems.push(id); return acquireItem(id, ...args); };
  const itemId = ps.gd.band('band_damaztic').skills[0].buffs[0].bbStr.chess;
  const pick = effectId => {
    assert.ok(openSkillChangeDraft(ps, 'skill_change_1', { rng: { shuffle(pool) {
      const first = pool.find(s => s.effectId === effectId);
      assert.ok(first, `${effectId} is available for selection`);
      return [first, ...pool.filter(s => s !== first)];
    } } }));
    const draft = ps.commandDrafts[0];
    assert.equal(draft.cards[0], effectId);
    assert.ok(ps.pickCommand(draft.id, 0).ok);
  };

  pick('aceffect_band_13');
  assert.equal(ps.command.records.aceffect_band_13.gainedRound, 3);
  next(ps, 7); ps.m.dispatch(ps, 'onPrepStart', { round: 7 });
  assert.deepEqual(gainedItems, [itemId]);
  next(ps, 8);
  pick('aceffect_band_22');
  const state = ps.command.records.aceffect_band_13;
  next(ps, 10); ps.m.dispatch(ps, 'onPrepStart', { round: 10 });
  assert.deepEqual(gainedItems, [itemId], 'swapping away stops the old schedule');
  next(ps, 11);
  Object.assign(state, { currentCost: 9, used: 1, round: 11, readyRound: 14, totalUsed: 2 });
  pick('aceffect_band_13');
  const renewed = ps.command.records.aceffect_band_13;
  assert.notEqual(renewed, state, 'reacquisition replaces the previous record object');
  assert.equal(renewed.gainedRound, 11, 'reacquiring the same effect starts a new schedule');
  assert.deepEqual(
    { currentCost: renewed.currentCost, used: renewed.used, round: renewed.round, readyRound: renewed.readyRound, totalUsed: renewed.totalUsed },
    { currentCost: ps.gd.band('band_damaztic').skills[0].cost, used: 0, round: 11, readyRound: 0, totalUsed: 0 },
    'reacquisition resets per-instance cost, uses, cooldown and match stock',
  );
  next(ps, 12); ps.m.dispatch(ps, 'onPrepStart', { round: 12 });
  assert.deepEqual(gainedItems, [itemId], 'the old R12 grant is missed while the command is swapped out');
  next(ps, 14); ps.m.dispatch(ps, 'onPrepStart', { round: 14 });
  assert.deepEqual(gainedItems, [itemId]);
  next(ps, 15); ps.m.dispatch(ps, 'onPrepStart', { round: 15 });
  assert.deepEqual(gainedItems, [itemId, itemId], 'the reacquired R11 cycle reaches its fifth round at R15');
});

test('a command acquired during the opening strategy pick anchors its first round at R1', t => {
  const { ps } = setup(t, 'band_support');
  const gainedItems = [];
  const acquireItem = ps.acquireItem.bind(ps);
  ps.acquireItem = (id, ...args) => { gainedItems.push(id); return acquireItem(id, ...args); };
  ps.m.round = 0;
  ps.bandId = 'band_damaztic';
  syncCommand(ps);
  assert.equal(ps.command.records.aceffect_band_13.gainedRound, 1);
  next(ps, 4); ps.m.dispatch(ps, 'onPrepStart', { round: 4 });
  assert.deepEqual(gainedItems, []);
  next(ps, 5); ps.m.dispatch(ps, 'onPrepStart', { round: 5 });
  assert.equal(gainedItems.length, 1, 'R1 counts as the first of five rounds, so the first grant is R5');
});

test('骰子 replacement and 追随者 prep drafts use the same current pool', t => {
  const { ps } = setup(t, 'band_random');
  const current = commandSkill(ps);
  assert.equal(current.type, 'PASSIVE');
  assert.ok(opensPrepSkillDraft(current));
  const expected = commandCandidatePool(ps).map(s => s.effectId);
  assert.ok(!expected.includes(current.effectId));
  const captured = [];
  for (const choiceId of ['skill_change_1', 'skill_change_2']) {
    assert.ok(openSkillChangeDraft(ps, choiceId, { rng: { shuffle(pool) { captured.push(pool.map(s => s.effectId)); return pool; } } }));
  }
  assert.deepEqual(captured, [expected, expected]);
  assert.deepEqual(ps.commandDrafts.map(d => d.cards.length), [3, 2]);
});

test('R13 妮芙 starts fresh after reacquisition while the old instance tile mark remains unavailable', t => {
  const { ps } = setup(t, 'band_dance', 13);
  const danceIds = new Set(ps.gd.band('band_dance').skills.map(s => s.effectId));
  assert.equal(commandSkill(ps).effectId, 'aceffect_band_110');
  const oldTiles = [];
  for (let i = 0; i < 4; i++) {
    const tile = commandView(ps).targets[0];
    assert.ok(tile, `use ${i + 1} has a legal tile target`);
    assert.ok(!oldTiles.some(old => old.row === tile.row && old.col === tile.col), 'each use selects a different legal tile');
    assert.ok(ps.useCommand('aceffect_band_110', tile).ok);
    oldTiles.push({ ...tile });
    assert.equal(commandView(ps).usesLeft, 3 - i);
  }
  assert.equal(commandView(ps).usesLeft, 0, 'the original A instance uses its four real charges');
  assert.ok(oldTiles.every(tile => ps.commandMarks.some(mark => mark.row === tile.row && mark.col === tile.col)));
  assert.deepEqual(commandCandidatePool(ps).filter(s => danceIds.has(s.effectId)), [], 'the current 110 row is excluded and lower rows are not candidates');

  const choose = effectId => {
    assert.ok(openSkillChangeDraft(ps, 'skill_change_1', { rng: { shuffle(pool) {
      const first = pool.find(s => s.effectId === effectId);
      assert.ok(first, `${effectId} must be in the current-level pool`);
      return [first, ...pool.filter(s => s !== first)];
    } } }));
    const draft = ps.commandDrafts[0];
    assert.equal(draft.cards[0], effectId);
    assert.ok(ps.pickCommand(draft.id, 0).ok);
  };

  choose('aceffect_band_22');
  assert.equal(ps.bandId, 'band_dance');
  assert.deepEqual(bandPoolEffects(ps, commandCandidatePool(ps), 'band_dance'), ['aceffect_band_110']);
  ps.pendingFunds = 7;
  ps.commandDiscounts = [{ remaining: 2, amount: 1 }];
  choose('aceffect_band_110');
  assert.equal(commandSkill(ps).effectId, 'aceffect_band_110');
  assert.equal(commandView(ps).usesLeft, 4);
  assert.equal(ps.command.records.aceffect_band_110.totalUsed, 0);
  assert.equal(ps.pendingFunds, 7);
  assert.deepEqual(ps.commandDiscounts, [{ remaining: 2, amount: 1 }]);
  assert.ok(oldTiles.every(tile => ps.commandMarks.some(mark => mark.row === tile.row && mark.col === tile.col)), 'previously produced marks persist');
  const battleMarks = commandBattleInput(ps, []).commandMarks;
  assert.deepEqual(battleMarks.map(({ row, col }) => [row, col]), oldTiles.map(({ row, col }) => [row, col]), 'battle input carries every old mark');

  for (const tile of oldTiles) {
    const funds = ps.funds, uses = commandView(ps).usesLeft, marks = ps.commandMarks.length;
    assert.equal(ps.useCommand('aceffect_band_110', tile).error, 'BAD_TARGET', 'an old marked tile is refused');
    assert.equal(ps.funds, funds, 'a refused old tile does not charge funds');
    assert.equal(commandView(ps).usesLeft, uses, 'a refused old tile does not spend a fresh-instance use');
    assert.equal(ps.commandMarks.length, marks, 'a refused old tile adds no mark');
  }

  const newTile = commandView(ps).targets[0];
  assert.ok(newTile && !oldTiles.some(tile => tile.row === newTile.row && tile.col === newTile.col));
  assert.ok(ps.useCommand('aceffect_band_110', newTile).ok, 'a new unmarked tile remains usable');
  assert.equal(commandView(ps).usesLeft, 3, 'a valid use decrements the fresh instance from four to three');
  assert.ok(oldTiles.every(tile => !commandView(ps).targets.some(target => target.row === tile.row && target.col === tile.col)));

  next(ps, 14);
  assert.ok(oldTiles.every(tile => !ps.commandMarks.some(mark => mark.row === tile.row && mark.col === tile.col)), 'non-persistent old marks expire next round');
});

test('v3_1 raw stages: Nymph PASSABLE excludes red/blue gates and still accepts ordinary ground on all deploy fields', t => {
  const fields = ['normal', 'bossL', 'bossR'];
  const rows = [[1, 'aceffect_band_107'], [5, 'aceffect_band_108'], [9, 'aceffect_band_109'], [13, 'aceffect_band_110']];
  const coverage = {
    layouts: 0, successfulGroundUses: 0, floorTargets: 0,
    tile_startCells: 0, tile_startLayouts: 0,
    tile_endCells: 0, tile_endLayouts: 0,
    highCells: 0, highLayouts: 0,
    fenceCells: 0, fenceLayouts: 0,
    floorCells: 0, floorLayouts: 0,
  };
  assert.equal(Object.keys(data.stages).length, 12, 'the test reads all twelve real v3_1 stages');

  for (const [stageId, stage] of Object.entries(data.stages)) for (const field of fields) {
    const { h, ps } = setup(t, 'band_dance', 1);
    const teammate = h.ps('p_1');
    h.m.stageId = stageId;
    h.m.bossWaves = field === 'normal' ? null : [{ players: field === 'bossL'
      ? [ps.playerId, teammate.playerId] : [teammate.playerId, ps.playerId], wave: {} }];
    assert.equal(h.m.deployFieldOf(ps), field, `${stageId} uses the real ${field} deploy-field mapping`);

    const byType = { tile_start: [], tile_end: [], high: [], fence: [], floor: [], ground: [] };
    for (let row = 9; row <= 12; row++) for (let col = 2; col <= 10; col++) {
      const [stageRow, stageCol] = fieldTile(field, row, col);
      const glyph = stage.rows?.[stageRow]?.[stageCol];
      const tile = glyph == null ? null : stage.tiles?.[glyph];
      if (!tile) continue;
      const cell = { row, col, tile };
      if (tile.tileKey === 'tile_start') byType.tile_start.push(cell);
      if (tile.tileKey === 'tile_end') byType.tile_end.push(cell);
      if (tile.height === 'HIGH') byType.high.push(cell);
      if (tile.tileKey === 'tile_fence_bound') byType.fence.push(cell);
      if (tile.tileKey === 'tile_floor' && tile.height === 'LOW' && tile.passable === 'ALL') byType.floor.push(cell);
      if (tile.height === 'LOW' && tile.passable === 'ALL' && !['tile_start', 'tile_end', 'tile_fence_bound'].includes(tile.tileKey)) byType.ground.push(cell);
    }
    coverage.layouts++;
    for (const [type, cellKey, layoutKey] of [
      ['tile_start', 'tile_startCells', 'tile_startLayouts'], ['tile_end', 'tile_endCells', 'tile_endLayouts'],
      ['high', 'highCells', 'highLayouts'], ['fence', 'fenceCells', 'fenceLayouts'], ['floor', 'floorCells', 'floorLayouts'],
    ]) {
      coverage[cellKey] += byType[type].length;
      if (byType[type].length) coverage[layoutKey]++;
    }

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      const [round, effectId] = rows[rowIndex];
      if (rowIndex) next(ps, round);
      const view = commandView(ps);
      assert.equal(view.effectId, effectId, `${stageId}/${field} R${round} uses Nymph ${effectId}`);
      assert.equal(view.targetFilterType, 'PASSABLE');
      assert.equal(view.reason, null, 'the command still has an available use before forged-target checks');
      const targetKeys = new Set(view.targets.map(target => `${target.row},${target.col}`));
      for (const cell of [...byType.tile_start, ...byType.tile_end]) {
        assert.equal(cell.tile.height, 'LOW', 'red/blue gate cells are LOW');
        assert.equal(cell.tile.passable, 'ALL', 'red/blue gate cells pass the existing passable check');
        assert.ok(!targetKeys.has(`${cell.row},${cell.col}`), `${stageId}/${field} excludes ${cell.tile.tileKey} at ${cell.row},${cell.col}`);
        const funds = ps.funds, uses = view.usesLeft, markCount = ps.commandMarks.length;
        assert.equal(ps.useCommand(effectId, { row: cell.row, col: cell.col }).error, 'BAD_TARGET', 'a forged gate target is refused');
        assert.equal(ps.funds, funds, 'a refused gate does not spend funds');
        assert.equal(commandView(ps).usesLeft, uses, 'a refused gate does not consume a command use');
        assert.equal(ps.commandMarks.length, markCount, 'a refused gate creates no tile mark');
      }
      for (const cell of [...byType.high, ...byType.fence]) {
        assert.ok(['FLY_ONLY', 'NONE'].includes(cell.tile.passable), 'HIGH/fence cells remain excluded by the existing passable check');
        assert.ok(!targetKeys.has(`${cell.row},${cell.col}`), `${stageId}/${field} leaves HIGH/fence excluded by the existing passable rule`);
      }

      const floorTarget = byType.floor.find(cell => targetKeys.has(`${cell.row},${cell.col}`));
      if (byType.floor.length) {
        assert.ok(floorTarget, `${stageId}/${field} keeps an ordinary tile_floor target`);
        coverage.floorTargets++;
      }
      const ground = floorTarget || byType.ground.find(cell => targetKeys.has(`${cell.row},${cell.col}`));
      if (ground) {
        assert.ok(view.targets.some(target => target.row === ground.row && target.col === ground.col));
        assert.ok(ps.useCommand(effectId, { row: ground.row, col: ground.col }).ok, `${stageId}/${field} accepts a legal ground tile at R${round}`);
        coverage.successfulGroundUses++;
      }
    }
  }

  assert.equal(coverage.layouts, 36, 'all twelve maps are checked on normal, bossL and bossR');
  assert.ok(coverage.tile_startCells && coverage.tile_endCells && coverage.highCells && coverage.fenceCells && coverage.floorCells);
  assert.equal(coverage.floorTargets, coverage.floorLayouts * rows.length, 'every tier keeps tile_floor targetable in each map-field layout that contains it');
  assert.ok(coverage.successfulGroundUses > 0, 'real PlayerState commands accept ordinary ground tiles');
  t.diagnostic(`raw data/versions/act3autochess-v3_1/stages.json coverage: ${coverage.layouts} map-field layouts; `
    + `tile_start ${coverage.tile_startCells} cells/${coverage.tile_startLayouts} layouts; `
    + `tile_end ${coverage.tile_endCells} cells/${coverage.tile_endLayouts} layouts; `
    + `HIGH ${coverage.highCells} cells/${coverage.highLayouts} layouts; `
    + `tile_fence_bound ${coverage.fenceCells} cells/${coverage.fenceLayouts} layouts; `
    + `tile_floor ${coverage.floorCells} cells/${coverage.floorLayouts} layouts; `
    + `${coverage.successfulGroundUses} legal ground uses`);
});

test('fresh command instances reset only quota counters and preserve earned credits, refresh facts and queued effects', t => {
  const { ps } = setup(t, 'band_support');
  const choose = effectId => {
    assert.ok(openSkillChangeDraft(ps, 'skill_change_1', { rng: { shuffle(pool) {
      const first = pool.find(s => s.effectId === effectId);
      assert.ok(first, `${effectId} is available`);
      return [first, ...pool.filter(s => s !== first)];
    } } }));
    const draft = ps.commandDrafts[0];
    assert.equal(draft.cards[0], effectId);
    assert.ok(ps.pickCommand(draft.id, 0).ok);
  };

  const mlynar = ps.gd.band('band_mlynar').skills[0].effectId;
  choose(mlynar);
  ps.counters['band:mlynar'] = 2; ps.counters['band:mlynar:r'] = ps.m.round;
  ps.counters['band:chiave'] = 1; ps.counters['band:chiave:r'] = ps.m.round;
  ps.counters['band:chiave:refreshes'] = 9;
  ps.counters['band:pepe:special'] = 1;
  ps.counters['command:discount:2'] = 3; ps.counters[`command:buy:${mlynar}`] = 2;
  ps.round['command:promote'] = 1; ps.round['command:equip'] = 1; ps.round['command:swap'] = 1;
  ps.pendingFunds = 5;
  ps.commandDiscounts = [{ remaining: 1, amount: 1 }];
  ps.offers.push({ slots: [{ kind: 'chess', id: normal(2) }] });
  const offers = structuredClone(ps.offers);

  choose('aceffect_band_22');
  choose(mlynar);
  assert.equal(ps.counters['band:mlynar'], undefined);
  assert.equal(ps.counters['band:mlynar:r'], undefined);
  assert.equal(ps.counters['band:chiave'], undefined);
  assert.equal(ps.counters['band:chiave:r'], undefined);
  assert.equal(ps.counters['command:discount:2'], undefined);
  assert.equal(ps.counters[`command:buy:${mlynar}`], undefined);
  for (const key of ['command:promote', 'command:equip', 'command:swap']) assert.equal(ps.round[key], undefined, key);
  assert.equal(ps.counters['band:chiave:refreshes'], 9, 'manual-refresh history remains factual');
  assert.equal(ps.counters['band:pepe:special'], 1, 'an already-earned refresh credit remains pending');
  assert.equal(ps.pendingFunds, 5);
  assert.deepEqual(ps.commandDiscounts, [{ remaining: 1, amount: 1 }]);
  assert.deepEqual(ps.offers, offers);
  assert.equal(ps.round.refreshes, 0, 'command quota reset does not clear per-round refresh facts');
});

test('reacquiring Mlynar starts a new live buy quota without losing its already queued funds', t => {
  const { ps } = setup(t, 'band_support');
  const choose = effectId => {
    assert.ok(openSkillChangeDraft(ps, 'skill_change_1', { rng: { shuffle(pool) {
      const first = pool.find(s => s.effectId === effectId);
      assert.ok(first, `${effectId} is available`);
      return [first, ...pool.filter(s => s !== first)];
    } } }));
    const draft = ps.commandDrafts[0];
    assert.equal(draft.cards[0], effectId);
    assert.ok(ps.pickCommand(draft.id, 0).ok);
  };
  const mlynarBand = ps.gd.band('band_mlynar');
  const mlynar = mlynarBand.skills[0];
  const buff = mlynar.buffs.find(row => row.key === 'buy_bond_char_gain_coin');
  const bond = buff.bbStr.bond;
  const chessId = Object.values(data.chess).find(chess => !chess.isGolden && chess.bonds.includes(bond)).chessId;
  const before = ps.pendingFunds;

  choose(mlynar.effectId);
  for (let i = 0; i < 5; i++) ps.m.dispatch(ps, 'onBuy', { kind: 'chess', slot: { id: chessId } });
  assert.equal(ps.pendingFunds, before + 3, 'the original instance reaches its three-fund per-round limit');
  assert.equal(ps.counters['band:mlynar'], 3);

  ps.counters['band:chiave:refreshes'] = 9;
  ps.round.refreshes = 2;
  choose('aceffect_band_22');
  choose(mlynar.effectId);
  assert.equal(ps.pendingFunds, before + 3, 'funds already granted by the first instance remain queued');
  assert.equal(ps.counters['band:mlynar'], undefined, 'the new instance begins with an empty buy quota');
  ps.m.dispatch(ps, 'onBuy', { kind: 'chess', slot: { id: chessId } });
  assert.equal(ps.pendingFunds, before + 4, 'the new instance can grant its first per-round fund');
  assert.equal(ps.counters['band:mlynar'], 1);
  assert.equal(ps.counters['band:chiave:refreshes'], 9, 'refresh history remains factual');
  assert.equal(ps.round.refreshes, 2, 'resetting command quotas does not erase refresh events');
});

test('the seven strategy bond replacements survive command swaps without leaking to the replacement', t => {
  const expected = {
    band_yan2: { bondeffect_yan_2: 'bondeffect_yan' },
    band_sargon: { bondeffect_sargon_2: 'bondeffect_sargon' },
    band_victoria: { bondeffect_victoria: 'bondeffect_victoria_2' },
    band_egir: { bondeffect_egir: 'bondeffect_egir_2' },
    band_kazimier: { bondeffect_kazimierz_2: 'bondeffect_kazimierz' },
    band_kjerag2: { bondeffect_kjerag_2: 'bondeffect_kjerag' },
    band_siracusa: { bondeffect_siracusa_2: 'bondeffect_siracusa' },
  };
  for (const [bandId, overrides] of Object.entries(expected)) {
    const { ps } = setup(t, bandId);
    const original = ps.command.currentEffectId;
    assert.deepEqual(commandBondOverrides(ps), overrides, bandId);
    assert.deepEqual(commandBattleInput(ps, []).bondEffectOverrides, overrides, bandId);
    assert.ok(openSkillChangeDraft(ps, 'skill_change_1', { rng: { shuffle: pool => pool } }), bandId);
    const draft = ps.commandDrafts[0];
    const replacement = draft.cards[0];
    const row = commandRows(ps).find(s => s.effectId === replacement);
    assert.notEqual(replacement, original, bandId);
    assert.ok(['ACTIVE', 'PASSIVE'].includes(row.type), bandId);
    assert.equal(hasEffectReplacement(row), false, bandId);
    assert.ok(ps.pickCommand(draft.id, 0).ok, bandId);
    assert.equal(commandSkill(ps).effectId, replacement, bandId);
    assert.equal(ps.bandId, bandId);
    assert.deepEqual(commandBattleInput(ps, []).bondEffectOverrides, overrides, bandId);
  }
});

test('Siracusa first-refresh income follows the live command while its bond replacement stays on the strategy', t => {
  const { ps } = setup(t, 'band_siracusa');
  const rebate = commandSkill(ps).buffs.find(b => b.key === 'n_round_refresh_cnt_gain_coin');
  assert.ok(rebate);
  const before = ps.funds;
  ps.round.refreshes = 1;
  ps.m.dispatch(ps, 'onRefresh', {});
  assert.equal(ps.funds, before + rebate.bb.coin);

  const replacement = ps.gd.band('band_price').skills[0];
  assert.ok(openSkillChangeDraft(ps, 'skill_change_1', { rng: { shuffle: pool => {
    const first = pool.find(s => s.effectId === replacement.effectId);
    assert.ok(first);
    return [first, ...pool.filter(s => s !== first)];
  } } }));
  const draft = ps.commandDrafts[0];
  assert.equal(draft.cards[0], replacement.effectId);
  assert.ok(ps.pickCommand(draft.id, 0).ok);
  assert.equal(commandSkill(ps).effectId, replacement.effectId);
  assert.deepEqual(commandBattleInput(ps, []).bondEffectOverrides, { bondeffect_siracusa_2: 'bondeffect_siracusa' });

  const afterSwap = ps.funds;
  ps.round.refreshes = 1;
  ps.m.dispatch(ps, 'onRefresh', {});
  assert.equal(ps.funds, afterSwap);
});

test('cost decay, reset, permanent growth and bond purchase discount follow their blackboards', t => {
  const { ps, use, view } = setup(t, 'band_kazimier');
  ps.m.dispatch(ps, 'onPrepEnd', {}); assert.equal(view().currentCost, 4);
  ps.shop.level = 6; assert.ok(use().ok); assert.equal(view().currentCost, 6);
  ps.bandId = 'band_lethania'; syncCommand(ps); assert.ok(use().ok); assert.equal(view().currentCost, 2);
  next(ps, 2); assert.equal(view().currentCost, 2);
  ps.bandId = 'band_ursus'; syncCommand(ps);
  const id = Object.values(data.chess).find(c => !c.isGolden && c.bonds.includes('ursusShip')).chessId;
  ps.m.dispatch(ps, 'onBuy', { kind: 'chess', slot: { id } }); assert.equal(view().currentCost, 4);
  assert.ok(use().ok); assert.equal(view().currentCost, 5);
});

test('click commands take shop operators, refresh higher tiers and change only the equipment offer', t => {
  const { ps, use, view } = setup(t, 'band_support');
  ps.shop.level = 2; assert.ok(use().ok); assert.ok(ps.shop.slots.some(s => s?.kind === 'chess' && ps.gd.tierOf(s.id) === 3));
  assert.equal(view().usesLeft, 2);
  ps.bandId = 'band_equipment'; syncCommand(ps);
  const chars = ps.shop.slots.filter(s => s?.kind === 'chess').map(s => s.id);
  assert.ok(use().ok); assert.deepEqual(ps.shop.slots.filter(s => s?.kind === 'chess').map(s => s.id), chars);
  ps.bandId = 'band_closeout'; syncCommand(ps); const n = own(ps).length;
  assert.ok(use().ok); assert.ok(own(ps).length > n); assert.ok(ps.shop.slots.every(s => s?.kind !== 'chess'));
});

test('equipment discount is applied once to the next item buy and survives command replacement', t => {
  const { ps, use } = setup(t, 'band_price');
  const i = ps.shop.slots.findIndex(s => s?.kind === 'item'); const price = ps.priceOf(ps.shop.slots[i]);
  assert.ok(use().ok); assert.equal(ps.priceOf(ps.shop.slots[i]), Math.max(0, price - 1));
  assert.ok(ps.buy(i).ok); assert.equal(ps.commandDiscounts[0].remaining, 0);
});

test('owned and shop transforms obey tier/bond constraints, while marks affect only the selected uid', t => {
  const { ps, use } = setup(t, 'band_transfer');
  const tier = ps.gd.tierOf(ps.shop.slots[0].id); assert.ok(use({ slot: 0 }).ok); assert.equal(ps.gd.tierOf(ps.shop.slots[0].id), tier);
  const p = grant(ps, 3); ps.bandId = 'band_yan2'; syncCommand(ps); assert.ok(use({ uid: p.uid }).ok);
  assert.equal(ps.find(p.uid), null); assert.ok(own(ps).some(p => matchesYan(p)));
  ps.bandId = 'band_survive'; syncCommand(ps); const target = own(ps)[0]; assert.ok(use({ uid: target.uid }).ok);
  assert.equal(ps.commandMarks.at(-1).uid, target.uid); assert.equal(ps.commandMarks.at(-1).tag, 'eff_band12');
  function matchesYan(p) { return data.chess[p.id].bonds.includes('yanShip') && data.chess[p.id].tier <= 3; }
});

test('copy preserves equipment, temporary elite/equipment and the layer cap alter only battle inputs', t => {
  const { ps, use } = setup(t, 'band_copy');
  const p = grant(ps, 4), itemId = Object.values(data.items).find(i => i.itemType === 'EQUIP' && i.isGolden && !/装备时销毁/.test(i.desc)).id;
  p.items.push({ uid: ps.m.nextUid(), kind: 'item', id: itemId });
  assert.ok(use({ uid: p.uid }).ok);
  const copy = own(ps).find(c => c !== p && c.id === p.id);
  assert.ok(copy); assert.deepEqual(copy.items.map(i => i.id), [itemId]);
  // Place directly so this regression does not depend on map terrain or a kit's deployment restrictions.
  const loc = ps.find(p.uid); ps._detach(loc); ps.board.set('10,5', p);
  ps.bandId = 'band_evolve'; syncCommand(ps); assert.ok(use({ uid: p.uid }).ok);
  const base = p.id;
  const inp = [{ uid: p.uid, kind: 'chess', chessId: p.id, items: [], row: 10, col: 5 }];
  commandBattleInput(ps, inp); assert.equal(inp[0].chessId, ps.gd.goldenIdOf(base)); assert.equal(p.id, base);
  ps.bandId = 'band_limit'; syncCommand(ps); assert.ok(use({ uid: p.uid }).ok);
  const cap = [{ uid: p.uid, kind: 'chess', chessId: p.id, items: [], row: 10, col: 5 }];
  commandBattleInput(ps, cap); assert.equal(cap[0].commandLayerCapBonus, ps.m.round);
  ps.bandId = 'band_pudd'; syncCommand(ps); ps.shop.slots[0] = { kind: 'item', id: itemId };
  assert.ok(use({ slot: 0 }).ok); assert.equal(ps.shop.slots[0], null);
  const items = [{ uid: p.uid, kind: 'chess', chessId: p.id, items: [] }, { uid: 999, kind: 'chess', chessId: p.id, items: [itemId, itemId] }];
  commandBattleInput(ps, items); assert.deepEqual(items[0].items, [itemId]); assert.equal(items[1].items.length, 2);
  assert.equal(p.items.length, 1);
});

test('gain and prep-finish commands explicitly trigger only the selected operator garrison event', t => {
  const { ps, use } = setup(t, 'band_gain');
  const c = Object.values(data.chess).find(c => !c.isGolden && c.garrisonIds.some(id => data.garrisons[id].eventType === 'SERVER_GAIN'));
  const p = ps.acquireChess(c.chessId, { silent: true });
  const seen = []; ps.m.dispatcher.triggerGarrisons = (_ps, piece, event) => { seen.push([piece.uid, event]); return 1; };
  assert.ok(use({ uid: p.uid }).ok); assert.deepEqual(seen, [[p.uid, 'SERVER_GAIN']]);
  ps.bandId = 'band_prepfin'; syncCommand(ps);
  const end = Object.values(data.chess).find(c => !c.isGolden && c.garrisonIds.some(id => data.garrisons[id].eventType === 'SERVER_PREP_FIN'));
  const q = ps.acquireChess(end.chessId, { silent: true }); assert.ok(use({ uid: q.uid }).ok);
  assert.equal(seen.length, 1); ps.m.dispatch(ps, 'onPrepEnd', {});
  assert.deepEqual(seen[1], [q.uid, 'SERVER_PREP_FIN']); ps.m.dispatch(ps, 'onPrepEnd', {}); assert.equal(seen.length, 2);
});

test('higher-tier transform caps at six; sale snapshots active bonds before removing the selected operator', t => {
  const { ps, use } = setup(t, 'band_mess', 7);
  const p = grant(ps, 5); assert.ok(use({ uid: p.uid }).ok); assert.ok(own(ps).some(c => ps.gd.tierOf(c.id) === 6));
  ps.bandId = 'band_sell'; syncCommand(ps); const q = grant(ps, 3);
  ps.bonds = { yanShip: { active: true, count: 3 } };
  const n = ps.layers.yanShip || 0; assert.ok(use({ uid: q.uid }).ok);
  assert.equal(ps.find(q.uid), null); assert.equal(ps.layers.yanShip, n + 3);
});

test('health sacrifice pays capped gold immediately and heals the lowest teammate at prep end', t => {
  const { h, ps, use } = setup(t, 'band_protect', 7);
  const other = h.ps('p_1'); ps.lp = 22; other.lp = 5;
  const before = ps.funds; assert.ok(use().ok); assert.equal(ps.lp, 5); assert.equal(other.lp, 5);
  const cap = commandSkill(ps).buffs[0].bb.max_count; assert.equal(ps.funds - before, Math.min(17, cap));
  ps.m.dispatch(ps, 'onPrepEnd', {}); assert.equal(other.lp, Math.min(ps.gd.startLp(other.bandId), 22));
});

test('shop command tiers and bond preference, one-stock board refresh, and free taking obey pools', t => {
  const { ps, use } = setup(t, 'band_yan'); ps.shop.level = 4;
  assert.ok(use().ok); assert.ok(ps.shop.slots.some(s => s?.kind === 'chess' && data.chess[s.id].bonds.includes('yanShip')));
  ps.bandId = 'band_high'; syncCommand(ps); const p = grant(ps, 3); ps._detach(ps.find(p.uid)); ps.board.set('10,5', p);
  assert.ok(use().ok); assert.ok(ps.shop.slots.some(s => s?.id === p.id)); assert.equal(commandView(ps).usesLeft, 0);
  ps.bandId = 'band_rich'; ps.stats.gold = 120; syncCommand(ps); const count = own(ps).length;
  assert.ok(use().ok); assert.ok(own(ps).length >= count);
  ps.bandId = 'band_iberia'; ps.bonds.iberiaShip = { count: 4 }; syncCommand(ps);
  ps.offers = []; ps.shop.slots[0] = { kind: 'chess', id: normal(6) };
  const slot = 0; const tier = ps.gd.tierOf(ps.shop.slots[slot].id);
  assert.ok(use({ slot }).ok); assert.ok(data.chess[ps.shop.slots[slot].id].bonds.includes('iberiaShip'));
  assert.ok(ps.gd.tierOf(ps.shop.slots[slot].id) <= tier);
});

test('equipment grant rounds, bond gains, purchase rewards and manual refresh rebates use official counts', t => {
  const { ps } = setup(t, 'band_smith'); ps.shop.level = 3;
  const skill = commandSkill(ps), round = skill.buffs[0].bb.round;
  ps.m.round = round; const itemsBefore = [...ps.hand, ...ps.temp].filter(p => p?.kind === 'item').length;
  ps.m.dispatch(ps, 'onPrepStart', {});
  const items = [...ps.hand, ...ps.temp].filter(p => p?.kind === 'item'); assert.equal(items.length, itemsBefore + 1); assert.equal(ps.gd.item(items.at(-1).id).tier, 3);
  ps.bandId = 'band_sargon'; syncCommand(ps);
  const buff = commandSkill(ps).buffs.find(b => b.key === 'gain_bond_cnt_shop_up_discount');
  const c = Object.values(data.chess).find(c => c.bonds.includes(buff.bbStr.bond)); const price = ps.shop.upgradePrice;
  for (let i = 0; i < buff.bb.count + 2; i++) ps.m.dispatch(ps, 'onGain', { kind: 'chess', piece: { id: c.chessId } });
  assert.equal(ps.shop.upgradePrice, Math.max(0, price - buff.bb.value));
  ps.bandId = 'band_victoria'; syncCommand(ps);
  const b = commandSkill(ps).buffs.find(b => b.key === 'buy_bond_char_cnt_gain_equip');
  const id = Object.values(data.chess).find(c => c.bonds.includes(b.bbStr.bond)).chessId;
  const gained = []; const acquire = ps.acquireItem.bind(ps); ps.acquireItem = (id, opts) => { gained.push(id); return acquire(id, opts); };
  for (let i = 0; i < b.bb.count; i++) ps.m.dispatch(ps, 'onBuy', { kind: 'chess', slot: { id } });
  assert.equal(gained.length, b.bb.count2); assert.ok(gained.every(id => ps.gd.item(id).tier <= ps.shop.level));
  ps.bandId = 'band_siracusa'; syncCommand(ps); const rebate = commandSkill(ps).buffs.find(b => b.key === 'n_round_refresh_cnt_gain_coin').bb;
  ps.m.round = rebate.round; const funds = ps.funds;
  for (let n = 1; n <= rebate.refresh_count + 1; n++) { ps.round.refreshes = n; ps.m.dispatch(ps, 'onRefresh', {}); }
  assert.equal(ps.funds, funds + rebate.coin * rebate.refresh_count);
});

test('first normal sale swaps the actual shop slot once; later sales and elite sales retain their proceeds', t => {
  const { ps } = setup(t, 'band_substitute'); const p = grant(ps, 2);
  const shop = ps.shop.slots.filter(s => s?.kind === 'chess').map(s => s.id), before = ps.funds;
  assert.ok(ps.sell(p.uid).ok); assert.equal(ps.funds, before); assert.ok(ps.shop.slots.some(s => s?.id === p.id));
  assert.ok(own(ps).some(p => shop.includes(p.id)));
  const q = grant(ps, 3); assert.ok(ps.sell(q.uid).ok); assert.ok(ps.funds > before);
});

test('promotion reward passives limit counts per round and random strategy opens two-command drafts every prep', t => {
  const { ps } = setup(t, 'band_bonus');
  const b = commandSkill(ps).buffs[0].bb; let awards = 0; ps.pushRewardOffer = () => { awards++; };
  for (let n = 0; n < b.n + 1; n++) ps.m.dispatch(ps, 'onMerge', { kind: 'chess' });
  assert.equal(awards, b.n * b.count);
  ps.bandId = 'band_equipment'; syncCommand(ps); const eq = commandSkill(ps).buffs.find(b => b.key === 'promote_equip_extra_award').bb;
  const offers = []; ps.pushItemOffer = ids => { offers.push(ids); return true; };
  for (let n = 0; n < eq.n + 1; n++) ps.m.dispatch(ps, 'onMerge', { kind: 'item' });
  assert.equal(offers.length, eq.n * eq.select_count); assert.ok(offers.every(ids => ids.length === eq.count && new Set(ids).size === ids.length));
  ps.bandId = 'band_random'; syncCommand(ps);
  const followerCommand = commandSkill(ps).effectId;
  ps.m.dispatch(ps, 'onPrepStart', {});
  assert.equal(ps.commandDrafts[0].choiceId, 'skill_change_2');
  assert.equal(ps.commandDrafts[0].cards.length, 2);
  ps.autoPickCommands();
  assert.equal(ps.bandId, 'band_random');
  assert.notEqual(commandSkill(ps).effectId, followerCommand);
  next(ps, 2); ps.m.dispatch(ps, 'onPrepStart', {});
  assert.equal(ps.commandDrafts.length, 1);
  assert.equal(ps.commandDrafts[0].choiceId, 'skill_change_2');
  assert.equal(ps.commandDrafts[0].cards.length, 2);
});

test('treasure marks persist across rounds, then disappear on validated battle receipts; bots consume click and drag commands', t => {
  const { ps, use, view } = setup(t, 'band_treasure'); assert.ok(use(view().targets[0]).ok);
  const mark = ps.commandMarks[0]; next(ps, 2); assert.ok(ps.commandMarks.includes(mark));
  const shown = ps.privateView().prepMapChars.find(u => u.defId === 'enemy_9038_achest');
  assert.ok(shown); assert.equal(shown.x, mark.col); assert.equal(shown.y, mark.row);
  assert.ok(shown.uid < 0 && !ps.privateView().board.some(p => p.uid === shown.uid));
  reconcileCommandChests(ps, { commandChests: [{ id: mark.id, alive: false }] }); assert.equal(ps.commandMarks.length, 0);
  assert.equal(ps.privateView().prepMapChars.some(u => u.defId === 'enemy_9038_achest'), false);
  ps.bandId = 'band_fund'; syncCommand(ps); assert.ok(botUseCommand(ps.m, ps));
  ps.bandId = 'band_survive'; syncCommand(ps); grant(ps); assert.ok(botUseCommand(ps.m, ps, true)); assert.equal(ps.commandMarks.length, 1);
});

test('a standing treasure refuses its tile and a bot places it off the enemy route', t => {
  const { ps, use, view } = setup(t, 'band_treasure');
  const melee = Object.values(data.chess).find(c => !c.isGolden && !c.isDiy && c.position === 'MELEE' && c.tier === 2).chessId;
  const piece = ps.acquireChess(melee, { silent: true });
  const tile = view().targets.find(t => ps._legal(piece, t.row, t.col));
  assert.ok(tile);
  assert.ok(use(tile).ok);
  assert.equal(ps.move(piece.uid, { area: 'board', row: tile.row, col: tile.col }, 'RIGHT').error, 'BAD_TILE');
  const other = view().targets.find(t => ps._legal(piece, t.row, t.col));
  assert.ok(other);
  assert.ok(ps.move(piece.uid, { area: 'board', row: other.row, col: other.col }, 'RIGHT').ok);
  next(ps, 3);
  assert.equal(ps.commandMarks.length, 1);
  assert.equal(ps.move(piece.uid, { area: 'board', row: tile.row, col: tile.col }, 'RIGHT').error, 'BAD_TILE');

  // Used on round 1 with availCount 3: the command is ready again on readyRound, and the mark is still there until then.
  next(ps, ps.command.records[ps.command.currentEffectId].readyRound);
  assert.equal(ps.commandMarks.length, 1);
  ps.commandMarks = [];
  const first = commandView(ps).targets[0];
  const endCol = first.col >= 10 ? first.col - 1 : first.col + 1;
  ps.m.wave = {
    templateId: 'treasure-path',
    routes: [{ motion: 'WALK', start: [first.row, first.col], end: [first.row, endCol], checkpoints: [] }],
    spawns: [{ enemyKey: 'enemy_1000_gopro_2', count: 1, routeIndex: 0 }],
  };
  delete ps.m._botPath;
  const path = new Set((fieldModel(ps.m, ps).routes || []).flatMap(r => r.tiles));
  assert.ok(path.has(`${first.row},${first.col}`));
  const off = commandView(ps).targets.find(t => !path.has(`${t.row},${t.col}`));
  assert.ok(off);
  assert.ok(botUseCommand(ps.m, ps, true));
  assert.deepEqual([ps.commandMarks[0].row, ps.commandMarks[0].col], [off.row, off.col]);
});

test('renamed passive keys keep delayed gold, first bond price and paid special refresh semantics', t => {
  const { ps } = setup(t, 'band_mlynar');
  const c = Object.values(data.chess).find(c => !c.isGolden && c.bonds.includes('kazimierzShip')).chessId;
  const funds = ps.funds, pending = ps.pendingFunds;
  for (let i = 0; i < 5; i++) ps.m.dispatch(ps, 'onBuy', { kind: 'chess', slot: { id: c } });
  assert.equal(ps.funds, funds); assert.equal(ps.pendingFunds, pending + 3);
  ps.bandId = 'band_kjerag'; syncCommand(ps);
  const id = Object.values(data.chess).find(c => !c.isGolden && c.bonds.includes('kjeragShip')).chessId;
  const slot = { kind: 'chess', id, basePrice: 3 }; assert.equal(ps.priceOf(slot), 1);
  ps.m.dispatch(ps, 'onBuy', { kind: 'chess', slot }); assert.equal(ps.priceOf(slot), 3);
  ps.bandId = 'band_pepe'; syncCommand(ps); ps.shop.level = 4;
  ps.m.dispatch(ps, 'onLevelUp', { level: 4 }); const free = ps.shop.freeRefreshes;
  assert.ok(ps.refresh().ok); assert.equal(ps.shop.freeRefreshes, free); assert.equal(ps.counters['band:pepe:special'], 0);
  assert.ok(ps.shop.slots.filter(s => s?.kind === 'chess').some(s => data.chess[s.id].bonds.includes('sargonShip')));
});

test('Pepe keeps an earned paid refresh credit after swap, and the live Pepe hook consumes only once', t => {
  const { ps } = setup(t, 'band_support');
  const choose = effectId => {
    assert.ok(openSkillChangeDraft(ps, 'skill_change_1', { rng: { shuffle(pool) {
      const first = pool.find(s => s.effectId === effectId);
      assert.ok(first, `${effectId} is available`);
      return [first, ...pool.filter(s => s !== first)];
    } } }));
    const draft = ps.commandDrafts[0];
    assert.equal(draft.cards[0], effectId);
    assert.ok(ps.pickCommand(draft.id, 0).ok);
  };
  const pepe = ps.gd.band('band_pepe').skills[0].effectId;

  choose(pepe);
  ps.shop.level = 2;
  ps.m.dispatch(ps, 'onLevelUp', { level: 2 });
  assert.equal(ps.counters['band:pepe:special'], 1, 'level 2 earns a pending Pepe credit');
  choose('aceffect_band_22');
  const free = ps.shop.freeRefreshes;
  assert.ok(ps.refresh().ok);
  assert.equal(ps.shop.freeRefreshes, free, 'the earned special refresh remains paid');
  assert.equal(ps.counters['band:pepe:special'], 0, 'the retained consumer spends exactly one credit');
  assert.ok(ps.shop.slots.filter(slot => slot?.kind === 'chess').some(slot => data.chess[slot.id].bonds.includes('sargonShip')),
    'the swap-away refresh still prioritizes Sargon operators');

  ps.counters['band:pepe:special'] = 2;
  choose(pepe);
  assert.ok(ps.refresh().ok);
  assert.equal(ps.counters['band:pepe:special'], 1, 'the live Pepe consumer spends one credit without a duplicate retained hook');
});

test('Chiave counts manual refreshes within the round and Warfarin only grows active bonds in regulation', t => {
  const { ps } = setup(t, 'band_bond'); let granted = 0;
  const acquire = ps.acquireChess.bind(ps); ps.acquireChess = (...args) => { granted++; return acquire(...args); };
  for (let round = 1; round <= 2; round++) {
    next(ps, round);
    for (let n = 1; n <= 3; n++) { ps.round.refreshes = n; ps.m.dispatch(ps, 'onRefresh', {}); }
  }
  assert.equal(granted, 0); ps.round.refreshes = 4; ps.m.dispatch(ps, 'onRefresh', {}); assert.equal(granted, 1);
  ps.round.refreshes = 8; ps.m.dispatch(ps, 'onRefresh', {}); assert.equal(granted, 1);
  ps.bandId = 'band_takecare'; syncCommand(ps); const p = grant(ps, 3); ps._detach(ps.find(p.uid)); ps.board.set('10,5', p);
  ps.bonds = Object.fromEntries(data.chess[p.id].bonds.map(id => [id, { active: false, count: 1 }]));
  ps.layers = {}; ps.m.dispatch(ps, 'onPrepEnd', {}); assert.deepEqual(ps.layers, {});
  for (const b of Object.values(ps.bonds)) b.active = true;
  ps.m.dispatch(ps, 'onPrepEnd', {}); assert.ok(Object.values(ps.layers).some(n => n > 0));
});

test('carried funds and duck substitutions follow the current effect after a command replacement', t => {
  const { ps } = setup(t, 'band_cannot'); assert.equal(keepsFunds(ps), true);
  assert.ok(openSkillChangeDraft(ps, 'skill_change_1')); ps.autoPickCommands(); assert.equal(keepsFunds(ps), false);
  ps.bandId = 'band_ducklord'; syncCommand(ps); ps.m.round = 6;
  const id = ps.command.currentEffectId; assert.equal(id, 'aceffect_band_16');
  assert.ok(openSkillChangeDraft(ps, 'skill_change_1')); ps.autoPickCommands(); assert.notEqual(ps.command.currentEffectId, id);
  // Swapping a passive must not leave its global hook behind merely because the original band id is unchanged.
  const spawns = [{ enemyKey: 'enemy_1007_slime', count: 30, time: 0, routeIndex: 0 }];
  const before = structuredClone(spawns);
  ps.m.dispatch(ps, 'onBattleStart', { kind: 'normal', spawns, waveSpawns: structuredClone(spawns), routes: [{ start: [12, 10], end: [9, 2] }] });
  assert.deepEqual(spawns, before);
});
