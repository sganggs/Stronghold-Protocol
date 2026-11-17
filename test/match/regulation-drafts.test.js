// 规程 机变 drafts measured on 15 co-op 终极 matches (BV13LWM6BEvY, 2026-11-10/11). The readings are
// test/fixtures/official-regulation-drafts.json; the tables are tools/versions/tables/act3autochess-v3_1.mjs, built
// into data/versions/act3autochess-v3_1/choices.json. choices.js is the same code the 下半 tables use: a list of 7
// shows 6, and a hunter list that already holds two tier-III cards keeps both.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getVersionData } from '../../server/data.js';
import { GameData } from '../../server/match/gamedata.js';
import { generateDraft, cardTargetBonds } from '../../server/match/choices.js';
import { createRng } from '../../server/sim/rng.js';
import { loadProfile, tableSpecError, TABLE_NAMES } from '../../tools/versions/profiles.mjs';
import { bountyDrafts as SRC_BOUNTY, shopDraft as SRC_SHOP, tacticDraft as SRC_TACTIC } from '../../tools/versions/tables/act3autochess-v3_1.mjs';

const OFFICIAL = JSON.parse(readFileSync(new URL('../fixtures/official-regulation-drafts.json', import.meta.url), 'utf8'));
const DATA = getVersionData('act3autochess@V3_1');
const CARDS = DATA.choices.cards.bounty;
const CARD = new Map(CARDS.map((c) => [c.effectId, c]));
const SPEC = DATA.choices.bountyDrafts;
const SHOP = DATA.choices.shopDraft;
const TACTIC = DATA.choices.tacticDraft;
const TACTIC_CARDS = DATA.choices.cards.tactic;
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const subset = (ids, cards) => ids.every((id) => cards.includes(id));

/** The data card of a fixture tuple [title, enemy, coins, battles]. */
function resolve([title, enemy, coin, battles]) {
  const hits = CARDS.filter((c) => c.name === title && c.coin === coin && c.rounds === battles
    && (c.desc.includes(`1只${enemy}，`) || c.desc.includes(`1个${enemy}，`)));
  assert.equal(hits.length, 1, `${title} ${enemy} ${coin}: ${hits.map((c) => c.effectId).join(', ') || 'no card'}`);
  return hits[0].effectId;
}

/** Every fixture screen: { match, round, family, leader, ids? , shop?, tactic? }. */
function screens() {
  const out = [];
  for (const [match, row] of Object.entries(OFFICIAL.matches)) {
    for (const round of ['3', '9', '11']) {
      const d = row[round];
      const rec = { match: Number(match), round: Number(round), family: d.family, leader: row.leader };
      if (d.family === 'bounty') rec.ids = d.cards.map(resolve);
      else if (d.family === 'shop') rec.shop = d.cards;
      else rec.tactic = d.cards.map(([name]) => name);
      out.push(rec);
    }
  }
  return out;
}

const SCREENS = screens();
const bountyOf = (round) => SCREENS.filter((d) => d.round === round && d.family === 'bounty');
const groupFor = (groups, d) => groups.filter((g) => subset(d.ids, g.cards));
const weighted = ({ hits, ...g }) => ({ ...g, weights: hits.map((h) => h + 1) });

/** A normal shop item's id. The build resolves the table's names the same way. */
function itemId(name) {
  const hits = Object.values(DATA.items).filter((i) => !i.isGolden && i.itemType === 'EQUIP' && i.name === name);
  assert.equal(hits.length, 1, name);
  return hits[0].id;
}

test('the fixture is the 15 matches of BV13LWM6BEvY and names no player', () => {
  assert.equal(OFFICIAL.season, 'act3autochess');
  assert.equal(OFFICIAL.video, 'BV13LWM6BEvY');
  assert.match(OFFICIAL._doc, /BV13LWM6BEvY/);
  assert.equal(Object.keys(OFFICIAL.matches).length, 15);
  assert.equal(SCREENS.length, 45);
  const text = JSON.stringify(OFFICIAL);
  // records carry cards, rounds, families and leaders only: no player, uploader or account field
  for (const m of Object.values(OFFICIAL.matches)) for (const k of Object.keys(m)) assert.ok(!/player|uploader|user|name/i.test(k), k);
  assert.equal(text.includes('/Users/'), false);
  const families = { bounty: 0, shop: 0, tactic: 0 };
  for (const d of SCREENS.filter((s) => s.round === 11)) families[d.family]++;
  assert.deepEqual(families, { bounty: 9, shop: 4, tactic: 2 });
});

test('profile tables accept a module id or an object, and 规程 names its module', async () => {
  const nil = Object.fromEntries(TABLE_NAMES.map((k) => [k, null]));
  assert.equal(tableSpecError('default'), null);
  assert.equal(tableSpecError(nil), null);
  assert.equal(tableSpecError({ ...nil, bountyDrafts: 'act3autochess-v3_1', shopDraft: { rounds: [11] } }), null);
  assert.match(tableSpecError(null), /tables must be/);
  assert.match(tableSpecError({ ...nil, stock: 1 }), /tables\.stock/);
  assert.match(tableSpecError({ ...nil, bountyDrafts: '../x' }), /safe name/);
  assert.match(tableSpecError({ ...nil, extra: null }), /tables\.extra/);
  const { profile } = await loadProfile('act3autochess@V3_1');
  assert.equal(profile.tables.stock, null);
  assert.equal(profile.tables.bountyDrafts, 'act3autochess-v3_1');
  assert.equal(profile.tables.shopDraft, 'act3autochess-v3_1');
  assert.equal(profile.tables.tacticDraft, 'act3autochess-v3_1');
  const act1 = await loadProfile('act1autochess');
  assert.ok(TABLE_NAMES.every((k) => act1.profile.tables[k] === null));
  const act2 = await loadProfile('act2autochess');
  assert.equal(act2.profile.tables, 'default');
  const v2 = await loadProfile('act2autochess@V2_1');
  assert.equal(v2.profile.tables, 'default');
  const v1 = await loadProfile('act1autochess@V1_1');
  assert.ok(TABLE_NAMES.every((k) => v1.profile.tables[k] === null));
});

test('built R3 / R9 / R11 tables have the measured shape, and every screen is a draw from them', () => {
  assert.equal(SPEC.initial.pick, 'slot');
  assert.equal(SPEC.initial.slots, 10);
  assert.equal(SPEC.initial.count, 6);
  assert.equal(SPEC.initial.groups.length, 7);
  assert.deepEqual(SPEC.initial.groups, SRC_BOUNTY.initialSets);
  assert.deepEqual(SPEC.initial.rule, SRC_BOUNTY.initialRule);
  assert.deepEqual(SPEC.initial.rule.tiers, [1, 1, 1, 2, 2, 3, 3]);
  assert.ok(SPEC.initial.assumed.some((s) => s.includes('[ASSUMED]')));

  assert.equal(SPEC.boss.pick, 'seen');
  assert.equal(SPEC.boss.groups.length, 6);
  assert.deepEqual(SPEC.boss.groups, SRC_BOUNTY.bossGroups.map(weighted));
  const seenW = SPEC.boss.groups.map((g) => g.seen.filter((x) => Number.isInteger(x)).length);
  assert.deepEqual(seenW, [3, 2, 4, 3, 2, 1]);
  assert.equal(seenW.reduce((a, b) => a + b, 0), 15);

  assert.equal(SPEC.hunter.pick, 'slot');
  assert.equal(SPEC.hunter.slots, SPEC.hunter.groups.length);
  assert.equal(SPEC.hunter.groups.length, 5);
  assert.deepEqual(SPEC.hunter.groups, SRC_BOUNTY.hunterGroups.map(weighted));
  assert.equal(SPEC.hunter.rule.size, 7);
  assert.ok(SPEC.hunter.rule.giants.includes('enemyeffect_16_13'), '聆风猎手 is a giant');
  assert.equal(SPEC.hunter.groups[0].cards.filter((id) => CARD.get(id).tier === 3).length, 2);
  assert.equal(SPEC.hunter.groups[3].cards.filter((id) => CARD.get(id).tier === 3).length, 2);
  assert.equal(SPEC.hunter.groups[1].cards.filter((id) => CARD.get(id).series === 13).length, 2);

  for (const round of [3, 9, 11]) {
    const kind = round === 3 ? 'initial' : round === 9 ? 'boss' : 'hunter';
    for (const d of bountyOf(round)) {
      assert.equal(d.ids.length, 6, `match ${d.match}`);
      assert.equal(new Set(d.ids).size, 6, `match ${d.match} repeats a card`);
      const fit = groupFor(SPEC[kind].groups, d);
      assert.equal(fit.length, 1, `match ${d.match} R${round} fits ${fit.length}`);
      assert.ok(fit[0].seen.includes(d.match), `match ${d.match} is not in the group's seen`);
      if (fit[0].cards.length === 6) assert.ok(sameSet(d.ids, fit[0].cards));
      else assert.equal(fit[0].cards.filter((id) => !d.ids.includes(id)).length, fit[0].cards.length - 6);
      for (const id of d.ids) assert.equal(CARD.get(id).draftPool, kind);
    }
  }
  // the two 胄 matches are not one group
  const zhou = bountyOf(9).filter((d) => d.leader === '假想敌：胄');
  assert.deepEqual(zhou.map((d) => d.match), [4, 8]);
  assert.notEqual(groupFor(SPEC.boss.groups, zhou[0])[0], groupFor(SPEC.boss.groups, zhou[1])[0]);

  for (const id of ['enemyeffect_b_5', 'enemyeffect_b_7', 'enemyeffect_b_15']) {
    assert.equal(CARD.get(id).draft, false);
    assert.equal(CARD.get(id).draftPool, null);
    assert.equal(CARD.get(id).draftExcluded, 'unseen');
  }
  for (const id of ['enemyeffect_b_6', 'enemyeffect_b_16', 'enemyeffect_b_18']) {
    assert.equal(CARD.get(id).draftPool, 'boss');
    assert.equal(CARD.get(id).draft, true);
  }

  // weights are 1 + the screens of that group the card was on
  for (const kind of ['boss', 'hunter']) {
    for (const g of SPEC[kind].groups) {
      const drafts = bountyOf(kind === 'boss' ? 9 : 11).filter((d) => g.seen.includes(d.match));
      assert.deepEqual(g.weights, g.cards.map((id) => 1 + drafts.filter((d) => d.ids.includes(id)).length));
    }
  }
});

test('R11 family weights stay 14 / 4 / 4; co-op 绝境 and 终极 have no R6', () => {
  const hard = DATA.choices.schedule.mode_multi_hard;
  const abyss = DATA.choices.schedule.mode_multi_abyss;
  assert.deepEqual(hard.spRounds, [3, 9, 11]);
  assert.deepEqual(abyss.spRounds, [3, 9, 11]);
  for (const rounds of [hard.rounds, abyss.rounds]) {
    assert.equal(rounds['3'].bountyDraft, 'initial');
    assert.equal(rounds['3'].assumed, false);
    assert.equal(rounds['6'], undefined);
    assert.equal(rounds['9'].bountyDraft, 'boss');
    assert.equal(rounds['9'].assumed, false);
    assert.equal(rounds['11'].bountyDraft, 'hunter');
    assert.equal(rounds['11'].assumed, true);
    assert.deepEqual(rounds['11'].families, [
      { family: 'bounty', weight: 14 }, { family: 'shop', weight: 4 }, { family: 'tactic', weight: 4 },
    ]);
  }
  // 险境 co-op (mode_multi_normal) still has an R6. The shared formula keeps it assumed because the mode is not 绝境 / 终极.
  assert.equal(DATA.choices.schedule.mode_multi_normal.rounds['6'].bountyDraft, 'initial');
  assert.equal(DATA.choices.schedule.mode_multi_normal.rounds['6'].assumed, true);
});

/** The 6 ids are a 6-subset of a seen R3 list, or 6 of a 7-card list the unseen-event rule can build. */
function initialOk(ids) {
  if (SPEC.initial.groups.some((g) => subset(ids, g.cards))) return true;
  const rule = SPEC.initial.rule;
  const tiers = rule.tiers.slice().sort().join('');
  const pool = CARDS.filter((c) => c.draftPool === 'initial' && rule.series.includes(c.series));
  return pool.some((extra) => {
    if (ids.includes(extra.effectId)) return false;
    const seven = [...ids, extra.effectId];
    if (new Set(seven).size !== 7) return false;
    const got = seven.map((id) => CARD.get(id).tier).sort().join('');
    if (got !== tiers) return false;
    const series = seven.map((id) => CARD.get(id).series);
    if (series.some((s) => series.filter((x) => x === s).length > rule.perSeries)) return false;
    return seven.filter((id) => CARD.get(id).tier === 3).every((id) => rule.prefer.includes(id));
  });
}

/** An open card hunterFill can append to the whole stored list (the list already holds its cards). */
function openLegal(group, extraId) {
  const rule = SPEC.hunter.rule;
  const giants = new Set(rule.giants);
  const have = group.cards.map((id) => CARD.get(id));
  if (!have.some((c) => giants.has(c.effectId))) return giants.has(extraId);
  const c = CARD.get(extraId);
  if (!c || !rule.cards.includes(extraId)) return false;
  if (rule.onePerSeries.includes(c.series)) return !have.some((x) => x.series === c.series);
  if (c.series !== 16) return false;
  return have.filter((x) => x.series === 16 && !giants.has(x.effectId)).length < rule.maxSeries16;
}

function hunterOk(ids) {
  return SPEC.hunter.groups.some((g) => {
    const extra = ids.filter((id) => !g.cards.includes(id));
    if (extra.length === 0) return true;
    return !!g.open && extra.length === 1 && ids.filter((id) => g.cards.includes(id)).length === 5 && openLegal(g, extra[0]);
  });
}

test('a 规程 co-op 终极 match draws only from the tables, and the same seed repeats', () => {
  const gd = new GameData(DATA, 'mode_multi_abyss');
  const once = (seed, round) => generateDraft(gd, createRng(seed), round, { stageId: 'act3autochess_m01', bondAvailable: () => true });
  assert.deepEqual(once(7, 3), once(7, 3));
  assert.deepEqual(once(11, 11), once(11, 11));

  const s17 = SPEC.initial.groups.find((g) => g.cards.includes('enemyeffect_17_1'));
  const omitted = new Set();
  let twoGiant = false;
  let twoSeries13 = false;
  let openFill = false;
  for (let seed = 1; seed <= 400; seed++) {
    const d3 = once(seed, 3);
    assert.equal(d3.family, 'bounty');
    assert.equal(d3.cards.length, 6);
    const ids3 = d3.cards.map((c) => c.id);
    assert.equal(new Set(ids3).size, 6);
    assert.ok(initialOk(ids3), `R3 seed ${seed} is not a table draw`);
    if (subset(ids3, s17.cards)) s17.cards.filter((id) => !ids3.includes(id)).forEach((id) => omitted.add(id));

    const d9 = once(seed + 1000, 9);
    assert.equal(d9.family, 'bounty');
    const ids9 = d9.cards.map((c) => c.id);
    assert.ok(SPEC.boss.groups.some((g) => subset(ids9, g.cards)), `R9 seed ${seed}`);
    assert.ok(ids9.every((id) => CARD.get(id).draftPool === 'boss'));

    const d11 = once(seed + 2000, 11);
    if (d11.family === 'bounty') {
      const ids = d11.cards.map((c) => c.id);
      assert.equal(ids.length, 6);
      assert.ok(hunterOk(ids), `R11 seed ${seed} ${ids.join(' ')}`);
      if (ids.includes('enemyeffect_16_1') && ids.includes('enemyeffect_16_13')) twoGiant = true;
      if (ids.includes('enemyeffect_13_7') && ids.includes('enemyeffect_13_8')) twoSeries13 = true;
      const opened = SPEC.hunter.groups.filter((g) => g.open).some((g) => ids.some((id) => !g.cards.includes(id)) && hunterOk(ids));
      if (opened && ids.some((id) => !SPEC.hunter.groups.some((g) => !g.open && g.cards.includes(id) && subset(ids, g.cards)))) {
        // an open card is one that sits outside the stored list of an open group the draw used
      }
      for (const g of SPEC.hunter.groups) {
        if (!g.open) continue;
        const extra = ids.filter((id) => !g.cards.includes(id));
        if (extra.length === 1 && ids.filter((id) => g.cards.includes(id)).length === 5) openFill = true;
      }
    }
  }
  assert.ok(omitted.size >= 2, `series 17 omitted only ${[...omitted].join(' ')}`);
  assert.equal(twoGiant, true, 'no draft showed both tier-III cards of the first R11 list');
  assert.equal(twoSeries13, true, 'no draft showed both series-13 cards of the second R11 list');
  assert.equal(openFill, true, 'no open R11 list showed its filled card');

  // 规程 solo 绝境 / 终极 are mode_single_9..20; the schedule shows 3 of the 6
  const solo = new GameData(DATA, 'mode_single_9');
  const s = generateDraft(solo, createRng(3), 3, {});
  assert.equal(s.family, 'bounty');
  assert.equal(s.cards.length, 3);
  assert.ok(s.cards.every((c) => CARD.get(c.id).draftPool === 'initial'));
});

test('机密商店 slots and 战术决策 weights are the measured ones, and a dead bond is not offered', () => {
  assert.deepEqual(SHOP.rounds, [11]);
  assert.deepEqual(SHOP.slots, SRC_SHOP.slots);
  assert.deepEqual(SHOP.seen, SRC_SHOP.matches);
  assert.equal(SHOP.coin, itemId('盟约之币'));
  assert.equal(SHOP.itemWeights[SHOP.coin], undefined);
  const weights = {};
  for (const [name, k] of Object.entries(SRC_SHOP.seen)) if (name !== SRC_SHOP.coin) weights[itemId(name)] = 1 + k;
  assert.deepEqual(SHOP.itemWeights, weights);

  const shops = SCREENS.filter((d) => d.family === 'shop');
  assert.deepEqual(shops.map((d) => d.match), [9, 12, 14, 15]);
  for (const d of shops) {
    const kinds = d.shop.map(([name, tier]) => (name === '盟约之币' ? 'coin' : tier));
    assert.ok(kinds.includes(6) && kinds.includes(5), `match ${d.match} has no fixed VI and V`);
    assert.ok(kinds.every((k) => k === 'coin' || k === 3 || k === 4 || k === 5 || k === 6));
    assert.equal(d.shop.length, 6);
  }
  // the screens repeat items; the weights count every copy
  assert.equal(SHOP.itemWeights[itemId('驮兽储蓄罐')], 5);
  assert.equal(SHOP.itemWeights[itemId('人事部文档')], 4);

  assert.deepEqual(TACTIC.kinds, ['ally']);
  assert.deepEqual(TACTIC.rounds, [11]);
  assert.deepEqual(TACTIC.seen, [6, 13]);
  const byName = (name) => {
    const hits = TACTIC_CARDS.filter((c) => c.name === name);
    assert.equal(hits.length, 1, name);
    assert.equal(hits[0].kind, 'ally');
    return hits[0];
  };
  const tw = {};
  for (const [name, k] of Object.entries(SRC_TACTIC.seen)) tw[byName(name).effectId] = 1 + k;
  assert.deepEqual(TACTIC.weights, tw);
  assert.equal(TACTIC.weights[byName('列装').effectId], 3);

  const gd = new GameData(DATA, 'mode_multi_abyss');
  const reinforce = byName('卡西米尔驰援');
  const bonds = cardTargetBonds(gd, reinforce.effectId);
  assert.ok(bonds && bonds.length === 1, '驰援 names one bond');
  assert.equal(cardTargetBonds(gd, byName('列装').effectId), null);
  let live = 0;
  let dead = 0;
  let deadSawBond = 0;
  let deadSawBasic = 0;
  for (let seed = 1; seed <= 2500 && (live < 1 || dead < 80); seed++) {
    const ok = generateDraft(gd, createRng(seed), 11, { bondAvailable: () => true });
    if (ok.family === 'tactic' && ok.cards.some((c) => c.id === reinforce.effectId)) live++;
    const no = generateDraft(gd, createRng(seed + 9000), 11, { bondAvailable: (b) => b !== bonds[0] });
    if (no.family !== 'tactic') continue;
    dead++;
    if (no.cards.some((c) => c.id === reinforce.effectId)) deadSawBond++;
    if (no.cards.some((c) => c.id === byName('列装').effectId)) deadSawBasic++;
  }
  assert.ok(live >= 1, 'a live bond never offered 卡西米尔驰援');
  assert.equal(deadSawBond, 0);
  assert.ok(deadSawBasic >= 1, '列装 was not offered while the bond was dead');

  let dup = 0;
  for (let seed = 1; seed <= 2000 && dup < 1; seed++) {
    const d = generateDraft(gd, createRng(seed + 50), 11, {});
    if (d.family !== 'shop') continue;
    const ids = d.cards.map((c) => c.id);
    const kinds = ids.map((id) => (id === SHOP.coin ? 'coin' : DATA.items[id].tier));
    assert.equal(kinds.length, 6);
    assert.ok(kinds.includes(6) && kinds.includes(5), `shop seed ${seed} ${kinds}`);
    assert.ok(kinds.every((k) => k === 'coin' || (k >= 3 && k <= 6)));
    if (ids.length !== new Set(ids).size) dup++;
  }
  assert.equal(dup, 1, 'no generated 机密商店 repeated an item');
});
