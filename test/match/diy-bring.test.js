// 规程 选择自编: per-tier cap, banned cores refused, bring-none, the timeout default, bot synthesis,
// setup reroll leaving stock empty, and a covenant match that never enters the step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getVersionData } from '../../server/data.js';
import { diyRecord, diySlot, diySlotIds } from '../../shared/diy.js';
import { botPickDiy, checkDiyBring, defaultDiyBring, diyBringCap, diyBringLimitsOf } from '../../shared/diyBring.js';
import { DIY_LIMITS, checkDiyPicks, validateC2S } from '../../shared/protocol.js';
import { makeMatch, DATA } from './harness.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const act3 = getVersionData('act3autochess@V3_1');
const limits = { 5: 2, 6: 2 };
const tierOfMap = (id) => ({ a: 5, b: 5, c: 5, d: 6 }[id] ?? null);

function protoPicks(data, n5, n6) {
  const slots = diySlotIds(data);
  const t5 = slots.filter((id) => diySlot(id, data)?.tier === 5);
  const t6 = slots.filter((id) => diySlot(id, data)?.tier === 6);
  const p5 = data.backups.diy.prototypes[5] || data.backups.diy.prototypes['5'];
  const p6 = data.backups.diy.prototypes[6] || data.backups.diy.prototypes['6'];
  const picks = {};
  for (let i = 0; i < n5; i++) picks[t5[i]] = { charId: p5[i] };
  for (let i = 0; i < n6; i++) picks[t6[i]] = { charId: p6[i] };
  return { picks, chars: [...p5.slice(0, n5), ...p6.slice(0, n6)] };
}

function ownedSkill0(data) {
  const slot = diySlotIds(data).find((id) => diySlot(id, data)?.tier === 6);
  for (const charId of data.backups.diy.ownedPool || []) {
    const pick = { charId, skillIndex: 0, uniEquipId: null };
    const rec = diyRecord(slot, pick, { data });
    const core = (rec?.bonds || []).find((b) => data.bonds[b]?.isCore);
    if (rec && core) return { slot, pick, core };
  }
  return null;
}

function bannedOf(ps, m) {
  const off = new Set([...m.disabledBonds, ...m.staticInactiveBonds]);
  return Object.keys(ps.diy).filter((id) => {
    const rec = ps._diyRecords.get(id);
    return !!(rec && m.gd.bondsExclude(rec, off));
  }).sort();
}

function legalOf(ps, m) {
  const off = new Set([...m.disabledBonds, ...m.staticInactiveBonds]);
  return diySlotIds(m.gd.raw).filter((id) => ps.diy[id] && ps._diyRecords.get(id) && !m.gd.bondsExclude(ps._diyRecords.get(id), off));
}

/** INFO_CHECK and the strategy draft, then stop. Does not confirm 选择自编. */
function toCustom(h) {
  const m = h.m;
  for (let i = 0; i < 80 && m.phase !== 'CUSTOM_CHECK'; i++) {
    if (m.phase === 'INFO_CHECK') {
      for (const ps of m.order) if (!ps.isBot && !ps.left && !ps.infoReady) m.handle(ps.playerId, { t: 'g.infoReady' });
    }
    if (m.phase === 'BAND_DRAFT') {
      const turn = m.draftTurn();
      const ps = turn && m.players.get(turn);
      if (ps && !ps.isBot && !ps.botControlled && m.draft.picks[turn] == null) {
        const band = m.gd.bandIds().find((b) => !m.bandTaken(b, turn));
        const res = m.handle(turn, { t: 'g.band', bandId: band });
        assert.equal(res.ok, true, JSON.stringify(res));
      }
    }
    if (m.phase === 'CUSTOM_CHECK') return;
    assert.equal(h.sched.runNext(), true, `stalled in ${m.phase}`);
  }
  assert.equal(m.phase, 'CUSTOM_CHECK');
}

test('diyBringLimitsOf needs both the enter step and the map; act3 is 2 and 2', () => {
  const cfg = JSON.parse(readFileSync(path.join(ROOT, 'data/versions/act3autochess-v3_1/config.json'), 'utf8'));
  const def = JSON.parse(readFileSync(path.join(ROOT, 'data/config.json'), 'utf8'));
  assert.deepEqual(diyBringLimitsOf(cfg), { 5: 2, 6: 2 });
  assert.equal(Object.keys(cfg).at(-1), 'version');
  assert.equal(diyBringLimitsOf(def), null);
  assert.equal(diyBringLimitsOf({ timers: { enterSteps: [{ step: 'CUSTOM_CHECK', time: 30 }] } }), null);
  assert.equal(diyBringLimitsOf({ diyBringLimits: { 5: 2, 6: 2 } }), null);
  assert.equal(diyBringLimitsOf({ timers: { enterSteps: [{ step: 'CUSTOM_CHECK' }] }, diyBringLimits: { no: 2, 5: 2.5, 9: -1 } }), null);
  assert.equal(diyBringCap({ 5: 2, '6': 2 }, 6), 2);
  assert.equal(diyBringCap({ 5: 2 }, 6), null);
});

test('checkDiyBring is strict; the default walks slot ids; a bot prefers active bonds then charId', () => {
  const roster = { a: { charId: 'a' }, b: { charId: 'b' }, c: { charId: 'c' }, d: { charId: 'd' } };
  const ctx = { roster, banned: [], limits, tierOf: tierOfMap };
  assert.deepEqual(checkDiyBring([], ctx), { ok: true, slots: [] });
  assert.equal(checkDiyBring(['a', 'b', 'c'], ctx).detail, 'cap');
  assert.equal(checkDiyBring(['a', 'a'], ctx).detail, 'duplicate');
  assert.equal(checkDiyBring(['nope'], ctx).detail, 'not in roster');
  assert.equal(checkDiyBring(['a'], { ...ctx, banned: ['a'] }).detail, 'banned bond');
  assert.equal(checkDiyBring('a', ctx).error, 'BAD_MSG');
  assert.deepEqual(defaultDiyBring(['a', 'b', 'c', 'd'], { ...ctx, banned: ['b'] }), ['a', 'c', 'd']);
  assert.deepEqual(botPickDiy(['a', 'b'], {
    roster, banned: [], limits, tierOf: () => 5,
    rank: (id) => ({ count: id === 'b' ? 3 : 1, charId: id }),
  }), ['b', 'a']);
  assert.deepEqual(botPickDiy(['m', 'a'], {
    roster: { m: { charId: 'm' }, a: { charId: 'a' } }, banned: [], limits, tierOf: () => 5,
    rank: (id) => ({ count: 1, charId: id }),
  }), ['a', 'm']);
});

test('g.diyBring and a 12-slot roster pass the wire; 13 does not; a real 6+6 act3 roster is kept', () => {
  assert.equal(DIY_LIMITS.slots, 12);
  assert.equal(validateC2S({ t: 'g.diyBring', slots: [] }), null);
  assert.match(validateC2S({ t: 'g.diyBring', slots: Array.from({ length: 13 }, (_, i) => `slot_${i}`) }) || '', /slots/);
  const twelve = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`slot_${i}`, null]));
  assert.equal(validateC2S({ t: 'room.diy', picks: twelve }), null);
  const thirteen = Object.fromEntries(Array.from({ length: 13 }, (_, i) => [`slot_${i}`, null]));
  assert.match(validateC2S({ t: 'room.diy', picks: thirteen }) || '', /picks/);
  const { picks, chars } = protoPicks(act3, 6, 6);
  const res = checkDiyPicks(picks, { data: act3, kitted: chars });
  assert.equal(res.dropped, 0);
  assert.equal(Object.keys(res.picks).length, 12);
});

test('规程: empty stock until 选择自编, reroll keeps it empty, cap and a banned core are refused, [] brings none', (t) => {
  const owned = ownedSkill0(act3);
  assert.ok(owned, 'an owned operator composes at skill 0');
  const { picks, chars } = protoPicks(act3, 3, 1);
  const bPicks = { [owned.slot]: owned.pick };
  const h = makeMatch({
    data: act3, mode: 'coop', difficulty: 'FUNNY', seed: 7, kitted: [...chars, owned.pick.charId],
    seats: [
      { playerId: 'p', seat: 0, name: 'P', isBot: false, connected: true, diy: picks },
      { playerId: 'q', seat: 1, name: 'Q', isBot: false, connected: true, diy: bPicks },
    ],
  });
  t.after(() => h.m.dispose());
  const m = h.m;
  h.start();
  const ps = h.ps('p');
  const qs = h.ps('q');
  assert.deepEqual(m.gd.diyBringLimits, { 5: 2, 6: 2 });
  assert.equal(ps.diyStock.entries.size, 0);
  assert.equal(qs.diyStock.entries.size, 0);
  assert.deepEqual([...ps.diyBanned].sort(), bannedOf(ps, m));
  assert.equal(m.publicView().diyCheck, undefined);
  assert.equal(ps.privateView().diyBring, null);
  assert.equal(m.handle('p', { t: 'g.diyBring', slots: [] }).error, 'WRONG_PHASE');

  const rev = m.setupRevision;
  assert.equal(m.requestSetupReroll('p', rev).ok, true);
  const vote = m.setupVote;
  assert.ok(vote);
  assert.equal(m.handle('q', { t: 'g.rerollVote', voteId: vote.id, agree: true }).ok, true);
  assert.equal(m.phase, 'INFO_CHECK');
  assert.equal(ps.diyStock.entries.size, 0);
  assert.deepEqual([...ps.diyBanned].sort(), bannedOf(ps, m));
  assert.deepEqual([...qs.diyBanned].sort(), bannedOf(qs, m));

  toCustom(h);
  assert.equal(m.publicView().diyCheck.untimed, false);
  assert.equal(m.publicView().diyCheck.picks.p, null);
  const legal5 = legalOf(ps, m).filter((id) => diySlot(id, act3)?.tier === 5);
  assert.ok(legal5.length >= 3, `need 3 legal tier-5 slots, got ${legal5.join(',')}`);
  const over = m.handle('p', { t: 'g.diyBring', slots: legal5.slice(0, 3) });
  assert.equal(over.error, 'BAD_TARGET');
  assert.equal(over.detail, 'cap');
  assert.equal(ps.diyBring, null);
  const two = legal5.slice(0, 2);
  assert.equal(m.handle('p', { t: 'g.diyBring', slots: two }).ok, true);
  assert.deepEqual([...ps.diyStock.entries.keys()].sort(), [...two].sort());

  if (!m.disabledBonds.includes(owned.core)) m.disabledBonds.push(owned.core);
  const refused = m.handle('q', { t: 'g.diyBring', slots: [owned.slot] });
  assert.equal(refused.error, 'BAD_TARGET');
  assert.equal(refused.detail, 'banned bond');
  assert.equal(m.handle('q', { t: 'g.diyBring', slots: [owned.slot, 'not_a_slot'] }).error, 'BAD_TARGET');
  assert.equal(m.handle('q', { t: 'g.diyBring', slots: [] }).ok, true);
  assert.equal(qs.diyStock.entries.size, 0);
  assert.deepEqual(qs.diyBring, []);
});

test('规程: a timed 选择自编 that nobody confirms brings the first legal slots per tier', (t) => {
  const { picks, chars } = protoPicks(act3, 3, 3);
  const h = makeMatch({
    data: act3, mode: 'coop', difficulty: 'FUNNY', seed: 9, kitted: chars,
    seats: [
      { playerId: 'p', seat: 0, name: 'P', isBot: false, connected: true, diy: picks },
      { playerId: 'q', seat: 1, name: 'Q', isBot: false, connected: true, diy: picks },
    ],
  });
  t.after(() => h.m.dispose());
  h.start();
  toCustom(h);
  assert.equal(h.run(() => h.m.phase === 'BATTLE_CHECK'), true);
  for (const id of ['p', 'q']) {
    const ps = h.ps(id);
    assert.ok(Array.isArray(ps.diyBring));
    for (const tier of [5, 6]) {
      const want = legalOf(ps, h.m).filter((slot) => diySlot(slot, act3)?.tier === tier).slice(0, 2);
      const got = [...ps.diyStock.entries.keys()].filter((slot) => diySlot(slot, act3)?.tier === tier).sort();
      assert.deepEqual(got, [...want].sort(), `${id} tier ${tier}`);
    }
  }
});

test('规程: a bot with no lobby roster gets a stable capped squad and setDiy cannot wipe it', (t) => {
  const seats = [
    { playerId: 'p', seat: 0, name: 'P', isBot: false, connected: true },
    { playerId: 'ai_1', seat: 1, name: 'AI', isBot: true, connected: true },
  ];
  const open = (seed) => {
    const h = makeMatch({ data: act3, mode: 'coop', difficulty: 'FUNNY', seed, seats });
    t.after(() => h.m.dispose());
    h.start();
    toCustom(h);
    return h;
  };
  const h = open(4);
  const bot = h.ps('ai_1');
  assert.ok(Array.isArray(bot.diyBring));
  assert.ok(bot.diyBring.length > 0);
  const per = {};
  for (const id of bot.diyBring) per[diySlot(id, act3).tier] = (per[diySlot(id, act3).tier] || 0) + 1;
  for (const n of Object.values(per)) assert.ok(n <= 2);
  const off = new Set([...h.m.disabledBonds, ...h.m.staticInactiveBonds]);
  for (const id of bot.diyBring) assert.equal(h.m.gd.bondsExclude(bot._diyRecords.get(id), off), false, id);
  const again = open(4);
  assert.deepEqual(again.ps('ai_1').diyBring, bot.diyBring);
  const rng = h.m.rngMeta.state();
  assert.equal(bot.synthesizeBotRoster(off, h.m.gd.diyBringLimits), true);
  assert.deepEqual(h.m.rngMeta.state(), rng);
  const snap = { ...bot.diy };
  assert.equal(bot.setDiy({ chess_char_5_diy1_a: { charId: 'char_x' } }), false);
  assert.deepEqual(bot.diy, snap);
});

test('规程 选择自编: 托管 confirms a seat at once (solo is untimed); the last chooser leaving ends the step', (t) => {
  const { picks, chars } = protoPicks(act3, 2, 2);
  const solo = makeMatch({
    data: act3, mode: 'solo', difficulty: 'FUNNY', seed: 3, kitted: chars,
    seats: [{ playerId: 'p', seat: 0, name: 'P', isBot: false, connected: true, diy: picks }],
  });
  t.after(() => solo.m.dispose());
  solo.start();
  toCustom(solo);
  const ps = solo.ps('p');
  assert.equal(ps.diyBring, null);
  assert.equal(solo.m.handle('p', { t: 'g.autoplay', on: true }).ok, true);
  assert.deepEqual([...ps.diyBring], defaultDiyBring(diySlotIds(act3), {
    roster: ps.diy, banned: bannedOf(ps, solo.m), limits, tierOf: (id) => diySlot(id, act3)?.tier ?? null,
  }));
  for (let i = 0; i < 5 && solo.m.phase === 'CUSTOM_CHECK'; i++) solo.sched.runNext();
  assert.notEqual(solo.m.phase, 'CUSTOM_CHECK');

  const duo = makeMatch({
    data: act3, mode: 'coop', difficulty: 'FUNNY', seed: 5, kitted: chars,
    seats: [
      { playerId: 'p', seat: 0, name: 'P', isBot: false, connected: true, diy: picks },
      { playerId: 'q', seat: 1, name: 'Q', isBot: false, connected: true, diy: picks },
    ],
  });
  t.after(() => duo.m.dispose());
  duo.start();
  toCustom(duo);
  assert.equal(duo.m.handle('p', { t: 'g.diyBring', slots: [] }).ok, true);
  assert.equal(duo.m.phase, 'CUSTOM_CHECK');
  assert.ok(duo.m.deadline > 0, 'two humans: a timed step');
  duo.m.onLeave('q');
  // the step ends at once (its deadline is cleared and a 0 ms advance runs), not when the 30 s run out
  assert.equal(duo.m.deadline, 0);
  assert.equal(duo.sched.runNext(), true);
  assert.notEqual(duo.m.phase, 'CUSTOM_CHECK');
});

test('a covenant match stocks the lobby roster at the start and never enters 选择自编', (t) => {
  const { picks, chars } = protoPicks(DATA, 2, 2);
  const h = makeMatch({
    mode: 'solo', difficulty: 'FUNNY', seed: 3, kitted: chars,
    seats: [{ playerId: 'p', seat: 0, name: 'P', isBot: false, connected: true, diy: picks }],
  });
  t.after(() => h.m.dispose());
  const m = h.m;
  assert.equal(m.gd.diyBringLimits, null);
  h.start();
  const ps = h.ps('p');
  assert.equal(Object.keys(ps.diy).length, 4);
  assert.ok(ps.diyStock.entries.size > 0);
  assert.equal(Object.hasOwn(ps.privateView(), 'diyBring'), false);
  m.handle('p', { t: 'g.infoReady' });
  assert.equal(h.run(() => m.phase === 'BAND_DRAFT'), true);
  const band = m.gd.bandIds().find((b) => m.gd.bandAllowed(b));
  assert.equal(m.handle('p', { t: 'g.band', bandId: band }).ok, true);
  assert.equal(h.run(() => m.phase === 'BATTLE_CHECK'), true);
  assert.notEqual(m.phase, 'CUSTOM_CHECK');
});
