// §37.63 co-op 终极 team play: a bot seat drafts Touch's 外勤医疗 (the reserve medic on every player's field) once
// another player holds 歌利亚, and a co-op normal round from R5 to R13 also rehearses lineup alternatives (two lineups
// re-chosen with a DPS weight, the two best single bench swaps) after the usual candidates. §37.65: a seat gone before
// its pick (before the draft or during it) takes Touch while nobody else holds it and never 歌利亚.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrange, botPickBand, botPrepEnd, coopAltLineups } from '../../server/match/bot.js';
import { makeMatch, give, DATA } from './harness.js';

const TOUCH = 'band_amedic', GOLIATH = 'band_sarkazb';
const bots = (n) => Array.from({ length: n }, (_, i) => ({ seat: i, playerId: `ai_${i}`, name: `AI-${i + 1}`, isBot: true, connected: true }));

/** A co-op match stopped at the start of its strategy draft (every seat still to pick). */
function draft(difficulty = 'ABYSS', data = DATA) {
  const h = makeMatch({ mode: 'coop', difficulty, seed: 5, seats: bots(4), data }).start();
  h.runToPhase('BAND_DRAFT');
  return h;
}
const share = (m, ps, id, n = 400) => {
  let hits = 0;
  for (let i = 0; i < n; i++) if (botPickBand(m, ps) === id) hits++;
  return hits / n;
};

test('§37.63: a drafting co-op 终极 bot takes Touch once another player holds 歌利亚', () => {
  const h = draft();
  try {
    const { m } = h;
    assert.ok(m.gd.bandIds().includes(TOUCH) && m.gd.bandIds().includes(GOLIATH));
    const [bot, mate] = m.order;
    assert.ok(!m.draft.picks[bot.playerId], 'the seat is still to draft');
    const before = share(m, bot, TOUCH);
    assert.ok(before < 0.2, `without 歌利亚 taken Touch is an ordinary pick (${before})`);
    mate.bandId = GOLIATH;
    const after = share(m, bot, TOUCH);
    assert.ok(after > 0.9, `with a teammate on 歌利亚 the bot takes Touch (${after})`);
    mate.bandId = TOUCH;
    assert.ok(share(m, bot, TOUCH) < 0.2, 'nobody else boosts it once a teammate holds it');
  } finally { h.m.dispose(); }
});

test('§37.63: a plugin strategy built on Touch or 歌利亚 (effectRef) counts as it', () => {
  const variant = (id, newId) => ({ ...DATA.bands[id], bandId: newId, effectRef: id });
  const data = { ...DATA, bands: { ...DATA.bands, band_x_touch: variant(TOUCH, 'band_x_touch'), band_x_goliath: variant(GOLIATH, 'band_x_goliath') } };
  const h = draft('ABYSS', data);
  try {
    const { m } = h;
    const [bot, a, b] = m.order;
    a.bandId = 'band_x_goliath';
    assert.ok(share(m, bot, TOUCH) > 0.9, 'a teammate on the 歌利亚 variant');
    b.bandId = 'band_x_touch';
    assert.ok(share(m, bot, TOUCH) < 0.2, 'a teammate on the Touch variant already grants the medic');
  } finally { h.m.dispose(); }
});

test('§37.63: the team medic is a co-op 终极 draft rule only', () => {
  const hard = draft('HARD');
  try {
    const [bot, mate] = hard.m.order;
    mate.bandId = GOLIATH;
    assert.ok(share(hard.m, bot, TOUCH) < 0.2, '绝境 keeps the LP pick');
  } finally { hard.m.dispose(); }
  const h = draft();
  try {
    const { m } = h;
    const [bot, mate] = m.order;
    mate.bandId = GOLIATH;
    m.draft.picks[bot.playerId] = 'band_amiya';
    assert.ok(share(m, bot, TOUCH) < 0.2, 'not for a seat that has drafted (botPickBand outside its turn)');
  } finally { h.m.dispose(); }
  const solo = makeMatch({ mode: 'solo', difficulty: 'ABYSS', seed: 5, seats: bots(1) }).start();
  try {
    solo.runToPhase('BAND_DRAFT');
    assert.ok(share(solo.m, solo.m.order[0], TOUCH) < 0.2, 'solo has no team to heal');
  } finally { solo.m.dispose(); }
});

/**
 * A co-op match of two humans and two AI seats whose second human (p_1) left during the briefing (unless `stay`), stopped
 * at the start of its strategy draft (every seat still to pick).
 */
function draftGone(difficulty = 'ABYSS', { stay = false, ...o } = {}) {
  const humans = [0, 1].map((i) => ({ seat: i, playerId: `p_${i}`, name: `P${i + 1}`, isBot: false, connected: true }));
  const seats = [...humans, ...bots(2).map((s, i) => ({ ...s, seat: i + 2 }))];
  const h = makeMatch({ mode: 'coop', difficulty, seed: 5, seats, ...o }).start();
  if (stay) h.m.handle('p_1', { t: 'g.infoReady' });
  else h.m.onLeave('p_1');
  h.m.handle('p_0', { t: 'g.infoReady' });
  h.runToPhase('BAND_DRAFT');
  return h;
}

test('§37.65: a seat gone before the draft takes Touch while nobody else holds it, never 歌利亚', () => {
  for (const difficulty of ['ABYSS', 'HARD']) {
    const h = draftGone(difficulty);
    try {
      const { m } = h;
      const gone = h.ps('p_1'), mate = h.ps('ai_0');
      assert.ok(!gone.alive && gone.botControlled && !m.draft.picks.p_1, 'eliminated when it left, the AI drafts for it');
      assert.equal(share(m, gone, TOUCH), 1, `${difficulty}: Touch while it is free`);
      mate.bandId = GOLIATH;
      assert.equal(share(m, gone, TOUCH), 1, `${difficulty}: whoever holds 歌利亚`);
      mate.bandId = TOUCH;
      const picks = Array.from({ length: 400 }, () => botPickBand(m, gone));
      assert.ok(!picks.includes(GOLIATH), `${difficulty}: never 歌利亚`);
      assert.ok(new Set(picks).size > 20, `${difficulty}: any other strategy alike, no LP weight (${new Set(picks).size})`);
    } finally { h.m.dispose(); }
  }
  // a plugin strategy built on Touch or 歌利亚 (effectRef) counts as it
  const variant = (id, newId) => ({ ...DATA.bands[id], bandId: newId, effectRef: id });
  const data = { ...DATA, bands: { ...DATA.bands, band_x_touch: variant(TOUCH, 'band_x_touch'), band_x_goliath: variant(GOLIATH, 'band_x_goliath') } };
  const h = draftGone('ABYSS', { data });
  try {
    const { m } = h;
    const gone = h.ps('p_1');
    assert.ok(Array.from({ length: 400 }, () => botPickBand(m, gone)).every((id) => id === TOUCH || id === 'band_x_touch'), 'either Touch');
    h.ps('ai_0').bandId = 'band_x_touch';
    const picks = Array.from({ length: 400 }, () => botPickBand(m, gone));
    assert.ok(!picks.includes(GOLIATH) && !picks.includes('band_x_goliath'), 'never 歌利亚 or a strategy built on it');
  } finally { h.m.dispose(); }
});

test('§37.65: no AI seat drafts Touch for a 歌利亚 teammate while a seat gone before the draft is still to pick', () => {
  const h = draftGone();
  try {
    const { m } = h;
    const gone = h.ps('p_1'), bot = h.ps('ai_0');
    h.ps('p_0').bandId = GOLIATH;
    assert.ok(share(m, bot, TOUCH) < 0.2, 'the seat gone before the draft takes it at its turn');
    m.draft.picks.p_1 = gone.bandId = 'band_amiya';
    assert.ok(share(m, bot, TOUCH) > 0.9, 'once it has drafted something else, the AI seat takes it again');
  } finally { h.m.dispose(); }
});

test('§37.65: in the draft the seat gone before it takes Touch, with or without 「AI 队友最后选择」', () => {
  let touch = 0;
  for (const aiPicksLast of [false, true]) {
    for (let seed = 1; seed <= 4; seed++) {
      const h = draftGone('ABYSS', { seed, aiPicksLast });
      try {
        const { m } = h;
        m.handle('p_0', { t: 'g.autoplay', on: true }); // the AI drafts for every seat
        h.run(() => m.phase !== 'BAND_DRAFT');
        const { picks, order } = m.draft;
        const why = `seed ${seed}, ${order}: ${JSON.stringify(picks)}`;
        // a seat before it may still draw Touch by its own weight (no boost while the gone seat is to pick)
        if (!order.slice(0, order.indexOf('p_1')).some((pid) => picks[pid] === TOUCH)) assert.equal(picks.p_1, TOUCH, why);
        assert.notEqual(picks.p_1, GOLIATH, why);
        assert.equal(h.ps('p_1').bandId, picks.p_1);
        assert.ok(m.teamMedicGranted(), 'the medic stands on the living players\' fields');
        if (picks.p_1 === TOUCH) touch++;
      } finally { h.m.dispose(); }
    }
  }
  assert.ok(touch >= 6, `the gone seat itself took Touch in ${touch} of 8 drafts`);
});

test('§37.65: a seat leaving during the draft keeps its turn, takes Touch while nobody else holds it, never 歌利亚', () => {
  let touch = 0, runs = 0;
  for (const onTurn of [false, true]) {
    for (const aiPicksLast of [false, true]) {
      for (let seed = 1; seed <= 4; seed++) {
        const h = draftGone('ABYSS', { stay: true, seed, aiPicksLast });
        try {
          const { m } = h;
          m.handle('p_0', { t: 'g.autoplay', on: true }); // the AI drafts for every other seat
          if (onTurn) assert.ok(h.run(() => m.draftTurn() === 'p_1'), 'its turn comes');
          const turn = m.draftTurn() === 'p_1';
          m.onLeave('p_1');
          assert.ok(!h.ps('p_1').alive && !m.draft.picks.p_1, 'eliminated, no strategy given at once: it keeps its place');
          h.run(() => m.phase !== 'BAND_DRAFT');
          const { picks, order } = m.draft;
          const why = `seed ${seed}, ${order}${turn ? ', left on its turn' : ''}: ${JSON.stringify(picks)}`;
          const earlier = order.slice(0, order.indexOf('p_1'));
          if (!earlier.some((pid) => picks[pid] === TOUCH)) assert.equal(picks.p_1, TOUCH, `Touch, not the default 华法琳: ${why}`);
          assert.notEqual(picks.p_1, GOLIATH, why);
          assert.equal(h.ps('p_1').bandId, picks.p_1);
          assert.equal(h.ps('p_1').lp, 0, 'it keeps the 0 it left with');
          assert.equal(new Set(Object.values(picks)).size, 4, `nobody shares a strategy: ${why}`);
          runs++;
          if (picks.p_1 === TOUCH) touch++;
        } finally { h.m.dispose(); }
      }
    }
  }
  assert.ok(touch >= runs - 3, `the departed seat itself took Touch in ${touch} of ${runs} drafts`);
});

test('§37.65: a departed seat drafts by the team\'s rule whatever strategy plays the AI seats', () => {
  // 伊奥莱塔's strategies take 伊奥莱塔 while it is free; the departed seat still takes Touch (or another, never 歌利亚)
  for (const botStrategy of ['ioleta', 'ioleta-adaptive']) {
    for (let seed = 1; seed <= 3; seed++) {
      const h = draftGone('ABYSS', { botStrategy, seed });
      try {
        const { m } = h;
        m.handle('p_0', { t: 'g.autoplay', on: true });
        h.run(() => m.phase !== 'BAND_DRAFT');
        const { picks, order } = m.draft;
        const why = `${botStrategy}, seed ${seed}, ${order}: ${JSON.stringify(picks)}`;
        const earlier = order.slice(0, order.indexOf('p_1'));
        if (!earlier.some((pid) => picks[pid] === TOUCH)) assert.equal(picks.p_1, TOUCH, why);
        assert.ok(picks.p_1 !== GOLIATH && picks.p_1 !== 'band_ioleta', why);
      } finally { h.m.dispose(); }
    }
  }
  // a strategy that decides for itself (the external AI) never gets the departed seat's turn: a 歌利亚 it highlighted
  // before leaving on its turn is not what a turn running out would then give it
  const h = draftGone('ABYSS', { stay: true, seed: 2 });
  try {
    const { m } = h;
    m.bot = { ...m.bot, id: 'stub', decide: () => true };
    m.handle('p_0', { t: 'g.autoplay', on: true });
    assert.ok(h.run(() => m.draftTurn() === 'p_1'), 'its turn comes');
    m.handle('p_1', { t: 'g.bandFocus', bandId: GOLIATH });
    m.onLeave('p_1');
    h.sched.advance(1);
    assert.equal(m.draft.picks.p_1, TOUCH, 'drafted at once by the team\'s rule');
  } finally { h.m.dispose(); }
});

// the fa-body fixture (白面鸮 heals, 瑕光 guards, 崖心 hooks) and two more dealers for the bench: 迷迭香 (6), 寒檀 (5)
const IDS = ['4_20_b', '6_01_a', '1_06_b', '4_14_a', '4_21_a', '3_12_a', '1_01_a', '2_03_a', '6_12_a', '5_21_a'];

/** A co-op 终极 bot at the prep of normal round `round` with the fixture in hand. */
function coopRound(round, mode = 'coop') {
  const h = makeMatch({ mode, difficulty: 'ABYSS', seats: bots(mode === 'solo' ? 1 : 4), seed: 7, botRehearsal: 3 }).start().toPrep();
  const m = h.m, ps = m.order[0];
  m.startRound(round);
  m.phase = 'PREP'; // the round's prep (startRound leaves the round start)
  for (const id of IDS) give(m, ps, `chess_char_${id}`, 'hand');
  return { h, m, ps };
}
const sameSwaps = (a, b) => JSON.stringify(a) === JSON.stringify(b);

test('§37.63: a co-op normal round rehearses lineup alternatives after the usual candidates', () => {
  const { h, m, ps } = coopRound(7);
  try {
    assert.ok(m.wave, 'a normal round');
    const job = arrange(m, ps, { final: true, defer: true });
    assert.ok(job, 'the round is rehearsed');
    const chosen = job.chosen.filter((p) => job.plans[0].lineup.has(p.uid));
    const alts = coopAltLineups(m, ps, chosen);
    assert.ok(alts.length >= 1, 'an alternative differs from the default lineup');
    const first = job.plans.findIndex((pl) => pl.swaps?.length);
    assert.ok(first > 0, 'the usual candidates come first');
    assert.ok(job.plans.slice(first).every((pl) => alts.some((d) => sameSwaps(pl.swaps, d.swaps))), 'then only alternatives');
    for (const d of alts) {
      assert.equal(d.set.length, chosen.length, 'one piece in for each one out');
      for (const q of d.ins) assert.ok(job.chosen.some((p) => p.uid === q.uid), 'the incoming pieces are rehearsed');
    }
  } finally { h.m.dispose(); }
});

/** Each alternative the rehearsal may keep is deployed as planned (a fresh fixture per alternative). */
function deploysEvery(round, setup) {
  const count = (() => { const f = setup(round); try { return arrange(f.m, f.ps, { final: true, defer: true }).plans.filter((pl) => pl.swaps?.length).length; } finally { f.h.m.dispose(); } })();
  assert.ok(count >= 1, 'the fixture has alternatives');
  for (let k = 0; k < count; k++) {
    const { h, m, ps } = setup(round);
    try {
      const job = arrange(m, ps, { final: true, defer: true });
      const best = job.plans.filter((pl) => pl.swaps?.length)[k];
      botPrepEnd(m, ps, { done: true, plans: job.plans, best, chosen: job.chosen });
      const board = [...ps.board.values()].filter((p) => p.kind === 'chess').map((p) => p.uid).sort();
      assert.deepEqual(board, [...best.lineup].sort(), `alternative ${k} is deployed`);
      for (const uid of best.lineup) assert.equal(ps.find(uid).key, best.get(uid), `alternative ${k}: every piece on its planned tile`);
    } finally { h.m.dispose(); }
  }
  return count;
}

test('§37.63: every alternative the rehearsal keeps is deployed as planned', () => {
  deploysEvery(7, (round) => coopRound(round));
});

test('§37.63: a melee piece swapped in for one on a 高台 tile is deployed (the replaced piece leaves the board)', () => {
  // 刺玫 耶拉 浊心斯卡蒂 野鬃 雪猎 小满 雷蛇 灰毫 斯卡蒂 流明: an alternative brings 雷蛇 (melee) in for 小满 on a 高台 tile
  const HAND = ['1_06_a', '3_20_a', '6_04_a', '1_19_a', '3_11_a', '2_04_a', '1_20_a', '2_18_a', '3_05_a', '6_14_a'];
  const setup = (round) => {
    const h = makeMatch({ mode: 'coop', difficulty: 'ABYSS', seats: bots(4), seed: 113, botRehearsal: 3 }).start().toPrep();
    const m = h.m, ps = m.order[0];
    m.startRound(round);
    m.phase = 'PREP';
    for (const id of HAND) give(m, ps, `chess_char_${id}`, 'hand');
    return { h, m, ps };
  };
  const f = setup(9);
  try {
    const job = arrange(f.m, f.ps, { final: true, defer: true });
    const melee = job.plans.find((pl) => pl.swaps?.some(([o, i]) => f.ps.find(i)?.piece.id === 'chess_char_1_20_a'
      && f.ps.deployMap().get(f.ps.find(o)?.key) === 'ranged'));
    assert.ok(melee, 'the fixture swaps a melee piece in for one on a 高台 tile');
  } finally { f.h.m.dispose(); }
  deploysEvery(9, setup);
});

test('§37.63: no alternative only trades the copies of a pair', () => {
  const { h, m, ps } = coopRound(7);
  try {
    arrange(m, ps, {});
    const chosen = [...ps.board.values()].filter((q) => q.kind === 'chess');
    const kits = (set) => set.map((p) => p.id).sort().join(',');
    for (const p of chosen) {
      const twin = give(m, ps, p.id, 'hand'); // its second copy on the bench
      const alts = coopAltLineups(m, ps, chosen);
      assert.ok(alts.length >= 1, `${p.id}: alternatives`);
      for (const d of alts) assert.notEqual(kits(d.set), kits(chosen), `${p.id}: the bench copy in place of the deployed one`);
      tryDispose(m, ps, twin);
    }
  } finally { h.m.dispose(); }
});
const tryDispose = (m, ps, piece) => { if (piece && ps.find(piece.uid)) ps.sell(piece.uid); };

test('§37.63: no alternatives before R5, after R13 or in solo', () => {
  for (const [round, mode] of [[4, 'coop'], [7, 'solo']]) {
    const { h, m, ps } = coopRound(round, mode);
    try {
      const chosen = arrange(m, ps, { final: true, defer: true }).chosen.slice(0, ps.deployCap);
      assert.deepEqual(coopAltLineups(m, ps, chosen), [], `${mode} R${round}`);
    } finally { h.m.dispose(); }
  }
  const { h, m, ps } = coopRound(13);
  try {
    m.round = 14; // past the window (the boss round has its own damage lineups, §37.62)
    assert.deepEqual(coopAltLineups(m, ps, ps.allChess().slice(0, ps.deployCap)), []);
  } finally { h.m.dispose(); }
});
