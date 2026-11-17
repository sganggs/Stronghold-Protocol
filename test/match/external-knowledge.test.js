import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knowledgePack, interestDigest } from '../../server/ai/knowledge.js';
import { makeMatch, DATA, give } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { aiObservation } from '../../server/match/externalAI.js';
import { validateC2S } from '../../shared/protocol.js';
import { buildRecordOverlay } from '../../shared/i18nData.js';
import { getVersionData } from '../../server/data.js';

const opts = { modeId: 'mode_single_normal' };
test('knowledge is immutable, cached, content-addressed, language-aware and independent of match state', () => {
  const a = knowledgePack(DATA, opts);
  assert.equal(a, knowledgePack(DATA, opts)); assert.match(a.version, /^[0-9a-f]{64}$/);
  assert.ok(Object.isFrozen(a.operators));
  const en = knowledgePack(DATA, { ...opts, language: 'en' });
  assert.notEqual(a.version, en.version); assert.ok(en.operators.some(p => p.name !== p.nameZh));
  assert.ok(a.operators.some(p => p.skill.effect)); assert.ok(a.items.some(i => i.effect));
  assert.ok(a.bonds.every(b => b.thresholds.length)); assert.equal(a.economy.exp, null);
  assert.match(a.economy.shopOdds, /remaining/);
  assert.match(a.economy.freezeRule, /unsold/);
  assert.match(a.economy.refreshRule, /cancels freezing/);
  assert.match(a.economy.sellRule, /not their purchase price/);
  assert.ok(a.operators.every(p => p.sellValue >= 0));
  assert.ok(a.bands.find(b => b.id === 'band_cannot').carriesFunds);
  assert.equal(a.bands.find(b => b.id === 'band_narant').carriesFunds, false);
  for (const l of a.economy.shop) assert.ok(Math.abs(l.initialTierSharesBeforeBans.reduce((s, p) => s + p.probability, 0) - 1) < 1e-8);
  const copy = structuredClone(DATA);
  assert.equal(knowledgePack(copy, opts).version, a.version);
  copy.chess[Object.keys(copy.chess)[0]].skill.desc += ' changed';
  assert.notEqual(knowledgePack({ ...copy }, opts).version, a.version);
  assert.notEqual(knowledgePack(DATA, { ...opts, source: 'changed docs' }).version, a.version);
  assert.notEqual(knowledgePack(DATA, { ...opts, contentId: 'plugin-script-version' }).version, a.version);
  assert.ok(a.playingEconomy.includes('|'));
  assert.notEqual(knowledgePack(DATA, { ...opts, rules: { unequip: 'allow' } }).version, a.version);
});

test('another official version\'s data names it (gameVersion, DESIGN §35.23); the default pack has no such key', () => {
  const a = knowledgePack(DATA, opts);
  assert.equal(Object.hasOwn(a, 'gameVersion'), false);
  const v = knowledgePack(getVersionData('act1autochess'), opts);
  assert.equal(v.gameVersion, 'act1autochess');
  assert.notEqual(v.version, a.version);
  assert.ok(v.bonds.length === 18, '第一期\'s 18 bonds');
});

test('active plugin records and offer cards are included; stale translations cannot mask plugin edits', () => {
  const data = { ...DATA, items: { ...DATA.items, plugin_item: { name: 'Plugin item', desc: 'Extra effect', tier: 1, price: 2 } } };
  const overlay = { files: { items: { plugin_item: buildRecordOverlay([{ path: ['name'], zh: 'old name', en: 'Stale' }]) } } };
  const p = knowledgePack(data, { ...opts, language: 'en', overlay, offers: [{ pluginId: 'demo', id: 'o', cards: [{ id: 'a', name: 'Choice' }] }] });
  assert.equal(p.items.find(x => x.id === 'plugin_item').name, 'Plugin item');
  assert.equal(p.pluginOffers[0].cards[0].name, 'Choice');
  assert.notEqual(p.version, knowledgePack(DATA, opts).version);
});

test('interest follows coin_carry_over data, with no universal interest or EXP invented', () => {
  const gd = new GameData(DATA, opts.modeId);
  assert.equal(interestDigest(gd, 'band_bldsk', 100).now, 0);
  const r = interestDigest(gd, 'band_cannot', 4);
  assert.equal(r.carries, true); assert.equal(r.now, 0); assert.equal(r.nextGold, 5); assert.equal(r.nextInterest, 1);
  assert.equal(interestDigest(gd, 'band_cannot', 5).now, 1);
});

test('digest uses wire-visible names, progress, positions and public scouting, never opponents private data', t => {
  const h = makeMatch({ humans: 2, fake: true }); t.after(() => h.m.dispose()); h.start().toPrep();
  const { m } = h, ps = m.order[0], other = m.order[1];
  const p = give(m, ps, m.gd.visibleChess[0]);
  give(m, other, m.gd.visibleChess[1]); other.funds = 987654321;
  const rng = [m.rngBots.state(), m.rngShop.state()];
  const o = aiObservation(m, ps, { id: 'one', kind: 'prep', remaining: 64, deadline: 100 }, []);
  assert.ok(o.digest.bench.some(x => x.uid === p.uid && x.nameZh));
  assert.equal(o.digest.economy.exp, null); assert.equal(o.digest.economy.gold, ps.funds);
  assert.ok(!JSON.stringify(o).includes('987654321'));
  assert.equal(o.digest.opponents[0].board.length, 0);
  assert.ok(o.digest.bonds.every(b => b.nameZh && b.nextThreshold > b.count || b.nextThreshold === null));
  assert.deepEqual(rng, [m.rngBots.state(), m.rngShop.state()]);
  assert.ok(o.digest.actions.length > 0);
  for (const a of o.digest.actions) assert.equal(validateC2S(a.intent), null, a.text);
});

test('short action IDs map only to their observation and use ordinary human semantic validation', t => {
  const h = makeMatch({ mode: 'solo', fake: true, botStrategy: 'external', externalReplay: true,
    seats: [{ seat: 0, playerId: 'ai_0', name: 'AI', isBot: true }] });
  t.after(() => h.m.dispose()); h.start();
  const pending = () => [...h.m.externalAI.jobs.values()][0];
  h.run(() => !!pending());
  let j = pending(); const band = [...j.actions].find(([, i]) => i.t === 'g.band');
  h.m.externalReply(j.id, { v: 'sp-ai/1', id: j.id, intents: [band[0]], done: true }, false);
  h.run(() => pending()?.kind === 'prep'); j = pending();
  const buy = [...j.actions].find(([, i]) => i.t === 'g.buy'); assert.ok(buy);
  const ps = h.m.order[0]; ps.funds = 0;
  const results = [], original = h.m.externalAI.request.bind(h.m.externalAI);
  h.m.externalAI.request = job => { results.push(...job.state.results); original(job); };
  h.m.externalReply(j.id, { v: 'sp-ai/1', id: j.id, intents: [buy[0], 'a999999'], done: false }, false);
  assert.equal(results[0].error, 'NO_FUNDS'); assert.equal(results[1].error, 'BAD_MSG');
  assert.equal(ps.funds, 0);
});
