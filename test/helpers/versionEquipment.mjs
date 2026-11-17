// Isolated historical-data check: install the version before importing match/content singletons, just like a host.
import assert from 'node:assert/strict';
import { getVersionData, setData } from '../../server/data.js';
import { installOfficialBounds, officialBoundsOf } from '../../shared/plugins/officialBounds.js';

const version = process.argv[2];
if (!version) process.exit(0); // a bare node --test may discover helpers
const data = setData(getVersionData(version, { log: { info() {}, warn() {}, error() {} } }));
installOfficialBounds(officialBoundsOf(data));
const { makeMatch } = await import('../match/harness.js');
const { generateDraft, applyCard } = await import('../../server/match/choices.js');
const { createRng } = await import('../../server/sim/rng.js');
const { isShopItem } = await import('../../server/sim/simdata.js');
const firstLevel = version.startsWith('act1') ? 5 : 1;
const results = [];
const draftsChecked = { supply: 0, shop: 0 };

for (const md of Object.values(data.config.modes).filter(m => m.inScope)) {
  const solo = md.type === 'SINGLE';
  const h = makeMatch({ data, mode: solo ? 'solo' : 'coop', difficulty: md.difficulty,
    humans: solo ? 1 : 4, bots: 0, seed: 53, fake: true }).start();
  try {
    h.toPrep(1);
    assert.equal(h.m.gd.config.version.id, version);
    assert.equal(h.m.gd.modeId, md.modeId);
    const levels = [];
    // Every seat buys, so this also exercises the shared item pool with four simultaneous players.
    for (const ps of h.m.players.values()) ps.funds = 1000;
    for (let level = 1; level <= 6; level++) {
      const chess = (md.difficulty === 'FUNNY' ? [3, 4, 4, 4, 4, 5] : [3, 4, 4, 5, 5, 5])[level - 1];
      const item = Number(level >= firstLevel);
      assert.deepEqual(h.m.gd.shopSlots(level), { chess, item });
      for (const ps of h.m.players.values()) {
        if (level > 1) {
          const old = ps.shop.slots.slice();
          const previous = h.m.gd.shopSlots(level - 1);
          assert.deepEqual(h.m.handle(ps.playerId, { t: 'g.levelUp' }), { ok: true });
          assert.deepEqual(ps.shop.slots.slice(0, previous.chess), old.slice(0, previous.chess));
          if (item > previous.item) assert.equal(ps.shop.slots[chess], null, 'new equipment slot opens empty');
        }
        assert.equal(ps.shop.level, level);
        assert.deepEqual(ps.privateView().shop.layout, { chess, item });
        assert.deepEqual(h.m.handle(ps.playerId, { t: 'g.refresh' }), { ok: true });
        assert.equal(ps.shop.slots.length, chess + item);
        assert.equal(ps.shop.slots.filter(s => s?.kind === 'item').length, item);
        if (!item) continue;
        const slot = ps.shop.slots[chess];
        assert.ok(isShopItem(data.items[slot.id]));
        assert.ok(data.items[slot.id].tier <= level);
        const view = ps.privateView().shop.slots[chess];
        assert.equal(view.kind, 'item');
        assert.equal(view.id, slot.id);
        const held = h.m.itemPool.held(slot.id);
        const funds = ps.funds;
        assert.deepEqual(h.m.handle(ps.playerId, { t: 'g.buy', slot: chess }), { ok: true });
        assert.equal(ps.funds, funds - view.price);
        assert.equal(h.m.itemPool.held(slot.id), held + 1, 'purchase reaches inventory (including an automatic merge)');
        assert.equal(ps.privateView().shop.slots[chess].sold, true);
      }
      if (item) levels.push(level);
    }
    h.invariants();
    assert.deepEqual(h.logs.error, []);
    results.push({ mode: md.modeId, players: h.m.players.size, levels });
  } finally { h.m.dispose(); }

  // A fresh match for each equipment draft: no stock depletion or earlier reward can mask a broken surface.
  for (const family of ['supply', 'shop']) {
    const d = makeMatch({ data, mode: solo ? 'solo' : 'coop', difficulty: md.difficulty,
      humans: solo ? 1 : 4, bots: 0, seed: 53, fake: true }).start();
    try {
      d.toPrep(1);
      for (const round of md.spRounds) {
        const schedule = data.choices.schedule[md.modeId].rounds[round];
        if (!schedule.families.some(f => f.family === family && f.weight > 0)) continue;
        let draft;
        for (let seed = 1; seed <= 200; seed++) {
          const candidate = generateDraft(d.m.gd, createRng(seed), round,
            { stageId: d.m.stageId, itemAvailable: id => d.m.itemPool.canGain(id) });
          if (candidate?.family === family) { draft = candidate; break; }
        }
        assert.ok(draft, `${md.modeId} R${round}: ${family} is reachable`);
        assert.equal(draft.cards.length, solo ? 3 : 6);
        for (const card of draft.cards) {
          assert.equal(card.kind, 'item');
          assert.equal(card.price, 0);
          assert.ok(isShopItem(data.items[card.id]));
        }
        const ps = d.ps('p_0');
        const card = draft.cards[0];
        const held = d.m.itemPool.held(card.id);
        applyCard(d.m, ps, card);
        assert.equal(d.m.itemPool.held(card.id), held + 1, 'draft pick grants its equipment');
        draftsChecked[family]++;
      }
      d.invariants();
      assert.deepEqual(d.logs.error, []);
    } finally { d.m.dispose(); }
  }
}
for (const [family, count] of Object.entries(draftsChecked)) assert.ok(count > 0, `${family} checked in this version`);

const h = makeMatch({ data, mode: 'solo', difficulty: 'NORMAL', seed: 53, fake: true }).start();
try {
  h.toPrep(1);
  const ps = h.ps('p_0');
  for (const [pool, spec] of Object.entries(data.choices.pools).filter(([, p]) => p.kind === 'equip')) {
    for (const id of [...(spec.items || []), ...(spec.weighted || []).map(p => p[0]), ...(spec.also || [])]) {
      assert.equal(data.items[id]?.itemType, 'EQUIP', `${pool}: explicit ids belong to this version`);
    }
    for (const shopLevel of [1, 6]) {
      const draw = h.m.rollPool(pool, { shopLevel });
      assert.equal(draw?.kind, 'item', pool);
      assert.equal(data.items[draw.id]?.itemType, 'EQUIP', pool);
      if (spec.maxTier === 'shopLevel') assert.ok(data.items[draw.id].tier <= shopLevel);
    }
  }
  // Free item reward uses the same private-view and g.reward path as trait offers.
  const ids = h.m.gd.shopItemsByTier[1].slice(0, 3);
  const offer = ps.pushItemOffer(ids, { label: 'equipment regression' });
  assert.equal(offer.slots.length, 3);
  assert.ok(ps.privateView().shop.rewardOffer.slots.every(s => s.kind === 'item' && s.price === 0));
  assert.deepEqual(h.m.handle(ps.playerId, { t: 'g.reward', idx: 0 }), { ok: true });
  assert.equal(h.m.itemPool.held(ids[0]), 1);
  assert.equal(ps.privateView().shop.rewardOffer, null);
  h.invariants();
  assert.deepEqual(h.logs.error, []);
} finally { h.m.dispose(); }
console.log(JSON.stringify(results));
