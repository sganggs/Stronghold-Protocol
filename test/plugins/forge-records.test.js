import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'acorn';
import { deriveOfficialUnit } from '../../server/plugins/officialUnitBuilder.js';
import { localOfficialUnits } from '../../server/plugins/officialUnits.js';
import { planForgeRecords, rewriteForgeIds, rewriteForgeKit } from '../../server/plugins/forgeRecords.js';
import { planForgeImport, importForge } from '../../server/plugins/forgeImport.js';
import { getData, ROOT } from '../../server/data.js';
import { expandGameplayRecords } from '../../server/plugins/gameplayRecords.js';
import { validateData } from '../../shared/plugins/validate.js';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { createPluginRegistry } from '../../server/plugins/registry.js';
import { officialBbRange } from '../../shared/plugins/officialBounds.js';
import { PLUGIN_LIMITS } from '../../shared/plugins/manifest.js';

const id = 'char_999_test', status = { phase: 1, level: 5, skillLevel: 4, equipLevel: 0 };
function tables() {
  const attrs = { maxHp: 1000, atk: 100, def: 100, magicResistance: 0, cost: 10, blockCnt: 1, baseAttackTime: 1, attackSpeed: 100, respawnTime: 70, spRecoveryPerSec: 1, hpRecoveryPerSec: 0, moveSpeed: 1, maxDeployCount: 1 };
  const phase = { maxLevel: 9, rangeId: 'test-range', attributesKeyFrames: [{ level: 1, data: attrs }, { level: 9, data: { ...attrs, atk: 200 } }] };
  return {
    charTable: { [id]: { name: 'Test', appellation: 'Test', rarity: 'TIER_4', profession: 'WARRIOR', position: 'MELEE', subProfessionId: 'fearless', description: 'Test trait', tagList: ['DPS'], phases: [phase, phase, phase],
      skills: [{ skillId: 'test-skill', unlockCond: { phase: 'PHASE_1', level: 1 } }],
      talents: [{ candidates: [{ name: 'Talent', description: 'ATK {atk:0%}', requiredPotentialRank: 0, blackboard: [{ key: 'atk', value: 0.1 }] }, { name: 'Talent', description: 'ATK {atk:0%}', requiredPotentialRank: 5, blackboard: [{ key: 'atk', value: 0.2 }] }] }],
      potentialRanks: [{ buff: { attributes: { attributeModifiers: [{ attributeType: 'ATK', formulaItem: 'ADDITION', value: 20 }] } } }],
    } },
    skillTable: { 'test-skill': { levels: Array.from({ length: 7 }, (_, i) => ({ name: 'Skill', description: 'ATK {atk:0%}', skillType: 'MANUAL', durationType: 'NONE', duration: 10, rangeId: null, blackboard: [{ key: 'atk', value: (i + 1) / 10 }], spData: { spType: 1, spCost: 10, initSp: 0, maxChargeTime: 1, increment: 1 } })) } },
    rangeTable: { 'test-range': { grids: [{ row: 0, col: 0 }, { row: 0, col: 1 }] } },
  };
}
function temp(t) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'w3-records-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir; }
function writeTables(root, ts) {
  const dir = path.join(root, '.cache/gamedata/excel'); fs.mkdirSync(dir, { recursive: true });
  for (const [k, name] of Object.entries({ charTable: 'character_table', skillTable: 'skill_table', rangeTable: 'range_table' })) fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(ts[k]));
}

test('official derivation shares builder interpolation, full potential, skill rank, talent and range paths', () => {
  const u = deriveOfficialUnit(tables(), id, [status]); const f = Object.values(u.forms)[0];
  assert.equal(f.stats.atk, 170); assert.equal(f.skills[0].bb.atk, 0.4); assert.equal(f.talents[0].bb.atk, 0.2);
  assert.deepEqual(f.rangeGrid, [[0, 0], [0, 1]]); assert.equal(u.profession, 'WARRIOR'); assert.deepEqual(u.tags, ['DPS']);
  assert.throws(() => deriveOfficialUnit(tables(), 'missing', [status]), /missing/);
  const ts = tables(); ts.rangeTable = {}; assert.throws(() => deriveOfficialUnit(ts, id, [status]), /range/);
  const missingSkill = tables(); missingSkill.charTable[id].skills.push({ skillId: 'missing-skill' });
  assert.throws(() => deriveOfficialUnit(missingSkill, id, [status]), /official skill missing-skill missing/);
});

test('local table loader reports a deterministic version, refuses missing tables, and never downloads', t => {
  const dir = temp(t); assert.throws(() => localOfficialUnits(path.join(dir, 'data'))(id, [status]), /unavailable/);
  writeTables(dir, tables());
  const a = localOfficialUnits(path.join(dir, 'data'))(id, [status]);
  const b = localOfficialUnits(path.join(dir, 'data'))(id, [status]);
  assert.match(a.version, /^sha256:[0-9a-f]{64}$/); assert.deepEqual(a, b);
});

test('Forge maps every record kind, rewrites references, and names unsupported traits and band behavior', () => {
  const data = getData(), docs = {
    bonds: { team: { name: 'Team', desc: '', thresholds: [1], countMode: 'BOARD' } },
    items: { hook: { ...data.items.chess_item_1_01_e_a, id: 'hook', baseId: 'hook', goldenId: null, upgradeChessId: null, upgradeNum: 0, mergeable: false, giveBondId: 'team' } },
    bands: { band: { base: 'band_amiya', name: 'Team band' }, bad: { buffs: [{ key: 'custom-engine-code' }] } },
    garrisons: { trait: { ...Object.values(data.garrisons)[0] } },
    traits: { alias: { ...Object.values(data.garrisons)[0] }, bad: { effectKey: 'invented' }, grant: {
      ...Object.values(data.garrisons)[0], eventType: 'SERVER_CHESS_SOLD', effectKey: 'custom_grant_item_on_sell', bb: { count: 1 }, bbStr: { item: 'hook' },
    } },
    tokens: { token: { ...Object.values(data.tokens)[0] } },
    effects: { effect: { buffs: [], params: {} } },
  };
  const notes = [], planned = planForgeRecords({ read: f => docs[f], table: f => data[f], allocate: (p, id) => `${p}_data_demo_${id}`, skip: (...args) => notes.push(args) });
  assert.ok(notes.some(n => n[0] === 'traits:bad#effectKey' && n[2].includes('invented')));
  assert.ok(notes.some(n => n[0] === 'bands:bad#base/effectRef'));
  const rows = rewriteForgeIds(planned.records, planned.ids);
  const composed = expandGameplayRecords(data, rows, { pluginId: 'data-demo' });
  assert.deepEqual(composed.problems, []); assert.deepEqual(validateData(composed.data, { vanilla: data }), []);
  assert.equal(composed.data.items.item_x_data_demo_hook.giveBondId, 'bond_x_data_demo_team');
  const grant = composed.data.garrisons.garrison_x_data_demo_grant;
  assert.equal(grant.effectKey, 'SERVER_GAIN_EQUIP'); assert.equal(grant.eventType, 'SERVER_CHESS_SOLD');
  assert.deepEqual(grant.bbStr, { chess: 'item_x_data_demo_hook' });
  assert.deepEqual(rewriteForgeIds({ bb: { hook: 25 }, name: 'hook' }, planned.ids), { bb: { hook: 25 }, name: 'hook' });
  for (const [table, id] of [['bands', 'band_x_data_demo_band'], ['garrisons', 'garrison_x_data_demo_alias'], ['tokens', 'token_x_data_demo_token']]) assert.ok(composed.data[table][id]);
});

test('importer derives a missing official chess pair from synthetic local tables and writes self-contained forms', t => {
  const dir = temp(t), dataDir = path.join(dir, 'data'); fs.mkdirSync(dataDir);
  for (const name of ['chess', 'backups', 'config', 'bonds']) fs.copyFileSync(path.join(ROOT, 'data', `${name}.json`), path.join(dataDir, `${name}.json`));
  writeTables(dir, tables());
  const files = new Map(Object.entries({
    'pack.json': { id: 'test-official', name: 'Test', version: '1.0.0', content: ['chess'] },
    'chess.json': { test_a: { charId: id, tier: 1, bonds: ['deputShip'] } },
  }).map(([k, v]) => [k, Buffer.from(JSON.stringify(v))]));
  const plan = planForgeImport(files, { dataDir });
  assert.equal(plan.meta.operators.length, 1); assert.ok(plan.meta.operators[0].forms.normal.stats.atk > 0);
  assert.ok(plan.meta.importedData.some(s => s.includes('local official tables (sha256:')));
  fs.rmSync(path.join(dir, '.cache'), { recursive: true });
  const unavailable = planForgeImport(files, { dataDir }); assert.equal(unavailable.meta.operators.length, 0);
  assert.ok(unavailable.meta.skipped.some(s => s.en.includes('tables unavailable')));
});

test('kit literal IDs and the pure onDefaultSkill compatibility helper are rewritten without execution', () => {
  const text = "import { onDefaultSkill as selected } from '@kit/tier2.js';\nconst id = 'old'; export default () => ({ id, selected });";
  const rewritten = rewriteForgeKit(text, new Map([['old', 'skx_demo_new']]), parse);
  assert.match(rewritten, /skx_demo_new/); assert.match(rewritten, /const selected = chess/); assert.doesNotMatch(rewritten, /@kit\/tier2/);
  assert.doesNotThrow(() => parse(rewritten, { ecmaVersion: 'latest', sourceType: 'module' }));
});

test('synthetic new hook imports as a validated content product', async t => {
  const root = temp(t), data = getData();
  const item = { ...data.items.chess_item_1_01_e_a, id: 'hook', name: 'Hook', baseId: 'hook', goldenId: null, upgradeChessId: null, upgradeNum: 0, mergeable: false, price: 2, tier: 2,
    buffs: [{ key: 'env_gbuff_new_with_verify', bb: { attack_speed: 25 }, bbStr: { key: 'attr_common_global_buff' } }] };
  const files = new Map(Object.entries({ 'pack.json': { id: 'test-hook', name: 'Hook', version: '1.0.0', content: ['items'] }, 'items.json': { hook: item } }).map(([k, v]) => [k, Buffer.from(JSON.stringify(v))]));
  const result = await importForge({ files }, { root, dataDir: path.join(ROOT, 'data'), dryRun: true });
  assert.equal(result.ok, true, JSON.stringify(result.issues)); assert.equal(result.report.products[0].class, 'content');
});

test('Forge keeps custom skill heal 65/80 through import and composition, retaining official and step bounds', async t => {
  const root = temp(t), dataDir = path.join(ROOT, 'data');
  getData();
  const atkCap = officialBbRange('atk').max;
  const chess = Object.fromEntries([false, true].map(golden => {
    const chessId = `chess_healer_${golden ? 'b' : 'a'}`;
    return [chessId, { chessId, baseId: 'chess_healer_a', goldenId: 'chess_healer_b', isGolden: golden,
      name: 'Healer', charId: null, assets: { avatar: 'synthetic-avatar' }, tier: 1, rarity: 4,
      profession: 'TANK', subProfessionId: 'protector', position: 'MELEE', bonds: ['deputShip'],
      stats: { maxHp: 1000, atk: 100, def: 100, res: 0, cost: 10, blockCnt: 1, bat: 1, aspd: 100, respawnTime: 70 }, rangeGrid: [[0, 0]],
      skills: [{ skillId: 'heal-skill', name: 'Heal', isDefault: true, desc: 'Heal {heal}', bb: {
        heal: golden ? 80 : 65, custom_value: PLUGIN_LIMITS.number, custom_negative: -PLUGIN_LIMITS.number,
        over_number: PLUGIN_LIMITS.number + 1, atk: atkCap + 1, 'custom.interval': 65, 'custom.cost': 0.00001,
      } }],
    }];
  }));
  const files = new Map(Object.entries({
    'pack.json': { id: 'test-healer', name: 'Healer', version: '1.0.0', content: ['chess'] }, 'chess.json': chess,
  }).map(([k, v]) => [k, Buffer.from(JSON.stringify(v))]));
  const result = await importForge({ files }, { root, dataDir, out: path.join(root, 'plugins/test-healer') });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  const registry = createPluginRegistry({ publicDir: path.join(root, 'public'), packsDir: path.join(root, 'packs'), pluginsDir: path.join(root, 'plugins'), dataDir });
  registry.rescan();
  const set = buildContentSet({ registry, ids: ['test-healer'] });
  assert.deepEqual(set.problems, []);
  for (const [golden, heal] of [[false, 65], [true, 80]]) {
    const form = Object.values(set.data.chess).find(c => c.chessId.startsWith('chess_x_test_healer_') && c.isGolden === golden);
    assert.deepEqual(form.skills[0].bb, { heal, custom_value: PLUGIN_LIMITS.number, custom_negative: -PLUGIN_LIMITS.number });
    assert.equal(form.skill.bb.heal, heal);
    assert.equal(form.skills[0].desc, `Heal ${heal}`);
  }
  assert.ok(result.report.skipped.some(s => s.en.includes('bb.atk=') && s.en.includes('custom.interval')));
});
