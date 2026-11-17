// Player feedback after 0.1.0, report #6 (workstream WB): "凯瑟琳策略升级刷新的三个装备显示异常". The strategy 凯瑟琳
// (【定向投放】"每次升级调度中心时，在调度中心刷新随机3件装备，可以选择并获得其中1件") queues a free pick-one offer of three
// items; the shop bar drew every offer slot as an operator card (ChessCard on an item id: no art, the raw id as the name,
// tier I, no description) under the promotion reward's 晋升奖励 / PROMOTION header, and the reminder pill said
// 晋升奖励待选择. Now: m.private shop.rewardOffer says what made the offer (`source` 'merge' | 'special', `label` = the
// effect's name — effectsMeta.offerLabel), an item slot is drawn as an item card (FREE) and the header / pill name the
// offer (gameLogic.offerHeader; `queued` — "之后还有 N 项" / the pill's "+N" — when more offers wait behind it, e.g. a
// 定向投放 behind a promotion reward put off). The same path serves 娜仁图亚 见者有份 (two items), 寻呼模块 / 信标
// (operators, an item's name) and 松果's 特质. Real match paths for the server side; the bar's offer cards rendered as
// vnodes.
// The browser check (desktop + phones, real input) is test/ui/feedback1-offers.e2e.test.js (SP_E2E=1).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { offerHeader } = await import('../../public/js/ui/gameLogic.js');
const { RewardCards, ItemCard, ChessCard } = await import('../../public/js/ui/shopBar.js');
const { RewardOverlay } = await import('../../public/js/ui/rewardOverlay.js');
const { data } = await import('../../public/js/data.js');
const { DATA, makeMatch, give, giveItem, chessOfTier, legalTileFor } = await import('../match/harness.js');
const { offerLabel } = await import('../../server/match/effectsMeta.js');

await data.loadAll('chess', 'bonds', 'items', 'assets');

const OK = { ok: true };
const PAGER = 'chess_item_4_01_e_a'; // 寻呼模块

/** A solo prep with an empty board and hand, plenty of funds, the given strategy. */
function prep(band, seed = 61) {
  const h = makeMatch({ mode: 'solo', difficulty: 'NORMAL', seed, fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.offers.length = 0;
  ps.funds = 60;
  ps.bandId = band;
  ps.recompute();
  return { h, m, ps };
}

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}

describe('#6 the server names its offers (m.private shop.rewardOffer source / label)', () => {
  test('凯瑟琳 (the players\' case): a level-up offers three different items, free, labelled 定向投放; a pick takes one into the hand', () => {
    const { m, ps } = prep('band_cathy');
    ps.shop.upgradePrice = 0;
    assert.deepEqual(m.handle('p_0', { t: 'g.levelUp' }), OK);
    const offer = ps.privateView().shop.rewardOffer;
    assert.ok(offer, 'an offer after the level-up');
    assert.equal(offer.source, 'special');
    assert.equal(offer.label, '定向投放', 'the strategy\'s effect name');
    assert.equal(offer.tier, null, 'items carry their own tiers');
    assert.equal(offer.slots.length, 3);
    assert.equal(new Set(offer.slots.map((s) => s.id)).size, 3, 'three different items');
    for (const s of offer.slots) {
      assert.equal(s.kind, 'item');
      assert.equal(s.price, 0);
      // any tier since 0.2.0 (community report of 2026-10-06: 「原版凯瑟琳1升2都能有6本装备」).
      // 突变细胞 joined the pool on 2026-10-14 (#631); the shop slot still never sells it.
      assert.ok(DATA.items[s.id] && DATA.items[s.id].itemType === 'EQUIP' && !DATA.items[s.id].isGolden && (s.id === 'chess_item_5_08_e_a' || !DATA.items[s.id].shopExcluded), s.id);
    }
    const want = offer.slots[1].id;
    const funds = ps.funds;
    assert.deepEqual(m.handle('p_0', { t: 'g.reward', idx: 1 }), OK);
    assert.equal(ps.funds, funds, 'free');
    assert.ok([...ps.hand, ...ps.temp].some((p) => p && p.kind === 'item' && (p.id === want || p.id === DATA.items[want].goldenId)), 'the item is owned');
    assert.equal(ps.privateView().shop.rewardOffer, null, 'the offer is gone');
    m.dispose();
  });

  test('two level-ups in one prep queue two offers: the second shows after the first pick, never stale', () => {
    const { m, ps } = prep('band_cathy', 62);
    for (let i = 0; i < 2; i++) { ps.shop.upgradePrice = 0; assert.deepEqual(m.handle('p_0', { t: 'g.levelUp' }), OK); }
    assert.equal(ps.offers.length, 2, 'two offers queued');
    assert.equal(ps.privateView().shop.rewardOffer.slots.length, 3, 'the first one is shown');
    assert.equal(ps.privateView().shop.rewardOffer.queued, 1, 'one more waits behind it');
    assert.deepEqual(m.handle('p_0', { t: 'g.reward', idx: 0 }), OK);
    const second = ps.privateView().shop.rewardOffer;
    assert.ok(second && second.label === '定向投放' && second.slots.length === 3 && second.slots.every((s) => !s.sold), 'the second offer, all free to pick');
    assert.equal(second.queued, 0);
    assert.deepEqual(m.handle('p_0', { t: 'g.reward', idx: 2 }), OK);
    assert.equal(ps.privateView().shop.rewardOffer, null);
    m.dispose();
  });

  test('娜仁图亚 见者有份 (two items), 寻呼模块 (operators of its bond) and the promotion reward', () => {
    const { m, ps } = prep('band_narant', 63);
    ps.shop.level = 3;
    m.round = 2;
    m.dispatch(ps, 'onPrepStart', { round: 2 }); // 「偶数回合进入休整期时」 (GitHub #851)
    let offer = ps.privateView().shop.rewardOffer;
    assert.ok(offer && offer.source === 'special' && offer.label === '见者有份', JSON.stringify(offer));
    assert.equal(offer.slots.length, 2);
    assert.ok(offer.slots.every((s) => s.kind === 'item'));
    ps.offers.length = 0;
    // 寻呼模块: equipped on an operator — three operators sharing a bond, labelled with the item
    const id = chessOfTier(1).find((x) => m.pool.has(x) && m.pool.left(x) > 0);
    const op = give(m, ps, id, 'board', legalTileFor(m, ps, id));
    const pager = giveItem(m, ps, PAGER);
    assert.deepEqual(m.handle('p_0', { t: 'g.equip', itemUid: pager.uid, targetUid: op.uid }), OK);
    offer = ps.privateView().shop.rewardOffer;
    assert.ok(offer && offer.source === 'special' && offer.label === '寻呼模块', JSON.stringify(offer));
    assert.ok(offer.slots.length >= 1 && offer.slots.every((s) => s.kind === 'chess'));
    ps.offers.length = 0;
    // the promotion reward
    ps.pushRewardOffer('merge');
    offer = ps.privateView().shop.rewardOffer;
    assert.equal(offer.source, 'merge');
    assert.equal(offer.label, null);
    assert.ok(Number.isInteger(offer.tier));
    m.dispose();
  });

  test('a promotion reward put off, then a 凯瑟琳 level-up: the promotion reward shows with "+1" (queued 1), then 定向投放', () => {
    const { m, ps } = prep('band_cathy', 65);
    ps.pushRewardOffer('merge');
    ps.shop.upgradePrice = 0;
    assert.deepEqual(m.handle('p_0', { t: 'g.levelUp' }), OK);
    let offer = ps.privateView().shop.rewardOffer;
    assert.equal(offer.source, 'merge', 'the promotion reward first');
    assert.equal(offer.queued, 1, 'the 定向投放 offer waits behind it');
    const head = offerHeader(offer);
    assert.equal(head.pill, '晋升奖励待选择');
    assert.equal(head.queued, 1);
    assert.equal(head.more, '之后还有 1 项');
    const pill = RewardOverlay({ priv: { shop: { rewardOffer: offer } }, minimized: true, onMinimize() {} });
    const texts = [...walk(pill)].flatMap((n) => (Array.isArray(n.props?.children) ? n.props.children.filter((x) => typeof x === 'string' || typeof x === 'number') : typeof n.props?.children === 'string' ? [n.props.children] : []));
    assert.ok(texts.join('').includes('+1'), `the pill says +1 (${texts.join(' | ')})`);
    assert.deepEqual(m.handle('p_0', { t: 'g.reward', idx: 0 }), OK);
    offer = ps.privateView().shop.rewardOffer;
    assert.ok(offer.source === 'special' && offer.label === '定向投放' && offer.queued === 0, JSON.stringify(offer));
    assert.equal(offerHeader(offer).more, null);
    m.dispose();
  });

  test('offerLabel: a strategy → its effect name, an item → its name, a 特质 → its operator, anything else → null', () => {
    const { m } = prep(null, 64);
    const gd = m.gd;
    assert.equal(offerLabel(gd, { kind: 'band', bandId: 'band_cathy' }), '定向投放');
    assert.equal(offerLabel(gd, { kind: 'band', band: gd.band('band_narant') }), '见者有份');
    assert.equal(offerLabel(gd, { kind: 'item', piece: { id: 'chess_item_5_04_e_a' } }), '信标');
    const chess = chessOfTier(2)[0];
    assert.equal(offerLabel(gd, { kind: 'garrison', piece: { id: chess } }), DATA.chess[chess].name);
    assert.equal(offerLabel(gd, { kind: 'global', key: 'global:x' }), null);
    assert.equal(offerLabel(gd, null), null);
    m.dispose();
  });
});

describe('#6 the shop bar draws the offer by its slots and names it', () => {
  const ITEMS = Object.values(DATA.items).filter((it) => it.itemType === 'EQUIP' && !it.isGolden).slice(0, 3).map((it) => it.id);
  const cathy = { tier: null, source: 'special', label: '定向投放', slots: ITEMS.map((id) => ({ kind: 'item', id, price: 0, sold: false })) };
  const merge = { tier: 3, source: 'merge', label: null, slots: chessOfTier(3).slice(0, 3).map((id) => ({ kind: 'chess', id, price: 0, sold: false })) };

  test('offerHeader: 晋升奖励 for the promotion reward, the label for a special refresh (items: 免费选择 1 件)', () => {
    assert.deepEqual(offerHeader(merge), { title: '晋升奖励', micro: 'PROMOTION', sub: '免费选择 1 名', icon: 'crown', items: false, pill: '晋升奖励待选择', queued: 0, more: null });
    assert.deepEqual(offerHeader(cathy), { title: '定向投放', micro: 'SPECIAL', sub: '免费选择 1 件', icon: 'refresh', items: true, pill: '定向投放待选择', queued: 0, more: null });
    assert.equal(offerHeader({ ...cathy, queued: 2 }).more, '之后还有 2 项');
    assert.equal(offerHeader({ ...cathy, queued: -1 }).queued, 0, 'a bad count is ignored');
    assert.equal(offerHeader({ ...merge, source: 'special', label: '寻呼模块' }).title, '寻呼模块');
    assert.equal(offerHeader({ ...merge, source: 'special', label: '寻呼模块' }).sub, '免费选择 1 名');
    assert.equal(offerHeader({ ...cathy, label: null }).title, '装备补给', 'an unnamed item offer');
    assert.equal(offerHeader({ tier: 2, slots: merge.slots }).title, '晋升奖励', 'an offer view without source (older server) is the promotion reward');
  });

  test('RewardCards: item slots → ItemCard (FREE), chess slots → ChessCard; the header says 定向投放', () => {
    const priv = { alive: true, funds: 0, hand: Array(10).fill(null), temp: Array(5).fill(null), board: [], shop: { rewardOffer: cathy } };
    const v = RewardCards({ offer: cathy, priv, editable: true, onPick() {}, onDetail() {}, onLater() {}, armed: null, onTap() {} });
    const nodes = [...walk(v)];
    const cards = nodes.filter((n) => n.type === ItemCard || n.type === ChessCard);
    assert.equal(cards.length, 3);
    for (const c of cards) {
      assert.equal(c.type, ItemCard, 'an item card');
      assert.equal(c.props.free, true, 'FREE');
      assert.equal(c.props.slot.price, 0);
      assert.equal(c.props.reason, null, 'pickable with 0 funds');
    }
    const title = nodes.find((n) => typeof n.props?.class === 'string' && n.props.class.includes('rwtag__title'));
    assert.equal(String(title.props.children), '定向投放');
    // the item card itself: icon, name, description, FREE (no price hex)
    const card = ItemCard({ ...cards[0].props });
    const inner = [...walk(card.type === 'button' || card.props?.class?.includes?.('scard') ? card : card.props.children)];
    const texts = inner.flatMap((n) => (typeof n.props?.children === 'string' ? [n.props.children] : []));
    assert.ok(texts.includes(DATA.items[ITEMS[0]].name), `the name (${texts.join(' | ')})`);
    assert.ok(inner.some((n) => typeof n.props?.class === 'string' && n.props.class.includes('scard__itemart')), 'the item art');
    // the promotion reward still draws operator cards under 晋升奖励
    const vm = RewardCards({ offer: merge, priv: { ...priv, shop: { rewardOffer: merge } }, editable: true, onPick() {}, onDetail() {}, onLater() {}, armed: null, onTap() {} });
    const mcards = [...walk(vm)].filter((n) => n.type === ItemCard || n.type === ChessCard);
    assert.ok(mcards.length === 3 && mcards.every((c) => c.type === ChessCard));
    assert.equal(String([...walk(vm)].find((n) => typeof n.props?.class === 'string' && n.props.class.includes('rwtag__title')).props.children), '晋升奖励');
    assert.ok(!nodes.some((n) => typeof n.props?.class === 'string' && n.props.class.includes('rwtag__more')), 'nothing queued: no "之后还有" line');
    // an offer with another one behind it says so in the header
    const vq = RewardCards({ offer: { ...merge, queued: 1 }, priv: { ...priv, shop: { rewardOffer: merge } }, editable: true, onPick() {}, onDetail() {}, onLater() {}, armed: null, onTap() {} });
    const more = [...walk(vq)].find((n) => typeof n.props?.class === 'string' && n.props.class.includes('rwtag__more'));
    assert.equal(String(more.props.children), '之后还有 1 项');
  });

  test('the reminder pill names the offer (定向投放待选择), with a tier chip only for operator offers', () => {
    const pill = RewardOverlay({ priv: { shop: { rewardOffer: cathy } }, minimized: true, onMinimize() {} });
    const texts = [...walk(pill)].flatMap((n) => (typeof n.props?.children === 'string' ? [n.props.children] : []));
    assert.ok(texts.includes('定向投放待选择'), texts.join(' | '));
    const mp = RewardOverlay({ priv: { shop: { rewardOffer: merge } }, minimized: true, onMinimize() {} });
    assert.ok([...walk(mp)].flatMap((n) => (typeof n.props?.children === 'string' ? [n.props.children] : [])).includes('晋升奖励待选择'));
  });
});

test('#617: a reward offer replaces the whole shop row — the equipment slot hides too, and only the offer\'s cards arm', () => {
  const src = readFileSync(path.join(ROOT, 'public/js/ui/shopBar.js'), 'utf8');
  assert.match(src, /\$\{showReward \? null : html`<div class="shopbar__item">/, 'the equipment column is not drawn under a reward offer');
  assert.match(src, /if \(showReward\) reward\.slots\.forEach\([^\n]*\n\s*else slots\.forEach/, 'the shop slots are not armable meanwhile');
});

