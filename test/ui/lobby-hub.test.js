// test/ui/lobby-hub.test.js — the hub lobby (PR #643 split 6): the two entries (独立模拟 / 同盟模拟) open their dialogs,
// 选择模拟协议 (the project's Modal, full screen: four difficulty cards with the 已选定 stamp, the selected one's scene —
// its official picture on the drawn grid, ui/protocolScene.js — 开始独立模拟 / 创建同盟, the test-room box only in test mode) and 选择同盟方式 (the project's Modal, full screen:
// 创建同盟, the key field with 观战, 加入同盟, recent keys that only fill it); the official art keys the hub asks for exist in data/assets.json; the css follows 文字大小 without !important; no
// account / matchmaking / federation code came along. Hook-free views drawn as vnode trees. (The browser side:
// test/ui/lobby-hub.e2e.test.js.)
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
const { HubEntry, ProtocolSelect, AllianceSelect } = await import('../../public/js/screens/lobby.js');
const { Modal } = await import('../../public/js/ui/components.js');
const { DIFFICULTIES } = await import('../../shared/constants.js');

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && ['DifficultyCard', 'BackPlate'].includes(v.type.name)) { yield* walk(v.type(v.props)); return; }
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const find = (tree, pred) => [...walk(tree)].filter(pred);
const byClass = (tree, c) => find(tree, (v) => hasClass(v, c));
const textOf = (v) => (v == null || typeof v === 'boolean' ? '' : typeof v !== 'object' ? String(v) : Array.isArray(v) ? v.map(textOf).join('') : textOf(v.props?.children));
const buttons = (tree) => find(tree, (v) => v.type === 'button');
const buttonText = (tree, text) => buttons(tree).find((b) => textOf(b).includes(text));
const titleOf = (tree) => textOf(byClass(tree, 'modal__title')[0]);

const MODES = {
  solo: { id: 'solo', name: '独立模拟', en: 'SOLO SIMULATION', icon: 'user', desc: '独自', points: ['1 名博士'] },
  coop: { id: 'coop', name: '同盟模拟', en: 'ALLIANCE SIMULATION', icon: 'users', desc: '同盟', points: ['联防'] },
};

test('the entries: 独立模拟 / 同盟模拟 keep the .mode-card hook and open their own dialog', () => {
  for (const id of ['solo', 'coop']) {
    const opened = [];
    const wrap = HubEntry({ card: MODES[id], onOpen: (m) => opened.push(m) });
    assert.ok(textOf(byClass(wrap, 'hub-entry__group')[0]).includes(MODES[id].points[0]), 'its line above it');
    const v = buttons(wrap)[0];
    assert.ok(hasClass(v, 'mode-card') && hasClass(v, 'hub-entry'));
    assert.equal(v.props['data-mode'], id);
    assert.ok(textOf(v).includes(MODES[id].name));
    v.props.onClick();
    assert.deepEqual(opened, [id]);
  }
});

const proto = (props) => ProtocolSelect({
  roomMode: 'solo', difficulty: 'FUNNY', onDifficulty: () => {}, onClose: () => {}, onCreate: () => {}, busy: null, online: true,
  testMode: false, asTest: false, onTest: () => {}, ...props,
});

test('选择模拟协议: the project Modal, four difficulty cards, the official picture of the selected one', () => {
  const picked = [];
  const v = proto({ difficulty: 'HARD', onDifficulty: (d) => picked.push(d) });
  assert.equal(v.type, Modal, 'a Modal (focus trap, Esc, focus restored)');
  assert.equal(titleOf(v), '选择模拟协议');
  assert.ok(hasClass(v, 'proto'));
  assert.equal(byClass(v, 'proto-back').length, 1, 'the back plate');
  assert.equal(typeof v.props.onClose, 'function');
  const cards = byClass(v, 'diff-card');
  assert.equal(cards.length, DIFFICULTIES.length);
  assert.deepEqual(cards.map((c) => hasClass(c, 'is-selected')), DIFFICULTIES.map((d) => d === 'HARD'));
  assert.deepEqual(cards.map((c) => hasClass(c, 'is-on') && byClass(c, 'pcard__stamp').length === 1), DIFFICULTIES.map((d) => d === 'HARD'));
  cards[0].props.onClick();
  assert.deepEqual(picked, ['FUNNY']);
  const art = find(v, (x) => x.type?.name === 'ProtocolArt');
  assert.deepEqual(art.map((x) => x.props.difficulty), ['HARD'], 'the selected difficulty’s scene');
  const body = byClass(v, 'proto__body')[0];
  assert.equal(body.props['data-difficulty'], 'HARD');
  assert.match(body.props.style, /--d-color:/);
});

test('选择模拟协议: 开始独立模拟 / 创建同盟, offline and busy states, the test-room box only in test mode', () => {
  const made = [];
  const solo = proto({ onCreate: () => made.push('solo') });
  const start = buttonText(solo, '开始独立模拟');
  assert.ok(start && hasClass(start, 'proto-start') && !start.props.disabled);
  assert.equal(byClass(solo, 'create-box').length, 1, 'the .create-box hook of the older tests');
  start.props.onClick();
  assert.deepEqual(made, ['solo']);
  assert.equal(find(solo, (x) => x.props?.['data-testid'] === 'create-test').length, 0);

  const coop = proto({ roomMode: 'coop', busy: 'create' });
  assert.equal(buttonText(coop, '创建同盟').props['aria-busy'], 'true');
  assert.ok(buttonText(coop, '创建同盟').props.disabled, 'no second click while it is made');
  assert.ok(textOf(coop).includes('创建后可邀请好友或添加 AI 队友'));
  assert.ok(buttonText(proto({ online: false }), '开始独立模拟').props.disabled, 'offline: no create');

  const ticked = [];
  const test = proto({ testMode: true, asTest: true, onTest: (on) => ticked.push(on) });
  const box = find(test, (x) => x.props?.['data-testid'] === 'create-test');
  assert.equal(box.length, 1);
  const input = find(box[0], (x) => x.type === 'input')[0];
  assert.equal(input.props.checked, true);
  input.props.onChange({ target: { checked: false } });
  assert.deepEqual(ticked, [false]);
});

const ally = (props) => AllianceSelect({
  onClose: () => {}, onCreate: () => {}, code: '', onCode: () => {}, codeOk: false, online: true, busy: null,
  onJoin: () => {}, onSpectate: () => {}, recent: [], marks: [], focusKey: true, ...props,
});

test('选择同盟方式: 创建同盟 leads on to 选择模拟协议; the key field joins or watches once the key is whole', () => {
  const calls = [];
  const v = ally({ onCreate: () => calls.push('create') });
  assert.equal(v.type, Modal);
  assert.ok(hasClass(v, 'ally') && !hasClass(v, 'proto'), 'its own class: .modal__box.proto is 选择模拟协议 only');
  assert.equal(titleOf(v), '选择同盟方式');
  const create = find(v, (x) => x.props?.['data-testid'] === 'alliance-create')[0];
  assert.equal(create.type, 'button');
  create.props.onClick();
  assert.deepEqual(calls, ['create']);
  const row = byClass(v, 'join-row');
  assert.equal(row.length, 1);
  const field = find(row[0], (x) => x.type === 'input')[0];
  assert.ok(field, 'the key field');
  assert.equal(field.props['data-autofocus'], '', 'the Modal focuses it');
  assert.equal(find(ally({ focusKey: false }), (x) => x.type === 'input')[0].props['data-autofocus'], undefined, 'not on a touch screen');
  assert.ok(buttonText(v, '加入同盟').props.disabled, 'no key yet');
  assert.ok(buttonText(v, '观战').props.disabled);

  const ready = ally({ code: 'ABCD', codeOk: true, onJoin: () => calls.push('join'), onSpectate: () => calls.push('spectate') });
  const join = buttonText(ready, '加入同盟');
  const watch = buttonText(ready, '观战');
  assert.ok(!join.props.disabled && !watch.props.disabled);
  assert.ok(hasClass(watch, 'join-spectate'));
  join.props.onClick();
  watch.props.onClick();
  assert.deepEqual(calls.slice(1), ['join', 'spectate']);
  assert.ok(buttonText(ally({ code: 'ABCD', codeOk: true, online: false }), '加入同盟').props.disabled, 'offline');
});

test('选择同盟方式: a recent key fills the field (it never joins by itself); a test room keeps its mark', () => {
  const filled = [];
  const v = ally({ recent: ['ABCD', 'WXYZ'], marks: ['WXYZ'], onCode: (c) => filled.push(c), onJoin: () => assert.fail('joined') });
  const chips = byClass(v, 'code-chip');
  assert.deepEqual(chips.map((c) => textOf(c).trim()), ['ABCD', 'WXYZ']);
  assert.equal(find(chips[0], (x) => x.type?.name === 'TestMark').length, 0);
  assert.equal(find(chips[1], (x) => x.type?.name === 'TestMark').length, 1);
  chips[1].props.onClick();
  assert.deepEqual(filled, ['WXYZ']);
  assert.ok(textOf(ally({})).includes('向同伴索取'), 'no recent key: the hint');
});

const lobbySrc = readFileSync(path.join(ROOT, 'public/js/screens/lobby.js'), 'utf8');
const lobbyCss = readFileSync(path.join(ROOT, 'public/css/screens/lobby.css'), 'utf8');

test('official art only: every key the hub and 选择模拟协议 ask for is in data/assets.json', () => {
  const ui = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8')).ui;
  const keys = [...lobbySrc.matchAll(/\sk="([^"$]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), ['entry/entry_bkg_01', 'entry/entry_bkg_02', 'entry/season_logo']);
  for (const k of keys) assert.ok(ui[k], k);
  for (const d of ['funny', 'normal', 'hard', 'abyss']) assert.ok(ui[`modeChoice/${d}_rhodes_island`], d);
});

test('成就统计 card: this browser’s records read without writing, the official trophy medals, opens the 成就统计 window', () => {
  assert.match(lobbySrc, /<\$\{AchievementCard\} onOpen=\$\{\(\) => setAchOpen\(true\)\} \/>/);
  assert.match(lobbySrc, /achOpen \? html`<\$\{AchievementDialog\} onClose=/);
  assert.match(lobbySrc, /levelProgress\(peekStatsRecords\(\)/);
  assert.doesNotMatch(lobbySrc, /loadStats\(/, 'loadStats moves a damaged value away: the 统计数据 page must still find it');
  const ui = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8')).ui;
  const medals = JSON.parse(readFileSync(path.join(ROOT, 'data/config.json'), 'utf8')).trophies.medals;
  for (const m of medals) assert.ok(ui[`medalIcon/${m.iconId}`], m.iconId);
});

test('选择模拟协议 scene: the official picture as an <image> of the drawn scene, the drawn hull when it fails to load', () => {
  assert.match(lobbySrc, /<\$\{ProtocolScene\} difficulty=\$\{difficulty\} art=\$\{uiUrl\(data\.get\('assets'\), `modeChoice\/\$\{PROTOCOL_ART\[difficulty\]\}_rhodes_island`\)\} \/>/);
  const scene = readFileSync(path.join(ROOT, 'public/js/ui/protocolScene.js'), 'utf8');
  assert.match(scene, /<image href=\$\{pic\}[^>]*onError=\$\{\(\) => setBad\(art\)\}/);
  const ui = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8')).ui;
  for (const k of ['funny', 'normal', 'hard', 'abyss']) assert.ok(ui[`modeChoice/${k}_rhodes_island`], k);
});

test('成就统计 window (screens/stats.js AchievementDialog): the project Modal, this browser’s records only, 查看完整统计 opens 统计数据', () => {
  const stats = readFileSync(path.join(ROOT, 'public/js/screens/stats.js'), 'utf8');
  const dlg = stats.slice(stats.indexOf('export function AchievementDialog'));
  assert.match(dlg, /<\$\{Modal\}/);
  assert.match(dlg, /peekStatsRecords\(\)/);
  assert.match(dlg, /openStats\(/);
  assert.doesNotMatch(dlg, /loadStats\(/);
});

test('no server-only features: accounts, friends, federation, matchmaking, 无限火力, Android', () => {
  for (const re of [/accounts\.js/, /friends\.js/, /federation/, /matchmaking/i, /match\.queue/, /randomMode/, /AndroidNative/, /__onRoomFound/, /room\.list/]) {
    assert.doesNotMatch(lobbySrc, re, String(re));
  }
});

test('lobby.css: text follows 文字大小 (var(--t)), no !important, no :has()', () => {
  const sizes = [...lobbyCss.matchAll(/font-size:\s*([^;}]+)/g)].map((m) => m[1].trim());
  assert.ok(sizes.length >= 25, `${sizes.length} font sizes`);
  // (a plain px value is a touch floor of the 0.3.x test-room box, never a rem that would ignore 文字大小)
  for (const s of sizes) assert.ok(/var\(--t\)/.test(s) || /^\d+px$/.test(s), s);
  assert.doesNotMatch(lobbyCss, /!important/);
  assert.doesNotMatch(lobbyCss, /:has\(/);
});
