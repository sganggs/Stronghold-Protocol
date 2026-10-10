// PR #434: real pixi-spine's final pose/mixing and shared ring textures, beyond the fake-PIXI unit tests.
// RENDER_E2E=1 node --test test/render/held-pose.browser.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const skip = process.env.RENDER_E2E !== '1' || !existsSync(CHROME);
test('real Spine held death matches forced updates; revival and late font rasterisation remain live', { skip, timeout: 90000 }, async () => {
  const { startServer } = await import('../../server/index.js');
  const puppeteer = (await import('puppeteer-core')).default;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-first-run'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') console.error(m.text()); });
    await page.goto(`http://127.0.0.1:${srv.port}/dev/render-demo.html?scene=normal-m01&t=18&paused=1&panel=0`);
    await page.waitForFunction(() => window.__demo?.ready && [...window.__demo.view.debug.views.values()].some(v => v.actor?.dieClip()), { timeout: 30000 });
    const result = await page.evaluate(async () => {
      const { SpineActor } = await import('/js/render/spine.js');
      const T = await import('/js/render/textures.js');
      const { app, views } = window.__demo.view.debug;
      app.stop();
      const source = [...views.values()].find(v => v.actor?.dieClip()).actor;
      const a = new SpineActor(source.spine.spineData, source.entry);
      const b = new SpineActor(source.spine.spineData, source.entry);
      const renderer = app.renderer;
      const hash = obj => {
        const pixels = renderer.extract.pixels(obj);
        let value = 2166136261, ink = 0;
        for (let i = 0; i < pixels.length; i++) { value = Math.imul(value ^ pixels[i], 16777619); if (i % 4 === 3 && pixels[i]) ink++; }
        return { value: value >>> 0, bytes: pixels.length, ink };
      };
      a.update(0.1);b.update(0.1);a.die();b.die();
      const firstHeld = a.poseHeld();
      // Exercise a real mix that outlasts the outgoing death clip, not merely the unposed first frame.
      for (const actor of [a, b]) {
        const track = actor.spine.state.tracks[0];
        track.mixDuration = track.animationEnd - track.animationStart + 0.25;
      }
      let skipped = 0, equal = true, ink = 0, endMixFrames = 0, mixedHeld = false;
      for (let i = 0; i < 600; i++) {
        const track = a.spine.state.tracks[0];
        if (track.mixingFrom && track.trackTime >= track.animationEnd - track.animationStart) {
          endMixFrames++;mixedHeld ||= a.poseHeld();
        }
        if (a.poseHeld()) { a.clock += 1 / 60;skipped++; } else a.update(1 / 60);
        b.update(1 / 60);
        if (i % 15 === 0) {
          const x = hash(a.spine), y = hash(b.spine);
          equal &&= x.value === y.value && x.bytes === y.bytes;
          ink = Math.max(ink, x.ink);
        }
      }
      const finalA = hash(a.spine), finalB = hash(b.spine);
      const finalVisibleEqual = a.poseHeld() && finalA.ink > 0 && finalA.value === finalB.value && finalA.bytes === finalB.bytes;
      const clocksEqual = Math.abs(a.clock - b.clock) < 1e-9;
      a.revive();a.deploy();a.update(1 / 60);
      const revived = !a.poseHeld() && !a.dead;
      a.spine.destroy({ children: true });b.spine.destroy({ children: true });
      // A label created before Bender loads must keep its texture identity when real glyphs arrive.
      await document.fonts.ready;
      document.querySelector('link[href="/fonts/fonts.css"]').remove();
      await Promise.resolve();
      const benderAbsent = ![...document.fonts].some(f => f.family.replace(/["']/g, '') === 'Bender');
      const label = T.downLabel('470', '#ffffff', 1);
      const sprite = new PIXI.Sprite(label), before = hash(sprite);
      const font = new FontFace('Bender', 'url(/fonts/bender-regular.woff2)', { weight: '400' });
      await font.load();document.fonts.add(font);T.refreshDownLabels();
      const after = hash(sprite);
      const sameTexture = T.downLabel('470', '#ffffff', 1) === label;
      const separateResolution = T.downLabel('470', '#ffffff', 2) !== label;
      sprite.destroy();
      return { firstHeld, skipped, equal, ink, finalVisibleEqual, clocksEqual, revived, sameTexture, separateResolution, endMixFrames, mixedHeld,
        benderAbsent, fontChanged: before.value !== after.value || before.bytes !== after.bytes, fontInk: after.ink };
    });
    assert.equal(result.firstHeld, false, 'initial pose / mix must run');
    assert.ok(result.skipped > 100, JSON.stringify(result));
    assert.ok(result.endMixFrames > 0, 'real runtime mix remains after the death clip ends');
    assert.equal(result.mixedHeld, false, 'mixed final poses still advance');
    assert.equal(result.equal, true, 'held final frame is pixel-identical to continual updates');
    assert.ok(result.ink > 0, 'the comparison renders actual art');
    assert.equal(result.finalVisibleEqual, true, 'the held final pose itself is visible and identical');
    assert.equal(result.clocksEqual, true);
    assert.equal(result.revived, true);
    assert.equal(result.sameTexture, true);
    assert.equal(result.separateResolution, true);
    assert.equal(result.benderAbsent, true, 'CSS font faces are absent before fallback rasterisation');
    assert.equal(result.fontChanged, true, 'late Bender glyphs replace the fallback');
    assert.ok(result.fontInk > 0);
    assert.deepEqual(errors, []);
  } catch (error) { console.error(error);throw error; } finally { await browser?.close();await srv.close(); }
});
