// test/render/feedback1f-liftoff.browser.test.js — player report F3 (sixth batch after 0.1.0) in headless Chrome: the
// client replica (the client runner's loadBrowserSim: the same /sim/ modules and data the browser simulates combat with)
// keeps ground enemies off an airborne 蒂比. On act2 m02's lower lane 蒂比 (S2 紧急赶场通知) stands on the road with 角峰 on
// the fence tile below her and a still 控潮术师 (ground caster: target + 周围四格) in range of both: its first shot sets her
// off (dodged), and while she is airborne (起飞: flag `liftoff`, 对地规避) it only hits 角峰 — never her, neither directly
// nor through the 周围四格 — and once she lands she is hit again (sim: targeting.js evadesGround, attack/helpers.js liftoffEvades).
//
// Opt-in (starts Chrome): RENDER_E2E=1 node --test test/render/feedback1f-liftoff.browser.test.js
// Chrome path: $CHROME_PATH or the macOS default.

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBattleSpec } from '../../server/sim/spec.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.RENDER_E2E === '1' && existsSync(CHROME) && existsSync(path.join(ROOT, 'public/assets'));
const skip = enabled ? false : 'set RENDER_E2E=1 (needs Chrome and downloaded assets)';

const SPEC = buildBattleSpec({
  battleId: 'e2e.liftoff', fieldId: 'n:P1', kind: 'normal', seed: 3, modeId: 'mode_multi_hard', round: 8, stageId: 'act2autochess_m02', timeLimit: 400,
  players: [{ playerId: 'P1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [], units: [
    { uid: 1, kind: 'chess', chessId: 'chess_char_2_13_a', row: 9, col: 5, dir: 'RIGHT', carryState: { sp: 999 } },
    { uid: 2, kind: 'chess', chessId: 'chess_char_1_02_a', row: 10, col: 5, dir: 'RIGHT' },
  ] }],
  spawns: [{ time: 0, enemyKey: 'enemy_1161_tidmag', routeIndex: 0, count: 1, mods: { hpMul: 1e4, speedMul: 0 } }],
  routes: [{ motion: 'WALK', start: [9, 7], end: [9, 2], checkpoints: [] }], flags: {},
});

describe('an airborne 蒂比 is no target of ground enemies in the client replica (headless Chrome, real sim)', { skip }, () => {
  let srv, browser;
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  test('控潮术师 hits 角峰 while 蒂比 is airborne, and her again once she lands', async () => {
    const page = await browser.newPage();
    const problems = [];
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    try {
      await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?scene=normal-m01&paused=1&panel=0`);
      await page.waitForFunction('window.__demo && (window.__demo.ready || window.__demo.error)', { timeout: 30000 });
      const r = await page.evaluate(async (spec) => {
        const { loadBrowserSim } = await import('/js/battle/runner.js');
        const { spec: S, ds } = await loadBrowserSim();
        const b = S.createBattleFromSpec(spec, ds, { quiet: true });
        const hits = [];
        b.on('damaged', (c) => { if (c.source && c.source.side === 'enemy') hits.push({ t: b.time, to: c.target.defId, amount: c.amount, air: !!c.target.s.flags.liftoff }); });
        let up = null, down = null, ground = null;
        for (let i = 0; i < 30 * 60 && (down == null || b.time < down + 12); i++) {
          b.step();
          const u = b.allyUnits.find((x) => x.defId === 'chess_char_2_13_a');
          if (up == null && u.skill.active) { up = b.time; ground = u.ground; }
          if (up != null && down == null && !u.skill.active) down = b.time;
        }
        return { up, down, ground, hits, errors: b.errors.length };
      }, SPEC);
      assert.ok(r.up != null && r.down != null, `took off at ${r.up}, landed at ${r.down}`);
      const tippiAir = r.hits.filter((x) => x.to === 'chess_char_2_13_a' && x.t > r.up + 1e-6 && x.t < r.down - 1e-6);
      assert.deepEqual(tippiAir.map((x) => `${x.t.toFixed(2)} ${Math.round(x.amount)}`), [], 'nothing reaches her while airborne');
      assert.equal(r.ground, true, 'still a ground unit on her tile');
      assert.ok(r.hits.some((x) => x.to === 'chess_char_1_02_a' && x.t > r.up && x.t < r.down), 'the caster shoots 角峰 meanwhile');
      assert.ok(r.hits.some((x) => x.to === 'chess_char_2_13_a' && x.t > r.down), 'hit again after landing');
      assert.equal(r.errors, 0);
      assert.deepEqual(problems, []);
    } finally {
      await page.close();
    }
  });
});
