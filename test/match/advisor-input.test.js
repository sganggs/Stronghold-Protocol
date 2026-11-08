import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATA, makeMatch, give, giveItem } from './harness.js';
import { knowledgePack, effectText } from '../../server/ai/knowledge.js';
import { buildPlaybook } from '../../server/ai/playbook.js';
import { strategyCandidates } from '../../server/ai/strategy.js';
import { aiDigest } from '../../server/match/aiDigest.js';
import { advisorSystem, STRATEGY_PROMPT, SYSTEM_BUDGET } from '../../tools/ai/llm-agent.mjs';
import { slimKnowledge } from '../../tools/ai/llm-knowledge.mjs';
import { compactDigest, compactChoices, focusPlan } from '../../tools/ai/llm-context.mjs';
import { repairPlan } from '../../tools/ai/llm-plan.mjs';
import { validPlan } from '../../server/match/aiPlan.js';

const hard = knowledgePack(DATA, { modeId: 'mode_multi_hard' });
const fixture = JSON.parse(readFileSync(new URL('../fixtures/llm-advisor.json', import.meta.url), 'utf8'));

test('the example system prompt is a slim view of the unchanged pack within SYSTEM_BUDGET (round 65: 50000 characters)', () => {
  const system = advisorSystem(hard);
  assert.ok(system.length <= SYSTEM_BUDGET, `hard system is ${system.length} characters`);
  assert.equal(SYSTEM_BUDGET, 50000);
  assert.ok(system.startsWith(STRATEGY_PROMPT));
  assert.ok(!system.includes('[object Object]'));
  const view = JSON.parse(system.slice(system.indexOf('\nKnowledge:\n') + '\nKnowledge:\n'.length));
  // Out: the enemy table, the playbook's community prose, graph, pairings, schedules, legacy reference and insights.
  for (const k of ['enemies', 'bosses', 'playbook']) assert.equal(view[k], undefined, k);
  assert.ok(hard.playbook.operators.length > 100 && hard.playbook.enemies.length > 50, 'the served pack is not replaced');
  assert.ok(hard.operators[0].traits && hard.operators[0].skill);
  const col = (table, name) => table.columns.indexOf(name);
  const ops = view.operators, at = k => col(ops, k);
  assert.deepEqual(ops.columns, ['id', 'name', 'tier', 'bonds', 'class', 'caps', 'trait']);
  assert.ok(ops.rows.length > 100 && ops.rows.every(r => r.length === ops.columns.length));
  assert.ok(ops.rows.every(r => hard.operators.find(o => o.id === r[at('id')])?.poolEligible && !/_b$/.test(r[at('id')])));
  // Two catalogue rows share the name 锡人; only the T2 one is in this version's shop pool (the id stays the key).
  const tin = ops.rows.filter(r => r[at('name')] === '锡人');
  assert.deepEqual(tin.map(r => [r[at('id')], r[at('tier')]]), [['chess_char_2_19_a', 2]]);
  for (const r of ops.rows) {
    assert.ok(r[at('trait')].length <= 90);
    assert.match(r[at('caps')], /^((air|block|sustain|elementRecovery|reveal)(\+|$))*$/);
  }
  const air = hard.playbook.operators.find(o => o.capabilities.air);
  assert.match(ops.rows.find(r => r[at('id')] === air.id)[at('caps')], /air/);
  const bands = view.bands, b = k => col(bands, k);
  const pepe = bands.rows.find(r => r[b('id')] === 'band_pepe');
  assert.equal(pepe[b('bond')], 'sargonShip');
  assert.equal(pepe[b('strength')], 30.6);
  assert.equal(bands.rows.find(r => r[b('id')] === 'band_sarkazb')[b('lp')], 45);
  const items = view.items;
  assert.ok(items.rows.some(r => r[col(items, 'mergeCopies')] === 2));
  assert.deepEqual(view.subBonds.lateranoShip, ['preciShip', 'skillfulShip']);
  for (const language of ['en', 'ja', 'ko', 'zh-TW']) {
    const other = advisorSystem(knowledgePack(DATA, { modeId: 'mode_single_funny', language }));
    assert.ok(other.length <= SYSTEM_BUDGET, `${language} funny system is ${other.length} characters`);
  }
  assert.match(STRATEGY_PROMPT, /primary|main/);
  assert.match(STRATEGY_PROMPT, /\*_b/);
  assert.match(STRATEGY_PROMPT, /holdLevel/);
  assert.match(STRATEGY_PROMPT, /items: buy only an item that completes an equipment merge/);
});

test('enemy effect text keeps handbook strings and drops ability objects', () => {
  assert.equal(effectText(['desc', { text: '攻击造成灼燃损伤', textRaw: 'raw', format: '{}' }]), 'desc 攻击造成灼燃损伤');
  assert.equal(effectText({ desc: 'only desc' }), 'only desc');
  const row = hard.enemies.find(e => e.id === 'enemy_1305_mhslim');
  assert.match(row.effect, /灼燃/);
  assert.equal(row.effect.includes('[object Object]'), false);
  assert.equal(hard.enemies.some(e => String(e.effect).includes('[object Object]')), false);
  // Round 65: the system prompt's view carries no enemy or leader rows (the round's upcoming list names them).
  const view = slimKnowledge({ bosses: [{ id: 'b', name: 'n', enemyKey: 'e', notes: [{ text: '射线', format: 'obj' }] }] });
  assert.equal(view.bosses, undefined); assert.equal(view.enemies, undefined);
});

test('band draft returns at most eight directions ranked by the measured prior (round 65); prep collapses subs', () => {
  const book = buildPlaybook(DATA, { modeId: 'mode_multi_abyss' });
  const open = { playerId: 'self', round: 1, band: { id: null }, availability: {}, board: [], bench: [],
    opponents: [], factions: [], economy: { level: 1, gold: 0 }, deployCap: 6,
    actions: book.bands.map((b, i) => ({ id: `a${i}`, intent: { t: 'g.band', bandId: b.id } })) };
  const result = strategyCandidates(book, open), draft = result.candidates;
  assert.equal(draft.length, 8);
  assert.equal(new Set(draft.map(c => c.band)).size, draft.length);
  assert.equal(result.prior.source, 'prior');
  // LP³ × §37.46 strength: 歌利亚 (45 LP) leads; every candidate's score is its band's prior share, never a heuristic sum.
  assert.equal(draft[0].band, 'band_sarkazb');
  for (const c of draft) {
    assert.deepEqual(Object.keys(c.scoreParts), ['prior']);
    assert.equal(c.score, c.scoreParts.prior);
    assert.equal(c.fitParts.survival, undefined);
    assert.ok(Number.isFinite(c.fit));
  }
  for (let i = 1; i < draft.length; i++) assert.ok(draft[i - 1].score >= draft[i].score);
  // The host's own draft weights win over the prior; its rule pick (Touch) comes first.
  const hosted = strategyCandidates(book, { ...open, bot: { bands: [{ id: 'band_amiya', share: 0.6 }, { id: 'band_sarkazb', share: 0.4 }], forced: 'band_amedic' } });
  assert.equal(hosted.prior.source, 'bot'); assert.equal(hosted.prior.forced, 'band_amedic');
  assert.deepEqual(hosted.candidates.slice(0, 3).map(c => c.band), ['band_amedic', 'band_amiya', 'band_sarkazb']);
  assert.equal(hosted.candidates[0].scoreParts.forced, 100);
  const contended = strategyCandidates(book, { ...open, opponents: [{ playerId: 'other', bandId: 'band_duyaoy', bonds: [], board: [] }] }).candidates;
  assert.ok(contended.every(c => c.main !== 'yanShip'));
  const prep = strategyCandidates(book, { playerId: 'self', round: 4, band: { id: 'band_duyaoy' }, availability: {},
    board: [], bench: [], opponents: [], factions: [], economy: { level: 3 }, deployCap: 8 }).candidates;
  const direction = prep.find(c => c.id === 'band_duyaoy:yanShip');
  assert.ok(direction.subOptions.length >= 2);
  assert.deepEqual(direction.subs, direction.subOptions[0].subs);
  assert.equal(direction.score, direction.subOptions[0].score);
  assert.equal(new Set(direction.subOptions.map(s => s.subs.join('+'))).size, direction.subOptions.length);
  const again = strategyCandidates(book, { playerId: 'self', round: 5, band: { id: 'band_duyaoy' }, availability: {},
    board: [], bench: [], opponents: [], factions: [], economy: { level: 4 }, deployCap: 8 }).candidates.find(c => c.main === 'yanShip' && !c.build);
  assert.equal(again.id, direction.id);
});

test('digest chess and items carry names, and bounty cards carry kill chance plus enemy stats', t => {
  const h = makeMatch({ humans: 1, fake: true }); t.after(() => h.m.dispose()); h.start().toPrep();
  const { m } = h, ps = m.order[0];
  const id = m.gd.visibleChess.find(chessId => {
    const c = m.gd.chess(chessId);
    return c.canHitFly === true && !['heal', 'none'].includes(c.dmgType);
  });
  const piece = give(m, ps, id);
  const itemId = Object.keys(DATA.items).find(key => DATA.items[key].name);
  const item = giveItem(m, ps, itemId);
  ps.shop.slots[0] = { kind: 'chess', id, basePrice: 1, sold: false, frozen: false };
  ps.shop.slots[1] = { kind: 'item', id: itemId, basePrice: 1, sold: false, frozen: false };
  const raw = DATA.choices.cards.bounty.find(c => c.enemyKey && DATA.enemies[c.enemyKey]?.stats);
  const bounty = { kind: 'bounty', idx: 0, id: raw.effectId, name: raw.name, desc: raw.desc || '', coin: raw.coin,
    payout: raw.payout, rounds: raw.rounds, enemyKey: raw.enemyKey, count: raw.count || 1 };
  const tactic = { kind: 'tactic', idx: 1, id: 'tactic-test', name: 'tactic', desc: 'no enemy' };
  const pub = m.publicView();
  pub.sp = { cards: [bounty, tactic] };
  const rng = [m.rngBots.state(), m.rngShop.state()];
  const digest = aiDigest(m, ps, 'card', pub, ps.privateView(), hard);
  assert.deepEqual(rng, [m.rngBots.state(), m.rngShop.state()]);
  assert.equal(bounty.killChance, undefined, 'annotation must copy the card');
  const held = digest.bench.find(p => p.uid === piece.uid);
  assert.equal(held.name, m.gd.chess(id).name);
  assert.equal(held.class, m.gd.chess(id).profession);
  assert.equal(held.caps.air, true);
  assert.equal(typeof held.caps.block, 'boolean');
  const heldItem = digest.bench.find(p => p.uid === item.uid);
  assert.equal(heldItem.name, DATA.items[itemId].name);
  const shopChess = digest.shop.find(s => s && s.kind === 'chess' && s.id === id);
  const shopItem = digest.shop.find(s => s && s.kind === 'item' && s.id === itemId);
  assert.equal(shopChess.class, held.class);
  assert.equal(shopChess.caps.air, true);
  assert.equal(shopItem.name, heldItem.name);
  assert.equal(typeof digest.choices.cards[0].killChance, 'number');
  assert.ok(Number.isFinite(digest.choices.cards[0].killChance));
  assert.equal(digest.choices.cards[1].killChance, undefined);
  assert.ok(digest.choices.cards[0].enemy.hp > 0);
  assert.equal(typeof digest.choices.cards[0].enemy.fly, 'boolean');
  assert.equal(String(digest.choices.cards[0].enemy.effect || '').includes('[object Object]'), false);
  digest.actions = [{ id: 'a9', intent: { t: 'g.choice', idx: 0 } }];
  const shown = compactDigest(digest, hard);
  const compactHeld = shown.bench.find(p => p.id === id);
  assert.equal(compactHeld.name, held.name);
  assert.equal(compactHeld.class, held.class);
  assert.equal(compactHeld.caps.air, true);
  const compactItem = shown.bench.find(p => p.id === itemId);
  assert.equal(compactItem.name, heldItem.name);
  assert.equal(compactItem.kind, 'item');
  assert.equal(shown.shop.find(s => s.kind === 'item').name, shopItem.name);
  assert.equal(compactChoices(digest)[0].card.killChance, digest.choices.cards[0].killChance);
  assert.equal(compactChoices(digest)[0].card.enemy.hp, digest.choices.cards[0].enemy.hp);
  m.bot = { bountyKillChance() { throw new Error('estimator down'); } };
  const broken = aiDigest(m, ps, 'card', pub, ps.privateView(), hard);
  assert.equal(broken.choices.cards[0].killChance, undefined);
  assert.ok(broken.choices.cards[0].enemy.hp > 0);
  m.bot = { bountyKillChance() { return null; } };
  assert.equal(aiDigest(m, ps, 'card', pub, ps.privateView(), hard).choices.cards[0].killChance, undefined);
});

test('only a primary-bond change needs a pivot; sub-bonds may be added', () => {
  const digest = { bonds: ['a', 'b', 'c', 'd'].map(id => ({ id, candidate: true })) };
  const previous = { bonds: [{ id: 'a', priority: 5 }, { id: 'b', priority: 4 }] };
  const added = { bonds: [{ id: 'a', priority: 5 }, { id: 'c', priority: 3 }, { id: 'b', priority: 2 }] };
  const repairs = [];
  const pivot = focusPlan(added, { pivot: false }, digest, previous, repairs);
  assert.equal(pivot.pivot, false);
  assert.deepEqual(added.bonds.map(b => b.id), ['a', 'c', 'b']);
  const swapped = { bonds: [{ id: 'b', priority: 5 }, { id: 'a', priority: 4 }] };
  const rejected = [];
  const back = focusPlan(swapped, { pivot: false, pivotReason: 'no' }, digest, previous, rejected);
  assert.equal(back.pivot, false);
  assert.deepEqual(swapped.bonds.map(b => b.id), ['a', 'b']);
  assert.match(rejected.at(-1).reason, /primary-bond/);
});

test('repair keeps items.buy only for an equipment merge or a declared Final Assault carrier, and economy.freezeSearch (§35.14)', () => {
  const pack = structuredClone(fixture.knowledge);
  pack.items = [{ id: 'item', mergeCopies: 2 }, ...Array.from({ length: 8 }, (_, i) => ({ id: `extra${i}`, mergeCopies: 2 }))];
  const digest = structuredClone(fixture.digest);
  digest.shop = [...digest.shop, { id: 'plugin_item', kind: 'item', slot: 1 }];
  digest.bench.push(...pack.items.map((it, i) => ({ id: it.id, kind: 'item', uid: `it${i}` })));
  const buy = ['item', 'plugin_item', 'support', 'missing', ...pack.items.filter(i => i.id.startsWith('extra')).map(i => i.id)];
  const { plan, repairs } = repairPlan({ items: { buy }, economy: { freezeSearch: true, reserve: 3 } }, pack, digest, []);
  assert.ok(validPlan(plan));
  // eight merge completions fit the cap; the plugin item merges nothing and no Final Assault carrier is declared
  assert.equal(plan.items.buy.length, 7);
  assert.ok(!plan.items.buy.includes('plugin_item') && !plan.items.buy.includes('missing') && !plan.items.buy.includes('support'));
  assert.equal(plan.economy.freezeSearch, true);
  assert.equal(plan.economy.reserve, 3);
  assert.ok(repairs.some(r => r.path === 'items.buy' && r.reason === 'list cap or duplicate'));
  assert.ok(repairs.some(r => r.path === 'items.buy' && String(r.value).includes('missing')));
  assert.ok(repairs.some(r => r.path === 'items.buy' && r.value === 'plugin_item' && /Final Assault/.test(r.reason)));
  // At the Final Assault prep an item for a carrier the plan names in items.equip stays.
  const fa = { ...digest, round: 14, boss: { id: 'boss', round: 14 } };
  const carrier = repairPlan({ items: { buy: ['plugin_item'], equip: [{ id: 'item', target: 'lead' }] } }, pack, fa, []);
  assert.deepEqual(carrier.plan.items.buy, []);
  pack.items.push({ id: 'plugin_item' });
  const named = repairPlan({ items: { buy: ['plugin_item'], equip: [{ id: 'plugin_item', target: 'lead' }] } }, pack, fa, []);
  assert.deepEqual(named.plan.items.buy, ['plugin_item']);
  assert.deepEqual(repairPlan({ items: { buy: ['plugin_item'], equip: [{ id: 'plugin_item', target: 'lead' }] } }, pack, { ...fa, round: 9 }, []).plan.items.buy, []);
  const held = repairPlan({ economy: { level: 2, holdLevel: true } }, pack, digest, []);
  assert.equal(held.plan.economy.holdLevel, undefined);
  assert.ok(held.repairs.some(r => r.path === 'economy.holdLevel'));
  const bad = repairPlan({ economy: { freezeSearch: 'yes', reserve: 1 } }, pack, digest, []);
  assert.equal(bad.plan.economy.freezeSearch, undefined);
  assert.equal(bad.plan.economy.reserve, 1);
  assert.ok(bad.repairs.some(r => r.path === 'economy.freezeSearch' && r.reason === 'unknown ID or invalid value'));
});
