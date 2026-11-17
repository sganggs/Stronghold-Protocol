// §37.37 positional traits, layer-gain rehearsal ties, skill-point and 维多利亚 equipment, engine merges (round54; owner
// 2026-10-28: R11–R13 defence, then front/row placement, then each bond's own play). The Final Assault lab of that round:
// layers are the lever (all active bonds ×2 at the boss prep: leader pool share 40.8 → 58.1 %).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { positionTraitsOf, positionPlanSteps, LayoutPlan, itemTarget, buyScoreOf } from '../../server/match/bot.js';
import { RehearsalScore } from '../../server/sim/rehearsal.js';
import { rotateOffset } from '../../server/sim/dir.js';
import { tileKey, parseKey } from '../../server/match/board.js';
import { makeMatch, give, giveItem, legalTileFor } from './harness.js';

const SEAT = [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }];

function solo(difficulty = 'ABYSS', seed = 3) {
  const h = makeMatch({ mode: 'solo', difficulty, seats: SEAT, seed }).start().toPrep();
  const m = h.m, ps = m.order[0];
  ps.hand.fill(null);
  ps.board.clear();
  ps.recompute();
  return { h, m, ps };
}

/** The normal chess id of a name (the data's own 名称). */
const idOf = (m, name) => {
  const c = Object.values(m.gd.raw.chess).find((x) => x.name === name && !x.isGolden && x.visible !== false);
  assert.ok(c, name);
  return c.chessId;
};

const run = (gen) => { let r; for (;;) { r = gen.next(); if (r.done) return r.value; } };

test('positional traits are read from the garrison data: front / behind, rows, grants, copies', () => {
  const { h, m, ps } = solo();
  try {
    const kinds = (name) => positionTraitsOf(m, ps, m.gd.chess(idOf(m, name))).map((t) => t.kind + (t.off ? `:${t.off}` : '') + (t.event ? `:${t.event}` : ''));
    assert.deepEqual(kinds('空弦'), ['pos:1'], '自身及身前一格 +3 (进入休整期时)');
    assert.deepEqual(kinds('断崖'), ['pos:-1'], '自身及身后一格 +3');
    assert.deepEqual(kinds('引星棘刺'), ['pos:1']);
    assert.deepEqual(kinds('蛇屠箱'), ['row'], '同一行每有1名干员');
    assert.deepEqual(kinds('余'), ['row3'], '同一行有3名干员: a free operator');
    assert.deepEqual(kinds('歌蕾蒂娅'), ['row3']);
    assert.deepEqual(kinds('寒芒克洛丝'), ['grant'], 'the piece in front carries 开启技能时 +1');
    assert.deepEqual(kinds('凛御银灰'), ['grant']);
    assert.deepEqual(kinds('远牙'), ['mostRight'], 'the rightmost chess of the row');
    assert.deepEqual(kinds('魔王'), ['extra']);
    assert.deepEqual(kinds('铃兰'), ['trigger']);
    assert.deepEqual(kinds('白面鸮'), ['copy:SERVER_PREP_START']);
    assert.deepEqual(kinds('塞雷娅'), ['copy:SERVER_PREP_FIN']);
    assert.deepEqual(kinds('惊蛰'), [], '获得时 only');
    assert.equal(positionTraitsOf(m, ps, m.gd.chess(idOf(m, '凛御银灰')))[0].need, 'kjeragShip', 'a 谢拉格 in front only');
  } finally { h.dispose?.(); }
});

test('the rehearsal: fewer leaks first, then leader damage, then the layers the battle gained, then kills', () => {
  const battle = (leaks, killed, gains, boss = 0) => ({
    result: () => ({ perPlayer: { ai_0: { leaked: Array.from({ length: leaks }, () => ({ counted: true })), killed, bossDamage: boss, layerGains: gains } } }),
  });
  const s = new RehearsalScore('ai_0');
  assert.ok(s.note(battle(0, 30, {}), 0));
  assert.ok(s.note(battle(0, 29, { yanShip: 3, arcaneShip: 2 }), 1), 'more layers beat one more kill');
  assert.ok(!s.note(battle(0, 31, { yanShip: 4 }), 2), 'fewer layers lose to the kill count no longer');
  assert.ok(!s.note(battle(1, 40, { yanShip: 50 }), 3), 'a leak outranks any layers');
  assert.ok(s.note(battle(0, 30, { yanShip: 5 }), 4), 'equal layers: more kills');
  assert.equal(s.index, 4);
  const b = new RehearsalScore('ai_0');
  b.note(battle(0, 10, { yanShip: 9 }, 100), 0);
  assert.ok(b.note(battle(0, 10, {}, 200), 1), 'leader damage still before layers');
});

test('a 空弦 with an empty tile in front: the positional plan puts a chess there (the plan goes first in the rehearsal)', () => {
  const { h, m, ps } = solo();
  try {
    // three 拉特兰 (active), 空弦 among them, plus fillers; every piece stands somewhere legal
    const ids = [idOf(m, '空弦'), idOf(m, '隐现'), idOf(m, '能天使'), idOf(m, '送葬人')];
    const pieces = [];
    for (const id of ids) { const p = give(m, ps, id, 'hand'); pieces.push(p); }
    ps.recompute();
    const map = ps.deployMap();
    const tiles = [...map.keys()].map(parseKey).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    // 空弦 faces RIGHT on a tile whose right neighbour is free in the base plan; the others stand away from it
    const kong = pieces[0];
    const spot = tiles.find(([r, c]) => map.has(tileKey(r, c + 1)));
    assert.ok(spot, 'a tile with a legal right neighbour');
    const base = new LayoutPlan();
    base.set(kong.uid, tileKey(spot[0], spot[1])); base.dirs.set(kong.uid, 'RIGHT');
    const used = new Set([tileKey(spot[0], spot[1]), tileKey(spot[0], spot[1] + 1)]);
    for (const p of pieces.slice(1)) {
      const t = tiles.find(([r, c]) => !used.has(tileKey(r, c)) && Math.abs(r - spot[0]) + Math.abs(c - spot[1]) > 1);
      used.add(tileKey(t[0], t[1]));
      base.set(p.uid, tileKey(t[0], t[1])); base.dirs.set(p.uid, 'RIGHT');
    }
    const chosen = pieces.map((p) => ({ ...p }));
    const plan = run(positionPlanSteps(m, ps, chosen, base, { focus: 'lateranoShip' }));
    assert.ok(plan, 'a better arrangement exists');
    const at = parseKey(plan.get(kong.uid));
    const [dr, dc] = rotateOffset(0, 1, plan.dirs.get(kong.uid));
    const front = tileKey(at[0] + dr, at[1] + dc);
    assert.ok([...plan.values()].includes(front), `a chess stands in front of 空弦 (${front})`);
  } finally { h.dispose?.(); }
});

test('skill points go to the piece whose skill start adds layers: 菲莱 before a stronger non-caster', () => {
  const { h, m, ps } = solo();
  try {
    for (const name of ['菲莱', '莎草', '艾丝黛尔', '史尔特尔']) give(m, ps, idOf(m, name), 'board', legalTileFor(m, ps, idOf(m, name)));
    ps.recompute();
    assert.ok(ps.bonds.sargonShip?.active);
    const item = giveItem(m, ps, 'chess_item_3_05_e_a');
    const target = itemTarget(m, ps, item);
    assert.equal(m.gd.chess(target.id).name, '菲莱', '6 a cast on 萨尔贡 against 莎草\'s capped 5');
  } finally { h.dispose?.(); }
});

test('with an active 维多利亚 focus, equipment goes to a 维多利亚 member first', () => {
  const { h, m, ps } = solo();
  try {
    ps.bandId = 'band_harold';
    ps._botFocus = null;
    const vic = ['刺玫', '薄绿', '号角'].map((n) => idOf(m, n));
    for (const id of [...vic, idOf(m, '史尔特尔')]) give(m, ps, id, 'board', legalTileFor(m, ps, id));
    ps.recompute();
    assert.ok(ps.bonds.victoriaShip?.active);
    const [atk] = Object.entries(m.gd.raw.items).find(([id, it]) => it.itemType === 'EQUIP' && it.category === 'ON_HIT' && /_a$/.test(id)) || [];
    assert.ok(atk, 'an on-hit item');
    const target = itemTarget(m, ps, giveItem(m, ps, atk));
    assert.ok(m.gd.chess(target.id).bonds.includes('victoriaShip'), `${m.gd.chess(target.id).name} carries it`);
  } finally { h.dispose?.(); }
});

test('engine merges: the pair of a focus engine scores ENGINE_BONUS / 2 more, its third copy ENGINE_BONUS more, until the Final Assault', () => {
  const { h, m, ps } = solo();
  try {
    ps.bandId = 'band_duyaoy';
    const real = m.round;
    const at = (round, id) => { m.round = round; ps._botFocus = null; return buyScoreOf(m, ps, id); };
    const swing = (id) => at(m.gd.bossRound - 2, id) - at(m.gd.bossRound, id);
    const engine = 'chess_char_2_04_a', plain = 'chess_char_1_03_a'; // 小满 (an engine of 炎), 惊蛰 (获得时 only)
    const single = swing(engine) - swing(plain);
    give(m, ps, engine, 'hand'); give(m, ps, plain, 'hand');
    const pair = swing(engine) - swing(plain);
    give(m, ps, engine, 'hand'); give(m, ps, plain, 'hand');
    const third = swing(engine) - swing(plain);
    m.round = real;
    assert.ok(Math.abs(single - 10) < 1e-9, `no copy: engine-first only (${single})`);
    assert.ok(Math.abs(pair - 15) < 1e-9, `the second copy (${pair})`);
    assert.ok(Math.abs(third - 20) < 1e-9, `the merge (${third})`);
  } finally { h.dispose?.(); }
});
