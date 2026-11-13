// The 规程 leader-ranking panel: vnode of the component, the viewer's hide preference, and the phone HUD boxes
// at 844×390 and 667×375 (1rem clamps to 40px). A hook component is not expanded — UnitThumb stays a vnode.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

const { LeaderRank, leaderSharePct, loadLeaderRankHidden, saveLeaderRankHidden } = await import('../../public/js/ui/leaderRank.js');

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
  return textOf(v.props?.children);
};

const ROWS = [
  { pid: 'p1', uid: 1, chess: 'op_a', tier: 5, dmg: 22 },
  { pid: 'p2', uid: 2, chess: 'op_b', tier: 4, dmg: 6 },
  { pid: 'p1', uid: 3, chess: 'op_c', tier: 6, dmg: 4 },
];
const PLAYERS = [{ playerId: 'p1', name: '博士甲' }, { playerId: 'p2', name: 'DoctorB' }];

test('the share is the operator\'s damage over the pool max, at least 1% for a real hit', () => {
  assert.equal(leaderSharePct(22, 100), 22);
  assert.equal(leaderSharePct(6, 100), 6);
  assert.equal(leaderSharePct(4, 100), 4);
  assert.equal(leaderSharePct(1, 1000), 1);
  assert.equal(leaderSharePct(0, 100), 0);
  assert.equal(leaderSharePct(10, 0), 0);
});

test('three rows: portrait, name, sword, percent; hidden leaves the show button', () => {
  let toggles = 0;
  const shown = LeaderRank({ rows: ROWS, players: PLAYERS, maxHp: 100, hidden: false, onToggle: () => { toggles += 1; } });
  const nodes = [...walk(shown)];
  const button = nodes.find((v) => v.type === 'button');
  assert.equal(textOf(button), '隐藏');
  button.props.onClick();
  assert.equal(toggles, 1);
  const text = textOf(shown);
  assert.equal(text.split('博士甲').length - 1, 2);
  assert.ok(text.includes('DoctorB'));
  assert.ok(text.includes('22%') && text.includes('6%') && text.includes('4%'));
  const thumbs = nodes.filter((v) => v.type && v.type.name === 'UnitThumb');
  assert.deepEqual(thumbs.map((v) => [v.props.id, v.props.tier, v.props.size]), [['op_a', 5, 'xs'], ['op_b', 4, 'xs'], ['op_c', 6, 'xs']]);
  const swords = nodes.filter((v) => v.type && v.type.name === 'Icon' && v.props.name === 'sword');
  assert.equal(swords.length, 3);
  const aside = nodes.find((v) => v.type === 'aside');
  assert.equal(aside.props['aria-label'], '领袖伤害排行');

  const hidden = LeaderRank({ rows: ROWS, players: PLAYERS, maxHp: 100, hidden: true, onToggle: () => {} });
  const hiddenNodes = [...walk(hidden)];
  assert.equal(textOf(hiddenNodes.find((v) => v.type === 'button')), '显示');
  assert.equal(hiddenNodes.some((v) => v.props?.class === 'ldmg__row'), false);
});

test('the hide preference survives a round trip and a throwing store stays shown', () => {
  const prev = globalThis.localStorage;
  try {
    const mem = new Map();
    globalThis.localStorage = {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, String(v)),
    };
    assert.equal(loadLeaderRankHidden(), false);
    saveLeaderRankHidden(true);
    assert.equal(loadLeaderRankHidden(), true);
    saveLeaderRankHidden(false);
    assert.equal(loadLeaderRankHidden(), false);
    globalThis.localStorage = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
    };
    assert.equal(loadLeaderRankHidden(), false);
    assert.doesNotThrow(() => saveLeaderRankHidden(true));
  } finally {
    globalThis.localStorage = prev;
  }
});

test('the panel clears the phone HUD at 844×390 and 667×375', () => {
  const css = read('public/css/screens/game.css');
  const page = read('public/index.html');
  assert.ok(page.indexOf('/css/components.css') < page.indexOf('/css/screens/game.css'), 'game.css wins over the slot rule');
  for (const decl of [
    'right: .92rem',
    'top: 1.95rem',
    'width: min(2.2rem, calc(100vw - 3.4rem - .92rem - .3rem))',
    'max-height: calc(50% - 1.95rem - .7rem)',
    'pointer-events: auto',
    '.gm.is-boss .gm__ui-slot { bottom: .3rem; max-height: calc(50% - 1.2rem); }',
  ]) assert.ok(css.includes(decl), decl);
  const game = read('public/js/screens/game.js');
  assert.ok(game.includes('is-boss') && game.includes('LeaderRank') && game.includes('leaderTop'));

  const remOf = (w, h) => Math.min(240, Math.max(40, Math.min(w / 19.2, h / 10.8)));
  const intersects = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  for (const [w, h] of [[844, 390], [667, 375]]) {
    const rem = remOf(w, h);
    assert.equal(rem, 40);
    const right = 0.92 * rem;
    const top = 1.95 * rem;
    const width = Math.min(2.2 * rem, w - 3.4 * rem - 0.92 * rem - 0.3 * rem);
    const height = h / 2 - 1.95 * rem - 0.7 * rem;
    const panel = { left: w - right - width, right: w - right, top, bottom: top + height };
    assert.ok(height > 1.5 * rem, 'three rows and the toggle fit the band');
    const team = { left: 0, right: 2.8 * rem, top: 2.36 * rem, bottom: h };
    const effects = { left: w - 0.8 * rem, right: w - 0.3 * rem, top: 2.4 * rem, bottom: h };
    const dp = { left: w - 1.5 * rem, right: w, top: h / 2 - 0.7 * rem, bottom: h / 2 + 0.7 * rem };
    const topBar = { left: 0, right: w, top: 0, bottom: 1.38 * rem };
    const ticker = { left: w / 2 - 3.8 * rem, right: w / 2 + 3.8 * rem, top: 1.0 * rem, bottom: 1.3 * rem };
    const corner = { left: 0, right: 4 * rem, top: h - 1.5 * rem, bottom: h };
    const chud = { left: w / 2 - 4.5 * rem, right: w / 2 + 4.5 * rem, top: h - 1.8 * rem, bottom: h - 0.3 * rem };
    const slotTop = h / 2 + 0.9 * rem;
    const slot = { left: w - 0.92 * rem - 2.6 * rem, right: w - 0.92 * rem, top: slotTop, bottom: h - 0.3 * rem };
    for (const [name, box] of [['team', team], ['effects', effects], ['dp', dp], ['top', topBar], ['ticker', ticker], ['corner', corner], ['chud', chud], ['slot', slot]]) {
      assert.equal(intersects(panel, box), false, `${w}×${h} overlaps ${name}`);
    }
  }
});
