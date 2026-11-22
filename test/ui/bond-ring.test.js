// §37.340 (the owner, 2026-11-22): an active bond disc draws the full official ring at every tier, as in the official 规程
// screenshot (PR #923 comment: 灵巧 Ⅱ, 精准 Ⅰ, 不屈 Ⅱ, 绝技 Ⅰ share one centre and one full ring; the tier is only the
// numeral above the disc), in every version. The segmented N_k rings stay for the member count before activation.
// Node test of the sprite choice (components.js bondFrame) and the bond strip's slot (the numeral sits on the full ring's
// rim); on screen: test/ui/bond-display.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// the browser data store reads the real data files from disk
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { bondFrame } = await import('../../public/js/ui/components.js');
const { BondStrip, BondPopup } = await import('../../public/js/ui/bondStrip.js');
const { data } = await import('../../public/js/data.js');
await data.loadAll('bonds', 'chess', 'assets');

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);

test('an active bond draws the full ring (1_1, lit centre) at every tier; member progress keeps the segmented rings', () => {
  // every active tier, whatever the thresholds: one sprite, the 77-unit full ring
  for (const [members, minCount] of [[2, 2], [3, 2], [3, 3], [6, 3], [9, 3], [5, 2], [1, 1], [0, 0], [12, 4]]) {
    assert.deepEqual(bondFrame({ active: true, members, minCount }), { key: 'bondBoardIcon/1_1', lit: true, progress: false, filled: 0, full: true },
      `${members}/${minCount}`);
  }
  // before activation: k of N members (N = the first threshold, at most 4), 65-unit sprites; none yet → N_1 greyed (filled 0)
  assert.deepEqual(bondFrame({ members: 1, minCount: 2 }), { key: 'bondBoardIcon/2_1', lit: false, progress: true, filled: 1, full: false });
  assert.deepEqual(bondFrame({ members: 2, minCount: 3 }), { key: 'bondBoardIcon/3_2', lit: false, progress: true, filled: 2, full: false });
  assert.deepEqual(bondFrame({ members: 0, minCount: 2 }), { key: 'bondBoardIcon/2_1', lit: false, progress: true, filled: 0, full: false });
  assert.equal(bondFrame({ members: 3, minCount: 6 }).key, 'bondBoardIcon/4_3');
  // a count at the threshold without activation draws N_N, the 77-unit sprite (sized as such)
  assert.deepEqual(bondFrame({ members: 3, minCount: 3 }), { key: 'bondBoardIcon/3_3', lit: false, progress: true, filled: 3, full: true });
  // disabled (本局禁用, a greyed core), or no count at all: the plain grey ring
  for (const props of [{ active: true, disabled: true, members: 3, minCount: 2 }, { disabled: true, members: 1, minCount: 2 }, {}, { members: 2 }]) {
    assert.deepEqual(bondFrame(props), { key: 'bondBoardIcon/1_0', lit: false, progress: false, filled: 0, full: false }, JSON.stringify(props));
  }
});

test('BondDisc reads one sprite for the ring and the centre plate (no separate lit plate)', () => {
  const src = read('public/js/ui/components.js');
  const disc = src.slice(src.indexOf('export function BondDisc('), src.indexOf('// ---- seven-segment display'));
  assert.doesNotMatch(disc, /bondBoardIcon\/1_1|--bond-core-|badCoreFrame|maxTier/);
  const css = read('public/css/screens/bond.css');
  assert.doesNotMatch(css, /--bond-core-/);
  assert.match(css, /\.bond\.is-sprite \.bond__core::before \{[^}]*background: var\(--bond-frame\) center \/ calc\(var\(--bond-frame-size\) \* 1\.08\)/);
});

test('the bond strip: every active slot sits its stage numeral on the full ring\'s rim, the tier still reaches the disc and the numeral', () => {
  const bonds = [
    { bondId: 'yanShip', count: 3, tier: 1, active: true, layers: 9, thresholds: [3, 6, 9] },
    { bondId: 'kazimierzShip', count: 6, tier: 2, active: true, layers: 8, thresholds: [3, 6, 9] },
    { bondId: 'siracusaShip', count: 6, tier: 2, active: true, layers: 7, thresholds: [3, 6] },
    { bondId: 'sargonShip', count: 2, tier: 0, active: false, layers: 0, thresholds: [3, 6] },
    { bondId: 'miraShip', count: 1, tier: 0, active: false, off: true, layers: 0 },
  ];
  const nodes = [...walk(BondStrip({ bonds, onOpen() {} }))];
  const slot = (id) => nodes.find((v) => v.props?.['data-bond'] === id && hasClass(v, 'bslot'));
  const inSlot = (id, name) => [...walk(slot(id))].find((v) => v.type?.name === name);
  const full = `--bond-frame-size: .815rem; --bond-rim-top: ${13 / 77}`;
  const part = `--bond-frame-size: .688rem; --bond-rim-top: ${8 / 65}`;
  for (const [id, tier] of [['yanShip', 1], ['kazimierzShip', 2], ['siracusaShip', 2]]) {
    assert.equal(slot(id).props.style, full, id);
    assert.ok(hasClass(slot(id), 'is-full'), id);
    assert.equal(inSlot(id, 'BondDisc').props.tier, tier);
    assert.equal(inSlot(id, 'BondDisc').props.maxTier, undefined);
    assert.equal(inSlot(id, 'BondStage').props.tier, tier);
  }
  assert.equal(slot('sargonShip').props.style, part);
  assert.ok(!hasClass(slot('sargonShip'), 'is-full'));
  assert.equal(inSlot('sargonShip', 'BondStage').props.tier, 0);
  assert.deepEqual([inSlot('sargonShip', 'BondDisc').props.members, inSlot('sargonShip', 'BondDisc').props.minCount], [2, 3]);
  assert.equal(slot('miraShip').props.style, part);
  // the detail card's header disc: the tier and the member count, no tier count
  const popup = [...walk(BondPopup({ bondId: 'yanShip', entry: bonds[0], priv: { board: [], hand: [], temp: [] }, onClose() {} }))];
  const head = popup.find((v) => v.type?.name === 'BondDisc');
  assert.deepEqual([head.props.active, head.props.tier, head.props.members, head.props.minCount, head.props.maxTier], [true, 1, 3, 3, undefined]);
});
