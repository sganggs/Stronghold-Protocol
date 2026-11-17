import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getVersionData } from '../../server/data.js';
import { placementContext, dropIntent } from '../../public/js/ui/gameLogic/placement.js';
import { replaceRequest } from '../../public/js/ui/equipReplace.js';

const V3 = getVersionData('act3autochess@V3_1');
const normal = 'chess_char_5_22_a', elite = 'chess_char_5_22_b';
const phone = 'chess_item_2_06_e_a';
const getChess = id => V3.chess[id];
const getItem = id => V3.items[id];
const equipment = Object.values(V3.items).filter(i => i.itemType === 'EQUIP' && !i.isGolden && !i.canFuse && !i.canGiveBond
  && !String(i.kind).startsWith('consume_on_equip')).slice(0, 6).map(i => i.id);

function context(id, count, morphMode = 'official') {
  const target = { uid: 1, kind: 'chess', id, golden: !!getChess(id).isGolden, row: 9, col: 3,
    items: equipment.slice(0, count).map((id, i) => ({ kind: 'item', uid: 11 + i, id })) };
  return placementContext({
    priv: { alive: true, ready: false, board: [target], hand: [{ uid: 2, kind: 'item', id: phone }], temp: [] },
    stage: Object.values(V3.stages)[0], editable: true, getChess, getItem, morphMode, config: V3.config,
  });
}

for (const [id, cap] of [[normal, 4], [elite, 6]]) {
  for (const mode of ['official', 'plus']) test(`${id} ${mode}: replacement UI opens at ${cap}, never at two`, () => {
    const free = context(id, 2, mode);
    const intent = dropIntent(free, 2, { area: 'board', row: 9, col: 3 });
    assert.equal(intent.confirmReplace, false);
    assert.equal(replaceRequest(free, { ...intent, confirmReplace: true }, getChess, getItem), null);
    const full = context(id, cap, mode);
    const replace = dropIntent(full, 2, { area: 'board', row: 9, col: 3 });
    assert.equal(replace.confirmReplace, true);
    const request = replaceRequest(full, replace, getChess, getItem);
    assert.equal(request.capacity, cap);
    assert.equal(request.options.length, cap);
  });
}

// Load the real season records for both own and spectator detail sections; no browser or renderer is needed.
globalThis.fetch = async url => {
  const name = String(url).split('/').pop();
  const value = name === 'assets.json' ? {} : V3[name.replace(/\.json$/, '')];
  return { ok: !!value, status: value ? 200 : 404, json: async () => value || {} };
};
const { data } = await import('../../public/js/data.js');
await data.loadAll('chess', 'items', 'bonds', 'garrisons', 'assets', 'config');
const { ChessDetail } = await import('../../public/js/ui/detailPanel.js');

for (const [id, cap] of [[normal, 4], [elite, 6]]) test(`${id}: own and spectated equipment details show the actual capacity`, () => {
  const piece = context(id, 2).pieces.get(1).piece;
  const own = ChessDetail({ chess: getChess(id), piece });
  assert.equal(own.find(v => v?.key === 'equip').props.micro, `EQUIP 2/${cap}`);
  const viewed = ChessDetail({ chess: getChess(id), piece: null, unitItems: piece.items.map(i => i.id) });
  assert.equal(viewed.find(v => v?.key === 'equip').props.micro, `EQUIP 2/${cap}`);
});

test('all shipped translations keep dynamic equipment-capacity placeholders', () => {
  const keys = ['拖拽装备至该干员以配发（最多 {max} 件）', '「{name}」的装备栏已满（{count}/{max}）。选择一件装备进行替换，{warn}。'];
  for (const lang of ['en', 'ja', 'ko', 'zh-TW']) {
    const pack = JSON.parse(readFileSync(new URL(`../../public/i18n/${lang}.json`, import.meta.url)));
    for (const key of keys) for (const p of key.match(/\{\w+\}/g)) assert.ok(pack[key].includes(p), `${lang}: ${p}`);
  }
});
