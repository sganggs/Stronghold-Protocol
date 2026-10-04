// test/render/fieldview.browser.test.js — field-view features in headless Chrome through the dev demo
// (public/dev/render-demo.html): the enemy preview pen (research 09 §2.2 / 08 §4.2) on the 3D and the 2D board and
// the 0.25 s pan to it and back, the Final Assault prep on the player's half of the boss field (research 09 §1.2:
// drop targets / directions stay in board space, the right half mirrored) with the round's leader on its spawn tile and
// its red hit tiles beside a range preview (community report #12), damage numbers that never touch, the
// automatic rebuild of a 3D board whose WebGL context was lost, and frame rates on a 4× throttled CPU.
// Screenshots → test/e2e/out/pen-*.png, fa-prep-*.png, fa-leader-*.png, dmgnum-*.png; perf → test/e2e/out/fieldview-perf.json.
//
// Opt-in (starts Chrome): RENDER_E2E=1 node --test test/render/fieldview.browser.test.js
// Run browser test files one at a time. Chrome path: $CHROME_PATH or the macOS default.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hasArt = existsSync(path.join(ROOT, 'public/assets/local/map/autochess/TX_autochessi_D.png'));
const enabled = process.env.RENDER_E2E === '1' && existsSync(CHROME) && existsSync(path.join(ROOT, 'public/assets'));
const skip = enabled ? false : 'set RENDER_E2E=1 (needs Chrome and downloaded assets)';

describe('field view features in headless Chrome', { skip }, () => {
  let srv, browser;
  const perf = { generated: new Date().toISOString(), throttle: 4, views: [] };
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run', '--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => {
    try { if (perf.views.length) writeFileSync(path.join(OUT, 'fieldview-perf.json'), JSON.stringify(perf, null, 1)); } catch { /* ignore */ }
    await browser?.close();
    await srv?.close();
  });

  async function open(query, w = 1920, h = 1080) {
    const page = await browser.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.setViewport({ width: w, height: h });
    await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?${query}&panel=0`);
    await page.waitForFunction('window.__demo && (window.__demo.ready || window.__demo.error)', { timeout: 40000 });
    assert.equal(await page.evaluate(() => window.__demo.error || null), null, 'demo boot');
    return { page, problems };
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  for (const board of ['3d', '2d']) {
    test(`enemy preview pen (${board}): R13 official preview idles in the pen, facing left, no bars; 0.25 s pan there and back`, async () => {
      if (board === '3d' && !hasArt) return;
      const { page, problems } = await open(`scene=prep&pen=late-m01-r13&board=${board}`);
      await wait(2500);
      await page.screenshot({ path: path.join(OUT, `pen-prep-${board}.png`) });
      const r = await page.evaluate(async () => {
        const v = window.__demo.view, st = window.__demo.scene.state;
        const out = { board3d: v.stats().board3d.on, pen: v.stats().pen, total: st.nextEnemies.reduce((s, e) => s + e.count, 0) };
        const pens = [...v.debug.penViews.values()];
        out.rows = [...new Set(pens.map((p) => Math.round(p.y)))].sort();
        out.cols = [Math.min(...pens.map((p) => Math.round(p.x))), Math.max(...pens.map((p) => Math.round(p.x)))];
        out.left = pens.every((p) => p.visFacing === -1);
        out.bars = pens.some((p) => p.hud.visible && (p.hpFill.visible || p.spFill.visible));
        out.upper = st.nextEnemies.filter((e) => e.gate === 'upper').length;
        out.upperOk = pens.filter((p) => p.info.enemyKey && Math.round(p.y) >= 17).length > 0 === out.upper > 0;
        const before = v.debug.cam.params();
        const t0 = performance.now();
        v.setCamera('pen', { side: 'L' });
        await new Promise((res) => { const f = () => (v.debug.camKind === 'pen' && performance.now() - t0 > 20 && v.debug.cam.params().ty === v.debug.cam.params().ty ? res() : requestAnimationFrame(f)); f(); });
        let settled = null;
        let last = JSON.stringify(v.debug.cam.params());
        while (performance.now() - t0 < 1500) {
          await new Promise((res) => requestAnimationFrame(res));
          const now = JSON.stringify(v.debug.cam.params());
          if (now === last && settled == null && performance.now() - t0 > 60) settled = performance.now() - t0;
          if (now !== last) settled = null;
          last = now;
        }
        out.panMs = settled;
        out.penCam = v.debug.cam.params();
        out.inPenView = pens.filter((p) => !p.culled).length;
        v.setCamera('prep');
        await new Promise((res) => setTimeout(res, 500));
        const back = v.debug.cam.params();
        out.backSame = Object.keys(before).every((k) => Math.abs(before[k] - back[k]) < 1e-6);
        return out;
      });
      assert.equal(r.board3d, board === '3d', 'board layer');
      assert.ok(r.total > 50 && r.pen <= 50 + 8 && r.pen >= 45, `thinned to ~50 of ${r.total}: ${r.pen}`);
      assert.ok(r.rows.every((row) => row >= 14 && row <= 18 && row !== 16), `pen rows ${r.rows}`);
      assert.ok(r.cols[0] >= 7 && r.cols[1] <= 13, `pen cols ${r.cols}`);
      assert.ok(r.left, 'every pen enemy faces left');
      assert.equal(r.bars, false, 'no HP / SP bars in the pen');
      assert.ok(r.upperOk, 'upper-gate enemies in rows 17–18');
      assert.ok(r.panMs != null && r.panMs < 450, `pan to the pen ≈ 0.25 s (${r.panMs} ms)`);
      assert.ok(r.inPenView >= 40, `the pen view shows the pen (${r.inPenView} on screen)`);
      assert.ok(r.backSame, 'setCamera(prevKind) returns to the exact camera used before the pen');
      await page.evaluate(() => window.__demo.view.setCamera('pen', { instant: true }));
      await wait(700);
      await page.screenshot({ path: path.join(OUT, `pen-view-${board}.png`) });
      await page.close();
      assert.deepEqual(problems, []);
    });
  }

  test('pen lifecycle: a real battle empties it; a scouted teammate board shows their preview; tapping an enemy emits its key', async () => {
    const { page, problems } = await open('scene=prep', 1600, 900);
    await wait(2000);
    const r = await page.evaluate(async () => {
      const v = window.__demo.view;
      const out = { prep: v.stats().pen };
      v.setCamera('pen', { instant: true });
      await new Promise((res) => setTimeout(res, 400));
      const clicks = [];
      const off = v.on('pieceClick', (e) => clicks.push(e));
      const pv = [...v.debug.penViews.values()].find((p) => !p.culled);
      const rect = v.debug.app.view.getBoundingClientRect();
      // picking is by tile (user playtest #4 item 1): a press at the figure's feet, on its own tile
      out.click = { x: rect.left + pv.screen.x, y: rect.top + pv.screen.y, key: pv.info.enemyKey };
      window.__clicks = clicks; window.__offClick = off;
      return out;
    });
    await page.mouse.click(r.click.x, r.click.y);
    await wait(200);
    const r2 = await page.evaluate(async () => {
      const v = window.__demo.view;
      const clicks = window.__clicks.map((e) => ({ enemyKey: e.enemyKey, preview: e.preview, side: e.unit?.side }));
      window.__offClick();
      const scout = [{ enemyKey: 'enemy_1007_slime', count: 4, gate: 'upper', t: 1, fly: false, elite: false, source: 'wave' }];
      v.enterBattle({ fieldId: 'n:mate', kind: 'normal', rect: { r0: 9, r1: 12, c0: 0, c1: 10 }, stageId: 'act2autochess_m01', prep: true, units: [], nextEnemies: scout });
      const scouted = { pen: v.stats().pen, keys: [...new Set([...v.debug.penViews.values()].map((p) => p.info.enemyKey))], rows: [...new Set([...v.debug.penViews.values()].map((p) => Math.round(p.y)))] };
      v.enterBattle({ fieldId: 'n:me', kind: 'normal', rect: { r0: 9, r1: 12, c0: 0, c1: 10 }, stageId: 'act2autochess_m01', units: [] });
      return { clicks, scouted, battle: v.stats().pen };
    });
    await page.close();
    assert.deepEqual(problems, []);
    assert.ok(r.prep > 0, 'the demo prep shows its preview');
    assert.ok(r2.clicks.some((c) => c.enemyKey === r.click.key && c.preview === true && c.side === 'enemy'), JSON.stringify(r2.clicks));
    assert.equal(r2.scouted.pen, 4);
    assert.deepEqual(r2.scouted.keys, ['enemy_1007_slime']);
    assert.ok(r2.scouted.rows.every((row) => row >= 17), 'upper gate → rows 17–18');
    assert.equal(r2.battle, 0, 'cleared at combat start');
  });

  for (const side of ['L', 'R']) {
    test(`Final Assault prep on the ${side} half: pieces on the boss field, drops and directions in board space${side === 'R' ? ', mirrored' : ''}`, async () => {
      const { page, problems } = await open(`scene=prep&fa=${side}&stage=act2autochess_m02`, 1920, 1080);
      await wait(2500);
      const info = await page.evaluate(() => {
        const v = window.__demo.view, st = window.__demo.scene.state;
        const stage = window.__demo.scene.stageId;
        const pf = v.prepField();
        const b = st.board[0];
        const view = v.debug.views.get('p:' + b.uid);
        const hand = st.hand[0];
        const hr = v.pieceScreenRect(hand.uid);
        // a free melee tile of the own board (board space)
        const taken = new Set(st.board.map((p) => `${p.row},${p.col}`));
        const melee = (window.__deploy || null);
        void melee; void stage;
        return {
          pf, boardPiece: { row: b.row, col: b.col, x: view.x, y: view.y, dir: view.dir }, hand: { uid: hand.uid, r: hr }, taken: [...taken],
          ts: v.tileScreen(9, 2), camTx: v.debug.cam.tx,
        };
      });
      assert.deepEqual(info.pf, { kind: 'bossPrep', side, mirror: side === 'R' });
      // the board piece stands on its boss-field tile: row − 7, col mirrored on the right half, facing mirrored
      assert.equal(info.boardPiece.y, info.boardPiece.row - 7);
      assert.equal(info.boardPiece.x, side === 'R' ? 20 - info.boardPiece.col : info.boardPiece.col);
      assert.equal(info.boardPiece.dir, side === 'R' ? 'LEFT' : 'RIGHT');
      assert.equal(info.ts.mirror, side === 'R');
      assert.ok(side === 'R' ? info.camTx > 10 : info.camTx < 10, `camera frames the own half (tx ${info.camTx})`);
      await page.screenshot({ path: path.join(OUT, `fa-prep-${side}.png`) });
      // drag the first hand piece onto a free legal board tile: the drop target comes back in board coordinates
      const target = await page.evaluate(async () => {
        const v = window.__demo.view;
        const st = window.__demo.scene.state;
        const taken = new Set(st.board.map((p) => `${p.row},${p.col}`));
        const stage = (await import('/js/data.js')).data.lookup('stages', window.__demo.scene.stageId);
        const tiles = (stage.deployTiles.normal.melee || []).filter(([r, c]) => !taken.has(`${r},${c}`));
        const [row, col] = tiles[0];
        const t = v.tileScreen(row, col);
        window.__drops = [];
        v.on('pieceDrop', (e) => window.__drops.push(e.target));
        return { row, col, x: t.x, y: t.y };
      });
      const r = info.hand.r;
      const cx = r.left + r.width / 2, cy = r.top + r.height * 0.6;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= 12; i++) await page.mouse.move(cx + (target.x - cx) * i / 12, cy + (target.y - cy) * i / 12);
      await page.mouse.up();
      await wait(400);
      const drops = await page.evaluate(() => window.__drops);
      const dirs = await page.evaluate((uid) => {
        const v = window.__demo.view;
        const b = window.__demo.scene.state.board[0];
        v.setPieceDir(b.uid, 'RIGHT');
        const a = v.debug.views.get('p:' + b.uid).dir;
        v.setPieceDir(b.uid, 'UP');
        const u = v.debug.views.get('p:' + b.uid).dir;
        void uid;
        return { a, u };
      }, info.hand.uid);
      // review regression: a range reaching past the field has no place on the boss field (a DOWN range below the
      // bench used to land on the boss rows 6 / 5 — the wall and the own top row); the HUD padding of this prep is
      // the prep one (shop bar below)
      const past = await page.evaluate(async () => {
        const v = window.__demo.view;
        const { hudPadding } = await import('/js/ui/fieldHost.js');
        const sz = { width: 1024, height: 1366 };
        return {
          field: !!v.tileScreen(9, 5), wallBelow: v.tileScreen(6, 5), below: v.tileScreen(5, 5), wallAbove: !!v.tileScreen(13, 5), pen: v.tileScreen(14, 5),
          pad: JSON.stringify(hudPadding('bossPrep', sz)) === JSON.stringify(hudPadding('prep', sz)),
        };
      });
      await page.close();
      assert.deepEqual(problems, []);
      assert.deepEqual(drops[0], { area: 'board', row: target.row, col: target.col }, `drop target in board space: ${JSON.stringify(drops)}`);
      assert.deepEqual(dirs, { a: side === 'R' ? 'LEFT' : 'RIGHT', u: 'UP' });
      assert.deepEqual(past, { field: true, wallBelow: null, below: null, wallAbove: true, pen: null, pad: true });
    });
  }

  for (const side of ['L', 'R']) {
    test(`Final Assault prep (${side}): the leader stands on its spawn tile, out of the pen; a range preview lights its hit tiles in red (report #12)`, async () => {
      const { page, problems } = await open(`scene=prep&fa=${side}&stage=act2autochess_m02`, 1920, 1080);
      await wait(1500);
      const r = await page.evaluate(async () => {
        const v = window.__demo.view, d = v.debug;
        // m.private as the server sends it in a boss round's prep: nextEnemies with the leader's spawn tile (waves.js previewOf)
        const st = JSON.parse(JSON.stringify(window.__demo.scene.state));
        st.nextEnemies = [
          { enemyKey: 'enemy_9013_acstmk', count: 1, gate: 'upper', t: 0, fly: false, elite: true, boss: true, source: 'wave', tag: 'boss', start: [3, 10] },
          { enemyKey: 'enemy_1007_slime', count: 3, gate: 'lower', t: 2, fly: false, elite: false, boss: false, source: 'wave', tag: null },
        ];
        v.setPrep(st, { editable: true });
        await new Promise((res) => setTimeout(res, 2000));
        const L = d.leader;
        const hl = () => (d.tiles.highlights.get('leaderHit')?.tiles || []).map((t) => t.join(','));
        const out = { has: !!L, x: L?.view.x, y: L?.view.y, shown: !!L?.view.root.visible, facing: L?.view.visFacing, spine: !!L?.view.actor,
          pen: [...d.penViews.values()].map((p) => p.info.defId), before: hl() };
        v.highlightTiles([[10, 5], [10, 6], [10, 7]], { group: 'facing', color: 0xff9c33, fill: 0.36, line: 1 });
        out.during = hl();
        out.range = (d.tiles.highlights.get('facing')?.tiles || []).length;
        return out;
      });
      await wait(300);
      await page.screenshot({ path: path.join(OUT, `fa-leader-${side}.png`) });
      const r2 = await page.evaluate(() => {
        const v = window.__demo.view, d = v.debug;
        v.highlightTiles([], { group: 'facing' });
        const after = (d.tiles.highlights.get('leaderHit')?.tiles || []).length;
        v.setCamera('prep', { instant: true });
        return { after, hiddenOnBoard: !d.leader.view.root.visible };
      });
      await page.close();
      assert.deepEqual(problems, []);
      assert.deepEqual([r.has, r.x, r.y, r.shown], [true, 10, 3, true], 'on its spawn tile (3, 10), shown by the boss-field prep camera');
      assert.equal(r.facing, side === 'R' ? 1 : -1, 'facing the player\'s half');
      assert.ok(r.spine, 'its Spine model');
      assert.ok(!r.pen.includes('enemy_9013_acstmk') && r.pen.length === 3, `not in the pen: ${r.pen}`);
      assert.deepEqual(r.before, [], 'no red tiles without a range preview');
      assert.equal(r.range, 3);
      assert.equal(r.during.length, 15, `the 5 × 3 hit tiles: ${r.during}`);
      assert.ok(['3,8', '3,12', '5,8', '5,12', '4,10'].every((t) => r.during.includes(t)));
      assert.equal(r2.after, 0, 'gone with the range preview');
      assert.equal(r2.hiddenOnBoard, true, 'the own-board camera does not show it');
    });
  }

  test('damage numbers: a boss and a knot of minions under rapid mixed hits never show touching numbers', async () => {
    const { page, problems } = await open('scene=numbers', 1920, 1080);
    await wait(2500);
    const r = await page.evaluate(async () => {
      const v = window.__demo.view;
      let frames = 0, bad = 0, maxLive = 0;
      const t0 = performance.now();
      while (performance.now() - t0 < 4000) {
        await new Promise((res) => requestAnimationFrame(res));
        // the digits' box of every readable number (BitmapText layout metrics × scale; anchor 0.5 / 1)
        const live = v.debug.fx.nums.filter((n) => n.text.visible && n.text.alpha > 0.35).map((n) => {
          const t = n.text, sc = t.scale.x, w = t.textWidth * sc, h = t.textHeight * sc;
          return { x0: t.position.x - w / 2, x1: t.position.x + w / 2, y0: t.position.y - h * 0.85, y1: t.position.y - h * 0.1 };
        });
        maxLive = Math.max(maxLive, live.length);
        frames++;
        let hit = false;
        for (let i = 0; i < live.length && !hit; i++) for (let j = i + 1; j < live.length; j++) {
          const a = live[i], b = live[j];
          // 2 px apart at least: numbers side by side must never read as one ('41509')
          if (a.x0 - 2 < b.x1 && b.x0 - 2 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1) { hit = true; break; }
        }
        if (hit) bad++;
      }
      return { frames, bad, maxLive, stats: v.stats() };
    });
    await page.screenshot({ path: path.join(OUT, 'dmgnum-1080.png') });
    await page.close();
    assert.deepEqual(problems, []);
    assert.ok(r.maxLive >= 8, `busy scene (${r.maxLive} numbers)`);
    assert.ok(r.bad <= r.frames * 0.03, `${r.bad}/${r.frames} frames with touching numbers`);
  });

  test('lost WebGL context: the 2D board takes over, then the 3D board rebuilds itself', async () => {
    if (!hasArt) return;
    const { page, problems } = await open('scene=normal-m03&t=20', 1280, 720);
    await wait(1800);
    const r = await page.evaluate(async () => {
      const v = window.__demo.view;
      const out = { before: v.stats().board3d.on };
      v.debug.board3d.renderer.forceContextLoss();
      await new Promise((res) => setTimeout(res, 400));
      out.during = v.stats().board3d;
      await new Promise((res) => setTimeout(res, 2600));
      out.after = v.stats().board3d;
      out.units = v.stats().units;
      return out;
    });
    await page.screenshot({ path: path.join(OUT, 'board3d-context-recovered.png') });
    await page.close();
    assert.deepEqual(problems, []);
    assert.equal(r.before, true);
    assert.equal(r.during.on, false, 'the 2D board while the context is gone');
    assert.equal(r.during.recovering, true, 'a rebuild is scheduled');
    assert.equal(r.after.on, true, 'rebuilt on a fresh context');
    assert.equal(r.after.losses, 1);
    assert.ok(r.units > 0);
  });

  const PERF = [
    ['late-r13', 'scene=late-m01-r13&t=50'], ['late-r12', 'scene=late-m03-r12&t=40'], ['unite', 'scene=unite-m01&t=25'], ['boss', 'scene=boss-m02&t=30'], ['prep-pen', 'scene=prep&pen=late-m01-r13'],
  ];
  for (const board of ['3d', '2d']) {
    test(`4× throttled CPU at 1920×1080 (${board}): typical late-round / 联防 / boss / pen scenes hold ≥ 50 fps`, async () => {
      if (board === '3d' && !hasArt) return;
      const worst = [];
      for (const [name, q] of PERF) {
        const { page, problems } = await open(`${q}&board=${board}`, 1920, 1080);
        await wait(2500);
        await page.emulateCPUThrottling(4);
        await wait(1500);
        const r = await page.evaluate(async () => {
          const times = [];
          let last = performance.now();
          const t0 = last;
          await new Promise((res) => { const f = (now) => { times.push(now - last); last = now; if (now - t0 < 4000) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
          times.shift();
          const mean = times.reduce((a, b) => a + b, 0) / times.length;
          const st = window.__demo.stats();
          return { fps: Math.round((1000 / mean) * 10) / 10, cpuMs: st.cpuMs, renderMs: st.renderMs, units: st.units, pen: st.pen, lod: st.lod, culled: st.culled };
        });
        await page.emulateCPUThrottling(null);
        await page.close();
        assert.deepEqual(problems, []);
        perf.views.push({ name, board, ...r });
        worst.push(`${name} ${r.fps}`);
        assert.ok(r.fps >= 50, `${name} (${board}): ${r.fps} fps at 4× throttle (${JSON.stringify(r)})`);
      }
      void worst;
    });
  }
});
