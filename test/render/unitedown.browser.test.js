// test/render/unitedown.browser.test.js — user playtest #5 item 2 in headless Chrome: a 联防 helper's operator knocked
// out in its own combat enters the 联防 field down. The real sim runs in the page (the /sim/ modules and /data/*.json,
// like the client runner's loadBrowserSim) on a 联防 BattleSpec whose operator carries `carryState: { down: true }`,
// and feeds the render demo's field view frame by frame (local feed, the runner's b.snap / b.ev frames): from the first
// frame the operator lies on its tile in its held Die pose (no fall) under the redeploy ring counting its full timer
// while its teammate stands, then it comes back on its tile.
//
// Opt-in (starts Chrome): RENDER_E2E=1 node --test test/render/unitedown.browser.test.js
// Chrome path: $CHROME_PATH or the macOS default. Screenshots → test/e2e/out/unitedown-*.png.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBattleSpec } from '../../server/sim/spec.js';
import { GEO } from '../../shared/constants.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.RENDER_E2E === '1' && existsSync(CHROME) && existsSync(path.join(ROOT, 'public/assets'));
const skip = enabled ? false : 'set RENDER_E2E=1 (needs Chrome and downloaded assets)';
// 德克萨斯's redeploy time and cost from the data (at full potential since 0.2.1: 60 s and 11; 70 s and 13 before)
const TEXAS = JSON.parse(readFileSync(path.join(ROOT, 'data/chess.json'), 'utf8')).chess_char_1_08_a.stats;

// the right-hand helper of a two-helper 联防 (colOffset +8): 德克萨斯 knocked out in its own combat,
// with 艾雅法拉 standing at half HP; the only enemy spawns long after the check (it keeps the battle running)
const SPEC = buildBattleSpec({
  battleId: 'e2e.1.1.u', fieldId: 'u', kind: 'unite', seed: 77, modeId: 'mode_multi_normal', round: 3, stageId: 'act2autochess_m01',
  rect: { ...GEO.UNITE_RECT }, timeLimit: 400, flags: { layerGainsEnabled: false },
  spawns: [{ time: 390, enemyKey: 'enemy_1000_gopro_2', routeIndex: 0 }], routes: [{ motion: 'WALK', start: [12, 18], end: [9, 2], checkpoints: [] }],
  players: [{
    playerId: 'p_1', seat: 1, side: 'L', colOffset: 8, bonds: {}, playerEffects: [],
    units: [
      { uid: 1, kind: 'chess', chessId: 'chess_char_1_08_a', row: 10, col: 4, dir: 'RIGHT', items: [], carryState: { down: true } },
      { uid: 2, kind: 'chess', chessId: 'chess_char_6_20_a', row: 11, col: 3, dir: 'RIGHT', items: [], carryState: { hpPct: 0.5, sp: 0, skillActive: false } },
    ],
  }],
});

/** Page side: the sim in the browser + a feed into the demo view. `advance(ticks)` steps and pushes one frame. */
async function installSim(spec) {
  const [S, simdata, support] = await Promise.all([import('/sim/spec.js'), import('/sim/simdata.js'), import('/sim/content/support/index.js')]);
  const names = ['chess', 'enemies', 'tokens', 'stages', 'waves', 'bonds', 'items', 'garrisons', 'bands', 'effects'];
  const raw = {};
  for (const n of names) raw[n] = await fetch(`/data/${n}.json`).then((r) => r.json());
  simdata.setSimData(raw);
  if (typeof support.setGameData === 'function') support.setGameData(null);
  const battle = S.createBattleFromSpec(spec, new simdata.DataSource(raw, null));
  const v = window.__demo.view;
  // what the runner's show() publishes: the field meta before the first step (nothing deployed yet)
  v.enterBattle({ ...battle.fieldMeta(), fieldId: 'u', kind: 'unite', rect: spec.rect, stageId: spec.stageId });
  v.setCamera('unite', { rect: spec.rect, side: 'R', instant: true });
  v.setLocalFeed({ on: true, speed: 2 });
  const frame = () => {
    const ev = battle.drainEvents();
    const gt = battle.time;
    if (ev.length) v.pushEvents({ t: 'b.ev', fieldId: 'u', gt, ev });
    const { t, ...rest } = battle.snapshot();
    v.pushSnapshot({ ...rest, t: 'b.snap', fieldId: 'u', gt: t });
  };
  frame();
  window.__sim = {
    battle,
    advance(n) { for (let i = 0; i < n; i++) battle.step(); frame(); },
    unit(uid) { return battle.allyUnits.find((u) => u.uid === uid); },
    state() {
      const out = {};
      for (const [id, x] of v.debug.views) {
        out[id] = { alive: x.alive, down: x.down ? x.down.state : null, ring: !!x._downRing?.root?.visible, label: x._downRing?.label ?? null,
          dieClip: x.actor?.current ?? null, dieT: x.dieT ?? null, alpha: +(x.alpha ?? 0).toFixed(2), x: x.x, y: x.y, spine: !!x.spineReady };
      }
      return out;
    },
  };
}

describe('联防: an operator knocked out in its own combat enters down (headless Chrome, real sim)', { skip }, () => {
  let srv, browser;
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  test('down on its tile from the first frame, ring counting its full timer, then redeployed', async () => {
    const page = await browser.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    page.on('response', (r) => { if (r.status() >= 400) problems.push(`HTTP ${r.status()} ${r.url()}`); });
    try {
      await page.setViewport({ width: 1280, height: 720 });
      await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?scene=normal-m01&paused=1&panel=0`);
      await page.waitForFunction('window.__demo && (window.__demo.ready || window.__demo.error)', { timeout: 30000 });
      await page.evaluate(installSim, SPEC);
      // real speed for 2 game s (2 ticks per frame at 60 fps), then the Spine models load
      const run = (frames, ticks) => page.evaluate(async (frames, ticks) => {
        for (let i = 0; i < frames; i++) { window.__sim.advance(ticks); await new Promise((r) => requestAnimationFrame(() => r())); }
      }, frames, ticks);
      await run(60, 2);
      await new Promise((r) => setTimeout(r, 1500));
      await run(30, 2);
      const texas = await page.evaluate(() => window.__sim.unit(1).id);
      const eyja = await page.evaluate(() => window.__sim.unit(2).id);
      let st = await page.evaluate(() => window.__sim.state());
      await page.screenshot({ path: path.join(OUT, 'unitedown-start.png') });
      assert.ok(st[texas], 'the knocked-out operator has a view on the 联防 field');
      assert.equal(st[texas].alive, false);
      assert.equal(st[texas].down, 0, 'down, its timer counting');
      assert.ok(st[texas].ring, 'redeploy ring');
      const gt = await page.evaluate(() => window.__sim.battle.time);
      const left = [6, 5, 4].map((k) => String(TEXAS.respawnTime - k));
      assert.ok(gt > 5.9 && left.includes(st[texas].label), `its full ${TEXAS.respawnTime} s timer (${st[texas].label} s left at ${gt.toFixed(2)} s)`);
      assert.equal(st[texas].dieClip, 'Die', 'held Die pose');
      assert.ok(st[texas].alpha > 0.8, `drawn (alpha ${st[texas].alpha})`);
      assert.deepEqual([Math.round(st[texas].x), Math.round(st[texas].y)], [12, 10], 'on its own tile (board col 4 + 8)');
      assert.equal(st[eyja].alive, true, 'the teammate stands');
      // fast-forward to the redeploy (DP 10 + 1/s reaches her cost long before her redeploy timer ends)
      await run(40, 60);
      await run(30, 2);
      st = await page.evaluate(() => window.__sim.state());
      await page.screenshot({ path: path.join(OUT, 'unitedown-redeployed.png') });
      assert.equal(st[texas].alive, true, 'back on its tile');
      assert.equal(st[texas].down, null);
      assert.equal(st[texas].ring, false);
      assert.deepEqual(problems, []);
    } finally {
      await page.close();
    }
  });
});
