// §37.340 (the owner, 2026-11-22): an active bond disc draws a full, lit official ring at every tier. 规程 draws the unbroken
// 1_1, as in the official screenshot (PR #923 comment: 灵巧 Ⅱ, 精准 Ⅰ, 不屈 Ⅱ, 绝技 Ⅰ share one centre and one full ring; the
// numeral above the disc is the phase level). §37.342: the 盟约 periods draw N_N, N = the bond's first threshold, at every
// tier, and no numeral (recordings of all four periods). The bond popup's header disc wears N_N in 规程 too (`split`: the
// same 规程 screenshot's open 不屈 card, [2,3] at 3 members, draws 2_2 while its strip disc is unbroken). The segmented N_k
// rings stay for the member count before activation. Node test of the sprite choice (components.js bondFrame) and the bond strip's slot (in 规程 the numeral sits
// on the full ring's rim); on screen: test/ui/bond-display.e2e.test.js.
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
await data.loadAll('bonds', 'chess', 'assets', 'config');
const V31 = path.join(ROOT, 'data/versions/act3autochess-v3_1');
const V31_FILES = Object.fromEntries(['bonds', 'effects', 'config'].map((n) => [n, JSON.parse(readFileSync(path.join(V31, `${n}.json`), 'utf8'))]));
/** Run `fn` with the 规程·序列Ⅰ bonds, effects and config in the data store, then the default (盟约) files again. */
function withRegulation(fn) {
  data.setContent({ id: 'bond-ring-test-v3_1', values: V31_FILES });
  try { return fn(); } finally { data.setContent(null); }
}

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);

test('an active bond draws a full lit ring at every tier (规程 1_1, 盟约 and the popup disc N_N by the first threshold); member progress keeps the segmented rings', () => {
  // 规程 (phased): every active tier, whatever the thresholds: one sprite, the 77-unit unbroken ring
  for (const [members, minCount] of [[2, 2], [3, 2], [3, 3], [6, 3], [9, 3], [5, 2], [1, 1], [0, 0], [12, 4]]) {
    assert.deepEqual(bondFrame({ active: true, members, minCount, phased: true }), { key: 'bondBoardIcon/1_1', lit: true, progress: false, filled: 0, full: true },
      `${members}/${minCount}`);
  }
  // 盟约 (the default): N_N with N = the first threshold (at most 4), at every tier — 维多利亚 7/3 → 3_3, 迅捷 → 2_2,
  // 调和 / 独行 [1] → 1_1, no count at all → 1_1; the same 77-unit size
  for (const [members, minCount, key] of [[7, 3, '3_3'], [3, 3, '3_3'], [9, 3, '3_3'], [2, 2, '2_2'], [5, 2, '2_2'], [1, 1, '1_1'], [0, 0, '1_1'], [12, 4, '4_4'], [6, 6, '4_4']]) {
    assert.deepEqual(bondFrame({ active: true, members, minCount }), { key: `bondBoardIcon/${key}`, lit: true, progress: false, filled: 0, full: true },
      `${members}/${minCount}`);
    assert.equal(bondFrame({ active: true, members, minCount, phased: false }).key, `bondBoardIcon/${key}`);
  }
  // before activation: k of N members (N = the first threshold, at most 4), 65-unit sprites; none yet → N_1 greyed (filled 0)
  assert.deepEqual(bondFrame({ members: 1, minCount: 2 }), { key: 'bondBoardIcon/2_1', lit: false, progress: true, filled: 1, full: false });
  assert.deepEqual(bondFrame({ members: 2, minCount: 3 }), { key: 'bondBoardIcon/3_2', lit: false, progress: true, filled: 2, full: false });
  assert.deepEqual(bondFrame({ members: 0, minCount: 2 }), { key: 'bondBoardIcon/2_1', lit: false, progress: true, filled: 0, full: false });
  assert.equal(bondFrame({ members: 3, minCount: 6 }).key, 'bondBoardIcon/4_3');
  // a count at the threshold without activation draws N_N, the 77-unit sprite (sized as such)
  assert.deepEqual(bondFrame({ members: 3, minCount: 3 }), { key: 'bondBoardIcon/3_3', lit: false, progress: true, filled: 3, full: true });
  // disabled (本局禁用, a greyed core), or no count at all: the plain grey ring, in both versions
  for (const props of [{ active: true, disabled: true, members: 3, minCount: 2 }, { disabled: true, members: 1, minCount: 2 }, {}, { members: 2 }]) {
    for (const phased of [false, true]) {
      assert.deepEqual(bondFrame({ ...props, phased }), { key: 'bondBoardIcon/1_0', lit: false, progress: false, filled: 0, full: false }, JSON.stringify(props));
    }
  }
  // the progress rings do not depend on the version
  assert.equal(bondFrame({ members: 2, minCount: 3, phased: true }).key, 'bondBoardIcon/3_2');
  // split (the popup's header disc): N_N by the first threshold whatever the version, clamped to 1..4 (不屈 [2,3] at 3
  // members → 2_2, 调和 [1] → 1_1); split false the unbroken 1_1; progress and disabled keep their rings
  for (const [members, minCount, key] of [[3, 2, '2_2'], [7, 3, '3_3'], [1, 1, '1_1'], [0, 0, '1_1'], [6, 6, '4_4']]) {
    assert.deepEqual(bondFrame({ active: true, members, minCount, phased: true, split: true }), { key: `bondBoardIcon/${key}`, lit: true, progress: false, filled: 0, full: true },
      `${members}/${minCount}`);
  }
  assert.equal(bondFrame({ active: true, members: 7, minCount: 3, split: false }).key, 'bondBoardIcon/1_1');
  assert.equal(bondFrame({ members: 1, minCount: 2, phased: true, split: true }).key, 'bondBoardIcon/2_1');
  assert.equal(bondFrame({ active: true, disabled: true, members: 3, minCount: 2, phased: true, split: true }).key, 'bondBoardIcon/1_0');
});

test('BondDisc reads one sprite for the ring and the centre plate (no separate lit plate)', () => {
  const src = read('public/js/ui/components.js');
  const disc = src.slice(src.indexOf('export function BondDisc('), src.indexOf('// ---- seven-segment display'));
  assert.doesNotMatch(disc, /bondBoardIcon\/1_1|--bond-core-|badCoreFrame|maxTier/);
  const css = read('public/css/screens/bond.css');
  assert.doesNotMatch(css, /--bond-core-/);
  assert.match(css, /\.bond\.is-sprite \.bond__core::before \{[^}]*background: var\(--bond-frame\) center \/ calc\(var\(--bond-frame-size\) \* 1\.08\)/);
});

test('the bond strip (盟约): every active slot has the full ring\'s size and no numeral; the tier still reaches the disc', () => {
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
    assert.deepEqual([inSlot(id, 'BondDisc').props.minCount, inSlot(id, 'BondDisc').props.phased], [3, false], id);
    assert.equal(inSlot(id, 'BondStage').props.stage, 0, `${id}: no numeral in 盟约`);
  }
  assert.equal(slot('sargonShip').props.style, part);
  assert.ok(!hasClass(slot('sargonShip'), 'is-full'));
  assert.equal(inSlot('sargonShip', 'BondStage').props.stage, 0);
  assert.deepEqual([inSlot('sargonShip', 'BondDisc').props.members, inSlot('sargonShip', 'BondDisc').props.minCount], [2, 3]);
  assert.equal(slot('miraShip').props.style, part);
  // the detail card's header disc: the tier and the member count, no tier count
  const popup = [...walk(BondPopup({ bondId: 'yanShip', entry: bonds[0], priv: { board: [], hand: [], temp: [] }, onClose() {} }))];
  const head = popup.find((v) => v.type?.name === 'BondDisc');
  assert.deepEqual([head.props.active, head.props.tier, head.props.members, head.props.minCount, head.props.maxTier, head.props.phased, head.props.split], [true, 1, 3, 3, undefined, false, true]);
});

test('the bond strip (规程): every active slot sits its stage numeral on the unbroken ring\'s rim; the popup\'s header disc wears N_N (不屈 2_2)', () => withRegulation(() => {
  const bonds = [
    { bondId: 'ursusShip', count: 6, tier: 2, active: true, layers: 129, thresholds: [3, 6] },
    { bondId: 'swiftShip', count: 2, tier: 1, active: true, layers: 85, thresholds: [2] },
    { bondId: 'arcaneShip', count: 2, tier: 1, active: true, layers: 69, thresholds: [2, 3] },
    { bondId: 'raidShip', count: 1, tier: 0, active: false, layers: 12, thresholds: [2] },
  ];
  const nodes = [...walk(BondStrip({ bonds, onOpen() {} }))];
  const slot = (id) => nodes.find((v) => v.props?.['data-bond'] === id && hasClass(v, 'bslot'));
  const inSlot = (id, name) => [...walk(slot(id))].find((v) => v.type?.name === name);
  const full = `--bond-frame-size: .815rem; --bond-rim-top: ${13 / 77}`;
  for (const [id, stage] of [['ursusShip', 2], ['swiftShip', 2], ['arcaneShip', 1]]) {
    assert.equal(slot(id).props.style, full, id);
    assert.equal(inSlot(id, 'BondDisc').props.phased, true, id);
    assert.equal(inSlot(id, 'BondStage').props.stage, stage, id);
  }
  assert.equal(slot('raidShip').props.style, `--bond-frame-size: .688rem; --bond-rim-top: ${8 / 65}`);
  assert.equal(inSlot('raidShip', 'BondStage').props.stage, 0);
  // the strip's discs keep the version's ring (no split); the popup's header disc passes split, so it wears N_N
  assert.ok(['ursusShip', 'swiftShip', 'arcaneShip', 'raidShip'].every((id) => inSlot(id, 'BondDisc').props.split === undefined));
  const head = (entry) => [...walk(BondPopup({ bondId: entry.bondId, entry, priv: { board: [], hand: [], temp: [] }, onClose() {} }))].find((v) => v.type?.name === 'BondDisc');
  const indom = head({ bondId: 'indomShip', count: 3, tier: 2, active: true, layers: 26, thresholds: [2, 3] });
  assert.deepEqual([indom.props.phased, indom.props.split, indom.props.minCount], [true, true, 2]);
  assert.equal(bondFrame(indom.props).key, 'bondBoardIcon/2_2');
  assert.equal(bondFrame(head(bonds[3]).props).key, 'bondBoardIcon/2_1', 'inactive: the member progress');
}));
