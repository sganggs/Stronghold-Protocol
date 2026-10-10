// Localized game data: the overlay format (shared/i18nData.js), its build (tools/build-i18n.mjs → data/i18n/en.json:
// shape, freshness against data/*.json, coverage, rich text) and the client accessors (public/js/data.js setLocale).
// docs/I18N.md.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRecordOverlay, applyRecordOverlay, applyFileOverlay, walkOverlay, getPath, textHash2 } from '../shared/i18nData.js';
import { buildOverlay, inverseFormat, shapeKey, DATA_FILES, stripRich, untranslatedTest, nativeCharset } from '../tools/build-i18n.mjs';
import { createDataStore } from '../public/js/data.js';
import { parseRichText, richTextPlain } from '../public/js/ui/richText.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (rel) => JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8'));
const OVERLAY = readJson('data/i18n/en.json');
const HAN = /[一-鿿]/;

test('overlay records: build → apply round trip, copy-on-write, array and string records', () => {
  const base = { name: '炎', n: 3, skills: [{ name: '甲', desc: '一' }, { name: '乙', desc: '二' }], keep: { x: '中' } };
  const ov = buildRecordOverlay([
    { path: ['name'], zh: '炎', en: 'Yan' },
    { path: ['skills', 1, 'desc'], zh: '二', en: 'two' },
  ]);
  assert.deepEqual(ov.skills, [null, { desc: 'two' }], 'arrays are index-aligned, null keeps the entry');
  assert.equal(ov._h, textHash2('炎') + textHash2('二'));
  const r = applyRecordOverlay(base, ov);
  assert.equal(r.applied, 2);
  assert.equal(r.value.name, 'Yan');
  assert.equal(r.value.skills[1].desc, 'two');
  assert.equal(r.value.skills[0], base.skills[0], 'untouched branches are shared');
  assert.equal(r.value.keep, base.keep);
  assert.equal(base.name, '炎', 'the input is never modified');
  // an array record (config tips) and a plain-string record (config seasonName)
  const tips = [{ tip: '甲' }, { tip: '乙' }];
  const tov = buildRecordOverlay([{ path: [1, 'tip'], zh: '乙', en: 'B' }]);
  assert.deepEqual(applyRecordOverlay(tips, tov).value, [{ tip: '甲' }, { tip: 'B' }]);
  const sov = buildRecordOverlay([{ path: [], zh: '卫戍协议：盟约', en: 'Stronghold Protocol: Alliance' }]);
  assert.equal(applyRecordOverlay('卫戍协议：盟约', sov).value, 'Stronghold Protocol: Alliance');
});

test('overlay records: a leaf whose Chinese source changed stays Chinese (no stale translation)', () => {
  const ov = buildRecordOverlay([{ path: ['desc'], zh: '攻击力+15%', en: 'ATK +15%' }, { path: ['name'], zh: '维式重锤', en: 'Victorian Hammer' }]);
  const r = applyRecordOverlay({ name: '维式重锤', desc: '攻击力+20%' }, ov);
  assert.deepEqual(r.value, { name: 'Victorian Hammer', desc: '攻击力+20%' });
  assert.equal(r.applied, 1);
  assert.equal(r.stale, 1);
  const f = applyFileOverlay({ a: { name: '甲' }, b: { name: '乙' } }, { a: buildRecordOverlay([{ path: ['name'], zh: '甲', en: 'A' }]), gone: { name: 'x', _h: '00' } });
  assert.deepEqual(f.value, { a: { name: 'A' }, b: { name: '乙' } }, 'records missing from the data are skipped');
});

test('build-i18n matching: exact, blackboard templates, plain from raw, composites, fallback order, notes, names', () => {
  const zh = [{ chars: { char_x: { name: '测试员', description: '攻击造成<@ba.kw>法术伤害</>', skill: { levels: [{ name: '强攻', description: '攻击力<@ba.vup>+{atk:0%}</>，持续{duration}秒' }] } } } }];
  const en = [{ chars: { char_x: { name: 'Tester', description: 'Attacks deal <@ba.kw>Arts damage</>', skill: { levels: [{ name: 'Assault', description: 'ATK <@ba.vup>+{atk:0%}</> for {duration} seconds' }] } } } }];
  const data = {
    chess: {
      chess_x_a: {
        charId: 'char_x', name: '测试员',
        trait: { desc: '攻击造成法术伤害', descRaw: '攻击造成<@ba.kw>法术伤害</>' },
        skill: { skillId: 'sk_x', name: '强攻', descRaw: '攻击力<@ba.vup>+80%</>，持续30秒', desc: '攻击力+80%，持续30秒', bb: { atk: 0.8 }, duration: 30 },
        spec: { note: '研究笔记' },
      },
    },
    stages: { m1: { name: '战场#05(下半) 测试员' }, m2: { name: '战场#04 活性源石' } },
    config: { seasonName: '卫戍协议：盟约', tips: [{ tip: '无官方的提示' }, { tip: '界面里的话' }] },
  };
  const { overlay, report } = buildOverlay({
    zh, en, data,
    fallback: { remake: { 活性源石: 'Active Originium', '卫戍协议：盟约': 'Stronghold Protocol: Alliance' }, pr70: { 无官方的提示: 'A tip', 界面里的话: 'PR wording' }, ui: { 界面里的话: 'UI wording' } },
  });
  const c = applyRecordOverlay(data.chess.chess_x_a, overlay.files.chess.chess_x_a).value;
  assert.equal(c.name, 'Tester');
  assert.equal(c.trait.descRaw, 'Attacks deal <@ba.kw>Arts damage</>');
  assert.equal(c.trait.desc, 'Attacks deal Arts damage', 'the plain text is the stripped raw translation');
  assert.equal(c.skill.descRaw, 'ATK <@ba.vup>+80%</> for 30 seconds', 'numbers read back from the Chinese and filled in');
  assert.equal(c.skill.desc, 'ATK +80% for 30 seconds');
  assert.equal(c.spec.note, '研究笔记', 'research notes are not translated');
  const st = applyFileOverlay(data.stages, overlay.files.stages).value;
  assert.equal(st.m1.name, 'Battlefield #05 (Second Half) Tester');
  assert.equal(st.m2.name, 'Battlefield #04 Active Originium');
  const cfg = applyFileOverlay(data.config, overlay.files.config).value;
  assert.equal(cfg.seasonName, 'Stronghold Protocol: Alliance');
  assert.deepEqual(cfg.tips.map((x) => x.tip), ['A tip', 'PR wording'], 'remake > PR #70 > UI table');
  assert.equal(overlay.names['测试员'], 'Tester');
  assert.equal(report.coverage.operators.translated, 1);
  assert.equal(report.coverage.skills.template, 2);
  assert.equal(report.coverage.operators.notes, 1);
  assert.deepEqual(inverseFormat('攻击力+{atk:0%}，{-x}格', '攻击力+80%，-2格'), { bb: { atk: 0.8, x: 2 }, bbStr: {} });
  assert.equal(inverseFormat('攻击力+{atk:0%}', '攻击力+80'), null);
  assert.equal(shapeKey('攻击力<@ba.vup>+{atk:0%}</>'), shapeKey('攻击力+80%'));
});

test('data/i18n/en.json: shape, the 盟约 season of the EN build, coverage and the names map', () => {
  assert.equal(OVERLAY.version, 1);
  assert.equal(OVERLAY.lang, 'en');
  assert.equal(OVERLAY.meta.source.season, 'act2autochess', 'built from an EN client that has 卫戍协议：盟约 下半');
  // 0.2.3 adds Clementia before her EN release: official untranslated names/skills/talents remain Chinese.
  // Measured 2026-10-09: total 97.4%, skills 95.9%, talents 94.9%; other category floors stay unchanged.
  assert.ok(OVERLAY.meta.totals.pct >= 97, `coverage ${OVERLAY.meta.totals.pct} %`);
  for (const kind of ['operators', 'skills', 'talents', 'modules', 'traits', 'enemies', 'bonds', 'items', 'effects', 'bands', 'garrisons', 'stages', 'tokens', 'choices', 'config']) {
    const c = OVERLAY.meta.coverage[kind];
    assert.ok(c && c.texts > 0, `coverage of ${kind}`);
    assert.ok(c.pct >= (kind === 'talents' ? 94.9 : ['operators', 'skills', 'modules'].includes(kind) ? 95 : 98), `${kind}: ${c.pct} %`);
  }
  assert.deepEqual(Object.keys(OVERLAY.files).filter((f) => !DATA_FILES.includes(f)), []);
  assert.equal(OVERLAY.names['琳琅诗怀雅'], 'Swire the Elegant Wit');
  assert.equal(OVERLAY.names['维式重锤'], 'Victorian Hammer');
  assert.equal(OVERLAY.names['奇迹'], 'Marvel');
  for (const [zh, en] of Object.entries(OVERLAY.names)) assert.ok(HAN.test(zh) && !HAN.test(en), `${zh} → ${en}`);
});

test('data/i18n/en.json matches the current data/*.json: every leaf replaces a Chinese string that still hashes the same', () => {
  // A failure here means data/*.json was rebuilt after the overlay: run `node tools/build-i18n.mjs` (docs/I18N.md).
  for (const [file, fov] of Object.entries(OVERLAY.files)) {
    const data = readJson(`data/${file}.json`);
    let leaves = 0;
    for (const [id, rov] of Object.entries(fov)) {
      if (typeof rov._s === 'string') { assert.equal(typeof data[id], 'string', `${file}.${id}`); leaves++; continue; }
      walkOverlay(rov, (p, enText) => {
        const zhText = getPath(data[id], p);
        assert.equal(typeof zhText, 'string', `${file}.${id}.${p.join('.')} is not a string in data/${file}.json`);
        assert.ok(HAN.test(zhText), `${file}.${id}.${p.join('.')}: not a Chinese text`);
        assert.ok(enText.trim(), `${file}.${id}.${p.join('.')}: empty translation`);
        leaves++;
      });
    }
    const r = applyFileOverlay(data, fov);
    assert.equal(r.stale, 0, `${file}: ${r.stale} translations are stale (run node tools/build-i18n.mjs)`);
    assert.equal(r.applied, leaves, file);
  }
});

test('official EN skill texts keep the rich-text markup and the remake\'s numbers (ui/richText.js renders them)', () => {
  const chess = readJson('data/chess.json');
  const cases = [['chess_char_3_04_a', 1, '155%'], ['chess_char_3_04_b', 1, '170%'], ['chess_char_1_01_a', 1, '+80%']];
  for (const [id, idx, number] of cases) {
    const zhRec = chess[id];
    const en = applyRecordOverlay(zhRec, OVERLAY.files.chess[id]).value;
    const zhSkill = zhRec.skills[idx];
    const enSkill = en.skills[idx];
    assert.ok(!HAN.test(enSkill.descRaw), `${id}: ${enSkill.descRaw}`);
    const vup = (s) => parseRichText(s).filter((x) => x.cls && x.cls.includes('ba.vup')).map((x) => x.text);
    assert.ok(vup(zhSkill.descRaw).includes(number) && vup(enSkill.descRaw).includes(number), `${id}: ${number} highlighted in both languages`);
    assert.equal(richTextPlain(enSkill.descRaw), enSkill.desc, 'desc is the plain form of descRaw');
    assert.equal((enSkill.descRaw.match(/<[@$][^<>]*>/g) || []).length, (enSkill.descRaw.match(/<\/>/g) || []).length, 'tags closed');
  }
  // every translated skill: it parses, no placeholder is left, plain = stripped raw (a few official EN texts leave a
  // tag unclosed, e.g. skchr_excu2_1's <@ba.rem>; the parser takes that as running to the end, as the game does)
  for (const [id, rov] of Object.entries(OVERLAY.files.chess)) {
    const rec = applyRecordOverlay(chess[id], rov).value;
    for (const s of rec.skills || []) {
      if (HAN.test(s.descRaw)) continue;
      assert.ok(parseRichText(s.descRaw).length > 0, `${id} ${s.skillId}`);
      assert.ok(!/\{-?[A-Za-z_@][^{}:]*(?::[^{}]+)?\}/.test(s.descRaw), `${id} ${s.skillId}: placeholder left: ${s.descRaw}`);
      assert.equal(stripRich(s.descRaw), s.desc, `${id} ${s.skillId}`);
    }
  }
});

/** A fetch over the repo's data/ (data/i18n/en.json included). */
function diskFetch(calls) {
  return async (url) => {
    calls.push(url);
    const rel = url.replace(/^\/data\//, 'data/');
    const abs = path.join(ROOT, rel);
    if (!existsSync(abs)) return { ok: false, status: 404, json: async () => null };
    const text = readFileSync(abs, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  };
}

test('data.js setLocale: getters return English records after the overlay loads, Chinese again after zh', async () => {
  const calls = [];
  const d = createDataStore({ fetch: diskFetch(calls), retryDelays: [] });
  await d.loadAll('chess', 'config', 'bonds');
  const seen = [];
  d.subscribe((n) => seen.push(n));
  assert.equal(d.lookup('chess', 'chess_char_3_04_a').name, '琳琅诗怀雅');
  assert.equal(await d.setLocale('en'), 'en');
  assert.equal(calls.filter((u) => u === '/data/i18n/en.json').length, 1);
  assert.deepEqual(seen.sort(), ['bonds', 'chess', 'config'], 'every loaded file notified');
  const swire = d.lookup('chess', 'chess_char_3_04_a');
  assert.equal(swire.name, 'Swire the Elegant Wit');
  assert.equal(swire.subProfessionName, 'Merchant');
  assert.equal(swire.stats.atk, 702, 'numbers untouched');   // 672 + 攻击力+30 (full potential)
  assert.equal(d.list('bonds').find((b) => b.bondId === 'yanShip').name, 'Yan');
  assert.equal(d.get('config').modes.mode_multi_hard.name, 'Dire Simulation');
  assert.equal(d.getRaw('config').modes.mode_multi_hard.name, '绝境模拟', 'getRaw keeps the Chinese file');
  assert.equal(d.localeName('琳琅诗怀雅'), 'Swire the Elegant Wit');
  assert.equal(d.localeName('不存在的名字'), '不存在的名字');
  await d.load('items'); // loaded after the switch: localized too
  assert.equal(d.lookup('items', 'chess_item_1_01_e_a').name, 'Victorian Hammer');
  assert.equal(await d.setLocale('zh'), 'zh');
  assert.equal(d.lookup('chess', 'chess_char_3_04_a').name, '琳琅诗怀雅');
  assert.equal(d.localeName('琳琅诗怀雅'), '琳琅诗怀雅');
  await d.setLocale('en');
  assert.equal(calls.filter((u) => u === '/data/i18n/en.json').length, 1, 'the overlay downloads once');
});

test('data.js setLocale: without an overlay the texts stay Chinese (no throw, no switch)', async () => {
  const d = createDataStore({ fetch: async () => ({ ok: false, status: 404, json: async () => null }), retryDelays: [] });
  const w = console.warn;
  console.warn = () => {};
  try {
    assert.equal(await d.setLocale('en'), 'zh');
    assert.equal(d.locale(), 'zh');
  } finally { console.warn = w; }
});

test('build-i18n ja: a text written like the Chinese is the client\'s own when every Han character of it appears in the client\'s translated texts (炎, 速射手), untranslated otherwise (甄选干员)', () => {
  // the JP client writes 炎 / 不屈 / 助力 / 速射手 exactly like the Chinese; 'same' dropped them, and the ja chain fell back
  // to the English names (Yan / Resilient / Aid) in a Japanese interface
  const zh = [{ a: { name: '炎', sub: '速射手', diy: '甄选干员', tip: '火焰射手出现' } }];
  const ja = [{ a: { name: '炎', sub: '速射手', diy: '甄选干员', tip: '炎の速射手が出現' } }];
  const chars = nativeCharset(zh, ja);
  assert.deepEqual([...chars].sort(), [...'炎速射手出現'].sort(), 'only the texts that differ from their Chinese pair teach the charset');
  const ut = untranslatedTest('ja', chars);
  assert.equal(ut('炎', '炎'), false, '炎: every character is the client\'s own');
  assert.equal(ut('速射手', '速射手'), false);
  assert.equal(ut('甄选干员', '甄选干员'), true, '甄选干员: 甄 / 选 / 干 / 员 never appear in the client\'s own texts');
  assert.equal(ut('W', 'W'), false, 'no Han character: as it stands');
  assert.equal(ut('火焰射手出现', '炎の速射手が出現'), false, 'a different text is a translation');
  // the other modes are unchanged: en / ko drop any target text with Chinese characters, zh-TW drops the Chinese itself
  assert.equal(untranslatedTest('en')('炎', '炎'), true);
  assert.equal(untranslatedTest('ko')('炎', '염'), false);
  assert.equal(untranslatedTest('zh-TW')('炎', '炎'), true);
  // the shipped ja overlay carries the bond names the JP client writes in kanji
  const jaData = JSON.parse(readFileSync(path.join(ROOT, 'data/i18n/ja.json'), 'utf8'));
  for (const n of ['炎', '不屈', '助力']) assert.equal(jaData.names[n], n, `${n} is Japanese as it stands`);
});
