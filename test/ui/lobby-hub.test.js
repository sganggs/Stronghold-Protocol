// test/ui/lobby-hub.test.js — the hub lobby (PR #643 split 6, PR #812): the two entries (独立模拟 / 同盟模拟) open their
// dialogs, 选择模拟协议 (the project's Modal, full screen: four difficulty cards with the 已选定 stamp, the selected one's
// scene — its official picture on the drawn grid, ui/protocolScene.js — 开始独立模拟, the test-room box only in test mode;
// the room's 确认 and read-only uses) and 选择同盟方式 (the project's Modal, full screen: 创建同盟 creating the room at once
// at the remembered difficulty — the event's 联合模拟, the maintainer's decision of 2026-10-21 —, the key field (the
// project's TextField) with 观战, 加入同盟, recent keys that only fill it); the 成就统计 card is the lobby's only statistics
// entry; the official art keys the hub asks for exist in data/assets.json; the css follows 文字大小 without !important; no
// account / matchmaking / federation code came along. Hook-free views drawn as vnode trees. (The browser side:
// test/ui/lobby-hub.e2e.test.js, test/ui/room-settings.e2e.test.js.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unscaled } from '../helpers/uiSize.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try { const body = readFileSync(path.join(ROOT, 'data', name), 'utf8'); return { ok: true, status: 200, json: async () => JSON.parse(body) }; } catch { return { ok: false, status: 404, json: async () => ({}) }; }
};
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { HubEntry, ProtocolSelect, AllianceSelect, normalizeCode, codeArg } = await import('../../public/js/screens/lobby.js');
const { Modal, TextField } = await import('../../public/js/ui/components.js');
const { ReplayWait, BondAchievement } = await import('../../public/js/screens/stats.js');
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


/** Every plain rule of a style sheet as [selector, body], comments stripped; @-rule preludes are not selectors. */
function* cssRules(src) {
  for (const m of src.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/(?<=^|[{}])\s*([^{}@]+)\{([^{}]*)\}/g)) yield [m[1].trim(), m[2]];
}
/** Whether a selector reaches the room's big button (GoButton: .proto-start.rs-go > .proto-start__label, in
 *  .rs-foot__right / .room-bar__right of the .rs-foot / .room-bar footer of .rs): the button or anything inside it, or one
 *  of its ancestors as the subject; 选择模拟协议's own button (.proto-foot .proto-start__label) is not the room's. */
function wrapsRoomGo(sel) {
  const x = sel.trim();
  if (/^\.proto-foot \.proto-start__label$/.test(x)) return false;
  if (/\.(?:rs-go|proto-start|proto-start__label)(?![\w-])/.test(x)) return true;
  const subject = x.split(/\s*[\s>+~]\s*/).pop();
  return /\.(?:rs|rs-foot|rs-foot__right|room-bar|room-bar__right)(?![\w-])/.test(subject);
}
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

test('选择模拟协议: 开始独立模拟, offline and busy states, the test-room box only in test mode; the room’s 确认', () => {
  const made = [];
  const solo = proto({ onCreate: () => made.push('solo') });
  const start = buttonText(solo, '开始独立模拟');
  assert.ok(start && hasClass(start, 'proto-start') && !start.props.disabled);
  assert.equal(byClass(solo, 'create-box').length, 1, 'the .create-box hook of the older tests');
  start.props.onClick();
  assert.deepEqual(made, ['solo']);
  assert.equal(find(solo, (x) => x.props?.['data-testid'] === 'create-test').length, 0);

  // the room's change of difficulty (screens/room.js, the host): 确认 with the server rules as the hint, busy while sent
  const room = proto({ roomMode: 'coop', busy: 'create', action: '确认', hint: '更改难度后，其他博士需要重新准备就绪' });
  assert.equal(buttonText(room, '确认').props['aria-busy'], 'true');
  assert.ok(buttonText(room, '确认').props.disabled, 'no second click while it is sent');
  assert.ok(textOf(room).includes('更改难度后，其他博士需要重新准备就绪'));
  assert.equal(buttonText(room, '创建同盟'), undefined, 'no 创建同盟 button inside a room');
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

test('选择模拟协议 read-only (a room’s other doctors): the cards shown, not chosen, no button, 由创建者选择', () => {
  const v = proto({ roomMode: 'coop', difficulty: 'ABYSS', readOnly: true, onCreate: () => assert.fail('sent') });
  const cards = byClass(v, 'diff-card');
  assert.equal(cards.length, DIFFICULTIES.length);
  assert.ok(cards.every((c) => c.props.disabled === true), 'no card can be chosen');
  assert.deepEqual(cards.map((c) => hasClass(c, 'is-selected')), DIFFICULTIES.map((d) => d === 'ABYSS'), 'the room’s difficulty');
  assert.equal(byClass(v, 'proto-start').length, 0, 'no 确认 / 创建同盟 button');
  assert.equal(find(v, (x) => x.props?.['data-testid'] === 'create-test').length, 0);
  assert.ok(textOf(byClass(v, 'proto-hint--ro')[0]).includes('由创建者选择'));
  assert.ok(proto({}).props && byClass(proto({}), 'diff-card').every((c) => !c.props.disabled), 'the host’s and the lobby’s cards stay live');
});

const ally = (props) => AllianceSelect({
  onClose: () => {}, onCreate: () => {}, code: '', onCode: () => {}, codeOk: false, online: true, busy: null,
  onJoin: () => {}, onSpectate: () => {}, recent: [], marks: [], focusKey: true, ...props,
});

test('选择同盟方式: 创建同盟 creates the room at once at the remembered difficulty (changed in the room); the test-room box in test mode', () => {
  const calls = [];
  const v = ally({ onCreate: (...a) => calls.push(['create', ...a]), difficulty: 'HARD' });
  assert.equal(v.type, Modal);
  assert.ok(hasClass(v, 'ally') && !hasClass(v, 'proto'), 'its own class: .modal__box.proto is 选择模拟协议 only');
  assert.equal(titleOf(v), '选择同盟方式');
  const create = find(v, (x) => x.props?.['data-testid'] === 'alliance-create')[0];
  assert.equal(create.type, 'button');
  assert.equal(create.props['data-difficulty'], 'HARD');
  assert.ok(textOf(create).includes('难度：绝境模拟（可在同盟内更改）'), textOf(create));
  assert.ok(!create.props.disabled);
  create.props.onClick({ type: 'click' });
  assert.deepEqual(calls, [['create']], 'no click event handed on, no difficulty step in between');
  const busy = find(ally({ busy: 'create' }), (x) => x.props?.['data-testid'] === 'alliance-create')[0];
  assert.ok(busy.props.disabled && busy.props['aria-busy'] === 'true', 'no second room while it is made');
  assert.ok(find(ally({ online: false }), (x) => x.props?.['data-testid'] === 'alliance-create')[0].props.disabled, 'offline');
  assert.equal(find(v, (x) => x.props?.['data-testid'] === 'create-test').length, 0, 'no test-room box outside test mode');
  const ticked = [];
  const test = ally({ testMode: true, asTest: true, onTest: (on) => ticked.push(on) });
  const box = find(test, (x) => x.props?.['data-testid'] === 'create-test');
  assert.equal(box.length, 1);
  const input = find(box[0], (x) => x.type === 'input')[0];
  assert.equal(input.props.checked, true);
  input.props.onChange({ target: { checked: false } });
  assert.deepEqual(ticked, [false]);
});

test('选择同盟方式: the key field is the project TextField (IME-safe Enter, normalised write-back, no length cap); join or watch once the key is whole', () => {
  const calls = [];
  const v = ally({ onCreate: () => calls.push('create') });
  const row = byClass(v, 'join-row');
  assert.equal(row.length, 1);
  assert.equal(find(row[0], (x) => x.type === 'input').length, 0, 'no raw <input>: TextField guards the IME composition');
  const field = find(row[0], (x) => x.type === TextField)[0];
  assert.ok(field, 'the key field');
  assert.equal(field.props.transform, normalizeCode, 'the normalised key is written back into the field');
  assert.equal(field.props.maxLength, undefined, 'no cap before normalizeCode: a long pasted invite link must reach it whole');
  assert.equal(field.props.modalFocus, true, 'the Modal focuses it');
  assert.equal(field.props.ariaLabel, '同盟密钥');
  assert.equal(find(ally({ focusKey: false }), (x) => x.type === TextField)[0].props.modalFocus, false, 'not on a touch screen');
  const enter = [];
  find(ally({ onJoin: (...a) => enter.push(a) }), (x) => x.type === TextField)[0].props.onEnter({ key: 'Enter' });
  assert.deepEqual(enter, [[]], 'Enter joins with the field’s key (no event handed on as a key)');
  assert.ok(buttonText(v, '加入同盟').props.disabled, 'no key yet');
  assert.ok(buttonText(v, '观战').props.disabled);

  const ready = ally({ code: 'ABCD', codeOk: true, onJoin: () => calls.push('join'), onSpectate: () => calls.push('spectate') });
  const join = buttonText(ready, '加入同盟');
  const watch = buttonText(ready, '观战');
  assert.ok(!join.props.disabled && !watch.props.disabled);
  assert.ok(hasClass(watch, 'join-spectate'));
  join.props.onClick();
  watch.props.onClick();
  assert.deepEqual(calls, ['join', 'spectate']);
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
const lobbyCss = unscaled(readFileSync(path.join(ROOT, 'public/css/screens/lobby.css'), 'utf8'));
const roomCss = unscaled(readFileSync(path.join(ROOT, 'public/css/screens/room.css'), 'utf8'));

test('the key: a pasted invite link of any length, a 5th character or a dash are normalised to the 4-letter key', () => {
  const link = 'https://crops-flexible-wedding-trademarks.trycloudflare.com/?room=QWER';
  assert.ok(link.length > 64);
  assert.equal(normalizeCode(link), 'QWER', 'the whole link reaches normalizeCode (the old maxlength 64 made it "HTTP")');
  assert.equal(normalizeCode(`${link} 凯尔希邀请你加入卫戍协议：盟约【标准模拟】`), 'QWER', 'the copied invitation line too');
  assert.equal(normalizeCode('abcde'), 'ABCD');
  assert.equal(normalizeCode('ab-'), 'AB');
  assert.equal(codeArg({ type: 'click' }, 'abcd'), 'ABCD', 'a click event falls back to the field');
});

test('official art only: every key the hub and 选择模拟协议 ask for is in data/assets.json', () => {
  const ui = JSON.parse(readFileSync(path.join(ROOT, 'data/assets.json'), 'utf8')).ui;
  const keys = [...lobbySrc.matchAll(/\sk="([^"$]+)"/g)].map((m) => m[1]);
  assert.deepEqual(keys.sort(), ['entry/entry_bkg_01', 'entry/entry_bkg_02', 'entry/season_logo']);
  for (const k of keys) assert.ok(ui[k], k);
  for (const d of ['funny', 'normal', 'hard', 'abyss']) assert.ok(ui[`modeChoice/${d}_rhodes_island`], d);
});

test('成就统计 card: the lobby’s only statistics entry (no top-bar 统计数据 chip); this browser’s records read without writing, the official trophy medals', () => {
  assert.match(lobbySrc, /<\$\{AchievementCard\} onOpen=\$\{\(\) => setAchOpen\(true\)\} \/>/);
  assert.match(lobbySrc, /achOpen \? html`<\$\{AchievementDialog\} onClose=/);
  assert.doesNotMatch(lobbySrc, /openStats/, 'the 统计数据 page opens from the window’s 查看完整统计 only');
  assert.doesNotMatch(lobbySrc, /stats-entry|me-chip/, 'the top-bar chip is gone');
  // (the season of the version shown: DESIGN §35.23 — every record on a server without versions)
  assert.match(lobbySrc, /const records = recordsOfSeason\(peekStatsRecords\(\), season\);\s*return \{ prog: levelProgress\(records/);
  assert.match(lobbySrc, /trophies: aggregateStats\(records\)\.trophies/, 'the same trophy count as the window’s 获得奖杯');
  assert.match(lobbySrc, /\[cfg, statsOpen, season\]/, 'read again when 统计数据 closes (an import or 清空 there) or the version changes');
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
  // the lineup's portraits, 自选 units and gear: nothing on the lobby path loads chess / items / backups
  assert.match(dlg, /useData\('config', 'bands', 'bonds', 'assets', 'chess', 'items', 'backups'\)/);
  // no gameplay-plugin match in the peak or the strategy marks (checklist §二.6), like the tallies (aggregateStats)
  assert.match(dlg, /achievementRecords\(records\)/);
  assert.match(dlg, /highestBondRecord\(official\)/);
  assert.match(dlg, /<\$\{StrategyRecords\}[^>]*records=\$\{official\}/);
  // an alphabetic title gets ': ', as on the hub and the title screen
  assert.match(dlg, /scriptOf\(t\('卫戍协议'\)\) === 'alphabetic' \? ': ' : '：'/);
});

test('选择同盟方式 creates the room itself: the lobby never stacks 选择模拟协议 for a 同盟', () => {
  // (the remembered difficulty, or the server's fallback when the lobby's version lacks it: DESIGN §35.23)
  assert.match(lobbySrc, /onCreate=\$\{\(\) => create\('coop'\)\} difficulty=\$\{shownCoop\}/);
  assert.match(lobbySrc, /onCreate=\$\{\(\) => create\('solo'\)\}/);
  assert.doesNotMatch(lobbySrc, /setProtocol\('coop'\)/);
  assert.match(lobbySrc, /<\$\{ProtocolSelect\} roomMode="solo"/, '选择模拟协议 stays before 独立模拟');
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

test('选择同盟方式 on a short screen (≤ 520 px tall): 创建同盟 keeps its difficulty line under the name, the column fits or scrolls (§35.18)', () => {
  // the name is an element of its own, so the icon and the name stay on the first row (a bare text node became a
  // flex item that wrapped under the icon in English at 大 — the 2026-10-22 review)
  const bar = byClass(find(ally({ difficulty: 'HARD' }), (x) => x.props?.['data-testid'] === 'alliance-create')[0], 'ally-card__bar')[0];
  const kids = [bar.props.children].flat(Infinity).filter((x) => x && typeof x === 'object');
  assert.deepEqual(kids.map((x) => x.props?.class ?? x.type), ['ally-card__icon', 'ally-card__name', 'small']);
  assert.equal(textOf(kids[1]), '创建同盟');
  const css = lobbyCss.replace(/\/\*[\s\S]*?\*\//g, '');
  // the column centres with auto margins (they give way when it is too tall; justify-content: center spilled it past both ends)
  assert.match(css, /\n\.ally-side \{(?![^}]*justify-content)[^}]*\}\n\.ally-side > :first-child \{ margin-top: auto; \}\n\.ally-side > :last-child \{ margin-bottom: auto; \}/);
  // the @media block, up to its own closing brace
  const at = css.indexOf('@media (max-height: 520px) {');
  let end = css.indexOf('{', at) + 1;
  for (let depth = 1; depth > 0 && end < css.length; end++) { if (css[end] === '{') depth++; else if (css[end] === '}') depth--; } // loop-cap: the stylesheet's length
  const short = css.slice(at, end);
  assert.ok(short.includes('.ally-card__bar {'), 'the short-screen block');
  assert.doesNotMatch(short, /\.ally-card__bar small \{ display: none; \}/, 'no longer hidden');
  assert.match(short, /\.ally-card__bar \{ font-size: clamp\(16px, calc\(\.3 \* var\(--t\)\), 26px\); \}/, 'the names a step smaller, capped');
  assert.match(short, /\.ally-card--create \.ally-card__bar \{[^}]*display: grid; grid-template-columns: auto minmax\(0, 1fr\);[^}]*height: auto;/);
  assert.match(short, /\.ally-card--create \.ally-card__name \{[^}]*min-width: 0;[^}]*text-overflow: ellipsis;/);
  assert.match(short, /\.ally-card--create \.ally-card__bar small \{[^}]*grid-column: 2;[^}]*white-space: normal;[^}]*font-size: clamp\(11px, calc\(\.28 \* var\(--t\)\), 14px\);/);
  assert.match(short, /\.ally-recent \{ font-size: min\(calc\(\.24 \* var\(--t\)\), 14px\);/);
  assert.match(short, /\.proto-title__mode \{[^}]*flex-wrap: wrap;[^}]*white-space: nowrap; \}/, 'the mode line breaks between its parts, never inside one');
  assert.match(short, /\.ally-side \{[^}]*overflow-x: hidden; overflow-y: auto;/, 'a column still too tall scrolls');
});

/** The short-screen @media block of lobby.css (comments dropped), up to its own closing brace. */
function shortBlock() {
  const css = lobbyCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf('@media (max-height: 520px) {');
  let end = css.indexOf('{', at) + 1;
  for (let depth = 1; depth > 0 && end < css.length; end++) { if (css[end] === '{') depth++; else if (css[end] === '}') depth--; } // loop-cap: the stylesheet's length
  return css.slice(at, end);
}

test('选择模拟协议 on a short screen (§35.18 leftover: at 文字大小 中+ the cards ran under 开始独立模拟): one-line cards, the description in the brief, capped header and label', () => {
  const short = shortBlock();
  // ÷ --sp-ui: under 界面大小 the column and the brief keep their unscaled widths (the 16 / 11 px text floors and the px
  // paddings do not shrink; DESIGN §35.47, the browser case in screen-fit.e2e)
  assert.match(short, /\.proto-body \{ grid-template-columns: minmax\(0, 1fr\) min\(calc\(7\.4rem \/ var\(--sp-ui, 1\)\), 50vw\);/, 'the column as wide as 选择同盟方式\'s');
  assert.match(short, /\.ally-body \{ grid-template-columns: minmax\(0, 1fr\) min\(calc\(7\.4rem \/ var\(--sp-ui, 1\)\), 54vw\); \}/);
  assert.match(short, /\.proto-brief \{ max-width: min\(calc\(6\.4rem \/ var\(--sp-ui, 1\)\), 100%\);/);
  assert.match(short, /\.pcard__desc, \.pcard__effects, \.pcard__meta \{ display: none; \}/, 'the cards keep only their names');
  assert.doesNotMatch(short, /\.proto-brief p \{ display: none; \}/, 'the brief keeps its description');
  assert.match(short, /\.proto-brief p \{[^}]*font-size: clamp\(11px, calc\(\.26 \* var\(--t\)\), 13px\);/);
  assert.match(short, /\.pcard__name \{ min-width: 0; overflow: hidden; text-overflow: ellipsis;/);
  assert.match(short, /\.pcard__name \{ font-size: clamp\(16px, calc\(\.4 \* var\(--t\)\), 20px\); \}/);
  assert.match(short, /\.proto-title \.modal__title \{ font-size: min\(calc\(\.46 \* var\(--t\)\), 24px\); white-space: nowrap; \}/);
  assert.match(short, /\.proto-title__mode, \.proto-title__mode i \{ font-size: min\(calc\(\.24 \* var\(--t\)\), 16px\); \}/);
  // the button grows for a second line of its label instead of cutting it (the wrap: the dialog's base rule)
  assert.match(short, /\.proto-start \{ height: auto; min-height: 44px;/);
  assert.match(short, /\.proto-foot \.proto-start__label \{ font-size: min\(calc\(\.5 \* var\(--t\)\), 20px\); \}/);
  assert.match(short, /\.proto-foot \.proto-start__rook \{ font-size: min\(calc\(\.36 \* var\(--t\)\), 16px\); \}/);
  assert.match(short, /\.proto-foot \.proto-start__mark small \{ font-size: min\(calc\(\.08 \* var\(--t\)\), 6px\); \}/);
  // the list still scrolls should a pack's names not fit (its base rule)
  assert.match(lobbyCss, /\.proto-list \{[^}]*overflow-y: auto;/);
  // the markup the rules rely on: the description on each card and in the brief, the name in its own element
  const v = ProtocolSelect({ roomMode: 'solo', difficulty: 'ABYSS', onDifficulty: () => {}, onClose: () => {}, onCreate: () => {}, online: true });
  assert.equal(byClass(v, 'pcard__name').length, 4);
  assert.equal(byClass(byClass(v, 'proto-brief')[0], 'proto-brief__name').length, 1);
  assert.ok(textOf(find(byClass(v, 'proto-brief')[0], (x) => x.type === 'p')[0]).length > 0, 'the brief\'s description');
  assert.match(lobbyCss, /\[ASSUMED\] every cap/);
});

test('TextField placeholderShort: placeholderFits measures the text in the ::placeholder font (letter spacing included) against the inner width', async () => {
  const { placeholderFits } = await import('../../public/js/ui/components.js');
  const saved = { gcs: globalThis.getComputedStyle, doc: globalThis.document };
  try {
    // 10 px a character in the canvas, + 1 px letter spacing; the input 200 px wide with 10 px padding each side → 180 px
    const ph = { fontStyle: 'normal', fontWeight: '500', fontSize: '20px', fontFamily: 'x', letterSpacing: '1px' };
    const own = { fontStyle: 'normal', fontWeight: '700', fontSize: '20px', fontFamily: 'x', letterSpacing: '2px', paddingLeft: '10px', paddingRight: '10px' };
    let font = '';
    globalThis.document = { createElement: () => ({ getContext: () => ({ set font(f) { font = f; }, measureText: (s) => ({ width: s.length * 10 }) }) }) };
    globalThis.getComputedStyle = (el, pseudo) => (pseudo === '::placeholder' ? ph : own);
    const input = { clientWidth: 200 };
    assert.equal(placeholderFits(input, 'x'.repeat(16)), true, '16 × 11 = 176 ≤ 180');
    assert.equal(placeholderFits(input, 'x'.repeat(17)), false, '17 × 11 = 187 > 180');
    assert.equal(font, 'normal 500 20px x', 'the placeholder\'s own font');
    // no ::placeholder style (an older engine): the input's own font and spacing stand in
    globalThis.getComputedStyle = (el, pseudo) => (pseudo ? {} : own);
    assert.equal(placeholderFits(input, 'x'.repeat(15)), true, '15 × 12 = 180');
    assert.equal(placeholderFits(input, 'x'.repeat(16)), false);
    // nothing to measure with: the whole placeholder stays
    globalThis.getComputedStyle = () => { throw new Error('no layout'); };
    assert.equal(placeholderFits(input, 'x'.repeat(99)), true);
  } finally { globalThis.getComputedStyle = saved.gcs; globalThis.document = saved.doc; }
  const comp = readFileSync(path.join(ROOT, 'public/js/ui/components.js'), 'utf8');
  assert.match(comp, /const check = \(\) => \{ if \(live\) setPhShort\(!placeholderFits\(el, placeholder\)\); \};/);
  assert.match(comp, /ro\?\.observe\(el\);\n\s+const fonts = globalThis\.document\?\.fonts;\n\s+fonts\?\.addEventListener\?\.\('loadingdone', check\);/);
  assert.match(comp, /placeholder=\$\{phShort && placeholderShort \? placeholderShort : placeholder\}/);
});

/** A top-level @media block of lobby.css (comments dropped), up to its own closing brace. */
function mediaBlock(query) {
  const css = lobbyCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf(`@media ${query} {`);
  assert.ok(at >= 0, query);
  let end = css.indexOf('{', at) + 1;
  for (let depth = 1; depth > 0 && end < css.length; end++) { if (css[end] === '{') depth++; else if (css[end] === '}') depth--; } // loop-cap: the stylesheet's length
  return css.slice(at, end);
}

test('选择模拟协议 above 520 px tall (§35.18 leftover: the label cut, the cards under the button at 大 / 特大): the label wraps and stops at .46rem, the cards fit by levels', async () => {
  const { pickCardFit, CARD_FIT_LEVELS } = await import('../../public/js/screens/lobby.js');
  // the first level whose cards do not spill; the last when none fits (the list then scrolls)
  assert.deepEqual(CARD_FIT_LEVELS, ['full', 'brief', 'names']);
  const tried = [];
  assert.equal(pickCardFit((lv) => { tried.push(lv); return lv !== 'brief'; }), 'brief');
  assert.deepEqual(tried, ['full', 'brief'], 'stops at the first that fits');
  assert.equal(pickCardFit(() => false), 'full');
  assert.equal(pickCardFit(() => true), 'names');
  const css = lobbyCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const base = css.slice(0, css.indexOf('@media (max-aspect-ratio: 1/1) {'));
  // the label: wraps (the button grows from its old height) and stops at 大's size; the rook too; the names at .36rem —
  // the dialog's own button only (.proto-foot): the shared rule keeps the old one-line label for the room's GoButton,
  // which makes its own choice in room.css (the review: these rules had reached it, and its fixed 46 px on a phone cut
  // every line)
  assert.match(base, /\n\.proto-start \{[^}]*\n {2}min-height: max\(1\.04rem, 54px\);/);
  assert.doesNotMatch(base.match(/\n\.proto-start \{[^}]*\}/)[0], /\n {2}height:/, 'no fixed height');
  assert.match(base, /\n\.proto-start__label \{[^}]*font-size: calc\(\.4 \* var\(--t\)\);[^}]*white-space: nowrap; \}/);
  assert.match(base, /\n\.proto-foot \.proto-start__label \{ flex: 1 1 auto; padding-right: 8%; font-size: min\(calc\(\.4 \* var\(--t\)\), \.46rem\); white-space: normal; line-height: 1\.1; \}/);
  assert.match(base, /\n\.proto-start__rook \{[^}]*font-size: calc\(\.36 \* var\(--t\)\);/);
  assert.match(base, /\n\.proto-foot \.proto-start__rook \{ font-size: min\(calc\(\.36 \* var\(--t\)\), \.4rem\); \}/);
  assert.match(base, /\n\.pcard__name \{ font-size: min\(calc\(\.28 \* var\(--t\)\), \.36rem\);/);
  // no rule of lobby.css outside the dialog wraps the label (the room's button shares the class)
  for (const [, sel, body] of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    if (/\.proto-start__label/.test(sel) && /white-space: normal|flex: 1 1 auto|padding-right/.test(body)) {
      assert.ok(sel.split(',').every((x) => !/\.proto-start__label/.test(x) || /\.proto-foot \.proto-start__label/.test(x)), `scoped to the dialog: ${sel.trim()}`);
    }
  }
  // the cards' column: 5.6rem with a 300 px floor (the review: in a 960×540 / 1100×530 / 800×600 window English names
  // ended in an ellipsis on cards not chosen), never past 46vw
  assert.match(base, /\n\.proto-body \{[^}]*grid-template-columns: minmax\(0, 1fr\) min\(max\(5\.6rem, 300px\), 46vw\);/);
  // the portrait layout's cards and button span the width: the caps give way there
  const narrow = mediaBlock('(max-aspect-ratio: 1/1)');
  assert.match(narrow, /\.pcard__name \{ font-size: calc\(\.28 \* var\(--t\)\); \}/);
  assert.match(narrow, /\.proto-foot \.proto-start__label \{ font-size: calc\(\.4 \* var\(--t\)\); \}/);
  // the levels, above 520 px only (the short-screen block has its own one-line cards)
  const tall = mediaBlock('(min-height: 521px)');
  assert.match(tall, /\.proto__body\[data-fit="brief"\] \.pcard__desc,\s*\.proto__body\[data-fit="names"\] \.pcard__desc, \.proto__body\[data-fit="names"\] \.pcard__effects, \.proto__body\[data-fit="names"\] \.pcard__meta \{ display: none; \}/);
  assert.match(tall, /\.proto__body\[data-fit="brief"\] \.pcard__name, \.proto__body\[data-fit="names"\] \.pcard__name \{ min-width: 0; overflow: hidden; text-overflow: ellipsis;/);
  assert.match(tall, /\.proto__body\[data-fit="names"\] \.proto-brief__more \{ display: flex;/);
  assert.match(base, /\n\.proto-brief__more \{ display: none; \}/, 'the brief\'s extra lines only at names');
  assert.doesNotMatch(tall, /\.proto-list \{|\.proto-body \{|\.proto-side \{/, 'a level never changes the list\'s box (no measuring loop)');
  // the markup: the fit element inside the body, the brief's effects and rounds, the list's tighter rhythm
  const v = ProtocolSelect({ roomMode: 'solo', difficulty: 'HARD', onDifficulty: () => {}, onClose: () => {}, onCreate: () => {}, online: true });
  const body = byClass(v, 'proto__body')[0];
  assert.equal(find(body, (x) => typeof x.type === 'function' && x.type.name === 'ProtoFit').length, 1);
  const more = byClass(v, 'proto-brief__more')[0];
  assert.ok(byClass(more, 'proto-brief__effects')[0].props.children.length > 0, 'the chosen difficulty\'s effects');
  assert.equal(byClass(more, 'proto-brief__meta').length, 1);
  assert.match(base, /\n\.proto-list \{[^}]*gap: \.1rem;\n {2}padding: \.07rem \.06rem \.07rem \.5rem;/);
  assert.match(base, /\n\.pcard \{[^}]*padding: \.08rem \.26rem \.09rem;/);
  // re-fitted at every render, on the list's resize and on every font load (late web fonts make the lines taller)
  assert.match(lobbySrc, /body\.dataset\.fit = pickCardFit\(\(level\) => \{ body\.dataset\.fit = level; return list\.scrollHeight > list\.clientHeight \+ 1; \}\);/);
  assert.match(lobbySrc, /useLayoutEffect\(fit\);/);
  assert.match(lobbySrc, /ro\?\.observe\(list\);/);
  assert.match(lobbySrc, /fonts\?\.addEventListener\?\.\('loadingdone', refit\);/);
  assert.match(lobbySrc, /fonts\?\.removeEventListener\?\.\('loadingdone', refit\);/);
  assert.match(lobbyCss, /\[ASSUMED\] the levels and the sizes/);
  assert.match(lobbyCss, /\[ASSUMED\] the label's caps \*\//);
  assert.match(lobbyCss, /\[ASSUMED\] the spacing \*\//);
  assert.match(lobbyCss, /\[ASSUMED\] the\n {3}floor \*\//);
});

test('the room\'s 开始模拟 / 准备就绪 (screens/room.js GoButton, `.proto-start rs-go`) chooses its own label (§35.18 review: 选择模拟协议\'s wrapping label reached it, and its fixed 46 px on a phone cut every line)', () => {
  const css = roomCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = css.indexOf('@media (max-height: 520px) {');
  const base = css.slice(0, at);
  // like the dialog's: wraps onto a second line (the button grows from .proto-start's min-height), .46rem at most; the
  // mark's rook and its STRONGHOLD PROTOCOL capped so 「Simulation」 has a line of its own in a 960 px window at 特大
  assert.match(base, /\n\.rs-go \.proto-start__label \{ flex: 1 1 auto; padding-right: 8%; font-size: min\(calc\(\.4 \* var\(--t\)\), \.46rem\); white-space: normal; line-height: 1\.1; \}/);
  assert.match(base, /\n\.rs-go \.proto-start__rook \{ font-size: min\(calc\(\.36 \* var\(--t\)\), \.4rem\); \}/);
  assert.match(base, /\n\.rs-go \.proto-start__mark small \{ font-size: min\(calc\(\.08 \* var\(--t\)\), \.1rem\); \}/);
  // on a short screen: at least 46 px and taller for the second line (it was a fixed 46 px), the label 18–20 px at 小 / 中 and a px more a step above (it was
  // .46 × --t, 40 px at 特大)
  let end = css.indexOf('{', at) + 1;
  for (let depth = 1; depth > 0 && end < css.length; end++) { if (css[end] === '{') depth++; else if (css[end] === '}') depth--; } // loop-cap: the stylesheet's length
  const short = css.slice(at, end);
  assert.match(short, /\.rs-go\.proto-start \{ height: auto; min-height: 46px; \}/);
  assert.doesNotMatch(short, /\.rs-go\.proto-start \{ height: 46px; \}/);
  assert.match(short, /\.rs-go \.proto-start__label \{ font-size: min\(calc\(\.46 \* var\(--t\)\), calc\(20px \+ var\(--t-step\)\)\); \}/);
  assert.match(short, /\.rs-go \.proto-start__mark \{ display: none; \}/);
  // the markup the rules rely on
  const room = readFileSync(path.join(ROOT, 'public/js/screens/room.js'), 'utf8');
  assert.match(room, /class=\$\{`proto-start rs-go\$\{ready \? ' is-ready' : ''\}`\}/);
  assert.match(room, /<span class="proto-start__label">/);
  assert.match(roomCss, /\[ASSUMED\] the caps \*\//);
  assert.match(roomCss, /\[ASSUMED\] the cap \*\//);
});

test('选择同盟方式 on a short screen (§35.18 leftover: the key field\'s placeholder ran under 观战 at 特大): the field\'s name as the placeholder, capped sizes', async () => {
  const field = (props) => find(ally(props), (x) => x.type === TextField)[0];
  assert.equal(field({}).props.placeholder, '输入同盟密钥 / 粘贴邀请链接', 'the whole sentence on a taller screen');
  assert.equal(field({}).props.placeholderShort, '同盟密钥', '… the field\'s name where it does not fit the field (TextField, by its width)');
  assert.equal(field({ short: true }).props.placeholder, '同盟密钥', 'the field\'s name on a short one');
  assert.equal(field({ short: true }).props.ariaLabel, '同盟密钥');
  const short = shortBlock();
  assert.match(short, /\.ally-key input::placeholder \{ font-size: clamp\(11px, calc\(\.26 \* var\(--t\)\), 13px\); \}/);
  assert.match(short, /\.ally-key__spec \{ font-size: min\(calc\(\.26 \* var\(--t\)\), 14px\); \}/, '观战 capped');
  assert.match(lobbyCss, /\.ally-key input \{[^}]*text-overflow: ellipsis;/, 'an ellipsis, never a cut, should a pack\'s name still be longer');
  // the lobby asks the same query as the stylesheet's block, kept current (a rotation)
  const dev = await import('../../public/js/ui/device.js');
  assert.equal(dev.SHORT_SCREEN_QUERY, '(max-height: 520px)');
  assert.ok(lobbyCss.includes(`@media ${dev.SHORT_SCREEN_QUERY} {`));
  assert.equal(typeof dev.useMediaQuery, 'function');
  assert.match(lobbySrc, /const shortScreen = useMediaQuery\(SHORT_SCREEN_QUERY\);/);
  assert.match(lobbySrc.match(/<\$\{AllianceSelect\}[\s\S]*? \/>/)[0], /short=\$\{shortScreen\} \/>$/);
  assert.match(readFileSync(path.join(ROOT, 'public/js/ui/device.js'), 'utf8'), /m\.addEventListener\('change', sync\); return \(\) => m\.removeEventListener\('change', sync\);/);
});

test('the hub keeps its text whole (§35.18 review: English 「Solo / Team Simulation」 cut by the cards at 小): the name wraps in a card that follows 文字大小, the plate labels wrap beside their glyph, the title follows 文字大小 while it fits on one line; on a short screen 128 px cards and caps that still grow a step', () => {
  const css = lobbyCss.replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (sel) => css.match(new RegExp(`\\n${sel.replace(/[.*()]/g, '\\$&')} \\{[^}]*\\}`))?.[0] || '';
  // the card, its icon and its name follow 文字大小 together (review: the names had been pinned at 小's .3rem)
  assert.match(css, /\.lobby-hub \{ --hub-entry-w: calc\(2\.3 \* var\(--t\)\);/);
  assert.match(rule('.hub-entry__name'), /font-size: calc\(\.3 \* var\(--t\)\);[^}]*line-height: 1\.1;/);
  assert.doesNotMatch(rule('.hub-entry__name'), /nowrap/, 'the name wraps between words');
  assert.match(rule('.hub-entry'), /min-height: calc\(1\.34 \* var\(--t\)\);/);
  assert.doesNotMatch(rule('.hub-entry'), /[^-]height: 1\.34rem/, 'the card grows for a second line');
  assert.match(rule('.hub-entry'), /flex: 1 0 auto;/, 'both cards the taller one\'s height');
  assert.match(rule('.hub-entries'), /align-items: stretch;/);
  assert.match(rule('.hub-entry__icon .icon'), /width: calc\(\.42 \* var\(--t\)\);/);
  // the text stays below the icon (the card's top padding is the icon's offset, height and a gap), not beside it (review of
  // the review: a padding beside it wrapped 「ALLIANCE / SIMULATION」 in Chinese at 小, which never reached the icon)
  assert.match(rule('.hub-entry'), /padding-top: calc\(\.12rem \+ \.42 \* var\(--t\) \+ \.04rem\);/, 'the text below the icon');
  assert.doesNotMatch(rule('.hub-entry__en'), /padding-right/);
  // Korean breaks between words (review: 「독립 시뮬레이|션」)
  assert.match(css, /\.lobby-hub:lang\(ko\) \.hub-stage \{ word-break: keep-all; overflow-wrap: break-word; \}/);
  assert.match(css, /\.lobby-hub:lang\(ja\) \.hub-stage \{ line-break: strict; \}/, 'no line starts with a small kana or ー');
  // a last line not a single character: `pretty` on the tips, the protocol dialog's paragraphs and its big button's label;
  // not on the whole lobby nor every dialog (WebKit's `pretty` adds lines to short labels; the other
  // dialogs not measured); the dialogs' Japanese strict as the room's and the hub's (§35.18 review of the review). The
  // room's big button shares the label's class and wraps plainly: in Safari `pretty` broke its 「シミュレー|ション開始」
  // at 小 on the phones (review of 6f34f380)
  assert.match(css, /\.tips__text, \.proto-brief p, \.proto-hint, \.proto-foot \.proto-start__label \{ text-wrap: pretty; \}/);
  assert.doesNotMatch(css, /\.proto-start__label[^{]*\{[^}]*text-wrap: balance/, 'balance broke 「シミュレー|ション開始」');
  // every rule of lobby.css and room.css, the first in a block and back-to-back ones too (a pattern that consumed the
  // previous rule's `}` saw every second rule only; review of 7aa59703): no `text-wrap` on the room's button, on anything
  // inside it, nor on an ancestor it would inherit it from (the footer's right cell, the footer, the whole room)
  const roomCss = readFileSync(path.join(ROOT, 'public/css/screens/room.css'), 'utf8');
  for (const [file, src] of [['lobby.css', css], ['room.css', roomCss]]) {
    const all = [...cssRules(src)];
    const plain = src.replace(/\/\*[\s\S]*?\*\//g, '');
    const blocks = (plain.match(/\{/g) || []).length - (plain.match(/@[a-z-]+[^{;]*\{/g) || []).length;
    assert.equal(all.length, blocks, `${file}: every rule seen (${all.length} of ${blocks})`);
    for (const [sel, body] of all) {
      if (!/text-wrap/.test(body)) continue;
      for (const x of sel.split(',')) assert.ok(!wrapsRoomGo(x), `${file}: the room's button wraps plainly: ${x.trim()}`);
    }
  }
  // the scan itself: a rule after another, the first in an @media block, an ancestor's text-wrap
  for (const bad of ['.rs-go .proto-start__label { text-wrap: pretty; }', '.proto-start__label { text-wrap: pretty; }',
    '.rs-go { text-wrap: balance; }', '.rs-foot__right { text-wrap: pretty; }', '.room-bar .rs-go span { text-wrap: pretty; }']) {
    for (const src of [`a{x:1}\n${bad}\nb{y:2}`, `@media (max-height: 520px) {\n  ${bad}\n  b{y:2}\n}`, bad]) {
      assert.ok([...cssRules(src)].some(([sel, body]) => /text-wrap/.test(body) && sel.split(',').some(wrapsRoomGo)), `caught: ${src}`);
    }
  }
  assert.ok(![...cssRules('.proto-foot .proto-start__label { text-wrap: pretty; } .rs-hint { text-wrap: pretty; }')]
    .some(([sel, body]) => /text-wrap/.test(body) && sel.split(',').some(wrapsRoomGo)), 'the dialog\'s button and the room\'s paragraphs may');
  // 选择同盟方式's Japanese note breaks between phrases (Chrome; 「…教えてもらう|か、招待リンク…」 at 特大)
  assert.match(css, /\.ally-recent:lang\(ja\) \{ word-break: auto-phrase; \}/);
  assert.doesNotMatch(css, /\.lobby-screen \{ text-wrap/);
  const comp = readFileSync(path.join(ROOT, 'public/css/components.css'), 'utf8');
  assert.doesNotMatch(comp, /\.modal__box \{ text-wrap/);
  assert.match(comp, /\.modal__box:lang\(ja\) \{ line-break: strict; \}/);
  assert.match(rule('.lobby-hub .hub-plate'), /min-height: \.7rem;/, 'a plate grows for a second line');
  const label = rule('.hub-plate__label, .lobby-hub .hub-plate .btn__label');
  assert.doesNotMatch(label, /ellipsis|nowrap/);
  assert.match(label, /flex: 1 1 0; min-width: min-content;/, 'the label wraps beside its glyph, only the tag drops');
  // the title: one line beside the side columns, following 文字大小 (review: pinned at 小's .56rem / .46rem)
  assert.match(css, /font-size: min\(calc\(\.56 \* var\(--t\)\), calc\(\(100vw - 9\.52rem\) \/ 8\.2\)\);/);
  assert.match(css, /\n\.hub-center__title--latin \{ font-size: min\(calc\(\.46 \* var\(--t\)\), calc\(\(100vw - 9\.52rem\) \/ 20\.2\)\); \}/);
  assert.doesNotMatch(rule('.hub-center__title'), /\.56rem\)/);
  // the top bar's ping grows here, not everywhere (review: the global min-height outgrew title.css's own height)
  assert.match(css, /\.lobby-hub > \.topbar \.ping \{ height: auto; min-height: \.32rem;/);
  const short = shortBlock();
  assert.match(short, /\.lobby-hub \{ --hub-entry-w: max\(2\.1rem, 128px\); \}/);
  assert.match(short, /\.hub-entry \{ min-height: max\(1\.1rem, 64px\); padding: \.1rem \.14rem; \}/, 'no room above the text on a phone');
  assert.match(short, /\.hub-entry \{ width: calc\(var\(--hub-entry-w\) \+ 7 \* max\(0px, var\(--t-step\)\)\); \}/);
  assert.match(short, /\.lobby-hub \.hub-plate \{ font-size: min\(calc\(\.3 \* var\(--t\)\), calc\(18px \+ var\(--t-step\)\)\); \}/);
  assert.match(short, /\.hub-entry__en \{ padding-right: \.44rem; font-size: min\(calc\(\.16 \* var\(--t\)\), calc\(10px \+ var\(--t-step\)\)\);/);
  assert.match(short, /\.hub-entry__name \{ font-size: min\(calc\(\.42 \* var\(--t\)\), calc\(18px \+ var\(--t-step\)\)\); \}/);
  assert.match(readFileSync(path.join(ROOT, 'public/css/theme.css'), 'utf8'), /:root \{ --t-step: calc\(\(var\(--t\) - 64px\) \/ 12\); \}/);
});

test('official versions (DESIGN §35.23): the cards of the version shown, the wait while it loads, room.create names the version', () => {
  // 第一期 / 第二期上半 offer three difficulties: the cards follow (versions.js offeredDifficulties)
  const three = proto({ difficulty: 'HARD', difficulties: ['FUNNY', 'NORMAL', 'HARD'] });
  assert.deepEqual(byClass(three, 'diff-card').map((c) => c.props.style.match(/--d-color:(#\w+)/)[1]).length, 3);
  assert.equal(byClass(three, 'diff-card').filter((c) => hasClass(c, 'is-selected')).length, 1);
  const waiting = proto({ difficulty: 'FUNNY', loading: true });
  assert.ok(find(waiting, (x) => x.props?.['data-testid'] === 'proto-loading').length, 'a spinner while the version loads');
  assert.ok(byClass(waiting, 'diff-card').every((c) => c.props.disabled === true), 'the cards wait');
  assert.equal(buttons(waiting).find((b) => hasClass(b, 'proto-start')).props.disabled, true, 'so does 开始独立模拟');
  // the version set failed its check: 版本数据校验失败 + 重试 instead of the spinner, the cards still wait
  const failed = proto({ difficulty: 'FUNNY', loading: true, failed: true });
  const byId = (tree, id) => find(tree, (x) => x.props?.['data-testid'] === id);
  assert.equal(byId(failed, 'proto-failed').length, 1);
  assert.ok(textOf(byId(failed, 'proto-failed')[0]).includes('版本数据校验失败'));
  assert.equal(byId(failed, 'proto-retry').length, 1, '重试');
  assert.equal(byId(failed, 'proto-loading').length, 0, 'no spinner');
  assert.ok(byClass(failed, 'diff-card').every((c) => c.props.disabled === true));
  // the lobby: the version only on a server that enables versions; the shown difficulty (the fallback) is the one sent
  assert.match(lobbySrc, /mode, difficulty: mode === 'solo' \? shownSolo : shownCoop, \.\.\.\(testMode && asTest \? \{ test: true \} : \{\}\), \.\.\.\(versions \? \{ version \} : \{\}\),\n {4}\.\.\.\(mode === 'solo' && soloFree && soloTimed === true \? \{ soloUnlimited: true \} : \{\}\),/);
  assert.match(lobbySrc, /const shownSolo = fallbackDifficulty\(solo, difficulty\);/);
  assert.match(lobbySrc, /const pickDifficulty = \(d\) => \{ setDifficulty\(d\); savePref\('lobby\.difficulty', d\); \};/, 'the pref changes only on a pick');
  assert.match(lobbySrc, /<\$\{VersionSwitch\} \/>\s*<\$\{ResumeMatchButton\} \/>/, 'the chip before 恢复本机对局');
  assert.match(lobbySrc, /data-testid="hub-version"/);
});

test('统计数据 replay wait (screens/stats.js ReplayWait): 返回统计 always, 重试 for a failed set outside a room, the line of each case', () => {
  const byId = (tree, id) => find(tree, (x) => x.props?.['data-testid'] === id);
  const back = [];
  const base = { version: 'act1autochess', otherInRoom: false, offered: true, failed: false, inRoom: false, onBack: () => back.push(1) };
  const loading = ReplayWait(base);
  assert.equal(find(loading, (x) => x.type?.name === 'Spinner').length, 1, 'a spinner while the version loads');
  assert.ok(textOf(loading).includes('正在载入「第一期下半」的数据…'), textOf(loading));
  assert.equal(byId(loading, 'stats-replay-retry').length, 0);
  byId(loading, 'stats-replay-back')[0].props.onClick();
  assert.deepEqual(back, [1], '返回统计');
  const unoffered = ReplayWait({ ...base, offered: false });
  assert.ok(textOf(unoffered).includes('这台服务器没有提供「第一期下半」，不能回看该局结算'));
  assert.equal(find(unoffered, (x) => x.type?.name === 'Spinner').length, 0);
  assert.equal(byId(unoffered, 'stats-replay-back').length, 1);
  const failed = ReplayWait({ ...base, failed: true });
  assert.ok(textOf(failed).includes('版本数据校验失败'));
  assert.equal(byId(failed, 'stats-replay-retry').length, 1, '重试 outside a room');
  assert.equal(byId(ReplayWait({ ...base, failed: true, inRoom: true }), 'stats-replay-retry').length, 0, 'no 重试 in a room (the room decides)');
  const room = ReplayWait({ ...base, otherInRoom: true, inRoom: true });
  assert.ok(textOf(room).includes('同盟中的数据由房间的版本决定，离开同盟后才能回看「第一期下半」的结算'));
  assert.equal(byId(room, 'stats-replay-back').length, 1);
});

test('卫戍成就 (screens/stats.js BondAchievement): a peak of another version shows its alliance, never its lineup drawn with the data on screen', () => {
  // 第一期下半's chess_char_1_02_a is 讯使; on 第二期下半's data the same id is 角峰 (and its items are other items)
  const peak = {
    record: { id: 'r1', version: 'act1autochess' },
    player: { lineup: [{ id: 'chess_char_1_02_a', tier: 1, items: ['chess_item_1_02_e_a'] }], bonds: [{ bondId: 'yanShip', active: true, layers: 12 }] },
    bond: { bondId: 'yanShip', layers: 12 },
  };
  const looked = [];
  const gd = { m: null, bond: () => null, chess: (id) => { looked.push(id); return null; }, item: (id) => { looked.push(id); return null; } };
  const ops = (tree) => find(tree, (x) => x.type?.name === 'AchievementOperator');
  const other = BondAchievement({ peak, gd });
  assert.equal(ops(other).length, 0, 'no operator of the lineup is drawn');
  const line = find(other, (x) => x.props?.['data-testid'] === 'achievement-other-version');
  assert.equal(line.length, 1);
  assert.ok(textOf(line).includes('切换到「第一期下半」查看'), textOf(line));
  assert.ok(find(other, (x) => x.type?.name === 'BondGlyph' && x.props.bondId === 'yanShip').length >= 1, 'the alliance stays');
  // the same version: the lineup is drawn (and nothing of another version's line)
  const firstData = { ...gd, config: { version: { id: 'act1autochess' } } };
  const same = BondAchievement({ peak, gd: firstData });
  assert.equal(ops(same).length, 1);
  assert.equal(find(same, (x) => x.props?.['data-testid'] === 'achievement-other-version').length, 0);
  // a record without a version is 第二期下半's
  const def = BondAchievement({ peak: { ...peak, record: { id: 'r2' } }, gd });
  assert.equal(ops(def).length, 1);
  const trimmed = BondAchievement({ peak: { ...peak, player: { ...peak.player, lineup: null } }, gd: firstData });
  assert.equal(ops(trimmed).length, 0);
  assert.equal(find(trimmed, (x) => x.props?.['data-testid'] === 'achievement-other-version').length, 0, 'a trimmed same-version record needs no switch');
  assert.deepEqual(looked, [], 'drawn as vnodes only: nothing looked up here');
});
