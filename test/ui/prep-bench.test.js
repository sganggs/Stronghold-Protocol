// 观战整备区的客户端(游玩记录 #2 item 1):被侦察玩家的手牌是 m.field(prep:true).units 里手牌行
// (row 7)上的单位——干员站立、道具 kind 'item'(浮牌),和自己整备区同一渲染路径;观战棋盘用
// prep 相机(收起商店形态,bench 行进画面)。battleView 为 kind 'item' 建 ItemView(图标/颜色客户端
// 解析,同 pieceInfo),prep 面上给带装备的队友干员挂 item pips。服务器侧:test/match/prep-bench.test.js。
import { test, describe } from 'node:test';
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
const { data } = await import('../../public/js/data.js');
await data.loadAll('bonds', 'chess', 'items', 'assets');
const { resolveDetail } = await import('../../public/js/ui/detailPanel.js');

describe('the scouted prep board renders the hand like the own bench', () => {
  test('the game screen frames it with the prep camera in its shop-folded form (source)', () => {
    const game = read('public/js/screens/game.js');
    assert.match(game, /field\.prep \? 'prep' : \(field\.kind === 'hidden' \? 'boss' : field\.kind \|\| 'normal'\)/);
    assert.match(game, /field\.prep \? \{ shop: false \} : \{\}/);
    assert.match(game, /const scoutPid = watchingOther && field\?\.prep/);
    assert.ok(!game.includes('ScoutedBench'), 'the floating strip is gone — the hand rides the board');
    assert.ok(!read('public/css/screens/game.css').includes('.sbench'), 'its styles too');
  });

  test('battleView builds an ItemView for a hand item and item pips for a teammate operator (source)', () => {
    const app = read('public/js/render/app.js');
    assert.match(app, /info\.kind === 'item' \? new ItemView\(ctx, scoutItemInfo\(info\)\)/);
    assert.match(app, /battleMeta\?\.prep && Array\.isArray\(info\.items\) && info\.items\.length/);
    assert.match(app, /function scoutItemInfo\(info\)/);
  });

  test('tapping a held item on the scouted board opens its card (resolveDetail unit → item)', () => {
    const IT = 'chess_item_1_01_e_a';
    const d = resolveDetail({ kind: 'unit', unit: { id: 3, kind: 'item', side: 'ally', ownerId: 'p2', defId: IT } }, new Map());
    assert.equal(d.type, 'item');
    assert.equal(d.item.itemId || d.item.id, IT);
    assert.equal(resolveDetail({ kind: 'unit', unit: { id: 4, kind: 'item', side: 'ally', ownerId: 'p2', defId: 'nope' } }, new Map()), null);
  });
});
