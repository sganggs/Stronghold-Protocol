// The operator model facing (DESIGN §37.329; PR #730 by @Seals-awa) in headless Chrome with real pixi-spine and the
// downloaded models, through the dev demo's recording scene (public/dev/render-demo.html: recorded b.ev / b.snap frames
// fed through the game's pushEvents / pushSnapshot path):
//   * a recorded battle turns operators' models toward their attack targets while their deploy direction stays;
//   * a turn up swaps to the Back model in the middle of the 0.15 game s turn, the model drawn edge-on around it, and the
//     attack goes on on the Back model; a turn down brings the Front model back.
// Screenshots → test/e2e/out/attack-facing-*.png.
//
// Opt-in (starts Chrome): RENDER_E2E=1 node --test test/render/attack-facing.browser.test.js   (PORT=<n> to pin the port)

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'test/e2e/out');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const enabled = process.env.RENDER_E2E === '1' && existsSync(CHROME) && existsSync(path.join(ROOT, 'public/assets/spine'));
const skip = enabled ? false : 'set RENDER_E2E=1 (needs Chrome and downloaded assets)';

describe('operator attack facing in headless Chrome', { skip, timeout: 180000 }, () => {
  let srv, browser;
  before(async () => {
    const puppeteer = (await import('puppeteer-core')).default;
    const { startServer } = await import('../../server/index.js');
    srv = await startServer({ port: Number(process.env.PORT) || 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
    mkdirSync(OUT, { recursive: true });
  });
  after(async () => {
    await browser?.close();
    await srv?.close();
  });

  async function open(query) {
    const page = await browser.newPage();
    const problems = [];
    page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
    await page.setViewport({ width: 1280, height: 720 });
    await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?${query}&board=2d&panel=0`);
    await page.waitForFunction('window.__demo && (window.__demo.ready || window.__demo.error)', { timeout: 40000 });
    assert.equal(await page.evaluate(() => window.__demo.error || null), null, 'demo boot');
    return { page, problems };
  }

  test('a recorded battle turns operators toward their targets; the deploy direction stays', async (t) => {
    // normal-m02: enemies get behind and above some operators (a left turn and back, a turn up to the Back model)
    const { page, problems } = await open('scene=normal-m02');
    // watch every operator view for 20 s of playback: each change of its drawn facing (mirror, skeleton) and its dir
    const r = await page.evaluate(async () => {
      const { views } = window.__demo.view.debug;
      const seen = new Map();
      const t0 = performance.now();
      while (performance.now() - t0 < 20000) {
        await new Promise((res) => setTimeout(res, 50));
        for (const v of views.values()) {
          if (!v.face || v.prep) continue;
          const key = `${v.face.sign === 3 ? 'L' : 'R'}${v.face.back ? 'B' : 'F'}`;
          let s = seen.get(v.id);
          if (!s) seen.set(v.id, (s = { def: v.info.defId, dir: v.dir, keys: [key], dirKept: true }));
          if (key !== s.keys[s.keys.length - 1]) s.keys.push(key);
          s.dirKept &&= v.dir === s.dir;
        }
      }
      // the skeleton drawn follows the facing (no load in flight, standing operators with a Back model)
      const skeleton = [...views.values()].filter((v) => v.face && !v.prep && v.alive && v.actor && !v._spineBusy && v._hasBackModel())
        .map((v) => ({ def: v.info.defId, ok: !!v.entryBack === v._wantsBack() }));
      return { ops: [...seen.values()], skeleton };
    });
    await page.screenshot({ path: path.join(OUT, 'attack-facing-recording.png') });
    await page.close();
    assert.deepEqual(problems, []);
    assert.ok(r.ops.length >= 3, `operators watched: ${r.ops.length}`);
    const turned = r.ops.filter((s) => s.keys.length > 1);
    t.diagnostic(`turned ${turned.length} of ${r.ops.length}: ${turned.map((s) => `${s.def} ${s.dir} ${s.keys.join('>')}`).join(', ')}`);
    assert.ok(turned.length >= 1, `some operator's model turned: ${JSON.stringify(r.ops)}`);
    for (const s of r.ops) assert.ok(s.dirKept, `${s.def}: dir ${s.dir} stayed`);
    for (const s of r.skeleton) assert.ok(s.ok, `${s.def}: the skeleton drawn is the one the facing asks for`);
  });

  test('a turn up: Back model in the middle of the turn, drawn edge-on around it, the attack goes on; down: Front again', async () => {
    const { page, problems } = await open('scene=normal-m01&t=18&paused=1');
    await page.waitForFunction(() => [...window.__demo.view.debug.views.values()].some((v) => v.face && v.actor && v.alive && v._hasBackModel() && !v.entryBack), { timeout: 30000 });
    const r = await page.evaluate(async () => {
      const { views } = window.__demo.view.debug;
      const v = [...views.values()].find((u) => u.face && u.actor && u.alive && u._hasBackModel() && !u.entryBack);
      const frame = () => new Promise((res) => requestAnimationFrame(res));
      const ratio = () => {
        const s = v.imp && v.imp.sprite.parent ? v.imp.sprite.scale : v.actor.spine.scale;
        return Math.abs(s.x) / Math.abs(s.y);
      };
      const out = { def: v.info.defId, dir: v.dir, before: { back: !!v.entryBack, ratio: ratio() } };
      v.face.reset(v.dir);
      // an attack starting now (a strike no wind-up started) at a target three tiles above
      v.onAttack({ x: v.x + 0.4, y: v.y + 3 }, v.gameT, 'none');
      out.turning = v.face.turning;
      let minRatio = Infinity;
      const t0 = performance.now();
      while (performance.now() - t0 < 700) {
        await frame();
        if (v.face.turning) minRatio = Math.min(minRatio, ratio());
      }
      out.minRatio = minRatio;
      out.up = { back: !!v.entryBack, actorBack: v.actor.entry === v._modelEntry(true), mode: v.actor.mode, ratio: ratio(), dir: v.dir };
      // below and to the left, past the ±0.2 dead zone (straight below would keep the mirror it had)
      v.onAttack({ x: v.x - 1.2, y: v.y - 3 }, v.gameT, 'none');
      const t1 = performance.now();
      while (performance.now() - t1 < 700) await frame();
      out.down = { back: !!v.entryBack, flip: v.modelFlip(), ratio: ratio() };
      return out;
    });
    await page.screenshot({ path: path.join(OUT, 'attack-facing-turns.png') });
    await page.close();
    assert.deepEqual(problems, []);
    assert.equal(r.before.back, false, `${r.def} starts on its Front model`);
    assert.equal(r.turning, true, 'the attack start turns it');
    assert.ok(r.minRatio < 0.5, `drawn edge-on around the swap (min width ratio ${r.minRatio})`);
    assert.equal(r.up.back, true, 'the Back model took over');
    assert.ok(Math.abs(r.up.ratio - 1) < 0.02, `full width again (${r.up.ratio})`);
    assert.equal(r.up.dir, r.dir, 'display only');
    assert.equal(r.down.back, false, 'a target below: the Front model');
    assert.equal(r.down.flip, -1, 'mirrored toward the target on the left');
  });
});
