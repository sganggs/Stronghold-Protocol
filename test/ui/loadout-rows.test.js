// test/ui/loadout-rows.test.js — the 干员调配 roster as one list (0.2.2): the quick choices of PR #301 (by @farridge) laid
// out as one row per operator with aligned columns instead of three columns of cards (the owner's decision of 2026-10-08:
// 「三个竖排有点乱影响观感」), and the per-operator 潜能 / 练度 controls (「调配干员里自己设置吧，默认满潜满加成」): the row's skill
// / module buttons and selects (state, labels, what a tap sets), the detail's section, a 自选 slot's selects, the 局内数值 at
// the settings, and the css that keeps the columns aligned and the detail sliding over the list below 1000 px. Hook-free
// views drawn as vnode trees. (The browser side: test/ui/loadout.e2e.test.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try { const body = readFileSync(path.join(ROOT, 'data', name), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(body) }; } catch { return { ok: false, status: 404, json: async () => ({}) }; }
};
const { RosterRow, RosterHead, statsPreview, LoadoutStats, ModuleInfo } = await import('../../public/js/screens/loadout.js');
const { CultivationSelects, CultivationSection, cultivateName } = await import('../../public/js/screens/cultivation.js');
const { OperatorVoiceSelect } = await import('../../public/js/screens/operatorVoice.js');
const { DiyPanelView } = await import('../../public/js/screens/diy.js');
const { data } = await import('../../public/js/data.js');
await data.loadAll('chess', 'garrisons', 'assets', 'bonds', 'effects', 'backups');

const get = (id) => data.lookup('chess', id);
const INSIDE = 'chess_char_1_01_a';   // 隐现: S1 / S2 (default S2), MAR-X
const VENDLA = 'chess_char_1_06_a';   // 刺玫
const CHAR = (id) => get(id).charId;

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && ['QuickSkill', 'QuickModule', 'CultivationSelects', 'OperatorVoiceSelect', 'SlotCard', 'KindTag', 'Bonds'].includes(v.type.name)) { yield* walk(v.type(v.props)); return; }
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const find = (tree, pred) => [...walk(tree)].filter(pred);
const textOf = (v) => (v == null || typeof v === 'boolean' ? '' : typeof v !== 'object' ? String(v) : Array.isArray(v) ? v.map(textOf).join('') : textOf(v.props?.children));

const row = (props) => RosterRow({ m: null, chess: get(INSIDE), golden: get(get(INSIDE).goldenId), entries: {}, ops: {}, selected: false, onPick: () => {}, onChange: () => {}, onOps: () => {}, ...props });

test('a row: portrait / name pick, three skill slots (an empty one for a two-skill chess), 不装备 first, the equipped ones pressed', () => {
  const picks = [];
  const changes = [];
  const r = row({ onPick: (id) => picks.push(id), onChange: (id, p) => changes.push([id, p]) });
  assert.ok(hasClass(r, 'lo-card') && hasClass(r, 'lo-card--t1'));
  assert.equal(r.props['data-chess'], INSIDE);
  const pick = find(r, (v) => hasClass(v, 'lo-card__pick'))[0];
  pick.props.onClick();
  assert.deepEqual(picks, [INSIDE]);
  const skills = find(r, (v) => hasClass(v, 'lo-q--skill'));
  assert.deepEqual(skills.map((b) => [b.props['data-skill'], b.props['aria-pressed']]), [[0, 'false'], [1, 'true']], 'S2 is the default');
  assert.equal(find(r, (v) => hasClass(v, 'lo-q--empty')).length, 1, 'the third slot stays empty');
  assert.match(skills[0].props['aria-label'], /^S1 · “不惹麻烦” · /);
  const mods = find(r, (v) => hasClass(v, 'lo-q--mod'));
  assert.deepEqual(mods.map((b) => [b.props['data-module'], b.props['aria-pressed']]), [['none', 'false'], ['uniequip_002_inside', 'true']]);
  skills[0].props.onClick();
  mods[0].props.onClick();
  assert.deepEqual(changes, [[INSIDE, { skill: 0 }], [INSIDE, { module: 'none' }]]);
  assert.equal(find(r, (v) => hasClass(v, 'lo-card__flag')).length, 0, 'nothing changed: no flag');
  // the shared preview: 精锐 shows the Lv.7 SP numbers of the same skill
  const elite = get(get(INSIDE).goldenId).skills.find((s) => s.index === 0);
  const e = find(row({ level: 'elite' }), (v) => hasClass(v, 'lo-q--skill'))[0];
  assert.match(e.props['aria-label'], new RegExp(`消耗 ${elite.spCost}`));
  assert.equal(row({ level: 'elite' }).props['data-variant'], 'elite');
});

test('a row\'s 潜能 / 练度 selects: the defaults quiet, a changed one marked; a change sets the operator\'s settings', () => {
  const sets = [];
  const r = row({ onOps: (id, p) => sets.push([id, p]) });
  const sel = find(r, (v) => v.type === 'select' && v.props['data-cult']);
  assert.deepEqual(sel.map((s) => [s.props['data-cult'], s.props.value]), [['potential', '6'], ['cultivate', '3']]);
  assert.equal(find(r, (v) => hasClass(v, 'is-off')).length, 0, 'the defaults are not marked');
  sel[0].props.onChange({ currentTarget: { value: '2' } });
  sel[1].props.onChange({ currentTarget: { value: '0' } });
  assert.deepEqual(sets, [[CHAR(INSIDE), { potential: 2 }], [CHAR(INSIDE), { cultivate: 0 }]]);
  const options = find(sel[0], (v) => v.type === 'option').map((o) => textOf(o));
  assert.deepEqual(options, ['潜能 1', '潜能 2', '潜能 3', '潜能 4', '潜能 5', '潜能 6']);
  assert.deepEqual(find(sel[1], (v) => v.type === 'option').map((o) => textOf(o)), ['未精英化', '精英1', '精英2', '精英2 Lv.60']);
  // changed: the select is marked, the row flagged and counted as changed
  const c = row({ ops: { [CHAR(INSIDE)]: { potential: 2 } } });
  assert.ok(hasClass(c, 'is-changed'));
  assert.equal(find(c, (v) => hasClass(v, 'lo-card__flag')).length, 1);
  assert.deepEqual(find(c, (v) => hasClass(v, 'is-off')).map((v) => v.props.class.includes('lo-cult__pot')), [true]);
  // a chess marked not owned: the 替补 tag, the settings say they do not apply now
  const s = row({ notOwned: true });
  assert.ok(hasClass(s, 'is-standin'));
  assert.equal(textOf(find(s, (v) => hasClass(v, 'lo-card__sub'))[0]), '替补');
  assert.match(find(s, (v) => hasClass(v, 'lo-cult'))[0].props.title, /替补干员没有潜能与练度/);
});

test('the head names the five columns; CultivationSelects without an operator draws nothing', () => {
  assert.deepEqual(find(RosterHead(), (v) => hasClass(v, 'lo-list__h')).map((v) => textOf(v)), ['干员', '技能', '模组精锐', '潜能 · 练度', '语音语言']);
  assert.equal(CultivationSelects({ charId: null, ops: {}, onSet: () => {} }), null);
});

test('operator voice select: explicit language, follow-global and unavailable audio; row reflects voice-only edits', () => {
  const charId = CHAR(INSIDE);
  const edits = [];
  const props = { m: data.get('assets'), charId, name: '隐现', voiceOverrides: { [charId]: 'cn' }, voiceLang: 'jp', onVoice: (...args) => edits.push(args) };
  const control = OperatorVoiceSelect(props);
  const select = find(control, (v) => v.type === 'select')[0];
  assert.equal(select.props.value, 'cn');
  assert.equal(select.props.disabled, false);
  assert.equal(select.props['aria-label'], '选择隐现的语音语言');
  assert.deepEqual(find(control, (v) => v.type === 'option').map((v) => [v.props.value, textOf(v)]), [['', '跟随全局（日本語）'], ['cn', '中文'], ['jp', '日本語']]);
  select.props.onChange({ currentTarget: { value: '' } });
  assert.deepEqual(edits, [[charId, '']]);
  assert.equal(find(OperatorVoiceSelect({ ...props, m: null }), (v) => v.type === 'select')[0].props.disabled, true);
  const r = row({ m: props.m, voiceOverrides: props.voiceOverrides, onVoice: props.onVoice });
  assert.ok(hasClass(r, 'is-changed'));
  assert.equal(find(r, (v) => v.type === 'select' && v.props['data-voice-char'] === charId).length, 1);
});

test('the detail\'s section: 潜能 1–6 and the four official 练度 tiers, the tier\'s effect, the stand-in note', () => {
  const sets = [];
  const id = CHAR(VENDLA);
  const sec = CultivationSection({ charId: id, ops: { [id]: { potential: 3 } }, onSet: (c, p) => sets.push([c, p]) });
  const pots = find(sec, (v) => v.props && v.props['data-potential'] != null);
  assert.deepEqual(pots.map((b) => [b.props['data-potential'], b.props['aria-checked']]), [[1, 'false'], [2, 'false'], [3, 'true'], [4, 'false'], [5, 'false'], [6, 'false']]);
  const tiers = find(sec, (v) => v.type === 'button' && v.props['data-cultivate'] != null);
  assert.deepEqual(tiers.map((b) => textOf(b)), ['未精英化', '精英阶段1', '精英阶段2', '精英阶段2-60级'], 'effects.json names');
  assert.equal(tiers[3].props['aria-checked'], 'true', 'the default tier');
  assert.match(textOf(find(sec, (v) => hasClass(v, 'lo-cult__eff'))[0]), /精英阶段2-60级 攻击力、防御力和最大生命值\+10%/);
  pots[0].props.onClick();
  tiers[1].props.onClick();
  assert.deepEqual(sets, [[id, { potential: 1 }], [id, { cultivate: 1 }]]);
  assert.equal(cultivateName(0), '未精英化');
  // the rule line says what an operator with nothing set fights at — the default, 满潜能 / 精英2 Lv.60 — and that an unowned
  // 特许 operator at the official 潜能1 / 未精英化 is the player's own setting (Grok review of the branch: it read as automatic)
  const note = textOf(find(sec, (v) => hasClass(v, 'lo-cult__note'))[0]);
  assert.match(note, /^默认满潜能、精英2 Lv\.60（满加成）。/);
  assert.match(note, /未持有的特许干员在官方按潜能1、没有加成，要照官方打请手动设为潜能1、未精英化。$/);
  const st = CultivationSection({ charId: id, ops: {}, onSet: () => {}, standIn: true });
  assert.ok(hasClass(st, 'is-moot'));
  assert.match(textOf(find(st, (v) => hasClass(v, 'lo-cult__note'))[0]), /替补干员没有潜能与练度/);
});

test('自选编队: an owned pick\'s card carries its operator\'s selects, a prototype says it has neither', () => {
  const sets = [];
  const picks = { chess_char_6_diy1_a: { charId: 'char_003_kalts', skillIndex: 0 }, chess_char_5_diy1_a: { charId: 'char_609_acguad' } };
  const tree = DiyPanelView({ m: null, picks, legal: picks, kitted: null, onSet: () => {}, picking: null, onPicking: () => {}, ops: { char_003_kalts: { cultivate: 1 } }, onOps: (c, p) => sets.push([c, p]) });
  const cult = find(tree, (v) => hasClass(v, 'diy-slot__cult'));
  assert.equal(cult.length, 2);
  const sel = find(tree, (v) => v.type === 'select' && v.props['data-cult']);
  assert.deepEqual(sel.map((s) => s.props.value), ['6', '1'], '凯尔希: 潜能 6, 精英1');
  sel[0].props.onChange({ currentTarget: { value: '4' } });
  assert.deepEqual(sets, [['char_003_kalts', { potential: 4 }]]);
  assert.ok(cult.some((v) => textOf(v) === '原型干员没有潜能与练度'));
});

test('局内数值 at the operator\'s settings: 刺玫 at 潜能1 / 未精英化 and at the defaults (×1.1)', () => {
  const v = get(VENDLA);
  const g = get(v.goldenId);
  const pv = (ops, level = 'normal') => statsPreview(v, g, {}, level, get, ops).record.stats;
  assert.deepEqual([pv({ [v.charId]: { potential: 1, cultivate: 0 } }).atk, pv({ [v.charId]: { potential: 1, cultivate: 0 } }).cost], [413, 17]);
  assert.equal(pv({}).atk, 435 * 1.1, 'none set: 满潜 + 精英2 Lv.60');
  assert.equal(pv({ [v.charId]: { potential: 1, cultivate: 0 } }, 'elite').atk, 508 + 23, 'the elite: statsBase at 潜能1 + INC-X');
  assert.ok(statsPreview(v, g, {}, 'normal', get, {}).lo.cultivation);
  // the caption says the numbers carry 潜能 and 练度 (an owned operator; effects.json loaded)
  const cap = (tree) => textOf(find(tree, (n) => hasClass(n, 'lo-stats__cap'))[0]);
  assert.match(cap(LoadoutStats({ base: v, golden: g, entries: {}, level: 'elite', onLevel() {}, getChess: get, ops: {} })), /^数值含所选模组；含潜能与练度；不含技能发动/);
});

test('the module card reads its talent changes at the operator\'s 潜能, as 局内数值 and the battle do (余 闲云隐市: 2%（+0.5%） / 1.5%)', () => {
  // (Grok review of the branch: the card printed the full-potential line whatever the setting)
  const g = get('chess_char_6_03_b');
  const mod = g.modules.find((x) => x.uniEquipId === 'uniequip_002_yu');
  const opt = { id: mod.uniEquipId, rec: mod, isDefault: !!mod.isDefault };
  const texts = (tree) => find(tree, (v) => typeof v.type === 'function' && v.type.name === 'RichText').map((v) => String(v.props.text));
  const full = texts(ModuleInfo({ m: null, golden: g, opt }));
  assert.ok(full.some((x) => x.includes('生命上限2%<@ba.talpu>（+0.5%）</>')), 'full potential (none given)');
  assert.deepEqual(texts(ModuleInfo({ m: null, golden: g, opt, potential: 6 })), full);
  const p1 = texts(ModuleInfo({ m: null, golden: g, opt, potential: 1 }));
  assert.ok(p1.some((x) => x.includes('生命上限1.5%的生命')), '潜能1');
  assert.ok(!p1.some((x) => x.includes('（+0.5%）')));
  assert.deepEqual(texts(ModuleInfo({ m: null, golden: g, opt: { id: 'none', rec: null }, potential: 1 })), [g.traitBase.descRaw], '不装备: the base 特性');
  // 圣约送葬人 REA-Y (GitHub #400): 特性 heals 50 per enemy hit as in battle; 特性追加 is the module's ASPD line
  const ex = get('chess_char_5_01_b');
  const rea = ex.modules.find((x) => x.uniEquipId === 'uniequip_003_excu2');
  const lines = texts(ModuleInfo({ m: null, golden: ex, opt: { id: rea.uniEquipId, rec: rea }, potential: 6 }));
  assert.ok(lines.some((x) => x.includes('每攻击到一个敌人回复自身<@ba.kw>50</>生命')), lines.join(' | '));
  assert.ok(lines.some((x) => x === '攻击范围内存在2名及以上敌人时攻击速度<@ba.kw>+12</>'));
  // the detail hands the operator's 潜能 to it
  const src = readFileSync(path.join(ROOT, 'public/js/screens/loadout.js'), 'utf8');
  assert.match(src, /<\$\{ModuleInfo\} m=\$\{m\} golden=\$\{golden\} opt=\$\{modOpt\} potential=\$\{opsOf\(ops, chess\.charId\)\.potential\} \/>/);
});

test('css: the selected skill\'s frame is square around its icon (GitHub #398 / PR #399): no img max-width clamp, fill beats `.lo-sicon img`', () => {
  // theme.css `img { max-width: 100% }` held the frame's width to the icon's while its height grew by .1rem (36 × 40 px
  // on a phone, 70 × 80 at 1920 px), and the more specific `.lo-sicon img { object-fit: cover }` cropped its side lines
  const css = readFileSync(path.join(ROOT, 'public/css/screens/loadout.css'), 'utf8');
  const rule = css.match(/^([^{}\n]*\.lo-sicon__outline) \{([^}]*)\}/m);
  assert.ok(rule, 'the frame rule');
  assert.equal(rule[1], '.lo-sicon .lo-sicon__outline', 'more specific than `.lo-sicon img`');
  assert.match(rule[2], /inset: -\.05rem; width: calc\(100% \+ \.1rem\) !important; height: calc\(100% \+ \.1rem\) !important;/);
  assert.match(rule[2], /max-width: none;/);
  assert.match(rule[2], /object-fit: fill;/);
  assert.match(css, /\.lo-sicon img \{ width: 100%; height: 100%; object-fit: cover;/, 'the icon itself still covers');
  assert.match(readFileSync(path.join(ROOT, 'public/css/theme.css'), 'utf8'), /\bimg \{ max-width: 100%; \}/, 'the global clamp the frame opts out of');
});

test('css: the head and the rows share one grid (columns aligned), quick targets grow on a coarse pointer, the detail slides over below 1000 px', () => {
  const css = readFileSync(path.join(ROOT, 'public/css/screens/loadout.css'), 'utf8');
  assert.match(css, /\.lo-list__head, \.lo \.lo-card \{ display: grid; grid-template-columns: var\(--cols\);/);
  assert.match(css, /\.sp-coarse \.lo-list \{ --q: max\(\.44rem, 40px\); \}/);
  const block = css.slice(css.indexOf('@media (max-width: 1000px) {\n  .lo-body'));
  assert.match(block, /\.lo-body \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(block, /\.lo-detail-wrap \{ display: none; \}/);
  assert.ok(!/\.lo-grid\b/.test(css), 'the old card grid is gone');
});
