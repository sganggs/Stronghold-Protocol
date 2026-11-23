// test/ui/shop-marks.test.js — the project's own marks on a canvas shop card (ui/shop/marks.js): the
// skill badge, 替补 / 自选, owned-copy pips and 可晋升. One pure model feeds the canvas's DOM overlay
// (host.syncCardMarks) and carries the accessible text, so the numbers and labels are checked here
// without a browser. The 卡面标记 switches (设置 → 外观) filter the model, not the shop.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { stubFetch } from '../helpers/fetchStub.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
// data.loadAll fetches /data/<name>.json: serve it from disk (the shared stub the other data tests use).
stubFetch((url) => {
  const name = String(url).split('/').pop();
  try {
    return JSON.parse(readFileSync(path.join(ROOT, 'data', name), 'utf8'));
  } catch {
    return null;
  }
});

const { data } = await import('../../public/js/data.js');
const { DATA } = await import('../match/harness.js');
await data.loadAll('chess', 'bonds', 'assets', 'garrisons', 'items', 'backups');
const { cardMarkModel, filterCardMarks, cardMarkElements } = await import('../../public/js/ui/shop/marks.js');
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

test('风丸 (upgradeNum 2) shows 可晋升 at one owned copy: the hint reads the same resolver as the pips', () => {
  // The merge need lives on the chess record (upgradeNum). mergeHint without the resolver falls back to three
  // copies, so a two-copy operator showed the pips at 1/2 with no 可晋升 mark at the one copy that completes it.
  const KAZE = 'chess_char_2_11_a';
  assert.equal(data.lookup('chess', KAZE).upgradeNum, 2, 'the data still needs two copies');
  const p = priv({ board: [{ kind: 'chess', id: KAZE, uid: 1 }] });
  const marks = cardMarkModel(p, slot(KAZE));
  assert.equal(marks.pips.copies, 1);
  assert.equal(marks.pips.need, 2);
  assert.ok(marks.merge, 'one more copy completes the merge');
  assert.equal(marks.merge.label, t('可晋升'));
  assert.ok(marks.merge.title, 'the merge hint is the tooltip');
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

test('the overlay elements keep the draw order, classes, tooltips and the pip/icon facts', () => {
  // host.js syncCardMarks builds the DOM from these descriptors, so this is the overlay's paint contract.
  const marks = {
    standIn: { label: '替补', title: '银灰的替补', aria: '…' },
    diy: null,
    merge: { label: '可晋升', title: '精锐干员将出现在…', aria: '…' },
    pips: { need: 3, copies: 1, title: '已拥有 1/3', aria: '…' },
    skill: { slot: 'S2', custom: true, file: null, title: '技能：X', aria: '…' },
  };
  const els = cardMarkElements(marks);
  assert.deepEqual(els.map((el) => el.cls),
    ['shop-mark--standin', 'shop-mark--merge', 'shop-mark--pips', 'shop-mark--skill'],
    'stand-in, DIY, 可晋升, pips, skill — the overlay order');
  assert.equal(els[0].text, '替补');
  assert.equal(els[0].title, '银灰的替补');
  assert.equal(els[1].text, '可晋升');
  assert.deepEqual(els[2].pips, [true, false, false], 'owned copies are the filled pips');
  assert.equal(els[2].text, '', 'the pips span carries no text');
  assert.equal(els[3].glyph, 'S2', 'a sprite-less skill draws its S-number');
  assert.equal(els[3].image, null);
  assert.equal(els[3].custom, true, 'a non-default skill keeps the is-custom class');
  const fileSkill = cardMarkElements({ skill: { file: '/assets/skill.png', slot: 'S2' } })[0];
  assert.equal(fileSkill.image, '/assets/skill.png');
  assert.equal(fileSkill.glyph, null, 'a sprite wins over the S-number');
  assert.equal(cardMarkElements({ pips: { need: 0, copies: 0 } })[0].pips.length, 0);
  assert.deepEqual(cardMarkElements(null), []);
  assert.deepEqual(cardMarkElements({ skill: null, pips: null, standIn: null, diy: null, merge: null }), [],
    'an all-off model draws nothing');
});
