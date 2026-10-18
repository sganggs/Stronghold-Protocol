// GitHub #700: the attack-range preview used to match Simplified Chinese on skill.desc / trait.moduleDesc.
// The client looks up the localized record, so en / ja / ko / zh-TW no longer contain those lines
// (莱恩哈特「攻击范围扩大」10 → 9, 引星棘刺 S3「被动效果：攻击范围扩大」19 → 13, 空弦 ISW-A「集成战略」
// extend 0 → 1). build-data stores the reading (passiveRange / rangeExpand / modeOnly). The Chinese
// line remains only when the flag is absent. The battle sim still reads the Chinese record.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyFileOverlay } from '../../shared/i18nData.js';
import { attackRangeGrid, loadoutRecord, resolveRecordLoadout, traitRangeExtend } from '../../shared/loadoutRecord.js';

const LANGS = ['zh', 'en', 'ja', 'ko', 'zh-TW'];
const read = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const CHESS = read('../../data/chess.json');
const PACKS = Object.fromEntries(['en', 'ja', 'ko', 'zh-TW'].map((lang) => [lang, read(`../../data/i18n/${lang}.json`)]));

function chessOf(lang) {
  if (lang === 'zh') return CHESS;
  return applyFileOverlay(CHESS, PACKS[lang].files.chess).value;
}

const cells = (g) => (g || []).map(([r, c]) => `${r},${c}`).join(' ');

function preview(lang, id, lo) {
  const c = chessOf(lang)[id];
  const rec = loadoutRecord(c, resolveRecordLoadout(c, lo));
  return { rec, grid: attackRangeGrid(rec), ext: traitRangeExtend(rec) };
}

test('preview range fallback: the flag, else the Simplified line, and a translation alone does not', () => {
  const base = [[0, 0], [0, 1]];
  const wide = [[0, 0], [0, 1], [0, 2]];
  const skill = (extra) => ({ rangeGrid: base, skill: { rangeGrid: wide, desc: 'Attack Range increases', ...extra }, isGolden: false });
  assert.equal(cells(attackRangeGrid(skill({}))), cells(base), 'a translation without the flag keeps the base grid');
  assert.equal(cells(attackRangeGrid(skill({ passiveRange: true }))), cells(wide));
  assert.equal(cells(attackRangeGrid(skill({ desc: '被动效果：攻击范围扩大' }))), cells(wide), 'no flag, Chinese line');
  assert.equal(cells(attackRangeGrid(skill({ passiveRange: false, desc: '被动效果：攻击范围扩大' }))), cells(wide), 'false still falls through');

  const mod = (trait) => ({
    isGolden: true,
    rangeGrid: base,
    module: { id: 'mod', active: true },
    modules: [{ uniEquipId: 'mod', talentChanges: [{ talentIndex: -1, rangeGrid: wide }] }],
    trait,
  });
  assert.equal(cells(attackRangeGrid(mod({ moduleDesc: 'Attack Range expands' }))), cells(base));
  assert.equal(cells(attackRangeGrid(mod({ rangeExpand: true, moduleDesc: 'Attack Range expands' }))), cells(wide));
  assert.equal(cells(attackRangeGrid(mod({ moduleDesc: '攻击范围扩大' }))), cells(wide));
  assert.equal(cells(attackRangeGrid(mod({ rangeExpand: false, moduleDesc: '攻击范围扩大' }))), cells(wide));

  const ext = (trait) => ({ trait: { bb: { ability_range_forward_extend: 1 }, ...trait }, rangeGrid: base });
  assert.equal(traitRangeExtend(ext({ moduleDesc: 'In Integrated Strategies' })), 1, 'a translation without the flag still extends');
  assert.equal(traitRangeExtend(ext({ modeOnly: true, moduleDesc: 'In Integrated Strategies' })), 0);
  assert.equal(traitRangeExtend(ext({ moduleDesc: '在集成战略中，攻击距离+1' })), 0);
  assert.equal(traitRangeExtend(ext({ modeOnly: false, moduleDesc: '在集成战略中' })), 0, 'false still falls through');
  assert.equal(cells(attackRangeGrid(ext({ modeOnly: true, moduleDesc: 'Attack Range +1' }))), cells(base));
});

test('preview range: every shipped overlay matches the Chinese grid', () => {
  const cases = [
    { id: 'chess_char_4_14_b', lo: {}, name: '莱恩哈特 default module', cells: 10, phrase: /攻击范围扩大/, text: (r) => r.trait?.moduleDesc, flag: (r) => r.trait?.rangeExpand },
    { id: 'chess_char_4_14_b', lo: { moduleId: 'none' }, name: '莱恩哈特 no module', cells: 9 },
    { id: 'chess_char_5_15_a', lo: { skillIndex: 2 }, name: '引星棘刺 S3', cells: 19, phrase: /被动效果：攻击范围扩大/, text: (r) => r.skill?.desc, flag: (r) => r.skill?.passiveRange },
    { id: 'chess_char_5_15_a', lo: { skillIndex: 0 }, name: '引星棘刺 S1', cells: 13 },
    { id: 'chess_char_3_21_b', lo: { moduleId: 'uniequip_004_archet' }, name: '空弦 ISW-A', cells: 12, ext: 0, phrase: /集成战略/, text: (r) => r.trait?.moduleDesc, flag: (r) => r.trait?.modeOnly },
    { id: 'chess_char_4_01_b', lo: { skillIndex: 0, moduleId: 'uniequip_003_rmixer' }, name: '信仰搅拌机 SPT-Y', cells: 4, ext: 1 },
    { id: 'chess_char_4_01_b', lo: { skillIndex: 0, moduleId: 'uniequip_002_rmixer' }, name: '信仰搅拌机 other', cells: 3, ext: 0 },
  ];
  const zh = Object.fromEntries(cases.map((c) => [c.name, preview('zh', c.id, c.lo)]));
  for (const c of cases) {
    assert.equal((zh[c.name].grid || []).length, c.cells, `zh ${c.name}`);
    if (c.ext != null) assert.equal(zh[c.name].ext, c.ext, `zh ${c.name} extend`);
    if (c.flag) assert.equal(c.flag(zh[c.name].rec), true, `zh ${c.name} flag`);
  }
  for (const lang of LANGS) {
    for (const c of cases) {
      const got = preview(lang, c.id, c.lo);
      assert.equal(cells(got.grid), cells(zh[c.name].grid), `${lang} ${c.name}`);
      assert.equal(got.ext, zh[c.name].ext, `${lang} ${c.name} extend`);
      if (lang !== 'zh' && c.phrase) {
        assert.equal(c.phrase.test(String(c.text(got.rec) ?? '')), false, `${lang} ${c.name}: overlay dropped the Simplified line`);
        assert.equal(c.flag(got.rec), true, `${lang} ${c.name}: flag survives the overlay`);
      }
    }
  }
});
