import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPwaInstall } from '../../public/js/pwa.js';
import { decodePng } from '../../tools/crop-board-atlas.mjs';
function rig(standalone = false) {
  const win = new EventTarget(), display = new EventTarget();
  display.matches = standalone;
  win.matchMedia = () => display;
  const pwa = createPwaInstall(win);
  const offer = (outcome = 'dismissed', fail = false) => {
    let calls = 0;
    const e = new Event('beforeinstallprompt', { cancelable: true });
    e.prompt = async () => { calls++; if (fail) throw Error('unavailable'); return { outcome }; };
    win.dispatchEvent(e);
    return { calls: () => calls, e };
  };
  return { pwa, win, display, offer };
}
test('install offer is consumed even on dismissal, duplicate clicks, or rejected prompt', async () => {
  const { pwa, offer } = rig();
  const states = []; const off = pwa.subscribe((x) => states.push(x));
  assert.equal(pwa.available(), false);
  const first = offer();
  assert.equal(first.e.defaultPrevented, true);
  assert.equal(pwa.available(), true);
  const a = pwa.request(), b = pwa.request();
  assert.equal(await a, false); assert.equal(await b, false); assert.equal(first.calls(), 1);
  const broken = offer('accepted', true);
  assert.equal(await pwa.request(), false); assert.equal(await pwa.request(), false); assert.equal(broken.calls(), 1);
  const next = offer('accepted');
  assert.equal(await pwa.request(), true); assert.equal(next.calls(), 1);
  assert.deepEqual(states, [false, true, false, true, false, true, false]);
  off(); pwa.dispose();
});
test('installed / standalone hides stale offers; disposing removes listeners', async () => {
  const { pwa, win, display, offer } = rig();
  offer(); display.matches = true; display.dispatchEvent(new Event('change'));
  assert.equal(pwa.available(), false); assert.equal(await pwa.request(), false);
  display.matches = false; win.dispatchEvent(new Event('appinstalled')); offer();
  assert.equal(pwa.available(), false);
  pwa.dispose();
  assert.equal(offer().e.defaultPrevented, false);
  const native = rig(true); native.offer(); assert.equal(native.pwa.available(), false); native.pwa.dispose();
});
test('manifest provides opaque mint-rook 192/512 icons for both purposes with a safe maskable mark', () => {
  const m = JSON.parse(readFileSync(new URL('../../public/manifest.json', import.meta.url)));
  assert.equal(m.start_url, '/'); assert.equal(m.scope, '/');
  assert.deepEqual(m.icons.map((i) => `${i.purpose}:${i.sizes}`).sort(),
    ['any:192x192', 'any:512x512', 'maskable:192x192', 'maskable:512x512']);
  for (const icon of m.icons) {
    assert.ok(icon.src.startsWith('/icons/'));
    assert.equal(icon.type, 'image/png');
    const bytes = readFileSync(new URL('../../public' + icon.src, import.meta.url));
    const size = Number(icon.sizes.split('x')[0]);
    const { w, h, rgba } = decodePng(bytes);
    assert.equal(w, size); assert.equal(h, size);
    let foreground = 0, solidMint = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      assert.equal(rgba[i + 3], 255, 'opaque edge-to-edge');
      const [r, g, b] = rgba.subarray(i, i + 3);
      if (r === 12 && g === 15 && b === 14) continue; // Original #0c0f0e background
      assert.ok(g >= b && b > r, 'mint palette, including antialiased edges');
      if (r === 78 && g === 216 && b === 175) solidMint++; // Original #4ed8af
      foreground++;
      if (icon.purpose === 'maskable') {
        // W3C safe zone is a circle, not merely a centred 80% square.
        const dx = x + 0.5 - w / 2, dy = y + 0.5 - h / 2;
        assert.ok(dx * dx + dy * dy <= (size * 0.4) ** 2, `clipped mark at ${x},${y}`);
      }
    }
    assert.ok(foreground > size * size * 0.12, 'the exported mark is not empty or tiny');
    assert.ok(solidMint > size * size * 0.12, 'the original flat mint identity is retained');
  }
});

test('favicon and Apple links resolve to real sizes, including all legacy ICO frames', () => {
  const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
  const links = [...html.matchAll(/<link rel="(?:icon|apple-touch-icon)"[^>]+>/g)].map(([s]) => s);
  assert.equal(links.length, 5);
  for (const link of links) {
    const href = link.match(/href="([^"]+)"/)[1];
    assert.ok(href.startsWith('/icons/'), href);
    const bytes = readFileSync(new URL('../../public' + href, import.meta.url));
    if (href.endsWith('.png')) {
      const { w, h } = decodePng(bytes);
      assert.ok(link.includes(`sizes="${w}x${h}"`), href);
    } else if (href.endsWith('.svg')) {
      assert.match(bytes.toString(), /viewBox="0 0 512 512"/);
      assert.doesNotMatch(bytes.toString(), /<(?:image|text|use|foreignObject|linearGradient|radialGradient|filter)\b|(?:href|font-family)=/);
    } else {
      assert.equal(bytes.readUInt16LE(2), 1);
      assert.equal(bytes.readUInt16LE(4), 3);
      for (const [i, size] of [16, 32, 48].entries()) {
        const entry = 6 + i * 16;
        assert.equal(bytes[entry], size); assert.equal(bytes[entry + 1], size);
        const length = bytes.readUInt32LE(entry + 8), offset = bytes.readUInt32LE(entry + 12);
        assert.ok(length > 0 && offset >= 54 && offset + length <= bytes.length);
        // Decode the legacy 24-bit DIB and its 1-bit transparency mask. Both row
        // types need 4-byte alignment; malformed masks can punch holes in an icon.
        assert.equal(bytes.readUInt32LE(offset), 40);
        assert.equal(bytes.readInt32LE(offset + 4), size);
        assert.equal(bytes.readInt32LE(offset + 8), size * 2);
        assert.equal(bytes.readUInt16LE(offset + 14), 24);
        assert.equal(bytes.readUInt32LE(offset + 16), 0);
        const colorStride = Math.ceil(size * 3 / 4) * 4, maskStride = Math.ceil(size / 32) * 4;
        assert.equal(length, 40 + (colorStride + maskStride) * size, `${size}px aligned ICO frame`);
        const mask = bytes.subarray(offset + 40 + colorStride * size, offset + length);
        assert.ok(mask.every((byte) => byte === 0), `${size}px ICO is fully opaque`);
        const { rgba } = decodePng(readFileSync(new URL(`../../public/icons/favicon-${size}.png`, import.meta.url)));
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const bmp = offset + 40 + (size - 1 - y) * colorStride + x * 3;
          const png = (y * size + x) * 4;
          for (let c = 0; c < 3; c++) assert.equal(bytes[bmp + 2 - c], rgba[png + c], `${size}px ICO matches PNG`);
        }
      }
    }
  }
  for (const size of [16, 32, 48]) {
    const { w, h, rgba } = decodePng(readFileSync(new URL(`../../public/icons/favicon-${size}.png`, import.meta.url)));
    assert.equal(w, size); assert.equal(h, size);
    // At actual favicon sizes, the three battlements must stay separated and the
    // tower must remain narrower than its base. Sample visible raster features.
    const row = (y) => Array.from({ length: w }, (_, x) => rgba[(Math.floor(y * h) * w + x) * 4 + 1] > 100);
    const runs = (pixels) => pixels.filter((on, x) => on && !pixels[x - 1]).length;
    const crown = row(0.19), tower = row(0.56), base = row(0.79);
    assert.equal(runs(crown), 3, `${size}px battlement gaps stay open`);
    assert.equal(runs(tower), 1, `${size}px tower stays connected`);
    assert.equal(runs(base), 1, `${size}px base stays connected`);
    assert.ok(tower.filter(Boolean).length < base.filter(Boolean).length, `${size}px inset tower remains legible`);
  }
});
