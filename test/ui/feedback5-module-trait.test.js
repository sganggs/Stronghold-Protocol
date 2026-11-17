// Community report of 2026-10-06, item 16.2: 「干员调配界面很多干员的某个模组只有额外特性没有基础特性，不清楚是文本错误还是
// 实际效果也有错」. A module's trait part either rewrites the class trait (official `overrideDescripton`) or adds a line
// after it (official `additionalDescription`, PRTS 「特性追加」). The data keeps both (`traitOverride.desc` = the class trait
// or its rewrite, `moduleDesc` = the added line) and the sim keeps the class trait with the module on; the text was wrong:
// the 干员调配 module card, its 局内数值, the detail card and the 自选 module row showed the added line alone (114 of the
// 164 modules the screen offers). Now the class trait comes first and the added line after it (the module card labels it 特性追加).
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

const { traitLines, fullTraitText } = await import('../../public/js/ui/loadoutModel.js');
const { traitText } = await import('../../public/js/ui/detailPanel.js');
const { ModuleInfo } = await import('../../public/js/screens/loadout.js');
const { DiyPickerView } = await import('../../public/js/screens/diy.js');
const { chessLoadout } = await import('../../public/js/ui/gameLogic.js');
const { getDefaultSource } = await import('../../server/sim/simdata.js');
const { resolveProfile } = await import('../../server/sim/professions.js');
const { data } = await import('../../public/js/data.js');
const { KITTED_CHARS } = await import('../../server/sim/content/kits/index.js');
await data.loadAll('chess', 'bonds', 'assets', 'garrisons', 'items', 'backups');

const CHESS = JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8'));
const get = (id) => CHESS[id] ?? null;
const elites = Object.values(CHESS).filter((c) => c.visible !== false && c.isGolden && Array.isArray(c.modules));
const modules = elites.flatMap((g) => g.modules.map((m) => ({ g, m })));
const added = modules.filter(({ m }) => m.traitOverride?.moduleDesc);

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  return typeof v === 'object' ? textOf(v.props?.children) : '';
};
const richText = (v) => String([...walk(v)].find((n) => typeof n.type === 'function' && n.type.name === 'RichText')?.props.text ?? '');
/** The module card's rows: { k, text, kind } (kind = data-trait). */
const cardRows = (tree) => [...walk(tree)].filter((n) => hasClass(n, 'lo-minfo__row')).map((row) => ({
  k: textOf([...walk(row)].find((n) => hasClass(n, 'lo-minfo__k'))), text: richText(row), kind: row.props['data-trait'] ?? null,
}));

test('the data: 164 elite modules offered, 114 of them add a line after the class trait (the report\'s "only the extra trait")', () => {
  assert.ok(modules.length >= 160, `${modules.length} elite module records`);
  assert.ok(added.length >= 110, `${added.length} modules with an added line`);
  for (const { g, m } of added) {
    // the record keeps the class trait (or the module's rewrite of it) beside the added line
    assert.ok(m.traitOverride.desc && m.traitOverride.desc !== m.traitOverride.moduleDesc, `${g.chessId} ${m.uniEquipId}`);
  }
  // 隐现's MAR-X: the official candidate is additionalDescription only, so the class trait stays
  const inside = get('chess_char_1_01_b').modules.find((m) => m.typeName === 'MAR-X');
  assert.equal(inside.traitOverride.desc, '优先攻击空中单位');
  assert.equal(inside.traitOverride.moduleDesc, '攻击空中单位时攻击力提升至110%');
});

test('traitLines / fullTraitText: the class trait, then the added line; a rewrite or a plain trait is one line', () => {
  assert.deepEqual(traitLines({ desc: 'A', descRaw: '<@ba.kw>A</>', moduleDesc: 'B', moduleDescRaw: '<@ba.kw>B</>' }), { base: '<@ba.kw>A</>', added: '<@ba.kw>B</>' });
  assert.equal(fullTraitText({ desc: 'A', moduleDesc: 'B' }), 'A\nB');
  assert.equal(fullTraitText({ desc: 'A' }), 'A');
  assert.equal(fullTraitText({ moduleDesc: 'B' }), 'B');
  assert.equal(fullTraitText(null), '');
  assert.deepEqual(traitLines(undefined), { base: '', added: null });
});

test('局内数值 and the detail card (traitText): every added-line module shows the class trait first, then its line', () => {
  for (const { g, m } of added) {
    const lo = { [g.baseId]: { module: m.uniEquipId } };
    const shown = traitText(g, true, chessLoadout(g, lo, get));
    const t = m.traitOverride;
    assert.equal(shown, `${t.descRaw || t.desc}\n${t.moduleDescRaw || t.moduleDesc}`, `${g.chessId} ${m.typeName}`);
  }
  // 不装备 keeps the bare class trait; a normal chess its own
  const g = get('chess_char_1_01_b');
  assert.equal(traitText(g, true, chessLoadout(g, { [g.baseId]: { module: 'none' } }, get)), g.traitBase.descRaw);
  assert.equal(traitText(get('chess_char_1_01_a'), false, null), get('chess_char_1_01_a').trait.descRaw);
});

test('the 干员调配 module card: 特性 = the class trait (or the rewrite), 特性追加 = the added line', () => {
  for (const { g, m } of modules) {
    const rows = cardRows(ModuleInfo({ m: null, golden: g, opt: { id: m.uniEquipId, rec: m, isDefault: m.isDefault } }));
    const t = m.traitOverride;
    const trait = rows.filter((r) => r.kind);
    if (t?.moduleDesc) {
      assert.deepEqual(trait.map((r) => [r.k, r.text]), [['特性', t.descRaw || t.desc], ['特性追加', t.moduleDescRaw || t.moduleDesc]], `${g.chessId} ${m.typeName}`);
    } else {
      assert.deepEqual(trait.map((r) => [r.k, r.text]), [['特性', t.descRaw || t.desc]], `${g.chessId} ${m.typeName}: a rewrite is one line`);
    }
  }
});

test('the 自选 picker\'s module card: the class trait, then the module\'s line (the roster\'s ModuleInfo)', () => {
  const pick = { charId: 'char_112_siege', skillIndex: 2, uniEquipId: 'uniequip_002_siege' };
  const slot = { slotId: 'chess_char_5_diy1_a', tier: 5, shopLevel: 5 };
  const tree = DiyPickerView({ m: null, slot, picks: { [slot.slotId]: pick }, kitted: [...KITTED_CHARS], onDone() {}, onClose() {},
    filter: 'all', query: '', draft: { ...pick }, onFilter() {}, onQuery() {}, onDraft() {} });
  const expand = (v, d = 6) => {
    if (Array.isArray(v)) return v.map((x) => expand(x, d));
    if (!v || typeof v !== 'object') return v;
    if (typeof v.type === 'function' && v.type.name !== 'RichText' && d > 0) { try { return expand(v.type(v.props || {}), d - 1); } catch { return v; } }
    const c = v.props?.children;
    return c === undefined ? v : { ...v, props: { ...v.props, children: expand(c, d) } };
  };
  // the picker draws the roster's ModuleInfo card (screens/loadoutSections.js): the rows are the same ones the 干员调配
  // module card asserts — 特性 first, the module's own line under 特性追加, never the added line alone
  const rows = cardRows(expand(tree));
  const mods = Object.values(data.get('backups').units.char_112_siege.forms).flatMap((f) => f.modules || []);
  const trait = mods.find((x) => x.uniEquipId === 'uniequip_002_siege').traitOverride;
  const base = rows.find((r) => r.kind === 'base');
  assert.ok(base && base.k === '特性', 'the class trait (or the module\'s rewrite) has its own row');
  assert.equal(base.text, trait.descRaw || trait.desc);
  const added = rows.find((r) => r.kind === 'added');
  if (trait.moduleDesc) {
    assert.ok(added && added.k === '特性追加', 'the module\'s own line follows under 特性追加');
    assert.equal(added.text, trait.moduleDescRaw || trait.moduleDesc);
  } else assert.equal(added, undefined, 'a module without an added line has none');
});

test('the sim: an added-line module keeps the class trait (the same text, targeting and attack shape as 不装备)', () => {
  const ds = getDefaultSource();
  const keys = ['trait', 'targetPriority', 'attackKind', 'dmgType', 'canHitFly', 'splashRadius'];
  const prof = ['attack', 'dmgType', 'canHitFly', 'maxTargets', 'hitAllBlocked', 'allInRange', 'priority', 'noAttack', 'noHeal', 'blockFly'];
  let same = 0;
  for (const { g, m } of added) {
    const a = ds.getChess(g.chessId, { moduleId: m.uniEquipId });
    const b = ds.getChess(g.chessId, { moduleId: 'none' });
    assert.equal(a.trait, m.traitOverride.desc, `${g.chessId} ${m.typeName}: the battle's trait text = the card's`);
    if (m.traitOverride.desc !== g.traitBase.desc) continue; // 圣约送葬人 REA-Y rewrites the class trait too
    const pa = resolveProfile(a), pb = resolveProfile(b);
    for (const k of keys) assert.deepEqual(a[k], b[k], `${g.chessId} ${m.typeName} ${k}`);
    for (const k of prof) assert.deepEqual(pa[k], pb[k], `${g.chessId} ${m.typeName} profile.${k}`);
    for (const k of Object.keys(b.traitBb || {})) assert.ok(k in a.traitBb, `${g.chessId} ${m.typeName}: keeps trait bb ${k}`);
    same++;
  }
  assert.ok(same >= 110, `${same} added-line modules keep the class trait in battle`);
});
