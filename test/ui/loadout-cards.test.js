// test/ui/loadout-cards.test.js — the 干员调配 tab's optional 卡片视图 (laid out after the event's 物资调配处): the stored
// view (the list stays the default), one operator card (portrait pick, the equipped skill and module, 潜能 as pips through
// cultivationView, the 已调整 mark, the 替补 ribbon), the 快速配置 columns beside it (the list rows' own handlers), the
// bottom bar's tier jumps, and the css rules of the view (text follows 文字大小, no !important). Hook-free views drawn as
// vnode trees. (The browser side: test/ui/loadout-cards.e2e.test.js.)
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
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { OpCard, DeckBar, loadoutViewPref } = await import('../../public/js/screens/loadout.js');
const { data } = await import('../../public/js/data.js');
await data.loadAll('chess', 'garrisons', 'assets', 'bonds', 'effects', 'backups');

const get = (id) => data.lookup('chess', id);
const INSIDE = 'chess_char_1_01_a';   // 隐现: S1 / S2 (default S2), MAR-X
const CHAR = (id) => get(id).charId;

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && ['QuickSkill', 'QuickModule', 'CultivationSelects', 'PotPips'].includes(v.type.name)) { yield* walk(v.type(v.props)); return; }
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const find = (tree, pred) => [...walk(tree)].filter(pred);
const byClass = (tree, c) => find(tree, (v) => hasClass(v, c));
const textOf = (v) => (v == null || typeof v === 'boolean' ? '' : typeof v !== 'object' ? String(v) : Array.isArray(v) ? v.map(textOf).join('') : textOf(v.props?.children));

const card = (props) => OpCard({ m: null, chess: get(INSIDE), golden: get(get(INSIDE).goldenId), entries: {}, ops: {}, onPick: () => {}, onChange: () => {}, onOps: () => {}, ...props });

test('the view: the list unless this browser chose the cards', () => {
  mem.clear();
  assert.equal(loadoutViewPref(), 'list', 'nothing stored: the list (0.3.x default)');
  localStorage.setItem('sp.pref.loadout.view', JSON.stringify('deck'));
  assert.equal(loadoutViewPref(), 'deck');
  localStorage.setItem('sp.pref.loadout.view', JSON.stringify('grid'));
  assert.equal(loadoutViewPref(), 'list', 'an unknown value falls back to the list');
  localStorage.setItem('sp.pref.loadout.view', '{oops');
  assert.equal(loadoutViewPref(), 'list', 'unreadable JSON falls back to the list');
  mem.clear();
});

test('a card: tier, both levels, the equipped skill and module, 潜能 pips, name; a press anywhere picks it', () => {
  const picks = [];
  const c = card({ onPick: (id) => picks.push(id) });
  assert.ok(hasClass(c, 'lo-op') && hasClass(c, 'lo-op--t1'));
  assert.equal(c.props['data-chess'], INSIDE);
  assert.equal(c.props.role, 'listitem');
  const lv = byClass(c, 'lo-op__lvrow');
  assert.equal(lv.length, 2, 'the normal and the elite level');
  assert.equal(textOf(lv[0]), String(get(INSIDE).status.level));
  assert.equal(textOf(lv[1]), String(get(get(INSIDE).goldenId).status.level));
  assert.equal(textOf(byClass(c, 'lo-op__name')[0]), get(INSIDE).name);
  const pips = byClass(c, 'lo-op__pot')[0];
  assert.ok(pips, 'an official operator shows 潜能');
  assert.equal(find(pips, (v) => v.type === 'i' && v.props.class === 'is-on').length, 6, 'default 潜能 6');
  assert.equal(byClass(c, 'lo-op__mark').length, 0, 'nothing changed: no mark');
  assert.equal(byClass(c, 'lo-op__ribbon').length, 0);
  assert.equal(byClass(c, 'lo-op__quick').length, 0, 'no 快速配置 column by default');
  byClass(c, 'lo-op__pick')[0].props.onClick();
  byClass(c, 'lo-op__card')[0].props.onClick({ target: { closest: () => null } });
  byClass(c, 'lo-op__card')[0].props.onClick({ target: { closest: () => ({}) } }); // a press on a control inside: not a pick
  assert.deepEqual(picks, [INSIDE, INSIDE]);
  // the kit row: the default S2 and the default module of the elite
  const kit = byClass(c, 'lo-op__kit')[0];
  assert.equal(find(kit, (v) => v.type?.name === 'SkillIcon')[0].props.index, 1);
  assert.equal(find(kit, (v) => v.type?.name === 'ModuleGlyph')[0].props.id, 'uniequip_002_inside');
});

test('a card follows the loadout: the chosen skill and module, a lower 潜能, the 已调整 mark, the 替补 ribbon', () => {
  const c = card({ entries: { [INSIDE]: { skill: 0, module: 'none' } }, ops: { [CHAR(INSIDE)]: { potential: 2, cultivate: 3 } }, selected: true, notOwned: true });
  assert.ok(hasClass(c, 'is-sel') && hasClass(c, 'is-changed') && hasClass(c, 'is-standin'));
  const kit = byClass(c, 'lo-op__kit')[0];
  assert.equal(find(kit, (v) => v.type?.name === 'SkillIcon')[0].props.index, 0);
  assert.equal(find(kit, (v) => v.type?.name === 'ModuleGlyph')[0].props.id, 'none');
  const pips = byClass(c, 'lo-op__pot')[0];
  assert.equal(find(pips, (v) => v.type === 'i' && v.props.class === 'is-on').length, 2);
  assert.equal(byClass(c, 'lo-op__mark').length, 1);
  assert.equal(textOf(byClass(c, 'lo-op__ribbon')[0]), '替补');
  // 潜能 alone counts as a change (cultivationView), like the list's row
  assert.ok(hasClass(card({ ops: { [CHAR(INSIDE)]: { potential: 5, cultivate: 3 } } }), 'is-changed'));
});

test('快速配置: the skills, the elite\'s modules (不装备 first) or the 潜能 / 练度 selects beside the card, with the list\'s handlers', () => {
  const changes = [], sets = [];
  const on = { onChange: (id, p) => changes.push([id, p]), onOps: (id, p) => sets.push([id, p]) };
  const sk = card({ quick: 'skill', ...on });
  assert.ok(hasClass(sk, 'is-quick'));
  const skills = byClass(sk, 'lo-q--skill');
  assert.deepEqual(skills.map((b) => [b.props['data-skill'], b.props['aria-pressed']]), [[0, 'false'], [1, 'true']]);
  assert.equal(byClass(sk, 'lo-q--empty').length, 1, 'a two-skill chess keeps the third slot empty');
  skills[0].props.onClick();
  const mods = byClass(card({ quick: 'module', ...on }), 'lo-q--mod');
  assert.deepEqual(mods.map((b) => b.props['data-module']), ['none', 'uniequip_002_inside']);
  mods[0].props.onClick();
  assert.deepEqual(changes, [[INSIDE, { skill: 0 }], [INSIDE, { module: 'none' }]]);
  const sel = find(card({ quick: 'cult', ...on }), (v) => v.type === 'select');
  assert.deepEqual(sel.map((s) => s.props['data-cult']), ['potential', 'cultivate']);
  sel[0].props.onChange({ currentTarget: { value: '3' } });
  assert.deepEqual(sets, [[CHAR(INSIDE), { potential: 3 }]]);
  // a chess without an elite form has no modules to choose
  const noElite = OpCard({ m: null, chess: get(INSIDE), golden: null, entries: {}, ops: {}, quick: 'module', onPick() {}, onChange() {}, onOps() {} });
  assert.equal(byClass(noElite, 'lo-q--mod').length, 0);
  assert.equal(textOf(byClass(noElite, 'lo-op__none')[0]), '无精锐');
});

test('the bottom bar: a tier with nothing is disabled, a jump names its tier, open 自选 slots badge 5 / 6, 确认配置 only in 快速配置', () => {
  const jumps = [];
  const counts = { 1: 20, 2: 20, 3: 20, 4: 0, 5: 20, 6: 16 };
  const bar = DeckBar({ counts, active: 2, onJump: (t) => jumps.push(t), diyOpen: { 5: 2, 6: 0 }, quick: null, onConfirm() {} });
  const tiers = byClass(bar, 'lo-bbar__tier');
  assert.deepEqual(tiers.map((b) => b.props['data-tier']), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(tiers.map((b) => !!b.props.disabled), [false, false, false, true, false, false]);
  assert.ok(hasClass(tiers[1], 'is-on'));
  tiers[4].props.onClick();
  assert.deepEqual(jumps, [5]);
  const diy = byClass(bar, 'lo-bbar__diy');
  assert.equal(diy.length, 1, 'only tier 5 has open slots');
  assert.equal(textOf(diy[0]).trim(), '2');
  assert.equal(byClass(bar, 'lo-confirm').length, 0);
  const done = [];
  const quickBar = DeckBar({ counts, active: 1, onJump() {}, diyOpen: {}, quick: 'skill', onConfirm: () => done.push(1) });
  byClass(quickBar, 'lo-confirm')[0].props.onClick();
  assert.deepEqual(done, [1]);
});

test('the view\'s css: every text size follows 文字大小 (var(--t)), no !important', () => {
  const css = readFileSync(path.join(ROOT, 'public/css/screens/loadout.css'), 'utf8');
  const at = css.indexOf('卡片视图 (optional');
  assert.ok(at > 0, 'the card view section');
  const section = css.slice(at);
  const sizes = [...section.matchAll(/font-size:\s*([^;}]+)/g)].map((m) => m[1].trim()).filter((v) => v !== 'inherit');
  assert.ok(sizes.length >= 20);
  assert.deepEqual(sizes.filter((v) => !v.includes('var(--t)')), [], 'font sizes through var(--t)');
  assert.ok(!/!important/.test(section));
});
