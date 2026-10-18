// 「轮到你选」 (ui/turnPopup.js, css/screens/game-panels.css .sptp): the official effectChoose sprites it draws, the
// wiring in screens/game.js (the shared draft's own turn, with the 轮到你 sound, once the art is in, never with reduced
// motion) and the stylesheet's rules. In a browser: test/ui/turn-popup.e2e.test.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');
const P = await import('../../public/js/ui/turnPopup.js');

test('the official effectChoose sprites, all in the asset list; no drawn stand-ins; not ready without them', () => {
  const ui = JSON.parse(read('data/assets.json')).ui;
  const js = read('public/js/ui/turnPopup.js');
  const keys = js.match(/const ART = \[([^\]]+)\]/)[1].match(/'([A-Za-z_0-9/]+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(keys.sort(), ['effectChoose/bg_circle', 'effectChoose/bottom', 'effectChoose/plus', 'effectChoose/square_1', 'effectChoose/square_2']);
  for (const k of keys) assert.ok(k in ui, k);
  for (const m of js.matchAll(/k="([^"]+)"/g)) assert.ok(keys.includes(m[1]), m[1]);
  assert.doesNotMatch(js, /<svg/, 'no drawn mark');
  assert.equal(P.turnPopupArtReady(), false, 'in Node (no Image) it never turns ready');
  assert.equal(P.TURN_POPUP_MS, 1200);
});

test('screens/game.js: the disc on the shared draft\'s own turn, with the 轮到你 sound, once the art is in, never with reduced motion', () => {
  const g = read('public/js/screens/game.js');
  assert.match(g, /const spMine = !!sp && !solo && sp\.turnPid === myId && !sp\.pickOf\.has\(myId\);/);
  assert.match(g, /useEffect\(\(\) => \{ preloadTurnPopupArt\(\); \}, \[\]\);/);
  assert.match(g, /if \(!spMine\) return;\n\s+audio\.sfx\('yourTurn'\);\n\s+if \(turnPopupArtReady\(\) && !reducedMotion\(\)\) setTurnPop\(\(n\) => n \+ 1\);/);
  assert.match(g, /<\$\{TurnPopup\} key=\$\{turnPop\} onDone=\$\{\(\) => setTurnPop\(0\)\} \/>/);
});

test('the stylesheet: every keyframe it uses is defined, no clicks caught, reduced motion hides it, the project\'s rules', () => {
  const css = read('public/css/screens/game-panels.css');
  const block = css.slice(css.indexOf('.sptp {'), css.indexOf('.sptp { display: none; }') + 30);
  const used = new Set([...block.matchAll(/animation:\s*([^;]+);/g)].map((m) => m[1].trim().split(/\s+/)[0]));
  assert.ok(used.size >= 4, [...used].join(','));
  for (const n of used) assert.match(block, new RegExp(`@keyframes ${n} \\{`), n);
  assert.match(block, /\.sptp \{[^}]*pointer-events: none;/);
  assert.match(block, /@media \(prefers-reduced-motion: reduce\) \{\n\s+\.sptp \{ display: none; \}/);
  assert.doesNotMatch(block, /!important|:has\(|--t\s*:/);
});
