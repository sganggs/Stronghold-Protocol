// Real Pixi/Spine frame regression. Opt in with RENDER_E2E=1 and CHROME_PATH.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const skip = process.env.RENDER_E2E !== '1' || !existsSync(CHROME);

test('finished field idles living Spine models and drains effects; paused feed does neither', { skip, timeout: 90000 }, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  mkdirSync('test/e2e/out', { recursive: true });
  const profile = mkdtempSync('test/e2e/out/battle-finish-profile-');
  try {
    await srv.assetIndex?.whenReady();
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, userDataDir: profile, args: ['--no-first-run', '--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    if (process.env.BATTLE_FINISH_BASELINE) {
      const source = execFileSync('git', ['show', `${process.env.BATTLE_FINISH_BASELINE}:public/js/render/app.js`], { encoding: 'utf8' });
      await page.setRequestInterception(true);
      page.on('request', request => request.url().endsWith('/js/render/app.js') ? request.respond({ status: 200, contentType: 'text/javascript', body: source }) : request.continue());
    }
    await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?scene=normal-m01&t=18&paused=1&panel=0`);
    await page.waitForFunction(() => window.__demo?.ready && [...window.__demo.view.debug.views.values()].some(v => v.alive && v.actor), { timeout: 45000 });
    const result = await page.evaluate(async () => {
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const { ANIM } = await import('/shared/constants.js');
      const { compileEffect, Effect } = await import('/js/render/vfx/effect.js');
      const view = window.__demo.view, { interp, views, ofx } = view.debug;
      const unit = [...views.values()].find(v => v.alive && v.actor && !v.down);
      const snap = interp.snaps[interp.snaps.length - 1].raw;
      const gt = interp.newestT + 0.1;
      view.pushSnapshot({ ...snap, t: gt, gt, units: snap.units.map(row => row[0] === unit.id ? [...row.slice(0, 8), ANIM.STUN] : row) });
      await sleep(1200);
      const frozenBefore = unit.actor.frozen;
      ofx.clear(); view.debug.wiring.clear();
      ofx.lib._available = true; ofx.unsupported = false; ofx.tier = 'full';
      const effect = loop => {
        const node = { id: 0, name: 'test', parent: null, children: [], active: true, pos: [0, 0, 0], rot: [0, 0, 0, 1], scale: [1, 1, 1], behaviours: [],
          particleSystem: { lengthInSec: 0.2, looping: loop, playOnAwake: true, simulationSpeed: 1,
            InitialModule: { startLifetime: 0.3, startSpeed: 0, startSize: 1, startColor: [1, 1, 1, 1], maxNumParticles: 100 },
            EmissionModule: { rateOverTime: loop ? 10 : 0, m_Bursts: loop ? [] : [{ time: 0, countCurve: 2, cycleCount: 1, probability: 1 }] } } };
        return new Effect(compileEffect({ format: 'fx-prefab', version: 1, key: 'finish-test', nodes: [node], materials: [], clips: [], textures: [], meshes: [], refs: [], stats: {} }), { seed: 1 });
      };
      const loop = effect(true), hit = effect(false);
      ofx.effects.push(loop, hit);
      const before = ofx.time;
      await sleep(450);
      const paused = { frozen: unit.actor.frozen, effects: ofx.effects.length, hasLoop: ofx.effects.includes(loop), hasHit: ofx.effects.includes(hit), timeDelta: ofx.time - before, loopState: loop.state };
      view.finishBattle?.();
      await sleep(500);
      const idle = { frozen: unit.actor.frozen, base: unit.actor.base, clip: unit.actor.current, time: unit.actor.spine.state.tracks[0]?.trackTime, loopState: loop.state };
      await sleep(2200);
      const after = { clip: unit.actor.current, time: unit.actor.spine.state.tracks[0]?.trackTime, effects: ofx.effects.length, renderT: interp.renderT, newestT: interp.newestT };
      return { frozenBefore, paused, idle, after };
    });
    console.log(JSON.stringify(result));
    mkdirSync('test/e2e/out', { recursive: true });
    await page.screenshot({ path: `test/e2e/out/battle-finish${process.env.BATTLE_FINISH_BASELINE ? '-baseline' : ''}.png` });
    assert.equal(result.frozenBefore, true);
    assert.equal(result.paused.frozen, true);
    assert.equal(result.paused.hasLoop, true);
    assert.equal(result.paused.hasHit, true);
    assert.ok(result.paused.timeDelta < 0.01);
    assert.equal(result.paused.loopState, 'play');
    assert.equal(result.idle.frozen, false);
    assert.equal(result.idle.base, 'idle');
    assert.notEqual(result.idle.loopState, 'play');
    assert.ok(result.after.time > result.idle.time, 'real Spine idle track advances after completion');
    assert.equal(result.after.effects, 0);
    assert.deepEqual(errors, []);
  } finally { await browser?.close(); await srv.close(); rmSync(profile, { recursive: true, force: true }); }
});
