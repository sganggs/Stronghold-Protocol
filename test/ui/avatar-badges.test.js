// 完美连胜 / 领袖伤害 on the team panel's avatars (DESIGN §37.148, ui/avatarBadges.js): the rank refs of the official
// player-avatar prefabs, the pack choice (the theme's own, else ac_n_initial's, else the CSS stand-in), the tooltips and
// the badge vnodes; with the local extraction, the installed packs' prefabs. Server side: test/match/avatar-badges.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

globalThis.fetch = async () => ({ ok: false, status: 404, json: async () => ({}) });

const {
  WIN_STREAK_PREFAB, BOSS_DAMAGE_PREFAB, AVATAR_UNITS, STREAK_BOX, STREAK_SCALE,
  hasAvatarBadges, avatarBadgePack, rankRefs, rankPose, avatarBadgeTips, WinStreakBadge, BossDamageBadge,
} = await import('../../public/js/ui/avatarBadges.js');
const { PrefabView } = await import('../../public/js/ui/prefab/view.js');

function* walk(v) {
  if (Array.isArray(v)) { for (const x of v) yield* walk(x); return; }
  if (!v || typeof v !== 'object') return;
  yield v;
  yield* walk(v.props?.children);
}
const textOf = (v) => {
  if (v == null || typeof v === 'boolean') return '';
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (Array.isArray(v)) return v.map(textOf).join('');
  return textOf(v.props?.children);
};
const classOf = (v) => String(v?.props?.class || v?.props?.className || '');

// the shape of ac_n_initial's prefabs (tools/local-extract ui_components.py): the controller's _rankItems, each rank's
// _streakText; the rank layers start inactive
const STREAK = {
  name: 'panel_win_streak', id: 1,
  scripts: [{ script: '6712249590885093658', refs: { _rankItems: [2, 4] } }, { script: '8850381329831666851', refs: { _panel: 1 } }],
  rect: { anchors: { min: [0, 0], max: [1, 1] }, pivot: [0.5, 0.5], sizeDelta: [0, 0], anchoredPosition: [0, 0] },
  children: [
    { name: 'win_streak_rank_1', id: 2, active: false, scripts: [{ script: '8289225825447677529', refs: { _streakText: 3 } }], children: [{ name: 'text_streak_count', id: 3, text: { fontSize: 12 } }] },
    { name: 'win_streak_rank_2', id: 4, active: false, scripts: [{ script: '8289225825447677529', refs: { _streakText: 5 } }], children: [{ name: 'text_streak_count', id: 5, text: { fontSize: 14 } }] },
  ],
};
const DAMAGE = {
  name: 'panel_boss_damage', id: 1,
  scripts: [{ script: '-9060859303773154152', refs: { _rankItems: [2, 3, 4] } }, { script: '8850381329831666851', refs: { _panel: 1 } }],
  children: [
    { name: 'boss_damage_rank_1', id: 2, active: false, autoClip: 'autochess_player_damage_rank_1' },
    { name: 'boss_damage_rank_2', id: 3, active: false, autoClip: 'autochess_player_damage_rank_2' },
    { name: 'boss_damage_rank_3', id: 4, active: false, autoClip: 'autochess_player_damage_rank_3' },
  ],
};
const PACK = { doc: { prefabs: { [WIN_STREAK_PREFAB]: STREAK, [BOSS_DAMAGE_PREFAB]: DAMAGE }, clips: {} }, sprite: () => '', texture: () => '' };

test('rank refs: the controller\'s rank layers in order and each rank\'s count text', () => {
  assert.deepEqual(rankRefs(STREAK), { ranks: [2, 4], texts: [3, 5] });
  assert.deepEqual(rankRefs(DAMAGE), { ranks: [2, 3, 4], texts: [null, null, null] });
  assert.deepEqual(rankRefs({ name: 'x' }), { ranks: [], texts: [] });
});

test('rank pose: the chosen rank active, the others not, the count in its own text; no rank → null', () => {
  const p1 = rankPose(STREAK, 1, '3');
  assert.deepEqual([...p1.active], [[2, true], [4, false]]);
  assert.deepEqual([...p1.texts], [[3, '3']]);
  const p2 = rankPose(STREAK, 2, '13');
  assert.deepEqual([...p2.active], [[2, false], [4, true]]);
  assert.deepEqual([...p2.texts], [[5, '13']]);
  assert.deepEqual([...rankPose(DAMAGE, 3).active], [[2, false], [3, false], [4, true]]);
  assert.equal(rankPose(DAMAGE, 4), null);
  assert.equal(rankPose(DAMAGE, 0), null);
});

test('pack choice: the theme\'s own prefabs, else the default pack\'s, else none (CSS)', () => {
  const theme = { doc: { prefabs: { [WIN_STREAK_PREFAB]: STREAK, [BOSS_DAMAGE_PREFAB]: DAMAGE } } };
  const iron = { doc: { prefabs: { 'hud/group_hud': {} } } };
  const base = { doc: { prefabs: { [WIN_STREAK_PREFAB]: STREAK, [BOSS_DAMAGE_PREFAB]: DAMAGE } } };
  assert.equal(hasAvatarBadges(iron), false);
  assert.equal(avatarBadgePack(theme, base), theme);
  assert.equal(avatarBadgePack(iron, base), base, '乌萨斯齐心团 borrows the default\'s');
  assert.equal(avatarBadgePack(null, base), base);
  assert.equal(avatarBadgePack(iron, null), null);
  assert.equal(avatarBadgePack(null, null), null);
});

test('tooltips: the streak count and the leader-damage step; nothing below the first level', () => {
  assert.deepEqual(avatarBadgeTips({}), []);
  assert.deepEqual(avatarBadgeTips({ winStreak: 3, winStreakLevel: 1 }), ['完美连胜：已连续 3 回合没有损失目标生命值']);
  assert.deepEqual(avatarBadgeTips({ bossDamageLevel: 2 }), ['领袖伤害：已造成本轮领袖 50% 以上的伤害']);
  assert.deepEqual(avatarBadgeTips({ winStreak: 6, winStreakLevel: 2, bossDamageLevel: 3 }),
    ['完美连胜：已连续 6 回合没有损失目标生命值', '领袖伤害：已造成本轮领袖 80% 以上的伤害']);
});

test('badges with a pack: PrefabView over the holder / the avatar box, keyed by the level, the count in the text', () => {
  const s = WinStreakBadge({ pack: PACK, level: 2, streak: 6 });
  assert.match(classOf(s), /abadge--streak/);
  const view = [...walk(s)].find((v) => v.type === PrefabView);
  assert.ok(view, 'drawn by PrefabView');
  assert.equal(view.key, 2);
  assert.deepEqual(view.props.size, [STREAK_BOX, STREAK_BOX]);
  assert.equal(view.props.scale, STREAK_SCALE);
  assert.deepEqual([...view.props.active], [[2, false], [4, true]]);
  assert.deepEqual([...view.props.texts], [[5, '6']]);
  const again = [...walk(WinStreakBadge({ pack: PACK, level: 2, streak: 6 }))].find((v) => v.type === PrefabView);
  assert.equal(again.props.active, view.props.active, 'a re-render hands over the same maps (no relayout)');
  const d = BossDamageBadge({ pack: PACK, level: 1, still: true });
  const dv = [...walk(d)].find((v) => v.type === PrefabView);
  assert.deepEqual(dv.props.size, [AVATAR_UNITS, AVATAR_UNITS]);
  assert.equal(dv.props.still, true);
  assert.deepEqual([...dv.props.active], [[2, true], [3, false], [4, false]]);
  assert.equal(WinStreakBadge({ pack: PACK, level: 0, streak: 2 }), null);
  assert.equal(BossDamageBadge({ pack: PACK, level: 0 }), null);
});

test('badges without the art: the CSS stand-ins (triangle / star with the count, the amber scan)', () => {
  const r1 = WinStreakBadge({ pack: null, level: 1, streak: 3 });
  assert.match(classOf(r1), /abadge--streak.*is-css.*is-r1/);
  assert.equal(textOf(r1), '3');
  const r2 = WinStreakBadge({ pack: null, level: 2, streak: 13 });
  assert.match(classOf(r2), /is-r2/);
  assert.equal(textOf(r2), '13');
  const d3 = BossDamageBadge({ pack: null, level: 3, still: true });
  assert.match(classOf(d3), /abadge--boss.*is-css.*is-l3.*is-still/);
  assert.ok([...walk(d3)].some((v) => classOf(v) === 'abadge__scan'));
});

test('team panel CSS: the holder centred inside the top-right corner, the scan over the avatar box', () => {
  const css = readFileSync(path.join(ROOT, 'public/css/screens/game.css'), 'utf8');
  // .338rem holder (33.76 units at the prefab's own scale), centre .024rem inside the right edge of the .8rem avatar and
  // .066rem below its top
  assert.ok(Math.abs(STREAK_BOX * STREAK_SCALE / 100 - 0.338) < 0.001);
  assert.match(css, /\.abadge--streak \{ left: \.607rem; top: -\.103rem; width: \.338rem; height: \.338rem;/);
  assert.match(css, /\.abadge--boss \{ left: 0; top: 0; width: \.8rem; height: \.8rem;/);
  assert.match(css, /\.team__you\.is-low \{/);
});

const LOCAL = path.join(ROOT, 'public/assets/local/themes');
test('installed packs (local extraction): ranks and texts as the badges expect, every sprite file present', { skip: !existsSync(path.join(LOCAL, 'ac_n_initial/prefabs.json')) && 'no local themes' }, () => {
  for (const id of ['ac_n_initial', 'ac_s_closur']) {
    const file = path.join(LOCAL, id, 'prefabs.json');
    if (!existsSync(file)) continue;
    const doc = JSON.parse(readFileSync(file, 'utf8'));
    assert.ok(hasAvatarBadges({ doc }), `${id} has both prefabs`);
    assert.deepEqual(rankRefs(doc.prefabs[WIN_STREAK_PREFAB]), { ranks: [2, 4], texts: [3, 5] }, id);
    assert.deepEqual(rankRefs(doc.prefabs[BOSS_DAMAGE_PREFAB]).ranks, [2, 3, 4], id);
    for (const name of [WIN_STREAK_PREFAB, BOSS_DAMAGE_PREFAB]) {
      (function check(n) {
        const f = n?.image?.file;
        if (f) assert.ok(existsSync(path.join(LOCAL, id, f)), `${id} ${f}`);
        for (const c of n?.children || []) check(c);
      })(doc.prefabs[name]);
    }
  }
  const iron = path.join(LOCAL, 'ac_n_iron/prefabs.json');
  if (existsSync(iron)) assert.equal(hasAvatarBadges({ doc: JSON.parse(readFileSync(iron, 'utf8')) }), false, '乌萨斯齐心团 has none (borrows)');
});
