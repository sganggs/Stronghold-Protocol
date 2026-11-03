// Gaps found while triaging GitHub issues #1 / #8 (DESIGN §21.26) — the server side.
//   2. 调和's +1: computeBonds marks a core bond's state whose count holds 调和's +1 (`harmony: 1`); the views send it
//      (m.private bonds, m.public players[].bonds — a teammate's strip and popup), the battle input does not. The popup
//      that reads it: test/ui/feedback1-gaps.test.js.
//   3. Bots never pick a strategy built around a bond the mode switches off: GameData.bandBondIds reads the tie from the
//      band's own data (its <bond> names, its blackboards' bond ids and bond pools); botPickBand gives such a band weight 0
//      — in 标准 潘格尼尼 (<拉特兰>, pool_char_later), 克莱门莎 (<阿戈尔>), 玛恩纳 (<卡西米尔>). Before: 5 of 200 solo picks and
//      23 of 800 co-op picks (seeds 1–200) were one of them; the other modes keep exactly the earlier picks.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PHASE } from '../../shared/constants.js';
import { GameData } from '../../server/match/gamedata.js';
import { computeBonds, bondList, bondSnapshot, bondsWithGains, HARMONY_BOND } from '../../server/match/bondsMeta.js';
import { botPickBand, bandStrength } from '../../server/match/bot.js';
import { tileKey } from '../../server/match/board.js';
import { validateClientResult } from '../../server/match/fields.js';
import { bandBondIds as bandBondIdsOf } from '../../shared/bandBonds.js';
import { DATA, makeMatch, give, legalTileFor, checkInvariants } from './harness.js';
import { designText } from '../helpers/designDocs.js';

const MLYSS = 'chess_char_6_11_a'; // 缪尔赛思 (调和)
const members = (bond, n) => Object.values(DATA.chess).filter((c) => c.visible && !c.isGolden && c.bonds.includes(bond) && !c.bonds.includes(HARMONY_BOND)).map((c) => c.chessId).sort().slice(0, n);
let uid = 1;
const piece = (id) => ({ uid: uid++, kind: 'chess', id, items: [] });
const state = (board, hand = []) => {
  const b = new Map();
  board.forEach((p, i) => b.set(`${9 + (i % 4)},${2 + Math.floor(i / 4)}`, p));
  const h = new Array(10).fill(null);
  hand.forEach((p, i) => { h[i] = p; });
  return { board: b, hand: h, layers: {} };
};

describe('§21.26 2 — 调和\'s +1 in the bond states and views', () => {
  const gd = new GameData(DATA, 'mode_multi_normal');

  test('computeBonds: `harmony: 1` exactly on the core bonds whose count holds the +1 — never an add-on bond, a core bond without a member, or 调和 itself', () => {
    const yan = members('yanShip', 2);
    const preci = members('preciShip', 1);
    const s = computeBonds(gd, state([piece(MLYSS), ...yan.map(piece), ...preci.map(piece)]));
    assert.equal(s[HARMONY_BOND].active, true);
    assert.deepEqual(s.yanShip, { count: 3, active: true, tier: 1, layers: 0, harmony: 1 });
    for (const [id, b] of Object.entries(s)) {
      if (id === 'yanShip') continue;
      assert.ok(!('harmony' in b), `${id}: no harmony (core with members: ${DATA.bonds[id].isCore && b.count > 0})`);
    }
    // the same board without 调和: no mark anywhere, the count is the real one
    const bare = computeBonds(gd, state([...yan.map(piece), ...preci.map(piece)]));
    assert.deepEqual(bare.yanShip, { count: 2, active: false, tier: 0, layers: 0 });
    assert.ok(Object.values(bare).every((b) => !('harmony' in b)));
    // 调和 on the bench does nothing (BOARD)
    const bench = computeBonds(gd, state(yan.map(piece), [piece(MLYSS)]));
    assert.equal(bench.yanShip.count, 2);
    assert.ok(!('harmony' in bench.yanShip));
  });

  test('bondList carries it (m.private and m.public), bondsWithGains keeps it, bondSnapshot (the battle input) leaves it out', () => {
    const s = computeBonds(gd, state([piece(MLYSS), ...members('yanShip', 2).map(piece)]));
    const full = bondList(gd, s, { full: true }).find((b) => b.bondId === 'yanShip');
    assert.deepEqual(full, { bondId: 'yanShip', count: 3, active: true, tier: 1, layers: 0, harmony: 1, thresholds: [3, 6, 9], countsHand: false });
    const pub = bondList(gd, s).find((b) => b.bondId === 'yanShip');
    assert.deepEqual(pub, { bondId: 'yanShip', count: 3, active: true, tier: 1, layers: 0, harmony: 1 });
    assert.ok(bondList(gd, s).filter((b) => b.bondId !== 'yanShip').every((b) => !('harmony' in b)));
    assert.equal(bondsWithGains(s, { yanShip: 4 }).yanShip.harmony, 1, 'the battle\'s gains keep the mark');
    assert.deepEqual(bondSnapshot(s).yanShip, { count: 3, active: true, tier: 1, layers: 0 }, 'the battle reads count / active / tier / layers only');
  });

  test('a real co-op match: the deploying player\'s m.private and their m.public row (a teammate\'s strip) say the count holds the +1', () => {
    const h = makeMatch({ mode: 'coop', humans: 2, seed: 2612, fake: true }).start();
    h.toPrep(1);
    const m = h.m;
    const ps = h.ps('p_1');
    ps.board.clear();
    const used = new Set();
    for (const id of [MLYSS, ...members('yanShip', 2)]) {
      const t = legalTileFor(m, ps, id, used);
      used.add(tileKey(t[0], t[1]));
      give(m, ps, id, 'board', t);
    }
    ps.recompute();
    const own = ps.privateView().bonds.find((b) => b.bondId === 'yanShip');
    assert.equal(own.count, 3);
    assert.equal(own.harmony, 1);
    const row = m.publicView().players.find((p) => p.playerId === 'p_1').bonds.find((b) => b.bondId === 'yanShip');
    assert.deepEqual(row, { bondId: 'yanShip', count: 3, active: true, tier: 1, layers: 0, harmony: 1 }, 'what p_0 reads when watching p_1');
    assert.ok(m.publicView().players.find((p) => p.playerId === 'p_0').bonds.every((b) => !('harmony' in b)), 'p_0 has no 调和');
    // 缪尔赛思 back to the bench: the mark goes with the +1
    const k = [...ps.board].find(([, p]) => p.id === MLYSS)[0];
    assert.deepEqual(m.handle('p_1', { t: 'g.move', uid: ps.board.get(k).uid, to: { area: 'hand', idx: ps.hand.findIndex((x) => x == null) } }), { ok: true });
    const after = ps.privateView().bonds.find((b) => b.bondId === 'yanShip');
    assert.equal(after.count, 2);
    assert.ok(!('harmony' in after));
    checkInvariants(m);
    m.dispose();
  });
});

describe('§21.26 3 — strategies tied to a bond the mode switches off', () => {
  const funny = new GameData(DATA, 'mode_multi_funny');

  test('GameData.bandBondIds reads the tie from the band\'s data: its <bond> names, bond ids and bond pools in its blackboards', () => {
    const tied = Object.fromEntries(funny.bandIds().map((id) => [DATA.bands[id].name, funny.bandBondIds(id)]).filter(([, b]) => b.length));
    assert.deepEqual(tied, {
      杜遥夜: ['yanShip'], 佩佩: ['sargonShip'], 哈洛德: ['victoriaShip'], 休露丝: ['kjeragShip'], 潘格尼尼: ['lateranoShip'],
      克莱门莎: ['egirShip'], 玛恩纳: ['kazimierzShip'], 贾维: ['siracusaShip'], 娜仁图亚: ['sargonShip'],
    });
    // every tied band carries the official note "在<X>部分干员缺席时体验可能不完整" naming that bond
    for (const id of funny.bandIds()) {
      const b = DATA.bands[id];
      const note = /在<([^<>]+)>部分干员缺席时体验可能不完整/.exec(b.desc);
      if (funny.bandBondIds(id).length) assert.ok(note && funny.bandBondIds(id).some((x) => DATA.bonds[x].name === note[1]), b.name);
    }
    // the three 标准 switches off; a bracketed item (<寻呼模块>, <画卷>) is no bond; unknown bands: []
    assert.deepEqual(funny.bandIds().filter((id) => funny.bandBondIds(id).some((b) => funny.modeInactiveBonds.has(b))), ['band_paganini', 'band_clementia', 'band_mlynar']);
    assert.deepEqual(funny.bandBondIds('band_jesica'), []);
    assert.deepEqual(funny.bandBondIds('band_dusk'), []);
    assert.deepEqual(funny.bandBondIds('nope'), []);
  });

  test('the derivation (shared/bandBonds.js, run by the data build) catches a tie through a pool or a blackboard bond id alone; GameData reads the field', () => {
    const ctx = { bonds: DATA.bonds, pools: DATA.choices.pools };
    const pool = { ...DATA.bands.band_paganini, desc: '【定制铳械】累计花费55资金后，获得1名精锐干员' };
    const bb = { ...DATA.bands.band_clementia, desc: '【崇高牺牲】' };
    assert.deepEqual(bandBondIdsOf(pool, ctx), ['lateranoShip'], 'choices.json pools.pool_char_later.bond');
    assert.deepEqual(bandBondIdsOf(bb, ctx), ['egirShip'], 'bbStr bond_id');
    assert.deepEqual(bandBondIdsOf({ desc: '在<阿戈尔>部分干员缺席时体验可能不完整；<寻呼模块>', buffs: [{ bb: { bond: 'kazimierzShip,nope' } }] }, ctx), ['egirShip', 'kazimierzShip'], 'the note, comma lists; an item in <…> is no bond');
    assert.deepEqual(bandBondIdsOf(DATA.bands.band_bldsk, ctx), []);
    assert.deepEqual(bandBondIdsOf(null, ctx), []);
    // the build wrote exactly this for every band (data/bands.json is not stale against the helper)
    for (const [id, b] of Object.entries(DATA.bands)) assert.deepEqual(b.bondIds, bandBondIdsOf(b, ctx), id);
    // GameData reads the field (known bonds, data order) — never re-derives
    const gd = new GameData({ ...DATA, bands: { band_x: { ...DATA.bands.band_bldsk, bandId: 'band_x', bondIds: ['kazimierzShip', 'nope', 'egirShip'] }, band_old: { ...DATA.bands.band_paganini, bondIds: undefined } } }, 'mode_single_funny');
    assert.deepEqual(gd.bandBondIds('band_x'), ['egirShip', 'kazimierzShip']);
    assert.deepEqual(gd.bandBondIds('band_old'), [], 'data without the field: no tie');
  });

  /** Bands the bots took over seeds 1–200: solo (one AI's pick) and co-op (the real draft, 4 AI seats). */
  function picks(difficulty) {
    const solo = [];
    const coop = [];
    for (let seed = 1; seed <= 200; seed++) {
      const s = makeMatch({ mode: 'solo', difficulty, seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }], seed, fake: true });
      solo.push(botPickBand(s.m, s.m.order[0]));
      s.m.dispose();
      const c = makeMatch({ mode: 'coop', difficulty, humans: 0, bots: 4, seed, fake: true }).start();
      c.run(() => c.m.phase !== PHASE.INFO_CHECK && c.m.phase !== PHASE.BAND_DRAFT, { maxSteps: 1e5 });
      assert.equal(c.m.phase, PHASE.BATTLE_CHECK, `seed ${seed}: the draft ended`);
      for (const ps of c.m.order) coop.push(ps.bandId);
      assert.equal(new Set(c.m.order.map((ps) => ps.bandId)).size, 4, 'no strategy twice');
      c.m.dispose();
    }
    return { solo, coop };
  }
  const TIED = new Set(['band_paganini', 'band_clementia', 'band_mlynar']);

  test('标准: over seeds 1–200 no bot picks 潘格尼尼 / 克莱门莎 / 玛恩纳 — solo (200) or in the co-op draft (800); every pick is offered', () => {
    const { solo, coop } = picks('FUNNY');
    assert.equal(solo.filter((id) => TIED.has(id)).length, 0, 'solo');
    assert.equal(coop.filter((id) => TIED.has(id)).length, 0, 'co-op');
    const offered = new Set(funny.bandIds());
    assert.ok([...solo, ...coop].every((id) => offered.has(id)));
    assert.ok(new Set(solo).size >= 15 && new Set(coop).size >= 25, 'the other strategies are still spread out');
  });

  test('绝境: the same seeds still give those strategies (nothing switched off), picks unchanged from the LP-only weighting', () => {
    const { solo, coop } = picks('HARD');
    assert.ok(solo.filter((id) => TIED.has(id)).length > 0, `solo ${solo.filter((id) => TIED.has(id)).length}/200`);
    assert.ok(coop.filter((id) => TIED.has(id)).length > 0, `co-op ${coop.filter((id) => TIED.has(id)).length}/800`);
    // the pre-0.1.1 pick (starting LP only), replayed on the same rng: identical where no bond is off (§37.34: cubed on
    // 终极 solo; §37.46: on 终极 times the bots' measured strength with the band, 1 elsewhere)
    const before = (m) => {
      const ids = m.gd.bandIds();
      const lateFunds = (id) => /暂存/.test(String(m.gd.band(id)?.desc || ''));
      const exp = m.isSolo && m.difficulty === 'ABYSS' ? 3 : 2;
      const pairs = ids.map((id) => [id, Math.max(1, (m.gd.startLp(id) - 18) ** exp) * (m.isSolo && lateFunds(id) ? 0.02 : 1) * bandStrength(m, id)]);
      let r = m.rngBots() * pairs.reduce((a, [, w]) => a + w, 0);
      for (const [id, w] of pairs) { r -= w; if (r < 0) return id; }
      return pairs[pairs.length - 1][0];
    };
    for (const difficulty of ['NORMAL', 'HARD', 'ABYSS']) {
      for (let seed = 1; seed <= 200; seed++) {
        const seats = [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }];
        const a = makeMatch({ mode: 'solo', difficulty, seats, seed, fake: true });
        const b = makeMatch({ mode: 'solo', difficulty, seats, seed, fake: true });
        assert.equal(botPickBand(a.m, a.m.order[0]), before(b.m), `${difficulty} seed ${seed}`);
        a.m.dispose();
        b.m.dispose();
      }
    }
  });

  test('deterministic per seed; one rng draw per pick; with every offered band excluded, the default band', () => {
    const seats = [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true, connected: true }];
    for (const seed of [3, 77, 140]) {
      const a = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seats, seed, fake: true });
      const b = makeMatch({ mode: 'solo', difficulty: 'FUNNY', seats, seed, fake: true });
      assert.equal(botPickBand(a.m, a.m.order[0]), botPickBand(b.m, b.m.order[0]));
      a.m.dispose();
      b.m.dispose();
    }
    let draws = 0;
    const fake = (gd, r = 0.5) => ({ gd, isSolo: true, rngBots: () => { draws++; return r; } });
    botPickBand(fake(funny), null);
    assert.equal(draws, 1);
    // every offered band tied to a bond 标准 switches off (the default band 华法琳 not offered here): the default band
    const data = { ...DATA, bands: {
      band_bldsk: { ...DATA.bands.band_bldsk, modeTypeList: ['MULTI'] },
      band_paganini: DATA.bands.band_paganini, band_clementia: DATA.bands.band_clementia, band_mlynar: DATA.bands.band_mlynar,
    } };
    const gd = new GameData(data, 'mode_single_funny');
    assert.deepEqual(gd.bandIds(), ['band_paganini', 'band_clementia', 'band_mlynar']);
    for (const r of [0, 0.3, 0.999]) assert.equal(botPickBand(fake(gd, r), null), gd.defaultBandId);
    // one free band left: always it, whatever the draw (also at the top of the range)
    const one = new GameData({ ...data, bands: { ...data.bands, band_amiya: DATA.bands.band_amiya } }, 'mode_single_funny');
    for (const r of [0, 0.5, 0.9999999]) assert.equal(botPickBand(fake(one, r), null), 'band_amiya');
  });
});

describe('§21.26 found on the way — the client-result layer bound reads the lineup\'s layer 特质', () => {
  // coop/FUNNY/107 (4 humans on AI 托管: their band picks changed with the bot's) reached a 6-谢拉格 freeze board at R12 —
  // 初雪 + 银灰 (garrison_28: 50 % +1 per freeze in range, no per-battle cap) and 凛御银灰's handed-out 60 % +2 — whose honest
  // +112 谢拉格 layers passed the flat 60 + 4·12 = 108: the server rejected the client and re-simulated (SP_VERIFY=all
  // agrees with the client on all 57 battles of that match)
  const gd = new GameData(DATA, 'mode_multi_funny');
  const spec = (round, units, bonds = {}) => ({
    kind: 'normal', round, timeLimit: 60, spawns: [], flags: { layerGainsEnabled: true },
    players: [{ playerId: 'p_0', units: units.map((chessId, i) => ({ uid: i + 1, kind: 'chess', chessId, row: 9 + (i % 4), col: 2 + (i >> 2) })), bonds }],
  });
  const res = (gains) => ({ reason: 'cleared', time: 10, perPlayer: { p_0: { killed: 0, total: 0, leaked: [], perfect: true, layerGains: gains, coins: 0, unitsEnd: [], unitStats: [] } } });
  const check = (s, gains, opts = { gd }) => { const v = validateClientResult(s, res(gains), opts); return v.ok ? 'ok' : v.reason; };
  const SEED_107_R12 = ['chess_char_1_06_b', 'chess_char_4_14_a', 'chess_char_4_13_a', 'chess_char_3_14_a', 'chess_char_3_11_a', 'chess_char_4_22_a', 'chess_char_3_20_a', 'chess_char_5_14_b'];

  // GitHub #175 (from PR #192 by @kukiC): the handed-out 华法琳 trait counts at the data cap, 7 / 14
  test('华法琳\'s handed-out trait allows its data cap of 7 / 14 (GitHub #175)', () => {
    for (const [id, cap] of [['chess_char_4_26_a', 7], ['chess_char_4_26_b', 14]]) {
      const s = spec(3, [id, 'chess_char_1_10_a']); // 华法琳 + 古米
      // a handed-out trait is counted once per operator of the player (2 here), on top of the flat 60 + 4·round
      const bound = 60 + 4 * 3 + 2 * cap;
      assert.equal(check(s, { steadShip: bound }), 'ok');
      assert.equal(check(s, { steadShip: bound + 1 }), 'layer bound');
    }
  });

  test('an uncapped freeze trait leaves 谢拉格 bounded only by 999: the honest +112 passes; a bond without such a trait keeps 60 + 4·round', () => {
    const s = spec(12, SEED_107_R12, { kjeragShip: { count: 6, active: true, tier: 2, layers: 39 }, swiftShip: { count: 2, active: true, tier: 1, layers: 0 } });
    assert.equal(check(s, { kjeragShip: 112 }), 'ok', 'the board of coop/FUNNY/107 R12');
    assert.equal(check(s, { kjeragShip: 960 }), 'ok', '999 − 39');
    assert.equal(check(s, { kjeragShip: 961 }), 'layer bound', 'never past 999');
    assert.equal(check(s, { swiftShip: 108 }), 'ok');
    assert.equal(check(s, { swiftShip: 109 }), 'layer bound', 'no layer trait names 迅捷: the flat bound');
    assert.equal(check(s, { kjeragShip: 112 }, {}), 'layer bound', 'without game data: the flat bound as before');
  });

  test('capped traits add their per-battle caps (handed-out ones once per operator); 魔王\'s +extra lifts the bonds traits raise', () => {
    // 史尔特尔 (精锐): <部署时> 突袭 +16, at most 100 a battle → 60 + 4·3 + 100
    const surtr = spec(3, ['chess_char_5_07_b']);
    assert.equal(check(surtr, { raidShip: 172 }), 'ok');
    assert.equal(check(surtr, { raidShip: 173 }), 'layer bound');
    assert.equal(check(surtr, { arcaneShip: 73 }), 'layer bound', 'its other bond: no trait, the flat bound');
    // 荒芜拉普兰德 (精锐) hands every 叙拉古 operator garrison_117_b (+2 per kill, at most 200): × the 2 operators
    const lap = spec(3, ['chess_char_6_18_b', 'chess_char_1_03_a']);
    assert.equal(check(lap, { siracusaShip: 72 + 400 }), 'ok');
    assert.equal(check(lap, { siracusaShip: 72 + 401 }), 'layer bound');
    // 魔王 in the lineup: every bond a trait raises is bounded by 999 only; the others keep the flat bound
    const demon = spec(3, ['chess_char_5_07_b', 'chess_char_4_25_a']);
    assert.equal(check(demon, { raidShip: 999 }), 'ok');
    assert.equal(check(demon, { arcaneShip: 73 }), 'layer bound');
  });
});

test('§21.26 docs: DESIGN (the subsection and the normative lines), META, PLAYING and the CHANGELOG say what the code does', () => {
  const doc = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
  const DESIGN = designText(fileURLToPath(new URL('../../', import.meta.url)));   // the index + docs/design/ + docs/history/
  const at = DESIGN.indexOf('### 21.26 Gaps found while triaging GitHub issues #1 / #8 (v0.1.1)');
  assert.ok(at > 0, 'the subsection');
  const s = DESIGN.slice(at);
  for (const k of ['morphPairings', 'harmonyMembers', '`harmony: 1`', 'bandBondIds', 'botPickBand', '0 of 200 and 0 of 800', '5 of 200 solo and 23 of 800 co-op',
    'shared/bandBonds.js', 'bandOffBonds', 'BandOffTag', '本局禁用【拉特兰】盟约，此策略效果可能无法发挥', 'it stays selectable']) assert.ok(s.includes(k), k);
  assert.match(doc('docs/DATA.md'), /\| `bondIds` \| `\["lateranoShip"\]` \(潘格尼尼\) \/ `\[\]` \|/, 'DATA.md bands.json bondIds');
  assert.match(DESIGN, /bonds:\[\{bondId,count,active,tier,layers,harmony\? \/\* 调和's \+1 is in count, §21\.26 \*\/\}\]/, '§8.2');
  assert.match(DESIGN, /bonds: \[ \{ bondId, count, active, tier, layers, harmony\? \/\* 调和's \+1 is in count, §21\.26 \*\/, thresholds, countsHand \} \]/, '§8.3');
  assert.match(DESIGN, /Strategy \(§21\.6\): pick a band \(weighted by starting LP; never one built around a bond the mode switches off — `gd\.bandBondIds`, §21\.26\)/, '§6.6');
  const META = doc('docs/META.md');
  assert.match(META, /\*\*Strategy\*\* \(`botPickBand`\)/);
  assert.match(META, /carries `harmony: 1` in both lists/);
  assert.match(doc('docs/PLAYING.md'), /盟约详情会写「含调和 \+1」/);
  const log = doc('CHANGELOG.md');
  const v011 = log.slice(log.indexOf('## 0.1.1'), log.indexOf('## 0.1.0'));
  assert.match(v011, /变形同构体的详情卡列出天赋栏里的对应关系/);
  assert.match(v011, /盟约详情写明「含调和 \+1」/);
  assert.match(v011, /人机不再选择围绕本局禁用盟约的策略（标准模拟下的潘格尼尼、克莱门莎、玛恩纳）/);
  assert.match(v011, /选择策略时，围绕本局禁用盟约的策略（标准模拟下的潘格尼尼、克莱门莎、玛恩纳）标出「本局禁用」并在详情里说明，仍可选择/);
  assert.match(META, /The strategy draft marks the same bands 本局禁用 for humans \(still selectable\)/);
});
