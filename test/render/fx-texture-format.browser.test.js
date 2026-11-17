// RENDER_E2E=1 node --test test/render/fx-texture-format.browser.test.js
// Original generated images exercise the real FX loader's Bitmap/Image paths and straight-alpha GPU upload.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gpuArgs } from '../../tools/perfbench.mjs';
import { CHROME, hasChrome } from '../e2e/client.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PY = ['python3', 'python'].find(bin => spawnSync(bin, ['--version']).status === 0);
const hasWebP = PY && spawnSync(PY, ['-c', "from PIL import features; import sys; sys.exit(0 if features.check('webp') else 1)"]).status === 0;
const enabled = process.env.RENDER_E2E === '1' && hasChrome() && hasWebP;

test('PNG/WebP decode, orientation, alpha and FX GPU uploads agree in both browser decode paths', {
  skip: !enabled && 'set RENDER_E2E=1 (needs Chrome and Pillow with WebP)', timeout: 90000,
}, async t => {
  const fixture = spawnSync(PY, ['-c', `import io, json, base64
from PIL import Image
out = {}
for tier, size in (('full', (32, 16)), ('half', (16, 8))):
    img = Image.new('RGBA', size)
    img.putdata([(40 + x * 5, 30 + y * 10, 160, 64 + ((x + y) % 4) * 48) for y in range(size[1]) for x in range(size[0])])
    for kind in ('png', 'webp'):
        buf = io.BytesIO()
        img.save(buf, kind.upper(), **({'lossless': True, 'exact': True} if kind == 'webp' else {}))
        out[tier + '.' + kind] = base64.b64encode(buf.getvalue()).decode()
print(json.dumps(out))`], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(fixture.status, 0, fixture.stderr);
  const images = Object.fromEntries(Object.entries(JSON.parse(fixture.stdout)).map(([key, value]) => [key, Buffer.from(value, 'base64')]));
  const srv = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost').pathname;
    const encoding = url.endsWith('.webp') ? 'webp' : 'png';
    if (url.startsWith('/fixture/')) { res.setHeader('Content-Type', `image/${encoding}`); res.end(images[url.split('/').at(-1)]); return; }
    if (url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>FX texture transport</title>'); return; }
    const rel = url.startsWith('/shared/') ? url.slice(1) : `public${url}`;
    const file = path.resolve(ROOT, rel);
    if (!file.startsWith(`${ROOT}${path.sep}`) || !file.endsWith('.js')) { res.writeHead(404); res.end(); return; }
    try { res.setHeader('Content-Type', 'application/javascript'); res.end(readFileSync(file)); }
    catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => srv.close(resolve)));
  const { default: puppeteer } = await import('puppeteer-core');
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: gpuArgs() });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${srv.address().port}/`);
  const result = await page.evaluate(async () => {
    const { FxLibrary } = await import('/js/render/vfx/library.js');
    const { FxGL } = await import('/js/render/vfx/gl.js');
    const bitmap = globalThis.createImageBitmap;
    const results = [];
    for (const useBitmap of [true, false]) {
      globalThis.createImageBitmap = useBitmap ? bitmap : undefined;
      const list = { groups: { fx: {}, 'fx/prefabs': { fixture: { path: '/fixture.json' } }, 'fx/mesh': {}, 'fx/tex': {
        png: { path: '/fixture/full.png', half: '/fixture/half.png', encoding: 'png' },
        webp: { path: '/fixture/full.webp', half: '/fixture/half.webp', encoding: 'webp' },
      } } };
      const lib = new FxLibrary({ list });
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      if (!gl) throw new Error('WebGL2 unavailable');
      const fxgl = new FxGL(gl, lib);
      const uploaded = [];
      for (const half of [false, true]) for (const key of ['png', 'webp']) {
        const loaded = await lib.loadTexture(key, half);
        if (!loaded) throw new Error(`failed to load ${key}`);
        const size = [loaded.image.width, loaded.image.height];
        const flipped = loaded.flipped;
        const texture = fxgl.texture(key, half);
        const fb = gl.createFramebuffer();
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('incomplete texture framebuffer');
        const pixels = new Uint8Array(size[0] * size[1] * 4);
        gl.readPixels(0, 0, ...size, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
        uploaded.push({ key, half, size, flipped, pixels: [...pixels], error: gl.getError() });
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.deleteFramebuffer(fb);
      }
      results.push({ useBitmap, uploaded });
      fxgl.destroy(); lib.dropImages();
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
    globalThis.createImageBitmap = bitmap;
    return results;
  });
  let maxCodecDifference = 0, maxDecoderDifference = 0;
  for (const r of result) for (let i = 0; i < r.uploaded.length; i += 2) {
    const png = r.uploaded[i], webp = r.uploaded[i + 1];
    assert.deepEqual(png.size, png.half ? [16, 8] : [32, 16]);
    assert.deepEqual(webp.size, png.size);
    assert.equal(png.flipped, r.useBitmap);
    assert.equal(webp.flipped, r.useBitmap);
    assert.equal(png.error, 0); assert.equal(webp.error, 0);
    const difference = png.pixels.reduce((max, value, p) => Math.max(max, Math.abs(value - webp.pixels[p])), 0);
    maxCodecDifference = Math.max(maxCodecDifference, difference);
    assert.ok(difference <= 1, `lossless browser upload difference ${difference}`);
    assert.equal(png.pixels[3], 64 + ((png.size[1] - 1) % 4) * 48, 'first uploaded row is the source bottom row, alpha stays straight');
    assert.equal(png.pixels[0], 40, 'RGB is not premultiplied by alpha');
  }
  for (let i = 0; i < 4; i++) {
    const bitmap = result[0].uploaded[i].pixels, image = result[1].uploaded[i].pixels;
    maxDecoderDifference = Math.max(maxDecoderDifference, ...bitmap.map((value, p) => Math.abs(value - image[p])));
    assert.ok(bitmap.every((value, p) => Math.abs(value - image[p]) <= 1), 'Image fallback agrees with ImageBitmap');
  }
  assert.deepEqual(errors, []);
  t.diagnostic(`8 full/half GPU uploads; max PNG/WebP channel difference ${maxCodecDifference}; max Bitmap/Image difference ${maxDecoderDifference}`);
});
