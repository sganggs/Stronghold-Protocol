// 点击 / 观战队友单位时详情卡显示装备(游玩记录 #2:「观战队友时看不到干员的装备」)。DESIGN §16
// 承诺 "a teammate's unit shows its owner's loadout in the detail card":服务器把 an ally operator 的
// 装备 id 放进战斗快照与侦察 meta 的 UnitInfo.items(server/sim/snapshot.js、Match.prepFieldMeta),
// detailPanel 的 unit 分支也从 `u.items` 取 `unitItems` —— 但 renderInfo(public/js/render/app.js)
// 构建 info 白名单时把 items 丢了,队友单位点开的卡永远没有 装备 区,变形同构体的「同构」pairing
// chips 对队友单位同样失效。renderInfo 在 app.js 里(模块顶层有 canvas 副作用,node 无法 import),
// 按docs-consistency / feedback1d 的惯例对源码断言;消费端行为已由 morph-bonds.test.js 锁住,
// 这里再走一遍 unit → resolveDetail → ChessDetail 的完整用户可见结果。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const load = (f) => JSON.parse(readFileSync(path.join(ROOT, 'data', f), 'utf8'));
const chess = load('chess.json');
const WEARER = 'chess_char_1_01_a'; // 隐现
const ISO = 'chess_item_6_09_e_a'; // 变形同构体
const HAMMER = 'chess_item_1_01_e_a'; // 维式重锤 → 维多利亚

// ---- renderInfo: the snapshot UnitInfo reaches the client info object ---------------------------------------------

test('renderInfo passes UnitInfo.items through (the teammate-unit equipment into the detail card)', () => {
  const app = readFileSync(path.join(ROOT, 'public/js/render/app.js'), 'utf8');
  const start = app.indexOf('export function renderInfo(');
  assert.ok(start > 0, 'renderInfo exists');
  const body = app.slice(start, app.indexOf('\n}', start));
  assert.match(
    body,
    /items: Array\.isArray\(u\.items\) \? u\.items\.filter\(\(x\) => typeof x === 'string'\) : undefined/,
    'the equipped item ids must survive the info whitelist (DESIGN §16: a teammate\'s unit shows its owner\'s loadout)',
  );
});

// ---- the user-visible end of the chain: a teammate unit's card with its equipment ----------------------------------

globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};
const { data } = await import('../../public/js/data.js');
await data.loadAll('bonds', 'chess', 'items', 'assets', 'garrisons');
const { ChessDetail, resolveDetail } = await import('../../public/js/ui/detailPanel.js');
const { BondChips } = await import('../../public/js/ui/detailPanel.js');

/** Every vnode of a preact tree (htm output), depth first. */
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);

test('a teammate unit carrying items opens with a read-only 装备 section and the worn 同构 pairing', () => {
  // the info object exactly as the battle view holds it after renderInfo (unit: info in pieceClick)
  const unit = { id: 7, uid: null, kind: 'op', side: 'ally', ownerId: 'p2', defId: WEARER, items: [ISO, HAMMER] };
  const d = resolveDetail({ kind: 'unit', unit }, new Map());
  assert.equal(d.type, 'chess');
  assert.deepEqual(d.unitItems, [ISO, HAMMER], 'no own piece for a teammate: the unit\'s items become unitItems');

  const mine = [{ bondId: 'victoriaShip', count: 3, active: true, tier: 1, layers: 0, thresholds: [3, 6] }];
  const blocks = ChessDetail({ chess: d.chess, piece: null, editable: false, bonds: mine, loadout: null, unitItems: d.unitItems });
  const equip = blocks.find((b) => b?.key === 'equip');
  assert.ok(equip, 'the 装备 section renders without an own piece');
  assert.deepEqual([...walk(equip)].filter((x) => x.props?.itemId).map((x) => x.props.itemId), [ISO, HAMMER]);
  const chips = [...walk(blocks)].find((x) => x.type === BondChips);
  assert.ok(chips, 'the card has bond chips');
  const vic = [...walk(BondChips(chips.props))].find((x) => hasClass(x, 'dbond') && x.props['data-bond'] === 'victoriaShip');
  assert.ok(vic && hasClass(vic, 'is-granted'), '变形同构体 marks the wearer as a 维多利亚 member on a teammate\'s card too');
});

test('a unit without items (enemies, summons, plain allies) still opens without a 装备 section', () => {
  const d = resolveDetail({ kind: 'unit', unit: { id: 8, kind: 'op', side: 'ally', ownerId: 'p2', defId: WEARER } }, new Map());
  assert.equal(d.unitItems, null, 'renderInfo leaves items undefined; resolveDetail hands null on');
  const mine = [{ bondId: 'victoriaShip', count: 3, active: true, tier: 1, layers: 0, thresholds: [3, 6] }];
  const blocks = ChessDetail({ chess: d.chess, piece: null, editable: false, bonds: mine, loadout: null, unitItems: d.unitItems });
  assert.equal(blocks.find((b) => b?.key === 'equip'), undefined, 'no empty 装备 section');
});
