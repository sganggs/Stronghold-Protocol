// test/render/impostor-bounds.browser.test.js — GitHub #542 (reported by @ImPQlc) in headless Chrome, real WebGL: a crowd
// drawn through the impostor atlas (public/dev/render-demo.html?scene=stress: 120 units, impostor interval ≥ 2) with the
// three reported operators in it (&ops=: 野鬃, 浊心斯卡蒂, 隐现), each held in its widest pose — 野鬃's flag at 0.27 s of
// Idle, 浊心斯卡蒂 at 3.5 s of Skill_3_Begin (the S3 flight), 隐现 at 0.33 s of Skill_2_Loop (the silenced pistol).
// Checks: every pose lies inside its unit's slot; after every page is cleared and every impostor redrawn once, no atlas
// pixel lies outside a live slot (render/impostor.js clips each slot's skeleton to the slot rectangle — a scissor rect);
// the scissor itself on a bare atlas page (a quad 9× its slot paints only the slot, a redraw clears the slot, a neighbour
// keeps its pixels); a clip too large for the box (野鬃's deploy drop) is drawn directly while it plays, then the impostor
// comes back. Pictures → test/e2e/out/impostor-542-after-*.png (each operator in the crowd, the atlas pages with the slot
// outlines). The same pictures of the code before #542 are made by checking out its parent and running this file.
//
// Opt-in (starts Chrome, needs the downloaded assets): RENDER_E2E=1 node --test test/render/impostor-bounds.browser.test.js
// Chrome path: $CHROME_PATH or the macOS default.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.RENDER_E2E === '1' && existsSync(CHROME) && existsSync(path.join(ROOT, 'public/assets'));
const skip = enabled ? false : 'set RENDER_E2E=1 (needs Chrome and downloaded assets)';
const TAG = process.env.IMPOSTOR_SHOT_TAG || 'after';   // file name tag of the pictures ('before' on the parent commit)

// [unit id (render-demo &ops= places), chessId, label, clip, loop, seconds into it]
const OPS = [
  [6, 'chess_char_1_19_a', 'wildmn-idle', 'Idle', true, 0.273],
  [8, 'chess_char_6_04_a', 'skadi2-s3begin', 'Skill_3_Begin', false, 3.527],
  [10, 'chess_char_1_01_a', 'inside-s2loop', 'Skill_2_Loop', true, 0.333],
];
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

describe('impostor boxes and slot clipping in headless Chrome (GitHub #542)', { skip }, () => {
  let srv, browser, page;
  const problems = [];
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    await srv.assetIndex?.whenReady();
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
    mkdirSync(OUT, { recursive: true });
    page = await browser.newPage();
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`); });
    await page.setViewport({ width: 1600, height: 900 });
    await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?scene=stress&panel=0&ops=${OPS.map((o) => o[1]).join(',')}`);
    await page.waitForFunction('window.__demo && (window.__demo.ready || window.__demo.error)', { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__demo.error || null), null, 'demo boot');
    // the crowd loads, its clips are measured, every unit becomes an impostor
    await page.waitForFunction((ids) => {
      const v = window.__demo.view;
      if (v.stats().impostor < 2) return false;
      for (const id of ids) { const u = v.debug.views.get(id); if (!u || !u.spineReady || !u.imp || u.imp.bypass) return false; }
      return true;
    }, { timeout: 40000, polling: 200 }, OPS.map((o) => o[0]));
    await wait(2500);   // the crowd attacks and casts for a while
    await page.evaluate(() => window.__demo.pause());
    await wait(300);
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  test('the three operators held in their widest poses: inside their slots; no atlas pixel outside a live slot', async () => {
    await page.evaluate((ops) => {
      const views = window.__demo.view.debug.views;
      for (const [id, , , clip, loop, t] of ops) {
        const v = views.get(id);
        v.actor.mode = 'base';
        v.actor._play(clip, loop, { timeScale: 0, mix: 0, start: t });
        if (v.imp) v.imp.dirty = true;
      }
    }, OPS);
    await wait(800);
    // a clean slate: every page cleared, every impostor redrawn once — what lies outside the live slots afterwards was
    // painted by these redraws (a freed slot's old pixels would count otherwise)
    await page.evaluate(() => {
      const view = window.__demo.view;
      const R = view.debug.app.renderer;
      for (const pg of view.debug.ctx.impostors.pages) R.render(new PIXI.Container(), { renderTexture: pg.rt, clear: true });
      for (const v of view.debug.views.values()) if (v.imp) v.imp.dirty = true;
    });
    await wait(600);
    const info = await page.evaluate((ops) => {
      const view = window.__demo.view;
      const atlas = view.debug.ctx.impostors;
      const R = view.debug.app.renderer;
      const res = atlas.res;
      const units = ops.map(([id, , label, clip]) => {
        const v = view.debug.views.get(id);
        const b = v.actor.spine.getLocalBounds();
        const s = v.imp && v.imp.slot, box = v._box, sc = v.imp ? v.imp.sc : 0, yK = v.modelKY || 1;
        const track = v.actor.spine.state.tracks[0]?.animation?.name;
        if (!s || !box) return { label, track, clip, slot: null };
        const x0 = (b.x - box.x0) * sc, y0 = (b.y - box.y0) * sc * yK, x1 = x0 + b.width * sc, y1 = y0 + b.height * sc * yK;
        return { label, track, clip, slot: [s.x, s.y, s.w, s.h], over: Math.max(-x0, -y0, x1 - s.w, y1 - s.h), sc };
      });
      const live = [];
      for (const v of view.debug.views.values()) if (v.imp && v.imp.slot && !v.imp.slot.freed) live.push(v.imp.slot);
      const pages = [], images = [];
      for (const pg of atlas.pages) {
        if (!pg.cleared) continue;
        const px = R.extract.pixels(pg.rt);
        const W = Math.round(pg.size * res);
        const mine = live.filter((s) => s.page === pg);
        const inSlot = new Uint8Array(W * W);
        for (const s of mine) for (let y = Math.floor(s.y * res); y < Math.ceil((s.y + s.h) * res); y++) inSlot.fill(1, y * W + Math.floor(s.x * res), y * W + Math.ceil((s.x + s.w) * res));
        let stray = 0;
        for (let i = 0; i < W * W; i++) if (!inSlot[i] && px[i * 4 + 3] > 8) stray++;
        pages.push({ index: pg.index, kind: pg.kind, slots: mine.length, stray });
        // picture: the page over a dark checker, the live slots outlined, the three operators' slots in colour
        const c = R.extract.canvas(pg.rt);
        const o = document.createElement('canvas');
        o.width = c.width; o.height = c.height;
        const g = o.getContext('2d');
        for (let y = 0; y < o.height; y += 16) for (let x = 0; x < o.width; x += 16) { g.fillStyle = ((x + y) / 16) % 2 ? '#2a2a2e' : '#222226'; g.fillRect(x, y, 16, 16); }
        g.drawImage(c, 0, 0);
        g.strokeStyle = 'rgba(255,255,255,0.35)';
        for (const s of mine) g.strokeRect(s.x * res + 0.5, s.y * res + 0.5, s.w * res - 1, s.h * res - 1);
        const colours = ['#ff4d4d', '#4dd2ff', '#ffd24d'];
        ops.forEach(([id, , label], k) => {
          const s = view.debug.views.get(id)?.imp?.slot;
          if (!s || s.page !== pg) return;
          g.strokeStyle = colours[k]; g.lineWidth = 2;
          g.strokeRect(s.x * res + 1, s.y * res + 1, s.w * res - 2, s.h * res - 2);
          g.fillStyle = colours[k]; g.font = '12px sans-serif'; g.fillText(label, s.x * res + 4, s.y * res + 14);
          g.lineWidth = 1;
        });
        images.push({ index: pg.index, url: o.toDataURL('image/png') });
      }
      return { units, pages, images, screens: ops.map(([id]) => ({ ...view.debug.views.get(id).screen })) };
    }, OPS);
    for (const im of info.images) writeFileSync(path.join(OUT, `impostor-542-${TAG}-atlas-page${im.index}.png`), Buffer.from(im.url.split(',')[1], 'base64'));
    // each operator alone on the field (the crowd keeps drawing into the atlas, hidden in the main pass; bars hidden)
    await page.evaluate((ids) => {
      const view = window.__demo.view;
      for (const [id, v] of view.debug.views) if (!ids.includes(id)) { v.root.visible = false; v.shadow.visible = false; }
      view.debug.ctx.layers.bars.visible = false;
    }, OPS.map((o) => o[0]));
    await wait(300);
    const rect = await page.evaluate(() => { const r = document.querySelector('#field canvas').getBoundingClientRect(); return { left: r.left, top: r.top }; });
    for (const [k, [, , label]] of OPS.entries()) {
      const s = info.screens[k];
      const w = s.s * 3.4, h = s.s * 3.6;
      await page.screenshot({ path: path.join(OUT, `impostor-542-${TAG}-${label}.png`), clip: { x: Math.max(0, rect.left + s.x - w / 2), y: Math.max(0, rect.top + s.y - h * 0.84), width: w, height: h } });
    }
    await page.evaluate((ids) => {
      const view = window.__demo.view;
      for (const [id, v] of view.debug.views) if (!ids.includes(id)) { v.root.visible = true; v.shadow.visible = true; }
      view.debug.ctx.layers.bars.visible = true;
    }, OPS.map((o) => o[0]));
    for (const u of info.units) {
      assert.equal(u.track, u.clip, `${u.label}: holding ${u.clip}`);
      assert.ok(u.slot, `${u.label}: drawn through the atlas`);
      assert.ok(u.over <= 0.5, `${u.label}: the pose is ${u.over.toFixed(1)} px past its slot`);
    }
    for (const p of info.pages) assert.equal(p.stray, 0, `${p.kind} page ${p.index}: ${p.stray} px outside the live slots`);
    assert.deepEqual(problems, []);
  });

  test('the scissor on a bare atlas page: a quad 9× its slot paints only the slot; a redraw clears it; a neighbour keeps its pixels', async () => {
    const r = await page.evaluate(async () => {
      const { ImpostorAtlas } = await import('/js/render/impostor.js');
      const R = window.__demo.view.debug.app.renderer;
      const atlas = new ImpostorAtlas(R);
      try {
        const a = atlas.alloc(64, 64), b = atlas.alloc(64, 64);
        // 16 px white quads, scaled by the draw transform (atlas.draw sets the scale, as for a skeleton)
        const quad = (tint) => { const s = new PIXI.Sprite(PIXI.Texture.WHITE); s.tint = tint; return s; };
        const big = quad(0xff0000), small = quad(0x00ff00), nb = quad(0x0000ff);
        for (const s of [big, small, nb]) atlas.park(s);
        const read = () => {
          const px = R.extract.pixels(a.page.rt), W = Math.round(a.page.size * atlas.res), k = atlas.res;
          const at = (x, y) => { const i = (Math.floor(y * k) * W + Math.floor(x * k)) * 4; return [px[i], px[i + 1], px[i + 2], px[i + 3]]; };
          let outside = 0;
          for (let y = 0; y < Math.round(160 * k); y++) for (let x = 0; x < Math.round(256 * k); x++) {
            const cx = x / k, cy = y / k;
            const inA = cx >= a.x && cx < a.x + a.w && cy >= a.y && cy < a.y + a.h, inB = cx >= b.x && cx < b.x + b.w && cy >= b.y && cy < b.y + b.h;
            if (!inA && !inB && px[(y * W + x) * 4 + 3] > 8) outside++;
          }
          return { outside, aCorner: at(a.x + 60, a.y + 60), aCentre: at(a.x + 8, a.y + 8), bCentre: at(b.x + 32, b.y + 32) };
        };
        // b: a blue square, drawn once; then a alone: a red quad 3× the slot each way, offset so that, unclipped, it would
        // paint over b (not redrawn: its eraser stays off) and the free space right of and below the slots
        atlas.draw(b, nb, { a: 4, d: 4, tx: 0, ty: 0 });            // 64 px: all of b
        atlas.flush();
        atlas.draw(a, big, { a: 12, d: 12, tx: -32, ty: -32 });     // 192 px from (−32, −32)
        atlas.flush();
        const first = read();
        // a again with a 16 px green quad in its corner: the rest of the slot must be empty
        atlas.draw(a, small, { a: 1, d: 1, tx: 0, ty: 0 });
        atlas.flush();
        const second = read();
        return { first, second, a: [a.x, a.y, a.w, a.h], b: [b.x, b.y, b.w, b.h] };
      } finally {
        atlas.destroy();
      }
    });
    assert.deepEqual(r.a.slice(2), [64, 64]);
    assert.equal(r.first.outside, 0, 'nothing painted outside the slots');
    assert.deepEqual(r.first.aCorner.slice(0, 1).concat(r.first.aCorner[3]), [255, 255], 'slot a filled red');
    assert.deepEqual(r.first.bCentre, [0, 0, 255, 255], 'slot b keeps its blue: a\'s spill was cut at a\'s edge');
    assert.equal(r.second.aCorner[3], 0, 'the redraw cleared the rest of slot a');
    assert.deepEqual(r.second.aCentre, [0, 255, 0, 255], 'and drew the new quad');
    assert.deepEqual(r.second.bCentre, [0, 0, 255, 255], 'b untouched');
    assert.equal(r.second.outside, 0);
  });

  test('a clip too large for the box (野鬃\'s deploy drop) is drawn directly while it plays, then the impostor is back', async () => {
    const r = await page.evaluate(async () => {
      const v = window.__demo.view.debug.views.get(6);
      const over = [...v._box.over];
      v.actor._play('Idle', true, { mix: 0 });
      v.onDeploy();                                     // the Start clip, as b.ev 'deploy'
      await new Promise((ok) => setTimeout(ok, 120));
      const during = { bypass: !!v.imp?.bypass, sprite: v.imp?.sprite.visible, inBody: v.actor.spine.parent === v.body, slot: !!v.imp?.slot };
      await new Promise((ok) => setTimeout(ok, 1600));   // 1 s clip at the demo's 2× clock, then its mix out
      const afterwards = { bypass: !!v.imp?.bypass, sprite: v.imp?.sprite.visible, track: v.actor.spine.state.tracks[0]?.animation?.name };
      return { over, during, afterwards };
    });
    assert.ok(r.over.includes('Start'), `over: ${r.over}`);
    assert.deepEqual(r.during, { bypass: true, sprite: false, inBody: true, slot: true }, 'drawn directly, its slot kept');
    assert.equal(r.afterwards.bypass, false);
    assert.equal(r.afterwards.sprite, true, 'the impostor again');
    assert.deepEqual(problems, []);
  });
});
