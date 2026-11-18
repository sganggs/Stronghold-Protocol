// 规程 INFO_CHECK is a two-column briefing. Every other family keeps screens/briefing.js's column.
// The preview is the stage's own cells until a manifest lists a picture (ui/stagePreview.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
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

const { regulationBriefingLayout, RegulationBriefing } = await import('../../public/js/ui/regulationBriefing.js');
const { MatchBondGroups, MatchBondRow, BannedByBond, RegulationHead, matchInfoModel } = await import('../../public/js/ui/matchInfo.js');
const { MatchEnemies } = await import('../../public/js/ui/matchEnemies.js');
const { StagePreview, StageMap, stagePreviewChoice, stagePreviewCells, stagePreviewKeys, STAGE_PREVIEW_CROP, STAGE_PREVIEW_ZOOM } = await import('../../public/js/ui/stagePreview.js');
const { Img, RichText } = await import('../../public/js/ui/gameComponents.js');
const { Tooltip } = await import('../../public/js/ui/components.js');

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

test('regulationBriefingLayout is the version family, not a bond id', () => {
  assert.equal(regulationBriefingLayout({ version: { family: 'regulation' } }), true);
  assert.equal(regulationBriefingLayout({ version: { family: 'regulation', id: 'act3autochess@V3_1' } }), true);
  assert.equal(regulationBriefingLayout(null), false);
  assert.equal(regulationBriefingLayout({}), false);
  assert.equal(regulationBriefingLayout({ version: { family: 'covenant' } }), false);
  assert.equal(regulationBriefingLayout({ version: null }), false);
  const brief = read('public/js/screens/briefing.js');
  assert.match(brief, /regulationBriefingLayout\(gd\.config\)/);
  assert.match(brief, /<section class="brief-sec brief-sec--enemy" style="--i:1">\s*<\$\{MatchEnemies\} pub=\$\{pub\} gd=\$\{gd\} \/>\s*<\/section>/);
  assert.doesNotMatch(brief, /enemyIconUrl|factionIconUrl|brief-boss|brief-faction/);
  assert.doesNotMatch(brief, /brief-legend|brief-banned|function BondRow|bannedPerBond|disabledBondSets/);
});

test('the 规程 screen is two columns and asks for the cell preview', () => {
  const pub = { modeId: 'mode_single_normal', stageId: 'act3autochess_m01', bossId: null, factions: [], setupRevision: 0 };
  const gd = {
    config: { version: { family: 'regulation' }, modes: { mode_single_normal: { stages: ['act3autochess_m01'] } } },
    m: { ui: {} },
    stage: () => null,
    list: () => [],
  };
  const info = matchInfoModel(pub, { bonds: [], chess: () => null });
  const me = { playerId: 'p', ready: false, name: '博士' };
  const tree = RegulationBriefing({
    pub, gd, room: null, solo: true, info, players: [me], me, readyN: 0, myId: 'p',
    exit: false, setExit() {}, busy: false, bondId: null, setBondId() {}, ready() {}, pickGroup() {}, priv: null,
  });
  assert.equal(tree.props['data-layout'], 'regulation');
  assert.ok(hasClass(tree, 'brief--reg'));
  const nodes = [...walk(tree)];
  assert.ok(nodes.some((v) => hasClass(v, 'brief__scroll')));
  assert.ok(nodes.some((v) => hasClass(v, 'brief__side')));
  assert.equal(nodes.some((v) => hasClass(v, 'brief__main')), false);
  const preview = nodes.find((v) => v.type === StagePreview);
  assert.equal(preview.props.choice.kind, 'cells');
  assert.equal(preview.props.choice.assumed, true);
  assert.equal(preview.props.pool, '战场固定');
  const enemies = nodes.find((v) => v.type === MatchEnemies);
  assert.equal(enemies.props.layout, 'regulation');
  assert.match(textOf(nodes.find((v) => hasClass(v, 'brief-go'))), /准备就绪/);
});

test('规程 leader shows the name only; the round, abilities and battlefield stay on a tap', () => {
  const pub = { modeId: 'm', bossId: 'b', stageId: 's', factions: ['element'], lastRound: 15 };
  const gd = {
    config: { modes: { m: { stages: ['s', 's2'], bossRound: 15 } } },
    boss: () => ({ name: '鳍', enemyKey: 'e', abilities: ['技能甲', '技能乙'] }),
    enemy: () => ({ name: '鳍' }),
    stage: () => ({ name: '沙地' }),
    factions: { types: { element: { name: '元素', desc: '说明', icon: 'element' } } },
    m: {},
  };
  const reg = MatchEnemies({ pub, gd, layout: 'regulation' });
  const face = [...walk(reg)].find((v) => hasClass(v, 'reg-boss'));
  assert.ok(face);
  assert.match(textOf(face), /敌方领袖/);
  assert.match(textOf([...walk(face)].find((v) => hasClass(v, 'brief-boss__name'))), /鳍/);
  const textCol = [...walk(face)].find((v) => hasClass(v, 'brief-boss__text'));
  assert.equal([...walk(textCol)].some((v) => hasClass(v, 'brief-boss__abil') || hasClass(v, 'reg-boss__abil')), false);
  const tip = [...walk(reg)].find((v) => v.type === Tooltip && v.props.tipClass === 'reg-boss__tip');
  assert.equal(tip.props.tap, true);
  const rich = [...walk(tip.props.text)].filter((v) => v.type === RichText);
  assert.deepEqual(rich.map((v) => v.props.text), ['技能甲', '技能乙']);
  assert.match(textOf(tip.props.text), /最终攻势/);
  assert.match(textOf(tip.props.text), /沙地/);
  assert.match(textOf(tip.props.text), /战场随机（共2张）/);
  assert.ok([...walk(face)].some((v) => hasClass(v, 'sr-only') && [...walk(v)].some((x) => x.type === RichText)));
  const faction = [...walk(reg)].find((v) => hasClass(v, 'brief-faction'));
  assert.equal(faction.props['data-faction'], 'element');
  const plain = MatchEnemies({ pub, gd });
  assert.ok([...walk(plain)].some((v) => hasClass(v, 'brief-boss__abil')));
  assert.equal([...walk(plain)].some((v) => hasClass(v, 'reg-boss')), false);
  assert.match(textOf(plain), /本局遭遇敌方/);
});

function bondModel() {
  const bond = (bondId, members, core = true) => ({ bondId, name: bondId, isCore: core, thresholds: [1, 2], visibleMembers: members });
  const core = [bond('sargon', ['a', 'b']), bond('yan', ['b'])];
  const addon = [bond('extra', ['c'], false)];
  return {
    regulation: true,
    choice: { groups: [['sargon'], ['yan']], picked: null },
    core, addon, bonds: [...core, ...addon],
    banned: ['a', 'c', 'b', 'z'],
    perBond: new Map([['sargon', 2], ['yan', 1], ['extra', 1]]),
    stateOf: () => null,
    sets: { drawn: new Set(), off: new Set() },
    diyBanned: [],
  };
}

test('规程 groups share one header; the covenant groups do not', () => {
  const model = bondModel();
  const open = MatchBondGroups({ model, panels: true, onPick() {}, onBond() {} });
  assert.equal([...walk(open)].filter((v) => v.type === RegulationHead).length, 1);
  assert.equal([...walk(open)].filter((v) => hasClass(v, 'reg-group__n')).length, 2);
  const rows = [...walk(open)].filter((v) => v.type === MatchBondRow);
  assert.ok(rows.length >= 2);
  assert.ok(rows.every((row) => row.props.head === false));
  const settled = MatchBondGroups({ model: { ...model, choice: { ...model.choice, picked: 0 } }, panels: true, onPick() {}, onBond() {} });
  assert.equal(settled.type, MatchBondRow);
  assert.equal(settled.props.head.type, RegulationHead);
  const plain = MatchBondGroups({ model, onPick() {}, onBond() {} });
  assert.equal([...walk(plain)].some((v) => v.type === RegulationHead), false);
  assert.equal([...walk(plain)].filter((v) => v.type === MatchBondRow)[0].props.head, undefined);
});

test('BannedByBond groups operators by bond and repeats one who is in two', () => {
  const view = BannedByBond({ model: bondModel(), onBond() {} });
  const groups = [...walk(view)].filter((v) => hasClass(v, 'reg-banned__group'));
  assert.deepEqual(groups.map((v) => v.props['data-bond']), ['sargon', 'yan', 'extra']);
  const thumbs = (node) => [...walk(node)].filter((v) => v.type?.name === 'UnitThumb').map((v) => v.props.id);
  assert.deepEqual(thumbs(groups[0]), ['a', 'b']);
  assert.deepEqual(thumbs(groups[1]), ['b']);
  assert.deepEqual(thumbs(groups[2]), ['c']);
  const rest = [...walk(view)].find((v) => v.props?.['data-testid'] === 'banned-rest');
  assert.deepEqual(thumbs(rest), ['z']);
  const empty = BannedByBond({ model: { ...bondModel(), banned: [], perBond: new Map() } });
  assert.match(textOf(empty), /本局没有禁用干员/);
});

test('the preview is the stage cells until a manifest lists a picture', () => {
  assert.deepEqual({ ...STAGE_PREVIEW_CROP }, { r0: 7, r1: 12, c0: 0, c1: 10 });
  assert.equal(STAGE_PREVIEW_ZOOM, 'dialog');
  assert.deepEqual(stagePreviewKeys('act3autochess_m01'), [
    'stagePreview/act3autochess_m01', 'mapPreview/act3autochess_m01', 'stageMap/act3autochess_m01',
  ]);
  assert.deepEqual(stagePreviewCells(null), []);
  assert.deepEqual(stagePreviewCells({}), []);
  const stage = {
    tiles: {
      r: { buildable: 'MELEE', height: 'LOW' },
      S: { tileKey: 'tile_start' },
      i: { special: 'infect', buildable: 'NONE' },
      z: { special: 'speedup', buildable: 'MELEE' },
    },
    rows: Array.from({ length: 19 }, () => 'r'.repeat(21)),
  };
  stage.rows[6] = stage.rows[6].slice(0, 2) + 'S' + stage.rows[6].slice(3);
  stage.rows[9] = stage.rows[9].slice(0, 2) + 'S' + stage.rows[9].slice(3);
  stage.rows[10] = stage.rows[10].slice(0, 6) + 'i' + stage.rows[10].slice(7);
  stage.rows[8] = stage.rows[8].slice(0, 7) + 'z' + stage.rows[8].slice(8);
  stage.rows[11] = 'rr';
  const cells = stagePreviewCells(stage);
  assert.equal(cells.length, 66);
  assert.equal(cells[0].row, 12, 'the far row is the top of the thumbnail (row 0 is the bottom of the stage)');
  assert.equal(cells[0].col, 0);
  assert.equal(cells.at(-1).row, 7);
  assert.equal(cells.at(-1).col, 10);
  assert.equal(cells.some((c) => c.row === 6), false);
  assert.equal(cells.find((c) => c.row === 9 && c.col === 2).kind, 'gate');
  assert.equal(cells.find((c) => c.row === 10 && c.col === 6).kind, 'infect');
  const speed = cells.find((c) => c.row === 8 && c.col === 7);
  assert.equal(speed.special, 'speedup');
  assert.equal(speed.kind, 'floor');
  assert.equal(cells.find((c) => c.row === 11 && c.col === 10).kind, 'void');
  const map = StageMap({ stage, choice: { kind: 'cells', assumed: true } });
  assert.equal(map.props['data-preview'], 'cells');
  assert.equal(map.props['data-assumed'], 'true');
  const painted = [...walk(map)].find((v) => v.props?.['data-special'] === 'speedup');
  assert.match(painted.props.class, /reg-map__cell--speedup/);
  assert.match(painted.props.class, /ff-tile--floor/);
  assert.doesNotMatch(painted.props.class, /(^|\s)ff-tile(\s|$)/);
  const picture = StageMap({ stage: null, choice: { kind: 'picture', url: '/m.png', key: 'stagePreview/x' } });
  assert.equal(picture.props['data-preview'], 'picture');
  assert.equal(picture.props['data-assumed'], undefined);
  assert.equal([...walk(picture)].find((v) => v.type === Img).props.src, '/m.png');
  const assets = JSON.parse(read('data/assets.json'));
  // data/local-assets.json is git-ignored (CI has none): then only data/assets.json is checked
  const local = existsSync(path.join(ROOT, 'data/local-assets.json')) ? JSON.parse(read('data/local-assets.json')) : { groups: {} };
  const src = { ui: assets.ui, localGroups: local.groups };
  for (const id of ['act3autochess_m01', 'act2autochess_m01']) {
    assert.deepEqual(stagePreviewChoice(src, id), { kind: 'cells', assumed: true });
  }
  assert.deepEqual(
    stagePreviewChoice({ ui: { 'stagePreview/act3autochess_m01': '/x.png' }, localGroups: {} }, 'act3autochess_m01'),
    { kind: 'picture', url: '/x.png', key: 'stagePreview/act3autochess_m01' },
  );
  assert.deepEqual(
    stagePreviewChoice({ ui: {}, localGroups: { 'ui/stagePreview': { act3autochess_m01: { path: '/local.png' } } } }, 'act3autochess_m01'),
    { kind: 'picture', url: '/local.png', key: 'ui/stagePreview/act3autochess_m01' },
  );
  const srcJs = read('public/js/ui/stagePreview.js');
  assert.match(srcJs, /name="search"/);
  assert.match(srcJs, /<\$\{Modal\}/);
});
