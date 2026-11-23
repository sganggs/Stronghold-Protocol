// §37.342: the bond discs of the four 盟约 periods follow the official recordings (31 recordings, about 200 disc readings):
// no numeral above any disc, active or not, at any tier or layer count (维多利亚 7 members 155 layers bare, BV1yyC9BPEXV
// 1600 s; 迅捷 crossing 40 bare, BV1gLUGBrEv2 p1 728 → 729 s); an active disc wears the full lit ring split by the bond's
// FIRST threshold (bondBoardIcon N_N: 维多利亚 3_3, 迅捷 2_2, 调和 1_1) at every tier; the popup reads members / first
// threshold with the check (7/3 ✓, 4/3, 1/1) and 层数, no 阶段 tag; the no-stack bonds draw no layer count. 规程 keeps its
// phase numerals, the unbroken 1_1 and its next-threshold count (test/ui/bond-stage.test.js, test/ui/bond-ring.test.js).
// Node tests on the real data files: the default data (第二期下半), the 第一期 and 第二期上半 version files, and 规程·序列Ⅰ.
// On screen: test/ui/bond-display.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = (p) => JSON.parse(readFileSync(path.join(ROOT, p), 'utf8'));

// the browser data store reads the real default data files from disk
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { options } = await import('../../public/vendor/preact.module.js');
const { bondPhased, bondCountCap } = await import('../../public/js/ui/gameLogic.js');
const { BondDisc, bondFrame } = await import('../../public/js/ui/components.js');
const { BondStrip, BondPopup } = await import('../../public/js/ui/bondStrip.js');
const { BondChips } = await import('../../public/js/ui/detailPanel.js');
const { MatchBondRow } = await import('../../public/js/ui/matchInfo.js');
const { data } = await import('../../public/js/data.js');
await data.loadAll('bonds', 'effects', 'chess', 'assets', 'config');

const versionFiles = (dir) => Object.fromEntries(['bonds', 'effects', 'config'].map((n) => [n, readJson(`data/versions/${dir}/${n}.json`)]));
const VERSIONS = {
  V1_1: versionFiles('act1autochess-v1_1'),
  V1_2: versionFiles('act1autochess'),
  V2_1: versionFiles('act2autochess-v2_1'),
  V3_1: versionFiles('act3autochess-v3_1'),
};
/** Run `fn` with a version's bonds, effects and config in the data store, then the default files (第二期下半) again. */
function withVersion(id, fn) {
  data.setContent({ id: `bond-covenant-test-${id}`, values: VERSIONS[id] });
  try { return fn(); } finally { data.setContent(null); }
}
/** The four 盟约 periods: the default files and three version folders. */
function eachCovenant(fn) {
  fn('V2_2');
  for (const id of ['V1_1', 'V1_2', 'V2_1']) withVersion(id, () => fn(id));
}

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const textOf = (v) => [...walk(v)].flatMap((n) => (Array.isArray(n.props?.children) ? n.props.children : [n.props?.children]))
  .filter((x) => typeof x === 'string' || typeof x === 'number').join('');
/**
 * Call BondDisc as a render would (its two useState hooks need a current component: preact's render hook `__r`), so its
 * own default `phased` (the loaded config) is what picks the sprite.
 */
function discVnode(props) {
  options.__r?.({ __c: { setState() {} } });
  return BondDisc(props);
}
/** The bondBoardIcon key a disc vnode draws (its --bond-frame), and its stack count text (null: none). */
function drawn(props) {
  const v = discVnode(props);
  const key = (String(v.props.style).match(/bondBoardIcon\/(\w+)\.png/) || [])[1] || null;
  const count = [...walk(v)].find((n) => hasClass(n, 'bond__count'));
  return { key, count: count ? textOf(count) : null };
}
/** One strip slot: its BondDisc props, the drawn sprite and count, the stage the strip draws over it (0: none). */
function slotOf(bonds, id) {
  const nodes = [...walk(BondStrip({ bonds, onOpen() {} }))];
  const slot = nodes.find((v) => v.props?.['data-bond'] === id && hasClass(v, 'bslot'));
  const disc = [...walk(slot)].find((v) => v.type === BondDisc);
  const stage = [...walk(slot)].find((v) => v.type?.name === 'BondStage');
  return { slot, disc: disc.props, ...drawn(disc.props), stage: stage?.props.stage ?? null };
}
/** The popup's header: population text, check, 阶段 tags, 层数 block, the header disc's sprite. */
function popupOf(bondId, entry, extra = {}) {
  const nodes = [...walk(BondPopup({ bondId, entry, priv: { board: [], hand: [], temp: [] }, onClose() {}, ...extra }))];
  const pop = nodes.find((v) => hasClass(v, 'bpop__population'));
  const disc = nodes.find((v) => v.type === BondDisc);
  const layers = nodes.find((v) => hasClass(v, 'bpop__layers'));
  return {
    population: pop ? textOf(pop).replace(/\s+/g, '') : null,
    check: nodes.some((v) => hasClass(v, 'bpop__check')),
    stages: nodes.filter((v) => hasClass(v, 'bpop__stage') && !hasClass(v, 'bpop__inactive')).map(textOf),
    inactive: nodes.some((v) => hasClass(v, 'bpop__inactive')),
    layers: layers ? textOf(layers).replace(/\s+/g, '') : null,
    ring: drawn(disc.props).key,
  };
}

const VIC = { bondId: 'victoriaShip', count: 7, tier: 2, active: true, layers: 155, thresholds: [3, 6] };
const SWIFT = { bondId: 'swiftShip', count: 2, tier: 1, active: true, layers: 85, thresholds: [2] };
const MANI = { bondId: 'maniShip', count: 1, tier: 1, active: true, layers: 0, thresholds: [1] };

test('bondPhased: the 规程 family only (config.json version.family); the default data and the three 盟约 version folders are not', () => {
  assert.equal(bondPhased(data.get('config')), false, '第二期下半 (the default files carry no version)');
  for (const id of ['V1_1', 'V1_2', 'V2_1']) assert.equal(bondPhased(VERSIONS[id].config), false, id);
  assert.equal(bondPhased(VERSIONS.V3_1.config), true);
  for (const c of [null, undefined, {}, { version: { family: 'covenant' } }]) assert.equal(bondPhased(c), false);
  // the store follows the loaded version
  assert.equal(withVersion('V3_1', () => bondPhased(data.get('config'))), true);
  assert.equal(withVersion('V1_1', () => bondPhased(data.get('config'))), false);
});

test('盟约 strip: 维多利亚 7 members 155 layers — no numeral, the 3_3 ring, 155 on the disc (BV1yyC9BPEXV 1600 s), in all four periods', () => {
  eachCovenant((v) => {
    const s = slotOf([VIC], 'victoriaShip');
    assert.equal(s.stage, 0, `${v}: no numeral`);
    assert.deepEqual([s.disc.phased, s.disc.minCount, s.disc.tier, s.key, s.count], [false, 3, 2, '3_3', '155'], v);
    assert.ok(hasClass(s.slot, 'is-full'), v);
    assert.equal(s.slot.props.style, `--bond-frame-size: .815rem; --bond-rim-top: ${13 / 77}`, v);
  });
});

test('盟约 strip: 迅捷 85 layers — no numeral, the 2_2 ring (BV1X6wRzhEVU 840 s); 调和 active — 1_1, no layer number', () => {
  eachCovenant((v) => {
    const swift = slotOf([SWIFT], 'swiftShip');
    assert.deepEqual([swift.stage, swift.key, swift.count], [0, '2_2', '85'], v);
    const mani = slotOf([MANI], 'maniShip');
    assert.deepEqual([mani.stage, mani.key, mani.count, mani.disc.layers], [0, '1_1', null, undefined], v);
  });
  // every active tier, every layer count: never a numeral (炎 [3,6,9] at nine members, 远见 past its milestones)
  const many = [
    { bondId: 'yanShip', count: 9, tier: 3, active: true, layers: 999, thresholds: [3, 6, 9] },
    { bondId: 'visiShip', count: 2, tier: 1, active: true, layers: 616, thresholds: [2] },
    { bondId: 'investShip', count: 3, tier: 1, active: true, layers: 120, thresholds: [3] },
    { bondId: 'raidShip', count: 1, tier: 0, active: false, layers: 64, thresholds: [2] },
  ];
  for (const b of many) assert.equal(slotOf(many, b.bondId).stage, 0, b.bondId);
  assert.deepEqual(['yanShip', 'visiShip', 'investShip'].map((id) => slotOf(many, id).key), ['3_3', '2_2', '3_3']);
  // inactive: the grey progress arc, unchanged
  assert.equal(slotOf(many, 'raidShip').key, '2_1');
});

test('盟约 no-stack bonds (调和, 协防干员, 独行, 绝技) draw no layer count on the disc or in the popup; 规程 likewise (绝技 in BV12ZWP6pE7m p1 340 s)', () => {
  const noStack = [
    MANI,
    { bondId: 'emptyShip', count: 2, tier: 1, active: true, layers: 9, thresholds: [2] },
    { bondId: 'soloShip', count: 1, tier: 1, active: true, layers: 9, thresholds: [1] },
    { bondId: 'suntShip', count: 2, tier: 1, active: true, layers: 9, thresholds: [2, 5] },
  ];
  const check = (v, version) => {
    for (const b of noStack) {
      if (!data.lookup('bonds', b.bondId)) continue;
      assert.equal(data.lookup('bonds', b.bondId).noStack, true, `${version} ${b.bondId}`);
      const s = slotOf(noStack, b.bondId);
      assert.deepEqual([s.count, s.disc.layers], [null, undefined], `${version} ${b.bondId}`);
      assert.equal(popupOf(b.bondId, b).layers, null, `${version} ${b.bondId}`);
    }
  };
  eachCovenant((v) => check(v, v));
  withVersion('V3_1', () => check('V3_1', 'V3_1'));
  // the first period has 协防干员 [3] and no 独行 / 绝技
  withVersion('V1_2', () => {
    assert.deepEqual([data.lookup('bonds', 'soloShip'), data.lookup('bonds', 'suntShip')], [null, null]);
    assert.equal(slotOf([{ bondId: 'emptyShip', count: 3, tier: 1, active: true, layers: 0, thresholds: [3] }], 'emptyShip').key, '3_3');
  });
});

test('盟约 popup: 维多利亚 7/3 ✓, 层数 155, the 3_3 header disc, no 阶段 tag; 投资人 4/3; 调和 1/1 without 层数; inactive 远见 1/2 尚未激活', () => {
  eachCovenant((v) => {
    assert.deepEqual(popupOf('victoriaShip', VIC), { population: '在场7/3', check: true, stages: [], inactive: false, layers: '层数155', ring: '3_3' }, v);
    assert.deepEqual(popupOf('investShip', { bondId: 'investShip', count: 4, tier: 1, active: true, layers: 14, thresholds: [3] }),
      { population: '在场4/3', check: true, stages: [], inactive: false, layers: '层数14', ring: '3_3' }, v);
    assert.deepEqual(popupOf('maniShip', MANI), { population: '在场1/1', check: true, stages: [], inactive: false, layers: null, ring: '1_1' }, v);
    assert.deepEqual(popupOf('swiftShip', SWIFT), { population: '在场2/2', check: true, stages: [], inactive: false, layers: '层数85', ring: '2_2' }, v);
    // inactive (BV1yyC9BPEXV 1590 s: 远见 1/2 尚未激活): unchanged — the first threshold is the next one
    const idle = popupOf('visiShip', { bondId: 'visiShip', count: 1, tier: 0, active: false, layers: 43, thresholds: [2] });
    assert.deepEqual([idle.population, idle.check, idle.inactive, idle.stages, idle.ring], ['在场1/2尚未激活', false, true, [], '2_1'], v);
    // 本局禁用 keeps its tag and no count
    const off = popupOf('miraShip', { bondId: 'miraShip', count: 2, tier: 0, active: false, layers: 120, thresholds: [2] }, { off: true });
    assert.deepEqual([off.population, off.stages, off.ring], [null, ['本局禁用'], '1_0'], v);
  });
});

test('bondCountCap: the first threshold in a 盟约 period; 规程 the next one, the top one when maxed', () => {
  assert.deepEqual([[7, [3, 6]], [4, [3]], [1, [1]], [1, [2]], [0, [3, 6, 9]], [5, []]].map(([c, th]) => bondCountCap(c, th, false)), [3, 3, 1, 2, 3, null]);
  assert.deepEqual([[7, [3, 6]], [4, [3, 6]], [1, [2]], [0, [3, 6, 9]], [5, []]].map(([c, th]) => bondCountCap(c, th, true)), [6, 6, 2, 3, null]);
  assert.equal(bondCountCap(7, [3, 6]), 6, 'default: 规程');
});

test('盟约 detail chip and strip tooltip: the popup\'s count (7/3), and 「，已激活」 with no 阶 (the strip draws no numeral)', () => {
  const chipOf = (bonds, id) => [...walk(BondChips({ bondIds: [id], bonds }))].find((v) => v.props?.['data-bond'] === id);
  const label = (bonds, id) => chipOf(bonds, id).props.title;
  eachCovenant((v) => {
    assert.match(label([VIC], 'victoriaShip'), /：在场 7\/3，已激活$/, v);
    assert.equal(textOf([...walk(chipOf([VIC], 'victoriaShip'))].find((n) => hasClass(n, 'dbond__count'))), '7/3', v);
    assert.equal(slotOf([VIC], 'victoriaShip').disc.title, '维多利亚 7/3', v);
    assert.match(label([SWIFT], 'swiftShip'), /：在场 2\/2，已激活$/, v);
    assert.match(label([{ ...SWIFT, count: 1, tier: 0, active: false }], 'swiftShip'), /，未激活$/, v);
  });
});

test('盟约 briefing: an enabled disc wears the first-threshold ring like an active one; 本局禁用 stays 1_0 [ASSUMED]', () => {
  const bonds = ['victoriaShip', 'swiftShip', 'maniShip', 'arcaneShip'].map((id) => data.lookup('bonds', id));
  const model = { banned: [], perBond: new Map(), stateOf: (id) => (id === 'arcaneShip' ? 'off' : null), regulation: false };
  const discs = [...walk(MatchBondRow({ title: '附加盟约', micro: 'ADD-ON BONDS', bonds, model }))].filter((v) => v.type === BondDisc);
  assert.deepEqual(discs.map((d) => [d.props.minCount, drawn(d.props).key]), [[3, '3_3'], [2, '2_2'], [1, '1_1'], [2, '1_0']]);
  assert.ok(discs.every((d) => d.props.tier === undefined), 'no tier before the match');
});

test('规程 is unchanged: 迅捷 85 still Ⅱ on the unbroken 1_1, 维多利亚 3/6 with 阶段 Ⅰ, the briefing\'s discs 1_1', () => withVersion('V3_1', () => {
  const swift = slotOf([SWIFT], 'swiftShip');
  assert.deepEqual([swift.stage, swift.key, swift.disc.phased], [2, '1_1', true]);
  const vic = slotOf([{ ...VIC, count: 3, tier: 1, layers: 8 }], 'victoriaShip');
  assert.deepEqual([vic.stage, vic.key], [1, '1_1']);
  // the popup keeps the next threshold (the top one when maxed) and the 阶段 tag
  assert.deepEqual(popupOf('victoriaShip', { ...VIC, count: 3, tier: 1, layers: 8 }), { population: '在场3/6', check: true, stages: ['阶段 Ⅰ'], inactive: false, layers: '层数8', ring: '1_1' });
  assert.deepEqual(popupOf('swiftShip', SWIFT), { population: '在场2/2', check: true, stages: ['阶段 Ⅱ'], inactive: false, layers: '层数85', ring: '1_1' });
  assert.deepEqual(popupOf('ursusShip', { bondId: 'ursusShip', count: 7, tier: 2, active: true, layers: 129, thresholds: [3, 6] }).population, '在场7/6');
  // the tooltip and the chip follow the popup (gameLogic bondCountCap)
  assert.equal(slotOf([{ ...VIC, count: 3, tier: 1, layers: 8 }], 'victoriaShip').disc.title, '维多利亚 3/6');
  const chip = [...walk(BondChips({ bondIds: ['victoriaShip'], bonds: [{ ...VIC, count: 3, tier: 1, layers: 8 }] }))].find((v) => v.props?.['data-bond'] === 'victoriaShip');
  assert.match(chip.props.title, /：在场 3\/6，已激活 1 阶$/);
  const bonds = ['victoriaShip', 'swiftShip', 'maniShip'].map((id) => data.lookup('bonds', id));
  const model = { banned: [], perBond: new Map(), stateOf: () => null, regulation: true };
  const discs = [...walk(MatchBondRow({ title: '附加盟约', micro: 'ADD-ON BONDS', bonds, model }))].filter((v) => v.type === BondDisc);
  assert.deepEqual(discs.map((d) => drawn(d.props).key), ['1_1', '1_1', '1_1']);
  // a plugin bond without a phase table in 规程: the member tier [ASSUMED, unchanged]
  assert.equal(bondFrame({ active: true, members: 7, minCount: 3, phased: true }).key, 'bondBoardIcon/1_1');
}));

test('BondDisc reads the version from the loaded config when no `phased` is passed; an explicit one wins', () => {
  const props = { name: '维多利亚', active: true, tier: 2, members: 7, minCount: 3 };
  assert.equal(drawn(props).key, '3_3');
  assert.equal(withVersion('V3_1', () => drawn(props).key), '1_1');
  assert.equal(drawn({ ...props, phased: true }).key, '1_1');
  assert.equal(withVersion('V3_1', () => drawn({ ...props, phased: false }).key), '3_3');
});
