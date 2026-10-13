// test/render/browser.test.js — headless Chrome checks of the battlefield renderer through the dev demo
// (public/dev/render-demo.html): every scene renders without console errors, Spine models load, drag & drop
// round-trips, camera transitions work, per-frame JS cost stays bounded. Screenshots → test/e2e/out/render-*.png.
//
// Opt-in (starts Chrome): RENDER_E2E=1 node --test test/render/browser.test.js
// Chrome path: $CHROME_PATH or the macOS default.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.RENDER_E2E === '1' && existsSync(CHROME) && existsSync(path.join(ROOT, 'public/assets'));
const skip = enabled ? false : 'set RENDER_E2E=1 (needs Chrome and downloaded assets)';

describe('render engine in headless Chrome', { skip }, () => {
  let srv, browser;
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    // the content-hash index first: every page then loads the served manifest's /assets/~<hash>/… URLs (ASSETS.md)
    await srv.assetIndex?.whenReady();
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => {
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
    await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?${query}`);
    await page.waitForFunction('window.__demo && (window.__demo.ready || window.__demo.error)', { timeout: 30000 });
    const err = await page.evaluate(() => window.__demo.error || null);
    assert.equal(err, null, 'demo boot');
    return { page, problems };
  }
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const SCENES = [
    ['prep', 'scene=prep', 1920, 1080],
    ['prep-720', 'scene=prep', 1280, 720],
    ['combat', 'scene=normal-m01&t=18', 1920, 1080],
    ['combat-720', 'scene=normal-m03&t=30', 1280, 720],
    ['unite', 'scene=unite-m01&t=25', 1920, 1080],
    ['boss', 'scene=boss-m02&t=30', 1920, 1080],
    ['boss-720', 'scene=boss-m02&t=12', 1280, 720],
  ];
  for (const [name, query, w, h] of SCENES) {
    test(`${name} ${w}×${h} renders cleanly`, async () => {
      const { page, problems } = await open(query + '&panel=0', w, h);
      await wait(3500);
      const st = await page.evaluate(() => window.__demo.stats());
      await page.screenshot({ path: path.join(OUT, `render-${name}.png`) });
      await page.close();
      assert.deepEqual(problems, []);
      assert.ok(st.units > 0, 'units on screen');
      assert.equal(st.spine.failed, 0, 'no Spine load failures');
      assert.ok(st.fps > 20, `fps ${st.fps}`);
      if (name.startsWith('combat') || name.startsWith('unite') || name.startsWith('boss')) {
        assert.equal(st.mode, 'battle');
        assert.ok(Math.abs(st.rate - 2) < 0.3, `2× clock (${st.rate})`);
      }
    });
  }

  test('Spine models load through the served manifest\'s content-hashed URLs, cached immutably (host bandwidth layer 1)', async (t) => {
    if (!srv.assetIndex) { t.skip('SP_ASSET_INDEX=0: no content hashes'); return; }
    const page = await browser.newPage();
    const spine = [];
    const problems = [];
    page.on('response', (r) => {
      const u = new URL(r.url());
      if (/\.(skel|atlas)$/.test(u.pathname) || (/\/spine\//.test(u.pathname) && /\.png$/.test(u.pathname))) spine.push({ path: u.pathname, status: r.status(), cache: r.headers()['cache-control'] });
      if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`);
    });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    try {
      await page.setViewport({ width: 1600, height: 900 });
      await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?scene=normal-m01&t=18&panel=0`);
      await page.waitForFunction('window.__demo && (window.__demo.ready || window.__demo.error)', { timeout: 30000 });
      await wait(3500);
      const st = await page.evaluate(() => window.__demo.stats());
      assert.ok(st.units > 0);
      assert.equal(st.spine.failed, 0, 'no Spine load failures');
      assert.ok(spine.length >= 6, `Spine files requested: ${spine.length}`);
      for (const s of spine) {
        assert.match(s.path, /^\/assets\/~[0-9a-f]{16}\//, `${s.path}: a content-hashed URL`);
        assert.equal(s.status, 200, s.path);
        assert.equal(s.cache, 'public, max-age=31536000, immutable', `${s.path}: skeleton, atlas and pages share the model hash`);
      }
      // the atlas pixi-spine derived from each skeleton came under the skeleton's segment
      for (const sk of spine.filter((s) => s.path.endsWith('.skel'))) {
        assert.ok(spine.some((s) => s.path === sk.path.replace(/\.skel$/, '.atlas')), `${sk.path}: its atlas`);
      }
      assert.deepEqual(problems, []);
    } finally { await page.close(); }
  });

  test('Swire coins from a real snapshot remain separate from the elemental gauge', async () => {
    const { makeBattle } = await import('../helpers/battleHarness.js');
    const h = makeBattle({ autoFinish: false, units: [{ uid: 1, chessId: 'chess_char_3_04_a', row: 10, col: 4, skillIndex: 1 }] });
    h.step(); const u = h.unit(1); u.mem.coins = 1;
    h.b.dealDamage(null, u, { type: 'element', element: 'burn', amount: 300 });
    const { page, problems } = await open('scene=prep&panel=0', 1600, 900);
    try {
      await page.evaluate(({ meta, snap }) => {
        window.__demo.pause(); const v = window.__demo.view;
        v.enterBattle(meta); v.pushSnapshot(snap);
      }, { meta: h.b.fieldMeta(), snap: h.b.snapshot() });
      await page.waitForFunction(id => window.__demo.view.debug.views.get(id)?.coinHud?.root.visible, {}, u.id);
      const bounds = await page.evaluate(id => {
        const v = window.__demo.view.debug.views.get(id), coins = v.coinHud.root.getBounds(), elem = v._elBar.root.getBounds();
        return { label: v.coinHud.text.text, coinBottom: coins.bottom, elementTop: elem.top };
      }, u.id);
      assert.equal(bounds.label, `1/${u.skill.bb.sp}`);
      assert.ok(bounds.coinBottom <= bounds.elementTop, JSON.stringify(bounds));
      await page.screenshot({ path: path.join(OUT, 'swire-coins-element.png') });
      assert.deepEqual(problems, []);
    } finally { await page.close(); }
  });

  test('外勤医疗 reserve medic opens its detail from normal and right boss preparation without being draggable', async () => {
    const { page, problems } = await open('scene=prep&panel=0', 1600, 900);
    const first = await page.evaluate(() => {
      const v = window.__demo.view;
      const st = JSON.parse(JSON.stringify(window.__demo.scene.state));
      st.prepMapChars = [{ id: -1, uid: -1, kind: 'token', side: 'ally', ownerId: 'p_0',
        defId: 'char_605_cmedic', name: '预备干员-医疗', spine: 'char_605_cmedic', avatar: 'char_605_cmedic',
        area: 'board', x: 2, y: 10, dir: 'RIGHT', facing: 1, maxHp: 1202 }];
      window.__touchPrepChar = st.prepMapChars[0];
      v.setPrep(st, { editable: true });
      const medic = v.debug.views.get('m:-1');
      const p = v.tileScreen(10, 2), rect = v.debug.app.view.getBoundingClientRect();
      let clicked = null;
      const off = v.on('pieceClick', (e) => { clicked = e; });
      v.debug.app.view.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 61, clientX: p.x, clientY: p.y }));
      off();
      const out = { exists: !!medic, id: medic?.info.defId, x: medic?.x, y: medic?.y,
        draggable: !!v.debug.pick.pieceAt(p.x - rect.left, p.y - rect.top),
        clicked: clicked ? { uid: clicked.uid, id: clicked.unit?.defId, row: clicked.unit?.y, col: clicked.unit?.x,
          prepMapChar: clicked.prepMapChar } : null };
      return out;
    });
    await wait(500);
    await page.screenshot({ path: path.join(OUT, 'touch-prep-normal.png') });
    const boss = await page.evaluate(() => {
      const v = window.__demo.view;
      v.setCamera('bossPrep', { side: 'R', instant: true });
      const mirrored = v.debug.views.get('m:-1');
      const p = v.tileScreen(10, 2);
      let clicked = null;
      const off = v.on('pieceClick', (e) => { clicked = e; });
      v.debug.app.view.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 62, clientX: p.x, clientY: p.y }));
      off();
      return { view: [mirrored?.x, mirrored?.y, mirrored?.dir],
        clicked: clicked ? [clicked.unit?.y, clicked.unit?.x, clicked.unit?.dir, clicked.prepMapChar] : null };
    });
    await wait(500);
    await page.screenshot({ path: path.join(OUT, 'touch-prep-boss-right.png') });
    const removed = await page.evaluate(() => {
      const v = window.__demo.view;
      const st = JSON.parse(JSON.stringify(window.__demo.scene.state));
      st.prepMapChars = [];
      v.setPrep(st, { editable: true });
      const p = v.tileScreen(10, 2), rect = v.debug.app.view.getBoundingClientRect();
      return !v.debug.views.has('m:-1') && !v.debug.pick.mapCharAt(p.x - rect.left, p.y - rect.top);
    });
    const fallback = await page.evaluate(async () => {
      const { createFallbackView } = await import('/js/ui/fallbackField.js');
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;width:800px;height:600px';
      document.body.appendChild(host);
      const ff = createFallbackView(host, { data: { get: () => null, lookup: () => null } });
      ff.setPrep({ board: [], hand: [], temp: [], prepMapChars: [window.__touchPrepChar] }, { editable: true });
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const el = host.querySelector('.ff-piece--map-char');
      let clicked = null;
      const off = ff.on('pieceClick', (e) => { clicked = e; });
      el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 63 }));
      off();
      const out = { exists: !!el, name: el?.title, pointerEvents: el ? getComputedStyle(el).pointerEvents : null,
        movableId: el?.dataset.uid ?? null, clicked: clicked ? [clicked.unit?.defId, clicked.prepMapChar] : null };
      ff.destroy(); host.remove();
      return out;
    });
    await page.close();
    assert.deepEqual(problems, []);
    assert.deepEqual(first, { exists: true, id: 'char_605_cmedic', x: 2, y: 10,
      draggable: false, clicked: { uid: -1, id: 'char_605_cmedic', row: 10, col: 2, prepMapChar: true } });
    assert.deepEqual(boss, { view: [18, 3, 'LEFT'], clicked: [10, 2, 'RIGHT', true] });
    assert.equal(removed, true);
    assert.deepEqual(fallback, { exists: true, name: '预备干员-医疗', pointerEvents: 'auto', movableId: null,
      clicked: ['char_605_cmedic', true] });
  });

  test('fx gallery: every sim fx kind, projectile and status renders without errors; board art in use', async () => {
    const { page, problems } = await open('scene=fx&panel=0', 1280, 720);
    // cycle through the whole FX_KINDS table (one kind every 0.5 game s = 0.25 real s), watching the FX system: shots
    // in flight (every projectile kind incl. the boomerang) and 蕾缪安's S3 locks (the gallery plays it at 'lock')
    const kinds = await page.evaluate(async () => (await import('/js/render/fx.js')).FX_KINDS).then((k) => Object.keys(k).length);
    const seen = await page.evaluate(async (ms) => {
      const seen = { projectiles: 0, particles: 0, locks: 0, auras: 0 };
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        const st = window.__demo.stats();
        for (const k of Object.keys(seen)) seen[k] = Math.max(seen[k], st[k] || 0);
        await new Promise((r) => setTimeout(r, 100));
      }
      return seen;
    }, Math.min(45000, kinds * 260 + 1500));
    const st = await page.evaluate(() => window.__demo.stats());
    await page.screenshot({ path: path.join(OUT, 'render-fx.png') });
    await page.close();
    assert.deepEqual(problems, []);
    assert.equal(st.mode, 'battle');
    assert.ok(st.units >= 10, `units ${st.units}`);
    assert.ok(seen.projectiles > 0 && seen.particles > 20 && seen.auras > 0, `projectiles, particles and a skill aura drawn (${JSON.stringify(seen)})`);
    assert.ok(seen.locks >= 2, `蕾缪安's lock reticles shown (${JSON.stringify(seen)})`);
    if (existsSync(path.join(ROOT, 'public/assets/local/map/autochess/tiles.json'))) assert.equal(st.boardArt, true, 'real board art composed');
  });

  /** fps / JS-per-frame (frame() + Pixi render EMAs, app.js stats) / particles over `ms`, sampled every 200 ms. */
  async function frameCost(page, ms) {
    return page.evaluate(async (ms) => {
      const rows = [];
      const t0 = performance.now();
      while (performance.now() - t0 < ms) {
        const s = window.__demo.stats();
        rows.push([s.fps, s.cpuMs, s.renderMs, s.particles, s.projectiles]);
        await new Promise((r) => setTimeout(r, 200));
      }
      const avg = (i) => rows.reduce((a, r) => a + r[i], 0) / rows.length;
      return { fps: avg(0), cpuMs: avg(1), renderMs: avg(2), particles: avg(3), maxParticles: Math.max(...rows.map((r) => r[3])), projectiles: avg(4) };
    }, ms);
  }
  const costLine = (c) => `fps ${c.fps.toFixed(1)} · JS ${c.cpuMs.toFixed(2)} + render ${c.renderMs.toFixed(2)} ms/frame · particles ${c.particles.toFixed(0)} (max ${c.maxParticles}) · shots ${c.projectiles.toFixed(1)}`;

  test('stress: 120 units + FX keep the per-frame JS cost bounded', async (t) => {
    const { page, problems } = await open('scene=stress&panel=0');
    await wait(3000);
    const cost = await frameCost(page, 3000);
    const st = await page.evaluate(() => window.__demo.stats());
    await page.screenshot({ path: path.join(OUT, 'render-stress.png') });
    await page.close();
    t.diagnostic(`stress 1920×1080: ${costLine(cost)}`);
    assert.deepEqual(problems, []);
    assert.equal(st.units, 120);
    assert.ok(st.impostor >= 2, 'crowded field switches to impostor rendering');
    assert.ok(cost.cpuMs + cost.renderMs < 16, `JS per frame ${cost.cpuMs} + ${cost.renderMs} ms`);
  });

  test('crowded boss battle: the FX keep the per-frame JS cost bounded', async (t) => {
    const { page, problems } = await open('scene=boss-m02&t=16&panel=0');
    await wait(2500);
    // t ≈ 21–29 (2×): 蕾缪安's S3 locks (21–24) and her shells one by one (24–26), skills, crowds of shots and hits
    const cost = await frameCost(page, 4000);
    await page.close();
    t.diagnostic(`boss-m02 1920×1080: ${costLine(cost)}`);
    assert.deepEqual(problems, []);
    assert.ok(cost.fps > 20, `fps ${cost.fps}`);
    assert.ok(cost.cpuMs + cost.renderMs < 16, `JS per frame ${cost.cpuMs} + ${cost.renderMs} ms`);
  });

  test('drag a hand piece onto a legal board tile; right-click opens detail', async () => {
    const { page, problems } = await open('scene=prep&panel=0', 1600, 900);
    await wait(2000);
    const info = await page.evaluate(() => {
      const v = window.__demo.view, st = window.__demo.scene.state;
      const uid = st.hand[0].uid;
      const r = v.pieceScreenRect(uid);
      const t = v.debug.cam.project(5, 10, 0);
      return { uid, r, target: { x: t.x, y: t.y } };
    });
    assert.ok(info.r && info.r.width > 10, 'pieceScreenRect');
    const cx = info.r.left + info.r.width / 2, cy = info.r.top + info.r.height * 0.6;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) await page.mouse.move(cx + (info.target.x - cx) * i / 10, cy + (info.target.y - cy) * i / 10);
    await page.screenshot({ path: path.join(OUT, 'render-drag.png') });
    await page.mouse.up();
    await wait(700);
    const placed = await page.evaluate((uid) => window.__demo.scene.state.board.find((p) => p.uid === uid) || null, info.uid);
    assert.ok(placed, 'piece moved to the board');
    assert.deepEqual([placed.row, placed.col], [10, 5]);
    // picking is by tile (user playtest #4 item 1): right-click the unit's own tile
    const r2 = await page.evaluate(() => { const p = window.__demo.scene.state.board[1]; return window.__demo.view.tileScreen(p.row, p.col); });
    await page.mouse.click(r2.x, r2.y, { button: 'right' });
    await wait(150);
    const log = await page.evaluate(() => window.__demo.log.join('\n'));
    assert.match(log, /pieceClick .*"detail":true/);
    await page.close();
    assert.deepEqual(problems, []);
  });

  test('API survives junk input, calls in any order, and double destroy', async () => {
    const { page, problems } = await open('scene=prep&panel=0', 1280, 720);
    await wait(1000);
    const res = await page.evaluate(async () => {
      const { createFieldView } = await import('/js/render/app.js');
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:640px;height:360px;z-index:9';
      document.body.appendChild(host);
      const v = await createFieldView(host, { data: null, assets: null });
      const out = [];
      const tryit = (name, fn) => { try { out.push([name, fn()]); } catch (e) { out.push([name, 'THROW ' + e.message]); } };
      tryit('pushSnapshot before battle', () => v.pushSnapshot({ t: 1, units: [[1, 2, 3, 4, 5, 6, 7, 8, 9]] }));
      tryit('setStage junk', () => v.setStage({ rows: 5 }));
      tryit('setStage null', () => v.setStage(null));
      tryit('setCamera junk', () => v.setCamera(null, null));
      tryit('setCamera weird', () => v.setCamera('zzz', { rect: { r0: 'a' } }));
      tryit('setPrep null', () => v.setPrep(null));
      tryit('setPrep junk', () => v.setPrep({ hand: 'x', temp: [null, 5, { uid: 'q' }], board: [{ uid: 1, row: 99, col: 1, kind: 'chess', id: 'nope' }, { uid: 2, row: 10, col: 4, kind: 'chess', id: 'nope' }] }, { editable: true, canPlace: () => { throw new Error('x'); } }));
      tryit('highlight junk', () => v.highlightTiles('x', 'y'));
      tryit('highlight mixed', () => v.highlightTiles([[1, 2], { row: 3, col: 4 }, null, [99, 99], ['a']], { color: 0xff0000 }));
      tryit('highlight clear', () => v.highlightTiles(null));
      tryit('enterBattle junk', () => v.enterBattle({ units: [null, { id: {} }, { id: 5, x: 'q' }] }));
      tryit('pushSnapshot junk', () => [v.pushSnapshot(null), v.pushSnapshot({ t: NaN }), v.pushSnapshot({ t: 1, units: [[5, 1, 1, 10, 10, 0, 0, 0, 0], 'x', [7]] })]);
      tryit('pushEvents junk', () => [v.pushEvents(null), v.pushEvents({ ev: 'x' }), v.pushEvents([['atk', 5, 999, 'arrow'], ['dmg', 5, 'x', 'phys'], ['heal'], ['status', 5], ['fx', 'burst', 'a', null, null], ['layer', 1, 'yanShip', 3], ['bounty', 1, 2], ['leak', 5], ['nope'], 7])]);
      await new Promise((r) => setTimeout(r, 400));
      tryit('snapshot after', () => v.pushSnapshot({ t: 1.2, units: [[5, 1.5, 1, 10, 10, 0, 0, 16, 2]] }));
      await new Promise((r) => setTimeout(r, 300));
      tryit('pieceScreenRect', () => [v.pieceScreenRect(-1), v.pieceScreenRect(undefined)]);
      tryit('settings', () => { v.setSettings(null); v.setSettings({ quality: 'low', damageNumbers: false }); v.setSettings({ quality: 'nope' }); return true; });
      tryit('on junk', () => typeof v.on('x', null));
      tryit('stats', () => v.stats().mode);
      tryit('destroy', () => { v.destroy(); v.destroy(); return true; });
      tryit('after destroy', () => [v.setPrep({}), v.pushSnapshot({ t: 9, units: [] }), v.enterBattle({})]);
      host.remove();
      return out;
    });
    await wait(300);
    await page.close();
    const thrown = res.filter(([, r]) => typeof r === 'string' && r.startsWith('THROW'));
    assert.deepEqual(thrown, []);
    assert.deepEqual(problems.filter((p) => !/\[render\]/.test(p)), []);
  });

  test('raised blocks share the unit layer and sort around units; operators on walls stand on top', async () => {
    // the 2D atlas board's block rows (the 3D board, default when the local art is installed, has none: board=2d)
    const { page, problems } = await open('scene=normal-m01&t=4&panel=0&board=2d', 1600, 900);
    await wait(2500);
    const r = await page.evaluate(() => {
      const { tiles, views } = window.__demo.view.debug;
      const out = { rows: [...tiles.rowMeshes.keys()], shared: true, order: [], walls: [] };
      for (const [id, v] of views) {
        if (!v.root || v.destroyed || !v.alive) continue;
        const row = Math.round(v.y);
        if (Math.round(v.x) === 4 && row >= 10 && row <= 12) {
          out.walls.push({ id, z: v.z, shadowOnSurface: v.shadow?.parent === tiles.rowSurfaces.get(row) });
        }
        for (const [br, { mesh: m }] of tiles.rowMeshes) {
          if (m.parent !== v.root.parent) out.shared = false;
          const kids = m.parent.children;
          // after a render the layer is sorted: the unit is behind the row's blocks iff it stands further back
          out.order.push({ id, y: v.y, br, before: kids.indexOf(v.root) < kids.indexOf(m) });
        }
      }
      return out;
    });
    await page.screenshot({ path: path.join(OUT, 'render-walls.png') });
    await page.close();
    assert.deepEqual(problems, []);
    assert.ok(r.rows.length > 0, 'raised rows have block meshes');
    assert.ok(r.shared, 'block rows live in the unit layer');
    const wrong = r.order.filter((o) => o.before !== (o.y > o.br + 0.5));
    assert.deepEqual(wrong, [], 'units behind a block row are drawn before it, others after');
    assert.ok(r.walls.length >= 2, `operators on the col-4 walls (${r.walls.length})`);
    for (const w of r.walls) {
      assert.ok(w.z > 0.12, `unit ${w.id} stands on the wall (z ${w.z})`);
      assert.ok(w.shadowOnSurface, `unit ${w.id} shadow lies on the wall top`);
    }
  });

  test('attack wind-up starts before the atk event reaches the render clock', async () => {
    const { page, problems } = await open('scene=normal-m01&t=6&panel=0', 1280, 720);
    await wait(800);
    const log = await page.evaluate(async () => {
      const { views, interp } = window.__demo.view.debug;
      const log = [];
      const hook = () => {
        for (const [id, v] of views) {
          if (v._hooked || !v.windUp) continue;
          v._hooked = true;
          const w = v.windUp.bind(v), a = v.onAttack.bind(v);
          v.windUp = (lead) => { const ok = w(lead); if (ok) log.push(['wind', id, interp.renderT, lead]); return ok; };
          v.onAttack = (tg, now) => { log.push(['atk', id, interp.renderT]); return a(tg, now); };
        }
      };
      for (let i = 0; i < 80; i++) { hook(); await new Promise((r) => setTimeout(r, 50)); }
      return log;
    });
    await page.close();
    assert.deepEqual(problems, []);
    const winds = log.filter((e) => e[0] === 'wind');
    assert.ok(winds.length >= 3, `wind-ups started (${winds.length})`);
    let paired = 0;
    for (const [, id, t, lead] of winds) {
      assert.ok(lead > 0 && lead <= 1.5, `lead ${lead}`);
      const hit = log.find((e) => e[0] === 'atk' && e[1] === id && e[2] >= t);
      if (hit && hit[2] - t > 0.02) paired++;
    }
    assert.ok(paired >= 2, `wind-ups followed by their attack (${paired})`);
  });

  test('a leaked enemy fades once and is not recreated from the trailing snapshots', async () => {
    const { page, problems } = await open('scene=normal-m02&t=33.5&panel=0', 1280, 720);
    const seen = await page.evaluate(async () => {
      const { views, interp } = window.__demo.view.debug;
      const seen = [];
      for (let i = 0; i < 120; i++) {
        seen.push([interp.renderT, views.has(18)]);
        await new Promise((r) => setTimeout(r, 25));
      }
      return seen;
    });
    await page.close();
    assert.deepEqual(problems, []);
    const first = seen.findIndex(([, has]) => has);
    assert.ok(first >= 0, 'enemy 18 shown before its leak');
    const gone = seen.findIndex(([, has], i) => i > first && !has);
    assert.ok(gone > first && seen[gone][0] > 35, `removed after the leak at 35 (at ${seen[gone]?.[0]})`);
    const back = seen.slice(gone).filter(([, has]) => has);
    assert.deepEqual(back, [], 'not resurrected by the snapshots that still list it');
  });

  test('prep scouting board (prep:true + one gt:0 snapshot) stays visible and static', async () => {
    const { page, problems } = await open('scene=prep&panel=0', 1280, 720);
    await wait(1200);
    const r = await page.evaluate(async () => {
      const rec = await fetch('/dev/recordings/normal-m01.json').then((x) => x.json());
      const v = window.__demo.view;
      const snap = rec.frames[0].snap;
      v.enterBattle({ fieldId: 'scout', kind: 'normal', rect: rec.field.rect, units: rec.field.units, prep: true });
      v.pushSnapshot({ t: 'b.snap', fieldId: 'scout', gt: 0, units: snap.units });
      const pos = () => [...v.debug.views].filter(([, u]) => u.root && !u.destroyed).map(([id, u]) => [id, +u.x.toFixed(3), +u.y.toFixed(3), u.root.visible && u.root.alpha > 0.5]);
      await new Promise((res) => setTimeout(res, 1500));
      const a = pos();
      await new Promise((res) => setTimeout(res, 1500));
      return { a, b: pos(), n: rec.field.units.length, mode: v.stats().mode };
    });
    await page.screenshot({ path: path.join(OUT, 'render-scout.png') });
    await page.close();
    assert.deepEqual(problems, []);
    assert.equal(r.a.length, r.n, 'every unit has a view');
    assert.ok(r.a.every((u) => u[3]), 'all visible');
    assert.deepEqual(r.b, r.a, 'nothing moved or vanished');
  });

  test('facing hooks: tileScreen / holdPiece / setPieceDir; board pieces and battle allies are built with their dir', async () => {
    const { page, problems } = await open('scene=prep&panel=0', 1600, 900);
    await wait(1500);
    const r = await page.evaluate(async () => {
      const v = window.__demo.view, st = window.__demo.scene.state;
      const out = {};
      // tileScreen = the camera projection of the tile-top centre, in client px (the wheel's geometry)
      const ts = v.tileScreen(10, 5);
      const cr = v.debug.app.view.getBoundingClientRect();
      const c = v.debug.cam.project(5, 10, v.debug.tiles.heightAt(10, 5));
      out.ts = ts && [Math.abs(ts.x - (cr.left + c.x)) < 0.01, Math.abs(ts.y - (cr.top + c.y)) < 0.01, ts.poly.length, ts.s > 0];
      out.tsJunk = [v.tileScreen('a', 1), v.tileScreen(1.5, 2)];
      // holdPiece pins a bench piece on a board tile across setPrep calls until released
      const uid = st.hand[0].uid;
      const pv = () => v.debug.views.get('p:' + uid);
      v.holdPiece(uid, { row: 10, col: 5 });
      await new Promise((res) => setTimeout(res, 450));
      out.held = [+pv().x.toFixed(2), +pv().y.toFixed(2)];
      v.setPrep(JSON.parse(JSON.stringify(st)), { editable: true });
      await new Promise((res) => setTimeout(res, 1600)); // longer than the drop-pending grace
      out.heldAfterPrep = [+pv().x.toFixed(2), +pv().y.toFixed(2)];
      v.holdPiece(uid, null);
      v.setPrep(JSON.parse(JSON.stringify(st)), { editable: true });
      await new Promise((res) => setTimeout(res, 450));
      out.released = [+pv().x.toFixed(2), +pv().y.toFixed(2)];
      // setPieceDir re-orients a prep view
      out.setDir = [v.setPieceDir(uid, 'UP'), pv().dir, v.setPieceDir(-5, 'UP'), v.setPieceDir(uid, 7)];
      v.setPieceDir(uid, 'RIGHT');
      // a board piece carrying dir is built facing it (after the round's rebuild: enterPrepMode clears every view)
      const b0 = st.board[0];
      v.enterBattle({ fieldId: 'x', kind: 'normal', units: [] });
      const next = JSON.parse(JSON.stringify(st));
      next.board[0].dir = 'LEFT';
      if (next.board[1]) next.board[1].dir = 'UP';
      v.setPrep(next, { editable: true });
      const bv = (p) => v.debug.views.get('p:' + p.uid);
      out.built = [bv(b0).dir, bv(b0).facing, next.board[1] ? bv(next.board[1]).dir : 'UP'];
      // battle / scouting allies keep UnitInfo.dir (model + ground wedge); a unit without it derives RIGHT, no wedge
      v.enterBattle({ fieldId: 'dirs', kind: 'normal', rect: { r0: 9, r1: 12, c0: 0, c1: 10 }, prep: true, units: [
        { id: 1, kind: 'op', side: 'ally', defId: b0.id, x: 3, y: 10, facing: 1, dir: 'UP', maxHp: 100 },
        { id: 2, kind: 'op', side: 'ally', defId: b0.id, x: 4, y: 10, facing: -1, dir: 'LEFT', maxHp: 100 },
        { id: 3, kind: 'op', side: 'ally', defId: b0.id, x: 5, y: 10, facing: 1, maxHp: 100 },
      ] });
      v.pushSnapshot({ fieldId: 'dirs', gt: 0, units: [[1, 3, 10, 100, 100, 0, 0, 0, 0], [2, 4, 10, 100, 100, 0, 0, 0, 0], [3, 5, 10, 100, 100, 0, 0, 0, 0]] });
      await new Promise((res) => setTimeout(res, 500));
      const u = (id) => v.debug.views.get(id);
      out.battle = [1, 2, 3].map((id) => u(id) && [u(id).dir, u(id).hasDir, u(id).facing]);
      return out;
    });
    await page.close();
    assert.deepEqual(problems, []);
    assert.deepEqual(r.ts, [true, true, 4, true], 'tileScreen = projected tile centre + 4 corners');
    assert.deepEqual(r.tsJunk, [null, null]);
    assert.deepEqual(r.held, [5, 10], 'held on the tile');
    assert.deepEqual(r.heldAfterPrep, [5, 10], 'setPrep and the drop grace keep a held piece on its tile');
    assert.notDeepEqual(r.released, [5, 10], 'released: back on its bench slot');
    assert.deepEqual(r.setDir, [true, 'UP', false, false]);
    assert.deepEqual(r.built, ['LEFT', -1, 'UP'], 'stored dir applied at build time');
    assert.deepEqual(r.battle, [['UP', true, 1], ['LEFT', true, -1], ['RIGHT', false, 1]]);
  });

  test('a merge completed between two preps (band grant at ROUND_START, after a battle) still plays the promotion cue (QA 6b)', async () => {
    const { page, problems } = await open('scene=prep&panel=0', 1600, 900);
    await wait(1500);
    const r = await page.evaluate(async () => {
      const v = window.__demo.view, st = window.__demo.scene.state;
      const rows = await (await fetch('/data/chess.json')).json();
      const chess = rows.chess || rows;
      const prev = JSON.parse(JSON.stringify(st));
      const b0 = prev.board.find((p) => p.kind === 'chess' && chess[p.id] && !chess[p.id].isGolden && chess[p.id].goldenId);
      if (!b0) return { skip: 'no normal chess on the demo board' };
      // the other copy waits in the hand
      const uids = [...prev.hand, ...prev.board, ...(prev.temp || [])].filter(Boolean).map((p) => p.uid);
      const hu = Math.max(...uids) + 1;
      prev.hand = [{ uid: hu, kind: 'chess', id: b0.id }, ...prev.hand.filter((p) => p && p.uid !== hu)].slice(0, 9);
      v.setPrep(prev, { editable: true });
      const n0 = v.debug.promotions.length;
      // a battle rebuilds the scene; the merge's elite takes the deployed copy's tile at the next round start
      v.enterBattle({ fieldId: 'x', kind: 'normal', units: [] });
      const next = JSON.parse(JSON.stringify(prev));
      next.hand = next.hand.filter((p) => p.uid !== hu);
      const eu = hu + 1;
      next.board = next.board.map((p) => (p.uid === b0.uid ? { uid: eu, kind: 'chess', id: chess[b0.id].goldenId, golden: true, row: b0.row, col: b0.col, dir: b0.dir } : p));
      v.setPrep(next, { editable: true });
      const p = v.debug.promotions.slice(n0);
      // a plain round rebuild (no merge) cues nothing
      v.enterBattle({ fieldId: 'y', kind: 'normal', units: [] });
      v.setPrep(JSON.parse(JSON.stringify(next)), { editable: true });
      return { p, after: v.debug.promotions.length - n0, row: b0.row, col: b0.col, eu };
    });
    await page.close();
    assert.deepEqual(problems, []);
    assert.equal(r.skip, undefined, 'the demo board has a normal operator');
    assert.equal(r.p.length, 1, JSON.stringify(r.p));
    assert.deepEqual([r.p[0].uid, r.p[0].area, r.p[0].row, r.p[0].col, r.p[0].copies], [r.eu, 'board', r.row, r.col, 2], 'the elite on the copy\'s tile, both copies');
    assert.equal(r.after, 1, 'no cue for a rebuild without a merge');
  });

  test('drops outside the stage report client coords; a refused drop tweens back home', async () => {
    const { page, problems } = await open('scene=prep&panel=0', 1600, 900);
    await wait(2000);
    const info = await page.evaluate(() => {
      window.__demo.refuseDrops = true;
      const v = window.__demo.view, st = window.__demo.scene.state;
      const uid = st.hand[0].uid;
      const pv = v.debug.views.get('p:' + uid);
      const t = v.debug.cam.project(5, 10, 0);
      return { uid, r: v.pieceScreenRect(uid), home: [pv.x, pv.y], target: { x: t.x, y: t.y } };
    });
    const drag = async (tx, ty) => {
      const cx = info.r.left + info.r.width / 2, cy = info.r.top + info.r.height * 0.6;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= 10; i++) await page.mouse.move(cx + (tx - cx) * i / 10, cy + (ty - cy) * i / 10);
      await page.mouse.up();
    };
    await drag(8, 8);
    await wait(500);
    const log1 = await page.evaluate(() => window.__demo.log.join('\n'));
    assert.match(log1, /pieceDrop .*"area":"outside","clientX":8,"clientY":8/);
    await drag(info.target.x, info.target.y);
    await wait(250);
    const mid = await page.evaluate((uid) => { const pv = window.__demo.view.debug.views.get('p:' + uid); return [pv.x, pv.y]; }, info.uid);
    await wait(1800);
    const end = await page.evaluate((uid) => { const pv = window.__demo.view.debug.views.get('p:' + uid); return [pv.x, pv.y]; }, info.uid);
    const onBoard = await page.evaluate((uid) => window.__demo.scene.state.board.some((p) => p.uid === uid), info.uid);
    await page.close();
    assert.deepEqual(problems, []);
    assert.equal(onBoard, false, 'demo refused the move');
    assert.ok(Math.hypot(mid[0] - 5, mid[1] - 10) < 0.3, `held at the drop tile while pending (${mid})`);
    assert.ok(Math.hypot(end[0] - info.home[0], end[1] - info.home[1]) < 0.05, `back home (${end} vs ${info.home})`);
  });

  test('DPR change and resize re-fit the canvas', async () => {
    const { page, problems } = await open('scene=normal-m02&t=10&panel=0', 1280, 720);
    await wait(1000);
    const size = () => page.evaluate(() => { const c = window.__demo.view.debug.app.view; return [c.width, c.height]; });
    const a = await size();
    await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 2 });
    await wait(700);
    const b = await size();
    await page.setViewport({ width: 900, height: 700, deviceScaleFactor: 1 });
    await wait(700);
    const c = await size();
    await page.screenshot({ path: path.join(OUT, 'render-resize.png') });
    await page.close();
    assert.deepEqual(problems, []);
    assert.ok(b[0] > a[0] * 1.3, `DPR 2 raises the backing resolution (${a} → ${b})`);
    assert.ok(c[0] < b[0] && Math.abs(c[0] / c[1] - 900 / 700) < 0.05, `resized to 900×700 aspect (${c})`);
  });

  test('camera flies prep → boss → unite without errors', async () => {
    const { page, problems } = await open('scene=prep&panel=0', 1280, 720);
    await wait(1500);
    await page.evaluate(() => window.__demo.view.setCamera('boss'));
    await wait(350);
    await page.screenshot({ path: path.join(OUT, 'render-camera-mid.png') });
    await wait(700);
    const cam1 = await page.evaluate(() => window.__demo.view.stats().camera);
    await page.evaluate(() => window.__demo.view.setCamera('unite'));
    await wait(1000);
    const cam2 = await page.evaluate(() => window.__demo.view.stats().camera);
    await page.close();
    assert.deepEqual(problems, []);
    assert.ok(cam1.ty < 5, 'boss camera looks at rows 0–5');
    assert.ok(cam2.tx > 9 && cam2.ty > 9, 'unite camera centred on the wide field');
  });
});
