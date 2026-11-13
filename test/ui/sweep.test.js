// S.W.E.E.P.报告 (screens/sweep.js) and the enemy codex's letter grades:
//   - factions.json `handbookLevels` is the official enemy handbook table (enemy_handbook_table levelInfoList, generated
//     by tools/build-data.mjs): ten grades E … SS, weakest first, every graded stat with a [min, max) band
//   - enemyGrade puts a value in its band (an edge belongs to the band that starts there; the attack interval runs the
//     other way); no value or no table reads '—'
//   - the codex lists one enemy per 图鉴 number and no summon-only enemy; a leader's keys are the leader, then its escorts
//   - the report is read-only and a full-screen Modal (focus trap, Esc, focus restored); the lobby opens it

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const factions = JSON.parse(read('data/factions.json'));
const enemies = JSON.parse(read('data/enemies.json'));

const { enemyGrade, codexEnemies, bossEnemyKeys, equipReportOn, equipReportGroups } = await import('../../public/js/screens/sweep.js');

const LEVELS = factions.handbookLevels;
const STATS = ['maxHp', 'atk', 'def', 'res', 'moveSpeed', 'interval', 'elementRes', 'elementDmgRes'];

test('handbookLevels: the official ten grades, weakest first, each stat a [min, max) band that meets the next', () => {
  assert.deepEqual(LEVELS.map((l) => l.level), ['E', 'D', 'C', 'B', 'B+', 'A', 'A+', 'S', 'S+', 'SS']);
  for (const l of LEVELS) for (const k of STATS) assert.ok(Array.isArray(l[k]) && l[k].length === 2, `${l.level} ${k}`);
  for (const k of STATS) {
    const bands = LEVELS.map((l) => l[k]);
    if (k === 'interval') {
      // shorter is stronger: SS starts at 0, E is open-ended
      assert.equal(bands.at(-1)[0], 0);
      assert.equal(bands[0][1], null);
      for (let i = 1; i < bands.length; i++) assert.equal(bands[i][1], bands[i - 1][0], `${k} ${LEVELS[i].level}`);
    } else {
      assert.equal(bands[0][0], 0);
      assert.equal(bands.at(-1)[1], null);
      for (let i = 1; i < bands.length; i++) assert.equal(bands[i][0], bands[i - 1][1], `${k} ${LEVELS[i].level}`);
    }
  }
  // spot checks against the table (enemy_handbook_table.json levelInfoList)
  assert.deepEqual(LEVELS.find((l) => l.level === 'B').maxHp, [5000, 8000]);
  assert.deepEqual(LEVELS.find((l) => l.level === 'A+').def, [1200, 2000]);
  assert.deepEqual(LEVELS.find((l) => l.level === 'S+').interval, [0.5, 0.8]);
});

test('enemyGrade: the band a value falls in; an edge starts the next band; the interval runs the other way', () => {
  assert.equal(enemyGrade('maxHp', 999, LEVELS), 'E');
  assert.equal(enemyGrade('maxHp', 1000, LEVELS), 'D');
  assert.equal(enemyGrade('maxHp', 7999, LEVELS), 'B');
  assert.equal(enemyGrade('maxHp', 500000, LEVELS), 'SS');
  assert.equal(enemyGrade('atk', 0, LEVELS), 'E');
  assert.equal(enemyGrade('res', 50, LEVELS), 'A');
  assert.equal(enemyGrade('moveSpeed', 1.9, LEVELS), 'S+');
  assert.equal(enemyGrade('interval', 0.4, LEVELS), 'SS');
  assert.equal(enemyGrade('interval', 1.7, LEVELS), 'B+');
  assert.equal(enemyGrade('interval', 9, LEVELS), 'E');
  assert.equal(enemyGrade('atk', null, LEVELS), '—', 'never attacks');
  assert.equal(enemyGrade('moveSpeed', undefined, LEVELS), '—');
  assert.equal(enemyGrade('atk', -5, LEVELS), '—', 'in no band');
  assert.equal(enemyGrade('atk', 300, undefined), '—', 'no table loaded');
  assert.equal(enemyGrade('nope', 300, LEVELS), '—');
});

test('enemyGrade grades every codex enemy\'s numbers (no gaps in the table)', () => {
  for (const e of codexEnemies(Object.values(enemies))) {
    for (const k of ['maxHp', 'atk', 'def', 'res', 'elementRes', 'elementDmgRes']) {
      const v = e.stats?.[k] ?? 0;
      assert.notEqual(enemyGrade(k, v, LEVELS), '—', `${e.key} ${k}=${v}`);
    }
  }
});

test('codexEnemies: one per 图鉴 number, no summon-only enemy, by number; bossEnemyKeys: the leader, then its escorts', () => {
  const list = codexEnemies(Object.values(enemies));
  assert.ok(list.length > 50);
  assert.ok(list.every((e) => !e.tokenOnly));
  const ids = list.map((e) => (e.handbookIndex ? `${e.handbookIndex}|${e.name}` : e.key));
  assert.equal(new Set(ids).size, ids.length);
  const boss = { enemyKey: 'a', escortsByTemplate: { t1: [{ key: 'b' }, { key: 'a' }], t2: [{ key: 'c' }, null] } };
  assert.deepEqual(bossEnemyKeys(boss), ['a', 'b', 'c']);
  assert.deepEqual(bossEnemyKeys(null), []);
});

test('the report is read-only and a full-screen Modal; the lobby opens it (source contract)', () => {
  const src = read('public/js/screens/sweep.js');
  assert.match(src, /<\$\{Modal\} open=\$\{true\} onClose=\$\{onClose\} class="sw"/);
  assert.match(src, /<\$\{Modal\} open=\$\{true\} onClose=\$\{onClose\} class="sw-codex"/);
  assert.doesNotMatch(src, /openLoadout|savePref\((?!TAB_PREF)|net\.|room\./, 'nothing but the remembered tab is written');
  assert.doesNotMatch(src, /name="box"|name="dice"/, 'only icons of the project\'s set');
  const lobby = read('public/js/screens/lobby.js');
  assert.match(lobby, /import \{ SweepReport \} from '\.\/sweep\.js';/);
  assert.match(lobby, /\$\{sweepOpen \? html`<\$\{SweepReport\} onClose=\$\{\(\) => setSweepOpen\(false\)\} \/>` : null\}/);
  assert.match(read('public/index.html'), /<link rel="stylesheet" href="\/css\/screens\/sweep\.css" \/>/);
});

const TIER4 = ['寻呼模块', '蜂鸣器', '伪装服', '卡西米尔竞技旗', '灼燃维式重锤', '护盾无人机', 'M3茧甲', '莱塔尼亚小鼓', '谢拉格不融冰', '可靠怀表', '一次性促销券', '驱逐者警棍', '动能单手弩', '汲取者之喙'];

test('equipReportOn: 装备报告 only when config.version.family is regulation', () => {
  const reg = JSON.parse(read('data/versions/act3autochess-v3_1/config.json'));
  const act1 = JSON.parse(read('data/versions/act1autochess/config.json'));
  const def = JSON.parse(read('data/config.json'));
  assert.equal(reg.version.family, 'regulation');
  assert.equal(equipReportOn(reg), true);
  assert.equal(act1.version.family, 'covenant');
  assert.equal(equipReportOn(act1), false);
  assert.equal(def.version, undefined);
  assert.equal(equipReportOn(def), false);
  assert.equal(equipReportOn(null), false);
  assert.equal(equipReportOn({}), false);
  assert.equal(equipReportOn({ version: { family: 'covenant' } }), false);
  assert.equal(equipReportOn({ version: { id: 'act3autochess@V3_1' } }), false, 'the id alone is not the gate');
  assert.equal(equipReportOn({ version: { family: 'regulation' } }), true);
});

test('equipReportGroups: 规程 base EQUIP, tiers 1–6, shopSortId, golden pairing; an absent golden record is null', () => {
  const items = JSON.parse(read('data/versions/act3autochess-v3_1/items.json'));
  const groups = equipReportGroups(items);
  assert.deepEqual(groups.map((g) => g.tier), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(groups.map((g) => g.items.length), [7, 10, 16, 14, 12, 6]);
  const names = (tier) => groups.find((g) => g.tier === tier).items.map((r) => r.item.name);
  assert.deepEqual(names(4), TIER4);
  for (const g of groups) {
    const sorts = g.items.map((r) => r.item.shopSortId);
    assert.deepEqual(sorts, [...sorts].sort((a, b) => a - b), `tier ${g.tier} shopSortId`);
    for (const { item, golden } of g.items) {
      assert.equal(item.itemType, 'EQUIP');
      assert.notEqual(item.isGolden, true);
      if (golden) {
        assert.equal(golden.id, item.goldenId);
        assert.notEqual(golden.id, item.id);
      } else {
        assert.equal(items[item.goldenId], undefined);
      }
    }
  }
  const buzz = groups.find((g) => g.tier === 4).items.find((r) => r.item.name === '蜂鸣器');
  assert.match(buzz.item.descRaw, /\+40%/);
  assert.match(buzz.golden.descRaw, /\+60%/);
  assert.equal(buzz.item.flavor, '“你们去救伤员，我来对付这些混蛋！”');
  const pager = groups.find((g) => g.tier === 4).items.find((r) => r.item.name === '寻呼模块');
  assert.equal(pager.golden, null);
  assert.equal(pager.item.goldenId, null);
  // the same rows from an array as from the file object
  const fromList = equipReportGroups(Object.values(items));
  assert.deepEqual(fromList.map((g) => g.items.map((r) => r.item.id)), groups.map((g) => g.items.map((r) => r.item.id)));
  // 盟约's table is a different list; the screen must not show it (the gate above)
  const defGroups = equipReportGroups(JSON.parse(read('data/items.json')));
  assert.notDeepEqual(defGroups.find((g) => g.tier === 4).items.map((r) => r.item.name), TIER4);
});

test('equipReportGroups: drops golden, non-EQUIP and tiers outside 1–6; missing goldenId is no pair; id breaks a shopSortId tie', () => {
  assert.deepEqual(equipReportGroups(null), []);
  assert.deepEqual(equipReportGroups(undefined), []);
  assert.deepEqual(equipReportGroups({}), []);
  const items = {
    a: { id: 'a', itemType: 'EQUIP', isGolden: false, tier: 2, shopSortId: 2, goldenId: 'aB', name: 'A' },
    aB: { id: 'aB', itemType: 'EQUIP', isGolden: true, tier: 2, shopSortId: 2, name: 'A+' },
    b: { id: 'b', itemType: 'EQUIP', isGolden: false, tier: 2, shopSortId: 1, goldenId: 'missing', name: 'B' },
    c: { id: 'c', itemType: 'EQUIP', isGolden: false, tier: 6, shopSortId: 1, goldenId: null, name: 'C' },
    mag: { id: 'mag', itemType: 'MAGIC', isGolden: false, tier: 1, shopSortId: 1, name: 'M' },
    goldOnly: { id: 'g', itemType: 'EQUIP', isGolden: true, tier: 1, shopSortId: 1, name: 'G' },
    t0: { id: 't0', itemType: 'EQUIP', isGolden: false, tier: 0, shopSortId: 1, name: 'Z' },
    t7: { id: 't7', itemType: 'EQUIP', isGolden: false, tier: 7, shopSortId: 1, name: 'Y' },
    self: { id: 'self', itemType: 'EQUIP', isGolden: false, tier: 1, shopSortId: 2, goldenId: 'self', name: 'S' },
    tieB: { id: 'tie-b', itemType: 'EQUIP', isGolden: false, tier: 1, shopSortId: 1, name: 'Tb' },
    tieA: { id: 'tie-a', itemType: 'EQUIP', isGolden: false, tier: 1, shopSortId: 1, name: 'Ta' },
  };
  const groups = equipReportGroups(items);
  assert.deepEqual(groups.map((g) => g.tier), [1, 2, 6]);
  assert.deepEqual(groups[0].items.map((r) => [r.item.id, r.golden]), [['tie-a', null], ['tie-b', null], ['self', null]]);
  assert.deepEqual(groups[1].items.map((r) => [r.item.id, r.golden && r.golden.id]), [['b', null], ['a', 'aB']]);
  assert.deepEqual(groups[2].items.map((r) => r.item.id), ['c']);
});

test('装备报告 is appended only for 规程; the three 盟约 tabs stay the base list (source contract)', () => {
  const src = read('public/js/screens/sweep.js');
  const base = src.slice(src.indexOf('const REPORT_TABS'), src.indexOf('const EQUIP_TAB'));
  assert.match(base, /盟约报告/);
  assert.match(base, /策略报告/);
  assert.match(base, /敌方资料/);
  assert.doesNotMatch(base, /装备报告/);
  assert.match(src, /const EQUIP_TAB = \{ id: 'equip', name: N_\('装备报告'\)/);
  assert.match(src, /name="shield"/);
  assert.match(src, /equipOn \? \[\.\.\.REPORT_TABS, EQUIP_TAB\] : REPORT_TABS/);
  assert.match(src, /t\('基础效果'\)/);
  assert.match(src, /t\('进阶效果'\)/);
  assert.match(src, /itemIconUrl\(m, item\)/);
  assert.match(src, /item\.descRaw \|\| item\.desc/);
  assert.match(src, /golden\.descRaw \|\| golden\.desc/);
  assert.match(src, /\$\{golden \? html/);
  assert.match(read('public/css/screens/sweep.css'), /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
});
