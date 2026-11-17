// §35.20. Optional installed art is read at runtime, never copied into test fixtures.
// SP_E2E=1 CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node --test test/render/skill-attack-candidates.browser.test.js
// RENDER_E2E=1 is an equivalent gate. SP_CLIP_SHOTS=<dir> additionally saves one PNG per case there.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { gpuArgs } from '../../tools/perfbench.mjs';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const OUT = process.env.SP_CLIP_SHOTS ? path.resolve(process.env.SP_CLIP_SHOTS) : null;
const CHROME = process.env.CHROME_PATH || {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome', win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
}[process.platform];
const enabled = process.env.SP_E2E === '1' || process.env.RENDER_E2E === '1';
const cases = [
  ['char_102_texas', 0, 'Attack_Loop'], ['char_102_texas', 1, 'Attack_Loop'],
  ['char_427_vigil', 0, 'Attack'], ['char_427_vigil', 1, 'Attack'],
  ['char_1023_ghost2', 0, 'Attack'], ['char_1020_reed2', 1, 'Attack'],
  ['char_1014_nearl2', 1, 'Attack_Loop'],
];

describe('verified skill attacks with real Spine models', { skip: !enabled && 'set SP_E2E=1 or RENDER_E2E=1; needs Chrome and local art' }, () => {
  let srv, browser, page;
  const errors = [];
  before(async () => {
    assert.ok(CHROME && existsSync(CHROME), 'CHROME_PATH must name an installed Chrome');
    assert.ok(existsSync(path.join(ROOT, 'public/assets/local/fx/index.json')), 'install the local effects index');
    const { startServer } = await import('../../server/index.js');
    const puppeteer = (await import('puppeteer-core')).default;
    srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: gpuArgs() });
    page = await browser.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?scene=prep&panel=0&paused=1`);
    await page.waitForFunction(() => window.__demo?.ready, { timeout: 60000 });
    await page.evaluate(async () => {
      window.__demo.view.debug.app.stop();
      const [assets, index] = await Promise.all([fetch('/data/assets.json'), fetch('/assets/local/fx/index.json')]);
      if (!assets.ok || !index.ok) throw new Error('missing installed manifest or index');
      window.__clipCheck = { assets: await assets.json(), index: await index.json() };
    });
    if (OUT) mkdirSync(OUT, { recursive: true });
  });
  after(async () => { await browser?.close(); await srv?.close(); });

  for (const [id, slot, strike] of cases) for (const loaded of [false, true]) {
    test(`${id} S${slot + 1}, ${loaded ? 'loaded index' : 'no index'}, four directions`, { timeout: 60000 }, async () => {
      for (const dir of ['RIGHT', 'LEFT', 'DOWN', 'UP']) {
        const r = await page.evaluate(async ({ id, slot, dir, loaded }) => {
          const { SpineActor } = await import('/js/render/spine.js');
          const { skillAttackMode } = await import('/js/render/skillAttack.js');
          const { loadSpineData } = await import('/js/assets.js');
          const { assets, index } = window.__clipCheck;
          const face = dir === 'UP' ? 'back' : 'front';
          const entry = assets.chars[id].spine[face];
          const data = await loadSpineData(entry);
          if (!data) throw new Error(`model did not load: ${id}/${face}`);
          const a = new SpineActor(data, entry);
          a.setSkillIndex(slot);
          a.skillAttackMode = () => ({ ...skillAttackMode(loaded ? index : null, { info: { spine: id, skillIndex: slot } }), down: dir === 'DOWN' });
          a.setSkill(true);
          // Let the one-shot cast finish; ordinary attack events then repeat without restarting that cast.
          for (let n = 0; n < 120; n++) a.update(1 / 30);
          a.windUp(1.2, 0.1);
          for (let n = 0; n < 3; n++) a.update(1 / 30);
          a.attack(1.2);
          a.update(0.08); // settle mixing, retaining the attack's strike pose
          const current = a.spine.state.tracks[0].animation.name;
          const pose = a.strikePose();
          const W = 512, H = 512;
          const stage = new PIXI.Container();
          const holder = new PIXI.Container();
          holder.addChild(a.spine);
          stage.addChild(holder);
          const bounds = a.spine.getLocalBounds();
          const scale = Math.min(440 / Math.max(1, bounds.width), 440 / Math.max(1, bounds.height));
          const sign = dir === 'LEFT' ? -1 : 1;
          holder.scale.set(scale * sign, scale);
          holder.position.set(W / 2 - (bounds.x + bounds.width / 2) * scale * sign, H / 2 - (bounds.y + bounds.height / 2) * scale);
          const rt = PIXI.RenderTexture.create({ width: W, height: H });
          const renderer = window.__demo.view.debug.app.renderer;
          renderer.render(stage, { renderTexture: rt, clear: true });
          const pixels = renderer.extract.pixels(rt);
          let ink = 0;
          for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) ink++;
          const png = await renderer.extract.base64(rt);
          rt.destroy(true);
          for (let n = 0; n < 120; n++) a.update(1 / 30);
          const rest = a.spine.state.tracks[0].animation.name;
          a.attack(1.2);
          const next = a.spine.state.tracks[0].animation.name;
          a.setSkill(false);
          const normal = a._attackClip()?.loop;
          holder.removeChild(a.spine);
          a.destroy();
          stage.destroy({ children: true });
          return { current, next, normal, rest, ink, png, pose: pose?.anim.name, down: !!entry.anims.attackDown };
        }, { id, slot, dir, loaded });
        const expected = dir === 'DOWN' && r.down ? 'Attack_Down' : strike;
        assert.equal(r.current, expected);
        assert.equal(r.pose, expected);
        assert.equal(r.next, expected, 'the second attack stays on the verified strike');
        assert.equal(r.normal, strike, 'skill off restores the normal role');
        assert.equal(r.rest, 'Idle', 'the real track finishes End and returns to Idle');
        assert.ok(r.ink > 500, `visible rendered model: ${r.ink} opaque pixels`);
        const name = `${id}-s${slot + 1}-${dir.toLowerCase()}-${loaded ? 'index' : 'no-index'}.png`;
        if (OUT) writeFileSync(path.join(OUT, name), Buffer.from(r.png.split(',')[1], 'base64'));
      }
      assert.deepEqual(errors, []);
    });
  }
});
