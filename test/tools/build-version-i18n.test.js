import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildVersionOverlay, reuseMapFromBase, overlayMatchesCommitted } from '../../tools/build-version-i18n.mjs';
import { applyFileOverlay } from '../../shared/i18nData.js';

test('reuses shared EN when Chinese text matches', () => {
  const data = { chess: { chess_x: { name: '折桠', skill: { name: '技', descRaw: '攻击力提升' } } } };
  const { overlay } = buildVersionOverlay({
    data,
    reuseMap: { '折桠': 'Vulpisfoglia', '攻击力提升': 'ATK increased' },
    dict: {},
  });
  assert.equal(overlay.files.chess.chess_x.name, 'Vulpisfoglia');
  assert.equal(overlay.files.chess.chess_x.skill.descRaw, 'ATK increased');
  assert.equal(overlay.names['折桠'], 'Vulpisfoglia');
});

test('dict fills when reuse misses', () => {
  const data = { bonds: { b1: { name: '炎', desc: '中文效果' } } };
  const { overlay, report } = buildVersionOverlay({
    data,
    reuseMap: {},
    dict: { '炎': 'Yan', '中文效果': 'Yan operators gain ATK' },
  });
  assert.equal(overlay.files.bonds.b1.name, 'Yan');
  assert.equal(overlay.files.bonds.b1.desc, 'Yan operators gain ATK');
  assert.ok(report.totals.fromDict >= 2);
});

test('reuseMapFromBase pairs default data with shared overlay', () => {
  const baseData = { items: { it1: { name: '锤子', desc: '描述甲' } } };
  const baseEn = {
    names: { '锤子': 'Hammer' },
    files: {
      items: {
        it1: { name: 'Hammer', desc: 'Desc A', _h: 'xxxx' },
      },
    },
  };
  const map = reuseMapFromBase(baseEn, baseData);
  assert.equal(map['锤子'], 'Hammer');
  assert.equal(map['描述甲'], 'Desc A');
});

test('overlay applies cleanly to source records', () => {
  const data = { chess: { chess_x: { name: '甲', skill: { descRaw: '乙' } } } };
  const { overlay } = buildVersionOverlay({
    data,
    reuseMap: { '甲': 'A', '乙': 'B' },
    dict: {},
  });
  const r = applyFileOverlay(data.chess, overlay.files.chess);
  assert.equal(r.stale, 0);
  assert.equal(r.value.chess_x.name, 'A');
});

test('path leaves win over missing dict for the same record field', () => {
  const data = { chess: { chess_x: { name: '甲', skill: { descRaw: '中文技能描述带数字80%' } } } };
  const { overlay, report } = buildVersionOverlay({
    data,
    reuseMap: { '甲': 'A' },
    dict: {},
    pathLeaves: [{ file: 'chess', id: 'chess_x', path: ['skill', 'descRaw'], en: 'ATK +80%' }],
  });
  assert.equal(overlay.files.chess.chess_x.skill.descRaw, 'ATK +80%');
  assert.ok(report.totals.fromPaths >= 1);
});

test('official reuse wins over Terra path leaves for the same Chinese text', () => {
  const data = { bonds: { b1: { name: '炎', descRaw: '官方同文' } } };
  const { overlay, report } = buildVersionOverlay({
    data,
    reuseMap: { '炎': 'Yan', '官方同文': 'Official EN client wording' },
    dict: { '官方同文': 'Terra unofficial wording' },
    pathLeaves: [{ file: 'bonds', id: 'b1', path: ['descRaw'], en: 'Terra unofficial wording' }],
    meta: { communityTranslated: true, credit: 'English text: Terra Archive (terra-archive.net), unofficial (partly machine-translated) translation' },
  });
  assert.equal(overlay.files.bonds.b1.descRaw, 'Official EN client wording');
  assert.ok(report.totals.fromReuse >= 1);
  assert.equal(overlay.meta.communityTranslated, true);
  assert.match(overlay.meta.credit, /Terra Archive/);
});

test('overlayMatchesCommitted ignores meta.totals only', () => {
  const a = { version: 1, lang: 'en', meta: { credit: 'x', totals: { texts: 1 } }, names: {}, files: {} };
  assert.equal(overlayMatchesCommitted(a, { ...a, meta: { credit: 'x', totals: { texts: 2 } } }), true);
  assert.equal(overlayMatchesCommitted(a, { ...a, meta: { credit: 'y', totals: { texts: 1 } } }), false);
  assert.equal(overlayMatchesCommitted(a, null), false);
});
