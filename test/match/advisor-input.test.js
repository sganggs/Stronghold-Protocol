import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DATA, makeMatch, give, giveItem } from './harness.js';
import { knowledgePack, effectText } from '../../server/ai/knowledge.js';
import { buildPlaybook } from '../../server/ai/playbook.js';
import { strategyCandidates } from '../../server/ai/strategy.js';
import { aiDigest } from '../../server/match/aiDigest.js';
import { advisorSystem, STRATEGY_PROMPT } from '../../tools/ai/llm-agent.mjs';
import { slimKnowledge } from '../../tools/ai/llm-knowledge.mjs';
import { compactDigest, compactChoices, focusPlan } from '../../tools/ai/llm-context.mjs';
import { repairPlan } from '../../tools/ai/llm-plan.mjs';
import { validPlan } from '../../server/match/aiPlan.js';

const hard = knowledgePack(DATA, { modeId: 'mode_multi_hard' });
const fixture = JSON.parse(readFileSync(new URL('../fixtures/llm-advisor.json', import.meta.url), 'utf8'));

test('the example system prompt is a slim view of the unchanged pack and stays within 200000 characters', () => {
  const system = advisorSystem(hard);
  assert.ok(system.length <= 200000, `hard system is ${system.length} characters`);
  assert.ok(system.startsWith(STRATEGY_PROMPT));
  assert.ok(!system.includes('[object Object]'));
  const view = JSON.parse(system.slice(system.indexOf('\nKnowledge:\n') + '\nKnowledge:\n'.length));
  assert.ok(view.enemies.length > 100, 'Chinese hard still carries compact enemies');
  assert.equal(view.playbook.operators, undefined);
  assert.equal(view.playbook.enemies, undefined);
  assert.ok(view.playbook.community && view.playbook.cycles && view.playbook.graph && view.playbook.pairings);
  assert.ok(view.playbook.legacyReference && view.playbook.bandInsights.length);
  assert.ok(hard.playbook.operators.length > 100 && hard.playbook.enemies.length > 50, 'the served pack is not replaced');
  assert.ok(hard.operators[0].traits && hard.operators[0].skill);
  const tin = view.operators.filter(o => o.name === '锡人');
  assert.ok(tin.some(o => o.id === 'chess_char_1_16_a' && o.tier === 1));
  assert.ok(tin.some(o => o.id === 'chess_char_2_19_a' && o.tier === 2));
  for (const o of view.operators) {
    assert.ok(o.trait.length <= 120);
    assert.equal(typeof o.skill, 'string');
    assert.deepEqual(Object.keys(o.caps).sort(), ['air', 'block', 'elementRecovery', 'sustain']);
  }
  const funny = advisorSystem(knowledgePack(DATA, { modeId: 'mode_single_funny', language: 'en' }));
  assert.ok(funny.length <= 200000, `english funny system is ${funny.length} characters`);
  const funnyView = JSON.parse(funny.slice(funny.indexOf('\nKnowledge:\n') + '\nKnowledge:\n'.length));
  assert.equal(funnyView.enemies.length, 0, 'drop compact enemies only when the prefix would exceed the budget');
  assert.match(STRATEGY_PROMPT, /Activated layers across ALL bonds/);
  assert.match(STRATEGY_PROMPT, /primary bond/);
  assert.match(STRATEGY_PROMPT, /caps\.air/);
  assert.match(STRATEGY_PROMPT, /freezeSearch/);
  assert.match(STRATEGY_PROMPT, /items\.buy/);
  assert.match(STRATEGY_PROMPT, /holdLevel/);
  assert.match(STRATEGY_PROMPT, /\*_b/);
});

test('enemy effect text keeps handbook strings and drops ability objects', () => {
  assert.equal(effectText(['desc', { text: '攻击造成灼燃损伤', textRaw: 'raw', format: '{}' }]), 'desc 攻击造成灼燃损伤');
  assert.equal(effectText({ desc: 'only desc' }), 'only desc');
  const row = hard.enemies.find(e => e.id === 'enemy_1305_mhslim');
  assert.match(row.effect, /灼燃/);
  assert.equal(row.effect.includes('[object Object]'), false);
  assert.equal(hard.enemies.some(e => String(e.effect).includes('[object Object]')), false);
  const notes = slimKnowledge({ bosses: [{ id: 'b', name: 'n', enemyKey: 'e', notes: [{ text: '射线', format: 'obj' }] }] });
  assert.equal(notes.bosses[0].notes, '射线');
});

test('band draft returns at most eight uncontended community directions; prep collapses subs', () => {
  const book = buildPlaybook(DATA, { modeId: 'mode_multi_hard' });
  const open = { playerId: 'self', round: 1, band: { id: null }, availability: {}, board: [], bench: [],
    opponents: [], factions: [], economy: { level: 1, gold: 0 }, deployCap: 6,
    actions: book.bands.map((b, i) => ({ id: `a${i}`, intent: { t: 'g.band', bandId: b.id } })) };
  const draft = strategyCandidates(book, open).candidates;
  assert.equal(draft.length, 8);
  assert.equal(new Set(draft.map(c => c.band)).size, draft.length);
  for (const id of ['band_pepe', 'band_paganini', 'band_clementia', 'band_harold']) assert.ok(draft.some(c => c.band === id), id);
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

test('repair keeps the advisor plan fields items.buy and economy.freezeSearch (§35.14)', () => {
  const pack = structuredClone(fixture.knowledge);
  pack.items = [...pack.items, ...Array.from({ length: 8 }, (_, i) => ({ id: `extra${i}` }))];
  const digest = structuredClone(fixture.digest);
  digest.shop = [...digest.shop, { id: 'plugin_item', kind: 'item', slot: 1 }];
  const buy = ['item', 'plugin_item', 'support', 'missing', ...pack.items.filter(i => i.id.startsWith('extra')).map(i => i.id)];
  const { plan, repairs } = repairPlan({ items: { buy }, economy: { freezeSearch: true, reserve: 3 } }, pack, digest, []);
  assert.ok(validPlan(plan));
  assert.equal(plan.items.buy.length, 8);
  assert.ok(plan.items.buy.includes('plugin_item') && !plan.items.buy.includes('missing') && !plan.items.buy.includes('support'));
  assert.equal(plan.economy.freezeSearch, true);
  assert.equal(plan.economy.reserve, 3);
  assert.ok(repairs.some(r => r.path === 'items.buy' && r.reason === 'list cap or duplicate'));
  assert.ok(repairs.some(r => r.path === 'items.buy' && String(r.value).includes('missing')));
  const held = repairPlan({ economy: { level: 2, holdLevel: true } }, pack, digest, []);
  assert.equal(held.plan.economy.holdLevel, undefined);
  assert.ok(held.repairs.some(r => r.path === 'economy.holdLevel'));
  const bad = repairPlan({ economy: { freezeSearch: 'yes', reserve: 1 } }, pack, digest, []);
  assert.equal(bad.plan.economy.freezeSearch, undefined);
  assert.equal(bad.plan.economy.reserve, 1);
  assert.ok(bad.repairs.some(r => r.path === 'economy.freezeSearch' && r.reason === 'unknown ID or invalid value'));
});
