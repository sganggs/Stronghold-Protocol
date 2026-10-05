// The 4 bonds whose effect never scales with layers (data/bonds.json `noStack`: 调和 / 协防干员 / 独行 / 绝技) must not
// show a stack count anywhere: the official hides those (PRTS 卫戍协议：盟约 下半/PRTS盟约记录 — "下述盟约中部分盟约不会
// 显示叠加层数，但是叠加层数的特质/策略/装备等效果仍然对其生效"). This project goes further and lets them take no layer
// gains at all — owner's decision, a deliberate deviation (DESIGN §24.3) — so there is never a count to show; the display
// rule itself is §24.2. Real data/records, no DOM (vnode walk: test/ui/match-info.test.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { bondStackBadge, BondDisc } = await import('../../public/js/ui/components.js');
const { BondStrip, BondPopup } = await import('../../public/js/ui/bondStrip.js');
const { data } = await import('../../public/js/data.js');

await data.loadAll('bonds', 'assets', 'chess', 'items');

/** bondId → the name the popup/strip shows. */
const NO_STACK = { maniShip: '调和', emptyShip: '协防干员', soloShip: '独行', suntShip: '绝技' };

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && !v.props?.children) return;
  yield* walk(v.props?.children);
}
const textOf = (v) => [...walk(v)].flatMap((n) => (Array.isArray(n.props?.children) ? n.props.children : [n.props?.children]))
  .filter((x) => typeof x === 'string' || typeof x === 'number').join('');

test('exactly these 4 bonds are noStack, and none of them has a layer-scaled field or a layer milestone', () => {
  const flagged = data.list('bonds').filter((b) => b.noStack).map((b) => b.bondId).sort();
  assert.deepEqual(flagged, Object.keys(NO_STACK).sort(), 'bonds.json noStack');
  for (const [id, name] of Object.entries(NO_STACK)) {
    const b = data.lookup('bonds', id);
    assert.equal(b.name, name);
    assert.deepEqual([b.baseParams, b.perStackParams, b.layerMilestones], [[], [], []], `${name}: nothing reads its layers`);
    assert.doesNotMatch(b.effectDesc || '', /层数/, `${name}: the effect text has no layer term (why the official hides it)`);
    assert.equal(b.noStack, true);
  }
  // the other 19 keep their layers on screen — including 远见 / 奇迹 / 投资人, whose milestones ARE layer-based
  assert.equal(data.list('bonds').filter((b) => !b.noStack).length, 19);
  assert.ok(data.lookup('bonds', 'visiShip').layerMilestones.length > 0, '远见: layers pay funds');
});

test('bondStackBadge: a noStack bond gets no badge, a normal one keeps its layers (or its member count)', () => {
  assert.equal(bondStackBadge(37, 2, true), null, 'noStack: hidden whatever the layers');
  assert.equal(bondStackBadge(0, 2, true), null);
  assert.equal(bondStackBadge(37, 2, false), 37, 'layers win over the count');
  assert.equal(bondStackBadge(undefined, 3, false), 3, 'no layers yet: the member count');
  assert.equal(bondStackBadge(undefined, undefined, false), undefined);
});

test('the strip hands BondDisc noStack for those bonds (and still hands it their layers); 炎 is untouched', () => {
  const bonds = [
    { bondId: 'maniShip', count: 1, tier: 1, active: true, layers: 12 },
    { bondId: 'yanShip', count: 3, tier: 1, active: true, layers: 7 },
  ];
  const discs = [...walk(BondStrip({ bonds, onOpen: () => {} }))].filter((v) => v.type === BondDisc);
  const byName = new Map(discs.map((d) => [d.props.name, d.props]));
  assert.deepEqual([byName.get('调和').noStack, byName.get('调和').layers], [true, 12], '调和: flagged, layers still passed');
  assert.deepEqual([byName.get('炎').noStack, byName.get('炎').layers], [false, 7]);
  assert.equal(bondStackBadge(byName.get('调和').layers, byName.get('调和').count, byName.get('调和').noStack), null);
  assert.equal(bondStackBadge(byName.get('炎').layers, byName.get('炎').count, byName.get('炎').noStack), 7);
});

test('the popup drops the 层数 row and the （n 层） heading for those bonds; 炎 keeps both', () => {
  const priv = { board: [], hand: [], temp: [] };
  const text = (bondId, layers) => textOf(BondPopup({
    bondId, entry: { count: 3, layers, tier: 1, active: true, thresholds: [] }, priv, onClose: () => {},
  }));
  const mani = text('maniShip', 12);
  assert.doesNotMatch(mani, /层数/, '调和: no 层数 row');
  assert.doesNotMatch(mani, /（12 层）/, '调和: no layer in the 当前效果 heading');
  assert.match(mani, /当前效果/, '调和: the effect itself stays');
  const yan = text('yanShip', 7);
  assert.match(yan, /层数/, '炎: the 层数 row stays');
  assert.match(yan, /（7 层）/, '炎: the heading keeps its layer count');
});
