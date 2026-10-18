// The shared 机变 draft in the official 悬赏决策 look (the event's video 9:59 – 10:16; ui/choiceOverlay.js,
// ui/teamPanel.js, css/screens/game-panels.css):
//   - the pick order is no list in the overlay: the team panel's portraits carry it — ✓ who has picked, ••• who is
//     deciding (spMarks); solo and the personal 教鞭 pick have none
//   - the header names the player deciding over 正在决策… (or 当前轮到你决策 / 已完成选择) beside the countdown
//   - the armed card's strip is ☑ 确认选择 · 再次点击
//   - the match's top bar stays on screen during the draft (round, funds and timer stay readable)

import { test } from 'node:test';
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

const { ChoiceView, spMarks } = await import('../../public/js/ui/choiceOverlay.js');

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  return typeof v === 'object' ? textOf(v.props?.children) : '';
};
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);

const sp = (o = {}) => ({
  family: 'bounty', name: '悬赏决策', desc: '', untimed: false, order: ['p1', 'me', 'p3'], turnPid: 'me', pickOf: new Map([['p1', 0]]),
  cards: [{ idx: 0, name: 'A', desc: 'a', takenBy: 'p1' }, { idx: 1, name: 'B', desc: 'b', takenBy: null }, { idx: 2, name: 'C', desc: 'c', takenBy: null }],
  ...o,
});
const players = [{ playerId: 'p1', seat: 0, name: 'Amiya' }, { playerId: 'me', seat: 1, name: 'Me' }, { playerId: 'p3', seat: 2, name: 'Kal\'tsit' }];

test('spMarks: ✓ for who has picked, ••• for who is deciding, nothing for who waits; none in solo or without an order', () => {
  assert.deepEqual([...spMarks(sp(), { solo: false })], [['p1', 'done'], ['me', 'turn']]);
  assert.deepEqual([...spMarks(sp({ turnPid: 'p3', pickOf: new Map([['p1', 0], ['me', 1]]) }), { solo: false })],
    [['p1', 'done'], ['me', 'done'], ['p3', 'turn']]);
  assert.equal(spMarks(sp(), { solo: true }).size, 0);
  assert.equal(spMarks(sp({ order: null }), { solo: false }).size, 0);
  assert.equal(spMarks(null, { solo: false }).size, 0);
});

test('ChoiceView: no order list in the overlay; the player deciding is named over 正在决策…', () => {
  const v = ChoiceView({ pub: { players, deadline: Date.now() + 9000 }, sp: sp({ turnPid: 'p3', pickOf: new Map([['p1', 0], ['me', 1]]) }),
    myId: 'p3x', solo: false });
  const nodes = [...walk(v)];
  assert.ok(!nodes.some((n) => hasClass(n, 'spov__order')), 'the order lives on the team panel');
  const who = nodes.find((n) => hasClass(n, 'spov__tw'));
  assert.ok(who, 'the deciding player beside the countdown');
  assert.equal(textOf(who), 'Kal\'tsit正在决策…');
  assert.ok(nodes.some((n) => n.type?.name === 'Countdown'));
  assert.doesNotMatch(textOf(v), /CONTINGENCY/);
  const mine = ChoiceView({ pub: { players, deadline: 0 }, sp: sp(), myId: 'me', solo: false });
  assert.match(textOf(mine), /当前轮到你决策/);
  const done = ChoiceView({ pub: { players, deadline: 0 }, sp: sp({ turnPid: 'p3', pickOf: new Map([['p1', 0], ['me', 1]]) }), myId: 'me', solo: false });
  assert.match(textOf(done), /已完成选择/);
});

test('the armed card\'s strip is ☑ 确认选择 · 再次点击', () => {
  const v = ChoiceView({ pub: { players, deadline: 0 }, sp: sp(), myId: 'me', solo: false, armed: 1 });
  const strip = [...walk(v)].find((n) => hasClass(n, 'spcard__confirm'));
  assert.ok(strip);
  assert.ok([...walk(strip)].some((n) => hasClass(n, 'spcard__cbox')), 'the check box');
  assert.equal(textOf(strip), '确认选择再次点击');
});

test('the team panel draws the marks; the match screen passes them only for the shared draft (source contract)', () => {
  const panel = read('public/js/ui/teamPanel.js');
  assert.match(panel, /spMarks\?\.get\(p\.playerId\) === 'done' \? html`<span class="team__spmark is-done"/);
  assert.match(panel, /spMarks\?\.get\(p\.playerId\) === 'turn' \? html`<span class="team__spmark is-turn"/);
  const game = read('public/js/screens/game.js');
  assert.match(game, /spMarks=\$\{sp \? spMarks\(sp, \{ solo \}\) : null\}/);
  assert.match(read('public/css/screens/game.css'), /\.team__spmark\.is-turn i \{/);
});

test('the top bar stays on screen during the shared draft', () => {
  const css = read('public/css/screens/game-panels.css');
  assert.doesNotMatch(css, /has-spdraft[^{]*\.gtop[^{]*\{[^}]*(visibility:\s*hidden|display:\s*none|opacity:\s*0)/);
  assert.match(css, /\.spov__inner \{ position: absolute; left: \.3rem; right: \.5rem; top: 1\.14rem;/, 'the overlay starts below the top bar');
});
