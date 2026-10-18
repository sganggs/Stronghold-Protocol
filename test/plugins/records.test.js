import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getData } from '../../server/data.js';
import { expandRecords } from '../../shared/plugins/records.js';
import { validateData, validateReferences } from '../../shared/plugins/validate.js';
import { validateDsl } from '../../server/sim/content/dsl/validate.js';
import { applyPatches } from '../../shared/plugins/patch.js';
import { dataBound } from '../../shared/plugins/limits.js';
import { officialBbMax, officialFieldMax } from '../../shared/plugins/officialBounds.js';
import { validateSkillSpec, matchesSchema } from '../../shared/plugins/skillSpec.js';
import { FX_RECORDS_SCHEMA } from '../../server/plugins/fxRecords.js';
import { TRAIT_RECORDS_SCHEMA as RECORDS_SCHEMA } from '../../server/plugins/traitSchema.js';
import { guard } from '../helpers/contentFixtures.js';
import { diyRecord } from '../../shared/diy.js';
import { meleeOnHighGround } from '../../shared/highGround.js';
const base = getData(), context = { pluginId: 'data-demo' };
test('complete normal/elite pair and all DIY forms; behavior survives production DIY composition', () => {
  const r = expandRecords(base, [guard()], context); assert.deepEqual(r.problems, []);
  assert.deepEqual(validateData(r.data), []);
  for (const elite of [false, true]) {
    const c = r.data.chess[`chess_x_data_demo_guard_${elite ? 'b' : 'a'}`];
    assert.equal(c.stats.maxHp, elite ? 3000 : 2000); assert.equal(c.skill.skillId, c.skills.find(s => s.isDefault).skillId);
    const d = diyRecord('chess_char_5_diy1_a', { charId: 'char_x_data_demo_guard', skillIndex: 0 }, { elite, data: r.data });
    assert.equal(d.kitRef, 'chess_char_1_02_a');
  }
  assert.ok(!base.chess.chess_x_data_demo_guard_a);
});
test('new enemies, waves, stages, modes, items, bands, garrisons and choices reuse data and effects', () => {
  const r = expandRecords(base, [
    { file: 'enemies', id: 'enemy_x_data_demo_slug', base: 'enemy_1422_lrsldr', set: { stats: { maxHp: 6000 } } },
    { file: 'waves', id: 'wave_x_data_demo_one', value: { routes: [{ start: [9,10], end: [9,2], motion: 'WALK' }], spawns: [{ key: 'enemy_x_data_demo_slug', time: 0, count: 1, interval: 0, routeIndex: 0 }] } },
    { file: 'stages', id: 'stage_x_data_demo_one', base: 'act1autochess_m01', set: { name: 'Example' } },
    { file: 'modes', id: 'mode_x_data_demo_one', base: 'mode_single_normal', set: { economy: { refreshPrice: 0 } } },
    { file: 'items', id: 'item_x_data_demo_one', base: 'chess_item_3_02_e_a' },
    { file: 'bands', id: 'band_x_data_demo_one', base: 'band_amiya' },
    { file: 'garrisons', id: 'garrison_x_data_demo_one', base: Object.keys(base.garrisons)[0] },
    { file: 'choices', id: 'effect_x_data_demo_one', kind: 'tactic', base: base.choices.cards.tactic[0].effectId },
  ], context);
  assert.deepEqual(r.problems, []); assert.deepEqual(validateData(r.data), []);
  assert.equal(r.data.config.modes.mode_x_data_demo_one.lastRound, base.config.modes.mode_single_normal.lastRound);
  assert.equal(r.data.items.item_x_data_demo_one.effectRef, 'chess_item_3_02_e_a');
});
test('record expansion errors are coded and atomic', () => {
  for (const [r, want] of [
    [{ ...guard(), charId: 'char_x_another_guard' }, 'PLUGIN_RECORD_ID'],
    [{ ...guard(), as: 'unknown' }, 'PLUGIN_RECORD_TYPE'],
    [{ ...guard(), skills: [{ ...guard().skills[0], default: false }] }, 'PLUGIN_RECORD_SKILLS'],
    [{ file: 'modes', id: 'mode_x_data_demo_bad', base: 'missing' }, 'PLUGIN_DATA_REFERENCE'],
  ]) { const v = expandRecords(base, [r], context); assert.equal(v.data, base); assert.equal(v.problems[0].code, want); }
  const a = expandRecords(base, [guard()], context); assert.equal(expandRecords(a.data, [guard()], context).problems[0].code, 'PLUGIN_RECORD_EXISTS');
});
test('merged data validation: required fields, pairs, references, skills, kitRef/effectRef, nonfinite, DSL', () => {
  assert.deepEqual(validateReferences(base), []);
  for (const [change, want] of [
    [d => { delete d.config; }, 'PLUGIN_DATA_REQUIRED'],
    [d => { d.chess.chess_char_1_02_a.goldenId = 'missing'; }, 'PLUGIN_DATA_PAIR'],
    [d => { d.chess.chess_char_1_02_a.bonds.push('missing'); }, 'PLUGIN_DATA_REFERENCE'],
    [d => { d.chess.chess_char_1_02_a.skills[0].isDefault = true; }, 'PLUGIN_RECORD_SKILLS'],
    [d => { d.chess.chess_char_1_02_a.kitRef = 'missing'; }, 'PLUGIN_KIT_REF'],
    [d => { d.items.chess_item_1_01_e_a.effectRef = 'missing'; }, 'PLUGIN_EFFECT_REF'],
    [d => { d.config.economy.refreshPrice = NaN; }, 'PLUGIN_DATA_NUMBER'],
    [d => { d.chess.chess_char_1_02_a.dsl = {}; }, 'PLUGIN_DSL_VERSION'],
  ]) { const d = structuredClone(base); change(d); assert.ok(validateData(d, { kitExists: () => false, validateDsl }).some(p => p.code === want), want); }
  // the DSL validator is the sim's, handed in by the content-set builder (shared code does not import the engine): without
  // it a record that carries DSL is refused, never passed unchecked
  const d = structuredClone(base); d.chess.chess_char_1_02_a.dsl = { dsl: 1, pluginId: 'x', skill: { kind: 'passive', mods: { atkPct: 0.1 } } };
  assert.ok(validateData(d, { kitExists: () => false }).some(p => p.code === 'PLUGIN_DSL_SHAPE'));
});
test('SkillSpec exposes only the JSON subset, including nested attack fields and typed mods', () => {
  assert.deepEqual(validateSkillSpec({ kind: 'passive', mods: { atkPct: 0.5 }, attack: { hits: 2, onHitStatus: { key: 'stun', duration: 1 } } }), []);
  for (const s of [{ kind: 'passive', onStart: 'evil()' }, { kind: 'ammo', ammo: 1e9 }, { kind: 'passive', attack: { onHit: () => 1 } }, { kind: 'passive', mods: { unknown: 1 } }]) assert.ok(validateSkillSpec(s).some(p => p.code === 'PLUGIN_SKILL_SPEC'));
});
test('checked-in schema equals the runtime schema and accepts/rejects the same structural fixtures', () => {
  const dest = path.join(os.tmpdir(), `records-schema-${process.pid}.json`);
  const run = spawnSync(process.execPath, ['tools/records-schema.mjs', dest], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(dest, 'utf8')), RECORDS_SCHEMA);
  fs.unlinkSync(dest);
  assert.deepEqual(JSON.parse(fs.readFileSync('schemas/records.schema.json')), RECORDS_SCHEMA);
  for (const r of [guard(), { ...guard(), as: 'bad' }, { ...guard(), forms: {} }, { file: 'modes', id: 'mode_x_data_demo_one', base: 'mode_single_normal' }]) {
    const valid = matchesSchema(r, FX_RECORDS_SCHEMA);
    const problems = expandRecords(base, [r], context).problems;
    assert.equal(!problems.some(p => p.code === 'PLUGIN_RECORD_TYPE'), valid);
  }
});

test('compact rich text fills the form blackboard and keeps literal trigger labels', () => {
  const op = guard(); op.skills[0].desc = '<获得时>攻击<@ba.vup>+{def:0%}</>';
  const r = expandRecords(base, [op], context); assert.deepEqual(r.problems, []);
  assert.equal(r.data.chess.chess_x_data_demo_guard_a.skill.desc, '<获得时>攻击+50%');
});
test('malformed nested arrays return diagnostics without throwing', () => {
  for (const edit of [d => { d.waves[Object.keys(d.waves)[0]].spawns = {}; }, d => { d.bonds.deputShip = null; }]) {
    const d = structuredClone(base); edit(d); assert.ok(validateData(d).length);
  }
});
test('spawn budgets, enemy times and per-count card grants stay inside the official tables and reject bombs', () => {
  assert.equal(validateData(base).some(p => p.code === 'PLUGIN_DATA_LIMIT'), false);
  const waveId = Object.keys(base.waves)[0];
  const sample = base.waves[waveId].spawns.find(s => s && !s.action);
  const row = (count) => ({ key: sample.key, time: 0, count, interval: 0, routeIndex: sample.routeIndex });
  const limited = (edit) => { const d = structuredClone(base); edit(d); return validateData(d).some(p => p.code === 'PLUGIN_DATA_LIMIT'); };
  assert.equal(limited(d => { d.waves[waveId].spawns = Array.from({ length: 65 }, () => row(1)); }), true);
  assert.equal(limited(d => { d.waves[waveId].spawns = [row(601)]; }), true);
  assert.equal(limited(d => { d.waves[waveId].spawns = [row(200), row(200), row(201)]; }), true);
  const branchWave = Object.values(base.waves).find(w => Object.values(w.branches).some(p => Array.isArray(p) && Array.isArray(p[0]) && p[0][0]));
  assert.ok(branchWave);
  assert.equal(limited(d => {
    const w = d.waves[branchWave.id];
    const [name, phases] = Object.entries(w.branches).find(([, p]) => Array.isArray(p) && Array.isArray(p[0]) && p[0][0]);
    const seed = phases[0][0];
    w.branches[name][0] = Array.from({ length: 65 }, () => ({ ...seed, count: 1 }));
  }), true);
  assert.equal(limited(d => { d.enemies.enemy_10162_mnctpt.talents.bb['Attack.attack@times'] = 1e6; }), true);
  assert.equal(limited(d => {
    const skill = d.enemies.enemy_10027_vtsk.skills.find(s => s?.bb && Object.hasOwn(s.bb, 'times'));
    assert.ok(skill);
    skill.bb.times = 1e6;
  }), true);
  assert.equal(limited(d => {
    const buff = d.effects.allybuff_select_1.buffs.find(b => b.key === 'global_special_choice_gain_equip');
    buff.bb.count = 1e9;
  }), true);
  assert.equal(limited(d => {
    const w = d.waves[waveId];
    w.overrides = { ...w.overrides, [sample.key]: { talents: { bb: { 'Attack.attack@times': 1e6 } } } };
  }), true);
});
test('enemy skills and talents keep their shape', () => {
  const d = structuredClone(base);
  d.enemies.enemy_10027_vtsk.skills = { hijack: true };
  d.enemies.enemy_10027_vtsk.talents = [];
  const codes = validateData(d).filter(p => p.code === 'PLUGIN_DATA_TYPE').map(p => p.path);
  assert.ok(codes.some(p => p.endsWith('.skills')));
  assert.ok(codes.some(p => p.endsWith('.talents')));
});
test('kit.ref together with talentMods is refused at expand and at validation', () => {
  const v = expandRecords(base, [{ ...guard(), talentMods: { atkPct: 0.1 } }], context);
  assert.equal(v.data, base);
  assert.equal(v.problems[0].code, 'PLUGIN_SKILL_SPEC');
  const d = structuredClone(base);
  d.chess.chess_char_1_02_a.kitRef = 'chess_char_1_02_a';
  d.chess.chess_char_1_02_a.talentMods = { atkPct: 0.1 };
  assert.ok(validateData(d, { kitExists: () => true }).some(p => p.code === 'PLUGIN_SKILL_SPEC'));
});

test('official tables pass the systematic bound; a 1e9 blackboard or loop field is PLUGIN_DATA_BOUND', () => {
  assert.equal(officialBbMax('times'), 12);
  assert.equal(officialBbMax('attack@times'), 5);
  assert.equal(officialBbMax('count'), 20);
  assert.equal(officialFieldMax('enemy.sp.maxSp'), 55);
  assert.equal(dataBound(12), 120);
  assert.equal(dataBound(null), 64);
  const plain = validateData(base);
  const official = validateData(base, { vanilla: base });
  assert.deepEqual(official.filter(p => p.code === 'PLUGIN_DATA_BOUND'), []);
  assert.deepEqual(official, plain);
  const bound = (op) => {
    const patched = applyPatches(base, [op]);
    assert.deepEqual(patched.problems, [], JSON.stringify(patched.problems));
    return validateData(patched.data, { vanilla: base });
  };
  const hits = (op) => bound(op).filter(p => p.code === 'PLUGIN_DATA_BOUND');
  const zuole = { op: 'set', file: 'backups', id: 'units', path: ['char_4121_zuole', 'forms', '2/1/4/0', 'skills', 2, 'bb', 'times'], value: 1e9 };
  const acpion = { op: 'set', file: 'backups', id: 'units', path: ['char_608_acpion', 'forms', '2/1/4/0', 'skills', 2, 'bb', 'times'], value: 1e9 };
  const wisdel = { op: 'set', file: 'chess', id: 'chess_char_6_12_a', path: ['trait', 'bb', 'attack@times'], value: 1e9 };
  const orchidAt = base.bands.band_orchid.buffs.findIndex(b => b.key === 'preparation_start_gain_chess_from_round');
  const victoriaAt = base.bonds.victoriaShip.buffs.findIndex(b => b.key === 'bond_layer_added_reward_equip');
  assert.ok(orchidAt >= 0 && victoriaAt >= 0);
  const orchid = { op: 'set', file: 'bands', id: 'band_orchid', path: ['buffs', orchidAt, 'bb', 'count'], value: 1e9 };
  const victoria = { op: 'set', file: 'bonds', id: 'victoriaShip', path: ['buffs', victoriaAt, 'bb', 'count'], value: 1e9 };
  const cloudSp = { op: 'set', file: 'enemies', id: 'enemy_9009_acfort', path: ['sp', 'maxSp'], value: 1e9 };
  const cloudBb = { op: 'set', file: 'enemies', id: 'enemy_9009_acfort', path: ['skills', 0, 'bb', 'sp'], value: 1e9 };
  for (const op of [zuole, acpion, wisdel, orchid, victoria, cloudSp, cloudBb]) {
    const found = hits(op);
    assert.equal(found.length, 1, JSON.stringify(found));
    assert.match(found[0].message, /超过上限/);
    assert.ok(found[0].message.includes(String(op.path.at(-1))), found[0].message);
  }
  assert.equal(hits({ ...zuole, value: dataBound(officialBbMax('times')) }).length, 0);
  assert.equal(hits({ ...zuole, value: dataBound(officialBbMax('times')) + 1 }).length, 1);
  assert.equal(hits({ ...zuole, value: -1e9 }).length, 1);
  assert.equal(hits({ ...cloudSp, value: dataBound(officialFieldMax('enemy.sp.maxSp')) }).length, 0);
  assert.equal(hits({ ...cloudSp, value: dataBound(officialFieldMax('enemy.sp.maxSp')) + 1 }).length, 1);
  const invented = (n) => hits({ op: 'merge', file: 'chess', id: 'chess_char_6_12_a', path: ['trait', 'bb'], value: { made_up_loop: n } });
  assert.equal(invented(64).length, 0);
  const unknown = invented(65);
  assert.equal(unknown.length, 1);
  assert.match(unknown[0].message, /原版没有这个键/);
  assert.match(unknown[0].message, /上限 64/);
});

test('a MELEE compact form copies placeOnRanged onto the chess and the 自选 form', () => {
  const hook = (over = {}) => ({
    op: 1, charId: 'char_x_data_demo_hook', name: 'Hook', profession: 'SPECIAL', subProfessionId: 'hookmaster',
    position: 'MELEE', rarity: 6, as: 'both',
    chess: { tier: 1, bonds: ['deputShip'] },
    trait: { desc: 'Can be deployed on Ranged Tiles' },
    forms: {
      normal: { stats: { maxHp: 2000, atk: 200 }, rangeGrid: [[0, 0], [0, 1]], placeOnRanged: true },
      elite: { stats: { maxHp: 3000, atk: 300 }, rangeGrid: [[0, 0], [0, 1]], placeOnRanged: true },
    },
    skills: [{ skillId: 'skx_data_demo_hook_1', name: 'Hook', default: true }],
    kit: 'generic',
    ...over,
  });
  const expanded = (record) => {
    const r = expandRecords(base, [record], context);
    assert.deepEqual(r.problems, [], JSON.stringify(r.problems));
    return r.data;
  };
  const pair = (data, stem) => ['a', 'b'].map((side) => data.chess[`chess_x_data_demo_${stem}_${side}`]);
  const flagged = expanded(hook());
  for (const c of pair(flagged, 'hook')) {
    assert.equal(c.placeOnRanged, true, c.chessId);
    assert.equal(meleeOnHighGround(c), true, c.chessId);
  }
  const unit = flagged.backups.units.char_x_data_demo_hook;
  const formKeys = Object.keys(unit.forms);
  assert.equal(formKeys.length, 3);
  for (const key of formKeys) assert.equal(unit.forms[key].placeOnRanged, true, key);
  const diy = diyRecord('chess_char_5_diy1_a', { charId: 'char_x_data_demo_hook', skillIndex: 0 }, { elite: true, data: flagged });
  assert.equal(diy.placeOnRanged, true);
  assert.equal(meleeOnHighGround(diy), true);
  assert.equal(diy.position, 'MELEE');
  assert.deepEqual(validateData(flagged), []);

  const shopOnly = expanded(hook({ as: 'chess', charId: 'char_x_data_demo_shop', skills: [{ skillId: 'skx_data_demo_shop_1', default: true }] }));
  for (const c of pair(shopOnly, 'shop')) assert.equal(c.placeOnRanged, true, c.chessId);
  assert.equal(shopOnly.backups.units.char_x_data_demo_shop, undefined);

  const line = hook({
    charId: 'char_x_data_demo_line', trait: { desc: '可以放置于远程位' },
    skills: [{ skillId: 'skx_data_demo_line_1', default: true }],
    forms: {
      normal: { stats: { maxHp: 2000 }, rangeGrid: [[0, 0]] },
      elite: { stats: { maxHp: 3000 }, rangeGrid: [[0, 0]] },
    },
  });
  for (const c of pair(expanded(line), 'line')) {
    assert.equal(c.placeOnRanged, undefined, c.chessId);
    assert.equal(meleeOnHighGround(c), true, c.chessId);
  }

  const plain = hook({
    charId: 'char_x_data_demo_plain',
    skills: [{ skillId: 'skx_data_demo_plain_1', default: true }],
    forms: {
      normal: { stats: { maxHp: 2000 }, rangeGrid: [[0, 0]] },
      elite: { stats: { maxHp: 3000 }, rangeGrid: [[0, 0]] },
    },
  });
  for (const c of pair(expanded(plain), 'plain')) {
    assert.equal(c.placeOnRanged, undefined, c.chessId);
    assert.equal(meleeOnHighGround(c), false, c.chessId);
  }

  const far = expanded(hook({
    position: 'RANGED', charId: 'char_x_data_demo_far',
    skills: [{ skillId: 'skx_data_demo_far_1', default: true }],
  }));
  for (const c of pair(far, 'far')) {
    assert.equal(c.placeOnRanged, undefined, c.chessId);
    assert.equal(meleeOnHighGround(c), false, c.chessId);
  }
  assert.equal(far.backups.units.char_x_data_demo_far.forms['2/1/4/0'].placeOnRanged, undefined);

  const odd = hook({ charId: 'char_x_data_demo_odd', skills: [{ skillId: 'skx_data_demo_odd_1', default: true }] });
  odd.forms.normal.placeOnRanged = false;
  odd.forms.elite.placeOnRanged = 1;
  for (const c of pair(expanded(odd), 'odd')) {
    assert.equal(c.placeOnRanged, undefined, c.chessId);
    assert.equal(meleeOnHighGround(c), false, c.chessId);
  }

  const half = hook({ charId: 'char_x_data_demo_half', skills: [{ skillId: 'skx_data_demo_half_1', default: true }] });
  delete half.forms.normal.placeOnRanged;
  const [normal, elite] = pair(expanded(half), 'half');
  assert.equal(normal.placeOnRanged, undefined);
  assert.equal(meleeOnHighGround(normal), false);
  assert.equal(elite.placeOnRanged, true);
  assert.equal(meleeOnHighGround(elite), true);
});
