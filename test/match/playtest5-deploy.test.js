// User playtest #5 item 7 — the Final Assault prep deploys on the player's half of the BOSS field (research 09 §1.2,
// official ConvertChessPositionInfoToBossMap / player_map_ud_offset 7): placement legality (server deploy map, the
// client's canPlace + legal-tile highlights, the bot) reads the boss field's tiles, not the normal field's.
//   User: "这张关底boss图靠右侧由1*3的管子框起来的地块官方原版是能部署干员的" — act2autochess_m01's 1×3 orange-railed
//   tiles (tile_fence_bound, LOW / buildable ALL) at boss (3–5, 8) and (3–5, 12) = board (10–12, 8) for both sides of a
//   pair; on the normal field board (10–12, 8) is '#' (tile_forbidden), which the remake used to read in R14 too.
// Audit: for every stage and every deploy field the server map equals the builder's official deploy tiles
// (stages.json deployTiles.normal / bossLeft / bossRight, from the level files' buildableType / heightType + devices),
// the client mirror equals the server, and nothing legal on the normal board becomes illegal in the boss round.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDeployMap, canPlace, fieldTile, boardTileOf, tileKey, FIELD } from '../../server/match/board.js';
import { bossFieldPlacement } from '../../server/match/finalAssault.js';
import { ERR, PHASE } from '../../shared/constants.js';
import {
  deployMap as clientDeployMap, deploySets, placementContext, canPlace as clientCanPlace, boardTargets, deployFieldOf,
  fieldTile as clientFieldTile,
} from '../../public/js/ui/gameLogic.js';
import { planLayout } from '../../server/match/bot.js';
import { collectViolations } from '../../server/match/invariants.js';
import { DATA, makeMatch, give, chessOfTier, checkInvariants } from './harness.js';

import { textMsg } from '../../shared/i18n.js';
const STAGE = 'act2autochess_m01';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const LEVELS = join(ROOT, '.cache', 'gamedata', 'levels', 'activities');
const levelFile = (id) => join(LEVELS, id.startsWith('act2') ? 'act2autochess' : 'act1autochess', `level_${id}.json`);
const HAS_LEVELS = Object.keys(DATA.stages).every((id) => existsSync(levelFile(id)));
const MELEE = (c) => c.position === 'MELEE';
const RANGED = (c) => c.position === 'RANGED';
const keysOf = (map, cls) => [...map].filter(([, v]) => !cls || v === cls).map(([k]) => k).sort();
/** stages.json deploy tiles of a boss half (field coordinates, rows 1–5) → board keys of deploy field `field`. */
const officialBoss = (st, field) => {
  const dt = st.deployTiles[field === 'bossR' ? 'bossRight' : 'bossLeft'];
  const toKey = ([r, c]) => { const [br, bc] = boardTileOf(field, r, c); return tileKey(br, bc); };
  const inBoard = ([r, c]) => { const [br, bc] = boardTileOf(field, r, c); return br >= FIELD.r0 && br <= FIELD.r1 && bc >= FIELD.c0 && bc <= FIELD.c1; };
  return { melee: dt.melee.filter(inBoard).map(toKey).sort(), ranged: dt.rangedOnly.filter(inBoard).map(toKey).sort() };
};

/** A 2-human co-op match on act2 m01 at the prep of round `round` (fake battles: nobody leaks). */
function coopAt(round, o = {}) {
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: o.seed ?? 21, fake: true }).start();
  h.setStage(STAGE);
  h.toPrep(round);
  return h;
}

/** Empty the player's board and hand (deterministic scenario). */
function clean(ps) {
  for (const p of [...ps.board.values(), ...ps.hand.filter(Boolean)]) if (p.kind === 'chess') ps.returnCopies(p);
  ps.board.clear();
  ps.hand.fill(null);
  ps.recompute();
}

describe('#7 the Final Assault prep deploys on the boss field', () => {
  test('repro: act2 m01 R14 — a melee operator may stand on the 1×3 fenced tiles (board col 8, rows 10–12), both sides', () => {
    const h = coopAt(14);
    const m = h.m;
    assert.equal(m.round, m.gd.bossRound);
    assert.equal(m.phase, PHASE.PREP);
    const meleeIds = [1, 2, 3].flatMap((t) => chessOfTier(t, MELEE)).filter((id) => m.pool.has(id));
    let next = 0;
    for (const [pid, field, bossCol] of [['p_0', 'bossL', 8], ['p_1', 'bossR', 12]]) {
      const ps = h.ps(pid);
      clean(ps);
      assert.equal(m.deployFieldOf(ps), field, `${pid} deploys on ${field}`);
      for (const row of [10, 11, 12]) {
        // what the player sees under that board tile: the boss field's fenced tile
        const at = bossFieldPlacement(field === 'bossR' ? 'R' : 'L', row, 8);
        assert.deepEqual([at.row, at.col], [row - 7, bossCol]);
        assert.equal(DATA.stages[STAGE].rows[at.row][at.col], 'b', 'tile_fence_bound');
        const a = give(m, ps, meleeIds[next++]);
        assert.deepEqual(m.handle(pid, { t: 'g.move', uid: a.uid, to: { area: 'board', row, col: 8 } }), { ok: true }, `${pid} melee on board ${row},8`);
      }
      // the lane (floor, buildable NONE) stays closed on the boss field too
      const b = give(m, ps, meleeIds[next++]);
      assert.deepEqual(m.handle(pid, { t: 'g.move', uid: b.uid, to: { area: 'board', row: 10, col: 9 } }), { error: ERR.BAD_TILE });
    }
    checkInvariants(m);
  });

  test('a normal round still reads the normal field (board col 8 rows 10–12 is forbidden there)', () => {
    const h = coopAt(13);
    const m = h.m;
    const ps = h.ps('p_0');
    clean(ps);
    assert.equal(m.deployFieldOf(ps), 'normal');
    const a = give(m, ps, chessOfTier(1, MELEE).find((id) => m.pool.has(id)));
    assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: a.uid, to: { area: 'board', row: 11, col: 8 } }), { error: ERR.BAD_TILE });
  });

  test('the boss round keeps every piece placed in the normal rounds and the boss battle stands them on the boss tiles', () => {
    const h = coopAt(13);
    const m = h.m;
    const ps = h.ps('p_0');
    clean(ps);
    const r1 = give(m, ps, chessOfTier(1, RANGED).find((id) => m.pool.has(id)));
    assert.deepEqual(m.handle('p_0', { t: 'g.move', uid: r1.uid, to: { area: 'board', row: 11, col: 4 } }), { ok: true }, 'high ground');
    h.toPrep(14);
    assert.equal(ps.board.get('11,4')?.uid, r1.uid, 'kept on its tile (normal ⊆ boss legality on every stage)');
    const input = ps.battleInput({ side: 'L' });
    assert.ok(input.units.some((u) => u.uid === r1.uid && u.row === 11 && u.col === 4), 'board coordinates in the battle input');
  });

  test('boss → boss: pieces on the fenced tiles in R14 stay there into the R15 (隐秘核心) prep, no terrain-change toast', () => {
    // review finding: Match.startRound cleared bossWaves before PlayerState.startRound's recompute, so R15's first
    // legality check read the NORMAL field and withdrew the pieces standing on board (10–12, 8)
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 52, fake: true, script: (b) => (b.kind === 'boss' || b.kind === 'hidden' ? { bossDps: 1e9 } : {}) }).start();
    h.setStage(STAGE);
    const m = h.m;
    h.drive(() => m.phase === PHASE.PREP && m.round === m.gd.bossRound);
    const toasts = [];
    const toast = m.toast.bind(m);
    m.toast = (ps, kind, text, args) => { toasts.push(`${ps.playerId}:${textMsg(text, args).text}`); return toast(ps, kind, text, args); };
    const fields = [];
    m.deployFieldOf = ((orig) => function (ps) { const f = orig.call(this, ps); if (this.round === this.gd.hiddenRound) fields.push(f); return f; })(m.deployFieldOf);
    const placed = {};
    const meleeIds = chessOfTier(1, MELEE).filter((id) => m.pool.has(id));
    for (const [i, pid] of ['p_0', 'p_1'].entries()) {
      const ps = h.ps(pid);
      clean(ps);
      const a = give(m, ps, meleeIds[i]);
      assert.deepEqual(m.handle(pid, { t: 'g.move', uid: a.uid, to: { area: 'board', row: 11, col: 8 } }), { ok: true });
      placed[pid] = a.uid;
      // Σ activated layers > 1200 (co-op) unlocks the hidden core after the win (finalAssault.test.js)
      ps.bondCountBonus.yanShip = 3; ps.layers.yanShip = 601; ps.recompute();
    }
    h.drive(() => m.phase === PHASE.FINAL_ASSAULT);
    h.drive(() => m.phase === PHASE.PREP && m.round === m.gd.hiddenRound);
    assert.ok(fields.length > 0 && fields.every((f) => f === 'bossL' || f === 'bossR'), `R15 never reads the normal field (${[...new Set(fields)]})`);
    for (const pid of ['p_0', 'p_1']) assert.equal(h.ps(pid).board.get('11,8')?.uid, placed[pid], `${pid} kept on the fenced tile in R15`);
    assert.deepEqual(toasts.filter((t) => t.includes('地形变化')), []);
    checkInvariants(m);
    m.dispose();
  });

  test('re-pairing before the fight (a teammate quits) moves the right player onto the left half', () => {
    const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 3, seed: 5, fake: true }).start();
    h.setStage(STAGE);
    h.toPrep(14);
    const m = h.m;
    assert.equal(m.deployFieldOf(h.ps('p_1')), 'bossR');
    assert.equal(m.deployFieldOf(h.ps('p_2')), 'bossL', 'the odd player alone on the left half');
    m.onLeave('p_0');
    assert.equal(m.deployFieldOf(h.ps('p_1')), 'bossL');
    assert.equal(m.deployFieldOf(h.ps('p_2')), 'bossR');
    // re-checked at once (Match._quit recomputes the players left), not at their next action
    for (const [id, field] of [['p_1', 'bossL'], ['p_2', 'bossR']]) {
      assert.equal(h.ps(id)._deployField, field, `${id} board re-checked on ${field}`);
      assert.equal(h.ps(id)._legalityStale, false);
    }
    checkInvariants(m);
  });

  test('the invariant checker reads the deploy field without touching the player\'s cache', () => {
    const h = coopAt(13);
    const m = h.m;
    const ps = h.ps('p_1');
    ps.deployMap();
    assert.equal(ps._deployField, 'normal');
    m._planBossWaves(); // the boss pairing appears (as at R14's round start) before the player's next recompute
    assert.equal(m.deployFieldOf(ps), 'bossR');
    collectViolations(m);
    checkInvariants(m);
    assert.equal(ps._deployField, 'normal', 'collectViolations / checkInvariants are pure reads');
    assert.equal(ps._legalityStale, false);
  });

  test('the bot plans boss-round layouts on the boss field (it may use the fenced tiles)', () => {
    const h = coopAt(14);
    const m = h.m;
    const ps = h.ps('p_0');
    clean(ps);
    const ids = chessOfTier(2, MELEE).filter((id) => m.pool.has(id)).slice(0, 6);
    const pieces = ids.map((id) => give(m, ps, id));
    const plan = planLayout(m, ps, pieces);
    const map = ps.deployMap();
    for (const k of plan.values()) assert.equal(map.get(k), 'melee', `planned ${k} is a melee tile of the boss half`);
    assert.equal(map.get('11,8'), 'melee');
  });
});

describe('#7 audit: every stage × deploy field (server = official level data = client)', () => {
  test('server deploy map on each field equals the builder\'s official deploy tiles', () => {
    for (const [id, st] of Object.entries(DATA.stages)) {
      const n = buildDeployMap(st);
      assert.deepEqual(keysOf(n, 'melee'), st.deployTiles.normal.melee.map(([r, c]) => tileKey(r, c)).sort(), `${id} normal melee`);
      assert.deepEqual(keysOf(n, 'ranged'), st.deployTiles.normal.rangedOnly.map(([r, c]) => tileKey(r, c)).sort(), `${id} normal ranged`);
      for (const field of ['bossL', 'bossR']) {
        const b = buildDeployMap(st, { field });
        const off = officialBoss(st, field);
        assert.deepEqual(keysOf(b, 'melee'), off.melee, `${id} ${field} melee`);
        assert.deepEqual(keysOf(b, 'ranged'), off.ranged, `${id} ${field} ranged`);
      }
    }
  });

  test('client mirror equals the server on every field (with and without terrain overrides)', () => {
    for (const [id, st] of Object.entries(DATA.stages)) {
      const aliases = (st.devices || []).filter((d) => d.alias && (d.role === 'crate' || d.role === 'platform'));
      const variants = [{}, { deviceOverrides: Object.fromEntries(aliases.map((d) => [d.alias, !d.active])) }];
      for (const field of ['normal', 'bossL', 'bossR']) {
        for (const ov of variants) {
          const srv = buildDeployMap(st, { ...ov, field });
          const cli = clientDeployMap(st, { ...ov, field });
          assert.deepEqual([...cli.entries()].sort(), [...srv.entries()].sort(), `${id} ${field} ${JSON.stringify(ov).slice(0, 40)}`);
        }
        const sets = deploySets(st, field);
        const srv = buildDeployMap(st, { field });
        assert.deepEqual([...sets.melee].sort(), keysOf(srv, 'melee'), `${id} ${field} deploySets melee`);
        assert.deepEqual([...sets.ranged].sort(), keysOf(srv).sort(), `${id} ${field} deploySets ranged`);
      }
    }
    for (const f of ['normal', 'bossL', 'bossR']) for (const [r, c] of [[9, 2], [12, 10], [10, 8]]) assert.deepEqual(clientFieldTile(f, r, c), fieldTile(f, r, c));
  });

  test('independent check against the raw official level files (buildableType / heightType + non-hidden devices)', { skip: !HAS_LEVELS && 'no .cache/gamedata level files (run node tools/build-data.mjs once)' }, () => {
    // trap_040_canoe 特制水上平台 "在水上建立可以部署任意单位的平台"; tile_deepsea refuses deployment whatever its
    // buildableType (PRTS 深水区 地形信息 "地形机制：拒绝部署（待补充）" — player report #3 after 0.1.0, 战场#08's pool)
    const ROLE = { trap_1105_accrate: 'block', trap_032_mound: 'block', trap_1106_achplat: 'platform', trap_040_canoe: 'water' };
    for (const [id, st] of Object.entries(DATA.stages)) {
      const lv = JSON.parse(readFileSync(levelFile(id), 'utf8'));
      const map = lv.mapData.map, tiles = lv.mapData.tiles, H = map.length;
      const dev = new Map();
      for (const t of lv.predefines?.tokenInsts || []) if (ROLE[t.inst?.characterKey] && !t.hidden) dev.set(`${t.position.row},${t.position.col}`, ROLE[t.inst.characterKey]);
      const official = (r, c) => {
        const t = tiles[map[H - 1 - r]?.[c]];
        const d = dev.get(`${r},${c}`);
        if (!t || d === 'block') return null;
        // 射击台: ranged only [ASSUMED, DATA §15.11] (the remake's rule for a raised platform)
        if (d === 'platform') return 'ranged';
        if (d === 'water') return 'melee';
        if (t.tileKey === 'tile_deepsea') return null;
        if (t.heightType === 'LOWLAND' && (t.buildableType === 'ALL' || t.buildableType === 'MELEE')) return 'melee';
        if (t.buildableType === 'RANGED' || (t.heightType === 'HIGHLAND' && t.buildableType === 'ALL')) return 'ranged';
        return null;
      };
      for (const field of ['normal', 'bossL', 'bossR']) {
        const srv = buildDeployMap(st, { field });
        for (let r = FIELD.r0; r <= FIELD.r1; r++) for (let c = FIELD.c0; c <= FIELD.c1; c++) {
          const [sr, sc] = fieldTile(field, r, c);
          assert.equal(srv.get(tileKey(r, c)) ?? null, official(sr, sc), `${id} ${field} board ${r},${c} = stage ${sr},${sc}`);
        }
      }
      // 联防: the second helper's board stands on the right half shifted by player_map_lr_offset 8 — the same classes
      for (let r = FIELD.r0; r <= FIELD.r1; r++) for (let c = FIELD.c0; c <= FIELD.c1; c++) {
        if (official(r, c)) assert.equal(official(r, c + 8), official(r, c), `${id} 联防 right half ${r},${c + 8}`);
      }
      // benches: hand row 7 (boss row 0, the right half mirrored), temp row 8 cols 4–8 (boss row 1)
      const key = (r, c) => tiles[map[H - 1 - r][c]].tileKey;
      for (let i = 0; i < 10; i++) for (const [r, c] of [[7, i], [0, i], [0, 20 - i]]) assert.equal(key(r, c), 'tile_achand', `${id} hand ${r},${c}`);
      for (let c = 4; c <= 8; c++) for (const [r, cc] of [[8, c], [1, c], [1, 20 - c]]) assert.equal(key(r, cc), 'tile_achand', `${id} temp ${r},${cc}`);
    }
  });

  test('carry-over: a tile legal on the normal board is legal (same class) on both boss halves of every active stage', () => {
    for (const [id, st] of Object.entries(DATA.stages)) {
      const n = buildDeployMap(st);
      for (const field of ['bossL', 'bossR']) {
        const b = buildDeployMap(st, { field });
        for (const [k, cls] of n) {
          const [r, c] = k.split(',').map(Number);
          if (cls === 'melee') assert.ok(canPlace(b, 'melee', r, c), `${id} ${field}: melee ${k}`);
          else assert.ok(canPlace(b, 'ranged', r, c), `${id} ${field}: ranged ${k}`);
        }
      }
    }
  });

  test('client placement: the boss prep lights and accepts the fenced tiles; the normal prep refuses them', () => {
    const st = DATA.stages[STAGE];
    const meleeId = chessOfTier(1, MELEE)[0];
    const priv = { hand: [{ uid: 1, kind: 'chess', id: meleeId }, ...Array(9).fill(null)], temp: Array(5).fill(null), board: [], deployCap: 8, deployCount: 0 };
    const getChess = (id) => DATA.chess[id];
    for (const field of ['bossL', 'bossR']) {
      const ctx = placementContext({ priv, stage: st, editable: true, field, getChess });
      assert.equal(ctx.field, field);
      for (const row of [10, 11, 12]) assert.equal(clientCanPlace(ctx, 1, { area: 'board', row, col: 8 }).ok, true, `${field} ${row},8`);
      const lit = boardTargets(ctx, 1).legal.map(([r, c]) => tileKey(r, c));
      assert.ok(['10,8', '11,8', '12,8'].every((k) => lit.includes(k)), `${field}: legal highlights ${lit}`);
    }
    const ctx = placementContext({ priv, stage: st, editable: true, getChess });
    assert.equal(clientCanPlace(ctx, 1, { area: 'board', row: 11, col: 8 }).ok, false);
  });

  test('the DOM fallback board draws the boss half in the boss prep: the fenced tiles are floor, not walls', async () => {
    // integration QA: with ?render=fallback (or no WebGL) the boss prep drew the normal field, whose board (10–12, 8) is
    // '#' — highlighted as legal but drawn as walls
    const { fallbackTileClass } = await import('../../public/js/ui/fallbackField.js');
    const st = DATA.stages[STAGE];
    for (const row of [10, 11, 12]) {
      assert.equal(fallbackTileClass(st, row, 8), 'void', `normal field ${row},8: a wall`);
      for (const field of ['bossL', 'bossR']) {
        const [r, c] = clientFieldTile(field, row, 8);
        assert.equal(fallbackTileClass(st, r, c), 'floor', `${field} board ${row},8 = boss ${r},${c}`);
      }
    }
    const src = readFileSync(join(ROOT, 'public/js/ui/fallbackField.js'), 'utf8');
    assert.match(src, /fieldTile\(st\.deployField, row, col\)/, 'the fallback maps its board tiles through fieldTile in prep');
    assert.match(src, /st\.deployField = kind === 'bossPrep' \? \(o\?\.side === 'R' \? 'bossR' : 'bossL'\) : 'normal'/);
    const game = readFileSync(join(ROOT, 'public/js/screens/game.js'), 'utf8');
    assert.match(game, /const prepCam = prepCamera\(pub, myId\);/, 'the match screen hands the fallback view the boss prep camera too');
  });

  test('deployFieldOf follows the boss-round pairing (alive players by seat, two by two)', () => {
    const players = [{ playerId: 'a', seat: 0 }, { playerId: 'b', seat: 1 }, { playerId: 'c', seat: 2, alive: false }, { playerId: 'd', seat: 3 }];
    const pub = { round: 14, bossRound: 14, hiddenRound: 15, players };
    assert.equal(deployFieldOf(pub, 'a'), 'bossL');
    assert.equal(deployFieldOf(pub, 'b'), 'bossR');
    assert.equal(deployFieldOf(pub, 'd'), 'bossL');
    assert.equal(deployFieldOf(pub, 'c'), 'normal', 'eliminated');
    assert.equal(deployFieldOf({ ...pub, round: 15 }, 'b'), 'bossR', 'hidden core');
    assert.equal(deployFieldOf({ ...pub, round: 13 }, 'b'), 'normal');
    assert.equal(deployFieldOf(null, 'a'), 'normal');
  });
});
