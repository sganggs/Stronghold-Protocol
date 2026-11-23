// §37.341: the numeral over a 规程 bond disc (and the popup's 阶段 tag) is the official bond phase level — how many entries
// of the active effect's phase table (activity_table effectDescParamDataDict[effectId].bondPhaseCountList; effects.json /
// bonds.json `phaseType` + `phaseCounts`) the count reaches: layers for STACK_COUNT, members for PEOPLE_COUNT, nothing for
// NONE, nothing while inactive. Recordings: BV12ZWP6pE7m p1 340 s (乌萨斯 Ⅱ 129, 迅捷 Ⅱ 85, 奥术 Ⅰ 69, 绝技 Ⅰ), the flips at
// BV12ZWP6pE7m p1 233.5 s (迅捷 39 → 41) and BV1Cjs46CE4k 9 s (灵巧 37 → 41), 远见 lit with no numeral below 80. The 盟约
// periods draw no numeral at all (§37.342, test/ui/bond-covenant.test.js). Node tests of gameLogic bondStage, the strip
// and the popup on the real 规程 data (its config too: the version family is the signal, gameLogic bondPhased), the
// live-layer path (ui/watchBonds.js) and the detail card's chip label.
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

const { bondStage } = await import('../../public/js/ui/gameLogic.js');
const { BondStrip, BondPopup, bondDisplay } = await import('../../public/js/ui/bondStrip.js');
const { BondChips } = await import('../../public/js/ui/detailPanel.js');
const { stripView, screenStrip, popupView, playerBonds } = await import('../../public/js/ui/watchBonds.js');
const { data } = await import('../../public/js/data.js');
await data.loadAll('bonds', 'effects', 'chess', 'assets', 'config');

const V31 = 'data/versions/act3autochess-v3_1';
const V31_FILES = { bonds: readJson(`${V31}/bonds.json`), effects: readJson(`${V31}/effects.json`), config: readJson(`${V31}/config.json`) };
/** Run `fn` with the 规程·序列Ⅰ bonds, effects and config in the data store, then the default files again. */
function withRegulation(fn) {
  data.setContent({ id: 'bond-stage-test-v3_1', values: V31_FILES });
  try { return fn(); } finally { data.setContent(null); }
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
/** bondId → the stage the strip draws over it (the BondStage vnode's prop; 0 = nothing drawn) */
function stripStages(bonds) {
  const nodes = [...walk(BondStrip({ bonds, onOpen() {} }))];
  return Object.fromEntries(nodes.filter((v) => hasClass(v, 'bslot')).map((slot) => [slot.props['data-bond'],
    [...walk(slot)].find((v) => v.type?.name === 'BondStage')?.props.stage ?? null]));
}
/** The popup's 阶段 tags: [{ text, title, active }] */
function popupStages(bondId, entry) {
  const nodes = [...walk(BondPopup({ bondId, entry, priv: { board: [], hand: [], temp: [] }, onClose() {} }))];
  return nodes.filter((v) => hasClass(v, 'bpop__stage') && !hasClass(v, 'bpop__inactive'))
    .map((v) => ({ text: textOf(v), title: v.props.title ?? null, active: hasClass(v, 'is-active') }));
}

test('bondStage: STACK_COUNT counts the layers (temporary ones too), PEOPLE_COUNT the member tier, NONE and inactive bonds nothing', () => {
  const swift = { phaseType: 'STACK_COUNT', phaseCounts: [0, 40] };
  const on = (layers, extra = {}) => ({ active: true, tier: 1, count: 2, layers, ...extra });
  assert.deepEqual([0, 39, 40, 85].map((n) => bondStage(on(n), swift)), [1, 1, 2, 2]);
  assert.equal(bondStage(on(39, { tempLayers: 1 }), swift), 2, '39 permanent + 1 temporary reach 40 [ASSUMED]');
  assert.equal(bondStage({ active: false, tier: 0, count: 1, layers: 201 }, swift), 0, 'inactive: nothing, even past a milestone');
  const visi = { phaseType: 'STACK_COUNT', phaseCounts: [80, 150] };
  assert.deepEqual([30, 79, 80, 149, 150, 464].map((n) => bondStage(on(n), visi)), [0, 0, 1, 1, 2, 2]);
  assert.equal(bondStage(on(0), { phaseType: 'NONE', phaseCounts: [] }), 0);
  // PEOPLE_COUNT: the entry's tier (调和's +1 and the 绝技 count are the server's; 助力's name-or-elite upper tiers too
  // [ASSUMED]: no recording shows a 助力 disc), else the members against the table
  const core = { phaseType: 'PEOPLE_COUNT', phaseCounts: [3, 6] };
  assert.equal(bondStage({ active: true, tier: 2, count: 6, layers: 129 }, core), 2);
  assert.equal(bondStage({ active: true, tier: 1, count: 6, layers: 999 }, core), 1, 'the tier wins over the count and ignores layers');
  assert.equal(bondStage({ active: true, count: 9 }, { phaseType: 'PEOPLE_COUNT', phaseCounts: [3, 6, 9] }), 3);
  // no phase table in 规程 (a plugin bond): the member tier while active [ASSUMED]
  for (const phase of [null, undefined, {}, { phaseType: null, phaseCounts: null }]) {
    assert.equal(bondStage({ active: true, tier: 1, count: 2, layers: 85 }, phase), 1);
    assert.equal(bondStage({ active: true, tier: 1, count: 2, layers: 85 }, phase, true), 1);
    assert.equal(bondStage({ active: false, tier: 0, count: 1, layers: 85 }, phase), 0);
  }
  // a 盟约 period (phased false, §37.342): nothing, whatever the bond carries
  for (const phase of [null, {}, swift, visi, core, { phaseType: 'NONE', phaseCounts: [] }]) {
    assert.equal(bondStage({ active: true, tier: 2, count: 7, layers: 155 }, phase, false), 0);
  }
  assert.equal(bondStage(null, swift), 0);
});

test('规程 data: every bond carries its effect\'s official phase table; 远见 is STACK_COUNT [80,150]; the 炎 replacement goes to Ⅲ', () => {
  const { bonds, effects } = V31_FILES;
  for (const b of Object.values(bonds)) {
    assert.deepEqual([b.phaseType, b.phaseCounts], [effects[b.effectId].phaseType, effects[b.effectId].phaseCounts], b.bondId);
  }
  assert.deepEqual([bonds.visiShip.phaseType, bonds.visiShip.phaseCounts], ['STACK_COUNT', [80, 150]]);
  assert.deepEqual([bonds.swiftShip.phaseType, bonds.swiftShip.phaseCounts], ['STACK_COUNT', [0, 40]]);
  assert.deepEqual([bonds.maniShip.phaseType, bonds.maniShip.phaseCounts], ['NONE', []]);
  assert.deepEqual([bonds.suntShip.phaseType, bonds.suntShip.phaseCounts], ['PEOPLE_COUNT', [2, 5]]);
  assert.deepEqual([effects.bondeffect_yan.phaseType, effects.bondeffect_yan.phaseCounts], ['PEOPLE_COUNT', [3, 6, 9]]);
  // displayThresholds stays as it was: PEOPLE_COUNT effects with description params only
  assert.equal(effects.bondeffect_sunt.displayThresholds, undefined);
  assert.deepEqual(effects.bondeffect_yan.displayThresholds, [3, 6, 9]);
  // the 盟约 default data has no phase table
  assert.ok(Object.values(readJson('data/bonds.json')).every((b) => !('phaseType' in b) && !('phaseCounts' in b)));
  assert.ok(Object.values(readJson('data/effects.json')).every((e) => !('phaseType' in e)));
});

test('规程 strip: BV12ZWP6pE7m p1 340 s (乌萨斯 Ⅱ, 迅捷 Ⅱ at 85, 奥术 Ⅰ, 绝技 Ⅰ); 灵巧 40 Ⅱ; 远见 30, 调和, an inactive 迅捷 nothing', () => withRegulation(() => {
  const frame = [
    { bondId: 'ursusShip', count: 6, tier: 2, active: true, layers: 129, thresholds: [3, 6] },
    { bondId: 'swiftShip', count: 2, tier: 1, active: true, layers: 85, thresholds: [2] },
    { bondId: 'arcaneShip', count: 2, tier: 1, active: true, layers: 69, thresholds: [2, 3] },
    { bondId: 'suntShip', count: 2, tier: 1, active: true, layers: 0, thresholds: [2, 5] },
  ];
  assert.deepEqual(stripStages(frame), { ursusShip: 2, swiftShip: 2, arcaneShip: 1, suntShip: 1 });
  const more = [
    { bondId: 'skillfulShip', count: 2, tier: 1, active: true, layers: 40, thresholds: [2] },
    { bondId: 'visiShip', count: 2, tier: 1, active: true, layers: 30, thresholds: [2] },
    { bondId: 'maniShip', count: 1, tier: 1, active: true, layers: 0, thresholds: [1] },
    { bondId: 'swiftShip', count: 1, tier: 0, active: false, layers: 201, thresholds: [2] },
    { bondId: 'miraShip', count: 2, tier: 1, active: true, layers: 120, thresholds: [2] },
    { bondId: 'investShip', count: 3, tier: 1, active: true, layers: 0, thresholds: [3] },
  ];
  assert.deepEqual(stripStages(more), { skillfulShip: 2, visiShip: 0, maniShip: 0, swiftShip: 0, miraShip: 2, investShip: 1 });
  // the member tier still reaches the disc (and its full ring): only the numeral counts layers
  const slot = [...walk(BondStrip({ bonds: [frame[1]], onOpen() {} }))].find((v) => v.type?.name === 'BondDisc');
  assert.deepEqual([slot.props.tier, slot.props.active, slot.props.layers], [1, true, 85]);
  // a strategy's replacement brings its own table: 炎 with bondeffect_yan [3,6,9] and nine members → Ⅲ
  const yan = { bondId: 'yanShip', count: 9, tier: 2, active: true, layers: 12, thresholds: [3, 6], effectId: 'bondeffect_yan' };
  assert.deepEqual(stripStages([yan]), { yanShip: 3 });
  assert.equal(stripStages([{ ...yan, effectId: undefined }]).yanShip, 2, 'the own effect bondeffect_yan_2 is [3,6]');
}));

test('规程 popup: the 阶段 tag shows the strip\'s numeral; none for 远见 below 80 layers or 调和; 本局禁用 unchanged', () => withRegulation(() => {
  assert.deepEqual(popupStages('swiftShip', { count: 2, tier: 1, active: true, layers: 85 }), [{ text: '阶段 Ⅱ', title: '已激活 · 2 阶', active: true }]);
  assert.deepEqual(popupStages('skillfulShip', { count: 2, tier: 1, active: true, layers: 40 }), [{ text: '阶段 Ⅱ', title: '已激活 · 2 阶', active: true }]);
  assert.deepEqual(popupStages('ursusShip', { count: 6, tier: 2, active: true, layers: 129 }), [{ text: '阶段 Ⅱ', title: '已激活 · 2 阶', active: true }]);
  assert.deepEqual(popupStages('yanShip', { count: 9, tier: 2, active: true, layers: 0, effectId: 'bondeffect_yan' }), [{ text: '阶段 Ⅲ', title: '已激活 · 3 阶', active: true }]);
  for (const [bondId, entry] of [['visiShip', { count: 2, tier: 1, active: true, layers: 30 }], ['maniShip', { count: 1, tier: 1, active: true, layers: 0 }]]) {
    assert.deepEqual(popupStages(bondId, entry), [], bondId);
    // still active: the check mark, no 尚未激活
    const nodes = [...walk(BondPopup({ bondId, entry, priv: { board: [], hand: [], temp: [] }, onClose() {} }))];
    assert.ok(nodes.some((v) => hasClass(v, 'bpop__check')), bondId);
    assert.ok(!nodes.some((v) => hasClass(v, 'bpop__inactive')), bondId);
  }
  assert.deepEqual(popupStages('visiShip', { count: 2, tier: 1, active: true, layers: 150 }), [{ text: '阶段 Ⅱ', title: '已激活 · 2 阶', active: true }]);
  // inactive past a milestone: 尚未激活, no 阶段 tag
  const idle = [...walk(BondPopup({ bondId: 'swiftShip', entry: { count: 1, tier: 0, active: false, layers: 201 }, priv: { board: [], hand: [] }, onClose() {} }))];
  assert.equal(textOf(idle.find((v) => hasClass(v, 'bpop__inactive'))), '尚未激活');
  assert.deepEqual(popupStages('swiftShip', { count: 1, tier: 0, active: false, layers: 201 }), []);
  const off = [...walk(BondPopup({ bondId: 'miraShip', off: true, entry: { count: 2, tier: 0, active: false, layers: 120 }, priv: { board: [], hand: [] }, onClose() {} }))];
  assert.equal(textOf(off.find((v) => hasClass(v, 'bpop__stage'))), '本局禁用');
}));

test('规程 live layers: the numeral flips mid-battle as the runner\'s layers cross 40 (BV12ZWP6pE7m p1 233.5 s, BV1Cjs46CE4k 9 s)', () => withRegulation(() => {
  const myId = 'p_0';
  const pub = { players: [{ playerId: myId, name: 'me', bonds: [] }] };
  const priv = { bonds: [
    { bondId: 'swiftShip', count: 2, tier: 1, active: true, layers: 39, thresholds: [2] },
    { bondId: 'skillfulShip', count: 2, tier: 1, active: true, layers: 37, thresholds: [2] },
  ] };
  // prep / before the gain: the view's start-of-round layers
  assert.deepEqual(stripStages(stripView({ pub, priv, myId }).bonds), { swiftShip: 1, skillfulShip: 1 });
  // the battle on screen: the runner's bondLayers laid over (withLiveLayers)
  const live = stripView({ pub, priv, myId, live: { [myId]: { swiftShip: 41, skillfulShip: 41 } } });
  assert.deepEqual(stripStages(live.bonds), { swiftShip: 2, skillfulShip: 2 });
  // the game screen's path (screenStrip, combat) and the popup it opens read the same live entry
  const screen = screenStrip({ pub, priv, myId, combat: true, bondLayers: { [myId]: { swiftShip: 41 } } });
  assert.deepEqual(stripStages(screen.bonds), { swiftShip: 2, skillfulShip: 1 });
  const pop = popupView({ open: { id: 'swiftShip', ownerId: myId }, pub, priv, myId, live: { [myId]: { swiftShip: 41 } } });
  assert.equal(bondDisplay(pop.bondId, pop.entry).stage, 2);
  // temporary (yellow) layers count too [ASSUMED]: 39 + 1
  const temp = stripView({ pub, priv, myId, live: { [myId]: { swiftShip: 39 } }, temporary: { [myId]: { swiftShip: 1 } } });
  assert.equal(stripStages(temp.bonds).swiftShip, 2);
}));

test('the detail card\'s chip names the strip\'s stage in 规程; in 盟约 it says just 已激活 (§37.342)', () => {
  const label = (bonds, id) => [...walk(BondChips({ bondIds: [id], bonds }))].find((v) => v.props?.['data-bond'] === id).props.title;
  withRegulation(() => {
    assert.match(label([{ bondId: 'swiftShip', count: 2, tier: 1, active: true, layers: 85, thresholds: [2] }], 'swiftShip'), /：在场 2\/2，已激活 2 阶$/);
    assert.match(label([{ bondId: 'maniShip', count: 1, tier: 1, active: true, layers: 0, thresholds: [1] }], 'maniShip'), /：在场 1\/1，已激活$/);
    assert.match(label([{ bondId: 'visiShip', count: 2, tier: 1, active: true, layers: 30, thresholds: [2] }], 'visiShip'), /，已激活$/);
    assert.match(label([{ bondId: 'swiftShip', count: 1, tier: 0, active: false, layers: 201, thresholds: [2] }], 'swiftShip'), /，未激活$/);
  });
  assert.match(label([{ bondId: 'swiftShip', count: 2, tier: 1, active: true, layers: 85, thresholds: [2] }], 'swiftShip'), /：在场 2\/2，已激活$/);
});

test('a teammate\'s unit on a shared field: the chip and the popup it opens name the same stage (temporary layers on both)', () => withRegulation(() => {
  const label = (bonds, id) => [...walk(BondChips({ bondIds: [id], bonds }))].find((v) => v.props?.['data-bond'] === id).props.title;
  // 联防 field: I fight there and the strip follows me; teammate b has 远见 75 permanent + 10 temporary layers
  const pub = { players: [{ playerId: 'a', name: 'A', bonds: [] }, { playerId: 'b', name: 'B', bonds: [{ bondId: 'visiShip', count: 2, active: true, tier: 1, layers: 75 }] }] };
  const live = { b: { visiShip: 75 } };
  const temporary = { b: { visiShip: 10 } };
  // screens/game.js detailBonds: playerBonds with the live and the temporary layers, as popupView reads them
  const pop = popupView({ open: { id: 'visiShip', ownerId: 'b' }, pub, myId: 'a', live, temporary });
  assert.equal(bondDisplay(pop.bondId, pop.entry).stage, 1, '75 + 10 reach 80 [ASSUMED: temporary layers count]');
  assert.match(label(playerBonds({ pub, myId: 'a', ownerId: 'b', live, temporary }), 'visiShip'), /：在场 2\/2，已激活 1 阶$/);
  // without the temporary layers the chip would name no stage while the popup shows 阶段 Ⅰ
  assert.match(label(playerBonds({ pub, myId: 'a', ownerId: 'b', live }), 'visiShip'), /，已激活$/);
}));

test('盟约 (default data, no phase table): no numeral and no 阶段 tag at any tier (§37.342)', () => {
  const entry = { bondId: 'swiftShip', count: 2, tier: 1, active: true, layers: 85, thresholds: [2] };
  assert.equal(data.lookup('bonds', 'swiftShip').phaseType, undefined);
  assert.deepEqual(stripStages([entry]), { swiftShip: 0 });
  assert.deepEqual(popupStages('swiftShip', entry), []);
  assert.deepEqual(stripStages([{ bondId: 'kazimierzShip', count: 6, tier: 2, active: true, layers: 3, thresholds: [3, 6, 9] }]), { kazimierzShip: 0 });
});
