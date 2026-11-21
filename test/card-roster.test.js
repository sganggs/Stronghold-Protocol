// test/card-roster.test.js — the cross-period 名片干员 roster (DESIGN §37.325, #877): shared/cardRoster.js (cardEntries,
// buildCardRoster, serializeCardRoster, parseCardRoster), tools/build-card-roster.mjs (readCardSources, writeCardRoster,
// the CLI and its --check) and the committed data/card-roster.json: current with every version's data, each period's
// candidates exactly, the art each row needs, the elite rule, no hidden preset or stand-in body, and tools/build-data.mjs
// rebuilding it after it writes a version's default output directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { CARD_PERIOD_ORDER, CARD_ROSTER, CARD_ROSTER_FORMAT, buildCardRoster, cardEntries, cardPoolIds, isCardChess, parseCardRoster,
  serializeCardRoster } from '../shared/cardRoster.js';
import { readCardSources, writeCardRoster } from '../tools/build-card-roster.mjs';
import { VERSIONS } from '../shared/versions.js';
import { isCharId } from '../shared/protocol.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'data', `${CARD_ROSTER}.json`);
const TOOL = join(ROOT, 'tools', 'build-card-roster.mjs');
const HOW = 'data/card-roster.json is stale: run npm run build:roster';
const readRoster = () => JSON.parse(readFileSync(FILE, 'utf8'));

/** Every version's sources, read once (≈ 18 MB of JSON). */
let sourcesP = null;
const sources = () => (sourcesP ??= readCardSources());

/** The card whitelist before the roster (server/lobby.js cardCharIds until §37.325): visible non-自选 chess ∪ the 自选 pool. */
function oldRule(chess, backups) {
  const ids = new Set();
  for (const c of Object.values(chess)) if (c && !c.isDiy && c.visible !== false && typeof c.charId === 'string') ids.add(c.charId);
  for (const id of backups?.diy?.ownedPool || []) if (typeof id === 'string' && id) ids.add(id);
  return ids;
}

test('data/card-roster.json is what the version data gives, byte for byte (else: npm run build:roster)', async () => {
  const text = serializeCardRoster(buildCardRoster(await sources()));
  assert.ok(readFileSync(FILE).equals(Buffer.from(text, 'utf8')), HOW);
  assert.ok(text.endsWith('\n]}\n'));
  // one operator per line: a stable diff
  const roster = readRoster();
  assert.equal(text.split('\n').filter((l) => l.startsWith('{"charId"')).length, roster.operators.length);
  assert.deepEqual(roster.operators.map((o) => o.charId), [...roster.operators.map((o) => o.charId)].sort(), 'sorted by charId');
  assert.deepEqual(roster.periods, CARD_PERIOD_ORDER);
  assert.equal(roster.format, CARD_ROSTER_FORMAT);
});

test('each period\'s rows are exactly its card candidates (187 / 182 / 167 / 166 / 200), 250 in all', async () => {
  const roster = readRoster();
  const counts = {};
  for (const src of await sources()) {
    const want = [...cardEntries(src.chess, src.backups).keys()].sort();
    const got = roster.operators.filter((o) => o.periods.includes(src.id)).map((o) => o.charId).sort();
    assert.deepEqual(got, want, src.id);
    counts[src.id] = got.length;
  }
  assert.deepEqual(counts, { act2autochess: 187, 'act2autochess@V2_1': 182, act1autochess: 167, 'act1autochess@V1_1': 166, 'act3autochess@V3_1': 200 });
  assert.equal(roster.operators.length, 250);
  assert.equal(parseCardRoster(roster).ids.size, 250, 'every committed row parses');
  assert.ok(roster.operators.every((o) => isCharId(o.charId)), 'every row passes room.card\'s wire check (shared/protocol.js isCharId)');
});

test('CARD_PERIOD_ORDER is a permutation of the registry\'s ids (shared/versions.js VERSIONS)', () => {
  assert.deepEqual([...CARD_PERIOD_ORDER].sort(), VERSIONS.map((v) => v.id).sort());
  assert.equal(new Set(CARD_PERIOD_ORDER).size, CARD_PERIOD_ORDER.length);
  assert.ok(Object.isFrozen(CARD_PERIOD_ORDER));
});

test('every row has its art in data/assets.json: avatar and portrait, and the E2 pair for an elite row', () => {
  const chars = JSON.parse(readFileSync(join(ROOT, 'data', 'assets.json'), 'utf8')).chars;
  for (const o of readRoster().operators) {
    const a = chars[o.charId];
    assert.ok(a?.avatar && a?.portrait, `${o.charId} avatar / portrait`);
    if (o.golden) assert.ok(a.avatarE2 && a.portraitE2, `${o.charId} avatarE2 / portraitE2`);
  }
});

test('buildCardRoster: a name, rarity or appellation that differs between periods throws; an unknown or repeated period too', () => {
  const chess = (over = {}) => ({ c_a: { charId: 'char_1_test', name: '测试', appellation: 'Test', rarity: 5, visible: true, ...over } });
  const src = (id, over) => ({ id, chess: chess(over), backups: { diy: { ownedPool: [] } } });
  const ok = buildCardRoster([src('act2autochess'), src('act1autochess')]);
  assert.deepEqual(ok.operators, [{ charId: 'char_1_test', name: '测试', appellation: 'Test', rarity: 5, golden: false, periods: ['act1autochess', 'act2autochess'] }]);
  assert.deepEqual(ok.periods, ['act1autochess', 'act2autochess'], 'in time order, whatever the order given');
  assert.throws(() => buildCardRoster([src('act1autochess'), src('act2autochess', { name: '别名' })]), /char_1_test name differs/);
  assert.throws(() => buildCardRoster([src('act1autochess'), src('act2autochess', { rarity: 6 })]), /char_1_test rarity differs/);
  assert.throws(() => buildCardRoster([src('act1autochess'), src('act2autochess', { appellation: 'Other' })]), /char_1_test appellation differs/);
  assert.throws(() => buildCardRoster([src('act9autochess')]), /unknown period/);
  assert.throws(() => buildCardRoster([src('act1autochess'), src('act1autochess')]), /twice/);
  assert.throws(() => buildCardRoster([src('act1autochess', { rarity: 0 })]), /rarity/);
  assert.throws(() => buildCardRoster([src('act1autochess', { name: '' })]), /name/);
});

test('the elite rule: 蜜蜡 (第二期上半 only, an elite record) is golden; 凯尔希 (自选 in every period) is not', () => {
  const rows = new Map(readRoster().operators.map((o) => [o.charId, o]));
  assert.deepEqual([rows.get('char_344_beewax').golden, rows.get('char_344_beewax').periods], [true, ['act2autochess@V2_1']]);
  assert.deepEqual([rows.get('char_003_kalts').golden, rows.get('char_003_kalts').periods], [false, [...CARD_PERIOD_ORDER]]);
  assert.equal(rows.get('char_003_kalts').appellation, 'Kal\'tsit', 'a 自选-only row has its appellation (backups.units)');
  const counts = { golden: 0, plain: 0 };
  for (const o of rows.values()) counts[o.golden ? 'golden' : 'plain']++;
  assert.deepEqual(counts, { golden: 217, plain: 33 });
});

test('no hidden preset and no stand-in body: char_616_pithst and char_600_cpione are in no period', () => {
  const ids = parseCardRoster(readRoster()).ids;
  for (const id of ['char_616_pithst', 'char_600_cpione', 'char_999_nobody']) assert.equal(ids.has(id), false, id);
});

test('parseCardRoster: a bad row is dropped, another format or a non-object is null, the same object gives the same result', () => {
  const row = (over = {}) => ({ charId: 'char_1_good', name: '好', appellation: 'Good', rarity: 3, golden: false, periods: ['act2autochess'], ...over });
  const json = {
    format: 1, periods: ['act2autochess', 'act9autochess'],
    operators: [
      row(),
      row({ charId: 'chess_char_1_01_a' }), row({ charId: 'char_x_plugin_op' }), row({ charId: 'char_2_r0', rarity: 0 }), row({ charId: 'char_3_r7', rarity: 7 }),
      row({ charId: 'char_4_r15', rarity: 1.5 }), row({ charId: 'char_5_period', periods: ['act9autochess'] }),
      row({ charId: 'char_6_noname', name: '' }), row({ charId: 'char_7_none', periods: [] }), row({ charId: 'char_8_gold', golden: 1 }),
      row({ charId: 'char_9_twice', periods: ['act1autochess', 'act1autochess'] }), row({ name: '重复' }), null, 'char_10_x',
      row({ charId: 'char_11_noapp', appellation: undefined }),
    ],
  };
  const r = parseCardRoster(json);
  assert.deepEqual([...r.ids], ['char_1_good', 'char_11_noapp']);
  assert.equal(r.byChar.get('char_1_good').name, '好', 'the first row of a charId wins');
  assert.equal(r.byChar.get('char_11_noapp').appellation, '');
  assert.deepEqual(r.periods, ['act2autochess'], 'unknown periods left out');
  assert.equal(parseCardRoster(json), r, 'cached per object');
  for (const bad of [{ ...json, format: 2 }, { format: 1 }, null, undefined, 'x', 7, [json]]) assert.equal(parseCardRoster(bad), null, JSON.stringify(bad)?.slice(0, 40));
});

test('cardEntries keeps the old whitelist (visible non-自选 chess ∪ the 自选 pool) on every version\'s data', async () => {
  for (const src of await sources()) {
    assert.deepEqual(new Set(cardEntries(src.chess, src.backups).keys()), oldRule(src.chess, src.backups), src.id);
    assert.ok(cardPoolIds(src.backups).length > 0, `${src.id} has a 自选 pool`);
  }
  assert.equal(isCardChess({ charId: 'char_1_x', isDiy: true }), false);
  assert.equal(isCardChess({ charId: 'char_1_x', visible: false }), false);
  assert.equal(isCardChess({ charId: 'char_1_x' }), true);
  assert.deepEqual(cardPoolIds({ diy: { ownedPool: ['char_1_a', '', 7, null] } }), ['char_1_a']);
  assert.deepEqual(cardPoolIds(null), []);
  assert.equal(cardEntries(null, null).size, 0);
  // a pool operator: name and rarity from diy.operators (else units), the appellation from units, never golden
  const e = cardEntries({}, { units: { char_1_a: { name: 'U', rarity: 4, appellation: 'Ua' }, char_2_b: { name: 'V', rarity: 3 } },
    diy: { ownedPool: ['char_1_a', 'char_2_b'], operators: { char_1_a: { name: 'D', rarity: 6 } } } });
  assert.deepEqual(Object.fromEntries(e), { char_1_a: { name: 'D', appellation: 'Ua', rarity: 6, golden: false }, char_2_b: { name: 'V', appellation: '', rarity: 3, golden: false } });
  // a chess operator: the elite record's fields when there is one
  const g = cardEntries({ a: { charId: 'char_1_a', name: 'A', rarity: 5, isGolden: false }, b: { charId: 'char_1_a', name: 'A', rarity: 5, isGolden: true } }, null);
  assert.equal(g.get('char_1_a').golden, true);
});

test('tools/build-data.mjs rebuilds the roster after it wrote a version\'s default output directory', () => {
  const src = readFileSync(join(ROOT, 'tools', 'build-data.mjs'), 'utf8');
  assert.match(src, /import \{ writeCardRoster \} from '\.\/build-card-roster\.mjs';/);
  assert.match(src, /if \(resolve\(OPTS\.out\) === resolve\(join\(ROOT, 'data', VERSION\.dir\)\)\) \{\s*try \{\s*const r = await writeCardRoster\(\{ dataDir: join\(ROOT, 'data'\) \}\);/);
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['build:roster'], 'node tools/build-card-roster.mjs');
});

test('the CLI: writes, --check passes on a current file and fails (exit 1, the npm script named) on a stale or missing one', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'sp-card-roster-'));
  try {
    // a data directory of one made-up operator per version
    for (const v of VERSIONS) {
      const d = join(dir, ...v.dir.split('/').filter(Boolean));
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'chess.json'), JSON.stringify({ a: { charId: 'char_1_test', name: '测试', appellation: 'Test', rarity: 4, visible: true } }));
      writeFileSync(join(d, 'backups.json'), JSON.stringify({ units: {}, diy: { ownedPool: [] } }));
    }
    const run = (...args) => spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', timeout: 60_000 });
    const missing = run('--check', '--data', dir);
    assert.equal(missing.status, 1, missing.stderr);
    assert.match(missing.stderr, /missing: run npm run build:roster/);
    const wrote = run('--data', dir);
    assert.equal(wrote.status, 0, wrote.stderr);
    assert.match(wrote.stdout, /1 operators/);
    const text = readFileSync(join(dir, 'card-roster.json'), 'utf8');
    assert.equal(parseCardRoster(JSON.parse(text)).byChar.get('char_1_test').periods.length, VERSIONS.length);
    assert.equal(run('--check', `--data=${dir}`).status, 0);
    writeFileSync(join(dir, 'card-roster.json'), text.replace('测试', '别名'));
    const stale = run('--check', '--data', dir);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /stale .*run npm run build:roster/);
    // the API answers the same
    await assert.rejects(writeCardRoster({ dataDir: dir, check: true }), /stale/);
    assert.equal((await writeCardRoster({ dataDir: dir })).operators, 1);
    assert.equal(readFileSync(join(dir, 'card-roster.json'), 'utf8'), text);
    // a missing version file names it; an unknown option exits 2
    rmSync(join(dir, 'versions', 'act1autochess', 'backups.json'));
    const broken = run('--data', dir);
    assert.equal(broken.status, 1);
    assert.match(broken.stderr, /cannot read .*act1autochess/);
    const bad = run('--nope');
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /usage:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the committed file passes the CLI\'s --check', () => {
  const r = spawnSync(process.execPath, [TOOL, '--check'], { encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /checked data\/card-roster\.json: 250 operators/);
});
