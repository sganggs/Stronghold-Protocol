// Regression tests (Node) of user playtest #4, UI-flow items:
//   2  机变 picks take two taps like the shop (ui/choiceOverlay.js): the first tap selects a card (gold frame, 确认选择 ·
//      再次点击 strip, the header's 确认选择), the second — or 确认选择 — sends it; another card moves the selection; a card
//      that cannot be picked (not my turn, taken, a pick in flight) is never selected; the selection drops with it
//   3  untimed phases show no timer at all: Countdown renders nothing without a deadline; the 机变 overlay of an untimed
//      draft (solo, a single human) shows no clock and says so
//   7  the detail card's live stats (ui/detailPanel.js): battle / prep values coloured against the unit's base (green
//      up, red down, a shorter attack interval is up), the difference beside them, a 实时 / 开战时 tag; the battle HP
//      bar follows the live HP; the game screen asks g.unitStats for own board units in prep and reads the local sim in
//      battle
//   1  (layout) on a notched phone the shop bar keeps its place at the bottom edge instead of rising by the bottom inset
//      over the bench pads — a bench piece is pressed / dropped on by its tile (css/devices.css)
//   5  an effect-only item's card (the special 维式重锤, 突变细胞: items.json shopExcluded) says the shop never sells it
//      and where it comes from
// (server side: test/match/unitStats.test.js, test/match/draft.test.js, test/ui/bandDraft.test.js; the runner:
// test/match/runner.test.js)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// the browser data store reads the real data files from disk (the card renders below)
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { ChoiceView, spTap, armedCard, cardPickable } = await import('../../public/js/ui/choiceOverlay.js');
const { ChessDetail, ItemDetail, statTone, liveStat } = await import('../../public/js/ui/detailPanel.js');
const { Button } = await import('../../public/js/ui/components.js');
const { data } = await import('../../public/js/data.js');

/** Every vnode of a preact tree (htm output), depth first; `expand` names components rendered in place (hook-free). */
function* walk(v, expand = new Set()) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x, expand); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && expand.has(v.type.name)) { yield* walk(v.type(v.props), expand); return; }
  yield* walk(v.props?.children, expand);
}
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  if (typeof v === 'object' && typeof v.type === 'function' && ['Stat', 'LiveTag'].includes(v.type.name)) return textOf(v.type(v.props));
  return typeof v === 'object' ? textOf(v.props?.children) : '';
};
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);

// ---- 2: two-tap 机变 picks ----------------------------------------------------------------------------------------

describe('2: 机变 cards take two taps (select → confirm), like buying in the shop', () => {
  const sp = (o = {}) => ({
    family: 'bounty', name: '悬赏决策', desc: '', untimed: false, order: ['me', 'p2'], turnPid: 'me', pickOf: new Map(),
    cards: [{ idx: 0, name: 'A', desc: 'a', takenBy: null }, { idx: 1, name: 'B', desc: 'b', takenBy: null }, { idx: 2, name: 'C', desc: 'c', takenBy: 'p2' }],
    ...o,
  });
  const me = { myId: 'me', solo: false };

  test('spTap: the first tap selects, the second on the same card confirms, another card moves the selection', () => {
    assert.deepEqual(spTap(null, 0, true), { armed: 0, pick: null }, 'first tap: selected, nothing sent');
    assert.deepEqual(spTap(0, 0, true), { armed: null, pick: 0 }, 'second tap on it: sent');
    assert.deepEqual(spTap(0, 1, true), { armed: 1, pick: null }, 'another card: the selection moves');
    assert.deepEqual(spTap(1, 0, false), { armed: 1, pick: null }, 'a card that cannot be picked changes nothing');
    assert.deepEqual(spTap(null, 'x', true), { armed: null, pick: null });
  });

  test('cardPickable / armedCard: only my turn, before my pick, a free card, nothing in flight — the selection drops otherwise', () => {
    const s = sp();
    assert.equal(cardPickable(s, s.cards[0], me), true);
    assert.equal(cardPickable(s, s.cards[2], me), false, 'taken');
    assert.equal(cardPickable(sp({ turnPid: 'p2' }), s.cards[0], me), false, 'not my turn');
    assert.equal(cardPickable(sp({ turnPid: 'p2' }), s.cards[0], { myId: 'me', solo: true }), true, 'solo: always my turn');
    assert.equal(cardPickable(sp({ pickOf: new Map([['me', 1]]) }), s.cards[0], me), false, 'after my pick');
    assert.equal(cardPickable(s, s.cards[0], { ...me, busyIdx: 1 }), false, 'a pick in flight');
    assert.equal(armedCard(0, s, me), 0);
    assert.equal(armedCard(2, s, me), null, 'a taken card is never selected');
    assert.equal(armedCard(0, sp({ turnPid: 'p2' }), me), null, 'the turn moved on (timeout)');
    assert.equal(armedCard(0, s, { ...me, busyIdx: 0 }), null);
    assert.equal(armedCard(7, s, me), null);
    assert.equal(armedCard(null, s, me), null);
  });

  test('ChoiceView: the selected card lifts with a 确认选择 · 再次点击 strip, the header offers 确认选择; taps go through onTap', () => {
    const s = sp();
    const taps = [];
    let confirmed = 0;
    const v = ChoiceView({ pub: { players: [{ playerId: 'me', seat: 0, name: 'Me' }, { playerId: 'p2', seat: 1, name: 'P2' }], deadline: 0 }, sp: s, ...me,
      armed: 1, onTap: (i) => taps.push(i), onConfirm: () => { confirmed++; } });
    assert.ok(hasClass(v, 'has-armed'));
    const nodes = [...walk(v)];
    const cards = nodes.filter((n) => hasClass(n, 'spcard'));
    assert.equal(cards.length, 3);
    assert.deepEqual(cards.map((c) => hasClass(c, 'is-armed')), [false, true, false]);
    assert.equal(cards[1].props['aria-pressed'], 'true');
    assert.match(cards[1].props['aria-label'], /已选中，再次点击确认/);
    assert.equal(textOf(nodes.find((n) => hasClass(n, 'spcard__confirm'))), '确认选择再次点击');
    const btn = nodes.find((n) => n.type === Button);
    assert.ok(btn && textOf(btn.props.children).includes('确认选择'), 'the header confirm');
    btn.props.onClick();
    assert.equal(confirmed, 1);
    cards[0].props.onClick();
    cards[1].props.onClick();
    cards[2].props.onClick(); // taken: disabled, never tapped
    assert.deepEqual(taps, [0, 1]);
    assert.equal(cards[2].props.disabled, true);
    // nothing selected: no strip, no confirm button, the hint says how it works
    const idle = [...walk(ChoiceView({ pub: { players: [] }, sp: s, ...me }))];
    assert.ok(!idle.some((n) => hasClass(n, 'spcard__confirm')));
    assert.ok(!idle.some((n) => n.type === Button));
    assert.match(textOf(idle.find((n) => hasClass(n, 'spov__sub'))), /点击卡牌选中，再次点击确认/);
  });

  test('3: an untimed 机变 (solo, a single human) shows no clock and says so; a timed one keeps its countdown', () => {
    const timed = [...walk(ChoiceView({ pub: { players: [], deadline: Date.now() + 9000 }, sp: sp(), ...me }))];
    assert.ok(timed.some((n) => n.type?.name === 'Countdown'));
    assert.match(textOf(timed.find((n) => hasClass(n, 'spov__sub'))), /倒计时结束后仍未选定将自动分配/);
    const lone = [...walk(ChoiceView({ pub: { players: [], deadline: 0 }, sp: sp({ untimed: true }), ...me }))];
    assert.ok(!lone.some((n) => n.type?.name === 'Countdown'), 'a single human\'s co-op draft: untimed');
    assert.match(textOf(lone.find((n) => hasClass(n, 'spov__sub'))), /无时间限制/);
  });

  test('教鞭 ChoiceView: personal heading, no global order or turn; timing follows PREP deadline', () => {
    const s = sp({ name: '教鞭 · 战术特训', desc: '请选择一项战术特训', cards: sp().cards.slice(0, 2) });
    for (const [solo, deadline] of [[false, 0], [true, 123456]]) {
      let confirmed = false;
      const v = ChoiceView({ pub: { players: [{ playerId: 'me', name: 'Me' }, { playerId: 'p2', name: 'P2' }], deadline }, sp: s,
        ...me, solo, personal: true, armed: 0, total: 74, onConfirm: () => { confirmed = true; } });
      const nodes = [...walk(v)];
      assert.equal(v.props['aria-label'], '教鞭选择');
      assert.ok(!nodes.some((n) => hasClass(n, 'spov__order')));
      assert.doesNotMatch(textOf(v), /机变阶段|当前轮到|正在决策/);
      const clock = nodes.find((n) => n.type?.name === 'Countdown');
      assert.equal(!!clock, deadline > 0);
      if (clock) { assert.equal(clock.props.deadline, deadline); assert.equal(clock.props.total, 74); }
      assert.match(textOf(nodes.find((n) => hasClass(n, 'spov__sub'))), deadline ? /休整期结束时未选择将自动选定/ : /无时间限制/);
      const btn = nodes.find((n) => n.type === Button);
      btn.props.onClick();
      assert.ok(confirmed);
      assert.match(btn.props.title, /确认选择「A」/);
      assert.match(nodes.find((n) => hasClass(n, 'spcard')).props.title, /^A\na$/);
    }
  });

  test('the overlay keeps the selection itself and drops it on Esc / a tap elsewhere (source contract)', () => {
    const src = read('public/js/ui/choiceOverlay.js');
    assert.match(src, /export function ChoiceOverlay\(props\) \{[\s\S]*useState\(null\)[\s\S]*armedCard\(sel, sp/);
    assert.match(src, /e\.key === 'Escape'/);
    assert.match(src, /closest\('\.spcard, \.spov__confirm'\)/);
    const css = read('public/css/screens/game-panels.css');
    assert.match(css, /\.spcard\.is-armed/);
    assert.match(css, /\.spcard__confirm \{/);
  });
});

// ---- 3: no timer without a deadline --------------------------------------------------------------------------------

describe('3: untimed phases show no timer', () => {
  test('Countdown renders nothing without a deadline (the "--" placeholder read as a timer)', () => {
    const comp = read('public/js/ui/components.js');
    const fn = comp.slice(comp.indexOf('export function Countdown'), comp.indexOf('// ---- Modal'));
    assert.match(fn, /if \(remain == null\) return null;/);
    // after the hooks (a component may toggle between timed and untimed)
    assert.ok(fn.indexOf('useEffect(') < fn.indexOf('if (remain == null) return null;'));
  });
});

// ---- 7: live stats -------------------------------------------------------------------------------------------------

describe('7: the detail card shows live stats against the base', () => {
  test('statTone: higher is up, a shorter attack interval is up, rounding noise is equal', () => {
    assert.equal(statTone('atk', 1042, 501), 'up');
    assert.equal(statTone('atk', 400, 501), 'down');
    assert.equal(statTone('atk', 501.3, 501), null);
    assert.equal(statTone('interval', 0.9, 1.05), 'up', 'faster attacks help');
    assert.equal(statTone('interval', 1.3, 1.05), 'down');
    assert.equal(statTone('interval', 1.052, 1.05), null);
    assert.equal(statTone('res', 12.3, 10), 'up');
    assert.equal(statTone('res', 10.02, 10), null);
    assert.equal(statTone('blockCnt', 2, 3), 'down');
    assert.equal(statTone('atk', null, 3), null);
  });

  test('liveStat: the live value with its difference and the base in the title; the record value without live stats', () => {
    const live = { atk: 1042, interval: 0.95, res: 12.5, base: { atk: 501, interval: 1.05, res: 10 } };
    assert.deepEqual(liveStat(live, 'atk', 501), { v: '1,042', tone: 'up', sub: '+541', title: '基础 501' });
    const iv = liveStat(live, 'interval', 1.05, (v) => `${v.toFixed(2)}s`);
    assert.deepEqual(iv, { v: '0.95s', tone: 'up', sub: '−0.10', title: '基础 1.05s' });
    assert.equal(liveStat(live, 'res', 10, String).sub, '+2.5');
    assert.deepEqual(liveStat(null, 'atk', 501), { v: '501', tone: null, sub: null, title: undefined });
    assert.equal(liveStat(null, 'atk', null).v, '—');
    assert.deepEqual(liveStat({ atk: 501, base: { atk: 501 } }, 'atk', 501), { v: '501', tone: null, sub: null, title: '基础 501' });
  });

  test('a rendered card: live values coloured, the 实时 / 开战时 tag, the battle HP bar from the live HP', async () => {
    await data.loadAll('chess', 'garrisons', 'assets', 'bonds', 'items');
    const c = data.lookup('chess', 'chess_char_1_01_a');
    assert.ok(c);
    const s = c.stats;
    const live = {
      src: 'battle', hp: 300, maxHp: Math.round(s.maxHp * 1.2), atk: Math.round(s.atk * 0.8), def: s.def, res: s.res ?? 0,
      interval: 0.5, blockCnt: s.blockCnt,
      base: { maxHp: s.maxHp, atk: s.atk, def: s.def, res: s.res ?? 0, interval: 1, blockCnt: s.blockCnt },
    };
    const blocks = ChessDetail({ chess: c, piece: null, editable: false, bonds: [], loadout: null, live });
    const stats = blocks.find((b) => b.key === 'stats');
    assert.ok(hasClass(stats, 'is-live'));
    assert.equal(stats.props['data-live'], 'battle');
    const cells = [...walk(stats, new Set(['Stat', 'LiveTag']))].filter((n) => hasClass(n, 'dstat'));
    const cell = (k) => cells.find((n) => textOf(n).startsWith(k));
    assert.ok(hasClass(cell('生命上限'), 'is-up'));
    assert.ok(hasClass(cell('攻击'), 'is-down') && !hasClass(cell('攻击间隔'), 'is-down'));
    assert.ok(hasClass(cell('攻击间隔'), 'is-up'), 'a shorter interval is a buff');
    assert.ok(!hasClass(cell('防御'), 'is-up') && !hasClass(cell('防御'), 'is-down'), 'unchanged');
    assert.ok(textOf(stats).includes('实时'));
    const head = blocks.find((b) => b.key === 'head');
    const hp = [...walk(head)].find((n) => hasClass(n, 'dhp'));
    assert.ok(textOf(hp).includes(`300 / ${live.maxHp.toLocaleString('en-US')}`), 'the live HP');
    // the prep preview: 开战时, no HP bar
    const prep = ChessDetail({ chess: c, piece: null, editable: false, bonds: [], loadout: null, live: { ...live, src: 'prep' } });
    assert.ok(textOf(prep.find((b) => b.key === 'stats')).includes('开战时'));
    assert.ok(![...walk(prep.find((b) => b.key === 'head'))].some((n) => hasClass(n, 'dhp')));
    // no live stats: the record's numbers, no tag
    const plain = ChessDetail({ chess: c, piece: null, editable: false, bonds: [], loadout: null });
    const pstats = plain.find((b) => b.key === 'stats');
    assert.ok(!hasClass(pstats, 'is-live'));
    assert.ok(!textOf(pstats).includes('实时') && !textOf(pstats).includes('开战时'));
  });

  test('the game screen feeds it: g.unitStats for an own board unit in prep (newest answer only), the local sim in battle', () => {
    const src = read('public/js/screens/game.js');
    assert.match(src, /net\.on\('m\.unitStats'/);
    assert.match(src, /msg\.seq !== statsSeqRef\.current/, 'only the newest request\'s answer');
    assert.match(src, /net\.request\('g\.unitStats', \{ seq: statsSeqRef\.current \}\)/);
    assert.match(src, /battleRunner\.unitStats\(uid, fid\)/);
    assert.match(src, /live=\$\{liveStats\}/);
    const panel = read('public/js/ui/detailPanel.js');
    assert.match(panel, /useTicker\(detail && \(getter \|\| bondTimers\) \? 250 : 0\)/, 'a getter is re-read 4× a second');
    // an own board piece's card opened in prep and left open into the battle turns live (its unit found by uid)
    assert.match(src, /battleRunner\.unitIdOf\(pieceUid, myId, fid\)/);
  });
});

// ---- 1 (layout) / 5 ------------------------------------------------------------------------------------------------

describe('1 / 5: the bench stays reachable on a notched phone; effect-only items say where they come from', () => {
  test('devices.css: the shop bar steps back over the HUD\'s bottom inset (it covered ~3/4 of bench pads 2–9)', () => {
    const css = read('public/css/devices.css');
    assert.match(css, /\.gm__hud > \.shopbar \{ bottom: calc\(\.2rem - var\(--sa-b\)\); \}/);
    // the shop's own rule stays the desktop place (.2rem from the bottom): the inset rule only cancels the HUD inset
    assert.match(read('public/css/screens/game-shop.css'), /\.shopbar \{\n {2}position: absolute; right: \.26rem; bottom: \.2rem;/);
  });

  test('ItemDetail: 调度中心不出售 + the source for the special 维式重锤 / 突变细胞, nothing for a shop item', async () => {
    await data.loadAll('items', 'assets');
    const special = data.lookup('items', 'chess_item_4_09_e_a');     // 灼燃维式重锤
    const cell = data.lookup('items', 'chess_item_5_08_e_a');        // 突变细胞
    assert.ok(special?.shopExcluded && cell?.shopExcluded, 'items.json marks them');
    const plain = data.list('items').find((i) => i.itemType === 'EQUIP' && !i.shopExcluded && !i.isGolden);
    const note = (item) => [...walk(ItemDetail({ item, piece: null, editable: false }))].find((n) => hasClass(n, 'dhint--source'));
    assert.match(textOf(note(special)), /调度中心不出售 · 获取途径：维多利亚盟约每25层 \/ 洛洛的定制品/);
    assert.match(textOf(note(cell)), /昆图斯/);
    assert.equal(note(plain), undefined, 'a shop item has no such line');
  });
});
