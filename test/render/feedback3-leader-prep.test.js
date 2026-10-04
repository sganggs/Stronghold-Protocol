// test/render/feedback3-leader-prep.test.js — community report #12 (owner's decision 2026-10-04): in the Final Assault /
// Hidden Core prep the round's leader stands on the boss field (it used to wait in the off-screen pen: research 08's +13
// preview row put it in the pen's upper zone), and while an operator's orange range preview shows, the leader's hit
// tiles — the sim's hit rectangle — are lit in red [ASSUMED colour]. The match layer's preview carries the leader's spawn
// tile (server/match/waves.js previewOf `start`); render/prepfield.js leaderStand + render/pick.js hitTiles (= the sim's
// body.js bodyKeys) give the stand; render/app.js draws it (wiring: test/render/fieldview.browser.test.js). Display only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GameData } from '../../server/match/gamedata.js';
import { setupMatchWaves, buildBossWave, previewOf } from '../../server/match/waves.js';
import { createRng } from '../../server/sim/rng.js';
import { bodyKeys, normHitArea } from '../../server/sim/body.js';
import { COLS } from '../../server/sim/constants.js';
import { DATA } from '../match/harness.js';
import { leaderStand } from '../../public/js/render/prepfield.js';
import { hitTiles } from '../../public/js/render/pick.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('the preview of a boss round carries the leader\'s spawn tile; other entries never do', () => {
  const p = previewOf([
    { enemyKey: 'L', count: 1, time: 0, tag: 'boss', preview: { gate: 'upper', boss: true, start: [3, 10] } },
    { enemyKey: 'a', count: 2, time: 1, preview: { gate: 'lower', start: [3, 2] } },
  ]);
  assert.deepEqual(p[0].start, [3, 10]);
  assert.equal('start' in p[1], false, 'escorts stay in the pen');
  const gd = new GameData(DATA, 'mode_multi_abyss');
  const setup = setupMatchWaves(gd, createRng(1));
  for (const bossId of Object.keys(gd.mode.bossWeights)) {
    for (const solo of [false, true]) {
      const w = buildBossWave(gd, createRng(1), setup.factions, 14, { bossId, solo });
      const boss = previewOf(w.spawns).filter((e) => e.boss);
      assert.ok(boss.length >= 1, `${w.templateId}: a leader`);
      const route = DATA.waves[w.templateId].routes[w.spawns.find((s) => s.tag === 'boss').routeIndex];
      for (const e of boss) assert.deepEqual(e.start, route.start.slice(0, 2), `${w.templateId}: the leader's route start`);
    }
  }
});

test('leaderStand: every leader of the data stands on its spawn tile with the sim\'s hit tiles (bodyKeys)', () => {
  const seen = new Set();
  for (const [id, tpl] of Object.entries(DATA.waves)) {
    if (!tpl || (tpl.kind !== 'boss' && tpl.kind !== 'hidden')) continue;
    for (const s of tpl.spawns.filter((x) => x.tag === 'boss')) {
      const start = tpl.routes[s.routeIndex].start.slice(0, 2);
      const st = leaderStand([{ enemyKey: 'escort', count: 3 }, { enemyKey: s.key, count: 1, boss: true, start }], (k) => DATA.enemies[k]?.hitArea ?? null, hitTiles);
      assert.ok(st, id);
      assert.deepEqual([st.row, st.col], start);
      const sim = bodyKeys({ x: start[1], y: start[0], hitArea: normHitArea(DATA.enemies[s.key].hitArea) }).map((k) => [Math.floor(k / COLS), k % COLS]);
      assert.deepEqual(st.tiles, sim, `${id} ${s.key}: the sim's hit tiles`);
      seen.add(`${s.key} ${st.tiles.length}`);
    }
  }
  // 胄 / 管 / 昆图斯 / 阿利斯泰尔 / 萨米的意志: 5 × 3 (4.95 × 2.95, up 1); 铳 / 卢西恩 are point units: their tile
  assert.ok(seen.has('enemy_9013_acstmk 15') && seen.has('enemy_9032_aclionk 15') && seen.has('enemy_9017_achunt 1'), [...seen].join(', '));
  const chou = leaderStand([{ enemyKey: 'enemy_9013_acstmk', boss: true, start: [3, 10] }], (k) => DATA.enemies[k].hitArea, hitTiles);
  assert.deepEqual([...new Set(chou.tiles.map(([r]) => r))], [3, 4, 5]);
  assert.deepEqual([...new Set(chou.tiles.map(([, c]) => c))], [8, 9, 10, 11, 12]);
  assert.equal(leaderStand([{ enemyKey: 'x', boss: true }], () => null, hitTiles), null, 'no spawn tile: it stays in the pen');
  assert.equal(leaderStand([{ enemyKey: 'x', boss: false, start: [3, 10] }], () => null, hitTiles), null);
  assert.equal(leaderStand(null), null);
});

test('render/app.js: the leader leaves the pen for the boss field, red hit tiles beside a range preview (source checks)', async () => {
  const { LEADER_HIT_STYLE, leaderShown } = await import('../../public/js/render/app.js');
  assert.equal(LEADER_HIT_STYLE.group, 'leaderHit');
  assert.ok((LEADER_HIT_STYLE.color >> 16) > 0xd0 && ((LEADER_HIT_STYLE.color >> 8) & 0xff) < 0x60, 'red');
  assert.equal(leaderShown('bossPrep'), true);
  assert.equal(leaderShown('prep'), false);
  assert.equal(leaderShown('pen', 'bossPrep'), true, 'a flight from the boss-field prep');
  const app = read('public/js/render/app.js');
  assert.match(app, /const pen = layoutPen\(stand \? list\.filter\(\(e\) => e !== stand\.entry\) : list, \{ stage: stageRec \}\);/);
  assert.match(app, /\[\.\.\.hlReq\.keys\(\)\]\.some\(\(g\) => RANGE_GROUPS\.has\(g\)\)/);
});

test('the leader\'s view (render/app.js setLeader: a boss, not a prep view) shows its full HP bar, like the official prep image', async () => {
  const { installFakePixi, fakeViewCtx } = await import('./fakepixi.js');
  const { presetCamera } = await import('../../public/js/render/projection.js');
  const fake = installFakePixi();
  try {
    const { UnitView } = await import('../../public/js/render/units.js');
    const cam = presetCamera('bossPrep', { width: 1600, height: 900 });
    const v = new UnitView(fakeViewCtx(fake.P, { cam: () => cam }), { id: 'leader:x', kind: 'enemy', side: 'enemy', defId: 'enemy_9013_acstmk', spine: 'enemy_9013_acstmk', tier: 3, x: 10, y: 3, facing: -1, maxHp: 1, boss: true });
    v.update(1 / 60, cam, 0);
    assert.equal(v.hpFill.visible, true, 'HP bar shown');
    assert.ok(Math.abs(v.hpFill.width - v.hpBg.width + 2) < 1e-6, 'full');
    assert.equal(v.spFill.visible, false);
    v.destroy();
  } finally { fake.restore(); }
});
