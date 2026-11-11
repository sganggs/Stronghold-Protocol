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

const { matchInfoModel, MatchBondGroups, MatchBondRow, MatchLegend, BannedOperators, MatchInfo, MatchInfoDialog, regulationCoreAbsent } = await import('../../public/js/ui/matchInfo.js');
const { BondPopup } = await import('../../public/js/ui/bondStrip.js');
const { MatchEnemies, factionDescId, leaderBlockOf } = await import('../../public/js/ui/matchEnemies.js');
const { briefingBondTip } = await import('../../public/js/ui/gameLogic.js');
const { BondDisc, Tooltip, Modal, Button, placeTooltip } = await import('../../public/js/ui/components.js');
const { UnitThumb, Img, RichText, makeLookups } = await import('../../public/js/ui/gameComponents.js');
const { enemyIconUrl, factionIconUrl } = await import('../../public/js/ui/assetUrls.js');
const { setLang, setMessages } = await import('../../shared/i18n.js');
const { draftInfoStatus } = await import('../../public/js/screens/bandDraft.js');
const { data, getMode } = await import('../../public/js/data.js');
const { DATA, makeMatch } = await import('../match/harness.js');

await data.loadAll('chess', 'bonds', 'assets', 'config', 'bosses', 'enemies', 'stages', 'factions');
const SRC = (modeId) => ({ bonds: data.list('bonds'), chess: (id) => data.lookup('chess', id), mode: getMode(modeId) });

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  if (typeof v.type === 'function' && !v.props?.children) return;
  yield* walk(v.props?.children);
}
const hasClass = (v, c) => typeof v?.props?.class === 'string' && v.props.class.split(/\s+/).includes(c);
const textOf = (v) => Array.isArray(v) ? v.map(textOf).join('')
  : typeof v === 'string' || typeof v === 'number' ? String(v) : v && typeof v === 'object' ? textOf(v.props?.children) : '';
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
  // the box beside the tip: one line per banned member (avatar, name, its bonds with this one highlighted); none ⇒ null
  const aside = tipOf('preciShip').props.aside;
  const ops = [...walk(aside)].filter((v) => hasClass(v, 'brief-bantip__op'));
  const bannedPreci = DATA.bonds.preciShip.visibleMembers.filter((id) => PUB.bannedChess.includes(id));
  assert.deepEqual(ops.map((v) => v.props['data-chess']), bannedPreci);
  for (const op of ops) {
    const c = DATA.chess[op.props['data-chess']];
    assert.ok([...walk(op)].some((v) => v.type === UnitThumb && v.props.id === c.chessId));
    assert.match(textOf(op), new RegExp('^' + c.name));
    assert.ok([...walk(op)].some((v) => hasClass(v, 'is-this') && textOf(v) === '精准'));
  }
  assert.equal(tipOf('deputShip').props.aside, null);
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

test('MatchInfoDialog retains the briefing bonds, enemy information, 关闭 and the status line', () => {
  const m = model();
  const parts = MatchInfo({ model: m }).filter((v) => v && typeof v === 'object');
  assert.deepEqual(parts.map((v) => v.type), [MatchBondRow, MatchBondRow, MatchLegend, BannedOperators]);
  assert.deepEqual(parts.slice(0, 2).map((v) => [v.props.title, v.props.bonds]), [['核心盟约', m.core], ['附加盟约', m.addon]]);
  assert.ok(parts.every((v) => v.props.model === m));
  const onClose = () => {};
  const enemies = MatchEnemies({ pub: PUB, gd: makeLookups() });
  const dlg = MatchInfoDialog({ open: true, onClose, model: m, enemies, status: '轮到你决策' });
  assert.equal(dlg.type, Modal);
  assert.equal(dlg.props.open, true);
  assert.equal(dlg.props.onClose, onClose, 'Esc and a tap outside close it (components.js Modal)');
  assert.equal(dlg.props.title, '本局信息');
  assert.equal(dlg.props.class, 'minfo-dlg');
  const inner = [...walk(dlg.props.children)].find((v) => v.type === MatchInfo);
  assert.equal(inner?.props.model, m, 'the very blocks of the briefing');
  assert.match(textOf(dlg.props.children), /本局没有特训敌人/);
  const close = [...walk(dlg.props.actions)].find((v) => v.type === Button);
  assert.equal(close.props.onClick, onClose);
  assert.match(textOf(close), /关闭/);
  assert.match(textOf(dlg.props.actions), /轮到你决策/);
  const shut = MatchInfoDialog({ open: false, onClose, model: m, enemies });
  assert.equal(shut.props.open, false);
  assert.equal([...walk(shut.props.children)].find((v) => v.type === MatchInfo), undefined, 'nothing built while closed');
  assert.equal([...walk(shut.props.children)].find((v) => hasClass(v, 'brief-factions')), undefined, 'enemy information unmounts too');
  assert.equal(MatchInfoDialog({ open: true, onClose, model: null }).props.open, false, 'no model: stays closed');
});

test('#484: enemy information uses this match\'s announced leader, abilities, battlefield and special enemy types', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', humans: 1, seed: 4 }).start();
  try {
    const pub = h.m.publicView();
    const gd = makeLookups();
    const boss = gd.boss(pub.bossId);
    const nodes = [...walk(MatchEnemies({ pub, gd }))];
    assert.ok(boss, 'the real match has an announced leader');
    assert.equal(textOf(nodes.find(v => hasClass(v, 'brief-boss__name'))), boss.name);
    assert.match(textOf(nodes.find(v => hasClass(v, 'brief-boss__when'))), /第 14 回合 · 最终攻势/);
    assert.equal(nodes.find(v => v.type === Img && v.props.class === 'brief-boss__img').props.src, enemyIconUrl(gd.m, boss.enemyKey));
    assert.deepEqual(nodes.filter(v => v.type === RichText).map(v => v.props.text), boss.abilities.slice(0, 3));
    assert.equal(textOf(nodes.find(v => hasClass(v, 'brief-stage__name'))), gd.stage(pub.stageId).name);
    const factions = nodes.filter(v => hasClass(v, 'brief-faction'));
    assert.deepEqual(factions.map(v => v.props['data-faction']), pub.factions, 'only the announced types, in briefing order');
    // (the maintainer's decision of 2026-10-22: the name under the icon, the description in the tooltip around the cell)
    const tips = nodes.filter(v => v.type === Tooltip);
    assert.equal(tips.length, factions.length, 'one tooltip per special enemy type');
    for (const [i, faction] of factions.entries()) {
      const type = gd.factions.types[faction.props['data-faction']];
      assert.ok(type.desc, `${type.name}: the data has a description`);
      assert.equal(tips[i].props.text, type.desc, `${type.name}: its tooltip says the description`);
      assert.ok([...walk(tips[i].props.children)].includes(faction), 'the tooltip wraps the cell');
      assert.equal(textOf([...walk(faction)].find(v => hasClass(v, 'brief-faction__text'))), type.name, 'the name under the icon');
      assert.equal([...walk(faction)].find(v => v.type === Img).props.src, factionIconUrl(gd.m, type.icon));
    }
  } finally { h.m.dispose(); }
});

test('特训敌人 description in a tooltip only (the maintainer, 2026-10-22): hover / keyboard focus / long press, described for screen readers', () => {
  const pub = { bossId: null, stageId: null, lastRound: 14, factions: ['FLY', 'TIMES'] };
  const gd = makeLookups();
  const nodes = [...walk(MatchEnemies({ pub, gd }))];
  const tips = nodes.filter((v) => v.type === Tooltip);
  assert.deepEqual(tips.map((v) => v.props.text), pub.factions.map((ty) => gd.factions.types[ty].desc), 'the description in the tooltip');
  assert.ok(tips.every((v) => v.props.block === true && v.props.class === 'brief-faction__tt' && v.props.tipClass === 'brief-faction__tip'));
  // the only place the text is shown: readable on a phone (1rem = 40 px there) — the dialog's former 10 px floor
  assert.match(read('public/css/screens/briefing.css'), /\n\.tooltip\.brief-faction__tip \{[^}]*font-size: max\(calc\(\.15 \* var\(--t\)\), 10px\);/);
  const cells = nodes.filter((v) => hasClass(v, 'brief-faction'));
  assert.deepEqual(cells.map((v) => v.props['data-faction']), pub.factions);
  for (const cell of cells) {
    const ty = cell.props['data-faction'];
    const type = gd.factions.types[ty];
    assert.equal(cell.props.title, undefined, 'no native title beside the tooltip');
    assert.equal(cell.props.tabindex, undefined, 'the icon takes the focus, not the cell');
    // the icon: focusable (keyboard focus shows the tooltip), named by the type, described by the text
    const icon = [...walk(cell)].find((v) => hasClass(v, 'brief-faction__icon'));
    assert.deepEqual([icon.props.tabindex, icon.props.role, icon.props['aria-label']], ['0', 'img', type.name]);
    assert.equal(icon.props['aria-describedby'], factionDescId('brief', ty));
    const desc = [...walk(cell)].find((v) => v.props?.id === icon.props['aria-describedby']);
    assert.ok(desc && hasClass(desc, 'sr-only') && hasClass(desc, 'brief-faction__desc'), 'an .sr-only copy for screen readers');
    assert.equal(textOf(desc), type.desc);
    assert.equal(textOf([...walk(cell)].find((v) => hasClass(v, 'brief-faction__text'))), type.name, 'only the name is shown');
  }
  // the draft dialog's copy keeps its own ids
  const dlg = [...walk(MatchEnemies({ pub, gd, idScope: 'minfo' }))].filter((v) => hasClass(v, 'brief-faction__icon'));
  assert.deepEqual(dlg.map((v) => v.props['aria-describedby']), pub.factions.map((ty) => factionDescId('minfo', ty)));
  assert.notEqual(factionDescId('minfo', 'FLY'), factionDescId('brief', 'FLY'));
  // a type without a description: no tooltip text, nothing to point at
  const bare = [...walk(MatchEnemies({ pub: { ...pub, factions: ['NOPE'] }, gd }))];
  assert.equal(bare.find((v) => v.type === Tooltip).props.text, null);
  assert.equal(bare.find((v) => hasClass(v, 'brief-faction__icon')).props['aria-describedby'], undefined);
  assert.equal(bare.filter((v) => hasClass(v, 'brief-faction__desc')).length, 0);
  // the temporary switch and the inline variant are gone (code and CSS)
  const js = read('public/js/ui/matchEnemies.js');
  assert.doesNotMatch(js, /enemyDescMode|ENEMY_DESC_MODES|__SP_ENEMY_DESC__|enemyDesc=|'inline'/);
  for (const f of ['public/css/screens/briefing.css', 'public/css/screens/draft.css']) {
    const css = read(f);
    assert.doesNotMatch(css, /brief-faction__desc|brief-factions--|\.is-tip/, `${f}: no inline description, no variant rules`);
    assert.match(css, /\.brief-faction__icon:focus-visible \{/, `${f}: the focused icon is marked`);
  }
});

test('特训敌人 tooltip at its icon (§35.18 leftover): the cell keeps the triggers, the box points at the icon, inside the dialog, clear of the leader block', () => {
  const pub = { bossId: null, stageId: null, lastRound: 14, factions: ['FLY', 'TIMES', 'SPECIAL'] };
  const tips = [...walk(MatchEnemies({ pub, gd: makeLookups() }))].filter((v) => v.type === Tooltip);
  assert.equal(tips.length, 3);
  for (const tip of tips) {
    assert.equal(tip.props.anchor, '.brief-faction__icon', 'the box points at the icon (in the dialog the cell is a whole row)');
    assert.equal(tip.props.within, '.modal__box', 'inside the 本局信息 dialog (the briefing has none: the screen)');
    assert.equal(tip.props.avoid, leaderBlockOf);
    assert.ok([...walk(tip.props.children)].some((v) => hasClass(v, 'brief-faction')), 'hover / long press anywhere on the cell');
  }
  // the leader block: the portrait with its tag and every line of its text, in the same 本局遭遇敌方 block
  const asked = [];
  const scope = { querySelectorAll: (q) => { asked.push(q); return ['a', 'b']; } };
  assert.deepEqual(leaderBlockOf({ closest: (q) => (q === '.brief-enemy' ? scope : null) }), ['a', 'b']);
  assert.deepEqual(asked, ['.brief-boss, .brief-boss__text > *']);
  assert.deepEqual([...leaderBlockOf({ closest: () => null })], []);

  const R = (left, top, w, h) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
  const box = { width: 160, height: 30 };
  // every other tooltip: the rule as it was — above and centred, flipped at the top edge, clamped into the viewport
  assert.deepEqual(placeTooltip(R(300, 200, 40, 20), box, { vw: 800, vh: 600 }), { top: 162, left: 240, place: 'top' });
  assert.deepEqual(placeTooltip(R(300, 10, 40, 20), box, { vw: 800, vh: 600 }), { top: 38, left: 240, place: 'bottom' });
  assert.deepEqual(placeTooltip(R(2, 200, 40, 20), box, { vw: 800, vh: 600 }), { top: 162, left: 8, place: 'top' });
  // the dialog's first row (667×375): above the icon is the 战场 line (the leader text spans the column) — below the
  // icon, 8 px off it, and inside the dialog's box rather than at the screen's edge
  const dlg = R(30, 10, 600, 350);
  const icon = R(60, 180, 30, 30);
  const leader = [R(40, 40, 70, 90), R(130, 40, 490, 30), R(130, 75, 490, 50), R(130, 140, 490, 20)];
  assert.deepEqual(placeTooltip(icon, box, { vw: 667, vh: 375, bounds: dlg, avoid: leader }), { top: 218, left: 38, place: 'bottom' });
  // the next row: above the icon covers only the row above — above it is
  assert.deepEqual(placeTooltip(R(60, 225, 30, 30), box, { vw: 667, vh: 375, bounds: dlg, avoid: leader }), { top: 187, left: 38, place: 'top' });
  // the briefing (desktop): the leader's name line ends left of the icon but under the centred box — the box slides right
  // past it, still over the icon
  const icon2 = R(400, 120, 50, 50);
  assert.deepEqual(placeTooltip(icon2, box, { vw: 1440, vh: 900, avoid: [R(150, 95, 270, 30)] }), { top: 82, left: 428, place: 'top' });
  // kept inside the dialog: an icon at its right edge
  assert.deepEqual(placeTooltip(R(590, 200, 30, 30), box, { vw: 1440, vh: 900, bounds: dlg, avoid: leader }), { top: 162, left: 462, place: 'top' });
  // no side clean inside the dialog (it ends under the row): out of the dialog, on the screen, rather than over the leader
  const short = R(30, 10, 600, 240);
  assert.deepEqual(placeTooltip(icon, box, { vw: 667, vh: 375, bounds: short, avoid: leader }), { top: 218, left: 8, place: 'bottom' });
  // nor on the screen: the side that fits, covering what it must (the least of the leader block)
  assert.deepEqual(placeTooltip(icon, box, { vw: 667, vh: 240, bounds: short, avoid: leader }), { top: 142, left: 38, place: 'top' });
  // a dialog narrower than the box: the viewport bounds it instead
  assert.equal(placeTooltip(R(100, 200, 30, 30), box, { vw: 800, vh: 600, bounds: R(90, 100, 120, 300) }).left, 35);
  // the components.js wiring: the anchor, the dialog's box and the leader rects are read when the tip opens
  const c = read('public/js/ui/components.js');
  assert.match(c, /const at = \(anchor && el\.querySelector\(anchor\)\) \|\| el;/);
  assert.match(c, /rect: at\.getBoundingClientRect\(\)/);
  assert.match(c, /bounds: box \? box\.getBoundingClientRect\(\) : null, avoid: keepOff,/);
  assert.match(c, /placeTooltip\(tipState\.rect, b, \{ placement: tipState\.placement, vw: window\.innerWidth, vh: window\.innerHeight,\n\s+bounds: tipState\.bounds, avoid: tipState\.avoid \|\| \[\] \}\)/);
});

test('#484: missing enemy data stays readable and UI labels follow the language', () => {
  const pub = { bossId: 'unknown', stageId: 'unknown-stage', lastRound: 9, factions: [] };
  const gd = makeLookups();
  assert.equal(MatchEnemies({ pub: null, gd }), null);
  const empty = MatchEnemies({ pub, gd });
  assert.match(textOf(empty), /未知领袖/);
  assert.match(textOf(empty), /第 9 回合 · 最终攻势/);
  assert.match(textOf(empty), /unknown-stage/);
  assert.match(textOf(empty), /本局没有特训敌人/);
  assert.equal([...walk(empty)].filter(v => hasClass(v, 'brief-faction')).length, 0);
  setMessages('en', JSON.parse(read('public/i18n/en.json')));
  setLang('en');
  try {
    const translated = textOf(MatchEnemies({ pub, gd }));
    assert.match(translated, /Unknown Leader/);
    assert.match(translated, /No Tactical Training Enemies this match/);
    assert.doesNotMatch(translated, /未知领袖|本局没有特训敌人/);
  } finally { setLang('zh'); setMessages('en', {}); }
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
  // (PR #643: the blocks one by one, each in its own section of the one column)
  assert.match(brief, /import \{ MatchBondGroups, MatchBondRow, MatchLegend, BannedOperators, matchInfoModel, MatchBondDialog, regulationCoreAbsent \} from '\.\.\/ui\/matchInfo\.js';/);
  assert.match(brief, /<\$\{MatchBondGroups\} model=\$\{info\} onPick=\$\{pickGroup\} onBond=\$\{setBondId\}/);
  assert.match(brief, /coreAbsent=\$\{regulationCoreAbsent\(info, bondId\)\}/);
  const game = read('public/js/screens/game.js');
  assert.match(game, /coreAbsent=\$\{regulationCoreAbsent\(bondInfo, bondPop\.bondId\)\}/);
  assert.match(brief, /<\$\{MatchBondRow\} title=\$\{t\('附加盟约'\)\} micro="ADD-ON BONDS" bonds=\$\{info\.addon\} model=\$\{info\} onBond=\$\{setBondId\} \/>\s*<\$\{MatchLegend\} model=\$\{info\} \/>/);
  assert.match(brief, /<\$\{BannedOperators\} model=\$\{info\} \/>/);
  // (+ the viewer's 自选 pieces out of the shop: priv / diyData, 0.2.0 WE2)
  assert.match(brief, /const info = matchInfoModel\(pub, \{ bonds: gd\.list\('bonds'\), chess: gd\.chess, mode, priv, diyData: \{ chess: data\.get\('chess'\), backups: data\.get\('backups'\) \} \}\);/);
  assert.doesNotMatch(brief, /brief-legend|brief-banned|function BondRow|bannedPerBond|disabledBondSets/, 'no own copy of the blocks');
  // (#484 / §35.6: the 本局遭遇敌方 section is ui/matchEnemies.js, also the draft dialog's enemy column)
  assert.match(brief, /<section class="brief-sec brief-sec--enemy" style="--i:1">\s*<\$\{MatchEnemies\} pub=\$\{pub\} gd=\$\{gd\} \/>\s*<\/section>/);
  assert.doesNotMatch(brief, /enemyIconUrl|factionIconUrl|brief-boss|brief-faction/, 'no own copy of the enemy section');
  const draft = read('public/js/screens/bandDraft.js');
  assert.match(draft, /import \{ MatchInfoDialog, matchInfoModel, MatchBondDialog, regulationCoreAbsent \} from '\.\.\/ui\/matchInfo\.js';/);
  assert.match(draft, /coreAbsent=\$\{regulationCoreAbsent\(info, bondId\)\}/);
  assert.match(draft, /const info = infoOpen \? matchInfoModel\(pub, \{ bonds: gd\.list\('bonds'\), chess: gd\.chess, mode, priv, diyData: \{ chess: data\.get\('chess'\), backups: data\.get\('backups'\) \} \}\) : null;/);
  // (PR #643: 本局信息 in the step header, beside the difficulty)
  assert.match(draft, /class="stephead__info" data-testid="match-info-open" aria-haspopup="dialog" onClick=\$\{\(\) => setInfoOpen\(true\)\}\n\s+title=\$\{t\('本局信息'\)\}><\$\{Icon\} name="search" \/><span>\$\{t\('本局信息'\)\}<\/span><\/button>/);
  assert.match(draft, /<\$\{MatchInfoDialog\} open=\$\{infoOpen\} onClose=\$\{\(\) => setInfoOpen\(false\)\} model=\$\{info\}/);
  assert.match(draft, /enemies=\$\{infoOpen \? html`<\$\{MatchEnemies\} pub=\$\{pub\} gd=\$\{gd\} idScope="minfo" \/>` : null\}/);
  // a turn change or my pick closes it; the draft's end unmounts the screen
  assert.match(draft, /const turnKey = `\$\{draft\.turnPid \|\| ''\}\|\$\{myPick \|\| ''\}`;\n\s*useEffect\(\(\) => \{ setInfoOpen\(false\); \}, \[turnKey\]\);/);
  const drawer = read('public/js/ui/enemyDrawer.js');
  assert.match(drawer, /import \{ matchInfoModel, DiyBannedLine \} from '\.\/matchInfo\.js';/);
  assert.match(drawer, /matchInfoModel\(pub, \{\s*bonds: data\.list\('bonds'\), chess: \(id\) => data\.lookup\('chess', id\), mode: data\.get\('config'\)\?\.modes\?\.\[pub\?\.modeId\],/);
  assert.doesNotMatch(drawer, /bannedPerBond|disabledBondSets/, 'the drawer derives nothing on its own');
});

test('regulation groups render two choices, disable waiting controls and settle to the normal bond row', () => {
  const pub = { ...PUB, bondDraw: 'regulation', bondChoice: { groups: [['yanShip'], ['sargonShip']], picked: null } };
  const m = matchInfoModel(pub, SRC('mode_single_normal'));
  let picked = null;
  const v = MatchBondGroups({ model: m, onPick: idx => { picked = idx; } });
  assert.match(textOf(v), /可选择一组激活/);
  const buttons = [...walk(v)].filter(v => v.type === Button);
  assert.equal(buttons.length, 2);
  buttons[1].props.onClick();
  assert.equal(picked, 1);
  const blocked = MatchBondGroups({ model: m, onPick() {}, disabled: true });
  assert.ok([...walk(blocked)].filter(v => v.type === Button).every(v => v.props.disabled));
  const settled = MatchBondGroups({ model: { ...m, choice: { ...m.choice, picked: 1 } }, onPick() {} });
  assert.equal(settled.type, MatchBondRow);
  assert.match(textOf(MatchLegend({ model: m })), /灰色核心盟约的所有干员无法出现/);
  assert.equal(briefingBondTip('炎', 'drawn', 10, true), '炎：该核心盟约的所有干员无法出现');
});

test('MatchBondGroups passes onBond to every core disc: both groups, the always-lit rest, the row after the pick, and a match with no choice', () => {
  const seen = [];
  const onBond = (id) => { seen.push(id); };
  const pub = { bondDraw: 'regulation', bondChoice: { groups: [['yanShip'], ['sargonShip']], picked: null }, drawnDisabledBonds: [], disabledBonds: [], bannedChess: [] };
  const m = matchInfoModel(pub, SRC('mode_single_normal'));
  const open = MatchBondGroups({ model: m, onPick() {}, onBond });
  // MatchBondRow is a function component and its vnode has no children, so walk() stops on the row.
  // Calling it is what builds the discs (it uses no hooks).
  const rows = [...walk(open)].filter((v) => v.type === MatchBondRow);
  assert.ok(rows.length >= 3, 'both groups and the cores that sit in neither');
  assert.ok(rows.every((row) => row.props.onBond === onBond));
  const cells = rows.flatMap((row) => [...walk(row.type(row.props))].filter((v) => typeof v.props?.['data-bond'] === 'string' && [...walk(v)].some((x) => x.type === BondDisc)));
  const ids = cells.map((cell) => cell.props['data-bond']);
  assert.ok(ids.includes('yanShip') && ids.includes('sargonShip') && ids.includes('victoriaShip'));
  for (const cell of cells) {
    const disc = [...walk(cell)].find((v) => v.type === BondDisc);
    assert.equal(typeof disc.props.onClick, 'function', cell.props['data-bond']);
    disc.props.onClick();
  }
  assert.deepEqual(seen, ids);
  const settled = MatchBondGroups({ model: { ...m, choice: { ...m.choice, picked: 1 } }, onPick() {}, onBond });
  assert.equal(settled.type, MatchBondRow);
  assert.equal(settled.props.onBond, onBond);
  const plainModel = matchInfoModel({ ...PUB, bondChoice: null }, SRC('mode_multi_hard'));
  const plain = MatchBondGroups({ model: plainModel, onPick() {}, onBond });
  assert.equal(plain.type, MatchBondRow);
  assert.equal(plain.props.onBond, onBond);
  assert.equal(plain.props.bonds, plainModel.core);
});

test('a greyed regulation core card says its operators cannot appear; an unpicked group and an add-on do not', () => {
  const priv = { board: [], hand: [] };
  const card = (model, bondId, entry = null) => textOf(BondPopup({
    bondId, entry, priv, onClose() {}, banned: model.banned,
    off: model.sets.off.has(bondId), coreAbsent: regulationCoreAbsent(model, bondId),
  }));
  const before = matchInfoModel({
    bondDraw: 'regulation', bondChoice: { groups: [['yanShip'], ['sargonShip']], picked: null },
    drawnDisabledBonds: [], disabledBonds: [], bannedChess: [],
  }, SRC('mode_single_normal'));
  assert.equal(regulationCoreAbsent(before, 'yanShip'), false);
  assert.equal(regulationCoreAbsent(before, 'sargonShip'), false);
  const comparing = card(before, 'yanShip', { count: 0, layers: 0, tier: 0, active: false });
  assert.match(comparing, /当前效果/);
  assert.match(comparing, /成员/);
  assert.doesNotMatch(comparing, /该核心盟约的所有干员无法出现/);
  assert.doesNotMatch(comparing, /本模式下该盟约不会激活/);

  const funny = matchInfoModel({
    bondDraw: 'regulation', bondChoice: { groups: [['yanShip'], ['sargonShip']], picked: null },
    drawnDisabledBonds: [], disabledBonds: [], bannedChess: [], modeId: 'mode_single_funny',
  }, SRC('mode_single_funny'));
  assert.equal(funny.stateOf('egirShip'), 'off');
  assert.equal(regulationCoreAbsent(funny, 'egirShip'), true);
  assert.equal(regulationCoreAbsent(funny, 'arcaneShip'), false, 'an add-on keeps the covenant rule');
  const modeOff = card(funny, 'egirShip', { count: 0, layers: 0, tier: 0, active: false });
  assert.match(modeOff, /阿戈尔：该核心盟约的所有干员无法出现/);
  assert.match(modeOff, /当前效果/, 'the covenant off branch, which hides the effect, is not used');
  assert.doesNotMatch(modeOff, /本模式下该盟约不会激活/);
  assert.doesNotMatch(modeOff, /仍可能因所属的其他盟约出现/);
  const addon = card(funny, 'arcaneShip');
  assert.match(addon, /本模式下该盟约不会激活（其干员仍可能因所属的其他盟约出现）/);
  assert.doesNotMatch(addon, /该核心盟约的所有干员无法出现/);
  assert.doesNotMatch(addon, /当前效果/);

  const after = matchInfoModel({
    bondDraw: 'regulation', bondChoice: { groups: [['yanShip'], ['sargonShip']], picked: 0 },
    drawnDisabledBonds: ['sargonShip'], disabledBonds: ['sargonShip'], bannedChess: [],
  }, SRC('mode_single_normal'));
  assert.equal(after.stateOf('sargonShip'), 'drawn');
  assert.equal(regulationCoreAbsent(after, 'sargonShip'), true);
  assert.equal(regulationCoreAbsent(after, 'yanShip'), false);
  const drawn = card(after, 'sargonShip', { count: 0, layers: 0, tier: 0, active: false });
  assert.match(drawn, /萨尔贡：该核心盟约的所有干员无法出现/);
  assert.match(drawn, /当前效果/);
  assert.doesNotMatch(drawn, /仍可能因所属的其他盟约出现/);
  assert.doesNotMatch(card(after, 'yanShip', { count: 1, layers: 2, tier: 1, active: true }), /该核心盟约的所有干员无法出现/);

  const cov = model();
  assert.equal(cov.regulation, false);
  assert.equal(regulationCoreAbsent(cov, 'sargonShip'), false);
  assert.equal(regulationCoreAbsent(cov, 'arcaneShip'), false);
  assert.doesNotMatch(card(cov, 'sargonShip', { count: 0, layers: 0, tier: 0, active: false }), /该核心盟约的所有干员无法出现/);
});
