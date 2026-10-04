// GitHub issue #8 item 1 (v0.1.1): "选策略时没法返回查看禁用的干员和盟约" — once the match moved on from the briefing to the
// strategy draft there was no way to see the disabled bonds and the banned operators again, though players choose a
// strategy partly by them. ui/matchInfo.js is now the one implementation of the briefing's bond rows (greyed: the drawn
// set D and the mode's static inactive bonds; the banned-member badge; briefingBondTip), the legend and the 本局禁用干员
// grid (by tier): the briefing renders it (MatchInfo), the draft's 本局信息 dialog renders the same blocks
// (MatchInfoDialog), and the in-game 本局信息 tab reads the same model (matchInfoModel). The dialog's status line repeats
// the turn and its countdown (bandDraft.js draftInfoStatus) and a turn change closes it. Browser: test/ui/match-info.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

globalThis.fetch = async (url) => {
  const name = String(url).split('/').pop();
  try {
    const body = readFileSync(path.join(ROOT, 'data', name), 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(body) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};

const { matchInfoModel, MatchBondRow, MatchLegend, BannedOperators, MatchInfo, MatchInfoDialog } = await import('../../public/js/ui/matchInfo.js');
const { briefingBondTip } = await import('../../public/js/ui/gameLogic.js');
const { BondDisc, Tooltip, Modal, Button } = await import('../../public/js/ui/components.js');
const { UnitThumb } = await import('../../public/js/ui/gameComponents.js');
const { draftInfoStatus } = await import('../../public/js/screens/bandDraft.js');
const { data, getMode } = await import('../../public/js/data.js');
const { DATA, makeMatch } = await import('../match/harness.js');

await data.loadAll('chess', 'bonds', 'assets', 'config');
const SRC = (modeId) => ({ bonds: data.list('bonds'), chess: (id) => data.lookup('chess', id), mode: getMode(modeId) });

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && !v.props?.children) return;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const textOf = (v) => [...walk(v)].flatMap((n) => (Array.isArray(n.props?.children) ? n.props.children : [n.props?.children])).filter((x) => typeof x === 'string' || typeof x === 'number').join('');
const OFF_FUNNY = ['lateranoShip', 'egirShip', 'kazimierzShip', 'skillfulShip', 'arcaneShip', 'miraShip', 'investShip', 'raidShip', 'soloShip', 'suntShip'];

// a synthetic match: 萨尔贡 + 坚守 drawn (D), 奥术 switched off by the mode, banned operators out of tier order + an unknown id
const PUB = {
  modeId: 'mode_multi_hard', drawnDisabledBonds: ['sargonShip', 'steadShip'], disabledBonds: ['arcaneShip', 'sargonShip', 'steadShip'],
  bannedChess: ['chess_char_5_02_a', 'chess_char_1_17_a', 'chess_nope_a', 'chess_char_3_09_a', 'chess_char_1_02_a'],
};
const MODE = { inactiveBondIds: ['arcaneShip'] };
const model = () => matchInfoModel(PUB, { bonds: data.list('bonds'), chess: (id) => data.lookup('chess', id), mode: MODE });

test('matchInfoModel: the two greyed kinds, the briefing order, banned operators by tier (known only), banned members per bond', () => {
  const m = model();
  assert.deepEqual([...m.sets.drawn].sort(), ['sargonShip', 'steadShip'], 'D = drawnDisabledBonds minus the static list');
  assert.deepEqual([...m.sets.off], ['arcaneShip'], 'the mode\'s inactive bonds');
  assert.equal(m.stateOf('arcaneShip'), 'off');
  assert.equal(m.stateOf('sargonShip'), 'drawn');
  assert.equal(m.stateOf('yanShip'), null);
  // bondOrder, then identifier: 调和 (bondOrder 1) leads the add-on row as in the official briefing
  assert.deepEqual(m.core.map((b) => b.name), ['炎', '萨尔贡', '维多利亚', '谢拉格', '拉特兰', '阿戈尔', '叙拉古', '卡西米尔']);
  assert.equal(m.addon[0].name, '调和');
  assert.equal(m.core.length + m.addon.length, Object.keys(DATA.bonds).length, 'every bond, once');
  assert.ok(m.core.every((b) => b.isCore) && m.addon.every((b) => !b.isCore));
  // tiers 1, 1, 3, 5 — ties keep the server's order; the unknown id is dropped
  assert.deepEqual(m.banned, ['chess_char_1_17_a', 'chess_char_1_02_a', 'chess_char_3_09_a', 'chess_char_5_02_a']);
  assert.equal(m.perBond.get('arcaneShip'), 2, '深靛 + 海霓');
  assert.equal(m.perBond.get('preciShip'), 2, '深靛 + 缇缇');
  assert.equal(m.perBond.get('yanShip'), 0);
  // an older payload without drawnDisabledBonds: disabledBonds minus the static list
  const old = matchInfoModel({ disabledBonds: ['arcaneShip', 'sargonShip'] }, { bonds: data.list('bonds'), chess: (id) => data.lookup('chess', id), mode: MODE });
  assert.deepEqual([...old.sets.drawn], ['sargonShip']);
  // nothing loaded yet: empty, never throws
  const empty = matchInfoModel(null);
  assert.deepEqual([empty.bonds.length, empty.banned.length, empty.sets.drawn.size, empty.sets.off.size], [0, 0, 0, 0]);
});

test('MatchBondRow: greyed by state (✕ disc), the banned-member badge, the red ring on an enabled bond that lost members, the tip', () => {
  const m = model();
  const row = MatchBondRow({ title: '附加盟约', micro: 'ADD-ON BONDS', bonds: m.addon, model: m });
  assert.match(textOf(row), /附加盟约ADD-ON BONDS/);
  const cell = (id) => [...walk(row)].find((v) => v.props?.['data-bond'] === id);
  const disc = (id) => [...walk(cell(id))].find((v) => v.type === BondDisc);
  const badge = (id) => [...walk(cell(id))].find((v) => hasClass(v, 'brief-bond__ban'));
  const tipOf = (id) => [...walk(row)].find((v) => v.type === Tooltip && v.key === id);
  // 奥术: switched off by the mode — greyed, ✕, no tier, badge 2, tip 本局禁用
  assert.ok(hasClass(cell('arcaneShip'), 'is-off') && !hasClass(cell('arcaneShip'), 'is-incomplete'));
  assert.deepEqual([disc('arcaneShip').props.disabled, disc('arcaneShip').props.active, disc('arcaneShip').props.tier], [true, false, 0]);
  assert.match(textOf(badge('arcaneShip')), /^2$/);
  assert.equal(tipOf('arcaneShip').props.text, '奥术：本局禁用（该盟约不会激活）');
  // 坚守: drawn (D) — greyed as well, marked incomplete, the 阵容不完整 tip
  assert.ok(hasClass(cell('steadShip'), 'is-off') && hasClass(cell('steadShip'), 'is-incomplete'));
  assert.equal(tipOf('steadShip').props.text, briefingBondTip('坚守', 'drawn', m.perBond.get('steadShip')));
  assert.match(tipOf('steadShip').props.text, /部分盟约所含干员阵容不完整/);
  // 精准: enabled, but 2 of its members are banned — lit disc, red ring (is-partial), badge 2
  assert.ok(!hasClass(cell('preciShip'), 'is-off') && hasClass(cell('preciShip'), 'is-partial'));
  assert.deepEqual([disc('preciShip').props.disabled, disc('preciShip').props.active], [false, true]);
  assert.match(textOf(badge('preciShip')), /^2$/);
  assert.equal(tipOf('preciShip').props.text, '精准：部分盟约所含干员阵容不完整（2 名干员无法出现）');
  // 助力: untouched — lit, no badge, the plain name
  assert.ok(!hasClass(cell('deputShip'), 'is-off') && !hasClass(cell('deputShip'), 'is-partial'));
  assert.equal(badge('deputShip'), undefined);
  assert.equal(tipOf('deputShip').props.text, '助力');
  assert.equal(disc('deputShip').props.tier, DATA.bonds.deputShip.thresholds.length);
});

test('MatchLegend: the grey and the badge; "或本模式禁用" only when the mode switches bonds off', () => {
  const t = textOf(MatchLegend({ model: model() }));
  assert.match(t, /灰色：部分盟约所含干员阵容不完整（仍可通过其他盟约的干员或装备激活），或本模式禁用 · /);
  assert.match(t, /该盟约中无法出现的干员数$/);
  const hard = matchInfoModel({ drawnDisabledBonds: ['sargonShip'] }, SRC('mode_multi_hard'));
  assert.doesNotMatch(textOf(MatchLegend({ model: hard })), /本模式禁用/);
});

test('BannedOperators: the count and dimmed avatars in tier order; none ⇒ 本局没有禁用干员', () => {
  const m = model();
  const block = BannedOperators({ model: m });
  assert.match(textOf(block), /本局禁用干员BANNED OPERATORS4/);
  const thumbs = [...walk(block)].filter((v) => v.type === UnitThumb);
  assert.deepEqual(thumbs.map((v) => v.props.id), m.banned);
  assert.ok(thumbs.every((v) => v.props.kind === 'chess' && v.props.dim === true && v.props.size === 'sm'));
  const none = BannedOperators({ model: matchInfoModel({}, SRC('mode_single_normal')) });
  assert.match(textOf(none), /本局没有禁用干员/);
  assert.equal([...walk(none)].filter((v) => v.type === UnitThumb).length, 0);
});

test('MatchInfo = 核心盟约, 附加盟约, the legend, 本局禁用干员 (one model); MatchInfoDialog = the same in a Modal with 关闭 and the status line', () => {
  const m = model();
  const parts = MatchInfo({ model: m }).filter((v) => v && typeof v === 'object');
  assert.deepEqual(parts.map((v) => v.type), [MatchBondRow, MatchBondRow, MatchLegend, BannedOperators]);
  assert.deepEqual(parts.slice(0, 2).map((v) => [v.props.title, v.props.bonds]), [['核心盟约', m.core], ['附加盟约', m.addon]]);
  assert.ok(parts.every((v) => v.props.model === m));
  const onClose = () => {};
  const dlg = MatchInfoDialog({ open: true, onClose, model: m, status: '轮到你决策' });
  assert.equal(dlg.type, Modal);
  assert.equal(dlg.props.open, true);
  assert.equal(dlg.props.onClose, onClose, 'Esc and a tap outside close it (components.js Modal)');
  assert.equal(dlg.props.title, '本局信息');
  assert.equal(dlg.props.class, 'minfo-dlg');
  const inner = [...walk(dlg.props.children)].find((v) => v.type === MatchInfo);
  assert.equal(inner?.props.model, m, 'the very blocks of the briefing');
  const close = [...walk(dlg.props.actions)].find((v) => v.type === Button);
  assert.equal(close.props.onClick, onClose);
  assert.match(textOf(close), /关闭/);
  assert.match(textOf(dlg.props.actions), /轮到你决策/);
  const shut = MatchInfoDialog({ open: false, onClose, model: m });
  assert.equal(shut.props.open, false);
  assert.equal([...walk(shut.props.children)].find((v) => v.type === MatchInfo), undefined, 'nothing built while closed');
  assert.equal(MatchInfoDialog({ open: true, onClose, model: null }).props.open, false, 'no model: stays closed');
});

test('a real 标准 match (solo and co-op): the mode\'s 10 inactive bonds are "off", banned operators are exactly the server\'s, by tier', () => {
  for (const [mode, modeId] of [['solo', 'mode_single_funny'], ['coop', 'mode_multi_funny']]) {
    const h = makeMatch({ mode, difficulty: 'FUNNY', humans: 1, seed: 11 }).start();
    const pub = h.m.publicView();
    assert.equal(pub.modeId, modeId);
    const m = matchInfoModel(pub, SRC(pub.modeId));
    assert.deepEqual([...m.sets.off].sort(), [...OFF_FUNNY].sort(), `${modeId}: 标准模拟's inactiveBondIdList`);
    assert.equal(m.sets.drawn.size, 1, '标准 draws one add-on bond');
    assert.ok([...m.sets.drawn].every((b) => !OFF_FUNNY.includes(b) && !DATA.bonds[b].isCore));
    assert.deepEqual([...m.banned].sort(), [...pub.bannedChess].sort(), 'every banned operator is known');
    assert.deepEqual(m.banned.map((id) => DATA.chess[id].tier), [...m.banned.map((id) => DATA.chess[id].tier)].sort((a, b) => a - b));
    for (const id of m.banned) assert.ok(DATA.chess[id].bonds.every((b) => m.stateOf(b)), `${id}: every bond greyed`);
    assert.equal(m.addon.filter((b) => m.stateOf(b.bondId)).length + m.core.filter((b) => m.stateOf(b.bondId)).length, 11);
    assert.match(textOf(MatchLegend({ model: m })), /或本模式禁用/);
    h.m.dispose();
  }
  // 绝境: 3 core + 4 add-on drawn, nothing switched off by the mode
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, bots: 1, seed: 4 }).start();
  const m = matchInfoModel(h.m.publicView(), SRC('mode_multi_hard'));
  assert.equal(m.sets.off.size, 0);
  assert.deepEqual([m.core.filter((b) => m.stateOf(b.bondId)).length, m.addon.filter((b) => m.stateOf(b.bondId)).length], [3, 4]);
  assert.deepEqual([...m.banned].sort(), [...h.m.bannedChess].sort());
  h.m.dispose();
});

test('draftInfoStatus: the dialog repeats the turn and its seconds (warning at ≤ 10 s), or my pick', () => {
  assert.deepEqual(draftInfoStatus({ myTurn: true, secs: 24 }), { text: '轮到你决策', secs: 24, tone: 'gold' });
  assert.deepEqual(draftInfoStatus({ myTurn: true, secs: 7 }), { text: '轮到你决策', secs: 7, tone: 'warn' });
  assert.deepEqual(draftInfoStatus({ myTurn: false, turnName: '凯尔希', secs: 30 }), { text: '凯尔希 决策中', secs: 30, tone: 'gold' });
  assert.deepEqual(draftInfoStatus({ myTurn: true, secs: null }), { text: '轮到你决策', secs: null, tone: 'gold' }, 'untimed: no seconds');
  assert.deepEqual(draftInfoStatus({ myTurn: false, turnName: null }), { text: '等待轮到你', secs: null, tone: 'dim' });
  assert.deepEqual(draftInfoStatus({ myPick: 'band_bldsk', pickName: '华法琳', myTurn: false, waiting: true }),
    { text: '已选择「华法琳」，等待其他博士', secs: null, tone: 'mint' });
  assert.equal(draftInfoStatus({ myPick: 'band_bldsk', pickName: '华法琳', myTurn: false }).text, '已选择「华法琳」');
});

test('the briefing, the strategy draft and the in-game 本局信息 tab all read ui/matchInfo.js (no second copy to drift)', () => {
  const brief = read('public/js/screens/briefing.js');
  assert.match(brief, /import \{ MatchInfo, matchInfoModel \} from '\.\.\/ui\/matchInfo\.js';/);
  assert.match(brief, /<section class="brief__right">\s*<\$\{MatchInfo\} model=\$\{info\} \/>\s*<\/section>/);
  assert.match(brief, /const info = matchInfoModel\(pub, \{ bonds: gd\.list\('bonds'\), chess: gd\.chess, mode \}\);/);
  assert.doesNotMatch(brief, /brief-legend|brief-banned|function BondRow|bannedPerBond|disabledBondSets/, 'no own copy of the blocks');
  const draft = read('public/js/screens/bandDraft.js');
  assert.match(draft, /import \{ MatchInfoDialog, matchInfoModel \} from '\.\.\/ui\/matchInfo\.js';/);
  assert.match(draft, /const info = infoOpen \? matchInfoModel\(pub, \{ bonds: gd\.list\('bonds'\), chess: gd\.chess, mode \}\) : null;/);
  assert.match(draft, /data-testid="match-info-open"[\s\S]*?onClick=\$\{\(\) => setInfoOpen\(true\)\}>\$\{T\('查看禁用盟约与干员'\)\}</);
  assert.match(draft, /<\$\{MatchInfoDialog\} open=\$\{infoOpen\} onClose=\$\{\(\) => setInfoOpen\(false\)\} model=\$\{info\}/);
  // a turn change or my pick closes it; the draft's end unmounts the screen
  assert.match(draft, /const turnKey = `\$\{draft\.turnPid \|\| ''\}\|\$\{myPick \|\| ''\}`;\n\s*useEffect\(\(\) => \{ setInfoOpen\(false\); \}, \[turnKey\]\);/);
  const drawer = read('public/js/ui/enemyDrawer.js');
  assert.match(drawer, /import \{ matchInfoModel \} from '\.\/matchInfo\.js';/);
  assert.match(drawer, /matchInfoModel\(pub, \{\s*bonds: data\.list\('bonds'\), chess: \(id\) => data\.lookup\('chess', id\), mode: data\.get\('config'\)\?\.modes\?\.\[pub\?\.modeId\],/);
  assert.doesNotMatch(drawer, /bannedPerBond|disabledBondSets/, 'the drawer derives nothing on its own');
});
