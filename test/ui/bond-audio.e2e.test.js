import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { Client, ROOT, hasChrome, startRealServer } from '../e2e/client.mjs';

const enabled = process.env.SP_E2E === '1' && hasChrome() && existsSync(`${ROOT}/public/assets`);

test('buying Matterhorn sends two live layer cues through the real client; resync/reload stays silent',
  { skip: !enabled, timeout: 120000 }, async () => {
    const P = (await import('puppeteer-core')).default;
    const srv = await startRealServer({ fast: { timerScale: 0.1, startRound: 2, kit: 0, shop: ['chess_char_1_02_a'] } });
    const c = new Client(P, srv.base, 'bond-audio', { prefix: 'bond-audio' });
    try {
      await c.open();
      const mediaHits = [];
      c.page.on('response', (r) => { const p = new URL(r.url()).pathname; if (p.startsWith('/media/')) mediaHits.push({ p, status: r.status(), cache: r.headers()['cache-control'] }); });
      await c.enter('叠层音效测试');
      await c.click('.mode-card', '独立模拟'); await c.click('.diff-card', '险境');
      await c.click('.create-box button', '开始独立模拟');
      await c.waitFor(s => !!s.room, 'solo room');
      if (!(await c.st()).phase) await c.click('.room-bar__right button', '开始模拟');
      await c.waitFor(s => s.phase === 'INFO_CHECK', 'briefing');
      await c.click('.brief__foot .btn--primary', '准备就绪');
      await c.waitFor(s => s.phase === 'BAND_DRAFT', 'band draft');
      await c.page.click('.dband'); await c.click('.draft-detail__btns .btn--primary', '确认选择');
      await c.waitFor(s => s.phase === 'PREP' && !s.ready, 'prep');
      await c.page.evaluate(async () => {
        const { audio } = await import('/js/audio.js');
        const { net } = await import('/js/net.js');
        window.__layerCues = []; window.__layerFrames = [];
        const play = audio._playBondCue.bind(audio);
        audio._playBondCue = (url, volume) => { window.__layerCues.push({ url, volume }); play(url, volume); };
        net.on('m.layer', m => window.__layerFrames.push(m));
      });
      await c.click('.scard', '角峰'); await c.click('.scard', '角峰');
      await c.page.waitForFunction(() => window.__layerFrames.length === 2);
      const result = await c.page.evaluate(async () => {
        const { audio } = await import('/js/audio.js');
        // Wait for the actual local asset decoder; then its queued cue continuation starts the source.
        await Promise.all([...audio.buffers.values()]); await Promise.resolve();
        return { frames: window.__layerFrames, cues: window.__layerCues, playing: !!audio.bondCueNode,
          state: audio.ctx?.state, layers: globalThis.__SP__.store.get().match.private.bonds };
      });
      assert.deepEqual(result.frames.map(m => [m.bondId, m.add]).sort(), [['kjeragShip', 2], ['steadShip', 2]]);
      assert.equal(result.cues.length, 2); assert.equal(result.playing, true); assert.equal(result.state, 'running');
      assert.ok(result.cues.every(x => /act1autochess_b_ui_buffup/.test(x.url)));
      // host bandwidth layer 1: the served manifest names the cue with its content hash and the client fetches it through
      // the extension-less /media/~<hash>/… route, cached immutably (skipped with SP_ASSET_INDEX=0: plain URLs)
      if (result.cues[0].url.includes('/~')) {
        assert.ok(result.cues.every(x => /^\/assets\/~[0-9a-f]{16}\/audio\//.test(x.url)), JSON.stringify(result.cues));
        const hit = mediaHits.find(h => /^\/media\/~[0-9a-f]{16}\/.*act1autochess_b_ui_buffup$/.test(h.p));
        assert.ok(hit, mediaHits.map(h => h.p).join(' '));
        assert.equal(hit.status, 200);
        assert.equal(hit.cache, 'public, max-age=31536000, immutable');
      }
      const count = result.cues.length;
      // g.watch on own prep asks the real server for state again, without a new gain.
      await c.page.evaluate(() => globalThis.__SP__.net.request('g.watch', { fieldId: `n:${globalThis.__SP__.store.get().me.playerId}` }));
      assert.equal(await c.page.evaluate(() => window.__layerCues.length), count);
      await c.page.reload({ waitUntil: 'networkidle0' });
      await c.waitFor(s => s.phase === 'PREP', 'restored prep');
      assert.equal(await c.page.evaluate(async () => !!(await import('/js/audio.js')).audio.bondCueNode), false);
      assert.equal(c.problems.filter(x => x.startsWith('pageerror:')).length, 0, c.problems.join('\n'));
    } finally { await c.close(); await srv.stop(); }
  });
