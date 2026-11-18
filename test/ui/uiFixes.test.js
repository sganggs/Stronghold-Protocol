// Regression tests for in-match UI defects (round-1 hunt): terrain 机变 cards in the client placement mirror, the
// result screen (hidden medal, rounds on a Hidden Core clear, remaining LP after the Final Assault), briefing bond
// labels, watch targets, the view-switcher label, equipment dropped on an operator's tile, illegal-drop reasons,
// full-hand shop cards, the solo exit text and htm's static vnode cache.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch, give, chessOfTier } from '../match/harness.js';
import { buildDeployMap } from '../../server/match/board.js';
import { applyCard } from '../../server/match/choices.js';
import {
  placementContext, canPlace, deploySets, stageOverrides, deployMap, effectiveStage, normalizeResult, disabledBondSets,
  briefingBondTip, watchTarget, switcherLabel, dropIntent, dropFailureReason, shopBlockReason,
  completesMerge, handFull, tileKey,
} from '../../public/js/ui/gameLogic.js';
import { PHASE, GEO } from '../../shared/constants.js';

const getChess = (id) => DATA.chess[id] || null;
const getItem = (id) => DATA.items[id] || null;
const getToken = (id) => DATA.tokens[id] || null;
const getEffect = (id) => DATA.effects[id] || null;
const TERRAIN = DATA.choices.cards.tactic.filter((c) => c.kind === 'terrain');

/** Client deploy class of every own-board tile ('melee' | 'ranged' | null). */
function clientClasses(deploy) {
  const out = new Map();
  for (let r = GEO.FIELD.r0; r <= GEO.FIELD.r1; r++) {
    for (let c = GEO.FIELD.c0; c <= GEO.FIELD.c1; c++) {
      const k = tileKey(r, c);
      out.set(k, deploy.melee.has(k) ? 'melee' : deploy.ranged.has(k) ? 'ranged' : null);
    }
  }
  return out;
}

function pickTerrain(card, seed = 3) {
  const h = makeMatch({ mode: 'coop', difficulty: 'FUNNY', humans: 1, bots: 1, seed, fake: true });
  h.start();
  h.setStage(card.stageId);
  h.toPrep(1);
  const ps = h.ps('p_0');
  applyCard(h.m, ps, { kind: 'tactic', id: card.effectId, team: false, tacticKind: 'terrain', family: 'tactic', idx: 0 });
  return { h, ps, stage: DATA.stages[card.stageId] };
}

describe('terrain 机变 cards (模拟战场演变) in the placement mirror', () => {
  test('there are terrain cards that change the own board', () => {
    assert.ok(TERRAIN.length >= 6);
  });

  for (const card of TERRAIN) {
    test(`${card.effectId}: client deploy tiles equal the server's per-player deploy map`, () => {
      const { ps, stage } = pickTerrain(card);
      const server = buildDeployMap(stage, { deviceOverrides: ps.deviceOverrides, tileOverrides: ps.tileOverrides });
      const ctx = placementContext({ priv: ps.privateView(), stage, editable: true, getChess, getToken, getItem, getEffect });
      const client = clientClasses(ctx.deploy);
      for (const [k, cls] of client) assert.equal(cls, server.get(k) ?? null, `${card.effectId} tile ${k}`);
    });
  }

  test('map_m01_1: a melee operator may now stand on a freed crate tile (client agrees with the server)', () => {
    const card = TERRAIN.find((c) => c.effectId === 'map_m01_1');
    const { h, ps, stage } = pickTerrain(card);
    assert.equal(deploySets(stage).melee.has('10,5'), false, 'a crate blocks (10,5) on the plain stage');
    const melee = chessOfTier(1, (c) => c.position === 'MELEE')[0];
    const piece = give(h.m, ps, melee, 'hand');
    const ctx = placementContext({ priv: ps.privateView(), stage, editable: true, getChess, getToken, getItem, getEffect });
    assert.deepEqual(canPlace(ctx, piece.uid, { area: 'board', row: 10, col: 5 }), { ok: true, action: 'move' });
    assert.deepEqual(h.m.handle('p_0', { t: 'g.move', uid: piece.uid, to: { area: 'board', row: 10, col: 5 } }), { ok: true });
  });

  test('map_m03_2: ranged-only platform tiles become ground (melee allowed)', () => {
    const card = TERRAIN.find((c) => c.effectId === 'map_m03_2');
    const { ps, stage } = pickTerrain(card);
    const ctx = placementContext({ priv: ps.privateView(), stage, editable: true, getChess, getToken, getItem, getEffect });
    assert.ok(ctx.deploy.melee.has('11,7') && ctx.deploy.melee.has('11,8'));
  });

  test('m.private deviceOverrides / tileOverrides (when the server sends them) win over the derivation', () => {
    const stage = DATA.stages.act1autochess_m01;
    const priv = { deviceOverrides: { 'trap_1105_accrate#001': false }, tileOverrides: { '9,3': 'none' }, effects: [] };
    const ov = stageOverrides(priv, getEffect);
    assert.deepEqual(ov, { deviceOverrides: { 'trap_1105_accrate#001': false }, tileOverrides: { '9,3': 'none' } });
    const map = deployMap(stage, ov);
    const server = buildDeployMap(stage, ov);
    assert.deepEqual([...map.entries()].sort(), [...server.entries()].sort());
  });

  test('deployMap mirrors buildDeployMap for every stage without overrides', () => {
    for (const [id, stage] of Object.entries(DATA.stages)) {
      assert.deepEqual([...deployMap(stage).entries()].sort(), [...buildDeployMap(stage).entries()].sort(), id);
    }
  });

  test('effectiveStage: removed crates are inactive for the renderer, unchanged stage without overrides', () => {
    const stage = DATA.stages.act1autochess_m01;
    assert.equal(effectiveStage(stage, { deviceOverrides: {}, tileOverrides: {} }), stage);
    const eff = effectiveStage(stage, stageOverrides({ effects: [{ id: 'choice:map_m01_1#77' }] }, getEffect));
    assert.deepEqual(stageOverrides({ effects: [{ id: 'map_m01_1#77' }] }, getEffect), stageOverrides({ effects: [{ id: 'choice:map_m01_1#77' }] }, getEffect));
    const crate = eff.devices.find((d) => d.alias === 'trap_1105_accrate#001');
    assert.equal(crate.active, false);
    assert.equal(stage.devices.find((d) => d.alias === 'trap_1105_accrate#001').active !== false, true, 'data record untouched');
    // band entries (no '#<uid>') are not 机变 picks
    assert.deepEqual(stageOverrides({ effects: [{ id: 'aceffect_band_43' }] }, getEffect).deviceOverrides, {});
  });
});

describe('result screen', () => {
  const base = { victory: false, roundsPassed: 4, hiddenBossId: 'boss_8', bossId: 'boss_5', players: [] };
  test('the Hidden Core medal needs the Hidden Core to have been reached', () => {
    assert.equal(normalizeResult({ ...base, hiddenReached: false }, null).hiddenReached, false);
    assert.equal(normalizeResult({ ...base }, null).hiddenReached, false);
    assert.equal(normalizeResult({ ...base, victory: true, hiddenReached: true }, null).hiddenReached, true);
    assert.equal(normalizeResult({ ...base, victory: true, hiddenCleared: true }, null).hiddenReached, true);
  });

  test('remaining LP after the Final Assault is the merged team pool, not the stale own LP', () => {
    const res = {
      victory: false, roundsPassed: 13, players: [
        { playerId: 'a', seat: 0, alive: true, lp: 7 },
        { playerId: 'b', seat: 1, alive: false, lp: 0 },
      ],
    };
    const pub = { teamLp: 0, players: [{ playerId: 'a', seat: 0 }, { playerId: 'b', seat: 1 }] };
    const r = normalizeResult(res, pub);
    assert.equal(r.players[0].lp, 0, 'defeat by the team LP hitting 0 shows 0 left');
    assert.equal(r.players[0].lpShared, true);
    assert.equal(r.players[1].lp, 0);
    assert.equal(normalizeResult(res, { ...pub, teamLp: 16 }).players[0].lp, 16);
    // no Final Assault: own LP
    const plain = normalizeResult(res, { players: pub.players });
    assert.equal(plain.players[0].lp, 7);
    assert.equal(plain.players[0].lpShared, false);
  });
});

describe('briefing bond labels', () => {
  test('drawn bonds read "部分盟约所含干员阵容不完整" (still activatable), static ones "本局禁用"', () => {
    const pub = { disabledBonds: ['a', 'b', 's'], drawnDisabledBonds: ['a', 'b'] };
    const sets = disabledBondSets(pub, ['s']);
    assert.deepEqual([...sets.drawn].sort(), ['a', 'b']);
    assert.deepEqual([...sets.off], ['s']);
    const tip = briefingBondTip('坚守', 'drawn', 2);
    assert.match(tip, /部分盟约所含干员阵容不完整/);
    assert.doesNotMatch(tip, /本局禁用/);
    assert.match(briefingBondTip('坚守', 'off', 0), /本局禁用/);
    assert.equal(briefingBondTip('坚守', null, 0), '坚守');
    // older payloads: disabledBonds minus the static list
    assert.deepEqual([...disabledBondSets({ disabledBonds: ['a', 's'] }, ['s']).drawn], ['a']);
  });
});

describe('watch targets and the view switcher', () => {
  const pub = {
    phase: PHASE.FINAL_ASSAULT,
    players: [
      { playerId: 'me', seat: 0, alive: true, fieldId: 'b1', name: '我' },
      { playerId: 'mate', seat: 1, alive: true, fieldId: 'b1', name: '搭档' },
      { playerId: 'x', seat: 2, alive: true, fieldId: 'b2', name: '另一组' },
      { playerId: 'dead', seat: 3, alive: false, fieldId: null, name: '倒下' },
    ],
    fields: [
      { fieldId: 'b1', kind: 'boss', players: ['me', 'mate'], live: true },
      { fieldId: 'b2', kind: 'boss', players: ['x'], live: true },
    ],
  };
  test('the other pair of a Final Assault is watchable; eliminated teammates remain unavailable', () => {
    assert.deepEqual(watchTarget(pub.players[2], pub, 'me'), { fieldId: 'b2' });
    assert.match(watchTarget(pub.players[3], pub, 'me').reason, /淘汰/);
    assert.deepEqual(watchTarget(pub.players[1], pub, 'me'), { fieldId: 'b1' });
    // an eliminated spectator may watch any boss field
    const dead = { ...pub, players: pub.players.map((p) => (p.playerId === 'me' ? { ...p, alive: false, fieldId: null } : p)), fields: [pub.fields[1]] };
    assert.deepEqual(watchTarget(pub.players[2], dead, 'me'), { fieldId: 'b2' });
    // prep scouting: the teammate's own board
    assert.deepEqual(watchTarget(pub.players[1], { ...pub, phase: PHASE.PREP }, 'me'), { fieldId: 'n:mate' });
  });

  test('switcher label names a watched field whose battle already ended', () => {
    const cpub = {
      phase: PHASE.COMBAT,
      players: [{ playerId: 'me', seat: 0, alive: false, name: '我' }, { playerId: 'ai_1', seat: 1, alive: true, name: 'AI·华法琳' }],
      fields: [{ fieldId: 'n:ai_1', kind: 'normal', players: ['ai_1'], live: false }, { fieldId: 'n:p3', kind: 'normal', players: ['p3'], live: true }],
    };
    assert.equal(switcherLabel(cpub, 'n:ai_1', 'me', true), 'AI·华法琳');
    assert.equal(switcherLabel(cpub, null, 'me', true), '观战');
    assert.equal(switcherLabel(cpub, null, 'me', false), '自己');
  });
});

describe('equipment dropped on an operator', () => {
  const ITEM = 'chess_item_1_01_e_a';
  const RANGED = 'chess_char_1_01_a';
  const priv = {
    alive: true, ready: false, funds: 10, deployCap: 8, deployCount: 2,
    board: [
      { uid: 1, kind: 'chess', id: RANGED, row: 9, col: 3, items: [] },
      { uid: 2, kind: 'chess', id: RANGED, row: 10, col: 3, items: [] },
    ],
    hand: [{ uid: 3, kind: 'item', id: ITEM }, ...new Array(GEO.HAND_SIZE - 1).fill(null)],
    temp: new Array(GEO.TEMP_SIZE).fill(null),
    shop: { slots: [] },
  };
  const ctx = placementContext({ priv, stage: DATA.stages.act2autochess_m01, editable: true, getChess, getToken, getItem });

  test('an item dropped on the unit\'s own tile equips it; the tile behind it (where its head is drawn) does not (user playtest #4 item 1: the tile decides)', () => {
    const head = { area: 'board', row: 11, col: 3 }; // the empty tile behind unit 2 (10,3), where its head is drawn
    assert.equal(canPlace(ctx, 3, head).ok, false, 'the tile itself is empty: nothing to equip there');
    assert.equal(dropIntent(ctx, 3, head), null);
    assert.deepEqual(dropIntent(ctx, 3, { area: 'board', row: 10, col: 3 }), { t: 'g.equip', fields: { itemUid: 3, targetUid: 2 }, confirmReplace: false });
    assert.deepEqual(dropIntent(ctx, 3, { area: 'board', row: 9, col: 3 }), { t: 'g.equip', fields: { itemUid: 3, targetUid: 1 }, confirmReplace: false });
  });
});

describe('illegal drops say why', () => {
  const MELEE = 'chess_char_1_02_a';
  const priv = {
    alive: true, ready: false, funds: 10, deployCap: 1, deployCount: 1,
    board: [{ uid: 1, kind: 'chess', id: 'chess_char_1_01_a', row: 9, col: 3, items: [] }],
    hand: [{ uid: 2, kind: 'chess', id: MELEE, items: [] }, { uid: 3, kind: 'item', id: 'chess_item_1_01_e_a' }, ...new Array(GEO.HAND_SIZE - 2).fill(null)],
    temp: new Array(GEO.TEMP_SIZE).fill(null),
    shop: { slots: [] },
  };
  const ctx = placementContext({ priv, stage: DATA.stages.act2autochess_m01, editable: true, getChess, getToken, getItem });
  test('reasons for board tiles, lanes and the temporary bench; none for the own slot', () => {
    const melee = [...ctx.deploy.melee].map((k) => k.split(',').map(Number)).find(([r, c]) => !(r === 9 && c === 3));
    assert.equal(dropFailureReason(ctx, 2, { row: melee[0], col: melee[1], area: 'board' }), '已达到部署上限');
    assert.equal(dropFailureReason(ctx, 3, { row: melee[0], col: melee[1], area: 'board' }), '请将装备拖拽至干员身上');
    assert.equal(dropFailureReason(ctx, 2, { row: GEO.TEMP_ROW, col: GEO.TEMP_C0, area: 'temp', idx: 0 }), '临时整备区无法放入单位');
    assert.equal(dropFailureReason(ctx, 2, { row: GEO.HAND_ROW, col: 0, area: 'hand', idx: 0 }), null, 'own slot');
    assert.equal(dropFailureReason(ctx, 2, { row: 3, col: 5, area: null }), null, 'far from the board');
    const lane = [9, 10, 11, 12].flatMap((r) => [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((c) => [r, c])).find(([r, c]) => c < GEO.FIELD.c0);
    assert.equal(dropFailureReason(ctx, 2, { row: lane[0], col: lane[1], area: null }), '无法部署在该位置');
  });
  test('a melee operator on a never-deployable tile is not told to use the ground', () => {
    const blocked = [];
    for (let r = GEO.FIELD.r0; r <= GEO.FIELD.r1; r++) for (let c = GEO.FIELD.c0; c <= GEO.FIELD.c1; c++) if (!ctx.deploy.ranged.has(tileKey(r, c))) blocked.push([r, c]);
    assert.ok(blocked.length > 0);
    const free = { ...ctx, count: 0 };
    assert.equal(canPlace(free, 2, { area: 'board', row: blocked[0][0], col: blocked[0][1] }).reason, '无法部署在该位置');
  });
});

describe('full hand: shop and promotion cards', () => {
  const MELEE = 'chess_char_1_02_a';
  const other = Object.values(DATA.chess).find((c) => c.visible && !c.isGolden && c.tier === 1 && c.chessId !== MELEE).chessId;
  const fullHand = (pieces) => { const h = new Array(GEO.HAND_SIZE).fill(null).map((_, i) => pieces[i] || { uid: 100 + i, kind: 'item', id: 'chess_item_1_01_e_a' }); return h; };
  const privFull = { alive: true, ready: false, funds: 20, board: [], temp: new Array(GEO.TEMP_SIZE).fill(null), shop: {},
    hand: fullHand([{ uid: 1, kind: 'chess', id: MELEE, items: [] }, { uid: 2, kind: 'chess', id: MELEE, items: [] }]) };
  const o = { priv: privFull, editable: true, getChess, getItem };
  test('every card is blocked with 整备区已满, one completing a merge too (PRTS 卫戍协议/帮助 §手牌区, GitHub #82)', () => {
    assert.equal(handFull(privFull), true);
    assert.equal(shopBlockReason('buy', { ...o, slot: { kind: 'chess', id: other, price: 1 } }), '整备区已满');
    assert.equal(completesMerge(privFull, { kind: 'chess', id: MELEE }, o), true);
    assert.equal(shopBlockReason('buy', { ...o, slot: { kind: 'chess', id: MELEE, price: 1 } }), '整备区已满', 'the third copy of a held pair');
    assert.equal(shopBlockReason('reward', { ...o, slot: { kind: 'chess', id: other, price: 0 } }), '整备区已满');
    assert.equal(shopBlockReason('reward', { ...o, slot: { kind: 'chess', id: MELEE, price: 0 } }), '整备区已满', 'a merge-completing pick');
    // the hand is filled with a mergeable equipment: another copy would merge, but the purchase is refused all the same
    assert.equal(completesMerge(privFull, { kind: 'item', id: 'chess_item_1_01_e_a' }, o), true);
    assert.equal(shopBlockReason('buy', { ...o, slot: { kind: 'item', id: 'chess_item_1_01_e_a', price: 1 } }), '整备区已满');
    const notFull = { ...privFull, hand: privFull.hand.map((p, i) => (i === 5 ? null : p)) };
    assert.equal(shopBlockReason('buy', { ...o, priv: notFull, slot: { kind: 'chess', id: other, price: 1 } }), null);
    assert.equal(shopBlockReason('buy', { ...o, priv: notFull, slot: { kind: 'chess', id: MELEE, price: 1 } }), null);
  });
});

describe('solo exit text and htm vnodes', () => {
  test('the solo quit text does not promise a settlement', async () => {
    const { EXIT_TEXT } = await import('../../public/js/ui/matchChrome.js');
    assert.doesNotMatch(EXIT_TEXT.soloQuit, /直接结算/);
    assert.match(EXIT_TEXT.soloQuit, /返回大厅/);
  });

  test('static templates give fresh vnodes (no shared, DOM-holding cached vnode)', async () => {
    const { html } = await import('../../public/js/ui/components.js');
    const f = () => html`<div class="a"><span>static</span></div>`;
    const g = (x) => html`<div class="b"><span>static</span><i>${x}</i></div>`;
    assert.notEqual(f(), f());
    assert.notEqual(g(1).props.children[0], g(2).props.children[0]);
  });
});
