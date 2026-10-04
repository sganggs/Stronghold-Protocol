// GitHub issue #64 — 干员调配 showed only the skill and module sections: no stats, no 攻击范围 (the in-match detail card has
// them). The screen's 局内数值 section now draws the detail card's own stats block (ui/detailPanel.js chessStatsBlock),
// plus 特性 and 天赋, for the selected chess under its chosen skill and module — the 精锐 record by default (the module only
// exists there), the 普通 one on the toggle. Everything comes from gameLogic.chessLoadout → shared/loadoutRecord.js, the
// composition the sim fights with; nothing is recomputed in the screen. These tests: the pure part (statsPreview), the
// rendered section against the card for the same loadout, the 特性 / 天赋 rows, the toggle, the section's place in the
// detail, and the css floors that keep it readable on a phone. (The browser side: test/ui/loadout.e2e.test.js.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

// the browser data store reads the real data files from disk (the card renders below)
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { statsPreview, LoadoutStats } = await import('../../public/js/screens/loadout.js');
const { ChessDetail, cardRangeGrid } = await import('../../public/js/ui/detailPanel.js');
const { fmtNum, attackInterval } = await import('../../public/js/ui/gameLogic.js');
const { data } = await import('../../public/js/data.js');
await data.loadAll('chess', 'garrisons', 'assets', 'bonds', 'items');

const get = (id) => data.lookup('chess', id);
const INSIDE = 'chess_char_1_01_a'; // 隐现: MAR-X (+80 生命上限 / +22 攻击) or 不装备; S1 / S2
const MIXER = 'chess_char_4_01_a'; // 信仰搅拌机: SPT-X (default) / SPT-Y "攻击距离+1"
const MOSTIMA = 'chess_char_4_02_a'; // 莫斯提马: SPC-Y (default) / SPC-X (a wider range grid)
const THORN = 'chess_char_5_15_a'; // 引星棘刺: S3 "被动效果：攻击范围扩大"
const PASSENGER = 'chess_char_6_05_a'; // 异客: SPC-X-style module that rewrites her talents
const PASSENGER_ALT = 'uniequip_003_pasngr';

const EXPAND = new Set(['Stat', 'LiveTag', 'RangeGrid']);
/** Every vnode of a preact tree (htm output), depth first; the hook-free components of EXPAND are rendered in place. */
function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && EXPAND.has(v.type.name)) { yield* walk(v.type(v.props)); return; }
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  if (typeof v === 'object' && typeof v.type === 'function' && EXPAND.has(v.type.name)) return textOf(v.type(v.props));
  return typeof v === 'object' ? textOf(v.props?.children) : '';
};
/** The eight stat cells of a tree: label → shown value. */
const statValues = (tree) => Object.fromEntries([...walk(tree)].filter((n) => hasClass(n, 'dstat')).map((cell) => {
  const parts = [...walk(cell)];
  return [textOf(parts.find((n) => hasClass(n, 'dstat__k'))), textOf(parts.find((n) => hasClass(n, 'dstat__v')))];
}));
const onCells = (tree) => [...walk(tree)].filter((n) => n.type === 'i' && hasClass(n, 'on')).length;
const statsBlock = (tree) => [...walk(tree)].find((n) => hasClass(n, 'dstats-wrap'));
/** The 特性 / 天赋 rows of the section: { k, name, text }. */
const kitRows = (tree) => [...walk(tree)].filter((n) => hasClass(n, 'lo-minfo__row')).map((row) => {
  const parts = [...walk(row)];
  return {
    k: textOf(parts.find((n) => hasClass(n, 'lo-minfo__k'))),
    name: textOf(parts.find((n) => hasClass(n, 'lo-minfo__tname'))),
    text: String(parts.find((n) => typeof n.type === 'function' && n.type.name === 'RichText')?.props.text ?? ''),
  };
});

const slot = (id) => { const base = get(id); return { base, golden: base.goldenId ? get(base.goldenId) : null }; };
const preview = (id, level, entries = {}) => { const { base, golden } = slot(id); return statsPreview(base, golden, entries, level, get); };
const section = (id, level, entries = {}, extra = {}) => { const { base, golden } = slot(id); return LoadoutStats({ base, golden, entries, level, onLevel() {}, getChess: get, ...extra }); };
/** The tiles of the 攻击范围 the card / section draws for a preview. */
const rangeTiles = (pv) => cardRangeGrid(null, pv.record, pv.chess).length;

test('statsPreview: the 精锐 record under the chosen module (stats = base + the module\'s attr; 不装备 = the base stats), 普通 never has a module', () => {
  const { base, golden } = slot(INSIDE);
  const mod = golden.modules.find((m) => m.isDefault);
  assert.deepEqual(mod.attr, { maxHp: 80, atk: 22 }, 'MAR-X');
  const def = preview(INSIDE, 'elite');
  assert.equal(def.elite, true);
  assert.equal(def.chess, golden);
  assert.equal(def.record, golden, 'the default loadout is the data record itself (the card\'s rule)');
  assert.equal(def.record.stats.maxHp, golden.statsBase.maxHp + 80);
  assert.equal(def.record.stats.atk, golden.statsBase.atk + 22);
  const none = preview(INSIDE, 'elite', { [INSIDE]: { module: 'none' } });
  assert.equal(none.record.stats.maxHp, golden.statsBase.maxHp, '不装备: the no-module stats');
  assert.equal(none.record.stats.atk, golden.statsBase.atk);
  assert.equal(none.lo.module.none, true);
  assert.notEqual(none.record.stats.maxHp, def.record.stats.maxHp, 'switching the module changes what the section shows');
  // 普通: the normal chess, whatever module is stored (modules are the elite's)
  const normal = preview(INSIDE, 'normal', { [INSIDE]: { module: 'none' } });
  assert.equal(normal.elite, false);
  assert.equal(normal.chess, base);
  assert.equal(normal.record.stats.maxHp, base.stats.maxHp);
  assert.equal(normal.lo.module, null, 'no module on a normal chess');
  assert.deepEqual(normal.record.stats, preview(INSIDE, 'normal').record.stats, 'the module choice does not reach it');
  // a skill choice is carried (lo.skillIndex) but does not change a chess's stats
  const s0 = preview(INSIDE, 'elite', { [INSIDE]: { skill: 0 } });
  assert.equal(s0.lo.skillIndex, 0);
  assert.equal(def.lo.skillIndex, 1, 'S2 is the default');
  assert.deepEqual(s0.record.stats, def.record.stats);
  // an entry of another chess, or an option the data does not offer, falls back to the defaults
  assert.equal(preview(INSIDE, 'elite', { [MIXER]: { module: 'none' } }).record, golden);
  assert.equal(preview(INSIDE, 'elite', { [INSIDE]: { module: 'uniequip_999_nope' } }).record, golden);
});

test('statsPreview: no elite record → the normal one; no record → null; the data records are never mutated', () => {
  const { base } = slot(INSIDE);
  const lone = { ...base, goldenId: null };
  const pv = statsPreview(lone, null, {}, 'elite', get);
  assert.equal(pv.elite, false, '精锐 asked for, none to show');
  assert.equal(pv.chess, lone);
  assert.equal(statsPreview(null, null, {}, 'elite', get), null);
  assert.equal(section(INSIDE, 'elite', {}, { base: null, golden: null }), null);
  const before = JSON.stringify([get(INSIDE), get(get(INSIDE).goldenId), get(MIXER), get(get(MIXER).goldenId)]);
  for (const level of ['normal', 'elite']) {
    preview(INSIDE, level, { [INSIDE]: { skill: 0, module: 'none' } });
    preview(MIXER, level, { [MIXER]: { module: 'uniequip_003_rmixer' } });
  }
  assert.equal(JSON.stringify([get(INSIDE), get(get(INSIDE).goldenId), get(MIXER), get(get(MIXER).goldenId)]), before);
});

test('the 攻击范围 follows the chosen module and skill (the sim\'s deployment range): SPT-Y +1, SPC-X wider, 引星棘刺 S3 passive', () => {
  // 信仰搅拌机: SPT-Y's 特性 "攻击距离+1" → one more tile in her row; SPT-X, 不装备 and the normal chess keep 3
  assert.equal(rangeTiles(preview(MIXER, 'elite')), 3);
  assert.equal(rangeTiles(preview(MIXER, 'elite', { [MIXER]: { module: 'uniequip_003_rmixer' } })), 4);
  assert.equal(rangeTiles(preview(MIXER, 'elite', { [MIXER]: { module: 'none' } })), 3);
  assert.equal(rangeTiles(preview(MIXER, 'normal', { [MIXER]: { module: 'uniequip_003_rmixer' } })), 3);
  // 莫斯提马: SPC-X's own range grid (9 → 10 tiles)
  assert.equal(rangeTiles(preview(MOSTIMA, 'elite')), 9);
  assert.equal(rangeTiles(preview(MOSTIMA, 'elite', { [MOSTIMA]: { module: 'uniequip_003_mostma' } })), 10);
  // 引星棘刺: the selected skill S3 "被动效果：攻击范围扩大" is her range while she carries it — at both levels
  const s3 = get(THORN).skills.find((s) => s.index === 2);
  assert.ok(s3.rangeGrid.length > get(THORN).rangeGrid.length && /被动效果：攻击范围扩大/.test(s3.desc));
  for (const level of ['normal', 'elite']) {
    assert.equal(rangeTiles(preview(THORN, level)), get(THORN).rangeGrid.length, `${level}: her own range by default (S2)`);
    assert.equal(rangeTiles(preview(THORN, level, { [THORN]: { skill: 0 } })), get(THORN).rangeGrid.length);
    assert.equal(rangeTiles(preview(THORN, level, { [THORN]: { skill: 2 } })), s3.rangeGrid.length, `${level}: S3's grid`);
  }
});

test('the section draws the detail card\'s own stats block: same eight values and the same range tiles as ChessDetail for that chess and loadout', () => {
  const cases = [
    [INSIDE, 'elite', {}], [INSIDE, 'elite', { [INSIDE]: { module: 'none' } }], [INSIDE, 'elite', { [INSIDE]: { skill: 0 } }], [INSIDE, 'normal', {}],
    [MIXER, 'elite', { [MIXER]: { module: 'uniequip_003_rmixer' } }], [MIXER, 'elite', { [MIXER]: { module: 'none' } }],
    [MOSTIMA, 'elite', { [MOSTIMA]: { module: 'uniequip_003_mostma' } }], [MOSTIMA, 'normal', {}],
    [THORN, 'elite', { [THORN]: { skill: 2 } }], [THORN, 'normal', { [THORN]: { skill: 2 } }],
    [PASSENGER, 'elite', { [PASSENGER]: { module: PASSENGER_ALT } }],
  ];
  for (const [id, level, entries] of cases) {
    const pv = preview(id, level, entries);
    const card = ChessDetail({ chess: pv.chess, piece: null, editable: false, bonds: [], loadout: entries }).find((b) => b.key === 'stats');
    const mine = statsBlock(section(id, level, entries));
    const what = `${id} ${level} ${JSON.stringify(entries)}`;
    assert.ok(card && mine, what);
    assert.equal(textOf(mine), textOf(card), `${what}: the card's numbers`);
    assert.equal(onCells(mine), onCells(card), `${what}: the card's range tiles`);
    assert.equal(onCells(mine), rangeTiles(pv), `${what}: and the loadout record's attackRangeGrid`);
  }
});

test('the eight stats shown are the record\'s: 生命上限 攻击 防御 法术抗性 攻击间隔 阻挡数 部署费用 再部署; no live tag, no colours', () => {
  const { golden } = slot(INSIDE);
  const mod = golden.modules.find((m) => m.isDefault);
  const s = golden.stats;
  const vals = statValues(section(INSIDE, 'elite'));
  assert.deepEqual(Object.keys(vals), ['生命上限', '攻击', '防御', '法术抗性', '攻击间隔', '阻挡数', '部署费用', '再部署']);
  assert.deepEqual(vals, {
    生命上限: fmtNum(golden.statsBase.maxHp + mod.attr.maxHp), 攻击: fmtNum(golden.statsBase.atk + mod.attr.atk), 防御: fmtNum(s.def),
    法术抗性: String(s.res ?? 0), 攻击间隔: `${attackInterval(s.bat, s.aspd).toFixed(2)}s`, 阻挡数: String(s.blockCnt),
    部署费用: String(s.cost), 再部署: `${s.respawnTime}s`,
  });
  // 不装备 → the base numbers; 普通 → the normal chess's (lower) ones
  const none = statValues(section(INSIDE, 'elite', { [INSIDE]: { module: 'none' } }));
  assert.equal(none['生命上限'], fmtNum(golden.statsBase.maxHp));
  assert.equal(none['攻击'], fmtNum(golden.statsBase.atk));
  const normal = statValues(section(INSIDE, 'normal'));
  assert.equal(normal['生命上限'], fmtNum(slot(INSIDE).base.stats.maxHp));
  assert.ok(Number(normal['生命上限'].replace(/,/g, '')) < Number(none['生命上限'].replace(/,/g, '')));
  // the record's numbers, not a live entry: no 实时 / 开战时 tag and no up / down colouring
  const block = statsBlock(section(INSIDE, 'elite'));
  assert.ok(!hasClass(block, 'is-live') && block.props['data-live'] === undefined);
  assert.ok(!/实时|开战时/.test(textOf(block)));
  assert.ok(![...walk(block)].some((n) => hasClass(n, 'is-up') || hasClass(n, 'is-down')));
});

test('特性 and 天赋 follow the chosen module: 隐现\'s trait upgrade is MAR-X\'s only; 异客\'s talents are rewritten by her other module', () => {
  const rows = (id, level, entries) => kitRows(section(id, level, entries));
  const { golden } = slot(INSIDE);
  const traitOf = (rs) => rs.find((r) => r.k === '特性');
  // default module: the module's upgraded trait text; 不装备: the plain class trait
  assert.equal(traitOf(rows(INSIDE, 'elite', {})).text, golden.trait.moduleDescRaw);
  assert.match(traitOf(rows(INSIDE, 'elite', {})).text, /110%/);
  assert.equal(traitOf(rows(INSIDE, 'elite', { [INSIDE]: { module: 'none' } })).text, golden.traitBase.descRaw);
  assert.equal(traitOf(rows(INSIDE, 'normal', {})).text, slot(INSIDE).base.trait.descRaw, '普通: its own trait');
  // 天赋: named and not hidden, the record's list
  const talents = rows(INSIDE, 'elite', {}).filter((r) => r.k === '天赋');
  assert.deepEqual(talents.map((r) => r.name), golden.talents.filter((t) => t.name && !t.hidden).map((t) => t.name));
  assert.ok(talents.every((r) => r.text.length > 0));
  // 异客: the default module keeps 80% / 3 s, her other module rewrites 机理分析 (70% / 4 s) — what the sim gives her
  const talentText = (entries) => rows(PASSENGER, 'elite', entries).filter((r) => r.k === '天赋').map((r) => `${r.name}:${r.text}`).join('\n');
  const dflt = talentText({});
  const alt = talentText({ [PASSENGER]: { module: PASSENGER_ALT } });
  assert.match(dflt, /机理分析:[^\n]*80%/);
  assert.match(alt, /机理分析:[^\n]*70%/);
  assert.notEqual(dflt, alt);
  assert.equal(talentText({ [PASSENGER]: { module: PASSENGER_ALT, skill: 0 } }), alt, 'a skill choice leaves the talents alone');
  // the kit card is the loadout screen's own module-info card style (a mint accent), only when there is something to say
  assert.ok([...walk(section(INSIDE, 'elite'))].some((n) => hasClass(n, 'lo-minfo--kit')));
  const bare = section(INSIDE, 'elite', {}, { base: { ...slot(INSIDE).base, trait: null, talents: [] }, golden: { ...golden, trait: null, talents: [], traitBase: null, statsBase: golden.stats, modules: [] } });
  assert.ok(![...walk(bare)].some((n) => hasClass(n, 'lo-minfo--kit')), 'no trait, no talents: no empty card');
});

test('the 普通 / 精锐 toggle: 精锐 is the shown variant, the tabs say so, 精锐 is disabled for a chess without one, a click asks for the other', () => {
  const tabs = (tree) => [...walk(tree)].filter((n) => n.type === 'button' && n.props.role === 'tab');
  const elite = section(INSIDE, 'elite');
  assert.equal(elite.props['data-variant'], 'elite');
  const [tn, te] = tabs(elite);
  assert.deepEqual([textOf(tn), textOf(te)], ['普通', '精锐']);
  assert.deepEqual([tn.props['aria-selected'], te.props['aria-selected']], ['false', 'true']);
  const normal = section(INSIDE, 'normal');
  assert.equal(normal.props['data-variant'], 'normal');
  assert.deepEqual(tabs(normal).map((t) => t.props['aria-selected']), ['true', 'false']);
  const asked = [];
  const sec = section(INSIDE, 'normal', {}, { onLevel: (l) => asked.push(l) });
  const [bn, be] = tabs(sec);
  be.props.onClick();
  bn.props.onClick();
  assert.deepEqual(asked, ['elite', 'normal']);
  assert.ok(!be.props.disabled && !bn.props.disabled);
  // the caption says what the numbers are: the chosen module's in 精锐; in 普通 that modules live in 精锐
  const cap = (tree) => textOf([...walk(tree)].find((n) => hasClass(n, 'lo-stats__cap')));
  assert.match(cap(elite), /^数值含所选模组；不含技能发动、装备、盟约等局内加成$/);
  assert.match(cap(normal), /^普通干员没有模组，所选模组在「精锐」中生效；不含技能发动/);
  // a chess without an elite record: only 普通 is selectable and shown
  const lone = LoadoutStats({ base: { ...slot(INSIDE).base, goldenId: null }, golden: null, entries: {}, level: 'elite', onLevel() {}, getChess: get });
  assert.equal(lone.props['data-variant'], 'normal');
  assert.equal(tabs(lone)[1].props.disabled, true);
  assert.match(cap(lone), /^不含技能发动、装备、盟约等局内加成$/, 'nothing to point at without an elite');
});

test('place in the detail: after the skills, before the modules; the first .lo-seg stays the skill level toggle (e2e selector)', () => {
  const src = read('public/js/screens/loadout.js');
  const detail = src.slice(src.indexOf('function Detail('), src.indexOf('// ---- filters'));
  const toggle = detail.indexOf("aria-label=${T('技能等级')}");
  const skills = detail.indexOf("aria-label=${T('选择技能')}");
  const stats = detail.indexOf('<${LoadoutStats} base=${chess}');
  const mods = detail.indexOf('<section class="lo-sec lo-sec--mod">');
  assert.ok(toggle > 0 && skills > toggle && stats > skills && mods > stats, 'skills (and their level toggle) → 局内数值 → modules');
  // one record resolution, shared with the card: chessLoadout, the card's block, trait and talent helpers — no stat arithmetic of its own
  assert.match(src, /import \{ chessStatsBlock, traitText, chessTalents \} from '\.\.\/ui\/detailPanel\.js';/);
  assert.match(src, /import \{ chessLoadout \} from '\.\.\/ui\/gameLogic\.js';/);
  const fn = src.slice(src.indexOf('export function statsPreview'), src.indexOf('export function LoadoutStats'));
  assert.ok(!/composeStats|attr\b|maxHp|statsBase/.test(fn), 'no stat arithmetic in the screen');
  // the screen's own state: 精锐 by default, independent of the skill toggle's 普通
  assert.match(src, /const \[statLevel, setStatLevel\] = useState\('elite'\)/);
});

test('css: the section reuses the card\'s .dstats / .drange / .rgrid, sized for the overlay with px floors (readable at 1 rem = 40 px), the range box may wrap under the numbers', () => {
  const css = read('public/css/screens/loadout.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({ sel: m[1].trim(), body: m[2] }));
  const mine = rules.filter((r) => /\.lo-sec--stats|\.lo-stats__cap|\.lo-minfo--kit/.test(r.sel));
  assert.ok(mine.length >= 8, 'the stats rules exist');
  for (const r of mine) for (const m of r.body.matchAll(/font-size:\s*([^;]+);/g)) {
    assert.match(m[1], /^max\([^)]*\d+px\)$/, `${r.sel}: font-size ${m[1]} keeps a px floor`);
  }
  const rule = (sel) => rules.find((r) => r.sel === sel)?.body || '';
  assert.match(rule('.lo-sec--stats .dstats-wrap'), /flex-wrap:\s*wrap/);
  assert.match(rule('.lo-sec--stats .dstats-wrap > .dstats'), /flex:\s*1 1 max\(3\.2rem, 190px\)/);
  assert.match(rule('.lo-sec--stats .rgrid'), /--rg:\s*max\(\.14rem, 7px\)/);
  assert.match(rule('.lo-sec--stats .drange'), /min-width:\s*max\(1\.1rem, 56px\)/);
  // the base classes come from game-panels.css, which every page loads
  const panels = read('public/css/screens/game-panels.css');
  for (const c of ['.dstats-wrap', '.dstats', '.dstat', '.dstat__k', '.dstat__v', '.drange', '.rgrid', '.rgrid-all']) {
    assert.ok(new RegExp(`(^|\\n)${c.replace('.', '\\.')}[ ,{]`).test(panels), `${c} is defined in game-panels.css`);
  }
  assert.match(read('public/index.html'), /<link rel="stylesheet" href="\/css\/screens\/game-panels\.css" \/>/);
});

test('特性 follows the chosen module also when the skill or the module differs from the default (cloned record)', async () => {
  const fs = await import('node:fs');
  const { chessLoadout } = await import('../../public/js/ui/gameLogic.js');
  const { traitText } = await import('../../public/js/ui/detailPanel.js');
  const chess = JSON.parse(fs.readFileSync(new URL('../../data/chess.json', import.meta.url), 'utf8'));
  const get = (id) => chess[id];
  const shown = (id, lo) => traitText(get(id), true, chessLoadout(get(id), lo, get));
  // 隐现 (MAR-X): its other skill keeps the module's line, not the class trait 优先攻击空中单位
  assert.match(shown('chess_char_1_01_b', { chess_char_1_01_a: { skill: 0, module: null } }), /攻击空中单位时攻击力提升至/);
  // 信仰搅拌机: SPT-Y shows its own line; 不装备 shows the class trait
  assert.match(shown('chess_char_4_01_b', { chess_char_4_01_a: { skill: get('chess_char_4_01_b').skill.index, module: 'uniequip_003_rmixer' } }), /攻击距离\+1/);
  assert.match(shown('chess_char_4_01_b', { chess_char_4_01_a: { skill: get('chess_char_4_01_b').skill.index, module: 'none' } }), /能够阻挡三个敌人/);
});
