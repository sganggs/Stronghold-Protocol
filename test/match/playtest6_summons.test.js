// User playtest #6 items 1 and 2 (both from a friend): 凯瑟琳's device and 赫默's drone could not be placed by hand.
// The official rule (PRTS 卫戍协议/帮助 §战斗部署): "如果部署的干员拥有可手动部署的附属召唤物，则该召唤物会立刻加入手牌区 …
// 根据召唤物部署数量上限（非初始持有量），发送等量召唤物至手牌区" — every manually deployable summon (shop state
// tokenDisplayType DEFAULT; 凯瑟琳's 爬行号·防护单元 has no entry and is deployable in the base game) is a hand card as
// soon as its owner stands on the board, a skill's summon only while that skill is equipped. The 2026-11-12 QoL keeps
// legally placed summons when their owner moves or swaps (replacing the older PRTS recall-all rule); a stack left in the
// 临时整备区 at the prep deadline "会于下一回合返还" (§手牌区). The battle side is test/content/playtest6_summons.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERR, PHASE } from '../../shared/constants.js';
import { checkLoadout } from '../../shared/protocol.js';
import { DATA, makeMatch, give, giveItem, checkInvariants, legalTileFor } from './harness.js';
import { botPrep } from '../../server/match/bot.js';

const SILENCE = 'chess_char_2_02_a';
const CATHY = 'chess_char_4_11_a';
const SHAMARE = 'chess_char_3_15_a';
const DRONE = 'token_10000_silent_healrb';
const DEVICE = 'token_10041_cathy_catsld';
const DOLL = 'token_10006_vodfox_doll';
const chess = (id) => (Object.hasOwn(DATA.chess, id) ? DATA.chess[id] : null);

function prep({ loadout = null, stageId = 'act2autochess_m04', seed = 11 } = {}) {
  const seats = [{ seat: 0, playerId: 'p_0', name: 'P0', isBot: false, connected: true, loadout }];
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seats, seed }).start();
  h.toPrep(1);
  h.setStage(stageId);
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  return { h, m: h.m, ps };
}

const tokensOf = (ps, id) => [...ps.hand, ...ps.temp, ...ps.board.values()].filter((p) => p && p.kind === 'token' && p.id === id);
const stackOf = (ps, id) => ps.hand.find((p) => p && p.kind === 'token' && p.id === id) ?? null;
const move = (m, uid, to, dir) => m.handle('p_0', { t: 'g.move', uid, to, ...(dir ? { dir } : {}) });

test('tokens.json: the manually deployable summons are hand pieces — 医疗探机, 诅咒娃娃, 爬行号·防护单元 with the talent ones', () => {
  const placeable = Object.values(DATA.tokens).filter((t) => t.placeable).map((t) => t.tokenId).sort();
  assert.deepEqual(placeable, [DRONE, DOLL, 'token_10017_skadi2_dedant', 'token_10028_vigil_wolf', 'token_10030_mlyss_wtrman', DEVICE].sort());
  // HIDDEN shop-state tokens stay battle-only (PRTS: 新约能天使 with 使命必达！ provides no 投递坐标 card)
  for (const t of Object.values(DATA.tokens)) if (t.displayType === 'HIDDEN') assert.equal(t.placeable, false, t.name);
  assert.equal(DATA.tokens.token_10056_angel2_target.placeable, false);
  // 凯瑟琳's device: no shop-state entry; the hand gets its deploy limit (2), not the 3 carried
  assert.equal(DATA.tokens[DEVICE].displayType, null);
  assert.equal(DATA.tokens[DEVICE].deployLimit, 2);
});

test('#2 赫默 on the board sends a 医疗探机 card to the hand; it is placed by hand like any summon (S2 only)', () => {
  const { m, ps } = prep();
  const hm = give(m, ps, SILENCE);
  const at = legalTileFor(m, ps, SILENCE);
  assert.deepEqual(move(m, hm.uid, { area: 'board', row: at[0], col: at[1] }), { ok: true });
  const stack = stackOf(ps, DRONE);
  assert.ok(stack, 'the drone card is in the hand');
  assert.equal(stack.ownerUid, hm.uid);
  assert.equal(stack.count, 1, 'deploy limit 1');
  const deployed = ps.deployCount;
  const t = legalTileFor(m, ps, SILENCE);
  assert.deepEqual(move(m, stack.uid, { area: 'board', row: t[0], col: t[1] }, 'UP'), { ok: true });
  const piece = ps.board.get(`${t[0]},${t[1]}`);
  assert.equal(piece.kind, 'token');
  assert.equal(piece.id, DRONE);
  assert.equal(piece.dir, 'UP');
  assert.equal(ps.deployCount, deployed, 'summons use no deploy slot (PRTS 医疗探机 部署占用数 0)');
  const input = ps.battleInput({ side: 'L', colOffset: 0 });
  assert.ok(input.units.some((u) => u.kind === 'token' && u.tokenId === DRONE && u.ownerUid === hm.uid && u.row === t[0] && u.col === t[1]));
  checkInvariants(m);
  m.dispose();
  // S1 治疗强化·γ型 makes no drone: no card
  const lo = checkLoadout({ [SILENCE]: { skill: 0 } }, chess).loadout;
  const s1 = prep({ loadout: lo });
  const hm1 = give(s1.m, s1.ps, SILENCE, 'board', [9, 3]);
  assert.ok(hm1);
  assert.equal(tokensOf(s1.ps, DRONE).length, 0, '赫默 S1: no drone card');
  s1.m.dispose();
});

test('#1 凯瑟琳 on the board sends her 支援装置 (2 = deploy limit) to the hand; both can be placed and turned', () => {
  const { m, ps } = prep();
  const cat = give(m, ps, CATHY);
  assert.deepEqual(move(m, cat.uid, { area: 'board', row: 10, col: 4 }), { ok: true });
  const stack = stackOf(ps, DEVICE);
  assert.ok(stack, 'the device card is in the hand');
  assert.equal(stack.count, 2);
  assert.deepEqual(move(m, stack.uid, { area: 'board', row: 10, col: 3 }, 'RIGHT'), { ok: true });
  assert.equal(stack.count, 1, 'one left on the card');
  assert.deepEqual(move(m, stack.uid, { area: 'board', row: 11, col: 4 }, 'DOWN'), { ok: true });
  const devs = [...ps.board.values()].filter((p) => p.kind === 'token' && p.id === DEVICE);
  assert.deepEqual(devs.map((p) => p.dir).sort(), ['DOWN', 'RIGHT']);
  assert.equal(stackOf(ps, DEVICE), null, 'the whole stack is on the board');
  checkInvariants(m);
  m.dispose();
});

test('巫恋 (S2 诅咒娃娃) sends a doll card like 赫默', () => {
  const { m, ps } = prep();
  give(m, ps, SHAMARE, 'board', [9, 3]);
  assert.equal(tokensOf(ps, DOLL).length, 1);
  m.dispose();
});

test('moving an owner keeps unrestricted summons on their original tiles with their facing and identity', () => {
  const { m, ps } = prep();
  const cat = give(m, ps, CATHY);
  assert.deepEqual(move(m, cat.uid, { area: 'board', row: 10, col: 4 }), { ok: true });
  const stack = stackOf(ps, DEVICE);
  assert.deepEqual(move(m, stack.uid, { area: 'board', row: 10, col: 3 }), { ok: true });
  assert.deepEqual(move(m, stack.uid, { area: 'board', row: 11, col: 4 }), { ok: true });
  assert.equal(ps.board.get('10,3')?.id, DEVICE);
  assert.equal(ps.board.get('11,4')?.id, DEVICE);
  // re-orienting in place is not a move: the devices stay
  assert.deepEqual(move(m, cat.uid, { area: 'board', row: 10, col: 4 }, 'UP'), { ok: true });
  assert.equal([...ps.board.values()].filter((p) => p.kind === 'token').length, 2);
  const before = [...ps.board.entries()].filter(([, p]) => p.kind === 'token').map(([key, piece]) => [key, structuredClone(piece)]);
  // A real move also keeps both unrestricted devices exactly where they were placed.
  assert.deepEqual(move(m, cat.uid, { area: 'board', row: 10, col: 7 }), { ok: true });
  assert.deepEqual([...ps.board.entries()].filter(([, p]) => p.kind === 'token'), before);
  assert.equal(stackOf(ps, DEVICE), null, 'no unnecessary stack is created');
  assert.equal(ps.battleInput().units.filter((u) => u.kind === 'token').length, 2);
  checkInvariants(m);
  m.dispose();
});

test('bots place the summon cards: 赫默\'s drone and 凯瑟琳\'s devices end up on the board, each device facing an operator', () => {
  for (const [owner, token] of [[SILENCE, DRONE], [CATHY, DEVICE]]) {
    const h = makeMatch({ mode: 'coop', humans: 1, bots: 1, seed: 21 }).start();
    h.toPrep(2);
    const bp = h.ps('ai_0');
    for (const p of [...bp.board.values(), ...bp.hand.filter(Boolean)]) if (p.kind === 'chess') bp.returnCopies(p);
    bp.board.clear();
    bp.hand.fill(null);
    bp.recompute();
    give(h.m, bp, 'chess_char_1_10_a');   // 古米: a blocker for the devices to face
    give(h.m, bp, owner);
    botPrep(h.m, bp);
    const placed = [...bp.board.entries()].filter(([, p]) => p.kind === 'token' && p.id === token);
    assert.ok(placed.length >= 1, `${token}: placed by the bot`);
    if (token === DEVICE) {
      for (const [k, p] of placed) {
        const [r, c] = k.split(',').map(Number);
        const d = { RIGHT: [0, 1], LEFT: [0, -1], UP: [1, 0], DOWN: [-1, 0] }[p.dir ?? 'RIGHT'];
        const front = bp.board.get(`${r + d[0]},${c + d[1]}`);
        assert.ok(front && front.kind === 'chess', `device at ${k} faces an operator (${p.dir})`);
      }
    }
    h.m.dispose();
  }
});

test('bots re-aim placed devices with every layout: a device left facing an operator the plan moved away is lifted and placed again (QA)', () => {
  // the bot arranges twice (before and after its items) and may switch to the rehearsed plan: operators moved without
  // their summons left 凯瑟琳's devices facing an empty tile (3.5–8.6 % of devices in QA's bot matches)
  const D = { RIGHT: [0, 1], LEFT: [0, -1], UP: [1, 0], DOWN: [-1, 0] };
  const others = ['chess_char_1_10_a', 'chess_char_2_02_a', 'chess_char_1_01_a', 'chess_char_1_02_a', 'chess_char_1_03_a', 'chess_char_1_04_a'];
  let devices = 0;
  for (const seed of [21, 22, 23, 24, 25, 26, 27, 28]) {
    const h = makeMatch({ mode: 'coop', humans: 1, bots: 1, seed }).start();
    h.toPrep(seed % 2 ? 3 : 5);
    const bp = h.ps('ai_0');
    for (const p of [...bp.board.values(), ...bp.hand.filter(Boolean)]) if (p.kind === 'chess') bp.returnCopies(p);
    bp.board.clear();
    bp.hand.fill(null);
    bp.recompute();
    // a hand-made layout the bot will rearrange: every operator on the first legal tile, both devices facing one of them
    for (const id of [CATHY, ...others.slice(0, bp.deployCap - 1)]) {
      const p = give(h.m, bp, id);
      const t = legalTileFor(h.m, bp, id);
      if (t) bp.move(p.uid, { area: 'board', row: t[0], col: t[1] }, 'RIGHT');
    }
    const [fk] = [...bp.board.entries()].find(([, p]) => p.kind === 'chess' && p.id !== CATHY);
    const [fr, fc] = fk.split(',').map(Number);
    for (const [dr, dc, dir] of [[0, -1, 'RIGHT'], [1, 0, 'DOWN'], [-1, 0, 'UP'], [0, 1, 'LEFT']]) {
      const stack = stackOf(bp, DEVICE);
      if (!stack) break;
      if (!bp.board.has(`${fr + dr},${fc + dc}`)) bp.move(stack.uid, { area: 'board', row: fr + dr, col: fc + dc }, dir);
    }
    botPrep(h.m, bp);
    for (const [k, p] of bp.board) {
      if (p.kind !== 'token' || p.id !== DEVICE) continue;
      devices++;
      const [r, c] = k.split(',').map(Number);
      const d = D[p.dir ?? 'RIGHT'];
      const front = bp.board.get(`${r + d[0]},${c + d[1]}`);
      assert.ok(front && front.kind === 'chess', `seed ${seed}: the device at ${k} (${p.dir}) faces an operator`);
    }
    checkInvariants(h.m);
    h.m.dispose();
  }
  assert.ok(devices >= 12, `devices checked: ${devices}`);
});

test('a summon card needs its owner on the board; the owner withdrawn takes its summons along', () => {
  const { m, ps } = prep();
  const hm = give(m, ps, SILENCE);
  assert.deepEqual(move(m, hm.uid, { area: 'board', row: 10, col: 4 }), { ok: true });
  const stack = stackOf(ps, DRONE);
  assert.deepEqual(move(m, stack.uid, { area: 'board', row: 10, col: 5 }), { ok: true });
  const free = ps.hand.findIndex((x) => x == null);
  assert.deepEqual(move(m, hm.uid, { area: 'hand', idx: free }), { ok: true });
  assert.equal(tokensOf(ps, DRONE).length, 0, 'withdrawn with its owner');
  // back on the board: a new card; it cannot be placed once the owner is gone again, and summons are not sold
  const at = legalTileFor(m, ps, SILENCE);
  assert.deepEqual(move(m, hm.uid, { area: 'board', row: at[0], col: at[1] }), { ok: true });
  const card = stackOf(ps, DRONE);
  assert.ok(card);
  assert.equal(m.handle('p_0', { t: 'g.sell', uid: card.uid }).error, ERR.BAD_TARGET);
  checkInvariants(m);
  m.dispose();
});

test('a summon dragged onto an operator preserves the displaced owner\'s other legal summons', () => {
  const { m, ps } = prep();
  const cat = give(m, ps, CATHY);
  const hm = give(m, ps, SILENCE);
  assert.deepEqual(move(m, cat.uid, { area: 'board', row: 10, col: 4 }), { ok: true });
  assert.deepEqual(move(m, hm.uid, { area: 'board', row: 10, col: 7 }), { ok: true });
  const devCard = stackOf(ps, DEVICE);
  assert.deepEqual(move(m, devCard.uid, { area: 'board', row: 10, col: 3 }), { ok: true });
  assert.deepEqual(move(m, devCard.uid, { area: 'board', row: 11, col: 4 }, 'UP'), { ok: true });
  assert.deepEqual(move(m, stackOf(ps, DRONE).uid, { area: 'board', row: 10, col: 8 }), { ok: true });
  // 凯瑟琳's device (10,3) dropped onto 赫默 (10,7): 赫默 takes 10,3, while her unrestricted drone stays.
  const devA = ps.board.get('10,3');
  assert.deepEqual(move(m, devA.uid, { area: 'board', row: 10, col: 7 }), { ok: true });
  assert.equal(ps.board.get('10,3')?.uid, hm.uid);
  assert.equal(ps.board.get('10,7')?.uid, devA.uid, 'the dragged device is where it was dropped');
  assert.equal(ps.board.get('10,8')?.id, DRONE, '赫默\'s drone stays on its original tile');
  assert.equal(stackOf(ps, DRONE), null);
  assert.equal(ps.board.get('11,4')?.id, DEVICE, '凯瑟琳\'s other device stays');
  // the other device (11,4) dropped onto its own owner (10,4): 凯瑟琳 takes 11,4; the dropped device stays at 10,4, her
  // remaining placed device (10,7) also stays
  const devB = ps.board.get('11,4');
  assert.deepEqual(move(m, devB.uid, { area: 'board', row: 10, col: 4 }), { ok: true });
  assert.equal(ps.board.get('11,4')?.uid, cat.uid);
  assert.equal(ps.board.get('10,4')?.uid, devB.uid);
  assert.equal(ps.board.get('10,7'), devA);
  assert.equal(stackOf(ps, DEVICE), null);
  assert.equal(tokensOf(ps, DEVICE).reduce((n, p) => n + (p.count || 1), 0), 2, 'still 2 devices in all');
  checkInvariants(m);
  m.dispose();
});

/** Plain equipment (no equip / merge side effects) to fill the hand. */
const PLAIN = Object.values(DATA.items).filter((i) => i.itemType === 'EQUIP' && !i.isGolden && i.kind === 'passive').map((i) => i.itemId ?? i.id).filter(Boolean);

test('a summon stack left in temp at the prep deadline comes back next round (PRTS "干员所属召唤物会于下一回合返还")', () => {
  // co-op of 2 humans: a timed prep whose deadline resolves temp (PlayerState.resolveTemp), FakeBattle
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 1601, fake: true }).start();
  h.toPrep(1);
  h.setStage('act2autochess_m04');
  const m = h.m;
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
  const vigil = give(m, ps, 'chess_char_3_19_a');
  assert.deepEqual(move(m, vigil.uid, { area: 'board', row: 10, col: 4 }), { ok: true });
  const card = stackOf(ps, 'token_10028_vigil_wolf');
  assert.deepEqual(move(m, card.uid, { area: 'board', row: 11, col: 5 }), { ok: true });
  for (let i = 0; ps.hand.some((x) => x == null); i++) giveItem(m, ps, PLAIN[i]);
  // Moving 伺夜 with a full hand leaves her wolf outside the new range; it overflows into temp and blocks Ready
  assert.deepEqual(move(m, vigil.uid, { area: 'board', row: 10, col: 7 }), { ok: true });
  const inTemp = ps.temp.find((p) => p && p.kind === 'token' && p.id === 'token_10028_vigil_wolf');
  assert.equal(inTemp?.count, 1);
  assert.deepEqual(m.handle('p_0', { t: 'g.ready', ready: true }), { error: ERR.TEMP_NOT_EMPTY });
  // the player leaves it there: the prep deadline removes the temp card …
  h.drive(() => m.phase === PHASE.COMBAT && m.round === 1, { ready: false });
  assert.equal(tokensOf(ps, 'token_10028_vigil_wolf').length, 0, 'removed with the temp slot at the deadline');
  // … and it comes back at the next round (still a full hand ⇒ temp again, where it can be placed)
  h.drive(() => m.phase === PHASE.PREP && m.round === 2, { ready: false });
  const back = tokensOf(ps, 'token_10028_vigil_wolf');
  assert.equal(back.length, 1);
  assert.equal(back[0].count, 1, 'the deploy limit again');
  assert.equal(back[0].ownerUid, vigil.uid);
  assert.deepEqual(move(m, back[0].uid, { area: 'board', row: 10, col: 8 }, 'RIGHT'), { ok: true });
  assert.ok(ps.tempEmpty, 'placing the wolf cleared temp');
  // a later round start grants nothing more: the wolf is on the board
  h.drive(() => m.phase === PHASE.PREP && m.round === 3);
  assert.equal(tokensOf(ps, 'token_10028_vigil_wolf').reduce((n, p) => n + (p.count || 1), 0), 1);
  checkInvariants(m);
  m.dispose();
});
