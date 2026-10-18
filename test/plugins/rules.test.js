// Rule switches (DESIGN §34.15): one table, composition, the content hash, and Forge behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RULE_NAMES, RULE_SWITCHES, OFFICIAL_SLOT_POLICY, ruleOption, rulePhrases, readDeclaredRules,
  readForgeBehaviour, composeRules, grantedBondsByMorph, morphSlotPolicy,
} from '../../shared/plugins/rules.js';
import { contentHashInput as hashInput } from '../../shared/plugins/identity.js';
import { importForge } from '../../server/plugins/forgeImport.js';
import { readVanillaAssets } from '../../server/plugins/registry.js';
import { fixture } from '../helpers/contentFixtures.js';
import { buildContentSet, contentSetFiles } from '../../server/plugins/contentSet.js';
import { createContentSets } from '../../server/plugins/contentSets.js';
import { createRoomSets } from '../../server/plugins/roomSets.js';
import { SharedPool } from '../../server/match/pool.js';
import { loadContentSet } from '../../public/js/content.js';
import { createMatchHosts } from '../../server/match/host/index.js';
import { getData } from '../../server/data.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function collector() {
  const problems = [];
  return { problems, problem(code, text, extra) { problems.push({ code, text, extra }); } };
}

test('the closed table is the only list of names and options', () => {
  assert.deepEqual(RULE_NAMES, ['shopBias', 'prepLoadout', 'morphPairing', 'unequip']);
  assert.deepEqual(RULE_SWITCHES.shopBias.options, ['official', 'bondBias']);
  assert.deepEqual(RULE_SWITCHES.prepLoadout.options, ['locked', 'prep']);
  assert.deepEqual(RULE_SWITCHES.morphPairing.options, ['official', 'plus']);
  assert.deepEqual(RULE_SWITCHES.unequip.options, ['official', 'allow']);
  assert.equal(ruleOption(null, 'unequip'), 'official');
  assert.equal(ruleOption({ unequip: 'nope' }, 'unequip'), 'official');
  assert.equal(ruleOption({ unequip: 'allow' }, 'unequip'), 'allow');
  assert.equal(ruleOption(null, 'constructor'), '');
  assert.deepEqual(rulePhrases(null), []);
  assert.deepEqual(rulePhrases({ shopBias: 'official', unequip: 'allow' }), ['可以卸下装备']);
  assert.deepEqual(rulePhrases({
    unequip: 'allow', morphPairing: 'plus', prepLoadout: 'prep', shopBias: 'bondBias',
  }), ['商店装备偏向已激活盟约', '休整期可调整技能与模组', '变形同构体不占格，仅配对最左盟约装备', '可以卸下装备']);
});

test('a bad rules field is PLUGIN_RULES; an empty object is absent', () => {
  const bad = collector();
  assert.equal(readDeclaredRules({ shopBias: 'sideways' }, bad, 'content'), undefined);
  assert.equal(bad.problems[0].code, 'PLUGIN_RULES');
  const cosmetic = collector();
  assert.equal(readDeclaredRules({ unequip: 'allow' }, cosmetic, 'cosmetic'), undefined);
  assert.equal(cosmetic.problems[0].code, 'PLUGIN_RULES');
  const empty = collector();
  assert.equal(readDeclaredRules({}, empty, 'content'), undefined);
  assert.equal(empty.problems.length, 0);
  const ok = collector();
  assert.deepEqual(readDeclaredRules({ unequip: 'allow', extra: 1 }, ok, 'content'), undefined);
  assert.equal(ok.problems[0].code, 'PLUGIN_RULES');
  const declared = collector();
  assert.deepEqual(readDeclaredRules({ unequip: 'official' }, declared, 'script'), { unequip: 'official' });
});

test('composeRules refuses two options and keeps one option named twice', () => {
  const clash = composeRules([
    { id: 'alpha', rules: { unequip: 'allow' } },
    { id: 'beta', rules: { unequip: 'official' } },
  ]);
  assert.equal(clash.rules, null);
  assert.equal(clash.problems[0].code, 'PLUGIN_RULE_CONFLICT');
  assert.match(clash.problems[0].message, /alpha and beta set unequip/);
  const same = composeRules([
    { id: 'alpha', rules: { unequip: 'allow', shopBias: 'bondBias' } },
    { id: 'beta', rules: { unequip: 'allow' } },
  ]);
  assert.equal(same.problems.length, 0);
  assert.deepEqual(same.rules, { shopBias: 'bondBias', unequip: 'allow' });
  assert.equal(composeRules([{ id: 'plain' }]).rules, null);
});

test('Forge omitted options preserve a declared default and its conflict', async (t) => {
  const got = readForgeBehaviour(RULE_NAMES.map((name) => ({ switch: name })));
  const defaults = Object.fromEntries(RULE_NAMES.map((name) => [name, RULE_SWITCHES[name].options[0]]));
  assert.deepEqual(got, { rules: defaults, skipped: [] });
  for (const option of [null, false, 0, '', 'bad']) {
    const invalid = readForgeBehaviour([{ switch: 'unequip', option }]);
    assert.equal(invalid.rules, null, `explicit ${JSON.stringify(option)} is not an omitted option`);
    assert.equal(invalid.skipped.length, 1);
  }
  const f = fixture(t);
  const pack = path.join(f.dir, 'forge-default');
  fs.mkdirSync(pack);
  fs.writeFileSync(path.join(pack, 'pack.json'), JSON.stringify({
    id: 'forge-default', name: 'Default', version: '1.0.0', behaviour: [{ switch: 'unequip' }],
  }));
  const result = await importForge(pack, { root: ROOT, pluginsDir: path.join(f.dir, 'plugins'), dryRun: true });
  assert.equal(result.ok, true);
  assert.deepEqual(result.report.products[0].rules, { unequip: 'official' });
  f.put('declared-default', { permissions: [], rules: result.report.products[0].rules });
  f.put('allow', { permissions: [], rules: { unequip: 'allow' } });
  const conflict = buildContentSet({ registry: f.registry, ids: ['declared-default', 'allow'] });
  assert.ok(conflict.problems.some((p) => p.code === 'PLUGIN_RULE_CONFLICT'));
  const declared = buildContentSet({ registry: f.registry, ids: ['declared-default'] });
  assert.deepEqual(declared.index.rules, { unequip: 'official' });
});

test('the content hash grows a rules key only when one is passed', () => {
  const parts = { app: '0.3.1', sim: 'aa', data: { chess: 'bb' } };
  const plain = hashInput(parts);
  assert.equal(Object.hasOwn(plain, 'rules'), false);
  const withRules = hashInput({ ...parts, rules: { unequip: 'allow' } });
  assert.deepEqual(withRules.rules, { unequip: 'allow' });
  assert.notEqual(JSON.stringify(plain), JSON.stringify(withRules));
});

test('rules-only manifests load, hash and compose through the room summary and browser verification', async (t) => {
  const f = fixture(t);
  f.put('alpha', { permissions: [], rules: { unequip: 'allow' } });
  f.put('beta', { permissions: [], rules: { unequip: 'allow' } });
  const plugin = f.registry.plugin('alpha');
  assert.ok(plugin?.content, 'registry recognises rules-only content');
  const before = plugin.content.hash;
  const plain = buildContentSet({ registry: f.registry });
  assert.equal(Object.hasOwn(plain.index, 'rules'), false);
  const set = buildContentSet({ registry: f.registry, ids: ['alpha', 'beta'] });
  assert.deepEqual(set.rules, { unequip: 'allow' });
  assert.equal(set.vanilla, false);
  const files = contentSetFiles(set);
  for (const [rel, file] of files) if (rel.startsWith('data/')) assert.deepEqual(file.body, fs.readFileSync(path.join(ROOT, rel)), 'rules leave data bytes unchanged');
  const fetch = async (url) => {
    const u = new URL(url, 'https://test.invalid');
    const file = u.pathname.startsWith('/cs/') ? files.get(u.pathname.split('/').slice(3).join('/'))?.body
      : fs.readFileSync(path.join(ROOT, u.pathname.slice(1)));
    return { ok: true, status: 200, arrayBuffer: async () => file };
  };
  const loaded = await loadContentSet(set.cs, { fetch });
  assert.equal(loaded.cs, set.cs, 'browser includes rules when verifying the identity');
  const contents = createContentSets({ registry: f.registry });
  const rooms = createRoomSets({ registry: f.registry, contents });
  const room = rooms.resolve(['alpha', 'beta']);
  assert.equal(room.ok, true, JSON.stringify(room));
  assert.deepEqual(room.set.rules, set.rules);
  f.put('beta', { permissions: [], rules: { unequip: 'official' } });
  const conflict = rooms.resolve(['alpha', 'beta']);
  assert.equal(conflict.error, 'PLUGIN_RULE_CONFLICT');
  for (const name of ['alpha', 'beta', 'unequip']) assert.ok(conflict.detail.includes(name));
  f.put('alpha', { permissions: [], rules: { unequip: 'official' } });
  assert.notEqual(f.registry.plugin('alpha').content.hash, before, 'the declaration enters the plugin hash');
  assert.notEqual(buildContentSet({ registry: f.registry, ids: ['alpha'] }).cs, set.cs);
});

test('shopBias filters within the drawn tier, respects stock, and falls back in that same tier', () => {
  const records = { other: { giveBondId: 'other' }, hit: { giveBondId: 'active' }, higher: { giveBondId: 'active' } };
  const pool = new SharedPool({ visibleChess: [], shopItemsByTier: { 1: ['other', 'hit'], 2: ['higher'] }, item: (id) => records[id] });
  pool.entries.set('one', { tier: 1, cap: 9, left: 9 });
  pool.entries.set('two', { tier: 2, cap: 1, left: 1 });
  const bias = new Set(['active']);
  const rng = () => 0;
  assert.equal(pool.rollItem(rng, 2, null), 'other');
  assert.equal(pool.rollItem(rng, 2, null, bias), 'hit');
  const stock = { canGain: (id) => id !== 'hit', pick: (_rng, ids) => ids[0] };
  assert.equal(pool.rollItem(rng, 2, stock, bias), 'other', 'exhausted hit falls back in tier 1, never to tier 2');
  assert.equal(pool.entries.get('one').left, 9, 'rolling never grants or reserves stock');
  assert.equal(pool.rollItem(rng, 2, null, new Set()), 'other');
});

test('the published editor schema mirrors the one rule table', () => {
  const schema = JSON.parse(fs.readFileSync(path.join(ROOT, 'schemas/plugin.schema.json'), 'utf8'));
  assert.equal(schema.properties.rules.additionalProperties, false);
  assert.deepEqual(Object.keys(schema.properties.rules.properties), RULE_NAMES);
  for (const name of RULE_NAMES) assert.deepEqual(schema.properties.rules.properties[name].enum, RULE_SWITCHES[name].options);
});

test('the isolated match host takes prep rules from the verified content set rather than create options', async (t) => {
  const f = fixture(t);
  f.put('host-rules', { permissions: [], rules: { prepLoadout: 'prep' } });
  const contents = createContentSets({ registry: f.registry, vanillaData: getData() });
  const resolved = contents.resolve(['host-rules']);
  assert.equal(resolved.ok, true, JSON.stringify(resolved));
  const hosts = createMatchHosts({ contents, options: { matchOptions: { botRehearsal: 0, timerScale: 0.001 } } });
  t.after(() => hosts.close());
  let phase;
  const proxy = hosts.create(resolved.set.cs, {
    roomCode: 'RULE', mode: 'solo', difficulty: 'NORMAL', seed: 1, cs: resolved.set.cs, requireCs: true,
    rules: { prepLoadout: 'locked' },
    seats: [{ seat: 0, playerId: 'p_0', name: 'Test', isBot: false, connected: true }],
    send() {}, broadcast: (msg) => { if (msg.t === 'm.public') phase = msg.phase; }, onEnd() {},
  });
  proxy.start();
  const until = async (wanted) => {
    for (let i = 0; i < 1000; i++) {
      if (phase === wanted) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.fail(`host did not reach ${wanted}: ${phase}`);
  };
  await until('INFO_CHECK');
  assert.deepEqual(await proxy.handle('p_0', { t: 'g.infoReady' }), { ok: true });
  await until('BAND_DRAFT');
  assert.deepEqual(await proxy.handle('p_0', { t: 'g.band', bandId: 'band_bldsk' }), { ok: true });
  await until('PREP');
  assert.deepEqual(await proxy.setLoadout('p_0', { chess_char_1_01_a: { skill: 0 } }), { ok: true });
  proxy.dispose();
});

test('granted bonds and the slot policy follow the workshop pairing', () => {
  const morph = { id: 'morph', canGiveBond: true };
  const hammer = { id: 'hammer', giveBondId: 'victoriaShip' };
  const knife = { id: 'knife', giveBondId: 'yanShip' };
  const get = (id) => ({ morph, hammer, knife })[id];
  assert.deepEqual(grantedBondsByMorph(['hammer'], get), []);
  assert.deepEqual(grantedBondsByMorph(['morph', 'hammer'], get), ['victoriaShip']);
  assert.deepEqual(grantedBondsByMorph(['morph', 'hammer', 'knife'], get), ['victoriaShip', 'yanShip']);
  assert.deepEqual(grantedBondsByMorph(['morph', 'hammer', 'knife'], get, { mode: 'plus' }), ['victoriaShip']);
  assert.deepEqual(grantedBondsByMorph(['hammer'], get, { mode: 'plus' }), []);
  assert.equal(morphSlotPolicy('official'), OFFICIAL_SLOT_POLICY);
  assert.equal(morphSlotPolicy('locked'), OFFICIAL_SLOT_POLICY);
  const plus = morphSlotPolicy('plus', (it) => it === morph || it?.canGiveBond);
  assert.equal(plus.slotsUsed([hammer, morph, knife]), 2);
  assert.equal(plus.occupies(morph), false);
  assert.equal(plus.accepts([morph], morph), false);
  assert.equal(plus.accepts([hammer], morph), true);
  assert.equal(plus.replacedIndex([morph, hammer, knife], null), 1);
  assert.equal(plus.replacedIndex([morph, hammer, knife], 'nope'), 1);
  assert.equal(OFFICIAL_SLOT_POLICY.replacedIndex([hammer, knife], null), 0);
});

test('Forge behaviour becomes rules; an unknown switch is skipped', async () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-rules-forge-'));
  const vanilla = readVanillaAssets(path.join(ROOT, 'data'));
  const opts = { pluginsDir: path.join(parent, 'plugins'), root: ROOT, dataDir: path.join(ROOT, 'data'), vanilla, dryRun: true };
  const write = (id, pack) => {
    const dir = path.join(parent, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({ id, name: id, version: '1.0.0', ...pack }));
    return dir;
  };
  try {
    const got = await importForge(write('rose-unequip', {
      combat: true,
      behaviour: [{ switch: 'unequip', option: 'allow' }, { switch: 'unequip', option: 'allow' }],
    }), opts);
    assert.equal(got.ok, true, JSON.stringify(got.issues || got.report?.check));
    assert.equal(got.report.products.length, 1);
    assert.equal(got.report.products[0].class, 'content');
    assert.deepEqual(got.report.products[0].rules, { unequip: 'allow' });
    assert.deepEqual(got.report.products[0].permissions, []);
    assert.equal(got.report.products[0].imported.some((line) => String(line).includes('data.patch')), false);
    assert.equal(got.report.skipped.some((s) => s.path === 'pack.json:combat'), false);
    const unknown = await importForge(write('rose-unknown', {
      behaviour: [{ switch: 'coreFirst', option: 'on' }],
    }), opts);
    assert.equal(unknown.ok, true, JSON.stringify(unknown.issues));
    assert.equal(unknown.wrote, false);
    assert.equal(unknown.report.products.length, 0);
    assert.ok(unknown.report.skipped.some((s) => /coreFirst|Unknown switch/.test(`${s.en} ${s.zh}`)));
    const invalid = readForgeBehaviour([{ switch: 'unequip', option: 'bad' }, null]);
    assert.equal(invalid.rules, null);
    assert.equal(invalid.skipped.length, 2);
    const implied = await importForge(write('rose-prep', { behaviour: [{ switch: 'prepLoadout', option: 'prep' }] }), opts);
    assert.equal(implied.ok, true);
    assert.deepEqual(implied.report.products[0].rules, { prepLoadout: 'prep' }, 'combat true is implied');
    const dup = readForgeBehaviour([
      { switch: 'unequip', option: 'allow' },
      { switch: 'unequip', option: 'official' },
      { switch: 'nope', option: 'x' },
    ]);
    assert.deepEqual(dup.rules, { unequip: 'allow' });
    assert.equal(dup.skipped.length, 2);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
