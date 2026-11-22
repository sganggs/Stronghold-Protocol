// test/ui/shop-marks.test.js — the project's own marks on a canvas shop card (ui/shop/marks.js): the
// skill badge, 替补 / 自选, owned-copy pips and 可晋升. One pure model feeds the canvas's DOM overlay
// (host.syncCardMarks) and carries the accessible text, so the numbers and labels are checked here
// without a browser. The 卡面标记 switches (设置 → 外观) filter the model, not the shop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
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
const { DATA } = await import('../match/harness.js');
await data.loadAll('chess', 'bonds', 'assets', 'garrisons', 'items', 'backups');
const { cardMarkModel, filterCardMarks } = await import('../../public/js/ui/shop/marks.js');
const { mergeProgress } = await import('../../public/js/ui/gameLogic.js');
const { DEFAULT_SETTINGS, sanitizeSettings } = await import('../../public/js/ui/gameLogic/settings.js');
const { t } = await import('../../shared/i18n.js');

const ANY = Object.values(DATA.chess).find((c) => c && c.chessType === 'NORMAL' && !c.isGolden && !c.isDiy && c.visible !== false).chessId;
const SILVER = 'chess_char_4_22_a';     // 银灰 → the stand-in Sharp (test/ui/standin-ui.test.js)
const DIY5 = 'chess_char_5_diy1_a';     // a 5-tier 自选 slot
const SIEGE = 'char_112_siege';         // a legal 5-tier pick, its own skill 2 (test/ui/diy-ui.test.js)
const SIEGE_PICK = { charId: SIEGE, skillIndex: 2 };

const priv = (over = {}) => ({
  funds: 10,
  loadout: {},
  standIns: [],
  diy: {},
  ops: null,
  board: [],
  hand: [],
  temp: [],
  ...over,
});

const slot = (id = ANY, over = {}) => ({ kind: 'chess', id, price: 3, basePrice: 3, sold: false, ...over });

test('an owned operator marks the owned copies and its skill', () => {
  const p = priv({ board: [{ kind: 'chess', id: ANY, uid: 1 }] });
  const marks = cardMarkModel(p, slot());
  const progress = mergeProgress(p, ANY, (id) => data.lookup('chess', id));
  assert.equal(marks.pips.copies, 1);
  assert.equal(marks.pips.need, progress.need);
  assert.equal(marks.pips.aria, t('已拥有 {copies}/{need}', { copies: 1, need: progress.need }));
  assert.ok(marks.skill, 'every operator card carries its skill badge');
  assert.equal(typeof marks.skill.file, 'string');
  assert.match(marks.skill.slot, /^S[1-3]$/);
  assert.equal(marks.standIn, null);
  assert.equal(marks.diy, null);
  assert.equal(marks.merge, null, 'one copy does not complete a merge');
});

test('an unowned operator shows its stand-in mark, with the replaced operator in the accessible text', () => {
  const marks = cardMarkModel(priv({ standIns: [SILVER] }), slot(SILVER));
  assert.ok(marks.standIn);
  assert.equal(marks.standIn.label, t('替补'));
  assert.equal(marks.standIn.aria, t('{name}的替补', { name: data.lookup('chess', SILVER).name }));
  assert.ok(marks.standIn.title.includes('替补'), 'the tooltip names the stand-in');
  assert.equal(marks.diy, null);
});

test('a filled 自选 slot shows the 自选 mark and the picked operator in the text', () => {
  const marks = cardMarkModel(priv({ diy: { [DIY5]: SIEGE_PICK } }), slot(DIY5));
  assert.ok(marks.diy);
  assert.equal(marks.diy.label, t('自选'));
  assert.match(marks.diy.aria, /自选编队/);
  assert.equal(marks.standIn, null);
});

test('a merge-completing operator shows 可晋升 with the hint as its tooltip', () => {
  const need = mergeProgress(priv(), ANY, (id) => data.lookup('chess', id)).need;
  const board = Array.from({ length: need - 1 }, (_, i) => ({ kind: 'chess', id: ANY, uid: i + 1 }));
  const marks = cardMarkModel(priv({ board }), slot());
  assert.ok(marks.merge);
  assert.equal(marks.merge.label, t('可晋升'));
  assert.ok(marks.merge.title, 'the merge hint is the tooltip');
  assert.equal(marks.pips.copies, need - 1);
});

test('item, sold and empty slots carry no marks', () => {
  for (const s of [null, slot(ANY, { sold: true }), { kind: 'item', id: 'chess_item_1_01_e_a', price: 1, sold: false }]) {
    assert.deepEqual(cardMarkModel(priv(), s), { skill: null, pips: null, standIn: null, diy: null, merge: null });
  }
  assert.deepEqual(cardMarkModel(priv(), slot('chess_no_such_id')), { skill: null, pips: null, standIn: null, diy: null, merge: null });
});

test('the 卡面标记 switches drop marks one by one and an empty model becomes null', () => {
  const marks = cardMarkModel(
    priv({ board: [{ kind: 'chess', id: SILVER, uid: 1 }], standIns: [SILVER] }),
    slot(SILVER),
  );
  assert.ok(marks.skill && marks.pips && marks.standIn);
  const offSkill = filterCardMarks(marks, { skill: false });
  assert.equal(offSkill.skill, null);
  assert.ok(offSkill.pips, 'the other marks stay');
  const offAll = filterCardMarks(marks, { skill: false, standIn: false, progress: false });
  assert.equal(offAll, null, 'nothing left to draw');
  assert.ok(filterCardMarks(marks, {}) !== null, 'no switch map = everything on');
});

test('the owned pips and 可晋升 share the progress switch', () => {
  const need = mergeProgress(priv(), ANY, (id) => data.lookup('chess', id)).need;
  const board = Array.from({ length: need - 1 }, (_, i) => ({ kind: 'chess', id: ANY, uid: i + 1 }));
  const marks = cardMarkModel(priv({ board }), slot());
  assert.ok(marks.pips && marks.merge);
  const off = filterCardMarks(marks, { progress: false });
  assert.equal(off.pips, null);
  assert.equal(off.merge, null);
  assert.ok(off.skill, 'the skill mark is a different group');
});

test('the 卡面标记 switches default on and only an explicit false turns one off', () => {
  for (const key of ['shopMarkSkill', 'shopMarkStandIn', 'shopMarkProgress']) {
    assert.equal(DEFAULT_SETTINGS[key], true, key);
    assert.equal(sanitizeSettings({})[key], true, key);
    assert.equal(sanitizeSettings({ ...DEFAULT_SETTINGS, [key]: false })[key], false, key);
    for (const junk of ['false', 0, null, 1]) assert.equal(sanitizeSettings({ ...DEFAULT_SETTINGS, [key]: junk })[key], true, `${key} ${JSON.stringify(junk)}`);
  }
  assert.equal(Object.hasOwn(DEFAULT_SETTINGS, 'shopMarkPromotable'), false, '可晋升 shares the progress switch');
});
