// Real-server browser E2E — 自定义大厅背景与音乐 (PR #643 split 8). The lobby's 大厅背景与音乐 dialog (the project's Modal)
// offers four generated scenes (夜巡 / 霜原 / 烬野 / 静默: one shows at once and is kept, 默认背景 takes it away) and
// takes the player's own picture through its file input: it covers the official backdrop at once, 暗度 darkens it, and
// it is still there after a reload (IndexedDB). A WebM video (recorded in the page) replaces it and plays muted under the
// site CSP. A file that is not what it says is refused with a toast and changes nothing. Own music (a WAV written here)
// becomes the lobby's track (played when the page's audio runs) and switching it off gives the official track back;
// the switches survive a reload. 删除 removes each. Esc closes the dialog
// and gives the focus back; on a phone in landscape the dialog stays on screen. No console error (a CSP refusal is one).
//
//   SP_E2E=1 node --test test/ui/lobby-media.e2e.test.js
//
// Screenshots: test/e2e/out/lobby-media-*.png.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client, ROOT, hasChrome, startRealServer, problemsOf } from '../e2e/client.mjs';

const ENABLED = process.env.SP_E2E === '1' && hasChrome() && existsSync(path.join(ROOT, 'public/assets'));

/** A mono 16-bit WAV of a sine (`seconds` long). */
function wav(seconds = 1, rate = 22050) {
  const n = Math.round(seconds * rate);
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin((i / rate) * 2 * Math.PI * 440) * 8000), 44 + i * 2);
  return b;
}
/** Bytes made in the page: a PNG from a canvas, or a WebM recorded from one. */
const pageFile = (c, kind) => c.page.evaluate(async (kind) => {
  const cv = document.createElement('canvas');
  cv.width = 320; cv.height = 180;
  const g = cv.getContext('2d');
  const paint = (k) => { g.fillStyle = `hsl(${(k * 40) % 360} 60% 40%)`; g.fillRect(0, 0, 320, 180); g.fillStyle = '#fff'; g.fillRect(20 + k * 8, 60, 60, 60); };
  let blob;
  if (kind === 'png') { paint(3); blob = await new Promise((r) => cv.toBlob(r, 'image/png')); } else {
    const rec = new MediaRecorder(cv.captureStream(15), { mimeType: 'video/webm' });
    const parts = [];
    rec.ondataavailable = (e) => parts.push(e.data);
    const stopped = new Promise((r) => { rec.onstop = r; });
    rec.start();
    for (let k = 0; k < 14; k++) { paint(k); await new Promise((r) => setTimeout(r, 70)); }
    rec.stop();
    await stopped;
    blob = new Blob(parts, { type: 'video/webm' });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}, kind).then((b64) => Buffer.from(b64, 'base64'));

const media = (c) => c.page.evaluate(async () => {
  const { audio } = await import('/js/audio.js');
  const own = document.querySelector('[data-testid="own-backdrop"]');
  const img = own?.querySelector('img'), video = own?.querySelector('video');
  return {
    own: own ? (img ? 'image' : video ? 'video' : '?') : null,
    imgOk: !!img && img.complete && img.naturalWidth > 0,
    video: video ? { ready: video.readyState, muted: video.muted, loop: video.loop, w: video.videoWidth } : null,
    dim: own ? getComputedStyle(own).getPropertyValue('--own-dim').trim() : null,
    bgName: document.querySelector('[data-testid="media-backdrop-name"]')?.textContent ?? null,
    musicName: document.querySelector('[data-testid="media-music-name"]')?.textContent ?? null,
    lobbyTrack: audio.lobbyTrack ? audio.lobbyTrack.id : null,
    lobbyLoop: audio._bgmTrack('lobby')?.loop ?? null,
    playing: audio.bgm?.loopUrl ?? null,
    ctx: audio.ctx?.state ?? null,
    pref: localStorage.getItem('sp.pref.lobby.media'),
  };
});
const openDialog = async (c) => {
  await c.click('[data-testid="lobby-media"]');
  await c.page.waitForSelector('.modal__box.lmedia', { visible: true });
};
const upload = async (c, slot, file) => {
  const input = await c.page.$(`[data-testid="media-${slot}-file"]`);
  await input.uploadFile(file);
};

describe('自定义大厅背景与音乐 (real server)', { skip: !ENABLED && 'set SP_E2E=1 (Chrome + public/assets)' }, () => {
  test('own picture / video / music: shown, refused, kept after a reload, switched off, deleted; a phone', { timeout: 4 * 60 * 1000 }, async () => {
    const tmp = mkdtempSync(path.join(os.tmpdir(), 'lobby-media-e2e-'));
    const srv = await startRealServer();
    const P = (await import('puppeteer-core')).default;
    const c = new Client(P, srv.base, 'media', { prefix: 'lobby-media' });
    try {
      await c.open();
      await c.enter('凯尔希');
      const files = {
        png: path.join(tmp, '我的背景.png'), webm: path.join(tmp, 'loop.webm'), wav: path.join(tmp, '大厅曲.wav'), fake: path.join(tmp, 'not-a-picture.png'),
      };
      writeFileSync(files.png, await pageFile(c, 'png'));
      writeFileSync(files.webm, await pageFile(c, 'webm'));
      writeFileSync(files.wav, wav());
      writeFileSync(files.fake, 'this is text, not a picture');

      // the dialog: the defaults, 完成 has the focus
      await openDialog(c);
      let m = await media(c);
      assert.equal(m.own, null);
      assert.equal(m.bgName, '默认背景');
      assert.equal(m.musicName, '默认音乐');
      assert.equal(await c.page.evaluate(() => document.activeElement?.textContent?.trim()), '完成');

      // 大厅场景: a generated scene over the official backdrop, at once; 默认背景 takes it away
      assert.equal(await c.page.$('[data-testid="hub-scene"]'), null);
      await c.click('.bgset__theme[data-scene="frost"]');
      await c.page.waitForFunction(() => document.querySelector('[data-testid="hub-scene"]')?.dataset.hubTheme === 'frost');
      assert.equal(JSON.parse(await c.page.evaluate(() => localStorage.getItem('sp.pref.lobby.media'))).scene, 'frost');
      await c.page.keyboard.press('Escape');
      await c.page.waitForFunction(() => !document.querySelector('.modal__box.lmedia'));
      await c.shot('hub-scene-frost');
      await openDialog(c);
      await c.click('.bgset__theme[data-scene="official"]');
      await c.page.waitForFunction(() => !document.querySelector('[data-testid="hub-scene"]'));

      // own picture: over the official backdrop at once; 暗度
      await upload(c, 'backdrop', files.png);
      await c.page.waitForFunction(() => document.querySelector('[data-testid="own-backdrop"] img')?.naturalWidth > 0, { timeout: 10000 });
      m = await media(c);
      assert.equal(m.own, 'image');
      assert.equal(m.bgName, '我的背景.png');
      assert.equal(m.dim, '0.35');
      await c.page.$eval('[data-testid="media-dim"]', (el) => { el.value = '60'; el.dispatchEvent(new Event('input', { bubbles: true })); });
      await c.page.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid="own-backdrop"]')).getPropertyValue('--own-dim').trim() === '0.6');
      await c.shot('dialog');

      // a file that is not what it says: refused, nothing changes
      await upload(c, 'backdrop', files.fake);
      await c.page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => /无法显示这张图片/.test(t.textContent)), { timeout: 12000 });
      assert.equal((await media(c)).bgName, '我的背景.png');

      // own music: the lobby's track, played from its bytes (test/ui/lobby-media.test.js: never a request)
      await upload(c, 'music', files.wav);
      await c.page.waitForFunction(async () => (await import('/js/audio.js')).audio.lobbyTrack != null, { timeout: 15000 });
      m = await media(c);
      assert.equal(m.musicName, '大厅曲.wav');
      assert.match(m.lobbyLoop, /^local-bgm:/);
      if (m.ctx === 'running') {
        await c.page.waitForFunction(async () => /^local-bgm:/.test((await import('/js/audio.js')).audio.bgm?.loopUrl || ''), { timeout: 10000 });
      }
      // off: the official track again; the choice is kept
      await c.click('[data-testid="media-music-on"]');
      m = await media(c);
      assert.equal(m.lobbyTrack, null);
      assert.equal(m.musicName, '默认音乐');
      assert.deepEqual(JSON.parse(m.pref), { backdrop: true, music: false, dim: 0.6, scene: 'official' });

      // Esc closes it and gives the focus back
      await c.page.keyboard.press('Escape');
      await c.page.waitForFunction(() => !document.querySelector('.modal__box.lmedia'));
      assert.equal(await c.page.evaluate(() => document.activeElement?.dataset?.testid || null), 'lobby-media');
      await c.shot('hub-own-picture');

      // a reload: the picture (IndexedDB) and the switches stay; music on again
      await c.page.reload({ waitUntil: 'domcontentloaded' });
      await c.page.waitForSelector('.lobby-screen');
      await c.page.waitForFunction(() => document.querySelector('[data-testid="own-backdrop"] img')?.naturalWidth > 0, { timeout: 15000 });
      await openDialog(c);
      m = await media(c);
      assert.equal(m.bgName, '我的背景.png');
      assert.equal(m.dim, '0.6');
      assert.equal(m.lobbyTrack, null);
      await c.click('[data-testid="media-music-on"]');
      await c.page.waitForFunction(async () => (await import('/js/audio.js')).audio.lobbyTrack != null);

      // a video instead of the picture: muted, looping, playing under the site CSP
      await upload(c, 'backdrop', files.webm);
      await c.page.waitForFunction(() => document.querySelector('[data-testid="own-backdrop"] video')?.readyState >= 2, { timeout: 15000 });
      m = await media(c);
      assert.equal(m.own, 'video');
      assert.ok(m.video.muted && m.video.loop && m.video.w > 0, JSON.stringify(m.video));
      assert.equal(m.bgName, 'loop.webm');

      // a phone in landscape: the dialog stays on screen
      // (switching to a touch viewport reloads the page: the files come back from IndexedDB)
      await c.page.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true });
      await c.page.waitForFunction(() => document.querySelector('[data-testid="own-backdrop"] video')?.readyState >= 2, { timeout: 15000 });
      await openDialog(c);
      const box = await c.page.$eval('.modal__box.lmedia', (el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight }; });
      assert.ok(box.l >= 0 && box.t >= 0 && box.r <= box.w + 0.5 && box.b <= box.h + 0.5, JSON.stringify(box));
      await c.page.screenshot({ path: path.join(ROOT, 'test/e2e/out/lobby-media-phone.png') });
      await c.page.setViewport({ width: 1920, height: 1080, isMobile: false, hasTouch: false });
      await c.page.waitForSelector('.lobby-screen');
      await openDialog(c);

      // 删除: back to the official backdrop and music
      await c.click('[data-testid="media-backdrop-remove"]');
      await c.click('[data-testid="media-music-remove"]');
      // (each 删除 deletes the IndexedDB record first)
      await c.page.waitForFunction(() => !document.querySelector('[data-testid="media-backdrop-remove"], [data-testid="media-music-remove"]'));
      m = await media(c);
      assert.equal(m.own, null);
      assert.equal(m.lobbyTrack, null);
      assert.equal(m.bgName, '默认背景');
      assert.equal(m.musicName, '默认音乐');
      assert.equal(await c.page.$('[data-testid="media-backdrop-remove"]'), null);

      assert.deepEqual(problemsOf([c]), []);
    } finally {
      await c.close();
      await srv.stop();
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
